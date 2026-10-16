import type { ReactNode } from 'react';

interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Tables go edge to edge; forms get padding. */
  padded?: boolean;
}

/**
 * Apple "grouped" section: the heading and its actions sit above a rounded content box,
 * like the groups in macOS System Settings.
 */
export function Card({ title, subtitle, actions, children, className = '', padded = false }: CardProps) {
  return (
    <section className={className}>
      {(title || actions) && (
        <header className="mb-2.5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-1">
          <div className="min-w-0">
            {title && <h2 className="text-[17px] font-semibold leading-snug tracking-[-0.022em] text-slate-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 max-w-3xl text-[13px] leading-snug text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div
        className={`rounded-[18px] bg-surface shadow-card dark:shadow-none dark:ring-1 dark:ring-white/[0.06] ${
          padded ? 'p-5' : ''
        }`}
      >
        {children}
      </div>
    </section>
  );
}

/** Horizontal scroll wrapper for wide tables. */
export function TableWrap({ children, className = '' }: { children: ReactNode; className?: string }) {
  // At the edges of a card, round the matching corners so row hover / footer fills follow the box.
  return (
    <div className={`overflow-x-auto first:rounded-t-[18px] last:rounded-b-[18px] ${className}`}>{children}</div>
  );
}
