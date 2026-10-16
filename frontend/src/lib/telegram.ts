import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TAB_ROOT_PATHS } from '../components/layout/nav';

/**
 * Telegram Mini App glue. index.html loads telegram-web-app.js only when the page was opened from
 * Telegram, so outside Telegram every helper here is a no-op.
 */
interface TelegramBackButton {
  show(): void;
  hide(): void;
  onClick(callback: () => void): void;
  offClick(callback: () => void): void;
}

export interface TelegramWebApp {
  initData: string;
  /** "unknown" outside Telegram. */
  platform: string;
  colorScheme: 'light' | 'dark';
  version: string;
  ready(): void;
  expand(): void;
  isVersionAtLeast(version: string): boolean;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  disableVerticalSwipes?: () => void;
  onEvent(event: 'themeChanged', callback: () => void): void;
  BackButton: TelegramBackButton;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/** The WebApp object when running inside Telegram, else null. */
export function telegramWebApp(): TelegramWebApp | null {
  const app = window.Telegram?.WebApp;
  return app && app.platform && app.platform !== 'unknown' ? app : null;
}

/**
 * Signed launch data for auto-login. Telegram sends it for inline-button and link launches, but not for the
 * reply-keyboard "📱 Panel" button; there the login form is shown once and the session is remembered.
 */
export function telegramInitData(): string | null {
  return telegramWebApp()?.initData || null;
}

/** Match Telegram's header and background to our canvas colour so the app looks native. */
export function syncTelegramChrome(dark: boolean): void {
  const app = telegramWebApp();
  if (!app || !app.isVersionAtLeast('6.1')) return;
  const color = dark ? '#000000' : '#f5f5f7';
  try {
    app.setHeaderColor(color);
    app.setBackgroundColor(color);
  } catch {
    // Older clients accept only theme keys; the default header is fine there.
  }
}

/** Call once at startup, before the first render. */
export function initTelegram(onThemeChanged: () => void): void {
  const app = telegramWebApp();
  if (!app) return;
  app.ready();
  app.expand();
  // Keep vertical scrolling from collapsing the Mini App (Bot API 7.7+).
  if (app.isVersionAtLeast('7.7')) app.disableVerticalSwipes?.();
  app.onEvent('themeChanged', onThemeChanged);
}

/** Show Telegram's native back button on every page except the tab roots (iOS: roots have no back). */
export function useTelegramBackButton(): void {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const app = telegramWebApp();
    if (!app || !app.isVersionAtLeast('6.1')) return undefined;
    if (TAB_ROOT_PATHS.has(pathname)) {
      app.BackButton.hide();
      return undefined;
    }
    const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/'));
    app.BackButton.onClick(goBack);
    app.BackButton.show();
    return () => app.BackButton.offClick(goBack);
  }, [pathname, navigate]);
}
