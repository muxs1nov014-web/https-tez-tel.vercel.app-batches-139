from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

Money = Numeric(14, 4)
Pct = Numeric(8, 5)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class User(TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("role IN ('admin','operator','viewer')", name="ck_users_role"),
        # Named: services/users.py tells a duplicate Telegram ID from a duplicate login by this name.
        UniqueConstraint("telegram_id", name="uq_users_telegram_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str] = mapped_column(String(128))
    full_name: Mapped[str] = mapped_column(String(128), default="")
    role: Mapped[str] = mapped_column(String(16), default="viewer")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Set by an admin; the Mini App login (POST /auth/telegram) maps the signed Telegram user to this.
    telegram_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


class BotUser(TimestampMixin, Base):
    __tablename__ = "bot_users"

    id: Mapped[int] = mapped_column(primary_key=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True)
    full_name: Mapped[str] = mapped_column(String(128), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class Product(TimestampMixin, Base):
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("brand", "model", "storage", "color", "variant", name="uq_products_identity",
                         postgresql_nulls_not_distinct=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    brand: Mapped[str] = mapped_column(String(32))
    model: Mapped[str] = mapped_column(String(64))
    storage: Mapped[str] = mapped_column(String(32), default="")
    color: Mapped[str] = mapped_column(String(32), default="")
    variant: Mapped[str | None] = mapped_column(String(32), nullable=True)
    name: Mapped[str] = mapped_column(String(160))
    search_text: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    aliases: Mapped[list["ProductAlias"]] = relationship(back_populates="product", cascade="all, delete-orphan")


class ProductAlias(TimestampMixin, Base):
    __tablename__ = "product_aliases"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    alias: Mapped[str] = mapped_column(String(160), unique=True)

    product: Mapped[Product] = relationship(back_populates="aliases")


class Channel(TimestampMixin, Base):
    __tablename__ = "channels"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(64))
    customs_factor: Mapped[Decimal] = mapped_column(Pct, default=Decimal("1"))


class CustomsTariff(TimestampMixin, Base):
    __tablename__ = "customs_tariffs"
    __table_args__ = (UniqueConstraint("brand", "model", "storage", "valid_from", name="uq_tariffs_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    brand: Mapped[str] = mapped_column(String(32))
    model: Mapped[str] = mapped_column(String(64))
    storage: Mapped[str] = mapped_column(String(32), default="")
    base_price_usd: Mapped[Decimal] = mapped_column(Money)
    valid_from: Mapped[date] = mapped_column(Date)


class Customer(TimestampMixin, Base):
    __tablename__ = "customers"
    __table_args__ = (CheckConstraint("kind IN ('dealer','client')", name="ck_customers_kind"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    kind: Mapped[str] = mapped_column(String(16), default="dealer")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Batch(TimestampMixin, Base):
    __tablename__ = "batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_date: Mapped[date] = mapped_column(Date, unique=True)
    code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    lines: Mapped[list["PurchaseLine"]] = relationship(
        back_populates="batch", cascade="all, delete-orphan", order_by="PurchaseLine.id"
    )
    expenses: Mapped[list["BatchExpense"]] = relationship(
        back_populates="batch", cascade="all, delete-orphan", order_by="BatchExpense.id"
    )


class PurchaseLine(TimestampMixin, Base):
    __tablename__ = "purchase_lines"
    __table_args__ = (
        CheckConstraint("qty > 0", name="ck_purchase_lines_qty"),
        CheckConstraint("rate > 0", name="ck_purchase_lines_rate"),
        Index("ix_purchase_lines_product_batch", "product_id", "batch_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("batches.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    channel_id: Mapped[int] = mapped_column(ForeignKey("channels.id"))
    qty: Mapped[int] = mapped_column(Integer)
    price_aed: Mapped[Decimal] = mapped_column(Money)
    rate: Mapped[Decimal] = mapped_column(Numeric(10, 5))
    perevod_pct: Mapped[Decimal] = mapped_column(Pct, default=Decimal("0"))
    cargo: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    imei: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    airport_road: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    inspector: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    bu: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    packaging: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    sim: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    rastamojka: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    client_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"), nullable=True, index=True)
    service_pct: Mapped[Decimal | None] = mapped_column(Pct, nullable=True)
    raw_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    unit_cost_est: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    unit_cost: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))

    batch: Mapped[Batch] = relationship(back_populates="lines")
    product: Mapped[Product] = relationship(lazy="joined")
    channel: Mapped[Channel] = relationship(lazy="joined")
    client: Mapped[Customer | None] = relationship(lazy="joined")


class BatchExpense(TimestampMixin, Base):
    __tablename__ = "batch_expenses"
    __table_args__ = (CheckConstraint("kind IN ('estimate','actual')", name="ck_batch_expenses_kind"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("batches.id", ondelete="CASCADE"), index=True)
    category: Mapped[str] = mapped_column(String(32))
    kind: Mapped[str] = mapped_column(String(16))
    amount_usd: Mapped[Decimal] = mapped_column(Money)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    batch: Mapped[Batch] = relationship(back_populates="expenses")


class Sale(TimestampMixin, Base):
    __tablename__ = "sales"
    __table_args__ = (CheckConstraint("source IN ('stock','consignment')", name="ck_sales_source"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    sale_date: Mapped[date] = mapped_column(Date, index=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"), nullable=True, index=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    # 'stock' = sold from our warehouse; 'consignment' = the customer reported selling goods we handed over.
    source: Mapped[str] = mapped_column(String(16), default="stock", server_default="stock")

    customer: Mapped[Customer | None] = relationship(lazy="joined")
    lines: Mapped[list["SaleLine"]] = relationship(
        back_populates="sale", cascade="all, delete-orphan", order_by="SaleLine.id"
    )


class SaleLine(TimestampMixin, Base):
    __tablename__ = "sale_lines"
    __table_args__ = (CheckConstraint("qty > 0", name="ck_sale_lines_qty"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    sale_id: Mapped[int] = mapped_column(ForeignKey("sales.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    qty: Mapped[int] = mapped_column(Integer)
    price_usd: Mapped[Decimal] = mapped_column(Money)
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("batches.id"), nullable=True)

    sale: Mapped[Sale] = relationship(back_populates="lines")
    product: Mapped[Product] = relationship(lazy="joined")
    allocations: Mapped[list["SaleAllocation"]] = relationship(
        back_populates="sale_line", cascade="all, delete-orphan", order_by="SaleAllocation.id"
    )


class SaleAllocation(Base):
    __tablename__ = "sale_allocations"
    __table_args__ = (CheckConstraint("qty > 0", name="ck_sale_allocations_qty"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    sale_line_id: Mapped[int] = mapped_column(ForeignKey("sale_lines.id", ondelete="CASCADE"), index=True)
    purchase_line_id: Mapped[int] = mapped_column(ForeignKey("purchase_lines.id"), index=True)
    qty: Mapped[int] = mapped_column(Integer)

    sale_line: Mapped[SaleLine] = relationship(back_populates="allocations")
    purchase_line: Mapped[PurchaseLine] = relationship(lazy="joined")


class StockAdjustment(TimestampMixin, Base):
    __tablename__ = "stock_adjustments"
    __table_args__ = (
        CheckConstraint("reason IN ('opening_balance','writeoff','correction')", name="ck_stock_adj_reason"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    purchase_line_id: Mapped[int] = mapped_column(
        ForeignKey("purchase_lines.id", ondelete="CASCADE"), index=True
    )
    qty: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(32))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


# ---- customer warehouses and debts (SPEC §12) ----
class ConsignmentMove(TimestampMixin, Base):
    """One handover ('out') or return document between our warehouse and a customer."""

    __tablename__ = "consignment_moves"
    __table_args__ = (
        CheckConstraint("kind IN ('out','return')", name="ck_consignment_moves_kind"),
        Index("ix_consignment_moves_customer_date", "customer_id", "move_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    move_date: Mapped[date] = mapped_column(Date)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    kind: Mapped[str] = mapped_column(String(16))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    entries: Mapped[list["ConsignmentEntry"]] = relationship(
        back_populates="move", cascade="all, delete-orphan", passive_deletes=True, order_by="ConsignmentEntry.id"
    )


class ConsignmentEntry(Base):
    """Signed qty of one purchase line at one customer: +q handover, -q return, -q customer sold.

    Exactly one parent: a move (handover/return) or a sale line (consignment sale). Deleting the parent
    cascades the entry away in the database.
    """

    __tablename__ = "consignment_entries"
    __table_args__ = (
        CheckConstraint("num_nonnulls(move_id, sale_line_id) = 1", name="ck_consignment_entries_one_parent"),
        CheckConstraint("qty <> 0", name="ck_consignment_entries_qty"),
        Index("ix_consignment_entries_customer_line", "customer_id", "purchase_line_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    purchase_line_id: Mapped[int] = mapped_column(ForeignKey("purchase_lines.id"), index=True)
    qty: Mapped[int] = mapped_column(Integer)
    price_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)  # agreed price, 'out' only
    move_id: Mapped[int | None] = mapped_column(
        ForeignKey("consignment_moves.id", ondelete="CASCADE"), nullable=True, index=True
    )
    sale_line_id: Mapped[int | None] = mapped_column(
        ForeignKey("sale_lines.id", ondelete="CASCADE"), nullable=True, index=True
    )

    move: Mapped[ConsignmentMove | None] = relationship(back_populates="entries")


class CustomerPayment(TimestampMixin, Base):
    """Money received from a customer ('payment') or debt carried over from before the system ('opening_debt')."""

    __tablename__ = "customer_payments"
    __table_args__ = (
        CheckConstraint("amount_usd > 0", name="ck_customer_payments_amount"),
        CheckConstraint("kind IN ('payment','opening_debt')", name="ck_customer_payments_kind"),
        Index("ix_customer_payments_customer_date", "customer_id", "payment_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    payment_date: Mapped[date] = mapped_column(Date)
    amount_usd: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    kind: Mapped[str] = mapped_column(String(16), default="payment")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)


# ---- Telegram group capture (SPEC §14) ----
class TelegramGroupMessage(Base):
    """A message the bot saw in a Telegram group. Stored raw; the bot never writes to groups.

    One row per (chat_id, message_id): an edit overwrites the row and sets edited_at.
    """

    __tablename__ = "telegram_group_messages"
    __table_args__ = (
        UniqueConstraint("chat_id", "message_id", name="uq_telegram_group_messages_chat_message"),
        Index("ix_telegram_group_messages_chat_sent", "chat_id", "sent_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    chat_id: Mapped[int] = mapped_column(BigInteger)
    chat_title: Mapped[str] = mapped_column(String(255), default="")
    message_id: Mapped[int] = mapped_column(BigInteger)
    from_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # None: anonymous admin / channel
    from_name: Mapped[str] = mapped_column(String(255), default="")
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    content_type: Mapped[str] = mapped_column(String(32))  # aiogram ContentType: text, photo, document, ...
    text: Mapped[str | None] = mapped_column(Text, nullable=True)  # text or media caption
    file_id: Mapped[str | None] = mapped_column(String(255), nullable=True)  # downloadable with this bot token
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reply_to_message_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    raw: Mapped[dict] = mapped_column(JSONB)  # the whole Telegram Message, for parsing rules added later
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ---- daily nasiya control workbook (SPEC §18) ----
NASIYA_REPORT_STATUSES = ("pending", "confirmed", "rejected", "superseded", "invalid")
NASIYA_ITEM_KINDS = ("nasiya", "variant", "qoldiq", "sotuv")


class NasiyaReport(Base):
    """One daily workbook from the "Telefon nasiya nazorat" group (or uploaded in the panel).

    pending → confirmed (the day's official snapshot) | rejected. Confirming a newer file of the same date turns the
    earlier confirmed one into 'superseded'. 'invalid': a group .xlsx that is not a nasiya workbook (kept so a
    rescan does not download it again).
    """

    __tablename__ = "nasiya_reports"
    __table_args__ = (
        CheckConstraint(f"status IN {NASIYA_REPORT_STATUSES}", name="ck_nasiya_reports_status"),
        CheckConstraint("source IN ('telegram','upload')", name="ck_nasiya_reports_source"),
        UniqueConstraint("file_sha256", name="uq_nasiya_reports_file_sha256"),
        Index("ix_nasiya_reports_date_status", "report_date", "status"),
        Index("uq_nasiya_reports_confirmed_date", "report_date", unique=True,
              postgresql_where="status = 'confirmed'"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    report_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    source: Mapped[str] = mapped_column(String(16))
    file_name: Mapped[str] = mapped_column(String(255), default="")
    file_sha256: Mapped[str] = mapped_column(String(64))
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    telegram_message_id: Mapped[int | None] = mapped_column(
        ForeignKey("telegram_group_messages.id", ondelete="SET NULL"), nullable=True, index=True)
    chat_title: Mapped[str] = mapped_column(String(255), default="")
    sent_by: Mapped[str] = mapped_column(String(255), default="")  # Telegram sender or panel user
    item_count: Mapped[int] = mapped_column(Integer, default=0)
    error_count: Mapped[int] = mapped_column(Integer, default=0)
    warning_count: Mapped[int] = mapped_column(Integer, default=0)
    issues: Mapped[list] = mapped_column(JSONB, default=list)  # workbook-level: cross-sheet IMEI, unreadable file
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    sheets: Mapped[list["NasiyaSheet"]] = relationship(
        back_populates="report", cascade="all, delete-orphan", passive_deletes=True, order_by="NasiyaSheet.position")


class NasiyaSheet(Base):
    """One sheet (= one customer) of a report, with the sheet's own totals and the problems found in it."""

    __tablename__ = "nasiya_sheets"

    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("nasiya_reports.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(128))
    sheet_key: Mapped[str] = mapped_column(String(128), index=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"), nullable=True, index=True)
    sheet_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    summary: Mapped[dict] = mapped_column(JSONB, default=dict)  # the sheet's panel: nasiya, qoldiq, limit, schedule
    declared: Mapped[list] = mapped_column(JSONB, default=list)  # footer totals ('Nasiyada 35 ta', sums)
    issues: Mapped[list] = mapped_column(JSONB, default=list)
    paid_note_usd: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)  # '4,490 $ utdi'
    error_count: Mapped[int] = mapped_column(Integer, default=0)
    warning_count: Mapped[int] = mapped_column(Integer, default=0)

    report: Mapped[NasiyaReport] = relationship(back_populates="sheets")
    customer: Mapped[Customer | None] = relationship(lazy="joined")
    items: Mapped[list["NasiyaItem"]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True, order_by="NasiyaItem.id")


class NasiyaItem(Base):
    """One phone (or a count-only qoldiq block) in a sheet: what the workbook says about it that day."""

    __tablename__ = "nasiya_items"
    __table_args__ = (
        CheckConstraint(f"kind IN {NASIYA_ITEM_KINDS}", name="ck_nasiya_items_kind"),
        CheckConstraint("qty > 0", name="ck_nasiya_items_qty"),
        Index("ix_nasiya_items_report_kind", "report_id", "kind"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("nasiya_reports.id", ondelete="CASCADE"))
    sheet_id: Mapped[int] = mapped_column(ForeignKey("nasiya_sheets.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    model: Mapped[str] = mapped_column(String(160))
    imei: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    qty: Mapped[int] = mapped_column(Integer, default=1)
    price_usd: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    marked_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    term_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cell: Mapped[str] = mapped_column(String(16), default="")

    report: Mapped[NasiyaReport] = relationship()


class NasiyaIntake(Base):
    """What happened to each group document the intake looked at, so a rescan never downloads it twice."""

    __tablename__ = "nasiya_intake"
    __table_args__ = (
        CheckConstraint("outcome IN ('created','duplicate','invalid')", name="ck_nasiya_intake_outcome"),
    )

    telegram_message_id: Mapped[int] = mapped_column(
        ForeignKey("telegram_group_messages.id", ondelete="CASCADE"), primary_key=True)
    report_id: Mapped[int | None] = mapped_column(ForeignKey("nasiya_reports.id", ondelete="SET NULL"), nullable=True)
    outcome: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class NasiyaSheetLink(Base):
    """Remembered sheet name → panel customer, so the next day's file maps itself."""

    __tablename__ = "nasiya_sheet_links"
    __table_args__ = (UniqueConstraint("sheet_key", name="uq_nasiya_sheet_links_sheet_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    sheet_key: Mapped[str] = mapped_column(String(128))
    sheet_name: Mapped[str] = mapped_column(String(128))
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LoginFailure(Base):
    """One failed panel login. /auth/login refuses after too many recent failures (SPEC §16.1)."""

    __tablename__ = "login_failures"
    __table_args__ = (Index("ix_login_failures_ip_failed_at", "ip", "failed_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64))
    ip: Mapped[str] = mapped_column(String(64))
    failed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
