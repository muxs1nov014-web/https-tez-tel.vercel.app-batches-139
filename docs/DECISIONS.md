# Decisions (confirmed by the client)

Date: 2026-09-30. Source of truth for scope until `docs/SPEC.md` exists.

| # | Topic | Decision |
|---|---|---|
| D1 | Source data | Primary file is `Foyda_Formula Рахбар.xlsx`. The "(2)" copy is not needed. |
| D2 | Batch (partiya) | One purchase **date** = one batch, as in Excel. Stored as a `Batch` entity with a unique date so real expenses attach to it. |
| D3 | Batch-cost allocation | Batch totals (certificate, Dubai internal, invoice customs, customs duty, cash customs, declarant) are split **equally per unit** across the batch. |
| D4 | Stock granularity | Quantity per **product + batch**. No per-IMEI tracking in v1. |
| D5 | Sales | **Wholesale, in USD**. Entered **only in the admin panel**. |
| D6 | Client import service | In v1 (answered before D1; **re-confirm**, since it only appears in the "(2)" file). |
| D7 | Cash, transfers, debts | Phase 2, not v1. |
| D8 | Bot data entry | **None.** The bot is read-only: text/voice question → Gemini → answer from the DB. |
| D9 | Visibility | Every authorised bot user may see unit cost and profit. |
| D10 | Bot location | Private chats only; access by whitelist managed in the admin panel. 2026-10-03: the bot may also sit in groups, read-only and silent (SPEC §14). |
| D11 | Legacy data | Import all purchase history from the Excel file; enter the current stock once as an opening balance (Excel never recorded sales). |
| D12 | Rastamojka | Estimate = customs base price × rate (17.6%), both editable in the admin panel with history. The real paid amount, once entered, replaces the estimate in unit cost. |
| D13 | Stack | FastAPI + SQLAlchemy 2 + Alembic + PostgreSQL + Pydantic v2; React 18 + Vite + TS + Tailwind admin; aiogram 3 bot; Google Gemini; Docker Compose + Caddy. See `docs/STACK.md`. |
| D14 | Infra | Client has a VPS and a Gemini API key. |

## Still open
- Meaning of the `(1)` suffix on model names (e.g. `17 pro max 256 silver (1)`: rastamojka 107.5 = half, airport road 50 $). Present in the primary file (8 names, ~900 units).
- Sign of `(-) Bojxona boji`: Excel adds it; the answer given ("so") was unclear.
- Whether `B/U xar`, `Upakovka`, `1 Sim tam`, `Inspector` belong in unit cost (Excel: Inspector yes, the other three no).
- D6 re-confirmation.
