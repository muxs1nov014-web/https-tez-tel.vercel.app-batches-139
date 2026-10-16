import { http } from './client';
import type { CustomerKind } from './types';

export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  kind: CustomerKind;
  note: string | null;
  is_active: boolean;
}

export interface CustomerIn {
  name: string;
  phone?: string | null;
  kind: CustomerKind;
  note?: string | null;
}

export interface CustomerPatch extends Partial<CustomerIn> {
  is_active?: boolean;
}

export interface CustomerFilter {
  q?: string;
  kind?: CustomerKind;
}

export const customerKeys = {
  all: ['customers'] as const,
  list: (filter: CustomerFilter) => ['customers', 'list', filter] as const,
};

export function listCustomers(filter: CustomerFilter = {}): Promise<Customer[]> {
  return http.get<Customer[]>('/customers', { q: filter.q, kind: filter.kind });
}

export function createCustomer(body: CustomerIn): Promise<Customer> {
  return http.post<Customer>('/customers', body);
}

export function updateCustomer(id: number, body: CustomerPatch): Promise<Customer> {
  return http.patch<Customer>(`/customers/${id}`, body);
}
