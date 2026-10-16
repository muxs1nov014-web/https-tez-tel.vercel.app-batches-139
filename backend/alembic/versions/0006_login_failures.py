"""login_failures: throttle for /auth/login on the public deployment (SPEC §16.1)

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-03

Hand-written. Additive only: one new table; downgrade() drops exactly that table.
"""
import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "login_failures",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(64), nullable=False),
        sa.Column("ip", sa.String(64), nullable=False),
        sa.Column("failed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_login_failures_ip_failed_at", "login_failures", ["ip", "failed_at"])


def downgrade() -> None:
    op.drop_index("ix_login_failures_ip_failed_at", table_name="login_failures")
    op.drop_table("login_failures")
