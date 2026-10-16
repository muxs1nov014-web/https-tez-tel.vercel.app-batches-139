import { DATE_PRESETS, type DateRangeValue } from '../../lib/dates';
import { Input } from './Input';

interface DateRangeFilterProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  presets?: boolean;
}

export function DateRangeFilter({ value, onChange, presets = true }: DateRangeFilterProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5">
        <Input
          type="date"
          aria-label="Sanadan"
          value={value.date_from}
          max={value.date_to || undefined}
          onChange={(e) => onChange({ ...value, date_from: e.target.value })}
          className="w-36"
        />
        <span className="text-slate-400">—</span>
        <Input
          type="date"
          aria-label="Sanagacha"
          value={value.date_to}
          min={value.date_from || undefined}
          onChange={(e) => onChange({ ...value, date_to: e.target.value })}
          className="w-36"
        />
      </div>
      {presets && (
        <div className="flex flex-wrap gap-1">
          {DATE_PRESETS.map((p) => {
            const r = p.range();
            const active = r.date_from === value.date_from && r.date_to === value.date_to;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => onChange(r)}
                className={`h-7 rounded-full px-3 text-xs font-medium transition-colors ${
                  active ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
