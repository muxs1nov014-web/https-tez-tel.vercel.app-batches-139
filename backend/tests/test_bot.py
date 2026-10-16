from contextlib import asynccontextmanager
from datetime import date
from decimal import Decimal
from zoneinfo import ZoneInfo

from google.genai import types

from app.bot import assistant as assistant_module
from app.bot.assistant import Assistant
from app.schemas import LineIn, SaleIn, SaleLineIn
from app.services import analytics, batches, catalog, sales, users


async def _seed(session):
    product = await catalog.create_product(session, "Apple", "iPhone 18 Pro Max", "256GB", "Black", None)
    await batches.create_batch(session, date(2026, 9, 1), None, None,
                               [LineIn(product_id=product.id, qty=40, price_aed=Decimal("6350"))], [], None)
    await sales.create_sale(session, SaleIn(sale_date=date(2026, 9, 5), lines=[
        SaleLineIn(product_id=product.id, qty=10, price_usd=Decimal("2300"))]), None)
    return product


async def test_analytics_tools(session):
    await _seed(session)
    stock = await analytics.stock_summary(session, "18 pro max")
    assert stock["total_qty"] == 30
    assert (await analytics.stock_summary(session, "nokia 3310"))["error"] == "product_not_found"
    sold = await analytics.sales_summary(session, "2026-09-01", "2026-09-30", "18pm")
    assert sold["total_qty"] == 10 and sold["total_profit_usd"] > 0
    bought = await analytics.purchases_summary(session, "2026-09-01", "2026-09-30")
    assert bought["total_qty"] == 40
    breakdown = await analytics.unit_cost_breakdown(session, "18 pro max 256")
    item = breakdown["items"][0]
    assert item["costs_per_unit_usd"]["Rastamojka"] == 264.0
    assert item["unit_cost_usd"] == round(item["price_usd"] + item["overhead_per_unit_usd"], 2)
    assert (await analytics.batch_summary(session, "2026-09-01"))["total_qty"] == 40
    assert (await analytics.top_products(session, metric="profit"))["items"][0]["qty"] == 10


class FakeModels:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    async def generate_content(self, model, contents, config):
        self.calls.append(list(contents))
        return self.responses.pop(0)


def _resp(part: types.Part) -> types.GenerateContentResponse:
    return types.GenerateContentResponse(candidates=[types.Candidate(content=types.Content(role="model",
                                                                                           parts=[part]))])


async def test_assistant_tool_loop(session, monkeypatch):
    await _seed(session)

    @asynccontextmanager
    async def fake_session():
        yield session

    monkeypatch.setattr(assistant_module, "SessionLocal", fake_session)
    fake = FakeModels([
        _resp(types.Part(function_call=types.FunctionCall(name="stock_summary",
                                                          args={"product_query": "18 pro max"}))),
        _resp(types.Part(text="Omborda 30 dona 18 Pro Max bor.")),
    ])
    bot = Assistant.__new__(Assistant)
    bot.model, bot.timeout, bot.tz = "test", 5, ZoneInfo("Asia/Tashkent")
    bot.client = type("C", (), {"aio": type("A", (), {"models": fake})()})()
    bot.tool = types.Tool(function_declarations=[])

    answer = await bot.answer(text="18 pro max dan nechta qoldi?")
    assert answer == "Omborda 30 dona 18 Pro Max bor."
    tool_turn = fake.calls[1][-1].parts[0].function_response
    assert tool_turn.name == "stock_summary" and tool_turn.response["result"]["total_qty"] == 30


async def test_bot_whitelist(session):
    await users.create_bot_user(session, 777, "Sotuvchi")
    assert await users.is_bot_user_allowed(session, 777)
    assert not await users.is_bot_user_allowed(session, 778)
