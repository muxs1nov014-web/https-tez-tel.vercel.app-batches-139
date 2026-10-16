import type { ReactNode } from 'react';
import { DATE_PRESETS, type DateRangeValue } from '../../lib/dates';

/**
 * iOS Form rows for iPhone filters, meant to sit inside a `ListSection`: a label on the left and a
 * menu-style picker or compact date pills on the right. Desktop keeps `DateRangeFilter` and selects.
 * (Candidates for components/ui once other screens need them.)
 */

const ROW = 'relative flex min-h-[48px] items-center gap-3 pl-4 pr-4';
const LABEL = 'shrink-0 text-[17px] tracking-[-0.025em] text-slate-900';
/** Inset hairline like ListRow; ListSection hides it on the last row. */
const SEP = 'list-sep pointer-events-none absolute bottom-0 left-4 right-0 h-[0.5px] bg-slate-200';

interface PickerRowProps<K extends string> {
  label: string;
  value: K;
  options: { key: K; label: string }[];
  onChange: (key: K) => void;
}

/** Menu picker: the current choice in secondary colour with up/down chevrons (global select style). */
export function PickerRow<K extends string>({ label, value, options, onChange }: PickerRowProps<K>) {
  return (
    <li>
      <label className={ROW}>
        <span className={`flex-1 ${LABEL}`}>{label}</span>
        <select
          value={value}
          onChange={(e) => {
            const next = options.find((o) => o.key === e.target.value);
            if (next) onChange(next.key);
          }}
          className="min-w-0 max-w-[62%] cursor-pointer truncate border-0 bg-transparent py-2 pl-2 pr-7 text-right text-[17px] tracking-[-0.025em] text-slate-500 focus:outline-none focus-visible:text-primary-600"
        >
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <span className={SEP} />
      </label>
    </li>
  );
}

/** A row with a label and any control on the right. */
export function ControlRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li>
      <div className={ROW}>
        <span className={`flex-1 ${LABEL}`}>{label}</span>
        {children}
        <span className={SEP} />
      </div>
    </li>
  );
}

const CUSTOM = 'custom';

function presetKey(value: DateRangeValue): string {
  const match = DATE_PRESETS.find((p) => {
    const r = p.range();
    return r.date_from === value.date_from && r.date_to === value.date_to;
  });
  return match?.key ?? CUSTOM;
}

/** iOS compact date picker: a grey rounded pill holding the date. */
const DATE_PILL =
  'h-[34px] w-[132px] rounded-[8px] border-0 bg-slate-200/60 px-2 text-center text-[16px] tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500/40';

/** Period picker (presets, "Boshqa" when the dates are custom) and the two dates under it. */
export function RangeRows({ value, onChange }: { value: DateRangeValue; onChange: (value: DateRangeValue) => void }) {
  const current = presetKey(value);
  const options = [
    ...DATE_PRESETS.map((p) => ({ key: p.key, label: p.label })),
    ...(current === CUSTOM ? [{ key: CUSTOM, label: 'Boshqa' }] : []),
  ];
  return (
    <>
      <PickerRow
        label="Davr"
        value={current}
        options={options}
        onChange={(key) => {
          const preset = DATE_PRESETS.find((p) => p.key === key);
          if (preset) onChange(preset.range());
        }}
      />
      <li>
        <div className={`${ROW} justify-between py-2`}>
          <input
            type="date"
            aria-label="Sanadan"
            value={value.date_from}
            max={value.date_to || undefined}
            onChange={(e) => onChange({ ...value, date_from: e.target.value })}
            className={DATE_PILL}
          />
          <span className="text-slate-400">—</span>
          <input
            type="date"
            aria-label="Sanagacha"
            value={value.date_to}
            min={value.date_from || undefined}
            onChange={(e) => onChange({ ...value, date_to: e.target.value })}
            className={DATE_PILL}
          />
          <span className={SEP} />
        </div>
      </li>
    </>
  );
}
