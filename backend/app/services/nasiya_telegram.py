"""Daily nasiya workbooks posted in a Telegram group (SPEC §18.2).

The bot already stores every group message (SPEC §14). An .xlsx document from a nasiya group is downloaded with
the bot token and handed to nasiya_reports.ingest as a pending report; nasiya_intake records the outcome per
message, so a rescan downloads each message at most once. The download is a callable, so the bot (live message)
and the panel's rescan (stored messages) share this code and tests need no Telegram.
"""

import logging
import time
from collections.abc import Awaitable, Callable
from datetime import date, datetime, time as day_start
from zoneinfo import ZoneInfo

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
RESCAN_LIMIT = 25  # files per panel request; the panel repeats the call until nothing is left
RESCAN_SECONDS = 8.0  # stop early: one request stays inside even a 10 s function limit; the panel calls again


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
    """Download one stored group document, ingest it and confirm it when nothing needs a decision.

    Returns the outcome ('created', 'confirmed', 'duplicate', 'invalid'), or None when the message is not a
    candidate or was already handled."""
    if not row.file_id or not is_candidate(row.chat_id, row.file_name):
        return None
    if await session.get(NasiyaIntake, row.id) is not None:
        return None
    size = ((row.raw or {}).get("document") or {}).get("file_size")
    if size is not None and size > MAX_BYTES:  # recorded, so a rescan does not pick it up again
        session.add(NasiyaIntake(telegram_message_id=row.id, report_id=None, outcome="invalid"))
        await session.flush()
        return "invalid"
    content = await download(row.file_id)
    report, created = await nasiya_reports.ingest(
        session, content, file_name=row.file_name or "", source="telegram", sent_by=row.from_name,
        chat_title=row.chat_title, telegram_message_id=row.id,
        fallback_date=row.sent_at.date() if row.sent_at else today())
    outcome = "duplicate" if not created else ("invalid" if report.status == "invalid" else "created")
    session.add(NasiyaIntake(telegram_message_id=row.id, report_id=report.id, outcome=outcome))
    await session.flush()
    if outcome == "created" and await nasiya_reports.auto_confirm(session, report):
        outcome = "confirmed"
    log.info("nasiya intake: group %s message %s (%s) → report %s %s, %s items, %s errors", row.chat_id,
             row.message_id, row.file_name, report.id, outcome, report.item_count, report.error_count)
    return outcome


def _unhandled(since: date | None):
    """Stored group .xlsx documents the intake has not looked at yet, oldest first."""
    stmt = select(TelegramGroupMessage).where(
        TelegramGroupMessage.file_id.is_not(None), func.lower(TelegramGroupMessage.file_name).like("%.xls_"),
        TelegramGroupMessage.id.not_in(select(NasiyaIntake.telegram_message_id)))
    if chats := nasiya_chat_ids():
        stmt = stmt.where(TelegramGroupMessage.chat_id.in_(chats))
    if since is not None:  # by sending time; process_pending then filters by the report date
        tz = ZoneInfo(get_settings().tz_name)
        stmt = stmt.where(TelegramGroupMessage.sent_at >= datetime.combine(since, day_start(), tz))
    return stmt


async def rescan(session: AsyncSession, download: Download, *, since: date | None = None,
                 limit: int = RESCAN_LIMIT, seconds: float = RESCAN_SECONDS) -> NasiyaRescanOut:
    """Read stored group files the intake has not handled (the bot was down, or files sent before §18).

    `since` skips files sent before that day. One call reads up to `limit` files or stops after `seconds`;
    `remaining` tells the panel to call again."""
    started = time.monotonic()
    rows = list((await session.execute(_unhandled(since).order_by(TelegramGroupMessage.sent_at).limit(limit))).scalars())
    checked = created = confirmed = skipped = failed = 0
    for row in rows:
        if checked and time.monotonic() - started > seconds:
            break
        checked += 1
        try:
            async with session.begin_nested():
                outcome = await ingest_message(session, row, download)
        except Exception:  # one bad file must not stop the others; it stays unhandled for the next rescan
            log.exception("nasiya rescan: message %s failed", row.id)
            failed += 1
            continue
        if outcome in ("created", "confirmed"):
            created += 1
            confirmed += outcome == "confirmed"
        else:
            skipped += 1
    remaining = int((await session.execute(
        select(func.count()).select_from(_unhandled(since).subquery()))).scalar_one())
    return NasiyaRescanOut(checked=checked, created=created, skipped=skipped, failed=failed, remaining=remaining,
                           confirmed=confirmed)
