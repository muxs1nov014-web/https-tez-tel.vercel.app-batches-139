from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import operator, viewer
from app.core.db import get_session
from app.core.errors import ValidationFailed
from app.schemas import ClientRow, DashboardOut, ImportResultOut, ProfitRow, UnitCostRow, VarianceRow
from app.importers import excel_purchases
from app.services import reports

router = APIRouter()


@router.get("/reports/dashboard", response_model=DashboardOut, dependencies=[Depends(viewer)])
async def dashboard(session: AsyncSession = Depends(get_session)):
    return await reports.dashboard(session)


@router.get("/reports/profit", response_model=list[ProfitRow], dependencies=[Depends(viewer)])
async def profit(date_from: date | None = None, date_to: date | None = None,
                 group_by: Literal["product", "customer", "day", "month"] = "product",
                 session: AsyncSession = Depends(get_session)):
    return await reports.profit(session, date_from, date_to, group_by)


@router.get("/reports/batch-variance", response_model=list[VarianceRow], dependencies=[Depends(viewer)])
async def batch_variance(date_from: date | None = None, date_to: date | None = None,
                         session: AsyncSession = Depends(get_session)):
    return await reports.batch_variance(session, date_from, date_to)


@router.get("/reports/unit-cost", response_model=list[UnitCostRow], dependencies=[Depends(viewer)])
async def unit_cost(product_id: int, session: AsyncSession = Depends(get_session)):
    return await reports.unit_cost_history(session, product_id)


@router.get("/reports/clients", response_model=list[ClientRow], dependencies=[Depends(viewer)])
async def clients(date_from: date | None = None, date_to: date | None = None, customer_id: int | None = None,
                  session: AsyncSession = Depends(get_session)):
    return await reports.clients(session, date_from, date_to, customer_id)


@router.post("/imports/purchases", response_model=ImportResultOut, dependencies=[Depends(operator)])
async def import_purchases(file: UploadFile = File(...), dry_run: bool = Query(True),
                           session: AsyncSession = Depends(get_session)):
    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise ValidationFailed("Fayl juda katta (20 MB dan oshmasin)")
    result = await excel_purchases.import_workbook(session, content, dry_run=dry_run)
    if dry_run:
        await session.rollback()
    else:
        await session.commit()
    return result
