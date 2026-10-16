from datetime import date
from decimal import Decimal

from sqlalchemy import case, exists, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import Conflict, NotFound, ValidationFailed
from app.domain.costing import (
    ALL_CATEGORIES,
    BATCH_CATEGORIES,
    CATEGORY_LABELS,
    LINE_CATEGORIES,
    LineInput,
    compute_batch,
)
from app.models import Batch, BatchExpense, ConsignmentEntry, PurchaseLine, SaleAllocation, StockAdjustment
from app.schemas import (
    BatchDetail,
    BatchSummary,
    BatchTotals,
    CategoryTotalOut,
    ChannelRef,
    ExpenseIn,
    ExpenseOut,
    LineIn,
    LineOut,
    PerUnitOut,
    Ref,
)
from app.services import catalog
from app.services import settings as settings_service
from app.services.stock import LineMovements, movements_for_lines

Q4 = Decimal("0.0001")
PER_UNIT_FIELDS = ("perevod_pct", "cargo", "imei", "airport_road", "inspector", "bu", "packaging", "sim",
                   "rastamojka")


def _line_input(line: PurchaseLine) -> LineInput:
    return LineInput(
        key=line.id, qty=line.qty, price_aed=line.price_aed, rate=line.rate,
        perevod_pct=line.perevod_pct, cargo=line.cargo, imei=line.imei, airport_road=line.airport_road,
        inspector=line.inspector, bu=line.bu, packaging=line.packaging, sim=line.sim,
        rastamojka=line.rastamojka,
    )


def _expense_sums(expenses: list[BatchExpense]) -> tuple[dict[str, Decimal], dict[str, Decimal]]:
    estimates: dict[str, Decimal] = {}
    actuals: dict[str, Decimal] = {}
    for e in expenses:
        target = actuals if e.kind == "actual" else estimates
        target[e.category] = target.get(e.category, Decimal(0)) + e.amount_usd
    return estimates, actuals


async def load(session: AsyncSession, batch_id: int, lock: bool = False) -> Batch:
    stmt = (select(Batch).where(Batch.id == batch_id)
            .options(selectinload(Batch.lines), selectinload(Batch.expenses))
            .execution_options(populate_existing=True))
    if lock:
        stmt = stmt.with_for_update(of=Batch)
    batch = (await session.execute(stmt)).scalar_one_or_none()
    if batch is None:
        raise NotFound("Partiya topilmadi")
    if lock:
        # Sales lock purchase lines (id order); edits must take the same row locks to not race them.
        await session.execute(select(PurchaseLine.id).where(PurchaseLine.batch_id == batch_id)
                              .order_by(PurchaseLine.id).with_for_update())
    return batch


async def recalculate(session: AsyncSession, batch: Batch) -> None:
    """Recompute and store unit costs for every line of the batch."""
    if not batch.lines:
        return
    estimates, actuals = _expense_sums(batch.expenses)
    result = compute_batch([_line_input(line) for line in batch.lines], estimates, actuals)
    for line in batch.lines:
        cost = result.line(line.id)
        line.unit_cost_est = cost.unit_cost_est.quantize(Q4)
        line.unit_cost = cost.unit_cost.quantize(Q4)
    await session.flush()


async def get_detail(session: AsyncSession, batch_id: int) -> BatchDetail:
    batch = await load(session, batch_id)
    estimates, actuals = _expense_sums(batch.expenses)
    result = compute_batch([_line_input(line) for line in batch.lines], estimates, actuals)
    moves = await movements_for_lines(session, [line.id for line in batch.lines])
    lines_out, warnings = [], []
    for line in batch.lines:
        cost = result.line(line.id)
        sold, adjusted, remaining, consigned = moves.get(line.id, LineMovements(0, 0, line.qty))
        if line.rastamojka == 0:
            warnings.append(f"{line.product.name}: rastamojka 0 (bojxona tarifi topilmadi yoki kiritilmagan)")
        lines_out.append(LineOut(
            id=line.id,
            product=Ref(id=line.product.id, name=line.product.name),
            channel=ChannelRef(id=line.channel.id, code=line.channel.code, name=line.channel.name),
            qty=line.qty, price_aed=line.price_aed, rate=line.rate, price_usd=cost.price_usd,
            client=Ref(id=line.client.id, name=line.client.name) if line.client else None,
            service_pct=line.service_pct, note=line.note, raw_name=line.raw_name,
            estimates={f: getattr(line, f) for f in PER_UNIT_FIELDS},
            per_unit={code: PerUnitOut(estimate=est, effective=eff) for code, (est, eff) in cost.per_unit.items()},
            unit_cost_est=cost.unit_cost_est, unit_cost=cost.unit_cost,
            overhead_est=cost.overhead_est, overhead=cost.overhead,
            sold_qty=sold, adjusted_qty=adjusted, consigned_qty=consigned,
            remaining_qty=remaining if line.client_id is None else 0,
        ))
    price_total = sum((c.price_usd * c.qty for c in result.lines), Decimal(0))
    cost_est = sum((c.unit_cost_est * c.qty for c in result.lines), Decimal(0))
    cost = sum((c.unit_cost * c.qty for c in result.lines), Decimal(0))
    return BatchDetail(
        id=batch.id, batch_date=batch.batch_date, code=batch.code, note=batch.note,
        total_qty=sum(line.qty for line in batch.lines),
        lines=lines_out,
        expenses=[ExpenseOut.model_validate(e) for e in batch.expenses],
        categories=[CategoryTotalOut(code=c.code, label=CATEGORY_LABELS[c.code], level=c.level,
                                     estimate_total=c.estimate_total, actual_total=c.actual_total,
                                     effective_total=c.effective_total) for c in result.categories],
        totals=BatchTotals(price_usd=price_total, cost_est=cost_est, cost=cost,
                           overhead_est=cost_est - price_total, overhead=cost - price_total),
        warnings=warnings,
    )


async def list_batches(session: AsyncSession, date_from: date | None = None,
                       date_to: date | None = None) -> list[BatchSummary]:
    pl = PurchaseLine
    has_actuals = exists().where(BatchExpense.batch_id == Batch.id, BatchExpense.kind == "actual")
    stmt = (
        select(
            Batch.id, Batch.batch_date, Batch.code, Batch.note,
            func.coalesce(func.sum(pl.qty), 0).label("total_qty"),
            func.coalesce(func.sum(case((pl.client_id.is_(None), pl.qty), else_=0)), 0).label("own_qty"),
            func.coalesce(func.sum(pl.qty * pl.price_aed / pl.rate), 0).label("price_total"),
            func.coalesce(func.sum(pl.qty * pl.unit_cost_est), 0).label("cost_est"),
            func.coalesce(func.sum(pl.qty * pl.unit_cost), 0).label("cost"),
            has_actuals.label("has_actuals"),
        )
        .outerjoin(pl, pl.batch_id == Batch.id)
        .group_by(Batch.id)
        .order_by(Batch.batch_date.desc())
    )
    if date_from:
        stmt = stmt.where(Batch.batch_date >= date_from)
    if date_to:
        stmt = stmt.where(Batch.batch_date <= date_to)
    rows = (await session.execute(stmt)).all()
    return [
        BatchSummary(
            id=r.id, batch_date=r.batch_date, code=r.code, note=r.note,
            total_qty=int(r.total_qty), own_qty=int(r.own_qty), client_qty=int(r.total_qty) - int(r.own_qty),
            price_usd_total=r.price_total, cost_est_total=r.cost_est, cost_total=r.cost,
            overhead_per_unit_avg=(r.cost - r.price_total) / r.total_qty if r.total_qty else Decimal(0),
            has_actuals=bool(r.has_actuals),
        )
        for r in rows
    ]


async def _build_line(session: AsyncSession, batch: Batch, data: LineIn) -> PurchaseLine:
    defaults = await settings_service.get_all(session)
    product = await catalog.get_product(session, data.product_id)
    channel = (await catalog.get_channel(session, data.channel_id) if data.channel_id
               else await catalog.default_channel(session))
    if data.client_id is not None:
        await catalog.get_customer(session, data.client_id)
    rastamojka = data.rastamojka
    if rastamojka is None:
        _, _, rastamojka = await catalog.estimate_rastamojka(session, product, channel, batch.batch_date)
    zero = Decimal(0)
    return PurchaseLine(
        batch_id=batch.id, product_id=product.id, channel_id=channel.id,
        qty=data.qty, price_aed=data.price_aed, rate=data.rate or defaults["default_rate"],
        perevod_pct=data.perevod_pct if data.perevod_pct is not None else defaults["default_perevod_pct"],
        cargo=data.cargo if data.cargo is not None else defaults["default_cargo"],
        imei=data.imei if data.imei is not None else defaults["default_imei"],
        airport_road=data.airport_road or zero, inspector=data.inspector or zero, bu=data.bu or zero,
        packaging=data.packaging or zero, sim=data.sim or zero, rastamojka=rastamojka,
        client_id=data.client_id, service_pct=data.service_pct, note=data.note,
    )


def _validate_expense(data: ExpenseIn) -> None:
    if data.category not in ALL_CATEGORIES:
        raise ValidationFailed(f"Noma'lum xarajat turi: {data.category}")
    if data.kind == "estimate" and data.category in LINE_CATEGORIES:
        raise ValidationFailed("Bu xarajatning taxminiy qiymati har bir qatorda kiritiladi")


async def create_batch(session: AsyncSession, batch_date: date, code: str | None, note: str | None,
                       lines: list[LineIn], expenses: list[ExpenseIn], user_id: int | None) -> Batch:
    for e in expenses:
        _validate_expense(e)
    batch = Batch(batch_date=batch_date, code=code, note=note)
    session.add(batch)
    try:
        async with session.begin_nested():
            await session.flush()
    except IntegrityError as exc:
        raise Conflict(f"{batch_date} sanasi uchun partiya allaqachon mavjud") from exc
    for data in lines:
        session.add(await _build_line(session, batch, data))
    for e in expenses:
        session.add(BatchExpense(batch_id=batch.id, category=e.category, kind=e.kind, amount_usd=e.amount_usd,
                                 note=e.note, created_by=user_id))
    await session.flush()
    await recalculate(session, await load(session, batch.id))
    return batch


async def update_batch(session: AsyncSession, batch_id: int, changes: dict) -> None:
    batch = await load(session, batch_id)
    for key, value in changes.items():
        setattr(batch, key, value)
    await session.flush()


async def _has_allocations(session: AsyncSession, line_ids: list[int]) -> bool:
    if not line_ids:
        return False
    stmt = select(func.count()).select_from(SaleAllocation).where(SaleAllocation.purchase_line_id.in_(line_ids))
    return (await session.execute(stmt)).scalar_one() > 0


async def _has_consignment_entries(session: AsyncSession, line_ids: list[int]) -> bool:
    """Any handover history on the lines (even if fully returned) blocks deleting them (FK + audit trail)."""
    if not line_ids:
        return False
    stmt = select(exists().where(ConsignmentEntry.purchase_line_id.in_(line_ids)))
    return bool((await session.execute(stmt)).scalar_one())


async def delete_batch(session: AsyncSession, batch_id: int) -> None:
    batch = await load(session, batch_id, lock=True)
    line_ids = [line.id for line in batch.lines]
    if await _has_allocations(session, line_ids):
        raise Conflict("Bu partiyadan sotuv qilingan, o'chirib bo'lmaydi")
    if await _has_consignment_entries(session, line_ids):
        raise Conflict("Bu partiyadan mijozga mol berilgan, o'chirib bo'lmaydi")
    await session.delete(batch)
    await session.flush()


async def add_line(session: AsyncSession, batch_id: int, data: LineIn) -> None:
    batch = await load(session, batch_id, lock=True)
    session.add(await _build_line(session, batch, data))
    await session.flush()
    await recalculate(session, await load(session, batch_id))


async def update_line(session: AsyncSession, batch_id: int, line_id: int, changes: dict) -> None:
    batch = await load(session, batch_id, lock=True)
    line = next((ln for ln in batch.lines if ln.id == line_id), None)
    if line is None:
        raise NotFound("Qator topilmadi")
    required = ("product_id", "channel_id", "qty", "price_aed", "rate")
    nullable = ("client_id", "service_pct", "note")
    changes = {k: v for k, v in changes.items() if not (v is None and k in required)}
    moved = (await movements_for_lines(session, [line.id]))[line.id].moved  # sold + adjusted + at customers
    if "qty" in changes and changes["qty"] < moved:
        raise ValidationFailed(
            f"Sotilgan/hisobdan chiqarilgan/mijozga berilgan: {moved} dona, undan kam bo'lmaydi")
    client_changed = "client_id" in changes and changes["client_id"] != line.client_id
    product_changed = "product_id" in changes and changes["product_id"] != line.product_id
    channel_changed = "channel_id" in changes and changes["channel_id"] != line.channel_id
    # Handover/return documents point at this line: even when everything came back (moved = 0), changing the
    # product or making it a client line would rewrite the customer's history.
    has_history = moved > 0 or ((client_changed or product_changed)
                                and await _has_consignment_entries(session, [line.id]))
    if client_changed and has_history:
        raise ValidationFailed("Sotuvi yoki mijozga berish tarixi bor qatorni mijoz yukiga o'tkazib bo'lmaydi")
    if product_changed:
        if has_history:
            raise ValidationFailed("Sotuvi, qoldiq tuzatishi yoki mijozga berish tarixi bor qatorning mahsulotini "
                                   "o'zgartirib bo'lmaydi")
        await catalog.get_product(session, changes["product_id"])
    if channel_changed:
        await catalog.get_channel(session, changes["channel_id"])
    if changes.get("client_id"):
        await catalog.get_customer(session, changes["client_id"])
    re_estimate = "rastamojka" not in changes and (product_changed or channel_changed)
    for key, value in changes.items():
        if value is None and key not in nullable:
            value = Decimal(0)  # a cleared per-unit cost means zero
        setattr(line, key, value)
    await session.flush()
    if re_estimate:
        refreshed = await load(session, batch_id)
        line = next(ln for ln in refreshed.lines if ln.id == line_id)
        _, _, line.rastamojka = await catalog.estimate_rastamojka(session, line.product, line.channel,
                                                                  refreshed.batch_date)
        await session.flush()
    await recalculate(session, await load(session, batch_id))


async def delete_line(session: AsyncSession, batch_id: int, line_id: int) -> None:
    batch = await load(session, batch_id, lock=True)
    line = next((ln for ln in batch.lines if ln.id == line_id), None)
    if line is None:
        raise NotFound("Qator topilmadi")
    if await _has_allocations(session, [line.id]):
        raise Conflict("Bu qatordan sotuv qilingan, o'chirib bo'lmaydi")
    if await _has_consignment_entries(session, [line.id]):
        raise Conflict("Bu qatordan mijozga mol berilgan, o'chirib bo'lmaydi")
    await session.execute(StockAdjustment.__table__.delete().where(StockAdjustment.purchase_line_id == line.id))
    await session.delete(line)
    await session.flush()
    await recalculate(session, await load(session, batch_id))


async def add_expense(session: AsyncSession, batch_id: int, data: ExpenseIn, user_id: int | None) -> None:
    _validate_expense(data)
    await load(session, batch_id, lock=True)
    session.add(BatchExpense(batch_id=batch_id, category=data.category, kind=data.kind,
                             amount_usd=data.amount_usd, note=data.note, created_by=user_id))
    await session.flush()
    await recalculate(session, await load(session, batch_id))


async def delete_expense(session: AsyncSession, batch_id: int, expense_id: int) -> None:
    batch = await load(session, batch_id, lock=True)
    expense = next((e for e in batch.expenses if e.id == expense_id), None)
    if expense is None:
        raise NotFound("Xarajat topilmadi")
    await session.delete(expense)
    await session.flush()
    await recalculate(session, await load(session, batch_id))


def category_list() -> list[dict]:
    return [{"code": c, "label": CATEGORY_LABELS[c], "level": "line" if c in LINE_CATEGORIES else "batch"}
            for c in (*LINE_CATEGORIES, *BATCH_CATEGORIES)]
