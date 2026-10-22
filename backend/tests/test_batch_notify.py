"""Batch cost message to Telegram (SPEC §17): per-model unit cost, sent only from the batch page to picked chats."""

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from aiogram.exceptions import TelegramForbiddenError, TelegramNetworkError
from aiogram.methods import SendMessage, SendPhoto

from app.bot import batch_notify, batch_texts, group_log
from app.core.config import get_settings
from app.schemas import BatchDetail, BatchTotals, ChannelRef, LineOut, Ref
from app.services import group_messages, telegram_notify, users
from tests.test_api import _product

GROUP_ID = -1001234567890


@pytest.fixture(autouse=True)
def bot_token(monkeypatch):
    monkeypatch.setattr(get_settings(), "telegram_bot_token", "42:TEST")


def _line(line_id: int, product_id: int, name: str, qty: int, unit_cost: str) -> LineOut:
    zero = Decimal(0)
    return LineOut(id=line_id, product=Ref(id=product_id, name=name), channel=ChannelRef(id=1, code="cargo", name="Kargo"),
                   qty=qty, price_aed=zero, rate=Decimal("3.67"), price_usd=zero, client=None, service_pct=None,
                   note=None, raw_name=None, estimates={}, per_unit={}, unit_cost_est=Decimal(unit_cost),
                   unit_cost=Decimal(unit_cost), overhead_est=zero, overhead=zero, sold_qty=0, adjusted_qty=0,
                   consigned_qty=0, remaining_qty=qty)


def _detail(lines: list[LineOut], code: str | None = None) -> BatchDetail:
    zero = Decimal(0)
    return BatchDetail(id=7, batch_date=date(2026, 10, 5), code=code, note=None, total_qty=sum(l.qty for l in lines),
                       lines=lines, expenses=[], categories=[],
                       totals=BatchTotals(price_usd=zero, cost_est=zero, cost=zero, overhead_est=zero, overhead=zero))


def test_lines_of_one_model_are_merged_in_first_seen_order():
    detail = _detail([_line(1, 10, "18 pro 1TB Burgundy", 6, "1900"), _line(2, 20, "17 Pro Max 256GB Silver", 5, "1450"),
                      _line(3, 10, "18 pro 1TB Burgundy", 4, "1946.925")], code="A-1")
    rows = batch_texts.model_costs(detail)
    assert [(r.name, r.qty) for r in rows] == [("18 pro 1TB Burgundy", 10), ("17 Pro Max 256GB Silver", 5)]
    assert rows[0].unit == Decimal("1918.77")
    [text] = batch_texts.render(detail)
    assert text.splitlines()[0] == "📦 Partiya · 05.10.2026 · A-1"
    assert "1. 18 pro 1TB Burgundy\n    10 dona × 1 919 $" in text
    assert "2. 17 Pro Max 256GB Silver\n    5 dona × 1 450 $" in text
    assert "Jami: 15 dona · 26 440 $" in text  # sum of the rounded rows: 10 × 1919 + 5 × 1450
    assert "O'rtacha" not in text


def test_long_message_is_split_at_line_breaks():
    detail = _detail([_line(i, i, f"Model {i} " + "x" * 80, 1, "100") for i in range(1, 80)])
    parts = batch_texts.render(detail)
    assert len(parts) > 1 and all(len(p) <= 4000 for p in parts)
    assert parts[0].startswith("📦 Partiya · 05.10.2026")
    assert "\n".join(parts).count("1 dona × 100 $") == 79


@pytest.mark.parametrize(("unit", "expected"), [
    ("1954.56", 1955), ("1954.01", 1955), ("1954.00", 1954), ("1954.004", 1954), ("1954.005", 1955), ("0", 0)])
def test_unit_cost_cents_are_rounded_up_to_a_whole_dollar(unit, expected):
    assert batch_texts.round_up(Decimal(unit)) == expected


def test_uneven_division_rounds_up():
    detail = _detail([_line(1, 10, "16 Pro", 2, "1000"), _line(2, 10, "16 Pro", 1, "1001")])
    [text] = batch_texts.render(detail)  # 3001 / 3 = 1000.333…
    assert "3 dona × 1 001 $" in text and "Jami: 3 dona · 3 003 $" in text


async def _create(client, h, product_id, day="2026-10-05", qty=10):
    r = await client.post("/api/batches", headers=h, json={
        "batch_date": day, "lines": [{"product_id": product_id, "qty": qty, "price_aed": 6350}], "expenses": []})
    assert r.status_code == 201, r.text
    return r.json()


async def _bot_users(session):
    for telegram_id, name in ((100, "Raxbar"), (200, "Sotuvchi")):
        await users.create_bot_user(session, telegram_id, name)
    gone = await users.create_bot_user(session, 400, "Ketgan")
    gone.is_active = False
    await session.flush()


async def _seen_group(session):
    await group_messages.save(session, chat_id=GROUP_ID, chat_title="Savdo guruhi", message_id=1, from_id=5,
                              from_name="Ali", sent_at=datetime(2026, 10, 3, tzinfo=timezone.utc), edited_at=None,
                              content_type="text", text="salom", file_id=None, file_name=None,
                              reply_to_message_id=None, raw={})


async def test_new_batch_sends_nothing(client, session, operator_h, telegram_calls):
    await _bot_users(session)
    product = await _product(client, operator_h)
    detail = await _create(client, operator_h, product["id"])
    assert "notify" not in detail
    assert telegram_calls == []


async def test_send_to_picked_chats_only(client, session, admin_h, operator_h, telegram_calls):
    await _bot_users(session)
    await _seen_group(session)
    r = await client.put("/api/telegram/notify", headers=admin_h,
                         json={"chat_ids": [f" {GROUP_ID} ", "@teztel_narx", str(GROUP_ID), "200"]})
    assert r.status_code == 200, r.text
    assert r.json()["chat_ids"] == [str(GROUP_ID), "@teztel_narx", "200"]

    r = await client.get("/api/telegram/recipients", headers=operator_h)
    assert r.status_code == 200
    assert r.json() == [  # configured groups/channels first, then active bot users by name (not the inactive one)
        {"chat_id": str(GROUP_ID), "name": "Savdo guruhi", "kind": "group", "blocked": False},
        {"chat_id": "@teztel_narx", "name": "@teztel_narx", "kind": "channel", "blocked": False},
        {"chat_id": "100", "name": "Raxbar", "kind": "user", "blocked": False},
        {"chat_id": "200", "name": "Sotuvchi", "kind": "user", "blocked": False},
    ]

    product = await _product(client, operator_h, model="iPhone 18 Pro", storage="1TB", color="Burgundy")
    detail = await _create(client, operator_h, product["id"])
    url = f"/api/batches/{detail['id']}/notify"
    r = await client.post(url, headers=operator_h, json={"chat_ids": ["100", str(GROUP_ID), "100"]})
    assert r.status_code == 200
    assert r.json() == {"recipients": 2, "sent": 2, "failed": 0, "blocked": 0, "skipped": 0}
    assert [c.chat_id for c in telegram_calls] == [100, GROUP_ID]  # the configured group may be written to
    assert all(isinstance(c, SendMessage) for c in telegram_calls)
    text = telegram_calls[0].text
    assert text.startswith("📦 Partiya · 05.10.2026") and product["name"] in text and "10 dona ×" in text

    strict = group_log.GroupSilence()  # the webhook/polling bot still never writes to a group
    with pytest.raises(group_log.GroupWriteBlocked):
        await strict(lambda bot, method: None, None, SendMessage(chat_id=GROUP_ID, text="x"))


PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


async def test_card_picture_goes_with_a_short_caption(client, session, operator_h, telegram_calls):
    await _bot_users(session)
    product = await _product(client, operator_h, model="iPhone 18 Pro", storage="1TB", color="Burgundy")
    detail = await _create(client, operator_h, product["id"])
    url = f"/api/batches/{detail['id']}/notify-photo"
    r = await client.post(url, headers=operator_h, files={"photo": ("tannarx.png", PNG, "image/png")},
                          data={"chat_ids": ["100", "200"]})
    assert r.status_code == 200, r.text
    assert r.json() == {"recipients": 2, "sent": 2, "failed": 0, "blocked": 0, "skipped": 0}
    assert [type(c) for c in telegram_calls] == [SendPhoto, SendPhoto]  # the picture only, no text message
    cap = telegram_calls[0].caption
    assert cap.startswith("📦 Partiya · 05.10.2026") and "Jami: 10 dona" in cap and "Taxminiy" in cap
    r = await client.post(url, headers=operator_h, files={"photo": ("x.png", b"GIF89a", "image/png")},
                          data={"chat_ids": ["100"]})
    assert r.status_code == 422 and "PNG" in r.json()["detail"]
    r = await client.post(url, headers=operator_h, files={"photo": ("tannarx.png", PNG, "image/png")},
                          data={"chat_ids": ["999"]})
    assert r.status_code == 422 and "999" in r.json()["detail"]


async def test_only_offered_chats_can_be_picked(client, session, operator_h, telegram_calls):
    await _bot_users(session)
    await _seen_group(session)  # the bot is in this group, but no admin added it
    product = await _product(client, operator_h)
    detail = await _create(client, operator_h, product["id"])
    url = f"/api/batches/{detail['id']}/notify"
    for bad in (["400"], ["999"], [str(GROUP_ID)]):  # inactive user, stranger, a group nobody configured
        r = await client.post(url, headers=operator_h, json={"chat_ids": bad})
        assert r.status_code == 422 and bad[0] in r.json()["detail"]
    r = await client.post(url, headers=operator_h, json={"chat_ids": []})
    assert r.status_code == 422 and "Kamida bitta" in r.json()["detail"]
    assert (await client.post(url, headers=operator_h)).status_code == 422  # a pick is required
    assert (await client.post("/api/batches/999999/notify", headers=operator_h,
                              json={"chat_ids": ["100"]})).status_code == 404
    assert telegram_calls == []


async def test_bad_chat_id_is_refused(client, admin_h):
    r = await client.put("/api/telegram/notify", headers=admin_h, json={"chat_ids": ["guruh"]})
    assert r.status_code == 422 and "guruh" in r.json()["detail"]


async def test_config_lists_known_groups(client, session, admin_h):
    await _seen_group(session)
    body = (await client.get("/api/telegram/notify", headers=admin_h)).json()
    assert body == {"chat_ids": [], "bot_configured": True, "groups": [{"chat_id": GROUP_ID, "title": "Savdo guruhi"}]}


def _flaky(monkeypatch, errors: dict):
    """Bots whose sends to the given chats raise the given Telegram error."""
    make_bot = batch_notify.make_bot

    def flaky(allowed):
        bot = make_bot(allowed)
        record = bot.session.make_request

        async def make_request(b, method, timeout=None):
            if method.chat_id in errors:
                raise errors[method.chat_id](method)
            return await record(b, method, timeout)

        bot.session.make_request = make_request
        return bot

    monkeypatch.setattr(batch_notify, "make_bot", flaky)


async def test_blocked_chat_gets_one_attempt_until_it_starts_the_bot_again(client, session, operator_h, monkeypatch,
                                                                           telegram_calls):
    await _bot_users(session)
    await users.create_bot_user(session, 300, "Kassir")
    recording = batch_notify.make_bot
    _flaky(monkeypatch, {
        100: lambda m: TelegramForbiddenError(method=m, message="Forbidden: bot was blocked by the user"),
        200: lambda m: TelegramNetworkError(method=m, message="timeout"),  # not remembered: may work next time
    })
    product = await _product(client, operator_h)
    detail = await _create(client, operator_h, product["id"])
    url = f"/api/batches/{detail['id']}/notify"
    r = await client.post(url, headers=operator_h, json={"chat_ids": ["100", "200", "300"]})
    assert r.json() == {"recipients": 3, "sent": 1, "failed": 2, "blocked": 1, "skipped": 0}
    assert [c.chat_id for c in telegram_calls] == [300]  # the failures did not stop the others
    recipients = (await client.get("/api/telegram/recipients", headers=operator_h)).json()
    assert {r["chat_id"]: r["blocked"] for r in recipients} == {"300": False, "100": True, "200": False}
    telegram_calls.clear()

    monkeypatch.setattr(batch_notify, "make_bot", recording)  # Telegram works again; 100 is still skipped untried
    r = await client.post(url, headers=operator_h, json={"chat_ids": ["100", "200"]})
    assert r.json() == {"recipients": 1, "sent": 1, "failed": 0, "blocked": 0, "skipped": 1}
    assert [c.chat_id for c in telegram_calls] == [200]
    r = await client.post(url, headers=operator_h, json={"chat_ids": ["100"]})
    assert r.json() == {"recipients": 0, "sent": 0, "failed": 0, "blocked": 0, "skipped": 1}
    assert len(telegram_calls) == 1

    assert await telegram_notify.mark_reachable(session, 100)  # what writing to the bot does
    r = await client.post(url, headers=operator_h, json={"chat_ids": ["100"]})
    assert r.json() == {"recipients": 1, "sent": 1, "failed": 0, "blocked": 0, "skipped": 0}
    assert [c.chat_id for c in telegram_calls] == [200, 100]


async def test_start_and_group_messages_make_a_chat_reachable_again(session, monkeypatch):
    from contextlib import asynccontextmanager

    from aiogram.types import Chat, Message, User

    from app.bot import main as bot_main

    @asynccontextmanager
    async def fake_session():
        yield session

    monkeypatch.setattr(bot_main, "SessionLocal", fake_session)
    monkeypatch.setattr(group_log, "SessionLocal", fake_session)
    await telegram_notify.mark_unreachable(session, [100, GROUP_ID])
    user = User(id=100, is_bot=False, first_name="Raxbar")
    answers = []

    class Start(Message):
        async def answer(self, text, **kwargs):
            answers.append(text)

    start = Start(message_id=1, date=datetime(2026, 10, 5, tzinfo=timezone.utc), chat=Chat(id=100, type="private"),
                  from_user=user, text="/start")
    await bot_main.start(start)
    assert await telegram_notify.unreachable(session) == {str(GROUP_ID)}

    group = Message(message_id=2, date=datetime(2026, 10, 5, tzinfo=timezone.utc),
                    chat=Chat(id=GROUP_ID, type="supergroup", title="Savdo guruhi"), from_user=user, text="salom")
    await group_log.capture(group)
    assert await telegram_notify.unreachable(session) == set()


async def test_rbac(client, viewer_h, operator_h):
    product = await _product(client, operator_h)
    detail = await _create(client, operator_h, product["id"])
    url = f"/api/batches/{detail['id']}/notify"
    assert (await client.post(url, headers=viewer_h, json={"chat_ids": ["100"]})).status_code == 403
    assert (await client.post(url, json={"chat_ids": ["100"]})).status_code == 401
    assert (await client.get("/api/telegram/recipients", headers=viewer_h)).status_code == 403
    assert (await client.get("/api/telegram/recipients")).status_code == 401
    for h in (viewer_h, operator_h):
        assert (await client.get("/api/telegram/notify", headers=h)).status_code == 403
        assert (await client.put("/api/telegram/notify", headers=h, json={"chat_ids": []})).status_code == 403
