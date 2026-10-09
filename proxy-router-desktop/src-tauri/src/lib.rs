// Tauri lib.rs — registers all commands and runs the app.

mod proxy;

use proxy::{
    check_running_processes, clear_system_proxy, get_proxy_status, get_public_ip,
    kill_process, launch_app_with_proxy, pick_exe_file, set_system_proxy,
    set_terminal_env_proxy, start_embedded_pac_server, update_pac_rules,
    window_close, window_minimize, window_toggle_maximize,
};

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            start_embedded_pac_server();
            if let Some(window) = app.get_webview_window("main") {
                if let Some(icon) = app.default_window_icon() {
                    let _ = window.set_icon(icon.clone());
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
            pick_exe_file,
            check_running_processes,
            kill_process,
            launch_app_with_proxy,
            set_terminal_env_proxy,
            window_minimize,
            window_toggle_maximize,
            window_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
