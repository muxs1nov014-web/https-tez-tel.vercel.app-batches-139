import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDownIcon, XIcon } from './icons';
import { Spinner } from './Spinner';

export interface ComboOption {
  id: number;
  label: string;
  /** Secondary text on the right (e.g. stock qty). */
  hint?: string;
  /** Extra text to match against (defaults to the label). */
  searchText?: string;
  disabled?: boolean;
}

interface ComboboxProps {
  options: ComboOption[];
  value: number | null;
  onChange: (id: number | null) => void;
  placeholder?: string;
  loading?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  clearable?: boolean;
  id?: string;
  className?: string;
  emptyText?: string;
  maxResults?: number;
  autoFocus?: boolean;
}

/** Searchable single select. Every whitespace-separated token must appear in the option text. */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Tanlang…',
  loading = false,
  invalid = false,
  disabled = false,
  clearable = false,
  id,
  className = '',
  emptyText = 'Hech narsa topilmadi',
  maxResults = 60,
  autoFocus,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selected = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);

  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches =
      tokens.length === 0
        ? options
        : options.filter((o) => {
            const hay = `${o.label} ${o.searchText ?? ''}`.toLowerCase();
            return tokens.every((t) => hay.includes(t));
          });
    return matches.slice(0, maxResults);
  }, [options, query, maxResults]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[active];
    if (el instanceof HTMLElement) el.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (opt: ComboOption) => {
    if (opt.disabled) return;
    onChange(opt.id);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && filtered[active]) {
        e.preventDefault();
        choose(filtered[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.stopPropagation();
        setOpen(false);
        setQuery('');
      }
    }
  };

  const border = invalid
    ? 'border-danger-500/70 bg-danger-50/60 focus:border-danger-500 focus:ring-danger-500/20'
    : 'border-transparent bg-slate-200/55 hover:bg-slate-200/80 focus:border-primary-500 focus:ring-primary-500/20';

  return (
    <div className={`relative ${className}`}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        value={open ? query : (selected?.label ?? '')}
        placeholder={open && selected ? selected.label : placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery('');
          const idx = selected ? options.indexOf(selected) : 0;
          setActive(idx >= 0 && idx < maxResults ? idx : 0);
        }}
        onBlur={() => {
          setOpen(false);
          setQuery('');
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        className={`block h-9 w-full truncate rounded-[9px] border pl-3 pr-12 text-[16px] text-slate-900 sm:text-[14px] placeholder:text-slate-400 transition-[background-color,border-color,box-shadow] duration-150 focus:bg-surface focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-60 ${border}`}
      />
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 pr-2 text-slate-400">
        {loading && <Spinner className="h-3.5 w-3.5" />}
        {clearable && value !== null && !disabled && (
          <button
            type="button"
            className="pointer-events-auto rounded-full p-0.5 hover:bg-slate-100 hover:text-slate-600"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange(null)}
            aria-label="Tozalash"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        )}
        <ChevronDownIcon className="h-3.5 w-3.5" />
      </div>
      {open && (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 top-full z-30 mt-1.5 max-h-72 w-max min-w-full max-w-[32rem] animate-fade-in overflow-auto rounded-[12px] bg-surface/95 p-1.5 text-[14px] shadow-pop backdrop-blur-xl dark:bg-slate-100/95 dark:ring-1 dark:ring-white/10"
        >
          {loading && options.length === 0 ? (
            <li className="px-3 py-2 text-slate-500">Yuklanmoqda…</li>
          ) : filtered.length === 0 ? (
            <li className="px-3 py-2 text-slate-500">{emptyText}</li>
          ) : (
            filtered.map((opt, idx) => (
              <li
                key={opt.id}
                role="option"
                aria-selected={opt.id === value}
                aria-disabled={opt.disabled}
                onMouseEnter={() => setActive(idx)}
                onClick={() => choose(opt)}
                className={`flex cursor-pointer items-center justify-between gap-4 rounded-[7px] px-2.5 py-1.5 ${
                  opt.disabled ? 'cursor-not-allowed text-slate-400' : ''
                } ${idx === active ? 'bg-primary-600 text-white [&>span+span]:text-white/75' : ''} ${
                  opt.id === value ? 'font-medium' : ''
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {opt.hint && <span className="shrink-0 text-xs tabular-nums text-slate-500">{opt.hint}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
