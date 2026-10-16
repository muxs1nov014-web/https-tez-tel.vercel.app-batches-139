import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useRegisterPageTitle } from '../layout/PageTitle';
import { ChevronLeftIcon } from './icons';

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
}

/**
 * Large title. On iPhone the back link lives in the navigation bar (AppLayout), which also shows the
 * title in small type once the large one scrolls away; on desktop both stay here.
 */
export function PageHeader({ title, subtitle, actions, back }: PageHeaderProps) {
  useRegisterPageTitle(typeof title === 'string' ? title : null, back ?? null);
  return (
    <div className="mb-6 lg:mb-7">
      {back && (
        <Link
          to={back.to}
          className="-ml-1.5 mb-3 hidden items-center gap-0.5 rounded-md px-1 text-[14px] text-primary-700 transition-colors hover:text-primary-600 lg:inline-flex"
        >
          <ChevronLeftIcon className="h-[18px] w-[18px]" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[34px] font-bold leading-[41px] tracking-[-0.03em] text-slate-900 lg:text-[30px] lg:leading-[1.1]">
            {title}
          </h1>
          {subtitle && (
            <div className="mt-1 max-w-3xl text-[15px] leading-snug text-slate-500 lg:mt-1.5">{subtitle}</div>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
