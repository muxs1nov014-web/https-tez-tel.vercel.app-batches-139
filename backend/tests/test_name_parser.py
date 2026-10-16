import pytest

from app.importers.name_parser import parse_name


@pytest.mark.parametrize("raw,name,channel", [
    ("17 pro max 256 silver", "iPhone 17 Pro Max 256GB Silver", "cargo"),
    ("17 pro max 256 silver (esim)  (1)", "iPhone 17 Pro Max 256GB Silver eSIM", "hand"),
    ("16 pro max256 desert", "iPhone 16 Pro Max 256GB Desert", "cargo"),
    ("Iphone 13 128  blekc", "iPhone 13 128GB Black", "cargo"),
    ("13128", "iPhone 13 128GB", "cargo"),
    ("17 pro max 1 tb siver", "iPhone 17 Pro Max 1TB Silver", "cargo"),
    ("17 pro max blue 2tb", "iPhone 17 Pro Max 2TB Blue", "cargo"),
    ("S25 ultra 12+256 greey", "Galaxy S25 Ultra 12/256GB Grey", "cargo"),
    ("A56 8+256 olivie", "Galaxy A56 8/256GB Olive", "cargo"),
    ("Samsung tab S10 FE 5G silver", "Galaxy Tab S10 FE 5G Silver", "cargo"),
    ("Dyson PH05", "Dyson PH05", "cargo"),
])
def test_parse(raw, name, channel):
    parsed = parse_name(raw)
    assert parsed.name == name
    assert parsed.channel_code == channel
