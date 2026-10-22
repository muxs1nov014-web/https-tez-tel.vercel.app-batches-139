from datetime import date

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import admin, operator, viewer
from app.core.config import get_settings
from app.core.db import get_session
from app.core.errors import ValidationFailed
from app.models import User
from app.schemas import (BatchDetail, BatchIn, BatchPatch, BatchSummary, ExpenseIn, LineIn, LinePatch, NotifyIn,
                         NotifyResult)
from app.services import batches as service
from app.services import telegram_notify

router = APIRouter(prefix="/batches")
PHOTO_MAX_BYTES = 5 * 1024 * 1024
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


@router.get("", response_model=list[BatchSummary], dependencies=[Depends(viewer)])
async def list_batches(date_from: date | None = None, date_to: date | None = None,
                       session: AsyncSession = Depends(get_session)):
    return await service.list_batches(session, date_from, date_to)


@router.post("", response_model=BatchDetail, status_code=201)
async def create_batch(data: BatchIn, user: User = Depends(operator), session: AsyncSession = Depends(get_session)):
    batch = await service.create_batch(session, data.batch_date, data.code, data.note, data.lines, data.expenses,
                                       user.id)
    await session.commit()
    return await service.get_detail(session, batch.id)


@router.get("/{batch_id}", response_model=BatchDetail, dependencies=[Depends(viewer)])
async def get_batch(batch_id: int, session: AsyncSession = Depends(get_session)):
    return await service.get_detail(session, batch_id)


@router.post("/{batch_id}/notify", response_model=NotifyResult, dependencies=[Depends(operator)])
async def notify_batch(batch_id: int, data: NotifyIn, session: AsyncSession = Depends(get_session)):
    """SPEC §17: the per-model unit cost to the chats picked on the batch page (from GET /telegram/recipients)."""
    return await _notify(session, batch_id, data.chat_ids)


@router.post("/{batch_id}/notify-photo", response_model=NotifyResult, dependencies=[Depends(operator)])
async def notify_batch_photo(batch_id: int, photo: UploadFile = File(...), chat_ids: list[str] = Form(...),
                             session: AsyncSession = Depends(get_session)):
    """SPEC §17: the same, as the panel's PNG picture of the "Model bo'yicha tannarx" card with a short caption."""
    content = await photo.read()
    if len(content) > PHOTO_MAX_BYTES:
        raise ValidationFailed("Rasm juda katta (5 MB dan oshmasin)")
    if not content.startswith(PNG_SIGNATURE):
        raise ValidationFailed("Rasm PNG formatida emas")
    if len(chat_ids) > 200:
        raise ValidationFailed("Qabul qiluvchilar juda ko'p")
    return await _notify(session, batch_id, chat_ids, content)


async def _notify(session: AsyncSession, batch_id: int, chat_ids: list[str], photo: bytes | None = None) -> NotifyResult:
    detail = await service.get_detail(session, batch_id)
    if not get_settings().telegram_bot_token:
        raise ValidationFailed("Telegram bot sozlanmagan (TELEGRAM_BOT_TOKEN yo'q)")
    if not detail.lines:
        raise ValidationFailed("Partiyada qator yo'q")
    targets, skipped = await telegram_notify.pick_recipients(session, chat_ids)
    if not targets:
        return NotifyResult(recipients=0, sent=0, failed=0, skipped=skipped)
    from app.bot import batch_notify  # aiogram loads only when a message is actually sent

    result = await batch_notify.send(detail, targets, photo)
    await telegram_notify.mark_unreachable(session, result.unreachable)
    await session.commit()
    return NotifyResult(recipients=result.recipients, sent=result.sent, failed=result.failed,
                        blocked=len(result.unreachable), skipped=skipped)


@router.patch("/{batch_id}", response_model=BatchDetail, dependencies=[Depends(operator)])
async def update_batch(batch_id: int, data: BatchPatch, session: AsyncSession = Depends(get_session)):
    await service.update_batch(session, batch_id, data.model_dump(exclude_unset=True))
    await session.commit()
    return await service.get_detail(session, batch_id)


@router.delete("/{batch_id}", status_code=204, dependencies=[Depends(admin)])
async def delete_batch(batch_id: int, session: AsyncSession = Depends(get_session)):
    await service.delete_batch(session, batch_id)
    await session.commit()


@router.post("/{batch_id}/lines", response_model=BatchDetail, status_code=201, dependencies=[Depends(operator)])
async def add_line(batch_id: int, data: LineIn, session: AsyncSession = Depends(get_session)):
    await service.add_line(session, batch_id, data)
    await session.commit()
    return await service.get_detail(session, batch_id)


@router.patch("/{batch_id}/lines/{line_id}", response_model=BatchDetail, dependencies=[Depends(operator)])
async def update_line(batch_id: int, line_id: int, data: LinePatch, session: AsyncSession = Depends(get_session)):
    await service.update_line(session, batch_id, line_id, data.model_dump(exclude_unset=True))
    await session.commit()
    return await service.get_detail(session, batch_id)


@router.delete("/{batch_id}/lines/{line_id}", response_model=BatchDetail, dependencies=[Depends(operator)])
async def delete_line(batch_id: int, line_id: int, session: AsyncSession = Depends(get_session)):
    await service.delete_line(session, batch_id, line_id)
    await session.commit()
    return await service.get_detail(session, batch_id)


@router.post("/{batch_id}/expenses", response_model=BatchDetail, status_code=201)
async def add_expense(batch_id: int, data: ExpenseIn, user: User = Depends(operator),
                      session: AsyncSession = Depends(get_session)):
    await service.add_expense(session, batch_id, data, user.id)
    await session.commit()
    return await service.get_detail(session, batch_id)


@router.delete("/{batch_id}/expenses/{expense_id}", response_model=BatchDetail, dependencies=[Depends(operator)])
async def delete_expense(batch_id: int, expense_id: int, session: AsyncSession = Depends(get_session)):
    await service.delete_expense(session, batch_id, expense_id)
    await session.commit()
    return await service.get_detail(session, batch_id)
