#!/usr/bin/env bash
# Quick installation & registration script for Omarchy Proxy Router Topbar Widget & Systemd Service

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${HOME}/.config/omarchy/plugins/proxy-router"
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
SERVICE_FILE="${SYSTEMD_USER_DIR}/proxy-router.service"

echo "==> Installing Proxy Router for Linux / Omarchy..."

# 1. Remove any stale static environment.d proxy configs that can break network on boot
rm -f "${HOME}/.config/environment.d/proxy-router.conf" "${HOME}/.config/environment.d/proxy.conf" 2>/dev/null || true

# 2. Make scripts executable
chmod +x "${SCRIPT_DIR}/proxy_router_ctl.py" "${SCRIPT_DIR}/proxy_router_daemon.py"

# 3. Install and enable systemd --user service so 127.0.0.1:8183 is always alive
mkdir -p "${SYSTEMD_USER_DIR}"
cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=Proxy Router Local Split-Tunneling Forwarder & PAC Server
After=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/env python3 "${SCRIPT_DIR}/proxy_router_daemon.py"
ExecStopPost=/usr/bin/env python3 "${SCRIPT_DIR}/proxy_router_ctl.py" rescue
Restart=always
RestartSec=2
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=default.target
EOF

if command -v systemctl >/dev/null 2>&1; then
    systemctl --user daemon-reload 2>/dev/null || true
    systemctl --user enable --now proxy-router.service 2>/dev/null || true
    echo "✓ Installed & started systemd user service: ${SERVICE_FILE}"
fi

# 4. Symlink widget into Omarchy plugins (if using Omarchy)
mkdir -p "${HOME}/.config/omarchy/plugins"
ln -sfn "${SCRIPT_DIR}" "${TARGET_DIR}"
echo "✓ Symlinked plugin: ${TARGET_DIR} -> ${SCRIPT_DIR}"

if command -v omarchy >/dev/null 2>&1; then
    omarchy plugin validate "${SCRIPT_DIR}" || true
    omarchy plugin enable proxy-router --before antigravity || true
    echo "✓ Enabled proxy-router in Omarchy top bar"
fi

if command -v omarchy-shell >/dev/null 2>&1; then
    omarchy-shell shell rescanPlugins 2>/dev/null || true
fi

# 5. Ensure daemon & state are initialized
"${SCRIPT_DIR}/proxy_router_ctl.py" start-daemon
echo "==> Installation complete! Local forwarder is running on 127.0.0.1:8183."
