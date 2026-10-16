"""Telegram customer buttons (SPEC §12.6): pure text renderers, callback parsing, rendering and routing."""

from contextlib import asynccontextmanager
from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace

from aiogram import Bot
from aiogram.types import Chat, Message, User

from app.bot import customer_texts as texts
from app.bot import customers_menu
from app.bot import main as bot_main
from app.schemas import (
    ConsignmentSaleIn,
    CustomerBalance,
    CustomerOverview,
    CustomerRef,
    CustomerStockLineOut,
    CustomerStockRowOut,
    CustomerTotals,
    LineIn,
    MoveIn,
    PaymentIn,
    PaymentOut,
    Ref,
    SaleSummary,
)
from app.services import batches, catalog, consignment, users
from app.services import customer_accounts as accounts
from app.services.customer_accounts import SalesStats
from app.services.reports import today

D = Decimal


def _overview(**totals) -> CustomerOverview:
    return CustomerOverview(
        balance=CustomerBalance(
            customer=CustomerRef(id=7, name="Ali aka", kind="dealer"), debt=D("12345.5"), stock_qty=5,
            stock_value_cost=D("9500"), stock_value_price=D("10000"), exposure=D("22345.5"), sales_month_qty=3,
            sales_month_revenue=D("3900"), last_payment_date=date(2026, 9, 30)),
        totals=CustomerTotals(**{"opening_debt": D("1000"), "charged_sales": D("15000"), "charged_service": D("0"),
                                 "paid": D("3654.5"), "given_qty": 20, "returned_qty": 5, "sold_qty": 10, **totals}),
    )


def test_money_and_units_formatting():
    assert texts.money(D("1234567.891")) == "1 234 567.89 $"
    assert texts.money(D("0")) == "0.00 $"
    assert texts.money(D("-1500.005")) == "-1 500.01 $"
    assert texts.money(999.995) == "1 000.00 $"
    assert texts.units(12345) == "12 345 dona"
    assert texts.day(date(2026, 9, 3)) == "03.09.2026" and texts.day(None) == "yo'q"


def test_debt_text_layout():
    assert texts.debt_text(_overview()) == "\n".join([
        "👤 Ali aka — 💰 Nasiya",
        "Qarz: 12 345.50 $",
        "• Boshlang'ich qarz: 1 000.00 $",
        "• Sotuvlar: 15 000.00 $",
        "• To'langan: 3 654.50 $",
        "Qo'lidagi mol: 5 dona · 10 000.00 $",
        "Jami majburiyat: 22 345.50 $",
        "Oxirgi to'lov: 30.09.2026",
    ])
    with_service = texts.debt_text(_overview(charged_service=D("82834.008"), opening_debt=D("0")))
    assert "• Xizmat haqi: 82 834.01 $" in with_service and "Boshlang'ich" not in with_service


def test_section_texts_render_expected_numbers():
    rows = [CustomerStockRowOut(
        product=Ref(id=1, name="iPhone 17 Pro Max 256GB Silver"), qty=3, avg_unit_cost=D("1500"),
        value_cost=D("4500"), price_usd=D("1650"), value_price=D("4950"),
        lines=[CustomerStockLineOut(purchase_line_id=1, batch_date=date(2026, 8, 1), qty=3, unit_cost=D("1500"),
                                    price_usd=D("1650"))])]
    stock = texts.stock_text("Ali aka", rows)
    assert "• iPhone 17 Pro Max 256GB Silver: 3 dona · 4 950.00 $" in stock
    assert stock.endswith("Jami: 3 dona · 4 950.00 $ (tannarxda 4 500.00 $)")
    assert texts.stock_text("Ali aka", []).endswith("Mijozda mol yo'q.")

    sales = [SaleSummary(id=i, sale_date=date(2026, 9, 30 - i), source="consignment" if i % 2 else "stock",
                         customer=Ref(id=7, name="Ali aka"), total_qty=2, revenue=D("2600"), cost=D("2000"),
                         profit=D("600")) for i in range(12)]
    text = texts.sales_text("Ali aka", SalesStats(3, D("3900"), 10, D("13000")), sales)
    assert "Shu oy: 3 dona · 3 900.00 $" in text and "Jami: 10 dona · 13 000.00 $" in text
    assert "Oxirgi 10 ta savdo:" in text and text.count("\n• ") == 10
    assert "• 29.09.2026 — 2 dona · 2 600.00 $ (qo'lidagi moldan)" in text
    assert "• 30.09.2026 — 2 dona · 2 600.00 $\n" in text

    payments = [PaymentOut(id=1, payment_date=date(2026, 9, 30), amount_usd=D("1000"), kind="payment", note="naqd",
                           created_at=datetime(2026, 9, 30)),
                PaymentOut(id=2, payment_date=date(2026, 1, 1), amount_usd=D("1000"), kind="opening_debt", note=None,
                           created_at=datetime(2026, 9, 30))]
    paid = texts.payments_text(_overview(), payments)
    assert "Jami to'langan: 3 654.50 $" in paid and "Boshlang'ich qarz: 1 000.00 $" in paid
    assert "Qolgan qarz: 12 345.50 $" in paid
    assert paid.endswith("Oxirgi 1 ta to'lov:\n• 30.09.2026 — 1 000.00 $ · naqd")

    summary = texts.summary_text(_overview(), SalesStats(3, D("3900"), 10, D("13000")))
    assert "Nasiya: 12 345.50 $" in summary and "Jami majburiyat: 22 345.50 $" in summary
    assert summary.endswith("Berilgan / qaytarilgan / sotilgan: 20 / 5 / 10 dona")


def test_fit_cuts_long_text_at_a_line_break():
    long = "\n".join(f"• Mahsulot {i}: 1 dona · 1 000.00 $" for i in range(400))
    cut = texts.fit(long)
    assert len(cut) <= texts.TG_LIMIT and cut.endswith(texts.CUT_NOTE)
    assert cut[: -len(texts.CUT_NOTE)].split("\n")[-1].endswith("$")  # no half lines
    assert texts.fit("qisqa") == "qisqa"


def test_callback_parsing_and_keyboards():
    parse = customers_menu.parse_callback
    assert parse("c:list") == (None, None)
    assert parse("c:12") == (12, None)
    assert parse("c:12:debt") == (12, "debt")
    assert parse("c:12:hack") is None and parse("c:x") is None and parse("other") is None and parse(None) is None

    kb = customers_menu.customers_keyboard([(1, "A"), (2, "B"), (3, "C")])
    assert [[b.callback_data for b in row] for row in kb.inline_keyboard] == [["c:1", "c:2"], ["c:3"]]
    assert customers_menu.customers_keyboard([]) is None
    sections = customers_menu.sections_keyboard(5)
    assert [b.callback_data for row in sections.inline_keyboard for b in row] == [
        "c:5:debt", "c:5:stock", "c:5:sales", "c:5:payments", "c:5:summary", "c:list"]
    assert all(len(row) <= 2 for row in sections.inline_keyboard)
    assert customers_menu.MAIN_KEYBOARD.keyboard[0][0].text == "👥 Mijozlar"


async def _seed(session):
    """Customer with 4 units handed over at 2300, 1 sold by them at 2500 today, and a 1000 payment."""
    product = await catalog.create_product(session, "Apple", "iPhone 18 Pro Max", "256GB", "Black", None)
    await batches.create_batch(session, date(2026, 8, 1), None, None,
                               [LineIn(product_id=product.id, qty=10, price_aed=D("6350"))], [], None)
    customer = await catalog.create_customer(session, {"name": "Ali aka"})
    now = today()
    await consignment.create_move(session, customer.id, MoveIn(move_date=now, kind="out", lines=[
        {"product_id": product.id, "qty": 4, "price_usd": D("2300")}]), None)
    await consignment.create_consignment_sale(session, customer.id, ConsignmentSaleIn(sale_date=now, lines=[
        {"product_id": product.id, "qty": 1, "price_usd": D("2500")}]), None)
    await accounts.create_payment(session, customer.id, PaymentIn(payment_date=now, amount_usd=D("1000"),
                                                                   kind="payment", note="naqd"), None)
    return customer


async def test_render_sections_from_services(session):
    customer = await _seed(session)
    render = customers_menu.render_section
    assert "Nasiya: 1 500.00 $ · Qo'lidagi mol: 3 dona" in await render(session, customer.id, None)
    debt = await render(session, customer.id, "debt")
    assert "Qarz: 1 500.00 $" in debt and "• Sotuvlar: 2 500.00 $" in debt
    assert "Jami majburiyat: 8 400.00 $" in debt  # 1500 + 3 × 2300
    stock = await render(session, customer.id, "stock")
    assert "• iPhone 18 Pro Max 256GB Black: 3 dona · 6 900.00 $" in stock
    sales = await render(session, customer.id, "sales")
    assert "Shu oy: 1 dona · 2 500.00 $" in sales and "Jami: 1 dona · 2 500.00 $" in sales
    assert "(qo'lidagi moldan)" in sales
    paid = await render(session, customer.id, "payments")
    assert f"• {today():%d.%m.%Y} — 1 000.00 $ · naqd" in paid
    summary = await render(session, customer.id, "summary")
    assert "Berilgan / qaytarilgan / sotilgan: 4 / 0 / 1 dona" in summary

    text, keyboard = await customers_menu.render(session, customers_menu.CallbackTarget(None, None))
    assert text == "👥 Mijozlar — birini tanlang:"
    assert [b.callback_data for row in keyboard.inline_keyboard for b in row] == [f"c:{customer.id}"]
    text, _ = await customers_menu.render(session, customers_menu.CallbackTarget(999999, "debt"))
    assert text.startswith("Mijoz topilmadi.")


class FakeCallback:
    def __init__(self, data: str, user_id: int):
        self.data, self.from_user, self.message = data, SimpleNamespace(id=user_id), None
        self.answers: list[tuple] = []
        self.sent: list[str] = []

        async def send_message(chat_id, text, reply_markup=None):
            self.sent.append(text)

        self.bot = SimpleNamespace(send_message=send_message)

    async def answer(self, text=None, show_alert=False):
        self.answers.append((text, show_alert))


async def test_callback_rechecks_whitelist(session, monkeypatch):
    customer = await _seed(session)
    await users.create_bot_user(session, 555, "Sotuvchi")

    @asynccontextmanager
    async def test_session():
        yield session

    monkeypatch.setattr(customers_menu, "_read_only_session", test_session)
    stranger = FakeCallback(f"c:{customer.id}:debt", 556)
    await customers_menu.on_customer_callback(stranger)
    assert stranger.answers == [("Sizga ruxsat yo'q", True)] and stranger.sent == []

    staff = FakeCallback(f"c:{customer.id}:debt", 555)
    await customers_menu.on_customer_callback(staff)
    assert staff.answers == [(None, False)] and "Qarz: 1 500.00 $" in staff.sent[0]


def _message(text: str) -> Message:
    return Message(message_id=1, date=datetime.now(), chat=Chat(id=1, type="private"),
                   from_user=User(id=1, is_bot=False, first_name="T"), text=text)


async def test_customer_button_is_routed_before_the_ai_handler(monkeypatch):
    calls = []

    async def fake_list(message, with_menu_keyboard=False):
        calls.append(("customers", message.text))

    async def fake_ai_gate(message):
        calls.append(("ai", message.text))
        return False

    monkeypatch.setattr(customers_menu, "show_customer_list", fake_list)
    monkeypatch.setattr(bot_main, "_allowed", fake_ai_gate)
    bot = Bot("123456:TEST-TOKEN")
    try:
        for text in ("👥 Mijozlar", "/mijozlar", "18 pro max nechta qoldi?"):
            await bot_main.dp.propagate_event("message", _message(text), bot=bot)
    finally:
        await bot.session.close()
    assert calls == [("customers", "👥 Mijozlar"), ("customers", "/mijozlar"), ("ai", "18 pro max nechta qoldi?")]
