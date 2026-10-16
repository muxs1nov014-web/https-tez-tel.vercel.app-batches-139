import { http } from './client';
import type { ISODate, Num, Ref } from './types';

export interface StockLine {
  purchase_line_id: number;
  batch_id: number;
  batch_date: ISODate;
  remaining_qty: number;
  unit_cost: Num;
}

export interface StockItem {
  product: Ref;
  qty: number;
  avg_unit_cost: Num;
  stock_value: Num;
  lines: StockLine[];
}

export interface OpeningBalanceItem {
  product_id: number;
  qty: number;
}

export interface OpeningBalanceIn {
  as_of_date: ISODate;
  items: OpeningBalanceItem[];
}

export interface OpeningBalanceResult {
  product_id: number;
  kept: number;
  written_off: number;
}

/** `opening_balance` adjustments are created only by the opening-balance endpoint. */
export type AdjustmentReason = 'writeoff' | 'correction';

export interface AdjustmentIn {
  purchase_line_id: number;
  /** > 0; reduces remaining stock (remaining = qty − sold − adjusted). */
  qty: number;
  reason: AdjustmentReason;
  note?: string | null;
}

export const stockKeys = {
  all: ['stock'] as const,
  list: (q: string) => ['stock', 'list', q] as const,
};

export function listStock(q?: string): Promise<StockItem[]> {
  return http.get<StockItem[]>('/stock', { q });
}

export function postOpeningBalance(body: OpeningBalanceIn): Promise<OpeningBalanceResult[]> {
  return http.post<OpeningBalanceResult[]>('/stock/opening-balance', body);
}

export function postAdjustment(body: AdjustmentIn): Promise<{ id: number }> {
  return http.post<{ id: number }>('/stock/adjustments', body);
}
