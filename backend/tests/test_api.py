import io
from datetime import datetime

import pytest
from openpyxl import Workbook


async def _product(client, h, model="iPhone 18 Pro Max", storage="256GB", color="Black"):
    r = await client.post("/api/products", json={"brand": "Apple", "model": model, "storage": storage,
                                                 "color": color}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


async def _batch(client, h, product_id, day="2026-09-01", qty=40, price=6350, **extra):
    body = {"batch_date": day, "lines": [{"product_id": product_id, "qty": qty, "price_aed": price, **extra}],
            "expenses": [{"category": "certificate", "kind": "estimate", "amount_usd": 500},
                         {"category": "dubai_internal", "kind": "estimate", "amount_usd": 200},
                         {"category": "declarant", "kind": "estimate", "amount_usd": 300}]}
    r = await client.post("/api/batches", json=body, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


async def test_health_and_auth_required(client):
    assert (await client.get("/api/health")).json() == {"status": "ok"}
    assert (await client.get("/api/batches")).status_code == 401


async def test_login(client, session):
    from app.services import users
    await users.create_user(session, "boss", "secret123", "Boss", "admin")
    r = await client.post("/api/auth/login", json={"username": "boss", "password": "secret123"})
    assert r.status_code == 200
    token = r.json()["access_token"]
    me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["role"] == "admin"
    bad = await client.post("/api/auth/login", json={"username": "boss", "password": "wrong"})
    assert bad.status_code == 401


async def test_rbac(client, viewer_h, operator_h):
    assert (await client.get("/api/batches", headers=viewer_h)).status_code == 200
    assert (await client.post("/api/products", json={"brand": "A", "model": "B"}, headers=viewer_h)).status_code == 403
    assert (await client.get("/api/users", headers=operator_h)).status_code == 403
    assert (await client.get("/api/bot-users", headers=operator_h)).status_code == 403
    assert (await client.put("/api/settings", json={"customs_rate": 0.2}, headers=operator_h)).status_code == 403
    assert (await client.post("/api/sales", json={"sale_date": "2026-09-01", "lines": [
        {"product_id": 1, "qty": 1, "price_usd": 1}]}, headers=viewer_h)).status_code == 403
    assert (await client.post("/api/imports/purchases", headers=viewer_h,
                              files={"file": ("a.xlsx", b"x")})).status_code == 403


async def test_batch_cost_brief_example_with_tariff(client, operator_h):
    product = await _product(client, operator_h)
    detail = await _batch(client, operator_h, product["id"])  # rastamojka from seeded tariff: 1500 x 17.6%
    line = detail["lines"][0]
    assert line["estimates"]["rastamojka"] == 264
    assert line["unit_cost"] == pytest.approx(2053.5477, abs=1e-3)
    assert line["overhead"] == pytest.approx(323.3025, abs=1e-3)
    assert detail["totals"]["cost"] == pytest.approx(2053.5477 * 40, abs=0.05)
    assert detail["warnings"] == []
    dup = await client.post("/api/batches", json={"batch_date": "2026-09-01"}, headers=operator_h)
    assert dup.status_code == 409


async def test_actual_expenses_change_effective_cost(client, operator_h):
    product = await _product(client, operator_h)
    detail = await _batch(client, operator_h, product["id"])
    r = await client.post(f"/api/batches/{detail['id']}/expenses",
                          json={"category": "rastamojka", "kind": "actual", "amount_usd": 40 * 250}, headers=operator_h)
    assert r.status_code == 201, r.text
    line = r.json()["lines"][0]
    assert line["per_unit"]["rastamojka"] == {"estimate": 264, "effective": 250}
    assert line["unit_cost"] == pytest.approx(2053.5477 - 14, abs=1e-3)
    assert line["unit_cost_est"] == pytest.approx(2053.5477, abs=1e-3)
    bad = await client.post(f"/api/batches/{detail['id']}/expenses",
                            json={"category": "rastamojka", "kind": "estimate", "amount_usd": 1}, headers=operator_h)
    assert bad.status_code == 422
    variance = (await client.get("/api/reports/batch-variance", headers=operator_h)).json()
    assert variance[0]["diff_per_unit"] == pytest.approx(14, abs=1e-3)


async def test_hand_channel_halves_rastamojka(client, operator_h):
    product = await _product(client, operator_h)
    channels = (await client.get("/api/channels", headers=operator_h)).json()
    hand = next(c for c in channels if c["code"] == "hand")
    detail = await _batch(client, operator_h, product["id"], channel_id=hand["id"])
    assert detail["lines"][0]["estimates"]["rastamojka"] == 132


async def test_sales_fifo_profit_and_stock(client, operator_h, admin_h):
    product = await _product(client, operator_h)
    b1 = await _batch(client, operator_h, product["id"], day="2026-08-01", qty=10, price=6000)
    b2 = await _batch(client, operator_h, product["id"], day="2026-08-05", qty=10, price=6500)
    dealer = (await client.post("/api/customers", json={"name": "Diler 1"}, headers=operator_h)).json()
    r = await client.post("/api/sales", json={"sale_date": "2026-08-10", "customer_id": dealer["id"],
                                              "lines": [{"product_id": product["id"], "qty": 15, "price_usd": 2200}]},
                          headers=operator_h)
    assert r.status_code == 201, r.text
    sale = r.json()
    allocs = sale["lines"][0]["allocations"]
    assert [(a["batch_date"], a["qty"]) for a in allocs] == [("2026-08-01", 10), ("2026-08-05", 5)]
    u1, u2 = b1["lines"][0]["unit_cost"], b2["lines"][0]["unit_cost"]
    assert sale["totals"]["cost"] == pytest.approx(10 * u1 + 5 * u2, abs=0.01)
    assert sale["totals"]["profit"] == pytest.approx(15 * 2200 - 10 * u1 - 5 * u2, abs=0.01)

    stock = (await client.get("/api/stock", headers=operator_h)).json()
    assert stock[0]["qty"] == 5 and stock[0]["lines"][0]["batch_date"] == "2026-08-05"

    short = await client.post("/api/sales", json={"sale_date": "2026-08-11", "lines": [
        {"product_id": product["id"], "qty": 6, "price_usd": 2200}]}, headers=operator_h)
    assert short.status_code == 409

    busy = await client.delete(f"/api/batches/{b1['id']}/lines/{b1['lines'][0]['id']}", headers=operator_h)
    assert busy.status_code == 409

    profit = (await client.get("/api/reports/profit?group_by=customer", headers=operator_h)).json()
    assert profit[0]["label"] == "Diler 1" and profit[0]["qty"] == 15

    assert (await client.delete(f"/api/sales/{sale['id']}", headers=operator_h)).status_code == 403
    assert (await client.delete(f"/api/sales/{sale['id']}", headers=admin_h)).status_code == 204
    stock = (await client.get("/api/stock", headers=operator_h)).json()
    assert stock[0]["qty"] == 20


async def test_client_lines_excluded_from_stock(client, operator_h):
    product = await _product(client, operator_h)
    cl = (await client.post("/api/customers", json={"name": "Begzod aka", "kind": "client"}, headers=operator_h)).json()
    await _batch(client, operator_h, product["id"], client_id=cl["id"], service_pct=0.01)
    assert (await client.get("/api/stock", headers=operator_h)).json() == []
    rows = (await client.get("/api/reports/clients", headers=operator_h)).json()
    assert rows[0]["service_fee_per_unit"] == pytest.approx(17.3025, abs=1e-3)
    assert rows[0]["charge_per_unit"] == pytest.approx(2053.5477 + 17.3025, abs=1e-3)


async def test_opening_balance_keeps_newest(client, operator_h):
    product = await _product(client, operator_h)
    await _batch(client, operator_h, product["id"], day="2026-07-01", qty=10)
    await _batch(client, operator_h, product["id"], day="2026-07-02", qty=10)
    r = await client.post("/api/stock/opening-balance", json={"as_of_date": "2026-07-31", "items": [
        {"product_id": product["id"], "qty": 12}]}, headers=operator_h)
    assert r.json() == [{"product_id": product["id"], "kept": 12, "written_off": 8}]
    stock = (await client.get("/api/stock", headers=operator_h)).json()[0]
    assert stock["qty"] == 12
    assert [(ln["batch_date"], ln["remaining_qty"]) for ln in stock["lines"]] == [("2026-07-01", 2),
                                                                                ("2026-07-02", 10)]
    # re-running replaces the previous opening balance
    await client.post("/api/stock/opening-balance", json={"as_of_date": "2026-07-31", "items": [
        {"product_id": product["id"], "qty": 20}]}, headers=operator_h)
    assert (await client.get("/api/stock", headers=operator_h)).json()[0]["qty"] == 20
    too_many = await client.post("/api/stock/opening-balance", json={"as_of_date": "2026-07-31", "items": [
        {"product_id": product["id"], "qty": 21}]}, headers=operator_h)
    assert too_many.status_code == 422


def _legacy_xlsx() -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Malumot kiritish"
    ws.append(["Сана", "Model", "Soni", "Narx AED", "Sotuv", "Rastamojka", None, "IMEI", "Cargo", "Yul", "Perivod",
               "Sertifikat", "Dubai", "Schet", "(-) Boji", "Naqd", "Deklarant", "Kurs", "Inspector", "B/U", "Upak", "Sim"])
    base = [15, 2, None, 0.01, 2192, 500, 778, 200, 180, 200, 3.67]
    d = datetime(2025, 11, 1)
    ws.append([d, "17 pro max 256 orange", 120, 4775, None, 215, None, *base, 2.5])
    ws.append([d, "17 pro max 256 silver", 80, 4814, None, 215, None, *base])
    ws.append([d, "17 pro max 256 blue", 80, 4684, None, 215, None, *base])
    ws.append([d, "17 pro max 512 orange", 10, 5940, None, 251, None, *base])
    ws.append([d, "17 pro max 512 silver", 20, 6050, None, 251, None, *base])
    ws.append(["01.11.2025 ЖАМИ", None, 310])
    ws.append([45964, "17 pro max 256 silver (1)", 20, 5080, None, 107.5, None, 15, 2, 50, 0.01,
               120, 570, 550, 200, 200, 100, 3.67, 260])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def test_legacy_import_dry_run_then_commit(client, operator_h):
    files = {"file": ("legacy.xlsx", _legacy_xlsx(),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    dry = await client.post("/api/imports/purchases?dry_run=true", files=files, headers=operator_h)
    assert dry.status_code == 200, dry.text
    assert [b["status"] for b in dry.json()["batches"]] == ["new", "new"]
    assert (await client.get("/api/batches", headers=operator_h)).json() == []

    done = (await client.post("/api/imports/purchases?dry_run=false", files=files, headers=operator_h)).json()
    assert done["created_batches"] == 2 and done["created_products"] == 5
    batches = (await client.get("/api/batches", headers=operator_h)).json()
    first = next(b for b in batches if b["batch_date"] == "2025-11-01")
    detail = (await client.get(f"/api/batches/{first['id']}", headers=operator_h)).json()
    costs = sorted(round(ln["unit_cost"], 4) for ln in detail["lines"])
    assert costs == sorted([1561.6653, 1569.8983, 1534.1217, 1915.7784, 1946.0509])

    second = next(b for b in batches if b["batch_date"] == "2025-11-03")
    line = (await client.get(f"/api/batches/{second['id']}", headers=operator_h)).json()["lines"][0]
    assert line["channel"]["code"] == "hand"
    assert line["estimates"]["inspector"] == 0 and "260" in line["note"]

    again = (await client.post("/api/imports/purchases?dry_run=false", files=files, headers=operator_h)).json()
    assert [b["status"] for b in again["batches"]] == ["exists", "exists"] and again["created_batches"] == 0


async def test_dashboard_and_settings(client, admin_h):
    assert (await client.get("/api/reports/dashboard", headers=admin_h)).status_code == 200
    r = await client.put("/api/settings", json={"customs_rate": 0.2}, headers=admin_h)
    assert r.json()["customs_rate"] == 0.2
    bu = await client.post("/api/bot-users", json={"telegram_id": 123456, "full_name": "Test"}, headers=admin_h)
    assert bu.status_code == 201
    assert (await client.post("/api/bot-users", json={"telegram_id": 123456}, headers=admin_h)).status_code == 409


async def test_batch_expense_defaults_are_editable(client, admin_h, operator_h):
    defaults = (await client.get("/api/settings", headers=operator_h)).json()
    assert [defaults[f"default_batch_{c}"] for c in (
        "certificate", "dubai_internal", "customs_invoice", "customs_duty", "customs_cash", "declarant",
    )] == [200, 500, 500, 200, 300, 200]
    r = await client.put("/api/settings", json={"default_batch_certificate": 250}, headers=admin_h)
    assert r.status_code == 200
    assert r.json()["default_batch_certificate"] == 250 and r.json()["default_batch_dubai_internal"] == 500
    assert (await client.get("/api/settings", headers=operator_h)).json()["default_batch_certificate"] == 250
    assert (await client.put("/api/settings", json={"default_batch_declarant": -1},
                             headers=admin_h)).status_code == 422
    assert (await client.put("/api/settings", json={"default_batch_declarant": 100},
                             headers=operator_h)).status_code == 403


async def test_opening_balance_rerun_after_sales_does_not_inflate(client, operator_h):
    product = await _product(client, operator_h)
    await _batch(client, operator_h, product["id"], day="2026-07-01", qty=20)
    body = {"as_of_date": "2026-07-31", "items": [{"product_id": product["id"], "qty": 12}]}
    await client.post("/api/stock/opening-balance", json=body, headers=operator_h)
    sale = await client.post("/api/sales", json={"sale_date": "2026-08-05", "lines": [
        {"product_id": product["id"], "qty": 5, "price_usd": 2200}]}, headers=operator_h)
    assert sale.status_code == 201
    assert (await client.post("/api/stock/opening-balance", json=body, headers=operator_h)).status_code == 200
    assert (await client.get("/api/stock", headers=operator_h)).json()[0]["qty"] == 7
    too_low = {"as_of_date": "2026-07-31", "items": [{"product_id": product["id"], "qty": 4}]}
    assert (await client.post("/api/stock/opening-balance", json=too_low, headers=operator_h)).status_code == 422


async def test_patch_line_keeps_manual_rastamojka_and_ignores_null(client, operator_h):
    product = await _product(client, operator_h)
    detail = await _batch(client, operator_h, product["id"], rastamojka=240)
    line = detail["lines"][0]
    r = await client.patch(f"/api/batches/{detail['id']}/lines/{line['id']}",
                           json={"channel_id": line["channel"]["id"], "product_id": product["id"], "qty": None,
                                 "note": "x"}, headers=operator_h)
    assert r.status_code == 200, r.text
    patched = r.json()["lines"][0]
    assert patched["estimates"]["rastamojka"] == 240 and patched["qty"] == 40 and patched["note"] == "x"
    channels = (await client.get("/api/channels", headers=operator_h)).json()
    hand = next(c for c in channels if c["code"] == "hand")
    r = await client.patch(f"/api/batches/{detail['id']}/lines/{line['id']}", json={"channel_id": hand["id"]},
                           headers=operator_h)
    assert r.json()["lines"][0]["estimates"]["rastamojka"] == 132


async def test_validation_error_detail_is_string(client, operator_h):
    r = await client.post("/api/batches", json={"batch_date": "not-a-date"}, headers=operator_h)
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)


async def test_last_admin_cannot_demote_self(client, admin_h, session):
    me = (await client.get("/api/auth/me", headers=admin_h)).json()
    r = await client.patch(f"/api/users/{me['id']}", json={"role": "viewer"}, headers=admin_h)
    assert r.status_code == 409


async def test_import_rejects_wrong_layout(client, operator_h):
    wb = Workbook()
    wb.active.append(["Nomi", "Baza narx"])
    buf = io.BytesIO()
    wb.save(buf)
    r = await client.post("/api/imports/purchases", files={"file": ("x.xlsx", buf.getvalue())}, headers=operator_h)
    assert r.status_code == 422
