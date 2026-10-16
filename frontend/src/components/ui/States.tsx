import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { ApiError, errorMessage } from '../../api/client';
import { Button } from './Button';
import { InboxIcon, LockIcon, RefreshIcon, WarningIcon } from './icons';
import { Spinner } from './Spinner';

interface LoadingStateProps {
  label?: string;
  /** Render as table-like placeholder rows instead of a centred spinner. */
  rows?: number;
  className?: string;
}

export function LoadingState({ label = 'Yuklanmoqda…', rows, className = '' }: LoadingStateProps) {
  if (rows) {
    return (
      <div className={`animate-pulse space-y-2 p-4 ${className}`} aria-busy="true" aria-label={label}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="h-5 rounded-lg bg-slate-100" />
        ))}
      </div>
    );
  }
  return (
    <div
      className={`flex items-center justify-center gap-2 px-4 py-12 text-[13px] text-slate-500 ${className}`}
      aria-busy="true"
    >
      <Spinner className="h-4 w-4 text-primary-500" />
      {label}
    </div>
  );
}

interface EmptyStateProps {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  title = "Ma'lumot yo'q",
  description,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center px-4 py-12 text-center ${className}`}>
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <InboxIcon className="h-7 w-7" />
      </span>
      <div className="mt-3 text-[15px] font-semibold tracking-[-0.01em] text-slate-800">{title}</div>
      {description && <div className="mt-1 max-w-md text-[13px] text-slate-500">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  title?: ReactNode;
  className?: string;
}

export function ErrorState({ error, onRetry, title, className = '' }: ErrorStateProps) {
  const forbidden = error instanceof ApiError && error.status === 403;
  const notFound = error instanceof ApiError && error.status === 404;
  const heading =
    title ?? (forbidden ? "Ruxsat yo'q" : notFound ? 'Topilmadi' : "Ma'lumotni yuklab bo'lmadi");
  return (
    <div className={`flex flex-col items-center justify-center px-4 py-12 text-center ${className}`}>
      <span className={`flex h-14 w-14 items-center justify-center rounded-full ${forbidden ? 'bg-slate-100 text-slate-400' : 'bg-danger-50 text-danger-500'}`}>
        {forbidden ? <LockIcon className="h-7 w-7" /> : <WarningIcon className="h-7 w-7" />}
      </span>
      <div className="mt-3 text-[15px] font-semibold tracking-[-0.01em] text-slate-800">{heading}</div>
      <div className="mt-1 max-w-md text-[13px] text-slate-500">{errorMessage(error)}</div>
      {onRetry && !forbidden && !notFound && (
        <Button className="mt-3" size="sm" icon={<RefreshIcon className="h-3.5 w-3.5" />} onClick={onRetry}>
          Qayta urinish
        </Button>
      )}
    </div>
  );
}

export function ForbiddenState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-[18px] bg-surface px-4 py-16 text-center shadow-card dark:shadow-none dark:ring-1 dark:ring-white/[0.06]">
      <LockIcon className="h-10 w-10 text-slate-300" />
      <div className="mt-3 text-[15px] font-medium text-slate-800">Ruxsat yo'q</div>
      <div className="mt-1 text-[13px] text-slate-500">Bu sahifa sizning rolingiz uchun yopiq.</div>
    </div>
  );
}

interface QueryViewProps<T> {
  query: UseQueryResult<T, Error>;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  loading?: ReactNode;
  children: (data: T) => ReactNode;
}

/** Loading → error → empty → data, in that order. */
export function QueryView<T>({ query, isEmpty, empty, loading, children }: QueryViewProps<T>) {
  if (query.isPending) return <>{loading ?? <LoadingState rows={6} />}</>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const data = query.data;
  if (isEmpty?.(data)) return <>{empty ?? <EmptyState />}</>;
  return <>{children(data)}</>;
}
