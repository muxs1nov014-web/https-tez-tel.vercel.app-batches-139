import type { Role } from '../api/types';

/**
 * Single source of truth for role-based UI. A control whose action the user
 * lacks is not rendered. Mirrors SPEC §2 / §8 and CONVENTIONS ("writes require
 * operator; users, bot users, settings and deletes require admin").
 */
export type Action =
  | 'catalog.write' // products, tariffs, customers
  | 'tariffs.delete'
  | 'channels.write'
  | 'settings.write'
  | 'batches.write' // create batch, edit header, add/edit lines, add expenses
  | 'batches.delete'
  | 'batchLines.delete' // treated as batch editing (operator+)
  | 'expenses.delete' // treated as batch editing (operator+)
  | 'sales.write'
  | 'sales.delete'
  | 'stock.write' // opening balance, adjustments
  | 'customerMoves.write' // customer warehouse: handover, return, reported sale (SPEC §12)
  | 'customerMoves.delete'
  | 'customerPayments.write' // payments and opening debt
  | 'customerPayments.delete'
  | 'imports.run'
  | 'nasiya.review' // daily nasiya workbooks: upload, rescan, link sheets, confirm, reject (SPEC §18)
  | 'nasiya.force' // confirm a workbook that still has errors
  | 'nasiya.delete'
  | 'users.manage'
  | 'botUsers.manage';

const OPERATOR: Role[] = ['admin', 'operator'];
const ADMIN: Role[] = ['admin'];

const RULES: Record<Action, Role[]> = {
  'catalog.write': OPERATOR,
  'tariffs.delete': ADMIN,
  'channels.write': ADMIN,
  'settings.write': ADMIN,
  'batches.write': OPERATOR,
  'batches.delete': ADMIN,
  'batchLines.delete': OPERATOR,
  'expenses.delete': OPERATOR,
  'sales.write': OPERATOR,
  'sales.delete': ADMIN,
  'stock.write': OPERATOR,
  'customerMoves.write': OPERATOR,
  'customerMoves.delete': ADMIN,
  'customerPayments.write': OPERATOR,
  'customerPayments.delete': ADMIN,
  'imports.run': OPERATOR,
  'nasiya.review': OPERATOR,
  'nasiya.force': ADMIN,
  'nasiya.delete': ADMIN,
  'users.manage': ADMIN,
  'botUsers.manage': ADMIN,
};

export function canRole(role: Role | null | undefined, action: Action): boolean {
  if (!role) return false;
  return RULES[action].includes(role);
}
