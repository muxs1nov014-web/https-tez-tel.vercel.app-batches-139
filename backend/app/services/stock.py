from datetime import date
from decimal import Decimal
from typing import NamedTuple

from sqlalchemy import Select, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound, ValidationFailed
from app.models import (
    Batch,
    ConsignmentEntry,
    ConsignmentMove,
    Product,
    PurchaseLine,
    Sale,
    SaleAllocation,
    SaleLine,
    StockAdjustment,
)
from app.schemas import OpeningResultOut, Ref, StockLineOut, StockRowOut


def _sold_subq():
    return (select(SaleAllocation.purchase_line_id.label("pl_id"), func.sum(SaleAllocation.qty).label("q"))
            .group_by(SaleAllocation.purchase_line_id).subquery())


def _adj_subq():
    return (select(StockAdjustment.purchase_line_id.label("pl_id"), func.sum(StockAdjustment.qty).label("q"))
            .group_by(StockAdjustment.purchase_line_id).subquery())


def _consigned_subq():
    """Units of each purchase line currently at customers (SPEC §12.2): Σ signed consignment entries."""
    return (select(ConsignmentEntry.purchase_line_id.label("pl_id"), func.sum(ConsignmentEntry.qty).label("q"))
            .group_by(ConsignmentEntry.purchase_line_id).subquery())


class LineMovements(NamedTuple):
    sold: int
    adjusted: int
    remaining: int  # in OUR warehouse: qty - sold - adjusted - consigned (index 2 kept for positional callers)
    consigned: int = 0  # currently at customers

    @property
    def moved(self) -> int:
        """Units that left our warehouse in any way; a line's qty may not drop below this."""
        return self.sold + self.adjusted + self.consigned


def line_movements_query() -> Select:
    """(purchase_line_id, sold, adjusted, consigned, remaining) for every purchase line."""
    sold, adj, cons = _sold_subq(), _adj_subq(), _consigned_subq()
    sold_q = func.coalesce(sold.c.q, 0)
    adj_q = func.coalesce(adj.c.q, 0)
    cons_q = func.coalesce(cons.c.q, 0)
    return (
        select(PurchaseLine.id, sold_q.label("sold"), adj_q.label("adjusted"), cons_q.label("consigned"),
               (PurchaseLine.qty - sold_q - adj_q - cons_q).label("remaining"))
        .outerjoin(sold, sold.c.pl_id == PurchaseLine.id)
        .outerjoin(adj, adj.c.pl_id == PurchaseLine.id)
        .outerjoin(cons, cons.c.pl_id == PurchaseLine.id)
    )


async def movements_for_lines(session: AsyncSession, line_ids: list[int]) -> dict[int, LineMovements]:
    if not line_ids:
        return {}
    rows = (await session.execute(line_movements_query().where(PurchaseLine.id.in_(line_ids)))).all()
    return {r.id: LineMovements(int(r.sold), int(r.adjusted), int(r.remaining), int(r.consigned)) for r in rows}


def own_stock_lines_query() -> Select:
    """Own (non-client) purchase lines with remaining > 0 in our warehouse, FIFO-ordered."""
    sold, adj, cons = _sold_subq(), _adj_subq(), _consigned_subq()
    remaining = (PurchaseLine.qty - func.coalesce(sold.c.q, 0) - func.coalesce(adj.c.q, 0)
                 - func.coalesce(cons.c.q, 0))
    return (
        select(PurchaseLine.id, PurchaseLine.product_id, PurchaseLine.batch_id, Batch.batch_date,
               PurchaseLine.unit_cost, remaining.label("remaining"))
        .join(Batch, Batch.id == PurchaseLine.batch_id)
        .outerjoin(sold, sold.c.pl_id == PurchaseLine.id)
        .outerjoin(adj, adj.c.pl_id == PurchaseLine.id)
        .outerjoin(cons, cons.c.pl_id == PurchaseLine.id)
        .where(PurchaseLine.client_id.is_(None), remaining > 0)
        .order_by(Batch.batch_date, PurchaseLine.id)
    )


async def stock_rows(session: AsyncSession, q: str | None = None,
                     product_ids: list[int] | None = None) -> list[StockRowOut]:
    stmt = own_stock_lines_query()
    if product_ids is not None:
        stmt = stmt.where(PurchaseLine.product_id.in_(product_ids))
    if q:
        stmt = stmt.join(Product, Product.id == PurchaseLine.product_id)
        for token in q.lower().split():
            stmt = stmt.where(Product.search_text.contains(token))
    rows = (await session.execute(stmt)).all()
    names = {}
    if rows:
        ids = {r.product_id for r in rows}
        names = dict((await session.execute(select(Product.id, Product.name).where(Product.id.in_(ids)))).all())
    grouped: dict[int, list] = {}
    for r in rows:
        grouped.setdefault(r.product_id, []).append(r)
    result = []
    for product_id, lines in grouped.items():
        qty = sum(int(r.remaining) for r in lines)
        value = sum((Decimal(r.remaining) * r.unit_cost for r in lines), Decimal(0))
        result.append(StockRowOut(
            product=Ref(id=product_id, name=names.get(product_id, "")),
            qty=qty,
            avg_unit_cost=value / qty if qty else Decimal(0),
            stock_value=value,
            lines=[StockLineOut(purchase_line_id=r.id, batch_id=r.batch_id, batch_date=r.batch_date,
                                remaining_qty=int(r.remaining), unit_cost=r.unit_cost) for r in lines],
        ))
    result.sort(key=lambda row: row.product.name)
    return result


async def lock_product_lines(session: AsyncSession, product_ids: list[int]) -> None:
    """Row-lock all purchase lines of the products, always in id order (same order as sales -> no deadlocks)."""
    await session.execute(select(PurchaseLine.id).where(PurchaseLine.product_id.in_(product_ids))
                          .order_by(PurchaseLine.id).with_for_update())


async def set_opening_balance(session: AsyncSession, as_of: date,
                              items: list[tuple[int, int]]) -> list[OpeningResultOut]:
    """Set on-hand qty as of `as_of`: keep the newest units, write off the rest (FIFO-consistent).

    Re-running replaces the previous opening balance of the product. What left our warehouse after `as_of`
    came out of the counted stock, so it is subtracted: units sold from stock (source='stock') and the net qty
    handed over to customers (handovers − returns with move_date > as_of). Consignment sales are not subtracted:
    those units had already left our warehouse when they were handed over (SPEC §12.2).
    """
    product_ids = sorted({product_id for product_id, _ in items})
    for product_id in product_ids:
        if await session.get(Product, product_id) is None:
            raise NotFound(f"Mahsulot topilmadi: {product_id}")
    await lock_product_lines(session, product_ids)
    results = []
    for product_id, keep in items:
        own_ids = select(PurchaseLine.id).where(PurchaseLine.product_id == product_id,
                                                PurchaseLine.client_id.is_(None))
        await session.execute(delete(StockAdjustment).where(
            StockAdjustment.purchase_line_id.in_(own_ids), StockAdjustment.reason == "opening_balance"))
        line_ids = list((await session.execute(
            select(PurchaseLine.id)
            .join(Batch, Batch.id == PurchaseLine.batch_id)
            .where(PurchaseLine.product_id == product_id, PurchaseLine.client_id.is_(None),
                   Batch.batch_date <= as_of)
            .order_by(Batch.batch_date.desc(), PurchaseLine.id.desc())
        )).scalars())
        moves = await movements_for_lines(session, line_ids)
        available = sum(moves[i][2] for i in line_ids)
        sold_after = moved_after = 0
        if line_ids:
            sold_after = int((await session.execute(
                select(func.coalesce(func.sum(SaleAllocation.qty), 0))
                .join(SaleLine, SaleLine.id == SaleAllocation.sale_line_id)
                .join(Sale, Sale.id == SaleLine.sale_id)
                .where(SaleAllocation.purchase_line_id.in_(line_ids), Sale.sale_date > as_of,
                       Sale.source == "stock")
            )).scalar_one())
            # Joining the move keeps only handover (+) / return (-) entries; consignment-sale entries have no move.
            moved_after = int((await session.execute(
                select(func.coalesce(func.sum(ConsignmentEntry.qty), 0))
                .join(ConsignmentMove, ConsignmentMove.id == ConsignmentEntry.move_id)
                .where(ConsignmentEntry.purchase_line_id.in_(line_ids), ConsignmentMove.move_date > as_of)
            )).scalar_one())
        target = keep - sold_after - moved_after
        if target < 0:
            raise ValidationFailed(
                f"Mahsulot {product_id}: {as_of} dan keyin {sold_after} dona sotilgan va {moved_after} dona "
                f"mijozlarga berilgan (qaytarilganlar ayirilgan), qoldiq undan kam bo'lmaydi")
        if target > available:
            raise ValidationFailed(
                f"Mahsulot {product_id}: qoldiq {keep} dona, lekin {as_of} gacha xarid qilinib hali "
                f"sotilmagani {available + sold_after + moved_after} dona")
        to_keep, written_off = target, 0
        for line_id in line_ids:
            remaining = moves[line_id][2]
            kept_here = min(remaining, to_keep)
            to_keep -= kept_here
            excess = remaining - kept_here
            if excess > 0:
                session.add(StockAdjustment(purchase_line_id=line_id, qty=excess, reason="opening_balance",
                                            note=f"Boshlang'ich qoldiq {as_of}"))
                written_off += excess
        results.append(OpeningResultOut(product_id=product_id, kept=keep, written_off=written_off))
    await session.flush()
    return results


async def add_adjustment(session: AsyncSession, purchase_line_id: int, qty: int, reason: str,
                         note: str | None) -> StockAdjustment:
    # of=PurchaseLine: the joined eager loads are outer joins, which Postgres cannot lock FOR UPDATE.
    line = (await session.execute(select(PurchaseLine).where(PurchaseLine.id == purchase_line_id)
                                  .with_for_update(of=PurchaseLine))).scalar_one_or_none()
    if line is None:
        raise NotFound("Xarid qatori topilmadi")
    if line.client_id is not None:
        raise ValidationFailed("Mijoz yuki omborga kirmaydi")
    remaining = (await movements_for_lines(session, [line.id]))[line.id][2]
    if qty > remaining:
        raise ValidationFailed(f"Qoldiq yetarli emas: {remaining} dona")
    adjustment = StockAdjustment(purchase_line_id=line.id, qty=qty, reason=reason, note=note)
    session.add(adjustment)
    await session.flush()
    return adjustment
