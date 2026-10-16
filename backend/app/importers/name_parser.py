"""Parse free-text product names from the legacy Excel into a catalog identity.

Examples: "17 pro max 256 silver (esim) (1)", "S25 ultra 12+256 greey", "Iphone 13 128  blekc".
"""

import re

from app.domain.naming import ParsedName, normalize_alias, search_text_for  # noqa: F401 (re-exported)

COLOR_MAP = {
    "black": "Black", "bleck": "Black", "blekc": "Black", "belck": "Black", "blekс": "Black",
    "white": "White",
    "silver": "Silver", "sailver": "Silver", "siver": "Silver", "silvetr": "Silver",
    "blue": "Blue", "bleu": "Blue",
    "grey": "Grey", "gray": "Grey", "greey": "Grey", "greeey": "Grey",
    "lavender": "Lavender", "lavander": "Lavender", "lavendem": "Lavender",
    "lima": "Lime", "lime": "Lime",
    "olivie": "Olive", "olive": "Olive",
    "burgunday": "Burgundy", "burgundy": "Burgundy",
}
APPLE_TIERS = ("pro", "max", "air", "plus", "mini")
APPLE_STORAGE = {"64": "64GB", "128": "128GB", "256": "256GB", "512": "512GB", "1tb": "1TB", "2tb": "2TB",
                 "12": "128GB"}  # "16 12 pink" is a typo for 128


def _color(tokens: list[str]) -> str:
    return " ".join(COLOR_MAP.get(t, t.capitalize()) for t in tokens)


def parse_name(raw: str) -> ParsedName:
    s = normalize_alias(raw)
    channel = "hand" if "(1)" in s else "cargo"
    variant = "eSIM" if "(esim)" in s else None
    s = re.sub(r"\([^)]*\)", " ", s)
    s = s.replace("iphone", " ")
    s = re.sub(r"(\d)\s*[+/]\s*(\d)", r"\1 \2", s)          # 12+256, 8/256
    s = re.sub(r"([a-zа-я]{2,})(\d)", r"\1 \2", s)          # max256, air256 (keeps s25, a07)
    s = re.sub(r"\b(\d)\s+tb\b", r"\1tb", s)                 # 1 tb -> 1tb
    s = re.sub(r"^(1[1-8])(128|256|512)\b", r"\1 \2", s)     # 13128 -> 13 128
    tokens = s.split()
    if not tokens:
        return ParsedName("Other", raw.strip(), "", "", variant, channel)

    first = tokens[0]
    if first == "dyson":
        return ParsedName("Dyson", "Dyson " + "".join(t.upper() for t in tokens[1:]), "", "", variant, channel)
    if first in ("макбоок", "macbook"):
        return ParsedName("Apple", "MacBook", "", "", variant, channel)
    if first == "google" or first == "pixel":
        return _parse_pixel(tokens, variant, channel)
    if first == "samsung" or first == "tab" or re.fullmatch(r"[sa]\d{2}", first):
        return _parse_samsung(tokens, variant, channel)
    if re.fullmatch(r"1[1-8]", first):
        return _parse_iphone(tokens, variant, channel)
    return ParsedName("Other", raw.strip(), "", "", variant, channel)


def _parse_iphone(tokens: list[str], variant: str | None, channel: str) -> ParsedName:
    number, rest = tokens[0], tokens[1:]
    tiers: list[str] = []
    while rest and rest[0] in APPLE_TIERS:
        tiers.append(rest.pop(0))
    storage = ""
    colors: list[str] = []
    for t in rest:
        if not storage and t in APPLE_STORAGE:
            storage = APPLE_STORAGE[t]
        else:
            colors.append(t)
    model = "iPhone " + " ".join([number] + [t.capitalize() for t in tiers])
    return ParsedName("Apple", model, storage, _color(colors), variant, channel)


def _parse_samsung(tokens: list[str], variant: str | None, channel: str) -> ParsedName:
    if tokens[0] == "samsung":
        tokens = tokens[1:]
    if tokens and tokens[0] == "tab":
        words, colors = [], []
        for t in tokens[1:]:
            (colors if t in COLOR_MAP or t in ("silver", "white", "gray") else words).append(t)
        model = "Galaxy Tab " + " ".join(w.upper() if len(w) <= 3 else w.capitalize() for w in words)
        return ParsedName("Samsung", model, "", _color(colors), variant, channel)
    model_words = [tokens[0].upper()]
    rest = tokens[1:]
    if rest and rest[0] == "ultra":
        model_words.append("Ultra")
        rest = rest[1:]
    numbers = [t for t in rest if t.isdigit()]
    colors = [t for t in rest if not t.isdigit()]
    storage = ""
    if len(numbers) >= 2:
        storage = f"{numbers[0]}/{numbers[1]}GB"
    elif numbers:
        storage = f"{numbers[0]}GB"
    return ParsedName("Samsung", "Galaxy " + " ".join(model_words), storage, _color(colors), variant, channel)


def _parse_pixel(tokens: list[str], variant: str | None, channel: str) -> ParsedName:
    rest = [t for t in tokens if t not in ("google", "pixel")]
    words, storage, colors = [], "", []
    for t in rest:
        if t in ("128", "256", "512", "1tb") and not storage:
            storage = APPLE_STORAGE[t]
        elif t.isdigit() or t in ("pro", "xl", "fold", "a"):
            words.append(t.upper() if t == "xl" else t.capitalize())
        else:
            colors.append(t)
    return ParsedName("Google", "Pixel " + " ".join(words), storage, _color(colors), variant, channel)
