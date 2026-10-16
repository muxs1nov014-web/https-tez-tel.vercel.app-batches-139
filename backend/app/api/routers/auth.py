from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Unauthorized, admin, current_user, viewer
from app.core.db import get_session
from app.core.security import create_access_token
from app.core.telegram_auth import InitDataInvalid
from app.models import User
from app.schemas import (
    BotUserIn,
    BotUserOut,
    BotUserPatch,
    LoginIn,
    MePatch,
    SettingsIn,
    SettingsOut,
    TelegramLoginIn,
    TokenOut,
    UserIn,
    UserOut,
    UserPatch,
)
from app.services import login_guard
from app.services import settings as settings_service
from app.services import users as users_service

router = APIRouter()


def client_ip(request: Request) -> str:
    """The caller's IP. Vercel and Caddy both overwrite X-Forwarded-For with the real client address."""
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return forwarded or request.headers.get("x-real-ip", "") or (request.client.host if request.client else "unknown")


@router.post("/auth/login", response_model=TokenOut)
async def login(data: LoginIn, request: Request, session: AsyncSession = Depends(get_session)):
    ip = client_ip(request)
    await login_guard.ensure_allowed(session, data.username, ip)
    user = await users_service.authenticate(session, data.username, data.password)
    if user is None:
        await login_guard.record_failure(session, data.username, ip)
        await session.commit()
        raise Unauthorized("Login yoki parol noto'g'ri")
    await login_guard.clear(session, data.username, ip)
    await session.commit()
    return TokenOut(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.post("/auth/telegram", response_model=TokenOut)
async def telegram_login(data: TelegramLoginIn, session: AsyncSession = Depends(get_session)):
    """Public: the signed initData is the credential (SPEC §13.3). Never log it or the issued token."""
    try:
        user = await users_service.authenticate_telegram(session, data.init_data)
    except InitDataInvalid as exc:
        raise Unauthorized(str(exc)) from exc
    return TokenOut(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.get("/auth/me", response_model=UserOut)
async def me(user: User = Depends(current_user)):
    return user


@router.patch("/auth/me", response_model=UserOut)
async def update_me(data: MePatch, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    """Any signed-in user: own login and/or password; the current password is required."""
    updated = await users_service.update_own_account(session, user, data.current_password, data.username,
                                                     data.password)
    await session.commit()
    return updated


@router.get("/users", response_model=list[UserOut], dependencies=[Depends(admin)])
async def list_users(session: AsyncSession = Depends(get_session)):
    return await users_service.list_users(session)


@router.post("/users", response_model=UserOut, status_code=201, dependencies=[Depends(admin)])
async def create_user(data: UserIn, session: AsyncSession = Depends(get_session)):
    user = await users_service.create_user(session, data.username, data.password, data.full_name, data.role,
                                           data.telegram_id)
    await session.commit()
    return user


@router.patch("/users/{user_id}", response_model=UserOut, dependencies=[Depends(admin)])
async def update_user(user_id: int, data: UserPatch, session: AsyncSession = Depends(get_session)):
    user = await users_service.update_user(session, user_id, data.model_dump(exclude_unset=True))
    await session.commit()
    return user


@router.get("/bot-users", response_model=list[BotUserOut], dependencies=[Depends(admin)])
async def list_bot_users(session: AsyncSession = Depends(get_session)):
    return await users_service.list_bot_users(session)


@router.post("/bot-users", response_model=BotUserOut, status_code=201, dependencies=[Depends(admin)])
async def create_bot_user(data: BotUserIn, session: AsyncSession = Depends(get_session)):
    bot_user = await users_service.create_bot_user(session, data.telegram_id, data.full_name)
    await session.commit()
    return bot_user


@router.patch("/bot-users/{bot_user_id}", response_model=BotUserOut, dependencies=[Depends(admin)])
async def update_bot_user(bot_user_id: int, data: BotUserPatch, session: AsyncSession = Depends(get_session)):
    bot_user = await users_service.update_bot_user(session, bot_user_id, data.model_dump(exclude_unset=True))
    await session.commit()
    return bot_user


@router.delete("/bot-users/{bot_user_id}", status_code=204, dependencies=[Depends(admin)])
async def delete_bot_user(bot_user_id: int, session: AsyncSession = Depends(get_session)):
    await users_service.delete_bot_user(session, bot_user_id)
    await session.commit()


@router.get("/settings", response_model=SettingsOut, dependencies=[Depends(viewer)])
async def get_settings(session: AsyncSession = Depends(get_session)):
    return SettingsOut(**await settings_service.get_all(session))


@router.put("/settings", response_model=SettingsOut, dependencies=[Depends(admin)])
async def put_settings(data: SettingsIn, session: AsyncSession = Depends(get_session)):
    values = await settings_service.update(session, data.model_dump(exclude_none=True))
    await session.commit()
    return SettingsOut(**values)
