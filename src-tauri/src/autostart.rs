#[cfg(any(target_os = "windows", test))]
pub fn format_run_command(exe_path: &str) -> String {
    let trimmed = exe_path.trim().trim_matches('"');
    format!("\"{trimmed}\"")
}

#[cfg(target_os = "windows")]
mod platform {
    use super::format_run_command;
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
        unsafe { RegCloseKey(hkey) };
        query == ERROR_SUCCESS && value_type == REG_SZ && data_len > 2
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
    use super::format_run_command;

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
}
