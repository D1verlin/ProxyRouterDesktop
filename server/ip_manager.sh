#!/usr/bin/env bash
# ip_manager.sh – Adds or removes an IP from Squid's whitelist.
# Usage:
#   ./ip_manager.sh add    <ip>
#   ./ip_manager.sh remove <ip>
#
# Environment:
#   WHITELIST_FILE  – path to squid whitelist (default: /etc/squid/whitelist.txt)
#   SQUID_BIN       – squid binary (default: squid)

set -euo pipefail

WHITELIST_FILE="${WHITELIST_FILE:-/etc/squid/whitelist.txt}"
SQUID_BIN="${SQUID_BIN:-squid}"
ACTION="${1:-}"
IP="${2:-}"

# ── Helpers ──────────────────────────────────────────────────────────────────

log() { echo "[$(date -u +%FT%TZ)] [ip_manager] $*"; }

validate_ip() {
  local ip="$1"
  if ! echo "$ip" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
    echo "ERROR: Invalid IP address: $ip" >&2
    exit 1
  fi
  IFS='.' read -r a b c d <<< "$ip"
  for octet in "$a" "$b" "$c" "$d"; do
    if (( octet > 255 )); then
      echo "ERROR: Invalid IP octet $octet in $ip" >&2
      exit 1
    fi
  done
}

reload_squid() {
  log "Reloading Squid..."
  if command -v "$SQUID_BIN" &>/dev/null; then
    sudo "$SQUID_BIN" -k reconfigure
    log "Squid reloaded."
  else
    log "WARN: squid binary not found, skipping reload."
  fi
}

# ── Validation ────────────────────────────────────────────────────────────────

if [[ -z "$ACTION" || -z "$IP" ]]; then
  echo "Usage: $0 <add|remove> <ip>" >&2
  exit 1
fi

validate_ip "$IP"

# Ensure whitelist file exists
if [[ ! -f "$WHITELIST_FILE" ]]; then
  log "Creating whitelist file: $WHITELIST_FILE"
  sudo touch "$WHITELIST_FILE"
fi

# ── Actions ───────────────────────────────────────────────────────────────────

case "$ACTION" in
  add)
    if grep -qxF "$IP" "$WHITELIST_FILE" 2>/dev/null; then
      log "IP $IP already in whitelist — skipping."
      echo "ALREADY_EXISTS"
    else
      echo "$IP" | sudo tee -a "$WHITELIST_FILE" > /dev/null
      log "IP $IP added to whitelist."
      reload_squid
      echo "ADDED"
    fi
    ;;

  remove)
    if grep -qxF "$IP" "$WHITELIST_FILE" 2>/dev/null; then
      # Use a temp file for safe in-place removal
      local_tmp=$(mktemp)
      grep -vxF "$IP" "$WHITELIST_FILE" > "$local_tmp" || true
      sudo cp "$local_tmp" "$WHITELIST_FILE"
      rm -f "$local_tmp"
      log "IP $IP removed from whitelist."
      reload_squid
      echo "REMOVED"
    else
      log "IP $IP not found in whitelist — nothing to remove."
      echo "NOT_FOUND"
    fi
    ;;

  list)
    cat "$WHITELIST_FILE" 2>/dev/null || echo ""
    ;;

  *)
    echo "ERROR: Unknown action '$ACTION'. Use add, remove, or list." >&2
    exit 1
    ;;
esac
