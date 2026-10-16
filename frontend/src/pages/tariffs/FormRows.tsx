import type { ReactNode } from 'react';

/*
 * iPhone form rows for a `ListSection`: label on the left, control on the right, separator inset to the
 * text column like `ListRow`. `ListRow` has no trailing-control slot, hence these two cells.
 */

function RowShell({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <li>
      <label htmlFor={htmlFor} className="flex w-full items-center pl-4">
        <div className="relative flex min-h-[48px] min-w-0 flex-1 items-center gap-3 py-[7px] pr-4">
          {children}
          <span className="list-sep pointer-events-none absolute inset-x-0 bottom-0 h-[0.5px] bg-slate-200" />
        </div>
      </label>
    </li>
  );
}

function RowLabel({ label, hint }: { label: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0 flex-1 py-[3px]">
      <div className="text-[17px] leading-[22px] tracking-[-0.025em] text-slate-900">{label}</div>
      {hint && <div className="mt-0.5 text-[13px] leading-[18px] text-slate-500">{hint}</div>}
    </div>
  );
}

interface InputRowProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  value: string;
  onChange: (value: string) => void;
}

/** Decimal field as an iOS inline value: grey rounded token, right-aligned (like a compact picker). */
export function InputRow({ id, label, hint, value, onChange }: InputRowProps) {
  return (
    <RowShell htmlFor={id}>
      <RowLabel label={label} hint={hint} />
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-[34px] w-[104px] shrink-0 rounded-[8px] border-0 bg-slate-200/60 px-[11px] text-right text-[17px] tabular-nums tracking-[-0.02em] text-slate-900 transition-[background-color,box-shadow] focus:bg-slate-200/90 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
      />
    </RowShell>
  );
}

interface SwitchRowProps {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** iOS switch row (51×31 track, green when on). */
export function SwitchRow({ label, checked, onChange }: SwitchRowProps) {
  return (
    <RowShell>
      <RowLabel label={label} />
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full p-[2px] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-500/25 ${
          checked ? 'bg-success-500' : 'bg-slate-300/80'
        }`}
      >
        <span
          className={`h-[27px] w-[27px] rounded-full bg-white shadow-raised transition-transform duration-200 ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </RowShell>
  );
}
