"""Customer warehouses, debts and payments (SPEC §12)."""

import pytest

from tests.test_api import _batch, _product


async def _customer(client, h, name="Diler A", kind="dealer"):
    r = await client.post("/api/customers", json={"name": name, "kind": kind}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


async def _move(client, h, customer_id, kind, product_id, qty, price=None, day="2026-09-01", expect=201):
    line = {"product_id": product_id, "qty": qty}
    if price is not None:
        line["price_usd"] = price
    r = await client.post(f"/api/customers/{customer_id}/moves",
                          json={"move_date": day, "kind": kind, "lines": [line]}, headers=h)
    assert r.status_code == expect, r.text
    return r.json()


async def _consignment_sale(client, h, customer_id, product_id, qty, price, day="2026-09-10", expect=201):
    line = {"product_id": product_id, "qty": qty, "price_usd": price}
    r = await client.post(f"/api/customers/{customer_id}/consignment-sales",
                          json={"sale_date": day, "lines": [line]}, headers=h)
    assert r.status_code == expect, r.text
    return r.json()


async def _our_stock(client, h):
    rows = (await client.get("/api/stock", headers=h)).json()
    return rows[0] if rows else {"qty": 0, "lines": []}


async def _get(client, h, path):
    r = await client.get(path, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


async def test_handover_moves_units_from_our_stock_to_customer(client, operator_h):
    product = await _product(client, operator_h)
    b1 = await _batch(client, operator_h, product["id"], day="2026-08-01", qty=10)
    b2 = await _batch(client, operator_h, product["id"], day="2026-08-05", qty=10, price=6500)
    dealer = await _customer(client, operator_h)

    move = await _move(client, operator_h, dealer["id"], "out", product["id"], 12, price=2300)
    assert move["kind"] == "out" and move["total_qty"] == 12 and move["total_value"] == 27600
    assert move["lines"] == [{"product": {"id": product["id"], "name": product["name"]}, "qty": 12, "price_usd": 2300}]

    ours = await _our_stock(client, operator_h)
    assert ours["qty"] == 8 and [ln["batch_date"] for ln in ours["lines"]] == ["2026-08-05"]
    b1_line = (await _get(client, operator_h, f"/api/batches/{b1['id']}"))["lines"][0]
    assert b1_line["remaining_qty"] == 0 and b1_line["sold_qty"] == 0

    held = await _get(client, operator_h, f"/api/customers/{dealer['id']}/stock")
    u1, u2 = b1["lines"][0]["unit_cost"], b2["lines"][0]["unit_cost"]
    assert len(held) == 1
    row = held[0]
    assert row["qty"] == 12 and row["price_usd"] == 2300 and row["value_price"] == 27600
    assert row["value_cost"] == pytest.approx(10 * u1 + 2 * u2, abs=0.01)
    assert [(ln["batch_date"], ln["qty"], ln["price_usd"]) for ln in row["lines"]] == [
        ("2026-08-01", 10, 2300), ("2026-08-05", 2, 2300)]

    short = await _move(client, operator_h, dealer["id"], "out", product["id"], 9, price=2300, expect=409)
    assert "8 dona bor" in short["detail"]

    summary = await _get(client, operator_h, "/api/customers/summary")
    mine = next(s for s in summary if s["customer"]["id"] == dealer["id"])
    assert mine["customer"] == {"id": dealer["id"], "name": "Diler A", "kind": "dealer"}
    assert mine["debt"] == 0 and mine["stock_qty"] == 12 and mine["exposure"] == 27600
    assert mine["last_payment_date"] is None


async def test_return_is_lifo_and_limited_to_customer_stock(client, operator_h):
    product = await _product(client, operator_h)
    b1 = await _batch(client, operator_h, product["id"], day="2026-08-01", qty=5)
    b2 = await _batch(client, operator_h, product["id"], day="2026-08-05", qty=5)
    dealer = await _customer(client, operator_h)
    await _move(client, operator_h, dealer["id"], "out", product["id"], 5, price=2300, day="2026-09-01")  # all of b1
    await _move(client, operator_h, dealer["id"], "out", product["id"], 3, price=2400, day="2026-09-02")  # 3 of b2

    # LIFO: the newest handover (b2, 2026-09-02) comes back first, then b1; a price on a return is ignored.
    ret = await _move(client, operator_h, dealer["id"], "return", product["id"], 4, price=999, day="2026-09-03")
    assert ret["total_value"] is None and ret["lines"][0]["price_usd"] is None and ret["total_qty"] == 4

    held = (await _get(client, operator_h, f"/api/customers/{dealer['id']}/stock"))[0]
    assert [(ln["purchase_line_id"], ln["qty"]) for ln in held["lines"]] == [(b1["lines"][0]["id"], 4)]
    assert held["price_usd"] == 2300
    ours = await _our_stock(client, operator_h)
    assert [(ln["batch_date"], ln["remaining_qty"]) for ln in ours["lines"]] == [("2026-08-01", 1), ("2026-08-05", 5)]

    too_many = await _move(client, operator_h, dealer["id"], "return", product["id"], 5, day="2026-09-04", expect=409)
    assert "mijozda 4 dona bor" in too_many["detail"]

    moves = await _get(client, operator_h, f"/api/customers/{dealer['id']}/moves")
    assert [(m["move_date"], m["kind"], m["total_qty"]) for m in moves] == [
        ("2026-09-03", "return", 4), ("2026-09-02", "out", 3), ("2026-09-01", "out", 5)]
    assert b2["lines"][0]["id"] not in [ln["purchase_line_id"] for ln in held["lines"]]


async def test_consignment_sale_creates_revenue_and_debt_and_restores_on_delete(client, operator_h, admin_h):
    product = await _product(client, operator_h)
    batch = await _batch(client, operator_h, product["id"], day="2026-08-01", qty=10)
    unit_cost = batch["lines"][0]["unit_cost"]
    dealer = await _customer(client, operator_h)
    await _move(client, operator_h, dealer["id"], "out", product["id"], 6, price=2300)

    sale = await _consignment_sale(client, operator_h, dealer["id"], product["id"], 4, 2500)
    assert sale["source"] == "consignment" and sale["customer"]["id"] == dealer["id"]
    assert sale["totals"]["revenue"] == 10000
    assert sale["totals"]["cost"] == pytest.approx(4 * unit_cost, abs=0.01)
    assert [(a["batch_date"], a["qty"]) for a in sale["lines"][0]["allocations"]] == [("2026-08-01", 4)]

    held = await _get(client, operator_h, f"/api/customers/{dealer['id']}/stock")
    assert held[0]["qty"] == 2
    assert (await _our_stock(client, operator_h))["qty"] == 4  # a consignment sale does not touch our warehouse

    listed = await _get(client, operator_h, "/api/sales")
    assert [(s["id"], s["source"]) for s in listed] == [(sale["id"], "consignment")]
    own_sales = await _get(client, operator_h, f"/api/customers/{dealer['id']}/sales")
    assert [s["id"] for s in own_sales] == [sale["id"]]

    overview = await _get(client, operator_h, f"/api/customers/{dealer['id']}/overview")
    assert overview["balance"]["debt"] == 10000 and overview["balance"]["stock_qty"] == 2
    assert overview["balance"]["exposure"] == 10000 + 2 * 2300
    assert overview["totals"] == {"opening_debt": 0, "charged_sales": 10000, "charged_service": 0, "paid": 0,
                                  "given_qty": 6, "returned_qty": 0, "sold_qty": 4}

    await _consignment_sale(client, operator_h, dealer["id"], product["id"], 3, 2500, expect=409)
    stock_sale = await client.post("/api/sales", json={"sale_date": "2026-09-10", "lines": [
        {"product_id": product["id"], "qty": 5, "price_usd": 2200}]}, headers=operator_h)
    assert stock_sale.status_code == 409  # the units at the customer cannot be sold from our warehouse

    assert (await client.delete(f"/api/sales/{sale['id']}", headers=admin_h)).status_code == 204
    held = await _get(client, operator_h, f"/api/customers/{dealer['id']}/stock")
    assert held[0]["qty"] == 6
    assert (await _our_stock(client, operator_h))["qty"] == 4
    overview = await _get(client, operator_h, f"/api/customers/{dealer['id']}/overview")
    assert overview["balance"]["debt"] == 0 and overview["totals"]["sold_qty"] == 0


async def test_stock_sale_reports_source_stock(client, operator_h):
    product = await _product(client, operator_h)
    await _batch(client, operator_h, product["id"], qty=2)
    r = await client.post("/api/sales", json={"sale_date": "2026-09-10", "lines": [
        {"product_id": product["id"], "qty": 1, "price_usd": 2200}]}, headers=operator_h)
    assert r.status_code == 201 and r.json()["source"] == "stock"
    assert (await _get(client, operator_h, "/api/sales"))[0]["source"] == "stock"


async def test_debt_formula_and_ledger_running_balance(client, operator_h, admin_h):
    product = await _product(client, operator_h)
    customer = await _customer(client, operator_h, name="Begzod aka", kind="client")
    cid = customer["id"]
    service_batch = await _batch(client, operator_h, product["id"], day="2026-07-01", qty=40, client_id=cid,
                                 service_pct=0.01)
    await _batch(client, operator_h, product["id"], day="2026-08-01", qty=10)
    charge = (await _get(client, operator_h, f"/api/reports/clients?customer_id={cid}"))[0]["charge_total"]
    assert charge == pytest.approx(40 * (2053.5477 + 17.3025), abs=0.01)

    r = await client.post(f"/api/customers/{cid}/payments", json={"payment_date": "2026-06-30", "amount_usd": 1000,
                                                                  "kind": "opening_debt", "note": "Excel"},
                          headers=operator_h)
    assert r.status_code == 201, r.text
    opening = r.json()
    assert opening["kind"] == "opening_debt" and opening["amount_usd"] == 1000 and opening["created_at"]
    stock_sale = (await client.post("/api/sales", json={"sale_date": "2026-08-10", "customer_id": cid, "lines": [
        {"product_id": product["id"], "qty": 2, "price_usd": 2200}]}, headers=operator_h)).json()
    await _move(client, operator_h, cid, "out", product["id"], 3, price=2300, day="2026-08-11")
    cons_sale = await _consignment_sale(client, operator_h, cid, product["id"], 1, 2400, day="2026-08-12")
    payment = (await client.post(f"/api/customers/{cid}/payments", json={
        "payment_date": "2026-08-15", "amount_usd": "5000.50", "kind": "payment"}, headers=operator_h)).json()

    debt = 1000 + 4400 + 2400 + charge - 5000.50
    overview = await _get(client, operator_h, f"/api/customers/{cid}/overview")
    totals = overview["totals"]
    assert totals["opening_debt"] == 1000 and totals["charged_sales"] == 6800 and totals["paid"] == 5000.50
    assert totals["charged_service"] == pytest.approx(charge, abs=1e-4)
    assert overview["balance"]["debt"] == pytest.approx(debt, abs=1e-4)
    assert overview["balance"]["exposure"] == pytest.approx(debt + 2 * 2300, abs=1e-4)
    assert overview["balance"]["last_payment_date"] == "2026-08-15"

    ledger = await _get(client, operator_h, f"/api/customers/{cid}/ledger")
    assert [(row["date"], row["type"], row["ref_id"]) for row in ledger] == [
        ("2026-06-30", "opening_debt", opening["id"]),
        ("2026-07-01", "service", service_batch["lines"][0]["id"]),
        ("2026-08-10", "sale", stock_sale["id"]),
        ("2026-08-12", "sale", cons_sale["id"]),
        ("2026-08-15", "payment", payment["id"]),
    ]
    assert [row["debit"] for row in ledger] == [1000, pytest.approx(charge, abs=1e-4), 4400, 2400, 0]
    assert [row["credit"] for row in ledger] == [0, 0, 0, 0, 5000.50]
    running = 0.0
    for row in ledger:
        running += row["debit"] - row["credit"]
        assert row["balance"] == pytest.approx(running, abs=1e-4)
    assert ledger[-1]["credit"] == 5000.50 and ledger[-1]["balance"] == pytest.approx(debt, abs=1e-4)
    assert "qo'lidagi moldan" in ledger[3]["description"] and "Excel" in ledger[0]["description"]

    payments = await _get(client, operator_h, f"/api/customers/{cid}/payments")
    assert [p["id"] for p in payments] == [payment["id"], opening["id"]]
    summary_row = next(s for s in await _get(client, operator_h, "/api/customers/summary")
                       if s["customer"]["id"] == cid)
    assert summary_row["debt"] == pytest.approx(debt, abs=1e-4)

    assert (await client.delete(f"/api/customers/{cid}/payments/{payment['id']}",
                                headers=admin_h)).status_code == 204
    overview = await _get(client, operator_h, f"/api/customers/{cid}/overview")
    assert overview["balance"]["debt"] == pytest.approx(debt + 5000.50, abs=1e-4)
    assert overview["balance"]["last_payment_date"] is None


async def test_move_delete_guard(client, operator_h, admin_h):
    product = await _product(client, operator_h)
    await _batch(client, operator_h, product["id"], day="2026-08-01", qty=10)
    dealer = await _customer(client, operator_h)
    other = await _customer(client, operator_h, name="Diler B")
    handover = await _move(client, operator_h, dealer["id"], "out", product["id"], 5, price=2300)
    sale = await _consignment_sale(client, operator_h, dealer["id"], product["id"], 3, 2500)

    path = f"/api/customers/{dealer['id']}/moves/{handover['id']}"
    assert (await client.delete(path, headers=admin_h)).status_code == 422  # 3 of its units were sold
    assert (await client.delete(f"/api/customers/{other['id']}/moves/{handover['id']}",
                                headers=admin_h)).status_code == 404
    assert (await client.delete(f"/api/sales/{sale['id']}", headers=admin_h)).status_code == 204
    assert (await client.delete(path, headers=admin_h)).status_code == 204
    assert (await _our_stock(client, operator_h))["qty"] == 10
    assert await _get(client, operator_h, f"/api/customers/{dealer['id']}/stock") == []

    # Deleting a return puts units back at the customer: refused once we sold them from our warehouse.
    await _move(client, operator_h, dealer["id"], "out", product["id"], 5, price=2300, day="2026-09-02")
    ret = await _move(client, operator_h, dealer["id"], "return", product["id"], 5, day="2026-09-03")
    r = await client.post("/api/sales", json={"sale_date": "2026-09-04", "lines": [
        {"product_id": product["id"], "qty": 10, "price_usd": 2200}]}, headers=operator_h)
    assert r.status_code == 201
    assert (await client.delete(f"/api/customers/{dealer['id']}/moves/{ret['id']}",
                                headers=admin_h)).status_code == 422


async def test_batch_line_guards_count_consigned_units(client, operator_h):
    product = await _product(client, operator_h)
    other = await _product(client, operator_h, color="Silver")
    batch = await _batch(client, operator_h, product["id"], day="2026-08-01", qty=10)
    line = batch["lines"][0]
    dealer = await _customer(client, operator_h)
    await _move(client, operator_h, dealer["id"], "out", product["id"], 6, price=2300)
    line_path = f"/api/batches/{batch['id']}/lines/{line['id']}"

    assert (await client.patch(line_path, json={"qty": 5}, headers=operator_h)).status_code == 422
    assert (await client.patch(line_path, json={"product_id": other["id"]}, headers=operator_h)).status_code == 422
    assert (await client.delete(line_path, headers=operator_h)).status_code == 409
    adj = await client.post("/api/stock/adjustments", json={"purchase_line_id": line["id"], "qty": 5,
                                                            "reason": "writeoff"}, headers=operator_h)
    assert adj.status_code == 422  # only 4 units are in our warehouse

    # Counted after the handover (09-01): 4 on hand, the 6 at the customer are not in our warehouse.
    body = {"as_of_date": "2026-09-30", "items": [{"product_id": product["id"], "qty": 4}]}
    r = await client.post("/api/stock/opening-balance", json=body, headers=operator_h)
    assert r.json() == [{"product_id": product["id"], "kept": 4, "written_off": 0}]
    body["items"][0]["qty"] = 5
    assert (await client.post("/api/stock/opening-balance", json=body, headers=operator_h)).status_code == 422

    r = await client.patch(line_path, json={"qty": 6}, headers=operator_h)
    assert r.status_code == 200, r.text
    assert r.json()["lines"][0]["remaining_qty"] == 0


async def test_customer_accounts_rbac_and_validation(client, viewer_h, operator_h, admin_h):
    product = await _product(client, operator_h)
    await _batch(client, operator_h, product["id"], qty=5)
    dealer = await _customer(client, operator_h)
    base = f"/api/customers/{dealer['id']}"
    move_body = {"move_date": "2026-09-01", "kind": "out",
                 "lines": [{"product_id": product["id"], "qty": 1, "price_usd": 2300}]}
    pay_body = {"payment_date": "2026-09-01", "amount_usd": 100, "kind": "payment"}
    sale_body = {"sale_date": "2026-09-01", "lines": [{"product_id": product["id"], "qty": 1, "price_usd": 1}]}

    assert (await client.get("/api/customers/summary")).status_code == 401
    assert (await client.post(f"{base}/moves", json=move_body)).status_code == 401
    for path in ("/api/customers/summary", f"{base}/overview", f"{base}/stock", f"{base}/moves", f"{base}/sales",
                 f"{base}/payments", f"{base}/ledger"):
        assert (await client.get(path, headers=viewer_h)).status_code == 200, path
    assert (await client.post(f"{base}/moves", json=move_body, headers=viewer_h)).status_code == 403
    assert (await client.post(f"{base}/payments", json=pay_body, headers=viewer_h)).status_code == 403
    assert (await client.post(f"{base}/consignment-sales", json=sale_body, headers=viewer_h)).status_code == 403

    move = (await client.post(f"{base}/moves", json=move_body, headers=operator_h)).json()
    payment = (await client.post(f"{base}/payments", json=pay_body, headers=operator_h)).json()
    assert (await client.delete(f"{base}/moves/{move['id']}", headers=operator_h)).status_code == 403
    assert (await client.delete(f"{base}/payments/{payment['id']}", headers=operator_h)).status_code == 403
    assert (await client.delete(f"{base}/payments/{payment['id']}", headers=admin_h)).status_code == 204
    assert (await client.delete(f"{base}/payments/{payment['id']}", headers=admin_h)).status_code == 404

    # Validation
    no_price = {**move_body, "lines": [{"product_id": product["id"], "qty": 1}]}
    r = await client.post(f"{base}/moves", json=no_price, headers=operator_h)
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)
    zero_price = {**move_body, "lines": [{"product_id": product["id"], "qty": 1, "price_usd": 0}]}
    assert (await client.post(f"{base}/moves", json=zero_price, headers=operator_h)).status_code == 422
    zero_qty = {**move_body, "lines": [{"product_id": product["id"], "qty": 0, "price_usd": 1}]}
    assert (await client.post(f"{base}/moves", json=zero_qty, headers=operator_h)).status_code == 422
    assert (await client.post(f"{base}/moves", json={**move_body, "lines": []}, headers=operator_h)).status_code == 422
    for amount in (0, -5, "1.005"):
        r = await client.post(f"{base}/payments", json={**pay_body, "amount_usd": amount}, headers=operator_h)
        assert r.status_code == 422, amount
    zero_sale = {"sale_date": "2026-09-01", "lines": [{"product_id": product["id"], "qty": 1, "price_usd": 0}]}
    assert (await client.post(f"{base}/consignment-sales", json=zero_sale, headers=operator_h)).status_code == 422
    missing_product = {**move_body, "lines": [{"product_id": 999999, "qty": 1, "price_usd": 1}]}
    assert (await client.post(f"{base}/moves", json=missing_product, headers=operator_h)).status_code == 404

    # Unknown customer -> 404 everywhere
    for path in ("/api/customers/999999/overview", "/api/customers/999999/stock", "/api/customers/999999/moves",
                 "/api/customers/999999/sales", "/api/customers/999999/payments", "/api/customers/999999/ledger"):
        assert (await client.get(path, headers=viewer_h)).status_code == 404, path
    assert (await client.post("/api/customers/999999/payments", json=pay_body,
                              headers=operator_h)).status_code == 404
    assert (await client.post("/api/customers/999999/moves", json=move_body, headers=operator_h)).status_code == 404


async def _opening(client, h, product_id, qty, as_of="2026-08-31"):
    return await client.post("/api/stock/opening-balance", json={"as_of_date": as_of, "items": [
        {"product_id": product_id, "qty": qty}]}, headers=h)


async def test_opening_balance_ignores_consignment_sales_after_as_of(client, operator_h):
    product = await _product(client, operator_h)
    await _batch(client, operator_h, product["id"], day="2026-08-01", qty=10)
    dealer = await _customer(client, operator_h)
    await _move(client, operator_h, dealer["id"], "out", product["id"], 5, price=2300, day="2026-08-10")
    await _consignment_sale(client, operator_h, dealer["id"], product["id"], 3, 2500, day="2026-09-05")

    # On 08-31 we held 10 - 5 = 5; the customer's sale on 09-05 never touched our warehouse.
    r = await _opening(client, operator_h, product["id"], 5)
    assert r.status_code == 200, r.text
    assert r.json() == [{"product_id": product["id"], "kept": 5, "written_off": 0}]
    assert (await _our_stock(client, operator_h))["qty"] == 5


async def test_opening_balance_subtracts_moves_after_as_of(client, operator_h):
    product = await _product(client, operator_h)
    await _batch(client, operator_h, product["id"], day="2026-08-01", qty=10)
    dealer = await _customer(client, operator_h)
    await _move(client, operator_h, dealer["id"], "out", product["id"], 5, price=2300, day="2026-09-05")

    r = await _opening(client, operator_h, product["id"], 10)  # counted before the handover
    assert r.status_code == 200, r.text
    assert (await _our_stock(client, operator_h))["qty"] == 5
    too_many = await _opening(client, operator_h, product["id"], 11)
    assert too_many.status_code == 422 and "10 dona" in too_many.json()["detail"]
    too_few = await _opening(client, operator_h, product["id"], 4)
    assert too_few.status_code == 422 and "mijozlarga berilgan" in too_few.json()["detail"]

    # A return after as_of brings units back into our warehouse: net handed over = 5 - 2 = 3.
    await _move(client, operator_h, dealer["id"], "return", product["id"], 2, day="2026-09-06")
    assert (await _opening(client, operator_h, product["id"], 10)).status_code == 200
    assert (await _our_stock(client, operator_h))["qty"] == 7


async def test_line_with_returned_handover_keeps_product_and_client(client, operator_h):
    product = await _product(client, operator_h)
    other = await _product(client, operator_h, color="Silver")
    batch = await _batch(client, operator_h, product["id"], day="2026-08-01", qty=10)
    line_path = f"/api/batches/{batch['id']}/lines/{batch['lines'][0]['id']}"
    dealer = await _customer(client, operator_h)
    await _move(client, operator_h, dealer["id"], "out", product["id"], 4, price=2300)

    line = (await _get(client, operator_h, f"/api/batches/{batch['id']}"))["lines"][0]
    assert (line["sold_qty"], line["adjusted_qty"], line["consigned_qty"], line["remaining_qty"]) == (0, 0, 4, 6)

    await _move(client, operator_h, dealer["id"], "return", product["id"], 4, day="2026-09-02")
    line = (await _get(client, operator_h, f"/api/batches/{batch['id']}"))["lines"][0]
    assert (line["consigned_qty"], line["remaining_qty"]) == (0, 10)
    # Nothing is out any more, but the handover documents still point at this line.
    assert (await client.patch(line_path, json={"product_id": other["id"]}, headers=operator_h)).status_code == 422
    assert (await client.patch(line_path, json={"client_id": dealer["id"], "service_pct": 0.01},
                               headers=operator_h)).status_code == 422
    r = await client.patch(line_path, json={"qty": 3}, headers=operator_h)
    assert r.status_code == 200 and r.json()["lines"][0]["remaining_qty"] == 3


async def test_inactive_customers_in_summary_and_handover(client, operator_h, session):
    from app.bot import customers_menu

    product = await _product(client, operator_h)
    await _batch(client, operator_h, product["id"], day="2026-08-01", qty=10)
    holder = await _customer(client, operator_h, name="A holder")
    debtor = await _customer(client, operator_h, name="B debtor")
    settled = await _customer(client, operator_h, name="C settled")
    active = await _customer(client, operator_h, name="D active")
    await _move(client, operator_h, holder["id"], "out", product["id"], 3, price=2300)
    await client.post(f"/api/customers/{debtor['id']}/payments", json={
        "payment_date": "2026-08-01", "amount_usd": 100, "kind": "opening_debt"}, headers=operator_h)
    for c in (holder, debtor, settled):
        r = await client.patch(f"/api/customers/{c['id']}", json={"is_active": False}, headers=operator_h)
        assert r.status_code == 200

    summary = await _get(client, operator_h, "/api/customers/summary")
    assert [s["customer"]["name"] for s in summary] == ["A holder", "B debtor", "D active"]

    refused = await _move(client, operator_h, holder["id"], "out", product["id"], 1, price=2300, expect=422)
    assert "faol emas" in refused["detail"]
    await _move(client, operator_h, holder["id"], "return", product["id"], 1, day="2026-09-02")

    _, keyboard = await customers_menu.customer_list(session)  # the bot lists active customers only
    assert [b.callback_data for row in keyboard.inline_keyboard for b in row] == [f"c:{active['id']}"]
