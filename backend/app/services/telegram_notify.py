"""Who may receive a batch cost message (SPEC §17). It is sent only from the batch page, to the chats picked there:
active bot users, plus the groups/channels an admin added (`chat_ids`, stored in the settings table under a key
outside services.settings.DEFAULTS, so the numeric settings form never sees it).

A chat that blocked the bot or is gone gets one attempt only: it is remembered as unreachable (`UNREACHABLE_KEY`) and
skipped by later sends until it talks to the bot again (/start in private, any message in a group).
"""

import re
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationFailed
from app.models import BotUser, Setting, TelegramGroupMessage

CHATS_KEY = "batch_notify_chats"
UNREACHABLE_KEY = "batch_notify_unreachable"
CHAT_RE = re.compile(r"^(-?\d{3,20}|@[A-Za-z][A-Za-z0-9_]{3,31})$")


@dataclass
class NotifyConfig:
    chat_ids: list[str] = field(default_factory=list)  # private IDs, group/channel IDs (negative) or @channel


def parse_chat_ids(values: list[str]) -> list[str]:
    """Normalise and validate chat IDs; duplicates are dropped, order kept."""
    result: list[str] = []
    for raw in values:
        value = raw.strip()
        if not value:
            continue
        if not CHAT_RE.match(value):
            raise ValidationFailed(f"Chat ID noto'g'ri: {value!r} (raqam, masalan -1001234567890, yoki @kanal)")
        if value not in result:
            result.append(value)
    return result


def chat_target(value: str) -> int | str:
    return value if value.startswith("@") else int(value)


async def get_config(session: AsyncSession) -> NotifyConfig:
    chats = await session.get(Setting, CHATS_KEY)
    return NotifyConfig(chat_ids=[c for c in (chats.value.split(",") if chats else []) if c])


async def set_config(session: AsyncSession, chat_ids: list[str]) -> NotifyConfig:
    value = ",".join(parse_chat_ids(chat_ids))
    setting = await session.get(Setting, CHATS_KEY)
    if setting is None:
        session.add(Setting(key=CHATS_KEY, value=value))
    else:
        setting.value = value
    await session.flush()
    return await get_config(session)


async def known_groups(session: AsyncSession) -> list[tuple[int, str]]:
    """Groups the bot has seen messages from (SPEC §14), one title per chat. Helps an admin pick a group ID."""
    rows = await session.execute(
        select(TelegramGroupMessage.chat_id, func.max(TelegramGroupMessage.chat_title))
        .group_by(TelegramGroupMessage.chat_id).order_by(TelegramGroupMessage.chat_id))
    return [(chat_id, title or "") for chat_id, title in rows]


@dataclass
class Recipient:
    chat_id: str
    name: str
    kind: str  # user | group | channel
    blocked: bool  # blocked the bot or is gone: not sent to until it talks to the bot again


async def available_recipients(session: AsyncSession) -> list[Recipient]:
    """Who a send may pick: the configured groups/channels first, then active bot users by name."""
    config = await get_config(session)
    users = (await session.execute(select(BotUser.telegram_id, BotUser.full_name)
                                   .where(BotUser.is_active.is_(True)).order_by(BotUser.full_name, BotUser.id))).all()
    user_ids = {str(telegram_id) for telegram_id, _ in users}
    titles = {str(chat_id): title for chat_id, title in await known_groups(session)}
    blocked = await unreachable(session)
    result = []
    for chat in config.chat_ids:
        if chat in user_ids:
            continue
        kind = "channel" if chat.startswith("@") else "group" if chat.startswith("-") else "user"
        result.append(Recipient(chat, chat if kind == "channel" else titles.get(chat) or f"Chat {chat}", kind,
                                chat in blocked))
    result += [Recipient(str(telegram_id), name, "user", str(telegram_id) in blocked) for telegram_id, name in users]
    return result


async def pick_recipients(session: AsyncSession, chat_ids: list[str]) -> tuple[list[int | str], int]:
    """The chosen chats to send to, in the given order, and how many were skipped as unreachable.
    Each chat must be one of `available_recipients`."""
    chosen = list(dict.fromkeys(c.strip() for c in chat_ids if c.strip()))
    if not chosen:
        raise ValidationFailed("Kamida bitta qabul qiluvchini tanlang")
    available = {r.chat_id: r for r in await available_recipients(session)}
    unknown = [c for c in chosen if c not in available]
    if unknown:
        raise ValidationFailed(f"Bu chatga yuborish mumkin emas: {', '.join(unknown)}")
    targets = [chat_target(c) for c in chosen if not available[c].blocked]
    return targets, len(chosen) - len(targets)


async def unreachable(session: AsyncSession) -> set[str]:
    row = await session.get(Setting, UNREACHABLE_KEY)
    return {c for c in row.value.split(",") if c} if row else set()


async def _store_unreachable(session: AsyncSession, chats: set[str]) -> None:
    row = await session.get(Setting, UNREACHABLE_KEY)
    value = ",".join(sorted(chats))
    if row is None:
        session.add(Setting(key=UNREACHABLE_KEY, value=value))
    else:
        row.value = value
    await session.flush()


async def mark_unreachable(session: AsyncSession, chat_ids: list[int | str]) -> None:
    if chat_ids:
        await _store_unreachable(session, await unreachable(session) | {str(c) for c in chat_ids})


async def mark_reachable(session: AsyncSession, chat_id: int | str) -> bool:
    """The chat talked to the bot again. Returns True if it had been marked unreachable (the caller commits)."""
    chats = await unreachable(session)
    if str(chat_id) not in chats:
        return False
    await _store_unreachable(session, chats - {str(chat_id)})
    return True
