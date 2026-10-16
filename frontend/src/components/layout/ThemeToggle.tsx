import { useTheme, type ThemePreference } from '../../lib/theme';
import { ComputerIcon, MoonIcon, SunIcon } from '../ui/icons';

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof SunIcon }[] = [
  { value: 'light', label: 'Kunduzgi', Icon: SunIcon },
  { value: 'dark', label: 'Tungi', Icon: MoonIcon },
  { value: 'system', label: 'Avto (tizim bo‘yicha)', Icon: ComputerIcon },
];

/** Segmented light / dark / system switch. */
export function ThemeToggle() {
  const [preference, setPreference] = useTheme();
  return (
    <div className="inline-flex items-center rounded-full bg-slate-300/35 p-0.5" role="radiogroup" aria-label="Mavzu">
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            title={label}
            aria-label={label}
            onClick={() => setPreference(value)}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
              active ? 'bg-surface text-slate-900 shadow-raised dark:bg-slate-400' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
