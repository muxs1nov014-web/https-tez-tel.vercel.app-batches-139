import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'subtle';
type Size = 'xs' | 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800 disabled:opacity-40',
  secondary: 'bg-slate-200/70 text-slate-900 hover:bg-slate-200 active:bg-slate-300 disabled:text-slate-400',
  danger: 'bg-danger-600 text-white hover:bg-danger-700 active:bg-danger-800 disabled:opacity-40',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300',
  subtle: 'bg-primary-50 text-primary-700 hover:bg-primary-100 disabled:opacity-50',
};

const SIZES: Record<Size, string> = {
  xs: 'h-7 gap-1 px-3 text-[12.5px]',
  sm: 'h-8 gap-1.5 px-3.5 text-[13px]',
  md: 'h-9 gap-2 px-[18px] text-[14px]',
  lg: 'h-11 gap-2 px-6 text-[15px]',
};

const BASE =
  'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full font-medium tracking-[-0.01em] transition-all duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-500/25 enabled:active:scale-[0.98] disabled:cursor-not-allowed';

export function buttonClasses(variant: Variant = 'secondary', size: Size = 'md'): string {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]}`;
}

interface ButtonLinkProps extends LinkProps {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

/** A router link styled as a button (avoids nesting <button> inside <a>). */
export function ButtonLink({ variant = 'secondary', size = 'md', icon, className = '', children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={`${buttonClasses(variant, size)} ${className}`} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, icon, className = '', children, disabled, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      className={`${buttonClasses(variant, size)} ${className}`}
      {...rest}
    >
      {loading ? <Spinner className="h-3.5 w-3.5" /> : icon}
      {children}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tone?: 'default' | 'danger';
  children: ReactNode;
}

/** Compact square button for row actions. `label` becomes the tooltip and aria-label. */
export function IconButton({ label, tone = 'default', className = '', children, type, ...rest }: IconButtonProps) {
  const toneClass =
    tone === 'danger'
      ? 'text-slate-400 hover:bg-danger-50 hover:text-danger-600'
      : 'text-slate-400 hover:bg-slate-100 hover:text-slate-800';
  return (
    <button
      type={type ?? 'button'}
      title={label}
      aria-label={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors sm:h-7 sm:w-7 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-500/25 disabled:opacity-40 ${toneClass} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
