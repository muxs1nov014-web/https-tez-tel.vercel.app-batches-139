"""Daily nasiya control (SPEC §18). Read = viewer; review (link, confirm, reject, upload, rescan) = operator;
confirming despite errors and deleting = admin."""

from datetime import date

from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ROLE_RANK, admin, operator, viewer
from app.core.config import get_settings
from app.core.db import get_session
from app.core.errors import Forbidden, ValidationFailed
from app.importers.nasiya_workbook import MAX_BYTES
from app.models import User
from app.schemas import (
    NasiyaConfirmIn,
    NasiyaCustomerDetail,
    NasiyaImeiTrailRow,
    NasiyaOverviewOut,
    NasiyaRejectIn,
    NasiyaReportDetail,
    NasiyaReportSummary,
    NasiyaRescanOut,
    NasiyaSeriesPoint,
    NasiyaSheetLinkIn,
    NasiyaStatus,
    NasiyaUploadOut,
)
from app.services import nasiya_monitor, nasiya_reports, nasiya_telegram

router = APIRouter(prefix="/nasiya")


# ---- monitoring ----
@router.get("/overview", response_model=NasiyaOverviewOut, dependencies=[Depends(viewer)])
async def overview(on: date | None = None, session: AsyncSession = Depends(get_session)):
    return await nasiya_monitor.overview(session, on)


@router.get("/series", response_model=list[NasiyaSeriesPoint], dependencies=[Depends(viewer)])
async def series(days: int = Query(90, ge=1, le=730), customer_id: int | None = None,
                 session: AsyncSession = Depends(get_session)):
    return await nasiya_monitor.series(session, days, customer_id)


@router.get("/customers/{customer_id}", response_model=NasiyaCustomerDetail, dependencies=[Depends(viewer)])
async def customer(customer_id: int, on: date | None = None, session: AsyncSession = Depends(get_session)):
    return await nasiya_monitor.customer_detail(session, customer_id, on)


@router.get("/imei/{imei}", response_model=list[NasiyaImeiTrailRow], dependencies=[Depends(viewer)])
async def imei_trail(imei: str, session: AsyncSession = Depends(get_session)):
    return await nasiya_monitor.imei_trail(session, imei)


# ---- reports (review queue) ----
@router.get("/reports", response_model=list[NasiyaReportSummary], dependencies=[Depends(viewer)])
async def list_reports(status: NasiyaStatus | None = None, limit: int = Query(60, ge=1, le=500),
                       session: AsyncSession = Depends(get_session)):
    return await nasiya_reports.list_reports(session, status, limit)


@router.get("/reports/{report_id}", response_model=NasiyaReportDetail, dependencies=[Depends(viewer)])
async def get_report(report_id: int, session: AsyncSession = Depends(get_session)):
    return await nasiya_reports.detail(session, report_id)


@router.post("/reports/upload", response_model=NasiyaUploadOut, status_code=201)
async def upload(file: UploadFile = File(...), user: User = Depends(operator),
                 session: AsyncSession = Depends(get_session)):
    content = await file.read()
    if len(content) > MAX_BYTES:
        raise ValidationFailed("Fayl juda katta (20 MB dan oshmasin)")
    try:
        report, created = await nasiya_reports.ingest(session, content, file_name=file.filename or "",
                                                      source="upload", sent_by=user.full_name or user.username)
    except ValidationFailed as exc:
        return NasiyaUploadOut(file_name=file.filename or "", report_id=None, report_date=None, duplicate=False,
                               error=exc.detail)
    await session.commit()
    return NasiyaUploadOut(file_name=file.filename or "", report_id=report.id, report_date=report.report_date,
                           duplicate=not created, error=None)


@router.post("/reports/rescan", response_model=NasiyaRescanOut, dependencies=[Depends(operator)])
async def rescan(session: AsyncSession = Depends(get_session)):
    if not get_settings().telegram_bot_token:
        raise ValidationFailed("Bot sozlanmagan (TELEGRAM_BOT_TOKEN yo'q)")
    from app.bot import webhook  # aiogram loads only when needed

    bot = webhook.make_bot()
    try:
        async def download(file_id: str) -> bytes:
            return (await bot.download(file_id)).getvalue()

        result = await nasiya_telegram.rescan(session, download)
    finally:
        await bot.session.close()
    await session.commit()
    return result


@router.put("/reports/{report_id}/sheets/{sheet_id}", response_model=NasiyaReportDetail)
async def link_sheet(report_id: int, sheet_id: int, data: NasiyaSheetLinkIn, user: User = Depends(operator),
                     session: AsyncSession = Depends(get_session)):
    await nasiya_reports.link_sheet(session, report_id, sheet_id, data.customer_id, user.id)
    await session.commit()
    return await nasiya_reports.detail(session, report_id)


@router.post("/reports/{report_id}/confirm", response_model=NasiyaReportDetail)
async def confirm(report_id: int, data: NasiyaConfirmIn, user: User = Depends(operator),
                  session: AsyncSession = Depends(get_session)):
    if data.force and ROLE_RANK[user.role] < ROLE_RANK["admin"]:
        raise Forbidden("Xatolar bilan tasdiqlash faqat administratorga ruxsat")
    await nasiya_reports.confirm(session, report_id, user.id, force=data.force, note=data.note)
    await session.commit()
    return await nasiya_reports.detail(session, report_id)


@router.post("/reports/{report_id}/reject", response_model=NasiyaReportDetail)
async def reject(report_id: int, data: NasiyaRejectIn, user: User = Depends(operator),
                 session: AsyncSession = Depends(get_session)):
    await nasiya_reports.reject(session, report_id, user.id, data.note)
    await session.commit()
    return await nasiya_reports.detail(session, report_id)


@router.delete("/reports/{report_id}", status_code=204, dependencies=[Depends(admin)])
async def delete_report(report_id: int, session: AsyncSession = Depends(get_session)):
    await nasiya_reports.delete(session, report_id)
    await session.commit()
