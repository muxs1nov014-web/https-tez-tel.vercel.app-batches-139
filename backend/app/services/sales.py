from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import Conflict, NotFound
from app.models import Batch, Customer, PurchaseLine, Sale, SaleAllocation, SaleLine
from app.schemas import AllocationOut, Ref, SaleDetail, SaleIn, SaleLineOut, SaleSummary, SaleTotals
from app.services import catalog
from app.services.stock import lock_product_lines, own_stock_lines_query


async def create_sale(session: AsyncSession, data: SaleIn, user_id: int | None) -> Sale:
    if data.customer_id is not None:
        await catalog.get_customer(session, data.customer_id)
    product_ids = sorted({line.product_id for line in data.lines})
    for product_id in product_ids:
        await catalog.get_product(session, product_id)
    await lock_product_lines(session, product_ids)  # serialise concurrent sales of the same products

    sale = Sale(sale_date=data.sale_date, customer_id=data.customer_id, note=data.note, created_by=user_id)
    session.add(sale)
    await session.flush()

    taken: dict[int, int] = {}  # purchase_line_id -> qty already allocated in this sale
    for item in data.lines:
        stmt = own_stock_lines_query().where(PurchaseLine.product_id == item.product_id)
        if item.batch_id is not None:
            stmt = stmt.where(PurchaseLine.batch_id == item.batch_id)
        candidates = (await session.execute(stmt)).all()
        available = sum(int(c.remaining) - taken.get(c.id, 0) for c in candidates)
        if available < item.qty:
            product = await catalog.get_product(session, item.product_id)
            raise Conflict(f"{product.name}: omborda {available} dona bor, {item.qty} dona so'raldi")
        sale_line = SaleLine(sale_id=sale.id, product_id=item.product_id, qty=item.qty, price_usd=item.price_usd,
                             batch_id=item.batch_id)
        session.add(sale_line)
        await session.flush()
        need = item.qty
        for c in candidates:
            free = int(c.remaining) - taken.get(c.id, 0)
            if free <= 0:
                continue
            q = min(free, need)
            session.add(SaleAllocation(sale_line_id=sale_line.id, purchase_line_id=c.id, qty=q))
            taken[c.id] = taken.get(c.id, 0) + q
            need -= q
            if need == 0:
                break
    await session.flush()
    return sale


async def _load(session: AsyncSession, sale_id: int) -> Sale:
    stmt = (select(Sale).where(Sale.id == sale_id)
            .options(selectinload(Sale.lines).selectinload(SaleLine.allocations))
            .execution_options(populate_existing=True))
    sale = (await session.execute(stmt)).scalar_one_or_none()
    if sale is None:
        raise NotFound("Sotuv topilmadi")
    return sale


async def get_detail(session: AsyncSession, sale_id: int) -> SaleDetail:
    sale = await _load(session, sale_id)
    batch_ids = {a.purchase_line.batch_id for line in sale.lines for a in line.allocations}
    batch_dates = dict((await session.execute(
        select(Batch.id, Batch.batch_date).where(Batch.id.in_(batch_ids)))).all()) if batch_ids else {}
    lines_out = []
    for line in sale.lines:
        cost = sum((a.qty * a.purchase_line.unit_cost for a in line.allocations), Decimal(0))
        revenue = line.qty * line.price_usd
        lines_out.append(SaleLineOut(
            id=line.id, product=Ref(id=line.product.id, name=line.product.name), qty=line.qty,
            price_usd=line.price_usd, revenue=revenue, cost=cost, profit=revenue - cost,
            allocations=[AllocationOut(purchase_line_id=a.purchase_line_id,
                                       batch_date=batch_dates[a.purchase_line.batch_id], qty=a.qty,
                                       unit_cost=a.purchase_line.unit_cost) for a in line.allocations],
        ))
    revenue = sum((ln.revenue for ln in lines_out), Decimal(0))
    cost = sum((ln.cost for ln in lines_out), Decimal(0))
    return SaleDetail(
        id=sale.id, sale_date=sale.sale_date, source=sale.source,
        customer=Ref(id=sale.customer.id, name=sale.customer.name) if sale.customer else None,
        note=sale.note, lines=lines_out,
        totals=SaleTotals(qty=sum(ln.qty for ln in lines_out), revenue=revenue, cost=cost, profit=revenue - cost),
    )


async def list_sales(session: AsyncSession, date_from: date | None, date_to: date | None,
                     customer_id: int | None, limit: int = 500) -> list[SaleSummary]:
    alloc_cost = (
        select(SaleAllocation.sale_line_id.label("sl_id"),
               func.sum(SaleAllocation.qty * PurchaseLine.unit_cost).label("cost"))
        .join(PurchaseLine, PurchaseLine.id == SaleAllocation.purchase_line_id)
        .group_by(SaleAllocation.sale_line_id).subquery()
    )
    stmt = (
        select(Sale.id, Sale.sale_date, Sale.source, Sale.customer_id,
               func.sum(SaleLine.qty).label("qty"),
               func.sum(SaleLine.qty * SaleLine.price_usd).label("revenue"),
               func.coalesce(func.sum(alloc_cost.c.cost), 0).label("cost"))
        .join(SaleLine, SaleLine.sale_id == Sale.id)
        .outerjoin(alloc_cost, alloc_cost.c.sl_id == SaleLine.id)
        .group_by(Sale.id)
        .order_by(Sale.sale_date.desc(), Sale.id.desc())
        .limit(limit)
    )
    if date_from:
        stmt = stmt.where(Sale.sale_date >= date_from)
    if date_to:
        stmt = stmt.where(Sale.sale_date <= date_to)
    if customer_id:
        stmt = stmt.where(Sale.customer_id == customer_id)
    rows = (await session.execute(stmt)).all()
    customer_ids = {r.customer_id for r in rows if r.customer_id}
    names = {}
    if customer_ids:
        names = dict((await session.execute(
            select(Customer.id, Customer.name).where(Customer.id.in_(customer_ids)))).all())
    return [
        SaleSummary(id=r.id, sale_date=r.sale_date, source=r.source,
                    customer=Ref(id=r.customer_id, name=names[r.customer_id]) if r.customer_id else None,
                    total_qty=int(r.qty), revenue=r.revenue, cost=r.cost, profit=r.revenue - r.cost)
        for r in rows
    ]


async def delete_sale(session: AsyncSession, sale_id: int) -> None:
    sale = await _load(session, sale_id)
    await session.delete(sale)
    await session.flush()
