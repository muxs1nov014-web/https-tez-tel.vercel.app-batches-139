import { useCallback, useEffect, useState } from 'react';
import { syncTelegramChrome, telegramWebApp } from './telegram';

export type ThemePreference = 'light' | 'dark' | 'system';

/** Keep in sync with the inline script in index.html, which applies the theme before first paint. */
const STORAGE_KEY = 'telefon.theme';
const THEME_COLORS = { light: '#f5f5f7', dark: '#000000' } as const;

export function readThemePreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

/** "System" means Telegram's colour scheme inside the Mini App, otherwise the OS setting. */
function systemPrefersDark(): boolean {
  const telegram = telegramWebApp();
  if (telegram) return telegram.colorScheme === 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function applyTheme(preference: ThemePreference): void {
  const dark = preference === 'dark' || (preference === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[dark ? 'dark' : 'light']);
  syncTelegramChrome(dark);
}

/** Current preference plus a setter that persists it (best effort) and applies it immediately. */
export function useTheme(): [ThemePreference, (next: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference);

  useEffect(() => {
    applyTheme(preference);
    if (preference !== 'system' || !window.matchMedia) return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference]);

  const update = useCallback((next: ThemePreference) => {
    try {
      if (next === 'system') window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage may be unavailable (private mode); the choice still applies for this session.
    }
    setPreference(next);
  }, []);

  return [preference, update];
}
