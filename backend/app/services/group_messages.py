"""Raw store of Telegram group messages (SPEC §14). Upsert by (chat_id, message_id), so an edit replaces the row."""

from datetime import datetime

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import TelegramGroupMessage


async def save(session: AsyncSession, *, chat_id: int, chat_title: str, message_id: int, from_id: int | None,
               from_name: str, sent_at: datetime, edited_at: datetime | None, content_type: str,
               text: str | None, file_id: str | None, file_name: str | None, reply_to_message_id: int | None,
               raw: dict) -> None:
    values = dict(chat_id=chat_id, chat_title=chat_title[:255], message_id=message_id, from_id=from_id,
                  from_name=from_name[:255], sent_at=sent_at, edited_at=edited_at, content_type=content_type[:32],
                  text=text, file_id=file_id, file_name=(file_name or None) and file_name[:255],
                  reply_to_message_id=reply_to_message_id, raw=raw)
    stmt = insert(TelegramGroupMessage).values(**values)
    update = {k: stmt.excluded[k] for k in values if k not in ("chat_id", "message_id", "sent_at")}
    await session.execute(stmt.on_conflict_do_update(constraint="uq_telegram_group_messages_chat_message",
                                                     set_=update))
