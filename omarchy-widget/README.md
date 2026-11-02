# Proxy Router Desktop — Omarchy Topbar Widget

Минималистичный виджет верхней панели для **Omarchy** в точном стиле оригинального [ProxyRouterDesktop](https://github.com/D1verlin/ProxyRouterDesktop):
**3D Кибер-Планетка (Dot-Matrix Earth Sphere)**, кнопка **CONNECT / DISCONNECT** и кнопка **REFRESH**.

Все файлы виджета и бэкенда размещены в директории `~/projects/ProxyRouterDesktop/omarchy-widget/`.

---

## Что на экране

1. **В топбаре (статус-бар Omarchy)**:
   - Иконка планетка `󱂇` и статус подключения: `󱂇 ON` (активен) / `󱂇 OFF` (выключен) / `󱂇 AUTH...` (авторизация).
   - **ЛКМ**: открывает всплывающее окно с 3D мини-планеткой.
   - **ПКМ**: мгновенный коннект / дисконнект прямо из топбара.
   - **СКМ**: мгновенный рефреш IP и статуса.

2. **Всплывающее окно (Панель)**:
   - **Верх**: Статус подключения (`Прокси активен` / `Прокси отключен`).
   - **Центр**: Интерактивная **3D кибер-планетка** с континентальной матрицей точек, параболическим лучом связи «Мой ПК» ↔ «Прокси» и анимированным импульсом передачи данных. Можно вращать мышкой.
   - **Кнопка CONNECT / DISCONNECT**: большая акцентная кнопка подключения/отключения прокси.
   - **Низ**: Ваш реальный внешний IP, статус авторизации в ядре VPS (`Вайтлист ✓`), кнопка копирования IP (`󰆏`) и кнопка рефреша (`󰑮`).

---

## Управление сервисами через консоль

Всё лишнее убрано из интерфейса. Включение/выключение сервисов (Google AI, Groq, Hugging Face, OpenAI, Claude и др.) выполняется одной простой командой:

```bash
# Посмотреть список всех сервисов и их текущий статус [ON]/[OFF]:
~/projects/ProxyRouterDesktop/omarchy-widget/proxy_router_ctl.py list

# Включить / выключить сервис:
~/projects/ProxyRouterDesktop/omarchy-widget/proxy_router_ctl.py enable groq
~/projects/ProxyRouterDesktop/omarchy-widget/proxy_router_ctl.py disable deepl
~/projects/ProxyRouterDesktop/omarchy-widget/proxy_router_ctl.py enable huggingface

# Добавить свой собственный домен:
~/projects/ProxyRouterDesktop/omarchy-widget/proxy_router_ctl.py add-domain cursor.sh
~/projects/ProxyRouterDesktop/omarchy-widget/proxy_router_ctl.py remove-domain cursor.sh

# Быстрый коннект / дисконнект / рефреш из терминала:
~/projects/ProxyRouterDesktop/omarchy-widget/proxy_router_ctl.py connect
~/projects/ProxyRouterDesktop/omarchy-widget/proxy_router_ctl.py disconnect
~/projects/ProxyRouterDesktop/omarchy-widget/proxy_router_ctl.py refresh
```

---

## Управление через Omarchy IPC

Из любого места системы можно отправлять вызовы виджету:

```bash
omarchy-shell proxy-router toggle
omarchy-shell proxy-router connect
omarchy-shell proxy-router disconnect
omarchy-shell proxy-router refresh
omarchy-shell proxy-router open
omarchy-shell proxy-router close
```
