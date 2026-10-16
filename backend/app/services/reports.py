from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import func, literal_column, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Batch, Customer, Product, PurchaseLine, Sale, SaleAllocation, SaleLine
from app.schemas import (
    ClientRow,
    DashboardOut,
    MonthlyRow,
    MonthStats,
    ProfitRow,
    Ref,
    UnitCostRow,
    VarianceRow,
)
from app.services.stock import stock_rows

ZERO = Decimal(0)


def month_key(column):
    # Literal format so SELECT and GROUP BY render the identical expression (bind params would differ).
    return func.to_char(column, literal_column("'YYYY-MM'"))


def today() -> date:
    return datetime.now(ZoneInfo(get_settings().tz_name)).date()


def _alloc_cost_subq():
    return (
        select(SaleAllocation.sale_line_id.label("sl_id"),
               func.sum(SaleAllocation.qty * PurchaseLine.unit_cost).label("cost"))
        .join(PurchaseLine, PurchaseLine.id == SaleAllocation.purchase_line_id)
        .group_by(SaleAllocation.sale_line_id).subquery()
    )


def _sales_base(date_from: date | None, date_to: date | None):
    cost = _alloc_cost_subq()
    stmt = (select().select_from(SaleLine).join(Sale, Sale.id == SaleLine.sale_id)
            .outerjoin(cost, cost.c.sl_id == SaleLine.id))
    if date_from:
        stmt = stmt.where(Sale.sale_date >= date_from)
    if date_to:
        stmt = stmt.where(Sale.sale_date <= date_to)
    qty = func.coalesce(func.sum(SaleLine.qty), 0)
    revenue = func.coalesce(func.sum(SaleLine.qty * SaleLine.price_usd), 0)
    cost_sum = func.coalesce(func.sum(cost.c.cost), 0)
    return stmt, qty, revenue, cost_sum


async def profit(session: AsyncSession, date_from: date | None, date_to: date | None,
                 group_by: str = "product", product_ids: list[int] | None = None,
                 customer_ids: list[int] | None = None) -> list[ProfitRow]:
    stmt, qty, revenue, cost = _sales_base(date_from, date_to)
    if product_ids is not None:
        stmt = stmt.where(SaleLine.product_id.in_(product_ids))
    if customer_ids is not None:
        stmt = stmt.where(Sale.customer_id.in_(customer_ids))
    if group_by == "product":
        key_cols = (SaleLine.product_id.label("k"), Product.name.label("label"))
        stmt = stmt.join(Product, Product.id == SaleLine.product_id)
    elif group_by == "customer":
        key_cols = (Sale.customer_id.label("k"), func.coalesce(Customer.name, "—").label("label"))
        stmt = stmt.outerjoin(Customer, Customer.id == Sale.customer_id)
    elif group_by == "day":
        key_cols = (Sale.sale_date.label("k"), Sale.sale_date.label("label"))
    else:
        month = month_key(Sale.sale_date)
        key_cols = (month.label("k"), month.label("label"))
    stmt = stmt.add_columns(*key_cols, qty.label("qty"), revenue.label("revenue"), cost.label("cost"))
    stmt = stmt.group_by(*[c.element if hasattr(c, "element") else c for c in key_cols])
    rows = (await session.execute(stmt)).all()
    out = [ProfitRow(key=str(r.k), label=str(r.label), qty=int(r.qty), revenue=r.revenue, cost=r.cost,
                     profit=r.revenue - r.cost) for r in rows]
    if group_by in ("day", "month"):
        out.sort(key=lambda row: row.key)
    else:
        out.sort(key=lambda row: row.profit, reverse=True)
    return out


async def sales_totals(session: AsyncSession, date_from: date | None, date_to: date | None) -> tuple[int, Decimal, Decimal]:
    stmt, qty, revenue, cost = _sales_base(date_from, date_to)
    row = (await session.execute(stmt.add_columns(qty.label("qty"), revenue.label("revenue"),
                                                  cost.label("cost")))).one()
    return int(row.qty), row.revenue, row.cost


async def purchases_by_product(session: AsyncSession, date_from: date | None, date_to: date | None,
                               product_ids: list[int] | None = None) -> list[dict]:
    pl = PurchaseLine
    stmt = (
        select(Product.id, Product.name, func.sum(pl.qty).label("qty"),
               func.sum(pl.qty * pl.price_aed).label("aed"),
               func.sum(pl.qty * pl.price_aed / pl.rate).label("usd"),
               func.sum(pl.qty * pl.unit_cost).label("cost"))
        .join(Product, Product.id == pl.product_id)
        .join(Batch, Batch.id == pl.batch_id)
        .where(pl.client_id.is_(None))
        .group_by(Product.id, Product.name)
        .order_by(func.sum(pl.qty).desc())
    )
    if date_from:
        stmt = stmt.where(Batch.batch_date >= date_from)
    if date_to:
        stmt = stmt.where(Batch.batch_date <= date_to)
    if product_ids is not None:
        stmt = stmt.where(pl.product_id.in_(product_ids))
    return [{"product_id": r.id, "product": r.name, "qty": int(r.qty), "aed": r.aed, "usd": r.usd,
             "avg_unit_cost": r.cost / r.qty} for r in (await session.execute(stmt)).all()]


async def dashboard(session: AsyncSession) -> DashboardOut:
    stock = await stock_rows(session)
    now = today()
    month_start = now.replace(day=1)
    sales_qty, revenue, cost = await sales_totals(session, month_start, now)
    pl = PurchaseLine
    month_purchases = (await session.execute(
        select(func.coalesce(func.sum(pl.qty), 0), func.coalesce(func.sum(pl.qty * pl.price_aed / pl.rate), 0))
        .join(Batch, Batch.id == pl.batch_id)
        .where(Batch.batch_date >= month_start, Batch.batch_date <= now, pl.client_id.is_(None))
    )).one()

    start = date(now.year - 1, now.month, 1) if now.month == 12 else date(now.year - 1, now.month + 1, 1)
    purchases = dict(((m, (int(q), u)) for m, q, u in (await session.execute(
        select(month_key(Batch.batch_date), func.sum(pl.qty), func.sum(pl.qty * pl.price_aed / pl.rate))
        .join(Batch, Batch.id == pl.batch_id)
        .where(Batch.batch_date >= start, pl.client_id.is_(None))
        .group_by(month_key(Batch.batch_date))
    )).all()))
    sales = {r.key: r for r in await profit(session, start, None, group_by="month")}
    months, y, m = [], start.year, start.month
    for _ in range(12):
        key = f"{y:04d}-{m:02d}"
        p_qty, p_usd = purchases.get(key, (0, ZERO))
        s = sales.get(key)
        months.append(MonthlyRow(month=key, purchases_qty=p_qty, purchases_usd=p_usd,
                                 sales_qty=s.qty if s else 0, revenue=s.revenue if s else ZERO,
                                 profit=s.profit if s else ZERO))
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return DashboardOut(
        stock_qty=sum(r.qty for r in stock),
        stock_value=sum((r.stock_value for r in stock), ZERO),
        month=MonthStats(sales_qty=sales_qty, revenue=revenue, profit=revenue - cost,
                         purchases_qty=int(month_purchases[0]), purchases_usd=month_purchases[1]),
        monthly=months,
    )


async def batch_variance(session: AsyncSession, date_from: date | None, date_to: date | None) -> list[VarianceRow]:
    pl = PurchaseLine
    stmt = (
        select(Batch.id, Batch.batch_date, func.sum(pl.qty).label("qty"),
               func.sum(pl.qty * pl.unit_cost_est).label("cost_est"), func.sum(pl.qty * pl.unit_cost).label("cost"))
        .join(pl, pl.batch_id == Batch.id)
        .group_by(Batch.id)
        .order_by(Batch.batch_date.desc())
    )
    if date_from:
        stmt = stmt.where(Batch.batch_date >= date_from)
    if date_to:
        stmt = stmt.where(Batch.batch_date <= date_to)
    return [VarianceRow(batch_id=r.id, batch_date=r.batch_date, qty=int(r.qty), cost_est=r.cost_est, cost=r.cost,
                        diff=r.cost_est - r.cost, diff_per_unit=(r.cost_est - r.cost) / r.qty)
            for r in (await session.execute(stmt)).all()]


async def unit_cost_history(session: AsyncSession, product_id: int) -> list[UnitCostRow]:
    pl = PurchaseLine
    stmt = (
        select(Batch.batch_date, pl.qty, (pl.price_aed / pl.rate).label("price_usd"), pl.unit_cost)
        .join(Batch, Batch.id == pl.batch_id)
        .where(pl.product_id == product_id)
        .order_by(Batch.batch_date.desc(), pl.id.desc())
    )
    return [UnitCostRow(batch_date=r.batch_date, qty=r.qty, price_usd=r.price_usd,
                        overhead=r.unit_cost - r.price_usd, unit_cost=r.unit_cost)
            for r in (await session.execute(stmt)).all()]


async def clients(session: AsyncSession, date_from: date | None, date_to: date | None,
                  customer_id: int | None) -> list[ClientRow]:
    pl = PurchaseLine
    stmt = (
        select(pl, Batch.batch_date)
        .join(Batch, Batch.id == pl.batch_id)
        .where(pl.client_id.is_not(None))
        .order_by(Batch.batch_date.desc(), pl.id)
    )
    if date_from:
        stmt = stmt.where(Batch.batch_date >= date_from)
    if date_to:
        stmt = stmt.where(Batch.batch_date <= date_to)
    if customer_id:
        stmt = stmt.where(pl.client_id == customer_id)
    out = []
    for line, batch_date in (await session.execute(stmt)).all():
        price_usd = line.price_aed / line.rate
        fee = price_usd * (line.service_pct or ZERO)
        charge = line.unit_cost_est + fee
        out.append(ClientRow(
            customer=Ref(id=line.client.id, name=line.client.name), batch_date=batch_date,
            product=Ref(id=line.product.id, name=line.product.name), qty=line.qty, price_usd=price_usd,
            unit_cost_est=line.unit_cost_est, service_fee_per_unit=fee, charge_per_unit=charge,
            charge_total=charge * line.qty, cost_total=line.unit_cost * line.qty,
            margin=(charge - line.unit_cost) * line.qty,
        ))
    return out
