import { http } from './client';
import type { User } from './auth';
import type { Role } from './types';

export type { User };

export interface UserIn {
  username: string;
  password: string;
  full_name: string;
  role: Role;
  telegram_id?: number | null;
}

export interface UserPatch {
  full_name?: string;
  role?: Role;
  is_active?: boolean;
  password?: string;
  /** null unlinks the Telegram account. */
  telegram_id?: number | null;
}

export const userKeys = {
  all: ['users'] as const,
};

export function listUsers(): Promise<User[]> {
  return http.get<User[]>('/users');
}

export function createUser(body: UserIn): Promise<User> {
  return http.post<User>('/users', body);
}

export function updateUser(id: number, body: UserPatch): Promise<User> {
  return http.patch<User>(`/users/${id}`, body);
}
