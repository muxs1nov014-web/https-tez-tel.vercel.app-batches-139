"""Customer warehouses, debts and payments (SPEC §12.4). Read = viewer, write = operator, delete = admin."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import admin, operator, viewer
from app.core.db import get_session
from app.models import User
from app.schemas import (
    ConsignmentSaleIn,
    CustomerBalance,
    CustomerOverview,
    CustomerStockRowOut,
    LedgerRow,
    MoveIn,
    MoveOut,
    PaymentIn,
    PaymentOut,
    SaleDetail,
    SaleSummary,
)
from app.services import consignment
from app.services import customer_accounts as accounts
from app.services import sales as sales_service

router = APIRouter(prefix="/customers")


@router.get("/summary", response_model=list[CustomerBalance], dependencies=[Depends(viewer)])
async def summary(session: AsyncSession = Depends(get_session)):
    return await accounts.summary(session)


@router.get("/{customer_id}/overview", response_model=CustomerOverview, dependencies=[Depends(viewer)])
async def overview(customer_id: int, session: AsyncSession = Depends(get_session)):
    return await accounts.overview(session, customer_id)


@router.get("/{customer_id}/stock", response_model=list[CustomerStockRowOut], dependencies=[Depends(viewer)])
async def stock(customer_id: int, session: AsyncSession = Depends(get_session)):
    return await consignment.customer_stock_rows(session, customer_id)


@router.get("/{customer_id}/moves", response_model=list[MoveOut], dependencies=[Depends(viewer)])
async def list_moves(customer_id: int, session: AsyncSession = Depends(get_session)):
    return await consignment.list_moves(session, customer_id)


@router.post("/{customer_id}/moves", response_model=MoveOut, status_code=201)
async def create_move(customer_id: int, data: MoveIn, user: User = Depends(operator),
                      session: AsyncSession = Depends(get_session)):
    move = await consignment.create_move(session, customer_id, data, user.id)
    await session.commit()
    return await consignment.get_move(session, customer_id, move.id)


@router.delete("/{customer_id}/moves/{move_id}", status_code=204, dependencies=[Depends(admin)])
async def delete_move(customer_id: int, move_id: int, session: AsyncSession = Depends(get_session)):
    await consignment.delete_move(session, customer_id, move_id)
    await session.commit()


@router.post("/{customer_id}/consignment-sales", response_model=SaleDetail, status_code=201)
async def create_consignment_sale(customer_id: int, data: ConsignmentSaleIn, user: User = Depends(operator),
                                  session: AsyncSession = Depends(get_session)):
    sale = await consignment.create_consignment_sale(session, customer_id, data, user.id)
    await session.commit()
    return await sales_service.get_detail(session, sale.id)


@router.get("/{customer_id}/sales", response_model=list[SaleSummary], dependencies=[Depends(viewer)])
async def list_sales(customer_id: int, session: AsyncSession = Depends(get_session)):
    return await accounts.list_customer_sales(session, customer_id)


@router.get("/{customer_id}/payments", response_model=list[PaymentOut], dependencies=[Depends(viewer)])
async def list_payments(customer_id: int, session: AsyncSession = Depends(get_session)):
    return await accounts.list_payments(session, customer_id)


@router.post("/{customer_id}/payments", response_model=PaymentOut, status_code=201)
async def create_payment(customer_id: int, data: PaymentIn, user: User = Depends(operator),
                         session: AsyncSession = Depends(get_session)):
    payment = await accounts.create_payment(session, customer_id, data, user.id)
    await session.commit()
    return payment


@router.delete("/{customer_id}/payments/{payment_id}", status_code=204, dependencies=[Depends(admin)])
async def delete_payment(customer_id: int, payment_id: int, session: AsyncSession = Depends(get_session)):
    await accounts.delete_payment(session, customer_id, payment_id)
    await session.commit()


@router.get("/{customer_id}/ledger", response_model=list[LedgerRow], dependencies=[Depends(viewer)])
async def ledger(customer_id: int, session: AsyncSession = Depends(get_session)):
    return await accounts.ledger(session, customer_id)
