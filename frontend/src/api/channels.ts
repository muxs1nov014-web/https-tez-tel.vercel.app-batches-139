import { http } from './client';
import type { Num } from './types';

export interface Channel {
  id: number;
  code: string;
  name: string;
  /** Multiplier on the rastamojka estimate: cargo 1.0, hand 0.5. */
  customs_factor: Num;
}

export interface ChannelIn {
  code: string;
  name: string;
  customs_factor: number;
}

/** `code` cannot be changed after creation. */
export interface ChannelPatch {
  name?: string;
  customs_factor?: number;
}

export const channelKeys = {
  all: ['channels'] as const,
};

export function listChannels(): Promise<Channel[]> {
  return http.get<Channel[]>('/channels');
}

export function createChannel(body: ChannelIn): Promise<Channel> {
  return http.post<Channel>('/channels', body);
}

export function updateChannel(id: number, body: ChannelPatch): Promise<Channel> {
  return http.patch<Channel>(`/channels/${id}`, body);
}
