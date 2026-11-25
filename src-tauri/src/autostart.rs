#[cfg(any(target_os = "windows", test))]
pub fn format_run_command(exe_path: &str) -> String {
    let trimmed = exe_path.trim().trim_matches('"');
    format!("\"{trimmed}\"")
}

#[cfg(any(target_os = "windows", test))]
fn normalize_win_path(raw: &str) -> String {
    let trimmed = raw.trim().trim_matches('"').trim();
    let stripped = trimmed.strip_prefix(r"\\?\").unwrap_or(trimmed);
    stripped.replace('/', "\\").to_lowercase()
}

#[cfg(any(target_os = "windows", test))]
pub fn matches_run_command(stored: &str, current_exe: &str) -> bool {
    let a = normalize_win_path(stored);
    let b = normalize_win_path(current_exe);
    !a.is_empty() && a == b
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{format_run_command, matches_run_command};
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::{
        Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS},
        System::Registry::{
            RegCloseKey, RegCreateKeyW, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW,
            RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE, REG_SZ,
        },
    };

    const RUN_SUBKEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    const VALUE_NAME: &str = "Araneae";

    fn to_wide(text: &str) -> Vec<u16> {
        OsStr::new(text)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    pub fn is_enabled() -> bool {
        let Ok(exe) = std::env::current_exe() else {
            return false;
        };
        let subkey = to_wide(RUN_SUBKEY);
        let name = to_wide(VALUE_NAME);
        let mut hkey: HKEY = std::ptr::null_mut();
        let status = unsafe {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                subkey.as_ptr(),
                0,
                KEY_QUERY_VALUE,
                &mut hkey,
            )
        };
        if status != ERROR_SUCCESS {
            return false;
        }
        let mut value_type: u32 = 0;
        let mut data_len: u32 = 0;
        let query = unsafe {
            RegQueryValueExW(
                hkey,
                name.as_ptr(),
                std::ptr::null_mut(),
                &mut value_type,
                std::ptr::null_mut(),
                &mut data_len,
            )
        };
        if query != ERROR_SUCCESS || value_type != REG_SZ || data_len < 2 {
            unsafe { RegCloseKey(hkey) };
            return false;
        }
        let mut wide = vec![0u16; (data_len as usize).div_ceil(2)];
        let mut read_len = (wide.len() * 2) as u32;
        let read = unsafe {
            RegQueryValueExW(
                hkey,
                name.as_ptr(),
                std::ptr::null_mut(),
                &mut value_type,
                wide.as_mut_ptr().cast::<u8>(),
                &mut read_len,
            )
        };
        unsafe { RegCloseKey(hkey) };
        if read != ERROR_SUCCESS || value_type != REG_SZ {
            return false;
        }
        let units = (read_len as usize / 2).min(wide.len());
        let len = wide[..units]
            .iter()
            .position(|&unit| unit == 0)
            .unwrap_or(units);
        let stored = String::from_utf16_lossy(&wide[..len]);
        matches_run_command(&stored, &exe.to_string_lossy())
    }

    pub fn set_enabled(enabled: bool) -> Result<(), String> {
        let subkey = to_wide(RUN_SUBKEY);
        let name = to_wide(VALUE_NAME);
        let mut hkey: HKEY = std::ptr::null_mut();
        let status = unsafe { RegCreateKeyW(HKEY_CURRENT_USER, subkey.as_ptr(), &mut hkey) };
        if status != ERROR_SUCCESS {
            return Err(format!(
                "Could not open Windows startup registry key (error {status})"
            ));
        }

        let result = if enabled {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let command = format_run_command(&exe.to_string_lossy());
            let wide = to_wide(&command);
            let bytes = unsafe {
                std::slice::from_raw_parts(wide.as_ptr().cast::<u8>(), wide.len() * 2)
            };
            let write = unsafe {
                RegSetValueExW(
                    hkey,
                    name.as_ptr(),
                    0,
                    REG_SZ,
                    bytes.as_ptr(),
                    bytes.len() as u32,
                )
            };
            if write == ERROR_SUCCESS {
                Ok(())
            } else {
                Err(format!(
                    "Could not enable Windows startup entry (error {write})"
                ))
            }
        } else {
            let del = unsafe { RegDeleteValueW(hkey, name.as_ptr()) };
            if del == ERROR_SUCCESS || del == ERROR_FILE_NOT_FOUND {
                Ok(())
            } else {
                Err(format!(
                    "Could not remove Windows startup entry (error {del})"
                ))
            }
        };

        unsafe { RegCloseKey(hkey) };
        result
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    pub fn is_enabled() -> bool {
        false
    }

    pub fn set_enabled(enabled: bool) -> Result<(), String> {
        if enabled {
            Err("Launch at startup is currently supported on Windows only".into())
        } else {
            Ok(())
        }
    }
}

pub use platform::{is_enabled, set_enabled};

#[cfg(test)]
mod tests {
    use super::{format_run_command, matches_run_command};

    #[test]
    fn quotes_executable_path_for_registry_run_value() {
        assert_eq!(
            format_run_command(r"C:\Program Files\Araneae\Araneae.exe"),
            "\"C:\\Program Files\\Araneae\\Araneae.exe\""
        );
        assert_eq!(
            format_run_command("\"C:\\code\\Araneae\\app.exe\""),
            "\"C:\\code\\Araneae\\app.exe\""
        );
    }

    #[test]
    fn run_command_match_verifies_current_executable_path() {
        let current = r"C:\Program Files\Araneae\Araneae.exe";
        assert!(matches_run_command(
            &format_run_command(current),
            current
        ));
        assert!(matches_run_command(
            r"c:\program files\araneae\araneae.exe",
            r"\\?\C:\Program Files\Araneae\Araneae.exe"
        ));
        // Moved or replaced executable path must report disabled.
        assert!(!matches_run_command(
            "\"D:\\Portable\\Araneae\\Araneae.exe\"",
            current
        ));
        assert!(!matches_run_command("", current));
        assert!(!matches_run_command("\"\"", current));
    }
}
