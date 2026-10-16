from decimal import Decimal as D

from app.domain.costing import LineInput, compute_batch, rastamojka_estimate


def test_brief_example_40_x_18_pro_max():
    line = LineInput(key=1, qty=40, price_aed=D("6350"), rate=D("3.67"), perevod_pct=D("0.01"), cargo=D("2"),
                     imei=D("15"), rastamojka=D("264"))
    result = compute_batch([line], {"certificate": D("500"), "dubai_internal": D("200"), "declarant": D("300")}, {})
    cost = result.line(1)
    assert round(cost.price_usd, 4) == D("1730.2452")
    assert round(cost.overhead, 4) == D("323.3025")
    assert round(cost.unit_cost, 4) == D("2053.5477")
    assert cost.unit_cost == cost.unit_cost_est


def test_excel_first_day_matches_workbook():
    # 'Foyda xisoboti' rows 3-7 (2025-11-01): V = SUM(F:R)
    common = dict(rate=D("3.67"), perevod_pct=D("0.01"), cargo=D("2"), imei=D("15"))
    lines = [
        LineInput(key=1, qty=120, price_aed=D("4775"), rastamojka=D("215"), inspector=D("2.5"), **common),
        LineInput(key=2, qty=80, price_aed=D("4814"), rastamojka=D("215"), **common),
        LineInput(key=3, qty=80, price_aed=D("4684"), rastamojka=D("215"), **common),
        LineInput(key=4, qty=10, price_aed=D("5940"), rastamojka=D("251"), **common),
        LineInput(key=5, qty=20, price_aed=D("6050"), rastamojka=D("251"), **common),
    ]
    estimates = {"certificate": D("2192"), "dubai_internal": D("500"), "customs_invoice": D("778"),
                 "customs_duty": D("200"), "customs_cash": D("180"), "declarant": D("200")}
    result = compute_batch(lines, estimates, {})
    expected = {1: "1561.6653335677245", 2: "1569.8983035949723", 3: "1534.1217368374791",
                4: "1915.778412586798", 5: "1946.0508921508306"}
    for key, value in expected.items():
        assert abs(result.line(key).unit_cost - D(value)) < D("0.0001")


def test_actual_line_category_spread_by_estimate_and_batch_category_equal():
    a = LineInput(key=1, qty=10, price_aed=D("367"), rate=D("3.67"), rastamojka=D("200"))
    b = LineInput(key=2, qty=10, price_aed=D("367"), rate=D("3.67"), rastamojka=D("50"))
    result = compute_batch([a, b], {"certificate": D("100")}, {"rastamojka": D("2000"), "certificate": D("60")})
    # estimate total 2500 -> actual 2000: a gets 1600/10 = 160, b gets 400/10 = 40
    assert result.line(1).per_unit["rastamojka"] == (D("200"), D("160"))
    assert result.line(2).per_unit["rastamojka"] == (D("50"), D("40"))
    assert result.line(1).per_unit["certificate"] == (D("5"), D("3"))
    cat = next(c for c in result.categories if c.code == "rastamojka")
    assert cat.estimate_total == D("2500") and cat.effective_total == D("2000")


def test_actual_without_estimate_splits_equally():
    a = LineInput(key=1, qty=3, price_aed=D("100"), rate=D("1"))
    b = LineInput(key=2, qty=1, price_aed=D("100"), rate=D("1"))
    result = compute_batch([a, b], {}, {"cargo": D("40")})
    assert result.line(1).per_unit["cargo"][1] == D("10")
    assert result.line(2).per_unit["cargo"][1] == D("10")


def test_rastamojka_estimate():
    assert rastamojka_estimate(D("1500"), D("0.176"), D("1")) == D("264.00")
    assert rastamojka_estimate(D("1190"), D("0.176"), D("0.5")) == D("104.72")
    assert rastamojka_estimate(None, D("0.176"), D("1")) == D("0")
