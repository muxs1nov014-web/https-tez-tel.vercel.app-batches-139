import { useQuery } from '@tanstack/react-query';
import type { LineIn, LineOut } from '../../api/batches';
import type { Settings } from '../../api/settings';
import { getTariffEstimate, tariffKeys } from '../../api/tariffs';
import type { ISODate } from '../../api/types';
import type { PreviewLineInput } from '../../lib/costing';
import {
  fractionToPercentInput,
  numToInput,
  parseInputNumber,
  percentInputToFraction,
} from '../../lib/format';

/** Per-unit USD cost fields on a purchase line (perevod is a percent, rastamojka is separate). */
export const PER_UNIT_FIELDS = [
  { key: 'cargo', label: 'Kargo' },
  { key: 'imei', label: 'IMEI' },
  { key: 'airport_road', label: "Yo'l kira (aeroport)" },
  { key: 'inspector', label: 'Inspektor' },
  { key: 'bu', label: 'B/U xarajat' },
  { key: 'packaging', label: 'Upakovka' },
  { key: 'sim', label: 'SIM' },
] as const;

export type PerUnitField = (typeof PER_UNIT_FIELDS)[number]['key'];

/** Form state for one purchase line. Numbers are kept as input strings. */
export interface LineDraft {
  key: string;
  product_id: number | null;
  channel_id: number | null;
  qty: string;
  price_aed: string;
  rate: string;
  /** Percent units in the UI (1 = 1%); sent as a fraction. */
  perevod_pct: string;
  cargo: string;
  imei: string;
  airport_road: string;
  inspector: string;
  bu: string;
  packaging: string;
  sim: string;
  rastamojka: string;
  /** True once the user typed a rastamojka value: stop auto-filling from the tariff. */
  rastamojka_manual: boolean;
  is_client: boolean;
  client_id: number | null;
  /** Percent units in the UI. */
  service_pct: string;
  note: string;
}

export type LineDraftPatch = Partial<Omit<LineDraft, 'key'>>;

export type DraftErrorKey =
  | 'product_id'
  | 'qty'
  | 'price_aed'
  | 'rate'
  | 'perevod_pct'
  | PerUnitField
  | 'rastamojka'
  | 'client_id'
  | 'service_pct';

export type DraftErrors = Partial<Record<DraftErrorKey, string>>;

let keySeq = 0;
export function newDraftKey(): string {
  keySeq += 1;
  return `line-${keySeq}`;
}

export function emptyDraft(settings: Settings | undefined, channelId: number | null): LineDraft {
  return {
    key: newDraftKey(),
    product_id: null,
    channel_id: channelId,
    qty: '',
    price_aed: '',
    rate: numToInput(settings?.default_rate ?? 3.67),
    perevod_pct: fractionToPercentInput(settings?.default_perevod_pct ?? 0.01),
    cargo: numToInput(settings?.default_cargo ?? 0),
    imei: numToInput(settings?.default_imei ?? 0),
    airport_road: '0',
    inspector: '0',
    bu: '0',
    packaging: '0',
    sim: '0',
    rastamojka: '',
    rastamojka_manual: false,
    is_client: false,
    client_id: null,
    service_pct: '',
    note: '',
  };
}

/** Copy of a draft for "duplicate line": same costs, new product. */
export function duplicateDraft(d: LineDraft): LineDraft {
  return { ...d, key: newDraftKey(), product_id: null, rastamojka: '', rastamojka_manual: false };
}

export function draftFromLine(line: LineOut): LineDraft {
  const e = line.estimates;
  return {
    key: newDraftKey(),
    product_id: line.product.id,
    channel_id: line.channel?.id ?? null,
    qty: String(line.qty),
    price_aed: numToInput(line.price_aed),
    rate: numToInput(line.rate),
    perevod_pct: fractionToPercentInput(e.perevod_pct),
    cargo: numToInput(e.cargo),
    imei: numToInput(e.imei),
    airport_road: numToInput(e.airport_road),
    inspector: numToInput(e.inspector),
    bu: numToInput(e.bu),
    packaging: numToInput(e.packaging),
    sim: numToInput(e.sim),
    rastamojka: numToInput(e.rastamojka),
    rastamojka_manual: true,
    is_client: line.client !== null,
    client_id: line.client?.id ?? null,
    service_pct: fractionToPercentInput(line.service_pct),
    note: line.note ?? '',
  };
}

function checkNonNegative(errors: DraftErrors, key: DraftErrorKey, text: string, required = false) {
  const n = parseInputNumber(text);
  if (n === undefined) {
    if (required || text.trim() !== '') errors[key] = required ? 'Kiriting' : "Son noto'g'ri";
  } else if (n < 0) {
    errors[key] = "Manfiy bo'lmasin";
  }
}

export function validateDraft(d: LineDraft): DraftErrors {
  const errors: DraftErrors = {};
  if (d.product_id === null) errors.product_id = 'Mahsulotni tanlang';

  const qty = parseInputNumber(d.qty);
  if (qty === undefined || !Number.isInteger(qty) || qty <= 0) errors.qty = 'Butun son > 0';

  const price = parseInputNumber(d.price_aed);
  if (price === undefined || price <= 0) errors.price_aed = 'Narx > 0';

  const rate = parseInputNumber(d.rate);
  if (rate === undefined || rate <= 0) errors.rate = 'Kurs > 0';

  checkNonNegative(errors, 'perevod_pct', d.perevod_pct);
  if (!errors.perevod_pct && (parseInputNumber(d.perevod_pct) ?? 0) > 100) errors.perevod_pct = '≤ 100%';
  for (const f of PER_UNIT_FIELDS) checkNonNegative(errors, f.key, d[f.key]);
  checkNonNegative(errors, 'rastamojka', d.rastamojka);

  if (d.is_client) {
    if (d.client_id === null) errors.client_id = 'Mijozni tanlang';
    checkNonNegative(errors, 'service_pct', d.service_pct);
    if (!errors.service_pct && (parseInputNumber(d.service_pct) ?? 0) > 100) errors.service_pct = '≤ 100%';
  }
  return errors;
}

export function hasErrors(errors: DraftErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Blank cost input = 0, exactly as the live preview counts it (never a hidden server default). */
function costOrZero(text: string): number {
  return parseInputNumber(text) ?? 0;
}

/**
 * Assumes `validateDraft` passed. Every cost is sent explicitly, except a blank
 * rastamojka, which is omitted so the server applies the tariff estimate
 * (on create; on PATCH it stays unchanged unless product/channel changed).
 */
export function draftToLineIn(d: LineDraft): LineIn {
  const line: LineIn = {
    product_id: d.product_id ?? 0,
    channel_id: d.channel_id,
    qty: parseInputNumber(d.qty) ?? 0,
    price_aed: parseInputNumber(d.price_aed) ?? 0,
    rate: parseInputNumber(d.rate),
    perevod_pct: percentInputToFraction(d.perevod_pct) ?? 0,
    cargo: costOrZero(d.cargo),
    imei: costOrZero(d.imei),
    airport_road: costOrZero(d.airport_road),
    inspector: costOrZero(d.inspector),
    bu: costOrZero(d.bu),
    packaging: costOrZero(d.packaging),
    sim: costOrZero(d.sim),
    rastamojka: parseInputNumber(d.rastamojka),
    client_id: d.is_client ? d.client_id : null,
    service_pct: d.is_client ? (percentInputToFraction(d.service_pct) ?? null) : null,
    note: d.note.trim() === '' ? null : d.note.trim(),
  };
  // Undefined keys are dropped by JSON.stringify, so "omitted" really is omitted in the body.
  return line;
}

/** Numbers for the live estimate preview; invalid input counts as 0. */
export function draftToPreview(d: LineDraft): PreviewLineInput {
  const n = (text: string) => parseInputNumber(text) ?? 0;
  return {
    qty: n(d.qty),
    price_aed: n(d.price_aed),
    rate: n(d.rate),
    perevod_pct: percentInputToFraction(d.perevod_pct) ?? 0,
    cargo: n(d.cargo),
    imei: n(d.imei),
    airport_road: n(d.airport_road),
    inspector: n(d.inspector),
    bu: n(d.bu),
    packaging: n(d.packaging),
    sim: n(d.sim),
    rastamojka: n(d.rastamojka),
    service_pct: d.is_client ? (percentInputToFraction(d.service_pct) ?? 0) : null,
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Rastamojka estimate for (product, channel, date) — cached per combination. */
export function useTariffEstimate(productId: number | null, channelId: number | null, date: ISODate) {
  const params = { product_id: productId ?? 0, channel_id: channelId, date };
  return useQuery({
    queryKey: tariffKeys.estimate(params),
    queryFn: () => getTariffEstimate(params),
    enabled: productId !== null && ISO_DATE.test(date),
    staleTime: 5 * 60_000,
  });
}
