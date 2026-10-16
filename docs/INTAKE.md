# Intake — client material analysis

Date: 2026-09-30
Sources:
- **Primary:** `~/Downloads/Telegram Desktop/Foyda_Formula Рахбар.xlsx` — 2 sheets
  (`Malumot kiritish`, `Foyda xisoboti`); dates stored as Excel serials.
- `~/Downloads/Telegram Desktop/Foyda_Formula Рахбар (2).xlsx` — 14 sheets.
  **Client said this file is NOT needed (2026-09-30).** Facts marked *(2)* below
  come only from it and are background, not requirements.
- Two screenshots: customs base-price tables (see §4).
- Client's verbal brief (Uzbek), 2026-09-30.

## 1. What the business does

Buys phones (mostly iPhone, also Samsung, tablets, Dyson) in **Dubai for AED**,
flies them to **Uzbekistan**, clears customs, and sells. Two streams:

1. **Own stock** — bought for resale (`Malumot kiritish`, `Foyda xisoboti`).
2. *(2)* **Client import service** — imports phones for named clients
   (Бегзод ака, Иброхим ака, Собир ака, Хусан ака клиенти) and charges them
   estimated expenses + a service fee (`KLENT X`, `Р. Клиент хараж фарки`).

*(2)* Money to Dubai goes via transfers (`Р. перевод`), commission 0.6–0.85%;
a cash desk in Dubai is run by Иброхимжон (`Иброхимжон касса`).

## 2. People and data flow *(2)* (from sheet `Лист1`)

| Person | Provides |
|---|---|
| Муминжон (declarant) | Receives each arrival as a **partiya** (batch), pays IMEI registration, certificate, invoice, rastamojka per partiya; posts real amounts to the Telegram group "Телефон харажатлари" |
| Мансур ака | Real customs expenses per partiya |
| Акмалхон | Money transfers (perevod) |
| Маруфхон | Client transfer info |
| Иброхимжон | Dubai side: buys, holds cash, holds stock before shipping |

Stock pipeline (`Йулдеги юклар`): bought → at Иброхимжон (Dubai) → in the air →
certificate → customs → released for sale.

## 3. Cost formula (as implemented in Excel)

Input row (`Malumot kiritish`): date, model (free text), qty, price AED,
rastamojka $/unit, IMEI $/unit, cargo $/unit, airport road $/unit, perevod %,
and **batch totals**: certificate, Dubai internal, invoice (schet) customs,
"(-) customs duty", cash customs, declarant/documents; AED→USD rate.

Per unit (sheet `Foyda xisoboti`):

```
price_usd        = price_aed / rate                        (rate ≈ 3.67, stored per row)
perevod          = price_usd × perevod_pct                 (1%)
cargo, imei, airport_road                                  (per unit, as entered)
batch_share(X)   = X_total / SUM(qty of all rows with the same DATE)   ← equal per unit
rastamojka       = per unit, as entered
inspector        = per unit (column S)
unit_cost        = price_usd + perevod + cargo + airport_road + imei
                   + Σ batch_share(cert, dubai_internal, schet, minus_duty, cash_customs, declarant)
                   + rastamojka + inspector
overhead_per_unit ("Тахм. собс") = unit_cost − price_usd − inspector
profit           = sale_usd − unit_cost
```

Worked example from the client's brief: 40 × 18 Pro Max, 6350 AED, rate 3.67,
batch fixed costs 500 + 200 + 300:

```
price_usd  = 6350 / 3.67           = 1730.25
perevod 1%                          =   17.30
cargo + IMEI                        =   17.00
batch share = 1000 / 40             =   25.00
rastamojka (1500 × 17.6%)           =  264.00
overhead per unit                   ≈  323.30
unit cost                           ≈ 2053.55
```

### Estimated vs real *(2)* (sheets `Р. хараж фарки`, `Р. Клиент хараж фарки`, `Р. ИТОГ`)
Per partiya the sheet keeps **Тахминий** (estimated at purchase) and
**Реальный** (actually paid, from Муминжон/Мансур) expenses by category, and the
difference per unit. Categories (`Лист5`): Перевод, Карго, ИМЕИКА,
Сертификат УЗБ, Дубай ички, Счёт божхона, −Божхона божи, Нақд божхона,
Хужжатлар, Растаможка.

### Client service *(2)* (sheet `KLENT X`)
Same cost build-up per client batch, plus `XIZMAT` (service fee, 1–1.8% of
price). `TANNARX dona` = client's per-unit cost; margin = estimated − real.

## 4. Customs base-price tables (screenshots)

Rastamojka per unit = **base price × 17.6%**.

| Model | Base $ | 17.6% |
|---|---|---|
| 13 128 black | 120 | 21.12 |
| 15 128 black | 270 | 47.52 |
| 16 128 black | 450 | 79.20 |
| 16 pro 128 | 450 | 79.20 |
| 16 pro 256 | 600 | 105.60 |
| 16 pro max 256 desert | 750 | 132.00 |
| 17 256 black | 800 | 140.80 |
| 17 pro 256 silver | 1099 | 193.42 |
| 17 pro 512 silver | 1175 | 206.80 |
| 17 pro 1TB silver | 1470 | 258.72 |
| 17 pro max 256 silver | 1190 | 209.44 |
| 17 pro max 512 silver | 1300 | 228.80 |
| 17 pro max 1TB silver | 1600 | 281.60 |
| 17 pro max 2TB silver | 2020 | 355.52 |
| 17 air 256 black | 830 | 146.08 |
| 17 air 512 black | 1250 | 220.00 |
| 17 air 1TB silver | 1730 | 304.48 |
| S25 Ultra 12/256 | 400 | 70.40 |
| S26 Ultra 12/256 | 800 | 140.80 |
| 18 pro max 256 | 1500 | 264.00 |
| 18 pro max 512 | 1730 | 304.48 |
| 18 pro max 1TB | 2195 | 386.32 |
| 18 pro max 2TB | 2890 | 508.64 |
| 18 pro 256 | 1390 | 244.64 |
| 18 pro 512 | 1625 | 286.00 |
| 18 pro 1TB | 2085 | 366.96 |
| 18 pro 2TB | 2780 | 489.28 |

## 5. Data volume

`Malumot kiritish`: 661 purchase rows, **20,491 units**, 2025-11-01 → 2026-09-29,
129 purchase days. Monthly 1.2k–3k units.
Correction (2026-10-01): the sheet has 662 data rows / 20,497 units. The 661/20,491 count missed
row 424, whose date is the text `30.02.2026` (6 × 17 Pro Max 256 silver (1)). The importer loads
660 rows / 20,490 units. It skips row 424 (impossible date) and row 848 (2026-06-15, `16 128 bleck`,
qty 1, no AED price).
Top: 17 Pro Max 256 Silver (4,992), 16 Pro Max 256 Desert (3,776), 13 128 Black (2,269).

## 6. Data-quality findings (must be resolved by the system, not copied)

1. **181 distinct free-text model names** for far fewer real SKUs — typos
   (`bleck/blekc/belck`, `greey/greeey`, `sailver/siver`, `pro max256`).
   → Needs a product catalog (model / memory / color / variant) and a name-normalizer for import.
2. **Batch = date.** Batch costs are split by `SUMIF(date)`; two shipments on one
   date would merge. Партия numbers (1, S1, 2, 3, S2…) exist only in report sheets.
3. **Sales never recorded** — `Sotuv $` is empty in all 661 rows, so every profit
   figure in the file is negative. Sales and stock are not tracked in Excel at all.
4. Rastamojka is hand-typed and drifts from the 17.6% table
   (17 Pro Max 256: Excel 215/210/193, table 209.44; 18 Pro Max 256: Excel 240, table 264).
5. Columns `B/U xar`, `Upakovka`, `1 Sim tam` are excluded from `unit_cost` (`SUM(F:R)`) — bug or intent unknown.
6. Column `Inspector` (S) sometimes holds ~250 values (looks like a total, not an inspector fee) — double counting.
7. `(-) Bojxona boji` is **added** to cost despite the minus in its name.
8. `Ф.Х жами!Q` multiplies by qty twice (absurd totals, e.g. −12.7 bn).
9. Date typos: rows dated 2026-06-29 placed among 2026-09 rows.
10. Suffixes on model names: `(1)` (rastamojka ≈ half, airport-road cost 50 $) and `(esim)` — meaning unconfirmed.
11. Non-phone goods present (Dyson PH05, Samsung Tab S10 FE).

## 7. Decisions and open questions
See `docs/DECISIONS.md` and `docs/ASSUMPTIONS.md`.
