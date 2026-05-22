use std::sync::atomic::{AtomicIsize, Ordering};

pub static LAST_TASKBAR_HWND: AtomicIsize = AtomicIsize::new(0);

#[derive(serde::Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OwnerBindingState {
    Bound,
    Failed,
    Unsupported,
    AlreadyBound,
}

#[derive(serde::Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GeometrySource {
    Tray,
    TaskbarFallback,
}

#[derive(serde::Serialize, Clone, Copy, Debug)]
pub struct RectPhysical {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct TaskbarTrayGeometry {
    pub taskbar_rect_physical: RectPhysical,
    pub tray_rect_physical: Option<RectPhysical>,
    pub taskbar_hwnd_changed: bool,
    pub owner_binding: OwnerBindingState,
    pub source: GeometrySource,
    pub scale_factor: f64,
}

#[cfg(target_os = "windows")]
fn find_window_recursive(
    hwnd: windows_sys::Win32::Foundation::HWND,
    target_class_utf16: &[u16],
    current_depth: u32,
    max_depth: u32,
    node_count: &mut u32,
) -> windows_sys::Win32::Foundation::HWND {
    if hwnd.is_null() {
        return std::ptr::null_mut();
    }
    *node_count += 1;
    if *node_count > 64 {
        return std::ptr::null_mut();
    }

    // 检查当前窗口的类名是否匹配（无分配高速比对）
    let mut class_name = [0u16; 256];
    let len = unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::GetClassNameW(
            hwnd,
            class_name.as_mut_ptr(),
            class_name.len() as i32,
        )
    };
    if len > 0 {
        let actual_len = len as usize;
        if actual_len == target_class_utf16.len() && &class_name[..actual_len] == target_class_utf16 {
            return hwnd;
        }
    }

    if current_depth >= max_depth {
        return std::ptr::null_mut();
    }

    // 遍历子窗口
    let mut child = unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::GetWindow(
            hwnd,
            windows_sys::Win32::UI::WindowsAndMessaging::GW_CHILD,
        )
    };
    while !child.is_null() {
        let found = find_window_recursive(
            child,
            target_class_utf16,
            current_depth + 1,
            max_depth,
            node_count,
        );
        if !found.is_null() {
            return found;
        }
        child = unsafe {
            windows_sys::Win32::UI::WindowsAndMessaging::GetWindow(
                child,
                windows_sys::Win32::UI::WindowsAndMessaging::GW_HWNDNEXT,
            )
        };
    }

    std::ptr::null_mut()
}

#[tauri::command]
pub fn setup_taskbar_window(window: tauri::Window) -> OwnerBindingState {
    #[cfg(target_os = "windows")]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        use windows_sys::Win32::Foundation::{GetLastError, HWND, SetLastError};
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            FindWindowW, GetWindowLongW, SetWindowLongPtrW, SetWindowLongW, GWL_EXSTYLE,
            GWLP_HWNDPARENT, WS_EX_NOACTIVATE,
        };

        if let Ok(handle) = window.window_handle() {
            if let RawWindowHandle::Win32(win32) = handle.as_raw() {
                let hwnd = win32.hwnd.get() as HWND;

                // 1. 设置 WS_EX_NOACTIVATE 扩展样式以尽量避免抢占焦点
                unsafe {
                    let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                    SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style | WS_EX_NOACTIVATE as i32);
                }

                // 2. 绑定 Owner 到 Shell_TrayWnd（主任务栏）
                let shell_tray_class: Vec<u16> = "Shell_TrayWnd\0".encode_utf16().collect();
                let hwnd_taskbar = unsafe { FindWindowW(shell_tray_class.as_ptr(), std::ptr::null()) };

                if !hwnd_taskbar.is_null() {
                    let mut bound_success = false;
                    unsafe {
                        SetLastError(0);
                        let prev = SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, hwnd_taskbar as isize);
                        if prev == 0 {
                            let err = GetLastError();
                            if err == 0 {
                                bound_success = true;
                            }
                        } else {
                            bound_success = true;
                        }
                    }

                    if bound_success {
                        LAST_TASKBAR_HWND.store(hwnd_taskbar as isize, Ordering::SeqCst);
                        return OwnerBindingState::Bound;
                    } else {
                        return OwnerBindingState::Failed;
                    }
                } else {
                    return OwnerBindingState::Failed;
                }
            }
        }
        OwnerBindingState::Unsupported
    }
    #[cfg(not(target_os = "windows"))]
    {
        OwnerBindingState::Unsupported
    }
}

#[tauri::command]
pub fn get_taskbar_tray_geometry(window: tauri::Window) -> Result<TaskbarTrayGeometry, String> {
    #[cfg(target_os = "windows")]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        use windows_sys::Win32::Foundation::{GetLastError, HWND, RECT, SetLastError};
        use windows_sys::Win32::UI::Shell::{ABM_GETTASKBARPOS, APPBARDATA, SHAppBarMessage};
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            FindWindowW, GetWindowRect, SetWindowLongPtrW, GWLP_HWNDPARENT,
        };

        // 1. 查找当前主系统任务栏句柄
        let shell_tray_class: Vec<u16> = "Shell_TrayWnd\0".encode_utf16().collect();
        let current_hwnd_taskbar = unsafe { FindWindowW(shell_tray_class.as_ptr(), std::ptr::null()) };

        if current_hwnd_taskbar.is_null() {
            return Err("Taskbar window not found".to_string());
        }

        let last_hwnd = LAST_TASKBAR_HWND.load(Ordering::SeqCst);
        let mut hwnd_changed = false;
        let mut owner_binding = OwnerBindingState::AlreadyBound;

        // 检测到 Explorer 重建时（HWND 变化），自愈重绑
        if last_hwnd != current_hwnd_taskbar as isize {
            hwnd_changed = true;
            if let Ok(handle) = window.window_handle() {
                if let RawWindowHandle::Win32(win32) = handle.as_raw() {
                    let hwnd = win32.hwnd.get() as HWND;
                    let mut bound_success = false;
                    unsafe {
                        SetLastError(0);
                        let prev = SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, current_hwnd_taskbar as isize);
                        if prev == 0 {
                            let err = GetLastError();
                            if err == 0 {
                                bound_success = true;
                            }
                        } else {
                            bound_success = true;
                        }
                    }

                    if bound_success {
                        owner_binding = OwnerBindingState::Bound;
                        LAST_TASKBAR_HWND.store(current_hwnd_taskbar as isize, Ordering::SeqCst);
                    } else {
                        owner_binding = OwnerBindingState::Failed;
                    }
                } else {
                    owner_binding = OwnerBindingState::Unsupported;
                }
            } else {
                owner_binding = OwnerBindingState::Unsupported;
            }
        }

        // 2. 提取任务栏物理矩形坐标
        let mut abd = APPBARDATA {
            cbSize: std::mem::size_of::<APPBARDATA>() as u32,
            hWnd: current_hwnd_taskbar,
            uCallbackMessage: 0,
            uEdge: 0,
            rc: RECT { left: 0, top: 0, right: 0, bottom: 0 },
            lParam: 0,
        };
        let mut taskbar_rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        let got_taskbar = unsafe { SHAppBarMessage(ABM_GETTASKBARPOS, &mut abd) != 0 };
        if got_taskbar {
            taskbar_rect = abd.rc;
        } else {
            // SHAppBarMessage 失败时的 GetWindowRect 物理兜底
            unsafe {
                GetWindowRect(current_hwnd_taskbar, &mut taskbar_rect);
            }
        }

        // 3. 递归安全深度查找托盘通知区域，限制在 3 层内，最多遍历 64 个节点
        let tray_class_utf16: Vec<u16> = "TrayNotifyWnd".encode_utf16().collect();
        let mut node_count = 0;
        let hwnd_tray = find_window_recursive(
            current_hwnd_taskbar,
            &tray_class_utf16,
            0,
            3,
            &mut node_count,
        );

        let mut tray_rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        let got_tray = if !hwnd_tray.is_null() {
            unsafe { GetWindowRect(hwnd_tray, &mut tray_rect) != 0 }
        } else {
            false
        };

        let tray_rect_physical = if got_tray {
            Some(RectPhysical {
                left: tray_rect.left,
                top: tray_rect.top,
                right: tray_rect.right,
                bottom: tray_rect.bottom,
            })
        } else {
            // 静默返回 None 作为正常无托盘/重建中的兜底分支，不刷 warning 日志
            None
        };

        let scale_factor = window.scale_factor().unwrap_or(1.0);

        Ok(TaskbarTrayGeometry {
            taskbar_rect_physical: RectPhysical {
                left: taskbar_rect.left,
                top: taskbar_rect.top,
                right: taskbar_rect.right,
                bottom: taskbar_rect.bottom,
            },
            tray_rect_physical,
            taskbar_hwnd_changed: hwnd_changed,
            owner_binding,
            source: if got_tray {
                GeometrySource::Tray
            } else {
                GeometrySource::TaskbarFallback
            },
            scale_factor,
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Unsupported OS".to_string())
    }
}
