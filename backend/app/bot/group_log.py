"""Silent group member (SPEC §14): stores every group message, never answers.

Two layers keep the bot quiet in groups:
- this router has no handler that sends anything, and every other router is private-chat only (main.py);
- GroupSilence, a request middleware on the bot session, refuses any non-read Telegram method aimed at a
  group or channel, so a future handler cannot post there by mistake.
The one exception is the batch cost message (SPEC §17): its own bot session allows the chats an admin chose.
"""

import logging
from collections.abc import Iterable
from datetime import datetime, timezone

from aiogram import F, Router
from aiogram.client.session.middlewares.base import BaseRequestMiddleware
from aiogram.enums import ChatType
from aiogram.types import Message

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.services import group_messages, telegram_notify

log = logging.getLogger(__name__)
GROUP_TYPES = {ChatType.GROUP, ChatType.SUPERGROUP}
# Allowed towards a group/channel: reading it, and leaving it.
READ_ONLY_PREFIXES = ("Get",)
READ_ONLY_METHODS = {"LeaveChat"}

router = Router(name="group_log")
router.message.filter(F.chat.type.in_(GROUP_TYPES))
router.edited_message.filter(F.chat.type.in_(GROUP_TYPES))
_seen_chats: set[int] = set()


class GroupWriteBlocked(RuntimeError):
    pass


def is_group_chat_id(chat_id: object) -> bool:
    """Private chats have positive IDs; groups, supergroups and channels are negative or '@username'."""
    if isinstance(chat_id, int):
        return chat_id < 0
    return chat_id is not None


class GroupSilence(BaseRequestMiddleware):
    def __init__(self, allowed_chat_ids: Iterable[int | str] = ()):
        # Only the batch cost sender (SPEC §17) passes chats here: the ones an admin chose to receive it.
        self.allowed = {str(c) for c in allowed_chat_ids}

    async def __call__(self, make_request, bot, method):
        name = type(method).__name__
        chat_id = getattr(method, "chat_id", None)
        if (is_group_chat_id(chat_id) and str(chat_id) not in self.allowed and not name.startswith(READ_ONLY_PREFIXES)
                and name not in READ_ONLY_METHODS):
            log.error("blocked %s to group chat %s: the bot must stay silent in groups", name, chat_id)
            raise GroupWriteBlocked(f"{name} to a group is not allowed")
        return await make_request(bot, method)


def allowed_group_ids() -> set[int]:
    """TELEGRAM_GROUP_IDS (comma-separated). Empty = every group the bot is in."""
    raw = get_settings().telegram_group_ids
    return {int(part) for part in raw.replace(" ", "").split(",") if part}


def _fields(message: Message) -> dict:
    sender = message.from_user
    if sender is not None:
        from_id, from_name = sender.id, sender.full_name
    else:  # anonymous group admin or a linked channel post
        from_id, from_name = None, (message.sender_chat.title if message.sender_chat else "") or ""
    media = (message.document or message.audio or message.video or message.voice or message.video_note
             or message.animation or message.sticker or (message.photo[-1] if message.photo else None))
    return dict(
        chat_id=message.chat.id, chat_title=message.chat.title or "", message_id=message.message_id,
        from_id=from_id, from_name=from_name, sent_at=message.date,
        edited_at=datetime.fromtimestamp(message.edit_date, timezone.utc) if message.edit_date else None,
        content_type=getattr(message.content_type, "value", str(message.content_type)), text=message.text or message.caption,
        file_id=media.file_id if media else None, file_name=getattr(media, "file_name", None),
        reply_to_message_id=message.reply_to_message.message_id if message.reply_to_message else None,
        raw=message.model_dump(mode="json", exclude_none=True, exclude={"reply_to_message"}),
    )


async def capture(message: Message) -> None:
    allowed = allowed_group_ids()
    if allowed and message.chat.id not in allowed:
        return
    if message.chat.id not in _seen_chats:
        _seen_chats.add(message.chat.id)
        log.info("capturing group %s (%s)", message.chat.id, message.chat.title)
    async with SessionLocal() as session:
        await group_messages.save(session, **_fields(message))
        await telegram_notify.mark_reachable(session, message.chat.id)  # the bot is in this group again (SPEC §17)
        await session.commit()


router.message.register(capture)
router.edited_message.register(capture)
