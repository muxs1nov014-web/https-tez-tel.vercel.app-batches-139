# SPEC — Phone Import Control (Telefon)

Status: v1, 2026-09-30. Inputs: `INTAKE.md`, `DECISIONS.md`, `ASSUMPTIONS.md`, `STACK.md`.

## 1. Purpose

Replace the Excel workbook `Foyda_Formula Рахбар.xlsx` with a system that:
1. records phone purchases in Dubai (AED) per **batch** (= purchase date),
2. computes the **landed unit cost** in USD (price + all import/customs costs),
   first as an estimate, then with actual amounts paid,
3. tracks own **stock** by product + batch, and **wholesale sales** in USD, with profit,
4. answers staff questions from a **Telegram bot** (text or voice, via Gemini),
5. imports data from Excel (legacy file + new files in the same layout).

Out of v1: cash desk, money transfers, debts (phase 2), per-IMEI tracking, batch
shipping status, AI data entry via the bot.

## 2. Roles (admin panel)

| Role | Can |
|---|---|
| `admin` | everything, incl. users, bot users, settings, deletes |
| `operator` | create and edit purchases, expenses, sales, products, tariffs, customers, imports, stock adjustments |
| `viewer` | read everything |

Bot users are a separate whitelist (`bot_users`, by Telegram ID). Every active bot
user may query everything, incl. cost and profit (D9). The bot is read-only.

## 3. Domain model

Money is `Numeric(14,4)`, USD unless named `_aed`. Percentages are fractions
(`0.01` = 1%). All tables have `id` (int PK) and `created_at`.

```
users(id, username UQ, password_hash, full_name, role, is_active)
bot_users(id, telegram_id BIGINT UQ, full_name, is_active)
settings(key PK, value TEXT)                   -- customs_rate=0.176, default_rate=3.67, default_perevod_pct=0.01,
                                               -- default_imei=15, default_cargo=2
products(id, brand, model, storage, color, variant NULL, name, search_text, is_active)
    UQ(brand, model, storage, color, variant)  -- name e.g. "iPhone 17 Pro Max 256GB Silver eSIM"
product_aliases(id, product_id FK, alias UQ)   -- normalised raw Excel names → product
channels(id, code UQ, name, customs_factor)    -- seeds: cargo 1.0, hand 0.5  ("(1)" in Excel)
customs_tariffs(id, brand, model, storage, base_price_usd, valid_from)
    UQ(brand, model, storage, valid_from)      -- estimate = base × customs_rate × channel.factor
customers(id, name, phone NULL, kind('dealer'|'client'), note NULL, is_active)
batches(id, batch_date UQ, code NULL, note NULL)
purchase_lines(id, batch_id FK, product_id FK, channel_id FK, qty, price_aed, rate,
    perevod_pct, cargo, imei, airport_road, inspector, bu, packaging, sim, rastamojka,   -- per-unit estimates
    client_id FK NULL, service_pct NULL, raw_name NULL, note NULL,
    unit_cost_est, unit_cost)                  -- materialised by the cost engine
batch_expenses(id, batch_id FK, category, kind('estimate'|'actual'), amount_usd, note NULL, created_by FK NULL)
sales(id, sale_date, customer_id FK NULL, note NULL, created_by FK NULL)
sale_lines(id, sale_id FK, product_id FK, qty, price_usd, batch_id FK NULL)  -- batch_id = optional override
sale_allocations(id, sale_line_id FK, purchase_line_id FK, qty)
stock_adjustments(id, purchase_line_id FK, qty, reason('opening_balance'|'writeoff'|'correction'), note NULL)
```

Indexes: `batches.batch_date`, `purchase_lines(product_id, batch_id)`,
`sales.sale_date`, `sale_allocations.purchase_line_id`,
`stock_adjustments.purchase_line_id`. Product search is a substring match on `products.search_text`
(the catalog has ~150 rows, so no trigram index is needed).

**Own stock** = purchase lines with `client_id IS NULL`.
`remaining(line) = qty − Σ allocations.qty − Σ adjustments.qty`.

## 4. Cost engine (pure function, `app/domain/costing.py`)

Categories:

| code | UI label (uz) | level | estimate source | actual total allocation |
|---|---|---|---|---|
| perevod | Perevod | line | `price_usd × perevod_pct` | ∝ line estimate |
| cargo | Kargo | line | per unit | ∝ line estimate |
| imei | IMEI | line | per unit | ∝ line estimate |
| airport_road | Yo'l kira (aeroport) | line | per unit | ∝ line estimate |
| inspector | Inspektor | line | per unit | ∝ line estimate |
| bu | B/U xarajat | line | per unit | ∝ line estimate |
| packaging | Upakovka | line | per unit | ∝ line estimate |
| sim | SIM | line | per unit | ∝ line estimate |
| rastamojka | Rastamojka | line | per unit (auto from tariff unless given) | ∝ line estimate |
| certificate | Sertifikat | batch | `batch_expenses` estimate | equal per unit |
| dubai_internal | Dubay ichki | batch | `batch_expenses` estimate | equal per unit |
| customs_invoice | Schet bojxona | batch | `batch_expenses` estimate | equal per unit |
| customs_duty | Bojxona boji | batch | `batch_expenses` estimate | equal per unit |
| customs_cash | Naqd bojxona | batch | `batch_expenses` estimate | equal per unit |
| declarant | Deklarant / hujjatlar | batch | `batch_expenses` estimate | equal per unit |

Rules:
- `price_usd = price_aed / rate`.
- Batch-level categories: `per_unit = total / Σ qty of ALL lines in the batch` (own + client), estimate and actual alike.
- Line-level categories: estimate per unit is on the line. If the batch has any
  `actual` rows for that category, `effective_per_unit(line) = actual_total × (line_est_total / batch_est_total) / line.qty`;
  if `batch_est_total = 0`, the actual total is split equally per unit.
- For each category, `effective` = actual allocation if actual rows exist, else the estimate.
- `unit_cost_est = price_usd + Σ estimates`; `unit_cost = price_usd + Σ effective`.
- `overhead = unit_cost − price_usd` (the "per phone customs + costs", e.g. ≈ 323 $ in the brief).
- Client lines: `service_fee_per_unit = price_usd × service_pct`,
  `charge_per_unit = unit_cost_est + service_fee_per_unit`,
  `margin = (charge_per_unit − unit_cost) × qty`.
- Rastamojka auto estimate at line creation:
  `base_price(brand, model, storage, latest valid_from ≤ batch_date) × settings.customs_rate × channel.customs_factor`,
  rounded to 2 decimals; `0` if no tariff (the API returns a warning).
- Engine recalculates and stores `unit_cost_est`/`unit_cost` on every line of a
  batch after any change to its lines or expenses (`CostService.recalculate_batch`).

Reference test (from the brief): one batch, 40 × product, 6350 AED, rate 3.67,
perevod 1%, cargo 2, IMEI 15, rastamojka 264, batch estimates 500+200+300 →
`price_usd 1730.2452`, `overhead 323.3025`, `unit_cost 2053.5477`.

## 5. Sales and stock

- A sale line allocates FIFO over own purchase lines of that product with
  `remaining > 0`, ordered by `batch_date, id`; if `batch_id` is given, only that
  batch. Not enough stock → `409` with the available qty.
- `cost(sale_line) = Σ alloc.qty × purchase_line.unit_cost` (read live, so later
  actual expenses update profit). `profit = revenue − cost`.
- Deleting a sale deletes its allocations (stock returns).
- **Opening balance** (legacy): `POST /stock/opening-balance {as_of_date, items[{product_id, qty}]}` —
  for each product, keeps the **newest** own units up to `qty` (lines with `batch_date ≤ as_of_date`)
  and writes off the rest with `reason='opening_balance'` (FIFO-consistent). If `qty` exceeds the units
  purchased → 422. Re-running replaces the previous opening-balance adjustments for that product; units
  already sold after `as_of` are subtracted (they came out of the counted stock).

## 6. Excel import

One importer for the legacy layout of sheet `Malumot kiritish` (header row 1):
`A date | B model | C qty | D price AED | E sale $ (ignored) | F rastamojka/unit | H IMEI | I cargo |
J airport road | K perevod % | L certificate | M dubai internal | N schet customs | O (-) customs duty |
P cash customs | Q declarant | R rate | S inspector | T B/U | U packaging | V sim`.

- Rows without a date or with a non-numeric qty (e.g. `… ЖАМИ`, blank, `#DIV/0!`) are skipped.
- Dates may be datetimes or Excel serials.
- Rows are grouped by date → batch. Batch-level estimates are
  `Σ(value × qty) / Σ qty` per column (reproduces `SUMIF`); 0 is not stored.
- Model names go through the **name parser** (`app/importers/name_parser.py`):
  typo map for colours, `(1)` → channel `hand`, `(esim)` → variant `eSIM`,
  brand detection (Apple by default, Samsung `S2x/A..`/`tab`, Dyson), storage
  (`256`, `1tb`, `12+256` → `12/256GB`). An alias match wins over the parser; unknown
  → a new product is created and reported.
- `dry_run=true` returns a preview and writes nothing. A commit skips dates whose
  batch already exists (reported as `exists`) → re-runnable.
- Legacy column S (`Inspector`) values ≥ 20 are treated as a note, not a cost
  (they are manual totals; see INTAKE §6.6).
- Rastamojka from column F is used as given (legacy estimates are the client's numbers).

## 7. Telegram bot

- aiogram 3, long polling, private chats only. Unknown user → "ruxsat yo'q" plus their Telegram ID.
- Text or voice (OGG sent inline to Gemini) → Gemini with **function declarations** → the
  backend executes read-only query functions → Gemini writes a short answer in Uzbek (Latin).
  At most 4 tool rounds per message; each Gemini call has a timeout.
  Model: `GEMINI_MODEL` (default `gemini-3.8-flash`: stable, audio input, function calling).
- Query functions (`app/services/analytics.py`, shared with the reports API):

| function | args | returns |
|---|---|---|
| `stock_summary` | `product_query?` | per product: qty, avg unit cost, stock value; total |
| `sales_summary` | `date_from, date_to, product_query?, customer_query?` | per product: qty, revenue, cost, profit; totals |
| `purchases_summary` | `date_from, date_to, product_query?` | per product: qty, AED, USD, avg unit cost |
| `unit_cost_breakdown` | `product_query, batch_date?` | latest (or given) batch lines: price, per-category costs, overhead, unit cost |
| `batch_summary` | `batch_date` | lines, estimate vs actual, overhead per unit |
| `top_products` | `date_from, date_to, metric('qty'\|'profit'), limit` | ranked list |

- `product_query` matching: lower-case tokens, all of which must appear in `products.search_text`
  (which contains the name, aliases and short forms such as "17pm", "pro max").
- Today's date and the timezone (Asia/Tashkent) go into the system prompt so "bugun", "shu oy" resolve.

## 8. API contract (prefix `/api`, JSON, JWT Bearer)

Errors: `{"detail": "..."}` with 400/401/403/404/409/422.
Pagination is not needed in v1 (data volume is small); `GET /sales` accepts `limit` (default 500).
Validation errors are flattened to a single string in `detail`.

Auth
- `POST /auth/login {username, password}` → `{access_token, token_type, user}`; `GET /auth/me` → `User`
- `User = {id, username, full_name, role, is_active}`

Admin only
- `GET/POST /users`, `PATCH /users/{id} {full_name?, role?, is_active?, password?}`
- `GET/POST /bot-users {telegram_id, full_name}`, `PATCH /bot-users/{id} {full_name?, is_active?}`, `DELETE /bot-users/{id}`
- `GET /settings` (any role) → `{customs_rate, default_rate, default_perevod_pct, default_imei, default_cargo}`; `PUT /settings` (admin)

Catalog (read: any role; write: operator+)
- `GET /meta/categories` → `[{code, label, level}]`
- `GET /products?q=&active=` → `[Product]`; `POST /products {brand, model, storage, color, variant?}`; `PATCH /products/{id}`
  `Product = {id, brand, model, storage, color, variant, name, is_active}`
- `GET /channels` → `[{id, code, name, customs_factor}]`; `POST /channels`, `PATCH /channels/{id}` (admin)
- `GET /tariffs` → `[{id, brand, model, storage, base_price_usd, valid_from}]`; `POST /tariffs`; `PATCH /tariffs/{id}`; `DELETE /tariffs/{id}` (admin)
- `GET /tariffs/estimate?product_id=&channel_id=&date=` → `{base_price_usd|null, customs_rate, customs_factor, rastamojka}`
- `GET /customers?q=&kind=` → `[Customer]`; `POST /customers {name, phone?, kind, note?}`; `PATCH /customers/{id}`

Batches (read: any; write: operator+; delete: admin)
- `GET /batches?date_from=&date_to=` → `[BatchSummary]`
  `BatchSummary = {id, batch_date, code, note, total_qty, own_qty, client_qty, price_usd_total, cost_est_total, cost_total, overhead_per_unit_avg, has_actuals}`
- `POST /batches {batch_date, code?, note?, lines: [LineIn], expenses: [ExpenseIn]}` → `BatchDetail` (409 if the date exists)
- `GET /batches/{id}` → `BatchDetail`; `PATCH /batches/{id} {code?, note?}`; `DELETE /batches/{id}` (409 if any sale allocations)
- `POST /batches/{id}/lines LineIn`; `PATCH /batches/{id}/lines/{line_id} LineIn(partial)`; `DELETE /batches/{id}/lines/{line_id}` → `BatchDetail`
- `POST /batches/{id}/expenses ExpenseIn`; `DELETE /batches/{id}/expenses/{expense_id}` → `BatchDetail`

```
LineIn = {product_id, channel_id?, qty, price_aed, rate?, perevod_pct?, cargo?, imei?, airport_road?,
          inspector?, bu?, packaging?, sim?, rastamojka?, client_id?, service_pct?, note?}
          -- omitted numbers fall back to settings defaults; rastamojka omitted → tariff estimate
ExpenseIn = {category, kind: 'estimate'|'actual', amount_usd, note?}
BatchDetail = {id, batch_date, code, note, total_qty,
  lines: [LineOut], expenses: [{id, category, kind, amount_usd, note, created_at}],
  categories: [{code, label, level, estimate_total, actual_total|null, effective_total}],
  totals: {price_usd, cost_est, cost, overhead_est, overhead}, warnings: [str]}
LineOut = {id, product: {id, name}, channel: {id, code, name}, qty, price_aed, rate, price_usd,
  client: {id, name}|null, service_pct, note, raw_name,
  estimates: {perevod_pct, cargo, imei, airport_road, inspector, bu, packaging, sim, rastamojka},
  per_unit: {<category>: {estimate, effective}},
  unit_cost_est, unit_cost, overhead_est, overhead, sold_qty, adjusted_qty, remaining_qty}
```

Stock (read: any; write: operator+)
- `GET /stock?q=` → `[{product: {id, name}, qty, avg_unit_cost, stock_value, lines: [{purchase_line_id, batch_id, batch_date, remaining_qty, unit_cost}]}]`
- `POST /stock/opening-balance {as_of_date, items: [{product_id, qty}]}` → `[{product_id, kept, written_off}]`
- `POST /stock/adjustments {purchase_line_id, qty, reason, note?}` → `{id}`

Sales (read: any; write: operator+)
- `GET /sales?date_from=&date_to=&customer_id=` → `[{id, sale_date, customer: {id, name}|null, total_qty, revenue, cost, profit}]`
- `POST /sales {sale_date, customer_id?, note?, lines: [{product_id, qty, price_usd, batch_id?}]}` → `SaleDetail` (409 if short of stock)
- `GET /sales/{id}` → `SaleDetail`; `DELETE /sales/{id}` (admin)
  `SaleDetail = {id, sale_date, customer, note, lines: [{id, product, qty, price_usd, revenue, cost, profit, allocations: [{purchase_line_id, batch_date, qty, unit_cost}]}], totals: {qty, revenue, cost, profit}}`

Reports (any role)
- `GET /reports/dashboard` → `{stock_qty, stock_value, month: {sales_qty, revenue, profit, purchases_qty, purchases_usd}, monthly: [{month, purchases_qty, purchases_usd, sales_qty, revenue, profit}]}` (last 12 months)
- `GET /reports/profit?date_from&date_to&group_by=product|customer|day|month` → `[{key, label, qty, revenue, cost, profit}]`
- `GET /reports/batch-variance?date_from&date_to` → `[{batch_id, batch_date, qty, cost_est, cost, diff, diff_per_unit}]`
- `GET /reports/unit-cost?product_id=` → `[{batch_date, qty, price_usd, overhead, unit_cost}]`
- `GET /reports/clients?date_from&date_to&customer_id` → `[{customer, batch_date, product, qty, price_usd, unit_cost_est, service_fee_per_unit, charge_per_unit, charge_total, cost_total, margin}]`

Import (operator+)
- `POST /imports/purchases` (multipart `file`, query `dry_run=true|false`) →
  `{batches: [{batch_date, lines, qty, status: 'new'|'exists'}], new_products: [{raw_name, name}], warnings: [str], created_batches, created_products}`

Health: `GET /health` → `{status: "ok"}`.

## 9. Admin panel pages (Uzbek UI)

Login · Dashboard · Partiyalar (list, detail with per-line cost breakdown, expense estimate/actual editor,
add/edit lines) · Yangi xarid · Ombor (by product, batch breakdown, opening balance) · Sotuvlar
(list, new sale with live profit, detail) · Katalog (products) · Bojxona tariflari + sozlamalar ·
Kanallar · Mijozlar/dilerlar · Hisobotlar (profit, estimate vs actual, unit-cost history, clients) ·
Excel import (preview → confirm) · Bot foydalanuvchilari · Foydalanuvchilar.

## 10. Layout

```
backend/app/{core, domain, models, schemas, services, api/routers, importers, bot}, alembic/, tests/
frontend/src/{api, components, pages, lib}
docker-compose.yml, Caddyfile, .env.example
```

## 11. Phases

1. Backend core: models, migration, cost engine, catalog, batches, expenses, auth/RBAC, legacy import, tests.
2. Stock, sales, reports, opening balance, tests.
3. Admin panel (parallel with 1–2 against this contract).
4. Bot + Gemini + analytics functions.
5. Docker Compose + Caddy, seeds (tariffs from the screenshots, channels, settings), legacy import run.

## 12. Client warehouses, debts and bot buttons (phase 2a, 2026-10-02)

The client has 7–8 large wholesale customers. Each customer acts as a **separate warehouse**: we hand over
phones from our stock on credit (consignment). The goods stay ours until the customer sells them. The
customer then owes us for what was sold and pays over time. Decisions are in `ASSUMPTIONS.md` (2026-10-02).

### 12.1 Model (migration `0003_client_warehouses`)

```
consignment_moves(id, move_date, customer_id FK customers, kind('out'|'return'), note NULL,
    created_by FK users NULL, created_at)                       -- one handover / return document
consignment_entries(id, customer_id FK, purchase_line_id FK purchase_lines, qty INT (signed, ≠ 0),
    price_usd NUMERIC(12,2) NULL,                               -- agreed unit price, 'out' only
    move_id FK consignment_moves NULL ON DELETE CASCADE,
    sale_line_id FK sale_lines NULL ON DELETE CASCADE,
    CHECK (num_nonnulls(move_id, sale_line_id) = 1), CHECK (qty <> 0))
customer_payments(id, customer_id FK, payment_date, amount_usd NUMERIC(14,2) > 0,
    kind('payment'|'opening_debt'), note NULL, created_by FK users NULL, created_at)
sales.source VARCHAR(16) NOT NULL DEFAULT 'stock'  CHECK IN ('stock','consignment')
```
Indexes: `consignment_entries(customer_id, purchase_line_id)`, `consignment_entries.purchase_line_id`,
`customer_payments(customer_id, payment_date)`, `consignment_moves(customer_id, move_date)`.

Entry signs:
- handover (`out` move): `+q` per purchase line, FIFO from **our** stock (same order as sales), `price_usd` = agreed price;
- return (`return` move): `−q` per purchase line, taken from that customer's lines, newest handover first (LIFO);
- customer sold (consignment sale): a normal `Sale` with `source='consignment'`, `customer_id` = the customer,
  allocations FIFO from the customer's lines, **plus** one `−q` entry per allocation linked by `sale_line_id`.
  Deleting the sale cascades the entries away, so the units go back to the customer.

### 12.2 Stock rules
- `consigned(line) = Σ consignment_entries.qty` (units currently at customers).
- **Our** warehouse: `remaining(line) = qty − sold − adjusted − consigned`. `line_movements_query` and
  `own_stock_lines_query` subtract `consigned`; every guard that uses `sold + adjusted` ("moved") also counts
  `consigned` (batch line qty/product/client changes, line/batch delete).
- Customer warehouse: `customer_stock(c, line) = Σ entries.qty WHERE customer_id = c` (always ≥ 0).
- A handover may only take units from our warehouse. A return or consignment sale may only take the customer's own units
  (409 with the available qty otherwise). All of these lock product lines with `lock_product_lines`, the same as sales.
- Deleting a move (admin) is refused (422) if it would leave any `customer_stock(c, line) < 0`
  (units of that handover were already sold or returned).
- Opening balance (`set_opening_balance`) counts our warehouse only. The counted qty is what was on hand at `as_of`.
  Units at customers are never in `remaining`. What left our warehouse after `as_of` is subtracted from the count:
  stock sales (`source='stock'`) dated after `as_of`, and the net qty handed over in moves dated after `as_of`
  (handovers − returns). Consignment sales are not subtracted, because those units left our warehouse when they were
  handed over.
- Batch `LineOut` gains `consigned_qty` (units of the line currently at customers). `remaining_qty` is our warehouse only.
  Once a line has any consignment entry, its product and client cannot change (422), and it cannot be deleted (409).

### 12.3 Debt
```
debt(c) = Σ opening_debt + Σ sales revenue (all sales with customer_id = c, both sources)
        + Σ client-service charges (purchase lines with client_id = c: charge_per_unit × qty)
        − Σ payments
```
- `stock_value_cost` = Σ customer_stock × unit_cost.
- `stock_value_price` = Σ customer_stock × the agreed price of that line's latest handover to c (falls back to unit_cost).
- `exposure` = debt + stock_value_price, i.e. what the customer would owe if everything were sold.

### 12.4 API (all under `/api`; read = viewer, write = operator, delete = admin)
- `GET /customers/summary` → `[CustomerBalance]` sorted by name. It covers active customers, plus inactive ones that still
  have a debt (|debt| ≥ 0.005) or goods on hand. The bot's customer list shows active customers only:
  `CustomerBalance = {customer: {id, name, kind}, debt, stock_qty, stock_value_cost, stock_value_price, exposure,
  sales_month_qty, sales_month_revenue, last_payment_date|null}`
- `GET /customers/{id}/overview` → `{balance: CustomerBalance, totals: {opening_debt, charged_sales, charged_service,
  paid, given_qty, returned_qty, sold_qty}}`
- `GET /customers/{id}/stock` → `[{product: Ref, qty, avg_unit_cost, value_cost, price_usd|null, value_price,
  lines: [{purchase_line_id, batch_date, qty, unit_cost, price_usd|null}]}]`
- `GET /customers/{id}/moves` → `[{id, move_date, kind, note, total_qty, total_value|null, created_at,
  lines: [{product: Ref, qty, price_usd|null}]}]` newest first
- `POST /customers/{id}/moves {move_date, kind:'out'|'return', note?, lines: [{product_id, qty>0, price_usd?}]}` → Move (201).
  `price_usd` is required (> 0) for `out` and ignored for `return`. An `out` move to an inactive customer is refused (422),
  and returns from that customer are still accepted.
- `DELETE /customers/{id}/moves/{move_id}` (admin) → 204
- `POST /customers/{id}/consignment-sales {sale_date, note?, lines: [{product_id, qty>0, price_usd>0}]}` →
  `SaleDetail` (201). It is also listed in `GET /sales` and is deleted through `DELETE /sales/{id}`.
  `SaleSummary` and `SaleDetail` gain a `source` field.
- `GET /customers/{id}/sales` → `[SaleSummary]` (both sources) newest first
- `GET /customers/{id}/payments` → `[{id, payment_date, amount_usd, kind, note, created_at}]` newest first
- `POST /customers/{id}/payments {payment_date, amount_usd>0, kind:'payment'|'opening_debt', note?}` → Payment (201)
- `DELETE /customers/{id}/payments/{payment_id}` (admin) → 204
- `GET /customers/{id}/ledger` → `[{date, type:'opening_debt'|'sale'|'service'|'payment', ref_id|null, description,
  debit, credit, balance}]` chronological. `debit` increases the debt, `credit` lowers it, and `balance` is the running debt.

### 12.5 Admin panel
- **Mijozlar** list: new columns Nasiya, Qo'lidagi mol (dona / $), Shu oy sotuv, and a link to the customer page.
- **Mijoz sahifasi** `/customers/:id`: stat cards (Nasiya, Qo'lidagi mol, Jami majburiyat, Shu oy sotuv).
  Tabs: Qoldiq (stock table) · Harakatlar (moves) · Sotuvlar · To'lovlar · Hisob-kitob (ledger).
  Action buttons by role: "Mol berish", "Qaytarish", "Sotildi", "To'lov", "Boshlang'ich qarz".
  The forms use `ProductSelect`. For "Mol berish" they show our available qty, and for "Qaytarish" / "Sotildi"
  the customer's qty. "Sotildi" pre-fills the price with the latest agreed price.

### 12.6 Telegram bot buttons (no Gemini involved)
- For allowed users, `/start` and `/mijozlar` show a persistent reply keyboard with the button **"👥 Mijozlar"**.
- Button → inline keyboard of active customers (2 per row, sorted by name). Callback data `c:<id>`.
- Customer → inline keyboard of sections: 💰 Nasiya · 📦 Qoldiq · 🧾 Savdolar · 💵 To'lovlar · 📋 Umumiy ·
  ⬅️ Mijozlar. Callback data `c:<id>:<section>`. The message is edited in place.
- Each section renders plain text (Uzbek, `$` amounts with 2 decimals, thousands separated by spaces) from the same
  services as the API. Savdolar shows this month + all time + the last 10 sales. To'lovlar shows the last 10 payments plus totals.
  Qoldiq shows per-product qty and value. Umumiy shows all of it in short form.
- Every callback re-checks `is_bot_user_allowed`. These handlers are registered before the free-text AI handler,
  and the button text never reaches Gemini.

## 13. Mobile and Telegram Mini App (2026-10-02)

The admin panel must work on phones and inside Telegram as a Mini App (WebApp).

### 13.1 Responsive rules (frontend)
- Every page is usable at 360–430 px width with no horizontal page scroll. Wide data tables may scroll inside their card.
- Inputs use a 16 px font below `sm`, so iOS Safari and the Telegram webview do not zoom on focus.
- Line-entry grids (new purchase, new sale, consignment, opening balance) stack into one card per line below `lg`.
- Modals become bottom sheets below `sm`. Fixed bars and headers respect `env(safe-area-inset-*)`.

### 13.2 Telegram Mini App (frontend)
- `telegram-web-app.js` is loaded with `defer`. Inside Telegram the app calls `ready()` and `expand()`, follows Telegram's
  colour scheme when the theme preference is "system", sets the header/background colours to the canvas colour,
  and shows Telegram's BackButton on every page except `/`.
- Auto-login: when there is no token and `Telegram.WebApp.initData` is present, the app calls `POST /api/auth/telegram`.
  If that fails, the normal login form is shown together with the reason.

### 13.3 Telegram login (backend, migration `0004_user_telegram_id`)
- `users.telegram_id BIGINT NULL UNIQUE`; admins set it on the Foydalanuvchilar page. `UserOut` gains `telegram_id`,
  and the user create/update schemas accept it (`null` clears it; 409 if it is already used by another user).
- `POST /api/auth/telegram {init_data: str}` → `TokenOut` (same shape as `/auth/login`). Public endpoint.
  - Verification follows Telegram WebApp rules: `secret = HMAC_SHA256(key="WebAppData", msg=TELEGRAM_BOT_TOKEN)`,
    `hash == hex(HMAC_SHA256(secret, data_check_string))` with constant-time compare, and `auth_date` no older than
    24 h (`TELEGRAM_INITDATA_MAX_AGE`, seconds, default 86400).
  - 401 when the signature is bad, `auth_date` is stale, or the bot token is not configured.
  - 403 when the Telegram user is not linked or the panel user is inactive. The message includes the Telegram ID,
    so an admin can link it.
- Bot (revised 2026-10-02 at the client's request): the reply keyboard shows "📱 Panel" next to "👥 Mijozlar", and it
  opens the panel as a Mini App. The blue chat menu button is not used. The URL is `WEBAPP_URL` (https). If that is empty,
  it is the current Cloudflare quick-tunnel hostname, read from cloudflared's `/quicktunnel` at `TUNNEL_METRICS_URL`.
  Telegram sends no initData to reply-keyboard Mini Apps, so this launch shows the login form once and then remembers it.

## 14. Silent group capture (2026-10-03)

The bot (`@Teztel2025bot`) can be added to Telegram groups to collect data. It never writes to a group, except the
batch cost message to the chats an admin chose (§17).

- Table `telegram_group_messages` (migration `0005`): `chat_id`, `chat_title`, `message_id`, `from_id` (null for an
  anonymous admin or a channel), `from_name`, `sent_at`, `edited_at`, `content_type`, `text` (text or caption),
  `file_id`, `file_name`, `reply_to_message_id`, `raw` (JSONB, the whole Message without `reply_to_message`).
  `UNIQUE(chat_id, message_id)`: an edit overwrites the row.
- `app/bot/group_log.py`: a router for `group`/`supergroup` messages and edits, included before the private router.
  Every replying handler (`/start`, customer menu, Gemini) sits in the `private` router (private chats only).
- `GroupSilence` request middleware on the bot session: a Telegram method whose `chat_id` is negative or `@name`
  is refused (`GroupWriteBlocked`, logged as an error) unless it is a `Get*` method or `LeaveChat`.
- `TELEGRAM_GROUP_IDS`: comma-separated chat IDs to store. Empty = every group the bot is in. The first message
  of each group logs its ID and title.
- Telegram constraints: with privacy mode on (the BotFather default), a bot in a group receives only commands and
  mentions. Turn it off with `/setprivacy` → Disable and re-add the bot, or make the bot a group admin. A bot never
  sees messages from before it joined; old history comes from a Telegram Desktop export instead.
- Not in this step: turning the stored messages into sales, payments or customer moves. That needs the message
  format agreed with the client.

## 15. Live Panel link on a quick tunnel (2026-10-03)

Until a domain exists, the Mini App runs on a Cloudflare quick tunnel (`*.trycloudflare.com`, random hostname).
- `deploy/tunnel.Dockerfile` + `deploy/tunnel-watchdog.sh`: cloudflared under a watchdog. If `/ready` fails 6 checks in
  a row (10 s apart, after a 60 s grace), the container exits and Docker restarts it, which gets a new tunnel.
  Reason: on 2026-10-02 Cloudflare dropped the tunnel ("Tunnel not found") and cloudflared retried it for 15 hours.
- `app/bot/panel_link.py`: every 60 s the bot compares the current Panel URL with the last one it announced
  (`settings.bot_announced_panel_url`). When it changed and `<url>/api/health` answers 200, each active bot user gets
  the reply keyboard again with the new URL. Reply-keyboard Mini App URLs are stored on the device, so this is the
  only way to update them without the menu button, which the client did not want.
- A new hostname is a new origin, so the panel's saved login is gone and users log in once more.
- With a domain: set `WEBAPP_URL=https://...`. The URL then never changes, and the tunnel profile is not needed.

### 15.1 Panel on Vercel (2026-10-03, replaced by §16 the same day)
- The panel is built and served by Vercel (project `tez-tel`, root directory `frontend`, https://tez-tel.vercel.app).
  `frontend/vercel.json` proxies `/api/*` to the backend and sends every other path to `index.html` (SPA routes).
- `WEBAPP_URL=https://tez-tel.vercel.app`, so the bot's "📱 Panel" button and the panel login no longer change with the
  tunnel. Until the backend has a fixed address, `/api` goes to the quick tunnel on the Mac; after the tunnel gets a
  new hostname, `deploy/point-vercel-to-tunnel.sh` updates `vercel.json` and pushes, and Vercel redeploys.

## 16. Everything on Vercel (2026-10-03)

The client wants the whole system on Vercel ("vercelni o'zida ishlasin"). One Vercel project `tez-tel` in
**Services** mode (framework preset "Services", root directory = repo root, function region `fra1`), configured by the
root `vercel.json`:

| service | root | serves |
|---|---|---|
| `frontend` | `frontend/` | the Vite panel; a service-scoped rewrite sends every path to `index.html` (SPA routes) |
| `backend` | `backend/` | FastAPI as one Python function (`index:app`), incl. the Telegram webhook |

Public routing: `/api/(.*)` → backend (paths keep their `/api` prefix, as the FastAPI routes expect), the rest →
frontend. One domain: https://tez-tel.vercel.app. Git pushes to `main` deploy both services together.

- Database: Neon Postgres, free plan, `fra1`, via the Vercel Marketplace (`teztel-db`). The integration sets
  `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`; the app prefers the unpooled one. `async_db_url()` turns
  `postgresql://...?sslmode=require` into the asyncpg form. On Vercel (`VERCEL=1`) the engine uses `NullPool`.
  Migrations run from a workstation: `ALEMBIC_DATABASE_URL=<neon url> alembic upgrade head`.
- Bot: webhook instead of long polling. `POST /api/telegram/webhook` checks `X-Telegram-Bot-Api-Secret-Token`
  against `TELEGRAM_WEBHOOK_SECRET` (empty secret = 404, wrong = 401). It always answers 200 after a handler error, so
  Telegram does not resend a failing update. Each update opens a bot session with the `GroupSilence` guard.
  `python -m app.cli set-webhook https://tez-tel.vercel.app` / `delete-webhook` switch modes. While a webhook is set,
  the polling bot container must stay stopped.
- `WEBAPP_URL=https://tez-tel.vercel.app`: the Panel button URL never changes. The quick tunnel, `panel_link` and the
  §15.1 tunnel proxy are not used on Vercel.
- Production env vars live on Vercel (`vercel env ls production`). Docker Compose stays the local/dev setup.

### 16.1 Go-live hardening (security audit, 2026-10-03)
- `/auth/login` throttle (`login_failures`, migration `0006`): 5 failures per username+IP or 20 per IP within
  15 minutes → 429 "Juda ko'p noto'g'ri urinish". A success clears that username+IP. Rows older than a day are
  pruned on each failure. Client IP = first `X-Forwarded-For` entry (Vercel and Caddy overwrite it).
- Unknown usernames cost the same bcrypt time as wrong passwords; passwords over 72 bytes are a plain 401.
- New passwords need 12+ characters (API schemas; `set-password`/`ensure-admin` in production).
- `check_production()` also runs on Vercel even without `APP_ENV`; `TELEGRAM_WEBHOOK_SECRET` must be 32+ characters.
- Bot private router: the chat must be the sender's own chat (and a callback's message chat the presser's), so a
  forged webhook update cannot redirect answers to a third-party chat.
- Root `.vercelignore` keeps `.env*` out of CLI uploads. CSP `frame-ancestors` allows only self and Telegram Web.
- Not done (low): JWTs cannot be revoked before they expire (12 h); a password change does not end other sessions.

## 17. Batch cost message to Telegram (2026-10-05)

The client wants the "Model bo'yicha tannarx" card of the new-purchase form (one row per model: name, qty, unit cost)
sent to Telegram, so prices can be set from it. Revised the same day at the client's request: nothing is sent
automatically; it goes only from the batch page button, to the people picked there.

- Content (`app/bot/batch_texts.py`, plain text): `📦 Partiya · dd.mm.yyyy[ · code]`, then one entry per product in
  first-seen order: `N. <product name>` / `<qty> dona × <unit cost> $`. Lines of one product (own and client lines alike,
  as on the form) are merged; the unit cost is `Σ unit_cost × qty / Σ qty` with the effective `unit_cost` (= the estimate
  until actual expenses exist). Then `Jami` (qty and total) and "Taxminiy…" or "Real xarajatlar hisobga olingan."
  No average line (removed at the client's request).
  Amounts are whole dollars, cents always rounded up (client request: 1954.56 → 1955 $; cents are taken first, so
  1954.00 stays 1954). `Jami` is `Σ qty × rounded unit`, so it adds up from the rows.
  Split at line breaks into ≤ 4000-character messages.
- `POST /batches` sends nothing.
- `GET /telegram/recipients` (operator) → `[{chat_id, name, kind: 'user'|'group'|'channel', blocked}]`: the configured
  groups/channels first, then active bot users by name.
- `POST /batches/{id}/notify {chat_ids: [str]}` (operator) → `{recipients, sent, failed, blocked, skipped}`. Each chat
  must be in `GET /telegram/recipients`; 422 for any other chat, an empty list, no bot token or a batch without lines.
  One attempt per chat, no retries; a chat that fails is counted and the rest still get it. Overall timeout 20 s.
- Unreachable chats (client request: one attempt is enough): a send that fails with Forbidden (blocked, kicked,
  deactivated) or "chat not found" stores the chat in settings key `batch_notify_unreachable` (`blocked` in the answer).
  Later sends skip it without trying (`skipped`), and the picker shows it disabled. It is cleared when that private chat
  writes to the bot (unblocking sends /start) or the bot sees a message in that group. Network errors and rate limits
  are not remembered.
- `GET/PUT /telegram/notify` (admin) → `{chat_ids, bot_configured, groups: [{chat_id, title}]}`: `chat_ids` (settings
  key `batch_notify_chats`, comma-separated; group/channel ID or `@channel`) are offered in the picker besides the bot
  users; `groups` are the chats seen in `telegram_group_messages`, to pick an ID from. A malformed ID → 422.
  Panel: "Bot foydalanuvchilari".
- Panel: "Telegramga yuborish" on the batch page opens a picker with a checkbox per recipient and "Hammasi". The last
  choice is remembered per browser (localStorage); without one, nothing is pre-selected.
- Batch page: a "Model bo'yicha tannarx" card at the end (same merge and effective cost as the message), like the card on
  the new-purchase form, so the per-model cost stays visible after saving. Both cards show each row's value as
  `<qty> dona × <unit> $` with the same whole-dollar round-up as the message (`fmtUsdUp`).
- Group guard: the sender opens its own bot session with `GroupSilence(allowed_chat_ids=<picked chats>)`. The webhook
  and polling bot keep the strict guard, so every other group stays silent.
- No migration: the settings table is key-value. A `batch_notify_enabled` row left by the first version is ignored.

## 18. Daily nasiya control workbook (2026-10-20)

Every day the "Telefon nasiya nazorat" group (`-1003839931967`) receives an Excel workbook (`nazorat_15.10.2026.xlsx`).
It replaces §14's open item for this group: the file becomes an IMEI-level snapshot of every customer, reviewed in the
panel and then monitored day to day.

### 18.1 Workbook format (`app/domain/nasiya_sheet.py`, pure)
- One sheet per customer. Top rows: the date (`15,10,2026`) and the name. A header row (found in the first 6 rows)
  gives each column's kind: `Nasiya` / `Nasiyada` / `Насияга берилди` → nasiya (debt); `N Variant` → variant
  (long-term deal, also debt); `Qoldiq` / `Колгани` / `Ostatka` → qoldiq (our goods at the customer, no debt yet);
  `Sotuv` → sotuv (paid today). A header merged over several columns names each of them; a blank header right of a
  typed column inherits its kind (warning).
- A column is a stream of blocks: model name (any text with a digit), IMEIs (14–17 digits), then a terminator:
  `1900*10` = price 1900 $ × 10 phones (the count must equal the IMEIs above it), a lone price for one phone, or for
  qoldiq a count. `15,10,` marks the date of the blocks below it (stored as `marked_date`); `8 kunga berildi` sets
  `term_days`. Text without a digit, with `$`, or with `aka`/`klent` is a note (the customer's name) and is skipped.
- A column ends at its own footer label: `Nasiyada 35 ta`, `4 ta tel un kirim` / `taga Puli olindi` / `Sotuv 16 taga`,
  `Ostatka`, `4,490 $ utdi`, `Jami nasiyasa`. The sum below (or beside) a label is checked against the IMEIs of the
  label's column and the same-kind columns to its right without a label of their own. A paid-total label under a
  non-sotuv column is only the day's note.
- The summary panel (a label column with `Limit` / `Berish mumkin`, values to its right) is read into
  `summary`: variant, nasiya, qoldiq, jami, limit, available, and the variant payment `schedule` (`31.10.2026 | 159500`).
- Issues. Errors (block confirmation): `count_mismatch`, `price_missing`, `imei_invalid` (length or Luhn check digit),
  `imei_duplicate` (in a sheet), `imei_cross_sheet` (one phone at two customers), `imei_without_model`,
  `unknown_column`, `kind_conflict` (header `Sotuv`, footer `Nasiyada 20 ta`: the header decides, a person checks),
  `data_after_footer`, `no_date`, `unreadable`. Warnings: `declared_qty`, `declared_amount`, `empty_block`,
  `stray_number`, `price_low`, `price_without_count`, `header_inherited`. Nothing is dropped silently: a phone without
  a price is kept with `price_usd = null`.
- Report date: the date most sheets carry (a shop sheet updated weekly does not decide it), else the file name, else
  the message date.
- Checked against the 60 workbooks from 27.07–15.10.2026: on 15.10 the IMEI sum of nasiya equals each sheet's own
  "Nasiya" panel figure to the cent for every customer.

### 18.2 Intake
- Bot (`group_log.capture`): after storing the message, an `.xlsx` document (≤ 20 MB) from a group in
  `NASIYA_CHAT_IDS` (empty = every stored group) is downloaded (`GetFile`, a read; nothing is posted) and ingested.
  A failure is logged and does not affect message capture.
- `nasiya_intake` (one row per handled group message: created / duplicate / invalid) makes every message handled at
  most once. `POST /nasiya/reports/rescan?since=` (operator) handles stored messages without a row, sent on or after
  `since`, oldest first: up to 25 files or 8 s per call (a Vercel function has a time limit), and `remaining` tells
  the panel to call again. A file over 20 MB is recorded as `invalid` without downloading.
- A new group file is confirmed automatically (`auto_confirm`) when nothing needs a decision: it has a date, no
  errors, every sheet with phones is linked (remembered, or a clear name match as below) and no later file for that
  day is confirmed. Anything else waits in the review queue.
- `POST /nasiya/reports/upload` (operator, one file per request) for files from elsewhere. A file that is not a nasiya
  workbook is refused for an upload and kept as `invalid` for a group message.
- The same bytes twice (sha256) are one report.

### 18.3 Review (`nasiya_reports`)
- Tables (migration `0007`): `nasiya_reports` (status pending / confirmed / rejected / superseded / invalid;
  partial unique index: one confirmed report per date), `nasiya_sheets` (customer link, summary, footer, issues),
  `nasiya_items` (kind, model, imei, qty, price_usd, marked_date, term_days, cell), `nasiya_sheet_links`
  (sheet name key → customer, remembered), `nasiya_intake`.
- Sheet → customer: `PUT /nasiya/reports/{id}/sheets/{sheet_id} {customer_id}` (operator) links every sheet with the
  same name key (case, spaces and punctuation ignored) and remembers it for the next files. One customer per sheet in a
  file (409). The panel suggests a customer only on a clear match: ratio ≥ 0.8, 0.1 ahead of the next, equal numbers
  in the names (B23 is never suggested for B16), not taken by another sheet.
- `POST /nasiya/reports/{id}/confirm {force, note}` (operator): needs a date, every sheet with phones linked, and no
  errors; `force` (admin) confirms despite errors and the panel asks for a note. A confirmed report of the same date
  becomes `superseded`. `POST …/reject {note}` (operator), `DELETE` (admin).
- "Hammasini hisoblash" (panel button; operator): reads the group from a chosen day with the rescan above, then
  `POST /nasiya/reports/process {since}` confirms every pending day from `since` on, oldest first. Per day the latest
  file wins and earlier ones become `superseded` (also when a later file of that day is already confirmed). Unlinked
  sheets get the clear-match customer (remembered). A day still having unlinked sheets waits; a day with errors waits
  for an operator and is confirmed for an admin with the note "Hammasini hisoblash: N ta xato bilan" (the errors stay
  on the report). The result lists the links made and every waiting day with its reason.

### 18.4 Monitoring (`nasiya_monitor`, confirmed reports only)
- Events by IMEI against the previous confirmed day: new_debt, qoldiq_to_debt, paid (nasiya → sotuv), sold_paid,
  sold_direct, handover; alerts: vanished_debt (left the debt without appearing in Sotuv), vanished_qoldiq,
  debt_to_qoldiq, moved (another customer), price_changed, reopened (sotuv → anything). The panel says how many days
  lie between the two days compared.
- Age: the first confirmed day of the phone's current unbroken run at the same customer in the same state (or its
  `marked_date`, when earlier and not in the future). A run that reaches the first confirmed day is a lower bound
  (`since_exact = false`, shown as "≥"). Buckets 0–3, 4–7, 8–14, 15–30, 30+ days; overdue = age > `term_days`.
- Per customer: debt (nasiya + variant), qoldiq (count; value from the sheet's panel), paid today, new debt, limit and
  available (limit − debt − qoldiq value), over_limit, the sheet's own Nasiya figure (shown red when it differs from
  the IMEI sum) and the panel ledger debt (§12) for reconciliation. The workbook does not write into the §12 ledger.
- Months (`GET /nasiya/months?count=&customer_id=`): per month of confirmed days — Sotuv (phones in the Sotuv column,
  each IMEI once on its first day there; a row without IMEI on every day listed), new debt (IMEIs in debt that were not
  in debt the confirmed day before; for one customer, also those moved in from another customer), and debt and qoldiq
  on the month's last confirmed day. The month holding the first confirmed day is `partial` (no day before it).
- `GET /nasiya/overview?on=`, `/nasiya/series?days=&customer_id=`, `/nasiya/customers/{id}?on=`, `/nasiya/imei/{imei}`
  (viewer). Panel: "Nasiya nazorati" (Savdo group) with the daily view, months and the report list, a review page per
  report (every phone by model with its IMEIs and cells), a page per customer (every phone with model, IMEI, price,
  since, age; months), a block on the Dashboard (latest day, this month's Sotuv and new debt), a "Guruh: nasiya"
  column in the customer list and a "Guruh hisoboti" block on the customer page (§12 figures stay separate).
