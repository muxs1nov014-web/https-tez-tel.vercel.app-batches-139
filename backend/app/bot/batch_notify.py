"""Sends a batch's per-model unit cost to Telegram (SPEC §17).

Recipients are the chats picked on the batch page (services.telegram_notify checks them). The bot session carries
GroupSilence with exactly those chats allowed, so a configured group/channel is the only kind of group the bot can
write to; every other group stays silent.
"""

import asyncio
import logging
from dataclasses import dataclass

from aiogram import Bot
from aiogram.exceptions import TelegramAPIError, TelegramBadRequest, TelegramForbiddenError

from app.bot import group_log
from app.bot.batch_texts import render
from app.core.config import get_settings
from app.schemas import BatchDetail

log = logging.getLogger(__name__)
SEND_TIMEOUT = 20.0


@dataclass
class SendResult:
    recipients: int
    sent: int
    failed: int
    unreachable: list[int | str]  # failed because the chat blocked the bot or is gone (part of `failed`)


def is_unreachable(exc: TelegramAPIError) -> bool:
    """The bot was blocked or kicked, the user deleted their account, or the chat does not exist: trying again later
    would fail the same way. Other errors (network, rate limit) are not remembered."""
    if isinstance(exc, TelegramForbiddenError):
        return True
    return isinstance(exc, TelegramBadRequest) and any(
        s in exc.message.lower() for s in ("chat not found", "user is deactivated", "peer_id_invalid"))


def make_bot(allowed_chat_ids: list[int | str]) -> Bot:
    bot = Bot(get_settings().telegram_bot_token)
    bot.session.middleware(group_log.GroupSilence(allowed_chat_ids=allowed_chat_ids))
    return bot


async def send(batch: BatchDetail, targets: list[int | str]) -> SendResult:
    """One attempt per chat, no retries. A chat that fails is logged and counted; the rest still get it."""
    parts = render(batch)
    bot = make_bot(targets)
    gone: list[int | str] = []

    async def deliver(chat_id: int | str) -> bool:
        try:
            for text in parts:
                await bot.send_message(chat_id, text)
            return True
        except TelegramAPIError as exc:
            log.warning("batch %s cost not delivered to %s: %s", batch.id, chat_id, exc)
            if is_unreachable(exc):
                gone.append(chat_id)
            return False
        except group_log.GroupWriteBlocked as exc:
            log.warning("batch %s cost not delivered to %s: %s", batch.id, chat_id, exc)
            return False

    try:
        results = await asyncio.wait_for(asyncio.gather(*(deliver(t) for t in targets)), SEND_TIMEOUT)
    except TimeoutError:
        log.error("batch %s cost: telegram timed out", batch.id)
        results = []
    finally:
        await bot.session.close()
    sent = sum(1 for ok in results if ok)
    log.info("batch %s cost sent to %d of %d chats", batch.id, sent, len(targets))
    return SendResult(recipients=len(targets), sent=sent, failed=len(targets) - sent, unreachable=gone)
