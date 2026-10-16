import { http } from './client';
import type { ISODate } from './types';

export interface ImportBatch {
  batch_date: ISODate;
  /** Number of purchase lines in the batch. */
  lines: number;
  qty: number;
  status: 'new' | 'exists';
}

export interface ImportNewProduct {
  raw_name: string;
  name: string;
}

export interface ImportResult {
  batches: ImportBatch[];
  new_products: ImportNewProduct[];
  warnings: string[];
  created_batches: number;
  created_products: number;
}

export function importPurchases(file: File, dryRun: boolean): Promise<ImportResult> {
  const form = new FormData();
  form.append('file', file);
  return http.upload<ImportResult>('/imports/purchases', form, { dry_run: dryRun });
}
