"""Admin commands.

    python -m app.cli ensure-admin                 # first admin from ADMIN_USERNAME / ADMIN_PASSWORD
    python -m app.cli set-password <username>      # password from ADMIN_PASSWORD (.env), or asks for it
    python -m app.cli import-excel <file> [--commit]
    python -m app.cli set-webhook <https://api-host>    # bot in webhook mode (Vercel, SPEC §16)
    python -m app.cli delete-webhook                   # back to long polling
"""

import asyncio
import getpass
import sys

from sqlalchemy import select

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.importers import excel_purchases
from app.models import User
from app.services import users


async def ensure_admin() -> None:
    settings = get_settings()
    async with SessionLocal() as session:
        try:
            created = await users.ensure_admin(session, settings.admin_username, settings.admin_password)
        except ValueError as exc:
            raise SystemExit(str(exc)) from exc
        await session.commit()
    print("admin created" if created else "users already exist, nothing to do")


async def set_password(username: str) -> None:
    password = get_settings().admin_password if sys.stdin is None or not sys.stdin.isatty() else (
        getpass.getpass("Yangi parol (bo'sh = .env dagi ADMIN_PASSWORD): ") or get_settings().admin_password)
    minimum = users.MIN_PASSWORD_LENGTH if get_settings().is_production else 6
    if len(password) < minimum:
        raise SystemExit(f"Parol kamida {minimum} belgi bo'lishi kerak")
    async with SessionLocal() as session:
        user = (await session.execute(select(User).where(User.username == username))).scalar_one_or_none()
        if user is None:
            raise SystemExit(f"Foydalanuvchi topilmadi: {username}")
        user.password_hash = hash_password(password)
        user.is_active = True
        await session.commit()
    print(f"{username}: parol yangilandi")
    if len(password) < 8:
        print("DIQQAT: parol 8 belgidan qisqa — serverga chiqarishdan oldin uzunroq parol qo'ying")


async def import_excel(path: str, commit: bool) -> None:
    with open(path, "rb") as f:
        content = f.read()
    async with SessionLocal() as session:
        result = await excel_purchases.import_workbook(session, content, dry_run=not commit)
        if commit:
            await session.commit()
        else:
            await session.rollback()
    new = [b for b in result.batches if b.status == "new"]
    print(f"batches: {len(result.batches)} (new {len(new)}), units in new: {sum(b.qty for b in new)}")
    print(f"new products: {len(result.new_products)}")
    for w in result.warnings:
        print("WARN", w)
    print("committed" if commit else "dry run, nothing saved (use --commit)")


async def set_webhook(base_url: str) -> None:
    from aiogram import Bot

    from app.bot.main import dp

    settings = get_settings()
    if not settings.telegram_webhook_secret:
        raise SystemExit("TELEGRAM_WEBHOOK_SECRET .env da bo'lishi kerak")
    url = f"{base_url.rstrip('/')}/api/telegram/webhook"
    async with Bot(settings.telegram_bot_token) as bot:
        await bot.set_webhook(url, secret_token=settings.telegram_webhook_secret,
                              allowed_updates=dp.resolve_used_update_types())
        info = await bot.get_webhook_info()
    print(f"webhook: {info.url} (pending updates: {info.pending_update_count})")


async def delete_webhook() -> None:
    from aiogram import Bot

    async with Bot(get_settings().telegram_bot_token) as bot:
        await bot.delete_webhook()
    print("webhook deleted: run the polling bot (python -m app.bot.main)")


def main() -> None:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    if args[0] == "ensure-admin":
        asyncio.run(ensure_admin())
    elif args[0] == "set-password" and len(args) >= 2:
        asyncio.run(set_password(args[1]))
    elif args[0] == "import-excel" and len(args) >= 2:
        asyncio.run(import_excel(args[1], "--commit" in args))
    elif args[0] == "set-webhook" and len(args) >= 2:
        asyncio.run(set_webhook(args[1]))
    elif args[0] == "delete-webhook":
        asyncio.run(delete_webhook())
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
