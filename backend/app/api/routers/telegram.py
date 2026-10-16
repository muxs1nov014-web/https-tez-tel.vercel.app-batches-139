"""Telegram webhook endpoint (SPEC §16). Not a user endpoint: Telegram authenticates with the shared secret it
sends in X-Telegram-Bot-Api-Secret-Token (set by `python -m app.cli set-webhook`).

Also the batch cost message settings (SPEC §17, admin only)."""

import hmac
import logging

from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Unauthorized, admin, operator
from app.core.config import get_settings
from app.core.db import get_session
from app.core.errors import NotFound
from app.schemas import NotifyConfigIn, NotifyConfigOut, RecipientOut, TelegramGroupOut
from app.services import telegram_notify

log = logging.getLogger(__name__)
router = APIRouter()


@router.post("/telegram/webhook", include_in_schema=False)
async def telegram_webhook(request: Request,
                           x_telegram_bot_api_secret_token: str | None = Header(default=None)) -> dict:
    secret = get_settings().telegram_webhook_secret
    if not secret:
        raise NotFound("Webhook o'chirilgan")
    if not hmac.compare_digest((x_telegram_bot_api_secret_token or "").encode(), secret.encode()):
        raise Unauthorized("Webhook secret noto'g'ri")
    from app.bot import webhook  # aiogram and Gemini load only when the bot is actually in webhook mode

    try:
        await webhook.handle_update(await request.json())
    except Exception:  # Telegram retries non-2xx answers, so a failing update would come back again and again
        log.exception("telegram update failed")
    return {"ok": True}


async def _config_out(session: AsyncSession, config: telegram_notify.NotifyConfig) -> NotifyConfigOut:
    return NotifyConfigOut(
        chat_ids=config.chat_ids, bot_configured=bool(get_settings().telegram_bot_token),
        groups=[TelegramGroupOut(chat_id=c, title=t) for c, t in await telegram_notify.known_groups(session)])


@router.get("/telegram/notify", response_model=NotifyConfigOut, dependencies=[Depends(admin)])
async def get_notify_config(session: AsyncSession = Depends(get_session)):
    return await _config_out(session, await telegram_notify.get_config(session))


@router.put("/telegram/notify", response_model=NotifyConfigOut, dependencies=[Depends(admin)])
async def put_notify_config(data: NotifyConfigIn, session: AsyncSession = Depends(get_session)):
    config = await telegram_notify.set_config(session, data.chat_ids)
    await session.commit()
    return await _config_out(session, config)


@router.get("/telegram/recipients", response_model=list[RecipientOut], dependencies=[Depends(operator)])
async def list_recipients(session: AsyncSession = Depends(get_session)):
    """Chats a batch cost send may pick (operator+, the same role that sends)."""
    return [RecipientOut(chat_id=r.chat_id, name=r.name, kind=r.kind, blocked=r.blocked)
            for r in await telegram_notify.available_recipients(session)]
