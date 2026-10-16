import { http } from './client';
import type { ISODate, Num } from './types';

export interface Tariff {
  id: number;
  brand: string;
  model: string;
  storage: string;
  base_price_usd: Num;
  valid_from: ISODate;
}

export interface TariffIn {
  brand: string;
  model: string;
  storage: string;
  base_price_usd: number;
  valid_from: ISODate;
}

export type TariffPatch = Partial<TariffIn>;

export interface TariffEstimate {
  base_price_usd: Num | null;
  customs_rate: Num;
  customs_factor: Num;
  rastamojka: Num;
}

export interface TariffEstimateParams {
  product_id: number;
  channel_id?: number | null;
  date: ISODate;
}

export const tariffKeys = {
  all: ['tariffs'] as const,
  estimate: (params: TariffEstimateParams) => ['tariffs', 'estimate', params] as const,
};

export function listTariffs(): Promise<Tariff[]> {
  return http.get<Tariff[]>('/tariffs');
}

export function createTariff(body: TariffIn): Promise<Tariff> {
  return http.post<Tariff>('/tariffs', body);
}

export function updateTariff(id: number, body: TariffPatch): Promise<Tariff> {
  return http.patch<Tariff>(`/tariffs/${id}`, body);
}

export function deleteTariff(id: number): Promise<void> {
  return http.delete(`/tariffs/${id}`);
}

export function getTariffEstimate(params: TariffEstimateParams): Promise<TariffEstimate> {
  return http.get<TariffEstimate>('/tariffs/estimate', {
    product_id: params.product_id,
    channel_id: params.channel_id,
    date: params.date,
  });
}
