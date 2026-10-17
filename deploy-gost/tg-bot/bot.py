#!/usr/bin/env python3
"""
Proxy Router - Telegram Whitelist Bot & Quick Web Auth
Compatible with GOST v3 and Linux kernel nftables.
"""

import asyncio
import ipaddress
import os
import secrets
import subprocess
import time
from aiohttp import web
from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)

# ── Configuration ─────────────────────────────────────────────────────────────
BOT_TOKEN = os.getenv("BOT_TOKEN", "8679377235:AAEas664Uqsp9TiqOsDX0aQDXaALEqJx88Y")
ADMIN_IDS = [int(i.strip()) for i in os.getenv("ADMIN_IDS", "795925133").split(",") if i.strip()]

# Path to the universal nftables ip_manager.sh script
SCRIPT_PATH = os.getenv("IP_MANAGER_SCRIPT", "/usr/local/bin/ip_manager.sh")
if not os.path.exists(SCRIPT_PATH) and os.path.exists("/opt/squid-bot/ip_manager.sh"):
    SCRIPT_PATH = "/opt/squid-bot/ip_manager.sh"

SERVER_HOST = os.getenv("SERVER_HOST", "2.27.25.190")
WEB_PORT = int(os.getenv("WEB_PORT", "8080"))

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher(storage=MemoryStorage())

# In-memory one-time tokens for web addition: {token: {"user_id": int, "expires_at": float}}
PENDING_TOKENS = {}


# ── FSM States ────────────────────────────────────────────────────────────────
class ProxyStates(StatesGroup):
    waiting_for_add_ip = State()
    waiting_for_remove_ip = State()


# ── Keyboards ─────────────────────────────────────────────────────────────────
def main_menu_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="📋 Список IP", callback_data="list_ips"),
                InlineKeyboardButton(text="⚡ Добавить мой IP по ссылке", callback_data="get_link"),
            ],
            [
                InlineKeyboardButton(text="➕ Ввести IP вручную", callback_data="prompt_add"),
                InlineKeyboardButton(text="🗑 Удалить IP", callback_data="prompt_remove"),
            ],
            [
                InlineKeyboardButton(text="🔄 Обновить статус", callback_data="refresh"),
            ],
        ]
    )


def cancel_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="cancel")]
        ]
    )


# ── Helpers ───────────────────────────────────────────────────────────────────
def run_script(action: str, ip: str = "") -> str:
    cmd = [SCRIPT_PATH, action]
    if ip:
        cmd.append(ip)
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        return result.stdout.strip() or result.stderr.strip()
    except Exception as e:
        return f"Ошибка выполнения скрипта: {e}"


def is_admin(user_id: int) -> bool:
    return user_id in ADMIN_IDS


def is_valid_ip(ip_str: str) -> bool:
    try:
        ipaddress.ip_address(ip_str)
        return True
    except ValueError:
        return False


# ── Web Handler for One-Click IP Addition ─────────────────────────────────────
async def handle_add_ip_web(request: web.Request) -> web.Response:
    token = request.query.get("token")
    now = time.time()

    # Clean expired tokens
    expired = [t for t, data in PENDING_TOKENS.items() if data["expires_at"] < now]
    for t in expired:
        PENDING_TOKENS.pop(t, None)

    if not token or token not in PENDING_TOKENS:
        return web.Response(
            text="""<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:50px;">
            <h1 style="color:#d32f2f;">❌ Ссылка недействительна или срок её действия истек.</h1>
            <p>Запросите новую ссылку через Telegram-бота.</p></body></html>""",
            content_type="text/html",
            status=403,
        )

    user_info = PENDING_TOKENS.pop(token)
    user_id = user_info["user_id"]

    # Extract real client IP
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        client_ip = forwarded.split(",")[0].strip()
    else:
        client_ip = request.remote

    if not client_ip or not is_valid_ip(client_ip):
        return web.Response(
            text=f"<h1>⚠️ Не удалось корректно определить ваш IP: {client_ip}</h1>",
            content_type="text/html",
            status=400,
        )

    # Execute instant kernel addition via ip_manager.sh
    result = run_script("add", client_ip)

    # Notify admin in Telegram
    try:
        await bot.send_message(
            chat_id=user_id,
            text=f"🎯 **Ваш IP успешно определен:** `{client_ip}`\n\n"
                 f"✅ Результат авторизации в ядре:\n`{result}`",
            parse_mode="Markdown",
            reply_markup=main_menu_kb(),
        )
    except Exception as e:
        print(f"Ошибка отправки сообщения: {e}")

    # Success browser page
    html_page = f"""<!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>IP Авторизован</title>
        <style>
            body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 90vh; background: #0c0d0e; color: #e1e4e8; margin: 0; }}
            .card {{ background: #16181a; border: 1px solid #2a2e33; padding: 36px; border-radius: 12px; max-width: 420px; width: 90%; text-align: center; box-shadow: 0 12px 32px rgba(0,0,0,0.4); }}
            .title {{ font-size: 20px; font-weight: 600; color: #4ade80; margin-bottom: 12px; }}
            .ip {{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 18px; font-weight: 600; color: #38bdf8; background: #1e2227; padding: 8px 16px; border-radius: 6px; display: inline-block; margin: 12px 0; border: 1px solid #333942; }}
            .desc {{ font-size: 14px; color: #8b949e; line-height: 1.5; }}
        </style>
    </head>
    <body>
        <div class="card">
            <div class="title">✅ Доступ активирован!</div>
            <div class="desc">Ваш публичный IPv4 адрес:</div>
            <div class="ip">{client_ip}</div>
            <div class="desc">IP добавлен в фаервол ядра Linux (nftables). Теперь вы можете безопасно использовать прокси-туннель.</div>
        </div>
    </body>
    </html>"""
    return web.Response(text=html_page, content_type="text/html")


# ── Telegram Handlers ─────────────────────────────────────────────────────────
@dp.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        await message.answer("⛔ Доступ запрещен.")
        return
    await state.clear()
    await message.answer(
        "🛡 **Панель управления Proxy Router (GOST & nftables)**\n\n"
        "Управление быстрым белым списком IP-адресов сервера:\n"
        "• Мгновенное применение (без перезагрузки прокси)\n"
        "• Защита фаерволом (порты скрыты от сканеров)\n\n"
        "Выберите действие ниже:",
        parse_mode="Markdown",
        reply_markup=main_menu_kb(),
    )


@dp.callback_query(F.data == "get_link")
async def get_link_handler(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        return

    token = secrets.token_urlsafe(16)
    PENDING_TOKENS[token] = {
        "user_id": callback.from_user.id,
        "expires_at": time.time() + 600,
    }

    url = f"http://{SERVER_HOST}:{WEB_PORT}/add-my-ip?token={token}"

    link_kb = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🌐 Открыть и добавить мой IP", url=url)],
            [InlineKeyboardButton(text="↩️ Назад", callback_data="refresh")],
        ]
    )

    await callback.message.edit_text(
        "🔗 **Автоматическое определение и добавление IP**\n\n"
        "Перейдите по ссылке ниже с устройства, с которого планируете выходить в сеть:\n\n"
        "⏳ _Ссылка одноразовая и действует 10 минут._",
        parse_mode="Markdown",
        reply_markup=link_kb,
    )
    await callback.answer()


@dp.callback_query(F.data == "cancel")
async def cancel_handler(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    await callback.message.edit_text(
        "🛡 **Панель управления Proxy Router**\n\nДействие отменено. Выберите пункт:",
        parse_mode="Markdown",
        reply_markup=main_menu_kb(),
    )
    await callback.answer()


@dp.callback_query(F.data == "refresh")
async def refresh_handler(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    await callback.message.edit_text(
        "🛡 **Панель управления Proxy Router (GOST & nftables)**\n\nВыберите нужное действие ниже:",
        parse_mode="Markdown",
        reply_markup=main_menu_kb(),
    )
    await callback.answer("Меню обновлено")


@dp.callback_query(F.data == "list_ips")
async def list_ips_handler(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        return

    output = run_script("list")
    text = f"📋 **Текущий белый список IP (nftables):**\n\n```\n{output}\n```"
    await callback.message.edit_text(text, parse_mode="Markdown", reply_markup=main_menu_kb())
    await callback.answer()


@dp.callback_query(F.data == "prompt_add")
async def prompt_add_handler(callback: CallbackQuery, state: FSMContext):
    if not is_admin(callback.from_user.id):
        return

    await state.set_state(ProxyStates.waiting_for_add_ip)
    await callback.message.edit_text(
        "✍️ Отправьте IPv4-адрес для **добавления** в белый список:\n\n_Например: 178.120.53.202_",
        parse_mode="Markdown",
        reply_markup=cancel_kb(),
    )
    await callback.answer()


@dp.callback_query(F.data == "prompt_remove")
async def prompt_remove_handler(callback: CallbackQuery, state: FSMContext):
    if not is_admin(callback.from_user.id):
        return

    await state.set_state(ProxyStates.waiting_for_remove_ip)
    await callback.message.edit_text(
        "🗑 Отправьте IP-адрес для **удаления** из белого списка:",
        parse_mode="Markdown",
        reply_markup=cancel_kb(),
    )
    await callback.answer()


@dp.message(ProxyStates.waiting_for_add_ip)
async def process_add_ip(message: Message, state: FSMContext):
    ip = message.text.strip()
    if not is_valid_ip(ip):
        await message.answer(
            "⚠️ Некорректный IP-адрес. Попробуйте еще раз или нажмите отмену:",
            reply_markup=cancel_kb(),
        )
        return

    result = run_script("add", ip)
    await state.clear()
    await message.answer(
        f"✅ Результат добавления:\n`{result}`",
        parse_mode="Markdown",
        reply_markup=main_menu_kb(),
    )


@dp.message(ProxyStates.waiting_for_remove_ip)
async def process_remove_ip(message: Message, state: FSMContext):
    ip = message.text.strip()
    if not is_valid_ip(ip):
        await message.answer(
            "⚠️ Некорректный IP-адрес. Попробуйте еще раз или нажмите отмену:",
            reply_markup=cancel_kb(),
        )
        return

    result = run_script("remove", ip)
    await state.clear()
    await message.answer(
        f"🗑 Результат удаления:\n`{result}`",
        parse_mode="Markdown",
        reply_markup=main_menu_kb(),
    )


# ── Main Entrypoint ───────────────────────────────────────────────────────────
async def main():
    app = web.Application()
    app.router.add_get("/add-my-ip", handle_add_ip_web)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", WEB_PORT)
    await site.start()

    await bot.delete_webhook(drop_pending_updates=True)
    try:
        await dp.start_polling(bot)
    finally:
        await runner.cleanup()


if __name__ == "__main__":
    asyncio.run(main())
