use serde::Serialize;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct PowerSnapshot {
    pub suspended: bool,
    pub epoch: u64,
}

#[cfg(any(windows, test))]
#[derive(Debug, Default)]
struct SuspendState {
    display_off: bool,
    session_locked: bool,
    system_suspending: bool,
    epoch: u64,
}

#[cfg(any(windows, test))]
impl SuspendState {
    fn snapshot(&self) -> PowerSnapshot {
        PowerSnapshot {
            suspended: self.display_off || self.session_locked || self.system_suspending,
            epoch: self.epoch,
        }
    }

    fn update(&mut self, set: impl FnOnce(&mut Self)) -> Option<PowerSnapshot> {
        let before = self.snapshot();
        set(self);
        if self.snapshot().suspended == before.suspended {
            return None;
        }
        self.epoch += 1;
        Some(self.snapshot())
    }

    fn set_display_status(&mut self, status: u32) -> Option<PowerSnapshot> {
        let off = match status {
            0 => true,
            1 | 2 => false,
            _ => return None,
        };
        self.update(|state| state.display_off = off)
    }

    fn set_session_locked(&mut self, locked: bool) -> Option<PowerSnapshot> {
        self.update(|state| state.session_locked = locked)
    }

    fn set_system_suspending(&mut self, suspending: bool) -> Option<PowerSnapshot> {
        self.update(|state| state.system_suspending = suspending)
    }
}

#[cfg(windows)]
mod platform {
    use super::{PowerSnapshot, SuspendState};
    use crate::DesktopResult;
    use std::{
        cell::RefCell,
        mem::size_of,
        ptr::{addr_of, null, null_mut},
        rc::Rc,
        sync::{mpsc, Mutex},
        thread::{self, JoinHandle},
    };
    use windows_sys::Win32::{
        Foundation::{GetLastError, HWND, LPARAM, LRESULT, WPARAM},
        System::{
            LibraryLoader::GetModuleHandleW,
            Power::{
                RegisterPowerSettingNotification, RegisterSuspendResumeNotification,
                UnregisterPowerSettingNotification, UnregisterSuspendResumeNotification,
                HPOWERNOTIFY, POWERBROADCAST_SETTING,
            },
            RemoteDesktop::{
                WTSFreeMemory, WTSQuerySessionInformationW, WTSRegisterSessionNotification,
                WTSSessionInfoEx, WTSUnRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION,
                WTSINFOEXW, WTS_CURRENT_SERVER_HANDLE, WTS_CURRENT_SESSION, WTS_SESSIONSTATE_LOCK,
                WTS_SESSIONSTATE_UNLOCK,
            },
            SystemServices::GUID_SESSION_DISPLAY_STATUS,
        },
        UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
            KillTimer, PostMessageW, PostQuitMessage, RegisterClassW, SetTimer, TranslateMessage,
            UnregisterClassW, DEVICE_NOTIFY_WINDOW_HANDLE, MSG, PBT_APMRESUMEAUTOMATIC,
            PBT_APMRESUMESUSPEND, PBT_APMSUSPEND, PBT_POWERSETTINGCHANGE, WM_CLOSE, WM_DESTROY,
            WM_POWERBROADCAST, WM_TIMER, WM_WTSSESSION_CHANGE, WNDCLASSW, WTS_SESSION_LOCK,
            WTS_SESSION_UNLOCK,
        },
    };

    const WTS_TIMER: usize = 1;
    pub(super) const RETRY_MS: [u32; 5] = [200, 400, 800, 1600, 2000];

    struct Monitor {
        hwnd: isize,
        thread: JoinHandle<()>,
    }

    static MONITOR: Mutex<Option<Monitor>> = Mutex::new(None);

    struct WindowState {
        suspend: SuspendState,
        on_change: Rc<dyn Fn(PowerSnapshot)>,
        wts_registered: bool,
        retries: usize,
    }

    thread_local! {
        static WINDOW: RefCell<Option<WindowState>> = const { RefCell::new(None) };
    }

    fn update_state(change: impl FnOnce(&mut SuspendState) -> Option<PowerSnapshot>) {
        let update = WINDOW.with(|slot| {
            let mut slot = slot.borrow_mut();
            let state = slot.as_mut()?;
            let previous = (
                state.suspend.display_off,
                state.suspend.session_locked,
                state.suspend.system_suspending,
            );
            let edge = change(&mut state.suspend);
            let current = (
                state.suspend.display_off,
                state.suspend.session_locked,
                state.suspend.system_suspending,
            );
            if current != previous {
                let snapshot = state.suspend.snapshot();
                eprintln!(
                    "power: epoch={} suspended={} display_off={} session_locked={} system_suspending={}",
                    snapshot.epoch, snapshot.suspended, current.0, current.1, current.2
                );
            }
            edge.map(|snap| (Rc::clone(&state.on_change), snap))
        });
        if let Some((notify, snapshot)) = update {
            notify(snapshot);
        }
    }

    pub(super) fn session_locked(flags: i32) -> Option<bool> {
        match flags as u32 {
            WTS_SESSIONSTATE_LOCK => Some(true),
            WTS_SESSIONSTATE_UNLOCK => Some(false),
            _ => None,
        }
    }

    fn query_session_locked() -> DesktopResult<bool> {
        let mut buffer = null_mut();
        let mut bytes = 0;
        let ok = unsafe {
            WTSQuerySessionInformationW(
                WTS_CURRENT_SERVER_HANDLE,
                WTS_CURRENT_SESSION,
                WTSSessionInfoEx,
                &mut buffer,
                &mut bytes,
            )
        };
        let result = if ok == 0 {
            Err(win32_error("WTSQuerySessionInformationW"))
        } else if buffer.is_null() || (bytes as usize) < size_of::<WTSINFOEXW>() {
            Err("WTSSessionInfoEx returned an incomplete record".into())
        } else {
            let info = unsafe { &*buffer.cast::<WTSINFOEXW>() };
            if info.Level == 1 {
                session_locked(unsafe { info.Data.WTSInfoExLevel1.SessionFlags })
                    .ok_or_else(|| "WTSSessionInfoEx returned an unknown lock state".into())
            } else {
                Err("WTSSessionInfoEx returned an unsupported level".into())
            }
        };
        if !buffer.is_null() {
            unsafe { WTSFreeMemory(buffer.cast()) };
        }
        result
    }

    fn sync_wts(hwnd: HWND) {
        let registered = WINDOW.with(|slot| {
            slot.borrow()
                .as_ref()
                .is_some_and(|state| state.wts_registered)
        });
        let result = if registered
            || unsafe { WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION) } != 0
        {
            WINDOW.with(|slot| {
                if let Some(state) = slot.borrow_mut().as_mut() {
                    state.wts_registered = true;
                }
            });
            query_session_locked()
        } else {
            Err(win32_error("WTSRegisterSessionNotification"))
        };
        match result {
            Ok(locked) => update_state(|state| state.set_session_locked(locked)),
            Err(error) => {
                let delay = WINDOW.with(|slot| {
                    let mut slot = slot.borrow_mut();
                    let state = slot.as_mut()?;
                    let delay = *RETRY_MS.get(state.retries)?;
                    state.retries += 1;
                    Some(delay)
                });
                if let Some(delay) = delay {
                    if unsafe { SetTimer(hwnd, WTS_TIMER, delay, None) } != 0 {
                        return;
                    }
                    eprintln!("power: {}", win32_error("SetTimer"));
                }
                eprintln!("power: session startup synchronization unavailable: {error}");
            }
        }
    }

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match message {
            WM_POWERBROADCAST => {
                match wparam as u32 {
                    PBT_POWERSETTINGCHANGE if lparam != 0 => {
                        let setting = lparam as *const POWERBROADCAST_SETTING;
                        let guid = (*setting).PowerSetting;
                        let display = GUID_SESSION_DISPLAY_STATUS;
                        if guid.data1 == display.data1
                            && guid.data2 == display.data2
                            && guid.data3 == display.data3
                            && guid.data4 == display.data4
                            && (*setting).DataLength >= size_of::<u32>() as u32
                        {
                            let value = addr_of!((*setting).Data).cast::<u32>().read_unaligned();
                            update_state(|state| state.set_display_status(value));
                        }
                    }
                    PBT_APMSUSPEND => update_state(|state| state.set_system_suspending(true)),
                    PBT_APMRESUMEAUTOMATIC | PBT_APMRESUMESUSPEND => {
                        update_state(|state| state.set_system_suspending(false));
                    }
                    _ => return DefWindowProcW(hwnd, message, wparam, lparam),
                }
                1
            }
            WM_WTSSESSION_CHANGE => {
                match wparam as u32 {
                    WTS_SESSION_LOCK => update_state(|state| state.set_session_locked(true)),
                    WTS_SESSION_UNLOCK => update_state(|state| state.set_session_locked(false)),
                    _ => {}
                }
                0
            }
            WM_TIMER if wparam == WTS_TIMER => {
                KillTimer(hwnd, WTS_TIMER);
                sync_wts(hwnd);
                0
            }
            WM_CLOSE | WM_DESTROY => {
                PostQuitMessage(0);
                0
            }
            _ => DefWindowProcW(hwnd, message, wparam, lparam),
        }
    }

    fn win32_error(operation: &str) -> String {
        format!("{operation} failed (Win32 {})", unsafe { GetLastError() })
    }

    unsafe fn close_window(hwnd: HWND, display: HPOWERNOTIFY, sleep: HPOWERNOTIFY) {
        KillTimer(hwnd, WTS_TIMER);
        let wts_registered = WINDOW.with(|slot| {
            slot.borrow()
                .as_ref()
                .is_some_and(|state| state.wts_registered)
        });
        if wts_registered {
            WTSUnRegisterSessionNotification(hwnd);
        }
        if display != 0 {
            UnregisterPowerSettingNotification(display);
        }
        if sleep != 0 {
            UnregisterSuspendResumeNotification(sleep);
        }
        DestroyWindow(hwnd);
    }

    fn run_window(ready: &mpsc::SyncSender<DesktopResult<isize>>) -> DesktopResult<()> {
        let class: Vec<u16> = "AraneaePowerMonitor\0".encode_utf16().collect();
        unsafe {
            let instance = GetModuleHandleW(null());
            if instance.is_null() {
                return Err(win32_error("GetModuleHandleW"));
            }
            let window_class = WNDCLASSW {
                hInstance: instance,
                lpfnWndProc: Some(window_proc),
                lpszClassName: class.as_ptr(),
                ..WNDCLASSW::default()
            };
            if RegisterClassW(&window_class) == 0 {
                return Err(win32_error("RegisterClassW"));
            }
            let hwnd = CreateWindowExW(
                0,
                class.as_ptr(),
                null(),
                0,
                0,
                0,
                0,
                0,
                null_mut(),
                null_mut(),
                instance,
                null(),
            );
            let result = if hwnd.is_null() {
                Err(win32_error("CreateWindowExW"))
            } else {
                run_message_loop(hwnd, ready)
            };
            UnregisterClassW(class.as_ptr(), instance);
            result
        }
    }

    unsafe fn run_message_loop(
        hwnd: HWND,
        ready: &mpsc::SyncSender<DesktopResult<isize>>,
    ) -> DesktopResult<()> {
        let sleep = RegisterSuspendResumeNotification(hwnd, DEVICE_NOTIFY_WINDOW_HANDLE);
        if sleep == 0 {
            let error = win32_error("RegisterSuspendResumeNotification");
            close_window(hwnd, 0, sleep);
            return Err(error);
        }
        let display = RegisterPowerSettingNotification(
            hwnd,
            &GUID_SESSION_DISPLAY_STATUS,
            DEVICE_NOTIFY_WINDOW_HANDLE,
        );
        if display == 0 {
            let error = win32_error("RegisterPowerSettingNotification");
            close_window(hwnd, display, sleep);
            return Err(error);
        }
        sync_wts(hwnd);
        let result = if ready.send(Ok(hwnd as isize)).is_ok() {
            let mut msg = MSG::default();
            loop {
                match GetMessageW(&mut msg, null_mut(), 0, 0) {
                    -1 => break Err(win32_error("GetMessageW")),
                    0 => break Ok(()),
                    _ => {
                        TranslateMessage(&msg);
                        DispatchMessageW(&msg);
                    }
                }
            }
        } else {
            Ok(())
        };
        close_window(hwnd, display, sleep);
        result
    }

    pub fn start(on_change: impl Fn(PowerSnapshot) + Send + 'static) -> DesktopResult<()> {
        let mut monitor = MONITOR.lock().map_err(|err| err.to_string())?;
        if monitor.is_some() {
            return Ok(());
        }
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let thread = thread::Builder::new()
            .name("araneae-power-monitor".into())
            .spawn(move || {
                WINDOW.with(|slot| {
                    *slot.borrow_mut() = Some(WindowState {
                        suspend: SuspendState::default(),
                        on_change: Rc::new(on_change),
                        wts_registered: false,
                        retries: 0,
                    });
                });
                if let Err(error) = run_window(&ready_tx) {
                    eprintln!("power: {error}");
                    let _ = ready_tx.send(Err(error));
                }
            })
            .map_err(|err| err.to_string())?;
        match ready_rx.recv() {
            Ok(Ok(hwnd)) => {
                *monitor = Some(Monitor { hwnd, thread });
                Ok(())
            }
            status => {
                let _ = thread.join();
                Err(match status {
                    Ok(Err(error)) => error,
                    _ => "Power monitor exited before initialization".into(),
                })
            }
        }
    }

    pub fn stop() -> DesktopResult<()> {
        let monitor = MONITOR.lock().map_err(|err| err.to_string())?.take();
        if let Some(Monitor { hwnd, thread }) = monitor {
            if unsafe { PostMessageW(hwnd as HWND, WM_CLOSE, 0, 0) } == 0 && !thread.is_finished() {
                return Err(win32_error("PostMessageW(WM_CLOSE)"));
            }
            thread.join().map_err(|_| "Power monitor panicked")?;
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod platform {
    use super::PowerSnapshot;
    use crate::DesktopResult;

    pub fn start(_: impl Fn(PowerSnapshot) + Send + 'static) -> DesktopResult<()> {
        Ok(())
    }

    pub fn stop() -> DesktopResult<()> {
        Ok(())
    }
}

pub use platform::{start, stop};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_flag_combinations_only_publish_combined_state_edges() {
        for mask in 0..8 {
            let mut state = SuspendState::default();
            assert_eq!(state.snapshot(), PowerSnapshot::default());
            state.set_display_status(if mask & 1 == 0 { 1 } else { 0 });
            state.set_session_locked(mask & 2 != 0);
            state.set_system_suspending(mask & 4 != 0);
            assert_eq!(
                state.snapshot(),
                PowerSnapshot {
                    suspended: mask != 0,
                    epoch: u64::from(mask != 0)
                },
            );

            state.set_system_suspending(false);
            assert_eq!(state.snapshot().suspended, mask & 3 != 0);
            state.set_display_status(1);
            assert_eq!(state.snapshot().suspended, mask & 2 != 0);
            state.set_session_locked(false);
            assert_eq!(
                state.snapshot(),
                PowerSnapshot {
                    suspended: false,
                    epoch: 2 * u64::from(mask != 0)
                },
            );
        }
    }

    #[test]
    fn display_dimmed_is_awake_and_unknown_values_do_not_clear_off() {
        let mut state = SuspendState::default();
        assert_eq!(state.set_display_status(2), None);
        assert_eq!(state.set_display_status(0).unwrap().epoch, 1);
        assert_eq!(state.set_display_status(99), None);
        assert!(state.snapshot().suspended);
        assert_eq!(state.set_display_status(2).unwrap().epoch, 2);
        assert_eq!(state.set_display_status(1), None);
    }

    #[test]
    fn repeated_wts_events_are_idempotent() {
        let mut state = SuspendState::default();
        assert_eq!(state.set_session_locked(true).unwrap().epoch, 1);
        assert_eq!(state.set_session_locked(true), None);
        assert_eq!(state.set_session_locked(false).unwrap().epoch, 2);
        assert_eq!(state.set_session_locked(false), None);
    }

    #[cfg(windows)]
    #[test]
    fn wts_flags_and_bounded_retry_intervals() {
        assert_eq!(platform::session_locked(0), Some(true));
        assert_eq!(platform::session_locked(1), Some(false));
        assert_eq!(platform::session_locked(-1), None);
        assert_eq!(platform::RETRY_MS, [200, 400, 800, 1600, 2000]);
    }

    #[cfg(windows)]
    #[test]
    fn start_and_stop_power_monitor_cleanly() {
        start(|_| {}).unwrap();
        stop().unwrap();
        start(|_| {}).unwrap();
        stop().unwrap();
    }
}
