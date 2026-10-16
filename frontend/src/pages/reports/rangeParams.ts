import type { ReactNode } from 'react';
import type { DateRange } from '../../api/reports';
import type { DateRangeValue } from '../../lib/dates';

export interface LeadProps {
  /** iPhone only: form rows shown first in the report's filter section (the report picker). */
  lead?: ReactNode;
}

export interface RangeProps extends LeadProps {
  range: DateRangeValue;
  onRangeChange: (range: DateRangeValue) => void;
}

export function toApiRange(range: DateRangeValue): DateRange {
  return { date_from: range.date_from || undefined, date_to: range.date_to || undefined };
}
