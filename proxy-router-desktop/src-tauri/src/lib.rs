// Tauri lib.rs — registers all commands and runs the app.

mod proxy;

use proxy::{
    api_whitelist_request, app_quit, apply_adapter_dns, check_running_processes, clear_system_proxy,
    get_autostart_status, get_network_adapters, get_proxy_status, get_public_ip,
    kill_process, launch_app_with_proxy, launch_proxied_terminal, pick_exe_file,
    reset_adapter_dns, restore_network_defaults, set_active_dns, set_autostart,
    set_system_proxy, set_terminal_env_proxy, start_embedded_pac_server,
    start_local_proxy_forwarder, test_dns_latency, test_upstream_proxy, update_pac_rules, update_tray_icon,
    set_app_icon, set_proxy_mode, get_proxy_mode, get_traffic_stats, check_services_health, check_service_health,
    update_upstream_proxy, window_close, window_minimize, window_toggle_maximize,
    set_window_effect, sanitize_startup_proxy, win32_proxy,
    TRAY_INACTIVE_BYTES,
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
            // Register Windows console shutdown & logoff handler
            win32_proxy::install_shutdown_handler();

            // Sanitize any stale Windows proxy settings if previously left by crash/reboot
            sanitize_startup_proxy();

            start_embedded_pac_server();
            start_local_proxy_forwarder();

            // 1. Window initialization (Show immediately unless launched in silent autostart)
            if let Some(window) = app.get_webview_window("main") {
                if let Some(icon) = app.default_window_icon() {
                    let _ = window.set_icon(icon.clone());
                }

                if is_silent {
                    let _ = window.hide();
                } else {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }

            // 2. Setup System Tray gracefully
            if let Ok(initial_icon) = Image::from_bytes(TRAY_INACTIVE_BYTES) {
                if let Ok(tray_menu) = proxy::build_tray_menu(app.handle(), false) {
                    let tray_id = if cfg!(debug_assertions) { "main_tray_dev" } else { "main_tray" };
                    let _ = TrayIconBuilder::with_id(tray_id)
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
                                "toggle_mode" => {
                                    let _ = app.emit("tray-toggle-mode", ());
                                }
                                "sync_ip" => {
                                    let _ = app.emit("tray-sync-ip", ());
                                }
                                "open_terminal" => {
                                    let _ = proxy::launch_proxied_terminal();
                                }
                                "quit_app" => {
                                    let _ = proxy::clear_system_proxy_sync();
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
                        .build(app);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            api_whitelist_request,
            set_system_proxy,
            clear_system_proxy,
            get_proxy_status,
            get_public_ip,
            update_pac_rules,
            update_upstream_proxy,
            test_upstream_proxy,
            pick_exe_file,
            check_running_processes,
            kill_process,
            launch_app_with_proxy,
            launch_proxied_terminal,
            set_terminal_env_proxy,
            get_autostart_status,
            set_autostart,
            update_tray_icon,
            set_app_icon,
            set_proxy_mode,
            get_proxy_mode,
            get_traffic_stats,
            check_services_health,
            check_service_health,
            get_network_adapters,
            set_active_dns,
            apply_adapter_dns,
            reset_adapter_dns,
            test_dns_latency,
            restore_network_defaults,
            app_quit,
            window_minimize,
            window_toggle_maximize,
            window_close,
            set_window_effect,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                let _ = proxy::clear_system_proxy_sync();
            }
        });
}
