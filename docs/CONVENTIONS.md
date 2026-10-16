# Conventions

## Backend layering (dependency points downward only)

```
api/routers  ─┐
bot/          ├─> services ─> models (SQLAlchemy) + domain (pure)
importers/   ─┘
```

- **domain/**: pure functions and dataclasses, with no DB and no I/O. Business math lives here
  (`costing.py`) and is unit-tested without a DB.
- **services/**: all DB reads and writes plus use-case orchestration. They take an `AsyncSession`,
  never commit implicitly (the caller's unit of work commits), and raise `app.core.errors` exceptions.
- **api/routers**: thin. They parse input (Pydantic), check the role via `require_role(...)`,
  call a service, commit, and return a schema. No queries in routers.
- **bot/**: thin, like routers. It never writes. The AI assistant calls the query functions in `services/analytics.py`.
  The menu buttons (SPEC §12.6) may call other services for reads only, inside a `READ ONLY` transaction.
- **importers/**: parse files into domain DTOs, then call services to persist.

## Rules
- Money is `Decimal` everywhere in Python and `Numeric` in the DB. Never `float`. Round only for display.
- Percentages are fractions (`0.01`).
- Every endpoint except `/health`, `/auth/login` and `/auth/telegram` (SPEC §13.3) requires auth. Writes require `operator`,
  and users, bot users, settings and deletes require `admin`.
- Errors: `NotFound` → 404, `Conflict` → 409, `ValidationFailed` → 422, `Forbidden` → 403.
- Naming: tables plural snake_case, and schemas `XxxIn` / `XxxOut` / `XxxPatch`.
- Code, identifiers and comments are in English. UI strings and bot replies are in Uzbek (Latin).
- Tests: pytest + pytest-asyncio against a real PostgreSQL (`TEST_DATABASE_URL`). Each test runs in a
  transaction that is rolled back.

## Frontend
- React 18 + Vite + TS + Tailwind. `src/api/` holds the typed client (one file per resource),
  `src/pages/` has one folder per page, and shared UI is in `src/components/`.
- Server state goes through TanStack Query. There is no global store besides auth.
- Numbers are formatted in one helper (`src/lib/format.ts`).
- Design system (Apple style, light + dark): every colour is a CSS variable in `src/index.css`, mapped by
  `tailwind.config.js` (`canvas`, `surface`, `slate`, `primary`, `success`, `danger`, `warning`).
  - Use `bg-surface` for cards and fields and `bg-canvas` for the page. Never use `bg-white` or hex colours,
    because they do not switch with the theme. `text-white` is fine on accent fills.
  - Build screens from `src/components/ui/*` (Card, Button, Field/Input, Badge, Tabs, Modal, StatCard).
    Card is an Apple "grouped" section: the title and actions sit above the rounded box.
  - Layout follows macOS System Settings. The sidebar holds search, the account, nav items with coloured
    squircle glyphs (`tint` in `nav.ts`), the theme switch and logout. Desktop has no top header.
  - The only hex colours allowed are the fixed Apple icon tints in `src/lib/tints.ts`; they are
    identical in both themes on purpose.
  - Do not animate `transform` on a long-lived wrapper. A finished animation still turns it into the
    containing block of fixed bars, so the route fade uses opacity with `backwards` fill.
  - Theme preference (`light` / `dark` / `system`) is in `src/lib/theme.ts`; the inline script in
    `index.html` applies it before first paint.
