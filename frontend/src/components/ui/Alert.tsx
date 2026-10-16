import type { ReactNode } from 'react';
import { WarningIcon } from './icons';

type AlertTone = 'warning' | 'danger' | 'info' | 'success';

const TONES: Record<AlertTone, string> = {
  warning: 'bg-warning-50 text-warning-900',
  danger: 'bg-danger-50 text-danger-800',
  info: 'bg-primary-50 text-primary-900',
  success: 'bg-success-50 text-success-800',
};

interface AlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function Alert({ tone = 'info', title, children, className = '' }: AlertProps) {
  return (
    <div className={`flex gap-2.5 rounded-xl px-3.5 py-3 text-[13px] ${TONES[tone]} ${className}`} role="alert">
      {(tone === 'warning' || tone === 'danger') && <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />}
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
      </div>
    </div>
  );
}
