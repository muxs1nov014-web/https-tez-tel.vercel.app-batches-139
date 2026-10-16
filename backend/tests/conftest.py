import os
from collections.abc import AsyncIterator

import asyncpg
import pytest
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.core.db import get_session
from app.core.security import create_access_token
from app.main import app
from app.services import users as users_service

ADMIN_DSN = os.environ.get("TEST_ADMIN_DSN", "postgresql://telefon:telefon@localhost:23432/telefon")
TEST_DB = "telefon_test"
TEST_URL = os.environ.get("TEST_DATABASE_URL",
                          f"postgresql+asyncpg://telefon:telefon@localhost:23432/{TEST_DB}")


@pytest.fixture(scope="session")
async def engine():
    conn = await asyncpg.connect(ADMIN_DSN)
    await conn.execute(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")
    await conn.execute(f"CREATE DATABASE {TEST_DB}")
    await conn.close()
    os.environ["ALEMBIC_DATABASE_URL"] = TEST_URL
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "alembic"))
    import asyncio
    await asyncio.to_thread(command.upgrade, cfg, "head")
    eng = create_async_engine(TEST_URL)
    yield eng
    await eng.dispose()


@pytest.fixture
async def session(engine) -> AsyncIterator[AsyncSession]:
    async with engine.connect() as conn:
        trans = await conn.begin()
        s = AsyncSession(bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint")
        try:
            yield s
        finally:
            await s.close()
            await trans.rollback()


@pytest.fixture
async def client(session) -> AsyncIterator[AsyncClient]:
    async def _override():
        yield session

    app.dependency_overrides[get_session] = _override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def _auth(session, username: str, role: str) -> dict:
    user = await users_service.create_user(session, username, "secret123", username, role)
    await session.commit()  # releases the test savepoint; the outer transaction is still rolled back
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


@pytest.fixture
async def admin_h(session):
    return await _auth(session, "t_admin", "admin")


@pytest.fixture
async def operator_h(session):
    return await _auth(session, "t_operator", "operator")


@pytest.fixture
async def viewer_h(session):
    return await _auth(session, "t_viewer", "viewer")


@pytest.fixture(autouse=True)
def telegram_calls(monkeypatch) -> list:
    """No test reaches the real Telegram API through the batch cost message (SPEC §17): its bot records calls."""
    from aiogram import Bot

    from app.bot import batch_notify, group_log
    from tests.test_group_log import RecordingSession

    calls: list = []

    def make_bot(allowed_chat_ids):
        recording = RecordingSession()
        recording.calls = calls
        bot = Bot("42:TEST", session=recording)
        bot.session.middleware(group_log.GroupSilence(allowed_chat_ids=allowed_chat_ids))
        return bot

    monkeypatch.setattr(batch_notify, "make_bot", make_bot)
    return calls
