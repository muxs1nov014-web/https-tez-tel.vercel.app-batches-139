"""Daily nasiya workbooks (SPEC §18): intake, review (sheet → customer, issues) and confirmation.

A workbook arrives from the "Telefon nasiya nazorat" group (the bot downloads it) or is uploaded in the panel.
It is parsed into an IMEI-level snapshot and waits as 'pending' until an operator confirms it. Only confirmed
reports feed the monitoring (services/nasiya_monitor.py), at most one per day.
"""

import difflib
import hashlib
import re
from collections import defaultdict
from dataclasses import asdict
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import delete as sql_delete
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, NotFound, ValidationFailed
from app.domain import nasiya_sheet as ns
from app.importers import nasiya_workbook
from app.models import Customer, NasiyaItem, NasiyaReport, NasiyaSheet, NasiyaSheetLink, User
from app.schemas import (
    CustomerRef,
    NasiyaDeclaredOut,
    NasiyaIssueOut,
    NasiyaItemOut,
    NasiyaKindTotal,
    NasiyaProcessOut,
    NasiyaProcessWaiting,
    NasiyaReportDetail,
    NasiyaReportSummary,
    NasiyaSheetOut,
)

REVIEWABLE = ("pending", "rejected", "superseded")
SUGGEST_MIN_RATIO = 0.8
SUGGEST_MARGIN = 0.1


def customer_ref(customer: Customer | None) -> CustomerRef | None:
    return CustomerRef(id=customer.id, name=customer.name, kind=customer.kind) if customer else None


def _issue_dicts(issues: list[ns.Issue]) -> list[dict]:
    return [asdict(i) for i in issues]


def _declared_dict(d: ns.Declared) -> dict:
    return {"kind": d.kind, "label": d.label, "qty": d.qty, "amount": str(d.amount) if d.amount is not None else None,
            "cell": d.cell}


# ---- intake ----
async def ingest(session: AsyncSession, content: bytes, *, file_name: str, source: str, sent_by: str = "",
                 chat_title: str = "", telegram_message_id: int | None = None,
                 fallback_date: date | None = None) -> tuple[NasiyaReport, bool]:
    """Store one workbook as a pending report. Returns (report, created); the same file twice is one report.

    A panel upload that is not a nasiya workbook is refused (ValidationFailed). A group file that is not one is kept
    as 'invalid', so the next rescan does not download it again.
    """
    sha = hashlib.sha256(content).hexdigest()
    existing = (await session.execute(select(NasiyaReport).where(NasiyaReport.file_sha256 == sha))).scalar_one_or_none()
    if existing is not None:
        return existing, False
    report = NasiyaReport(source=source, file_name=(file_name or "")[:255], file_sha256=sha, file_size=len(content),
                          telegram_message_id=telegram_message_id, chat_title=chat_title[:255], sent_by=sent_by[:255],
                          status="pending", issues=[])
    try:
        parsed = nasiya_workbook.parse_workbook(content, file_name, fallback_date)
    except ValidationFailed as exc:
        if source == "upload":
            raise
        report.status = "invalid"
        report.issues = [asdict(ns.Issue("error", "unreadable", exc.detail))]
        report.error_count = 1
        session.add(report)
        await session.flush()
        return report, True

    report.report_date = parsed.report_date
    workbook_issues = list(parsed.issues)
    if parsed.report_date is None:
        workbook_issues.append(ns.Issue("error", "no_date", "Hisobot sanasi topilmadi (varaqlarda ham, fayl nomida ham)"))
    report.issues = _issue_dicts(workbook_issues)
    links = await _links(session)
    errors = sum(i.level == "error" for i in workbook_issues)
    warnings = sum(i.level == "warning" for i in workbook_issues)
    items = 0
    for position, sheet in enumerate(parsed.sheets):
        key = ns.sheet_key(sheet.name)
        s_err = sum(i.level == "error" for i in sheet.issues)
        s_warn = sum(i.level == "warning" for i in sheet.issues)
        row = NasiyaSheet(position=position, name=sheet.name[:128], sheet_key=key[:128], customer_id=links.get(key),
                          sheet_date=sheet.sheet_date, summary=sheet.summary,
                          declared=[_declared_dict(d) for d in sheet.declared], issues=_issue_dicts(sheet.issues),
                          paid_note_usd=sheet.paid_note, error_count=s_err, warning_count=s_warn)
        row.items = [NasiyaItem(kind=it.kind, model=it.model[:160], imei=it.imei, qty=it.qty, price_usd=it.price_usd,
                                marked_date=it.marked_date, term_days=it.term_days, cell=it.cell) for it in sheet.items]
        for item in row.items:
            item.report = report
        report.sheets.append(row)
        errors += s_err
        warnings += s_warn
        items += sum(it.qty for it in sheet.items)
    report.item_count, report.error_count, report.warning_count = items, errors, warnings
    session.add(report)
    await session.flush()
    return report, True


async def _links(session: AsyncSession) -> dict[str, int]:
    return dict((await session.execute(select(NasiyaSheetLink.sheet_key, NasiyaSheetLink.customer_id))).all())


# ---- review ----
async def get_report(session: AsyncSession, report_id: int) -> NasiyaReport:
    report = await session.get(NasiyaReport, report_id)
    if report is None:
        raise NotFound("Hisobot topilmadi")
    return report


async def list_reports(session: AsyncSession, status: str | None = None, limit: int = 60) -> list[NasiyaReportSummary]:
    stmt = select(NasiyaReport).order_by(NasiyaReport.report_date.desc().nulls_last(), NasiyaReport.id.desc()).limit(limit)
    if status:
        stmt = stmt.where(NasiyaReport.status == status)
    reports = list((await session.execute(stmt)).scalars())
    return await summaries(session, reports)


async def summaries(session: AsyncSession, reports: list[NasiyaReport]) -> list[NasiyaReportSummary]:
    ids = [r.id for r in reports]
    counts: dict[int, tuple[int, int]] = {}
    if ids:
        rows = await session.execute(
            select(NasiyaSheet.report_id, func.count(),
                   func.count().filter(NasiyaSheet.customer_id.is_(None)
                                       & select(NasiyaItem.id).where(NasiyaItem.sheet_id == NasiyaSheet.id)
                                       .exists()))
            .where(NasiyaSheet.report_id.in_(ids)).group_by(NasiyaSheet.report_id))
        counts = {rid: (n, unlinked) for rid, n, unlinked in rows}
    reviewers = {}
    reviewer_ids = {r.reviewed_by for r in reports if r.reviewed_by}
    if reviewer_ids:
        reviewers = dict((await session.execute(
            select(User.id, func.coalesce(func.nullif(User.full_name, ""), User.username))
            .where(User.id.in_(reviewer_ids)))).all())
    return [NasiyaReportSummary(
        id=r.id, report_date=r.report_date, status=r.status, source=r.source, file_name=r.file_name,
        chat_title=r.chat_title, sent_by=r.sent_by, item_count=r.item_count, error_count=r.error_count,
        warning_count=r.warning_count, sheet_count=counts.get(r.id, (0, 0))[0],
        unlinked_sheets=counts.get(r.id, (0, 0))[1], created_at=r.created_at, reviewed_at=r.reviewed_at,
        reviewed_by=reviewers.get(r.reviewed_by), review_note=r.review_note) for r in reports]


async def detail(session: AsyncSession, report_id: int) -> NasiyaReportDetail:
    from app.services import nasiya_monitor  # monitor imports this module for the summaries

    report = await get_report(session, report_id)
    sheets = list((await session.execute(
        select(NasiyaSheet).where(NasiyaSheet.report_id == report_id).order_by(NasiyaSheet.position))).scalars())
    items = list((await session.execute(
        select(NasiyaItem).where(NasiyaItem.report_id == report_id).order_by(NasiyaItem.sheet_id, NasiyaItem.id)
    )).scalars())
    by_sheet: dict[int, list[NasiyaItem]] = defaultdict(list)
    for item in items:
        by_sheet[item.sheet_id].append(item)
    customers = list((await session.execute(select(Customer).where(Customer.is_active))).scalars())
    taken = {s.customer_id for s in sheets if s.customer_id}
    out_sheets = []
    for s in sheets:
        sheet_items = by_sheet.get(s.id, [])
        totals: dict[str, list] = {}
        for it in sheet_items:
            t = totals.setdefault(it.kind, [0, Decimal(0)])
            t[0] += it.qty
            t[1] += (it.price_usd or 0) * it.qty
        out_sheets.append(NasiyaSheetOut(
            id=s.id, position=s.position, name=s.name, customer=customer_ref(s.customer),
            suggested_customer=None if s.customer_id else customer_ref(suggest_customer(s.name, customers, taken)),
            sheet_date=s.sheet_date, summary=s.summary or {},
            declared=[NasiyaDeclaredOut(**d) for d in s.declared or []],
            issues=[NasiyaIssueOut(**i) for i in s.issues or []], paid_note_usd=s.paid_note_usd,
            error_count=s.error_count, warning_count=s.warning_count,
            totals=[NasiyaKindTotal(kind=k, qty=v[0], amount=v[1]) for k, v in totals.items()],
            items=[NasiyaItemOut.model_validate(it) for it in sheet_items]))
    summary = (await summaries(session, [report]))[0]
    diff = await nasiya_monitor.diff_for_report(session, report) if report.report_date and sheets else None
    return NasiyaReportDetail(**summary.model_dump(), issues=[NasiyaIssueOut(**i) for i in report.issues or []],
                              sheets=out_sheets, diff=diff)


def suggest_customer(sheet_name: str, customers: list[Customer], taken: set[int] = frozenset()) -> Customer | None:
    """The panel customer whose name clearly matches the sheet name ('Adxam aka B 4' ~ 'Adxam aka B4').

    Only a suggestion the operator accepts. It must be close (ratio ≥ 0.8), clearly ahead of the next candidate,
    and the numbers in the names must agree (B23 is never suggested for B16)."""
    key = ns.sheet_key(sheet_name)
    key_digits = re.sub(r"\D", "", key)
    scored = []
    for c in customers:
        ckey = ns.sheet_key(c.name)
        cdigits = re.sub(r"\D", "", ckey)
        if not ckey or c.id in taken or (cdigits and cdigits != key_digits):
            continue
        ratio = 1.0 if ckey == key else difflib.SequenceMatcher(None, key, ckey).ratio()
        scored.append((ratio, c))
    scored.sort(key=lambda x: -x[0])
    if not scored or scored[0][0] < SUGGEST_MIN_RATIO:
        return None
    if len(scored) > 1 and scored[0][0] < 1.0 and scored[0][0] - scored[1][0] < SUGGEST_MARGIN:
        return None
    return scored[0][1]


async def link_sheet(session: AsyncSession, report_id: int, sheet_id: int, customer_id: int,
                     user_id: int | None) -> None:
    """Map a sheet to a panel customer and remember it: every report with the same sheet name follows."""
    sheet = await session.get(NasiyaSheet, sheet_id)
    if sheet is None or sheet.report_id != report_id:
        raise NotFound("Varaq topilmadi")
    customer = await session.get(Customer, customer_id)
    if customer is None:
        raise NotFound("Mijoz topilmadi")
    clash = (await session.execute(
        select(NasiyaSheet.name)
        .where(NasiyaSheet.report_id == report_id, NasiyaSheet.customer_id == customer_id,
               NasiyaSheet.id != sheet_id))).scalars().first()
    if clash is not None:
        raise Conflict(f"Bu mijoz shu faylda '{clash}' varag'iga bog'langan: bitta mijozga ikki varaq bo'lmaydi")
    link = (await session.execute(
        select(NasiyaSheetLink).where(NasiyaSheetLink.sheet_key == sheet.sheet_key))).scalar_one_or_none()
    if link is None:
        session.add(NasiyaSheetLink(sheet_key=sheet.sheet_key, sheet_name=sheet.name, customer_id=customer_id,
                                    created_by=user_id))
    else:
        link.customer_id, link.sheet_name = customer_id, sheet.name
    await session.execute(update(NasiyaSheet).where(NasiyaSheet.sheet_key == sheet.sheet_key)
                          .values(customer_id=customer_id))
    await session.flush()


def _unlinked_with_phones(report_id: int):
    return select(NasiyaSheet).where(
        NasiyaSheet.report_id == report_id, NasiyaSheet.customer_id.is_(None),
        select(NasiyaItem.id).where(NasiyaItem.sheet_id == NasiyaSheet.id).exists()).order_by(NasiyaSheet.position)


async def auto_link(session: AsyncSession, report_id: int, user_id: int | None) -> list[str]:
    """Link each unlinked sheet that has phones to the customer suggest_customer clearly matches, and remember it.

    Returns 'sheet → customer' lines. A sheet without a clear match stays for the operator."""
    sheets = list((await session.execute(_unlinked_with_phones(report_id))).scalars())
    if not sheets:
        return []
    customers = list((await session.execute(select(Customer).where(Customer.is_active))).scalars())
    taken = set((await session.execute(select(NasiyaSheet.customer_id).where(
        NasiyaSheet.report_id == report_id, NasiyaSheet.customer_id.is_not(None)))).scalars())
    linked = []
    for sheet in sheets:
        customer = suggest_customer(sheet.name, customers, taken)
        if customer is None:
            continue
        await link_sheet(session, report_id, sheet.id, customer.id, user_id)
        taken.add(customer.id)
        linked.append(f"{sheet.name} → {customer.name}")
    return linked


async def confirm(session: AsyncSession, report_id: int, user_id: int | None, *, force: bool,
                  note: str | None) -> NasiyaReport:
    report = await get_report(session, report_id)
    if report.status == "confirmed":
        raise Conflict("Hisobot allaqachon tasdiqlangan")
    if report.status not in REVIEWABLE:
        raise ValidationFailed("Bu faylni tasdiqlab bo'lmaydi: u nasiya hisoboti emas")
    if report.report_date is None:
        raise ValidationFailed("Hisobot sanasi aniqlanmagan")
    unlinked = [s.name for s in (await session.execute(_unlinked_with_phones(report_id))).scalars()]
    if unlinked:
        raise ValidationFailed("Mijozga bog'lanmagan varaqlar: " + ", ".join(unlinked))
    if report.error_count and not force:
        raise ValidationFailed(f"Faylda {report.error_count} ta xato bor. Xatolarni tuzatib qayta yuboring "
                               "yoki administrator xatolar bilan tasdiqlasin")
    await session.execute(update(NasiyaReport)
                          .where(NasiyaReport.report_date == report.report_date, NasiyaReport.status == "confirmed")
                          .values(status="superseded"))
    await session.flush()
    report.status = "confirmed"
    report.reviewed_at = datetime.now(timezone.utc)
    report.reviewed_by = user_id
    report.review_note = note
    await session.flush()
    return report


async def reject(session: AsyncSession, report_id: int, user_id: int, note: str | None) -> NasiyaReport:
    report = await get_report(session, report_id)
    if report.status not in ("pending", "confirmed"):
        raise ValidationFailed("Faqat kutilayotgan yoki tasdiqlangan hisobotni rad etish mumkin")
    report.status = "rejected"
    report.reviewed_at = datetime.now(timezone.utc)
    report.reviewed_by = user_id
    report.review_note = note
    await session.flush()
    return report


async def delete(session: AsyncSession, report_id: int) -> None:
    await get_report(session, report_id)
    await session.execute(sql_delete(NasiyaReport).where(NasiyaReport.id == report_id))  # sheets/items cascade


async def pending_count(session: AsyncSession) -> int:
    return int((await session.execute(
        select(func.count()).select_from(NasiyaReport).where(NasiyaReport.status == "pending"))).scalar_one())


async def _newer_confirmed(session: AsyncSession, report: NasiyaReport) -> bool:
    """A later file for the same day is already confirmed: this one is an older copy."""
    return (await session.execute(select(NasiyaReport.id).where(
        NasiyaReport.report_date == report.report_date, NasiyaReport.status == "confirmed",
        NasiyaReport.id > report.id).limit(1))).first() is not None


async def auto_confirm(session: AsyncSession, report: NasiyaReport) -> bool:
    """A group file is counted as soon as it arrives when it has a date, every sheet with phones belongs to a
    customer (remembered or clearly matching by name) and no later file for that day is confirmed. A file with
    errors is counted too, with a note: the errors stay on the report and the panel flags the day. A sheet that
    matches no customer is the one thing that waits for an operator."""
    if report.status != "pending" or report.report_date is None:
        return False
    if await _newer_confirmed(session, report):
        return False
    await auto_link(session, report.id, None)
    if (await session.execute(_unlinked_with_phones(report.id).limit(1))).first() is not None:
        return False
    note = f"Avtomatik: {report.error_count} ta xato bilan" if report.error_count else "Avtomatik: xatosiz"
    await confirm(session, report.id, None, force=True, note=note)
    return True


async def process_pending(session: AsyncSession, user_id: int | None, *, since: date | None,
                          allow_errors: bool) -> NasiyaProcessOut:
    """Confirm every pending day from `since` on (SPEC §18.3, "Hammasini hisoblash").

    Per day the latest file wins; earlier files of that day become 'superseded'. Sheets are linked by remembered
    or clearly matching names. A day with unlinked sheets waits; a day with errors waits unless an administrator
    runs this (allow_errors): it is then confirmed with a note and its errors stay listed on the report."""
    stmt = (select(NasiyaReport).where(NasiyaReport.status == "pending", NasiyaReport.report_date.is_not(None))
            .order_by(NasiyaReport.report_date, NasiyaReport.id))
    if since is not None:
        stmt = stmt.where(NasiyaReport.report_date >= since)
    by_day: dict[date, list[NasiyaReport]] = defaultdict(list)
    for report in (await session.execute(stmt)).scalars():
        by_day[report.report_date].append(report)
    out = NasiyaProcessOut(confirmed=0, superseded=0, linked=[], waiting=[])
    now = datetime.now(timezone.utc)
    for day, reports in by_day.items():
        *older, latest = reports
        if await _newer_confirmed(session, latest):
            older.append(latest)
            latest = None
        for report in older:
            report.status, report.reviewed_at, report.reviewed_by = "superseded", now, user_id
            report.review_note = "Shu kun uchun keyingi fayl hisobga olindi"
            out.superseded += 1
        if latest is None:
            continue
        out.linked.extend(await auto_link(session, latest.id, user_id))
        unlinked = [s.name for s in (await session.execute(_unlinked_with_phones(latest.id))).scalars()]
        reason = None
        if unlinked:
            reason = "Mijozga bog'lanmagan varaqlar: " + ", ".join(unlinked)
        elif latest.error_count and not allow_errors:
            reason = f"{latest.error_count} ta xato: administrator tasdiqlashi kerak"
        if reason:
            out.waiting.append(NasiyaProcessWaiting(report_id=latest.id, report_date=day, file_name=latest.file_name,
                                                    reason=reason))
            continue
        label = "Hammasini hisoblash" if user_id is not None else "Kunlik avtomatik hisoblash"
        note = label + (f": {latest.error_count} ta xato bilan" if latest.error_count else "")
        await confirm(session, latest.id, user_id, force=True, note=note)
        out.confirmed += 1
    await session.flush()
    return out

