import { useLayoutEffect, useRef, type ComponentType, type ReactNode } from 'react';
import { TINTS, type Tint } from '../../lib/tints';

interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  valueClassName?: string;
  /** Optional glyph shown in a coloured squircle next to the label (Apple widget style). */
  icon?: ComponentType<{ className?: string }>;
  tint?: Tint;
}

export function StatCard({ label, value, sub, valueClassName = 'text-slate-900', icon: Icon, tint = 'blue' }: StatCardProps) {
  return (
    <div className="rounded-[18px] bg-surface px-5 pb-4 pt-4 shadow-card dark:shadow-none dark:ring-1 dark:ring-white/[0.06]">
      <div className="flex items-center gap-2 text-[13px] font-medium text-slate-500">
        {Icon && (
          <span
            className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] bg-gradient-to-b text-white shadow-glyph [&>svg]:stroke-[2] ${TINTS[tint]}`}
          >
            <Icon className="h-[13px] w-[13px]" />
          </span>
        )}
        <span className="leading-snug">{label}</span>
      </div>
      <FitValue className={`mt-2.5 text-[26px] font-semibold leading-none tracking-[-0.03em] tabular-nums ${valueClassName}`}>
        {value}
      </FitValue>
      {sub && <div className="mt-2 text-[12px] leading-snug text-slate-500">{sub}</div>}
    </div>
  );
}

const MIN_FONT_PX = 14;

/**
 * One-line value that shrinks its font to fit the card (like `adjustsFontSizeToFitWidth` on iOS),
 * so large sums stay exact and never wrap or get clipped on phones.
 */
function FitValue({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let lastWidth = -1;
    const fit = () => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      el.style.fontSize = '';
      const ratio = el.clientWidth / el.scrollWidth;
      if (ratio < 1) {
        const base = parseFloat(getComputedStyle(el).fontSize);
        el.style.fontSize = `${Math.max(MIN_FONT_PX, Math.floor(base * ratio * 0.98))}px`;
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children]);

  return (
    <div ref={ref} className={`overflow-hidden text-ellipsis whitespace-nowrap ${className}`}>
      {children}
    </div>
  );
}
