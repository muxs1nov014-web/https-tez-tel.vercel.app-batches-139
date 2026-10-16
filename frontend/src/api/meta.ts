import { http } from './client';
import type { CategoryCode, CategoryLevel } from './types';

export interface Category {
  code: CategoryCode;
  label: string;
  level: CategoryLevel;
}

export const metaKeys = {
  categories: ['meta', 'categories'] as const,
};

export function listCategories(): Promise<Category[]> {
  return http.get<Category[]>('/meta/categories');
}
