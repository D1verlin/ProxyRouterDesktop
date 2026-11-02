#!/usr/bin/env python3
"""
Proxy Router Background Daemon
Runs local PAC HTTP server (127.0.0.1:8182) and Async Selective Proxy Forwarder (127.0.0.1:8183).
"""

import sys
import os
import asyncio
import socket
import ssl
import json
import time
from pathlib import Path

CONFIG_DIR = Path.home() / ".config" / "proxy-router"
CACHE_DIR = Path.home() / ".cache" / "proxy-router"
CONFIG_FILE = CONFIG_DIR / "config.json"
STATE_FILE = CACHE_DIR / "state.json"
PID_FILE = CACHE_DIR / "daemon.pid"

BUFFER_SIZE = 65536
CONNECT_TIMEOUT = 10.0

class ProxyRouterDaemon:
    def __init__(self):
        self.config = {}
        self.routed_domains = set()
        self.last_config_mtime = 0
        self.pac_port = 8182
        self.forwarder_port = 8183
        self.is_active = False
        self.upstream_host = ""
        self.upstream_port = 3128
        self.upstream_proto = "http"
        self.ignore_tls = True

    def reload_config(self):
        if not CONFIG_FILE.exists():
            return
        try:
            mtime = CONFIG_FILE.stat().st_mtime
            if mtime == self.last_config_mtime:
                return
            self.last_config_mtime = mtime
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                self.config = json.load(f)

            self.is_active = self.config.get("isActive", False)
            self.pac_port = self.config.get("pacPort", 8182)
            self.forwarder_port = self.config.get("forwarderPort", 8183)

            server = self.config.get("server", {})
            self.upstream_host = server.get("host", "")
            self.upstream_port = server.get("port", 3128)
            self.upstream_proto = server.get("protocol", "http").lower()
            self.ignore_tls = server.get("ignoreTls", True)

            domains = set()
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
        if not self.is_active:
            return False
        h = host.strip().lower()
        if not h or h in ("localhost", "127.0.0.1", "::1") or "." not in h:
            return False
        # Local intranet exclusion
        if h.startswith("192.168.") or h.startswith("10.") or h.endswith(".local"):
            return False

        for d in self.routed_domains:
            if h == d or h.endswith("." + d):
                return True
        return False

    def generate_pac_script(self) -> str:
        if self.upstream_proto == "https":
            proxy_str = f"HTTPS {self.upstream_host}:{self.upstream_port}; PROXY {self.upstream_host}:{self.upstream_port}"
        elif self.upstream_proto == "socks5":
            proxy_str = f"SOCKS5 {self.upstream_host}:{self.upstream_port}; SOCKS {self.upstream_host}:{self.upstream_port}"
        else:
            proxy_str = f"PROXY {self.upstream_host}:{self.upstream_port}"

        conds = [f'    dnsDomainIs(host, ".{d}") || host === "{d}" || shExpMatch(host, "*.{d}")' for d in sorted(self.routed_domains)]
        match_body = " ||\n".join(conds) if conds else "false"

        return f"""// Proxy Auto-Configuration (PAC) — Proxy Router Omarchy
function FindProxyForURL(url, host) {{
  var proxy = "{proxy_str}";
  host = (host || "").toLowerCase();

  if (isPlainHostName(host) || host === "localhost" || host === "127.0.0.1" || host === "::1" ||
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
                writer.close()
                await writer.wait_closed()
                return

            method, path = parts[0], parts[1] if len(parts) > 1 else "/"
            # Consume remaining headers
            while True:
                h = await asyncio.wait_for(reader.readline(), timeout=2.0)
                if not h or h == b"\r\n":
                    break

            if method == "OPTIONS":
                resp = b"HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n"
            elif path == "/health":
                body = json.dumps({"ok": True, "engine": "omarchy-proxy-router"}).encode()
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
        except (asyncio.CancelledError, ConnectionResetError, BrokenPipeError):
            pass
        finally:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass

    async def connect_upstream_socks5(self, target_host: str, target_port: int):
        reader, writer = await asyncio.open_connection(self.upstream_host, self.upstream_port)
        writer.write(b"\x05\x01\x00")
        await writer.drain()
        resp = await reader.readexactly(2)
        if resp != b"\x05\x00":
            writer.close()
            await writer.wait_closed()
            raise ConnectionError("SOCKS5 auth failed")

        req = bytearray([0x05, 0x01, 0x00, 0x03, len(target_host)])
        req.extend(target_host.encode("utf-8"))
        req.extend(target_port.to_bytes(2, "big"))
        writer.write(req)
        await writer.drain()

        resp_hdr = await reader.readexactly(4)
        if resp_hdr[1] != 0x00:
            writer.close()
            await writer.wait_closed()
            raise ConnectionError(f"SOCKS5 connect error {resp_hdr[1]}")

        atyp = resp_hdr[3]
        if atyp == 0x01:
            await reader.readexactly(6)
        elif atyp == 0x03:
            l = (await reader.readexactly(1))[0]
            await reader.readexactly(l + 2)
        elif atyp == 0x04:
            await reader.readexactly(18)

        return reader, writer

    async def connect_upstream_https(self, target_host: str, target_port: int):
        ctx = ssl.create_default_context()
        if self.ignore_tls:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        reader, writer = await asyncio.open_connection(self.upstream_host, self.upstream_port, ssl=ctx)
        connect_req = f"CONNECT {target_host}:{target_port} HTTP/1.1\r\nHost: {target_host}:{target_port}\r\n\r\n".encode()
        writer.write(connect_req)
        await writer.drain()
        resp = await reader.readuntil(b"\r\n\r\n")
        if b" 200 " not in resp:
            writer.close()
            await writer.wait_closed()
            raise ConnectionError(f"HTTPS proxy rejected: {resp.splitlines()[0]}")
        return reader, writer

    async def connect_upstream_http(self, target_host: str, target_port: int):
        reader, writer = await asyncio.open_connection(self.upstream_host, self.upstream_port)
        connect_req = f"CONNECT {target_host}:{target_port} HTTP/1.1\r\nHost: {target_host}:{target_port}\r\n\r\n".encode()
        writer.write(connect_req)
        await writer.drain()
        resp = await reader.readuntil(b"\r\n\r\n")
        if b" 200 " not in resp:
            writer.close()
            await writer.wait_closed()
            raise ConnectionError(f"HTTP proxy rejected: {resp.splitlines()[0]}")
        return reader, writer

    async def handle_forwarder_client(self, client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter):
        try:
            initial_line = await asyncio.wait_for(client_reader.readline(), timeout=CONNECT_TIMEOUT)
            if not initial_line:
                client_writer.close()
                await client_writer.wait_closed()
                return

            parts = initial_line.decode("utf-8", errors="replace").split()
            if not parts:
                client_writer.close()
                await client_writer.wait_closed()
                return

            method = parts[0].upper()
            target = parts[1]

            # Read remaining headers
            headers = []
            while True:
                h = await asyncio.wait_for(client_reader.readline(), timeout=CONNECT_TIMEOUT)
                if not h or h == b"\r\n":
                    break
                headers.append(h)

            self.reload_config()

            if method == "CONNECT":
                # HTTPS Tunneling
                if ":" in target:
                    thost, tport_str = target.split(":", 1)
                    tport = int(tport_str)
                else:
                    thost, tport = target, 443

                use_proxy = self.should_proxy(thost)

                if use_proxy:
                    try:
                        if self.upstream_proto == "socks5":
                            remote_reader, remote_writer = await self.connect_upstream_socks5(thost, tport)
                        elif self.upstream_proto == "https":
                            remote_reader, remote_writer = await self.connect_upstream_https(thost, tport)
                        else:
                            remote_reader, remote_writer = await self.connect_upstream_http(thost, tport)
                    except Exception as e:
                        # Fallback to direct if upstream fails
                        remote_reader, remote_writer = await asyncio.open_connection(thost, tport)
                else:
                    remote_reader, remote_writer = await asyncio.open_connection(thost, tport)

                # Send 200 Connection Established to client
                client_writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                await client_writer.drain()

                # Bi-directional pipe
                await asyncio.gather(
                    self.pipe(client_reader, remote_writer),
                    self.pipe(remote_reader, client_writer),
                    return_exceptions=True
                )
            else:
                # Plain HTTP Request
                # Parse host from URL or headers
                target_url = target
                host_val = ""
                for h in headers:
                    if h.lower().startswith(b"host:"):
                        host_val = h.decode().split(":", 1)[1].strip()
                        break

                if host_val:
                    thost = host_val.split(":")[0]
                    tport = int(host_val.split(":")[1]) if ":" in host_val else 80
                else:
                    client_writer.close()
                    await client_writer.wait_closed()
                    return

                use_proxy = self.should_proxy(thost)

                if use_proxy:
                    remote_reader, remote_writer = await asyncio.open_connection(self.upstream_host, self.upstream_port)
                    remote_writer.write(initial_line)
                    for h in headers:
                        remote_writer.write(h)
                    remote_writer.write(b"\r\n")
                    await remote_writer.drain()
                else:
                    remote_reader, remote_writer = await asyncio.open_connection(thost, tport)
                    # Reconstruct relative request line
                    from urllib.parse import urlparse
                    parsed = urlparse(target_url)
                    rel_path = (parsed.path or "/") + (f"?{parsed.query}" if parsed.query else "")
                    new_init = f"{method} {rel_path} {parts[2]}\r\n".encode()
                    remote_writer.write(new_init)
                    for h in headers:
                        remote_writer.write(h)
                    remote_writer.write(b"\r\n")
                    await remote_writer.drain()

                await asyncio.gather(
                    self.pipe(client_reader, remote_writer),
                    self.pipe(remote_reader, client_writer),
                    return_exceptions=True
                )
        except Exception:
            pass
        finally:
            try:
                client_writer.close()
                await client_writer.wait_closed()
            except Exception:
                pass

    async def run(self):
        self.reload_config()

        # Start PAC Server
        pac_server = await asyncio.start_server(
            self.handle_pac_client,
            "127.0.0.1",
            self.pac_port
        )
        print(f"[Daemon] PAC Server listening on http://127.0.0.1:{self.pac_port}/proxy.pac")

        # Start Selective Forwarder
        fwd_server = await asyncio.start_server(
            self.handle_forwarder_client,
            "127.0.0.1",
            self.forwarder_port
        )
        print(f"[Daemon] Forwarder proxy listening on 127.0.0.1:{self.forwarder_port}")

        async with pac_server, fwd_server:
            while True:
                await asyncio.sleep(5.0)
                self.reload_config()

def main():
    daemon = ProxyRouterDaemon()
    try:
        asyncio.run(daemon.run())
    except KeyboardInterrupt:
        pass
    finally:
        PID_FILE.unlink(missing_ok=True)

if __name__ == "__main__":
    main()
