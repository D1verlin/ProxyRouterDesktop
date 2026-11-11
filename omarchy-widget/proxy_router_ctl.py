#!/usr/bin/env python3
"""
Proxy Router Controller (CLI & Backend Engine for Linux / Arch / Omarchy Topbar Widget)
Synchronized with ProxyRouterDesktop (https://github.com/D1verlin/ProxyRouterDesktop)
"""

import sys
import os
import json
import time
import socket
import urllib.request
import urllib.error
import subprocess
import argparse
import shlex
from pathlib import Path

# Paths
CONFIG_DIR = Path.home() / ".config" / "proxy-router"
CACHE_DIR = Path.home() / ".cache" / "proxy-router"
SETTINGS_FILE = CONFIG_DIR / "settings.json"
CONFIG_FILE = SETTINGS_FILE
STATE_FILE = CACHE_DIR / "state.json"
PID_FILE = CACHE_DIR / "daemon.pid"
ENV_FILE = CONFIG_DIR / "env.sh"
SCRIPT_DIR = Path(__file__).resolve().parent
DAEMON_SCRIPT = SCRIPT_DIR / "proxy_router_daemon.py"

# Direct opener that completely bypasses http_proxy / https_proxy env vars
DIRECT_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

NO_PROXY_LIST = "localhost,127.0.0.1,::1,local.home,*.local,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12"
PROXY_ENV_VARS = [
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "ftp_proxy",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "FTP_PROXY",
    "no_proxy",
    "NO_PROXY",
    "GRPC_PROXY",
    "grpc_proxy",
]

DEFAULT_CONFIG = {
    "isActive": False,
    "proxyMode": "split",  # "split" | "global"
    "systemProxyMode": "forwarder",  # "forwarder" | "pac" | "env_only"
    "autoWhitelist": True,
    "server": {
        "apiUrl": "",
        "authToken": "",
        "host": "",
        "protocol": "socks5",  # "socks5" | "http" | "https"
        "port": 1080,
        "availablePorts": {
            "http": 3128,
            "https": 8443,
            "socks5": 1080
        },
        "ignoreTls": True
    },
    "local": {
        "pacPort": 8182,
        "forwarderPort": 8183,
        "pacUrl": "http://127.0.0.1:8182/proxy.pac",
        "forwarderUrl": "http://127.0.0.1:8183"
    },
    "pacPort": 8182,
    "forwarderPort": 8183,
    "routedSites": [
        {
            "id": "gemini",
            "label": "Google Gemini & Studio",
            "category": "Google AI",
            "enabled": True,
            "hosts": [
                "gemini.google.com", "bard.google.com", "notebook.google", "*.notebook.google",
                "notebooklm.google", "*.notebooklm.google", "notebook.google.com", "*.notebook.google.com",
                "notebooklm.google.com", "*.notebooklm.google.com", "clientlog.cloud.google", "cloud.google",
                "proactivebackend-pa.googleapis.com", "generativelanguage.googleapis.com",
                "alkalimakersuite-pa.clients6.google.com", "alkalimakersuite-pa.googleapis.com",
                "apis.google.com", "accounts.google.com", "oauth2.googleapis.com",
                "ssl.gstatic.com", "www.gstatic.com", "gstatic.com", "googleusercontent.com",
                "deepmind.google", "aistudio.google.com", "googleapis.com", "clients6.google.com",
                "ai.google.dev", "makersuite.google.com", "stitch.withgoogle.com", "*.stitch.withgoogle.com"
            ]
        },
        {
            "id": "chatgpt",
            "label": "ChatGPT & OpenAI API",
            "category": "OpenAI",
            "enabled": True,
            "hosts": [
                "chatgpt.com", "chat.openai.com", "oaistatic.com", "oaiusercontent.com",
                "openai.com", "api.openai.com", "platform.openai.com"
            ]
        },
        {
            "id": "claude",
            "label": "Claude & Anthropic",
            "category": "Anthropic",
            "enabled": True,
            "hosts": [
                "claude.ai", "anthropic.com", "claudeusercontent.com", "api.anthropic.com", "*.anthropic.com"
            ]
        },
        {
            "id": "antigravity",
            "label": "Antigravity & DeepMind",
            "category": "Google AI",
            "enabled": True,
            "hosts": [
                "*.antigravity.google", "antigravity.google", "*.deepmind.google", "deepmind.google", "*.deepmind.com",
                "daily-cloudcode-pa.googleapis.com", "cloudcode-pa.googleapis.com", "cloudaicompanion.googleapis.com",
                "oauth2.googleapis.com", "accounts.google.com", "googleapis.com"
            ]
        },
        {
            "id": "deepl",
            "label": "DeepL Translator & Linguee",
            "category": "Inference",
            "enabled": True,
            "hosts": [
                "deepl.com", "*.deepl.com", "www.deepl.com", "api.deepl.com", "api-free.deepl.com",
                "static.deepl.com", "s.deepl.com", "w.deepl.com", "identity.deepl.com", "dict.deepl.com",
                "linguee.com", "*.linguee.com", "deepl-partners.com", "*.deepl-partners.com"
            ]
        },
        {
            "id": "perplexity",
            "label": "Perplexity AI",
            "category": "Inference",
            "enabled": True,
            "hosts": ["perplexity.ai", "*.perplexity.ai"]
        },
        {
            "id": "groq",
            "label": "Groq Cloud LPU",
            "category": "Inference",
            "enabled": False,
            "hosts": ["groq.com", "api.groq.com", "*.groq.com"]
        },
        {
            "id": "openrouter",
            "label": "OpenRouter",
            "category": "Inference",
            "enabled": False,
            "hosts": ["openrouter.ai", "*.openrouter.ai"]
        },
        {
            "id": "huggingface",
            "label": "Hugging Face Hub",
            "category": "Inference",
            "enabled": False,
            "hosts": ["huggingface.co", "*.huggingface.co", "api-inference.huggingface.co"]
        },
        {
            "id": "midjourney",
            "label": "Midjourney",
            "category": "Generative",
            "enabled": False,
            "hosts": ["midjourney.com", "*.midjourney.com"]
        }
    ],
    "customDomains": []
}


def ensure_dirs():
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)


def load_config() -> dict:
    ensure_dirs()
    target = CONFIG_DIR / "settings.json"
    if not target.exists():
        legacy = CONFIG_DIR / "config.json"
        if legacy.exists() and not legacy.is_symlink():
            try:
                with open(legacy, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                save_config(cfg)
                return cfg
            except Exception:
                pass
        save_config(DEFAULT_CONFIG)
        return DEFAULT_CONFIG.copy()
    try:
        with open(target, "r", encoding="utf-8") as f:
            cfg = json.load(f)
            for k, v in DEFAULT_CONFIG.items():
                if k not in cfg:
                    cfg[k] = v
            # Ensure config.json symlink exists for backward compatibility
            cfg_link = CONFIG_DIR / "config.json"
            if not cfg_link.exists():
                try:
                    cfg_link.symlink_to(target)
                except Exception:
                    pass
            return cfg
    except Exception as e:
        print(f"Error loading settings.json, falling back to defaults: {e}", file=sys.stderr)
        return DEFAULT_CONFIG.copy()


def save_config(cfg: dict):
    ensure_dirs()
    target = CONFIG_DIR / "settings.json"
    with open(target, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
    cfg_link = CONFIG_DIR / "config.json"
    if not cfg_link.exists() or not cfg_link.is_symlink():
        try:
            cfg_link.unlink(missing_ok=True)
            cfg_link.symlink_to(target)
        except Exception:
            pass


def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_state(state: dict):
    ensure_dirs()
    state["lastUpdated"] = time.strftime("%H:%M:%S")
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)


def get_direct_env() -> dict:
    """Env without proxies or LD_PRELOAD to check real direct WAN IP"""
    env = os.environ.copy()
    for var in ["LD_PRELOAD"] + PROXY_ENV_VARS:
        env.pop(var, None)
    return env


def is_valid_ipv4(ip: str) -> bool:
    parts = ip.strip().split(".")
    if len(parts) != 4:
        return False
    return all(p.isdigit() and 0 <= int(p) <= 255 for p in parts)


def get_real_public_ip(timeout=3) -> str:
    """Queries external public IPv4 strictly bypassing any environment or system proxies"""
    http_services = [
        "http://api.ipify.org",
        "http://icanhazip.com",
        "http://checkip.amazonaws.com",
        "https://api.ipify.org",
    ]
    for url in http_services:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "curl/8.0"})
            with DIRECT_OPENER.open(req, timeout=timeout) as resp:
                ip = resp.read().decode("utf-8", errors="ignore").strip()
                if is_valid_ipv4(ip):
                    return ip
        except Exception:
            continue

    env = get_direct_env()
    for s in ["https://api.ipify.org", "https://icanhazip.com", "https://ifconfig.me/ip"]:
        try:
            proc = subprocess.run(
                ["curl", "-4", "-s", "--noproxy", "*", "--connect-timeout", str(timeout), s],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                env=env,
                timeout=timeout + 1,
            )
            ip = proc.stdout.strip()
            if is_valid_ipv4(ip):
                return ip
        except Exception:
            continue
    return ""


def is_daemon_running() -> bool:
    if PID_FILE.exists():
        try:
            pid = int(PID_FILE.read_text().strip())
            os.kill(pid, 0)
            return True
        except (ValueError, OSError):
            pass
    # Also check if port 8182/health responds
    try:
        req = urllib.request.Request("http://127.0.0.1:8182/health")
        with DIRECT_OPENER.open(req, timeout=0.5) as resp:
            if resp.status == 200:
                return True
    except Exception:
        pass
    return False


def start_daemon():
    if is_daemon_running():
        return
    ensure_dirs()
    # Try starting systemd user service first if installed
    try:
        unit_path = Path.home() / ".config" / "systemd" / "user" / "proxy-router.service"
        if unit_path.exists():
            res = subprocess.run(
                ["systemctl", "--user", "start", "proxy-router.service"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            if res.returncode == 0:
                time.sleep(0.3)
                if is_daemon_running():
                    return
    except Exception:
        pass

    log_file = CACHE_DIR / "daemon.log"
    env = get_direct_env()
    with open(log_file, "a", encoding="utf-8") as out:
        proc = subprocess.Popen(
            [sys.executable, str(DAEMON_SCRIPT)],
            stdout=out,
            stderr=out,
            env=env,
            start_new_session=True,
        )
    PID_FILE.write_text(str(proc.pid))
    time.sleep(0.3)


def stop_daemon():
    try:
        subprocess.run(
            ["systemctl", "--user", "stop", "proxy-router.service"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass

    if PID_FILE.exists():
        try:
            pid = int(PID_FILE.read_text().strip())
            os.kill(pid, 15)
            time.sleep(0.3)
            try:
                os.kill(pid, 0)
                os.kill(pid, 9)
            except OSError:
                pass
        except Exception:
            pass
        PID_FILE.unlink(missing_ok=True)


def _sync_ide_proxy_settings(enable: bool, proxy_url: str):
    """
    Synchronizes proxy settings directly into Antigravity / VS Code / Cursor user settings.json
    on Linux so IDE extensions and Go/Node background processes route through the local forwarder
    without needing global /etc/environment hacks.
    """
    ide_configs = [
        Path.home() / ".config" / "Antigravity" / "User" / "settings.json",
    ]
    for settings_path in ide_configs:
        if not settings_path.parent.exists():
            continue
        try:
            data = {}
            if settings_path.exists():
                raw = settings_path.read_text(encoding="utf-8").strip()
                if raw:
                    data = json.loads(raw)
            if enable:
                data["http.proxy"] = proxy_url
                data["http.proxySupport"] = "override"
                data["http.proxyStrictSSL"] = False
            else:
                if data.get("http.proxy") == proxy_url or str(data.get("http.proxy", "")).startswith("http://127.0.0.1:818"):
                    data.pop("http.proxy", None)
            settings_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        except Exception:
            pass


def apply_system_proxy(enable: bool, cfg: dict):
    """Sets desktop / session proxy safely and generates env.sh"""
    mode = cfg.get("systemProxyMode", "forwarder")
    fwd_port = cfg.get("forwarderPort", 8183)
    pac_port = cfg.get("pacPort", 8182)
    proxy_url = f"http://127.0.0.1:{fwd_port}"
    pac_url = f"http://127.0.0.1:{pac_port}/proxy.pac"

    # Always remove dangerous static environment.d files that could break boot if daemon is off
    env_d = Path.home() / ".config" / "environment.d"
    for stale_name in ("proxy.conf", "proxy-router.conf"):
        stale_file = env_d / stale_name
        if stale_file.exists():
            try:
                stale_file.unlink(missing_ok=True)
            except Exception:
                pass

    if enable:
        # Ensure daemon is listening before directing traffic to it
        start_daemon()

        # 1. GNOME / GTK gsettings
        try:
            ignore_hosts = "['localhost', '127.0.0.1', '::1', '*.local', 'local.home', '192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12']"
            subprocess.run(["gsettings", "set", "org.gnome.system.proxy", "ignore-hosts", ignore_hosts], stderr=subprocess.DEVNULL)
            if mode == "pac":
                subprocess.run(["gsettings", "set", "org.gnome.system.proxy", "mode", "auto"], stderr=subprocess.DEVNULL)
                subprocess.run(["gsettings", "set", "org.gnome.system.proxy", "autoconfig-url", pac_url], stderr=subprocess.DEVNULL)
            elif mode == "forwarder":
                subprocess.run(["gsettings", "set", "org.gnome.system.proxy", "mode", "manual"], stderr=subprocess.DEVNULL)
                subprocess.run(["gsettings", "set", "org.gnome.system.proxy", "use-same-proxy", "true"], stderr=subprocess.DEVNULL)
                subprocess.run(["gsettings", "set", "org.gnome.system.proxy.http", "host", "127.0.0.1"], stderr=subprocess.DEVNULL)
                subprocess.run(["gsettings", "set", "org.gnome.system.proxy.http", "port", str(fwd_port)], stderr=subprocess.DEVNULL)
                subprocess.run(["gsettings", "set", "org.gnome.system.proxy.http", "enabled", "true"], stderr=subprocess.DEVNULL)
                subprocess.run(["gsettings", "set", "org.gnome.system.proxy.https", "host", "127.0.0.1"], stderr=subprocess.DEVNULL)
                subprocess.run(["gsettings", "set", "org.gnome.system.proxy.https", "port", str(fwd_port)], stderr=subprocess.DEVNULL)
        except Exception:
            pass

        # 2. Live systemd --user & D-Bus activation environment (for Hyprland / Omarchy GUI apps)
        try:
            env_pairs = [
                f"http_proxy={proxy_url}",
                f"https_proxy={proxy_url}",
                f"all_proxy={proxy_url}",
                f"HTTP_PROXY={proxy_url}",
                f"HTTPS_PROXY={proxy_url}",
                f"ALL_PROXY={proxy_url}",
                f"no_proxy={NO_PROXY_LIST}",
                f"NO_PROXY={NO_PROXY_LIST}",
                f"GRPC_PROXY={proxy_url}",
                f"grpc_proxy={proxy_url}",
            ]
            subprocess.run(["systemctl", "--user", "set-environment"] + env_pairs, stderr=subprocess.DEVNULL)
            subprocess.run(["dbus-update-activation-environment", "--systemd"] + env_pairs, stderr=subprocess.DEVNULL)
        except Exception:
            pass

        # 3. Configure Antigravity IDE settings.json automatically
        _sync_ide_proxy_settings(True, proxy_url)

        # 4. Write env.sh for interactive shells
        env_content = f"""# Proxy Router Shell Environment
export http_proxy="{proxy_url}"
export https_proxy="{proxy_url}"
export all_proxy="{proxy_url}"
export HTTP_PROXY="{proxy_url}"
export HTTPS_PROXY="{proxy_url}"
export ALL_PROXY="{proxy_url}"
export GRPC_PROXY="{proxy_url}"
export grpc_proxy="{proxy_url}"
export no_proxy="{NO_PROXY_LIST}"
export NO_PROXY="{NO_PROXY_LIST}"
"""
        ENV_FILE.write_text(env_content, encoding="utf-8")
    else:
        # 1. Reset GNOME / GTK proxy
        try:
            subprocess.run(["gsettings", "set", "org.gnome.system.proxy", "mode", "none"], stderr=subprocess.DEVNULL)
            subprocess.run(["gsettings", "set", "org.gnome.system.proxy.http", "enabled", "false"], stderr=subprocess.DEVNULL)
        except Exception:
            pass

        # 2. Unset live systemd --user & D-Bus proxy environment variables
        try:
            subprocess.run(["systemctl", "--user", "unset-environment"] + PROXY_ENV_VARS, stderr=subprocess.DEVNULL)
            empty_pairs = [f"{k}=" for k in PROXY_ENV_VARS]
            subprocess.run(["dbus-update-activation-environment", "--systemd"] + empty_pairs, stderr=subprocess.DEVNULL)
        except Exception:
            pass

        # 3. Clean Antigravity IDE proxy setting
        _sync_ide_proxy_settings(False, proxy_url)

        # 4. Remove env.sh
        if ENV_FILE.exists():
            ENV_FILE.unlink(missing_ok=True)


def query_vps_health(api_url: str, timeout=2.5) -> tuple[bool, int]:
    """Returns (is_healthy, latency_ms) strictly bypassing local proxy"""
    if not api_url:
        return False, -1
    start = time.perf_counter()
    try:
        req = urllib.request.Request(f"{api_url.rstrip('/')}/health", headers={"User-Agent": "ProxyRouter/1.0"})
        with DIRECT_OPENER.open(req, timeout=timeout) as resp:
            elapsed = int((time.perf_counter() - start) * 1000)
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("ok", False), elapsed
    except Exception:
        return False, -1


def query_vps_whitelist(api_url: str, token: str, timeout=3) -> list:
    if not api_url or not token:
        return []
    try:
        req = urllib.request.Request(
            f"{api_url.rstrip('/')}/api/whitelist",
            headers={
                "Authorization": f"Bearer {token}",
                "User-Agent": "ProxyRouter/1.0",
            },
        )
        with DIRECT_OPENER.open(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("ips", [])
    except Exception:
        return []


def add_ip_to_whitelist(api_url: str, token: str, ip: str, timeout=4) -> tuple[bool, str]:
    if not api_url or not token:
        return False, "Missing apiUrl or authToken in settings.json"
    try:
        payload = json.dumps({"ip": ip}).encode("utf-8")
        req = urllib.request.Request(
            f"{api_url.rstrip('/')}/api/whitelist",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
                "User-Agent": "ProxyRouter/1.0",
            },
            method="POST",
        )
        with DIRECT_OPENER.open(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return True, data.get("msg", "IP whitelisted")
    except urllib.error.HTTPError as e:
        return False, f"HTTP Error {e.code}: {e.reason}"
    except Exception as e:
        return False, str(e)


def delete_ip_from_whitelist(api_url: str, token: str, ip: str, timeout=4) -> tuple[bool, str]:
    if not api_url or not token:
        return False, "Missing apiUrl or authToken"
    try:
        payload = json.dumps({"ip": ip}).encode("utf-8")
        req = urllib.request.Request(
            f"{api_url.rstrip('/')}/api/whitelist",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
                "User-Agent": "ProxyRouter/1.0",
            },
            method="DELETE",
        )
        with DIRECT_OPENER.open(req, timeout=timeout) as resp:
            return True, "IP removed from whitelist"
    except Exception as e:
        return False, str(e)


def update_status_sync(force_ip_check=False) -> dict:
    cfg = load_config()
    state = load_state()
    server = cfg.get("server", {})
    host = server.get("host", "").strip()
    api_url = server.get("apiUrl", "").strip()
    if not api_url and host and host != "your-server-ip":
        api_url = f"http://{host}:1135"
    token = server.get("authToken", "").strip()
    is_active = cfg.get("isActive", False)
    auto_whitelist = cfg.get("autoWhitelist", True)

    daemon_alive = is_daemon_running()
    if is_active and not daemon_alive:
        start_daemon()
        daemon_alive = is_daemon_running()

    public_ip = state.get("publicIp", "")
    last_ip_check = state.get("lastIpCheck", 0)
    now = time.time()
    ip_needs_check = force_ip_check or not public_ip or (now - last_ip_check > 45)

    old_ip = public_ip
    ip_changed = False
    if ip_needs_check:
        detected = get_real_public_ip()
        if detected:
            if public_ip and detected != public_ip:
                ip_changed = True
            public_ip = detected
            state["lastIpCheck"] = now

    vps_health, latency_ms = query_vps_health(api_url)
    whitelisted_ips = query_vps_whitelist(api_url, token) if vps_health else []
    is_whitelisted = public_ip in whitelisted_ips if (public_ip and whitelisted_ips) else False

    if vps_health and token and public_ip and auto_whitelist and not is_whitelisted:
        ok, _ = add_ip_to_whitelist(api_url, token, public_ip)
        if ok:
            is_whitelisted = True
            if public_ip not in whitelisted_ips:
                whitelisted_ips.append(public_ip)
            try:
                msg_text = (
                    f"Обнаружен новый динамический IP {public_ip}. Авторизован на VPS."
                    if ip_changed
                    else f"IP {public_ip} добавлен в вайтлист VPS."
                )
                subprocess.Popen(
                    ["notify-send", "-a", "ProxyRouter", "-i", "network-vpn", "Proxy Router", msg_text],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            except Exception:
                pass

    preset_sites = cfg.get("routedSites", [])
    active_count = sum(1 for s in preset_sites if s.get("enabled", False))
    custom_domains = cfg.get("customDomains", [])

    new_state = {
        "isActive": is_active,
        "proxyMode": cfg.get("proxyMode", "split"),
        "daemonRunning": daemon_alive,
        "publicIp": public_ip,
        "previousIp": old_ip if ip_changed else state.get("previousIp", ""),
        "isWhitelisted": is_whitelisted,
        "isWhitelisting": False,
        "whitelistStatus": "success" if is_whitelisted else "unauthorized",
        "autoWhitelist": auto_whitelist,
        "lastIpCheck": state.get("lastIpCheck", now),
        "vpsHealth": vps_health,
        "vpsLatencyMs": latency_ms,
        "upstreamHost": host,
        "upstreamPort": server.get("port", 3128),
        "upstreamProtocol": server.get("protocol", "http"),
        "totalWhitelistedIps": len(whitelisted_ips),
        "whitelistedIps": whitelisted_ips,
        "activeServicesCount": active_count,
        "totalServicesCount": len(preset_sites),
        "totalCustomDomainsCount": len(custom_domains),
        "systemProxyMode": cfg.get("systemProxyMode", "forwarder"),
        "error": "" if vps_health else "VPS unreachable",
    }
    save_state(new_state)
    return new_state


# ── Command Line Handlers ───────────────────────────────────────────────────

def cmd_status(args):
    st = update_status_sync(force_ip_check=getattr(args, "refresh_ip", False))
    if getattr(args, "json", False):
        print(json.dumps(st, indent=2, ensure_ascii=False))
    else:
        active_str = f"ACTIVE (ON - {st.get('proxyMode', 'split').upper()})" if st["isActive"] else "INACTIVE (OFF)"
        health_str = f"OK ({st['vpsLatencyMs']}ms)" if st["vpsHealth"] else "OFFLINE"
        wl_str = "AUTHORIZED" if st["isWhitelisted"] else "NOT IN WHITELIST"
        auto_wl_str = "ENABLED (Dynamic Sync)" if st.get("autoWhitelist", True) else "DISABLED"
        print(f"Proxy Router:      {active_str}")
        print(f"Daemon Service:    {'RUNNING' if st['daemonRunning'] else 'STOPPED'}")
        print(f"Public WAN IP:     {st['publicIp'] or 'Unknown'} ({wl_str})")
        print(f"Dynamic Auto-WL:   {auto_wl_str}")
        print(f"VPS Server:        {st['upstreamHost']} ({health_str})")
        print(f"Upstream Protocol: {st['upstreamProtocol'].upper()} (port {st['upstreamPort']})")
        print(f"Active AI Sites:   {st['activeServicesCount']}/{st['totalServicesCount']}")
        print(f"Whitelisted IPs:   {st['totalWhitelistedIps']} total on VPS")


def cmd_toggle(args):
    cfg = load_config()
    new_state = not cfg.get("isActive", False)
    cfg["isActive"] = new_state
    save_config(cfg)

    start_daemon()
    if new_state:
        st = load_state()
        curr_ip = st.get("publicIp") or get_real_public_ip()
        server = cfg.get("server", {})
        api_url = server.get("apiUrl") or (f"http://{server.get('host')}:1135" if server.get("host") else "")
        if curr_ip and api_url:
            add_ip_to_whitelist(api_url, server.get("authToken", ""), curr_ip)
    apply_system_proxy(new_state, cfg)
    res = update_status_sync()
    if getattr(args, "json", False):
        print(json.dumps({"success": True, "isActive": new_state, "state": res}))
    else:
        print(f"Proxy Router switched to: {'ACTIVE' if new_state else 'INACTIVE'}")


def cmd_whitelist(args):
    cfg = load_config()
    server = cfg.get("server", {})
    host = server.get("host", "").strip()
    api_url = server.get("apiUrl", "").strip() or (f"http://{host}:1135" if host else "")
    token = server.get("authToken", "").strip()

    ip = getattr(args, "ip", None) or get_real_public_ip()
    if not ip:
        print(json.dumps({"success": False, "error": "Could not detect public IPv4"}))
        return

    ok, msg = add_ip_to_whitelist(api_url, token, ip)
    update_status_sync(force_ip_check=True)
    if getattr(args, "json", False):
        print(json.dumps({"success": ok, "ip": ip, "message": msg}))
    else:
        print(f"Whitelist IP {ip}: {'Success' if ok else 'Failed'} - {msg}")


def cmd_set_protocol(args):
    cfg = load_config()
    proto = args.protocol.lower()
    port_map = cfg.get("server", {}).get("availablePorts", {"http": 3128, "https": 8443, "socks5": 1080})
    if proto not in port_map:
        print(f"Invalid protocol: {proto}. Choose http, https, or socks5", file=sys.stderr)
        return
    cfg["server"]["protocol"] = proto
    cfg["server"]["port"] = port_map[proto]
    save_config(cfg)
    update_status_sync()
    if getattr(args, "json", False):
        print(json.dumps({"success": True, "protocol": proto, "port": port_map[proto]}))
    else:
        print(f"Upstream proxy protocol set to: {proto.upper()} (port {port_map[proto]})")


def cmd_set_mode(args):
    cfg = load_config()
    mode = args.mode.lower()
    if mode not in ("split", "global"):
        print("Invalid mode. Choose 'split' or 'global'", file=sys.stderr)
        return
    cfg["proxyMode"] = mode
    save_config(cfg)
    update_status_sync()
    if getattr(args, "json", False):
        print(json.dumps({"success": True, "proxyMode": mode}))
    else:
        print(f"Proxy routing mode set to: {mode.upper()}")


def cmd_edit_settings(args=None):
    fpath = str(CONFIG_DIR / "settings.json")
    if sys.stdout.isatty():
        editor = os.environ.get("EDITOR") or "nano"
        try:
            cmd = shlex.split(editor) + [fpath]
            subprocess.run(cmd)
            return
        except Exception:
            pass
    try:
        subprocess.Popen(["xdg-open", fpath])
        print(f"Открыт файл настроек: {fpath}")
    except Exception:
        print(f"Файл настроек: {fpath}")


def cmd_set_token(args):
    cfg = load_config()
    tok = args.token.strip()
    cfg.setdefault("server", {})["authToken"] = tok
    save_config(cfg)
    update_status_sync()
    if getattr(args, "json", False):
        print(json.dumps({"success": True, "token": tok}))
    else:
        print(f"Server auth token set to: {tok}")


ALIAS_MAP = {
    "gemini": "gemini", "google": "gemini", "googleai": "gemini",
    "chatgpt": "chatgpt", "gpt": "chatgpt", "openai": "chatgpt",
    "claude": "claude", "anthropic": "claude",
    "antigravity": "antigravity", "deepmind": "antigravity", "agy": "antigravity",
    "deepl": "deepl", "linguee": "deepl",
    "perplexity": "perplexity", "perp": "perplexity",
    "groq": "groq",
    "openrouter": "openrouter", "or": "openrouter",
    "huggingface": "huggingface", "hf": "huggingface",
    "midjourney": "midjourney", "mj": "midjourney",
}


def cmd_list_sites(args=None):
    cfg = load_config()
    is_tty = sys.stdout.isatty()
    c_green = "\033[1;32m" if is_tty else ""
    c_dim = "\033[2m" if is_tty else ""
    c_bold = "\033[1;34m" if is_tty else ""
    c_cyan = "\033[1;36m" if is_tty else ""
    c_reset = "\033[0m" if is_tty else ""

    print(f"{c_bold}=== Сервисы выборочного проксирования ==={c_reset}")
    for s in cfg.get("routedSites", []):
        en = s.get("enabled", False)
        st = f"{c_green}[ON]{c_reset} " if en else f"{c_dim}[OFF]{c_reset}"
        sid = s["id"]
        lbl = s["label"]
        cat = s["category"]
        print(f" {st}  {c_cyan}{sid:<14}{c_reset} : {lbl} ({cat})")
    customs = cfg.get("customDomains", [])
    if customs:
        print(f"\n{c_bold}=== Пользовательские домены ==={c_reset}")
        for d in customs:
            print(f"  * {d}")


def cmd_set_site_state(site_name: str, enabled: bool, json_output=False):
    cfg = load_config()
    site_key = site_name.strip().lower()
    if site_key == "all":
        for s in cfg.get("routedSites", []):
            s["enabled"] = enabled
        save_config(cfg)
        update_status_sync()
        if json_output:
            print(json.dumps({"success": True, "siteId": "all", "enabled": enabled}))
        else:
            print(f"Все AI-сервисы установлены в: {'ON (Включены)' if enabled else 'OFF (Выключены)'}")
        return

    target = ALIAS_MAP.get(site_key, site_key)
    found = False
    label = target
    for s in cfg.get("routedSites", []):
        if s.get("id") == target:
            s["enabled"] = enabled
            found = True
            label = s.get("label", target)
            break
    if found:
        save_config(cfg)
        update_status_sync()
        if json_output:
            print(json.dumps({"success": True, "siteId": target, "enabled": enabled}))
        else:
            state_str = "ON (Включен)" if enabled else "OFF (Выключен)"
            print(f"Сервис '{label}' [{target}] переключен в: {state_str}")
    else:
        print(f"Ошибка: сервис '{site_name}' не найден. Список сервисов: proxy-router list", file=sys.stderr)


def cmd_toggle_site(site_name: str, json_output=False):
    cfg = load_config()
    site_key = site_name.strip().lower()
    target = ALIAS_MAP.get(site_key, site_key)
    found = False
    new_state = False
    label = target
    for s in cfg.get("routedSites", []):
        if s.get("id") == target:
            new_state = not s.get("enabled", False)
            s["enabled"] = new_state
            found = True
            label = s.get("label", target)
            break
    if found:
        save_config(cfg)
        update_status_sync()
        if json_output:
            print(json.dumps({"success": True, "siteId": target, "enabled": new_state}))
        else:
            state_str = "ON (Включен)" if new_state else "OFF (Выключен)"
            print(f"Сервис '{label}' [{target}] переключен в: {state_str}")
    else:
        print(f"Ошибка: сервис '{site_name}' не найден. Список сервисов: proxy-router list", file=sys.stderr)


def cmd_enable_site(args):
    cmd_set_site_state(args.site_id, True, getattr(args, "json", False))


def cmd_disable_site(args):
    cmd_set_site_state(args.site_id, False, getattr(args, "json", False))


def cmd_env(args=None):
    cfg = load_config()
    port = cfg.get("forwarderPort", 8183)
    print(f'export http_proxy="http://127.0.0.1:{port}" https_proxy="http://127.0.0.1:{port}" all_proxy="http://127.0.0.1:{port}" no_proxy="{NO_PROXY_LIST}"')


def cmd_pac(args=None):
    cfg = load_config()
    port = cfg.get("pacPort", 8182)
    print(f"http://127.0.0.1:{port}/proxy.pac")


def cmd_connect(args):
    cfg = load_config()
    cfg["isActive"] = True
    save_config(cfg)
    start_daemon()
    st = load_state()
    curr_ip = st.get("publicIp") or get_real_public_ip()
    server = cfg.get("server", {})
    host = server.get("host", "").strip()
    api_url = server.get("apiUrl", "").strip() or (f"http://{host}:1135" if host else "")
    if curr_ip and api_url:
        add_ip_to_whitelist(api_url, server.get("authToken", ""), curr_ip)
    apply_system_proxy(True, cfg)
    res = update_status_sync()
    if getattr(args, "json", False):
        print(json.dumps({"success": True, "isActive": True, "state": res}))
    else:
        print("Proxy Router: CONNECTED (ON)")


def cmd_disconnect(args):
    cfg = load_config()
    cfg["isActive"] = False
    save_config(cfg)
    apply_system_proxy(False, cfg)
    res = update_status_sync()
    if getattr(args, "json", False):
        print(json.dumps({"success": True, "isActive": False, "state": res}))
    else:
        print("Proxy Router: DISCONNECTED (OFF)")


def cmd_rescue(args=None):
    """Emergency network recovery: clears all system proxies, environment.d files, and restarts daemon in safe pass-through mode."""
    cfg = load_config()
    cfg["isActive"] = False
    save_config(cfg)
    apply_system_proxy(False, cfg)
    stop_daemon()
    start_daemon()
    print("✓ Сетевые настройки и переменные окружения очищены (Direct mode). Фоновый шлюз перезапущен.")


def cmd_refresh(args):
    st = update_status_sync(force_ip_check=True)
    if getattr(args, "json", False):
        print(json.dumps(st, indent=2, ensure_ascii=False))
    else:
        print(f"Refreshed. Public IP: {st.get('publicIp')} (Whitelisted: {st.get('isWhitelisted')}), Ping: {st.get('vpsLatencyMs')}ms")


def cmd_add_domain(args):
    cfg = load_config()
    dom = args.domain.strip().lower().lstrip("*.").lstrip(".")
    if dom and dom not in cfg.get("customDomains", []):
        cfg.setdefault("customDomains", []).append(dom)
        save_config(cfg)
        update_status_sync()
        if getattr(args, "json", False):
            print(json.dumps({"success": True, "domain": dom}))
        else:
            print(f"Added custom domain: {dom}")


def cmd_remove_domain(args):
    cfg = load_config()
    dom = args.domain.strip().lower().lstrip("*.").lstrip(".")
    if dom in cfg.get("customDomains", []):
        cfg["customDomains"].remove(dom)
        save_config(cfg)
        update_status_sync()
        if getattr(args, "json", False):
            print(json.dumps({"success": True, "domain": dom}))
        else:
            print(f"Removed custom domain: {dom}")


def cmd_launch_terminal(args):
    cfg = load_config()
    fwd_port = cfg.get("forwarderPort", 8183)
    start_daemon()
    for term in ["ghostty", "foot", "kitty", "alacritty", "konsole", "gnome-terminal", "xterm"]:
        if subprocess.run(["which", term], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
            env = os.environ.copy()
            proxy_url = f"http://127.0.0.1:{fwd_port}"
            env["http_proxy"] = proxy_url
            env["https_proxy"] = proxy_url
            env["all_proxy"] = proxy_url
            env["HTTP_PROXY"] = proxy_url
            env["HTTPS_PROXY"] = proxy_url
            env["ALL_PROXY"] = proxy_url
            env["no_proxy"] = NO_PROXY_LIST
            env["NO_PROXY"] = NO_PROXY_LIST
            subprocess.Popen([term], env=env, start_new_session=True)
            print(f"Launched {term} with proxy env ({proxy_url})")
            return
    print("No supported terminal emulator found", file=sys.stderr)


def cmd_start_daemon(args):
    start_daemon()
    cfg = load_config()
    if not cfg.get("isActive", False):
        apply_system_proxy(False, cfg)
    update_status_sync()
    print("Daemon started")


def cmd_stop_daemon(args):
    cfg = load_config()
    cfg["isActive"] = False
    save_config(cfg)
    apply_system_proxy(False, cfg)
    stop_daemon()
    update_status_sync()
    print("Daemon stopped & system proxy reset")


def main():
    if len(sys.argv) > 1:
        first = sys.argv[1].strip().lower()
        if first in ["ls"]:
            cmd_list_sites()
            return
        elif first in ["rescue", "fix-network", "reset-network"]:
            cmd_rescue()
            return
        elif first in ["on", "enable"]:
            target = sys.argv[2] if len(sys.argv) > 2 else "all"
            cmd_set_site_state(target, True, "--json" in sys.argv)
            return
        elif first in ["off", "disable"]:
            target = sys.argv[2] if len(sys.argv) > 2 else "all"
            cmd_set_site_state(target, False, "--json" in sys.argv)
            return
        elif first in ["toggle", "switch"]:
            if len(sys.argv) > 2 and not sys.argv[2].startswith("-"):
                cmd_toggle_site(sys.argv[2], "--json" in sys.argv)
            else:
                parser_tmp = argparse.Namespace(json="--json" in sys.argv)
                cmd_toggle(parser_tmp)
            return
        elif first in ["env"]:
            cmd_env()
            return
        elif first in ["pac"]:
            cmd_pac()
            return
        elif first in ["config", "settings", "edit"]:
            cmd_edit_settings()
            return
        elif first in ALIAS_MAP:
            cmd_toggle_site(first, "--json" in sys.argv)
            return

    parser = argparse.ArgumentParser(
        description="Proxy Router CLI Controller — selective AI proxy routing for Linux & Omarchy",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command")

    p_status = subparsers.add_parser("status", help="Get current status")
    p_status.add_argument("--json", action="store_true", help="Output JSON format")
    p_status.add_argument("--refresh-ip", action="store_true", help="Force refresh public WAN IP")

    p_toggle = subparsers.add_parser("toggle", help="Toggle proxy active/inactive")
    p_toggle.add_argument("--json", action="store_true", help="Output JSON format")

    p_wl = subparsers.add_parser("whitelist", help="Authorize IP on VPS whitelist")
    p_wl.add_argument("--ip", help="Specific IP to whitelist (defaults to detected WAN IP)")
    p_wl.add_argument("--json", action="store_true", help="Output JSON format")

    p_proto = subparsers.add_parser("set-protocol", help="Set upstream protocol")
    p_proto.add_argument("protocol", choices=["http", "https", "socks5"], help="Protocol name")
    p_proto.add_argument("--json", action="store_true", help="Output JSON format")

    p_mode = subparsers.add_parser("mode", help="Set routing mode (split or global)")
    p_mode.add_argument("mode", choices=["split", "global"], help="Routing mode")
    p_mode.add_argument("--json", action="store_true", help="Output JSON format")

    p_tsite = subparsers.add_parser("toggle-site", help="Toggle a site preset")
    p_tsite.add_argument("site_id", help="Site identifier")
    p_tsite.add_argument("--json", action="store_true", help="Output JSON format")

    p_adom = subparsers.add_parser("add", help="Add custom domain (alias for add-domain)")
    p_adom.add_argument("domain", help="Domain name e.g. example.com")
    p_adom.add_argument("--json", action="store_true", help="Output JSON format")

    p_adom2 = subparsers.add_parser("add-domain", help="Add custom domain")
    p_adom2.add_argument("domain", help="Domain name e.g. example.com")
    p_adom2.add_argument("--json", action="store_true", help="Output JSON format")

    p_rdom = subparsers.add_parser("del", help="Remove custom domain (alias for remove-domain)")
    p_rdom.add_argument("domain", help="Domain name")
    p_rdom.add_argument("--json", action="store_true", help="Output JSON format")

    p_rdom2 = subparsers.add_parser("remove-domain", help="Remove custom domain")
    p_rdom2.add_argument("domain", help="Domain name")
    p_rdom2.add_argument("--json", action="store_true", help="Output JSON format")

    subparsers.add_parser("list", help="List all AI services and routed domains")
    subparsers.add_parser("ls", help="List all AI services (alias for list)")

    p_enable = subparsers.add_parser("enable", help="Enable a specific service (or 'all')")
    p_enable.add_argument("site_id", help="Service identifier (e.g. groq, claude, all)")
    p_enable.add_argument("--json", action="store_true", help="Output JSON format")

    p_on = subparsers.add_parser("on", help="Enable a specific service (or 'all')")
    p_on.add_argument("site_id", nargs="?", default="all", help="Service identifier (e.g. groq, all)")
    p_on.add_argument("--json", action="store_true", help="Output JSON format")

    p_disable = subparsers.add_parser("disable", help="Disable a specific service (or 'all')")
    p_disable.add_argument("site_id", help="Service identifier")
    p_disable.add_argument("--json", action="store_true", help="Output JSON format")

    p_off = subparsers.add_parser("off", help="Disable a specific service (or 'all')")
    p_off.add_argument("site_id", nargs="?", default="all", help="Service identifier")
    p_off.add_argument("--json", action="store_true", help="Output JSON format")

    p_conn = subparsers.add_parser("connect", help="Connect proxy")
    p_conn.add_argument("--json", action="store_true", help="Output JSON format")

    p_disc = subparsers.add_parser("disconnect", help="Disconnect proxy")
    p_disc.add_argument("--json", action="store_true", help="Output JSON format")

    p_ref = subparsers.add_parser("refresh", help="Refresh WAN IP and status")
    p_ref.add_argument("--json", action="store_true", help="Output JSON format")

    p_token = subparsers.add_parser("set-token", help="Set server auth token/password")
    p_token.add_argument("token", help="Token/password string")
    p_token.add_argument("--json", action="store_true", help="Output JSON format")

    subparsers.add_parser("rescue", help="Emergency network recovery & proxy reset")
    subparsers.add_parser("config", help="Open settings.json in text editor")
    subparsers.add_parser("settings", help="Open settings.json in text editor")
    subparsers.add_parser("edit", help="Open settings.json in text editor")
    subparsers.add_parser("env", help="Print export http_proxy commands")
    subparsers.add_parser("pac", help="Print local PAC URL")
    subparsers.add_parser("start-daemon", help="Start background proxy daemon")
    subparsers.add_parser("stop-daemon", help="Stop background proxy daemon")
    subparsers.add_parser("launch-terminal", help="Launch proxied terminal")

    args = parser.parse_args()

    if args.command == "status" or not args.command:
        cmd_status(args)
    elif args.command in ["list", "ls"]:
        cmd_list_sites(args)
    elif args.command in ["enable", "on"]:
        cmd_enable_site(args)
    elif args.command in ["disable", "off"]:
        cmd_disable_site(args)
    elif args.command == "connect":
        cmd_connect(args)
    elif args.command == "disconnect":
        cmd_disconnect(args)
    elif args.command == "rescue":
        cmd_rescue(args)
    elif args.command == "refresh":
        cmd_refresh(args)
    elif args.command == "toggle":
        cmd_toggle(args)
    elif args.command == "whitelist":
        cmd_whitelist(args)
    elif args.command == "set-protocol":
        cmd_set_protocol(args)
    elif args.command == "mode":
        cmd_set_mode(args)
    elif args.command == "set-token":
        cmd_set_token(args)
    elif args.command == "toggle-site":
        cmd_toggle_site(args.site_id, getattr(args, "json", False))
    elif args.command in ["add", "add-domain"]:
        cmd_add_domain(args)
    elif args.command in ["del", "remove-domain"]:
        cmd_remove_domain(args)
    elif args.command == "env":
        cmd_env(args)
    elif args.command == "pac":
        cmd_pac(args)
    elif args.command in ["config", "settings", "edit"]:
        cmd_edit_settings(args)
    elif args.command == "start-daemon":
        cmd_start_daemon(args)
    elif args.command == "stop-daemon":
        cmd_stop_daemon(args)
    elif args.command == "launch-terminal":
        cmd_launch_terminal(args)


if __name__ == "__main__":
    main()
