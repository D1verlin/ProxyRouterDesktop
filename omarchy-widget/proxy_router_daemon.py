#!/usr/bin/env python3
"""
Proxy Router Background Daemon (Linux / Arch / Omarchy)
Runs local PAC HTTP server (127.0.0.1:8182) and Async Selective Proxy Forwarder (127.0.0.1:8183).
Synchronized with ProxyRouterDesktop Rust engine (fast UDP IPv4 DNS, CORE_AI_DOMAINS, protocol fallback).
"""

import sys
import os
import asyncio
import socket
import ssl
import struct
import json
import time
import signal
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

CONFIG_DIR = Path.home() / ".config" / "proxy-router"
CACHE_DIR = Path.home() / ".cache" / "proxy-router"
SETTINGS_FILE = CONFIG_DIR / "settings.json"
LEGACY_CONFIG_FILE = CONFIG_DIR / "config.json"
STATE_FILE = CACHE_DIR / "state.json"
PID_FILE = CACHE_DIR / "daemon.pid"

BUFFER_SIZE = 65536
CONNECT_TIMEOUT = 6.0
UPSTREAM_TIMEOUT = 4.0
DNS_CACHE_TTL = 300.0

# Fast public DNS servers (UDP IPv4) — bypasses ISP/IPv6 RDNSS stalls
PUBLIC_DNS_SERVERS = [
    ("1.1.1.1", 53),
    ("1.0.0.1", 53),
    ("8.8.8.8", 53),
    ("9.9.9.9", 53),
]

# Core AI and developer ecosystem domains that MUST ALWAYS route through VPS proxy when active
# Matches proxy-router-desktop/src-tauri/src/proxy.rs CORE_AI_DOMAINS
CORE_AI_DOMAINS = {
    "googleapis.com",
    "google.com",
    "google",
    "goog",
    "notebook.google",
    "notebooklm.google",
    "cloud.google",
    "deepmind.google",
    "deepmind.com",
    "gstatic.com",
    "googleusercontent.com",
    "ggpht.com",
    "gvt1.com",
    "gvt2.com",
    "aistudio.google.com",
    "antigravity.google",
    "ai.google.dev",
    "withgoogle.com",
    "daily-cloudcode-pa.googleapis.com",
    "cloudcode-pa.googleapis.com",
    "cloudaicompanion.googleapis.com",
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
    "midjourney.com",
}

NEVER_PROXY_DOMAINS = {
    "apple.com",
    "icloud.com",
    "mzstatic.com",
    "aaplimg.com",
    "apple-cloudkit.com",
    "crashlytics.com",
    "local.home",
}

# Direct opener that completely ignores http_proxy / https_proxy env vars
DIRECT_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def is_valid_ipv4(ip: str) -> bool:
    parts = ip.strip().split(".")
    if len(parts) != 4:
        return False
    return all(p.isdigit() and 0 <= int(p) <= 255 for p in parts)


def build_dns_query_a(host: str) -> bytes:
    packet = bytearray([
        0x1A, 0x2B,  # TXID
        0x01, 0x00,  # Standard query, RD=1
        0x00, 0x01,  # QDCOUNT=1
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ])
    for part in host.split("."):
        b = part.encode("ascii", errors="ignore")
        if not b or len(b) > 63:
            return b""
        packet.append(len(b))
        packet.extend(b)
    packet.append(0x00)
    packet.extend(b"\x00\x01\x00\x01")  # Type A, Class IN
    return bytes(packet)


def parse_dns_response_a(buf: bytes) -> list[str]:
    ips = []
    length = len(buf)
    if length < 12 or buf[0] != 0x1A or buf[1] != 0x2B:
        return ips
    ancount = struct.unpack("!H", buf[6:8])[0]
    if ancount == 0:
        return ips

    idx = 12
    while idx < length and buf[idx] != 0:
        if (buf[idx] & 0xC0) == 0xC0:
            idx += 2
            break
        idx += 1 + buf[idx]
    if idx < length and buf[idx] == 0:
        idx += 1
    idx += 4  # Skip QTYPE and QCLASS

    for _ in range(ancount):
        if idx >= length:
            break
        if (buf[idx] & 0xC0) == 0xC0:
            idx += 2
        else:
            while idx < length and buf[idx] != 0:
                idx += 1 + buf[idx]
            if idx < length:
                idx += 1
        if idx + 10 > length:
            break
        rtype = struct.unpack("!H", buf[idx:idx + 2])[0]
        rdlength = struct.unpack("!H", buf[idx + 8:idx + 10])[0]
        idx += 10
        if rtype == 1 and rdlength == 4 and idx + 4 <= length:
            ip = f"{buf[idx]}.{buf[idx + 1]}.{buf[idx + 2]}.{buf[idx + 3]}"
            ips.append(ip)
        idx += rdlength
    return ips


def query_dns_ipv4_sync(host: str) -> list[str]:
    if is_valid_ipv4(host):
        return [host]
    query = build_dns_query_a(host)
    if not query:
        return []
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(0.45)
    try:
        for srv in PUBLIC_DNS_SERVERS:
            try:
                sock.sendto(query, srv)
                data, _ = sock.recvfrom(512)
                ips = parse_dns_response_a(data)
                if ips:
                    return ips
            except Exception:
                continue
    finally:
        sock.close()
    return []


class ProxyRouterDaemon:
    def __init__(self):
        self.config = {}
        self.routed_domains = set(CORE_AI_DOMAINS)
        self.last_config_mtime = 0.0
        self.pac_port = 8182
        self.forwarder_port = 8183
        self.is_active = False
        self.proxy_mode = "split"  # "split" | "global"
        self.upstream_host = ""
        self.upstream_port = 3128
        self.upstream_proto = "http"
        self.available_ports = {"http": 3128, "https": 8443, "socks5": 1080}
        self.ignore_tls = True
        self.auto_whitelist = True
        self.api_url = ""
        self.auth_token = ""
        self.dns_cache: dict[str, tuple[list[str], float]] = {}

    def _get_config_file(self) -> Path | None:
        if SETTINGS_FILE.exists():
            return SETTINGS_FILE
        if LEGACY_CONFIG_FILE.exists():
            return LEGACY_CONFIG_FILE
        return None

    def reload_config(self):
        cfg_path = self._get_config_file()
        if not cfg_path:
            return
        try:
            mtime = cfg_path.stat().st_mtime
            if mtime == self.last_config_mtime:
                return
            self.last_config_mtime = mtime
            with open(cfg_path, "r", encoding="utf-8") as f:
                self.config = json.load(f)

            self.is_active = bool(self.config.get("isActive", False))
            self.proxy_mode = str(self.config.get("proxyMode", "split")).lower()
            self.pac_port = int(self.config.get("pacPort", 8182))
            self.forwarder_port = int(self.config.get("forwarderPort", 8183))
            self.auto_whitelist = bool(self.config.get("autoWhitelist", True))

            server = self.config.get("server", {})
            self.upstream_host = str(server.get("host", "")).strip()
            self.api_url = str(server.get("apiUrl", "")).strip()
            if not self.api_url and self.upstream_host and self.upstream_host != "your-server-ip":
                self.api_url = f"http://{self.upstream_host}:1135"
            self.auth_token = str(server.get("authToken", "")).strip()
            self.upstream_port = int(server.get("port", 3128))
            self.upstream_proto = str(server.get("protocol", "http")).lower()
            if isinstance(server.get("availablePorts"), dict):
                self.available_ports = server["availablePorts"]
            self.ignore_tls = bool(server.get("ignoreTls", True))

            domains = set(CORE_AI_DOMAINS)
            for site in self.config.get("routedSites", []):
                if site.get("enabled", False):
                    for h in site.get("hosts", []):
                        clean = h.strip().lstrip("*.").lstrip(".").lower()
                        if clean:
                            domains.add(clean)
            for cd in self.config.get("customDomains", []):
                clean = cd.strip().lstrip("*.").lstrip(".").lower()
                if clean:
                    domains.add(clean)
            self.routed_domains = domains
        except Exception as e:
            print(f"[Daemon] Config reload error: {e}", file=sys.stderr)

    def should_proxy(self, host: str) -> bool:
        if not self.is_active or not self.upstream_host or self.upstream_host == "your-server-ip":
            return False

        h = host.strip().lower().rstrip(".")
        if ":" in h:
            h = h.split(":", 1)[0]

        if not h or h in ("localhost", "127.0.0.1", "::1", "0.0.0.0") or "." not in h:
            return False

        # Never proxy requests targeting the VPS host itself (prevents deadlock on Whitelist API :1135)
        if h == self.upstream_host.lower():
            return False

        # Local intranet & Apple exclusion
        if (
            h.startswith("192.168.")
            or h.startswith("10.")
            or h.startswith("172.16.")
            or h.startswith("172.17.")
            or h.startswith("172.18.")
            or h.startswith("172.19.")
            or h.startswith("172.2")
            or h.startswith("172.30.")
            or h.startswith("172.31.")
            or h.endswith(".local")
        ):
            return False

        for excl in NEVER_PROXY_DOMAINS:
            if h == excl or h.endswith("." + excl):
                return False

        if self.proxy_mode == "global":
            return True

        for d in self.routed_domains:
            if h == d or h.endswith("." + d):
                return True
        return False

    async def resolve_ipv4_first(self, host: str) -> list[str]:
        if is_valid_ipv4(host):
            return [host]
        now = time.monotonic()
        cached = self.dns_cache.get(host)
        if cached and (now - cached[1]) < DNS_CACHE_TTL:
            return cached[0]

        loop = asyncio.get_running_loop()
        ips = await loop.run_in_executor(None, query_dns_ipv4_sync, host)
        if not ips:
            try:
                infos = await loop.getaddrinfo(host, None, family=socket.AF_INET, type=socket.SOCK_STREAM)
                ips = [info[4][0] for info in infos if info[4] and info[4][0]]
            except Exception:
                pass
        if ips:
            self.dns_cache[host] = (ips, now)
        return ips

    async def open_direct_connection(self, host: str, port: int, timeout: float = CONNECT_TIMEOUT):
        if host in ("localhost", "127.0.0.1", "::1"):
            return await asyncio.wait_for(asyncio.open_connection("127.0.0.1", port), timeout=timeout)

        ips = await self.resolve_ipv4_first(host)
        last_err = None
        for ip in ips[:3]:
            try:
                return await asyncio.wait_for(asyncio.open_connection(ip, port), timeout=timeout)
            except Exception as e:
                last_err = e
                continue

        try:
            return await asyncio.wait_for(asyncio.open_connection(host, port), timeout=timeout)
        except Exception as e:
            raise last_err or e

    def generate_pac_script(self) -> str:
        if not self.is_active or not self.upstream_host or self.upstream_host == "your-server-ip":
            return "// Proxy Disabled\nfunction FindProxyForURL(url, host) {\n  return 'DIRECT';\n}\n"

        if self.upstream_proto == "https":
            proxy_str = f"HTTPS {self.upstream_host}:{self.upstream_port}; PROXY {self.upstream_host}:{self.upstream_port}"
        elif self.upstream_proto == "socks5":
            proxy_str = f"SOCKS5 {self.upstream_host}:{self.upstream_port}; SOCKS {self.upstream_host}:{self.upstream_port}"
        else:
            proxy_str = f"PROXY {self.upstream_host}:{self.upstream_port}"

        conds = [f'    dnsDomainIs(host, ".{d}") || host === "{d}" || shExpMatch(host, "*.{d}")' for d in sorted(self.routed_domains)]
        match_body = " ||\n".join(conds) if conds else "false"

        return f"""// Proxy Auto-Configuration (PAC) — Proxy Router
function FindProxyForURL(url, host) {{
  var proxy = "{proxy_str}";
  host = (host || "").toLowerCase();

  if (isPlainHostName(host) || host === "localhost" || host === "127.0.0.1" || host === "::1" ||
      host === "{self.upstream_host.lower()}" ||
      shExpMatch(host, "10.*") || shExpMatch(host, "192.168.*") || shExpMatch(host, "172.16.*")) {{
    return "DIRECT";
  }}

  if (
{match_body}
  ) {{
    return proxy;
  }}

  return "DIRECT";
}}
"""

    async def handle_pac_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        try:
            line = await asyncio.wait_for(reader.readline(), timeout=3.0)
            parts = line.decode("utf-8", errors="replace").split()
            if not parts:
                return

            method, path = parts[0], parts[1] if len(parts) > 1 else "/"
            while True:
                h = await asyncio.wait_for(reader.readline(), timeout=2.0)
                if not h or h in (b"\r\n", b"\n"):
                    break

            if method == "OPTIONS":
                resp = b"HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n"
            elif path == "/health":
                body = json.dumps({"ok": True, "engine": "proxy-router-daemon", "active": self.is_active}).encode()
                resp = f"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode() + body
            elif path.startswith("/proxy.pac") or path == "/":
                self.reload_config()
                pac_text = self.generate_pac_script().encode("utf-8")
                resp = (
                    f"HTTP/1.1 200 OK\r\nContent-Type: application/x-ns-proxy-autoconfig\r\n"
                    f"Access-Control-Allow-Origin: *\r\nCache-Control: no-cache\r\nContent-Length: {len(pac_text)}\r\nConnection: close\r\n\r\n"
                ).encode() + pac_text
            else:
                resp = b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"

            writer.write(resp)
            await writer.drain()
        except Exception:
            pass
        finally:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass

    async def pipe(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        try:
            while not reader.at_eof():
                data = await reader.read(BUFFER_SIZE)
                if not data:
                    break
                writer.write(data)
                await writer.drain()
        except (asyncio.CancelledError, ConnectionResetError, BrokenPipeError, OSError):
            pass
        finally:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass

    async def _connect_socks5_port(self, port: int, target_host: str, target_port: int):
        reader, writer = await self.open_direct_connection(self.upstream_host, port, timeout=UPSTREAM_TIMEOUT)
        try:
            writer.write(b"\x05\x01\x00")
            await asyncio.wait_for(writer.drain(), timeout=UPSTREAM_TIMEOUT)
            resp = await asyncio.wait_for(reader.readexactly(2), timeout=UPSTREAM_TIMEOUT)
            if resp != b"\x05\x00":
                raise ConnectionError("SOCKS5 auth failed")

            host_bytes = target_host.encode("utf-8")
            req = bytearray([0x05, 0x01, 0x00, 0x03, len(host_bytes)])
            req.extend(host_bytes)
            req.extend(target_port.to_bytes(2, "big"))
            writer.write(req)
            await asyncio.wait_for(writer.drain(), timeout=UPSTREAM_TIMEOUT)

            resp_hdr = await asyncio.wait_for(reader.readexactly(4), timeout=UPSTREAM_TIMEOUT)
            if resp_hdr[1] != 0x00:
                raise ConnectionError(f"SOCKS5 connect error {resp_hdr[1]}")

            atyp = resp_hdr[3]
            if atyp == 0x01:
                await asyncio.wait_for(reader.readexactly(6), timeout=UPSTREAM_TIMEOUT)
            elif atyp == 0x03:
                l = (await asyncio.wait_for(reader.readexactly(1), timeout=UPSTREAM_TIMEOUT))[0]
                await asyncio.wait_for(reader.readexactly(l + 2), timeout=UPSTREAM_TIMEOUT)
            elif atyp == 0x04:
                await asyncio.wait_for(reader.readexactly(18), timeout=UPSTREAM_TIMEOUT)

            return reader, writer
        except Exception:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass
            raise

    async def _connect_https_port(self, port: int, target_host: str, target_port: int):
        ctx = ssl.create_default_context()
        if self.ignore_tls:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        ips = await self.resolve_ipv4_first(self.upstream_host)
        connect_host = ips[0] if ips else self.upstream_host
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(connect_host, port, ssl=ctx, server_hostname=self.upstream_host),
            timeout=UPSTREAM_TIMEOUT,
        )
        try:
            connect_req = (
                f"CONNECT {target_host}:{target_port} HTTP/1.1\r\n"
                f"Host: {target_host}:{target_port}\r\n"
                f"Proxy-Connection: Keep-Alive\r\n\r\n"
            ).encode()
            writer.write(connect_req)
            await asyncio.wait_for(writer.drain(), timeout=UPSTREAM_TIMEOUT)
            resp = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=UPSTREAM_TIMEOUT)
            if b" 200 " not in resp.splitlines()[0]:
                raise ConnectionError(f"HTTPS proxy rejected: {resp.splitlines()[0]}")
            return reader, writer
        except Exception:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass
            raise

    async def _connect_http_port(self, port: int, target_host: str, target_port: int):
        reader, writer = await self.open_direct_connection(self.upstream_host, port, timeout=UPSTREAM_TIMEOUT)
        try:
            connect_req = (
                f"CONNECT {target_host}:{target_port} HTTP/1.1\r\n"
                f"Host: {target_host}:{target_port}\r\n"
                f"Proxy-Connection: Keep-Alive\r\n\r\n"
            ).encode()
            writer.write(connect_req)
            await asyncio.wait_for(writer.drain(), timeout=UPSTREAM_TIMEOUT)
            resp = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=UPSTREAM_TIMEOUT)
            if b" 200 " not in resp.splitlines()[0]:
                raise ConnectionError(f"HTTP proxy rejected: {resp.splitlines()[0]}")
            return reader, writer
        except Exception:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass
            raise

    async def connect_upstream_with_fallback(self, target_host: str, target_port: int):
        """
        Connects to the VPS upstream using the configured protocol, and automatically falls back
        to alternative GOST ports (http:3128, socks5:1080, https:8443) if the primary port fails.
        """
        candidates = [(self.upstream_proto, self.upstream_port)]
        for proto, default_port in [("http", 3128), ("socks5", 1080), ("https", 8443)]:
            port = int(self.available_ports.get(proto, default_port))
            if (proto, port) not in candidates:
                candidates.append((proto, port))

        last_err = None
        for proto, port in candidates:
            try:
                if proto == "socks5":
                    return await self._connect_socks5_port(port, target_host, target_port)
                elif proto == "https":
                    return await self._connect_https_port(port, target_host, target_port)
                else:
                    return await self._connect_http_port(port, target_host, target_port)
            except Exception as e:
                last_err = e
                continue
        raise last_err or ConnectionError("All upstream proxy protocols failed")

    async def handle_forwarder_client(self, client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter):
        try:
            initial_line = await asyncio.wait_for(client_reader.readline(), timeout=CONNECT_TIMEOUT)
            if not initial_line:
                return

            parts = initial_line.decode("utf-8", errors="replace").split()
            if len(parts) < 2:
                return

            method = parts[0].upper()
            target = parts[1]
            http_version = parts[2] if len(parts) > 2 else "HTTP/1.1"

            headers = []
            while True:
                h = await asyncio.wait_for(client_reader.readline(), timeout=CONNECT_TIMEOUT)
                if not h or h in (b"\r\n", b"\n"):
                    break
                headers.append(h)

            self.reload_config()

            if method == "CONNECT":
                if ":" in target:
                    thost, tport_str = target.rsplit(":", 1)
                    tport = int(tport_str) if tport_str.isdigit() else 443
                else:
                    thost, tport = target, 443

                thost = thost.strip("[]")

                # Prevent infinite proxy self-loop
                if thost in ("127.0.0.1", "localhost", "::1") and tport in (self.forwarder_port, self.pac_port):
                    client_writer.write(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n")
                    await client_writer.drain()
                    return

                use_proxy = self.should_proxy(thost)

                if use_proxy:
                    try:
                        remote_reader, remote_writer = await self.connect_upstream_with_fallback(thost, tport)
                    except Exception as e:
                        print(f"[Daemon] Upstream tunnel failed for {thost}:{tport} ({e})", file=sys.stderr)
                        client_writer.write(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
                        await client_writer.drain()
                        return
                else:
                    try:
                        remote_reader, remote_writer = await self.open_direct_connection(thost, tport)
                    except Exception:
                        client_writer.write(b"HTTP/1.1 504 Gateway Timeout\r\nConnection: close\r\n\r\n")
                        await client_writer.drain()
                        return

                client_writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                await client_writer.drain()

                await asyncio.gather(
                    self.pipe(client_reader, remote_writer),
                    self.pipe(remote_reader, client_writer),
                    return_exceptions=True,
                )
            else:
                # Plain HTTP Request
                parsed = urlparse(target) if "://" in target else None
                thost = ""
                tport = 80

                if parsed and parsed.hostname:
                    thost = parsed.hostname
                    tport = parsed.port or (443 if parsed.scheme == "https" else 80)
                else:
                    for h in headers:
                        if h.lower().startswith(b"host:"):
                            host_val = h.decode("utf-8", errors="replace").split(":", 1)[1].strip()
                            if ":" in host_val:
                                thost, p_str = host_val.rsplit(":", 1)
                                tport = int(p_str) if p_str.isdigit() else 80
                            else:
                                thost = host_val
                            break

                if not thost:
                    return

                thost = thost.strip("[]")

                if thost in ("127.0.0.1", "localhost", "::1") and tport in (self.forwarder_port, self.pac_port):
                    if tport == self.pac_port:
                        pac_text = self.generate_pac_script().encode("utf-8")
                        resp = (
                            f"HTTP/1.1 200 OK\r\nContent-Type: application/x-ns-proxy-autoconfig\r\n"
                            f"Content-Length: {len(pac_text)}\r\nConnection: close\r\n\r\n"
                        ).encode() + pac_text
                        client_writer.write(resp)
                        await client_writer.drain()
                    return

                use_proxy = self.should_proxy(thost)
                rel_path = (
                    (parsed.path or "/") + (f"?{parsed.query}" if parsed.query else "")
                    if parsed
                    else (target if target.startswith("/") else "/")
                )

                if use_proxy:
                    try:
                        # Tunnel plain HTTP through SOCKS5 or HTTP CONNECT upstream
                        if self.upstream_proto == "http":
                            remote_reader, remote_writer = await self.open_direct_connection(
                                self.upstream_host, self.upstream_port, timeout=UPSTREAM_TIMEOUT
                            )
                            remote_writer.write(initial_line)
                        else:
                            remote_reader, remote_writer = await self.connect_upstream_with_fallback(thost, tport)
                            remote_writer.write(f"{method} {rel_path} {http_version}\r\n".encode())
                    except Exception:
                        client_writer.write(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
                        await client_writer.drain()
                        return
                else:
                    try:
                        remote_reader, remote_writer = await self.open_direct_connection(thost, tport)
                        remote_writer.write(f"{method} {rel_path} {http_version}\r\n".encode())
                    except Exception:
                        client_writer.write(b"HTTP/1.1 504 Gateway Timeout\r\nConnection: close\r\n\r\n")
                        await client_writer.drain()
                        return

                for h in headers:
                    if not h.lower().startswith(b"proxy-connection:"):
                        remote_writer.write(h)
                remote_writer.write(b"\r\n")
                await remote_writer.drain()

                await asyncio.gather(
                    self.pipe(client_reader, remote_writer),
                    self.pipe(remote_reader, client_writer),
                    return_exceptions=True,
                )
        except Exception:
            pass
        finally:
            try:
                client_writer.close()
                await client_writer.wait_closed()
            except Exception:
                pass

    def _sync_whitelist_direct(self):
        """Directly checks public IP and whitelists it on VPS bypassing all environment proxies."""
        if not self.api_url or not self.auth_token or self.auth_token == "your-secret-token":
            return
        ip = ""
        for url in ("http://api.ipify.org", "http://icanhazip.com", "http://checkip.amazonaws.com"):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "curl/8.0"})
                with DIRECT_OPENER.open(req, timeout=2.5) as resp:
                    candidate = resp.read().decode("utf-8", errors="ignore").strip()
                    if is_valid_ipv4(candidate):
                        ip = candidate
                        break
            except Exception:
                continue

        if not ip:
            return

        try:
            payload = json.dumps({"ip": ip}).encode("utf-8")
            req = urllib.request.Request(
                f"{self.api_url.rstrip('/')}/api/whitelist",
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self.auth_token}",
                    "User-Agent": "ProxyRouter/1.0",
                },
                method="POST",
            )
            with DIRECT_OPENER.open(req, timeout=3.5) as resp:
                resp.read()
        except Exception:
            pass

    async def run(self):
        self.reload_config()
        loop = asyncio.get_running_loop()

        if self.auto_whitelist:
            loop.run_in_executor(None, self._sync_whitelist_direct)

        pac_server = await asyncio.start_server(
            self.handle_pac_client,
            "127.0.0.1",
            self.pac_port,
            reuse_address=True,
        )
        print(f"[Daemon] PAC Server listening on http://127.0.0.1:{self.pac_port}/proxy.pac", flush=True)

        fwd_server = await asyncio.start_server(
            self.handle_forwarder_client,
            "127.0.0.1",
            self.forwarder_port,
            reuse_address=True,
        )
        print(f"[Daemon] Forwarder proxy listening on 127.0.0.1:{self.forwarder_port}", flush=True)

        ticks = 0
        async with pac_server, fwd_server:
            while True:
                await asyncio.sleep(3.0)
                self.reload_config()
                ticks += 1
                if ticks % 20 == 0 and self.is_active and self.auto_whitelist:
                    loop.run_in_executor(None, self._sync_whitelist_direct)


def main():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    PID_FILE.write_text(str(os.getpid()))
    daemon = ProxyRouterDaemon()

    def handle_sig(signum, frame):
        PID_FILE.unlink(missing_ok=True)
        sys.exit(0)

    signal.signal(signal.SIGTERM, handle_sig)
    signal.signal(signal.SIGINT, handle_sig)

    try:
        asyncio.run(daemon.run())
    except KeyboardInterrupt:
        pass
    finally:
        PID_FILE.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
