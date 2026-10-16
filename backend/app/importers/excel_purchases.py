"""Import purchases from the client's Excel layout (sheet "Malumot kiritish"). See docs/SPEC.md §6."""

import io
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation

from openpyxl import load_workbook
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationFailed
from app.domain.naming import ParsedName
from app.importers.name_parser import parse_name
from app.models import Batch, BatchExpense, PurchaseLine
from app.schemas import ImportBatchOut, ImportResultOut, NewProductOut
from app.services import batches as batches_service
from app.services import catalog
from app.services import settings as settings_service

SHEET_NAME = "Malumot kiritish"
EXCEL_EPOCH = datetime(1899, 12, 30)
INSPECTOR_MAX = Decimal("20")
MAX_NAME = 160  # larger values in column S are manual totals, not an inspector fee

# 0-based column indexes of the legacy layout
COL = {"date": 0, "name": 1, "qty": 2, "price_aed": 3, "rastamojka": 5, "imei": 7, "cargo": 8,
       "airport_road": 9, "perevod_pct": 10, "certificate": 11, "dubai_internal": 12, "customs_invoice": 13,
       "customs_duty": 14, "customs_cash": 15, "declarant": 16, "rate": 17, "inspector": 18, "bu": 19,
       "packaging": 20, "sim": 21}
BATCH_COLS = ("certificate", "dubai_internal", "customs_invoice", "customs_duty", "customs_cash", "declarant")


@dataclass
class RawLine:
    row: int
    name: str
    qty: int
    price_aed: Decimal
    values: dict[str, Decimal | None]


@dataclass
class RawBatch:
    batch_date: date
    lines: list[RawLine] = field(default_factory=list)


def _num(value) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    try:
        return Decimal(str(value).strip().replace(",", "."))
    except InvalidOperation:
        return None


def _date(value) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, (int, float)) and 20000 < value < 80000:
        return (EXCEL_EPOCH + timedelta(days=int(value))).date()
    return None


def parse_workbook(content: bytes) -> tuple[list[RawBatch], list[str]]:
    try:
        wb = load_workbook(io.BytesIO(content), data_only=True, read_only=True)
    except Exception as exc:  # openpyxl raises many types for bad files
        raise ValidationFailed("Excel faylni o'qib bo'lmadi") from exc
    warnings: list[str] = []
    if SHEET_NAME in wb.sheetnames:
        ws = wb[SHEET_NAME]
    else:
        ws = wb.worksheets[0]
        warnings.append(f"'{SHEET_NAME}' varag'i topilmadi, birinchi varaq o'qildi: '{ws.title}'")
    header = next(ws.iter_rows(min_row=1, max_row=1, max_col=4, values_only=True), ())
    if not header or not str(header[0] or "").strip().lower().startswith(("сана", "sana", "date")):
        wb.close()
        raise ValidationFailed("Fayl formati mos emas: A1 katakda 'Сана' (sana) ustuni bo'lishi kerak")
    batches: dict[date, RawBatch] = {}
    for idx, row in enumerate(ws.iter_rows(min_row=2, max_col=22, values_only=True), start=2):
        row = list(row) + [None] * (22 - len(row))
        batch_date = _date(row[COL["date"]])
        name = row[COL["name"]]
        qty = _num(row[COL["qty"]])
        price = _num(row[COL["price_aed"]])
        if name is None or str(name).strip() == "" or qty is None or qty <= 0:
            continue
        if batch_date is None:
            if row[COL["date"]] is not None and "жами" not in str(row[COL["date"]]).lower():
                warnings.append(f"{idx}-qator: sana tushunilmadi ({row[COL['date']]}), o'tkazib yuborildi")
            continue
        if price is None:
            warnings.append(f"{idx}-qator: narx yo'q, o'tkazib yuborildi ({name})")
            continue
        values = {key: _num(row[col]) for key, col in COL.items()
                  if key not in ("date", "name", "qty", "price_aed")}
        batches.setdefault(batch_date, RawBatch(batch_date)).lines.append(
            RawLine(row=idx, name=str(name).strip()[:MAX_NAME], qty=int(qty), price_aed=price, values=values))
    wb.close()
    return sorted(batches.values(), key=lambda b: b.batch_date), warnings


async def import_workbook(session: AsyncSession, content: bytes, dry_run: bool) -> ImportResultOut:
    """Parse and persist. For dry_run the caller rolls the transaction back."""
    raw_batches, warnings = parse_workbook(content)
    defaults = await settings_service.get_all(session)
    existing_qty = dict((await session.execute(
        select(Batch.batch_date, func.coalesce(func.sum(PurchaseLine.qty), 0))
        .outerjoin(PurchaseLine, PurchaseLine.batch_id == Batch.id).group_by(Batch.batch_date))).all())
    existing = set(existing_qty)
    out_batches: list[ImportBatchOut] = []
    new_products: list[NewProductOut] = []
    created_batches = 0
    zero = Decimal(0)

    for raw in raw_batches:
        qty_total = sum(line.qty for line in raw.lines)
        if raw.batch_date in existing:
            db_qty = existing_qty.get(raw.batch_date, 0)
            if db_qty != qty_total:
                warnings.append(f"{raw.batch_date}: partiya bazada bor ({db_qty} dona), Excel'da {qty_total} dona — "
                                "o'zgarishlarni admin panelda qo'lda kiriting")
            out_batches.append(ImportBatchOut(batch_date=raw.batch_date, lines=len(raw.lines), qty=qty_total,
                                              status="exists"))
            continue
        batch = Batch(batch_date=raw.batch_date, note="Excel import")
        session.add(batch)
        await session.flush()
        for line in raw.lines:
            parsed = parse_name(line.name[:MAX_NAME])
            if len(parsed.model) > 64 or len(parsed.color) > 32 or len(parsed.storage) > 32:
                parsed = ParsedName("Other", line.name[:64], "", "", parsed.variant, parsed.channel_code)
                warnings.append(f"{line.row}-qator: nomi juda uzun, 'Other' sifatida saqlandi ({line.name[:40]}…)")
            product, created = await catalog.resolve_parsed(session, line.name, parsed)
            if created:
                new_products.append(NewProductOut(raw_name=line.name, name=product.name))
            channel = await catalog.get_channel_by_code(session, parsed.channel_code)
            v = line.values
            note = None
            inspector = v["inspector"] or zero
            if inspector >= INSPECTOR_MAX:
                note = f"Excel 'Inspector' ustuni: {inspector}"
                inspector = zero
            rastamojka = v["rastamojka"]
            if rastamojka is None:
                _, _, rastamojka = await catalog.estimate_rastamojka(session, product, channel, raw.batch_date)
                warnings.append(f"{line.row}-qator ({line.name}): rastamojka yo'q, tarifdan {rastamojka} olindi")
            session.add(PurchaseLine(
                batch_id=batch.id, product_id=product.id, channel_id=channel.id, qty=line.qty,
                price_aed=line.price_aed, rate=v["rate"] or defaults["default_rate"],
                perevod_pct=v["perevod_pct"] or zero, cargo=v["cargo"] or zero, imei=v["imei"] or zero,
                airport_road=v["airport_road"] or zero, inspector=inspector, bu=v["bu"] or zero,
                packaging=v["packaging"] or zero, sim=v["sim"] or zero, rastamojka=rastamojka,
                raw_name=line.name, note=note,
            ))
        for key in BATCH_COLS:
            total = sum(((line.values[key] or zero) * line.qty for line in raw.lines), zero) / qty_total
            if total:
                session.add(BatchExpense(batch_id=batch.id, category=key, kind="estimate",
                                         amount_usd=total.quantize(Decimal("0.0001")), note="Excel import"))
        await session.flush()
        await batches_service.recalculate(session, await batches_service.load(session, batch.id))
        existing.add(raw.batch_date)
        created_batches += 1
        out_batches.append(ImportBatchOut(batch_date=raw.batch_date, lines=len(raw.lines), qty=qty_total,
                                          status="new"))

    return ImportResultOut(batches=out_batches, new_products=new_products, warnings=warnings,
                           created_batches=0 if dry_run else created_batches,
                           created_products=0 if dry_run else len(new_products))
