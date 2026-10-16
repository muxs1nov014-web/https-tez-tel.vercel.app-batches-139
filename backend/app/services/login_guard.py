"""Login throttle (SPEC §16.1): too many recent failures from one IP, or for one username from one IP, get a 429.

Counted in the database, because Vercel runs many short-lived instances that share no memory.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import TooManyRequests
from app.models import LoginFailure

WINDOW = timedelta(minutes=15)
MAX_PER_USERNAME_AND_IP = 5
MAX_PER_IP = 20
KEEP = timedelta(days=1)


async def ensure_allowed(session: AsyncSession, username: str, ip: str) -> None:
    since = datetime.now(UTC) - WINDOW
    per_ip, per_pair = (await session.execute(
        select(func.count(), func.count().filter(LoginFailure.username == username[:64]))
        .where(LoginFailure.ip == ip[:64], LoginFailure.failed_at >= since))).one()
    if per_pair >= MAX_PER_USERNAME_AND_IP or per_ip >= MAX_PER_IP:
        raise TooManyRequests("Juda ko'p noto'g'ri urinish. 15 daqiqadan keyin qayta urinib ko'ring.")


async def record_failure(session: AsyncSession, username: str, ip: str) -> None:
    session.add(LoginFailure(username=username[:64], ip=ip[:64]))
    await session.execute(delete(LoginFailure).where(LoginFailure.failed_at < datetime.now(UTC) - KEEP))


async def clear(session: AsyncSession, username: str, ip: str) -> None:
    await session.execute(delete(LoginFailure).where(LoginFailure.username == username[:64],
                                                     LoginFailure.ip == ip[:64]))
