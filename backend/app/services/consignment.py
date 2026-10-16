"""Customer warehouses (SPEC §12.1–12.2): handovers, returns, consignment sales and the customer's stock.

Every unit at a customer is a signed `ConsignmentEntry` on a purchase line: +q handover, -q return, -q sold by
the customer. Our warehouse already subtracts those units (`stock.own_stock_lines_query`); a customer's stock is
the sum of their entries per line. All writers lock the product lines first, the same as sales.
"""

from collections import defaultdict
from decimal import Decimal
from typing import Literal, NamedTuple

from sqlalchemy import Select, and_, func, select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, NotFound, ValidationFailed
from app.models import (
    Batch,
    ConsignmentEntry,
    ConsignmentMove,
    Product,
    PurchaseLine,
    Sale,
    SaleAllocation,
    SaleLine,
)
from app.schemas import (
    ConsignmentSaleIn,
    CustomerStockLineOut,
    CustomerStockRowOut,
    MoveIn,
    MoveLineOut,
    MoveOut,
    Ref,
)
from app.services import catalog
from app.services.stock import lock_product_lines, movements_for_lines, own_stock_lines_query

ZERO = Decimal(0)


class StockValue(NamedTuple):
    qty: int
    value_cost: Decimal
    value_price: Decimal


def _latest_handover_subq(customer_ids: list[int] | None):
    """Newest handover entry per (customer, line): its agreed price, date and move id (DISTINCT ON)."""
    stmt = (
        select(ConsignmentEntry.customer_id, ConsignmentEntry.purchase_line_id, ConsignmentEntry.price_usd,
               ConsignmentMove.move_date, ConsignmentMove.id.label("move_id"))
        .join(ConsignmentMove, ConsignmentMove.id == ConsignmentEntry.move_id)
        .where(ConsignmentMove.kind == "out")
        .ext(distinct_on(ConsignmentEntry.customer_id, ConsignmentEntry.purchase_line_id))
        .order_by(ConsignmentEntry.customer_id, ConsignmentEntry.purchase_line_id,
                  ConsignmentMove.move_date.desc(), ConsignmentMove.id.desc(), ConsignmentEntry.id.desc())
    )
    if customer_ids is not None:
        stmt = stmt.where(ConsignmentEntry.customer_id.in_(customer_ids))
    return stmt.subquery()


def customer_lines_query(customer_ids: list[int] | None = None,
                         order: Literal["fifo", "lifo"] = "fifo") -> Select:
    """Purchase lines a customer currently holds (qty > 0), with the latest agreed price of each line.

    Columns: customer_id, id (purchase line), product_id, batch_date, unit_cost, qty, price_usd, handover_date,
    handover_move_id. `fifo` = oldest batch first (consignment sales); `lifo` = newest handover first (returns).
    """
    held_qty = func.sum(ConsignmentEntry.qty)
    held = (select(ConsignmentEntry.customer_id, ConsignmentEntry.purchase_line_id, held_qty.label("qty"))
            .group_by(ConsignmentEntry.customer_id, ConsignmentEntry.purchase_line_id)
            .having(held_qty > 0))
    if customer_ids is not None:
        held = held.where(ConsignmentEntry.customer_id.in_(customer_ids))
    held = held.subquery()
    last = _latest_handover_subq(customer_ids)
    stmt = (
        select(held.c.customer_id, PurchaseLine.id, PurchaseLine.product_id, Batch.batch_date,
               PurchaseLine.unit_cost, held.c.qty, last.c.price_usd,
               last.c.move_date.label("handover_date"), last.c.move_id.label("handover_move_id"))
        .join(PurchaseLine, PurchaseLine.id == held.c.purchase_line_id)
        .join(Batch, Batch.id == PurchaseLine.batch_id)
        .outerjoin(last, and_(last.c.customer_id == held.c.customer_id,
                              last.c.purchase_line_id == held.c.purchase_line_id))
    )
    if order == "lifo":
        return stmt.order_by(last.c.move_date.desc().nulls_last(), last.c.move_id.desc().nulls_last(),
                             Batch.batch_date.desc(), PurchaseLine.id.desc())
    return stmt.order_by(Batch.batch_date, PurchaseLine.id)


def _take(candidates: list[tuple[int, int]], need: int, taken: dict[int, int], product_name: str,
          where: str) -> list[tuple[int, int]]:
    """Pick `need` units from (line_id, available) in the given order, minus what this document already took.

    409 with the available qty if there is not enough; `where` names the warehouse ("omborda" / "mijozda").
    """
    available = sum(max(qty - taken.get(line_id, 0), 0) for line_id, qty in candidates)
    if available < need:
        raise Conflict(f"{product_name}: {where} {available} dona bor, {need} dona so'raldi")
    picks = []
    for line_id, qty in candidates:
        free = qty - taken.get(line_id, 0)
        if free <= 0:
            continue
        q = min(free, need)
        picks.append((line_id, q))
        taken[line_id] = taken.get(line_id, 0) + q
        need -= q
        if need == 0:
            break
    return picks


async def _prepare(session: AsyncSession, customer_id: int, product_ids: set[int],
                   require_active: bool = False) -> dict[int, Product]:
    """404 on an unknown customer/product, then lock the product lines (serialises with sales)."""
    customer = await catalog.get_customer(session, customer_id)
    if require_active and not customer.is_active:
        raise ValidationFailed(f"{customer.name} faol emas: unga mol berib bo'lmaydi")
    ordered = sorted(product_ids)
    products = {pid: await catalog.get_product(session, pid) for pid in ordered}
    await lock_product_lines(session, ordered)
    return products


async def _customer_candidates(session: AsyncSession, customer_id: int, product_id: int,
                               order: Literal["fifo", "lifo"]) -> list[tuple[int, int]]:
    stmt = customer_lines_query([customer_id], order).where(PurchaseLine.product_id == product_id)
    return [(r.id, int(r.qty)) for r in (await session.execute(stmt)).all()]


async def create_move(session: AsyncSession, customer_id: int, data: MoveIn, user_id: int | None) -> ConsignmentMove:
    """Handover ('out', FIFO from our stock, at the agreed price) or return ('return', LIFO from the customer).

    All lines are allocated before anything is written, so a 409 leaves the session untouched.
    Goods are not handed over to an inactive customer (422); returns from them are still accepted.
    """
    products = await _prepare(session, customer_id, {line.product_id for line in data.lines},
                              require_active=data.kind == "out")
    taken: dict[int, int] = {}  # purchase_line_id -> qty already taken by this move
    planned = []  # (line item, [(purchase_line_id, qty)])
    for item in data.lines:
        if data.kind == "out":
            rows = (await session.execute(
                own_stock_lines_query().where(PurchaseLine.product_id == item.product_id))).all()
            candidates, where = [(r.id, int(r.remaining)) for r in rows], "omborda"
        else:
            candidates = await _customer_candidates(session, customer_id, item.product_id, "lifo")
            where = "mijozda"
        planned.append((item, _take(candidates, item.qty, taken, products[item.product_id].name, where)))

    move = ConsignmentMove(move_date=data.move_date, customer_id=customer_id, kind=data.kind, note=data.note,
                           created_by=user_id)
    session.add(move)
    await session.flush()
    sign = 1 if data.kind == "out" else -1
    for item, picks in planned:
        for line_id, q in picks:
            session.add(ConsignmentEntry(customer_id=customer_id, purchase_line_id=line_id, qty=sign * q,
                                         price_usd=item.price_usd if data.kind == "out" else None,
                                         move_id=move.id))
    await session.flush()
    return move


async def delete_move(session: AsyncSession, customer_id: int, move_id: int) -> None:
    """Refused (422) if the customer or our warehouse would go below zero on any line.

    Deleting a handover takes its units back from the customer: refused once they were sold or returned.
    Deleting a return puts its units back at the customer: refused once we sold or handed them on again.
    """
    move = await session.get(ConsignmentMove, move_id)
    if move is None or move.customer_id != customer_id:
        raise NotFound("Harakat topilmadi")
    entries = (await session.execute(
        select(ConsignmentEntry.purchase_line_id, ConsignmentEntry.qty).where(ConsignmentEntry.move_id == move_id)
    )).all()
    line_ids = sorted({e.purchase_line_id for e in entries})
    if line_ids:
        product_ids = sorted(set((await session.execute(
            select(PurchaseLine.product_id).where(PurchaseLine.id.in_(line_ids)))).scalars()))
        await lock_product_lines(session, product_ids)

    delta: dict[int, int] = defaultdict(int)  # line -> change of the customer's qty if the move disappears
    for e in entries:
        delta[e.purchase_line_id] -= e.qty
    held = dict((await session.execute(
        select(ConsignmentEntry.purchase_line_id, func.sum(ConsignmentEntry.qty))
        .where(ConsignmentEntry.customer_id == customer_id, ConsignmentEntry.purchase_line_id.in_(line_ids))
        .group_by(ConsignmentEntry.purchase_line_id)
    )).all()) if line_ids else {}
    if any(int(held.get(line_id, 0)) + d < 0 for line_id, d in delta.items()):
        raise ValidationFailed("Bu harakatdagi mollar allaqachon sotilgan yoki qaytarilgan, o'chirib bo'lmaydi")
    ours = await movements_for_lines(session, line_ids)
    if any(ours[line_id].remaining - d < 0 for line_id, d in delta.items()):
        raise ValidationFailed("Qaytarilgan mollar omborda qolmagan (sotilgan yoki boshqa mijozga berilgan), "
                               "o'chirib bo'lmaydi")
    await session.delete(move)
    await session.flush()


async def create_consignment_sale(session: AsyncSession, customer_id: int, data: ConsignmentSaleIn,
                                  user_id: int | None) -> Sale:
    """The customer sold goods we handed over: a normal sale (source='consignment') allocated FIFO from the
    customer's lines, plus one -q entry per allocation so the units leave the customer's warehouse."""
    products = await _prepare(session, customer_id, {line.product_id for line in data.lines})
    taken: dict[int, int] = {}
    planned = []
    for item in data.lines:
        candidates = await _customer_candidates(session, customer_id, item.product_id, "fifo")
        planned.append((item, _take(candidates, item.qty, taken, products[item.product_id].name, "mijozda")))

    sale = Sale(sale_date=data.sale_date, customer_id=customer_id, note=data.note, created_by=user_id,
                source="consignment")
    session.add(sale)
    await session.flush()
    for item, picks in planned:
        sale_line = SaleLine(sale_id=sale.id, product_id=item.product_id, qty=item.qty, price_usd=item.price_usd)
        session.add(sale_line)
        await session.flush()
        for line_id, q in picks:
            session.add(SaleAllocation(sale_line_id=sale_line.id, purchase_line_id=line_id, qty=q))
            session.add(ConsignmentEntry(customer_id=customer_id, purchase_line_id=line_id, qty=-q,
                                         sale_line_id=sale_line.id))
    await session.flush()
    return sale


async def _moves_out(session: AsyncSession, customer_id: int, move_id: int | None = None) -> list[MoveOut]:
    """Moves of a customer (or one move), newest first, with lines grouped by (product, price): two queries."""
    moves_stmt = (select(ConsignmentMove).where(ConsignmentMove.customer_id == customer_id)
                  .order_by(ConsignmentMove.move_date.desc(), ConsignmentMove.id.desc()))
    lines_stmt = (
        select(ConsignmentEntry.move_id, Product.id.label("product_id"), Product.name, ConsignmentEntry.price_usd,
               func.sum(func.abs(ConsignmentEntry.qty)).label("qty"))
        .join(ConsignmentMove, ConsignmentMove.id == ConsignmentEntry.move_id)
        .join(PurchaseLine, PurchaseLine.id == ConsignmentEntry.purchase_line_id)
        .join(Product, Product.id == PurchaseLine.product_id)
        .where(ConsignmentMove.customer_id == customer_id)
        .group_by(ConsignmentEntry.move_id, Product.id, Product.name, ConsignmentEntry.price_usd)
        .order_by(ConsignmentEntry.move_id, func.min(ConsignmentEntry.id))
    )
    if move_id is not None:
        moves_stmt = moves_stmt.where(ConsignmentMove.id == move_id)
        lines_stmt = lines_stmt.where(ConsignmentMove.id == move_id)
    moves = (await session.execute(moves_stmt)).scalars().all()
    lines: dict[int, list[MoveLineOut]] = defaultdict(list)
    for r in (await session.execute(lines_stmt)).all():
        lines[r.move_id].append(MoveLineOut(product=Ref(id=r.product_id, name=r.name), qty=int(r.qty),
                                            price_usd=r.price_usd))
    out = []
    for m in moves:
        move_lines = lines.get(m.id, [])
        total_value = (sum((ln.qty * (ln.price_usd or ZERO) for ln in move_lines), ZERO)
                       if m.kind == "out" else None)
        out.append(MoveOut(id=m.id, move_date=m.move_date, kind=m.kind, note=m.note,
                           total_qty=sum(ln.qty for ln in move_lines), total_value=total_value,
                           created_at=m.created_at, lines=move_lines))
    return out


async def list_moves(session: AsyncSession, customer_id: int) -> list[MoveOut]:
    await catalog.get_customer(session, customer_id)
    return await _moves_out(session, customer_id)


async def get_move(session: AsyncSession, customer_id: int, move_id: int) -> MoveOut:
    found = await _moves_out(session, customer_id, move_id)
    if not found:
        raise NotFound("Harakat topilmadi")
    return found[0]


def _line_price(row) -> Decimal:
    """Value at the agreed price of the line's latest handover; falls back to unit cost (SPEC §12.3)."""
    return row.price_usd if row.price_usd is not None else row.unit_cost


async def customer_stock_rows(session: AsyncSession, customer_id: int) -> list[CustomerStockRowOut]:
    await catalog.get_customer(session, customer_id)
    rows = (await session.execute(customer_lines_query([customer_id], "fifo"))).all()
    names = {}
    if rows:
        names = dict((await session.execute(
            select(Product.id, Product.name).where(Product.id.in_({r.product_id for r in rows})))).all())
    grouped: dict[int, list] = defaultdict(list)
    for r in rows:
        grouped[r.product_id].append(r)
    result = []
    for product_id, lines in grouped.items():
        qty = sum(int(r.qty) for r in lines)
        value_cost = sum((r.qty * r.unit_cost for r in lines), ZERO)
        newest = max((r for r in lines if r.handover_move_id is not None),
                     key=lambda r: (r.handover_date, r.handover_move_id), default=None)
        result.append(CustomerStockRowOut(
            product=Ref(id=product_id, name=names.get(product_id, "")),
            qty=qty,
            avg_unit_cost=value_cost / qty,
            value_cost=value_cost,
            price_usd=newest.price_usd if newest else None,
            value_price=sum((r.qty * _line_price(r) for r in lines), ZERO),
            lines=[CustomerStockLineOut(purchase_line_id=r.id, batch_date=r.batch_date, qty=int(r.qty),
                                        unit_cost=r.unit_cost, price_usd=r.price_usd) for r in lines],
        ))
    result.sort(key=lambda row: row.product.name)
    return result


async def stock_values(session: AsyncSession, customer_ids: list[int]) -> dict[int, StockValue]:
    """Per customer: units on hand, their value at cost and at the agreed price. One query for all customers."""
    if not customer_ids:
        return {}
    totals: dict[int, StockValue] = {}
    for r in (await session.execute(customer_lines_query(customer_ids))).all():
        prev = totals.get(r.customer_id, StockValue(0, ZERO, ZERO))
        totals[r.customer_id] = StockValue(prev.qty + int(r.qty), prev.value_cost + r.qty * r.unit_cost,
                                           prev.value_price + r.qty * _line_price(r))
    return totals
