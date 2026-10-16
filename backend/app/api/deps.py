from collections.abc import Callable

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.errors import AppError, Forbidden
from app.core.security import decode_access_token
from app.models import User

bearer = HTTPBearer(auto_error=False)
ROLE_RANK = {"viewer": 0, "operator": 1, "admin": 2}


class Unauthorized(AppError):
    status_code = 401


async def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: AsyncSession = Depends(get_session),
) -> User:
    if credentials is None:
        raise Unauthorized("Avtorizatsiya talab qilinadi")
    user_id = decode_access_token(credentials.credentials)
    user = await session.get(User, user_id) if user_id else None
    if user is None or not user.is_active:
        raise Unauthorized("Token yaroqsiz")
    return user


def require_role(role: str) -> Callable:
    async def checker(user: User = Depends(current_user)) -> User:
        if ROLE_RANK[user.role] < ROLE_RANK[role]:
            raise Forbidden("Ruxsat yo'q")
        return user

    return checker


viewer = require_role("viewer")
operator = require_role("operator")
admin = require_role("admin")
