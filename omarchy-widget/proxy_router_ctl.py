#!/usr/bin/env python3
"""
Proxy Router Controller (CLI & Backend Engine for Omarchy Topbar Widget)
Adapted from ProxyRouterDesktop (https://github.com/D1verlin/ProxyRouterDesktop)
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

DEFAULT_CONFIG = {
    "isActive": False,
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
                "apis.google.com", "accounts.google.com", "ssl.gstatic.com", "www.gstatic.com",
                "gstatic.com", "googleusercontent.com", "deepmind.google", "aistudio.google.com",
                "googleapis.com", "clients6.google.com", "ai.google.dev", "makersuite.google.com"
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
                "*.antigravity.google", "antigravity.google", "*.deepmind.google", "deepmind.google", "*.deepmind.com"
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
            # Ensure defaults for any missing keys
            for k, v in DEFAULT_CONFIG.items():
                if k not in cfg:
                    cfg[k] = v
            return cfg
    except Exception as e:
        print(f"Error loading settings.json, falling back to defaults: {e}", file=sys.stderr)
        return DEFAULT_CONFIG.copy()

def save_config(cfg: dict):
    ensure_dirs()
    target = CONFIG_DIR / "settings.json"
    with open(target, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
    # Ensure config.json points to settings.json
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
    for var in ["LD_PRELOAD", "http_proxy", "https_proxy", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"]:
        env.pop(var, None)
    return env

def get_real_public_ip(timeout=3) -> str:
    """Queries external public IPv4 without proxies"""
    services = [
        "https://api.ipify.org",
        "https://icanhazip.com",
        "https://ifconfig.me/ip",
        "https://checkip.amazonaws.com"
    ]
    env = get_direct_env()
    for s in services:
        try:
            proc = subprocess.run(
                ["curl", "-s", "--connect-timeout", str(timeout), s],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                env=env,
                timeout=timeout + 1
            )
            ip = proc.stdout.strip()
            if ip and ip.count(".") == 3 and all(p.isdigit() and 0 <= int(p) <= 255 for p in ip.split(".")):
                return ip
        except Exception:
            continue
    return ""

def is_daemon_running() -> bool:
    if not PID_FILE.exists():
        return False
    try:
        pid = int(PID_FILE.read_text().strip())
        # Check if process is alive
        os.kill(pid, 0)
        return True
    except (ValueError, OSError):
        return False

def start_daemon():
    if is_daemon_running():
        return
    ensure_dirs()
    log_file = CACHE_DIR / "daemon.log"
    with open(log_file, "a", encoding="utf-8") as out:
        proc = subprocess.Popen(
            [sys.executable, str(DAEMON_SCRIPT)],
            stdout=out,
            stderr=out,
            start_new_session=True
        )
    PID_FILE.write_text(str(proc.pid))
    time.sleep(0.3)

def stop_daemon():
    if PID_FILE.exists():
        try:
            pid = int(PID_FILE.read_text().strip())
            os.kill(pid, 15)  # SIGTERM
            time.sleep(0.3)
            try:
                os.kill(pid, 0)
                os.kill(pid, 9)  # SIGKILL if still running
            except OSError:
                pass
        except Exception:
            pass
        PID_FILE.unlink(missing_ok=True)

def apply_system_proxy(enable: bool, cfg: dict):
    """Sets GNOME / system proxy and generates env.sh"""
    mode = cfg.get("systemProxyMode", "forwarder")
    fwd_port = cfg.get("forwarderPort", 8183)
    pac_port = cfg.get("pacPort", 8182)

    if enable:
        if mode == "pac":
            pac_url = f"http://127.0.0.1:{pac_port}/proxy.pac"
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

        # Write env.sh
        env_content = f"""# Proxy Router Shell Environment
export http_proxy=http://127.0.0.1:{fwd_port}
export https_proxy=http://127.0.0.1:{fwd_port}
export all_proxy=http://127.0.0.1:{fwd_port}
export HTTP_PROXY=http://127.0.0.1:{fwd_port}
export HTTPS_PROXY=http://127.0.0.1:{fwd_port}
export ALL_PROXY=http://127.0.0.1:{fwd_port}
export no_proxy="localhost,127.0.0.1,::1,local.home"
export NO_PROXY="localhost,127.0.0.1,::1,local.home"
"""
        ENV_FILE.write_text(env_content)
    else:
        subprocess.run(["gsettings", "set", "org.gnome.system.proxy", "mode", "none"], stderr=subprocess.DEVNULL)
        subprocess.run(["gsettings", "set", "org.gnome.system.proxy.http", "enabled", "false"], stderr=subprocess.DEVNULL)
        if ENV_FILE.exists():
            ENV_FILE.unlink(missing_ok=True)

def query_vps_health(api_url: str, timeout=2.5) -> tuple[bool, int]:
    """Returns (is_healthy, latency_ms)"""
    start = time.perf_counter()
    try:
        req = urllib.request.Request(f"{api_url.rstrip('/')}/health", headers={"User-Agent": "ProxyRouter/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            elapsed = int((time.perf_counter() - start) * 1000)
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("ok", False), elapsed
    except Exception:
        return False, -1

def query_vps_whitelist(api_url: str, token: str, timeout=3) -> list:
    try:
        req = urllib.request.Request(
            f"{api_url.rstrip('/')}/api/whitelist",
            headers={
                "Authorization": f"Bearer {token}",
                "User-Agent": "ProxyRouter/1.0"
            }
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("ips", [])
    except Exception:
        return []

def add_ip_to_whitelist(api_url: str, token: str, ip: str, timeout=4) -> tuple[bool, str]:
    try:
        payload = json.dumps({"ip": ip}).encode("utf-8")
        req = urllib.request.Request(
            f"{api_url.rstrip('/')}/api/whitelist",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
                "User-Agent": "ProxyRouter/1.0"
            },
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return True, data.get("msg", "IP whitelisted")
    except urllib.error.HTTPError as e:
        return False, f"HTTP Error {e.code}: {e.reason}"
    except Exception as e:
        return False, str(e)

def delete_ip_from_whitelist(api_url: str, token: str, ip: str, timeout=4) -> tuple[bool, str]:
    try:
        payload = json.dumps({"ip": ip}).encode("utf-8")
        req = urllib.request.Request(
            f"{api_url.rstrip('/')}/api/whitelist",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
                "User-Agent": "ProxyRouter/1.0"
            },
            method="DELETE"
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return True, "IP removed from whitelist"
    except Exception as e:
        return False, str(e)

def update_status_sync(force_ip_check=False) -> dict:
    cfg = load_config()
    state = load_state()
    server = cfg.get("server", {})
    api_url = server.get("apiUrl", "")
    token = server.get("authToken", "")
    is_active = cfg.get("isActive", False)
    auto_whitelist = cfg.get("autoWhitelist", True)

    daemon_alive = is_daemon_running()

    # Public IP detection with cache expiration (re-check dynamic IP every 45s)
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

    # VPS Health and Whitelist
    vps_health, latency_ms = query_vps_health(api_url)
    whitelisted_ips = query_vps_whitelist(api_url, token) if vps_health else []
    is_whitelisted = public_ip in whitelisted_ips if (public_ip and whitelisted_ips) else False

    # Dynamic IP Auto-Whitelisting:
    # If autoWhitelist is enabled, server is healthy, token is configured, and current IP is not yet whitelisted:
    auto_enrolled = False
    if vps_health and token and public_ip and auto_whitelist and not is_whitelisted:
        ok, msg = add_ip_to_whitelist(api_url, token, public_ip)
        if ok:
            is_whitelisted = True
            auto_enrolled = True
            if public_ip not in whitelisted_ips:
                whitelisted_ips.append(public_ip)
            try:
                msg_text = f"Обнаружен новый динамический IP {public_ip}. Авторизован на VPS." if ip_changed else f"IP {public_ip} добавлен в вайтлист VPS."
                subprocess.Popen(
                    ["notify-send", "-a", "ProxyRouter", "-i", "network-vpn", "Proxy Router", msg_text],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
            except Exception:
                pass

    # Routed count
    preset_sites = cfg.get("routedSites", [])
    active_count = sum(1 for s in preset_sites if s.get("enabled", False))
    custom_domains = cfg.get("customDomains", [])
    total_routed_count = active_count + len(custom_domains)

    new_state = {
        "isActive": is_active,
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
        "upstreamHost": server.get("host", ""),
        "upstreamPort": server.get("port", 3128),
        "upstreamProtocol": server.get("protocol", "http"),
        "totalWhitelistedIps": len(whitelisted_ips),
        "whitelistedIps": whitelisted_ips,
        "activeServicesCount": active_count,
        "totalServicesCount": len(preset_sites),
        "totalCustomDomainsCount": len(custom_domains),
        "systemProxyMode": cfg.get("systemProxyMode", "forwarder"),
        "error": "" if vps_health else "VPS unreachable"
    }
    save_state(new_state)
    return new_state

# ── Command Line Handlers ───────────────────────────────────────────────────

def cmd_status(args):
    st = update_status_sync(force_ip_check=args.refresh_ip)
    if args.json:
        print(json.dumps(st, indent=2, ensure_ascii=False))
    else:
        active_str = "ACTIVE (ON)" if st["isActive"] else "INACTIVE (OFF)"
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

    # Ensure daemon is running
    if new_state:
        start_daemon()
        # Authorize IP if needed
        st = load_state()
        curr_ip = st.get("publicIp") or get_real_public_ip()
        server = cfg.get("server", {})
        if curr_ip and not st.get("isWhitelisted", False):
            add_ip_to_whitelist(server.get("apiUrl"), server.get("authToken"), curr_ip)
    apply_system_proxy(new_state, cfg)
    res = update_status_sync()
    if args.json:
        print(json.dumps({"success": True, "isActive": new_state, "state": res}))
    else:
        print(f"Proxy Router switched to: {'ACTIVE' if new_state else 'INACTIVE'}")

def cmd_whitelist(args):
    cfg = load_config()
    server = cfg.get("server", {})
    api_url = server.get("apiUrl", "")
    token = server.get("authToken", "")

    ip = args.ip or get_real_public_ip()
    if not ip:
        print(json.dumps({"success": False, "error": "Could not detect public IPv4"}))
        return

    ok, msg = add_ip_to_whitelist(api_url, token, ip)
    update_status_sync(force_ip_check=True)
    if args.json:
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

def cmd_edit_settings(args=None):
    fpath = str(CONFIG_DIR / "settings.json")
    if sys.stdout.isatty():
        editor = os.environ.get("EDITOR") or "code"
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
    if args.json:
        print(json.dumps({"success": True, "token": tok}))
    else:
        print(f"Server auth token/password set to: {tok}")

ALIAS_MAP = {
    "gemini": "gemini", "google": "gemini", "googleai": "gemini",
    "chatgpt": "chatgpt", "gpt": "chatgpt", "openai": "chatgpt",
    "claude": "claude", "anthropic": "claude",
    "antigravity": "antigravity", "deepmind": "antigravity",
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
    c_bold = "\033[1m" if is_tty else ""
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
            print(f"Все 10 AI-сервисов установлены в: {'ON (Включены)' if enabled else 'OFF (Выключены)'}")
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
    print(f"export http_proxy=http://127.0.0.1:{port} https_proxy=http://127.0.0.1:{port} all_proxy=http://127.0.0.1:{port}")

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
    if curr_ip and not st.get("isWhitelisted", False):
        add_ip_to_whitelist(server.get("apiUrl"), server.get("authToken"), curr_ip)
    apply_system_proxy(True, cfg)
    res = update_status_sync()
    if args.json:
        print(json.dumps({"success": True, "isActive": True, "state": res}))
    else:
        print("Proxy Router: CONNECTED (ON)")

def cmd_disconnect(args):
    cfg = load_config()
    cfg["isActive"] = False
    save_config(cfg)
    apply_system_proxy(False, cfg)
    res = update_status_sync()
    if args.json:
        print(json.dumps({"success": True, "isActive": False, "state": res}))
    else:
        print("Proxy Router: DISCONNECTED (OFF)")

def cmd_refresh(args):
    st = update_status_sync(force_ip_check=True)
    if args.json:
        print(json.dumps(st, indent=2, ensure_ascii=False))
    else:
        print(f"Refreshed. Public IP: {st.get('publicIp')} (Whitelisted: {st.get('isWhitelisted')}), Ping: {st.get('vpsLatencyMs')}ms")


def cmd_add_domain(args):
    cfg = load_config()
    dom = args.domain.strip().lower()
    if dom and dom not in cfg.get("customDomains", []):
        cfg.setdefault("customDomains", []).append(dom)
        save_config(cfg)
        update_status_sync()
        if args.json:
            print(json.dumps({"success": True, "domain": dom}))
        else:
            print(f"Added custom domain: {dom}")

def cmd_remove_domain(args):
    cfg = load_config()
    dom = args.domain.strip().lower()
    if dom in cfg.get("customDomains", []):
        cfg["customDomains"].remove(dom)
        save_config(cfg)
        update_status_sync()
        if args.json:
            print(json.dumps({"success": True, "domain": dom}))
        else:
            print(f"Removed custom domain: {dom}")

def cmd_launch_terminal(args):
    cfg = load_config()
    fwd_port = cfg.get("forwarderPort", 8183)
    # Detect available terminal: ghostty, foot, kitty, alacritty
    for term in ["ghostty", "foot", "kitty", "alacritty", "xterm"]:
        if subprocess.run(["which", term], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
            env = os.environ.copy()
            env["http_proxy"] = f"http://127.0.0.1:{fwd_port}"
            env["https_proxy"] = f"http://127.0.0.1:{fwd_port}"
            env["all_proxy"] = f"http://127.0.0.1:{fwd_port}"
            subprocess.Popen([term], env=env, start_new_session=True)
            print(f"Launched {term} with proxy env")
            return
    print("No supported terminal emulator found", file=sys.stderr)

def cmd_start_daemon(args):
    start_daemon()
    update_status_sync()
    print("Daemon started")

def cmd_stop_daemon(args):
    stop_daemon()
    cfg = load_config()
    cfg["isActive"] = False
    save_config(cfg)
    apply_system_proxy(False, cfg)
    update_status_sync()
    print("Daemon stopped & system proxy reset")

def main():
    # Fast path shortcuts for intuitive terminal usage:
    # proxy-router ls
    # proxy-router on <service|all>
    # proxy-router off <service|all>
    # proxy-router <service_id> (e.g. proxy-router groq)
    # proxy-router env
    # proxy-router pac
    if len(sys.argv) > 1:
        first = sys.argv[1].strip().lower()
        if first in ["ls"]:
            cmd_list_sites()
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
            # Direct service toggle: e.g. "proxy-router groq" or "proxy-router mj"
            cmd_toggle_site(first, "--json" in sys.argv)
            return

    parser = argparse.ArgumentParser(
        description="Proxy Router CLI Controller — selective AI proxy routing for Omarchy",
        epilog="Examples:\n"
               "  proxy-router on groq          # Turn ON groq\n"
               "  proxy-router off midjourney   # Turn OFF midjourney\n"
               "  proxy-router toggle claude    # Toggle claude\n"
               "  proxy-router groq             # Quick-toggle groq\n"
               "  proxy-router on all           # Enable all 10 services\n"
               "  proxy-router off all          # Disable all services\n"
               "  proxy-router list             # Show all routed services\n"
               "  proxy-router status           # Show proxy status & WAN IP\n"
               "  proxy-router connect          # Connect master proxy\n"
               "  proxy-router disconnect       # Disconnect master proxy\n"
               "  proxy-router whitelist        # Whitelist current WAN IP\n"
               "  proxy-router add notion.so    # Add custom domain\n"
               "  proxy-router del notion.so    # Remove custom domain\n",
        formatter_class=argparse.RawDescriptionHelpFormatter
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
    p_token.add_argument("token", help="Token/password string (e.g. your-secret-token)")
    p_token.add_argument("--json", action="store_true", help="Output JSON format")

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
    elif args.command == "refresh":
        cmd_refresh(args)
    elif args.command == "toggle":
        cmd_toggle(args)
    elif args.command == "whitelist":
        cmd_whitelist(args)
    elif args.command == "set-protocol":
        cmd_set_protocol(args)
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
