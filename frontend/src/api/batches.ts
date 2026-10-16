import { http } from './client';
import type {
  CategoryCode,
  CategoryLevel,
  ExpenseKind,
  ISODate,
  ISODateTime,
  Num,
  Ref,
} from './types';

export interface BatchSummary {
  id: number;
  batch_date: ISODate;
  code: string | null;
  note: string | null;
  total_qty: number;
  own_qty: number;
  client_qty: number;
  /** Σ price_usd × qty over all lines. */
  price_usd_total: Num;
  /** Σ unit_cost_est × qty. */
  cost_est_total: Num;
  /** Σ unit_cost × qty (effective). */
  cost_total: Num;
  overhead_per_unit_avg: Num;
  has_actuals: boolean;
}

/**
 * Omitted numbers fall back to settings defaults; omitted `rastamojka` means
 * "tariff estimate". Percentages are fractions.
 */
export interface LineIn {
  product_id: number;
  channel_id?: number | null;
  qty: number;
  price_aed: number;
  rate?: number;
  perevod_pct?: number;
  cargo?: number;
  imei?: number;
  airport_road?: number;
  inspector?: number;
  bu?: number;
  packaging?: number;
  sim?: number;
  rastamojka?: number;
  client_id?: number | null;
  service_pct?: number | null;
  note?: string | null;
}

export type LinePatch = Partial<LineIn>;

export interface ExpenseIn {
  category: CategoryCode;
  kind: ExpenseKind;
  amount_usd: number;
  note?: string | null;
}

export interface BatchIn {
  batch_date: ISODate;
  code?: string | null;
  note?: string | null;
  lines: LineIn[];
  expenses: ExpenseIn[];
}

export interface BatchPatch {
  code?: string | null;
  note?: string | null;
}

export interface LineEstimates {
  perevod_pct: Num;
  cargo: Num;
  imei: Num;
  airport_road: Num;
  inspector: Num;
  bu: Num;
  packaging: Num;
  sim: Num;
  rastamojka: Num;
}

export interface CostPair {
  estimate: Num;
  effective: Num;
}

export interface LineChannel {
  id: number;
  code: string;
  name: string;
}

export interface LineOut {
  id: number;
  product: Ref;
  channel: LineChannel;
  qty: number;
  price_aed: Num;
  rate: Num;
  price_usd: Num;
  client: Ref | null;
  service_pct: Num | null;
  note: string | null;
  raw_name: string | null;
  estimates: LineEstimates;
  /** Per-unit USD by category code (line- and batch-level). */
  per_unit: Partial<Record<CategoryCode, CostPair>>;
  unit_cost_est: Num;
  unit_cost: Num;
  /** Per unit: unit_cost_est − price_usd. */
  overhead_est: Num;
  /** Per unit: unit_cost − price_usd. */
  overhead: Num;
  sold_qty: number;
  adjusted_qty: number;
  /** Units currently at customers (consignment, SPEC §12.2). Read as `?? 0`: older API responses omit it. */
  consigned_qty: number;
  /** qty − sold − adjusted − consigned. */
  remaining_qty: number;
}

export interface BatchExpense {
  id: number;
  category: CategoryCode;
  kind: ExpenseKind;
  amount_usd: Num;
  note: string | null;
  created_at: ISODateTime;
}

export interface BatchCategory {
  code: CategoryCode;
  label: string;
  level: CategoryLevel;
  estimate_total: Num;
  actual_total: Num | null;
  effective_total: Num;
}

/** Batch-wide sums (× qty), USD. */
export interface BatchTotals {
  price_usd: Num;
  cost_est: Num;
  cost: Num;
  overhead_est: Num;
  overhead: Num;
}

export interface BatchDetail {
  id: number;
  batch_date: ISODate;
  code: string | null;
  note: string | null;
  total_qty: number;
  lines: LineOut[];
  expenses: BatchExpense[];
  categories: BatchCategory[];
  totals: BatchTotals;
  warnings: string[];
}

export interface BatchFilter {
  date_from?: ISODate;
  date_to?: ISODate;
}

export const batchKeys = {
  all: ['batches'] as const,
  list: (filter: BatchFilter) => ['batches', 'list', filter] as const,
  detail: (id: number) => ['batches', 'detail', id] as const,
};

export function listBatches(filter: BatchFilter = {}): Promise<BatchSummary[]> {
  return http.get<BatchSummary[]>('/batches', {
    date_from: filter.date_from,
    date_to: filter.date_to,
  });
}

export function getBatch(id: number): Promise<BatchDetail> {
  return http.get<BatchDetail>(`/batches/${id}`);
}

export function createBatch(body: BatchIn): Promise<BatchDetail> {
  return http.post<BatchDetail>('/batches', body);
}

export function updateBatch(id: number, body: BatchPatch): Promise<BatchDetail> {
  return http.patch<BatchDetail>(`/batches/${id}`, body);
}

export function deleteBatch(id: number): Promise<void> {
  return http.delete(`/batches/${id}`);
}

export function addLine(batchId: number, body: LineIn): Promise<BatchDetail> {
  return http.post<BatchDetail>(`/batches/${batchId}/lines`, body);
}

export function updateLine(batchId: number, lineId: number, body: LinePatch): Promise<BatchDetail> {
  return http.patch<BatchDetail>(`/batches/${batchId}/lines/${lineId}`, body);
}

export function deleteLine(batchId: number, lineId: number): Promise<BatchDetail> {
  return http.delete<BatchDetail>(`/batches/${batchId}/lines/${lineId}`);
}

export function addExpense(batchId: number, body: ExpenseIn): Promise<BatchDetail> {
  return http.post<BatchDetail>(`/batches/${batchId}/expenses`, body);
}

export function deleteExpense(batchId: number, expenseId: number): Promise<BatchDetail> {
  return http.delete<BatchDetail>(`/batches/${batchId}/expenses/${expenseId}`);
}
