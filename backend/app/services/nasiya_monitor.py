"""Nasiya monitoring from confirmed daily reports (SPEC §18.4).

Each confirmed report is the state of every phone that day: at which customer, in which state (debt = nasiya or
variant, qoldiq = our goods at the customer, sotuv = paid today). Comparing two consecutive confirmed days by IMEI
gives the day's events; walking back through confirmed days gives how long a phone has been in its state.
Transitions the business does not expect (a debt phone that disappears without being paid, a phone that moves to
another customer, a changed price) are alerts.
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Customer, NasiyaItem, NasiyaReport, NasiyaSheet
from app.schemas import (
    NasiyaAgingBucket,
    NasiyaCustomerDetail,
    NasiyaCustomerRow,
    NasiyaDebtItemOut,
    NasiyaDiffOut,
    NasiyaEventCount,
    NasiyaEventOut,
    NasiyaImeiTrailRow,
    NasiyaModelRow,
    NasiyaOverviewOut,
    NasiyaSeriesPoint,
    NasiyaTotals,
)
from app.services import catalog
from app.services import customer_accounts as accounts
from app.services import nasiya_reports
from app.services.nasiya_reports import customer_ref

ZERO = Decimal(0)
DEBT_KINDS = ("nasiya", "variant")
AGING = ((0, 3, "0–3 kun"), (4, 7, "4–7 kun"), (8, 14, "8–14 kun"), (15, 30, "15–30 kun"), (31, None, "30+ kun"))
ALERT_TYPES = {"vanished_debt", "vanished_qoldiq", "debt_to_qoldiq", "moved", "price_changed", "reopened"}
EVENT_ORDER = ("vanished_debt", "vanished_qoldiq", "moved", "price_changed", "debt_to_qoldiq", "reopened",
               "paid", "sold_paid", "sold_direct", "qoldiq_to_debt", "new_debt", "handover")


def group_of(kind: str) -> str:
    return "debt" if kind in DEBT_KINDS else kind


@dataclass(frozen=True)
class Row:
    customer_id: int | None
    sheet_name: str
    kind: str
    model: str
    imei: str | None
    qty: int
    price: Decimal | None
    marked_date: date | None
    term_days: int | None
    cell: str

    @property
    def amount(self) -> Decimal:
        return (self.price or ZERO) * self.qty


# ---- loading ----
async def latest_confirmed(session: AsyncSession, on_or_before: date | None = None) -> NasiyaReport | None:
    stmt = select(NasiyaReport).where(NasiyaReport.status == "confirmed")
    if on_or_before is not None:
        stmt = stmt.where(NasiyaReport.report_date <= on_or_before)
    return (await session.execute(stmt.order_by(NasiyaReport.report_date.desc()).limit(1))).scalar_one_or_none()


async def previous_confirmed(session: AsyncSession, before: date) -> NasiyaReport | None:
    return (await session.execute(
        select(NasiyaReport).where(NasiyaReport.status == "confirmed", NasiyaReport.report_date < before)
        .order_by(NasiyaReport.report_date.desc()).limit(1))).scalar_one_or_none()


async def _rows(session: AsyncSession, report_id: int, customer_id: int | None = None) -> list[Row]:
    stmt = (select(NasiyaSheet.customer_id, NasiyaSheet.name, NasiyaItem.kind, NasiyaItem.model, NasiyaItem.imei,
                   NasiyaItem.qty, NasiyaItem.price_usd, NasiyaItem.marked_date, NasiyaItem.term_days, NasiyaItem.cell)
            .join(NasiyaSheet, NasiyaSheet.id == NasiyaItem.sheet_id)
            .where(NasiyaItem.report_id == report_id).order_by(NasiyaSheet.position, NasiyaItem.id))
    if customer_id is not None:
        stmt = stmt.where(NasiyaSheet.customer_id == customer_id)
    return [Row(*r) for r in (await session.execute(stmt)).all()]


async def _sheets(session: AsyncSession, report_id: int) -> list[NasiyaSheet]:
    return list((await session.execute(
        select(NasiyaSheet).where(NasiyaSheet.report_id == report_id).order_by(NasiyaSheet.position))).scalars())


async def _customers(session: AsyncSession, ids) -> dict[int, Customer]:
    ids = {i for i in ids if i is not None}
    if not ids:
        return {}
    return {c.id: c for c in (await session.execute(select(Customer).where(Customer.id.in_(ids)))).scalars()}


def _decimal(value) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except InvalidOperation:
        return None  # "yo'q", "—"


# ---- events: one day against the previous confirmed day ----
@dataclass(frozen=True)
class Event:
    type: str
    row: Row  # the current row, or the previous one when the phone is gone
    previous: Row | None

    @property
    def alert(self) -> bool:
        return self.type in ALERT_TYPES

    @property
    def amount(self) -> Decimal:
        if self.row.price is None and self.previous is not None:
            return self.previous.amount
        return self.row.amount


def _by_imei(rows: list[Row]) -> dict[str, Row]:
    out: dict[str, Row] = {}
    for r in rows:
        if r.imei and r.imei not in out:  # a duplicate IMEI is already an error on the report
            out[r.imei] = r
    return out


def compute_events(previous: list[Row], current: list[Row]) -> list[Event]:
    prev, cur = _by_imei(previous), _by_imei(current)
    events = []
    for imei in prev.keys() | cur.keys():
        p, c = prev.get(imei), cur.get(imei)
        pg, cg = (group_of(p.kind) if p else None), (group_of(c.kind) if c else None)
        if p and c and p.customer_id != c.customer_id:
            events.append(Event("moved", c, p))
            continue
        kind = {
            (None, "debt"): "new_debt", (None, "qoldiq"): "handover", (None, "sotuv"): "sold_direct",
            ("qoldiq", "debt"): "qoldiq_to_debt", ("qoldiq", "sotuv"): "sold_paid", ("qoldiq", None): "vanished_qoldiq",
            ("debt", "sotuv"): "paid", ("debt", None): "vanished_debt", ("debt", "qoldiq"): "debt_to_qoldiq",
            ("sotuv", "debt"): "reopened", ("sotuv", "qoldiq"): "reopened", ("sotuv", "sotuv"): "reopened",
        }.get((pg, cg))
        if kind is None and pg == cg == "debt" and p.price != c.price:
            kind = "price_changed"
        if kind:
            events.append(Event(kind, c or p, p))
    events.sort(key=lambda e: (EVENT_ORDER.index(e.type), e.row.sheet_name, e.row.model, e.row.imei or ""))
    return events


def _event_out(e: Event, customers: dict[int, Customer]) -> NasiyaEventOut:
    moved_from = e.previous.customer_id if e.type == "moved" and e.previous else None
    return NasiyaEventOut(
        type=e.type, alert=e.alert, customer=customer_ref(customers.get(e.row.customer_id)), sheet_name=e.row.sheet_name,
        other_customer=customer_ref(customers.get(moved_from)), model=e.row.model, imei=e.row.imei or "",
        price_usd=e.row.price if e.row.price is not None else (e.previous.price if e.previous else None),
        previous_price_usd=e.previous.price if e.previous else None)


def _counts(events: list[Event]) -> list[NasiyaEventCount]:
    acc: dict[str, list] = {}
    for e in events:
        a = acc.setdefault(e.type, [0, ZERO])
        a[0] += e.row.qty
        a[1] += e.amount
    return [NasiyaEventCount(type=t, alert=t in ALERT_TYPES, qty=acc[t][0], amount=acc[t][1])
            for t in EVENT_ORDER if t in acc]


async def diff_for_report(session: AsyncSession, report: NasiyaReport) -> NasiyaDiffOut | None:
    prev = await previous_confirmed(session, report.report_date)
    if prev is None:
        return None
    events = compute_events(await _rows(session, prev.id), await _rows(session, report.id))
    customers = await _customers(session, [e.row.customer_id for e in events]
                                 + [e.previous.customer_id for e in events if e.previous])
    return NasiyaDiffOut(previous_report_id=prev.id, previous_date=prev.report_date, counts=_counts(events),
                         events=[_event_out(e, customers) for e in events])


# ---- how long each phone has been in its state ----
@dataclass(frozen=True)
class Since:
    since: date | None
    exact: bool


async def _since(session: AsyncSession, report: NasiyaReport, rows: list[Row]) -> dict[str, Since]:
    """For each IMEI of the report: the first confirmed day of its current unbroken run at the same customer in the
    same state. A run that reaches the first confirmed day is not exact (it may have started earlier)."""
    imeis = {r.imei for r in rows if r.imei and group_of(r.kind) in ("debt", "qoldiq")}
    if not imeis:
        return {}
    days = [(rid, d) for rid, d in (await session.execute(
        select(NasiyaReport.id, NasiyaReport.report_date)
        .where(NasiyaReport.status == "confirmed", NasiyaReport.report_date <= report.report_date)
        .order_by(NasiyaReport.report_date.desc()))).all()]
    if not days or days[0][0] != report.id:
        days = [(report.id, report.report_date)] + [x for x in days if x[0] != report.id]
    present: set[tuple[int, str, int | None, str]] = set()
    for rid, imei, cid, kind in (await session.execute(
            select(NasiyaItem.report_id, NasiyaItem.imei, NasiyaSheet.customer_id, NasiyaItem.kind)
            .join(NasiyaSheet, NasiyaSheet.id == NasiyaItem.sheet_id)
            .where(NasiyaItem.report_id.in_([d[0] for d in days]), NasiyaItem.imei.in_(imeis)))).all():
        present.add((rid, imei, cid, group_of(kind)))
    out: dict[str, Since] = {}
    for r in rows:
        if not r.imei or r.imei in out or group_of(r.kind) not in ("debt", "qoldiq"):
            continue
        key = (r.customer_id, group_of(r.kind))
        start, exact = days[0][1], False
        for i, (rid, d) in enumerate(days):
            if (rid, r.imei, *key) in present:
                start = d
                exact = i + 1 < len(days)
            else:
                exact = True
                break
        if r.marked_date and r.marked_date <= report.report_date and r.marked_date < start:
            start, exact = r.marked_date, True
        out[r.imei] = Since(start, exact)
    return out


def _bucket_index(age: int) -> int:
    for i, (lo, hi, _) in enumerate(AGING):
        if age >= lo and (hi is None or age <= hi):
            return i
    return 0


def _aging(entries: list[tuple[int, Row]]) -> list[NasiyaAgingBucket]:
    qty, amount = [0] * len(AGING), [ZERO] * len(AGING)
    for age, r in entries:
        i = _bucket_index(age)
        qty[i] += r.qty
        amount[i] += r.amount
    return [NasiyaAgingBucket(label=label, min_days=lo, max_days=hi, qty=qty[i], amount=amount[i])
            for i, (lo, hi, label) in enumerate(AGING)]


# ---- totals ----
def _totals(rows: list[Row], qoldiq_value: Decimal, ages: dict[str, int]) -> NasiyaTotals:
    t = defaultdict(lambda: [0, ZERO])
    overdue_qty, overdue_usd = 0, ZERO
    for r in rows:
        t[r.kind][0] += r.qty
        t[r.kind][1] += r.amount
        age = ages.get(r.imei) if r.imei else None
        if r.kind in DEBT_KINDS and r.term_days is not None and age is not None and age > r.term_days:
            overdue_qty += r.qty
            overdue_usd += r.amount
    return NasiyaTotals(
        debt_usd=t["nasiya"][1] + t["variant"][1], debt_qty=t["nasiya"][0] + t["variant"][0],
        nasiya_usd=t["nasiya"][1], variant_usd=t["variant"][1], qoldiq_qty=t["qoldiq"][0],
        qoldiq_value_usd=qoldiq_value, sotuv_usd=t["sotuv"][1], sotuv_qty=t["sotuv"][0],
        overdue_qty=overdue_qty, overdue_usd=overdue_usd)


def _ages(report: NasiyaReport, since: dict[str, Since]) -> dict[str, int]:
    return {imei: (report.report_date - s.since).days for imei, s in since.items() if s.since}


@dataclass
class _Day:
    report: NasiyaReport
    rows: list[Row]
    sheets: list[NasiyaSheet]
    since: dict[str, Since]
    ages: dict[str, int]
    prev: NasiyaReport | None
    events: list[Event]


async def _load_day(session: AsyncSession, report: NasiyaReport) -> _Day:
    rows = await _rows(session, report.id)
    since = await _since(session, report, rows)
    prev = await previous_confirmed(session, report.report_date)
    events = compute_events(await _rows(session, prev.id), rows) if prev else []
    return _Day(report, rows, await _sheets(session, report.id), since, _ages(report, since), prev, events)


def _customer_rows(day: _Day, customers: dict[int, Customer], panel_debt: dict[int, Decimal]) -> list[NasiyaCustomerRow]:
    sheets_by_customer: dict[int, list[NasiyaSheet]] = defaultdict(list)
    for s in day.sheets:
        if s.customer_id is not None:
            sheets_by_customer[s.customer_id].append(s)
    rows_by_customer: dict[int, list[Row]] = defaultdict(list)
    for r in day.rows:
        if r.customer_id is not None:
            rows_by_customer[r.customer_id].append(r)
    events_by_customer: dict[int, list[Event]] = defaultdict(list)
    for e in day.events:
        events_by_customer[e.row.customer_id].append(e)
        if e.type == "moved" and e.previous and e.previous.customer_id != e.row.customer_id:
            events_by_customer[e.previous.customer_id].append(e)
    out = []
    for cid, sheets in sheets_by_customer.items():
        rows = rows_by_customer.get(cid, [])
        summaries = [s.summary or {} for s in sheets]
        qoldiq_value = sum((_decimal(s.get("qoldiq")) or ZERO for s in summaries), ZERO)
        limits = [v for s in summaries if (v := _decimal(s.get("limit"))) is not None]
        limit = sum(limits, ZERO) if limits else None
        file_nasiya = [v for s in summaries if (v := _decimal(s.get("nasiya"))) is not None]
        totals = _totals(rows, qoldiq_value, day.ages)
        exposure = totals.debt_usd + qoldiq_value
        debt_ages = [(day.ages[r.imei], r) for r in rows if r.kind in DEBT_KINDS and r.imei in day.ages]
        evs = events_by_customer.get(cid, [])
        out.append(NasiyaCustomerRow(
            customer=customer_ref(customers[cid]), sheet_name=", ".join(s.name for s in sheets), totals=totals,
            limit_usd=limit, exposure_usd=exposure, available_usd=(limit - exposure) if limit is not None else None,
            over_limit=limit is not None and exposure > limit,
            max_age_days=max((a for a, _ in debt_ages), default=None), aging=_aging(debt_ages),
            new_debt_usd=sum((e.amount for e in evs if e.type in ("new_debt", "qoldiq_to_debt")), ZERO),
            paid_usd=sum((e.amount for e in evs if e.type in ("paid", "sold_paid", "sold_direct")), ZERO),
            alert_count=sum(e.alert for e in evs),
            file_nasiya_usd=sum(file_nasiya, ZERO) if file_nasiya else None,
            panel_debt_usd=panel_debt.get(cid), error_count=sum(s.error_count for s in sheets)))
    out.sort(key=lambda r: (-r.totals.debt_usd, r.customer.name))
    return out


async def _panel_debts(session: AsyncSession) -> dict[int, Decimal]:
    return {b.customer.id: b.debt for b in await accounts.summary(session)}


async def _history_start(session: AsyncSession) -> date | None:
    return (await session.execute(
        select(func.min(NasiyaReport.report_date)).where(NasiyaReport.status == "confirmed"))).scalar_one()


# ---- public reads ----
async def overview(session: AsyncSession, on: date | None = None) -> NasiyaOverviewOut:
    pending = await nasiya_reports.pending_count(session)
    report = await latest_confirmed(session, on)
    if report is None:
        return NasiyaOverviewOut(report=None, previous_date=None, totals=None, previous_totals=None,
                                 aging=_aging([]), customers=[], counts=[], alerts=[], pending_reports=pending,
                                 history_start=None)
    day = await _load_day(session, report)
    customers = await _customers(session, [r.customer_id for r in day.rows] + [s.customer_id for s in day.sheets]
                                 + [e.previous.customer_id for e in day.events if e.previous])
    rows = _customer_rows(day, customers, await _panel_debts(session))
    qoldiq_value = sum((r.totals.qoldiq_value_usd for r in rows), ZERO)
    previous_totals = None
    if day.prev is not None:
        prev_sheets = await _sheets(session, day.prev.id)
        prev_value = sum((_decimal((s.summary or {}).get("qoldiq")) or ZERO for s in prev_sheets), ZERO)
        previous_totals = _totals(await _rows(session, day.prev.id), prev_value, {})
    debt_ages = [(day.ages[r.imei], r) for r in day.rows if r.kind in DEBT_KINDS and r.imei in day.ages]
    return NasiyaOverviewOut(
        report=(await nasiya_reports.summaries(session, [report]))[0],
        previous_date=day.prev.report_date if day.prev else None,
        totals=_totals(day.rows, qoldiq_value, day.ages), previous_totals=previous_totals, aging=_aging(debt_ages),
        customers=rows, counts=_counts(day.events),
        alerts=[_event_out(e, customers) for e in day.events if e.alert], pending_reports=pending,
        history_start=await _history_start(session))


async def series(session: AsyncSession, days: int = 90, customer_id: int | None = None,
                 until: date | None = None) -> list[NasiyaSeriesPoint]:
    is_debt = NasiyaItem.kind.in_(DEBT_KINDS)
    amount = NasiyaItem.qty * func.coalesce(NasiyaItem.price_usd, 0)
    stmt = (select(NasiyaReport.id, NasiyaReport.report_date,
                   func.coalesce(func.sum(amount).filter(is_debt), 0),
                   func.coalesce(func.sum(NasiyaItem.qty).filter(is_debt), 0),
                   func.coalesce(func.sum(NasiyaItem.qty).filter(NasiyaItem.kind == "qoldiq"), 0),
                   func.coalesce(func.sum(amount).filter(NasiyaItem.kind == "sotuv"), 0),
                   func.coalesce(func.sum(NasiyaItem.qty).filter(NasiyaItem.kind == "sotuv"), 0))
            .select_from(NasiyaReport)
            .outerjoin(NasiyaItem, NasiyaItem.report_id == NasiyaReport.id)
            .where(NasiyaReport.status == "confirmed")
            .group_by(NasiyaReport.id, NasiyaReport.report_date).order_by(NasiyaReport.report_date))
    if customer_id is not None:
        stmt = stmt.join(NasiyaSheet, NasiyaSheet.id == NasiyaItem.sheet_id).where(NasiyaSheet.customer_id == customer_id)
    end = until
    if end is None:
        latest = await latest_confirmed(session)
        end = latest.report_date if latest else None
    if end is not None:
        stmt = stmt.where(NasiyaReport.report_date <= end, NasiyaReport.report_date > end - timedelta(days=days))
    return [NasiyaSeriesPoint(report_id=rid, date=d, debt_usd=Decimal(debt), debt_qty=int(debt_qty),
                              qoldiq_qty=int(q_qty), sotuv_usd=Decimal(s_usd), sotuv_qty=int(s_qty))
            for rid, d, debt, debt_qty, q_qty, s_usd, s_qty in (await session.execute(stmt)).all()]


async def customer_detail(session: AsyncSession, customer_id: int, on: date | None = None) -> NasiyaCustomerDetail:
    customer = await catalog.get_customer(session, customer_id)
    report = await latest_confirmed(session, on)
    ref = customer_ref(customer)
    if report is None:
        return NasiyaCustomerDetail(customer=ref, report=None, row=None, items=[], models=[], events=[], series=[],
                                    schedule=[])
    day = await _load_day(session, report)
    customers = await _customers(session, [customer_id] + [e.previous.customer_id for e in day.events if e.previous]
                                 + [e.row.customer_id for e in day.events])
    rows = [r for r in _customer_rows(day, customers, await _panel_debts(session)) if r.customer.id == customer_id]
    mine = [r for r in day.rows if r.customer_id == customer_id]
    items = []
    for r in mine:
        s = day.since.get(r.imei) if r.imei else None
        age = day.ages.get(r.imei) if r.imei else None
        items.append(NasiyaDebtItemOut(
            kind=r.kind, model=r.model, imei=r.imei, qty=r.qty, price_usd=r.price, since=s.since if s else None,
            since_exact=s.exact if s else False, age_days=age, term_days=r.term_days,
            overdue=r.kind in DEBT_KINDS and r.term_days is not None and age is not None and age > r.term_days,
            marked_date=r.marked_date))
    kind_order = {"nasiya": 0, "variant": 1, "qoldiq": 2, "sotuv": 3}
    items.sort(key=lambda i: (kind_order[i.kind], -(i.age_days or 0), i.model, i.imei or ""))
    models: dict[tuple[str, str], list] = {}
    for r in mine:
        m = models.setdefault((r.kind, r.model), [0, ZERO])
        m[0] += r.qty
        m[1] += r.amount
    events = [e for e in day.events if e.row.customer_id == customer_id
              or (e.previous is not None and e.previous.customer_id == customer_id)]
    schedule = []
    for s in day.sheets:
        if s.customer_id == customer_id:
            schedule.extend((s.summary or {}).get("schedule", []))
    return NasiyaCustomerDetail(
        customer=ref, report=(await nasiya_reports.summaries(session, [report]))[0], row=rows[0] if rows else None,
        items=items,
        models=[NasiyaModelRow(kind=k, model=m, qty=v[0], amount=v[1])
                for (k, m), v in sorted(models.items(), key=lambda kv: (kind_order[kv[0][0]], -kv[1][0], kv[0][1]))],
        events=[_event_out(e, customers) for e in events],
        series=await series(session, 90, customer_id, until=report.report_date), schedule=schedule)


async def imei_trail(session: AsyncSession, imei: str) -> list[NasiyaImeiTrailRow]:
    rows = (await session.execute(
        select(NasiyaReport.report_date, NasiyaReport.id, NasiyaSheet.customer_id, NasiyaSheet.name, NasiyaItem.kind,
               NasiyaItem.model, NasiyaItem.price_usd, NasiyaItem.cell)
        .join(NasiyaSheet, NasiyaSheet.id == NasiyaItem.sheet_id)
        .join(NasiyaReport, NasiyaReport.id == NasiyaItem.report_id)
        .where(NasiyaItem.imei == imei.strip(), NasiyaReport.status == "confirmed")
        .order_by(NasiyaReport.report_date.desc(), NasiyaItem.id))).all()
    customers = await _customers(session, [r[2] for r in rows])
    return [NasiyaImeiTrailRow(date=d, report_id=rid, customer=customer_ref(customers.get(cid)), sheet_name=name,
                               kind=kind, model=model, price_usd=price, cell=cell)
            for d, rid, cid, name, kind, model, price, cell in rows]

