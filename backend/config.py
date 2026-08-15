"""Application configuration.

DATABASE_URL defaults to SQLite for zero-friction local development and tests.
Production targets PostgreSQL (see docker-compose.yml at the repo root and
render.yaml).

Security: the app FAILS CLOSED in production. With APP_ENV=production, a
missing or still-default SECRET_KEY / JWT_SECRET_KEY prevents startup with a
clear error instead of silently running with predictable keys. Development
and test configs keep safe local defaults.
"""

import os

from dotenv import load_dotenv

load_dotenv()


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _normalize_db_url(url: str) -> str:
    """SQLAlchemy only accepts postgresql:// (postgres:// is psycopg legacy).

    sqlite:/// and postgresql:// URLs pass through untouched, so local
    development keeps working with no changes.
    """
    prefix = "postgres://"
    if url.startswith(prefix):
        return "postgresql://" + url[len(prefix):]
    return url


# Explicit environment switch. Defaults to development so a fresh clone runs
# with zero configuration; deployments set APP_ENV=production.
APP_ENV = os.environ.get("APP_ENV", "development").strip().lower() or "development"
IS_PRODUCTION = APP_ENV == "production"


class Config:
    # Also a class attribute so it lands in app.config via from_object —
    # create_app reads it there to decide whether to validate secrets.
    APP_ENV = APP_ENV
    # In production a missing secret is left empty so startup fails with a
    # clear message (validate_production_config) instead of a silent default.
    SECRET_KEY = os.environ.get("SECRET_KEY") or (
        "dev-secret-key-change-me" if not IS_PRODUCTION else ""
    )
    JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY") or (
        "dev-jwt-secret-change-me" if not IS_PRODUCTION else ""
    )
    JWT_ACCESS_TOKEN_EXPIRES = _int_env("JWT_ACCESS_TOKEN_EXPIRES", 2592000)  # 30 days
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_DATABASE_URI = _normalize_db_url(
        os.environ.get("DATABASE_URL", "sqlite:///dai.db")
    )
    # Managed PostgreSQL providers (Render, Neon, Supabase) close idle
    # connections and recycle them behind load balancers. pool_pre_ping
    # validates a connection before handing it out (defends against stale
    # sockets) and pool_recycle forces a periodic refresh. Both are cheap and
    # prevent "connection is already closed" errors in production. SQLite
    # needs neither (single file, no network), so dev stays simple.
    SQLALCHEMY_ENGINE_OPTIONS = (
        {"pool_pre_ping": True, "pool_recycle": 300}
        if SQLALCHEMY_DATABASE_URI.startswith("postgresql")
        else {}
    )
    CORS_ORIGINS = [
        o.strip()
        for o in os.environ.get(
            "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",")
        if o.strip()
    ]


class TestConfig(Config):
    TESTING = True
    APP_ENV = "development"
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SECRET_KEY = "test-secret-key-that-is-long-enough-for-hmac-sha256"
    JWT_SECRET_KEY = "test-secret-key-that-is-long-enough-for-hmac-sha256"
    JWT_ACCESS_TOKEN_EXPIRES = 3600
    # Small so the rate-limit test is fast.
    LOGIN_RATE_LIMIT = 5
    LOGIN_RATE_WINDOW_SECONDS = 60


# The insecure defaults are rejected in production even if explicitly set, so
# a deployment that copied the dev values cannot start silently.
_DEV_DEFAULTS = {"dev-secret-key-change-me", "dev-jwt-secret-change-me"}


def validate_production_config(app) -> None:
    """Fail closed: refuse to start in production with missing or default secrets."""
    problems = []
    for name in ("SECRET_KEY", "JWT_SECRET_KEY"):
        value = app.config.get(name)
        if not value:
            problems.append(f"{name} is not set")
        elif value in _DEV_DEFAULTS:
            problems.append(f"{name} is still the insecure development default")
    if problems:
        raise RuntimeError(
            "Refusing to start in production mode (APP_ENV=production): "
            + "; ".join(problems)
            + ". Set them in the environment — see backend/.env.example."
        )