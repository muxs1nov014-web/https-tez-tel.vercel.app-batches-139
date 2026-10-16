"""Telegram Mini App login (SPEC §13.3): initData verifier, POST /auth/telegram, users.telegram_id, bot buttons."""

import hashlib
import hmac
import json
import time
from types import SimpleNamespace
from urllib.parse import urlencode

import pytest
from aiogram.types import ReplyKeyboardMarkup

from app.bot import customers_menu
from app.bot import main as bot_main
from app.bot import webapp
from app.core.config import get_settings
from app.core.telegram_auth import InitDataInvalid, verify_init_data
from app.services import users

BOT_TOKEN = "123456:TEST-TOKEN"
DAY = 86400


def _init_data(telegram_id: int = 777000111, auth_date: int | None = None, token: str = BOT_TOKEN) -> str:
    """initData built the way Telegram documents it: the hash covers the decoded fields sorted by key, then
    everything is URL-encoded. The name has spaces and Cyrillic, so URL decoding is part of what gets tested."""
    fields = {
        "query_id": "AAHdF6IQAAAAAN0XohDhrOrc",
        "user": json.dumps({"id": telegram_id, "first_name": "Акмал aka", "language_code": "uz"},
                           ensure_ascii=False, separators=(",", ":")),
        "auth_date": str(int(time.time()) if auth_date is None else auth_date),
        "signature": "c2lnbmF0dXJl",  # newer clients send this; it is covered by the hash like any other field
    }
    data_check_string = "\n".join(f"{key}={fields[key]}" for key in sorted(fields))
    secret_key = hmac.new(key=b"WebAppData", msg=token.encode(), digestmod=hashlib.sha256).digest()
    fields["hash"] = hmac.new(key=secret_key, msg=data_check_string.encode(), digestmod=hashlib.sha256).hexdigest()
    return urlencode(fields)


def _verify(init_data: str, token: str = BOT_TOKEN, now: float | None = None) -> int:
    return verify_init_data(init_data, token, DAY, now)


# ---- pure verifier ----
def test_verifier_accepts_genuine_init_data():
    assert _verify(_init_data(777000111)) == 777000111


def test_verifier_rejects_tampering_and_foreign_tokens():
    genuine = _init_data(777000111)
    with pytest.raises(InitDataInvalid, match="imzosi noto'g'ri"):
        _verify(genuine.replace("777000111", "777000112"))  # someone else's id, original hash
    with pytest.raises(InitDataInvalid, match="imzosi noto'g'ri"):
        _verify(genuine, token="654321:OTHER-BOT")
    with pytest.raises(InitDataInvalid, match="imzosi noto'g'ri"):
        _verify(_init_data(777000111, token="654321:OTHER-BOT"))
    unsigned = "&".join(p for p in genuine.split("&") if not p.startswith("hash="))
    with pytest.raises(InitDataInvalid, match="imzosi topilmadi"):
        _verify(unsigned)
    with pytest.raises(InitDataInvalid, match="imzosi noto'g'ri"):
        _verify(f"{unsigned}&hash=%D0%B6")  # non-ASCII hash must fail cleanly, not raise TypeError
    with pytest.raises(InitDataInvalid, match="formatda"):
        _verify(f"{genuine}&user=%7B%22id%22%3A1%7D")  # a repeated key is ambiguous
    with pytest.raises(InitDataInvalid, match="formatda"):
        _verify("not-a-query-string")
    with pytest.raises(InitDataInvalid, match="imzosi topilmadi"):
        _verify("")


def test_verifier_enforces_max_age():
    signed_at = 1_790_000_000
    init_data = _init_data(777000111, auth_date=signed_at)
    assert _verify(init_data, now=signed_at + DAY) == 777000111  # exactly at the limit is still fine
    with pytest.raises(InitDataInvalid, match="eskirgan"):
        _verify(init_data, now=signed_at + DAY + 1)


def test_verifier_refuses_when_bot_token_is_not_configured():
    with pytest.raises(InitDataInvalid, match="sozlanmagan"):
        _verify(_init_data(777000111), token="")


# ---- POST /api/auth/telegram ----
@pytest.fixture
def telegram_settings(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "telegram_bot_token", BOT_TOKEN)
    monkeypatch.setattr(settings, "telegram_initdata_max_age", DAY)
    return settings


async def test_telegram_login_for_linked_active_user(client, session, telegram_settings):
    user = await users.create_user(session, "tg_seller", "secret123", "Sotuvchi", "operator", telegram_id=777000111)
    r = await client.post("/api/auth/telegram", json={"init_data": _init_data(777000111)})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["token_type"] == "bearer"
    assert body["user"]["id"] == user.id and body["user"]["telegram_id"] == 777000111
    me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200
    assert me.json() == {"id": user.id, "username": "tg_seller", "full_name": "Sotuvchi", "role": "operator",
                         "is_active": True, "telegram_id": 777000111}


async def test_telegram_login_refuses_unlinked_and_inactive_users(client, session, telegram_settings):
    r = await client.post("/api/auth/telegram", json={"init_data": _init_data(777000999)})
    assert r.status_code == 403
    assert "777000999" in r.json()["detail"] and "ulanmagan" in r.json()["detail"]

    user = await users.create_user(session, "tg_gone", "secret123", "Ketgan", "viewer", telegram_id=777000222)
    user.is_active = False
    await session.flush()
    r = await client.post("/api/auth/telegram", json={"init_data": _init_data(777000222)})
    assert r.status_code == 403
    assert "777000222" in r.json()["detail"] and "faol emas" in r.json()["detail"]


async def test_telegram_login_401_for_bad_stale_or_unverifiable_data(client, session, telegram_settings,
                                                                     monkeypatch):
    await users.create_user(session, "tg_seller", "secret123", "Sotuvchi", "operator", telegram_id=777000111)
    tampered = _init_data(777000333).replace("777000333", "777000111")
    stale = _init_data(777000111, auth_date=int(time.time()) - DAY - 60)
    for init_data in (tampered, stale, _init_data(777000111, token="654321:OTHER-BOT"), ""):
        r = await client.post("/api/auth/telegram", json={"init_data": init_data})
        assert r.status_code == 401, (init_data, r.text)
        assert "access_token" not in r.json()

    monkeypatch.setattr(telegram_settings, "telegram_bot_token", "")
    r = await client.post("/api/auth/telegram", json={"init_data": _init_data(777000111, token="")})
    assert r.status_code == 401 and "sozlanmagan" in r.json()["detail"]

    assert (await client.post("/api/auth/telegram", json={})).status_code == 422


# ---- users.telegram_id via the admin users API ----
async def test_admin_links_and_unlinks_telegram_id(client, admin_h):
    r = await client.post("/api/users", json={"username": "kassir", "password": "secret123456", "role": "viewer",
                                              "telegram_id": 555000111}, headers=admin_h)
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["telegram_id"] == 555000111

    plain = await client.post("/api/users", json={"username": "omborchi", "password": "secret123456"}, headers=admin_h)
    assert plain.status_code == 201 and plain.json()["telegram_id"] is None
    plain_id = plain.json()["id"]

    r = await client.patch(f"/api/users/{plain_id}", json={"telegram_id": 555000222}, headers=admin_h)
    assert r.status_code == 200 and r.json()["telegram_id"] == 555000222
    r = await client.patch(f"/api/users/{plain_id}", json={"full_name": "Omborchi"}, headers=admin_h)
    assert r.json()["telegram_id"] == 555000222  # omitted = unchanged
    r = await client.patch(f"/api/users/{plain_id}", json={"telegram_id": None}, headers=admin_h)
    assert r.status_code == 200 and r.json()["telegram_id"] is None  # null = unlinked
    r = await client.patch(f"/api/users/{plain_id}", json={"role": None, "telegram_id": 555000222}, headers=admin_h)
    assert r.json()["role"] == "viewer"  # null still means "unchanged" for every other field

    listed = {u["id"]: u for u in (await client.get("/api/users", headers=admin_h)).json()}
    assert listed[created["id"]]["telegram_id"] == 555000111


async def test_duplicate_or_invalid_telegram_id_is_refused(client, admin_h):
    first = await client.post("/api/users", json={"username": "birinchi", "password": "secret123456",
                                                  "telegram_id": 555000333}, headers=admin_h)
    assert first.status_code == 201, first.text

    dup = await client.post("/api/users", json={"username": "ikkinchi", "password": "secret123456",
                                                "telegram_id": 555000333}, headers=admin_h)
    assert dup.status_code == 409 and "555000333" in dup.json()["detail"]
    same_login = await client.post("/api/users", json={"username": "birinchi", "password": "secret123456"},
                                   headers=admin_h)
    assert same_login.status_code == 409 and same_login.json()["detail"] == "Bunday login mavjud"

    other = (await client.post("/api/users", json={"username": "uchinchi", "password": "secret123456"},
                               headers=admin_h)).json()
    clash = await client.patch(f"/api/users/{other['id']}", json={"telegram_id": 555000333}, headers=admin_h)
    assert clash.status_code == 409 and "555000333" in clash.json()["detail"]
    again = await client.patch(f"/api/users/{first.json()['id']}", json={"telegram_id": 555000333}, headers=admin_h)
    assert again.status_code == 200  # re-saving a user's own id is not a clash

    for bad in (0, -5, "abc"):
        r = await client.patch(f"/api/users/{other['id']}", json={"telegram_id": bad}, headers=admin_h)
        assert r.status_code == 422, bad


async def test_only_admin_can_set_telegram_id(client, session, admin_h, operator_h):
    target = await users.create_user(session, "nishon", "secret123", "Nishon", "viewer")
    r = await client.patch(f"/api/users/{target.id}", json={"telegram_id": 555000444}, headers=operator_h)
    assert r.status_code == 403
    r = await client.post("/api/users", json={"username": "yangi", "password": "secret123456",
                                              "telegram_id": 555000444}, headers=operator_h)
    assert r.status_code == 403
    assert (await client.patch(f"/api/users/{target.id}", json={"telegram_id": 555000444})).status_code == 401


# ---- bot: "📱 Panel" Mini App button on the reply keyboard ----
def test_https_url_required_for_mini_app():
    assert webapp.https_url("") is None
    assert webapp.https_url("http://panel.example.uz") is None
    assert webapp.https_url("  https://panel.example.uz/  ") == "https://panel.example.uz/"


def test_main_keyboard_has_panel_button_only_with_url():
    [[only]] = customers_menu.main_keyboard(None).keyboard
    assert only.text == customers_menu.CUSTOMERS_BUTTON and only.web_app is None

    [[customers, panel]] = customers_menu.main_keyboard("https://panel.example.uz").keyboard
    assert customers.text == customers_menu.CUSTOMERS_BUTTON
    assert panel.text == "📱 Panel" and panel.web_app.url == "https://panel.example.uz"


def test_welcome_is_one_message_with_the_reply_keyboard():
    [(body, keyboard)] = bot_main.welcome_messages(None)
    assert body == bot_main.WELCOME and len(keyboard.keyboard[0]) == 1

    [(body, keyboard)] = bot_main.welcome_messages("https://panel.example.uz")
    assert "📱 Panel" in body and isinstance(keyboard, ReplyKeyboardMarkup)
    assert keyboard.keyboard[0][1].web_app.url == "https://panel.example.uz"


async def test_start_handler_sends_panel_button_for_current_url(monkeypatch):
    async def allowed(message):
        return True

    monkeypatch.setattr(bot_main, "_allowed", allowed)
    for url, buttons in ((None, 1), ("https://panel.example.uz", 2)):
        async def current(url=url):
            return url

        monkeypatch.setattr(bot_main, "current_webapp_url", current)
        sent = []

        async def answer(text, reply_markup=None):
            sent.append((text, reply_markup))

        await bot_main.start(SimpleNamespace(answer=answer))
        [(_, keyboard)] = sent
        assert len(keyboard.keyboard[0]) == buttons, url


async def test_webapp_url_prefers_setting_then_tunnel(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(webapp, "_cache", None)
    monkeypatch.setattr(settings, "webapp_url", "https://panel.example.uz")
    monkeypatch.setattr(settings, "tunnel_metrics_url", "http://tunnel:20241")
    assert await webapp.current_webapp_url() == "https://panel.example.uz"

    calls = []

    def fetch(metrics_url):
        calls.append(metrics_url)
        return "https://abc-def.trycloudflare.com"

    monkeypatch.setattr(webapp, "_fetch_tunnel_url", fetch)
    monkeypatch.setattr(settings, "webapp_url", "")
    assert await webapp.current_webapp_url() == "https://abc-def.trycloudflare.com"
    assert await webapp.current_webapp_url() == "https://abc-def.trycloudflare.com"
    assert calls == ["http://tunnel:20241"]  # cached between calls

    monkeypatch.setattr(webapp, "_cache", None)
    monkeypatch.setattr(settings, "webapp_url", "http://insecure.example.uz")
    monkeypatch.setattr(settings, "tunnel_metrics_url", "")
    assert await webapp.current_webapp_url() is None


async def test_webapp_url_is_none_when_tunnel_unreachable(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(webapp, "_cache", None)
    monkeypatch.setattr(settings, "webapp_url", "")
    monkeypatch.setattr(settings, "tunnel_metrics_url", "http://tunnel:20241")

    def fetch(metrics_url):
        raise OSError("connection refused")

    monkeypatch.setattr(webapp, "_fetch_tunnel_url", fetch)
    assert await webapp.current_webapp_url() is None
