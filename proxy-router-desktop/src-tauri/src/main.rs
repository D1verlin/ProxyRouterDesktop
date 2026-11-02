// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(debug_assertions)]
    {
        if std::env::var("WEBVIEW2_USER_DATA_FOLDER").is_err() {
            if let Some(mut path) = std::env::var_os("LOCALAPPDATA").map(std::path::PathBuf::from) {
                path.push("com.proxyrouter.desktop.dev");
                let _ = std::fs::create_dir_all(&path);
                std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &path);
                println!("[dev] Using separate WebView2 data folder: {:?}", path);
            }
        }
    }
    proxy_router_desktop_lib::run()
}
