import { http } from './client';
import type { Role } from './types';

export interface User {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  /** Linked Telegram account for Mini App sign-in (admin sets it on the users page). */
  telegram_id?: number | null;
}

export interface LoginIn {
  username: string;
  password: string;
}

export interface LoginOut {
  access_token: string;
  token_type: string;
  user: User;
}

export const authKeys = {
  me: ['auth', 'me'] as const,
};

export function login(body: LoginIn): Promise<LoginOut> {
  return http.login<LoginOut>('/auth/login', body);
}

/** Mini App sign-in: the backend verifies Telegram's signed initData (SPEC §13.3). */
export function loginTelegram(initData: string): Promise<LoginOut> {
  return http.login<LoginOut>('/auth/telegram', { init_data: initData });
}

export function getMe(): Promise<User> {
  return http.get<User>('/auth/me');
}

export interface MePatch {
  /** Always required: the user re-enters the current password. */
  current_password: string;
  username?: string;
  password?: string;
}

/** Own login and/or password change. */
export function updateMe(body: MePatch): Promise<User> {
  return http.patch<User>('/auth/me', body);
}
