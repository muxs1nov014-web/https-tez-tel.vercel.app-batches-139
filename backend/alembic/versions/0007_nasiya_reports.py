"""nasiya_reports, nasiya_sheets, nasiya_items, nasiya_sheet_links, nasiya_intake: daily nasiya control workbook (SPEC §18)

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-20

Hand-written. Additive only: five new tables; downgrade() drops exactly those tables.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "nasiya_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("report_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("file_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("file_sha256", sa.String(64), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("telegram_message_id", sa.Integer(),
                  sa.ForeignKey("telegram_group_messages.id", ondelete="SET NULL"), nullable=True),
        sa.Column("chat_title", sa.String(255), nullable=False, server_default=""),
        sa.Column("sent_by", sa.String(255), nullable=False, server_default=""),
        sa.Column("item_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("warning_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("issues", JSONB(), nullable=False, server_default="[]"),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('pending', 'confirmed', 'rejected', 'superseded', 'invalid')",
                           name="ck_nasiya_reports_status"),
        sa.CheckConstraint("source IN ('telegram','upload')", name="ck_nasiya_reports_source"),
        sa.UniqueConstraint("file_sha256", name="uq_nasiya_reports_file_sha256"),
    )
    op.create_index("ix_nasiya_reports_date_status", "nasiya_reports", ["report_date", "status"])
    op.create_index("ix_nasiya_reports_telegram_message_id", "nasiya_reports", ["telegram_message_id"])
    # At most one confirmed snapshot per day.
    op.create_index("uq_nasiya_reports_confirmed_date", "nasiya_reports", ["report_date"], unique=True,
                    postgresql_where=sa.text("status = 'confirmed'"))

    op.create_table(
        "nasiya_sheets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("report_id", sa.Integer(), sa.ForeignKey("nasiya_reports.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("sheet_key", sa.String(128), nullable=False),
        sa.Column("customer_id", sa.Integer(), sa.ForeignKey("customers.id"), nullable=True),
        sa.Column("sheet_date", sa.Date(), nullable=True),
        sa.Column("summary", JSONB(), nullable=False, server_default="{}"),
        sa.Column("declared", JSONB(), nullable=False, server_default="[]"),
        sa.Column("issues", JSONB(), nullable=False, server_default="[]"),
        sa.Column("paid_note_usd", sa.Numeric(14, 2), nullable=True),
        sa.Column("error_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("warning_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_nasiya_sheets_report_id", "nasiya_sheets", ["report_id"])
    op.create_index("ix_nasiya_sheets_sheet_key", "nasiya_sheets", ["sheet_key"])
    op.create_index("ix_nasiya_sheets_customer_id", "nasiya_sheets", ["customer_id"])

    op.create_table(
        "nasiya_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("report_id", sa.Integer(), sa.ForeignKey("nasiya_reports.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sheet_id", sa.Integer(), sa.ForeignKey("nasiya_sheets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("model", sa.String(160), nullable=False),
        sa.Column("imei", sa.String(20), nullable=True),
        sa.Column("qty", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("price_usd", sa.Numeric(14, 2), nullable=True),
        sa.Column("marked_date", sa.Date(), nullable=True),
        sa.Column("term_days", sa.Integer(), nullable=True),
        sa.Column("cell", sa.String(16), nullable=False, server_default=""),
        sa.CheckConstraint("kind IN ('nasiya', 'variant', 'qoldiq', 'sotuv')", name="ck_nasiya_items_kind"),
        sa.CheckConstraint("qty > 0", name="ck_nasiya_items_qty"),
    )
    op.create_index("ix_nasiya_items_report_kind", "nasiya_items", ["report_id", "kind"])
    op.create_index("ix_nasiya_items_sheet_id", "nasiya_items", ["sheet_id"])
    op.create_index("ix_nasiya_items_imei", "nasiya_items", ["imei"])

    op.create_table(
        "nasiya_sheet_links",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("sheet_key", sa.String(128), nullable=False),
        sa.Column("sheet_name", sa.String(128), nullable=False),
        sa.Column("customer_id", sa.Integer(), sa.ForeignKey("customers.id"), nullable=False),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("sheet_key", name="uq_nasiya_sheet_links_sheet_key"),
    )

    op.create_table(
        "nasiya_intake",
        sa.Column("telegram_message_id", sa.Integer(),
                  sa.ForeignKey("telegram_group_messages.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("report_id", sa.Integer(), sa.ForeignKey("nasiya_reports.id", ondelete="SET NULL"), nullable=True),
        sa.Column("outcome", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("outcome IN ('created','duplicate','invalid')", name="ck_nasiya_intake_outcome"),
    )


def downgrade() -> None:
    op.drop_table("nasiya_intake")
    op.drop_table("nasiya_sheet_links")
    op.drop_index("ix_nasiya_items_imei", table_name="nasiya_items")
    op.drop_index("ix_nasiya_items_sheet_id", table_name="nasiya_items")
    op.drop_index("ix_nasiya_items_report_kind", table_name="nasiya_items")
    op.drop_table("nasiya_items")
    op.drop_index("ix_nasiya_sheets_customer_id", table_name="nasiya_sheets")
    op.drop_index("ix_nasiya_sheets_sheet_key", table_name="nasiya_sheets")
    op.drop_index("ix_nasiya_sheets_report_id", table_name="nasiya_sheets")
    op.drop_table("nasiya_sheets")
    op.drop_index("uq_nasiya_reports_confirmed_date", table_name="nasiya_reports")
    op.drop_index("ix_nasiya_reports_telegram_message_id", table_name="nasiya_reports")
    op.drop_index("ix_nasiya_reports_date_status", table_name="nasiya_reports")
    op.drop_table("nasiya_reports")
