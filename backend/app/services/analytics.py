"""Read-only query functions used by the Telegram assistant. Results are JSON-safe dicts."""

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.costing import CATEGORY_LABELS
from app.models import Batch, Customer, Product, PurchaseLine
from app.services import batches as batches_service
from app.services import reports
from app.services.stock import stock_rows


def _money(value: Decimal | float | int) -> float:
    return round(float(value), 2)


def _date(value: str | None, default: date | None = None) -> date | None:
    if not value:
        return default
    try:
        return date.fromisoformat(value)
    except ValueError:
        return default


async def match_products(session: AsyncSession, query: str | None) -> list[Product] | None:
    """None = no filter. Every token must appear in search_text."""
    if not query or not query.strip():
        return None
    stmt = select(Product)
    for token in query.lower().replace("gb", "").split():
        stmt = stmt.where(Product.search_text.contains(token))
    return list((await session.execute(stmt.order_by(Product.name).limit(200))).scalars().all())


async def _match_customers(session: AsyncSession, query: str | None) -> list[Customer] | None:
    if not query or not query.strip():
        return None
    stmt = select(Customer).where(Customer.name.ilike(f"%{query.strip()}%"))
    return list((await session.execute(stmt)).scalars().all())


def _not_found(query: str) -> dict:
    return {"error": "product_not_found", "query": query,
            "hint": "Ask the user to clarify the model, e.g. '17 pro max 256 silver'."}


async def stock_summary(session: AsyncSession, product_query: str | None = None) -> dict:
    products = await match_products(session, product_query)
    if products == []:
        return _not_found(product_query or "")
    rows = await stock_rows(session, product_ids=[p.id for p in products] if products is not None else None)
    return {
        "items": [{"product": r.product.name, "qty": r.qty, "avg_unit_cost_usd": _money(r.avg_unit_cost),
                   "stock_value_usd": _money(r.stock_value),
                   "by_batch": [{"batch_date": ln.batch_date.isoformat(), "qty": ln.remaining_qty,
                                 "unit_cost_usd": _money(ln.unit_cost)} for ln in r.lines[:10]]}
                  for r in rows[:60]],
        "total_qty": sum(r.qty for r in rows),
        "total_value_usd": _money(sum((r.stock_value for r in rows), Decimal(0))),
    }


async def sales_summary(session: AsyncSession, date_from: str | None = None, date_to: str | None = None,
                        product_query: str | None = None, customer_query: str | None = None) -> dict:
    products = await match_products(session, product_query)
    if products == []:
        return _not_found(product_query or "")
    customers = await _match_customers(session, customer_query)
    if customers == []:
        return {"error": "customer_not_found", "query": customer_query}
    d_from, d_to = _date(date_from), _date(date_to)
    rows = await reports.profit(session, d_from, d_to, "product",
                                product_ids=[p.id for p in products] if products is not None else None,
                                customer_ids=[c.id for c in customers] if customers is not None else None)
    return {
        "period": {"from": d_from.isoformat() if d_from else None, "to": d_to.isoformat() if d_to else None},
        "items": [{"product": r.label, "qty": r.qty, "revenue_usd": _money(r.revenue), "cost_usd": _money(r.cost),
                   "profit_usd": _money(r.profit)} for r in rows[:60]],
        "total_qty": sum(r.qty for r in rows),
        "total_revenue_usd": _money(sum((r.revenue for r in rows), Decimal(0))),
        "total_profit_usd": _money(sum((r.profit for r in rows), Decimal(0))),
    }


async def purchases_summary(session: AsyncSession, date_from: str | None = None, date_to: str | None = None,
                            product_query: str | None = None) -> dict:
    products = await match_products(session, product_query)
    if products == []:
        return _not_found(product_query or "")
    rows = await reports.purchases_by_product(session, _date(date_from), _date(date_to),
                                              [p.id for p in products] if products is not None else None)
    return {
        "items": [{"product": r["product"], "qty": r["qty"], "total_aed": _money(r["aed"]),
                   "total_usd": _money(r["usd"]), "avg_unit_cost_usd": _money(r["avg_unit_cost"])}
                  for r in rows[:60]],
        "total_qty": sum(r["qty"] for r in rows),
        "total_usd": _money(sum((r["usd"] for r in rows), Decimal(0))),
    }


async def unit_cost_breakdown(session: AsyncSession, product_query: str, batch_date: str | None = None) -> dict:
    products = await match_products(session, product_query)
    if not products:
        return _not_found(product_query)
    stmt = (select(PurchaseLine.id, PurchaseLine.batch_id, Batch.batch_date)
            .join(Batch, Batch.id == PurchaseLine.batch_id)
            .where(PurchaseLine.product_id.in_([p.id for p in products]))
            .order_by(Batch.batch_date.desc(), PurchaseLine.id.desc()).limit(5))
    on = _date(batch_date)
    if on:
        stmt = stmt.where(Batch.batch_date == on)
    found = (await session.execute(stmt)).all()
    items = []
    details: dict[int, object] = {}
    for line_id, batch_id, _ in found:
        if batch_id not in details:
            details[batch_id] = await batches_service.get_detail(session, batch_id)
        detail = details[batch_id]
        line = next(ln for ln in detail.lines if ln.id == line_id)
        items.append({
            "batch_date": detail.batch_date.isoformat(), "product": line.product.name, "qty": line.qty,
            "price_aed": _money(line.price_aed), "rate": float(line.rate), "price_usd": _money(line.price_usd),
            "costs_per_unit_usd": {CATEGORY_LABELS[c]: _money(v.effective) for c, v in line.per_unit.items()
                                   if v.effective},
            "overhead_per_unit_usd": _money(line.overhead),
            "overhead_estimate_per_unit_usd": _money(line.overhead_est),
            "unit_cost_usd": _money(line.unit_cost),
            "actual_expenses_entered": any(c.actual_total is not None for c in detail.categories),
        })
    return {"items": items} if items else {"error": "no_purchases", "query": product_query}


async def batch_summary(session: AsyncSession, batch_date: str) -> dict:
    on = _date(batch_date)
    if on is None:
        return {"error": "bad_date", "value": batch_date}
    batch_id = (await session.execute(select(Batch.id).where(Batch.batch_date == on))).scalar_one_or_none()
    if batch_id is None:
        return {"error": "batch_not_found", "batch_date": batch_date}
    d = await batches_service.get_detail(session, batch_id)
    return {
        "batch_date": d.batch_date.isoformat(), "total_qty": d.total_qty,
        "lines": [{"product": ln.product.name, "qty": ln.qty, "price_usd": _money(ln.price_usd),
                   "overhead_per_unit_usd": _money(ln.overhead), "unit_cost_usd": _money(ln.unit_cost),
                   "client": ln.client.name if ln.client else None, "remaining_qty": ln.remaining_qty}
                  for ln in d.lines],
        "expenses": [{"category": c.label, "estimate_usd": _money(c.estimate_total),
                      "actual_usd": _money(c.actual_total) if c.actual_total is not None else None}
                     for c in d.categories if c.estimate_total or c.actual_total is not None],
        "total_cost_estimate_usd": _money(d.totals.cost_est), "total_cost_usd": _money(d.totals.cost),
    }


async def top_products(session: AsyncSession, date_from: str | None = None, date_to: str | None = None,
                       metric: str = "qty", limit: int = 10) -> dict:
    rows = await reports.profit(session, _date(date_from), _date(date_to), "product")
    key = (lambda r: r.profit) if metric == "profit" else (lambda r: r.qty)
    rows.sort(key=key, reverse=True)
    return {"metric": metric, "items": [{"product": r.label, "qty": r.qty, "revenue_usd": _money(r.revenue),
                                         "profit_usd": _money(r.profit)} for r in rows[:max(1, min(limit, 30))]]}


TOOLS = {
    "stock_summary": stock_summary,
    "sales_summary": sales_summary,
    "purchases_summary": purchases_summary,
    "unit_cost_breakdown": unit_cost_breakdown,
    "batch_summary": batch_summary,
    "top_products": top_products,
}
