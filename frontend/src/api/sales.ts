import { http } from './client';
import type { ISODate, Num, Ref } from './types';

/** `consignment` = reported sold from a customer's warehouse (SPEC §12). */
export type SaleSource = 'stock' | 'consignment';

export interface SaleSummary {
  id: number;
  sale_date: ISODate;
  customer: Ref | null;
  source: SaleSource;
  total_qty: number;
  revenue: Num;
  cost: Num;
  profit: Num;
}

export interface SaleLineIn {
  product_id: number;
  qty: number;
  price_usd: number;
  /** Optional override: allocate only from this batch. */
  batch_id?: number | null;
}

export interface SaleIn {
  sale_date: ISODate;
  customer_id?: number | null;
  note?: string | null;
  lines: SaleLineIn[];
}

export interface SaleAllocation {
  purchase_line_id: number;
  batch_date: ISODate;
  qty: number;
  unit_cost: Num;
}

export interface SaleLineOut {
  id: number;
  product: Ref;
  qty: number;
  price_usd: Num;
  revenue: Num;
  cost: Num;
  profit: Num;
  allocations: SaleAllocation[];
}

export interface SaleTotals {
  qty: number;
  revenue: Num;
  cost: Num;
  profit: Num;
}

export interface SaleDetail {
  id: number;
  sale_date: ISODate;
  customer: Ref | null;
  source: SaleSource;
  note: string | null;
  lines: SaleLineOut[];
  totals: SaleTotals;
}

export interface SaleFilter {
  date_from?: ISODate;
  date_to?: ISODate;
  customer_id?: number;
  /** Server default is 500. */
  limit?: number;
}

export const saleKeys = {
  all: ['sales'] as const,
  list: (filter: SaleFilter) => ['sales', 'list', filter] as const,
  detail: (id: number) => ['sales', 'detail', id] as const,
};

export function listSales(filter: SaleFilter = {}): Promise<SaleSummary[]> {
  return http.get<SaleSummary[]>('/sales', {
    date_from: filter.date_from,
    date_to: filter.date_to,
    customer_id: filter.customer_id,
    limit: filter.limit,
  });
}

export function getSale(id: number): Promise<SaleDetail> {
  return http.get<SaleDetail>(`/sales/${id}`);
}

export function createSale(body: SaleIn): Promise<SaleDetail> {
  return http.post<SaleDetail>('/sales', body);
}

export function deleteSale(id: number): Promise<void> {
  return http.delete(`/sales/${id}`);
}
