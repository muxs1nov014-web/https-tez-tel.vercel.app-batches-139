"""A nasiya workbook sent or forwarded to the bot in a private chat (SPEC §18.2).

The daily file reaches the group from another bot, and Telegram never shows one bot's messages to another, so the
group intake cannot see it. Forwarding the file to this bot works: the forward comes from a person. Only a panel
operator or administrator (users.telegram_id) may submit one; the file is ingested like an upload, counted when
nothing needs a decision (nasiya_reports.auto_confirm), and the reply says what was counted and what is wrong.
"""

import logging
from collections import Counter

from aiogram import F, Router
from aiogram.types import Message
from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.errors import ValidationFailed
from app.importers.nasiya_workbook import MAX_BYTES, looks_like_xlsx
from app.models import NasiyaItem, NasiyaReport, NasiyaSheet, User
from app.services import nasiya_monitor, nasiya_reports
from app.services.reports import today

log = logging.getLogger(__name__)
router = Router(name="nasiya_upload")
REVIEW_ROLES = ("operator", "admin")
MAX_ISSUES_SHOWN = 8


async def _operator(session, telegram_id: int) -> User | None:
    return (await session.execute(select(User).where(
        User.telegram_id == telegram_id, User.is_active.is_(True), User.role.in_(REVIEW_ROLES)))).scalar_one_or_none()


def _money(value) -> str:
    return f"{value:,.0f}".replace(",", " ") + " $"


async def summary_text(session, report: NasiyaReport, counted: bool, duplicate: bool) -> str:
    """The bot's reply: the day, what the file holds per kind, the errors with their cells, and the outcome."""
    day = report.report_date.strftime("%d.%m.%Y") if report.report_date else "sana topilmadi"
    rows = (await session.execute(
        select(NasiyaItem.kind, NasiyaItem.qty, NasiyaItem.price_usd).where(NasiyaItem.report_id == report.id))).all()
    qty, amount = Counter(), Counter()
    for kind, n, price in rows:
        qty[kind] += n
        amount[kind] += (price or 0) * n
    lines = [f"📄 {report.file_name} — {day}"]
    if duplicate:
        lines.append("Bu fayl avval yuklangan.")
    labels = (("nasiya", "Nasiya"), ("variant", "Variant"), ("qoldiq", "Qoldiq"), ("sotuv", "Sotuv (to'landi)"))
    for kind, label in labels:
        if qty[kind]:
            lines.append(f"• {label}: {qty[kind]} dona" + (f", {_money(amount[kind])}" if kind != "qoldiq" else ""))
    sheets = list((await session.execute(
        select(NasiyaSheet).where(NasiyaSheet.report_id == report.id).order_by(NasiyaSheet.position))).scalars())
    issues = [(None, i) for i in report.issues or [] if i["level"] == "error"]
    issues += [(s.name, i) for s in sheets for i in s.issues or [] if i["level"] == "error"]
    if issues:
        lines.append(f"\n⚠️ {len(issues)} ta xato:")
        for sheet, i in issues[:MAX_ISSUES_SHOWN]:
            where = " ".join(p for p in (sheet, i.get("cell")) if p)
            lines.append(f"– {where}: {i['message']}" if where else f"– {i['message']}")
        if len(issues) > MAX_ISSUES_SHOWN:
            lines.append(f"… yana {len(issues) - MAX_ISSUES_SHOWN} ta — panelda.")
    if report.status == "confirmed":
        lines.append("\n✅ Hisoblandi." if counted else "\n✅ Bu kun hisobga olingan.")
        lines.extend(await _reopened_lines(session, report))
        lines.extend(await _debt_lines(session, report))
    elif report.status == "invalid":
        lines.append("\n❌ Bu nasiya fayli emas.")
    else:
        unlinked = [s.name for s in sheets if s.customer_id is None
                    and (await session.execute(select(NasiyaItem.id).where(NasiyaItem.sheet_id == s.id).limit(1))).first()]
        if unlinked:
            lines.append("\n⏳ Kutmoqda: mijozga bog'lanmagan varaqlar — " + ", ".join(unlinked)
                         + ". Panel → Nasiya nazorati → Hisobotlar: bir marta bog'lang.")
        else:
            lines.append("\n⏳ Kutmoqda: shu kun uchun keyingi fayl allaqachon hisoblangan.")
    return "\n".join(lines)


async def _reopened_lines(session, report: NasiyaReport) -> list[str]:
    """Phones that were sold (Sotuv, paid) on an earlier day and are back in nasiya or qoldiq: checked by IMEI."""
    diff = await nasiya_monitor.diff_for_report(session, report)
    back = [e for e in diff.events if e.type == "reopened"] if diff else []
    if not back:
        return []
    lines = [f"\n🚨 Sotilgan telefon qaytib chiqdi — {len(back)} ta, IMEI'ni tekshiring:"]
    for e in back[:MAX_ISSUES_SHOWN]:
        who = e.customer.name if e.customer else e.sheet_name
        when = f" (sotilgan {e.sold_on:%d.%m})" if e.sold_on else ""
        lines.append(f"– {who} · {e.model} · {e.imei}{when}")
    if len(back) > MAX_ISSUES_SHOWN:
        lines.append(f"… yana {len(back) - MAX_ISSUES_SHOWN} ta — panelda.")
    return lines


WATCH_DAY = 2  # the panel's split: nasiya given today, exactly 2 days old, older than 2 days


def _bands(rows) -> tuple[list, list, list]:
    """[qty, usd] for: given today, 2 days old, over 2 days (as the panel's Telefonlar tab)."""
    new, two, over = [0, 0], [0, 0], [0, 0]
    for p in rows:
        band = (new if p.age_days == 1 and p.since_exact else two if p.age_days == WATCH_DAY
                else over if p.age_days and p.age_days > WATCH_DAY else None)
        if band is not None:
            band[0] += p.qty
            band[1] += (p.price_usd or 0) * p.qty
    return new, two, over


def _band(mark: str, label: str, band: list) -> str:
    return f"{mark} {label}: {band[0]} ta · {_money(band[1])}"


async def _debt_lines(session, report: NasiyaReport) -> list[str]:
    """Nasiya by days, in total and for each customer: given today, 2 days, over 2 days."""
    data = await nasiya_monitor.phones(session, "debt", on=report.report_date)
    if data.report is None or data.report.id != report.id or not data.rows:
        return []
    new, two, over = _bands(data.rows)
    lines = ["\n📊 Nasiya kunlar bo'yicha:", _band("🟢", "Yangi berilgan", new),
             _band("🟡", "2 kun bo'lgan", two), _band("🔴", "2 kundan oshgan", over)]
    by_customer: dict[str, list] = {}
    for p in data.rows:
        by_customer.setdefault(p.customer.name if p.customer else p.sheet_name, []).append(p)
    lines.append("\n👤 Mijozlar:")
    for name, rows in by_customer.items():
        parts = [f"{mark} {band[0]} ta {_money(band[1])}"
                 for mark, band in zip(("🟢", "🟡", "🔴"), _bands(rows)) if band[0]]
        if parts:
            lines.append(f"• {name}: " + " · ".join(parts))
    lines.append("Hammasi: Panel → Nasiya nazorati → Telefonlar.")
    return lines


@router.message(F.document, lambda m: looks_like_xlsx(m.document.file_name))
async def workbook(message: Message) -> None:
    doc = message.document
    async with SessionLocal() as session:
        user = await _operator(session, message.from_user.id)
        if user is None:
            await message.answer("Nasiya faylini faqat panel operatori yoki administratori yubora oladi. Panelda "
                                 "«Foydalanuvchilar» bo'limida o'zingizga shu Telegram ID ni yozing: "
                                 f"{message.from_user.id}")
            return
        if doc.file_size and doc.file_size > MAX_BYTES:
            await message.answer("Fayl juda katta (20 MB dan oshmasin).")
            return
        content = (await message.bot.download(doc)).getvalue()
        # a forwarded file belongs to the day it was first sent
        sent = message.forward_origin.date if message.forward_origin else message.date
        try:
            report, created = await nasiya_reports.ingest(
                session, content, file_name=doc.file_name or "", source="upload",
                sent_by=user.full_name or user.username, chat_title="Telegram (bot)",
                fallback_date=sent.date() if sent else today())
        except ValidationFailed as exc:
            await message.answer(f"❌ {doc.file_name}: {exc.detail}")
            return
        counted = await nasiya_reports.auto_confirm(session, report)
        await session.commit()
        log.info("nasiya workbook from %s via the bot → report %s (%s, counted=%s)", user.username, report.id,
                 "new" if created else "duplicate", counted)
        await message.answer(await summary_text(session, report, counted, not created))
