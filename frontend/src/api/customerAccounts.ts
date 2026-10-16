/**
 * Customer warehouses, debts and payments (SPEC §12.4).
 *
 * Each customer is a separate warehouse: goods handed over on consignment stay
 * ours until the customer reports them sold. A reported sale (and any normal
 * sale to the customer) creates debt; payments lower it.
 */
import { http } from './client';
import type { SaleDetail, SaleSummary } from './sales';
import type { CustomerKind, ISODate, ISODateTime, Num, Ref } from './types';

export type MoveKind = 'out' | 'return';

export type PaymentKind = 'payment' | 'opening_debt';

export type LedgerEntryType = 'opening_debt' | 'sale' | 'service' | 'payment';

export interface CustomerRef {
  id: number;
  name: string;
  kind: CustomerKind;
}

export interface CustomerBalance {
  customer: CustomerRef;
  /** Opening debt + sales + client-service charges − payments. */
  debt: Num;
  /** Units currently held by the customer (ours until sold). */
  stock_qty: number;
  stock_value_cost: Num;
  /** At the agreed price of each line's latest handover (falls back to unit cost). */
  stock_value_price: Num;
  /** debt + stock_value_price. */
  exposure: Num;
  sales_month_qty: number;
  sales_month_revenue: Num;
  last_payment_date: ISODate | null;
}

export interface CustomerTotals {
  opening_debt: Num;
  charged_sales: Num;
  charged_service: Num;
  paid: Num;
  given_qty: number;
  returned_qty: number;
  sold_qty: number;
}

export interface CustomerOverview {
  balance: CustomerBalance;
  totals: CustomerTotals;
}

export interface CustomerStockLine {
  purchase_line_id: number;
  batch_date: ISODate;
  qty: number;
  unit_cost: Num;
  price_usd: Num | null;
}

export interface CustomerStockItem {
  product: Ref;
  qty: number;
  avg_unit_cost: Num;
  value_cost: Num;
  /** Latest agreed price for this product (pre-fills "Sotildi"). */
  price_usd: Num | null;
  value_price: Num;
  lines: CustomerStockLine[];
}

export interface ConsignmentMoveLine {
  product: Ref;
  qty: number;
  price_usd: Num | null;
}

export interface ConsignmentMove {
  id: number;
  move_date: ISODate;
  kind: MoveKind;
  note: string | null;
  total_qty: number;
  total_value: Num | null;
  created_at: ISODateTime;
  lines: ConsignmentMoveLine[];
}

export interface ConsignmentMoveLineIn {
  product_id: number;
  /** > 0; the direction comes from `kind`. */
  qty: number;
  /** Required (> 0) for `out`, ignored for `return`. */
  price_usd?: number | null;
}

export interface ConsignmentMoveIn {
  move_date: ISODate;
  kind: MoveKind;
  note?: string | null;
  lines: ConsignmentMoveLineIn[];
}

export interface ConsignmentSaleLineIn {
  product_id: number;
  qty: number;
  price_usd: number;
}

export interface ConsignmentSaleIn {
  sale_date: ISODate;
  note?: string | null;
  lines: ConsignmentSaleLineIn[];
}

export interface CustomerPayment {
  id: number;
  payment_date: ISODate;
  amount_usd: Num;
  kind: PaymentKind;
  note: string | null;
  created_at: ISODateTime;
}

export interface CustomerPaymentIn {
  payment_date: ISODate;
  amount_usd: number;
  kind: PaymentKind;
  note?: string | null;
}

export interface LedgerEntry {
  date: ISODate;
  type: LedgerEntryType;
  /** Sale id for `sale`; other types may carry their own reference or null. */
  ref_id: number | null;
  description: string;
  /** Increases the debt. */
  debit: Num;
  /** Lowers the debt. */
  credit: Num;
  /** Running debt after this entry. */
  balance: Num;
}

/**
 * Nested under `['customers']`, so saving a customer (which invalidates
 * `customerKeys.all`) also refreshes balances.
 */
export const customerAccountKeys = {
  summary: ['customers', 'summary'] as const,
  all: ['customers', 'account'] as const,
  detail: (id: number) => ['customers', 'account', id] as const,
  overview: (id: number) => ['customers', 'account', id, 'overview'] as const,
  stock: (id: number) => ['customers', 'account', id, 'stock'] as const,
  moves: (id: number) => ['customers', 'account', id, 'moves'] as const,
  sales: (id: number) => ['customers', 'account', id, 'sales'] as const,
  payments: (id: number) => ['customers', 'account', id, 'payments'] as const,
  ledger: (id: number) => ['customers', 'account', id, 'ledger'] as const,
};

export function listCustomerBalances(): Promise<CustomerBalance[]> {
  return http.get<CustomerBalance[]>('/customers/summary');
}

export function getCustomerOverview(id: number): Promise<CustomerOverview> {
  return http.get<CustomerOverview>(`/customers/${id}/overview`);
}

export function getCustomerStock(id: number): Promise<CustomerStockItem[]> {
  return http.get<CustomerStockItem[]>(`/customers/${id}/stock`);
}

export function listCustomerMoves(id: number): Promise<ConsignmentMove[]> {
  return http.get<ConsignmentMove[]>(`/customers/${id}/moves`);
}

export function createCustomerMove(id: number, body: ConsignmentMoveIn): Promise<ConsignmentMove> {
  return http.post<ConsignmentMove>(`/customers/${id}/moves`, body);
}

export function deleteCustomerMove(id: number, moveId: number): Promise<void> {
  return http.delete(`/customers/${id}/moves/${moveId}`);
}

export function createConsignmentSale(id: number, body: ConsignmentSaleIn): Promise<SaleDetail> {
  return http.post<SaleDetail>(`/customers/${id}/consignment-sales`, body);
}

export function listCustomerSales(id: number): Promise<SaleSummary[]> {
  return http.get<SaleSummary[]>(`/customers/${id}/sales`);
}

export function listCustomerPayments(id: number): Promise<CustomerPayment[]> {
  return http.get<CustomerPayment[]>(`/customers/${id}/payments`);
}

export function createCustomerPayment(id: number, body: CustomerPaymentIn): Promise<CustomerPayment> {
  return http.post<CustomerPayment>(`/customers/${id}/payments`, body);
}

export function deleteCustomerPayment(id: number, paymentId: number): Promise<void> {
  return http.delete(`/customers/${id}/payments/${paymentId}`);
}

export function getCustomerLedger(id: number): Promise<LedgerEntry[]> {
  return http.get<LedgerEntry[]>(`/customers/${id}/ledger`);
}
