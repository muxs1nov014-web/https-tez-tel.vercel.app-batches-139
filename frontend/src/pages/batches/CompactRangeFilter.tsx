import { DATE_PRESETS, type DateRangeValue } from '../../lib/dates';

interface CompactRangeFilterProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
}

/**
 * iPhone version of `DateRangeFilter`: the presets as a full-width capsule segmented control and the two
 * dates as grey pills (iOS compact date picker). Same presets and value shape as the desktop filter.
 */
export function CompactRangeFilter({ value, onChange }: CompactRangeFilterProps) {
  return (
    <div className="space-y-2.5">
      <div className="flex rounded-full bg-slate-300/40 p-[2px]" role="radiogroup" aria-label="Davr">
        {DATE_PRESETS.map((p) => {
          const r = p.range();
          const active = r.date_from === value.date_from && r.date_to === value.date_to;
          return (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(r)}
              className={`h-[30px] min-w-0 flex-1 truncate rounded-full px-1 text-[13px] tracking-[-0.01em] text-slate-900 transition-all duration-200 ${
                active ? 'bg-surface font-semibold shadow-raised dark:bg-slate-400' : 'font-medium active:opacity-60'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <DatePill
          label="Sanadan"
          value={value.date_from}
          max={value.date_to || undefined}
          onChange={(date_from) => onChange({ ...value, date_from })}
        />
        <span className="text-slate-400" aria-hidden="true">
          —
        </span>
        <DatePill
          label="Sanagacha"
          value={value.date_to}
          min={value.date_from || undefined}
          onChange={(date_to) => onChange({ ...value, date_to })}
        />
      </div>
    </div>
  );
}

interface DatePillProps {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}

/**
 * Native date input dressed as an iOS date pill. The picker indicator is stretched over the whole pill so a tap
 * anywhere opens the picker; while empty, the caption stands in for the browser's "dd/mm/yyyy" mask.
 */
function DatePill({ label, value, min, max, onChange }: DatePillProps) {
  const empty = value === '';
  return (
    <label className="relative block min-w-0 flex-1">
      <input
        type="date"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className={`peer relative h-9 w-full appearance-none rounded-[10px] border-0 bg-slate-300/40 px-2 text-center text-[16px] tabular-nums tracking-[-0.02em] focus:outline-none focus:ring-2 focus:ring-primary-500/40 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-auto [&::-webkit-calendar-picker-indicator]:w-auto [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-date-and-time-value]:text-center ${
          empty ? 'text-transparent focus:text-slate-900' : 'text-slate-900'
        }`}
      />
      {empty && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[16px] peer-focus:hidden tracking-[-0.02em] text-slate-500">
          {label}
        </span>
      )}
    </label>
  );
}
