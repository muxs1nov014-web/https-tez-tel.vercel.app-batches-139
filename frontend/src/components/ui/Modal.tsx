import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { XIcon } from './icons';

type Size = 'sm' | 'md' | 'lg' | 'xl' | '2xl';

const SIZES: Record<Size, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-6xl',
};

interface ModalProps {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  size?: Size;
  children: ReactNode;
}

/**
 * The overlay scrolls, not the panel — so dropdowns inside the panel are never clipped.
 * Closes on Esc or the X button; not on backdrop click (forms would lose input).
 */
export function Modal({ open, title, subtitle, onClose, size = 'md', children }: ModalProps) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('overflow-hidden');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('overflow-hidden');
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-40 animate-fade-in overflow-y-auto bg-black/25 backdrop-blur-[6px]" role="dialog" aria-modal="true">
      {/* Phones: a bottom sheet with a grabber. sm+: a centred dialog. */}
      <div className="flex min-h-full items-end justify-center pt-10 sm:items-center sm:p-10">
        <div className={`w-full ${SIZES[size]} animate-sheet-in rounded-t-[18px] bg-surface shadow-pop dark:bg-slate-50 dark:ring-1 dark:ring-white/10 sm:rounded-[18px]`}>
          <div className="mx-auto mt-2 h-[5px] w-9 rounded-full bg-slate-300 sm:hidden" aria-hidden="true" />
          <div className="flex items-start justify-between gap-4 px-5 pb-2 pt-3 sm:px-6 sm:pt-5">
            <div className="min-w-0">
              <h2 className="text-[17px] font-semibold tracking-[-0.015em] text-slate-900">{title}</h2>
              {subtitle && <p className="mt-0.5 text-[12px] text-slate-500">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800"
              aria-label="Yopish"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ModalBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`px-5 py-4 sm:px-6 ${className}`}>{children}</div>;
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200/70 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:rounded-b-[18px] sm:px-6 sm:pb-4">
      {children}
    </div>
  );
}
