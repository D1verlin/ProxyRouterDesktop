# Proxy Router Desktop

<div align="center">

![Platform](https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011%20(x64)-black?style=flat-square)
![Version](https://img.shields.io/badge/Release-v1.0.0-black?style=flat-square)
![Stack](https://img.shields.io/badge/Stack-Tauri%202%20%7C%20Rust%20%7C%20React%2019-black?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-black?style=flat-square)
![CI/CD](https://img.shields.io/badge/Build-GitHub%20Actions-black?style=flat-square)

**Высокопроизводительный Windows-клиент для выборочного проксирования (Split Tunneling) целевых доменов и процессов.**

[Скачать релиз](https://github.com/D1verlin/ProxyRouterDesktop/releases) • [Документация сервера](server/README.md) • [Сообщить об ошибке](https://github.com/D1verlin/ProxyRouterDesktop/issues)

</div>

---

## О проекте

**Proxy Router Desktop** решает проблему блокировок и региональных ограничений веб-сервисов (OpenAI, Anthropic Claude, Google Gemini, GitHub Copilot и др.), не замедляя весь интернет-трафик компьютера.

В отличие от стандартных VPN-клиентов, которые перенаправляют весь трафик через удаленный сервер и увеличивают задержку для локальных ресурсов, Proxy Router маршрутизирует **только указанные домены и приложения**, оставляя остальной трафик прямым (DIRECT).

---

## Ключевые возможности

### 1. Интерактивный 3D-глобус (Vector Earth Visualizer)
- Реалистичная проекция Земли на базе картографических данных **Natural Earth 110m**: 126 континентальных контуров и 2 022 выверенные точки суши.
- Динамические узлы дата-центров (Google Gemini East, Anthropic Claude Central, OpenAI West).
- Точное сферическое позиционирование, плавная физика вращения, телеметрия пинга и статуса соединения.

### 2. Мгновенная интеграция с реестром Windows (WinInet)
- Встроенный нативный PAC-сервер на Rust (`http://127.0.0.1:8182/proxy.pac`).
- Динамическая запись конфигурации в системный реестр Windows (`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`).
- Мгновенное применение изменений через WinInet API без перезагрузки системы и браузеров.

### 3. Управление исполняемыми файлами (.exe) и процессами
- Запуск любых установленных программ (`.exe`) с наследованием системных прокси-переменных.
- Мониторинг запущенных целевых процессов в реальном времени с возможностью их принудительного завершения.

### 4. Проксирование терминалов (CLI)
- Генерация и копирование в один клик готовых команд установки переменных окружения `HTTP_PROXY` и `HTTPS_PROXY` для **PowerShell** и **Command Prompt (CMD)**.

### 5. Автоматический Whitelist на VPS
- Определение внешнего IP-адреса пользователя в реальном времени.
- Автоматическая передача IP на серверный API через зашифрованный токен авторизации для обновления списков контроля доступа (ACL) в Squid.

### 6. Быстрый перенос профилей (Export / Import)
- Экспорт настроек (API URL, токен, параметры прокси) в компактную строку `pr://...` или файл `.json`.
- Загрузка конфигурации перетаскиванием (Drag & Drop) или вставкой ключа.

### 7. Встроенная проверка обновлений и GitHub Actions CI/CD
- Проверка новых релизов через GitHub API непосредственно из окна настроек приложения.
- Полностью автоматизированная сборка Windows-инсталляторов (`.msi`, `.exe`) при каждом релизе.

---

## Архитектура системы

```mermaid
flowchart TD
    subgraph Client ["Клиентский ПК (Windows 10/11)"]
        UI["React 19 Frontend (Dark Monolith UI)"]
        Tauri["Tauri 2 Core (Rust Engine)"]
        PAC["Локальный PAC Server (127.0.0.1:8182)"]
        WinInet["Windows Internet Settings (WinInet / Registry)"]
        Apps["Браузеры и Desktop-приложения"]

        UI <-->|Tauri IPC| Tauri
        Tauri -->|Запуск| PAC
        Tauri -->|Запись PAC URL| WinInet
        WinInet -->|Автоконфигурация| Apps
    end

    subgraph VPS ["Удаленный VPS (Squid Proxy Server)"]
        API["Node.js Whitelist API (Express + PM2)"]
        IPManager["ip_manager.sh (Управление ACL)"]
        Squid["Squid HTTP/HTTPS Proxy (Порт 3128)"]

        API -->|Вызов скрипта| IPManager
        IPManager -->|Обновление whitelist.txt & reload| Squid
    end

    Tauri -->|1. POST /api/whitelist (Внешний IP + Bearer Token)| API
    Apps -->|2. Выборочный трафик по правилам PAC| Squid
    Apps -->|3. Весь остальной трафик (DIRECT)| Web["Прямой доступ в Интернет"]
```

---

## Быстрый старт

### Установка готового приложения
1. Перейдите в раздел [Релизы (Releases)](https://github.com/D1verlin/ProxyRouterDesktop/releases).
2. Скачайте последнюю версию инсталлятора:
   - **`Proxy Router Desktop_x64-setup.exe`** (стандартный установщик)
   - или **`Proxy Router Desktop_x64_en-US.msi`** (пакет Windows Installer)
3. Запустите установщик и следуйте инструкциям на экране.

---

## Сборка из исходников

### Требования к окружению:
- **Node.js** ≥ 18 (рекомендуется LTS 20+)
- **Rust & Cargo** (установка через [rustup.rs](https://rustup.rs))
- **Visual Studio C++ Build Tools** (компоненты MSVC для Windows)

### 1. Клонирование репозитория
```bash
git clone https://github.com/D1verlin/ProxyRouterDesktop.git
cd ProxyRouterDesktop
```

### 2. Установка зависимостей и запуск в dev-режиме
```bash
cd proxy-router-desktop
npm install
npm run tauri dev
```

### 3. Локальная сборка релизного инсталлятора
```bash
npm run tauri build
```
Готовые исполняемые файлы и инсталляторы будут сгенерированы в каталоге:  
`proxy-router-desktop/src-tauri/target/release/bundle/`

---

## Деплой серверной части

Серверный компонент разворачивается на Ubuntu/Debian VPS с установленным Squid.  
Подробная пошаговая инструкция доступна в файле [server/README.md](server/README.md).

Краткий алгоритм:
1. Скопируйте содержимое папки `server/` на ваш сервер.
2. Настройте конфигурацию токенов `tokens.json`.
3. Установите зависимости и запустите службу через PM2:
```bash
cd server
npm install
pm2 start ecosystem.config.js
pm2 save
```

---

## Структура репозитория

```
ProxyRouterDesktop/
├── .github/
│   └── workflows/
│       ├── release.yml         # CI/CD: автобилд инсталляторов и создание GitHub Release
│       └── ci.yml              # CI: верификация компиляции frontend и rust
├── proxy-router-desktop/       # Клиентское приложение (Tauri + React + Rust)
│   ├── src/                    # Фронтенд на React 19 (Dark Monolith UI)
│   │   ├── pages/              # Страницы: Dashboard, Sites, Apps, Logs, Settings
│   │   ├── components/         # 3D Vector Earth Visualizer, Titlebar, Sidebar
│   │   ├── store/              # Централизованный стейт (useAppStore)
│   │   └── assets/             # Векторные карты Natural Earth 110m (earthData.js)
│   ├── src-tauri/              # Нативный бэкенд на Rust
│   │   ├── src/                # Управление WinInet, PAC-сервер, реестр Windows, процессы
│   │   ├── Cargo.toml          # Зависимости и флаги сборки
│   │   └── tauri.conf.json     # Конфигурация окна, бандлера и прав доступа
│   └── package.json            # Зависимости интерфейса (Vite, React 19, Simple Icons)
├── server/                     # Серверный микросервис для VPS (Node.js + Squid ACL)
│   ├── index.js                # REST API эндпоинты авторизации и добавления IP
│   ├── ip_manager.sh           # Bash-скрипт обновления белого списка Squid
│   └── ecosystem.config.js     # Конфиг автозапуска PM2
├── scripts/
│   └── release.ps1             # Скрипт автоматизации релиза и пуша тегов
└── README.md                   # Главная документация проекта
```

---

## Лицензия

Проект распространяется под лицензией [MIT](LICENSE).
