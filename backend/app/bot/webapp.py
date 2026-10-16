"""Where the "📱 Panel" Mini App button points.

WEBAPP_URL wins when it is an https URL (a real domain). Otherwise, if TUNNEL_METRICS_URL is set, the current
Cloudflare quick-tunnel hostname is read from cloudflared's `/quicktunnel` endpoint, because that hostname
changes on every tunnel restart. No usable URL means no Panel button.
"""

import asyncio
import json
import logging
import time
import urllib.request

from app.core.config import get_settings

log = logging.getLogger(__name__)
CACHE_SECONDS = 60
_cache: tuple[float, str | None] | None = None


def https_url(raw: str) -> str | None:
    """A Telegram Mini App needs https; anything else means "no button"."""
    url = raw.strip()
    return url if url.startswith("https://") else None


def _fetch_tunnel_url(metrics_url: str) -> str | None:
    with urllib.request.urlopen(f"{metrics_url.rstrip('/')}/quicktunnel", timeout=3) as response:
        hostname = (json.loads(response.read() or b"{}").get("hostname") or "").strip()
    return f"https://{hostname}" if hostname else None


async def current_webapp_url() -> str | None:
    global _cache
    settings = get_settings()
    configured = https_url(settings.webapp_url)
    if configured:
        return configured
    if settings.webapp_url.strip():
        log.warning("WEBAPP_URL ignored: a Telegram Mini App needs an https:// URL")
    if not settings.tunnel_metrics_url.strip():
        return None
    now = time.monotonic()
    if _cache and now - _cache[0] < CACHE_SECONDS:
        return _cache[1]
    try:
        url = await asyncio.to_thread(_fetch_tunnel_url, settings.tunnel_metrics_url)
    except (OSError, ValueError) as exc:  # tunnel not running / not ready: just no Panel button
        log.info("quick tunnel hostname unavailable: %s", exc)
        url = None
    _cache = (now, url)
    return url
