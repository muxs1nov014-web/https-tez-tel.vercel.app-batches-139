import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { ROLE_LABELS } from '../../lib/categories';
import { useTelegramBackButton } from '../../lib/telegram';
import { ChevronLeftIcon, ChevronRightIcon, LogoutIcon, PhoneIcon, SearchIcon, XIcon } from '../ui/icons';
import { LoadingState } from '../ui/States';
import { NavList } from './NavList';
import { PageTitleProvider, usePageTitle } from './PageTitle';
import { ProfileSheet } from './ProfileSheet';
import { TabBar } from './TabBar';
import { ThemeToggle } from './ThemeToggle';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

function AppIcon({ className = 'h-7 w-7 rounded-[8px]' }: { className?: string }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center bg-gradient-to-b from-[#4ea6ff] to-[#0066d6] text-white shadow-glyph ${className}`}
    >
      <PhoneIcon className="h-[58%] w-[58%]" />
    </span>
  );
}

/** Sidebar body shared by the desktop column and the mobile drawer (macOS System Settings layout). */
function SidebarContent({ onNavigate, onClose }: { onNavigate?: () => void; onClose?: () => void }) {
  const { user, logout } = useAuth();
  const [query, setQuery] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const name = user ? user.full_name || user.username : '';

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-5">
        <div className="flex items-center gap-2.5">
          <AppIcon />
          <div className="text-[15px] font-semibold tracking-[-0.02em] text-slate-900">TezTel</div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-200/70 text-slate-500 hover:text-slate-800"
            aria-label="Menyuni yopish"
          >
            <XIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="px-3">
        <label className="relative block">
          <span className="sr-only">Bo'lim qidirish</span>
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Qidirish"
            className="h-8 w-full rounded-[8px] border border-transparent bg-slate-300/35 pl-8 pr-2.5 text-[16px] text-slate-900 placeholder:text-slate-500 sm:text-[13px] transition-[background-color,box-shadow] focus:border-primary-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-primary-500/20"
          />
        </label>
      </div>

      {user && (
        <button
          type="button"
          onClick={() => setProfileOpen(true)}
          title="Login va parolni o'zgartirish"
          className="mx-3 mt-3 flex w-[calc(100%-1.5rem)] items-center gap-3 rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-black/[0.05] active:bg-black/[0.08] dark:hover:bg-white/[0.07]"
        >
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#a9a9ae] to-[#7c7c82] text-[13px] font-semibold text-white"
            aria-hidden="true"
          >
            {initials(name)}
          </span>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[13.5px] font-semibold text-slate-900">{name}</div>
            <div className="truncate text-[12px] text-slate-500">
              {ROLE_LABELS[user.role]} · @{user.username}
            </div>
          </div>
          <ChevronRightIcon className="ml-auto h-4 w-4 shrink-0 text-slate-400" />
        </button>
      )}
      <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} />

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
        <NavList onNavigate={onNavigate} query={query} />
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-black/[0.06] px-3 py-3 dark:border-white/[0.08]">
        <ThemeToggle />
        <button
          type="button"
          onClick={logout}
          className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-slate-600 transition-colors hover:bg-black/[0.05] hover:text-slate-900 dark:hover:bg-white/[0.07]"
        >
          <LogoutIcon className="h-4 w-4" />
          Chiqish
        </button>
      </div>
    </div>
  );
}

/** iPhone navigation bar (iOS 26): transparent over the large title, glass once content scrolls under it. */
function MobileNavBar() {
  const { title, back } = usePageTitle();
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 36);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-20 pt-[env(safe-area-inset-top)] transition-[background-color,box-shadow] duration-200 lg:hidden ${
        scrolled
          ? 'bg-canvas/75 shadow-[0_0.5px_0_rgb(0_0_0/0.12)] backdrop-blur-xl backdrop-saturate-[1.8] dark:shadow-[0_0.5px_0_rgb(255_255_255/0.12)]'
          : 'bg-transparent'
      }`}
    >
      <div className="relative flex h-[52px] items-center px-4">
        {back && (
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(back.to))}
            aria-label={back.label}
            className="glass relative z-10 inline-flex h-[40px] w-[40px] items-center justify-center rounded-full text-slate-900 transition-transform active:scale-90"
          >
            <ChevronLeftIcon className="h-[22px] w-[22px] [&>path]:stroke-[2.2]" />
          </button>
        )}
        <div
          className={`pointer-events-none absolute inset-x-16 text-center text-[17px] font-semibold tracking-[-0.025em] text-slate-900 transition-opacity duration-200 ${
            scrolled && title ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <span className="block truncate">{title}</span>
        </div>
      </div>
    </header>
  );
}

/** Screens with their own bottom action bar hide the tab bar, as iOS does for pushed editors. */
const NO_TAB_BAR = new Set(['/batches/new']);

export function AppLayout() {
  const { pathname } = useLocation();
  useTelegramBackButton();
  const showTabBar = !NO_TAB_BAR.has(pathname);

  return (
    <PageTitleProvider>
      <div className="min-h-screen">
        {/* Desktop sidebar: a floating Liquid Glass panel (macOS Tahoe) */}
        <aside className="glass fixed bottom-2 left-2 top-2 z-20 hidden w-[256px] overflow-hidden rounded-[22px] lg:block">
          <SidebarContent />
        </aside>

        <div className="lg:pl-[272px]">
          <MobileNavBar />
          <main
            className={`mx-auto max-w-[1440px] px-4 pt-1 sm:px-8 lg:px-10 lg:pb-16 lg:pt-10 ${
              showTabBar ? 'pb-[calc(96px+env(safe-area-inset-bottom))]' : 'pb-16'
            }`}
          >
            <div key={pathname} className="animate-page">
              <Suspense fallback={<LoadingState />}>
                <Outlet />
              </Suspense>
            </div>
          </main>
        </div>
        {showTabBar && <TabBar />}
      </div>
    </PageTitleProvider>
  );
}
