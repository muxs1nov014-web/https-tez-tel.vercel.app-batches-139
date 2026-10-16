import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { XIcon } from './icons';

type ToastTone = 'success' | 'danger' | 'info';

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Colour of the status dot; the toast itself is a neutral frosted card. */
const TONES: Record<ToastTone, string> = {
  success: 'bg-success-500',
  danger: 'bg-danger-500',
  info: 'bg-primary-500',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current++;
      setItems((prev) => [...prev.slice(-3), { id, tone, message }]);
      window.setTimeout(() => dismiss(id), tone === 'danger' ? 6000 : 3500);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('danger', m),
      info: (m) => push('info', m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-5 z-50 flex w-[340px] max-w-[calc(100vw-2.5rem)] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex animate-sheet-in items-start gap-2.5 rounded-[16px] bg-surface/85 px-4 py-3 text-[13.5px] text-slate-900 shadow-pop backdrop-blur-2xl backdrop-saturate-150 dark:bg-slate-100/85 dark:ring-1 dark:ring-white/10"
          >
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONES[t.tone]}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">{t.message}</div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="opacity-60 hover:opacity-100"
              aria-label="Yopish"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
