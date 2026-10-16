import type { ISODate } from '../api/types';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(): ISODate {
  return toISODate(new Date());
}

export function startOfMonthISO(d = new Date()): ISODate {
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function endOfMonthISO(d = new Date()): ISODate {
  return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export interface DateRangeValue {
  date_from: ISODate;
  date_to: ISODate;
}

export interface DatePreset {
  key: string;
  label: string;
  range: () => DateRangeValue;
}

export const DATE_PRESETS: DatePreset[] = [
  {
    key: 'this-month',
    label: 'Bu oy',
    range: () => ({ date_from: startOfMonthISO(), date_to: todayISO() }),
  },
  {
    key: 'last-month',
    label: "O'tgan oy",
    range: () => {
      const now = new Date();
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { date_from: startOfMonthISO(prev), date_to: endOfMonthISO(prev) };
    },
  },
  {
    key: 'last-90',
    label: '90 kun',
    range: () => {
      const from = new Date();
      from.setDate(from.getDate() - 89);
      return { date_from: toISODate(from), date_to: todayISO() };
    },
  },
  {
    key: 'this-year',
    label: 'Bu yil',
    range: () => ({ date_from: `${new Date().getFullYear()}-01-01`, date_to: todayISO() }),
  },
  {
    key: 'all',
    label: 'Hammasi',
    range: () => ({ date_from: '', date_to: '' }),
  },
];
