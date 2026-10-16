from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Setting

DEFAULTS: dict[str, Decimal] = {
    "customs_rate": Decimal("0.176"),
    "default_rate": Decimal("3.67"),
    "default_perevod_pct": Decimal("0.01"),
    "default_imei": Decimal("15"),
    "default_cargo": Decimal("2"),
    # Pre-filled batch expense estimates (USD per batch) on the new-purchase form.
    "default_batch_certificate": Decimal("200"),
    "default_batch_dubai_internal": Decimal("500"),
    "default_batch_customs_invoice": Decimal("500"),
    "default_batch_customs_duty": Decimal("200"),
    "default_batch_customs_cash": Decimal("300"),
    "default_batch_declarant": Decimal("200"),
}


async def get_all(session: AsyncSession) -> dict[str, Decimal]:
    rows = (await session.execute(select(Setting))).scalars().all()
    values = dict(DEFAULTS)
    for row in rows:
        if row.key in values:
            values[row.key] = Decimal(row.value)
    return values


async def update(session: AsyncSession, changes: dict[str, Decimal]) -> dict[str, Decimal]:
    for key, value in changes.items():
        if key not in DEFAULTS or value is None:
            continue
        setting = await session.get(Setting, key)
        if setting is None:
            session.add(Setting(key=key, value=str(value)))
        else:
            setting.value = str(value)
    await session.flush()
    return await get_all(session)
