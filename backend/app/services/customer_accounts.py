"""Customer debts (SPEC §12.3–12.4): payments, balances, overview, ledger.

debt(c) = Σ opening_debt + Σ sales revenue (all sales to c, both sources)
        + Σ client-service charges (purchase lines with client_id = c) − Σ payments

Balances are computed set-based (a fixed number of aggregate queries, whatever the number of customers).
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import NamedTuple

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound
from app.models import (
    Batch,
    ConsignmentEntry,
    ConsignmentMove,
    Customer,
    CustomerPayment,
    Product,
    PurchaseLine,
    Sale,
    SaleLine,
)
from app.schemas import (
    CustomerBalance,
    CustomerOverview,
    CustomerRef,
    CustomerTotals,
    LedgerRow,
    PaymentIn,
    SaleSummary,
)
from app.services import catalog
from app.services import sales as sales_service
from app.services.consignment import StockValue, stock_values
from app.services.reports import today

ZERO = Decimal(0)
HALF_CENT = Decimal("0.005")  # a debt below half a cent is settled (service charges carry more decimals)
LEDGER_ORDER = {"opening_debt": 0, "service": 1, "sale": 2, "payment": 3}  # tie-break within one day


def service_charge_total():
    """Client-service charge of a purchase line, as a SQL expression (SPEC §4, same formula as reports.clients):
    (unit_cost_est + price_usd × service_pct) × qty, where price_usd = price_aed / rate."""
    pl = PurchaseLine
    return pl.qty * (pl.unit_cost_est + pl.price_aed / pl.rate * func.coalesce(pl.service_pct, 0))


class SalesStats(NamedTuple):
    month_qty: int
    month_revenue: Decimal
    total_qty: int
    total_revenue: Decimal


@dataclass
class _DebtParts:
    opening_debt: Decimal = ZERO
    charged_sales: Decimal = ZERO
    charged_service: Decimal = ZERO
    paid: Decimal = ZERO
    last_payment_date: date | None = None
    sales: SalesStats = SalesStats(0, ZERO, 0, ZERO)

    @property
    def debt(self) -> Decimal:
        return self.opening_debt + self.charged_sales + self.charged_service - self.paid


# ---- payments ----
async def list_payments(session: AsyncSession, customer_id: int) -> list[CustomerPayment]:
    await catalog.get_customer(session, customer_id)
    stmt = (select(CustomerPayment).where(CustomerPayment.customer_id == customer_id)
            .order_by(CustomerPayment.payment_date.desc(), CustomerPayment.id.desc()))
    return list((await session.execute(stmt)).scalars().all())


async def create_payment(session: AsyncSession, customer_id: int, data: PaymentIn,
                         user_id: int | None) -> CustomerPayment:
    await catalog.get_customer(session, customer_id)
    payment = CustomerPayment(customer_id=customer_id, payment_date=data.payment_date, amount_usd=data.amount_usd,
                              kind=data.kind, note=data.note, created_by=user_id)
    session.add(payment)
    await session.flush()
    await session.refresh(payment)  # created_at is set by the database
    return payment


async def delete_payment(session: AsyncSession, customer_id: int, payment_id: int) -> None:
    payment = await session.get(CustomerPayment, payment_id)
    if payment is None or payment.customer_id != customer_id:
        raise NotFound("To'lov topilmadi")
    await session.delete(payment)
    await session.flush()


# ---- balances ----
async def active_customers(session: AsyncSession) -> list[Customer]:
    stmt = select(Customer).where(Customer.is_active.is_(True)).order_by(Customer.name, Customer.id)
    return list((await session.execute(stmt)).scalars().all())


async def _sales_stats(session: AsyncSession, customer_ids: list[int]) -> dict[int, SalesStats]:
    now = today()
    in_month = (Sale.sale_date >= now.replace(day=1)) & (Sale.sale_date <= now)
    revenue = SaleLine.qty * SaleLine.price_usd
    rows = (await session.execute(
        select(Sale.customer_id,
               func.coalesce(func.sum(SaleLine.qty).filter(in_month), 0).label("month_qty"),
               func.coalesce(func.sum(revenue).filter(in_month), 0).label("month_revenue"),
               func.sum(SaleLine.qty).label("qty"), func.sum(revenue).label("revenue"))
        .join(SaleLine, SaleLine.sale_id == Sale.id)
        .where(Sale.customer_id.in_(customer_ids))
        .group_by(Sale.customer_id)
    )).all()
    return {r.customer_id: SalesStats(int(r.month_qty), r.month_revenue, int(r.qty), r.revenue) for r in rows}


async def _debt_parts(session: AsyncSession, customer_ids: list[int]) -> dict[int, _DebtParts]:
    parts = {cid: _DebtParts() for cid in customer_ids}
    if not customer_ids:
        return parts
    is_opening = CustomerPayment.kind == "opening_debt"
    is_payment = CustomerPayment.kind == "payment"
    for r in (await session.execute(
        select(CustomerPayment.customer_id,
               func.coalesce(func.sum(CustomerPayment.amount_usd).filter(is_opening), 0).label("opening"),
               func.coalesce(func.sum(CustomerPayment.amount_usd).filter(is_payment), 0).label("paid"),
               func.max(CustomerPayment.payment_date).filter(is_payment).label("last_payment"))
        .where(CustomerPayment.customer_id.in_(customer_ids))
        .group_by(CustomerPayment.customer_id)
    )).all():
        p = parts[r.customer_id]
        p.opening_debt, p.paid, p.last_payment_date = r.opening, r.paid, r.last_payment
    for customer_id, stats in (await _sales_stats(session, customer_ids)).items():
        parts[customer_id].sales = stats
        parts[customer_id].charged_sales = stats.total_revenue
    for client_id, charged in (await session.execute(
        select(PurchaseLine.client_id, func.sum(service_charge_total()))
        .where(PurchaseLine.client_id.in_(customer_ids))
        .group_by(PurchaseLine.client_id)
    )).all():
        parts[client_id].charged_service = charged
    return parts


def _balance(customer: Customer, parts: _DebtParts, stock: StockValue) -> CustomerBalance:
    return CustomerBalance(
        customer=CustomerRef(id=customer.id, name=customer.name, kind=customer.kind),
        debt=parts.debt,
        stock_qty=stock.qty,
        stock_value_cost=stock.value_cost,
        stock_value_price=stock.value_price,
        exposure=parts.debt + stock.value_price,
        sales_month_qty=parts.sales.month_qty,
        sales_month_revenue=parts.sales.month_revenue,
        last_payment_date=parts.last_payment_date,
    )


async def _balances(session: AsyncSession, customers: list[Customer]) -> list[CustomerBalance]:
    ids = [c.id for c in customers]
    parts = await _debt_parts(session, ids)
    stock = await stock_values(session, ids)
    empty = StockValue(0, ZERO, ZERO)
    return [_balance(c, parts[c.id], stock.get(c.id, empty)) for c in customers]


def _is_open(balance: CustomerBalance) -> bool:
    return balance.stock_qty > 0 or abs(balance.debt) >= HALF_CENT


async def summary(session: AsyncSession) -> list[CustomerBalance]:
    """Active customers plus inactive ones that still owe (or are owed) money or hold our goods, sorted by name."""
    customers = list((await session.execute(select(Customer).order_by(Customer.name, Customer.id))).scalars())
    balances = await _balances(session, customers)
    return [b for c, b in zip(customers, balances, strict=True) if c.is_active or _is_open(b)]


async def overview(session: AsyncSession, customer_id: int) -> CustomerOverview:
    customer = await catalog.get_customer(session, customer_id)
    parts = (await _debt_parts(session, [customer_id]))[customer_id]
    stock = (await stock_values(session, [customer_id])).get(customer_id, StockValue(0, ZERO, ZERO))
    is_out = ConsignmentMove.kind == "out"
    is_return = ConsignmentMove.kind == "return"
    is_sold = ConsignmentEntry.sale_line_id.is_not(None)
    moved = (await session.execute(
        select(func.coalesce(func.sum(ConsignmentEntry.qty).filter(is_out), 0).label("given"),
               func.coalesce(-func.sum(ConsignmentEntry.qty).filter(is_return), 0).label("returned"),
               func.coalesce(-func.sum(ConsignmentEntry.qty).filter(is_sold), 0).label("sold"))
        .select_from(ConsignmentEntry)
        .outerjoin(ConsignmentMove, ConsignmentMove.id == ConsignmentEntry.move_id)
        .where(ConsignmentEntry.customer_id == customer_id)
    )).one()
    return CustomerOverview(
        balance=_balance(customer, parts, stock),
        totals=CustomerTotals(opening_debt=parts.opening_debt, charged_sales=parts.charged_sales,
                              charged_service=parts.charged_service, paid=parts.paid,
                              given_qty=int(moved.given), returned_qty=int(moved.returned), sold_qty=int(moved.sold)),
    )


async def sales_stats(session: AsyncSession, customer_id: int) -> SalesStats:
    """This month and all-time sales to the customer (both sources)."""
    return (await _sales_stats(session, [customer_id])).get(customer_id, SalesStats(0, ZERO, 0, ZERO))


async def list_customer_sales(session: AsyncSession, customer_id: int, limit: int = 500) -> list[SaleSummary]:
    await catalog.get_customer(session, customer_id)
    return await sales_service.list_sales(session, None, None, customer_id, limit)


# ---- ledger ----
async def ledger(session: AsyncSession, customer_id: int) -> list[LedgerRow]:
    """Chronological debit/credit rows with the running debt; the last balance equals `debt`."""
    await catalog.get_customer(session, customer_id)
    items: list[tuple[date, str, int, str, Decimal, Decimal]] = []  # (date, type, ref_id, text, debit, credit)

    payments = (await session.execute(
        select(CustomerPayment).where(CustomerPayment.customer_id == customer_id))).scalars().all()
    for p in payments:
        suffix = f" — {p.note}" if p.note else ""
        if p.kind == "opening_debt":
            items.append((p.payment_date, "opening_debt", p.id, f"Boshlang'ich qarz{suffix}", p.amount_usd, ZERO))
        else:
            items.append((p.payment_date, "payment", p.id, f"To'lov{suffix}", ZERO, p.amount_usd))

    for s in (await session.execute(
        select(Sale.id, Sale.sale_date, Sale.source, func.sum(SaleLine.qty).label("qty"),
               func.sum(SaleLine.qty * SaleLine.price_usd).label("revenue"))
        .join(SaleLine, SaleLine.sale_id == Sale.id)
        .where(Sale.customer_id == customer_id)
        .group_by(Sale.id)
    )).all():
        origin = " (qo'lidagi moldan)" if s.source == "consignment" else ""
        items.append((s.sale_date, "sale", s.id, f"Sotuv #{s.id}: {int(s.qty)} dona{origin}", s.revenue, ZERO))

    for ln in (await session.execute(
        select(PurchaseLine.id, PurchaseLine.qty, Batch.batch_date, Product.name,
               service_charge_total().label("charge"))
        .join(Batch, Batch.id == PurchaseLine.batch_id)
        .join(Product, Product.id == PurchaseLine.product_id)
        .where(PurchaseLine.client_id == customer_id)
    )).all():
        items.append((ln.batch_date, "service", ln.id,
                      f"Xizmat: {ln.name} × {ln.qty} (partiya {ln.batch_date:%d.%m.%Y})", ln.charge, ZERO))

    items.sort(key=lambda i: (i[0], LEDGER_ORDER[i[1]], i[2]))
    balance = ZERO
    rows = []
    for day, kind, ref_id, text, debit, credit in items:
        balance += debit - credit
        rows.append(LedgerRow(date=day, type=kind, ref_id=ref_id, description=text, debit=debit, credit=credit,
                              balance=balance))
    return rows
