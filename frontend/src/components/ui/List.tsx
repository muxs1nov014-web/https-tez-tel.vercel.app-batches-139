import type { ComponentType, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { TINTS, type Tint } from '../../lib/tints';
import { ChevronRightIcon } from './icons';

/** iOS inset-grouped section (Settings style): small caps header, rounded group, footnote. */
export function ListSection({
  header,
  footer,
  children,
  className = '',
}: {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      {header && <h3 className="px-4 pb-[7px] text-[13px] uppercase leading-tight text-slate-500">{header}</h3>}
      <div className="overflow-hidden rounded-[18px] bg-surface shadow-card dark:shadow-none">
        <ul className="[&>li:last-child_.list-sep]:hidden">{children}</ul>
      </div>
      {footer && <p className="px-4 pt-[7px] text-[13px] leading-snug text-slate-500">{footer}</p>}
    </section>
  );
}

interface ListRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned value (secondary label colour unless `valueStrong`). */
  value?: ReactNode;
  valueStrong?: boolean;
  /** Text under the value, e.g. a unit. */
  valueSub?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  tint?: Tint;
  /** Custom leading view instead of an icon squircle. */
  leading?: ReactNode;
  to?: string;
  onClick?: () => void;
  chevron?: boolean;
  tone?: 'default' | 'danger' | 'primary';
  center?: boolean;
}

/** One cell: [icon] title / subtitle … value [›]. Separator is inset to the text column like UITableView. */
export function ListRow({
  title,
  subtitle,
  value,
  valueStrong = false,
  valueSub,
  icon: Icon,
  tint = 'blue',
  leading,
  to,
  onClick,
  chevron,
  tone = 'default',
  center = false,
}: ListRowProps) {
  const interactive = Boolean(to || onClick);
  const showChevron = chevron ?? Boolean(to);
  const toneClass = tone === 'danger' ? 'text-danger-600' : tone === 'primary' ? 'text-primary-600' : 'text-slate-900';
  const body = (
    <>
      {Icon && (
        <span
          className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] bg-gradient-to-b text-white shadow-glyph [&>svg]:stroke-[2] ${TINTS[tint]}`}
        >
          <Icon className="h-[17px] w-[17px]" />
        </span>
      )}
      {leading}
      <div className="relative flex min-h-[48px] min-w-0 flex-1 items-center gap-3 py-[10px] pr-4">
        <div className={`min-w-0 flex-1 ${center ? 'text-center' : ''}`}>
          <div className={`truncate text-[17px] leading-[22px] tracking-[-0.025em] ${toneClass}`}>{title}</div>
          {subtitle && <div className="mt-0.5 truncate text-[13px] leading-[18px] text-slate-500">{subtitle}</div>}
        </div>
        {(value !== undefined || valueSub) && (
          <div className="shrink-0 text-right tabular-nums">
            {value !== undefined && (
              <div
                className={`text-[17px] leading-[22px] tracking-[-0.025em] ${valueStrong ? 'font-semibold text-slate-900' : 'text-slate-500'}`}
              >
                {value}
              </div>
            )}
            {valueSub && <div className="mt-0.5 text-[12px] leading-4 text-slate-500">{valueSub}</div>}
          </div>
        )}
        {showChevron && <ChevronRightIcon className="h-[17px] w-[17px] shrink-0 text-slate-300 [&>path]:stroke-[2.2]" />}
        <span className="list-sep pointer-events-none absolute inset-x-0 bottom-0 h-[0.5px] bg-slate-200 dark:bg-slate-200" />
      </div>
    </>
  );
  const rowClass = `flex w-full items-center gap-3 pl-4 text-left ${
    interactive ? 'transition-colors active:bg-slate-200/70 lg:hover:bg-slate-100/70' : ''
  }`;
  return (
    <li>
      {to ? (
        <Link to={to} className={rowClass}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={rowClass}>
          {body}
        </button>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
    </li>
  );
}
