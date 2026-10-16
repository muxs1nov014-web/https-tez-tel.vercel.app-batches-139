import type { QueryParams } from './types';

const API_BASE = '/api';
const TOKEN_KEY = 'telefon.access_token';

export const tokenStorage = {
  get(): string | null {
    try {
      return window.localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string): void {
    window.localStorage.setItem(TOKEN_KEY, token);
  },
  clear(): void {
    window.localStorage.removeItem(TOKEN_KEY);
  },
};

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

let unauthorizedHandler: (() => void) | null = null;

/** Registered by the auth provider: called on any 401 (except the login call itself). */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

const STATUS_MESSAGES: Record<number, string> = {
  400: "So'rov noto'g'ri",
  401: 'Sessiya tugagan. Qaytadan kiring',
  403: "Bu amal uchun ruxsat yo'q",
  404: 'Topilmadi',
  409: "Amalni bajarib bo'lmadi: ma'lumotlar ziddiyati",
  422: "Kiritilgan ma'lumotlar noto'g'ri",
  500: 'Serverda xatolik yuz berdi',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeValidationItem(item: unknown): string {
  if (!isRecord(item)) return String(item);
  const msg = typeof item.msg === 'string' ? item.msg : JSON.stringify(item);
  const loc = Array.isArray(item.loc)
    ? item.loc.filter((part) => part !== 'body' && part !== 'query').join('.')
    : '';
  return loc ? `${loc}: ${msg}` : msg;
}

function extractDetail(body: unknown, status: number): string {
  const fallback = STATUS_MESSAGES[status] ?? `Xatolik (${status})`;
  if (!isRecord(body) || !('detail' in body)) return fallback;
  const detail = body.detail;
  if (typeof detail === 'string' && detail.trim() !== '') return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    return detail.map(describeValidationItem).join('; ');
  }
  if (isRecord(detail)) {
    if (typeof detail.message === 'string') return detail.message;
    if (typeof detail.msg === 'string') return detail.msg;
    return JSON.stringify(detail);
  }
  return fallback;
}

function buildUrl(path: string, query?: QueryParams): string {
  let url = API_BASE + path;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      params.append(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  return url;
}

interface RequestOptions {
  query?: QueryParams;
  body?: unknown;
  form?: FormData;
  /** Do not treat 401 as an expired session (used by the login call). */
  skipAuthRedirect?: boolean;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = tokenStorage.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), { method, headers, body });
  } catch {
    throw new ApiError(0, "Serverga ulanib bo'lmadi. Internet aloqasini tekshiring");
  }

  const text = await response.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }

  if (!response.ok) {
    if (response.status === 401 && !options.skipAuthRedirect) {
      tokenStorage.clear();
      unauthorizedHandler?.();
    }
    throw new ApiError(response.status, extractDetail(parsed, response.status));
  }

  return parsed as T;
}

export const http = {
  get<T>(path: string, query?: QueryParams): Promise<T> {
    return request<T>('GET', path, { query });
  },
  post<T>(path: string, body?: unknown, query?: QueryParams): Promise<T> {
    return request<T>('POST', path, { body, query });
  },
  put<T>(path: string, body?: unknown): Promise<T> {
    return request<T>('PUT', path, { body });
  },
  patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>('PATCH', path, { body });
  },
  delete<T = void>(path: string): Promise<T> {
    return request<T>('DELETE', path);
  },
  upload<T>(path: string, form: FormData, query?: QueryParams): Promise<T> {
    return request<T>('POST', path, { form, query });
  },
  login<T>(path: string, body: unknown): Promise<T> {
    return request<T>('POST', path, { body, skipAuthRedirect: true });
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error && error.message) return error.message;
  return "Noma'lum xatolik";
}
