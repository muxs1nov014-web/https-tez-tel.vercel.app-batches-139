import type { ReactNode } from 'react';

export type Tone = 'slate' | 'primary' | 'success' | 'danger' | 'warning';

const TONES: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-600',
  primary: 'bg-primary-50 text-primary-700',
  success: 'bg-success-50 text-success-700',
  danger: 'bg-danger-50 text-danger-700',
  warning: 'bg-warning-50 text-warning-700',
};

export function Badge({ tone = 'slate', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-[3px] text-[11.5px] font-medium leading-none ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
