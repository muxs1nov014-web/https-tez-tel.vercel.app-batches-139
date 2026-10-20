"""Daily nasiya workbooks posted in a Telegram group (SPEC §18.2).

The bot already stores every group message (SPEC §14). An .xlsx document from a nasiya group is downloaded with
the bot token and handed to nasiya_reports.ingest as a pending report; nasiya_intake records the outcome per
message, so a rescan downloads each message at most once. The download is a callable, so the bot (live message)
and the panel's rescan (stored messages) share this code and tests need no Telegram.
"""

import logging
from collections.abc import Awaitable, Callable

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.importers.nasiya_workbook import MAX_BYTES, looks_like_xlsx
from app.models import NasiyaIntake, TelegramGroupMessage
from app.schemas import NasiyaRescanOut
from app.services import nasiya_reports
from app.services.reports import today

log = logging.getLogger(__name__)
Download = Callable[[str], Awaitable[bytes]]
RESCAN_LIMIT = 40  # one panel request; a Vercel function has a time limit


def nasiya_chat_ids() -> set[int]:
    """NASIYA_CHAT_IDS (comma-separated). Empty = .xlsx files from every group the bot stores."""
    raw = get_settings().nasiya_chat_ids
    return {int(part) for part in raw.replace(" ", "").split(",") if part}


def is_candidate(chat_id: int, file_name: str | None, file_size: int | None = None) -> bool:
    allowed = nasiya_chat_ids()
    if allowed and chat_id not in allowed:
        return False
    return looks_like_xlsx(file_name) and (file_size is None or file_size <= MAX_BYTES)


async def ingest_message(session: AsyncSession, row: TelegramGroupMessage, download: Download) -> str | None:
    """Download one stored group document and ingest it.

    Returns the outcome ('created', 'duplicate', 'invalid'), or None when the message is not a candidate or was
    already handled."""
    size = ((row.raw or {}).get("document") or {}).get("file_size")
    if not row.file_id or not is_candidate(row.chat_id, row.file_name, size):
        return None
    if await session.get(NasiyaIntake, row.id) is not None:
        return None
    content = await download(row.file_id)
    report, created = await nasiya_reports.ingest(
        session, content, file_name=row.file_name or "", source="telegram", sent_by=row.from_name,
        chat_title=row.chat_title, telegram_message_id=row.id,
        fallback_date=row.sent_at.date() if row.sent_at else today())
    outcome = "duplicate" if not created else ("invalid" if report.status == "invalid" else "created")
    session.add(NasiyaIntake(telegram_message_id=row.id, report_id=report.id, outcome=outcome))
    await session.flush()
    log.info("nasiya intake: group %s message %s (%s) → report %s %s, %s items, %s errors", row.chat_id,
             row.message_id, row.file_name, report.id, outcome, report.item_count, report.error_count)
    return outcome


async def rescan(session: AsyncSession, download: Download, limit: int = RESCAN_LIMIT) -> NasiyaRescanOut:
    """Stored group .xlsx documents the intake has not handled (the bot was down, or files sent before §18)."""
    handled = select(NasiyaIntake.telegram_message_id)
    rows = list((await session.execute(
        select(TelegramGroupMessage)
        .where(TelegramGroupMessage.file_id.is_not(None),
               func.lower(TelegramGroupMessage.file_name).like("%.xls_"),
               TelegramGroupMessage.id.not_in(handled))
        .order_by(TelegramGroupMessage.sent_at).limit(limit))).scalars())
    created = skipped = failed = 0
    for row in rows:
        try:
            async with session.begin_nested():
                outcome = await ingest_message(session, row, download)
        except Exception:  # one bad file must not stop the others; it stays unhandled for the next rescan
            log.exception("nasiya rescan: message %s failed", row.id)
            failed += 1
            continue
        if outcome == "created":
            created += 1
        else:
            skipped += 1
    return NasiyaRescanOut(checked=len(rows), created=created, skipped=skipped, failed=failed)
