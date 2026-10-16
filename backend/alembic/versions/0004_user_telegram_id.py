"""users.telegram_id for the Telegram Mini App login (SPEC §13.3)

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-02

Hand-written. Additive only: one nullable column (existing users stay unlinked) plus a named UNIQUE
constraint, so one Telegram account maps to at most one panel user. downgrade() drops exactly that.
"""
import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("telegram_id", sa.BigInteger(), nullable=True))
    op.create_unique_constraint("uq_users_telegram_id", "users", ["telegram_id"])


def downgrade() -> None:
    op.drop_constraint("uq_users_telegram_id", "users", type_="unique")
    op.drop_column("users", "telegram_id")
