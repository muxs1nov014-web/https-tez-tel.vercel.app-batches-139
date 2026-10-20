"""Daily "Telefon nasiya nazorat" workbook → IMEI-level snapshot. Pure: no DB, no I/O. See docs/SPEC.md §18.

Layout (hand-filled, one sheet per customer):
- top rows: the date (`15,10,2026`) and the customer's name;
- a header row of column kinds: Nasiya / Nasiyada / Насияга берилди (debt), N Variant (long-term deal),
  Qoldiq / Колгани (our goods still at the customer), Sotuv (phones paid for today);
- each column is a stream of blocks: a model name, its IMEIs, then a terminator: `1900*10` (price × count) or
  a single price for nasiya/sotuv, or a count for qoldiq. `15,10,` starts the blocks given on that date,
  `8 kunga berildi` sets the term of the blocks that follow;
- footer: `Nasiyada 35 ta`, `4 ta tel un kirim`, `Ostatka`, `4,490 $ utdi`, with the sums below them;
- an optional summary panel to the right (Variant / Nasiya / Qoldiq / Jami / Limit / Berish mumkin).

Every check that can prove the sheet inconsistent is reported as an issue; nothing is silently dropped.
"""

import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

KINDS = ("nasiya", "variant", "qoldiq", "sotuv")
DEBT_KINDS = ("nasiya", "variant")
KIND_LABELS = {"nasiya": "Nasiya", "variant": "Variant", "qoldiq": "Qoldiq", "sotuv": "Sotuv"}
HEADER_SCAN_ROWS = 6
PRICE_MIN = Decimal(100)  # a lone number below this after IMEIs is a count, not a price

_SPACES = re.compile(r"\s+")
_IMEI = re.compile(r"\d{14,17}")
_NUMBER = re.compile(r"\d+(?:[.,]\d+)?")
_PRICE = re.compile(r"(\d+(?:[.,]\d+)?)\s*[*xх×]\s*(\d+)", re.IGNORECASE)
_DATE = re.compile(r"(\d{1,2})[.,/](\d{1,2})(?:[.,/]+(\d{4}|\d{2})?)\.?")
_FULL_DATE = re.compile(r"(\d{1,2})[.,/](\d{1,2})[.,/]+(\d{4})")
_TERM = re.compile(r"(\d+)\s*kun(?:ga)?\s*beril", re.IGNORECASE)
_FOOT_NASIYA = re.compile(r"nasiyada\s*(\d+)", re.IGNORECASE)
# '4 ta tel un kirim', '121 ta te un krim', '3 taga Puli olindi', '7 ta Tel un Pul olindi', 'Sotuv 16 taga'
_FOOT_SOTUV = re.compile(r"(\d+)\s*ta(?:ga)?\b.*(?:kirim|krim|pul)|sotuv\s*(\d+)\s*ta", re.IGNORECASE)
_NAME_WORDS = re.compile(r"\b(aka|opa|klent|klient|client|mijoz)\b", re.IGNORECASE)
_FOOT_QOLDIQ = re.compile(r"(osta(?:t)?ka|остатка)", re.IGNORECASE)
_FOOT_PAID = re.compile(r"([\d][\d\s,.]*)\s*\$\s*(?:utdi|o['‘’`]?tdi)", re.IGNORECASE)
_FOOT_TOTAL = re.compile(r"jami\s+nasiya", re.IGNORECASE)
_PANEL_LABELS = {"variant": "variant", "nasiya": "nasiya", "qoldiq": "qoldiq", "jami": "jami", "limit": "limit",
                 "berish mumkin": "available"}


# ---- results ----
@dataclass(frozen=True)
class Issue:
    level: str  # 'error' blocks confirmation; 'warning' is shown but does not block
    code: str
    message: str
    cell: str = ""


@dataclass(frozen=True)
class Item:
    kind: str
    model: str
    imei: str | None  # None only for a qoldiq block that gives a count without IMEIs
    qty: int
    price_usd: Decimal | None
    marked_date: date | None  # the `15,10,` marker above the block (given date, or a due date in the future)
    term_days: int | None
    cell: str


@dataclass
class Declared:
    """Totals the sheet states about itself (footer), per column group."""
    kind: str
    label: str
    qty: int | None
    amount: Decimal | None
    columns: list[int]
    cell: str


@dataclass
class SheetResult:
    name: str
    sheet_date: date | None
    items: list[Item] = field(default_factory=list)
    issues: list[Issue] = field(default_factory=list)
    declared: list[Declared] = field(default_factory=list)
    summary: dict = field(default_factory=dict)  # the sheet's own panel: nasiya, qoldiq, limit, schedule...
    paid_note: Decimal | None = None  # `4,490 $ utdi`

    @property
    def has_data(self) -> bool:
        return bool(self.items)


@dataclass
class WorkbookResult:
    report_date: date | None
    sheets: list[SheetResult]
    issues: list[Issue] = field(default_factory=list)  # cross-sheet issues (duplicate IMEI between customers)


# ---- helpers ----
def cell_ref(row: int, col: int) -> str:
    """0-based (row, col) → Excel A1 reference."""
    letters, n = "", col + 1
    while n:
        n, rem = divmod(n - 1, 26)
        letters = chr(65 + rem) + letters
    return f"{letters}{row + 1}"


def normalize_text(value: str) -> str:
    return _SPACES.sub(" ", value).strip()


def sheet_key(name: str) -> str:
    """Stable key of a sheet name for the sheet → customer link: case, spaces and punctuation do not matter."""
    return re.sub(r"[^0-9a-zа-яёўқғҳ]", "", name.lower())


def luhn_ok(imei: str) -> bool:
    if len(imei) != 15 or not imei.isdigit():
        return False
    total = 0
    for i, ch in enumerate(reversed(imei)):
        d = int(ch)
        if i % 2:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def _decimal(text: str) -> Decimal | None:
    try:
        return Decimal(text.replace(",", "."))
    except InvalidOperation:
        return None


def _make_date(day: str, month: str, year: str | None, default_year: int) -> date | None:
    y = default_year if not year else int(year) + (2000 if len(year) == 2 else 0)
    try:
        return date(y, int(month), int(day))
    except ValueError:
        return None


def is_model_text(text: str) -> bool:
    """Every phone model the sheets name carries a digit ('17 max 256', 'Air black 1 tb'); a name or note does not,
    and an amount note carries a currency sign."""
    return any(ch.isdigit() for ch in text) and "$" not in text and not _NAME_WORDS.search(text)


def column_kind(text: str) -> str | None:
    t = normalize_text(text).lower()
    if "variant" in t:
        return "variant"
    if "nasiya" in t or "насия" in t:
        return "nasiya"
    if any(w in t for w in ("qoldiq", "колгани", "қолгани", "qolgani", "остат", "ostatka", "ostaka")):
        return "qoldiq"
    if "sotuv" in t or "сотув" in t:
        return "sotuv"
    return None


# ---- tokens ----
@dataclass(frozen=True)
class Tok:
    type: str  # imei, number, price, date, term, model, foot_nasiya, foot_sotuv, foot_qoldiq, foot_paid, foot_total
    text: str = ""
    num: Decimal | None = None
    count: int | None = None
    day: date | None = None


def tokenize(value, default_year: int) -> Tok | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, datetime):
        return Tok("date", day=value.date())
    if isinstance(value, date):
        return Tok("date", day=value)
    if isinstance(value, (int, float)):
        if isinstance(value, float) and not value.is_integer():
            return Tok("number", num=Decimal(str(value)))
        as_int = int(value)
        if as_int >= 10**13:
            return Tok("imei", text=str(as_int))
        return Tok("number", num=Decimal(as_int))
    text = normalize_text(str(value))
    if not text:
        return None
    if _IMEI.fullmatch(text):
        return Tok("imei", text=text)
    if _NUMBER.fullmatch(text):
        return Tok("number", num=_decimal(text))
    if m := _PRICE.fullmatch(text):
        return Tok("price", text=text, num=_decimal(m.group(1)), count=int(m.group(2)))
    if (m := _DATE.fullmatch(text)) and (text.endswith((",", ".", "/")) or m.group(3)):
        if d := _make_date(m.group(1), m.group(2), m.group(3), default_year):
            return Tok("date", text=text, day=d)
    if m := _FOOT_NASIYA.search(text):
        return Tok("foot_nasiya", text=text, count=int(m.group(1)))
    if m := _FOOT_SOTUV.search(text):
        return Tok("foot_sotuv", text=text, count=int(m.group(1) or m.group(2)))
    if m := _FOOT_PAID.search(text):
        return Tok("foot_paid", text=text, num=_decimal(re.sub(r"[\s,]", "", m.group(1))))
    if _FOOT_TOTAL.search(text):
        return Tok("foot_total", text=text)
    if _FOOT_QOLDIQ.search(text):
        return Tok("foot_qoldiq", text=text)
    if m := _TERM.search(text):
        return Tok("term", text=text, count=int(m.group(1)))
    return Tok("model", text=text)


FOOT_TYPES = {"foot_nasiya", "foot_sotuv", "foot_qoldiq", "foot_paid", "foot_total"}


# ---- sheet parsing ----
def _find_panel(grid: list[list]) -> set[int]:
    """Columns of the summary panel: a label column holding 'Limit'/'Berish mumkin' and the value column to its right."""
    for row in grid[:15]:
        for c, value in enumerate(row):
            if isinstance(value, str) and normalize_text(value).lower() in ("limit", "berish mumkin"):
                return {c, c + 1}
    return set()


def _read_panel(grid: list[list], cols: set[int], default_year: int) -> dict:
    if not cols:
        return {}
    label_col = min(cols)
    summary: dict = {}
    schedule = []
    for row in grid:
        label = row[label_col] if label_col < len(row) else None
        value = row[label_col + 1] if label_col + 1 < len(row) else None
        if not isinstance(label, str):
            continue
        text = normalize_text(label)
        key = _PANEL_LABELS.get(re.sub(r"[^a-z ]", "", text.lower()).strip())
        if key and key not in summary:
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                summary[key] = str(Decimal(str(value)).quantize(Decimal("0.01")))
            elif value is not None:
                summary[key] = normalize_text(str(value))
        elif (m := _FULL_DATE.fullmatch(text)) and isinstance(value, (int, float)):
            if d := _make_date(m.group(1), m.group(2), m.group(3), default_year):
                schedule.append({"date": d.isoformat(), "amount": str(Decimal(str(value)))})
    if schedule:
        summary["schedule"] = schedule
    return summary


def _sheet_date(grid: list[list], header_row: int, default_year: int) -> date | None:
    found: list[date] = []
    for row in grid[: header_row + 1]:
        for value in row:
            tok = tokenize(value, default_year)
            if tok and tok.type == "date" and (tok.text == "" or _FULL_DATE.fullmatch(tok.text)):
                found.append(tok.day)
    return Counter(found).most_common(1)[0][0] if found else None


def _header(grid: list[list], skip: set[int]) -> tuple[int, dict[int, str]]:
    best_row, best = -1, {}
    for r, row in enumerate(grid[:HEADER_SCAN_ROWS]):
        kinds = {c: k for c, v in enumerate(row)
                 if c not in skip and isinstance(v, str) and (k := column_kind(v))}
        if len(kinds) > len(best):
            best_row, best = r, kinds
    return best_row, best


class _Column:
    def __init__(self, sheet: SheetResult, col: int, kind: str):
        self.sheet, self.col, self.kind = sheet, col, kind
        self.model: str | None = None
        self.model_cell = ""
        self.imeis: list[tuple[str, str]] = []  # (imei, cell)
        self.marked: date | None = None
        self.term: int | None = None

    @property
    def is_open(self) -> bool:
        return self.model is not None or bool(self.imeis)

    def issue(self, level: str, code: str, message: str, cell: str) -> None:
        self.sheet.issues.append(Issue(level, code, message, cell))

    def _emit(self, price: Decimal | None, qty_without_imei: int = 0) -> None:
        model = self.model or "?"
        for imei, cell in self.imeis:
            self.sheet.items.append(Item(self.kind, model, imei, 1, price, self.marked, self.term, cell))
        if qty_without_imei:
            self.sheet.items.append(Item(self.kind, model, None, qty_without_imei, price, self.marked, self.term,
                                         self.model_cell))
        self.model, self.model_cell, self.imeis = None, "", []

    def close_open_block(self, cell: str) -> None:
        """A block that ends without its price/count line."""
        if not self.imeis:
            if self.model:
                self.issue("warning", "empty_block", f"'{self.model}' ostida IMEI ham, son ham yo'q", self.model_cell)
                self.model, self.model_cell = None, ""
            return
        if self.kind in DEBT_KINDS or self.kind == "sotuv":
            self.issue("error", "price_missing",
                       f"'{self.model or '?'}': {len(self.imeis)} ta IMEI, lekin narxi yozilmagan", self.model_cell or cell)
        self._emit(None)

    def feed(self, tok: Tok, cell: str) -> None:
        if tok.type == "model":
            if not is_model_text(tok.text):
                return  # the customer's name or a note ('160 000$') written inside the column
            self.close_open_block(cell)
            self.model, self.model_cell = tok.text, cell
        elif tok.type == "imei":
            if self.model is None:
                self.issue("error", "imei_without_model", f"IMEI {tok.text} model nomisiz turibdi", cell)
                self.model, self.model_cell = "?", cell
            self.imeis.append((tok.text, cell))
        elif tok.type == "price":
            self._terminate(tok.num, tok.count, cell, explicit=True)
        elif tok.type == "number":
            self._number(tok.num, cell)
        elif tok.type == "date":
            self.close_open_block(cell)
            self.marked = tok.day
        elif tok.type == "term":
            self.close_open_block(cell)
            self.term = tok.count

    def _number(self, value: Decimal, cell: str) -> None:
        if self.model is None and not self.imeis:
            self.issue("warning", "stray_number", f"{value} — qaysi modelga tegishli ekani noma'lum", cell)
            return
        if self.kind == "qoldiq":
            self._terminate(None, int(value) if value == value.to_integral() else None, cell, explicit=True)
        elif value >= PRICE_MIN:
            self._terminate(value, len(self.imeis) or 1, cell, explicit=len(self.imeis) <= 1)
        else:  # a small number after debt IMEIs: a count without a price
            self.issue("error", "price_missing", f"'{self.model}': son {value} yozilgan, narxi yo'q", cell)
            self._terminate(None, int(value), cell, explicit=True)

    def _terminate(self, price: Decimal | None, count: int | None, cell: str, explicit: bool) -> None:
        n_imei = len(self.imeis)
        if count is None:
            self.issue("error", "bad_count", f"'{self.model}': son butun emas", cell)
            self._emit(price)
            return
        if not explicit:
            self.issue("warning", "price_without_count",
                       f"'{self.model}': {n_imei} ta IMEI, narx {price} soni ko'rsatilmagan — har biriga {price} deb olindi",
                       cell)
        elif n_imei and count != n_imei:
            self.issue("error", "count_mismatch",
                       f"'{self.model}': yozilgan son {count}, IMEI esa {n_imei} ta", cell)
        if price is not None and price < PRICE_MIN:
            self.issue("warning", "price_low", f"'{self.model}': narx {price} juda past", cell)
        self._emit(price, qty_without_imei=count if n_imei == 0 else 0)


def parse_sheet(name: str, grid: list[list], default_year: int) -> SheetResult:
    """grid: rows of raw cell values (openpyxl data_only), 0-based."""
    width = max((len(r) for r in grid), default=0)
    grid = [list(r) + [None] * (width - len(r)) for r in grid]
    panel = _find_panel(grid)
    header_row, kinds = _header(grid, panel)
    sheet = SheetResult(name=normalize_text(name), sheet_date=_sheet_date(grid, max(header_row, 1), default_year))
    sheet.summary = _read_panel(grid, panel, default_year)
    if not kinds:
        return sheet
    sheet_year = sheet.sheet_date.year if sheet.sheet_date else default_year

    toks = [[tokenize(v, sheet_year) if c not in panel else None for c, v in enumerate(row)] for row in grid]
    footer_rows = {r for r in range(header_row + 1, len(grid)) if any(t and t.type in FOOT_TYPES for t in toks[r])}

    for c in range(width):
        if c in panel:
            continue
        # A column ends at its own footer label; another column's footer row does not cut it short.
        end = next((r for r in range(header_row + 1, len(grid)) if toks[r][c] and toks[r][c].type in FOOT_TYPES),
                   len(grid))
        kind = kinds.get(c)
        if kind is None:
            if not any(toks[r][c] and toks[r][c].type in ("imei", "price") for r in range(header_row + 1, end)):
                continue
            if kinds.get(c - 1) is None:
                sheet.issues.append(Issue("error", "unknown_column",
                                          "Ustun turi (Nasiya/Qoldiq/Sotuv) yozilmagan", cell_ref(header_row, c)))
                continue
            # A wide header ("Насияга берилди" over B:C) leaves the continuation column blank.
            kind = kinds[c] = kinds[c - 1]
            sheet.issues.append(Issue("warning", "header_inherited",
                                      f"Ustun sarlavhasi bo'sh — chapdagi ustun kabi '{KIND_LABELS[kind]}' deb olindi",
                                      cell_ref(header_row, c)))
        column = _Column(sheet, c, kind)
        for r in range(header_row + 1, end):
            tok = toks[r][c]
            if tok is None:
                continue
            if r in footer_rows and tok.type == "number" and not column.is_open:
                continue  # a total written next to another column's footer label (`Ostatka | 33`)
            column.feed(tok, cell_ref(r, c))
        column.close_open_block(cell_ref(end, c))
        for r in range(end + 1, len(grid)):
            tok = toks[r][c]
            if tok and tok.type in ("imei", "price"):
                sheet.issues.append(Issue("error", "data_after_footer",
                                          f"Jami qatoridan keyin ma'lumot bor: {tok.text}", cell_ref(r, c)))
    _read_footer(sheet, toks, kinds, footer_rows, panel)
    _check_items(sheet)
    return sheet


def _read_footer(sheet: SheetResult, toks, kinds: dict[int, str], footer_rows: set[int], panel: set[int]) -> None:
    """Footer labels and the sums under them; each label covers its column and the same-kind columns to its right
    that have no label of their own."""
    labels: dict[int, tuple[int, Tok]] = {}
    for r in sorted(footer_rows):
        for c, tok in enumerate(toks[r]):
            if c in panel or tok is None:
                continue
            if tok.type == "foot_paid":
                sheet.paid_note = (sheet.paid_note or Decimal(0)) + (tok.num or 0)
            elif tok.type in ("foot_nasiya", "foot_sotuv", "foot_qoldiq") and c not in labels:
                labels[c] = (r, tok)
    label_cols = sorted(labels)
    for i, c in enumerate(label_cols):
        r, tok = labels[c]
        kind = {"foot_nasiya": None, "foot_sotuv": "sotuv", "foot_qoldiq": "qoldiq"}[tok.type]
        own_kind = kinds.get(c)
        if kind is None:
            kind = own_kind if own_kind in DEBT_KINDS else "nasiya"
        stop = label_cols[i + 1] if i + 1 < len(label_cols) else max(kinds, default=c) + 1
        covered = [c] + [k for k in range(c + 1, stop) if kinds.get(k) == own_kind]
        if kind == "sotuv" and own_kind != "sotuv":
            covered = []  # '4 ta tel un kirim' under another column: the day's paid total, not about that column
        amount = None
        below = toks[r + 1][c] if r + 1 < len(toks) else None
        if below is not None and below.type == "number":
            amount = below.num
        right = toks[r][c + 1] if c + 1 < len(toks[r]) else None
        if amount is None and right is not None and right.type == "number" and c + 1 in covered:
            amount = right.num  # 'Nasiyada 39 ta | 21830': the sum written beside the label
        qty = tok.count
        if tok.type == "foot_qoldiq" and right is not None and right.type == "number" and c + 1 not in kinds:
            qty = int(right.num)
        sheet.declared.append(Declared(kind, tok.text, qty, amount, covered, cell_ref(r, c)))


def _check_items(sheet: SheetResult) -> None:
    seen: dict[str, str] = {}
    for item in sheet.items:
        if item.imei is None:
            continue
        if not luhn_ok(item.imei):
            sheet.issues.append(Issue("error", "imei_invalid",
                                      f"IMEI {item.imei} noto'g'ri (raqamlar soni yoki nazorat raqami xato)", item.cell))
        if item.imei in seen:
            sheet.issues.append(Issue("error", "imei_duplicate",
                                      f"IMEI {item.imei} ikki marta yozilgan ({seen[item.imei]} va {item.cell})",
                                      item.cell))
        else:
            seen[item.imei] = item.cell
    col_of = {}
    for item in sheet.items:
        col_of.setdefault(re.match(r"[A-Z]+", item.cell).group(0), []).append(item)
    for d in sheet.declared:
        letters = {re.match(r"[A-Z]+", cell_ref(0, c)).group(0) for c in d.columns}
        group = [it for col in letters for it in col_of.get(col, []) if it.kind == d.kind or
                 (d.kind == "nasiya" and it.kind in DEBT_KINDS)]
        qty = sum(it.qty for it in group)
        others = [it for col in letters for it in col_of.get(col, []) if it not in group]
        if not group and others:
            found = KIND_LABELS[others[0].kind]
            sheet.issues.append(Issue("error", "kind_conflict",
                                      f"Ustun sarlavhasi '{found}', pastida esa '{d.label}' yozilgan — "
                                      f"{sum(it.qty for it in others)} ta telefon sarlavha bo'yicha '{found}' deb "
                                      f"hisoblandi, to'g'riligini tekshiring",
                                      d.cell))
            continue
        if d.kind == "sotuv" and not group:
            continue  # today's paid phones stated only as a total, without listing them: nothing to compare
        if d.qty is not None and qty != d.qty:
            sheet.issues.append(Issue("warning", "declared_qty",
                                      f"'{d.label}' deb yozilgan, hisoblanganda {qty} ta chiqdi", d.cell))
        if d.amount is not None and d.kind != "qoldiq":
            total = sum((it.price_usd or 0) * it.qty for it in group)
            if total != d.amount and d.amount * 1000 != total:  # '8.245' typed with a thousands dot = 8245
                sheet.issues.append(Issue("warning", "declared_amount",
                                          f"'{d.label}' ostidagi summa {d.amount}, hisoblanganda {total}", d.cell))


def check_workbook(sheets: list[SheetResult]) -> list[Issue]:
    """An IMEI may appear only once in the whole file (one phone cannot be at two customers)."""
    where: dict[str, list[str]] = {}
    for s in sheets:
        for item in s.items:
            if item.imei:
                where.setdefault(item.imei, []).append(f"{s.name} {item.cell}")
    issues = []
    for imei, places in where.items():
        sheets_with = {p.rsplit(" ", 1)[0] for p in places}
        if len(sheets_with) > 1:
            issues.append(Issue("error", "imei_cross_sheet",
                                f"IMEI {imei} bir nechta mijozda: {', '.join(places)}"))
    return issues


def report_date(sheets: list[SheetResult], fallback: date | None) -> date | None:
    """The date most sheets carry; a stale sheet (e.g. a shop updated weekly) does not decide it."""
    dates = Counter(s.sheet_date for s in sheets if s.sheet_date and s.has_data)
    if not dates:
        dates = Counter(s.sheet_date for s in sheets if s.sheet_date)
    return dates.most_common(1)[0][0] if dates else fallback


def date_from_filename(name: str) -> date | None:
    if m := _FULL_DATE.search(name or ""):
        return _make_date(m.group(1), m.group(2), m.group(3), 2000)
    return None
