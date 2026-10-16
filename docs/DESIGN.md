# TezTel design system: Apple, no deviations

The client asked for the app to look like Apple's own apps ("Apple'dan umuman farq qilmasin"). The target is
**iOS 26 / macOS Tahoe (Liquid Glass)**: iPhone below `lg`, Mac app from `lg` up. When in doubt, copy what the
Apple Store / Settings / Stocks apps do. Do not invent styles.

## Shell (done, `src/components/layout`)
- iPhone: floating glass capsule **tab bar** (`TabBar.tsx`, tabs in `nav.ts` → `TABS`), glass circular **back
  button** + small centered title that fades in on scroll (`MobileNavBar` in `AppLayout.tsx`), "Ko'proq" tab =
  iOS Settings-style list of the remaining sections (`pages/more/MorePage.tsx`).
- Mac: floating glass sidebar panel (`.glass`, 256 px, inset 8 px), content starts at `lg:pl-[272px]`.
- `PageHeader` registers its string title and `back` for the iPhone nav bar; its own back link shows on `lg` only.
- Screens with their own fixed bottom action bar are listed in `NO_TAB_BAR` (AppLayout), so the tab bar hides there.

## Tokens
- Colours: Tailwind `canvas`, `surface`, `slate-*` (iOS label/fill greys), `primary-*` (systemBlue), `success`,
  `danger`, `warning`. All are CSS variables with a dark value; never hard-code hex except Apple tints (`lib/tints`).
- Type (SF): large title 34/41 bold (iPhone) or 30 (Mac); section title 17 semibold; body/list 17 (iPhone) and
  13.5–15 (Mac tables); secondary 13–15 `text-slate-500`; footnote 12–13. Numbers always `tabular-nums`.
- Radii: cards, list sections, stat cards **18 px**; inputs 10–12; buttons and segmented controls full/capsule.
- Material: `.glass` class (index.css) for floating chrome only (tab bar, sidebar, nav buttons). Content sits on
  opaque `bg-surface` cards over `bg-canvas`.

## Patterns
- **Lists on iPhone, tables on Mac.** Below `md`, render data as inset-grouped lists: `ListSection` + `ListRow`
  (`components/ui/List.tsx`). Row = title (product/customer/date), subtitle (secondary facts joined with " · "),
  right-aligned `value` (the one number that matters, `valueStrong`) with `valueSub` (unit), chevron when it opens a
  detail page. From `md` up keep the existing `.tbl` table. Render both, toggled with `md:hidden` / `hidden md:block`.
- **Search**: `SearchField` (`components/ui/SearchField.tsx`), full width on iPhone, under the large title.
- **Segmented control**: `Tabs` (`components/ui/Tabs.tsx`).
- **Buttons**: capsule `Button`; one `primary` action per screen. On iPhone, secondary actions go in a row of
  `secondary` capsules or into the list as rows; never more than one row of buttons under the title.
- **Stat widgets**: `StatCard` (2 per row on iPhone).
- **Empty states**: `EmptyState` from `components/ui/States.tsx`; charts with no data show an empty state, not
  empty axes.
- Copy stays Uzbek (Latin), short, sentence case. Section headers in lists are rendered uppercase by `ListSection`.

## Checking
`npm run build` must pass. Look at every changed screen at 390×844 (iPhone) and 1440×900 (Mac), light and dark.
