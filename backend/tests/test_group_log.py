"""Silent group capture (SPEC §14): group messages are stored, nothing is ever sent to a group."""

from contextlib import asynccontextmanager
from datetime import datetime, timezone

import pytest
from aiogram import Bot
from aiogram.client.session.base import BaseSession
from aiogram.methods import GetChat, SendMessage
from aiogram.types import Chat, Document, Message, Update, User
from sqlalchemy import select

from app.bot import group_log
from app.bot import main as bot_main
from app.core.config import get_settings
from app.models import TelegramGroupMessage

GROUP = Chat(id=-1001234567890, type="supergroup", title="Savdo guruhi")
ALI = User(id=5005, is_bot=False, first_name="Ali", last_name="aka")
SENT = datetime(2026, 10, 3, 9, 0, tzinfo=timezone.utc)


class RecordingSession(BaseSession):
    """Bot session that records every Telegram call instead of making it."""

    def __init__(self):
        super().__init__()
        self.calls = []

    async def make_request(self, bot, method, timeout=None):
        self.calls.append(method)
        return True

    async def stream_content(self, *args, **kwargs):
        raise NotImplementedError

    async def close(self):
        pass


@pytest.fixture
def bot(session, monkeypatch):
    @asynccontextmanager
    async def fake_session():
        yield session

    monkeypatch.setattr(group_log, "SessionLocal", fake_session)
    monkeypatch.setattr(bot_main, "SessionLocal", fake_session)
    b = Bot("42:TEST", session=RecordingSession())
    b.session.middleware(group_log.GroupSilence())
    return b


def _update(update_id: int, *, edited: bool = False, chat: Chat = GROUP, **message) -> Update:
    msg = Message(message_id=message.pop("message_id", 10), date=SENT, chat=chat, from_user=ALI, **message)
    return Update(update_id=update_id, **{"edited_message" if edited else "message": msg})


async def _rows(session) -> list[TelegramGroupMessage]:
    return list((await session.execute(select(TelegramGroupMessage).order_by(TelegramGroupMessage.id))).scalars())


async def test_group_messages_are_stored_and_never_answered(session, bot):
    await bot_main.dp.feed_update(bot, _update(1, text="/start"))
    await bot_main.dp.feed_update(bot, _update(2, message_id=11, text="Xusan aka 5 ta 17 pro max oldi"))
    await bot_main.dp.feed_update(bot, _update(3, message_id=12, caption="hisobot", document=Document(
        file_id="DOC1", file_unique_id="U1", file_name="qoldiq.xlsx")))

    # Nothing is sent; the .xlsx document is only read (GetFile) by the nasiya intake (SPEC §18).
    assert [type(c).__name__ for c in bot.session.calls] == ["GetFile"]
    rows = await _rows(session)
    assert [(r.message_id, r.content_type, r.text) for r in rows] == [
        (10, "text", "/start"), (11, "text", "Xusan aka 5 ta 17 pro max oldi"), (12, "document", "hisobot")]
    first = rows[0]
    assert (first.chat_id, first.chat_title, first.from_id, first.from_name) == (
        GROUP.id, "Savdo guruhi", 5005, "Ali aka")
    assert (rows[2].file_id, rows[2].file_name) == ("DOC1", "qoldiq.xlsx")
    assert rows[1].raw["text"] == "Xusan aka 5 ta 17 pro max oldi"


async def test_edit_overwrites_the_stored_message(session, bot):
    await bot_main.dp.feed_update(bot, _update(1, message_id=20, text="3 ta"))
    await bot_main.dp.feed_update(bot, _update(2, edited=True, message_id=20, text="4 ta",
                                                    edit_date=int(SENT.timestamp())))

    rows = await _rows(session)
    assert len(rows) == 1 and rows[0].text == "4 ta" and rows[0].edited_at == SENT
    assert bot.session.calls == []


async def test_other_groups_are_ignored_when_an_allowlist_is_set(session, bot, monkeypatch):
    monkeypatch.setattr(get_settings(), "telegram_group_ids", " -100999, -100888")
    await bot_main.dp.feed_update(bot, _update(1, text="salom"))
    assert await _rows(session) == []

    monkeypatch.setattr(get_settings(), "telegram_group_ids", str(GROUP.id))
    await bot_main.dp.feed_update(bot, _update(2, message_id=30, text="salom"))
    assert [r.message_id for r in await _rows(session)] == [30]


async def test_private_chat_still_answers_and_is_not_stored(session, bot):
    private = Chat(id=ALI.id, type="private")
    await bot_main.dp.feed_update(bot, _update(1, chat=private, text="/start"))

    assert await _rows(session) == []
    [call] = bot.session.calls
    assert isinstance(call, SendMessage) and call.chat_id == ALI.id and "ruxsat yo'q" in call.text


async def test_silence_guard_blocks_writes_to_groups(bot):
    with pytest.raises(group_log.GroupWriteBlocked):
        await bot.send_message(GROUP.id, "salom")
    with pytest.raises(group_log.GroupWriteBlocked):
        await bot.send_chat_action("@public_group", "typing")
    assert bot.session.calls == []

    await bot.send_message(ALI.id, "salom")
    await bot.get_chat(GROUP.id)
    assert [type(c) for c in bot.session.calls] == [SendMessage, GetChat]


async def test_a_nasiya_workbook_sent_to_the_bot_is_counted_and_summarised(session, bot, monkeypatch):
    """The group's daily file comes from another bot, which this bot cannot see: an operator forwards it (§18.2)."""
    import io

    from app.bot import nasiya_upload
    from app.models import Customer, NasiyaReport
    from app.models import User as PanelUser
    from tests.test_nasiya_api import DAY1, workbook

    @asynccontextmanager
    async def fake_session():
        yield session

    monkeypatch.setattr(nasiya_upload, "SessionLocal", fake_session)
    content = workbook("14,10,2026", DAY1)

    async def download(file, destination=None):
        return io.BytesIO(content)

    monkeypatch.setattr(bot, "download", download)
    private = Chat(id=ALI.id, type="private")
    doc = Document(file_id="DOC1", file_unique_id="U1", file_name="nazorat_14.10.2026.xlsx", file_size=len(content))

    await bot_main.dp.feed_update(bot, _update(1, chat=private, document=doc))
    [call] = bot.session.calls
    assert isinstance(call, SendMessage) and "faqat panel operatori" in call.text and "5005" in call.text

    session.add_all([PanelUser(username="op", password_hash="x", role="operator", telegram_id=ALI.id),
                     Customer(name="Ali aka", kind="dealer"), Customer(name="Vali aka", kind="dealer")])
    await session.flush()
    bot.session.calls.clear()
    await bot_main.dp.feed_update(bot, _update(2, chat=private, message_id=11, document=doc))
    [call] = bot.session.calls
    assert isinstance(call, SendMessage) and call.chat_id == ALI.id
    assert "14.10.2026" in call.text and "• Nasiya: 3 dona, 3 460 $" in call.text and "✅ Hisoblandi." in call.text
    assert "📊 Nasiya kunlar bo'yicha:" in call.text and "👤 Mijozlar:" in call.text
    report = (await session.execute(select(NasiyaReport))).scalar_one()
    assert (report.status, report.review_note) == ("confirmed", "Avtomatik: xatosiz")

    bot.session.calls.clear()
    await bot_main.dp.feed_update(bot, _update(3, chat=private, message_id=12, document=doc))
    assert "avval yuklangan" in bot.session.calls[0].text and "Bu kun hisobga olingan" in bot.session.calls[0].text
