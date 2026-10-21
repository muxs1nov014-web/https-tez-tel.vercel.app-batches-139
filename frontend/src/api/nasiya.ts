/**
 * Daily nasiya control (SPEC §18).
 *
 * Every day the "Telefon nasiya nazorat" Telegram group gets an Excel workbook: one sheet per customer, every
 * phone by IMEI as nasiya (debt), variant (long-term deal), qoldiq (our goods at the customer) or sotuv (paid
 * today). The bot turns it into a pending report; an operator links sheets to customers and confirms it.
 * Confirmed days feed the monitoring: day-to-day events by IMEI, debt age, limits and alerts.
 */
import { http } from './client';
import type { CustomerRef } from './customerAccounts';
import type { ISODate, ISODateTime, Num } from './types';

export type NasiyaStatus = 'pending' | 'confirmed' | 'rejected' | 'superseded' | 'invalid';
export type NasiyaKind = 'nasiya' | 'variant' | 'qoldiq' | 'sotuv';
export type NasiyaEventType =
  | 'new_debt'
  | 'qoldiq_to_debt'
  | 'paid'
  | 'sold_paid'
  | 'sold_direct'
  | 'handover'
  | 'vanished_debt'
  | 'vanished_qoldiq'
  | 'debt_to_qoldiq'
  | 'moved'
  | 'price_changed'
  | 'reopened';

export interface NasiyaIssue {
  /** 'error' blocks confirmation (an admin may still confirm); 'warning' does not. */
  level: 'error' | 'warning';
  code: string;
  message: string;
  /** Excel cell, e.g. `B14`. */
  cell: string;
}

export interface NasiyaDeclared {
  kind: string;
  label: string;
  qty: number | null;
  amount: Num | null;
  cell: string;
}

export interface NasiyaItem {
  id: number;
  kind: NasiyaKind;
  model: string;
  imei: string | null;
  qty: number;
  price_usd: Num | null;
  marked_date: ISODate | null;
  term_days: number | null;
  cell: string;
}

export interface NasiyaKindTotal {
  kind: NasiyaKind;
  qty: number;
  amount: Num;
}

/** The sheet's own panel (strings as written: numbers, or "yo'q"). */
export interface NasiyaSheetSummary {
  variant?: string;
  nasiya?: string;
  qoldiq?: string;
  jami?: string;
  limit?: string;
  available?: string;
  schedule?: { date: ISODate; amount: string }[];
}

export interface NasiyaSheet {
  id: number;
  position: number;
  name: string;
  customer: CustomerRef | null;
  suggested_customer: CustomerRef | null;
  sheet_date: ISODate | null;
  summary: NasiyaSheetSummary;
  declared: NasiyaDeclared[];
  issues: NasiyaIssue[];
  paid_note_usd: Num | null;
  error_count: number;
  warning_count: number;
  totals: NasiyaKindTotal[];
  items: NasiyaItem[];
}

export interface NasiyaReportSummary {
  id: number;
  report_date: ISODate | null;
  status: NasiyaStatus;
  source: 'telegram' | 'upload';
  file_name: string;
  chat_title: string;
  sent_by: string;
  item_count: number;
  /** Debt (nasiya + variant) phones in the file. */
  nasiya_qty: number;
  nasiya_usd: Num;
  qoldiq_qty: number;
  sotuv_qty: number;
  sotuv_usd: Num;
  error_count: number;
  warning_count: number;
  sheet_count: number;
  unlinked_sheets: number;
  created_at: ISODateTime;
  reviewed_at: ISODateTime | null;
  reviewed_by: string | null;
  review_note: string | null;
}

export interface NasiyaEvent {
  type: NasiyaEventType;
  alert: boolean;
  customer: CustomerRef | null;
  sheet_name: string;
  /** 'moved': the customer it was at before. */
  other_customer: CustomerRef | null;
  model: string;
  imei: string;
  price_usd: Num | null;
  previous_price_usd: Num | null;
}

export interface NasiyaEventCount {
  type: NasiyaEventType;
  alert: boolean;
  qty: number;
  amount: Num;
}

export interface NasiyaDiff {
  previous_report_id: number;
  previous_date: ISODate;
  counts: NasiyaEventCount[];
  events: NasiyaEvent[];
}

export interface NasiyaReportDetail extends NasiyaReportSummary {
  issues: NasiyaIssue[];
  sheets: NasiyaSheet[];
  /** Against the latest confirmed report before this date; null when none. */
  diff: NasiyaDiff | null;
}

export interface NasiyaAgingBucket {
  label: string;
  min_days: number;
  max_days: number | null;
  qty: number;
  amount: Num;
}

export interface NasiyaTotals {
  /** nasiya + variant */
  debt_usd: Num;
  debt_qty: number;
  nasiya_usd: Num;
  variant_usd: Num;
  qoldiq_qty: number;
  /** From the sheets' own panel (cost value); 0 when the sheets do not state it. */
  qoldiq_value_usd: Num;
  sotuv_usd: Num;
  sotuv_qty: number;
  overdue_qty: number;
  overdue_usd: Num;
}

export interface NasiyaCustomerRow {
  customer: CustomerRef;
  sheet_name: string;
  totals: NasiyaTotals;
  limit_usd: Num | null;
  /** debt + qoldiq value (the sheet's "Jami"). */
  exposure_usd: Num;
  available_usd: Num | null;
  over_limit: boolean;
  max_age_days: number | null;
  aging: NasiyaAgingBucket[];
  new_debt_usd: Num;
  paid_usd: Num;
  alert_count: number;
  /** The sheet's own "Nasiya" figure, to cross-check the IMEI sum. */
  file_nasiya_usd: Num | null;
  /** Debt in the panel's customer ledger (Mijozlar), for reconciliation. */
  panel_debt_usd: Num | null;
  error_count: number;
}

export interface NasiyaOverview {
  report: NasiyaReportSummary | null;
  previous_date: ISODate | null;
  totals: NasiyaTotals | null;
  previous_totals: NasiyaTotals | null;
  aging: NasiyaAgingBucket[];
  customers: NasiyaCustomerRow[];
  counts: NasiyaEventCount[];
  alerts: NasiyaEvent[];
  pending_reports: number;
  /** First confirmed day: an age that reaches it is a lower bound. */
  history_start: ISODate | null;
}

export interface NasiyaSeriesPoint {
  date: ISODate;
  report_id: number;
  debt_usd: Num;
  debt_qty: number;
  qoldiq_qty: number;
  sotuv_usd: Num;
  sotuv_qty: number;
}

export interface NasiyaPhone {
  kind: NasiyaKind;
  model: string;
  imei: string | null;
  qty: number;
  price_usd: Num | null;
  since: ISODate | null;
  /** false: already there on the first confirmed day, so the real date may be earlier. */
  since_exact: boolean;
  age_days: number | null;
  term_days: number | null;
  overdue: boolean;
  marked_date: ISODate | null;
}

export interface NasiyaPhoneRow extends NasiyaPhone {
  customer: CustomerRef | null;
  sheet_name: string;
}

export interface NasiyaPhones {
  report: NasiyaReportSummary | null;
  /** First confirmed day: an age that reaches it is a lower bound ("≥"). */
  history_start: ISODate | null;
  /** Oldest first. */
  rows: NasiyaPhoneRow[];
}

export type NasiyaPhoneGroup = 'debt' | 'qoldiq' | 'sotuv';

export interface NasiyaModelRow {
  kind: NasiyaKind;
  model: string;
  qty: number;
  amount: Num;
}

export interface NasiyaCustomerDetail {
  customer: CustomerRef;
  report: NasiyaReportSummary | null;
  row: NasiyaCustomerRow | null;
  items: NasiyaPhone[];
  models: NasiyaModelRow[];
  events: NasiyaEvent[];
  series: NasiyaSeriesPoint[];
  schedule: { date: ISODate; amount: string }[];
}

export interface NasiyaImeiTrailRow {
  date: ISODate;
  report_id: number;
  customer: CustomerRef | null;
  sheet_name: string;
  kind: NasiyaKind;
  model: string;
  price_usd: Num | null;
  cell: string;
}

export interface NasiyaUploadResult {
  file_name: string;
  report_id: number | null;
  report_date: ISODate | null;
  duplicate: boolean;
  error: string | null;
}

export interface NasiyaRescanResult {
  checked: number;
  created: number;
  skipped: number;
  failed: number;
  /** Group files still to read: call again while a call makes progress. */
  remaining: number;
  /** New reports confirmed automatically (no errors, every sheet linked). */
  confirmed: number;
}

export interface NasiyaBotGroup {
  chat_id: number;
  title: string;
  messages: number;
  excel_files: number;
  last_message_at: string | null;
  /** administrator, member, left, kicked; "unknown" when Telegram did not answer. */
  bot_status: string;
  error: string | null;
}

export interface NasiyaBotStatus {
  bot_username: string;
  can_read_all_group_messages: boolean;
  webhook_set: boolean;
  webhook_error: string | null;
  pending_updates: number;
  nasiya_chat_ids: number[];
  groups: NasiyaBotGroup[];
  /** Plain-language reasons files do not arrive; empty = fine. */
  problems: string[];
}

export interface NasiyaProcessResult {
  confirmed: number;
  superseded: number;
  /** "sheet → customer" links made by name. */
  linked: string[];
  waiting: { report_id: number; report_date: ISODate; file_name: string; reason: string }[];
}

export interface NasiyaMonthRow {
  /** First day of the month. */
  month: ISODate;
  days: number;
  first_date: ISODate;
  last_date: ISODate;
  /** The month starts the history: new debt on its first day is unknown. */
  partial: boolean;
  sotuv_qty: number;
  sotuv_usd: Num;
  new_debt_qty: number;
  new_debt_usd: Num;
  debt_qty_end: number;
  debt_usd_end: Num;
  qoldiq_qty_end: number;
}

export const nasiyaKeys = {
  all: ['nasiya'] as const,
  overview: (on?: ISODate) => ['nasiya', 'overview', on ?? null] as const,
  series: (days: number) => ['nasiya', 'series', days] as const,
  phones: (group?: NasiyaPhoneGroup) => ['nasiya', 'phones', group ?? null] as const,
  months: (customerId?: number) => ['nasiya', 'months', customerId ?? null] as const,
  customer: (id: number, on?: ISODate) => ['nasiya', 'customer', id, on ?? null] as const,
  reports: (status?: NasiyaStatus) => ['nasiya', 'reports', status ?? null] as const,
  report: (id: number) => ['nasiya', 'report', id] as const,
  imei: (imei: string) => ['nasiya', 'imei', imei] as const,
};

export function getNasiyaOverview(on?: ISODate): Promise<NasiyaOverview> {
  return http.get<NasiyaOverview>('/nasiya/overview', { on });
}

export function getNasiyaSeries(days = 90): Promise<NasiyaSeriesPoint[]> {
  return http.get<NasiyaSeriesPoint[]>('/nasiya/series', { days });
}

export function getNasiyaPhones(group?: NasiyaPhoneGroup): Promise<NasiyaPhones> {
  return http.get<NasiyaPhones>('/nasiya/phones', { group });
}

export function getNasiyaMonths(customerId?: number): Promise<NasiyaMonthRow[]> {
  return http.get<NasiyaMonthRow[]>('/nasiya/months', { customer_id: customerId });
}

export function getNasiyaCustomer(customerId: number, on?: ISODate): Promise<NasiyaCustomerDetail> {
  return http.get<NasiyaCustomerDetail>(`/nasiya/customers/${customerId}`, { on });
}

export function getImeiTrail(imei: string): Promise<NasiyaImeiTrailRow[]> {
  return http.get<NasiyaImeiTrailRow[]>(`/nasiya/imei/${encodeURIComponent(imei)}`);
}

export function listNasiyaReports(status?: NasiyaStatus): Promise<NasiyaReportSummary[]> {
  return http.get<NasiyaReportSummary[]>('/nasiya/reports', { status });
}

export function getNasiyaReport(reportId: number): Promise<NasiyaReportDetail> {
  return http.get<NasiyaReportDetail>(`/nasiya/reports/${reportId}`);
}

export function uploadNasiyaReport(file: File): Promise<NasiyaUploadResult> {
  const form = new FormData();
  form.append('file', file);
  return http.upload<NasiyaUploadResult>('/nasiya/reports/upload', form);
}

export function rescanNasiyaGroup(since?: ISODate): Promise<NasiyaRescanResult> {
  return http.post<NasiyaRescanResult>('/nasiya/reports/rescan', undefined, { since });
}

export function getNasiyaBotStatus(): Promise<NasiyaBotStatus> {
  return http.get<NasiyaBotStatus>('/nasiya/bot-status');
}

export function processNasiyaReports(since: ISODate | null): Promise<NasiyaProcessResult> {
  return http.post<NasiyaProcessResult>('/nasiya/reports/process', { since });
}

export function linkNasiyaSheet(reportId: number, sheetId: number, customerId: number): Promise<NasiyaReportDetail> {
  return http.put<NasiyaReportDetail>(`/nasiya/reports/${reportId}/sheets/${sheetId}`, { customer_id: customerId });
}

export function confirmNasiyaReport(
  reportId: number,
  body: { force?: boolean; note?: string | null } = {},
): Promise<NasiyaReportDetail> {
  return http.post<NasiyaReportDetail>(`/nasiya/reports/${reportId}/confirm`, body);
}

export function rejectNasiyaReport(reportId: number, note?: string | null): Promise<NasiyaReportDetail> {
  return http.post<NasiyaReportDetail>(`/nasiya/reports/${reportId}/reject`, { note: note ?? null });
}

export function deleteNasiyaReport(reportId: number): Promise<void> {
  return http.delete(`/nasiya/reports/${reportId}`);
}
