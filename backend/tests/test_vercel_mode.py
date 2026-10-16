"""Vercel mode (SPEC §16): Neon URLs, the Telegram webhook endpoint and per-request update handling."""

from contextlib import asynccontextmanager

import pytest
from aiogram import Bot
from sqlalchemy import select

from app.bot import group_log, webhook
from app.bot import main as bot_main
from app.core.config import async_db_url, get_settings
from app.models import TelegramGroupMessage
from tests.test_group_log import RecordingSession

SECRET = "s3cret-token_value"
GROUP_UPDATE = {
    "update_id": 1,
    "message": {"message_id": 77, "date": 1791000000, "text": "Xusan aka 2 ta 17 pro max",
                "chat": {"id": -1003839931967, "type": "supergroup", "title": "Telefon nasiya nazirat"},
                "from": {"id": 5005, "is_bot": False, "first_name": "Ali"}},
}


def test_async_db_url_accepts_neon_urls():
    neon = "postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
    assert async_db_url(neon) == "postgresql+asyncpg://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/neondb?ssl=require"
    assert async_db_url("postgres://u:p@h:5432/d") == "postgresql+asyncpg://u:p@h:5432/d"
    assert async_db_url("postgresql://u:p@h/d?sslmode=disable") == "postgresql+asyncpg://u:p@h/d"
    local = "postgresql+asyncpg://telefon:telefon@db:5432/telefon"
    assert async_db_url(local) == local


@pytest.fixture
def secret(monkeypatch):
    monkeypatch.setattr(get_settings(), "telegram_webhook_secret", SECRET)


async def test_webhook_is_off_without_a_secret(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "telegram_webhook_secret", "")
    r = await client.post("/api/telegram/webhook", json=GROUP_UPDATE,
                          headers={"X-Telegram-Bot-Api-Secret-Token": ""})
    assert r.status_code == 404


async def test_webhook_refuses_a_wrong_secret(client, secret, monkeypatch):
    called = []

    async def fake_handle(data):
        called.append(data)

    monkeypatch.setattr(webhook, "handle_update", fake_handle)
    assert (await client.post("/api/telegram/webhook", json=GROUP_UPDATE)).status_code == 401
    r = await client.post("/api/telegram/webhook", json=GROUP_UPDATE,
                          headers={"X-Telegram-Bot-Api-Secret-Token": "wrong"})
    assert r.status_code == 401 and called == []


async def test_webhook_passes_updates_on_and_always_answers_ok(client, secret, monkeypatch):
    called = []

    async def fake_handle(data):
        called.append(data)
        raise RuntimeError("handler crashed")

    monkeypatch.setattr(webhook, "handle_update", fake_handle)
    r = await client.post("/api/telegram/webhook", json=GROUP_UPDATE,
                          headers={"X-Telegram-Bot-Api-Secret-Token": SECRET})
    assert r.status_code == 200 and called == [GROUP_UPDATE]


async def test_handle_update_stores_group_message_silently(session, monkeypatch):
    @asynccontextmanager
    async def fake_session():
        yield session

    recording = RecordingSession()

    def fake_bot():
        bot = Bot("42:TEST", session=recording)
        bot.session.middleware(group_log.GroupSilence())
        return bot

    monkeypatch.setattr(group_log, "SessionLocal", fake_session)
    monkeypatch.setattr(webhook, "make_bot", fake_bot)
    monkeypatch.setattr(bot_main, "assistant", object())

    await webhook.handle_update(GROUP_UPDATE)

    row = (await session.execute(select(TelegramGroupMessage))).scalar_one()
    assert (row.chat_id, row.message_id, row.text) == (-1003839931967, 77, "Xusan aka 2 ta 17 pro max")
    assert recording.calls == []
