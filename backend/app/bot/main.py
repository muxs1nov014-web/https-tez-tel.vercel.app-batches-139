"""Telegram bot (aiogram 3, long polling). Run: python -m app.bot.main"""

import asyncio
import io
import logging

from aiogram import Bot, Dispatcher, F, Router
from aiogram.enums import ChatAction, ChatType
from aiogram.filters import CommandStart
from aiogram.types import Message, ReplyKeyboardMarkup

from app.bot import customers_menu, group_log, panel_link
from app.bot.assistant import Assistant
from app.bot.webapp import current_webapp_url
from app.core.config import get_settings
from app.core.db import SessionLocal
from app.services import telegram_notify
from app.services.users import is_bot_user_allowed

log = logging.getLogger(__name__)
TG_LIMIT = 4000

dp = Dispatcher()
# Groups only reach group_log (stores messages, never answers); everything that replies lives in `private`.
private = Router(name="private")
# The chat must be the sender's own: a forged webhook update cannot steer answers into someone else's chat.
private.message.filter(F.chat.type == ChatType.PRIVATE, lambda m: m.from_user is not None and m.chat.id == m.from_user.id)
private.callback_query.filter(lambda c: c.message is not None and c.message.chat.id == c.from_user.id)
# Free text / voice -> Gemini. Included after the customer menu router, so menu buttons never reach Gemini.
ai = Router(name="ai")
assistant: Assistant | None = None

WELCOME = (
    "Assalomu alaykum! Men TezTel — telefon import bo'yicha yordamchiman.\n"
    "Savolni yozing yoki ovozli xabar yuboring. Masalan:\n"
    "- 18 Pro Max 256 dan nechta qoldi?\n"
    "- Shu oy nechta 17 Pro Max sotildi, foyda qancha?\n"
    "- Oxirgi partiyada 18 Pro Max ga bitta telefonga qancha rastamojka tushdi?\n"
    "- Kecha nima xarid qildik?\n"
    f"Mijozlarning qarzi va qoldig'i: pastdagi «{customers_menu.CUSTOMERS_BUTTON}» tugmasi."
)
PANEL_HINT = f"\nBoshqaruv paneli: pastdagi «{customers_menu.PANEL_BUTTON}» tugmasi (Telegram ichida ochiladi)."


def welcome_messages(url: str | None) -> list[tuple[str, ReplyKeyboardMarkup]]:
    """`/start` reply for an allowed user: the welcome with the reply keyboard ("👥 Mijozlar", plus "📱 Panel"
    when a Mini App URL is available). The bot's blue menu button is deliberately left alone."""
    return [(WELCOME + (PANEL_HINT if url else ""), customers_menu.main_keyboard(url))]


async def _allowed(message: Message) -> bool:
    async with SessionLocal() as session:
        # Writing to the bot (unblocking it sends /start) means batch cost messages can reach this chat again (SPEC §17).
        if await telegram_notify.mark_reachable(session, message.chat.id):
            await session.commit()
        if await is_bot_user_allowed(session, message.from_user.id):
            return True
    await message.answer(f"Sizga ruxsat yo'q. Administratorga Telegram ID raqamingizni yuboring: "
                         f"{message.from_user.id}")
    return False


async def _reply(message: Message, text: str) -> None:
    for i in range(0, len(text), TG_LIMIT):
        await message.answer(text[i:i + TG_LIMIT])


async def _ask(message: Message, text: str | None = None, media=None) -> None:
    await message.bot.send_chat_action(message.chat.id, ChatAction.TYPING)
    try:
        audio, mime = None, "audio/ogg"
        if media is not None:
            buf = io.BytesIO()
            await message.bot.download(media, destination=buf)
            audio, mime = buf.getvalue(), media.mime_type or "audio/ogg"
        answer = await assistant.answer(text=text, audio=audio, audio_mime=mime)
    except TimeoutError:
        answer = "Javob kechikdi, bir ozdan keyin qayta urinib ko'ring."
    except Exception:
        log.exception("assistant failed")
        answer = "Xatolik yuz berdi, keyinroq qayta urinib ko'ring."
    await _reply(message, answer)


@private.message(CommandStart())
async def start(message: Message) -> None:
    if await _allowed(message):
        for body, keyboard in welcome_messages(await current_webapp_url()):
            await message.answer(body, reply_markup=keyboard)


@ai.message(F.voice | F.audio)
async def voice(message: Message) -> None:
    if not await _allowed(message):
        return
    media = message.voice or message.audio
    if media.duration and media.duration > 120:
        await message.answer("Ovozli xabar 2 daqiqadan oshmasin.")
        return
    await _ask(message, media=media)


@ai.message(F.text)
async def text(message: Message) -> None:
    if not await _allowed(message):
        return
    await _ask(message, text=message.text[:2000])


private.include_routers(customers_menu.router, ai)
dp.include_routers(group_log.router, private)


async def main() -> None:
    global assistant
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = get_settings()
    if not settings.telegram_bot_token or not settings.gemini_api_key:
        raise SystemExit("TELEGRAM_BOT_TOKEN va GEMINI_API_KEY .env da bo'lishi kerak")
    assistant = Assistant()
    bot = Bot(settings.telegram_bot_token)
    bot.session.middleware(group_log.GroupSilence())
    watcher = asyncio.create_task(panel_link.watch(bot))
    try:
        await dp.start_polling(bot)
    finally:
        watcher.cancel()


if __name__ == "__main__":
    asyncio.run(main())
