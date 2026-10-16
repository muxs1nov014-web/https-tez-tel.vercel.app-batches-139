import { http } from './client';
import type { ISODateTime } from './types';

export interface BotUser {
  id: number;
  telegram_id: number;
  full_name: string;
  is_active: boolean;
  created_at: ISODateTime;
}

export interface BotUserIn {
  telegram_id: number;
  full_name: string;
}

export interface BotUserPatch {
  full_name?: string;
  is_active?: boolean;
}

export const botUserKeys = {
  all: ['bot-users'] as const,
};

export function listBotUsers(): Promise<BotUser[]> {
  return http.get<BotUser[]>('/bot-users');
}

export function createBotUser(body: BotUserIn): Promise<BotUser> {
  return http.post<BotUser>('/bot-users', body);
}

export function updateBotUser(id: number, body: BotUserPatch): Promise<BotUser> {
  return http.patch<BotUser>(`/bot-users/${id}`, body);
}

export function deleteBotUser(id: number): Promise<void> {
  return http.delete(`/bot-users/${id}`);
}
