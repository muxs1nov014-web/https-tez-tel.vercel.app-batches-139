"""Keeps every bot user's "📱 Panel" button on a live URL.

A reply-keyboard Mini App button stores its URL on the user's device. A Cloudflare quick tunnel gets a new random
hostname whenever it restarts (the tunnel watchdog restarts it when Cloudflare drops it), so old buttons point to a
dead host. Once a minute the bot compares the current Panel URL with the last one it announced (settings table);
when it changed and the new URL answers, every active bot user gets the reply keyboard again with the new URL.
"""

import asyncio
import logging
import urllib.request

from aiogram import Bot
from aiogram.exceptions import TelegramAPIError
from sqlalchemy import select

from app.bot import customers_menu
from app.bot.webapp import current_webapp_url
from app.core.db import SessionLocal
from app.models import BotUser, Setting

log = logging.getLogger(__name__)
SETTING_KEY = "bot_announced_panel_url"  # not in services.settings.DEFAULTS, so the panel never shows it
CHECK_SECONDS = 60
ANNOUNCEMENT = (f"🔄 Panel havolasi yangilandi. Pastdagi «{customers_menu.PANEL_BUTTON}» tugmasi endi yangi manzilda "
                "ochiladi.")


def _is_live(url: str) -> bool:
    try:
        with urllib.request.urlopen(f"{url.rstrip('/')}/api/health", timeout=8) as response:
            return response.status == 200
    except (OSError, ValueError):
        return False


async def announce_if_changed(bot: Bot) -> int:
    """Send the new Panel keyboard to active bot users if the URL changed. Returns how many users got it."""
    url = await current_webapp_url()
    if url is None:
        return 0
    async with SessionLocal() as session:
        stored = await session.get(Setting, SETTING_KEY)
        if stored is not None and stored.value == url:
            return 0
        if not await asyncio.to_thread(_is_live, url):
            log.info("panel url %s not reachable yet; announcing later", url)
            return 0
        user_ids = list((await session.execute(
            select(BotUser.telegram_id).where(BotUser.is_active.is_(True)))).scalars())
        sent = 0
        for telegram_id in user_ids:
            try:
                await bot.send_message(telegram_id, ANNOUNCEMENT, reply_markup=customers_menu.main_keyboard(url))
                sent += 1
            except TelegramAPIError as exc:  # user never opened the bot, or blocked it
                log.info("panel url not delivered to %s: %s", telegram_id, exc)
        if stored is None:
            session.add(Setting(key=SETTING_KEY, value=url))
        else:
            stored.value = url
        await session.commit()
    log.info("panel url %s announced to %d of %d bot users", url, sent, len(user_ids))
    return sent


async def watch(bot: Bot) -> None:
    while True:
        try:
            await announce_if_changed(bot)
        except Exception:
            log.exception("panel url check failed")
        await asyncio.sleep(CHECK_SECONDS)
