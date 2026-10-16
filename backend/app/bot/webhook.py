"""Webhook mode (SPEC §16): one Telegram update per HTTP request, for Vercel where no process runs between requests.

The same dispatcher as polling (app.bot.main), so private chats, the customer menu and silent group capture behave
the same. The bot session is opened and closed per update and carries the GroupSilence guard.
"""

from aiogram import Bot
from aiogram.types import Update

from app.bot import group_log
from app.bot import main as bot_main
from app.bot.assistant import Assistant
from app.core.config import get_settings


def make_bot() -> Bot:
    bot = Bot(get_settings().telegram_bot_token)
    bot.session.middleware(group_log.GroupSilence())
    return bot


async def handle_update(data: dict) -> None:
    if bot_main.assistant is None:
        bot_main.assistant = Assistant()
    bot = make_bot()
    try:
        await bot_main.dp.feed_update(bot, Update.model_validate(data, context={"bot": bot}))
    finally:
        await bot.session.close()
