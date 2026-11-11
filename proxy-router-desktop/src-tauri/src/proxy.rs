// Tauri Rust backend — system proxy, app router, & embedded PAC server

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener, TcpStream, ToSocketAddrs, UdpSocket};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::{command, AppHandle, Manager, Window};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

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

// Upstream proxy protocol
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UpstreamProtocol {
    Http,
    Https,
    Socks5,
}

impl Default for UpstreamProtocol {
    fn default() -> Self {
        UpstreamProtocol::Http
    }
}

impl UpstreamProtocol {
    pub fn from_str_opt(s: Option<&str>) -> Self {
        match s.map(|v| v.to_ascii_lowercase()).as_deref() {
            Some("https") | Some("tls") => UpstreamProtocol::Https,
            Some("socks5") | Some("socks") => UpstreamProtocol::Socks5,
            _ => UpstreamProtocol::Http,
        }
    }
}

// Global in-memory PAC content protected by RwLock
static PAC_CONTENT: RwLock<Option<Arc<String>>> = RwLock::new(None);

// Global upstream proxy target protected by RwLock (host, port, protocol, ignore_tls_errors)
static UPSTREAM_PROXY: RwLock<(String, u16, UpstreamProtocol, bool)> =
    RwLock::new((String::new(), 3128, UpstreamProtocol::Http, true));

// Global proxy master switch state
pub static PROXY_ACTIVE: AtomicBool = AtomicBool::new(false);

// Global proxy mode: 0 = Split Tunneling (selective rules), 1 = Global Mode (all external traffic)
pub static PROXY_MODE: AtomicU8 = AtomicU8::new(0);

// Global live telemetry metrics
pub static TOTAL_RX_BYTES: AtomicU64 = AtomicU64::new(0);
pub static TOTAL_TX_BYTES: AtomicU64 = AtomicU64::new(0);
pub static ACTIVE_CONNECTIONS: AtomicU32 = AtomicU32::new(0);

#[derive(Clone, Serialize, Deserialize)]
pub struct SessionRecord {
    pub host: String,
    pub proxied: bool,
    pub bytes: u64,
    pub timestamp: u64,
}

static RECENT_SESSIONS: Mutex<Option<VecDeque<SessionRecord>>> = Mutex::new(None);

pub fn record_session(target: &str, proxied: bool, bytes: u64) {
    let host = target
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .split('/')
        .next()
        .unwrap_or(target)
        .split(':')
        .next()
        .unwrap_or(target)
        .to_string();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    if let Ok(mut lock) = RECENT_SESSIONS.lock() {
        let deque = lock.get_or_insert_with(|| VecDeque::with_capacity(35));
        deque.push_front(SessionRecord {
            host,
            proxied,
            bytes,
            timestamp: now,
        });
        if deque.len() > 30 {
            deque.pop_back();
        }
    }
}

pub fn update_session_bytes(host: &str, additional_bytes: u64) {
    let clean_host = host
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .split('/')
        .next()
        .unwrap_or(host)
        .split(':')
        .next()
        .unwrap_or(host);

    if let Ok(mut lock) = RECENT_SESSIONS.lock() {
        if let Some(ref mut deque) = *lock {
            for session in deque.iter_mut() {
                if session.host == clean_host {
                    session.bytes += additional_bytes;
                    break;
                }
            }
        }
    }
}

// Global in-memory list of routed domains for selective forwarder filtering
static ROUTED_DOMAINS: RwLock<Vec<String>> = RwLock::new(Vec::new());

// Fast in-memory DNS cache: target -> (Vec<SocketAddr>, Instant)
static DNS_CACHE: RwLock<Option<HashMap<String, (Vec<SocketAddr>, Instant)>>> = RwLock::new(None);

// Configurable fast public DNS servers (NO Yandex!).
// Defaults to Cloudflare (1.1.1.1, 1.0.0.1), Google (8.8.8.8), and Quad9 (9.9.9.9)
static ACTIVE_DNS_SERVERS: RwLock<Vec<String>> = RwLock::new(Vec::new());

pub fn get_configured_dns_servers() -> Vec<String> {
    if let Ok(guard) = ACTIVE_DNS_SERVERS.read() {
        if !guard.is_empty() {
            return guard.clone();
        }
    }
    vec![
        "1.1.1.1:53".to_string(),
        "1.0.0.1:53".to_string(),
        "8.8.8.8:53".to_string(),
        "9.9.9.9:53".to_string(),
    ]
}

/// Queries fast public DNS directly via UDP IPv4.
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

    let servers = get_configured_dns_servers();
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

    // 0. If host_part is already an IP address, resolve instantly with 0 latency
    if let Ok(ip) = host_part.parse::<IpAddr>() {
        return vec![SocketAddr::new(ip, port)];
    }

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

    // Never proxy traffic targeting the upstream VPS itself (prevents Whitelist API loops)
    if let Ok(lock) = UPSTREAM_PROXY.read() {
        let up_host = lock.0.trim().to_lowercase();
        if !up_host.is_empty() && host == up_host {
            return false;
        }
    }

    // NEVER proxy local network or Apple authentication / services (critical for AltServer & AltStore)
    if host.ends_with(".apple.com") || host == "apple.com"
        || host.ends_with(".icloud.com") || host == "icloud.com"
        || host.ends_with(".mzstatic.com") || host.ends_with(".aaplimg.com")
        || host.ends_with(".apple-cloudkit.com") || host.ends_with(".crashlytics.com")
        || host.starts_with("192.168.") || host.starts_with("10.") || host.starts_with("172.")
        || host.ends_with(".local")
    {
        return false;
    }

    // In Global Mode (1), route all external destinations through the upstream proxy
    if PROXY_MODE.load(Ordering::Relaxed) == 1 {
        return true;
    }

    // Core AI and developer ecosystem domains that MUST ALWAYS route through VPS proxy
    const CORE_AI_DOMAINS: &[&str] = &[
        "daily-cloudcode-pa.googleapis.com",
        "cloudcode-pa.googleapis.com",
        "cloudaicompanion.googleapis.com",
        "googleapis.com",
        "google.com",
        "google",
        "notebook.google",
        "notebooklm.google",
        "cloud.google",
        "deepmind.google",
        "deepmind.com",
        "withgoogle.com",
        "gstatic.com",
        "googleusercontent.com",
        "gvt1.com",
        "gvt2.com",
        "ggpht.com",
        "goog",
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
        "deepl.com",
        "linguee.com",
        "perplexity.ai",
        "groq.com",
        "openrouter.ai",
        "huggingface.co",
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

fn generate_pac_script(proxy_host: &str, proxy_port: u16, protocol: UpstreamProtocol, hosts: &[String]) -> String {
    let trimmed_host = proxy_host.trim();
    let proxy = if trimmed_host.is_empty() {
        "DIRECT".to_string()
    } else {
        match protocol {
            UpstreamProtocol::Http => format!("PROXY {}:{}", trimmed_host, proxy_port),
            UpstreamProtocol::Https => format!("HTTPS {}:{}; PROXY {}:{}", trimmed_host, proxy_port, trimmed_host, proxy_port),
            UpstreamProtocol::Socks5 => format!("SOCKS5 {}:{}; SOCKS {}:{}", trimmed_host, proxy_port, trimmed_host, proxy_port),
        }
    };
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

    let match_block = if PROXY_MODE.load(Ordering::Relaxed) == 1 {
        "  // Global Mode: all external traffic routed through proxy\n  return proxy;".to_string()
    } else if conditions.is_empty() {
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
    let default_pac = generate_pac_script("", 3128, UpstreamProtocol::Http, &default_domains);
    if let Ok(mut lock) = PAC_CONTENT.write() {
        *lock = Some(Arc::new(default_pac));
    }
    if let Ok(mut lock) = ROUTED_DOMAINS.write() {
        *lock = default_domains.clone();
    }
    if let Ok(mut lock) = UPSTREAM_PROXY.write() {
        *lock = ("".to_string(), 3128, UpstreamProtocol::Http, true);
    }

    thread::spawn(move || {
        let listener = match TcpListener::bind("127.0.0.1:8182") {
            Ok(l) => {
                println!("[embedded-pac] Native PAC server listening on http://127.0.0.1:8182/proxy.pac");
                l
            }
            Err(e) => {
                #[cfg(debug_assertions)]
                {
                    match TcpListener::bind("127.0.0.1:18182") {
                        Ok(l) => {
                            println!("[embedded-pac] Dev PAC server listening on http://127.0.0.1:18182/proxy.pac");
                            l
                        }
                        Err(_) => {
                            println!("[embedded-pac] Port 8182 in use by primary running instance; using primary PAC service ({})", e);
                            return;
                        }
                    }
                }
                #[cfg(not(debug_assertions))]
                {
                    eprintln!("[embedded-pac] Could not bind to 127.0.0.1:8182: {}", e);
                    return;
                }
            }
        };

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

/// Performs client-side SOCKS5 handshake (RFC 1928) with the upstream proxy
fn socks5_handshake(stream: &mut TcpStream, target: &str) -> std::io::Result<()> {
    // 1. SOCKS5 Greeting: VER=5, NMETHODS=1, METHOD=0 (No Auth)
    stream.write_all(&[0x05, 0x01, 0x00])?;
    let mut resp = [0u8; 2];
    stream.read_exact(&mut resp)?;
    if resp[0] != 0x05 || resp[1] != 0x00 {
        return Err(std::io::Error::new(std::io::ErrorKind::Other, "SOCKS5 authentication failed"));
    }

    // 2. Parse host and port
    let (host, port) = if let Some(idx) = target.rfind(':') {
        let h = &target[..idx];
        let p = target[idx + 1..].parse::<u16>().unwrap_or(80);
        (h, p)
    } else {
        (target, 80)
    };

    // 3. SOCKS5 CONNECT command: VER=5, CMD=1, RSV=0
    let mut req = Vec::with_capacity(7 + host.len());
    req.extend_from_slice(&[0x05, 0x01, 0x00]);

    if let Ok(ip) = host.parse::<Ipv4Addr>() {
        req.push(0x01); // ATYP=1 (IPv4)
        req.extend_from_slice(&ip.octets());
    } else if let Ok(ip6) = host.parse::<std::net::Ipv6Addr>() {
        req.push(0x04); // ATYP=4 (IPv6)
        req.extend_from_slice(&ip6.octets());
    } else {
        req.push(0x03); // ATYP=3 (Domain)
        let host_bytes = host.as_bytes();
        if host_bytes.len() > 255 {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "Domain too long for SOCKS5"));
        }
        req.push(host_bytes.len() as u8);
        req.extend_from_slice(host_bytes);
    }
    req.extend_from_slice(&port.to_be_bytes());
    stream.write_all(&req)?;

    // 4. SOCKS5 Response: [VER, REP, RSV, ATYP, BND.ADDR, BND.PORT]
    let mut header = [0u8; 4];
    stream.read_exact(&mut header)?;
    if header[0] != 0x05 || header[1] != 0x00 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("SOCKS5 connect failed with status code {}", header[1]),
        ));
    }

    match header[3] {
        0x01 => {
            let mut buf = [0u8; 6];
            stream.read_exact(&mut buf)?;
        }
        0x03 => {
            let mut len_buf = [0u8; 1];
            stream.read_exact(&mut len_buf)?;
            let mut domain_buf = vec![0u8; len_buf[0] as usize + 2];
            stream.read_exact(&mut domain_buf)?;
        }
        0x04 => {
            let mut buf = [0u8; 18];
            stream.read_exact(&mut buf)?;
        }
        other => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("Unsupported SOCKS5 address type: {}", other),
            ));
        }
    }

    Ok(())
}

/// Asynchronously forwards traffic to upstream via TLS-encrypted HTTPS CONNECT tunnel
fn forward_https_upstream(
    mut client: TcpStream,
    client_leftover: Vec<u8>,
    target: String,
    upstream_host: String,
    upstream_port: u16,
    ignore_tls_err: bool,
) {
    tauri::async_runtime::spawn(async move {
        
        let upstream_addr_str = format!("{}:{}", upstream_host, upstream_port);
        let upstream_tcp = match tokio::net::TcpStream::connect(&upstream_addr_str).await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[local-forwarder] HTTPS upstream TCP connection failed: {}", e);
                let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n");
                return;
            }
        };

        let mut builder = native_tls::TlsConnector::builder();
        if ignore_tls_err {
            builder.danger_accept_invalid_certs(true);
            builder.danger_accept_invalid_hostnames(true);
        }
        let connector = match builder.build() {
            Ok(c) => tokio_native_tls::TlsConnector::from(c),
            Err(e) => {
                eprintln!("[local-forwarder] TLS builder failed: {}", e);
                let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n");
                return;
            }
        };

        let mut tls_stream = match connector.connect(&upstream_host, upstream_tcp).await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[local-forwarder] TLS handshake with upstream failed: {}", e);
                let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n");
                return;
            }
        };

        let connect_req = format!(
            "CONNECT {} HTTP/1.1\r\nHost: {}\r\nProxy-Connection: Keep-Alive\r\n\r\n",
            target, target
        );
        if let Err(e) = tls_stream.write_all(connect_req.as_bytes()).await {
            eprintln!("[local-forwarder] Writing CONNECT to HTTPS upstream failed: {}", e);
            let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n");
            return;
        }

        // Read until end of HTTP response headers
        let mut resp_buf = Vec::new();
        let mut byte_buf = [0u8; 1];
        let mut found_header_end = false;
        while resp_buf.len() < 4096 {
            match tls_stream.read(&mut byte_buf).await {
                Ok(1) => {
                    resp_buf.push(byte_buf[0]);
                    if resp_buf.ends_with(b"\r\n\r\n") || resp_buf.ends_with(b"\n\n") {
                        found_header_end = true;
                        break;
                    }
                }
                _ => break,
            }
        }

        let resp_str = String::from_utf8_lossy(&resp_buf);
        if !found_header_end || !resp_str.contains("200") {
            eprintln!("[local-forwarder] HTTPS upstream non-200 response: {}", resp_str.lines().next().unwrap_or(""));
            let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n");
            return;
        }

        let _ = client.set_nonblocking(true);
        let mut async_client = match tokio::net::TcpStream::from_std(client) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[local-forwarder] Async client conversion error: {}", e);
                return;
            }
        };

        if let Err(_) = async_client.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n").await {
            return;
        }

        if !client_leftover.is_empty() {
            if let Err(_) = tls_stream.write_all(&client_leftover).await {
                return;
            }
        }

        record_session(&target, true, client_leftover.len() as u64);
        ACTIVE_CONNECTIONS.fetch_add(1, Ordering::Relaxed);
        let res = tokio::io::copy_bidirectional(&mut async_client, &mut tls_stream).await;
        ACTIVE_CONNECTIONS.fetch_sub(1, Ordering::Relaxed);
        if let Ok((tx, rx)) = res {
            TOTAL_TX_BYTES.fetch_add(tx, Ordering::Relaxed);
            TOTAL_RX_BYTES.fetch_add(rx, Ordering::Relaxed);
            update_session_bytes(&target, tx + rx);
        }
    });
}

/// Starts embedded local HTTP CONNECT proxy forwarder on 127.0.0.1:8183
pub fn start_local_proxy_forwarder() {
    thread::spawn(|| {
        let mut listener = None;
        for attempt in 0..10 {
            match TcpListener::bind("127.0.0.1:8183") {
                Ok(l) => {
                    println!("[local-forwarder] Native Proxy Forwarder listening on http://127.0.0.1:8183");
                    listener = Some(l);
                    break;
                }
                Err(e) => {
                    println!("[local-forwarder] Bind attempt {} on 127.0.0.1:8183: {}; retrying in 300ms...", attempt + 1, e);
                    thread::sleep(Duration::from_millis(300));
                }
            }
        }

        let listener = match listener {
            Some(l) => l,
            None => {
                eprintln!("[local-forwarder] CRITICAL: Failed to bind 127.0.0.1:8183 after 10 attempts!");
                return;
            }
        };

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
    let (upstream_host, upstream_port, upstream_proto, ignore_tls_err) = {
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

        let client_leftover = reader.buffer().to_vec();

        // 1. If upstream is HTTPS (TLS), forward via async TLS tunnel
        if should_proxy && upstream_proto == UpstreamProtocol::Https {
            if upstream_host.is_empty() {
                let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n");
                return Ok(());
            }
            let client_clone = client.try_clone()?;
            forward_https_upstream(
                client_clone,
                client_leftover,
                target.to_string(),
                upstream_host,
                upstream_port,
                ignore_tls_err,
            );
            return Ok(());
        }

        // 2. HTTP or SOCKS5 upstream (or Direct)
        let target_stream = if should_proxy {
            if upstream_host.is_empty() {
                let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n");
                return Ok(());
            }

            // Route via upstream proxy on VPS
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

            if upstream_proto == UpstreamProtocol::Socks5 {
                if let Err(e) = socks5_handshake(&mut upstream, target) {
                    eprintln!("[local-forwarder] SOCKS5 handshake to upstream failed: {}", e);
                    let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n");
                    return Ok(());
                }
            } else {
                let connect_req = format!("CONNECT {} HTTP/1.1\r\nHost: {}\r\nProxy-Connection: Keep-Alive\r\n\r\n", target, target);
                if let Err(e) = upstream.write_all(connect_req.as_bytes()) {
                    eprintln!("[local-forwarder] Failed writing CONNECT to upstream: {}", e);
                    let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n");
                    return Ok(());
                }

                // Read until \r\n\r\n byte-by-byte so no TLS bytes from target are buffered away
                let mut resp_header = Vec::new();
                let mut byte = [0u8; 1];
                while resp_header.len() < 4096 {
                    if upstream.read_exact(&mut byte).is_err() {
                        break;
                    }
                    resp_header.push(byte[0]);
                    if resp_header.ends_with(b"\r\n\r\n") || resp_header.ends_with(b"\n\n") {
                        break;
                    }
                }
                let resp_str = String::from_utf8_lossy(&resp_header);
                if !resp_str.contains("200") {
                    eprintln!("[local-forwarder] Upstream proxy returned non-200: {}", resp_str.lines().next().unwrap_or(""));
                    let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n");
                    return Ok(());
                }
            }

            upstream
        } else {
            // Master proxy is disabled or host is unrouted: connect DIRECTLY via fast IPv4-first resolution
            let addrs = resolve_target_addresses(target);
            let mut direct_stream = None;
            for addr in addrs {
                if let Ok(s) = TcpStream::connect_timeout(&addr, Duration::from_secs(6)) {
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
        if !client_leftover.is_empty() {
            let mut target_clone = target_stream.try_clone()?;
            let _ = target_clone.write_all(&client_leftover);
        }

        record_session(target, should_proxy, client_leftover.len() as u64);
        ACTIVE_CONNECTIONS.fetch_add(1, Ordering::Relaxed);

        let mut client_read = client.try_clone()?;
        let mut client_write = client.try_clone()?;
        let mut target_read = target_stream.try_clone()?;
        let mut target_write = target_stream;

        let host_t1 = target.to_string();
        let t1 = thread::spawn(move || {
            let tx = std::io::copy(&mut client_read, &mut target_write).unwrap_or(0);
            let _ = target_write.shutdown(std::net::Shutdown::Write);
            TOTAL_TX_BYTES.fetch_add(tx, Ordering::Relaxed);
            update_session_bytes(&host_t1, tx);
            tx
        });

        let rx = std::io::copy(&mut target_read, &mut client_write).unwrap_or(0);
        let _ = client_write.shutdown(std::net::Shutdown::Write);
        TOTAL_RX_BYTES.fetch_add(rx, Ordering::Relaxed);
        update_session_bytes(target, rx);
        let _ = t1.join();
        ACTIVE_CONNECTIONS.fetch_sub(1, Ordering::Relaxed);
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
            let mut upstream = match upstream {
                Some(s) => s,
                None => {
                    let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n");
                    return Ok(());
                }
            };
            if upstream_proto == UpstreamProtocol::Socks5 {
                let host_part = target.trim_start_matches("http://").split('/').next().unwrap_or(target);
                let addr_str = if host_part.contains(':') {
                    host_part.to_string()
                } else {
                    format!("{}:80", host_part)
                };
                if let Err(e) = socks5_handshake(&mut upstream, &addr_str) {
                    eprintln!("[local-forwarder] SOCKS5 plain HTTP handshake failed: {}", e);
                    let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n");
                    return Ok(());
                }
            }
            upstream
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
                if let Ok(s) = TcpStream::connect_timeout(&a, Duration::from_secs(6)) {
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

        let formatted_request_line = if should_proxy && upstream_proto != UpstreamProtocol::Socks5 {
            request_line.clone()
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

        record_session(target, should_proxy, client_leftover.len() as u64);
        ACTIVE_CONNECTIONS.fetch_add(1, Ordering::Relaxed);

        let mut client_read = client.try_clone()?;
        let mut client_write = client.try_clone()?;
        let mut target_read = target_stream.try_clone()?;
        let mut target_write = target_stream;

        let host_t1 = target.to_string();
        let t1 = thread::spawn(move || {
            let tx = std::io::copy(&mut client_read, &mut target_write).unwrap_or(0);
            let _ = target_write.shutdown(std::net::Shutdown::Write);
            TOTAL_TX_BYTES.fetch_add(tx, Ordering::Relaxed);
            update_session_bytes(&host_t1, tx);
            tx
        });

        let rx = std::io::copy(&mut target_read, &mut client_write).unwrap_or(0);
        let _ = client_write.shutdown(std::net::Shutdown::Write);
        TOTAL_RX_BYTES.fetch_add(rx, Ordering::Relaxed);
        update_session_bytes(target, rx);
        let _ = t1.join();
        ACTIVE_CONNECTIONS.fetch_sub(1, Ordering::Relaxed);
    }

    Ok(())
}

fn resolve_effective_proxy_target(host: &str, port: u16) -> (String, u16) {
    let trimmed = host.trim();
    let eff_host = if trimmed.is_empty() || trimmed.contains("your-server-ip") {
        "".to_string()
    } else {
        trimmed.to_string()
    };
    let eff_port = if port == 0 { 3128 } else { port };
    (eff_host, eff_port)
}

/// Updates upstream proxy target in memory
#[command]
pub fn update_upstream_proxy(
    proxy_host: String,
    proxy_port: u16,
    proxy_protocol: Option<String>,
    ignore_tls: Option<bool>,
) -> Result<String, String> {
    let (eff_host, eff_port) = resolve_effective_proxy_target(&proxy_host, proxy_port);
    let proto = UpstreamProtocol::from_str_opt(proxy_protocol.as_deref());
    let ignore_tls_err = ignore_tls.unwrap_or(true);
    if let Ok(mut lock) = UPSTREAM_PROXY.write() {
        *lock = (eff_host.clone(), eff_port, proto, ignore_tls_err);
        Ok(format!("Upstream proxy set to {:?}://{}:{}", proto, eff_host, eff_port))
    } else {
        Err("Failed to acquire write lock for UPSTREAM_PROXY".to_string())
    }
}

/// Tests upstream proxy connectivity, handshake and round-trip latency
#[command]
pub async fn test_upstream_proxy(
    proxy_host: String,
    proxy_port: u16,
    proxy_protocol: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (eff_host, eff_port) = resolve_effective_proxy_target(&proxy_host, proxy_port);
        let proto = UpstreamProtocol::from_str_opt(proxy_protocol.as_deref());
        let target_addr = format!("{}:{}", eff_host, eff_port);

        let start = std::time::Instant::now();
        let addrs = resolve_target_addresses(&target_addr);
        if addrs.is_empty() {
            return Ok(serde_json::json!({
                "ok": false,
                "error": format!("Could not resolve host: {}", eff_host)
            }));
        }

        let mut stream = None;
        for addr in &addrs {
            if let Ok(s) = TcpStream::connect_timeout(addr, Duration::from_millis(4000)) {
                stream = Some(s);
                break;
            }
        }

        let mut stream = match stream {
            Some(s) => s,
            None => {
                return Ok(serde_json::json!({
                    "ok": false,
                    "error": format!("Connection to {}:{} timed out (port unreachable or filtered)", eff_host, eff_port)
                }));
            }
        };

        let _ = stream.set_read_timeout(Some(Duration::from_millis(4000)));
        let _ = stream.set_write_timeout(Some(Duration::from_millis(4000)));

        match proto {
            UpstreamProtocol::Http => {
                let req = "CONNECT gemini.google.com:443 HTTP/1.1\r\nHost: gemini.google.com:443\r\n\r\n";
                if let Err(e) = stream.write_all(req.as_bytes()) {
                    return Ok(serde_json::json!({ "ok": false, "error": format!("Failed writing HTTP CONNECT: {}", e) }));
                }
                let mut reader = BufReader::new(stream);
                let mut line = String::new();
                if let Err(e) = reader.read_line(&mut line) {
                    return Ok(serde_json::json!({ "ok": false, "error": format!("Failed reading proxy response: {}", e) }));
                }
                if !line.contains("200") {
                    return Ok(serde_json::json!({ "ok": false, "error": format!("Proxy returned: {}", line.trim()) }));
                }
            }
            UpstreamProtocol::Socks5 => {
                if let Err(e) = socks5_handshake(&mut stream, "gemini.google.com:443") {
                    return Ok(serde_json::json!({ "ok": false, "error": format!("SOCKS5 handshake failed: {}", e) }));
                }
            }
            UpstreamProtocol::Https => {
                let mut builder = native_tls::TlsConnector::builder();
                builder.danger_accept_invalid_certs(true);
                builder.danger_accept_invalid_hostnames(true);
                let connector = match builder.build() {
                    Ok(c) => c,
                    Err(e) => return Ok(serde_json::json!({ "ok": false, "error": format!("TLS builder error: {}", e) })),
                };
                let mut tls_stream = match connector.connect(&eff_host, stream) {
                    Ok(s) => s,
                    Err(e) => return Ok(serde_json::json!({ "ok": false, "error": format!("TLS handshake failed: {}", e) })),
                };
                let req = "CONNECT gemini.google.com:443 HTTP/1.1\r\nHost: gemini.google.com:443\r\n\r\n";
                if let Err(e) = tls_stream.write_all(req.as_bytes()) {
                    return Ok(serde_json::json!({ "ok": false, "error": format!("Writing CONNECT over TLS failed: {}", e) }));
                }
            }
        }

        let elapsed = start.elapsed().as_millis() as u64;
        Ok(serde_json::json!({
            "ok": true,
            "latency_ms": elapsed,
            "protocol": format!("{:?}", proto).to_lowercase(),
            "target": format!("{}:{}", eff_host, eff_port)
        }))
    })
    .await
    .map_err(|e| format!("Task execution error: {}", e))?
}

/// Updates PAC rules in memory from the Tauri UI
#[command]
pub fn update_pac_rules(
    proxy_host: String,
    proxy_port: u16,
    hosts: Vec<String>,
    proxy_protocol: Option<String>,
    ignore_tls: Option<bool>,
) -> Result<String, String> {
    let (eff_host, eff_port) = resolve_effective_proxy_target(&proxy_host, proxy_port);
    let proto = UpstreamProtocol::from_str_opt(proxy_protocol.as_deref());
    let ignore_tls_err = ignore_tls.unwrap_or(true);
    if let Ok(mut lock) = UPSTREAM_PROXY.write() {
        *lock = (eff_host.clone(), eff_port, proto, ignore_tls_err);
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
    let script = generate_pac_script(&eff_host, eff_port, proto, &hosts);
    if let Ok(mut lock) = PAC_CONTENT.write() {
        *lock = Some(Arc::new(script));
        Ok("PAC rules updated".to_string())
    } else {
        Err("Failed to acquire write lock".to_string())
    }
}

#[command]
pub fn set_proxy_mode(mode: String) -> Result<String, String> {
    let mode_val = if mode.eq_ignore_ascii_case("global") { 1 } else { 0 };
    PROXY_MODE.store(mode_val, Ordering::SeqCst);
    let (host, port, proto) = {
        let lock = UPSTREAM_PROXY.read().unwrap();
        (lock.0.clone(), lock.1, lock.2)
    };
    let hosts = {
        let lock = ROUTED_DOMAINS.read().unwrap();
        lock.clone()
    };
    let pac = generate_pac_script(&host, port, proto, &hosts);
    if let Ok(mut lock) = PAC_CONTENT.write() {
        *lock = Some(Arc::new(pac));
    }
    Ok(if mode_val == 1 { "global".to_string() } else { "split".to_string() })
}

#[command]
pub fn get_proxy_mode() -> Result<String, String> {
    let val = PROXY_MODE.load(Ordering::SeqCst);
    Ok(if val == 1 { "global".to_string() } else { "split".to_string() })
}

#[command]
pub fn get_traffic_stats() -> Result<serde_json::Value, String> {
    let rx = TOTAL_RX_BYTES.load(Ordering::Relaxed);
    let tx = TOTAL_TX_BYTES.load(Ordering::Relaxed);
    let active = ACTIVE_CONNECTIONS.load(Ordering::Relaxed);

    let sessions = if let Ok(lock) = RECENT_SESSIONS.lock() {
        lock.as_ref().map(|d| d.iter().cloned().collect::<Vec<_>>()).unwrap_or_default()
    } else {
        Vec::new()
    };

    Ok(serde_json::json!({
        "total_rx_bytes": rx,
        "total_tx_bytes": tx,
        "active_connections": active,
        "recent_sessions": sessions,
    }))
}

#[derive(Serialize)]
pub struct ServiceHealth {
    pub id: String,
    pub name: String,
    pub host: String,
    pub ok: bool,
    pub latency_ms: u64,
    pub error: Option<String>,
}

#[command]
pub async fn check_service_health(host: String, port: Option<u16>) -> Result<ServiceHealth, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = port.unwrap_or(443);
        let start = Instant::now();
        let forwarder_addr = "127.0.0.1:8183";
        let mut ok = false;
        let mut err_msg = None;

        if let Ok(mut stream) = TcpStream::connect_timeout(
            &forwarder_addr.parse().unwrap(),
            Duration::from_millis(4500),
        ) {
            let _ = stream.set_read_timeout(Some(Duration::from_millis(4500)));
            let _ = stream.set_write_timeout(Some(Duration::from_millis(4500)));
            let req = format!("CONNECT {}:{} HTTP/1.1\r\nHost: {}:{}\r\n\r\n", host, p, host, p);
            if stream.write_all(req.as_bytes()).is_ok() {
                let mut resp = [0u8; 128];
                if let Ok(n) = stream.read(&mut resp) {
                    let resp_str = String::from_utf8_lossy(&resp[..n]);
                    if resp_str.starts_with("HTTP/1.1 200") || resp_str.starts_with("HTTP/1.0 200") {
                        ok = true;
                    } else {
                        err_msg = Some(resp_str.lines().next().unwrap_or("Non-200 response").to_string());
                    }
                } else {
                    err_msg = Some("Timeout".to_string());
                }
            } else {
                err_msg = Some("Write failed".to_string());
            }
        } else {
            err_msg = Some("Forwarder unreachable".to_string());
        }

        let elapsed = start.elapsed().as_millis() as u64;
        Ok(ServiceHealth {
            id: host.clone(),
            name: host.clone(),
            host,
            ok,
            latency_ms: if ok { elapsed } else { 0 },
            error: err_msg,
        })
    })
    .await
    .map_err(|e| format!("Task execution error: {}", e))?
}

#[command]
pub async fn check_services_health() -> Result<Vec<ServiceHealth>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let targets = vec![
            ("openai", "OpenAI API", "api.openai.com", 443),
            ("anthropic", "Anthropic Claude", "api.anthropic.com", 443),
            ("gemini", "Google Gemini", "generativelanguage.googleapis.com", 443),
            ("copilot", "GitHub Copilot", "api.github.com", 443),
            ("discord", "Discord Gateway", "gateway.discord.gg", 443),
            ("perplexity", "Perplexity AI", "www.perplexity.ai", 443),
        ];

        let handles: Vec<_> = targets.into_iter().map(|(id, name, host, port)| {
            thread::spawn(move || {
                let start = Instant::now();
                let forwarder_addr = "127.0.0.1:8183";
                let mut ok = false;
                let mut err_msg = None;

                if let Ok(mut stream) = TcpStream::connect_timeout(
                    &forwarder_addr.parse().unwrap(),
                    Duration::from_millis(3500),
                ) {
                    let _ = stream.set_read_timeout(Some(Duration::from_millis(3500)));
                    let _ = stream.set_write_timeout(Some(Duration::from_millis(3500)));
                    let req = format!("CONNECT {}:{} HTTP/1.1\r\nHost: {}:{}\r\n\r\n", host, port, host, port);
                    if stream.write_all(req.as_bytes()).is_ok() {
                        let mut resp = [0u8; 128];
                        if let Ok(n) = stream.read(&mut resp) {
                            let resp_str = String::from_utf8_lossy(&resp[..n]);
                            if resp_str.starts_with("HTTP/1.1 200") || resp_str.starts_with("HTTP/1.0 200") {
                                ok = true;
                            } else {
                                err_msg = Some(resp_str.lines().next().unwrap_or("Non-200 response").to_string());
                            }
                        } else {
                            err_msg = Some("Read timeout".to_string());
                        }
                    } else {
                        err_msg = Some("Write failed".to_string());
                    }
                } else {
                    err_msg = Some("Cannot reach forwarder".to_string());
                }

                let elapsed = start.elapsed().as_millis() as u64;
                ServiceHealth {
                    id: id.to_string(),
                    name: name.to_string(),
                    host: host.to_string(),
                    ok,
                    latency_ms: if ok { elapsed } else { 0 },
                    error: err_msg,
                }
            })
        }).collect();

        let mut results = Vec::new();
        for h in handles {
            if let Ok(res) = h.join() {
                results.push(res);
            }
        }
        Ok(results)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Sets the system proxy to local forwarder on 127.0.0.1:8183 and optionally sets HTTP_PROXY / HTTPS_PROXY
#[command]
pub async fn set_system_proxy(
    #[allow(unused_variables)]
    pac_url: Option<String>,
    #[allow(unused_variables)]
    #[allow(non_snake_case)]
    pacUrl: Option<String>,
    set_env: Option<bool>,
    #[allow(non_snake_case)]
    setEnv: Option<bool>,
) -> Result<String, String> {
    let should_set_env = set_env.or(setEnv).unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        PROXY_ACTIVE.store(true, std::sync::atomic::Ordering::SeqCst);
        apply_windows_system_proxy(true)?;
        if should_set_env {
            let _ = set_terminal_env_proxy_internal(Some("http://127.0.0.1:8183".to_string()), true);
        } else {
            let _ = set_terminal_env_proxy_internal(None, false);
        }
        Ok("System proxy set to 127.0.0.1:8183".to_string())
    })
    .await
    .map_err(|e| format!("Task execution error: {}", e))?
}

/// Synchronous internal version of clear_system_proxy
pub fn clear_system_proxy_sync() -> Result<String, String> {
    PROXY_ACTIVE.store(false, std::sync::atomic::Ordering::SeqCst);
    win32_proxy::clear_system_proxy_native();
    if let Ok(mut lock) = PAC_CONTENT.write() {
        *lock = Some(Arc::new(
            "// Proxy Disabled\nfunction FindProxyForURL(url, host) {\n  return 'DIRECT';\n}\n".to_string()
        ));
    }
    // Clear DNS memory cache and flush Windows DNS cache
    if let Ok(mut cache) = DNS_CACHE.write() {
        *cache = None;
    }
    Ok("System proxy cleared and environment variables removed".to_string())
}

/// Clears all system proxy settings, removes HTTP_PROXY env vars, flushes DNS cache.
#[command]
pub async fn clear_system_proxy() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        clear_system_proxy_sync()
    })
    .await
    .map_err(|e| format!("Task execution error: {}", e))?
}

/// Returns the current Windows proxy settings from the registry.
#[command]
pub fn get_proxy_status() -> Result<serde_json::Value, String> {
    let pac_url     = reg_get("AutoConfigURL").unwrap_or_default();
    let proxy_en    = reg_get("ProxyEnable").unwrap_or_default();
    let proxy_srv   = reg_get("ProxyServer").unwrap_or_default();
    let http_proxy  = reg_get_key(r"HKCU\Environment", "HTTP_PROXY").unwrap_or_default();
    let https_proxy = reg_get_key(r"HKCU\Environment", "HTTPS_PROXY").unwrap_or_default();

    Ok(serde_json::json!({
        "pac_url":      pac_url,
        "proxy_enable": proxy_en,
        "proxy_server": proxy_srv,
        "http_proxy":   http_proxy,
        "https_proxy":  https_proxy,
    }))
}

fn is_valid_ipv4(ip: &str) -> bool {
    let parts: Vec<&str> = ip.trim().split('.').collect();
    if parts.len() != 4 {
        return false;
    }
    parts.iter().all(|p| p.parse::<u8>().is_ok())
}

/// Direct plain-HTTP socket fetch for public IP (takes ~60-120ms, no child process, no TLS)
fn fetch_raw_http_ip(host: &str, path: &str) -> Option<String> {
    let target = format!("{}:80", host);
    let addrs: Vec<SocketAddr> = target.to_socket_addrs().ok()?.collect();
    let addr = addrs.into_iter().find(|a| a.is_ipv4())?;

    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(800)).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1000)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(800)));

    let req = format!("GET {} HTTP/1.1\r\nHost: {}\r\nUser-Agent: curl/8.0\r\nConnection: close\r\n\r\n", path, host);
    stream.write_all(req.as_bytes()).ok()?;

    let mut reader = BufReader::new(stream);
    let mut header = true;
    let mut body = String::new();
    let mut line = String::new();
    while reader.read_line(&mut line).unwrap_or(0) > 0 {
        if header {
            if line == "\r\n" || line == "\n" {
                header = false;
            }
        } else {
            body.push_str(&line);
        }
        line.clear();
    }

    let trimmed = body.trim();
    if is_valid_ipv4(trimmed) {
        Some(trimmed.to_string())
    } else {
        None
    }
}

/// Robust, non-blocking multi-endpoint WAN IPv4 discovery
#[command]
pub async fn get_public_ip() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        // 1. Fast direct HTTP on port 80 (completes in ~60-150ms, bypasses TLS and proxy)
        let endpoints = [
            ("api4.ipify.org", "/"),
            ("checkip.amazonaws.com", "/"),
            ("ipv4.icanhazip.com", "/"),
            ("ifconfig.me", "/ip"),
        ];

        for (host, path) in endpoints {
            if let Some(ip) = fetch_raw_http_ip(host, path) {
                return Ok(ip);
            }
        }

        // 2. Fallback to curl with short timeout
        let curl_targets = [
            "http://api4.ipify.org",
            "http://checkip.amazonaws.com",
            "https://ipv4.icanhazip.com",
        ];

        let curl_bin = if cfg!(windows) { "curl.exe" } else { "curl" };
        for url in curl_targets {
            let mut cmd = hidden_command(curl_bin);
            cmd.args(["--silent", "--connect-timeout", "1", "--max-time", "2", "--noproxy", "*", url]);
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
    })
    .await
    .map_err(|e| format!("Task execution error: {}", e))?
}

/// Native HTTP bridge for Whitelist API requests — bypasses WebView CORS completely.
#[command]
pub async fn api_whitelist_request(
    url: String,
    method: Option<String>,
    token: Option<String>,
    ip: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target_url = url.trim();
        if target_url.is_empty() || target_url.starts_with('/') || target_url.contains("your-server-ip") {
            return Err("API URL is not configured. Please specify your server address in Settings (e.g. http://YOUR_SERVER_IP:1135)".to_string());
        }

        let curl_bin = if cfg!(windows) { "curl.exe" } else { "curl" };
        let mut cmd = hidden_command(curl_bin);
        cmd.env_remove("HTTP_PROXY")
           .env_remove("HTTPS_PROXY")
           .env_remove("ALL_PROXY")
           .env_remove("http_proxy")
           .env_remove("https_proxy")
           .env_remove("all_proxy");
        cmd.args([
            "--silent",
            "--show-error",
            "--connect-timeout", "6",
            "--max-time", "10",
            "--noproxy", "*",
        ]);

        let m = method.unwrap_or_else(|| "GET".to_string()).to_uppercase();
        cmd.args(["-X", &m]);

        if let Some(tok) = token {
            let clean = tok.trim().trim_start_matches("Bearer ").trim();
            if !clean.is_empty() {
                cmd.args(["-H", &format!("Authorization: Bearer {}", clean)]);
            }
        }

        if let Some(target_ip) = ip {
            if m == "POST" || m == "DELETE" {
                cmd.args(["-H", "Content-Type: application/json"]);
                let body = format!("{{\"ip\":\"{}\"}}", target_ip.trim());
                cmd.args(["--data-raw", &body]);
            }
        }

        cmd.arg(target_url);

        let out = cmd.output().map_err(|e| format!("Failed to execute curl: {}", e))?;
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();

        if stdout.is_empty() {
            if out.status.success() {
                return Ok(serde_json::json!({ "ok": true }));
            }
            return Err(if !stderr.is_empty() {
                format!("Connection error: {}", stderr)
            } else {
                format!("Server returned empty response (exit code {})", out.status.code().unwrap_or(-1))
            });
        }

        match serde_json::from_str::<serde_json::Value>(&stdout) {
            Ok(json) => Ok(json),
            Err(_) => {
                if !out.status.success() {
                    Err(format!("Request failed: {}", if !stderr.is_empty() { &stderr } else { &stdout }))
                } else {
                    Err(format!("Server returned invalid JSON response: {}", stdout))
                }
            }
        }
    })
    .await
    .map_err(|e| format!("Task execution error: {}", e))?
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
pub async fn pick_exe_file() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
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
    })
    .await
    .map_err(|e| format!("Task execution error: {}", e))?
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ProcessStatus {
    pub query: String,
    pub is_running: bool,
    pub process_name: String,
}

/// Checks whether specified executables are currently running in Windows
#[command]
pub async fn check_running_processes(names: Vec<String>) -> Result<Vec<ProcessStatus>, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|e| format!("Task execution error: {}", e))?
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
        || lower_path.contains("chromium")
        || lower_path.contains("antigravity")
        || lower_path.contains("agy")
        || lower_path.contains("windsurf")
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

pub fn set_terminal_env_proxy_internal(proxy_url: Option<String>, enabled: bool) -> Result<String, String> {
    win32_proxy::set_terminal_env_proxy_native(proxy_url.as_deref(), enabled)?;
    if enabled {
        let eff_url = proxy_url
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "http://127.0.0.1:8183".to_string());
        Ok(format!("Terminal proxy variables set to {}", eff_url))
    } else {
        Ok("Terminal proxy variables removed".to_string())
    }
}

/// Toggles terminal & CLI developer tools proxy in User Environment
#[command]
pub async fn set_terminal_env_proxy(proxy_url: Option<String>, enabled: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        set_terminal_env_proxy_internal(proxy_url, enabled)
    })
    .await
    .map_err(|e| format!("Task execution error: {}", e))?
}

// ── DNS Management & Network Adapter Commands ─────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct NetworkAdapterInfo {
    pub name: String,
    pub index: u32,
    pub description: String,
    pub status: String,
    pub ipv4_dns: Vec<String>,
    pub ipv6_dns: Vec<String>,
    pub is_dhcp: bool,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct DnsLatencyResult {
    pub server: String,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

/// Retrieves list of all active network adapters on Windows
#[command]
pub async fn get_network_adapters() -> Result<Vec<NetworkAdapterInfo>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let script = r#"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object {
    $idx = [int]$_.InterfaceIndex
    $name = [string]$_.Name
    $desc = [string]$_.InterfaceDescription
    $status = [string]$_.Status
    $rawDns4 = (Get-DnsClientServerAddress -InterfaceIndex $idx -AddressFamily IPv4 -ErrorAction SilentlyContinue).ServerAddresses
    $dns4 = @()
    if ($rawDns4) {
        $dns4 = @($rawDns4 | Where-Object { $_ -ne $null -and $_.Trim() -ne '' })
    }
    $rawDns6 = (Get-DnsClientServerAddress -InterfaceIndex $idx -AddressFamily IPv6 -ErrorAction SilentlyContinue).ServerAddresses
    $dns6 = @()
    if ($rawDns6) {
        $dns6 = @($rawDns6 | Where-Object { $_ -ne $null -and $_.Trim() -ne '' })
    }
    $dhcp4 = (Get-NetIPInterface -InterfaceIndex $idx -AddressFamily IPv4 -ErrorAction SilentlyContinue).Dhcp
    $isDhcp = ($dhcp4 -eq 'Enabled')
    [PSCustomObject]@{
        name = $name
        index = $idx
        description = $desc
        status = $status
        ipv4_dns = $dns4
        ipv6_dns = $dns6
        is_dhcp = $isDhcp
    }
} | ConvertTo-Json -Compress
"#;
        let output = hidden_command("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .output()
            .map_err(|e| format!("Failed to query network adapters: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if stdout.is_empty() {
            return Ok(Vec::new());
        }

        let parsed_val: serde_json::Value = match serde_json::from_str(&stdout) {
            Ok(v) => v,
            Err(_) => return Ok(Vec::new()),
        };

        let items = if let Some(arr) = parsed_val.as_array() {
            arr.clone()
        } else if parsed_val.is_object() {
            vec![parsed_val]
        } else {
            return Ok(Vec::new());
        };

        let mut adapters = Vec::new();
        for item in items {
            let name = item["name"].as_str().unwrap_or("Network Adapter").to_string();
            let index = item["index"].as_u64().unwrap_or(0) as u32;
            let description = item["description"].as_str().unwrap_or("").to_string();
            let status = item["status"].as_str().unwrap_or("Up").to_string();
            let is_dhcp = item["is_dhcp"].as_bool().unwrap_or(true);

            let mut ipv4_dns = Vec::new();
            if let Some(arr) = item["ipv4_dns"].as_array() {
                for v in arr {
                    if let Some(s) = v.as_str() {
                        let t = s.trim();
                        if !t.is_empty() {
                            ipv4_dns.push(t.to_string());
                        }
                    }
                }
            } else if let Some(s) = item["ipv4_dns"].as_str() {
                let t = s.trim();
                if !t.is_empty() {
                    ipv4_dns.push(t.to_string());
                }
            }

            let mut ipv6_dns = Vec::new();
            if let Some(arr) = item["ipv6_dns"].as_array() {
                for v in arr {
                    if let Some(s) = v.as_str() {
                        let t = s.trim();
                        if !t.is_empty() {
                            ipv6_dns.push(t.to_string());
                        }
                    }
                }
            } else if let Some(s) = item["ipv6_dns"].as_str() {
                let t = s.trim();
                if !t.is_empty() {
                    ipv6_dns.push(t.to_string());
                }
            }

            adapters.push(NetworkAdapterInfo {
                name,
                index,
                description,
                status,
                ipv4_dns,
                ipv6_dns,
                is_dhcp,
            });
        }

        Ok(adapters)
    })
    .await
    .map_err(|e| format!("Task execution error: {}", e))?
}

/// Updates the internal proxy forwarder DNS servers
#[command]
pub fn set_active_dns(provider_id: String, servers_v4: Vec<String>, _servers_v6: Vec<String>) -> Result<String, String> {
    let mut combined = Vec::new();
    for ip in &servers_v4 {
        let trimmed = ip.trim();
        if !trimmed.is_empty() {
            let addr = if trimmed.contains(':') { trimmed.to_string() } else { format!("{}:53", trimmed) };
            combined.push(addr);
        }
    }
    if let Ok(mut guard) = ACTIVE_DNS_SERVERS.write() {
        if !combined.is_empty() {
            *guard = combined;
        } else {
            *guard = vec![
                "1.1.1.1:53".to_string(),
                "1.0.0.1:53".to_string(),
                "8.8.8.8:53".to_string(),
                "9.9.9.9:53".to_string(),
            ];
        }
    }
    if let Ok(mut cache) = DNS_CACHE.write() {
        *cache = None;
    }
    Ok(format!("Active DNS provider set to {}", provider_id))
}

/// Applies chosen DNS servers directly to the specified Windows network adapter
#[command]
pub async fn apply_adapter_dns(
    adapter_index: u32,
    servers_v4: Vec<String>,
    servers_v6: Vec<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let clean_v4: Vec<String> = servers_v4.iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
        let clean_v6: Vec<String> = servers_v6.iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();

        let v4_args = if clean_v4.is_empty() {
            "$null".to_string()
        } else {
            format!("@('{}')", clean_v4.join("','"))
        };

        let v6_args = if clean_v6.is_empty() {
            "$null".to_string()
        } else {
            format!("@('{}')", clean_v6.join("','"))
        };

        let script = format!(
            r#"
$idx = {}
$v4 = {}
$v6 = {}

$backupKey = "HKCU:\Software\ProxyRouterDesktop\NetworkBackup\$idx"
if (-not (Test-Path $backupKey)) {{
    New-Item -Path $backupKey -Force | Out-Null
    $curr4 = (Get-DnsClientServerAddress -InterfaceIndex $idx -AddressFamily IPv4 -ErrorAction SilentlyContinue).ServerAddresses
    Set-ItemProperty -Path $backupKey -Name 'SavedIPv4' -Value ($curr4 -join ',') -Type String -ErrorAction SilentlyContinue
}}

if ($v4) {{
    Set-DnsClientServerAddress -InterfaceIndex $idx -ServerAddresses $v4 -ErrorAction SilentlyContinue
}}
if ($v6) {{
    Set-DnsClientServerAddress -InterfaceIndex $idx -ServerAddresses $v6 -ErrorAction SilentlyContinue
}} else {{
    Set-DnsClientServerAddress -InterfaceIndex $idx -AddressFamily IPv6 -ResetServerAddresses -ErrorAction SilentlyContinue
}}
Clear-DnsClientCache
"#,
            adapter_index, v4_args, v6_args
        );

        let output = hidden_command("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
            .map_err(|e| format!("Failed to apply adapter DNS: {}", e))?;

        if !output.status.success() {
            let elevated_cmd = format!(
                "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-Command','{}' -Wait",
                script.replace('\'', "''").replace('\n', "; ")
            );
            let _ = hidden_command("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &elevated_cmd])
                .output();
        }

        let _ = set_active_dns("adapter_sync".to_string(), clean_v4, clean_v6);
        Ok(format!("DNS applied to adapter index {}", adapter_index))
    })
    .await
    .map_err(|e| format!("Task execution error: {}", e))?
}

/// Resets adapter DNS back to DHCP / automatic
#[command]
pub async fn reset_adapter_dns(adapter_index: u32) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let script = format!(
            r#"
$idx = {}
Set-DnsClientServerAddress -InterfaceIndex $idx -ResetServerAddresses -ErrorAction SilentlyContinue
Clear-DnsClientCache
Remove-Item -Path "HKCU:\Software\ProxyRouterDesktop\NetworkBackup\$idx" -Recurse -Force -ErrorAction SilentlyContinue
"#,
            adapter_index
        );

        let output = hidden_command("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
            .map_err(|e| format!("Failed to reset adapter DNS: {}", e))?;

        if !output.status.success() {
            let elevated_cmd = format!(
                "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-Command','{}' -Wait",
                script.replace('\'', "''").replace('\n', "; ")
            );
            let _ = hidden_command("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &elevated_cmd])
                .output();
        }

        Ok(format!("DNS reset to automatic (DHCP) on adapter index {}", adapter_index))
    })
    .await
    .map_err(|e| format!("Task execution error: {}", e))?
}

/// Tests latency (RTT in ms) to each provided DNS server over UDP concurrently
#[command]
pub async fn test_dns_latency(servers: Vec<String>) -> Result<Vec<DnsLatencyResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::sync::{Arc, Mutex};
        let results = Arc::new(Mutex::new(Vec::new()));
        let mut handles = Vec::new();

        for raw_server in servers {
            let server = raw_server.trim().to_string();
            if server.is_empty() {
                continue;
            }
            let results_clone = Arc::clone(&results);
            handles.push(thread::spawn(move || {
                let target_addr = if server.contains(':') {
                    server.clone()
                } else {
                    format!("{}:53", server)
                };

                let start = Instant::now();
                let socket = match UdpSocket::bind("0.0.0.0:0") {
                    Ok(s) => s,
                    Err(e) => {
                        let mut res = results_clone.lock().unwrap();
                        res.push(DnsLatencyResult {
                            server,
                            latency_ms: None,
                            error: Some(e.to_string()),
                        });
                        return;
                    }
                };
                let _ = socket.set_read_timeout(Some(Duration::from_millis(800)));
                let _ = socket.set_write_timeout(Some(Duration::from_millis(800)));

                let mut packet = Vec::with_capacity(64);
                packet.extend_from_slice(&[0x3a, 0x4b, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
                packet.push(10);
                packet.extend_from_slice(b"cloudflare");
                packet.push(3);
                packet.extend_from_slice(b"com");
                packet.push(0);
                packet.extend_from_slice(&[0x00, 0x01, 0x00, 0x01]);

                if socket.send_to(&packet, &target_addr).is_err() {
                    let mut res = results_clone.lock().unwrap();
                    res.push(DnsLatencyResult {
                        server,
                        latency_ms: None,
                        error: Some("Send error".to_string()),
                    });
                    return;
                }

                let mut buf = [0u8; 512];
                let item = match socket.recv_from(&mut buf) {
                    Ok((len, _)) if len >= 12 => {
                        let elapsed = start.elapsed().as_millis() as u64;
                        DnsLatencyResult {
                            server,
                            latency_ms: Some(elapsed),
                            error: None,
                        }
                    }
                    Ok(_) => DnsLatencyResult {
                        server,
                        latency_ms: None,
                        error: Some("Truncated response".to_string()),
                    },
                    Err(e) => DnsLatencyResult {
                        server,
                        latency_ms: None,
                        error: Some(e.to_string()),
                    },
                };

                let mut res = results_clone.lock().unwrap();
                res.push(item);
            }));
        }

        for h in handles {
            let _ = h.join();
        }

        let final_results = results.lock().unwrap().clone();
        Ok(final_results)
    })
    .await
    .map_err(|e| format!("Task execution error: {}", e))?
}

/// Restores all network settings, adapter DNS, IPv6 defaults, and environment variables
#[command]
pub async fn restore_network_defaults() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let _ = clear_system_proxy_sync();

        let script = r#"
# 1. Reset DNS on ALL active network adapters back to automatic (DHCP)
Get-NetAdapter -ErrorAction SilentlyContinue | ForEach-Object {
    Set-DnsClientServerAddress -InterfaceIndex $_.InterfaceIndex -ResetServerAddresses -ErrorAction SilentlyContinue
}

# 2. Delete static IPv6 DNS on virtual / VPN adapters that might stall lookups
netsh interface ipv6 delete dnsservers "Radmin VPN" all 2>$null

# 3. Ensure IPv6 is enabled on all adapters
Get-NetAdapterBinding -ComponentId ms_tcpip6 -ErrorAction SilentlyContinue | Where-Object { -not $_.Enabled } | ForEach-Object {
    Enable-NetAdapterBinding -Name $_.Name -ComponentId ms_tcpip6 -ErrorAction SilentlyContinue
}

# 4. Remove backup keys
$backupRoot = "HKCU:\Software\ProxyRouterDesktop\NetworkBackup"
if (Test-Path $backupRoot) {
    Remove-Item -Path $backupRoot -Recurse -Force -ErrorAction SilentlyContinue
}

# 5. Reset WinHTTP proxy to direct
netsh winhttp reset proxy 2>$null

# 6. Delete all proxy environment variables from User and Machine registry
$vars = @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy')
$envReg = 'HKCU:\Environment'
$sysEnvReg = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment'
foreach ($v in $vars) {
    Remove-ItemProperty -Path $envReg -Name $v -ErrorAction SilentlyContinue
    Remove-ItemProperty -Path $sysEnvReg -Name $v -ErrorAction SilentlyContinue
    [System.Environment]::SetEnvironmentVariable($v, $null, 'User')
    [System.Environment]::SetEnvironmentVariable($v, $null, 'Process')
}

# 7. Clear DNS cache
Clear-DnsClientCache

# 8. Broadcast changes
$wininetCode = @"
using System;
using System.Runtime.InteropServices;
public class EnvRefresh {
    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
    public static void Notify() {
        UIntPtr result;
        SendMessageTimeout((IntPtr)0xffff, 0x001A, UIntPtr.Zero, "Environment", 2, 1000, out result);
        SendMessageTimeout((IntPtr)0xffff, 0x001A, UIntPtr.Zero, "Internet Settings", 2, 1000, out result);
    }
}
"@
Add-Type -TypeDefinition $wininetCode -ErrorAction SilentlyContinue
[EnvRefresh]::Notify()
"#;

        let output = hidden_command("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .output();

        if output.is_err() || !output.as_ref().map(|o| o.status.success()).unwrap_or(false) {
            let elevated_cmd = format!(
                "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-Command','{}' -Wait",
                script.replace('\'', "''").replace('\n', "; ")
            );
            let _ = hidden_command("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &elevated_cmd])
                .output();
        }

        if let Ok(mut guard) = ACTIVE_DNS_SERVERS.write() {
            *guard = vec![
                "1.1.1.1:53".to_string(),
                "1.0.0.1:53".to_string(),
                "8.8.8.8:53".to_string(),
                "9.9.9.9:53".to_string(),
            ];
        }
        if let Ok(mut cache) = DNS_CACHE.write() {
            *cache = None;
        }

        Ok("All network settings, IPv6 defaults, and environment variables restored to clean state".to_string())
    })
    .await
    .map_err(|e| format!("Task execution error: {}", e))?
}

// ── Autostart & Dynamic Tray Icon Commands ─────────────────────────────────

pub const TRAY_ACTIVE_BYTES: &[u8] = include_bytes!("../icons/variants/monolith-tray-active.png");
pub const TRAY_INACTIVE_BYTES: &[u8] = include_bytes!("../icons/variants/monolith-tray-inactive.png");

static CURRENT_APP_ICON: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);
static CURRENT_PROXY_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn get_tray_icon_bytes(icon_id: &str, active: bool) -> &'static [u8] {
    match (icon_id, active) {
        ("vela-cream", true) => include_bytes!("../icons/variants/vela-cream-tray-active.png"),
        ("vela-cream", false) => include_bytes!("../icons/variants/vela-cream-tray-inactive.png"),
        ("vela-amber", true) => include_bytes!("../icons/variants/vela-amber-tray-active.png"),
        ("vela-amber", false) => include_bytes!("../icons/variants/vela-amber-tray-inactive.png"),
        ("sunset-peach", true) => include_bytes!("../icons/variants/sunset-peach-tray-active.png"),
        ("sunset-peach", false) => include_bytes!("../icons/variants/sunset-peach-tray-inactive.png"),
        ("lilac-lavender", true) => include_bytes!("../icons/variants/lilac-lavender-tray-active.png"),
        ("lilac-lavender", false) => include_bytes!("../icons/variants/lilac-lavender-tray-inactive.png"),
        ("cyber-emerald", true) => include_bytes!("../icons/variants/cyber-emerald-tray-active.png"),
        ("cyber-emerald", false) => include_bytes!("../icons/variants/cyber-emerald-tray-inactive.png"),
        ("midnight-white", true) => include_bytes!("../icons/variants/midnight-white-tray-active.png"),
        ("midnight-white", false) => include_bytes!("../icons/variants/midnight-white-tray-inactive.png"),
        ("monolith", true) => include_bytes!("../icons/variants/monolith-tray-active.png"),
        ("monolith", false) => include_bytes!("../icons/variants/monolith-tray-inactive.png"),
        (_, true) => TRAY_ACTIVE_BYTES,
        (_, false) => TRAY_INACTIVE_BYTES,
    }
}

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
    let mode_val = PROXY_MODE.load(Ordering::SeqCst);
    let mode_str = if mode_val == 1 { "Global" } else { "Split" };
    let status_text = if active {
        format!("Proxy Router: Active ({})", mode_str)
    } else {
        "Proxy Router: Disconnected".to_string()
    };
    let toggle_text = if active {
        "Disable Proxy"
    } else {
        "Enable Proxy"
    };
    let mode_text = if mode_val == 1 {
        "Switch Mode: Split Tunneling (Rules)"
    } else {
        "Switch Mode: All Traffic (Global)"
    };

    let status_header = MenuItem::with_id(app, "status_info", status_text, false, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let toggle_proxy_item = MenuItem::with_id(app, "toggle_proxy", toggle_text, true, None::<&str>)?;
    let toggle_mode_item = MenuItem::with_id(app, "toggle_mode", mode_text, true, None::<&str>)?;
    let sync_ip_item = MenuItem::with_id(app, "sync_ip", "Sync IP with Whitelist", true, None::<&str>)?;
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
            &toggle_mode_item,
            &sync_ip_item,
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
pub fn update_tray_icon(
    app: AppHandle,
    active: bool,
    icon_id: Option<String>,
) -> Result<(), String> {
    CURRENT_PROXY_ACTIVE.store(active, std::sync::atomic::Ordering::SeqCst);
    if let Some(id) = icon_id {
        if !id.is_empty() {
            if let Ok(mut lock) = CURRENT_APP_ICON.lock() {
                *lock = Some(id);
            }
        }
    }

    let active_icon_id = CURRENT_APP_ICON
        .lock()
        .ok()
        .and_then(|lock| lock.clone())
        .unwrap_or_else(|| "monolith".to_string());

    let tray = app.tray_by_id("main_tray").or_else(|| app.tray_by_id("main_tray_dev"));
    if let Some(tray) = tray {
        let img_bytes = get_tray_icon_bytes(&active_icon_id, active);
        if let Ok(icon) = Image::from_bytes(img_bytes) {
            let _ = tray.set_icon(Some(icon));
        }
        let mode_val = PROXY_MODE.load(Ordering::SeqCst);
        let mode_str = if mode_val == 1 { "Global" } else { "Split" };
        let tooltip = if active {
            format!("Proxy Router: Active ({})", mode_str)
        } else {
            "Proxy Router: Disconnected".to_string()
        };
        let _ = tray.set_tooltip(Some(&tooltip));

        if let Ok(menu) = build_tray_menu(&app, active) {
            let _ = tray.set_menu(Some(menu));
        }
    }
    Ok(())
}

#[command]
pub fn set_app_icon(
    app: AppHandle,
    icon_id: String,
    active: Option<bool>,
) -> Result<(), String> {
    if let Ok(mut lock) = CURRENT_APP_ICON.lock() {
        *lock = Some(icon_id.clone());
    }
    if let Some(act) = active {
        CURRENT_PROXY_ACTIVE.store(act, std::sync::atomic::Ordering::SeqCst);
    }
    let is_active = CURRENT_PROXY_ACTIVE.load(std::sync::atomic::Ordering::SeqCst);

    let window_bytes: &[u8] = match icon_id.as_str() {
        "vela-cream" => include_bytes!("../icons/variants/vela-cream-256.png"),
        "vela-amber" => include_bytes!("../icons/variants/vela-amber-256.png"),
        "sunset-peach" => include_bytes!("../icons/variants/sunset-peach-256.png"),
        "lilac-lavender" => include_bytes!("../icons/variants/lilac-lavender-256.png"),
        "cyber-emerald" => include_bytes!("../icons/variants/cyber-emerald-256.png"),
        "midnight-white" => include_bytes!("../icons/variants/midnight-white-256.png"),
        _ => include_bytes!("../icons/variants/monolith-256.png"),
    };

    let small_icon_bytes: &[u8] = match icon_id.as_str() {
        "vela-cream" => include_bytes!("../icons/variants/vela-cream-32.png"),
        "vela-amber" => include_bytes!("../icons/variants/vela-amber-32.png"),
        "sunset-peach" => include_bytes!("../icons/variants/sunset-peach-32.png"),
        "lilac-lavender" => include_bytes!("../icons/variants/lilac-lavender-32.png"),
        "cyber-emerald" => include_bytes!("../icons/variants/cyber-emerald-32.png"),
        "midnight-white" => include_bytes!("../icons/variants/midnight-white-32.png"),
        _ => include_bytes!("../icons/variants/monolith-32.png"),
    };

    let ico_bytes: &[u8] = match icon_id.as_str() {
        "vela-cream" => include_bytes!("../icons/variants/vela-cream.ico"),
        "vela-amber" => include_bytes!("../icons/variants/vela-amber.ico"),
        "sunset-peach" => include_bytes!("../icons/variants/sunset-peach.ico"),
        "lilac-lavender" => include_bytes!("../icons/variants/lilac-lavender.ico"),
        "cyber-emerald" => include_bytes!("../icons/variants/cyber-emerald.ico"),
        "midnight-white" => include_bytes!("../icons/variants/midnight-white.ico"),
        _ => include_bytes!("../icons/variants/monolith.ico"),
    };

    let tray_bytes = get_tray_icon_bytes(&icon_id, is_active);

    // 1. Standard Tauri window icon
    if let Ok(window_icon) = Image::from_bytes(window_bytes) {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_icon(window_icon);
        }
    }

    // 2. System tray icon
    if let Ok(tray_icon) = Image::from_bytes(tray_bytes) {
        let tray = app.tray_by_id("main_tray").or_else(|| app.tray_by_id("main_tray_dev"));
        if let Some(tray) = tray {
            let _ = tray.set_icon(Some(tray_icon));
        }
    }

    // 3. Windows Native Taskbar & Shell Shortcut Synchronization
    #[cfg(windows)]
    {
        if let Some(window) = app.get_webview_window("main") {
            if let Ok(hwnd_obj) = window.hwnd() {
                let hwnd = hwnd_obj.0;
                unsafe {
                    let hicon_big = win32_icon::CreateIconFromResourceEx(
                        window_bytes.as_ptr(),
                        window_bytes.len() as u32,
                        1,
                        0x00030000,
                        256,
                        256,
                        0,
                    );
                    let hicon_small = win32_icon::CreateIconFromResourceEx(
                        small_icon_bytes.as_ptr(),
                        small_icon_bytes.len() as u32,
                        1,
                        0x00030000,
                        32,
                        32,
                        0,
                    );
                    if hicon_big != 0 {
                        win32_icon::SendMessageW(hwnd, 0x0080 /* WM_SETICON */, 1 /* ICON_BIG */, hicon_big);
                        #[cfg(target_pointer_width = "64")]
                        win32_icon::SetClassLongPtrW(hwnd, -14 /* GCLP_HICON */, hicon_big);
                    }
                    if hicon_small != 0 {
                        win32_icon::SendMessageW(hwnd, 0x0080 /* WM_SETICON */, 0 /* ICON_SMALL */, hicon_small);
                        #[cfg(target_pointer_width = "64")]
                        win32_icon::SetClassLongPtrW(hwnd, -34 /* GCLP_HICONSM */, hicon_small);
                    }
                }
            }
        }

        // Persist active .ico to local app data and update Windows shortcuts
        win32_icon::sync_windows_shortcuts_icon(ico_bytes);
    }

    Ok(())
}

#[command]
pub fn app_quit(app: AppHandle) -> Result<(), String> {
    let _ = clear_system_proxy_sync();
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

#[command]
pub fn set_window_effect(window: Window, effect: String, color: Option<(u8, u8, u8, u8)>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::{apply_acrylic, apply_blur, apply_mica, clear_acrylic, clear_blur, clear_mica};
        match effect.as_str() {
            "acrylic" => {
                let _ = clear_blur(&window);
                let _ = clear_mica(&window);
                if let Err(e) = apply_acrylic(&window, color) {
                    eprintln!("[set_window_effect] apply_acrylic: {e}");
                }
            }
            "blur" => {
                let _ = clear_acrylic(&window);
                let _ = clear_mica(&window);
                if let Err(e) = apply_blur(&window, color) {
                    eprintln!("[set_window_effect] apply_blur: {e}");
                }
            }
            "mica" => {
                let _ = clear_acrylic(&window);
                let _ = clear_blur(&window);
                if let Err(e) = apply_mica(&window, Some(true)) {
                    eprintln!("[set_window_effect] apply_mica failed ({e}), fallback to acrylic");
                    let _ = apply_acrylic(&window, color.or(Some((18, 18, 18, 200))));
                }
            }
            _ => {
                let _ = clear_acrylic(&window);
                let _ = clear_blur(&window);
                let _ = clear_mica(&window);
            }
        }
    }
    Ok(())
}

// ── Native Win32 Registry & Shutdown Safety ──────────────────────────────────

#[cfg(windows)]
pub mod win32_icon {
    use std::ptr::null;

    #[link(name = "user32")]
    extern "system" {
        pub fn CreateIconFromResourceEx(
            pbIconBits: *const u8,
            cbIconBits: u32,
            fIcon: i32,
            dwVersion: u32,
            cxDesired: i32,
            cyDesired: i32,
            uFlags: u32,
        ) -> isize;

        pub fn SendMessageW(
            hWnd: *mut std::ffi::c_void,
            Msg: u32,
            wParam: usize,
            lParam: isize,
        ) -> isize;

        #[cfg(target_pointer_width = "64")]
        pub fn SetClassLongPtrW(
            hWnd: *mut std::ffi::c_void,
            nIndex: i32,
            dwNewLong: isize,
        ) -> usize;
    }

    #[link(name = "shell32")]
    extern "system" {
        pub fn SHChangeNotify(
            wEventId: i32,
            uFlags: u32,
            dwItem1: *const std::ffi::c_void,
            dwItem2: *const std::ffi::c_void,
        );
    }

    pub fn sync_windows_shortcuts_icon(ico_bytes: &[u8]) {
        let local_app_data = std::env::var("LOCALAPPDATA")
            .or_else(|_| std::env::var("APPDATA"))
            .unwrap_or_else(|_| ".".into());
        let app_dir = std::path::PathBuf::from(local_app_data).join("Proxy Router Desktop");
        let _ = std::fs::create_dir_all(&app_dir);
        let ico_path = app_dir.join("app_icon.ico");

        if std::fs::write(&ico_path, ico_bytes).is_ok() {
            let ico_str = ico_path.to_string_lossy();
            let script = format!(
                r#"
$ico = '{}'
$ws = New-Object -ComObject WScript.Shell
$targets = @(
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Proxy Router Desktop.lnk",
    "$env:USERPROFILE\Desktop\Proxy Router Desktop.lnk",
    "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Proxy Router Desktop.lnk"
)
foreach ($t in $targets) {{
    if (Test-Path $t) {{
        try {{
            $s = $ws.CreateShortcut($t)
            $s.IconLocation = "$ico,0"
            $s.Save()
        }} catch {{}}
    }}
}}
"#,
                ico_str
            );

            let mut cmd = std::process::Command::new("powershell");
            cmd.args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &script]);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }
            let _ = cmd.spawn();

            unsafe {
                SHChangeNotify(0x08000000 /* SHCNE_ASSOCCHANGED */, 0x0000 /* SHCNF_IDLIST */, null(), null());
            }
        }
    }
}

#[cfg(windows)]
pub mod win32_proxy {
    use std::ffi::c_void;
    use std::ptr::null_mut;

    pub const HKEY_CURRENT_USER: isize = -2147483647; // 0x80000001
    pub const KEY_SET_VALUE: u32 = 0x0002;
    pub const KEY_READ: u32 = 0x20019;
    pub const REG_SZ: u32 = 1;
    pub const REG_BINARY: u32 = 3;
    pub const REG_DWORD: u32 = 4;

    pub const INTERNET_OPTION_SETTINGS_CHANGED: u32 = 39;
    pub const INTERNET_OPTION_REFRESH: u32 = 37;
    pub const WM_SETTINGCHANGE: u32 = 0x001A;
    pub const SMTO_ABORTIFHUNG: u32 = 0x0002;

    #[link(name = "advapi32")]
    extern "system" {
        pub fn RegOpenKeyExW(
            hKey: isize,
            lpSubKey: *const u16,
            ulOptions: u32,
            samDesired: u32,
            phkResult: *mut isize,
        ) -> i32;

        pub fn RegCreateKeyExW(
            hKey: isize,
            lpSubKey: *const u16,
            Reserved: u32,
            lpClass: *const u16,
            dwOptions: u32,
            samDesired: u32,
            lpSecurityAttributes: *mut c_void,
            phkResult: *mut isize,
            lpdwDisposition: *mut u32,
        ) -> i32;

        pub fn RegSetValueExW(
            hKey: isize,
            lpValueName: *const u16,
            Reserved: u32,
            dwType: u32,
            lpData: *const u8,
            cbData: u32,
        ) -> i32;

        pub fn RegDeleteValueW(
            hKey: isize,
            lpValueName: *const u16,
        ) -> i32;

        pub fn RegEnumValueW(
            hKey: isize,
            dwIndex: u32,
            lpValueName: *mut u16,
            lpcchValueName: *mut u32,
            lpReserved: *mut u32,
            lpType: *mut u32,
            lpData: *mut u8,
            lpcbData: *mut u32,
        ) -> i32;

        pub fn RegCloseKey(hKey: isize) -> i32;
    }

    #[link(name = "wininet")]
    extern "system" {
        pub fn InternetSetOptionW(
            hInternet: *mut c_void,
            dwOption: u32,
            lpBuffer: *mut c_void,
            dwBufferLength: u32,
        ) -> i32;
    }

    #[link(name = "user32")]
    extern "system" {
        pub fn SendMessageTimeoutW(
            hWnd: isize,
            Msg: u32,
            wParam: usize,
            lParam: *const u16,
            fuFlags: u32,
            uTimeout: u32,
            lpdwResult: *mut usize,
        ) -> isize;
    }

    #[link(name = "kernel32")]
    extern "system" {
        pub fn SetConsoleCtrlHandler(
            HandlerRoutine: Option<unsafe extern "system" fn(u32) -> i32>,
            Add: i32,
        ) -> i32;

        pub fn SetProcessShutdownParameters(
            dwLevel: u32,
            dwFlags: u32,
        ) -> i32;
    }

    #[link(name = "comctl32")]
    #[allow(non_snake_case)]
    extern "system" {
        pub fn SetWindowSubclass(
            hWnd: *mut c_void,
            pfnSubclass: unsafe extern "system" fn(
                hWnd: *mut c_void,
                uMsg: u32,
                wParam: usize,
                lParam: isize,
                uIdSubclass: usize,
                dwRefData: usize,
            ) -> isize,
            uIdSubclass: usize,
            dwRefData: usize,
        ) -> i32;

        pub fn DefSubclassProc(
            hWnd: *mut c_void,
            uMsg: u32,
            wParam: usize,
            lParam: isize,
        ) -> isize;
    }

    #[link(name = "dnsapi")]
    extern "system" {
        pub fn DnsFlushResolverCache() -> i32;
    }

    pub fn set_terminal_env_proxy_native(proxy_url: Option<&str>, enabled: bool) -> Result<(), String> {
        let eff_url = proxy_url
            .filter(|s| !s.trim().is_empty())
            .unwrap_or("http://127.0.0.1:8183");

        let env_subkey: Vec<u16> = "Environment\0".encode_utf16().collect();
        let mut env_hkey: isize = 0;
        let res = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                env_subkey.as_ptr(),
                0,
                null_mut(),
                0,
                KEY_SET_VALUE,
                null_mut(),
                &mut env_hkey,
                null_mut(),
            )
        };
        if res != 0 {
            return Err(format!("Failed to open HKCU\\Environment: error {}", res));
        }

        let vars = [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
            "no_proxy",
        ];

        let no_proxy_val = "localhost,127.0.0.1,::1,<local>,*.local,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,*.apple.com,*.icloud.com,apple.com,icloud.com,*.mzstatic.com,*.aaplimg.com,*.apple-cloudkit.com,*.crashlytics.com";

        if enabled {
            for var in &vars {
                let val = if var.to_ascii_uppercase().contains("NO_PROXY") {
                    no_proxy_val
                } else {
                    eff_url
                };
                let var_u16: Vec<u16> = format!("{}\0", var).encode_utf16().collect();
                let val_u16: Vec<u16> = format!("{}\0", val).encode_utf16().collect();
                unsafe {
                    RegSetValueExW(
                        env_hkey,
                        var_u16.as_ptr(),
                        0,
                        REG_SZ,
                        val_u16.as_ptr() as *const u8,
                        (val_u16.len() * 2) as u32,
                    );
                }
            }
        } else {
            for var in &vars {
                let var_u16: Vec<u16> = format!("{}\0", var).encode_utf16().collect();
                unsafe {
                    RegDeleteValueW(env_hkey, var_u16.as_ptr());
                }
            }
        }

        unsafe {
            RegCloseKey(env_hkey);
            let env_param: Vec<u16> = "Environment\0".encode_utf16().collect();
            let mut result: usize = 0;
            SendMessageTimeoutW(0xffff, WM_SETTINGCHANGE, 0, env_param.as_ptr(), SMTO_ABORTIFHUNG, 200, &mut result);
        }

        Ok(())
    }

    pub fn apply_system_proxy_native(enabled: bool) -> Result<(), String> {
        let subkey: Vec<u16> = "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\0".encode_utf16().collect();
        let mut hkey: isize = 0;
        let res = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_SET_VALUE, &mut hkey) };
        if res != 0 {
            return Err(format!("Failed to open Internet Settings registry key: {}", res));
        }

        let val_pac: Vec<u16> = "AutoConfigURL\0".encode_utf16().collect();
        unsafe {
            RegDeleteValueW(hkey, val_pac.as_ptr());
        }

        let val_enable: Vec<u16> = "ProxyEnable\0".encode_utf16().collect();
        let val_server: Vec<u16> = "ProxyServer\0".encode_utf16().collect();
        let val_override: Vec<u16> = "ProxyOverride\0".encode_utf16().collect();

        let blob: Vec<u8>;

        if enabled {
            let one: u32 = 1;
            let srv: Vec<u16> = "127.0.0.1:8183\0".encode_utf16().collect();
            let ovr: Vec<u16> = "localhost;127.0.0.1;<local>\0".encode_utf16().collect();

            unsafe {
                RegSetValueExW(hkey, val_enable.as_ptr(), 0, REG_DWORD, &one as *const _ as *const u8, 4);
                RegSetValueExW(hkey, val_server.as_ptr(), 0, REG_SZ, srv.as_ptr() as *const u8, (srv.len() * 2) as u32);
                RegSetValueExW(hkey, val_override.as_ptr(), 0, REG_SZ, ovr.as_ptr() as *const u8, (ovr.len() * 2) as u32);
            }

            // Flag 0x03 = PROXY_TYPE_DIRECT (1) | PROXY_TYPE_PROXY_SERVER (2)
            let proxy_bytes = b"127.0.0.1:8183";
            let bypass_bytes = b"localhost;127.0.0.1;<local>";
            let mut b = Vec::with_capacity(80);
            b.extend_from_slice(&[0x46, 0x00, 0x00, 0x00, 0x12, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00]);
            b.extend_from_slice(&(proxy_bytes.len() as u32).to_le_bytes());
            b.extend_from_slice(proxy_bytes);
            b.extend_from_slice(&(bypass_bytes.len() as u32).to_le_bytes());
            b.extend_from_slice(bypass_bytes);
            b.extend_from_slice(&(0u32).to_le_bytes()); // pac len = 0
            b.resize(b.len() + 32, 0u8);
            blob = b;

            // Set RunOnce safety net in case of sudden power cut or crash
            let runonce_subkey: Vec<u16> = "Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce\0".encode_utf16().collect();
            let mut runonce_hkey: isize = 0;
            if unsafe { RegCreateKeyExW(HKEY_CURRENT_USER, runonce_subkey.as_ptr(), 0, null_mut(), 0, KEY_SET_VALUE, null_mut(), &mut runonce_hkey, null_mut()) } == 0 {
                let ro_name: Vec<u16> = "ProxyRouterRescue\0".encode_utf16().collect();
                let ro_cmd: Vec<u16> = "cmd.exe /c reg add \"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\" /v ProxyEnable /t REG_DWORD /d 0 /f & reg delete \"HKCU\\Environment\" /v HTTP_PROXY /f & reg delete \"HKCU\\Environment\" /v HTTPS_PROXY /f & reg delete \"HKCU\\Environment\" /v ALL_PROXY /f\0".encode_utf16().collect();
                unsafe {
                    RegSetValueExW(runonce_hkey, ro_name.as_ptr(), 0, REG_SZ, ro_cmd.as_ptr() as *const u8, (ro_cmd.len() * 2) as u32);
                    RegCloseKey(runonce_hkey);
                }
            }
        } else {
            let zero: u32 = 0;
            let empty_sz: [u16; 1] = [0];

            unsafe {
                RegSetValueExW(hkey, val_enable.as_ptr(), 0, REG_DWORD, &zero as *const _ as *const u8, 4);
                RegSetValueExW(hkey, val_server.as_ptr(), 0, REG_SZ, empty_sz.as_ptr() as *const u8, 2);
            }

            // Flag 0x01 = PROXY_TYPE_DIRECT (strictly direct, no proxy)
            let bypass_bytes = b"localhost;127.0.0.1;<local>";
            let mut b = Vec::with_capacity(80);
            b.extend_from_slice(&[0x46, 0x00, 0x00, 0x00, 0x13, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]);
            b.extend_from_slice(&(0u32).to_le_bytes()); // proxy len = 0
            b.extend_from_slice(&(bypass_bytes.len() as u32).to_le_bytes());
            b.extend_from_slice(bypass_bytes);
            b.extend_from_slice(&(0u32).to_le_bytes()); // pac len = 0
            b.resize(b.len() + 32, 0u8);
            blob = b;

            // Remove RunOnce safety net since proxy is cleanly disabled
            let runonce_subkey: Vec<u16> = "Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce\0".encode_utf16().collect();
            let mut runonce_hkey: isize = 0;
            if unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, runonce_subkey.as_ptr(), 0, KEY_SET_VALUE, &mut runonce_hkey) } == 0 {
                let ro_name: Vec<u16> = "ProxyRouterRescue\0".encode_utf16().collect();
                unsafe {
                    RegDeleteValueW(runonce_hkey, ro_name.as_ptr());
                    RegCloseKey(runonce_hkey);
                }
            }
        }

        unsafe {
            RegCloseKey(hkey);
        }

        // Apply binary blob to Connections
        let conn_subkey: Vec<u16> = "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\\Connections\0".encode_utf16().collect();
        let mut conn_hkey: isize = 0;
        if unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, conn_subkey.as_ptr(), 0, KEY_READ | KEY_SET_VALUE, &mut conn_hkey) } == 0 {
            let mut names: Vec<Vec<u16>> = Vec::new();
            let mut index = 0u32;
            let mut name_buf = [0u16; 256];
            loop {
                let mut name_len = name_buf.len() as u32;
                let res = unsafe {
                    RegEnumValueW(
                        conn_hkey,
                        index,
                        name_buf.as_mut_ptr(),
                        &mut name_len,
                        null_mut(),
                        null_mut(),
                        null_mut(),
                        null_mut(),
                    )
                };
                if res != 0 {
                    break;
                }
                let mut name_vec = name_buf[..name_len as usize].to_vec();
                name_vec.push(0);
                names.push(name_vec);
                index += 1;
            }

            let val_def: Vec<u16> = "DefaultConnectionSettings\0".encode_utf16().collect();
            let val_saved: Vec<u16> = "SavedLegacySettings\0".encode_utf16().collect();
            if !names.contains(&val_def) {
                names.push(val_def);
            }
            if !names.contains(&val_saved) {
                names.push(val_saved);
            }

            for name in &names {
                unsafe {
                    RegSetValueExW(conn_hkey, name.as_ptr(), 0, REG_BINARY, blob.as_ptr(), blob.len() as u32);
                }
            }
            unsafe {
                RegCloseKey(conn_hkey);
            }
        }

        // WinINet notifications
        unsafe {
            InternetSetOptionW(null_mut(), INTERNET_OPTION_SETTINGS_CHANGED, null_mut(), 0);
            InternetSetOptionW(null_mut(), INTERNET_OPTION_REFRESH, null_mut(), 0);

            let param: Vec<u16> = "Internet Settings\0".encode_utf16().collect();
            let mut result: usize = 0;
            SendMessageTimeoutW(0xffff, WM_SETTINGCHANGE, 0, param.as_ptr(), SMTO_ABORTIFHUNG, 200, &mut result);

            if !enabled {
                DnsFlushResolverCache();
            }
        }

        Ok(())
    }

    /// Fast, native <1ms Win32 reset of all system proxy and environment variables to Direct
    pub fn clear_system_proxy_native() {
        let _ = apply_system_proxy_native(false);
        let _ = set_terminal_env_proxy_native(None, false);
    }

    unsafe extern "system" fn window_subclass_proc(
        hwnd: *mut c_void,
        msg: u32,
        wparam: usize,
        lparam: isize,
        _uid_subclass: usize,
        _ref_data: usize,
    ) -> isize {
        const WM_QUERYENDSESSION: u32 = 0x0011;
        const WM_ENDSESSION: u32 = 0x0016;
        const WM_DESTROY: u32 = 0x0002;

        match msg {
            WM_QUERYENDSESSION => {
                eprintln!("[win32] Received WM_QUERYENDSESSION: cleaning up proxy before shutdown/logoff");
                clear_system_proxy_native();
                return 1;
            }
            WM_ENDSESSION => {
                if wparam != 0 {
                    eprintln!("[win32] Received WM_ENDSESSION: session ending, ensuring proxy clean");
                    clear_system_proxy_native();
                }
                return 0;
            }
            WM_DESTROY => {
                clear_system_proxy_native();
            }
            _ => {}
        }

        DefSubclassProc(hwnd, msg, wparam, lparam)
    }

    pub fn subclass_main_window(hwnd: *mut c_void) {
        unsafe {
            SetWindowSubclass(hwnd, window_subclass_proc, 1001, 0);
        }
    }

    unsafe extern "system" fn console_ctrl_handler(_ctrl_type: u32) -> i32 {
        clear_system_proxy_native();
        0
    }

    pub fn install_shutdown_handler() {
        unsafe {
            SetProcessShutdownParameters(0x300, 0);
            SetConsoleCtrlHandler(Some(console_ctrl_handler), 1);
        }
    }
}

#[cfg(not(windows))]
pub mod win32_proxy {
    use std::ffi::c_void;
    use std::process::Command;

    fn configure_linux_antigravity_settings(proxy_url: &str, enabled: bool) {
        if let Ok(home) = std::env::var("HOME") {
            let agy_settings = std::path::PathBuf::from(&home)
                .join(".config")
                .join("Antigravity")
                .join("User")
                .join("settings.json");

            if let Some(parent) = agy_settings.parent() {
                if parent.exists() {
                    let mut data: serde_json::Value = std::fs::read_to_string(&agy_settings)
                        .ok()
                        .and_then(|s| serde_json::from_str(&s).ok())
                        .unwrap_or_else(|| serde_json::json!({}));

                    if let Some(obj) = data.as_object_mut() {
                        if enabled {
                            obj.insert("http.proxy".to_string(), serde_json::Value::String(proxy_url.to_string()));
                            obj.insert("http.proxySupport".to_string(), serde_json::Value::String("override".to_string()));
                            obj.insert("http.proxyStrictSSL".to_string(), serde_json::Value::Bool(false));
                        } else if obj.get("http.proxy").and_then(|v| v.as_str()).map(|s| s.contains("127.0.0.1")).unwrap_or(false) {
                            obj.remove("http.proxy");
                        }
                        if let Ok(serialized) = serde_json::to_string_pretty(&data) {
                            let _ = std::fs::write(&agy_settings, serialized);
                        }
                    }
                }
            }

            // Never leave static environment.d files that can break network on reboot
            let env_d = std::path::PathBuf::from(&home).join(".config").join("environment.d");
            let _ = std::fs::remove_file(env_d.join("proxy-router.conf"));
            let _ = std::fs::remove_file(env_d.join("proxy.conf"));
        }
    }

    pub fn set_terminal_env_proxy_native(proxy_url: Option<&str>, enabled: bool) -> Result<(), String> {
        let eff_url = proxy_url
            .filter(|s| !s.trim().is_empty())
            .unwrap_or("http://127.0.0.1:8183");
        let no_proxy = "localhost,127.0.0.1,::1,.local,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16";

        if enabled {
            let _ = Command::new("systemctl")
                .args([
                    "--user",
                    "set-environment",
                    &format!("HTTP_PROXY={}", eff_url),
                    &format!("HTTPS_PROXY={}", eff_url),
                    &format!("ALL_PROXY={}", eff_url),
                    &format!("http_proxy={}", eff_url),
                    &format!("https_proxy={}", eff_url),
                    &format!("all_proxy={}", eff_url),
                    &format!("NO_PROXY={}", no_proxy),
                    &format!("no_proxy={}", no_proxy),
                ])
                .status();
            let _ = Command::new("dbus-update-activation-environment")
                .args([
                    "--systemd",
                    &format!("HTTP_PROXY={}", eff_url),
                    &format!("HTTPS_PROXY={}", eff_url),
                    &format!("ALL_PROXY={}", eff_url),
                    &format!("http_proxy={}", eff_url),
                    &format!("https_proxy={}", eff_url),
                    &format!("all_proxy={}", eff_url),
                    &format!("NO_PROXY={}", no_proxy),
                    &format!("no_proxy={}", no_proxy),
                ])
                .status();
        } else {
            let _ = Command::new("systemctl")
                .args([
                    "--user",
                    "unset-environment",
                    "HTTP_PROXY",
                    "HTTPS_PROXY",
                    "ALL_PROXY",
                    "http_proxy",
                    "https_proxy",
                    "all_proxy",
                    "NO_PROXY",
                    "no_proxy",
                ])
                .status();
        }
        Ok(())
    }

    pub fn apply_system_proxy_native(enabled: bool) -> Result<(), String> {
        let proxy_url = "http://127.0.0.1:8183";
        if enabled {
            let _ = Command::new("gsettings").args(["set", "org.gnome.system.proxy", "mode", "manual"]).status();
            let _ = Command::new("gsettings").args(["set", "org.gnome.system.proxy.http", "host", "127.0.0.1"]).status();
            let _ = Command::new("gsettings").args(["set", "org.gnome.system.proxy.http", "port", "8183"]).status();
            let _ = Command::new("gsettings").args(["set", "org.gnome.system.proxy.https", "host", "127.0.0.1"]).status();
            let _ = Command::new("gsettings").args(["set", "org.gnome.system.proxy.https", "port", "8183"]).status();
            let _ = Command::new("gsettings").args(["set", "org.gnome.system.proxy", "ignore-hosts", "['localhost', '127.0.0.0/8', '::1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']"]).status();
            configure_linux_antigravity_settings(proxy_url, true);
            let _ = set_terminal_env_proxy_native(Some(proxy_url), true);
        } else {
            let _ = Command::new("gsettings").args(["set", "org.gnome.system.proxy", "mode", "none"]).status();
            configure_linux_antigravity_settings(proxy_url, false);
            let _ = set_terminal_env_proxy_native(None, false);
        }
        Ok(())
    }

    pub fn clear_system_proxy_native() {
        let _ = apply_system_proxy_native(false);
    }

    pub fn subclass_main_window(_hwnd: *mut c_void) {}
    pub fn install_shutdown_handler() {}
}

/// Checks if Windows/Linux proxy is still configured to 127.0.0.1:8183 while PROXY_ACTIVE is false,
/// and resets it to direct if so.
pub fn sanitize_startup_proxy() {
    #[cfg(not(windows))]
    {
        let is_active = PROXY_ACTIVE.load(std::sync::atomic::Ordering::Relaxed);
        if !is_active {
            win32_proxy::clear_system_proxy_native();
        }
    }
    #[cfg(windows)]
    {
        let is_active = PROXY_ACTIVE.load(std::sync::atomic::Ordering::Relaxed);
        if !is_active {
            let proxy_en = reg_get("ProxyEnable").unwrap_or_default();
            let proxy_srv = reg_get("ProxyServer").unwrap_or_default();
            let http_env = reg_get_key(r"HKCU\Environment", "HTTP_PROXY").unwrap_or_default();
            let https_env = reg_get_key(r"HKCU\Environment", "HTTPS_PROXY").unwrap_or_default();
            if proxy_en == "0x1"
                || proxy_en == "1"
                || proxy_srv.contains("127.0.0.1:8183")
                || http_env.contains("127.0.0.1:8183")
                || https_env.contains("127.0.0.1:8183")
            {
                eprintln!(
                    "[sanitize_startup_proxy] Detected stale proxy settings on startup (ProxyServer: {}, ProxyEnable: {}, HTTP_PROXY: {}). Cleaning...",
                    proxy_srv, proxy_en, http_env
                );
                win32_proxy::clear_system_proxy_native();
            }
        }
    }
}

// ── Registry & WinInet helpers ──────────────────────────────────────────────

fn apply_windows_system_proxy(enabled: bool) -> Result<(), String> {
    win32_proxy::apply_system_proxy_native(enabled)?;
    Ok(())
}

fn reg_get(name: &str) -> Option<String> {
    reg_get_key(REG_PATH, name)
}

fn reg_get_key(key_path: &str, name: &str) -> Option<String> {
    let out = hidden_command("reg")
        .args(["query", key_path, "/v", name])
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 3 && parts[0].eq_ignore_ascii_case(name) {
            return Some(parts[2..].join(" "));
        }
    }
    None
}
