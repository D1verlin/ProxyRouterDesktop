// Tauri lib.rs — registers all commands and runs the app.

mod proxy;

use proxy::{
    app_quit, check_running_processes, clear_system_proxy, get_autostart_status,
    get_proxy_status, get_public_ip, kill_process, launch_app_with_proxy,
    launch_proxied_terminal, pick_exe_file, set_autostart, set_system_proxy,
    set_terminal_env_proxy, start_embedded_pac_server, start_local_proxy_forwarder,
    update_pac_rules, update_tray_icon, update_upstream_proxy, window_close,
    window_minimize, window_toggle_maximize, TRAY_INACTIVE_BYTES,
};

use tauri::image::Image;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let is_silent = args.iter().any(|a| a == "--silent" || a == "--minimized" || a == "-s");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            start_embedded_pac_server();
            start_local_proxy_forwarder();

            // Setup System Tray
            let initial_icon = Image::from_bytes(TRAY_INACTIVE_BYTES).expect("Failed to load tray icon");

            let tray_menu = proxy::build_tray_menu(app.handle(), false)?;

            let _tray = TrayIconBuilder::with_id("main_tray")
                .icon(initial_icon)
                .tooltip("Proxy Router: Disconnected")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show_window" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                        }
                        "hide_window" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.hide();
                            }
                        }
                        "toggle_proxy" => {
                            let _ = app.emit("tray-toggle-proxy", ());
                        }
                        "open_terminal" => {
                            let _ = proxy::launch_proxied_terminal();
                        }
                        "quit_app" => {
                            let _ = proxy::clear_system_proxy();
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Window initialization
            if let Some(window) = app.get_webview_window("main") {
                if let Some(icon) = app.default_window_icon() {
                    let _ = window.set_icon(icon.clone());
                }

                if !is_silent {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_system_proxy,
            clear_system_proxy,
            get_proxy_status,
            get_public_ip,
            update_pac_rules,
            update_upstream_proxy,
            pick_exe_file,
            check_running_processes,
            kill_process,
            launch_app_with_proxy,
            launch_proxied_terminal,
            set_terminal_env_proxy,
            get_autostart_status,
            set_autostart,
            update_tray_icon,
            app_quit,
            window_minimize,
            window_toggle_maximize,
            window_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
