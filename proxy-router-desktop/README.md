# Proxy Router Desktop

<div align="center">

![Platform](https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011%20(x64)-black?style=flat-square)
![Stack](https://img.shields.io/badge/Stack-Tauri%202%20%7C%20Rust%20%7C%20React%2019-black?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-black?style=flat-square)

**Windows-клиент для выборочного проксирования (Split Tunneling) доменов и процессов.**

[Релизы](https://github.com/D1verlin/ProxyRouterDesktop/releases) • [Серверная часть](../server/README.md) • [Баг-трекер](https://github.com/D1verlin/ProxyRouterDesktop/issues)

</div>

---

## Что это и зачем

**Proxy Router Desktop** решает проблему доступа к заблокированным и региональным сервисам (OpenAI, Anthropic Claude, Google Gemini, GitHub Copilot и др.), не замедляя весь интернет-трафик системы.

В отличие от стандартных VPN-клиентов, перенаправляющих весь сетевой поток через удаленный сервер, приложение маршрутизирует через прокси **только указанные домены и исполняемые файлы**, оставляя остальной трафик прямым (DIRECT).

---

## Как это работает

1. **Локальный PAC-сервер**: нативный движок на Rust запускает HTTP-сервер (`http://127.0.0.1:8182/proxy.pac`), динамически формирующий правила маршрутизации.
2. **Интеграция с Windows (WinInet)**: URL PAC-файла прописывается в реестр Windows и мгновенно активируется через WinInet API без необходимости перезагружать систему или браузеры.
3. **Белый список на VPS**: клиент определяет внешний IP пользователя и отправляет его на серверный API по Bearer-токену, добавляя в список разрешенных IP для Squid.

---

## Архитектура

```mermaid
flowchart TD
    subgraph Client ["Клиент (Windows 10/11)"]
        UI["React 19 UI"]
        Tauri["Tauri Core (Rust)"]
        PAC["PAC-сервер (127.0.0.1:8182)"]
        WinInet["Windows Internet Settings (WinInet)"]
        Apps["Браузеры и приложения"]

        UI <-->|"Tauri IPC"| Tauri
        Tauri -->|"Запуск"| PAC
        Tauri -->|"Запись PAC URL"| WinInet
        WinInet -->|"Автоконфигурация"| Apps
    end

    subgraph VPS ["VPS (Squid Proxy)"]
        API["Whitelist API (Node.js)"]
        IPManager["ip_manager.sh"]
        Squid["Squid Proxy (:3128)"]

        API -->|"Вызов"| IPManager
        IPManager -->|"Обновление whitelist & reload"| Squid
    end

    Tauri -->|"1. POST /api/whitelist (IP + токен)"| API
    Apps -->|"2. Целевые домены по правилам PAC"| Squid
    Apps -->|"3. Прямой трафик (DIRECT)"| Web["Интернет"]
```

---

## Основные возможности

- **Выборочный роутинг сайтов**: добавление пользовательских доменов (включая wildcards `*.domain.com`), готовые пресеты для популярных AI-сервисов.
- **Проксирование приложений (`.exe`)**: запуск программ с системными прокси-переменными и мониторинг их процессов в реальном времени.
- **Терминалы (CLI)**: экспорт переменных `HTTP_PROXY` / `HTTPS_PROXY` в один клик для PowerShell и CMD.
- **VPS Whitelist**: автообновление белого списка IP на удаленном сервере через REST API.
- **Импорт / Экспорт профилей**: перенос настроек через компактную строку `pr://...` или файл `.json`.

---

## Быстрый старт

### Установка готового релиза
Скачайте актуальный установщик со страницы [Releases](https://github.com/D1verlin/ProxyRouterDesktop/releases):
- `Proxy Router Desktop_x64-setup.exe` (NSIS-установщик)
- `Proxy Router Desktop_x64_en-US.msi` (MSI-пакет)

### Сборка из исходников

**Требования:**
- **Node.js** ≥ 18
- **Rust** (MSVC toolchain, устанавливается через [rustup.rs](https://rustup.rs))
- **Visual Studio C++ Build Tools**

**Запуск в dev-режиме:**
```bash
# Из папки proxy-router-desktop
npm install
npm run tauri dev
```

**Сборка инсталлятора:**
```bash
npm run tauri build
```
Готовые бинарники и инсталляторы будут в `src-tauri/target/release/bundle/`.

---

## Серверная часть (VPS)

Серверный компонент управляет белым списком IP для прокси-сервера Squid. Инструкция по установке и настройке Node.js API и Squid находится в [../server/README.md](../server/README.md).

---

## Лицензия

MIT License.
