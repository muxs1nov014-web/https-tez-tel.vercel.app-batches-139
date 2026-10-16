import type { Category } from '../api/meta';
import type { LedgerEntryType, MoveKind, PaymentKind } from '../api/customerAccounts';
import type { SaleSource } from '../api/sales';
import type { CategoryCode, CustomerKind, ExpenseKind, Role } from '../api/types';

/** SPEC §4 — used as a fallback until `GET /meta/categories` is loaded, and for ordering. */
export const CATEGORY_FALLBACK: Category[] = [
  { code: 'perevod', label: 'Perevod', level: 'line' },
  { code: 'cargo', label: 'Kargo', level: 'line' },
  { code: 'imei', label: 'IMEI', level: 'line' },
  { code: 'airport_road', label: "Yo'l kira (aeroport)", level: 'line' },
  { code: 'inspector', label: 'Inspektor', level: 'line' },
  { code: 'bu', label: 'B/U xarajat', level: 'line' },
  { code: 'packaging', label: 'Upakovka', level: 'line' },
  { code: 'sim', label: 'SIM', level: 'line' },
  { code: 'rastamojka', label: 'Rastamojka', level: 'line' },
  { code: 'certificate', label: 'Sertifikat', level: 'batch' },
  { code: 'dubai_internal', label: 'Dubay ichki', level: 'batch' },
  { code: 'customs_invoice', label: 'Schet bojxona', level: 'batch' },
  { code: 'customs_duty', label: 'Bojxona boji', level: 'batch' },
  { code: 'customs_cash', label: 'Naqd bojxona', level: 'batch' },
  { code: 'declarant', label: 'Deklarant / hujjatlar', level: 'batch' },
];

export function categoryLabel(code: CategoryCode | string, categories?: Category[]): string {
  const list = categories && categories.length > 0 ? categories : CATEGORY_FALLBACK;
  return list.find((c) => c.code === code)?.label ?? code;
}

export const LEVEL_LABELS: Record<Category['level'], string> = {
  line: 'Qator (dona)',
  batch: 'Partiya',
};

export const EXPENSE_KIND_LABELS: Record<ExpenseKind, string> = {
  estimate: 'Taxminiy',
  actual: 'Real',
};

export const CUSTOMER_KIND_LABELS: Record<CustomerKind, string> = {
  dealer: 'Diler',
  client: 'Mijoz (xizmat)',
};

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrator',
  operator: 'Operator',
  viewer: 'Kuzatuvchi',
};

export const MOVE_KIND_LABELS: Record<MoveKind, string> = {
  out: 'Berildi',
  return: 'Qaytarildi',
};

export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  payment: "To'lov",
  opening_debt: "Boshlang'ich qarz",
};

export const LEDGER_TYPE_LABELS: Record<LedgerEntryType, string> = {
  opening_debt: "Boshlang'ich qarz",
  sale: 'Sotuv',
  service: 'Xizmat haqi',
  payment: "To'lov",
};

export const SALE_SOURCE_LABELS: Record<SaleSource, string> = {
  stock: 'Ombordan',
  consignment: 'Mijoz omboridan',
};
