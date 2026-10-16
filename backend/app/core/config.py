from functools import lru_cache
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    database_url: str = "postgresql+asyncpg://telefon:telefon@localhost:23432/telefon"
    # Set by the Vercel Neon integration next to the pooled DATABASE_URL. Preferred when present: a direct connection
    # avoids asyncpg prepared statements going through PgBouncer.
    database_url_unpooled: str = ""
    jwt_secret: str = "dev-only-secret-change-me-in-production-env"
    jwt_expire_minutes: int = 720
    admin_username: str = "admin"
    admin_password: str = "admin"

    telegram_bot_token: str = ""
    # Webhook mode (Vercel, SPEC §16): Telegram sends this in X-Telegram-Bot-Api-Secret-Token. Empty = webhook off.
    telegram_webhook_secret: str = ""
    # Groups whose messages the bot stores (SPEC §14), comma-separated chat IDs. Empty = every group it is in.
    telegram_group_ids: str = ""
    # Mini App (SPEC §13.3). initData older than this many seconds is refused by POST /auth/telegram.
    telegram_initdata_max_age: int = 86400
    # https URL of the admin panel. Empty = the bot shows no WebApp button and leaves its menu button alone.
    webapp_url: str = ""
    # cloudflared metrics address; used for the Panel button when WEBAPP_URL is empty (see app/bot/webapp.py)
    tunnel_metrics_url: str = ""
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.8-flash"
    gemini_timeout_seconds: float = 25.0

    tz_name: str = "Asia/Tashkent"
    app_env: str = "dev"
    # Vercel sets VERCEL=1. Its instances freeze between requests, so the DB engine keeps no pooled connections.
    vercel: bool = False

    @property
    def async_database_url(self) -> str:
        return async_db_url(self.database_url_unpooled or self.database_url)

    @property
    def is_production(self) -> bool:
        """APP_ENV=production, or running on Vercel (public) even if APP_ENV was forgotten there."""
        return self.app_env == "production" or self.vercel

    def check_production(self) -> None:
        """Fail fast on placeholder secrets in production."""
        if not self.is_production:
            return
        if len(self.jwt_secret) < 32 or "change-me" in self.jwt_secret or self.jwt_secret.startswith("dev-only"):
            raise RuntimeError("JWT_SECRET must be a random string of at least 32 characters")
        if self.telegram_webhook_secret and len(self.telegram_webhook_secret) < 32:
            raise RuntimeError("TELEGRAM_WEBHOOK_SECRET must be at least 32 characters")


def async_db_url(url: str) -> str:
    """The asyncpg form of a Postgres URL. Neon/Vercel hand out `postgresql://...?sslmode=require&channel_binding=...`,
    which asyncpg does not understand: the scheme gets the driver, and sslmode becomes asyncpg's `ssl`."""
    parts = urlsplit(url)
    scheme = "postgresql+asyncpg" if parts.scheme in ("postgres", "postgresql") else parts.scheme
    query = dict(parse_qsl(parts.query))
    sslmode = query.pop("sslmode", None)
    query.pop("channel_binding", None)
    if sslmode and sslmode != "disable":
        query.setdefault("ssl", sslmode if sslmode in ("verify-ca", "verify-full") else "require")
    return urlunsplit((scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


@lru_cache
def get_settings() -> Settings:
    return Settings()
