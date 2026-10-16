from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import admin, operator, viewer
from app.core.db import get_session
from app.schemas import (
    CategoryOut,
    ChannelIn,
    ChannelOut,
    ChannelPatch,
    CustomerIn,
    CustomerOut,
    CustomerPatch,
    EstimateOut,
    ProductIn,
    ProductOut,
    ProductPatch,
    TariffIn,
    TariffOut,
    TariffPatch,
)
from app.services import batches as batches_service
from app.services import catalog
from app.services.reports import today

router = APIRouter()


@router.get("/meta/categories", response_model=list[CategoryOut], dependencies=[Depends(viewer)])
async def categories():
    return batches_service.category_list()


@router.get("/products", response_model=list[ProductOut], dependencies=[Depends(viewer)])
async def list_products(q: str | None = None, active: bool | None = None,
                        session: AsyncSession = Depends(get_session)):
    return await catalog.list_products(session, q, active)


@router.post("/products", response_model=ProductOut, status_code=201, dependencies=[Depends(operator)])
async def create_product(data: ProductIn, session: AsyncSession = Depends(get_session)):
    product = await catalog.create_product(session, data.brand, data.model, data.storage, data.color, data.variant)
    await session.commit()
    return product


@router.patch("/products/{product_id}", response_model=ProductOut, dependencies=[Depends(operator)])
async def update_product(product_id: int, data: ProductPatch, session: AsyncSession = Depends(get_session)):
    product = await catalog.update_product(session, product_id, data.model_dump(exclude_unset=True))
    await session.commit()
    return product


@router.get("/channels", response_model=list[ChannelOut], dependencies=[Depends(viewer)])
async def list_channels(session: AsyncSession = Depends(get_session)):
    return await catalog.list_channels(session)


@router.post("/channels", response_model=ChannelOut, status_code=201, dependencies=[Depends(admin)])
async def create_channel(data: ChannelIn, session: AsyncSession = Depends(get_session)):
    channel = await catalog.create_channel(session, data.code, data.name, data.customs_factor)
    await session.commit()
    return channel


@router.patch("/channels/{channel_id}", response_model=ChannelOut, dependencies=[Depends(admin)])
async def update_channel(channel_id: int, data: ChannelPatch, session: AsyncSession = Depends(get_session)):
    channel = await catalog.update_channel(session, channel_id, data.model_dump(exclude_none=True))
    await session.commit()
    return channel


@router.get("/tariffs", response_model=list[TariffOut], dependencies=[Depends(viewer)])
async def list_tariffs(session: AsyncSession = Depends(get_session)):
    return await catalog.list_tariffs(session)


@router.get("/tariffs/estimate", response_model=EstimateOut, dependencies=[Depends(viewer)])
async def estimate(product_id: int, channel_id: int | None = None, on: date | None = Query(None, alias="date"),
                   session: AsyncSession = Depends(get_session)):
    product = await catalog.get_product(session, product_id)
    channel = (await catalog.get_channel(session, channel_id) if channel_id
               else await catalog.default_channel(session))
    base, rate, value = await catalog.estimate_rastamojka(session, product, channel, on or today())
    return EstimateOut(base_price_usd=base, customs_rate=rate, customs_factor=channel.customs_factor,
                       rastamojka=value)


@router.post("/tariffs", response_model=TariffOut, status_code=201, dependencies=[Depends(operator)])
async def create_tariff(data: TariffIn, session: AsyncSession = Depends(get_session)):
    tariff = await catalog.create_tariff(session, data.model_dump())
    await session.commit()
    return tariff


@router.patch("/tariffs/{tariff_id}", response_model=TariffOut, dependencies=[Depends(operator)])
async def update_tariff(tariff_id: int, data: TariffPatch, session: AsyncSession = Depends(get_session)):
    tariff = await catalog.update_tariff(session, tariff_id, data.model_dump(exclude_none=True))
    await session.commit()
    return tariff


@router.delete("/tariffs/{tariff_id}", status_code=204, dependencies=[Depends(admin)])
async def delete_tariff(tariff_id: int, session: AsyncSession = Depends(get_session)):
    await catalog.delete_tariff(session, tariff_id)
    await session.commit()


@router.get("/customers", response_model=list[CustomerOut], dependencies=[Depends(viewer)])
async def list_customers(q: str | None = None, kind: str | None = None,
                         session: AsyncSession = Depends(get_session)):
    return await catalog.list_customers(session, q, kind)


@router.post("/customers", response_model=CustomerOut, status_code=201, dependencies=[Depends(operator)])
async def create_customer(data: CustomerIn, session: AsyncSession = Depends(get_session)):
    customer = await catalog.create_customer(session, data.model_dump())
    await session.commit()
    return customer


@router.patch("/customers/{customer_id}", response_model=CustomerOut, dependencies=[Depends(operator)])
async def update_customer(customer_id: int, data: CustomerPatch, session: AsyncSession = Depends(get_session)):
    customer = await catalog.update_customer(session, customer_id, data.model_dump(exclude_unset=True))
    await session.commit()
    return customer
