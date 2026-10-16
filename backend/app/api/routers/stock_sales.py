from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import admin, operator, viewer
from app.core.db import get_session
from app.models import User
from app.schemas import (
    AdjustmentIn,
    IdOut,
    OpeningBalanceIn,
    OpeningResultOut,
    SaleDetail,
    SaleIn,
    SaleSummary,
    StockRowOut,
)
from app.services import sales as sales_service
from app.services import stock as stock_service

router = APIRouter()


@router.get("/stock", response_model=list[StockRowOut], dependencies=[Depends(viewer)])
async def stock(q: str | None = None, session: AsyncSession = Depends(get_session)):
    return await stock_service.stock_rows(session, q)


@router.post("/stock/opening-balance", response_model=list[OpeningResultOut], dependencies=[Depends(operator)])
async def opening_balance(data: OpeningBalanceIn, session: AsyncSession = Depends(get_session)):
    result = await stock_service.set_opening_balance(session, data.as_of_date,
                                                     [(i.product_id, i.qty) for i in data.items])
    await session.commit()
    return result


@router.post("/stock/adjustments", response_model=IdOut, status_code=201, dependencies=[Depends(operator)])
async def adjustment(data: AdjustmentIn, session: AsyncSession = Depends(get_session)):
    adj = await stock_service.add_adjustment(session, data.purchase_line_id, data.qty, data.reason, data.note)
    await session.commit()
    return IdOut(id=adj.id)


@router.get("/sales", response_model=list[SaleSummary], dependencies=[Depends(viewer)])
async def list_sales(date_from: date | None = None, date_to: date | None = None, customer_id: int | None = None,
                     limit: int = 500, session: AsyncSession = Depends(get_session)):
    return await sales_service.list_sales(session, date_from, date_to, customer_id, limit)


@router.post("/sales", response_model=SaleDetail, status_code=201)
async def create_sale(data: SaleIn, user: User = Depends(operator), session: AsyncSession = Depends(get_session)):
    sale = await sales_service.create_sale(session, data, user.id)
    await session.commit()
    return await sales_service.get_detail(session, sale.id)


@router.get("/sales/{sale_id}", response_model=SaleDetail, dependencies=[Depends(viewer)])
async def get_sale(sale_id: int, session: AsyncSession = Depends(get_session)):
    return await sales_service.get_detail(session, sale_id)


@router.delete("/sales/{sale_id}", status_code=204, dependencies=[Depends(admin)])
async def delete_sale(sale_id: int, session: AsyncSession = Depends(get_session)):
    await sales_service.delete_sale(session, sale_id)
    await session.commit()
