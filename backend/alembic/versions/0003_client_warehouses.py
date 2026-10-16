"""client warehouses: consignment moves/entries, customer payments, sales.source (SPEC §12.1)

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-02

Hand-written. Additive only: three new tables, one new column with a server default (existing sales
become 'stock'). downgrade() drops exactly what upgrade() created.
"""
import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sales", sa.Column("source", sa.String(length=16), server_default="stock", nullable=False))
    op.create_check_constraint("ck_sales_source", "sales", "source IN ('stock','consignment')")

    op.create_table(
        "consignment_moves",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("move_date", sa.Date(), nullable=False),
        sa.Column("customer_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("kind IN ('out','return')", name="ck_consignment_moves_kind"),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_consignment_moves_customer_date", "consignment_moves", ["customer_id", "move_date"])

    op.create_table(
        "consignment_entries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("customer_id", sa.Integer(), nullable=False),
        sa.Column("purchase_line_id", sa.Integer(), nullable=False),
        sa.Column("qty", sa.Integer(), nullable=False),
        sa.Column("price_usd", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("move_id", sa.Integer(), nullable=True),
        sa.Column("sale_line_id", sa.Integer(), nullable=True),
        sa.CheckConstraint("num_nonnulls(move_id, sale_line_id) = 1", name="ck_consignment_entries_one_parent"),
        sa.CheckConstraint("qty <> 0", name="ck_consignment_entries_qty"),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"]),
        sa.ForeignKeyConstraint(["purchase_line_id"], ["purchase_lines.id"]),
        sa.ForeignKeyConstraint(["move_id"], ["consignment_moves.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sale_line_id"], ["sale_lines.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_consignment_entries_customer_line", "consignment_entries",
                    ["customer_id", "purchase_line_id"])
    op.create_index("ix_consignment_entries_purchase_line_id", "consignment_entries", ["purchase_line_id"])
    # FK lookups for the ON DELETE CASCADE from moves / sale lines (every sale delete probes this table).
    op.create_index("ix_consignment_entries_move_id", "consignment_entries", ["move_id"])
    op.create_index("ix_consignment_entries_sale_line_id", "consignment_entries", ["sale_line_id"])

    op.create_table(
        "customer_payments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("customer_id", sa.Integer(), nullable=False),
        sa.Column("payment_date", sa.Date(), nullable=False),
        sa.Column("amount_usd", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("amount_usd > 0", name="ck_customer_payments_amount"),
        sa.CheckConstraint("kind IN ('payment','opening_debt')", name="ck_customer_payments_kind"),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_customer_payments_customer_date", "customer_payments", ["customer_id", "payment_date"])


def downgrade() -> None:
    op.drop_index("ix_customer_payments_customer_date", table_name="customer_payments")
    op.drop_table("customer_payments")
    op.drop_index("ix_consignment_entries_sale_line_id", table_name="consignment_entries")
    op.drop_index("ix_consignment_entries_move_id", table_name="consignment_entries")
    op.drop_index("ix_consignment_entries_purchase_line_id", table_name="consignment_entries")
    op.drop_index("ix_consignment_entries_customer_line", table_name="consignment_entries")
    op.drop_table("consignment_entries")
    op.drop_index("ix_consignment_moves_customer_date", table_name="consignment_moves")
    op.drop_table("consignment_moves")
    op.drop_constraint("ck_sales_source", "sales", type_="check")
    op.drop_column("sales", "source")
