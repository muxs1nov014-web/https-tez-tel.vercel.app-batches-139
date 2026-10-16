import type { ReactNode } from 'react';
import type { TooltipProps } from 'recharts';
import { chartColors } from '../../lib/chartColors';
import { fmtMonth } from '../../lib/format';

/**
 * Apple Health / Stocks chart styling for Recharts: no axis lines or ticks, dotted horizontal
 * gridlines, the value axis on the right, rounded bars and a translucent popover tooltip.
 * Recharts needs its own components as direct children, so this module exports prop presets and
 * HTML pieces (panel, legend, tooltip) rather than wrapped chart components.
 */

/** One plotted series: the SVG colour for Recharts and the matching Tailwind class for HTML dots. */
export interface Series {
  key: string;
  name: string;
  color: string;
  dotClass: string;
}

export const SERIES_COLORS = {
  blue: { color: chartColors.primary, dotClass: 'bg-primary-500' },
  green: { color: chartColors.success, dotClass: 'bg-success-500' },
  orange: { color: chartColors.warning, dotClass: 'bg-warning-500' },
  gray: { color: chartColors.muted, dotClass: 'bg-slate-400' },
} as const;

const tick = { fontSize: 11, fill: chartColors.axis };

export const gridProps = {
  vertical: false,
  stroke: chartColors.grid,
  strokeDasharray: '2 4',
};

export const xAxisProps = {
  tick,
  tickLine: false,
  axisLine: false,
  tickMargin: 8,
  minTickGap: 6,
  interval: 'preserveStartEnd' as const,
};

export const yAxisProps = {
  tick,
  tickLine: false,
  axisLine: false,
  tickMargin: 6,
  tickCount: 4,
};

/** Bar cursor: a soft rounded column behind the hovered month. */
export const barCursor = { fill: chartColors.grid, fillOpacity: 0.55, radius: 6 };
/** Line cursor: a thin vertical rule. */
export const lineCursor = { stroke: chartColors.muted, strokeWidth: 1, strokeDasharray: '3 3' };

export const BAR_RADIUS: [number, number, number, number] = [5, 5, 5, 5];

/** `2026-09` → `Sen` for compact month ticks (the tooltip shows the full month). */
export function monthTick(value: string): string {
  return fmtMonth(value).split(' ')[0];
}

/** Axis label: `950`, `1.15k`, `2.5k`, `25k`, `2.4M` (enough decimals that close ticks never repeat). */
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  const trim = (n: number, decimals: number) => n.toFixed(decimals).replace(/\.?0+$/, '');
  if (abs >= 1_000_000) return `${trim(value / 1_000_000, 2)}M`;
  if (abs >= 100_000) return `${Math.round(value / 1_000)}k`;
  if (abs >= 1_000) return `${trim(value / 1_000, abs >= 10_000 ? 1 : 2)}k`;
  return String(Math.round(value));
}

/** True when every value of every series is zero (or the data is empty). */
export function allZero<T>(rows: T[], keys: ((row: T) => number)[]): boolean {
  return rows.every((row) => keys.every((get) => get(row) === 0));
}

interface ChartPanelProps {
  title: ReactNode;
  subtitle?: ReactNode;
  legend?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Widget-style card (Health): heading and summary inside the card, chart below. */
export function ChartPanel({ title, subtitle, legend, children, className = '' }: ChartPanelProps) {
  return (
    <section
      className={`rounded-[18px] bg-surface px-4 pb-3 pt-4 shadow-card dark:shadow-none dark:ring-1 dark:ring-white/[0.06] sm:px-5 sm:pt-5 ${className}`}
    >
      <h2 className="text-[17px] font-semibold leading-snug tracking-[-0.022em] text-slate-900">{title}</h2>
      {subtitle && <p className="mt-0.5 text-[13px] leading-snug text-slate-500">{subtitle}</p>}
      {legend && <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2.5">{legend}</div>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

interface LegendItemProps {
  series: Series;
  value: ReactNode;
  unit?: ReactNode;
}

/** Health-style summary: coloured dot and series name over its total. */
export function LegendItem({ series, value, unit }: LegendItemProps) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500">
        <span className={`h-2 w-2 shrink-0 rounded-full ${series.dotClass}`} aria-hidden="true" />
        {series.name}
      </div>
      <div className="mt-0.5 whitespace-nowrap text-[19px] font-semibold leading-tight tracking-[-0.025em] text-slate-900 tabular-nums">
        {value}
        {unit && <span className="ml-1 text-[13px] font-medium tracking-normal text-slate-500">{unit}</span>}
      </div>
    </div>
  );
}

type ChartTooltipProps = TooltipProps<number, string> & {
  series: Series[];
  format: (value: number, key: string) => string;
  /** Turns the category value into the tooltip heading (default: long month name). */
  heading?: (label: string) => string;
};

/** Translucent popover with one line per series, like the Health app's selection callout. */
export function ChartTooltip({ active, payload, label, series, format, heading }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const title = typeof label === 'string' ? (heading ? heading(label) : fmtMonth(label, true)) : '';
  return (
    <div className="min-w-[168px] rounded-[12px] bg-surface/95 px-3 py-2.5 shadow-pop backdrop-blur-xl dark:bg-slate-100/95 dark:ring-1 dark:ring-white/10">
      <div className="mb-1.5 text-[12px] font-semibold text-slate-900">{title}</div>
      <div className="space-y-1">
        {payload.map((entry) => {
          const key = String(entry.dataKey ?? '');
          const s = series.find((x) => x.key === key);
          const value = typeof entry.value === 'number' ? entry.value : 0;
          return (
            <div key={key} className="flex items-center justify-between gap-4 text-[12px]">
              <span className="flex items-center gap-1.5 text-slate-500">
                <span className={`h-2 w-2 rounded-full ${s?.dotClass ?? 'bg-slate-400'}`} aria-hidden="true" />
                {s?.name ?? entry.name}
              </span>
              <span className="font-semibold text-slate-900 tabular-nums">{format(value, key)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
