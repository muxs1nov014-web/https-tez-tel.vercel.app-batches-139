import { Link, useLocation } from 'react-router-dom';
import { useCan } from '../../lib/auth';
import { TINTS } from '../../lib/tints';
import { NAV, isNavActive } from './nav';

interface NavListProps {
  onNavigate?: () => void;
  /** Sidebar search text; items whose label does not contain it are hidden. */
  query?: string;
}

/** Shared by the desktop sidebar and the mobile drawer, so both always list the same pages. */
export function NavList({ onNavigate, query = '' }: NavListProps) {
  const { pathname } = useLocation();
  const can = useCan();
  const needle = query.trim().toLocaleLowerCase();

  const groups = NAV.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => (!item.requires || can(item.requires)) && (!needle || item.label.toLocaleLowerCase().includes(needle)),
    ),
  })).filter((group) => group.items.length > 0);

  if (groups.length === 0) {
    return <div className="px-3 py-6 text-center text-[13px] text-slate-500">Hech narsa topilmadi</div>;
  }

  return (
    <nav className="px-2.5 pb-4">
      {groups.map((group, gi) => (
        <div key={group.label ?? gi} className={gi === 0 ? '' : 'mt-4'}>
          {group.label && <div className="mb-1 px-2.5 text-[11px] font-semibold text-slate-400">{group.label}</div>}
          <ul className="space-y-px">
            {group.items.map((item) => {
              const active = isNavActive(item, pathname);
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={`flex h-[32px] items-center gap-2.5 rounded-[8px] px-1.5 text-[13.5px] transition-colors ${
                      active
                        ? 'bg-primary-600 font-medium text-white'
                        : 'text-slate-800 hover:bg-black/[0.05] dark:hover:bg-white/[0.07]'
                    }`}
                  >
                    <span
                      className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] bg-gradient-to-b text-white shadow-glyph [&>svg]:stroke-[2] ${TINTS[item.tint]}`}
                    >
                      <Icon className="h-[13px] w-[13px]" />
                    </span>
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
