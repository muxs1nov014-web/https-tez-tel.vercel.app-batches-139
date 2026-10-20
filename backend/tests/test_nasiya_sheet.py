"""Daily nasiya workbook parser (SPEC §18.1): pure, no DB."""

from datetime import date, datetime
from decimal import Decimal

from app.domain import nasiya_sheet as ns


def imei(n: int) -> str:
    """A valid 15-digit IMEI (Luhn check digit) from a small number."""
    body = f"35{n:012d}"
    total = 0
    for i, ch in enumerate(reversed(body)):
        d = int(ch)
        if i % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return body + str((10 - total % 10) % 10)


def grid(*columns: list) -> list[list]:
    """Columns → rows (the sheets are written column by column)."""
    height = max(len(c) for c in columns)
    return [[c[r] if r < len(c) else None for c in columns] for r in range(height)]


def codes(sheet: ns.SheetResult) -> list[str]:
    return [i.code for i in sheet.issues]


def test_luhn_and_imei_helper():
    assert ns.luhn_ok("490154203237518")  # the textbook IMEI
    assert not ns.luhn_ok("490154203237517")
    assert not ns.luhn_ok("49015420323751")
    assert all(ns.luhn_ok(imei(n)) for n in range(1, 50))


def test_a_clean_sheet_becomes_imei_level_items():
    rows = grid(
        ["15,10,2026", "Ali aka", "Sotuv", "15 blue 128", int(imei(1)), 635, "1 ta tel un kirim", 635],
        [None, None, "Nasiya", "18 max black 256", int(imei(2)), imei(3), "1900*2", "15,10,", "13 black 128",
         int(imei(4)), 460, "Nasiyada 3 ta", 4260],
        [None, None, "Qoldiq", "16 black 128", int(imei(5)), int(imei(6)), 2, "Ostatka"],
    )
    sheet = ns.parse_sheet(" Ali aka ", rows, 2026)

    assert sheet.name == "Ali aka" and sheet.sheet_date == date(2026, 10, 15)
    assert sheet.issues == []
    by_kind = {k: [i for i in sheet.items if i.kind == k] for k in ns.KINDS}
    assert [(i.model, i.imei, i.price_usd) for i in by_kind["sotuv"]] == [("15 blue 128", imei(1), Decimal(635))]
    assert [(i.model, i.imei, i.price_usd, i.marked_date) for i in by_kind["nasiya"]] == [
        ("18 max black 256", imei(2), Decimal(1900), None),
        ("18 max black 256", imei(3), Decimal(1900), None),
        ("13 black 128", imei(4), Decimal(460), date(2026, 10, 15)),
    ]
    assert [(i.imei, i.price_usd) for i in by_kind["qoldiq"]] == [(imei(5), None), (imei(6), None)]
    assert by_kind["nasiya"][0].cell == "B5"
    nasiya_decl = next(d for d in sheet.declared if d.kind == "nasiya")
    assert (nasiya_decl.qty, nasiya_decl.amount) == (3, Decimal(4260))


def test_count_mismatch_missing_price_invalid_and_duplicate_imei_are_errors():
    bad = imei(9)[:-1] + str((int(imei(9)[-1]) + 1) % 10)
    rows = grid(
        ["Nasiya", "17 pro 256", imei(1), imei(2), "1500*3", "16 black 128", imei(3), imei(4), "13 white 128", bad,
         480, "15 blue 128", imei(1), 640],
    )
    sheet = ns.parse_sheet("B", rows, 2026)
    assert codes(sheet) == ["count_mismatch", "price_missing", "imei_invalid", "imei_duplicate"]
    assert all(i.level == "error" for i in sheet.issues)
    assert sheet.issues[0].cell == "A5" and "yozilgan son 3, IMEI esa 2" in sheet.issues[0].message
    # nothing is dropped: the phones without a price are kept with price None
    assert [i.price_usd for i in sheet.items if i.model == "16 black 128"] == [None, None]


def test_a_small_number_after_debt_imeis_is_a_count_without_price():
    sheet = ns.parse_sheet("B", grid(["Nasiya", "17 max 256", imei(1), imei(2), 2]), 2026)
    assert codes(sheet) == ["price_missing"]
    assert [i.price_usd for i in sheet.items] == [None, None]


def test_footer_mismatch_is_a_warning_and_data_after_it_an_error():
    rows = grid(["Nasiya", "16 black 128", imei(1), 795, "Nasiyada 2 ta", 900, imei(2)])
    sheet = ns.parse_sheet("B", rows, 2026)
    assert [(i.level, i.code) for i in sheet.issues] == [
        ("error", "data_after_footer"), ("warning", "declared_qty"), ("warning", "declared_amount")]


def test_wide_header_continuation_column_inherits_the_kind():
    rows = grid(
        ["Насияга берилди", "13 black 128", imei(1), "460*1", "Nasiyada 2 ta"],
        [None, "16 white 128", imei(2), 800],
    )
    sheet = ns.parse_sheet("B", rows, 2026)
    assert [i.code for i in sheet.issues] == ["header_inherited"]
    assert [i.kind for i in sheet.items] == ["nasiya", "nasiya"]
    assert sheet.declared[0].columns == [0, 1]


def test_header_kind_against_footer_label_is_an_error():
    rows = grid(["Sotuv", "17 max 256", imei(1), imei(2), "1500*2", "Nasiyada 2 ta"])
    sheet = ns.parse_sheet("B", rows, 2026)
    assert codes(sheet) == ["kind_conflict"]
    assert [i.kind for i in sheet.items] == ["sotuv", "sotuv"]  # the header decides, the error asks to check


def test_a_paid_total_under_another_column_is_only_a_note():
    rows = grid(["Nasiya", "16 white 128", imei(1), 780, "4 ta tel un kirim", 3120],
                ["Qoldiq", "13 black 128", imei(2), 1, "Ostatka"])
    sheet = ns.parse_sheet("B", rows, 2026)
    assert sheet.issues == []
    sotuv = next(d for d in sheet.declared if d.kind == "sotuv")
    assert (sotuv.qty, sotuv.amount, sotuv.columns) == (4, Decimal(3120), [])


def test_names_notes_terms_and_variant_columns():
    rows = grid(
        [" N Variant", "12,07,2026", "Narimonjon aka", "17 max silver 256", imei(1), imei(2), "1640*2"],
        ["Nasiya", "8 kunga berildi", "18 max burgundy 256", imei(3), 1880, "160 000$"],
    )
    sheet = ns.parse_sheet("Narimonjon aka", rows, 2026)
    assert sheet.issues == []
    variant = [i for i in sheet.items if i.kind == "variant"]
    assert [(i.model, i.price_usd, i.marked_date) for i in variant] == [
        ("17 max silver 256", Decimal(1640), date(2026, 7, 12))] * 2
    nasiya = [i for i in sheet.items if i.kind == "nasiya"]
    assert [(i.imei, i.term_days) for i in nasiya] == [(imei(3), 8)]


def test_summary_panel_is_read_and_kept_out_of_the_items():
    rows = grid(
        ["Nasiya", "13 black 128", imei(1), 460],
        ["Ali aka", "Variant", "Nasiya", "Qoldiq ⚠️", "Jami", "Limit", "Berish mumkin", None, "Variant pul berish muddatlari",
         "31.10.2026"],
        [None, 0, 460, 20510.6, 20970.6, 200000, 179029.4, None, None, 159500],
    )
    sheet = ns.parse_sheet("Ali aka", rows, 2026)
    assert sheet.issues == []
    assert sheet.summary == {"variant": "0.00", "nasiya": "460.00", "qoldiq": "20510.60", "jami": "20970.60",
                             "limit": "200000.00", "available": "179029.40",
                             "schedule": [{"date": "2026-10-31", "amount": "159500"}]}
    assert len(sheet.items) == 1


def test_cross_sheet_duplicate_and_report_date():
    a = ns.parse_sheet("A", grid(["15,10,2026", "Qoldiq", "16 black 128", imei(1), 1]), 2026)
    b = ns.parse_sheet("B", grid(["15,10,2026", "Nasiya", "16 black 128", imei(1), 760]), 2026)
    stale = ns.parse_sheet("C", grid(["06,10,2026", "Qoldiq", "13 black 128", imei(2), 1]), 2026)
    assert [i.code for i in ns.check_workbook([a, b, stale])] == ["imei_cross_sheet"]
    assert ns.report_date([a, b, stale], None) == date(2026, 10, 15)
    assert ns.date_from_filename("nazorat_15.10.2026.xlsx") == date(2026, 10, 15)


def test_datetime_cells_and_numeric_strings():
    rows = grid([datetime(2026, 10, 15), "Nasiya", "16 black 128", imei(1), "760"])
    sheet = ns.parse_sheet("A", rows, 2026)
    assert sheet.sheet_date == date(2026, 10, 15)
    assert [(i.imei, i.price_usd) for i in sheet.items] == [(imei(1), Decimal(760))]


def test_sheet_key_ignores_case_spaces_and_punctuation():
    assert ns.sheet_key(" Adxam aka  B16") == ns.sheet_key("adxam AKA b-16") == "adxamakab16"
