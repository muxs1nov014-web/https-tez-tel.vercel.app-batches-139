import type { ReactNode } from 'react';
import { PencilIcon } from '../../components/ui/icons';

/**
 * iPhone-only pieces of the customer screens (inset-grouped lists below `md`, tables from `md` up).
 * They compose the shared `ListSection` / `ListRow`; nothing here replaces a shared component.
 */

/**
 * Below `md`: stretches the shared segmented control (`Tabs`) across the full width, segments sized by their
 * label (UISegmentedControl `apportionsSegmentWidthsByContent`), so five segments fit a 390 pt screen.
 */
export const FILL_SEGMENTS =
  'max-md:[&_[role=tablist]]:flex max-md:[&_[role=tablist]]:w-full max-md:[&_[role=tab]]:flex-auto max-md:[&_[role=tab]]:px-1 max-md:[&_[role=tab]]:text-center';

/** Section header with a trailing "Edit / Done" text button (iOS Health "Pinned … Edit"). */
export function EditableHeader({
  label,
  editing,
  onToggle,
  canEdit,
}: {
  label: ReactNode;
  editing: boolean;
  onToggle: () => void;
  canEdit: boolean;
}) {
  if (!canEdit) return <>{label}</>;
  return (
    <span className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 truncate">{label}</span>
      <button
        type="button"
        onClick={onToggle}
        className="-my-1 shrink-0 py-1 text-[15px] normal-case tracking-[-0.01em] text-primary-600 active:opacity-50"
      >
        {editing ? 'Tayyor' : 'Tahrirlash'}
      </button>
    </span>
  );
}

/** Red "minus" control shown in front of a row in edit mode (UITableView delete control). */
export function DeleteControl() {
  return (
    <span
      className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-danger-500 text-white"
      aria-hidden="true"
    >
      <span className="h-[2px] w-[11px] rounded-full bg-white" />
    </span>
  );
}

/** Blue pencil shown in front of a row in edit mode when tapping it opens the editor. */
export function EditControl() {
  return (
    <span
      className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-primary-600 text-white"
      aria-hidden="true"
    >
      <PencilIcon className="h-[12px] w-[12px] [&>path]:stroke-[2.2]" />
    </span>
  );
}

/** Placeholder bar for a value that is still loading. */
export function ValueSkeleton() {
  return <span className="inline-block h-4 w-16 animate-pulse rounded bg-slate-200/80 align-middle" aria-hidden="true" />;
}

/** Multi-line subtitle: ListRow truncates its subtitle to one line; these lines wrap instead. */
export function SubLines({ lines }: { lines: ReactNode[] }) {
  return (
    <span className="block whitespace-normal">
      {lines.map((line, i) => (
        <span key={i} className="block min-w-0">
          {line}
        </span>
      ))}
    </span>
  );
}
