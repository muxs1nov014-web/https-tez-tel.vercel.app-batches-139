"""Panel URL announcements (app/bot/panel_link.py): a new live tunnel URL reaches every active bot user once."""

from contextlib import asynccontextmanager

import pytest
from aiogram import Bot
from aiogram.exceptions import TelegramForbiddenError
from aiogram.methods import SendMessage

from app.bot import customers_menu, panel_link
from app.models import Setting
from app.services import users
from tests.test_group_log import RecordingSession

OLD, NEW = "https://old-host.trycloudflare.com", "https://new-host.trycloudflare.com"


class BlockedBySomeone(RecordingSession):
    async def make_request(self, bot, method, timeout=None):
        if getattr(method, "chat_id", None) == 300:
            raise TelegramForbiddenError(method=method, message="Forbidden: bot was blocked by the user")
        return await super().make_request(bot, method, timeout)


@pytest.fixture
def env(session, monkeypatch):
    state = {"url": NEW, "live": True}

    @asynccontextmanager
    async def fake_session():
        yield session

    async def fake_url():
        return state["url"]

    monkeypatch.setattr(panel_link, "SessionLocal", fake_session)
    monkeypatch.setattr(panel_link, "current_webapp_url", fake_url)
    monkeypatch.setattr(panel_link, "_is_live", lambda url: state["live"])
    return state


async def _users(session):
    for telegram_id, name in ((100, "Raxbar"), (200, "Sotuvchi"), (300, "Bloklagan")):
        await users.create_bot_user(session, telegram_id, name)
    inactive = await users.create_bot_user(session, 400, "Ketgan")
    inactive.is_active = False
    await session.flush()


async def test_new_url_is_sent_once_to_active_users(session, env):
    await _users(session)
    session.add(Setting(key=panel_link.SETTING_KEY, value=OLD))
    await session.flush()
    bot = Bot("42:TEST", session=BlockedBySomeone())

    assert await panel_link.announce_if_changed(bot) == 2
    calls = bot.session.calls
    assert [c.chat_id for c in calls] == [100, 200] and all(isinstance(c, SendMessage) for c in calls)
    buttons = calls[0].reply_markup.keyboard[0]
    assert [b.text for b in buttons] == [customers_menu.CUSTOMERS_BUTTON, customers_menu.PANEL_BUTTON]
    assert buttons[1].web_app.url == NEW
    assert (await session.get(Setting, panel_link.SETTING_KEY)).value == NEW

    assert await panel_link.announce_if_changed(bot) == 0
    assert len(bot.session.calls) == 2


async def test_dead_or_missing_url_is_not_announced(session, env):
    await _users(session)
    bot = Bot("42:TEST", session=RecordingSession())

    env["live"] = False
    assert await panel_link.announce_if_changed(bot) == 0
    assert await session.get(Setting, panel_link.SETTING_KEY) is None

    env["url"] = None
    assert await panel_link.announce_if_changed(bot) == 0
    assert bot.session.calls == []
