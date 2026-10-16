import { Link, useLocation } from 'react-router-dom';
import { TABS } from './nav';

/** iPhone tab bar, iOS 26 style: a floating Liquid Glass capsule; the selected tab sits on a lighter pill. */
export function TabBar() {
  const { pathname } = useLocation();
  return (
    <nav
      aria-label="Bo'limlar"
      className="fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(env(safe-area-inset-bottom),12px)] lg:hidden"
    >
      <ul className="glass flex h-[62px] w-full max-w-[440px] items-stretch rounded-full p-[5px]">
        {TABS.map((tab) => {
          const active = tab.match(pathname);
          const Icon = tab.icon;
          return (
            <li key={tab.to} className="flex-1">
              <Link
                to={tab.to}
                aria-current={active ? 'page' : undefined}
                className={`flex h-full flex-col items-center justify-center gap-[3px] rounded-full transition-[background-color,color,transform] duration-200 active:scale-95 ${
                  active ? 'bg-black/[0.06] text-primary-600 dark:bg-white/[0.1]' : 'text-slate-800'
                }`}
              >
                <Icon className={`h-[24px] w-[24px] ${active ? '[&>path]:stroke-[2]' : ''}`} />
                <span className="text-[10px] font-semibold leading-none">{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
