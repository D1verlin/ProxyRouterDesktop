// Tauri Rust backend — system proxy, app router, & embedded PAC server

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener, TcpStream, ToSocketAddrs, UdpSocket};
use std::process::Command;
use std::sync::{Arc, RwLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::{command, AppHandle, Window};

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

// Global proxy master switch state
pub static PROXY_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

// Global in-memory list of routed domains for selective forwarder filtering
static ROUTED_DOMAINS: RwLock<Vec<String>> = RwLock::new(Vec::new());

// Fast in-memory DNS cache: target -> (Vec<SocketAddr>, Instant)
static DNS_CACHE: RwLock<Option<HashMap<String, (Vec<SocketAddr>, Instant)>>> = RwLock::new(None);

/// Queries fast public DNS (77.88.8.8, 1.1.1.1, 8.8.8.8) directly via UDP IPv4.
/// This completely bypasses buggy Windows IPv6 RDNSS stalls and dead local adapter timeouts.
fn query_dns_ipv4(host: &str) -> Vec<Ipv4Addr> {
    let mut ips = Vec::new();
    if let Ok(ip) = host.parse::<Ipv4Addr>() {
        ips.push(ip);
        return ips;
    }

    let socket = match UdpSocket::bind("0.0.0.0:0") {
        Ok(s) => s,
        Err(_) => return ips,
    };
    let _ = socket.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = socket.set_write_timeout(Some(Duration::from_millis(500)));

    let mut packet = Vec::with_capacity(64);
    packet.extend_from_slice(&[0x1a, 0x2b]); // TXID
    packet.extend_from_slice(&[0x01, 0x00]); // Standard query, RD=1
    packet.extend_from_slice(&[0x00, 0x01]); // QDCOUNT=1
    packet.extend_from_slice(&[0x00, 0x00, 0x00, 0x00, 0x00, 0x00]); // AN, NS, AR = 0

    for part in host.split('.') {
        if part.is_empty() || part.len() > 63 {
            return ips;
        }
        packet.push(part.len() as u8);
        packet.extend_from_slice(part.as_bytes());
    }
    packet.push(0x00);
    packet.extend_from_slice(&[0x00, 0x01]); // Type A
    packet.extend_from_slice(&[0x00, 0x01]); // Class IN

    // 77.88.8.8 is fastest in Russia/CIS; 1.1.1.1 and 8.8.8.8 as fallbacks
    let servers = ["77.88.8.8:53", "1.1.1.1:53", "8.8.8.8:53"];
    let mut buf = [0u8; 512];
    for server in &servers {
        if socket.send_to(&packet, server).is_ok() {
            if let Ok((len, _)) = socket.recv_from(&mut buf) {
                if len >= 12 && buf[0] == 0x1a && buf[1] == 0x2b {
                    let ancount = u16::from_be_bytes([buf[6], buf[7]]);
                    if ancount > 0 {
                        let mut idx = 12;
                        while idx < len && buf[idx] != 0 {
                            if (buf[idx] & 0xc0) == 0xc0 {
                                idx += 2;
                                break;
                            } else {
                                idx += 1 + (buf[idx] as usize);
                            }
                        }
                        if idx < len && buf[idx] == 0 {
                            idx += 1;
                        }
                        idx += 4; // Skip QTYPE and QCLASS

                        for _ in 0..ancount {
                            if idx >= len {
                                break;
                            }
                            if (buf[idx] & 0xc0) == 0xc0 {
                                idx += 2;
                            } else {
                                while idx < len && buf[idx] != 0 {
                                    idx += 1 + (buf[idx] as usize);
                                }
                                if idx < len {
                                    idx += 1;
                                }
                            }
                            if idx + 10 > len {
                                break;
                            }
                            let rtype = u16::from_be_bytes([buf[idx], buf[idx + 1]]);
                            let rdlength = u16::from_be_bytes([buf[idx + 8], buf[idx + 9]]) as usize;
                            idx += 10;
                            if rtype == 1 && rdlength == 4 && idx + 4 <= len {
                                ips.push(Ipv4Addr::new(
                                    buf[idx],
                                    buf[idx + 1],
                                    buf[idx + 2],
                                    buf[idx + 3],
                                ));
                            }
                            idx += rdlength;
                        }
                        if !ips.is_empty() {
                            return ips;
                        }
                    }
                }
            }
        }
    }
    ips
}

/// Resolves target "host:port" with fast memory cache and strict IPv4-first ordering
fn resolve_target_addresses(target: &str) -> Vec<SocketAddr> {
    let now = Instant::now();
    let cache_ttl_secs = 300; // 5 minutes

    if let Ok(guard) = DNS_CACHE.read() {
        if let Some(ref map) = *guard {
            if let Some((addrs, ts)) = map.get(target) {
                if now.duration_since(*ts).as_secs() < cache_ttl_secs {
                    return addrs.clone();
                }
            }
        }
    }

    let mut result = Vec::new();
    let host_part = target.split(':').next().unwrap_or(target);
    let port: u16 = target.split(':').nth(1).and_then(|p| p.parse().ok()).unwrap_or(80);

    // 1. Try fast pure-UDP DNS first (bypasses Windows IPv6 RDNSS stall)
    let fast_ips = query_dns_ipv4(host_part);
    for ip in fast_ips {
        result.push(SocketAddr::V4(SocketAddrV4::new(ip, port)));
    }

    // 2. Fallback to OS resolver if pure-UDP didn't find anything
    if result.is_empty() {
        if let Ok(iter) = target.to_socket_addrs() {
            let mut os_addrs: Vec<_> = iter.collect();
            // Prioritize IPv4
            os_addrs.sort_by_key(|a| if a.is_ipv4() { 0 } else { 1 });
            result = os_addrs;
        }
    }

    if !result.is_empty() {
        if let Ok(mut guard) = DNS_CACHE.write() {
            let map = guard.get_or_insert_with(HashMap::new);
            map.insert(target.to_string(), (result.clone(), now));
        }
    }

    result
}

pub fn should_proxy_host(target: &str) -> bool {
    let host = target
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .split('/')
        .next()
        .unwrap_or(target)
        .split(':')
        .next()
        .unwrap_or(target)
        .trim()
        .to_lowercase();

    if host.is_empty() || host == "localhost" || host == "127.0.0.1" || !host.contains('.') {
        return false;
    }

    // Core AI and developer ecosystem domains that MUST ALWAYS route through VPS proxy
    const CORE_AI_DOMAINS: &[&str] = &[
        "googleapis.com",
        "google.com",
        "deepmind.google",
        "gstatic.com",
        "googleusercontent.com",
        "aistudio.google.com",
        "antigravity.google",
        "ai.google.dev",
        "openai.com",
        "chatgpt.com",
        "oaistatic.com",
        "oaiusercontent.com",
        "anthropic.com",
        "claude.ai",
        "claudeusercontent.com",
    ];

    for domain in CORE_AI_DOMAINS {
        if host == *domain || host.ends_with(&format!(".{}", domain)) {
            return true;
        }
    }

    if let Ok(domains) = ROUTED_DOMAINS.read() {
        for domain in domains.iter() {
            if host == *domain || host.ends_with(&format!(".{}", domain)) {
                return true;
            }
        }
    }
    false
}

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
            "    dnsDomainIs(host, \".{}\") || host === \"{}\" || shExpMatch(host, \"*.{}\")",
            domain, domain, domain
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
        "notebook.google".to_string(),
        "notebooklm.google".to_string(),
        "notebook.google.com".to_string(),
        "notebooklm.google.com".to_string(),
        "cloud.google".to_string(),
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
        "deepl.com".to_string(),
        "linguee.com".to_string(),
        "deepl-partners.com".to_string(),
    ];
    let default_pac = generate_pac_script("2.27.25.190", 3128, &default_domains);
    if let Ok(mut lock) = PAC_CONTENT.write() {
        *lock = Some(Arc::new(default_pac));
    }
    if let Ok(mut lock) = ROUTED_DOMAINS.write() {
        *lock = default_domains.clone();
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
                thread::spawn(move || {
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
                    let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
                    let mut buf = [0u8; 2048];
                    if let Ok(bytes_read) = stream.read(&mut buf) {
                        if bytes_read == 0 {
                            return;
                        }
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
                                "HTTP/1.1 200 OK\r\nContent-Type: application/x-ns-proxy-autoconfig\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-cache, no-store, must-revalidate\r\nPragma: no-cache\r\nExpires: 0\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
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
                });
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

    let is_active = PROXY_ACTIVE.load(std::sync::atomic::Ordering::Relaxed);
    let (upstream_host, upstream_port) = {
        let lock = UPSTREAM_PROXY.read().unwrap();
        lock.clone()
    };

    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        return Ok(());
    }
    let method = parts[0];
    let target = parts[1];
    let should_proxy = is_active && should_proxy_host(target);

    if method.eq_ignore_ascii_case("CONNECT") {
        // Drain client CONNECT headers
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line)? == 0 || line == "\r\n" || line == "\n" {
                break;
            }
        }

        let target_stream = if should_proxy {
            if upstream_host.is_empty() {
                let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n");
                return Ok(());
            }

            // Route via upstream Squid proxy on VPS
            let upstream_addrs = resolve_target_addresses(&format!("{}:{}", upstream_host, upstream_port));
            let mut upstream = None;
            for addr in upstream_addrs {
                if let Ok(s) = TcpStream::connect_timeout(&addr, Duration::from_secs(4)) {
                    upstream = Some(s);
                    break;
                }
            }

            let mut upstream = match upstream {
                Some(s) => s,
                None => {
                    eprintln!("[local-forwarder] Upstream {}:{} unreachable", upstream_host, upstream_port);
                    let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n");
                    return Ok(());
                }
            };

            upstream.set_read_timeout(Some(Duration::from_secs(45)))?;
            upstream.set_write_timeout(Some(Duration::from_secs(45)))?;

            let connect_req = format!("CONNECT {} HTTP/1.1\r\nHost: {}\r\nProxy-Connection: Keep-Alive\r\n\r\n", target, target);
            if let Err(e) = upstream.write_all(connect_req.as_bytes()) {
                eprintln!("[local-forwarder] Failed writing CONNECT to upstream: {}", e);
                let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n");
                return Ok(());
            }

            let mut upstream_reader = BufReader::new(upstream.try_clone()?);
            let mut resp_line = String::new();
            if upstream_reader.read_line(&mut resp_line).is_err() || !resp_line.contains("200") {
                let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n");
                return Ok(());
            }

            loop {
                let mut line = String::new();
                if upstream_reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" || line == "\n" {
                    break;
                }
            }

            // Flush any excess bytes that were buffered inside upstream_reader
            let upstream_leftover = upstream_reader.buffer().to_vec();
            if !upstream_leftover.is_empty() {
                let _ = client.write_all(&upstream_leftover);
            }

            upstream
        } else {
            // Master proxy is disabled or host is unrouted: connect DIRECTLY via fast IPv4-first resolution
            let addrs = resolve_target_addresses(target);
            let mut direct_stream = None;
            for addr in addrs {
                if let Ok(s) = TcpStream::connect_timeout(&addr, Duration::from_millis(1500)) {
                    direct_stream = Some(s);
                    break;
                }
            }
            match direct_stream {
                Some(s) => s,
                None => {
                    eprintln!("[local-forwarder] Direct connection to {} failed", target);
                    let _ = client.write_all(b"HTTP/1.1 504 Gateway Timeout\r\n\r\n");
                    return Ok(());
                }
            }
        };

        client.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")?;

        let _ = client.set_read_timeout(None);
        let _ = client.set_write_timeout(None);
        let _ = target_stream.set_read_timeout(None);
        let _ = target_stream.set_write_timeout(None);

        // Send any data that BufReader already read from client socket (e.g. TLS ClientHello)
        let client_leftover = reader.buffer().to_vec();
        if !client_leftover.is_empty() {
            let mut target_clone = target_stream.try_clone()?;
            let _ = target_clone.write_all(&client_leftover);
        }

        let mut client_read = client.try_clone()?;
        let mut client_write = client.try_clone()?;
        let mut target_read = target_stream.try_clone()?;
        let mut target_write = target_stream;

        let t1 = thread::spawn(move || {
            let _ = std::io::copy(&mut client_read, &mut target_write);
            let _ = target_write.shutdown(std::net::Shutdown::Write);
        });

        let _ = std::io::copy(&mut target_read, &mut client_write);
        let _ = client_write.shutdown(std::net::Shutdown::Write);
        let _ = t1.join();
    } else {
        // Plain HTTP forwarding
        let mut target_stream = if should_proxy {
            let upstream_addrs = resolve_target_addresses(&format!("{}:{}", upstream_host, upstream_port));
            let mut upstream = None;
            for a in upstream_addrs {
                if let Ok(s) = TcpStream::connect_timeout(&a, Duration::from_secs(4)) {
                    upstream = Some(s);
                    break;
                }
            }
            match upstream {
                Some(s) => s,
                None => {
                    let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n");
                    return Ok(());
                }
            }
        } else {
            let host_part = target.trim_start_matches("http://").split('/').next().unwrap_or(target);
            let addr_str = if host_part.contains(':') {
                host_part.to_string()
            } else {
                format!("{}:80", host_part)
            };
            let addrs = resolve_target_addresses(&addr_str);
            let mut direct_stream = None;
            for a in addrs {
                if let Ok(s) = TcpStream::connect_timeout(&a, Duration::from_millis(1500)) {
                    direct_stream = Some(s);
                    break;
                }
            }
            match direct_stream {
                Some(s) => s,
                None => {
                    let _ = client.write_all(b"HTTP/1.1 504 Gateway Timeout\r\n\r\n");
                    return Ok(());
                }
            }
        };

        let formatted_request_line = if should_proxy {
            request_line
        } else {
            let relative_path = if let Some(idx) = target.find("://") {
                let after_scheme = &target[idx + 3..];
                if let Some(slash_idx) = after_scheme.find('/') {
                    &after_scheme[slash_idx..]
                } else {
                    "/"
                }
            } else if target.starts_with('/') {
                target
            } else if let Some(slash_idx) = target.find('/') {
                &target[slash_idx..]
            } else {
                "/"
            };
            format!("{} {} {}\r\n", method, relative_path, parts.get(2).unwrap_or(&"HTTP/1.1"))
        };

        target_stream.write_all(formatted_request_line.as_bytes())?;
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line)? == 0 {
                break;
            }
            target_stream.write_all(line.as_bytes())?;
            if line == "\r\n" || line == "\n" {
                break;
            }
        }

        let client_leftover = reader.buffer().to_vec();
        if !client_leftover.is_empty() {
            let _ = target_stream.write_all(&client_leftover);
        }

        let mut client_read = client.try_clone()?;
        let mut client_write = client.try_clone()?;
        let mut target_read = target_stream.try_clone()?;
        let mut target_write = target_stream;

        let t1 = thread::spawn(move || {
            let _ = std::io::copy(&mut client_read, &mut target_write);
            let _ = target_write.shutdown(std::net::Shutdown::Write);
        });

        let _ = std::io::copy(&mut target_read, &mut client_write);
        let _ = client_write.shutdown(std::net::Shutdown::Write);
        let _ = t1.join();
    }

    Ok(())
}

fn resolve_effective_proxy_target(host: &str, port: u16) -> (String, u16) {
    let trimmed = host.trim();
    let eff_host = if trimmed.is_empty()
        || trimmed.contains("your-server-ip")
        || trimmed == "127.0.0.1"
        || trimmed == "localhost"
    {
        "2.27.25.190".to_string()
    } else {
        trimmed.to_string()
    };
    let eff_port = if port == 0 { 3128 } else { port };
    (eff_host, eff_port)
}

/// Updates upstream proxy target in memory
#[command]
pub fn update_upstream_proxy(proxy_host: String, proxy_port: u16) -> Result<String, String> {
    let (eff_host, eff_port) = resolve_effective_proxy_target(&proxy_host, proxy_port);
    if let Ok(mut lock) = UPSTREAM_PROXY.write() {
        *lock = (eff_host.clone(), eff_port);
        Ok(format!("Upstream proxy set to {}:{}", eff_host, eff_port))
    } else {
        Err("Failed to acquire write lock for UPSTREAM_PROXY".to_string())
    }
}

/// Updates PAC rules in memory from the Tauri UI
#[command]
pub fn update_pac_rules(proxy_host: String, proxy_port: u16, hosts: Vec<String>) -> Result<String, String> {
    let (eff_host, eff_port) = resolve_effective_proxy_target(&proxy_host, proxy_port);
    if let Ok(mut lock) = UPSTREAM_PROXY.write() {
        *lock = (eff_host.clone(), eff_port);
    }
    if let Ok(mut lock) = ROUTED_DOMAINS.write() {
        let mut cleaned = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for raw in &hosts {
            let d = raw
                .trim()
                .trim_start_matches("*.")
                .trim_start_matches('.')
                .to_lowercase();
            if !d.is_empty() && seen.insert(d.clone()) {
                cleaned.push(d);
            }
        }
        *lock = cleaned;
    }
    let script = generate_pac_script(&eff_host, eff_port, &hosts);
    if let Ok(mut lock) = PAC_CONTENT.write() {
        *lock = Some(Arc::new(script));
        Ok("PAC rules updated".to_string())
    } else {
        Err("Failed to acquire write lock".to_string())
    }
}

/// Sets the system proxy to local forwarder on 127.0.0.1:8183
#[command]
pub fn set_system_proxy(
    #[allow(unused_variables)]
    pac_url: Option<String>,
    #[allow(unused_variables)]
    #[allow(non_snake_case)]
    pacUrl: Option<String>,
) -> Result<String, String> {
    PROXY_ACTIVE.store(true, std::sync::atomic::Ordering::SeqCst);
    apply_windows_system_proxy(true)?;
    Ok("System proxy set to 127.0.0.1:8183".to_string())
}

/// Clears all system proxy settings — traffic goes direct.
#[command]
pub fn clear_system_proxy() -> Result<String, String> {
    PROXY_ACTIVE.store(false, std::sync::atomic::Ordering::SeqCst);
    apply_windows_system_proxy(false)?;
    let _ = set_terminal_env_proxy(None, false);
    if let Ok(mut lock) = PAC_CONTENT.write() {
        *lock = Some(Arc::new(
            "// Proxy Disabled\nfunction FindProxyForURL(url, host) {\n  return 'DIRECT';\n}\n".to_string()
        ));
    }
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

    let mut cmd = Command::new("cmd.exe");
    cmd.args([
        "/c",
        "start",
        "Proxy Router Terminal",
        "powershell.exe",
        "-NoExit",
        "-Command",
        script,
    ]);

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

// ── Autostart & Dynamic Tray Icon Commands ─────────────────────────────────

pub const TRAY_ACTIVE_BYTES: &[u8] = include_bytes!("../icons/tray-active.png");
pub const TRAY_INACTIVE_BYTES: &[u8] = include_bytes!("../icons/tray-inactive.png");

const AUTOSTART_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const AUTOSTART_NAME: &str = "ProxyRouterDesktop";

#[command]
pub fn get_autostart_status() -> Result<bool, String> {
    let out = hidden_command("reg")
        .args(["query", AUTOSTART_KEY, "/v", AUTOSTART_NAME])
        .output()
        .map_err(|e| format!("Registry query error: {}", e))?;
    Ok(out.status.success())
}

#[command]
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    if enabled {
        let current_exe = std::env::current_exe()
            .map_err(|e| format!("Failed to get executable path: {}", e))?;
        let exe_str = current_exe.to_string_lossy().to_string();
        let cmd_val = format!("\"{}\" --silent", exe_str);
        let out = hidden_command("reg")
            .args(["add", AUTOSTART_KEY, "/v", AUTOSTART_NAME, "/t", "REG_SZ", "/d", &cmd_val, "/f"])
            .output()
            .map_err(|e| format!("Failed to register autostart: {}", e))?;
        if !out.status.success() {
            return Err(format!(
                "Failed to set autostart in registry: {}",
                String::from_utf8_lossy(&out.stderr)
            ));
        }
    } else {
        let _ = hidden_command("reg")
            .args(["delete", AUTOSTART_KEY, "/v", AUTOSTART_NAME, "/f"])
            .output();
    }
    Ok(())
}

pub fn build_tray_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    active: bool,
) -> Result<Menu<R>, tauri::Error> {
    let status_text = if active {
        "Proxy Router: Active"
    } else {
        "Proxy Router: Disconnected"
    };
    let toggle_text = if active {
        "Disable Proxy"
    } else {
        "Enable Proxy"
    };

    let status_header = MenuItem::with_id(app, "status_info", status_text, false, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let toggle_proxy_item = MenuItem::with_id(app, "toggle_proxy", toggle_text, true, None::<&str>)?;
    let terminal_item = MenuItem::with_id(app, "open_terminal", "Open Proxied Terminal", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let show_window_item = MenuItem::with_id(app, "show_window", "Show Proxy Router", true, None::<&str>)?;
    let hide_window_item = MenuItem::with_id(app, "hide_window", "Hide to Tray", true, None::<&str>)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit_app", "Quit Proxy Router", true, None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &status_header,
            &sep1,
            &toggle_proxy_item,
            &terminal_item,
            &sep2,
            &show_window_item,
            &hide_window_item,
            &sep3,
            &quit_item,
        ],
    )
}

#[command]
pub fn update_tray_icon(app: AppHandle, active: bool) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main_tray") {
        let img_bytes = if active { TRAY_ACTIVE_BYTES } else { TRAY_INACTIVE_BYTES };
        if let Ok(icon) = Image::from_bytes(img_bytes) {
            let _ = tray.set_icon(Some(icon));
        }
        let tooltip = if active {
            "Proxy Router: Active (Connected)"
        } else {
            "Proxy Router: Disconnected"
        };
        let _ = tray.set_tooltip(Some(tooltip));

        if let Ok(menu) = build_tray_menu(&app, active) {
            let _ = tray.set_menu(Some(menu));
        }
    }
    Ok(())
}

#[command]
pub fn app_quit(app: AppHandle) -> Result<(), String> {
    let _ = clear_system_proxy();
    app.exit(0);
    Ok(())
}

// ── Window Control Commands (Minimize to Tray) ───────────────────────────────

#[command]
pub fn window_minimize(window: Window) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
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
    window.hide().map_err(|e| e.to_string())
}

// ── Registry & WinInet helpers ──────────────────────────────────────────────

fn apply_windows_system_proxy(enabled: bool) -> Result<(), String> {
    let script = format!(
        r#"
$regPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$connPath = "$regPath\Connections"

# Guarantee AutoConfigURL (PAC) is completely eradicated from registry
Remove-ItemProperty -Path $regPath -Name 'AutoConfigURL' -ErrorAction SilentlyContinue

if ({}) {{
    Set-ItemProperty -Path $regPath -Name 'ProxyEnable' -Value 1 -Type DWord
    Set-ItemProperty -Path $regPath -Name 'ProxyServer' -Value '127.0.0.1:8183' -Type String
    Set-ItemProperty -Path $regPath -Name 'ProxyOverride' -Value 'localhost;127.0.0.1;<local>' -Type String

    # Flag 0x03 = PROXY_TYPE_DIRECT (1) | PROXY_TYPE_PROXY_SERVER (2)
    $flags = [byte]0x03
    $header = [byte[]](0x46, 0x00, 0x00, 0x00, 0x12, 0x00, 0x00, 0x00, $flags, 0x00, 0x00, 0x00)
    $proxyBytes = [System.Text.Encoding]::ASCII.GetBytes("127.0.0.1:8183")
    $proxyLen = [BitConverter]::GetBytes([int]$proxyBytes.Length)
    $bypassBytes = [System.Text.Encoding]::ASCII.GetBytes("localhost;127.0.0.1;<local>")
    $bypassLen = [BitConverter]::GetBytes([int]$bypassBytes.Length)
    $pacLen = [BitConverter]::GetBytes([int]0)
    $padding = New-Object byte[] 32
    $blob = $header + $proxyLen + $proxyBytes + $bypassLen + $bypassBytes + $pacLen + $padding

    Set-ItemProperty -Path $connPath -Name 'DefaultConnectionSettings' -Value $blob
    Set-ItemProperty -Path $connPath -Name 'SavedLegacySettings' -Value $blob
    Get-Item -Path $connPath -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Property | ForEach-Object {{
        Set-ItemProperty -Path $connPath -Name $_ -Value $blob -ErrorAction SilentlyContinue
    }}
}} else {{
    Set-ItemProperty -Path $regPath -Name 'ProxyEnable' -Value 0 -Type DWord
    Set-ItemProperty -Path $regPath -Name 'ProxyServer' -Value '' -Type String

    # Flag 0x01 = PROXY_TYPE_DIRECT (strictly direct, no proxy)
    $flags = [byte]0x01
    $header = [byte[]](0x46, 0x00, 0x00, 0x00, 0x13, 0x00, 0x00, 0x00, $flags, 0x00, 0x00, 0x00)
    $proxyLen = [BitConverter]::GetBytes([int]0)
    $bypassBytes = [System.Text.Encoding]::ASCII.GetBytes("localhost;127.0.0.1;<local>")
    $bypassLen = [BitConverter]::GetBytes([int]$bypassBytes.Length)
    $pacLen = [BitConverter]::GetBytes([int]0)
    $padding = New-Object byte[] 32
    $blob = $header + $proxyLen + $bypassLen + $bypassBytes + $pacLen + $padding

    Set-ItemProperty -Path $connPath -Name 'DefaultConnectionSettings' -Value $blob
    Set-ItemProperty -Path $connPath -Name 'SavedLegacySettings' -Value $blob
    Get-Item -Path $connPath -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Property | ForEach-Object {{
        Set-ItemProperty -Path $connPath -Name $_ -Value $blob -ErrorAction SilentlyContinue
    }}
}}

$wininetCode = @"
using System;
using System.Runtime.InteropServices;
public class WinInetHelper {{
    [DllImport("wininet.dll", SetLastError = true)]
    public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern IntPtr SendMessageTimeout(
        IntPtr hWnd,
        uint Msg,
        UIntPtr wParam,
        string lParam,
        uint fuFlags,
        uint uTimeout,
        out UIntPtr lpdwResult
    );

    public const int INTERNET_OPTION_SETTINGS_CHANGED = 39;
    public const int INTERNET_OPTION_REFRESH = 37;
    public const uint WM_SETTINGCHANGE = 0x001A;
    public const uint SMTO_ABORTIFHUNG = 0x0002;

    public static void Refresh() {{
        InternetSetOption(IntPtr.Zero, INTERNET_OPTION_SETTINGS_CHANGED, IntPtr.Zero, 0);
        InternetSetOption(IntPtr.Zero, INTERNET_OPTION_REFRESH, IntPtr.Zero, 0);
        UIntPtr result;
        SendMessageTimeout((IntPtr)0xffff, WM_SETTINGCHANGE, UIntPtr.Zero, "Internet Settings", SMTO_ABORTIFHUNG, 1000, out result);
    }}
}}
"@
Add-Type -TypeDefinition $wininetCode -ErrorAction SilentlyContinue
[WinInetHelper]::Refresh()
"#,
        if enabled { "$true" } else { "$false" }
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
