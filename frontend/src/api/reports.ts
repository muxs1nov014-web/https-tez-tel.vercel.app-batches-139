import { http } from './client';
import type { ISODate, Num, Ref } from './types';

export interface DashboardMonthTotals {
  sales_qty: number;
  revenue: Num;
  profit: Num;
  /** Part of sales_qty / revenue from the nasiya files' Sotuv: no purchase cost, so not in profit. */
  nasiya_sales_qty: number;
  nasiya_revenue: Num;
  purchases_qty: number;
  purchases_usd: Num;
}

export interface DashboardMonthly {
  /** `YYYY-MM` (a full `YYYY-MM-DD` is tolerated). */
  month: string;
  purchases_qty: number;
  purchases_usd: Num;
  sales_qty: number;
  revenue: Num;
  profit: Num;
  nasiya_sales_qty: number;
  nasiya_revenue: Num;
}

export interface Dashboard {
  stock_qty: number;
  stock_value: Num;
  month: DashboardMonthTotals;
  monthly: DashboardMonthly[];
}

export type ProfitGroupBy = 'product' | 'customer' | 'day' | 'month';

export interface ProfitRow {
  key: string;
  label: string;
  qty: number;
  revenue: Num;
  cost: Num;
  profit: Num;
}

export interface BatchVarianceRow {
  batch_id: number;
  batch_date: ISODate;
  qty: number;
  cost_est: Num;
  cost: Num;
  /** cost − cost_est (positive = real costs exceeded the estimate). */
  diff: Num;
  diff_per_unit: Num;
}

export interface UnitCostRow {
  batch_date: ISODate;
  qty: number;
  price_usd: Num;
  overhead: Num;
  unit_cost: Num;
}

export interface ClientServiceRow {
  customer: Ref;
  batch_date: ISODate;
  product: Ref;
  qty: number;
  price_usd: Num;
  unit_cost_est: Num;
  service_fee_per_unit: Num;
  charge_per_unit: Num;
  charge_total: Num;
  cost_total: Num;
  margin: Num;
}

export interface DateRange {
  date_from?: ISODate;
  date_to?: ISODate;
}

export const reportKeys = {
  all: ['reports'] as const,
  dashboard: ['reports', 'dashboard'] as const,
  profit: (range: DateRange, groupBy: ProfitGroupBy) => ['reports', 'profit', range, groupBy] as const,
  variance: (range: DateRange) => ['reports', 'batch-variance', range] as const,
  unitCost: (productId: number) => ['reports', 'unit-cost', productId] as const,
  clients: (range: DateRange, customerId: number | null) =>
    ['reports', 'clients', range, customerId] as const,
};

export function getDashboard(): Promise<Dashboard> {
  return http.get<Dashboard>('/reports/dashboard');
}

export function getProfitReport(range: DateRange, groupBy: ProfitGroupBy): Promise<ProfitRow[]> {
  return http.get<ProfitRow[]>('/reports/profit', { ...range, group_by: groupBy });
}

export function getBatchVariance(range: DateRange): Promise<BatchVarianceRow[]> {
  return http.get<BatchVarianceRow[]>('/reports/batch-variance', { ...range });
}

export function getUnitCostHistory(productId: number): Promise<UnitCostRow[]> {
  return http.get<UnitCostRow[]>('/reports/unit-cost', { product_id: productId });
}

export function getClientsReport(
  range: DateRange,
  customerId: number | null,
): Promise<ClientServiceRow[]> {
  return http.get<ClientServiceRow[]>('/reports/clients', {
    ...range,
    customer_id: customerId,
  });
}
