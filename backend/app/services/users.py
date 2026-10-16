from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from app.core.security import burn_password_check, hash_password, verify_password
from app.core.telegram_auth import verify_init_data
from app.models import BotUser, User

MIN_PASSWORD_LENGTH = 12  # public deployment (SPEC §16); also the API schemas' minimum


async def authenticate(session: AsyncSession, username: str, password: str) -> User | None:
    user = (await session.execute(select(User).where(User.username == username))).scalar_one_or_none()
    if user is None:
        burn_password_check(password)
        return None
    if not user.is_active or not verify_password(password, user.password_hash):
        return None
    return user


async def authenticate_telegram(session: AsyncSession, init_data: str) -> User:
    """Panel user for a Telegram Mini App initData string (SPEC §13.3).

    Raises InitDataInvalid (→ 401) for a bad, stale or unverifiable signature, and Forbidden (→ 403) when no
    active user is linked. The Forbidden message names the Telegram ID so an admin can link it.
    """
    settings = get_settings()
    telegram_id = verify_init_data(init_data, settings.telegram_bot_token, settings.telegram_initdata_max_age)
    user = (await session.execute(select(User).where(User.telegram_id == telegram_id))).scalar_one_or_none()
    if user is None:
        raise Forbidden(f"Telegram ID {telegram_id} hech qaysi foydalanuvchiga ulanmagan. "
                        "Administratorga shu raqamni yuboring.")
    if not user.is_active:
        raise Forbidden(f"Telegram ID {telegram_id} ulangan foydalanuvchi faol emas")
    return user


async def list_users(session: AsyncSession) -> list[User]:
    return list((await session.execute(select(User).order_by(User.id))).scalars().all())


def _user_conflict(exc: IntegrityError, telegram_id: int | None) -> Conflict:
    """Users have two unique keys (login, Telegram ID); name the one that clashed."""
    if "uq_users_telegram_id" in str(exc.orig):
        return Conflict(f"Telegram ID {telegram_id} boshqa foydalanuvchiga ulangan")
    return Conflict("Bunday login mavjud")


async def create_user(session: AsyncSession, username: str, password: str, full_name: str, role: str,
                      telegram_id: int | None = None) -> User:
    user = User(username=username, password_hash=hash_password(password), full_name=full_name, role=role,
                telegram_id=telegram_id)
    try:
        # add() inside the block: begin_nested() flushes pending objects *before* its SAVEPOINT, so an object added
        # earlier would hit the unique key outside the savepoint and break the caller's whole transaction.
        async with session.begin_nested():
            session.add(user)
            await session.flush()
    except IntegrityError as exc:
        raise _user_conflict(exc, telegram_id) from exc
    return user


async def update_user(session: AsyncSession, user_id: int, changes: dict) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise NotFound("Foydalanuvchi topilmadi")
    demoted = changes.get("role") not in (None, "admin") or changes.get("is_active") is False
    if user.role == "admin" and user.is_active and demoted:
        admins = (await session.execute(select(func.count()).select_from(User).where(
            User.role == "admin", User.is_active.is_(True)))).scalar_one()
        if admins <= 1:
            raise Conflict("Oxirgi faol administratorni o'chirib yoki pasaytirib bo'lmaydi")
    password = changes.pop("password", None)
    password_hash = hash_password(password) if password else None
    try:
        async with session.begin_nested():  # changes made inside it, for the same reason as in create_user
            if password_hash:
                user.password_hash = password_hash
            for key, value in changes.items():
                if value is None and key != "telegram_id":
                    continue  # only the Telegram link can be cleared; null elsewhere means "unchanged"
                setattr(user, key, value)
            await session.flush()
    except IntegrityError as exc:
        raise _user_conflict(exc, changes.get("telegram_id")) from exc
    return user


async def update_own_account(session: AsyncSession, user: User, current_password: str, username: str | None,
                             password: str | None) -> User:
    """A signed-in user changes their own login and/or password after re-entering the current password."""
    if not verify_password(current_password, user.password_hash):
        raise ValidationFailed("Joriy parol noto'g'ri")
    username = username.strip() if username else None
    if not username and not password:
        raise ValidationFailed("Yangi login yoki yangi parolni kiriting")
    try:
        async with session.begin_nested():
            if username and username != user.username:
                user.username = username
            if password:
                user.password_hash = hash_password(password)
            await session.flush()
    except IntegrityError as exc:
        raise Conflict("Bunday login mavjud") from exc
    return user


async def ensure_admin(session: AsyncSession, username: str, password: str) -> bool:
    """Create the first admin if no users exist. Returns True if created."""
    if (await session.execute(select(User.id).limit(1))).first():
        return False
    if get_settings().is_production and len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"ADMIN_PASSWORD kamida {MIN_PASSWORD_LENGTH} belgi bo'lishi kerak")
    await create_user(session, username, password, "Administrator", "admin")
    return True


# ---- bot users ----
async def list_bot_users(session: AsyncSession) -> list[BotUser]:
    return list((await session.execute(select(BotUser).order_by(BotUser.id))).scalars().all())


async def create_bot_user(session: AsyncSession, telegram_id: int, full_name: str) -> BotUser:
    bot_user = BotUser(telegram_id=telegram_id, full_name=full_name)
    session.add(bot_user)
    try:
        async with session.begin_nested():
            await session.flush()
    except IntegrityError as exc:
        raise Conflict("Bu Telegram ID allaqachon qo'shilgan") from exc
    return bot_user


async def update_bot_user(session: AsyncSession, bot_user_id: int, changes: dict) -> BotUser:
    bot_user = await session.get(BotUser, bot_user_id)
    if bot_user is None:
        raise NotFound("Bot foydalanuvchisi topilmadi")
    for key, value in changes.items():
        if value is not None:
            setattr(bot_user, key, value)
    await session.flush()
    return bot_user


async def delete_bot_user(session: AsyncSession, bot_user_id: int) -> None:
    bot_user = await session.get(BotUser, bot_user_id)
    if bot_user is None:
        raise NotFound("Bot foydalanuvchisi topilmadi")
    await session.delete(bot_user)
    await session.flush()


async def is_bot_user_allowed(session: AsyncSession, telegram_id: int) -> bool:
    stmt = select(BotUser.id).where(BotUser.telegram_id == telegram_id, BotUser.is_active.is_(True))
    return (await session.execute(stmt)).first() is not None
