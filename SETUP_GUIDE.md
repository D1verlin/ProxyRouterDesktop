# Полное руководство по развертыванию и настройке Proxy Router

Это исчерпывающее пошаговое руководство по полной установке и настройке всех компонентов экосистемы **Proxy Router**:
1. **Удаленный VPS сервер:** GOST v3 + ядро фильтрации nftables + Whitelist REST API.
2. **Telegram-бот:** Авторизация и добавление IP-адресов в белый список без входа по SSH.
3. **Клиент Windows:** Десктопное приложение Proxy Router Desktop (Tauri 2 + React 19).
4. **Виджет Omarchy Linux:** Виджет верхней панели с 3D кибер-планетой и CLI-утилитой `proxy_router_ctl.py`.

---

## 1. Архитектура и принцип работы

Proxy Router использует технологию **Split Tunneling** (выборочное проксирование). 
- Пакеты к обычным сайтам (банки, Госуслуги, игры, торренты, Steam) идут напрямую через вашего локального провайдера без задержек.
- Пакеты к целевым сервисам (ChatGPT, Claude, Gemini, YouTube, Discord, Notion и др.) направляются через защищенный туннель на ваш VPS.
- На VPS сервер включен режим **Stealth Whitelist** на базе `nftables`: сервер принимает трафик **только** от авторизованных IP-адресов. Любые сканирования портов извне отбрасываются ядром Linux (`DROP`) без ответа, поэтому сервер полностью невидим в интернете.

```
                    ┌───────────────────────────────────────────────┐
                    │               КЛИЕНТСКИЙ ПК                   │
                    │                                               │
                    │  [Браузеры / Приложения / Игры]              │
                    │         │                        │            │
                    │  (Прямой трафик)      (Целевые домены)        │
                    │         │                        │            │
                    └─────────┼────────────────────────┼────────────┘
                              │                        │
                              ▼                        ▼
                       [Домашний роутер]     [127.0.0.1:8182 PAC / :8183 Forwarder]
                              │                        │
                              │                 (Зашифрованный туннель)
                              │                        │
                              │                        ▼
                              │              ┌─────────────────────────────────┐
                              │              │       УДАЛЕННЫЙ СЕРВЕР VPS       │
                              │              │                                 │
                              │              │  nftables (Stealth Whitelist)   │
                              │              │   ├─ Чужой IP: DROP (тишина)    │
                              │              │   └─ Ваш IP: ACCEPT             │
                              │              │          │                      │
                              │              │          ▼                      │
                              │              │      GOST v3 Engine             │
                              │              │   (:3128 HTTP / :8443 TLS /     │
                              │              │    :1080 SOCKS5)                │
                              │              │          │                      │
                              │              └──────────┼──────────────────────┘
                              │                         │
                              ▼                         ▼
                      [Прямой интернет]       [ChatGPT / Claude / YouTube]
```

---

## 2. Развёртывание серверной части (VPS)

### Требования к серверу:
- Любой недорогой VPS за пределами РФ (Нидерланды, Германия, Финляндия, Турция, Казахстан и др.).
- ОС: **Ubuntu 20.04 / 22.04 / 24.04** или **Debian 11 / 12**.
- Память: от 512 МБ (GOST v3 + nftables потребляют менее 15 МБ RAM).

### Шаг 2.1. Автоматическая установка в 1 клик
Подключитесь к вашему VPS по SSH:
```bash
ssh root@YOUR_SERVER_IP
```

Склонируйте репозиторий и запустите скрипт автоматической установки:
```bash
git clone https://github.com/D1verlin/ProxyRouterDesktop.git /opt/proxy-router
cd /opt/proxy-router/deploy-gost
chmod +x install.sh
./install.sh
```

### Что делает скрипт установки:
1. Устанавливает бинарник **GOST v3** (`/usr/local/bin/gost`) с поддержкой HTTP, HTTPS (TLS) и SOCKS5.
2. Генерирует самоподписанный TLS-сертификат для шифрованного HTTPS-прокси на порту `8443`.
3. Развертывает скрипт ядра `/usr/local/bin/ip_manager.sh` для атомарного управления белым списком `nftables`.
4. Запускает **Whitelist REST API** на порту `1135` и использует токены авторизации из `/opt/proxy-whitelist-api/tokens.json`.
5. Настраивает и запускает systemd-службы с автозапуском:
   - `gost.service` (движок прокси)
   - `whitelist-api.service` (REST API для клиентов)
   - `nftables.service` (защита сетевого стека)

### Шаг 2.2. Сохранение данных подключения
После завершения установки в терминале отобразится блок с данными:
```
================================================================
 Установка успешно завершена!
 Данные для подключения клиентов:
   IP сервера:     YOUR_SERVER_IP
   HTTP-прокси:    порт 3128
   HTTPS (TLS):    порт 8443
   SOCKS5-прокси:  порт 1080
   API URL:        http://YOUR_SERVER_IP:1135
   Auth Token:     YOUR_GENERATED_SECRET_TOKEN
================================================================
```
Сохраните `IP сервера`, `Порты` и `Auth Token` — они понадобятся для настройки Windows-клиента и Omarchy-виджета.

---

## 3. Настройка Telegram-бота для вайтлиста (Опционально)

Telegram-бот позволяет авторизовывать новые IP-адреса (например, с мобильного телефона или ноутбука в кафе) одним нажатием кнопки, без открытия SSH.

### Шаг 3.1. Создание бота в Telegram
1. Откройте в Telegram официального бота [@BotFather](https://t.me/BotFather) и отправьте команду `/newbot`.
2. Задайте имя и юзернейм для бота, скопируйте полученный `BOT_TOKEN`.
3. Узнайте свой Telegram ID через бота [@userinfobot](https://t.me/userinfobot).

### Шаг 3.2. Настройка конфигурации на сервере
Перейдите в директорию бота на сервере:
```bash
cd /opt/proxy-router/deploy-gost/tg-bot
cp .env.example .env
nano .env
```
Заполните параметры:
```ini
BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ
ADMIN_IDS=123456789
SERVER_HOST=YOUR_SERVER_IP
WEB_PORT=8080
```
Сохраните файл (`Ctrl+O`, затем `Enter`, выход `Ctrl+X`).

### Шаг 3.3. Запуск службы бота
```bash
systemctl daemon-reload
systemctl enable --now tg-bot.service
systemctl status tg-bot.service
```
Теперь в диалоге с вашим ботом доступны команды:
- `/start` — приветствие и главное меню.
- `/add_ip <IP>` — моментальное добавление IP в вайтлист сервера.
- `/my_ip` — автоматическое определение вашего текущего внешнего IP и кнопка добавления в 1 клик.
- `/status` — список активных IP в вайтлисте и проверка здоровья GOST.

---

## 4. Настройка клиента Windows (ProxyRouterDesktop)

### Шаг 4.1. Установка
1. Перейдите в раздел [Релизы GitHub](https://github.com/D1verlin/ProxyRouterDesktop/releases).
2. Скачайте установщик `ProxyRouterDesktop-Setup.exe` или портативный архив.
3. Запустите приложение.

### Шаг 4.2. Настройка подключения к VPS
1. В приложении перейдите на вкладку **Настройки (Settings)**.
2. В блоке **Сервер**:
   - **Хост сервера:** укажите `YOUR_SERVER_IP`.
   - **URL API:** `http://YOUR_SERVER_IP:1135`.
   - **Токен авторизации:** вставьте ваш `Auth Token` из шага 2.2.
   - **Протокол:** выберите `HTTP (3128)` или `SOCKS5 (1080)`.
3. Включите переключатель **Авто-вайтлист (Auto Whitelist)**:
   При каждом запуске приложение автоматически определит ваш текущий домашний IP и отправит запрос на сервер для мгновенного добавления в nftables.

### Шаг 4.3. Выбор режима проксирования
Вверху приложения доступны два режима:
- **PAC-режим (Рекомендуемый для браузеров):**  
  Создает локальный PAC-файл (`http://127.0.0.1:8182/proxy.pac`). Браузеры (Chrome, Firefox, Edge, Yandex) самостоятельно решают, какие домены пускать через прокси, а какие — напрямую.
- **Forwarder-режим (Глобальный для всех приложений):**  
  Поднимает локальный шлюз `127.0.0.1:8183`. Весь сетевой трафик приложений, не поддерживающих PAC (Discord-клиент, Telegram Desktop, Spotify, терминал), перехватывается и направляется по правилам.

---

## 5. Настройка виджета для Omarchy Linux

Для пользователей Linux (дистрибутивы Arch Linux, Omarchy, Hyprland, Sway, Quickshell) доступен нативный виджет верхней панели с интерактивной **3D Кибер-Планетой**.

### Шаг 5.1. Установка виджета
Выполните команду в терминале вашего Linux-ПК:
```bash
cd ~/projects
git clone https://github.com/D1verlin/ProxyRouterDesktop.git
cd ProxyRouterDesktop/omarchy-widget
chmod +x install.sh proxy_router_ctl.py proxy_router_daemon.py
./install.sh
```

Скрипт `install.sh`:
- Создаст символическую ссылку в `~/.config/omarchy/plugins/proxy-router`.
- Зарегистрирует виджет в топбаре Omarchy.
- Запустит фоновый локальный демон `proxy_router_daemon.py`.

### Шаг 5.2. Настройка `settings.json`
Создайте или отредактируйте конфигурационный файл:
```bash
nano ~/.config/proxy-router/settings.json
```
Пример рабочей конфигурации:
```json
{
  "isActive": false,
  "systemProxyMode": "forwarder",
  "autoWhitelist": true,
  "server": {
    "host": "YOUR_SERVER_IP",
    "apiUrl": "http://YOUR_SERVER_IP:1135",
    "authToken": "YOUR_AUTH_TOKEN",
    "protocol": "socks5",
    "port": 1080,
    "availablePorts": {
      "http": 3128,
      "https": 8443,
      "socks5": 1080
    },
    "ignoreTls": true
  },
  "pacPort": 8182,
  "forwarderPort": 8183
}
```

### Шаг 5.3. Использование виджета и 3D Планеты
- **В статус-баре Omarchy:**  
  Отображается статус: `󱂇 ON` (прокси активен), `󱂇 OFF` (выключен), `󱂇 AUTH...` (добавление в вайтлист).
  - **ЛКМ:** Открывает выпадающую панель с анимированной 3D кибер-планеткой, вращающейся в реальном времени, статусом задержки до VPS и кнопкой переключения.
  - **ПКМ:** Мгновенный коннект / дисконнект без открытия панели.
  - **СКМ:** Быстрое обновление IP и проверка вайтлиста.

### Шаг 5.4. Управление из консоли и шорткаты
```bash
# Просмотр списка сервисов и их статуса:
proxy_router_ctl.py list

# Включение / отключение отдельных маршрутов:
proxy_router_ctl.py enable gemini
proxy_router_ctl.py disable claude

# Добавление собственного домена:
proxy_router_ctl.py add-domain cursor.com

# Управление прокси из терминала:
proxy_router_ctl.py connect
proxy_router_ctl.py disconnect
proxy_router_ctl.py refresh
```

Для вызова через горячие клавиши Hyprland / Omarchy добавьте в `hyprland.conf`:
```ini
bind = $mainMod, P, exec, omarchy-shell proxy-router toggle
bind = $mainMod SHIFT, P, exec, omarchy-shell proxy-router open
```

---

## 6. Диагностика и устранение неполадок (Troubleshooting)

### Проверка статуса сервисов на VPS:
```bash
# Проверка работы GOST:
systemctl status gost.service

# Проверка REST API вайтлиста:
systemctl status whitelist-api.service

# Просмотр открытых портов (должны быть 3128, 8443, 1080, 1135):
ss -tulpn | grep -E '3128|8443|1080|1135'
```

### Проверка правил файрвола nftables:
```bash
# Просмотр активного списка разрешенных IP:
nft list set inet proxy_filter allowed_clients

# Ручное добавление своего IP в nftables:
/usr/local/bin/ip_manager.sh add YOUR_CLIENT_IP

# Ручное удаление IP:
/usr/local/bin/ip_manager.sh remove YOUR_CLIENT_IP
```

### Проверка с клиентского ПК:
```bash
# Тест доступности API:
curl -H "Authorization: Bearer YOUR_AUTH_TOKEN" http://YOUR_SERVER_IP:1135/api/status

# Тест работы прокси:
curl -x http://YOUR_SERVER_IP:3128 https://api.ipify.org
```
Если `curl` возвращает IP вашего VPS сервера — Split Tunneling работает корректно и без потерь производительности.
