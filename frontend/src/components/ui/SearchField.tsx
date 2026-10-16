import type { InputHTMLAttributes } from 'react';
import { SearchIcon, XIcon } from './icons';

interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  value: string;
  onChange: (value: string) => void;
}

/** iOS search field: grey capsule, magnifier, clear button while there is text. */
export function SearchField({ value, onChange, placeholder = 'Qidirish', className = '', ...rest }: SearchFieldProps) {
  return (
    <label className={`relative block ${className}`}>
      <span className="sr-only">{placeholder}</span>
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-slate-500 [&>path]:stroke-[2]" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-[38px] w-full rounded-[12px] border-0 bg-slate-300/40 pl-9 pr-9 text-[17px] tracking-[-0.02em] text-slate-900 placeholder:text-slate-500 transition-[background-color,box-shadow] focus:bg-slate-300/50 focus:outline-none focus:ring-2 focus:ring-primary-500/40 sm:h-9 sm:text-[15px] [&::-webkit-search-cancel-button]:hidden"
        {...rest}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Tozalash"
          className="absolute right-2.5 top-1/2 inline-flex h-[18px] w-[18px] -translate-y-1/2 items-center justify-center rounded-full bg-slate-400 text-white dark:bg-slate-500"
        >
          <XIcon className="h-3 w-3 [&>path]:stroke-[2.6]" />
        </button>
      )}
    </label>
  );
}
