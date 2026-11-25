use crate::desktop;
use crate::settings::{Mode, Settings};

const DRAG_THRESHOLD: f64 = 5.0;

pub fn avoid_radius_logical(size: f64) -> f64 {
    let size = if size.is_finite() && size > 0.0 {
        size
    } else {
        0.5
    };
    (160.0 * size).clamp(95.0, 230.0)
}

pub fn should_avoid(settings: &Settings) -> bool {
    settings.avoid_pointer
        && settings.visible
        && !settings.paused
        && settings.mode != Mode::Follow
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ClickGesture {
    press: Option<desktop::Point>,
}

impl ClickGesture {
    pub fn reset(&mut self) {
        self.press = None;
    }

    pub fn on_down(&mut self, point: desktop::Point, modifier_held: bool) {
        self.press = modifier_held.then_some(point);
    }

    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub fn on_move(&mut self, point: desktop::Point) {
        if self.press.is_some_and(|start| {
            (point.x - start.x).hypot(point.y - start.y) > DRAG_THRESHOLD
        }) {
            self.press = None;
        }
    }

    pub fn on_up(
        &mut self,
        point: desktop::Point,
        modifier_held: bool,
        dragged: bool,
    ) -> Option<desktop::Point> {
        let start = self.press.take()?;
        if !dragged
            && modifier_held
            && (point.x - start.x).hypot(point.y - start.y) <= DRAG_THRESHOLD
        {
            Some(point)
        } else {
            None
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::ClickGesture;
    use crate::{desktop, DesktopResult};
    use block2::RcBlock;
    use objc2::{rc::Retained, runtime::AnyObject, MainThreadMarker};
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags, NSEventType};
    use serde::Serialize;
    use std::{cell::RefCell, ptr::NonNull};
    use tauri::Emitter;

    thread_local! {
        // AppKit installs, invokes, and removes this monitor on the main thread.
        static MONITOR: RefCell<Option<Retained<AnyObject>>> = const { RefCell::new(None) };
    }

    #[derive(Clone, Serialize)]
    struct Destination {
        point: desktop::Point,
        fast: bool,
    }

    fn handle(
        app: &tauri::AppHandle,
        event: &NSEvent,
        gesture: &RefCell<ClickGesture>,
    ) -> DesktopResult<()> {
        let settings = crate::settings(app)?;
        if !settings.visible || settings.paused {
            gesture.borrow_mut().reset();
            return Ok(());
        }
        let main = MainThreadMarker::new().ok_or("Desktop clicks must run on the main thread")?;
        let layout = crate::cached_layout(app)?;
        // A global event normally has no local window. Preserve the actual event
        // location rather than sampling a cursor that may already have moved.
        let location = event.locationInWindow();
        let location = event
            .window(main)
            .map_or(location, |window| window.convertPointToScreen(location));
        let point = desktop::Point {
            x: location.x,
            y: layout.primary_top - location.y,
        };
        let in_work_area = point.x.is_finite()
            && point.y.is_finite()
            && layout
                .screens
                .iter()
                .any(|screen| screen.work_area.contains(point));
        if !in_work_area {
            gesture.borrow_mut().reset();
            return Ok(());
        }
        let command = event.modifierFlags().contains(NSEventModifierFlags::Command);
        match event.r#type() {
            NSEventType::LeftMouseDown => gesture.borrow_mut().on_down(point, command),
            NSEventType::LeftMouseDragged => gesture.borrow_mut().on_move(point),
            NSEventType::LeftMouseUp => {
                if let Some(target) = gesture.borrow_mut().on_up(point, command, false) {
                    app.emit_to(
                        "pet",
                        "pet-destination",
                        Destination {
                            point: target,
                            fast: true,
                        },
                    )
                    .map_err(|error| error.to_string())?;
                }
            }
            _ => {}
        }
        Ok(())
    }

    pub fn start(app: &tauri::AppHandle) -> DesktopResult<()> {
        MainThreadMarker::new().ok_or("Desktop click monitor must start on the main thread")?;
        MONITOR.with(|slot| {
            if slot.borrow().is_some() {
                return Ok(());
            }
            let app = app.clone();
            let gesture = RefCell::new(ClickGesture::default());
            let handler = RcBlock::new(move |event: NonNull<NSEvent>| {
                // AppKit keeps the event alive for the duration of this callback.
                if let Err(error) = handle(&app, unsafe { event.as_ref() }, &gesture) {
                    eprintln!("Desktop click handling failed: {error}");
                    if let Err(report_error) = app.emit_to("controls", "desktop-error", &error) {
                        eprintln!("Could not report desktop click error: {report_error}");
                    }
                }
            });
            // Global monitors receive copies of other apps' events and cannot
            // consume them. Our controls and menu clicks are excluded by AppKit.
            let monitor = NSEvent::addGlobalMonitorForEventsMatchingMask_handler(
                NSEventMask::LeftMouseDown
                    | NSEventMask::LeftMouseUp
                    | NSEventMask::LeftMouseDragged,
                &handler,
            )
            .ok_or("Could not install desktop click monitor")?;
            *slot.borrow_mut() = Some(monitor);
            Ok(())
        })
    }

    pub fn stop() -> DesktopResult<()> {
        MainThreadMarker::new().ok_or("Desktop click monitor must stop on the main thread")?;
        MONITOR.with(|slot| {
            if let Some(monitor) = slot.borrow_mut().take() {
                // This token was returned by addGlobalMonitor and is removed once.
                unsafe { NSEvent::removeMonitor(&monitor) };
            }
        });
        Ok(())
    }

    pub fn update_spider(_center: desktop::Point, _base_scale: f64) {}

    pub fn sync_settings(_settings: &crate::settings::Settings, _base_scale: f64) {}
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{avoid_radius_logical, should_avoid, ClickGesture, DRAG_THRESHOLD};
    use crate::{desktop, settings::Settings, DesktopResult};
    use serde::Serialize;
    use std::{
        sync::{
            atomic::{AtomicBool, AtomicI32, AtomicI64, AtomicU32, AtomicU64, Ordering},
            mpsc::{self, SyncSender, TrySendError},
            Mutex, OnceLock,
        },
        thread::JoinHandle,
        time::{Duration, Instant},
    };
    use tauri::Emitter;
    use windows_sys::Win32::{
        Foundation::{LPARAM, LRESULT, POINT, WPARAM},
        System::Threading::{GetCurrentProcessId, GetCurrentThreadId},
        UI::{
            Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL},
            WindowsAndMessaging::{
                CallNextHookEx, DispatchMessageW, GetMessageW, GetWindowThreadProcessId,
                PeekMessageW, PostThreadMessageW, SetWindowsHookExW, TranslateMessage,
                UnhookWindowsHookEx, WindowFromPoint, MSG, MSLLHOOKSTRUCT, PM_NOREMOVE,
                WH_MOUSE_LL, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_QUIT,
            },
        },
    };

    const EVENT_TTL: Duration = Duration::from_millis(500);
    const CHANNEL_CAPACITY: usize = 64;
    const AVOID_COOLDOWN_MS: u64 = 180;

    #[derive(Clone, Serialize)]
    struct Destination {
        point: desktop::Point,
        fast: bool,
    }

    enum RawEvent {
        Down {
            x: i32,
            y: i32,
            at: Instant,
        },
        Up {
            x: i32,
            y: i32,
            ctrl_held: bool,
            dragged: bool,
            at: Instant,
        },
        Avoid {
            x: i32,
            y: i32,
            at: Instant,
        },
        Reset,
    }

    struct HookHandle {
        thread_id: u32,
        hook_thread: Option<JoinHandle<()>>,
        worker_thread: Option<JoinHandle<()>>,
    }

    static HOOK_STATE: Mutex<Option<HookHandle>> = Mutex::new(None);
    static EVENT_TX: OnceLock<Mutex<Option<SyncSender<RawEvent>>>> = OnceLock::new();
    static START_EPOCH: OnceLock<Instant> = OnceLock::new();
    static SELF_PID: AtomicU32 = AtomicU32::new(0);
    static PRESSING: AtomicBool = AtomicBool::new(false);
    static DRAGGED: AtomicBool = AtomicBool::new(false);
    static DOWN_X: AtomicI32 = AtomicI32::new(0);
    static DOWN_Y: AtomicI32 = AtomicI32::new(0);
    static DRAG_LIMIT_SQ: AtomicI64 = AtomicI64::new(25);
    static AVOID_ENABLED: AtomicBool = AtomicBool::new(false);
    static SPIDER_READY: AtomicBool = AtomicBool::new(false);
    static SPIDER_PHYS_X: AtomicI32 = AtomicI32::new(0);
    static SPIDER_PHYS_Y: AtomicI32 = AtomicI32::new(0);
    static AVOID_RADIUS_SQ: AtomicI64 = AtomicI64::new(100 * 100);
    static LAST_AVOID_MS: AtomicU64 = AtomicU64::new(0);

    fn now_ms() -> u64 {
        START_EPOCH
            .get_or_init(Instant::now)
            .elapsed()
            .as_millis() as u64
    }

    pub fn update_spider(center: desktop::Point, base_scale: f64) {
        let scale = if base_scale.is_finite() && base_scale > 0.0 {
            base_scale
        } else {
            1.0
        };
        if center.x.is_finite() && center.y.is_finite() {
            SPIDER_PHYS_X.store((center.x * scale).round() as i32, Ordering::Relaxed);
            SPIDER_PHYS_Y.store((center.y * scale).round() as i32, Ordering::Relaxed);
            SPIDER_READY.store(true, Ordering::Release);
        }
    }

    pub fn sync_settings(settings: &Settings, base_scale: f64) {
        let scale = if base_scale.is_finite() && base_scale > 0.0 {
            base_scale
        } else {
            1.0
        };
        let radius_px = (avoid_radius_logical(settings.size) * scale).round() as i64;
        AVOID_RADIUS_SQ.store(radius_px * radius_px, Ordering::Relaxed);
        AVOID_ENABLED.store(should_avoid(settings), Ordering::Release);
    }

    fn event_tx() -> &'static Mutex<Option<SyncSender<RawEvent>>> {
        EVENT_TX.get_or_init(|| Mutex::new(None))
    }

    fn update_drag_limit(base_scale: f64) {
        let scale = if base_scale.is_finite() && base_scale > 0.0 {
            base_scale
        } else {
            1.0
        };
        let px = (DRAG_THRESHOLD * scale).ceil() as i64;
        DRAG_LIMIT_SQ.store(px * px, Ordering::Relaxed);
    }

    fn ctrl_pressed() -> bool {
        (unsafe { GetAsyncKeyState(i32::from(VK_CONTROL)) } as u16 & 0x8000) != 0
    }

    fn hits_own_window(pt: POINT) -> bool {
        let hwnd = unsafe { WindowFromPoint(pt) };
        if hwnd.is_null() {
            return false;
        }
        let mut pid: u32 = 0;
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        pid != 0 && pid == SELF_PID.load(Ordering::Relaxed)
    }

    fn enqueue(event: RawEvent) {
        if let Ok(guard) = event_tx().try_lock() {
            if let Some(tx) = guard.as_ref() {
                if let Err(TrySendError::Full(_)) = tx.try_send(event) {
                    PRESSING.store(false, Ordering::Release);
                    DRAGGED.store(false, Ordering::Release);
                    let _ = tx.try_send(RawEvent::Reset);
                }
            }
        }
    }

    unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 && lparam != 0 {
            let info = &*(lparam as *const MSLLHOOKSTRUCT);
            match wparam as u32 {
                WM_LBUTTONDOWN => {
                    if ctrl_pressed() && !hits_own_window(info.pt) {
                        DOWN_X.store(info.pt.x, Ordering::Relaxed);
                        DOWN_Y.store(info.pt.y, Ordering::Relaxed);
                        DRAGGED.store(false, Ordering::Release);
                        PRESSING.store(true, Ordering::Release);
                        enqueue(RawEvent::Down {
                            x: info.pt.x,
                            y: info.pt.y,
                            at: Instant::now(),
                        });
                    } else {
                        PRESSING.store(false, Ordering::Release);
                        DRAGGED.store(false, Ordering::Release);
                        enqueue(RawEvent::Reset);
                    }
                }
                WM_MOUSEMOVE => {
                    // Never enqueue ordinary mouse moves; only check atomic drag overrun
                    // and zero-allocation proximity gate for mouse avoidance.
                    if PRESSING.load(Ordering::Acquire) && !DRAGGED.load(Ordering::Relaxed) {
                        let dx = i64::from(info.pt.x - DOWN_X.load(Ordering::Relaxed));
                        let dy = i64::from(info.pt.y - DOWN_Y.load(Ordering::Relaxed));
                        if dx * dx + dy * dy > DRAG_LIMIT_SQ.load(Ordering::Relaxed) {
                            DRAGGED.store(true, Ordering::Release);
                        }
                    } else if AVOID_ENABLED.load(Ordering::Acquire)
                        && SPIDER_READY.load(Ordering::Acquire)
                    {
                        let dx = i64::from(info.pt.x - SPIDER_PHYS_X.load(Ordering::Relaxed));
                        let dy = i64::from(info.pt.y - SPIDER_PHYS_Y.load(Ordering::Relaxed));
                        if dx * dx + dy * dy < AVOID_RADIUS_SQ.load(Ordering::Relaxed) {
                            let now = now_ms();
                            let prev = LAST_AVOID_MS.load(Ordering::Relaxed);
                            if now.saturating_sub(prev) >= AVOID_COOLDOWN_MS
                                && LAST_AVOID_MS
                                    .compare_exchange(
                                        prev,
                                        now,
                                        Ordering::AcqRel,
                                        Ordering::Relaxed,
                                    )
                                    .is_ok()
                            {
                                enqueue(RawEvent::Avoid {
                                    x: info.pt.x,
                                    y: info.pt.y,
                                    at: Instant::now(),
                                });
                            }
                        }
                    }
                }
                WM_LBUTTONUP => {
                    if PRESSING.swap(false, Ordering::AcqRel) {
                        let dragged = DRAGGED.swap(false, Ordering::AcqRel);
                        enqueue(RawEvent::Up {
                            x: info.pt.x,
                            y: info.pt.y,
                            ctrl_held: ctrl_pressed(),
                            dragged,
                            at: Instant::now(),
                        });
                    }
                }
                _ => {}
            }
        }
        CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
    }

    fn process_event(
        app: &tauri::AppHandle,
        event: RawEvent,
        gesture: &mut ClickGesture,
    ) -> DesktopResult<()> {
        let now = Instant::now();
        let settings = crate::settings(app)?;
        if !settings.visible || settings.paused {
            gesture.reset();
            return Ok(());
        }
        let layout = crate::cached_layout(app)?;
        update_drag_limit(layout.base_scale);
        match event {
            RawEvent::Reset => gesture.reset(),
            RawEvent::Avoid { x, y, at } => {
                if !should_avoid(&settings) || now.saturating_duration_since(at) > EVENT_TTL {
                    return Ok(());
                }
                let point = desktop::physical_point_to_logical(x, y, layout.base_scale);
                app.emit_to("pet", "pet-avoid", point)
                    .map_err(|error| error.to_string())?;
            }
            RawEvent::Down { x, y, at } => {
                if now.saturating_duration_since(at) > EVENT_TTL {
                    gesture.reset();
                    return Ok(());
                }
                let point = desktop::physical_point_to_logical(x, y, layout.base_scale);
                let in_work_area = layout
                    .screens
                    .iter()
                    .any(|screen| screen.work_area.contains(point));
                if in_work_area {
                    gesture.on_down(point, true);
                } else {
                    gesture.reset();
                }
            }
            RawEvent::Up {
                x,
                y,
                ctrl_held,
                dragged,
                at,
            } => {
                if now.saturating_duration_since(at) > EVENT_TTL {
                    gesture.reset();
                    return Ok(());
                }
                let point = desktop::physical_point_to_logical(x, y, layout.base_scale);
                let in_work_area = layout
                    .screens
                    .iter()
                    .any(|screen| screen.work_area.contains(point));
                if !in_work_area {
                    gesture.reset();
                    return Ok(());
                }
                if let Some(target) = gesture.on_up(point, ctrl_held, dragged) {
                    app.emit_to(
                        "pet",
                        "pet-destination",
                        Destination {
                            point: target,
                            fast: true,
                        },
                    )
                    .map_err(|error| error.to_string())?;
                }
            }
        }
        Ok(())
    }

    pub fn start(app: &tauri::AppHandle) -> DesktopResult<()> {
        let mut slot = HOOK_STATE.lock().map_err(|e| e.to_string())?;
        if slot.is_some() {
            return Ok(());
        }
        SELF_PID.store(unsafe { GetCurrentProcessId() }, Ordering::Relaxed);
        let _ = START_EPOCH.get_or_init(Instant::now);
        if let Ok(layout) = crate::cached_layout(app) {
            update_drag_limit(layout.base_scale);
            if let Ok(current_settings) = crate::settings(app) {
                sync_settings(&current_settings, layout.base_scale);
            }
        }
        PRESSING.store(false, Ordering::Release);
        DRAGGED.store(false, Ordering::Release);

        let (tx, rx) = mpsc::sync_channel::<RawEvent>(CHANNEL_CAPACITY);
        *event_tx().lock().map_err(|e| e.to_string())? = Some(tx);

        let worker_app = app.clone();
        let worker_thread = std::thread::Builder::new()
            .name("araneae-click-worker".into())
            .spawn(move || {
                let mut gesture = ClickGesture::default();
                while let Ok(event) = rx.recv() {
                    if let Err(error) = process_event(&worker_app, event, &mut gesture) {
                        eprintln!("Desktop click handling failed: {error}");
                        if let Err(report_error) =
                            worker_app.emit_to("controls", "desktop-error", &error)
                        {
                            eprintln!("Could not report desktop click error: {report_error}");
                        }
                    }
                }
            })
            .map_err(|e| e.to_string())?;

        let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<u32, String>>(1);
        let hook_thread = std::thread::Builder::new()
            .name("araneae-mouse-hook".into())
            .spawn(move || {
                // Force creation of the thread message queue before signaling readiness.
                let mut msg = MSG {
                    hwnd: std::ptr::null_mut(),
                    message: 0,
                    wParam: 0,
                    lParam: 0,
                    time: 0,
                    pt: POINT { x: 0, y: 0 },
                };
                unsafe {
                    PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_NOREMOVE);
                }
                let hook = unsafe {
                    SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), std::ptr::null_mut(), 0)
                };
                if hook.is_null() {
                    let _ = ready_tx.send(Err("Could not install Windows mouse hook".into()));
                    return;
                }
                let tid = unsafe { GetCurrentThreadId() };
                let _ = ready_tx.send(Ok(tid));
                loop {
                    let status = unsafe { GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) };
                    if status <= 0 {
                        if status == -1 {
                            eprintln!("Windows mouse hook GetMessageW returned -1; exiting loop");
                        }
                        break;
                    }
                    unsafe {
                        TranslateMessage(&msg);
                        DispatchMessageW(&msg);
                    }
                }
                unsafe {
                    UnhookWindowsHookEx(hook);
                }
            })
            .map_err(|e| e.to_string())?;

        match ready_rx.recv() {
            Ok(Ok(thread_id)) => {
                *slot = Some(HookHandle {
                    thread_id,
                    hook_thread: Some(hook_thread),
                    worker_thread: Some(worker_thread),
                });
                Ok(())
            }
            Ok(Err(error)) => {
                if let Ok(mut guard) = event_tx().lock() {
                    guard.take();
                }
                let _ = hook_thread.join();
                let _ = worker_thread.join();
                Err(error)
            }
            Err(_) => {
                if let Ok(mut guard) = event_tx().lock() {
                    guard.take();
                }
                let _ = hook_thread.join();
                let _ = worker_thread.join();
                Err("Windows mouse hook thread terminated before reporting readiness".into())
            }
        }
    }

    pub fn stop() -> DesktopResult<()> {
        PRESSING.store(false, Ordering::Release);
        DRAGGED.store(false, Ordering::Release);
        if let Ok(mut guard) = event_tx().lock() {
            guard.take();
        }
        let handle = HOOK_STATE.lock().map_err(|e| e.to_string())?.take();
        if let Some(mut handle) = handle {
            let posted = unsafe { PostThreadMessageW(handle.thread_id, WM_QUIT, 0, 0) } != 0;
            if let Some(thread) = handle.hook_thread.take() {
                if posted || thread.is_finished() {
                    let _ = thread.join();
                } else {
                    eprintln!("Could not post WM_QUIT to mouse hook thread; skipping blocking join");
                }
            }
            if let Some(worker) = handle.worker_thread.take() {
                let _ = worker.join();
            }
        }
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use crate::{desktop, settings::Settings, DesktopResult};

    pub fn start(_app: &tauri::AppHandle) -> DesktopResult<()> {
        Err("Passive desktop clicks are currently supported on macOS and Windows only".into())
    }

    pub fn stop() -> DesktopResult<()> {
        Ok(())
    }

    pub fn update_spider(_center: desktop::Point, _base_scale: f64) {}

    pub fn sync_settings(_settings: &Settings, _base_scale: f64) {}
}

pub use platform::{start, stop, sync_settings, update_spider};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gesture_triggers_only_on_clean_modified_click() {
        let mut gesture = ClickGesture::default();
        let origin = desktop::Point { x: 200.0, y: 300.0 };
        let nearby = desktop::Point { x: 203.0, y: 304.0 };
        gesture.on_down(origin, true);
        assert_eq!(gesture.on_up(nearby, true, false), Some(nearby));

        // Unmodified click is ignored.
        gesture.on_down(origin, false);
        assert_eq!(gesture.on_up(origin, false, false), None);

        // Releasing modifier before mouse up cancels.
        gesture.on_down(origin, true);
        assert_eq!(gesture.on_up(origin, false, false), None);
    }

    #[test]
    fn gesture_cancels_on_drag_even_if_pointer_returns_to_origin() {
        let mut gesture = ClickGesture::default();
        let origin = desktop::Point { x: 200.0, y: 300.0 };
        gesture.on_down(origin, true);
        gesture.on_move(desktop::Point { x: 220.0, y: 300.0 });
        assert_eq!(gesture.on_up(origin, true, false), None);

        // Hook-level dragged flag also cancels return-to-origin drags.
        gesture.on_down(origin, true);
        assert_eq!(gesture.on_up(origin, true, true), None);
    }

    #[test]
    fn gesture_reset_clears_stale_press_after_pause_or_out_of_bounds() {
        let mut gesture = ClickGesture::default();
        let origin = desktop::Point { x: 200.0, y: 300.0 };
        gesture.on_down(origin, true);
        gesture.reset();
        assert_eq!(gesture.on_up(origin, true, false), None);
    }

    #[test]
    fn avoid_policy_disables_in_follow_paused_or_hidden_and_clamps_radius() {
        let mut settings = Settings::default();
        assert!(should_avoid(&settings));
        settings.mode = Mode::Follow;
        assert!(!should_avoid(&settings));
        settings.mode = Mode::Observe;
        assert!(should_avoid(&settings));
        settings.paused = true;
        assert!(!should_avoid(&settings));
        settings.paused = false;
        settings.visible = false;
        assert!(!should_avoid(&settings));
        settings.visible = true;
        settings.avoid_pointer = false;
        assert!(!should_avoid(&settings));

        assert_eq!(avoid_radius_logical(0.35), 95.0);
        assert_eq!(avoid_radius_logical(1.0), 160.0);
        assert_eq!(avoid_radius_logical(2.1), 230.0);
    }
}
