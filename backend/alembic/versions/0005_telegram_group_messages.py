"""telegram_group_messages: raw capture of Telegram group messages (SPEC §14)

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-03

Hand-written. Additive only: one new table; downgrade() drops exactly that table.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "telegram_group_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("chat_id", sa.BigInteger(), nullable=False),
        sa.Column("chat_title", sa.String(255), nullable=False, server_default=""),
        sa.Column("message_id", sa.BigInteger(), nullable=False),
        sa.Column("from_id", sa.BigInteger(), nullable=True),
        sa.Column("from_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("content_type", sa.String(32), nullable=False),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("file_id", sa.String(255), nullable=True),
        sa.Column("file_name", sa.String(255), nullable=True),
        sa.Column("reply_to_message_id", sa.BigInteger(), nullable=True),
        sa.Column("raw", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("chat_id", "message_id", name="uq_telegram_group_messages_chat_message"),
    )
    op.create_index("ix_telegram_group_messages_chat_sent", "telegram_group_messages", ["chat_id", "sent_at"])


def downgrade() -> None:
    op.drop_index("ix_telegram_group_messages_chat_sent", table_name="telegram_group_messages")
    op.drop_table("telegram_group_messages")
