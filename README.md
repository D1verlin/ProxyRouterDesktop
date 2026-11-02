# Proxy Router Desktop & Linux Widget

<div align="center">

![Platform](https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011%20%7C%20Linux-black?style=flat-square)
![Stack](https://img.shields.io/badge/Stack-Tauri%202%20%7C%20Rust%20%7C%20React%2019%20%7C%20QML-black?style=flat-square)
![Version](https://img.shields.io/badge/Version-v1.0.21-blue?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-black?style=flat-square)

**Высокопроизводительное решение для выборочного проксирования (Split Tunneling) доменов и процессов.**  
Поддержка **Windows** (Tauri 2 + React 19 + Rust) и **Linux** (виджет для Omarchy / Hyprland + CLI), протоколов **HTTP**, **HTTPS (TLS)**, **SOCKS5**, встроенный DNS-бенчмарк и защита доступа через ядро Linux (**nftables + GOST v3**).

[Релизы](https://github.com/D1verlin/ProxyRouterDesktop/releases) • [Виджет Omarchy (Linux)](omarchy-widget/README.md) • [Быстрый деплой сервера (GOST v3)](deploy-gost/README.md) • [Сообщить об ошибке](https://github.com/D1verlin/ProxyRouterDesktop/issues)

</div>

---

## Что это и зачем

**Proxy Router** решает проблему стабильного и быстрого доступа к заблокированным и региональным веб-сервисам (OpenAI ChatGPT, Anthropic Claude, Google Gemini, GitHub Copilot, Midjourney, Perplexity, DeepL и др.), не замедляя весь интернет-трафик системы.

В отличие от классических VPN-клиентов, которые перенаправляют абсолютно весь сетевой трафик через удаленный сервер (что создает лаги в онлайн-играх, снижает скорость торрентов и блокирует доступ к локальным ресурсам вроде Госуслуг и банков), Proxy Router маршрутизирует через защищенный прокси **только указанные домены и приложения**, оставляя весь остальной трафик прямым (`DIRECT`).

---

## Архитектура системы

```mermaid
flowchart TD
    subgraph WindowsClient ["Клиентский ПК (Windows 10/11)"]
        UI["React 19 Frontend (Dark Monolith UI)"]
        Tauri["Tauri 2 Core (Rust Async Engine)"]
        PAC["Локальный PAC-сервер (127.0.0.1:8182)"]
        Forwarder["Локальный Proxy Forwarder (127.0.0.1:8183)"]
        DNS["DNS Benchmark & Netsh Switcher"]
        WinInet["Windows Internet Settings (WinInet / Registry)"]
        WinApps["Браузеры, IDE и Desktop-приложения"]

        UI <-->|"Tauri IPC"| Tauri
        Tauri -->|"Запуск"| PAC
        Tauri -->|"Двунаправленный мост"| Forwarder
        Tauri -->|"Управление адаптерами"| DNS
        Tauri -->|"Запись PAC URL / Forwarder"| WinInet
        WinInet -->|"Автоконфигурация"| WinApps
    end

    subgraph LinuxClient ["Клиентский ПК (Linux / Omarchy / Hyprland)"]
        QML["Omarchy Topbar Widget (QML / Quickshell)"]
        Globe["Интерактивная 3D Кибер-Планетка"]
        CTL["proxy_router_ctl.py (CLI Controller)"]
        Daemon["proxy_router_daemon.py (Служба)"]
        LinuxApps["Браузеры, Shell и консольные утилиты"]

        QML <-->|"State & Commands"| CTL
        QML --- Globe
        CTL <-->|"Local PAC & Forwarder"| Daemon
        Daemon -->|"Системный прокси & env.sh"| LinuxApps
    end

    subgraph VPS ["Удаленный VPS (GOST v3 + nftables)"]
        NFT["nftables (Stealth Whitelist в ядре Linux)"]
        GOST["GOST v3 Engine"]
        API["Node.js Whitelist API (:1135)"]
        Bot["Telegram Bot & Web Auth (:8080)"]

        NFT -->|"Пакет от IP из вайтлиста"| GOST
        NFT -.->|"Пакет от чужого IP: молчаливый DROP"| Blackhole["Отброс пакетов (Stealth Mode)"]
        API -->|"Мгновенный апдейт (0.001s)"| NFT
        Bot -->|"Добавление IP по кнопке/команде"| NFT
    end

    Tauri -->|"1. POST /api/whitelist"| API
    CTL -->|"1. POST /api/whitelist"| API
    WinApps -->|"2. Выборочный трафик (HTTP / TLS / SOCKS5)"| NFT
    LinuxApps -->|"2. Выборочный трафик (HTTP / TLS / SOCKS5)"| NFT
    GOST -->|"3. Запросы к целевым сервисам"| Target["OpenAI / Claude / Copilot"]
    WinApps -->|"4. Прямой трафик (DIRECT)"| Web["Прямой доступ в Интернет"]
    LinuxApps -->|"4. Прямой трафик (DIRECT)"| Web
```

---

## Ключевые возможности

### 1. Поддержка двух экосистем: Windows и Linux
* **Windows (Desktop App)**: современный графический клиент на базе **Tauri 2 + React 19 + Rust**, поддержка тем Acrylic и Mica с кастомизацией прозрачности и размытия, трей и автозапуск.
* **Linux (Omarchy Topbar Widget)**: ультралегкий виджет верхней панели для дистрибутивов с Omarchy / Hyprland на базе Quickshell и QML, интерактивная 3D-планетка (Dot-Matrix Earth Sphere) и консольная утилита `proxy_router_ctl.py`.

### 2. Многопротокольный апстрим-прокси
Клиент поддерживает мгновенное переключение между тремя протоколами проксирования:
* **HTTP CONNECT** (порт `3128`) — проверенный стандарт для маршрутизации трафика.
* **HTTPS / TLS CONNECT** (порт `8443`) — зашифрованный туннель между ПК и вашим VPS. Скрывает SNI и заголовки от систем глубокого анализа пакетов (DPI/ТСПУ) провайдеров. Поддерживает работу с самоподписанными сертификатами.
* **SOCKS5** (порт `1080`) — бинарный протокол с полной поддержкой RFC 1928, минимальным оверхедом и высокой пропускной способностью.

### 3. Локальный форвардер и PAC-сервер
* **Локальный PAC-сервер (`127.0.0.1:8182/proxy.pac`)**: динамически генерирует PAC-скрипт с правилами фильтрации доменов на лету.
* **Локальный Proxy Forwarder (`127.0.0.1:8183`)**: асинхронный двунаправленный мост. Позволяет направлять трафик системного прокси напрямую через локальный порт, устраняя задержки парсинга PAC и сетевые таймауты.

### 4. DNS-бенчмарк и мгновенное переключение (Windows)
* Встроенный тест задержки (ping/latency) до **8 ведущих защищенных DNS-провайдеров**: Cloudflare, Google DNS, Quad9, AdGuard DNS, OpenDNS, DNS.WATCH, CleanBrowsing, Control D.
* Применение выбранного DNS в 1 клик через `netsh` на активных сетевых адаптерах (Wi-Fi, Ethernet) с возможностью отката в автоматический режим (DHCP).

### 5. Защита сервера: GOST v3 + nftables Stealth Whitelist
* **Потребление ОЗУ на сервере**: ~**15 МБ** (вместо 250–350 МБ у классического Squid).
* **Мгновенный вайтлист**: добавление IP-адреса клиента в хэш-таблицу ядра Linux `nftables` занимает **0.001 секунды** без перезагрузки служб и без обрыва активных соединений.
* **Режим невидимки (Stealth / DROP)**: неавторизованные запросы молча отбрасываются фаерволом на уровне сетевых пакетов. Для сетевых сканеров (Shodan, Censys) и ботов порты прокси выглядят полностью выключенными.
* **Telegram-бот**: привязанный бот позволяет добавлять IP-адрес со смартфона в 1 клик или через защищенную веб-страницу `/add-my-ip` с автоматическим определением IP.

### 6. Управление процессами и терминалами
* **Проксирование приложений (.exe)**: запуск выбранных программ с изоляцией и мониторингом их состояния в реальном времени.
* **Экспорт системных переменных окружения**: копирование команд настройки `HTTP_PROXY`, `HTTPS_PROXY` и `ALL_PROXY` для PowerShell, CMD, Bash, Zsh и WSL в один клик.

---

## Быстрый старт

### Windows: Установка готового приложения
1. Перейдите в раздел [Релизы (Releases)](https://github.com/D1verlin/ProxyRouterDesktop/releases).
2. Скачайте инсталлятор:
   - **`Proxy Router Desktop_1.0.21_x64-setup.exe`** (рекомендуемый NSIS-установщик)
   - или **`Proxy Router Desktop_1.0.21_x64_en-US.msi`** (пакет Windows Installer)
3. Запустите инсталлятор и откройте приложение.
4. В разделе **Settings** укажите адрес вашего сервера и токен авторизации (или импортируйте профиль).

---

### Linux: Установка виджета Omarchy (Arch / Hyprland)

Виджет интегрируется прямо в верхнюю панель **Omarchy** и управляется как графически, так и через CLI:

```bash
# 1. Перейдите в директорию виджета:
cd omarchy-widget

# 2. Запустите скрипт автоматической установки:
chmod +x install.sh
./install.sh
```

Скрипт автоматически:
- Создает симлинк плагина в `~/.config/omarchy/plugins/proxy-router`.
- Делает исполняемыми управляющие скрипты.
- Валидирует манифест плагина и включает виджет на верхней панели Omarchy.
- Запускает фоновый демон и кэширует первичное состояние.

#### Управление через консоль (`proxy_router_ctl.py`):
```bash
# Посмотреть статус подключения, внешний IP и латентность VPS:
python3 omarchy-widget/proxy_router_ctl.py status

# Список всех маршрутизируемых AI-сервисов и их статус:
python3 omarchy-widget/proxy_router_ctl.py list

# Включение / выключение сервисов:
python3 omarchy-widget/proxy_router_ctl.py enable groq
python3 omarchy-widget/proxy_router_ctl.py disable deepl

# Добавление собственного домена:
python3 omarchy-widget/proxy_router_ctl.py add-domain cursor.sh
python3 omarchy-widget/proxy_router_ctl.py remove-domain cursor.sh

# Быстрое управление подключением:
python3 omarchy-widget/proxy_router_ctl.py connect
python3 omarchy-widget/proxy_router_ctl.py disconnect
python3 omarchy-widget/proxy_router_ctl.py whitelist
```

#### Управление через Omarchy IPC:
```bash
omarchy-shell proxy-router toggle
omarchy-shell proxy-router connect
omarchy-shell proxy-router disconnect
omarchy-shell proxy-router refresh
```

Конфигурационный файл для Linux находится по пути `~/.config/proxy-router/settings.json` (шаблон доступен в корне репозитория: `settings.example.json`).

---

## Деплой серверной части

Вся серверная инфраструктура упакована в готовый комплект автоматического развертывания в папке [`deploy-gost/`](deploy-gost/README.md).

### Установка на Ubuntu / Debian за 1 минуту:
```bash
# 1. Скопируйте папку на VPS:
scp -r ./deploy-gost root@ВАШ_IP_СЕРВЕРА:/root/deploy-gost

# 2. Подключитесь по SSH и запустите установщик:
ssh root@ВАШ_IP_СЕРВЕРА
cd /root/deploy-gost
chmod +x install.sh ip_manager.sh
./install.sh
```

Скрипт автоматически:
1. Установит GOST v3 и `nftables`.
2. Мягко остановит и отключит старый Squid (освободив порт `3128`).
3. Мигрирует все существующие разрешенные IP в новую таблицу ядра.
4. Сгенерирует TLS-сертификаты для защищенного HTTPS-прокси на порту `8443`.
5. Настроит и запустит systemd-юниты: `gost.service`, `whitelist-api.service` и `tg-bot.service`.

> [!NOTE]
> Сгенерированный или настроенный токен авторизации API находится в файле `/opt/proxy-whitelist-api/tokens.json` на сервере. Вставьте его в поле **«Токен авторизации»** в настройках клиента (или в `settings.json` на Linux).

---

## Сборка Windows-клиента из исходников

### Требования к окружению
- **Node.js** ≥ 18
- **Rust & Cargo** (установка через [rustup.rs](https://rustup.rs))
- **Visual Studio C++ Build Tools** (компоненты MSVC для Windows)

### 1. Клонирование репозитория
```bash
git clone https://github.com/D1verlin/ProxyRouterDesktop.git
cd ProxyRouterDesktop
```

### 2. Запуск в dev-режиме
```bash
cd proxy-router-desktop
npm install
npm run tauri dev
```

### 3. Сборка релизного инсталлятора
```bash
npm run tauri build
```
Готовые исполняемые файлы и установщики будут сгенерированы в каталоге:  
`proxy-router-desktop/src-tauri/target/release/bundle/`

---

## Структура репозитория

```
ProxyRouterDesktop/
├── .github/workflows/          # GitHub Actions CI/CD (автоматическая сборка релизов)
├── deploy-gost/                # Полный серверный стек: GOST v3 + nftables + API + TG-бот
│   ├── gost.yaml               # Конфигурация портов GOST (HTTP :3128, TLS :8443, SOCKS5 :1080)
│   ├── nftables.conf           # Конфигурация ядра Linux со скрытым вайтлистом (Stealth DROP)
│   ├── ip_manager.sh           # Высокоскоростное управление хэш-сетом nftables (0.001s)
│   ├── index.js                # Whitelist REST API (:1135) с поддержкой токенов
│   ├── install.sh              # Скрипт автоматического развертывания в 1 клик
│   ├── systemd/                # Юниты gost.service, whitelist-api.service, tg-bot.service
│   └── tg-bot/                 # Telegram-бот с веб-авторизацией /add-my-ip
├── omarchy-widget/             # Топбар-виджет для Omarchy Linux (Arch / Hyprland)
│   ├── BarWidget.qml           # Основной компонент виджета в статус-баре
│   ├── Panel.qml               # Всплывающее окно управления с 3D-планеткой
│   ├── PlanetView.qml          # Рендерер 3D Dot-Matrix сферы Земли
│   ├── proxy_router_ctl.py     # Мощный CLI-контроллер и бэкенд для виджета
│   ├── proxy_router_daemon.py  # Локальный форвардер и PAC демон для Linux
│   ├── manifest.json           # Манифест плагина для Omarchy
│   ├── install.sh              # Скрипт быстрой установки и регистрации в Omarchy
│   └── README.md               # Документация по установке и командам виджета
├── proxy-router-desktop/       # Клиентское Windows-приложение (Tauri 2 + React 19 + Rust)
│   ├── src/                    # Интерфейс React (Dashboard, Rules, Settings, DNS Benchmark)
│   ├── src-tauri/              # Нативный бэкенд на Rust
│   │   ├── src/proxy.rs        # PAC-сервер, Forwarder (HTTP/TLS/SOCKS5), WinInet интеграция
│   │   ├── src/dns.rs          # Мониторинг и переключение сетевых DNS-адаптеров
│   │   └── Cargo.toml          # Зависимости Rust (tokio, native-tls, tauri 2)
│   ├── sidecar/pac-server.js   # Sidecar PAC-сервер
│   └── package.json            # Зависимости и скрипты сборки интерфейса
├── settings.example.json       # Шаблон конфигурации настроек для Linux/клиентов
├── server/                     # Устаревший серверный стек на базе Squid (архив)
└── README.md                   # Главная документация проекта
```

---

## Лицензия

Проект распространяется под лицензией [MIT](LICENSE).
