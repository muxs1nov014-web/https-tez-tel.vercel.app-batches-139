"""Landed unit-cost engine. Pure: no DB, no I/O. See docs/SPEC.md §4."""

from dataclasses import dataclass, field
from decimal import Decimal

ZERO = Decimal("0")

LINE_CATEGORIES: tuple[str, ...] = (
    "perevod",
    "cargo",
    "imei",
    "airport_road",
    "inspector",
    "bu",
    "packaging",
    "sim",
    "rastamojka",
)
BATCH_CATEGORIES: tuple[str, ...] = (
    "certificate",
    "dubai_internal",
    "customs_invoice",
    "customs_duty",
    "customs_cash",
    "declarant",
)
ALL_CATEGORIES: tuple[str, ...] = LINE_CATEGORIES + BATCH_CATEGORIES

CATEGORY_LABELS: dict[str, str] = {
    "perevod": "Perevod",
    "cargo": "Kargo",
    "imei": "IMEI",
    "airport_road": "Yo'l kira (aeroport)",
    "inspector": "Inspektor",
    "bu": "B/U xarajat",
    "packaging": "Upakovka",
    "sim": "SIM",
    "rastamojka": "Rastamojka",
    "certificate": "Sertifikat",
    "dubai_internal": "Dubay ichki",
    "customs_invoice": "Schet bojxona",
    "customs_duty": "Bojxona boji",
    "customs_cash": "Naqd bojxona",
    "declarant": "Deklarant / hujjatlar",
}


def category_level(code: str) -> str:
    return "line" if code in LINE_CATEGORIES else "batch"


@dataclass(frozen=True)
class LineInput:
    key: int
    qty: int
    price_aed: Decimal
    rate: Decimal
    perevod_pct: Decimal = ZERO
    cargo: Decimal = ZERO
    imei: Decimal = ZERO
    airport_road: Decimal = ZERO
    inspector: Decimal = ZERO
    bu: Decimal = ZERO
    packaging: Decimal = ZERO
    sim: Decimal = ZERO
    rastamojka: Decimal = ZERO

    @property
    def price_usd(self) -> Decimal:
        return self.price_aed / self.rate if self.rate else ZERO

    def estimate_per_unit(self, category: str) -> Decimal:
        if category == "perevod":
            return self.price_usd * self.perevod_pct
        return getattr(self, category)


@dataclass
class LineCost:
    key: int
    qty: int
    price_usd: Decimal
    # category -> (estimate per unit, effective per unit)
    per_unit: dict[str, tuple[Decimal, Decimal]] = field(default_factory=dict)

    @property
    def overhead_est(self) -> Decimal:
        return sum((est for est, _ in self.per_unit.values()), ZERO)

    @property
    def overhead(self) -> Decimal:
        return sum((eff for _, eff in self.per_unit.values()), ZERO)

    @property
    def unit_cost_est(self) -> Decimal:
        return self.price_usd + self.overhead_est

    @property
    def unit_cost(self) -> Decimal:
        return self.price_usd + self.overhead


@dataclass(frozen=True)
class CategoryTotal:
    code: str
    level: str
    estimate_total: Decimal
    actual_total: Decimal | None

    @property
    def effective_total(self) -> Decimal:
        return self.actual_total if self.actual_total is not None else self.estimate_total


@dataclass
class BatchCost:
    lines: list[LineCost]
    categories: list[CategoryTotal]

    def line(self, key: int) -> LineCost:
        return next(line for line in self.lines if line.key == key)


def compute_batch(
    lines: list[LineInput],
    batch_estimates: dict[str, Decimal],
    actuals: dict[str, Decimal],
) -> BatchCost:
    """Compute per-unit estimate and effective cost for every line of one batch.

    batch_estimates: batch-level category -> estimated total for the batch.
    actuals: category -> actual total paid (only categories with actual records).
    """
    total_qty = sum(line.qty for line in lines)
    costs = {line.key: LineCost(key=line.key, qty=line.qty, price_usd=line.price_usd) for line in lines}
    categories: list[CategoryTotal] = []

    for code in LINE_CATEGORIES:
        est_totals = {line.key: line.estimate_per_unit(code) * line.qty for line in lines}
        est_sum = sum(est_totals.values(), ZERO)
        actual = actuals.get(code)
        for line in lines:
            est_unit = line.estimate_per_unit(code)
            if actual is None:
                eff_unit = est_unit
            elif est_sum:
                eff_unit = actual * (est_totals[line.key] / est_sum) / line.qty
            else:
                eff_unit = actual / total_qty if total_qty else ZERO
            costs[line.key].per_unit[code] = (est_unit, eff_unit)
        categories.append(CategoryTotal(code, "line", est_sum, actual))

    for code in BATCH_CATEGORIES:
        est_total = batch_estimates.get(code, ZERO)
        actual = actuals.get(code)
        est_unit = est_total / total_qty if total_qty else ZERO
        eff_unit = (actual / total_qty if total_qty else ZERO) if actual is not None else est_unit
        for line in lines:
            costs[line.key].per_unit[code] = (est_unit, eff_unit)
        categories.append(CategoryTotal(code, "batch", est_total, actual))

    return BatchCost(lines=[costs[line.key] for line in lines], categories=categories)


def rastamojka_estimate(base_price_usd: Decimal | None, customs_rate: Decimal, customs_factor: Decimal) -> Decimal:
    if base_price_usd is None:
        return ZERO
    return (base_price_usd * customs_rate * customs_factor).quantize(Decimal("0.01"))
