"""Telegram Mini App initData verification (SPEC §13.3).

Pure: no DB, no settings lookup, no logging (initData is a bearer credential for its whole lifetime, so it must
never end up in a log). Algorithm: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
"""

import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl


class InitDataInvalid(ValueError):
    """initData is missing, malformed, wrongly signed or stale. The message is Uzbek and safe to show to the
    user: it never echoes the data."""


def _signature(data_check_string: str, bot_token: str) -> bytes:
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    return hmac.new(secret, data_check_string.encode(), hashlib.sha256).hexdigest().encode()


def verify_init_data(init_data: str, bot_token: str, max_age_seconds: int, now: float | None = None) -> int:
    """Return the Telegram user id from a genuine, fresh initData string; raise InitDataInvalid otherwise."""
    if not bot_token:
        raise InitDataInvalid("Telegram orqali kirish sozlanmagan (bot tokeni yo'q)")
    try:
        pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=True)
    except ValueError as exc:
        raise InitDataInvalid("Telegram ma'lumoti noto'g'ri formatda") from exc
    fields = dict(pairs)
    if len(fields) != len(pairs):  # a repeated key would make "which value was signed" ambiguous
        raise InitDataInvalid("Telegram ma'lumoti noto'g'ri formatda")

    received = fields.pop("hash", "")
    if not received:
        raise InitDataInvalid("Telegram imzosi topilmadi")
    # Every field except `hash` (including `signature`), as decoded `key=value` lines sorted by key.
    data_check_string = "\n".join(f"{key}={value}" for key, value in sorted(fields.items()))
    # Bytes, not str: compare_digest refuses non-ASCII str, and `received` is attacker-controlled.
    if not hmac.compare_digest(_signature(data_check_string, bot_token), received.encode()):
        raise InitDataInvalid("Telegram imzosi noto'g'ri")

    try:
        auth_date = int(fields["auth_date"])
    except (KeyError, ValueError) as exc:
        raise InitDataInvalid("Telegram ma'lumotida auth_date yo'q") from exc
    if (time.time() if now is None else now) - auth_date > max_age_seconds:
        raise InitDataInvalid("Telegram ma'lumoti eskirgan, Mini App'ni yopib qayta oching")

    try:
        return int(json.loads(fields["user"])["id"])
    except (KeyError, ValueError, TypeError) as exc:
        raise InitDataInvalid("Telegram foydalanuvchisi aniqlanmadi") from exc
