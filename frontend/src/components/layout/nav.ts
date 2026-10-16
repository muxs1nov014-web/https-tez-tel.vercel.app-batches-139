import type { ComponentType } from 'react';
import type { Action } from '../../lib/permissions';
import type { Tint } from '../../lib/tints';
import {
  ArchiveIcon,
  CartIcon,
  ChartIcon,
  ChatIcon,
  CubeIcon,
  EllipsisCircleIcon,
  HomeIcon,
  PhoneIcon,
  PlusCircleIcon,
  ReceiptIcon,
  TableIcon,
  TruckIcon,
  UserCircleIcon,
  UsersIcon,
} from '../ui/icons';

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Colour of the squircle behind the glyph (System Settings style). */
  tint: Tint;
  /** Hidden unless the user may perform this action. */
  requires?: Action;
  /** Custom active matcher (default: prefix match; `/` is exact). */
  match?: (pathname: string) => boolean;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: null,
    items: [{ to: '/', label: 'Dashboard', icon: HomeIcon, tint: 'blue', match: (p) => p === '/' }],
  },
  {
    label: 'Xarid',
    items: [
      {
        to: '/batches',
        label: 'Partiyalar',
        icon: ArchiveIcon,
        tint: 'orange',
        match: (p) => p.startsWith('/batches') && p !== '/batches/new',
      },
      {
        to: '/batches/new',
        label: 'Yangi xarid',
        icon: PlusCircleIcon,
        tint: 'green',
        requires: 'batches.write',
        match: (p) => p === '/batches/new',
      },
      { to: '/import', label: 'Excel import', icon: TableIcon, tint: 'teal', requires: 'imports.run' },
    ],
  },
  {
    label: 'Savdo',
    items: [
      { to: '/stock', label: 'Ombor', icon: CubeIcon, tint: 'brown' },
      { to: '/sales', label: 'Sotuvlar', icon: CartIcon, tint: 'pink' },
      { to: '/customers', label: 'Mijozlar', icon: UsersIcon, tint: 'indigo' },
    ],
  },
  {
    label: "Ma'lumotnomalar",
    items: [
      { to: '/products', label: 'Katalog', icon: PhoneIcon, tint: 'gray' },
      { to: '/tariffs', label: 'Bojxona tariflari', icon: ReceiptIcon, tint: 'purple' },
      { to: '/channels', label: 'Kanallar', icon: TruckIcon, tint: 'cyan' },
    ],
  },
  {
    label: 'Tahlil',
    items: [{ to: '/reports', label: 'Hisobotlar', icon: ChartIcon, tint: 'mint' }],
  },
  {
    label: 'Administrator',
    items: [
      { to: '/bot-users', label: 'Bot foydalanuvchilari', icon: ChatIcon, tint: 'telegram', requires: 'botUsers.manage' },
      { to: '/users', label: 'Foydalanuvchilar', icon: UserCircleIcon, tint: 'slate', requires: 'users.manage' },
    ],
  },
];

export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.match) return item.match(pathname);
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

export interface TabItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  match: (pathname: string) => boolean;
}

const TAB_ROOTS: Omit<TabItem, 'match'>[] = [
  { to: '/', label: 'Asosiy', icon: HomeIcon },
  { to: '/batches', label: 'Partiyalar', icon: ArchiveIcon },
  { to: '/stock', label: 'Ombor', icon: CubeIcon },
  { to: '/customers', label: 'Mijozlar', icon: UsersIcon },
];

function underTabRoot(pathname: string, root: string): boolean {
  return root === '/' ? pathname === '/' : pathname === root || pathname.startsWith(`${root}/`);
}

/** iPhone tab bar (below lg). Every page that is not under the first four tabs belongs to "Ko'proq". */
export const TABS: TabItem[] = [
  ...TAB_ROOTS.map((t) => ({ ...t, match: (p: string) => underTabRoot(p, t.to) })),
  {
    to: '/more',
    label: "Ko'proq",
    icon: EllipsisCircleIcon,
    match: (p) => !TAB_ROOTS.some((t) => underTabRoot(p, t.to)),
  },
];

/** Root screens of the tabs: no back button there (iOS and Telegram alike). */
export const TAB_ROOT_PATHS = new Set(['/', '/batches', '/stock', '/customers', '/more']);
