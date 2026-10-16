import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface PageTitleInfo {
  title: string | null;
  back: { to: string; label: string } | null;
}

interface PageTitleContextValue extends PageTitleInfo {
  set: (info: PageTitleInfo) => void;
}

const EMPTY: PageTitleInfo = { title: null, back: null };
const PageTitleContext = createContext<PageTitleContextValue>({ ...EMPTY, set: () => undefined });

/** Lets the iPhone navigation bar show the current page's title and back link (UINavigationBar). */
export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [info, set] = useState<PageTitleInfo>(EMPTY);
  const value = useMemo(() => ({ ...info, set }), [info]);
  return <PageTitleContext.Provider value={value}>{children}</PageTitleContext.Provider>;
}

export function usePageTitle(): PageTitleInfo {
  const { title, back } = useContext(PageTitleContext);
  return { title, back };
}

/** Called by PageHeader: publishes the title while the page is mounted. */
export function useRegisterPageTitle(title: string | null, back: PageTitleInfo['back']): void {
  const { set } = useContext(PageTitleContext);
  const backTo = back?.to ?? null;
  const backLabel = back?.label ?? null;
  useEffect(() => {
    set({ title, back: backTo && backLabel ? { to: backTo, label: backLabel } : null });
    return () => set(EMPTY);
  }, [set, title, backTo, backLabel]);
}
