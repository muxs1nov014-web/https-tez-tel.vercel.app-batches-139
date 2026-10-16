import { http } from './client';

/** Batch cost message to Telegram (SPEC §17): chats tried, delivered, failed. */
export interface NotifyResult {
  recipients: number;
  sent: number;
  failed: number;
  /** Of `failed`: blocked the bot or gone, so skipped from now on. */
  blocked: number;
  /** Picked but already known to be unreachable: not tried. */
  skipped: number;
}

export interface TelegramGroup {
  chat_id: number;
  title: string;
}

export interface NotifyConfig {
  /** Groups/channels (or private IDs) offered in the batch page picker next to the active bot users. */
  chat_ids: string[];
  bot_configured: boolean;
  /** Groups the bot has seen messages in, to pick an ID from. */
  groups: TelegramGroup[];
}

export interface NotifyConfigIn {
  chat_ids: string[];
}

/** A chat the batch page picker offers: configured groups/channels and active bot users. */
export interface Recipient {
  chat_id: string;
  name: string;
  kind: 'user' | 'group' | 'channel';
  /** Blocked the bot or is gone: not sent to until it writes to the bot again. */
  blocked: boolean;
}

export const telegramKeys = {
  notify: ['telegram', 'notify'] as const,
  recipients: ['telegram', 'recipients'] as const,
};

export function listRecipients(): Promise<Recipient[]> {
  return http.get<Recipient[]>('/telegram/recipients');
}

export function getNotifyConfig(): Promise<NotifyConfig> {
  return http.get<NotifyConfig>('/telegram/notify');
}

export function putNotifyConfig(body: NotifyConfigIn): Promise<NotifyConfig> {
  return http.put<NotifyConfig>('/telegram/notify', body);
}

/** Only to the picked chats (from listRecipients). */
export function notifyBatch(batchId: number, chatIds: string[]): Promise<NotifyResult> {
  return http.post<NotifyResult>(`/batches/${batchId}/notify`, { chat_ids: chatIds });
}

/** Toast text for a send result. */
export function notifyResultText(r: NotifyResult): string {
  const parts: string[] = [];
  if (r.recipients > 0) {
    if (r.failed === 0) parts.push(`Telegramga yuborildi (${r.sent} ta chat)`);
    else if (r.sent === 0) parts.push(`Telegramga yuborilmadi (${r.recipients} ta chat)`);
    else parts.push(`Telegram: ${r.recipients} ta chatdan ${r.sent} tasiga yetdi`);
  }
  if (r.blocked > 0) parts.push(`${r.blocked} ta chat botni bloklagan yoki o'chirgan — unga endi yuborilmaydi`);
  if (r.skipped > 0) parts.push(`${r.skipped} ta bloklangan chat o'tkazib yuborildi`);
  return parts.join('. ');
}
