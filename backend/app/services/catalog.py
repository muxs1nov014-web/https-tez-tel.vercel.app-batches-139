from datetime import date
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, NotFound
from app.domain.costing import rastamojka_estimate
from app.domain.naming import ParsedName, normalize_alias, search_text_for
from app.models import Channel, Customer, CustomsTariff, Product, ProductAlias
from app.services import settings as settings_service


def product_display_name(model: str, storage: str, color: str, variant: str | None) -> str:
    return " ".join(p for p in (model, storage, color, variant or "") if p)


def _refresh_product_text(product: Product, aliases: list[str] | None = None) -> None:
    product.name = product_display_name(product.model, product.storage, product.color, product.variant)
    extra = " ".join(aliases or [])
    product.search_text = f"{search_text_for(product.name, product.model)} {product.brand.lower()} {extra}".strip()


# ---- products ----
async def list_products(session: AsyncSession, q: str | None = None, active: bool | None = None) -> list[Product]:
    stmt = select(Product).order_by(Product.brand, Product.model, Product.storage, Product.color)
    if active is not None:
        stmt = stmt.where(Product.is_active == active)
    for token in (q or "").lower().split():
        stmt = stmt.where(Product.search_text.contains(token))
    return list((await session.execute(stmt)).scalars().all())


async def get_product(session: AsyncSession, product_id: int) -> Product:
    product = await session.get(Product, product_id)
    if product is None:
        raise NotFound("Mahsulot topilmadi")
    return product


async def create_product(session: AsyncSession, brand: str, model: str, storage: str, color: str,
                         variant: str | None) -> Product:
    product = Product(brand=brand, model=model, storage=storage, color=color, variant=variant or None)
    _refresh_product_text(product)
    session.add(product)
    try:
        async with session.begin_nested():
            await session.flush()
    except IntegrityError as exc:
        raise Conflict("Bunday mahsulot allaqachon mavjud") from exc
    return product


async def update_product(session: AsyncSession, product_id: int, changes: dict) -> Product:
    product = await get_product(session, product_id)
    for key, value in changes.items():
        if value is None and key != "variant":
            continue  # required fields cannot be cleared
        setattr(product, key, value)
    aliases = list((await session.execute(
        select(ProductAlias.alias).where(ProductAlias.product_id == product_id))).scalars())
    _refresh_product_text(product, aliases)
    try:
        async with session.begin_nested():
            await session.flush()
    except IntegrityError as exc:
        raise Conflict("Bunday mahsulot allaqachon mavjud") from exc
    return product


async def resolve_parsed(session: AsyncSession, raw_name: str, parsed: ParsedName) -> tuple[Product, bool]:
    """Find a product by alias or identity, creating it if needed. Returns (product, created)."""
    alias = normalize_alias(raw_name)
    found = (await session.execute(
        select(Product).join(ProductAlias).where(ProductAlias.alias == alias))).scalar_one_or_none()
    if found:
        return found, False
    stmt = select(Product).where(
        Product.brand == parsed.brand, Product.model == parsed.model, Product.storage == parsed.storage,
        Product.color == parsed.color,
        Product.variant.is_(None) if parsed.variant is None else Product.variant == parsed.variant,
    )
    product = (await session.execute(stmt)).scalar_one_or_none()
    created = product is None
    aliases: list[str] = []
    if created:
        product = Product(brand=parsed.brand, model=parsed.model, storage=parsed.storage, color=parsed.color,
                          variant=parsed.variant)
        _refresh_product_text(product)
        session.add(product)
        await session.flush()
    else:
        aliases = list((await session.execute(
            select(ProductAlias.alias).where(ProductAlias.product_id == product.id))).scalars())
    session.add(ProductAlias(product_id=product.id, alias=alias))
    _refresh_product_text(product, [*aliases, alias])
    await session.flush()
    return product, created


# ---- channels ----
async def list_channels(session: AsyncSession) -> list[Channel]:
    return list((await session.execute(select(Channel).order_by(Channel.id))).scalars().all())


async def get_channel(session: AsyncSession, channel_id: int) -> Channel:
    channel = await session.get(Channel, channel_id)
    if channel is None:
        raise NotFound("Kanal topilmadi")
    return channel


async def get_channel_by_code(session: AsyncSession, code: str) -> Channel:
    channel = (await session.execute(select(Channel).where(Channel.code == code))).scalar_one_or_none()
    if channel is None:
        raise NotFound(f"Kanal topilmadi: {code}")
    return channel


async def default_channel(session: AsyncSession) -> Channel:
    channel = (await session.execute(select(Channel).where(Channel.code == "cargo"))).scalar_one_or_none()
    if channel is None:
        channel = (await session.execute(select(Channel).order_by(Channel.id).limit(1))).scalar_one_or_none()
    if channel is None:
        raise NotFound("Kanal yo'q")
    return channel


async def create_channel(session: AsyncSession, code: str, name: str, customs_factor: Decimal) -> Channel:
    channel = Channel(code=code, name=name, customs_factor=customs_factor)
    session.add(channel)
    try:
        async with session.begin_nested():
            await session.flush()
    except IntegrityError as exc:
        raise Conflict("Bunday kodli kanal mavjud") from exc
    return channel


async def update_channel(session: AsyncSession, channel_id: int, changes: dict) -> Channel:
    channel = await get_channel(session, channel_id)
    for key, value in changes.items():
        setattr(channel, key, value)
    await session.flush()
    return channel


# ---- tariffs ----
async def list_tariffs(session: AsyncSession) -> list[CustomsTariff]:
    stmt = select(CustomsTariff).order_by(CustomsTariff.brand, CustomsTariff.model, CustomsTariff.storage,
                                          CustomsTariff.valid_from.desc())
    return list((await session.execute(stmt)).scalars().all())


async def get_tariff(session: AsyncSession, tariff_id: int) -> CustomsTariff:
    tariff = await session.get(CustomsTariff, tariff_id)
    if tariff is None:
        raise NotFound("Tarif topilmadi")
    return tariff


async def create_tariff(session: AsyncSession, data: dict) -> CustomsTariff:
    tariff = CustomsTariff(**data)
    session.add(tariff)
    try:
        async with session.begin_nested():
            await session.flush()
    except IntegrityError as exc:
        raise Conflict("Bu model uchun shu sanadan tarif mavjud") from exc
    return tariff


async def update_tariff(session: AsyncSession, tariff_id: int, changes: dict) -> CustomsTariff:
    tariff = await get_tariff(session, tariff_id)
    for key, value in changes.items():
        setattr(tariff, key, value)
    try:
        async with session.begin_nested():
            await session.flush()
    except IntegrityError as exc:
        raise Conflict("Bu model uchun shu sanadan tarif mavjud") from exc
    return tariff


async def delete_tariff(session: AsyncSession, tariff_id: int) -> None:
    await session.delete(await get_tariff(session, tariff_id))
    await session.flush()


async def base_price_for(session: AsyncSession, product: Product, on: date) -> Decimal | None:
    stmt = (
        select(CustomsTariff.base_price_usd)
        .where(func.lower(CustomsTariff.brand) == product.brand.lower(),
               func.lower(CustomsTariff.model) == product.model.lower(),
               func.lower(CustomsTariff.storage) == product.storage.lower(),
               CustomsTariff.valid_from <= on)
        .order_by(CustomsTariff.valid_from.desc())
        .limit(1)
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def estimate_rastamojka(session: AsyncSession, product: Product, channel: Channel,
                              on: date) -> tuple[Decimal | None, Decimal, Decimal]:
    """Returns (base_price or None, customs_rate, estimate)."""
    rate = (await settings_service.get_all(session))["customs_rate"]
    base = await base_price_for(session, product, on)
    return base, rate, rastamojka_estimate(base, rate, channel.customs_factor)


# ---- customers ----
async def list_customers(session: AsyncSession, q: str | None = None, kind: str | None = None) -> list[Customer]:
    stmt = select(Customer).order_by(Customer.name)
    if kind:
        stmt = stmt.where(Customer.kind == kind)
    if q:
        stmt = stmt.where(or_(Customer.name.ilike(f"%{q}%"), Customer.phone.ilike(f"%{q}%")))
    return list((await session.execute(stmt)).scalars().all())


async def get_customer(session: AsyncSession, customer_id: int) -> Customer:
    customer = await session.get(Customer, customer_id)
    if customer is None:
        raise NotFound("Mijoz topilmadi")
    return customer


async def create_customer(session: AsyncSession, data: dict) -> Customer:
    customer = Customer(**data)
    session.add(customer)
    await session.flush()
    return customer


async def update_customer(session: AsyncSession, customer_id: int, changes: dict) -> Customer:
    customer = await get_customer(session, customer_id)
    for key, value in changes.items():
        if value is None and key not in ("phone", "note"):
            continue  # required fields cannot be cleared
        setattr(customer, key, value)
    await session.flush()
    return customer
