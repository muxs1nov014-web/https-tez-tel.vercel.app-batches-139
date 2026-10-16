"""Go-live hardening (SPEC §16.1): login throttle, password rules, production guard, forged bot updates."""

import pytest
from aiogram import Bot
from aiogram.types import Chat, Message, Update, User

from app.bot import main as bot_main
from app.core.config import Settings
from app.core.security import hash_password, verify_password
from app.services import users
from tests.test_group_log import SENT, RecordingSession


def _login(client, password, ip="203.0.113.7", username="boss"):
    return client.post("/api/auth/login", json={"username": username, "password": password},
                       headers={"X-Forwarded-For": f"{ip}, 10.0.0.1"})


async def test_login_is_throttled_per_username_and_ip(client, session):
    await users.create_user(session, "boss", "right-password-1", "Boss", "admin")
    for _ in range(5):
        assert (await _login(client, "wrong")).status_code == 401
    assert (await _login(client, "right-password-1")).status_code == 429  # even the right password waits
    assert (await _login(client, "right-password-1", ip="198.51.100.9")).status_code == 200  # another IP


async def test_success_clears_failures(client, session):
    await users.create_user(session, "boss", "right-password-1", "Boss", "admin")
    for _ in range(4):
        await _login(client, "wrong")
    assert (await _login(client, "right-password-1")).status_code == 200
    for _ in range(4):
        assert (await _login(client, "wrong")).status_code == 401


async def test_one_ip_cannot_spray_many_usernames(client):
    for i in range(20):
        assert (await _login(client, "wrong", username=f"user{i}")).status_code == 401
    assert (await _login(client, "wrong", username="someone-else")).status_code == 429


async def test_unknown_user_and_overlong_password_answer_401(client, session):
    await users.create_user(session, "boss", "right-password-1", "Boss", "admin")
    assert (await _login(client, "x", username="nobody")).status_code == 401
    assert (await _login(client, "й" * 50)).status_code == 401  # 100 bytes: bcrypt would raise
    assert verify_password("a" * 73, hash_password("a" * 72)) is False


async def test_new_passwords_need_12_characters(client, admin_h):
    short = await client.post("/api/users", json={"username": "kassir", "password": "short-pass"}, headers=admin_h)
    assert short.status_code == 422
    ok = await client.post("/api/users", json={"username": "kassir", "password": "long-enough-1"}, headers=admin_h)
    assert ok.status_code == 201


def test_production_guard_also_runs_on_vercel():
    with pytest.raises(RuntimeError):
        Settings(_env_file=None, app_env="dev", vercel=True).check_production()
    with pytest.raises(RuntimeError):
        Settings(_env_file=None, app_env="production", jwt_secret="x" * 40,
                 telegram_webhook_secret="short").check_production()
    Settings(_env_file=None, app_env="production", jwt_secret="x" * 40,
             telegram_webhook_secret="y" * 40).check_production()


async def test_forged_private_update_for_another_chat_is_ignored():
    bot = Bot("42:TEST", session=RecordingSession())
    staff = User(id=874784622, is_bot=False, first_name="Raxbar")
    forged = Message(message_id=1, date=SENT, chat=Chat(id=999000111, type="private"), from_user=staff,
                     text="/start")
    await bot_main.dp.feed_update(bot, Update(update_id=1, message=forged))
    assert bot.session.calls == []
