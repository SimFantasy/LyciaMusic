use crate::database::DbState;
use crate::music::{run_cache_cleanup, ImageConcurrencyLimit};
use crate::player::init_player;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tokio::sync::Semaphore;

#[derive(Default)]
pub(crate) struct PendingOpenPaths(pub(crate) Mutex<Vec<String>>);

fn append_unique_paths(target: &mut Vec<String>, incoming: impl IntoIterator<Item = String>) {
    let mut seen = target.iter().cloned().collect::<HashSet<_>>();

    for path in incoming {
        if seen.insert(path.clone()) {
            target.push(path);
        }
    }
}

fn collect_existing_open_paths(
    args: impl IntoIterator<Item = String>,
    current_exe: Option<&Path>,
) -> Vec<String> {
    let mut paths = Vec::new();
    let mut seen = HashSet::new();

    for arg in args {
        let trimmed = arg.trim();
        if trimmed.is_empty() {
            continue;
        }

        let normalized = crate::music::utils::normalize_path(trimmed);
        if normalized.is_empty() {
            continue;
        }

        let candidate = PathBuf::from(&normalized);
        if !candidate.exists() {
            continue;
        }

        if current_exe.is_some_and(|exe| exe == candidate.as_path()) {
            continue;
        }

        if seen.insert(normalized.clone()) {
            paths.push(normalized);
        }
    }

    paths
}

fn queue_open_paths<R: tauri::Runtime>(app: &tauri::AppHandle<R>, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }

    if let Some(state) = app.try_state::<PendingOpenPaths>() {
        if let Ok(mut pending_paths) = state.0.lock() {
            append_unique_paths(&mut pending_paths, paths);
        }
    }
}

fn reveal_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn install_window_boundary<R: tauri::Runtime>(app: &tauri::App<R>) {
    #[cfg(target_os = "windows")]
    {
        if let Some(window) = app.get_webview_window("main") {
            use raw_window_handle::HasWindowHandle;

            if let Ok(handle) = window.as_ref().window().window_handle() {
                if let raw_window_handle::RawWindowHandle::Win32(win32) = handle.as_raw() {
                    crate::window_boundary::install_boundary_subclass(win32.hwnd.get() as isize);
                }
            }
        }
    }
}

fn build_tray<R: tauri::Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let handle = app.handle();
    let show_item = MenuItem::with_id(handle, "show", "显示主界面", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(handle, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(handle, &[&show_item, &quit_item])?;

    let _tray = TrayIconBuilder::with_id("tray")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => reveal_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                reveal_main_window(&tray.app_handle());
            }
        })
        .build(app.handle())?;

    Ok(())
}

pub(crate) fn handle_single_instance<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    argv: Vec<String>,
) {
    let current_exe = std::env::current_exe().ok();
    let open_paths = collect_existing_open_paths(argv, current_exe.as_deref());
    queue_open_paths(app, open_paths);
    let _ = app.emit("app:open-paths", ());
    reveal_main_window(app);
}

pub(crate) fn setup_app(
    app: &mut tauri::App<tauri::Wry>,
) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(PendingOpenPaths::default());

    let db_state = DbState::new(app.handle())?;
    app.manage(db_state);

    let player_state = init_player(app.handle());
    app.manage(player_state);

    app.manage(ImageConcurrencyLimit(Semaphore::new(4)));
    run_cache_cleanup(app.handle());

    let current_exe = std::env::current_exe().ok();
    let initial_open_paths =
        collect_existing_open_paths(std::env::args().skip(1), current_exe.as_deref());
    queue_open_paths(app.handle(), initial_open_paths);

    install_window_boundary(app);
    build_tray(app)?;

    Ok(())
}

#[tauri::command]
pub(crate) fn consume_pending_open_paths(
    state: tauri::State<PendingOpenPaths>,
) -> Result<Vec<String>, String> {
    let mut pending_paths = state.0.lock().map_err(|error| error.to_string())?;
    Ok(std::mem::take(&mut *pending_paths))
}
