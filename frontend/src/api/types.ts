/**
 * Shared API primitives.
 *
 * `Num` marks a backend `Numeric`/`Decimal` field. It travels as a JSON number
 * rounded to at most 6 decimals (money is USD unless named `_aed`; percentages
 * are fractions, 0.01 = 1%). Display goes through `lib/format.ts`.
 */
export type Num = number;

/** Calendar date, `YYYY-MM-DD`. */
export type ISODate = string;

/** ISO datetime string. */
export type ISODateTime = string;

export interface Ref {
  id: number;
  name: string;
}

export type Role = 'admin' | 'operator' | 'viewer';

export type CategoryCode =
  | 'perevod'
  | 'cargo'
  | 'imei'
  | 'airport_road'
  | 'inspector'
  | 'bu'
  | 'packaging'
  | 'sim'
  | 'rastamojka'
  | 'certificate'
  | 'dubai_internal'
  | 'customs_invoice'
  | 'customs_duty'
  | 'customs_cash'
  | 'declarant';

export type CategoryLevel = 'line' | 'batch';

export type ExpenseKind = 'estimate' | 'actual';

export type CustomerKind = 'dealer' | 'client';

export type QueryParams = Record<string, string | number | boolean | null | undefined>;
