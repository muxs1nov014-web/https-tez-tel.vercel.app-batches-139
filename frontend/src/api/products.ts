import { http } from './client';

export interface Product {
  id: number;
  brand: string;
  model: string;
  storage: string;
  color: string;
  variant: string | null;
  name: string;
  is_active: boolean;
}

export interface ProductIn {
  brand: string;
  model: string;
  storage: string;
  color: string;
  variant?: string | null;
}

export interface ProductPatch extends Partial<ProductIn> {
  is_active?: boolean;
}

export interface ProductFilter {
  q?: string;
  active?: boolean;
}

export const productKeys = {
  all: ['products'] as const,
  list: (filter: ProductFilter) => ['products', 'list', filter] as const,
};

export function listProducts(filter: ProductFilter = {}): Promise<Product[]> {
  return http.get<Product[]>('/products', { q: filter.q, active: filter.active });
}

export function createProduct(body: ProductIn): Promise<Product> {
  return http.post<Product>('/products', body);
}

export function updateProduct(id: number, body: ProductPatch): Promise<Product> {
  return http.patch<Product>(`/products/${id}`, body);
}
