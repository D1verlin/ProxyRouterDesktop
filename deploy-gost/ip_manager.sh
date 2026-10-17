#!/usr/bin/env bash
# ==============================================================================
# ip_manager.sh – High performance Linux kernel whitelist manager (nftables)
#
# Usage:
#   ./ip_manager.sh add     <ip>
#   ./ip_manager.sh remove  <ip>
#   ./ip_manager.sh list
#   ./ip_manager.sh restore
#   ./ip_manager.sh flush
# ==============================================================================

set -euo pipefail

WHITELIST_FILE="${WHITELIST_FILE:-/etc/gost/whitelist.txt}"
TABLE_NAME="inet proxy_filter"
SET_NAME="whitelist"

# ── Validation ────────────────────────────────────────────────────────────────
validate_ip() {
    local ip="$1"
    if ! echo "$ip" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
        echo "ERROR: Invalid IPv4 address format: $ip" >&2
        exit 1
    fi
    IFS='.' read -r a b c d <<< "$ip"
    for octet in "$a" "$b" "$c" "$d"; do
        if (( octet > 255 )); then
            echo "ERROR: Invalid octet $octet in $ip" >&2
            exit 1
        fi
    done
}

ensure_file_and_set() {
    if [[ ! -f "$WHITELIST_FILE" ]]; then
        mkdir -p "$(dirname "$WHITELIST_FILE")"
        touch "$WHITELIST_FILE"
    fi

    # Ensure nftables table and set exist in kernel
    if command -v nft &>/dev/null; then
        if ! nft list set inet proxy_filter whitelist &>/dev/null; then
            nft add table inet proxy_filter 2>/dev/null || true
            nft add set inet proxy_filter whitelist '{ type ipv4_addr; flags interval; }' 2>/dev/null || true
            nft add chain inet proxy_filter input '{ type filter hook input priority filter; }' 2>/dev/null || true
            nft add rule inet proxy_filter input ct state established,related accept 2>/dev/null || true
            nft add rule inet proxy_filter input iifname lo accept 2>/dev/null || true
            nft add rule inet proxy_filter input tcp dport '{ 3128, 8443, 1080 }' ip saddr @whitelist accept 2>/dev/null || true
            nft add rule inet proxy_filter input tcp dport '{ 3128, 8443, 1080 }' drop 2>/dev/null || true
        fi
    fi
}

ACTION="${1:-}"
IP="${2:-}"

case "$ACTION" in
    add)
        if [[ -z "$IP" ]]; then
            echo "Usage: $0 add <ip>" >&2
            exit 1
        fi
        validate_ip "$IP"
        ensure_file_and_set

        # Check if already present in persistent file
        if grep -qx "$IP" "$WHITELIST_FILE" 2>/dev/null; then
            # Ensure it is in kernel table anyway
            if command -v nft &>/dev/null; then
                nft add element inet proxy_filter whitelist "{ $IP }" 2>/dev/null || true
            fi
            echo "IP $IP is already in the whitelist."
            exit 0
        fi

        # 1. Add to kernel in-memory set (instant 0.001s, zero proxy reload)
        if command -v nft &>/dev/null; then
            nft add element inet proxy_filter whitelist "{ $IP }" 2>/dev/null || true
        elif command -v ipset &>/dev/null; then
            ipset add -exist proxy_whitelist "$IP" 2>/dev/null || true
        fi

        # 2. Persist to file
        echo "$IP" >> "$WHITELIST_FILE"
        echo "IP $IP successfully added to whitelist (instant kernel rule active)."
        ;;

    remove|del)
        if [[ -z "$IP" ]]; then
            echo "Usage: $0 remove <ip>" >&2
            exit 1
        fi
        validate_ip "$IP"
        ensure_file_and_set

        # 1. Delete from kernel in-memory set
        if command -v nft &>/dev/null; then
            nft delete element inet proxy_filter whitelist "{ $IP }" 2>/dev/null || true
        elif command -v ipset &>/dev/null; then
            ipset del -exist proxy_whitelist "$IP" 2>/dev/null || true
        fi

        # 2. Remove from persistent file
        if [[ -f "$WHITELIST_FILE" ]]; then
            sed -i "/^${IP}$/d" "$WHITELIST_FILE"
        fi
        echo "IP $IP successfully removed from whitelist."
        ;;

    list)
        ensure_file_and_set
        if [[ -s "$WHITELIST_FILE" ]]; then
            cat "$WHITELIST_FILE"
        else
            echo "Whitelist is empty."
        fi
        ;;

    restore)
        ensure_file_and_set
        count=0
        if [[ -f "$WHITELIST_FILE" ]]; then
            while IFS= read -r entry; do
                trimmed=$(echo "$entry" | xargs)
                if [[ -n "$trimmed" && ! "$trimmed" =~ ^# ]]; then
                    if command -v nft &>/dev/null; then
                        nft add element inet proxy_filter whitelist "{ $trimmed }" 2>/dev/null || true
                    fi
                    ((count++))
                fi
            done < "$WHITELIST_FILE"
        fi
        echo "Restored $count IP(s) into nftables kernel whitelist."
        ;;

    flush)
        if command -v nft &>/dev/null; then
            nft flush set inet proxy_filter whitelist 2>/dev/null || true
        fi
        if [[ -f "$WHITELIST_FILE" ]]; then
            > "$WHITELIST_FILE"
        fi
        echo "Whitelist completely flushed and cleared."
        ;;

    *)
        echo "Usage: $0 <add|remove|list|restore|flush> [IP]" >&2
        exit 1
        ;;
esac
