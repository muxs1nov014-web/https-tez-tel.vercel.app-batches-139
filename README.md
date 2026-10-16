# TezTel — phone import control

Purchases in Dubai (AED) → landed unit cost in USD → stock → wholesale sales and profit.
Admin panel (React), REST API (FastAPI), Telegram bot with Gemini (text and voice questions).

Docs: `docs/SPEC.md` (source of truth), `docs/DECISIONS.md`, `docs/ASSUMPTIONS.md`, `docs/INTAKE.md`.

## Run everything (Docker)

```bash
cp .env.example .env        # set passwords, JWT_SECRET, TELEGRAM_BOT_TOKEN, GEMINI_API_KEY, DOMAIN
docker compose up -d --build
```

- Admin panel: `http://<server>/`. The first admin comes from `ADMIN_USERNAME` / `ADMIN_PASSWORD`
  and is created on the first start, only if no users exist.
- Set `DOMAIN=telefon.example.uz` for automatic HTTPS via Caddy.
- Changing `ADMIN_PASSWORD` in `.env` later does **not** change the stored password. To apply it:
  `docker compose up -d --force-recreate api && docker compose exec -T api python -m app.cli set-password admin`
  (minimum 6 characters). Other passwords are changed on the "Foydalanuvchilar" page.

## Legacy Excel import (one time)

```bash
docker compose cp "Foyda_Formula Рахбар.xlsx" api:/tmp/legacy.xlsx
docker compose exec api python -m app.cli import-excel /tmp/legacy.xlsx            # dry run
docker compose exec api python -m app.cli import-excel /tmp/legacy.xlsx --commit
```

The same import is also available in the admin panel (Excel import page). It can be re-run safely,
because dates that already exist are skipped. Afterwards, enter the **current stock** once on
Ombor → "Boshlang'ich qoldiq": Excel never recorded sales, so every purchased unit counts as in stock until you do.

## Bot

1. Create the bot with @BotFather and put the token into `TELEGRAM_BOT_TOKEN`.
2. Put the Gemini key into `GEMINI_API_KEY` (model: `GEMINI_MODEL`, default `gemini-3.8-flash`).
3. Each employee sends `/start` to the bot, and the bot replies with their Telegram ID.
   An admin adds that ID on "Bot foydalanuvchilari".

The bot is read-only. It answers from 6 fixed query functions (`app/services/analytics.py`)
and never runs model-generated SQL.

**Groups (SPEC §14).** Added to a group, the bot stays silent and stores every message in
`telegram_group_messages`. It needs @BotFather `/setprivacy` → Disable (then re-add it to the group), or
admin rights in the group; otherwise Telegram only delivers commands. `TELEGRAM_GROUP_IDS` limits which
groups are stored. A request guard (`GroupSilence`) refuses any non-read Telegram call aimed at a group.

## Production: Vercel (SPEC §16)

One Vercel project (`tez-tel`, Services mode): the panel and the FastAPI backend deploy together on every push to
`main` (root `vercel.json`). Database: Neon (Vercel Marketplace). Env vars: `vercel env ls production`.

```bash
# schema changes: run migrations against Neon before pushing code that needs them
vercel env pull .env.production --environment=production      # gitignored; holds DATABASE_URL_UNPOOLED
cd backend && ALEMBIC_DATABASE_URL="$(grep ^DATABASE_URL_UNPOOLED= ../.env.production | cut -d= -f2- | tr -d '"')" \
  uv run alembic upgrade head
# the bot runs as a webhook on Vercel; local polling must stay off while the webhook is set
uv run python -m app.cli set-webhook https://tez-tel.vercel.app
```

**Panel link without a domain (SPEC §15, local only).** `docker compose --profile tunnel up -d tunnel` starts a Cloudflare
quick tunnel under a watchdog. When its random hostname changes, the bot sends every active bot user the new
"📱 Panel" button. With a domain, set `WEBAPP_URL` instead.

## Development

```bash
docker compose up -d db                      # Postgres on localhost:23432 (DB_PORT)
cd backend
uv sync
export DATABASE_URL=postgresql+asyncpg://telefon:telefon@localhost:23432/telefon   # root .env points at the docker host "db"
.venv/bin/alembic upgrade head
.venv/bin/python -m app.cli ensure-admin     # admin/admin unless .env says otherwise
.venv/bin/uvicorn app.main:app --reload --port 8000
.venv/bin/pytest -q                          # creates and drops the telefon_test database

cd ../frontend && npm install && npm run dev # http://localhost:5173, proxies /api → :8000
```

Bot locally: `cd backend && .venv/bin/python -m app.bot.main` (needs a token and key in `.env`).

## Layout

```
backend/app/domain/costing.py     unit-cost engine (pure, unit-tested against the Excel numbers)
backend/app/services/             use cases: batches, stock, sales, reports, analytics (bot), catalog
backend/app/api/routers/          thin HTTP layer, RBAC via require_role (admin/operator/viewer)
backend/app/importers/            Excel importer + model-name parser (202 raw names → 135 products)
backend/app/bot/                  aiogram bot + Gemini tool loop
frontend/                         React admin panel
deploy/                           Caddyfile, web image
```
