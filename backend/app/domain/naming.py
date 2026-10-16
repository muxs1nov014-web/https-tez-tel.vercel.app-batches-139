"""Product identity and search text. Pure helpers shared by the importer and the catalog service."""

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class ParsedName:
    brand: str
    model: str
    storage: str
    color: str
    variant: str | None
    channel_code: str  # "cargo" (default) or "hand" for the "(1)" suffix

    @property
    def name(self) -> str:
        parts = [self.model, self.storage, self.color, self.variant or ""]
        return " ".join(p for p in parts if p)


def normalize_alias(raw: str) -> str:
    return re.sub(r"\s+", " ", raw.strip().lower())


def search_text_for(parsed_name: str, model: str) -> str:
    """Lower-case text used by the bot/product search: name plus common short forms."""
    base = parsed_name.lower()
    extras = []
    m = model.lower()
    if m.startswith("iphone "):
        short = m.removeprefix("iphone ")
        extras.append(short)
        extras.append(short.replace("pro max", "pm").replace(" ", ""))
        extras.append(short.replace("pro max", "promax"))
    if m.startswith("galaxy "):
        extras.append(m.removeprefix("galaxy "))
    return " ".join([base, *extras])
