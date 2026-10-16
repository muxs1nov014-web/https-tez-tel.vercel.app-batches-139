"""Plain-text renderers for the customer buttons (SPEC §12.6). Pure functions: no DB, no Telegram.

Amounts: `$` with 2 decimals and thousands separated by spaces ("12 345.60 $"). Dates: dd.mm.yyyy.
"""

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from app.schemas import CustomerOverview, CustomerStockRowOut, PaymentOut, SaleSummary
from app.services.customer_accounts import SalesStats

TG_LIMIT = 4000  # Telegram allows 4096 characters per message; keep a margin
RECENT = 10
CUT_NOTE = "\n… (to'liq ro'yxat admin panelda)"


def money(value: Decimal | int | float) -> str:
    amount = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return f"{amount:,.2f}".replace(",", " ") + " $"


def units(qty: int) -> str:
    return f"{qty:,}".replace(",", " ") + " dona"


def day(value: date | None) -> str:
    return value.strftime("%d.%m.%Y") if value else "yo'q"


def fit(text: str, limit: int = TG_LIMIT) -> str:
    """Cut a long text at a line break so it fits one Telegram message (messages are edited in place)."""
    if len(text) <= limit:
        return text
    cut = text.rfind("\n", 0, limit - len(CUT_NOTE))
    return text[:cut if cut > 0 else limit - len(CUT_NOTE)] + CUT_NOTE


def _header(name: str, section: str) -> str:
    return f"👤 {name} — {section}"


def menu_text(overview: CustomerOverview) -> str:
    b = overview.balance
    return (f"👤 {b.customer.name}\n"
            f"Nasiya: {money(b.debt)} · Qo'lidagi mol: {units(b.stock_qty)}\n"
            "Bo'limni tanlang:")


def debt_text(overview: CustomerOverview) -> str:
    b, t = overview.balance, overview.totals
    lines = [_header(b.customer.name, "💰 Nasiya"), f"Qarz: {money(b.debt)}"]
    if t.opening_debt:
        lines.append(f"• Boshlang'ich qarz: {money(t.opening_debt)}")
    lines.append(f"• Sotuvlar: {money(t.charged_sales)}")
    if t.charged_service:
        lines.append(f"• Xizmat haqi: {money(t.charged_service)}")
    lines += [
        f"• To'langan: {money(t.paid)}",
        f"Qo'lidagi mol: {units(b.stock_qty)} · {money(b.stock_value_price)}",
        f"Jami majburiyat: {money(b.exposure)}",
        f"Oxirgi to'lov: {day(b.last_payment_date)}",
    ]
    return "\n".join(lines)


def stock_text(name: str, rows: list[CustomerStockRowOut]) -> str:
    lines = [_header(name, "📦 Qoldiq")]
    if not rows:
        lines.append("Mijozda mol yo'q.")
        return "\n".join(lines)
    for row in rows:
        lines.append(f"• {row.product.name}: {units(row.qty)} · {money(row.value_price)}")
    qty = sum(row.qty for row in rows)
    value_price = sum((row.value_price for row in rows), Decimal(0))
    value_cost = sum((row.value_cost for row in rows), Decimal(0))
    lines.append(f"Jami: {units(qty)} · {money(value_price)} (tannarxda {money(value_cost)})")
    return fit("\n".join(lines))


def sales_text(name: str, stats: SalesStats, recent: list[SaleSummary]) -> str:
    lines = [
        _header(name, "🧾 Savdolar"),
        f"Shu oy: {units(stats.month_qty)} · {money(stats.month_revenue)}",
        f"Jami: {units(stats.total_qty)} · {money(stats.total_revenue)}",
    ]
    if not recent:
        lines.append("Savdolar yo'q.")
        return "\n".join(lines)
    lines.append(f"Oxirgi {min(len(recent), RECENT)} ta savdo:")
    for sale in recent[:RECENT]:
        origin = " (qo'lidagi moldan)" if sale.source == "consignment" else ""
        lines.append(f"• {day(sale.sale_date)} — {units(sale.total_qty)} · {money(sale.revenue)}{origin}")
    return fit("\n".join(lines))


def payments_text(overview: CustomerOverview, payments: list[PaymentOut]) -> str:
    t = overview.totals
    lines = [_header(overview.balance.customer.name, "💵 To'lovlar"), f"Jami to'langan: {money(t.paid)}"]
    if t.opening_debt:
        lines.append(f"Boshlang'ich qarz: {money(t.opening_debt)}")
    lines.append(f"Qolgan qarz: {money(overview.balance.debt)}")
    paid = [p for p in payments if p.kind == "payment"]
    if not paid:
        lines.append("To'lovlar yo'q.")
        return "\n".join(lines)
    lines.append(f"Oxirgi {min(len(paid), RECENT)} ta to'lov:")
    for p in paid[:RECENT]:
        note = f" · {p.note}" if p.note else ""
        lines.append(f"• {day(p.payment_date)} — {money(p.amount_usd)}{note}")
    return fit("\n".join(lines))


def summary_text(overview: CustomerOverview, stats: SalesStats) -> str:
    b, t = overview.balance, overview.totals
    return "\n".join([
        _header(b.customer.name, "📋 Umumiy"),
        f"Nasiya: {money(b.debt)}",
        f"Qo'lidagi mol: {units(b.stock_qty)} · {money(b.stock_value_price)}",
        f"Jami majburiyat: {money(b.exposure)}",
        f"Shu oy sotuv: {units(stats.month_qty)} · {money(stats.month_revenue)}",
        f"Jami sotuv: {units(stats.total_qty)} · {money(stats.total_revenue)}",
        f"To'langan: {money(t.paid)} · oxirgi: {day(b.last_payment_date)}",
        f"Berilgan / qaytarilgan / sotilgan: {t.given_qty} / {t.returned_qty} / {t.sold_qty} dona",
    ])


def customer_list_text(count: int) -> str:
    return "👥 Mijozlar — birini tanlang:" if count else "Faol mijozlar yo'q."
