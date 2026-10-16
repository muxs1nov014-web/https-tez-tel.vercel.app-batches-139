import { http } from './client';
import type { Num } from './types';

/** Percentages are fractions: customs_rate 0.176 = 17.6%, default_perevod_pct 0.01 = 1%. */
export interface Settings {
  customs_rate: Num;
  default_rate: Num;
  default_perevod_pct: Num;
  default_imei: Num;
  default_cargo: Num;
  /** Batch expense estimates (USD per batch) pre-filled on the new-purchase form. */
  default_batch_certificate: Num;
  default_batch_dubai_internal: Num;
  default_batch_customs_invoice: Num;
  default_batch_customs_duty: Num;
  default_batch_customs_cash: Num;
  default_batch_declarant: Num;
}

export type BatchExpenseDefaultKey = Extract<keyof Settings, `default_batch_${string}`>;

export const BATCH_EXPENSE_DEFAULT_KEYS: BatchExpenseDefaultKey[] = [
  'default_batch_certificate',
  'default_batch_dubai_internal',
  'default_batch_customs_invoice',
  'default_batch_customs_duty',
  'default_batch_customs_cash',
  'default_batch_declarant',
];

/** Settings key holding the default estimate for a batch-level category, if any. */
export function batchExpenseDefaultKey(code: string): BatchExpenseDefaultKey | null {
  const key = `default_batch_${code}`;
  return BATCH_EXPENSE_DEFAULT_KEYS.find((k) => k === key) ?? null;
}

export const settingsKeys = {
  all: ['settings'] as const,
};

export function getSettings(): Promise<Settings> {
  return http.get<Settings>('/settings');
}

export function updateSettings(body: Settings): Promise<Settings> {
  return http.put<Settings>('/settings', body);
}
