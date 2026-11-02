#!/usr/bin/env bash
# Quick installation & registration script for Omarchy Proxy Router Topbar Widget

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${HOME}/.config/omarchy/plugins/proxy-router"

echo "==> Installing Proxy Router Widget for Omarchy..."

# 1. Symlink widget into Omarchy plugins
mkdir -p "${HOME}/.config/omarchy/plugins"
ln -sfn "${SCRIPT_DIR}" "${TARGET_DIR}"
echo "✓ Symlinked plugin: ${TARGET_DIR} -> ${SCRIPT_DIR}"

# 2. Make scripts executable
chmod +x "${SCRIPT_DIR}/proxy_router_ctl.py" "${SCRIPT_DIR}/proxy_router_daemon.py"

# 3. Validate plugin manifest
omarchy plugin validate "${SCRIPT_DIR}"
echo "✓ Plugin manifest validated"

# 4. Enable plugin in Omarchy bar
omarchy plugin enable proxy-router --before antigravity
echo "✓ Enabled proxy-router in Omarchy top bar"

# 5. Initialize daemon & state
"${SCRIPT_DIR}/proxy_router_ctl.py" start-daemon
echo "✓ Daemon started & initial state cached"

# 6. Rescan plugins in shell
omarchy-shell shell rescanPlugins 2>/dev/null || true
echo "==> Installation complete! Proxy Router is now active on your top bar."
