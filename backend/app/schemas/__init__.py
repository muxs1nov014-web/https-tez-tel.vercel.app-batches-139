from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, model_validator

# Decimals travel as JSON numbers (Pydantic would emit strings by default).
# 6 decimals keeps 5-decimal rates/percentages (e.g. 0.00625) intact on a round trip.
Num = Annotated[Decimal, PlainSerializer(lambda v: float(round(v, 6)), return_type=float, when_used="json")]
Role = Literal["admin", "operator", "viewer"]
ExpenseKind = Literal["estimate", "actual"]
CustomerKind = Literal["dealer", "client"]
AdjustmentReason = Literal["writeoff", "correction"]
SaleSource = Literal["stock", "consignment"]
MoveKind = Literal["out", "return"]
PaymentKind = Literal["payment", "opening_debt"]
LedgerType = Literal["opening_debt", "sale", "service", "payment"]
# Telegram user IDs are positive; the upper bound keeps the value inside the BIGINT column.
TelegramId = Annotated[int, Field(gt=0, lt=2**63)]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- auth & users ----
class LoginIn(BaseModel):
    username: str
    password: str


class TelegramLoginIn(BaseModel):
    # Telegram.WebApp.initData, passed through untouched. Real values are well under 2 KB.
    init_data: str = Field(max_length=8192)


class UserOut(ORM):
    id: int
    username: str
    full_name: str
    role: Role
    is_active: bool
    telegram_id: int | None


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserIn(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=12)
    full_name: str = ""
    role: Role = "viewer"
    telegram_id: TelegramId | None = None


class MePatch(BaseModel):
    """Own login/password change. The current password is always required."""

    current_password: str = Field(min_length=1, max_length=256)
    username: str | None = Field(default=None, min_length=3, max_length=64)
    password: str | None = Field(default=None, min_length=12, max_length=72)


class UserPatch(BaseModel):
    full_name: str | None = None
    role: Role | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=12)
    telegram_id: TelegramId | None = None  # omitted = unchanged, null = unlink


class BotUserIn(BaseModel):
    telegram_id: int
    full_name: str = ""


class BotUserPatch(BaseModel):
    full_name: str | None = None
    is_active: bool | None = None


class BotUserOut(ORM):
    id: int
    telegram_id: int
    full_name: str
    is_active: bool
    created_at: datetime


class SettingsOut(BaseModel):
    customs_rate: Num
    default_rate: Num
    default_perevod_pct: Num
    default_imei: Num
    default_cargo: Num
    default_batch_certificate: Num
    default_batch_dubai_internal: Num
    default_batch_customs_invoice: Num
    default_batch_customs_duty: Num
    default_batch_customs_cash: Num
    default_batch_declarant: Num


class SettingsIn(BaseModel):
    customs_rate: Decimal | None = Field(default=None, ge=0, le=1)
    default_rate: Decimal | None = Field(default=None, gt=0)
    default_perevod_pct: Decimal | None = Field(default=None, ge=0, le=1)
    default_imei: Decimal | None = Field(default=None, ge=0)
    default_cargo: Decimal | None = Field(default=None, ge=0)
    default_batch_certificate: Decimal | None = Field(default=None, ge=0)
    default_batch_dubai_internal: Decimal | None = Field(default=None, ge=0)
    default_batch_customs_invoice: Decimal | None = Field(default=None, ge=0)
    default_batch_customs_duty: Decimal | None = Field(default=None, ge=0)
    default_batch_customs_cash: Decimal | None = Field(default=None, ge=0)
    default_batch_declarant: Decimal | None = Field(default=None, ge=0)


# ---- catalog ----
class CategoryOut(BaseModel):
    code: str
    label: str
    level: Literal["line", "batch"]


class ProductIn(BaseModel):
    brand: str = Field(min_length=1)
    model: str = Field(min_length=1)
    storage: str = ""
    color: str = ""
    variant: str | None = None


class ProductPatch(BaseModel):
    brand: str | None = None
    model: str | None = None
    storage: str | None = None
    color: str | None = None
    variant: str | None = None
    is_active: bool | None = None


class ProductOut(ORM):
    id: int
    brand: str
    model: str
    storage: str
    color: str
    variant: str | None
    name: str
    is_active: bool


class Ref(BaseModel):
    id: int
    name: str


class ChannelIn(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str
    customs_factor: Decimal = Field(ge=0)


class ChannelPatch(BaseModel):
    name: str | None = None
    customs_factor: Decimal | None = Field(default=None, ge=0)


class ChannelOut(ORM):
    id: int
    code: str
    name: str
    customs_factor: Num


class TariffIn(BaseModel):
    brand: str
    model: str
    storage: str = ""
    base_price_usd: Decimal = Field(ge=0)
    valid_from: date


class TariffPatch(BaseModel):
    brand: str | None = None
    model: str | None = None
    storage: str | None = None
    base_price_usd: Decimal | None = Field(default=None, ge=0)
    valid_from: date | None = None


class TariffOut(ORM):
    id: int
    brand: str
    model: str
    storage: str
    base_price_usd: Num
    valid_from: date


class EstimateOut(BaseModel):
    base_price_usd: Num | None
    customs_rate: Num
    customs_factor: Num
    rastamojka: Num


class CustomerIn(BaseModel):
    name: str = Field(min_length=1)
    phone: str | None = None
    kind: CustomerKind = "dealer"
    note: str | None = None


class CustomerPatch(BaseModel):
    name: str | None = None
    phone: str | None = None
    kind: CustomerKind | None = None
    note: str | None = None
    is_active: bool | None = None


class CustomerOut(ORM):
    id: int
    name: str
    phone: str | None
    kind: CustomerKind
    note: str | None
    is_active: bool


# ---- batches ----
class LineIn(BaseModel):
    product_id: int
    channel_id: int | None = None
    qty: int = Field(gt=0)
    price_aed: Decimal = Field(ge=0)
    rate: Decimal | None = Field(default=None, gt=0)
    perevod_pct: Decimal | None = Field(default=None, ge=0, le=1)
    cargo: Decimal | None = Field(default=None, ge=0)
    imei: Decimal | None = Field(default=None, ge=0)
    airport_road: Decimal | None = Field(default=None, ge=0)
    inspector: Decimal | None = Field(default=None, ge=0)
    bu: Decimal | None = Field(default=None, ge=0)
    packaging: Decimal | None = Field(default=None, ge=0)
    sim: Decimal | None = Field(default=None, ge=0)
    rastamojka: Decimal | None = Field(default=None, ge=0)
    client_id: int | None = None
    service_pct: Decimal | None = Field(default=None, ge=0, le=1)
    note: str | None = None


class LinePatch(BaseModel):
    product_id: int | None = None
    channel_id: int | None = None
    qty: int | None = Field(default=None, gt=0)
    price_aed: Decimal | None = Field(default=None, ge=0)
    rate: Decimal | None = Field(default=None, gt=0)
    perevod_pct: Decimal | None = Field(default=None, ge=0, le=1)
    cargo: Decimal | None = Field(default=None, ge=0)
    imei: Decimal | None = Field(default=None, ge=0)
    airport_road: Decimal | None = Field(default=None, ge=0)
    inspector: Decimal | None = Field(default=None, ge=0)
    bu: Decimal | None = Field(default=None, ge=0)
    packaging: Decimal | None = Field(default=None, ge=0)
    sim: Decimal | None = Field(default=None, ge=0)
    rastamojka: Decimal | None = Field(default=None, ge=0)
    client_id: int | None = None
    service_pct: Decimal | None = Field(default=None, ge=0, le=1)
    note: str | None = None


class ExpenseIn(BaseModel):
    category: str
    kind: ExpenseKind
    amount_usd: Decimal = Field(ge=0)
    note: str | None = None


class BatchIn(BaseModel):
    batch_date: date
    code: str | None = None
    note: str | None = None
    lines: list[LineIn] = []
    expenses: list[ExpenseIn] = []


class BatchPatch(BaseModel):
    code: str | None = None
    note: str | None = None


class ExpenseOut(ORM):
    id: int
    category: str
    kind: ExpenseKind
    amount_usd: Num
    note: str | None
    created_at: datetime


class CategoryTotalOut(BaseModel):
    code: str
    label: str
    level: Literal["line", "batch"]
    estimate_total: Num
    actual_total: Num | None
    effective_total: Num


class PerUnitOut(BaseModel):
    estimate: Num
    effective: Num


class ChannelRef(BaseModel):
    id: int
    code: str
    name: str


class LineOut(BaseModel):
    id: int
    product: Ref
    channel: ChannelRef
    qty: int
    price_aed: Num
    rate: Num
    price_usd: Num
    client: Ref | None
    service_pct: Num | None
    note: str | None
    raw_name: str | None
    estimates: dict[str, Num]
    per_unit: dict[str, PerUnitOut]
    unit_cost_est: Num
    unit_cost: Num
    overhead_est: Num
    overhead: Num
    sold_qty: int
    adjusted_qty: int
    consigned_qty: int  # units of this line currently at customers (SPEC §12.2)
    remaining_qty: int  # in our warehouse: qty - sold - adjusted - consigned


class BatchTotals(BaseModel):
    price_usd: Num
    cost_est: Num
    cost: Num
    overhead_est: Num
    overhead: Num


class BatchDetail(BaseModel):
    id: int
    batch_date: date
    code: str | None
    note: str | None
    total_qty: int
    lines: list[LineOut]
    expenses: list[ExpenseOut]
    categories: list[CategoryTotalOut]
    totals: BatchTotals
    warnings: list[str] = []



class NotifyResult(BaseModel):
    """Telegram batch cost message (SPEC §17): chats tried, delivered, failed."""
    recipients: int
    sent: int
    failed: int
    blocked: int = 0  # of `failed`: blocked the bot or gone, so skipped from now on
    skipped: int = 0  # picked but already known to be unreachable: not tried


class NotifyIn(BaseModel):
    chat_ids: list[str] = Field(max_length=200)  # from GET /telegram/recipients


class RecipientOut(BaseModel):
    chat_id: str
    name: str
    kind: Literal["user", "group", "channel"]
    blocked: bool  # blocked the bot or is gone: not sent to until it talks to the bot again

class BatchSummary(BaseModel):
    id: int
    batch_date: date
    code: str | None
    note: str | None
    total_qty: int
    own_qty: int
    client_qty: int
    price_usd_total: Num
    cost_est_total: Num
    cost_total: Num
    overhead_per_unit_avg: Num
    has_actuals: bool


# ---- stock ----
class StockLineOut(BaseModel):
    purchase_line_id: int
    batch_id: int
    batch_date: date
    remaining_qty: int
    unit_cost: Num


class StockRowOut(BaseModel):
    product: Ref
    qty: int
    avg_unit_cost: Num
    stock_value: Num
    lines: list[StockLineOut]


class OpeningItem(BaseModel):
    product_id: int
    qty: int = Field(ge=0)


class OpeningBalanceIn(BaseModel):
    as_of_date: date
    items: list[OpeningItem]


class OpeningResultOut(BaseModel):
    product_id: int
    kept: int
    written_off: int


class AdjustmentIn(BaseModel):
    purchase_line_id: int
    qty: int = Field(gt=0)
    reason: AdjustmentReason
    note: str | None = None


class IdOut(BaseModel):
    id: int


# ---- sales ----
class SaleLineIn(BaseModel):
    product_id: int
    qty: int = Field(gt=0)
    price_usd: Decimal = Field(ge=0)
    batch_id: int | None = None


class SaleIn(BaseModel):
    sale_date: date
    customer_id: int | None = None
    note: str | None = None
    lines: list[SaleLineIn] = Field(min_length=1)


class AllocationOut(BaseModel):
    purchase_line_id: int
    batch_date: date
    qty: int
    unit_cost: Num


class SaleLineOut(BaseModel):
    id: int
    product: Ref
    qty: int
    price_usd: Num
    revenue: Num
    cost: Num
    profit: Num
    allocations: list[AllocationOut]


class SaleTotals(BaseModel):
    qty: int
    revenue: Num
    cost: Num
    profit: Num


class SaleDetail(BaseModel):
    id: int
    sale_date: date
    source: SaleSource
    customer: Ref | None
    note: str | None
    lines: list[SaleLineOut]
    totals: SaleTotals


class SaleSummary(BaseModel):
    id: int
    sale_date: date
    source: SaleSource
    customer: Ref | None
    total_qty: int
    revenue: Num
    cost: Num
    profit: Num


# ---- customer warehouses and debts (SPEC §12) ----
class CustomerRef(BaseModel):
    id: int
    name: str
    kind: CustomerKind


class CustomerBalance(BaseModel):
    customer: CustomerRef
    debt: Num
    stock_qty: int
    stock_value_cost: Num
    stock_value_price: Num
    exposure: Num  # debt + stock_value_price: what the customer owes if everything on hand were sold
    sales_month_qty: int
    sales_month_revenue: Num
    last_payment_date: date | None


class CustomerTotals(BaseModel):
    opening_debt: Num
    charged_sales: Num  # revenue of all sales to the customer, both sources
    charged_service: Num  # client-service charges (purchase lines with client_id = customer)
    paid: Num
    given_qty: int  # handed over in 'out' moves
    returned_qty: int  # taken back in 'return' moves
    sold_qty: int  # sold by the customer from the goods we handed over (consignment sales)


class CustomerOverview(BaseModel):
    balance: CustomerBalance
    totals: CustomerTotals


class CustomerStockLineOut(BaseModel):
    purchase_line_id: int
    batch_date: date
    qty: int
    unit_cost: Num
    price_usd: Num | None  # agreed price of this line's latest handover to the customer


class CustomerStockRowOut(BaseModel):
    product: Ref
    qty: int
    avg_unit_cost: Num
    value_cost: Num
    price_usd: Num | None  # latest agreed price of the product for this customer
    value_price: Num
    lines: list[CustomerStockLineOut]


class MoveLineIn(BaseModel):
    product_id: int
    qty: int = Field(gt=0)
    price_usd: Decimal | None = Field(default=None, max_digits=12, decimal_places=2)


class MoveIn(BaseModel):
    move_date: date
    kind: MoveKind
    note: str | None = None
    lines: list[MoveLineIn] = Field(min_length=1)

    @model_validator(mode="after")
    def _prices(self) -> "MoveIn":
        if self.kind == "out":
            if any(line.price_usd is None or line.price_usd <= 0 for line in self.lines):
                raise ValueError("Mol berishda har bir qator uchun narx (price_usd > 0) kerak")
        else:
            for line in self.lines:
                line.price_usd = None  # a return carries no price
        return self


class MoveLineOut(BaseModel):
    product: Ref
    qty: int
    price_usd: Num | None


class MoveOut(BaseModel):
    id: int
    move_date: date
    kind: MoveKind
    note: str | None
    total_qty: int
    total_value: Num | None  # Σ qty × agreed price for 'out'; null for 'return'
    created_at: datetime
    lines: list[MoveLineOut]


class ConsignmentSaleLineIn(BaseModel):
    product_id: int
    qty: int = Field(gt=0)
    price_usd: Decimal = Field(gt=0)


class ConsignmentSaleIn(BaseModel):
    sale_date: date
    note: str | None = None
    lines: list[ConsignmentSaleLineIn] = Field(min_length=1)


class PaymentIn(BaseModel):
    payment_date: date
    amount_usd: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    kind: PaymentKind
    note: str | None = None


class PaymentOut(ORM):
    id: int
    payment_date: date
    amount_usd: Num
    kind: PaymentKind
    note: str | None
    created_at: datetime


class LedgerRow(BaseModel):
    date: date
    type: LedgerType
    ref_id: int | None  # payment id, sale id, or purchase line id (service)
    description: str
    debit: Num  # increases the debt
    credit: Num  # lowers the debt
    balance: Num  # running debt after this row


# ---- reports ----
class MonthStats(BaseModel):
    sales_qty: int
    revenue: Num
    profit: Num
    nasiya_sales_qty: int = 0  # part of sales_qty / revenue taken from the nasiya files' Sotuv (no cost, no profit)
    nasiya_revenue: Num = Decimal(0)
    purchases_qty: int
    purchases_usd: Num


class MonthlyRow(BaseModel):
    month: str
    purchases_qty: int
    purchases_usd: Num
    sales_qty: int
    revenue: Num
    profit: Num
    nasiya_sales_qty: int = 0
    nasiya_revenue: Num = Decimal(0)


class DashboardOut(BaseModel):
    stock_qty: int
    stock_value: Num
    month: MonthStats
    monthly: list[MonthlyRow]


class ProfitRow(BaseModel):
    key: str
    label: str
    qty: int
    revenue: Num
    cost: Num
    profit: Num


class VarianceRow(BaseModel):
    batch_id: int
    batch_date: date
    qty: int
    cost_est: Num
    cost: Num
    diff: Num
    diff_per_unit: Num


class UnitCostRow(BaseModel):
    batch_date: date
    qty: int
    price_usd: Num
    overhead: Num
    unit_cost: Num


class ClientRow(BaseModel):
    customer: Ref
    batch_date: date
    product: Ref
    qty: int
    price_usd: Num
    unit_cost_est: Num
    service_fee_per_unit: Num
    charge_per_unit: Num
    charge_total: Num
    cost_total: Num
    margin: Num


# ---- import ----
class ImportBatchOut(BaseModel):
    batch_date: date
    lines: int
    qty: int
    status: Literal["new", "exists"]


class NewProductOut(BaseModel):
    raw_name: str
    name: str


class ImportResultOut(BaseModel):
    batches: list[ImportBatchOut]
    new_products: list[NewProductOut]
    warnings: list[str]
    created_batches: int
    created_products: int


# ---- telegram notifications (SPEC §17) ----
class NotifyConfigIn(BaseModel):
    chat_ids: list[str] = Field(default=[], max_length=20)


class TelegramGroupOut(BaseModel):
    chat_id: int
    title: str


class NotifyConfigOut(BaseModel):
    chat_ids: list[str]
    bot_configured: bool
    groups: list[TelegramGroupOut]  # groups the bot has seen, to pick an ID from


# ---- daily nasiya control workbook (SPEC §18) ----
NasiyaStatus = Literal["pending", "confirmed", "rejected", "superseded", "invalid"]
NasiyaKind = Literal["nasiya", "variant", "qoldiq", "sotuv"]
NasiyaEventType = Literal["new_debt", "qoldiq_to_debt", "paid", "sold_paid", "sold_direct", "handover",
                          "vanished_debt", "vanished_qoldiq", "debt_to_qoldiq", "moved", "price_changed", "reopened"]


class NasiyaIssueOut(BaseModel):
    level: Literal["error", "warning"]
    code: str
    message: str
    cell: str = ""


class NasiyaDeclaredOut(BaseModel):
    kind: str
    label: str
    qty: int | None
    amount: Num | None
    cell: str


class NasiyaItemOut(ORM):
    id: int
    kind: NasiyaKind
    model: str
    imei: str | None
    qty: int
    price_usd: Num | None
    marked_date: date | None
    term_days: int | None
    cell: str


class NasiyaKindTotal(BaseModel):
    kind: NasiyaKind
    qty: int
    amount: Num  # Σ price × qty; qoldiq has no price in the workbook, so 0


class NasiyaSheetOut(BaseModel):
    id: int
    position: int
    name: str
    customer: CustomerRef | None
    suggested_customer: CustomerRef | None  # best name match among panel customers, while unlinked
    sheet_date: date | None
    summary: dict
    declared: list[NasiyaDeclaredOut]
    issues: list[NasiyaIssueOut]
    paid_note_usd: Num | None
    error_count: int
    warning_count: int
    totals: list[NasiyaKindTotal]
    items: list[NasiyaItemOut]


class NasiyaReportSummary(BaseModel):
    id: int
    report_date: date | None
    status: NasiyaStatus
    source: Literal["telegram", "upload"]
    file_name: str
    chat_title: str
    sent_by: str
    item_count: int
    nasiya_qty: int = 0  # debt (nasiya + variant) phones in the file
    nasiya_usd: Num = 0
    qoldiq_qty: int = 0
    sotuv_qty: int = 0
    sotuv_usd: Num = 0
    error_count: int
    warning_count: int
    sheet_count: int
    unlinked_sheets: int
    created_at: datetime
    reviewed_at: datetime | None
    reviewed_by: str | None
    review_note: str | None


class NasiyaEventOut(BaseModel):
    type: NasiyaEventType
    alert: bool  # needs a person to look at it
    customer: CustomerRef | None
    sheet_name: str
    other_customer: CustomerRef | None  # 'moved': where it was before
    model: str
    imei: str
    price_usd: Num | None
    previous_price_usd: Num | None
    sold_on: date | None = None  # 'reopened': the last earlier day it was in Sotuv (paid)


class NasiyaEventCount(BaseModel):
    type: NasiyaEventType
    alert: bool
    qty: int
    amount: Num


class NasiyaDiffOut(BaseModel):
    previous_report_id: int
    previous_date: date
    counts: list[NasiyaEventCount]
    events: list[NasiyaEventOut]


class NasiyaReportDetail(NasiyaReportSummary):
    issues: list[NasiyaIssueOut]
    sheets: list[NasiyaSheetOut]
    diff: NasiyaDiffOut | None  # against the latest confirmed report before this date


class NasiyaSheetLinkIn(BaseModel):
    customer_id: int


class NasiyaConfirmIn(BaseModel):
    force: bool = False  # confirm despite errors (admin only)
    note: str | None = Field(default=None, max_length=1000)


class NasiyaRejectIn(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


class NasiyaUploadOut(BaseModel):
    file_name: str
    report_id: int | None
    report_date: date | None
    duplicate: bool
    error: str | None


class NasiyaRescanOut(BaseModel):
    checked: int
    created: int
    skipped: int
    failed: int
    remaining: int = 0  # group files still to read: the panel repeats the call while it makes progress
    confirmed: int = 0  # new reports confirmed automatically (nasiya_reports.auto_confirm)


class NasiyaBotGroup(BaseModel):
    chat_id: int
    title: str
    messages: int  # stored by the bot (SPEC §14)
    excel_files: int
    last_message_at: datetime | None
    bot_status: str = ""  # Telegram chat member status: administrator, member, left, kicked; 'unknown' on error
    error: str | None = None


class NasiyaBotStatus(BaseModel):
    bot_username: str
    can_read_all_group_messages: bool  # privacy mode off
    webhook_set: bool
    webhook_error: str | None
    pending_updates: int
    nasiya_chat_ids: list[int]
    groups: list[NasiyaBotGroup]
    problems: list[str]  # plain-language reasons files do not arrive; empty = fine


class NasiyaProcessIn(BaseModel):
    since: date | None = None


class NasiyaProcessWaiting(BaseModel):
    report_id: int
    report_date: date
    file_name: str
    reason: str


class NasiyaProcessOut(BaseModel):
    confirmed: int
    superseded: int
    linked: list[str]  # 'sheet → customer' links made by name
    waiting: list[NasiyaProcessWaiting]


class NasiyaAgingBucket(BaseModel):
    label: str
    min_days: int
    max_days: int | None
    qty: int
    amount: Num


class NasiyaTotals(BaseModel):
    debt_usd: Num  # nasiya + variant
    debt_qty: int
    nasiya_usd: Num
    variant_usd: Num
    qoldiq_qty: int
    qoldiq_value_usd: Num  # from the sheets' own panel (cost value), when present
    sotuv_usd: Num
    sotuv_qty: int
    overdue_qty: int
    overdue_usd: Num


class NasiyaCustomerRow(BaseModel):
    customer: CustomerRef
    sheet_name: str
    totals: NasiyaTotals
    limit_usd: Num | None
    exposure_usd: Num  # debt + qoldiq value: what the sheet's 'Jami' means
    available_usd: Num | None  # limit − exposure
    over_limit: bool
    max_age_days: int | None
    aging: list[NasiyaAgingBucket]
    new_debt_usd: Num
    paid_usd: Num
    alert_count: int
    file_nasiya_usd: Num | None  # the sheet's own 'Nasiya' panel figure, to cross-check the IMEI sum
    panel_debt_usd: Num | None  # debt in the panel's customer ledger (SPEC §12), for reconciliation
    error_count: int


class NasiyaOverviewOut(BaseModel):
    report: NasiyaReportSummary | None
    previous_date: date | None
    totals: NasiyaTotals | None
    previous_totals: NasiyaTotals | None
    aging: list[NasiyaAgingBucket]
    customers: list[NasiyaCustomerRow]
    counts: list[NasiyaEventCount]
    alerts: list[NasiyaEventOut]
    pending_reports: int
    history_start: date | None  # first confirmed day: ages before it are lower bounds


class NasiyaSeriesPoint(BaseModel):
    date: date
    report_id: int
    debt_usd: Num
    debt_qty: int
    qoldiq_qty: int
    sotuv_usd: Num
    sotuv_qty: int


class NasiyaMonthRow(BaseModel):
    month: date  # first day of the month
    days: int  # confirmed days in the month
    first_date: date
    last_date: date
    partial: bool  # the month starts the history: its first day has no day before, so new debt is a lower bound
    sotuv_qty: int  # paid / sold phones (Sotuv column), each IMEI once
    sotuv_usd: Num
    new_debt_qty: int
    new_debt_usd: Num
    debt_qty_end: int  # on the month's last confirmed day
    debt_usd_end: Num
    qoldiq_qty_end: int


class NasiyaDebtItemOut(BaseModel):
    kind: NasiyaKind
    model: str
    imei: str | None
    qty: int
    price_usd: Num | None
    since: date | None  # first day of the current run in this state (or the marked date, if earlier)
    since_exact: bool  # False: already there on the first confirmed day, so the real date may be earlier
    age_days: int | None
    term_days: int | None
    overdue: bool
    marked_date: date | None


class NasiyaPhoneRow(NasiyaDebtItemOut):
    customer: CustomerRef | None
    sheet_name: str
    sold_on: date | None = None  # in debt or qoldiq although it was in Sotuv (paid) on this earlier day


class NasiyaPhonesOut(BaseModel):
    report: "NasiyaReportSummary | None"
    history_start: date | None  # first confirmed day: an age that reaches it is a lower bound
    ages_as_of: date | None = None  # ages are counted up to this day (today for the latest day)
    rows: list[NasiyaPhoneRow]  # oldest first


class NasiyaModelRow(BaseModel):
    kind: NasiyaKind
    model: str
    qty: int
    amount: Num


class NasiyaCustomerDetail(BaseModel):
    customer: CustomerRef
    report: NasiyaReportSummary | None
    row: NasiyaCustomerRow | None
    items: list[NasiyaDebtItemOut]  # every phone at the customer that day: nasiya, variant, qoldiq, sotuv
    models: list[NasiyaModelRow]
    events: list[NasiyaEventOut]  # against the previous confirmed day
    series: list[NasiyaSeriesPoint]
    schedule: list[dict]  # variant payment dates from the sheet's panel


class NasiyaImeiTrailRow(BaseModel):
    date: date
    report_id: int
    customer: CustomerRef | None
    sheet_name: str
    kind: NasiyaKind
    model: str
    price_usd: Num | None
    cell: str
