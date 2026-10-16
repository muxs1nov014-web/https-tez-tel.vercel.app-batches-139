# Stack

Chosen by the client on 2026-09-30 from three presented options.

| Layer | Choice |
|---|---|
| Backend API | FastAPI, Pydantic v2 |
| Data | PostgreSQL, SQLAlchemy 2 (async), Alembic |
| Admin panel | React 18 + Vite + TypeScript + TailwindCSS |
| Telegram bot | aiogram 3, same service layer as the API |
| AI | Google Gemini: speech-to-text for voice and intent → function calling over a fixed set of read-only query functions (no model-generated SQL) |
| Excel | openpyxl (import/export) |
| Infra | Docker Compose + Caddy on the client's VPS |
| Tests | pytest (backend), Vitest (frontend) |

## Why
- Requirement "clean architecture": bot and admin API share one service layer, and business rules (unit cost) live in one place.
- Requirement "fast": the bot answers through pre-built, indexed queries. The model only picks the function and its arguments.
- The admin panel needs dashboards and analytics, not just CRUD.

## Rejected
- **Django + Django Admin**: CRUD comes free, but dashboards are weak and clean layering is harder.
- **FastAPI + SQLAdmin**: fastest to ship, but the admin UI is too basic for analytics.
