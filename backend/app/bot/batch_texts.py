"""Plain-text batch cost message (SPEC §17). Pure functions: no DB, no Telegram.

Lines of one product are merged; the unit cost is their qty-weighted average, the same as the
"Model bo'yicha tannarx" card on the new-purchase form. Amounts are whole dollars with the cents always rounded up
(1954.56 → 1955 $), like that card; the total is the sum of the rounded rows, so it adds up on paper.
"""

from dataclasses import dataclass
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal

from app.bot.customer_texts import TG_LIMIT, day, units
from app.schemas import BatchDetail


@dataclass
class ModelCost:
    name: str
    qty: int
    total: Decimal
    extra: Decimal = Decimal(0)

    @property
    def overhead_text(self) -> str:
        """Average expense on top of the purchase price per phone, with cents (the "Ustama / dona" column)."""
        value = (self.extra / self.qty if self.qty else Decimal(0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        return f"{value:,.2f}".replace(",", " ") + " $"

    @property
    def unit(self) -> Decimal:
        return self.total / self.qty if self.qty else Decimal(0)

    @property
    def unit_up(self) -> int:
        return round_up(self.unit)


def round_up(value: Decimal) -> int:
    """Whole dollars, cents always rounded up: 1954.56 → 1955, 1954.00 → 1954. Cents are taken first, so a sub-cent
    remainder of the division does not add a dollar."""
    cents = value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return int(cents.to_integral_value(rounding=ROUND_CEILING))


def dollars(value: int) -> str:
    return f"{value:,}".replace(",", " ") + " $"


def model_costs(batch: BatchDetail) -> list[ModelCost]:
    """Per product, in the order the products first appear in the batch."""
    rows: dict[int, ModelCost] = {}
    for line in batch.lines:
        row = rows.setdefault(line.product.id, ModelCost(line.product.name, 0, Decimal(0)))
        row.qty += line.qty
        row.total += Decimal(line.unit_cost) * line.qty
        row.extra += Decimal(line.overhead) * line.qty
    return list(rows.values())


def render(batch: BatchDetail) -> list[str]:
    """The message, split at line breaks into parts that fit Telegram's limit."""
    has_actuals = any(c.actual_total is not None for c in batch.categories)
    title = f"📦 Partiya · {day(batch.batch_date)}"
    if batch.code:
        title += f" · {batch.code}"
    head = [title, "Model bo'yicha tannarx (1 dona):", ""]
    body: list[str] = []
    rows = model_costs(batch)
    for i, row in enumerate(rows, 1):
        body.append(f"{i}. {row.name}")
        body.append(f"    {units(row.qty)} × {dollars(row.unit_up)}")
        body.append(f"    xarajat: +{row.overhead_text} / dona")
    qty = sum(r.qty for r in rows)
    total = sum(r.qty * r.unit_up for r in rows)
    tail = ["", f"Jami: {units(qty)} · {dollars(total)}"]
    tail.append("Real xarajatlar hisobga olingan." if has_actuals
                else "Taxminiy: narx + ustama + partiya xarajati ulushi.")
    return _split(head + body + tail)


def _split(lines: list[str], limit: int = TG_LIMIT) -> list[str]:
    parts, current = [], ""
    for line in lines:
        candidate = f"{current}\n{line}" if current else line
        if len(candidate) > limit and current:
            parts.append(current)
            candidate = line
        current = candidate
    if current:
        parts.append(current)
    return parts
