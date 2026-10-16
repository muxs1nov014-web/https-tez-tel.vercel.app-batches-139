/** Narrow no-break space: a thin thousands separator that never wraps. */
const THIN = ' ';
const MINUS = '−';
const DASH = '—';

/** Formatters also accept numeric strings (form inputs, defensive parsing). */
type Maybe = number | string | null | undefined;

/** Decimal (string or number) → number. Blank or invalid → 0. */
export function toNum(value: Maybe): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isBlank(value: Maybe): value is null | undefined | '' {
  return value === null || value === undefined || value === '';
}

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
}

/** Fixed decimals, thin-space thousands, `.` as decimal separator. */
export function fmtNumber(value: Maybe, decimals = 2): string {
  if (isBlank(value)) return DASH;
  const n = toNum(value);
  const fixed = Math.abs(n).toFixed(decimals);
  const [intPart, frac] = fixed.split('.');
  const negative = n < 0 && Number(fixed) !== 0;
  return (negative ? MINUS : '') + groupThousands(intPart) + (frac ? `.${frac}` : '');
}

interface MoneyOptions {
  /** Append the currency sign. Table cells usually omit it (the header names the unit). */
  symbol?: boolean;
  decimals?: number;
}

/** USD: 2 decimals, e.g. `1 730.25` or `1 730.25 $`. */
export function fmtUsd(value: Maybe, options: MoneyOptions = {}): string {
  const text = fmtNumber(value, options.decimals ?? 2);
  return options.symbol && text !== DASH ? `${text}${THIN}$` : text;
}

/**
 * USD in whole dollars with the cents always rounded up, e.g. 1954.56 → `1 955 $`, 1954.00 → `1 954 $`.
 * Cents are taken first, so float noise (1450.0000001) does not add a dollar.
 */
export function fmtUsdUp(value: Maybe): string {
  if (isBlank(value)) return DASH;
  // Whole cents half-up like the backend's Decimal ROUND_HALF_UP (toFixed would turn 1000.005 into 1000.00).
  const cents = Math.round(toNum(value) * 100 + 1e-6) / 100;
  return fmtUsd(Math.ceil(cents), { symbol: true, decimals: 0 });
}

/** AED: 2 decimals, e.g. `6 350.00 AED`. */
export function fmtAed(value: Maybe, options: MoneyOptions = {}): string {
  const text = fmtNumber(value, options.decimals ?? 2);
  return options.symbol && text !== DASH ? `${text}${THIN}AED` : text;
}

/** Quantity: integer with thousands separator. */
export function fmtQty(value: Maybe): string {
  return fmtNumber(value, 0);
}

/** Exchange rate: 2–4 decimals, trailing zeros trimmed beyond 2. */
export function fmtRate(value: Maybe): string {
  if (isBlank(value)) return DASH;
  const fixed = toNum(value).toFixed(4).replace(/0{1,2}$/, '');
  return fixed;
}

/** Fraction → percent: 0.176 → `17.6%`, 0.01 → `1%`. */
export function fmtPct(fraction: Maybe, maxDecimals = 3): string {
  if (isBlank(fraction)) return DASH;
  const pct = toNum(fraction) * 100;
  const text = pct.toFixed(maxDecimals).replace(/\.?0+$/, '');
  return `${text}%`;
}

/** Signed USD, e.g. `+12.50` / `−3.00`; used for differences. */
export function fmtSignedUsd(value: Maybe): string {
  if (isBlank(value)) return DASH;
  const n = toNum(value);
  const text = fmtUsd(n);
  return n > 0 && Number(Math.abs(n).toFixed(2)) !== 0 ? `+${text}` : text;
}

/** `YYYY-MM-DD` (or an ISO datetime) → `DD.MM.YYYY`, without timezone shifts. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

/** ISO datetime → `DD.MM.YYYY HH:mm` in the browser's timezone. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fmtDate(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const MONTHS_SHORT = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyun', 'Iyul', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'];
const MONTHS_LONG = [
  'Yanvar',
  'Fevral',
  'Mart',
  'Aprel',
  'May',
  'Iyun',
  'Iyul',
  'Avgust',
  'Sentabr',
  'Oktabr',
  'Noyabr',
  'Dekabr',
];

/** `YYYY-MM` or `YYYY-MM-DD` → `Sen 2026` (short) / `Sentabr 2026` (long). */
export function fmtMonth(value: string | null | undefined, long = false): string {
  if (!value) return DASH;
  const match = /^(\d{4})-(\d{2})/.exec(value);
  if (!match) return value;
  const idx = Number(match[2]) - 1;
  const names = long ? MONTHS_LONG : MONTHS_SHORT;
  return `${names[idx] ?? match[2]} ${match[1]}`;
}

/** CSS classes for a signed money value (profit, margin, variance). */
export function signClass(value: Maybe, invert = false): string {
  const n = toNum(value);
  if (Math.abs(n) < 0.005) return 'text-slate-500';
  const positive = invert ? n < 0 : n > 0;
  return positive ? 'text-success-700' : 'text-danger-600';
}

// ---- form helpers (inputs keep strings; conversion happens on submit) ----

/** Round away binary noise (17.6 / 100 → 0.176). */
export function roundTo(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

/** Decimal → plain input string: "264.0000" → "264". Blank → "". */
export function numToInput(value: Maybe): string {
  if (isBlank(value)) return '';
  return String(roundTo(toNum(value), 6));
}

/** Fraction → percent input string: 0.01 → "1". */
export function fractionToPercentInput(value: Maybe): string {
  if (isBlank(value)) return '';
  return String(roundTo(toNum(value) * 100, 6));
}

/** Percent input → fraction: "17.6" → 0.176. Blank → undefined. */
export function percentInputToFraction(text: string): number | undefined {
  const n = parseInputNumber(text);
  return n === undefined ? undefined : roundTo(n / 100, 8);
}

/** Input string → number; blank or invalid → undefined. Accepts `,` as decimal separator. */
export function parseInputNumber(text: string): number | undefined {
  const trimmed = text.trim().replace(/\s/g, '').replace(',', '.');
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}
