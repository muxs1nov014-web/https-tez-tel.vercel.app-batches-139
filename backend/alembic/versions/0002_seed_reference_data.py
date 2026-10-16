"""seed channels, settings and customs tariffs (from client screenshots)

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-30
"""
from datetime import date

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

SETTINGS = {
    "customs_rate": "0.176",
    "default_rate": "3.67",
    "default_perevod_pct": "0.01",
    "default_imei": "15",
    "default_cargo": "2",
}
CHANNELS = [("cargo", "Kargo", "1"), ("hand", "Yo'lovchi (1)", "0.5")]
TARIFFS = [
    ("Apple", "iPhone 13", "128GB", 120),
    ("Apple", "iPhone 15", "128GB", 270),
    ("Apple", "iPhone 16", "128GB", 450),
    ("Apple", "iPhone 16 Pro", "128GB", 450),
    ("Apple", "iPhone 16 Pro", "256GB", 600),
    ("Apple", "iPhone 16 Pro Max", "256GB", 750),
    ("Apple", "iPhone 17", "256GB", 800),
    ("Apple", "iPhone 17 Pro", "256GB", 1099),
    ("Apple", "iPhone 17 Pro", "512GB", 1175),
    ("Apple", "iPhone 17 Pro", "1TB", 1470),
    ("Apple", "iPhone 17 Pro Max", "256GB", 1190),
    ("Apple", "iPhone 17 Pro Max", "512GB", 1300),
    ("Apple", "iPhone 17 Pro Max", "1TB", 1600),
    ("Apple", "iPhone 17 Pro Max", "2TB", 2020),
    ("Apple", "iPhone 17 Air", "256GB", 830),
    ("Apple", "iPhone 17 Air", "512GB", 1250),
    ("Apple", "iPhone 17 Air", "1TB", 1730),
    ("Samsung", "Galaxy S25 Ultra", "12/256GB", 400),
    ("Samsung", "Galaxy S26 Ultra", "12/256GB", 800),
    ("Apple", "iPhone 18 Pro Max", "256GB", 1500),
    ("Apple", "iPhone 18 Pro Max", "512GB", 1730),
    ("Apple", "iPhone 18 Pro Max", "1TB", 2195),
    ("Apple", "iPhone 18 Pro Max", "2TB", 2890),
    ("Apple", "iPhone 18 Pro", "256GB", 1390),
    ("Apple", "iPhone 18 Pro", "512GB", 1625),
    ("Apple", "iPhone 18 Pro", "1TB", 2085),
    ("Apple", "iPhone 18 Pro", "2TB", 2780),
]
VALID_FROM = date(2025, 1, 1)


def upgrade() -> None:
    settings = sa.table("settings", sa.column("key"), sa.column("value"))
    op.bulk_insert(settings, [{"key": k, "value": v} for k, v in SETTINGS.items()])
    channels = sa.table("channels", sa.column("code"), sa.column("name"), sa.column("customs_factor"))
    op.bulk_insert(channels, [{"code": c, "name": n, "customs_factor": f} for c, n, f in CHANNELS])
    tariffs = sa.table(
        "customs_tariffs", sa.column("brand"), sa.column("model"), sa.column("storage"),
        sa.column("base_price_usd"), sa.column("valid_from"),
    )
    op.bulk_insert(tariffs, [
        {"brand": b, "model": m, "storage": s, "base_price_usd": p, "valid_from": VALID_FROM}
        for b, m, s, p in TARIFFS
    ])


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM customs_tariffs WHERE valid_from = '2025-01-01'"))
    op.execute(sa.text("DELETE FROM channels WHERE code IN ('cargo', 'hand')"))
    op.execute(sa.text(
        "DELETE FROM settings WHERE key IN "
        "('customs_rate','default_rate','default_perevod_pct','default_imei','default_cargo')"
    ))
