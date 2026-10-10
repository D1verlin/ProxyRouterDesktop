// Tauri Rust backend — system proxy, app router, & embedded PAC server

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::Command;
use std::sync::{Arc, RwLock};
use std::thread;
use std::time::Duration;
use tauri::{command, Window};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Spawns a Command without showing any console window on Windows
fn hidden_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

const REG_PATH: &str =
    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings";

// Global in-memory PAC content protected by RwLock
static PAC_CONTENT: RwLock<Option<Arc<String>>> = RwLock::new(None);

// Global upstream proxy target protected by RwLock (host, port)
static UPSTREAM_PROXY: RwLock<(String, u16)> = RwLock::new((String::new(), 3128));

fn generate_pac_script(proxy_host: &str, proxy_port: u16, hosts: &[String]) -> String {
    let proxy = format!("PROXY {}:{}", proxy_host, proxy_port);
    let mut conditions = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for raw in hosts {
        let trimmed = raw.trim();
        let domain = trimmed
            .trim_start_matches("*.")
            .trim_start_matches('.')
            .to_lowercase();

        if domain.is_empty() || !seen.insert(domain.clone()) {
            continue;
        }

        // Match both the exact apex domain (e.g. chatgpt.com) and all its subdomains (e.g. *.chatgpt.com)
        conditions.push(format!(
            "    shExpMatch(host, \"{}\") || shExpMatch(host, \"*.{}\")",
            domain, domain
        ));
    }

    let match_block = if conditions.is_empty() {
        "  // No routed domains configured".to_string()
    } else {
        format!("  if (\n{}\n  ) {{\n    return proxy;\n  }}", conditions.join(" ||\n"))
    };

    format!(
r#"// Proxy Auto-Configuration (PAC) — Proxy Router Desktop
function FindProxyForURL(url, host) {{
  var proxy = "{}";
  host = (host || "").toLowerCase();

  // Intranet and loopback traffic goes directly
  if (isPlainHostName(host) || host === "localhost" || host === "127.0.0.1") {{
    return "DIRECT";
  }}

{}

  return "DIRECT";
}}
"#,
        proxy, match_block
    )
}

/// Starts embedded lightweight PAC HTTP server on 127.0.0.1:8182
pub fn start_embedded_pac_server() {
    let default_domains = vec![
        "gemini.google.com".to_string(),
        "bard.google.com".to_string(),
        "proactivebackend-pa.googleapis.com".to_string(),
        "generativelanguage.googleapis.com".to_string(),
        "alkalimakersuite-pa.clients6.google.com".to_string(),
        "alkalimakersuite-pa.googleapis.com".to_string(),
        "apis.google.com".to_string(),
        "accounts.google.com".to_string(),
        "ssl.gstatic.com".to_string(),
        "www.gstatic.com".to_string(),
        "gstatic.com".to_string(),
        "googleusercontent.com".to_string(),
        "deepmind.google".to_string(),
        "aistudio.google.com".to_string(),
        "googleapis.com".to_string(),
        "clients6.google.com".to_string(),
        "chatgpt.com".to_string(),
        "chat.openai.com".to_string(),
        "oaistatic.com".to_string(),
        "oaiusercontent.com".to_string(),
        "openai.com".to_string(),
        "claude.ai".to_string(),
        "anthropic.com".to_string(),
        "claudeusercontent.com".to_string(),
    ];
    let default_pac = generate_pac_script("2.27.25.190", 3128, &default_domains);
    if let Ok(mut lock) = PAC_CONTENT.write() {
        *lock = Some(Arc::new(default_pac));
    }
    if let Ok(mut lock) = UPSTREAM_PROXY.write() {
        *lock = ("2.27.25.190".to_string(), 3128);
    }

    thread::spawn(move || {
        let listener = match TcpListener::bind("127.0.0.1:8182") {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[embedded-pac] Could not bind to 127.0.0.1:8182: {}", e);
                return;
            }
        };
        println!("[embedded-pac] Native PAC server listening on http://127.0.0.1:8182/proxy.pac");

        for stream in listener.incoming() {
            if let Ok(mut stream) = stream {
                let mut buf = [0u8; 1024];
                if let Ok(bytes_read) = stream.read(&mut buf) {
                    let req = String::from_utf8_lossy(&buf[..bytes_read]);
                    let mut parts = req.split_whitespace();
                    let method = parts.next().unwrap_or("");
                    let path = parts.next().unwrap_or("");

                    if method == "OPTIONS" {
                        let resp = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization, *\r\nConnection: close\r\n\r\n";
                        let _ = stream.write_all(resp.as_bytes());
                    } else if path == "/health" {
                        let body = r#"{"ok":true,"server":"embedded-rust"}"#;
                        let resp = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            body.len(), body
                        );
                        let _ = stream.write_all(resp.as_bytes());
                    } else if path == "/update" {
                        let body = r#"{"ok":true,"message":"PAC rules acknowledged"}"#;
                        let resp = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            body.len(), body
                        );
                        let _ = stream.write_all(resp.as_bytes());
                    } else if path.starts_with("/proxy.pac") || path == "/" {
                        let pac = {
                            PAC_CONTENT
                                .read()
                                .ok()
                                .and_then(|r| r.clone())
                                .unwrap_or_else(|| Arc::new("function FindProxyForURL(url, host) { return 'DIRECT'; }".to_string()))
                        };
                        let resp = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/x-ns-proxy-autoconfig\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-cache\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            pac.len(), *pac
                        );
                        let _ = stream.write_all(resp.as_bytes());
                    } else {
                        let body = "Not Found";
                        let resp = format!(
                            "HTTP/1.1 404 Not Found\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            body.len(), body
                        );
                        let _ = stream.write_all(resp.as_bytes());
                    }
                }
            }
        }
    });
}

/// Starts embedded local HTTP CONNECT proxy forwarder on 127.0.0.1:8183
pub fn start_local_proxy_forwarder() {
    thread::spawn(|| {
        let listener = match TcpListener::bind("127.0.0.1:8183") {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[local-forwarder] Could not bind to 127.0.0.1:8183: {}", e);
                return;
            }
        };
        println!("[local-forwarder] Native Proxy Forwarder listening on http://127.0.0.1:8183");

        for stream in listener.incoming() {
            if let Ok(mut client) = stream {
                thread::spawn(move || {
                    let _ = handle_forwarder_client(&mut client);
                });
            }
        }
    });
}

fn handle_forwarder_client(client: &mut TcpStream) -> std::io::Result<()> {
    client.set_read_timeout(Some(Duration::from_secs(30)))?;
    client.set_write_timeout(Some(Duration::from_secs(30)))?;

    let mut reader = BufReader::new(client.try_clone()?);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line)? == 0 {
        return Ok(());
    }

    let (upstream_host, upstream_port) = {
        let lock = UPSTREAM_PROXY.read().unwrap();
        lock.clone()
    };

    if upstream_host.is_empty() {
        let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\n\r\nNo upstream proxy configured\r\n");
        return Ok(());
    }

    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        return Ok(());
    }
    let method = parts[0];
    let target = parts[1];

    if method.eq_ignore_ascii_case("CONNECT") {
        // Drain client CONNECT headers
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line)? == 0 || line == "\r\n" || line == "\n" {
                break;
            }
        }

        // Connect to upstream proxy
        let mut upstream = match TcpStream::connect((upstream_host.as_str(), upstream_port)) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[local-forwarder] Upstream {}:{} unreachable: {}", upstream_host, upstream_port, e);
                let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\n\r\nUpstream proxy unreachable\r\n");
                return Ok(());
            }
        };

        upstream.set_read_timeout(Some(Duration::from_secs(45)))?;
        upstream.set_write_timeout(Some(Duration::from_secs(45)))?;

        // Send CONNECT request to upstream proxy
        let connect_req = format!("CONNECT {} HTTP/1.1\r\nHost: {}\r\nProxy-Connection: Keep-Alive\r\n\r\n", target, target);
        if let Err(e) = upstream.write_all(connect_req.as_bytes()) {
            eprintln!("[local-forwarder] Failed writing CONNECT to upstream: {}", e);
            let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n");
            return Ok(());
        }

        // Read upstream response
        let mut upstream_reader = BufReader::new(upstream.try_clone()?);
        let mut resp_line = String::new();
        if upstream_reader.read_line(&mut resp_line).is_err() {
            let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n");
            return Ok(());
        }

        if !resp_line.contains("200") {
            let _ = client.write_all(resp_line.as_bytes());
            return Ok(());
        }

        // Drain upstream response headers
        loop {
            let mut line = String::new();
            if upstream_reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" || line == "\n" {
                break;
            }
        }

        // Send 200 Connection Established to client
        client.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")?;

        let _ = client.set_read_timeout(None);
        let _ = client.set_write_timeout(None);
        let _ = upstream.set_read_timeout(None);
        let _ = upstream.set_write_timeout(None);

        let mut client_read = client.try_clone()?;
        let mut client_write = client.try_clone()?;
        let mut upstream_read = upstream.try_clone()?;
        let mut upstream_write = upstream;

        let t1 = thread::spawn(move || {
            let _ = std::io::copy(&mut client_read, &mut upstream_write);
            let _ = upstream_write.shutdown(std::net::Shutdown::Both);
        });

        let _ = std::io::copy(&mut upstream_read, &mut client_write);
        let _ = client_write.shutdown(std::net::Shutdown::Both);
        let _ = t1.join();
    } else {
        // Plain HTTP forwarding
        let mut upstream = match TcpStream::connect((upstream_host.as_str(), upstream_port)) {
            Ok(s) => s,
            Err(_) => {
                let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n");
                return Ok(());
            }
        };

        upstream.write_all(request_line.as_bytes())?;
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line)? == 0 {
                break;
            }
            upstream.write_all(line.as_bytes())?;
            if line == "\r\n" || line == "\n" {
                break;
            }
        }

        let mut client_read = client.try_clone()?;
        let mut client_write = client.try_clone()?;
        let mut upstream_read = upstream.try_clone()?;
        let mut upstream_write = upstream;

        let t1 = thread::spawn(move || {
            let _ = std::io::copy(&mut client_read, &mut upstream_write);
        });

        let _ = std::io::copy(&mut upstream_read, &mut client_write);
        let _ = t1.join();
    }

    Ok(())
}

/// Updates upstream proxy target in memory
#[command]
pub fn update_upstream_proxy(proxy_host: String, proxy_port: u16) -> Result<String, String> {
    if let Ok(mut lock) = UPSTREAM_PROXY.write() {
        *lock = (proxy_host.trim().to_string(), proxy_port);
        Ok(format!("Upstream proxy set to {}:{}", proxy_host, proxy_port))
    } else {
        Err("Failed to acquire write lock for UPSTREAM_PROXY".to_string())
    }
}

/// Updates PAC rules in memory from the Tauri UI
#[command]
pub fn update_pac_rules(proxy_host: String, proxy_port: u16, hosts: Vec<String>) -> Result<String, String> {
    if let Ok(mut lock) = UPSTREAM_PROXY.write() {
        *lock = (proxy_host.trim().to_string(), proxy_port);
    }
    let script = generate_pac_script(&proxy_host, proxy_port, &hosts);
    if let Ok(mut lock) = PAC_CONTENT.write() {
        *lock = Some(Arc::new(script));
        Ok("PAC rules updated".to_string())
    } else {
        Err("Failed to acquire write lock".to_string())
    }
}

/// Sets the system proxy to a PAC URL (Proxy Auto-Config) updating both root registry and Connections blobs.
#[command]
pub fn set_system_proxy(
    pac_url: Option<String>,
    #[allow(non_snake_case)]
    pacUrl: Option<String>,
) -> Result<String, String> {
    let url = pac_url.or(pacUrl).unwrap_or_default();
    apply_windows_pac_proxy(&url)?;
    Ok(format!("System proxy set to PAC: {}", url))
}

/// Clears all system proxy settings — traffic goes direct.
#[command]
pub fn clear_system_proxy() -> Result<String, String> {
    apply_windows_pac_proxy("")?;
    Ok("System proxy cleared".to_string())
}

/// Returns the current Windows proxy settings from the registry.
#[command]
pub fn get_proxy_status() -> Result<serde_json::Value, String> {
    let pac_url    = reg_get("AutoConfigURL").unwrap_or_default();
    let proxy_en   = reg_get("ProxyEnable").unwrap_or_default();
    let proxy_srv  = reg_get("ProxyServer").unwrap_or_default();

    Ok(serde_json::json!({
        "pac_url":      pac_url,
        "proxy_enable": proxy_en,
        "proxy_server": proxy_srv,
    }))
}

fn is_valid_ipv4(ip: &str) -> bool {
    let parts: Vec<&str> = ip.trim().split('.').collect();
    if parts.len() != 4 {
        return false;
    }
    parts.iter().all(|p| p.parse::<u8>().is_ok())
}

/// Robust multi-endpoint WAN IPv4 discovery
/// Robust multi-endpoint WAN IPv4 discovery — bypasses any active proxy or environment variables
#[command]
pub fn get_public_ip() -> Result<String, String> {
    let endpoints = [
        "https://api4.ipify.org",
        "https://ipv4.icanhazip.com",
        "https://v4.ident.me",
        "https://ifconfig.me/ip",
    ];

    for endpoint in endpoints {
        let mut cmd = hidden_command("curl.exe");
        cmd.args(["--silent", "--connect-timeout", "2", "--max-time", "3", "--noproxy", "*", endpoint]);
        cmd.env_remove("HTTP_PROXY")
           .env_remove("HTTPS_PROXY")
           .env_remove("ALL_PROXY")
           .env_remove("http_proxy")
           .env_remove("https_proxy")
           .env_remove("all_proxy");

        if let Ok(out) = cmd.output() {
            if out.status.success() {
                let candidate = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if is_valid_ipv4(&candidate) {
                    return Ok(candidate);
                }
            }
        }
    }

    Err("Could not retrieve external public IPv4 address".to_string())
}

// ── Application (.exe) Routing & Process Management ───────────────────────────

fn expand_env_vars(raw: &str) -> String {
    let mut result = raw.to_string();
    if let Ok(username) = std::env::var("USERNAME") {
        result = result.replace("%USERNAME%", &username);
    }
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        result = result.replace("%USERPROFILE%", &userprofile);
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        result = result.replace("%APPDATA%", &appdata);
    }
    if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
        result = result.replace("%LOCALAPPDATA%", &localappdata);
    }
    result
}

/// Opens native Windows Explorer OpenFileDialog to select an .exe file
#[command]
pub fn pick_exe_file() -> Result<Option<String>, String> {
    let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Filter = "Executable Files (*.exe)|*.exe|All Files (*.*)|*.*"
$dialog.Title = "Select Application Executable"
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dialog.FileName
}
"#;

    let out = hidden_command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .map_err(|e| format!("Failed to open file dialog: {}", e))?;

    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if path.is_empty() {
        Ok(None)
    } else {
        Ok(Some(path))
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ProcessStatus {
    pub query: String,
    pub is_running: bool,
    pub process_name: String,
}

/// Checks whether specified executables are currently running in Windows
#[command]
pub fn check_running_processes(names: Vec<String>) -> Result<Vec<ProcessStatus>, String> {
    let out = hidden_command("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .output()
        .map_err(|e| format!("tasklist execution failed: {}", e))?;

    let stdout = String::from_utf8_lossy(&out.stdout).to_lowercase();

    let mut results = Vec::new();
    for query in names {
        let clean = query.trim().to_lowercase();
        let exe_name = if clean.contains('\\') || clean.contains('/') {
            clean.rsplit(['\\', '/']).next().unwrap_or(&clean).to_string()
        } else {
            clean.clone()
        };

        let is_running = stdout.contains(&format!("\"{}\"", exe_name))
            || stdout.contains(&exe_name);

        results.push(ProcessStatus {
            query,
            is_running,
            process_name: exe_name,
        });
    }

    Ok(results)
}

/// Force-terminates a process by executable name
#[command]
pub fn kill_process(exe_name: String) -> Result<(), String> {
    let clean = exe_name.trim();
    let name = if clean.contains('\\') || clean.contains('/') {
        clean.rsplit(['\\', '/']).next().unwrap_or(clean)
    } else {
        clean
    };

    let out = hidden_command("taskkill")
        .args(["/F", "/IM", name])
        .output()
        .map_err(|e| format!("taskkill error: {}", e))?;

    if !out.status.success() {
        return Err(format!("Could not terminate {}", name));
    }
    Ok(())
}

/// Launches an application with isolated proxy environment variables and smart profiles
#[command]
pub fn launch_app_with_proxy(
    exe_path: String,
    args: Option<String>,
    proxy_url: Option<String>,
    #[allow(non_snake_case)]
    isolated_profile: Option<bool>,
    #[allow(non_snake_case)]
    isolatedProfile: Option<bool>,
) -> Result<u32, String> {
    let expanded_path = expand_env_vars(&exe_path);
    let path_obj = std::path::Path::new(&expanded_path);
    if !path_obj.exists() {
        return Err(format!("Executable not found: {}", expanded_path));
    }

    let eff_proxy_url = proxy_url
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "http://127.0.0.1:8183".to_string());

    let mut cmd = Command::new(&expanded_path);

    // Standard proxy environment variables
    cmd.env("HTTP_PROXY", &eff_proxy_url);
    cmd.env("HTTPS_PROXY", &eff_proxy_url);
    cmd.env("ALL_PROXY", &eff_proxy_url);
    cmd.env("http_proxy", &eff_proxy_url);
    cmd.env("https_proxy", &eff_proxy_url);
    cmd.env("all_proxy", &eff_proxy_url);
    cmd.env("NO_PROXY", "localhost,127.0.0.1");
    cmd.env("no_proxy", "localhost,127.0.0.1");

    let lower_path = expanded_path.to_lowercase();
    let is_chromium_electron = lower_path.contains("chrome")
        || lower_path.contains("cursor")
        || lower_path.contains("code")
        || lower_path.contains("discord")
        || lower_path.contains("slack")
        || lower_path.contains("brave")
        || lower_path.contains("edge")
        || lower_path.contains("msedge")
        || lower_path.contains("obsidian")
        || lower_path.contains("spotify")
        || lower_path.contains("notion")
        || lower_path.contains("vivaldi")
        || lower_path.contains("opera");

    let is_telegram = lower_path.contains("telegram");

    if is_chromium_electron {
        cmd.arg(format!("--proxy-server={}", eff_proxy_url));
        cmd.arg("--proxy-bypass-list=<local>;localhost;127.0.0.1");

        let use_profile = isolated_profile.or(isolatedProfile).unwrap_or(true);
        if use_profile {
            let app_name = path_obj
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("App");
            let temp_dir = std::env::temp_dir();
            let profile_dir = temp_dir.join("ProxyRouter_Profiles").join(app_name);
            let _ = std::fs::create_dir_all(&profile_dir);
            cmd.arg(format!("--user-data-dir={}", profile_dir.display()));
            cmd.arg("--no-first-run");
            cmd.arg("--no-default-browser-check");
        }
    } else if is_telegram {
        let parsed_port = eff_proxy_url
            .rsplit(':')
            .next()
            .and_then(|p| p.trim_end_matches('/').parse::<u16>().ok())
            .unwrap_or(8183);
        let parsed_host = if eff_proxy_url.contains("127.0.0.1") {
            "127.0.0.1"
        } else {
            "127.0.0.1"
        };
        cmd.args([
            "-proxy_server",
            parsed_host,
            "-proxy_port",
            &parsed_port.to_string(),
            "-proxy_type",
            "http",
        ]);
    }

    if let Some(extra_args) = args {
        for arg in extra_args.split_whitespace() {
            cmd.arg(arg);
        }
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("Could not launch '{}': {}", expanded_path, e))?;

    Ok(child.id())
}

/// Launches an interactive PowerShell terminal with proxy environment variables pre-configured
#[command]
pub fn launch_proxied_terminal() -> Result<u32, String> {
    let script = concat!(
        "$env:HTTP_PROXY='http://127.0.0.1:8183'; ",
        "$env:HTTPS_PROXY='http://127.0.0.1:8183'; ",
        "$env:ALL_PROXY='http://127.0.0.1:8183'; ",
        "$env:http_proxy='http://127.0.0.1:8183'; ",
        "$env:https_proxy='http://127.0.0.1:8183'; ",
        "$env:all_proxy='http://127.0.0.1:8183'; ",
        "$env:NO_PROXY='localhost,127.0.0.1'; ",
        "Write-Host '=====================================================' -ForegroundColor Cyan; ",
        "Write-Host '  PROXY ROUTER DESKTOP - Proxied PowerShell Terminal ' -ForegroundColor Green; ",
        "Write-Host '  HTTP_PROXY  : http://127.0.0.1:8183                ' -ForegroundColor Yellow; ",
        "Write-Host '  HTTPS_PROXY : http://127.0.0.1:8183                ' -ForegroundColor Yellow; ",
        "Write-Host '  ALL_PROXY   : http://127.0.0.1:8183                ' -ForegroundColor Yellow; ",
        "Write-Host '  All CLI requests (curl, git, npm, python) routed!  ' -ForegroundColor White; ",
        "Write-Host '=====================================================' -ForegroundColor Cyan; "
    );

    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoExit", "-Command", script]);

    let child = cmd
        .spawn()
        .map_err(|e| format!("Could not start PowerShell: {}", e))?;

    Ok(child.id())
}

/// Toggles terminal & CLI developer tools proxy in User Environment
#[command]
pub fn set_terminal_env_proxy(proxy_url: Option<String>, enabled: bool) -> Result<String, String> {
    let env_reg = r"HKCU\Environment";
    let eff_url = proxy_url
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "http://127.0.0.1:8183".to_string());

    if enabled {
        let _ = hidden_command("reg")
            .args(["add", env_reg, "/v", "HTTP_PROXY", "/t", "REG_SZ", "/d", &eff_url, "/f"])
            .output();
        let _ = hidden_command("reg")
            .args(["add", env_reg, "/v", "HTTPS_PROXY", "/t", "REG_SZ", "/d", &eff_url, "/f"])
            .output();
        let _ = hidden_command("reg")
            .args(["add", env_reg, "/v", "ALL_PROXY", "/t", "REG_SZ", "/d", &eff_url, "/f"])
            .output();
        let _ = hidden_command("reg")
            .args(["add", env_reg, "/v", "NO_PROXY", "/t", "REG_SZ", "/d", "localhost,127.0.0.1", "/f"])
            .output();
        Ok(format!("Terminal proxy variables set to {}", eff_url))
    } else {
        let _ = hidden_command("reg")
            .args(["delete", env_reg, "/v", "HTTP_PROXY", "/f"])
            .output();
        let _ = hidden_command("reg")
            .args(["delete", env_reg, "/v", "HTTPS_PROXY", "/f"])
            .output();
        let _ = hidden_command("reg")
            .args(["delete", env_reg, "/v", "ALL_PROXY", "/f"])
            .output();
        let _ = hidden_command("reg")
            .args(["delete", env_reg, "/v", "NO_PROXY", "/f"])
            .output();
        Ok("Terminal proxy variables removed".to_string())
    }
}

// ── Window Control Commands ───────────────────────────────────────────────────

#[command]
pub fn window_minimize(window: Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[command]
pub fn window_toggle_maximize(window: Window) -> Result<(), String> {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[command]
pub fn window_close(window: Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

// ── Registry & WinInet helpers ──────────────────────────────────────────────

fn apply_windows_pac_proxy(pac_url: &str) -> Result<(), String> {
    let escaped_url = pac_url.replace('"', "\\\"");
    let script = format!(
        r#"
$pacUrl = "{}"
$regPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$connPath = "$regPath\Connections"

if ($pacUrl) {{
    Set-ItemProperty -Path $regPath -Name 'AutoConfigURL' -Value $pacUrl
    Set-ItemProperty -Path $regPath -Name 'ProxyEnable' -Value 0
    Set-ItemProperty -Path $regPath -Name 'ProxyServer' -Value ''

    # Flag 0x05 = PROXY_TYPE_DIRECT (1) | PROXY_TYPE_AUTO_PROXY_URL (4)
    $flags = [byte]0x05
    $header = [byte[]](0x46, 0x00, 0x00, 0x00, 0x0B, 0x00, 0x00, 0x00, $flags, 0x00, 0x00, 0x00)
    $proxyServerLen = [BitConverter]::GetBytes([int]0)
    $bypassBytes = [System.Text.Encoding]::ASCII.GetBytes("<-loopback>")
    $bypassLen = [BitConverter]::GetBytes([int]$bypassBytes.Length)
    $pacBytes = [System.Text.Encoding]::ASCII.GetBytes($pacUrl)
    $pacLen = [BitConverter]::GetBytes([int]$pacBytes.Length)
    $padding = New-Object byte[] 32
    $blob = $header + $proxyServerLen + $bypassLen + $bypassBytes + $pacLen + $pacBytes + $padding

    Set-ItemProperty -Path $connPath -Name 'DefaultConnectionSettings' -Value $blob
    Set-ItemProperty -Path $connPath -Name 'SavedLegacySettings' -Value $blob
}} else {{
    Set-ItemProperty -Path $regPath -Name 'AutoConfigURL' -Value ''
    Set-ItemProperty -Path $regPath -Name 'ProxyEnable' -Value 0
    Set-ItemProperty -Path $regPath -Name 'ProxyServer' -Value ''

    # Flag 0x09 = PROXY_TYPE_AUTO_DETECT (wpad default)
    $flags = [byte]0x09
    $header = [byte[]](0x46, 0x00, 0x00, 0x00, 0x0B, 0x00, 0x00, 0x00, $flags, 0x00, 0x00, 0x00)
    $proxyServerLen = [BitConverter]::GetBytes([int]0)
    $bypassBytes = [System.Text.Encoding]::ASCII.GetBytes("<-loopback>")
    $bypassLen = [BitConverter]::GetBytes([int]$bypassBytes.Length)
    $pacLen = [BitConverter]::GetBytes([int]0)
    $padding = New-Object byte[] 32
    $blob = $header + $proxyServerLen + $bypassLen + $bypassBytes + $pacLen + $padding

    Set-ItemProperty -Path $connPath -Name 'DefaultConnectionSettings' -Value $blob
    Set-ItemProperty -Path $connPath -Name 'SavedLegacySettings' -Value $blob
}}

$wininetCode = @"
using System;
using System.Runtime.InteropServices;
public class WinInetHelper {{
    [DllImport("wininet.dll", SetLastError = true)]
    public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
    public const int INTERNET_OPTION_SETTINGS_CHANGED = 39;
    public const int INTERNET_OPTION_REFRESH = 37;
    public static void Refresh() {{
        InternetSetOption(IntPtr.Zero, INTERNET_OPTION_SETTINGS_CHANGED, IntPtr.Zero, 0);
        InternetSetOption(IntPtr.Zero, INTERNET_OPTION_REFRESH, IntPtr.Zero, 0);
    }}
}}
"@
Add-Type -TypeDefinition $wininetCode -ErrorAction SilentlyContinue
[WinInetHelper]::Refresh()
"#,
        escaped_url
    );

    let out = hidden_command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|e| format!("Failed to configure Windows proxy: {}", e))?;

    if !out.status.success() {
        return Err(format!(
            "Failed configuring Windows proxy: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }

    Ok(())
}

fn reg_get(name: &str) -> Option<String> {
    let out = hidden_command("reg")
        .args(["query", REG_PATH, "/v", name])
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 3 && parts[0] == name {
            return Some(parts[2..].join(" "));
        }
    }
    None
}
