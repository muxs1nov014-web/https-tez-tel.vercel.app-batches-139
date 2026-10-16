import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

const CONTROL =
  'block w-full rounded-[9px] border px-3 text-[16px] text-slate-900 sm:text-[14px] placeholder:text-slate-400 transition-[background-color,border-color,box-shadow] duration-150 focus:bg-surface focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-60';
/** Filled field (iOS / macOS Sonoma style): tinted until focused, then white with an accent ring. */
const VALID = 'border-transparent bg-slate-200/55 hover:bg-slate-200/80 focus:border-primary-500 focus:ring-primary-500/20';
const INVALID = 'border-danger-500/70 bg-danger-50/60 focus:border-danger-500 focus:ring-danger-500/20';

interface ControlProps {
  invalid?: boolean;
}

export type InputProps = InputHTMLAttributes<HTMLInputElement> & ControlProps;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className = '', ...rest },
  ref,
) {
  return <input ref={ref} className={`${CONTROL} h-9 ${invalid ? INVALID : VALID} ${className}`} {...rest} />;
});

/** Text input for decimals: `inputMode="decimal"`, right-aligned, accepts `,` or `.`. */
export const NumberInput = forwardRef<HTMLInputElement, InputProps>(function NumberInput(
  { className = '', ...rest },
  ref,
) {
  return (
    <Input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={`text-right tabular-nums ${className}`}
      {...rest}
    />
  );
});

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & ControlProps;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className = '', children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={`${CONTROL} h-9 pr-8 ${invalid ? INVALID : VALID} ${className}`} {...rest}>
      {children}
    </select>
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & ControlProps;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className = '', rows = 2, ...rest },
  ref,
) {
  return (
    <textarea ref={ref} rows={rows} className={`${CONTROL} py-2 ${invalid ? INVALID : VALID} ${className}`} {...rest} />
  );
});

interface FieldProps {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, required, className = '', children }: FieldProps) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[12.5px] font-medium text-slate-600">
        {label}
        {required && <span className="ml-0.5 text-danger-500">*</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-[12px] text-danger-600">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[12px] text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}

export function Checkbox({ checked, onChange, label, disabled }: CheckboxProps) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded accent-primary-600"
      />
      {label}
    </label>
  );
}
