#!/usr/bin/env bash
# ==============================================================================
# One-Click Automated Deployment Script: GOST v3 + nftables + Whitelist API + TG Bot
# Supported OS: Ubuntu 20.04/22.04/24.04, Debian 11/12
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${CYAN}[DEPLOY]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# 1. Root check
if [[ $EUID -ne 0 ]]; then
    error "Этот скрипт должен выполняться от имени root (sudo -i)."
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log "================================================================"
log " Proxy Router Server: Миграция со Squid на GOST v3 + nftables"
log "================================================================"

# 2. Установка системных зависимостей
log "Обновление репозиториев и установка системных пакетов..."
apt-get update -y
PKGS=(curl tar openssl nftables ca-certificates python3 python3-pip)
apt-get install -y --no-install-recommends "${PKGS[@]}"

if ! command -v node &>/dev/null; then
    apt-get install -y --no-install-recommends nodejs || true
fi
if ! command -v npm &>/dev/null; then
    apt-get install -y --no-install-recommends npm || true
fi

# 3. Остановка и отключение старых сервисов Squid и старого бота
if systemctl is-active --quiet squid 2>/dev/null || systemctl is-enabled --quiet squid 2>/dev/null; then
    warn "Обнаружен работающий Squid. Останавливаем и отключаем его..."
    systemctl stop squid || true
    systemctl disable squid || true
    success "Squid успешно остановлен. Порт 3128 освобожден."
fi

if systemctl is-active --quiet squid-bot 2>/dev/null || systemctl is-enabled --quiet squid-bot 2>/dev/null; then
    warn "Обнаружен старый сервис squid-bot. Останавливаем и отключаем его..."
    systemctl stop squid-bot || true
    systemctl disable squid-bot || true
    success "Старый squid-bot отключен."
fi

if command -v pm2 &>/dev/null; then
    if pm2 list 2>/dev/null | grep -q "proxy-router-api"; then
        warn "Обнаружен дубликат API в PM2. Удаляем из PM2..."
        pm2 delete proxy-router-api || true
        pm2 save || true
        success "Старый API удален из PM2."
    fi
fi

# 4. Сохранение и перенос существующих IP-адресов
mkdir -p /etc/gost /etc/gost/certs
if [[ -f /etc/squid/whitelist.txt && ! -s /etc/gost/whitelist.txt ]]; then
    log "Миграция существующего белого списка из /etc/squid/whitelist.txt..."
    cp /etc/squid/whitelist.txt /etc/gost/whitelist.txt
    success "Существующие IP успешно перенесены в /etc/gost/whitelist.txt"
else
    touch /etc/gost/whitelist.txt
fi

# 5. Установка бинарника GOST v3
ARCH="$(uname -m)"
case "$ARCH" in
    x86_64)  GOST_ARCH="linux_amd64" ;;
    aarch64) GOST_ARCH="linux_arm64" ;;
    armv7l)  GOST_ARCH="linux_armv7" ;;
    *) error "Неподдерживаемая архитектура процессора: $ARCH" ;;
esac

log "Загрузка официального бинарника GOST v3 ($GOST_ARCH)..."
GOST_VERSION="3.0.0"
GOST_URL="https://github.com/go-gost/gost/releases/download/v${GOST_VERSION}/gost_${GOST_VERSION}_${GOST_ARCH}.tar.gz"

TMP_DIR="$(mktemp -d)"
if curl -fsSL --connect-timeout 10 "$GOST_URL" -o "$TMP_DIR/gost.tar.gz"; then
    tar -xzf "$TMP_DIR/gost.tar.gz" -C "$TMP_DIR"
    install -m 755 "$TMP_DIR/gost" /usr/local/bin/gost
    rm -rf "$TMP_DIR"
    success "GOST v3 установлен в /usr/local/bin/gost ($(gost -V 2>/dev/null || echo 'v3'))"
else
    error "Не удалось скачать GOST с GitHub. Проверьте интернет-соединение сервера."
fi

# 6. Установка скрипта управления вайтлистом (ip_manager.sh)
log "Установка ip_manager.sh в /usr/local/bin..."
install -m 755 "$SCRIPT_DIR/ip_manager.sh" /usr/local/bin/ip_manager.sh
# Симлинк для обратной совместимости со старыми скриптами
mkdir -p /opt/squid-bot
ln -sf /usr/local/bin/ip_manager.sh /opt/squid-bot/ip_manager.sh

# 7. Генерация самоподписанного TLS-сертификата для HTTPS-прокси (порт 8443)
if [[ ! -f /etc/gost/certs/cert.pem || ! -f /etc/gost/certs/key.pem ]]; then
    log "Генерация самоподписанного сертификата TLS для HTTPS-прокси (:8443)..."
    openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
        -keyout /etc/gost/certs/key.pem \
        -out /etc/gost/certs/cert.pem \
        -subj "/CN=proxy-router-node/O=ProxyRouter" 2>/dev/null
    chmod 600 /etc/gost/certs/key.pem
    success "TLS-сертификаты созданы в /etc/gost/certs/"
fi

# 8. Копирование конфигурации GOST
log "Копирование конфигурации /etc/gost/gost.yaml..."
cp "$SCRIPT_DIR/gost.yaml" /etc/gost/gost.yaml

# 9. Настройка nftables фаервола
log "Настройка фаервола nftables (Stealth Whitelist)..."
install -m 644 "$SCRIPT_DIR/nftables.conf" /etc/nftables.conf
systemctl enable nftables
systemctl restart nftables || true
# Загрузка сохраненных IP в память ядра
/usr/local/bin/ip_manager.sh restore || true
success "Фаервол nftables настроен: порты 3128, 8443, 1080 скрыты от сканеров."

# 10. Установка Node.js Whitelist API
log "Настройка микросервиса Whitelist API в /opt/proxy-whitelist-api..."
mkdir -p /opt/proxy-whitelist-api /opt/proxy-whitelist-api/logs
cp "$SCRIPT_DIR/index.js" /opt/proxy-whitelist-api/
cp "$SCRIPT_DIR/package.json" /opt/proxy-whitelist-api/
if [[ -f "$SCRIPT_DIR/tokens.json" ]]; then
    cp "$SCRIPT_DIR/tokens.json" /opt/proxy-whitelist-api/
elif [[ ! -f /opt/proxy-whitelist-api/tokens.json ]]; then
    for candidate in /opt/proxy-router-api/tokens.json /opt/proxy-whitelist/tokens.json /opt/squid-bot/tokens.json "$SCRIPT_DIR/tokens.json.example"; do
        if [[ -f "$candidate" ]]; then
            cp "$candidate" /opt/proxy-whitelist-api/tokens.json
            break
        fi
    done
fi

(cd /opt/proxy-whitelist-api && npm install --omit=dev --silent)
success "Whitelist API настроен."

# 11. Настройка Telegram-бота (если файлы присутствуют)
if [[ -d "$SCRIPT_DIR/tg-bot" && -f "$SCRIPT_DIR/tg-bot/bot.py" ]]; then
    log "Настройка Telegram-бота в /opt/proxy-tg-bot..."
    mkdir -p /opt/proxy-tg-bot
    cp -r "$SCRIPT_DIR/tg-bot/"* /opt/proxy-tg-bot/
    pip3 install -r /opt/proxy-tg-bot/requirements.txt --break-system-packages 2>/dev/null || pip3 install -r /opt/proxy-tg-bot/requirements.txt || true
    success "Telegram-бот установлен."
fi

# 12. Регистрация и запуск systemd служб
log "Установка systemd юнитов..."
cp "$SCRIPT_DIR/systemd/gost.service" /etc/systemd/system/
cp "$SCRIPT_DIR/systemd/whitelist-api.service" /etc/systemd/system/
if [[ -f "$SCRIPT_DIR/systemd/tg-bot.service" ]]; then
    cp "$SCRIPT_DIR/systemd/tg-bot.service" /etc/systemd/system/
fi

systemctl daemon-reload
systemctl enable --now gost.service
systemctl enable --now whitelist-api.service
if [[ -f /etc/systemd/system/tg-bot.service ]]; then
    systemctl enable --now tg-bot.service || true
fi

log "================================================================"
success "ГОТОВО! Сервер успешно переведен на GOST v3 + nftables!"
log "================================================================"
echo -e "• ${GREEN}GOST v3:${NC} слушает порты 3128 (HTTP), 8443 (HTTPS/TLS), 1080 (SOCKS5)"
echo -e "• ${GREEN}Фаервол:${NC} порты открываются моментально (0.001с) только для белого списка"
echo -e "• ${GREEN}Whitelist API:${NC} работает на порту 1135 (POST /api/whitelist)"
echo -e "• ${GREEN}Проверка статуса служб:${NC}"
echo "    systemctl status gost"
echo "    systemctl status whitelist-api"
echo "    systemctl status tg-bot"
echo -e "• ${GREEN}Просмотр белого списка в ядре:${NC}"
echo "    nft list set inet proxy_filter whitelist"
echo "    /usr/local/bin/ip_manager.sh list"
