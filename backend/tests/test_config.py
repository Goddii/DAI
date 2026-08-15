"""Configuration hardening: fail-closed production secrets, DATABASE_URL
normalization, and connection pool options.

The env-dependent values are computed at import time, so these tests reload
the config module under a controlled environment.
"""

import importlib
import re

import pytest

import config as config_module

_ENV_KEYS = (
    "APP_ENV",
    "DATABASE_URL",
    "SECRET_KEY",
    "JWT_SECRET_KEY",
    "CORS_ORIGINS",
    "JWT_ACCESS_TOKEN_EXPIRES",
)


def _reload_config(monkeypatch, **env):
    for key in _ENV_KEYS:
        if key in env:
            monkeypatch.setenv(key, env[key])
        else:
            monkeypatch.delenv(key, raising=False)
    # The developer's local backend/.env would leak into a reloaded config;
    # neutralize dotenv so every test sees exactly the environment it sets.
    monkeypatch.setattr("dotenv.load_dotenv", lambda *args, **kwargs: False)
    return importlib.reload(config_module)


def test_normalize_db_url():
    assert config_module._normalize_db_url("postgres://u:p@h:5432/db") == "postgresql://u:p@h:5432/db"
    assert config_module._normalize_db_url("postgresql://u:p@h:5432/db") == "postgresql://u:p@h:5432/db"
    assert config_module._normalize_db_url("sqlite:///dai.db") == "sqlite:///dai.db"
    assert config_module._normalize_db_url("sqlite:///:memory:") == "sqlite:///:memory:"


def test_dev_defaults_are_sqlite_with_local_secrets(monkeypatch):
    cfg = _reload_config(monkeypatch)
    assert cfg.APP_ENV == "development"
    assert cfg.IS_PRODUCTION is False
    assert cfg.Config.SQLALCHEMY_DATABASE_URI == "sqlite:///dai.db"
    assert cfg.Config.SQLALCHEMY_ENGINE_OPTIONS == {}
    assert cfg.Config.SECRET_KEY == "dev-secret-key-change-me"
    assert cfg.Config.JWT_SECRET_KEY == "dev-jwt-secret-change-me"


def test_postgres_url_is_normalized_and_gets_pool_options(monkeypatch):
    cfg = _reload_config(
        monkeypatch,
        DATABASE_URL="postgres://dai:dai@localhost:5432/dai",
    )
    assert cfg.Config.SQLALCHEMY_DATABASE_URI == "postgresql://dai:dai@localhost:5432/dai"
    assert cfg.Config.SQLALCHEMY_ENGINE_OPTIONS == {
        "pool_pre_ping": True,
        "pool_recycle": 300,
    }


def test_sqlite_gets_no_engine_options(monkeypatch):
    cfg = _reload_config(monkeypatch, DATABASE_URL="sqlite:///dai.db")
    assert cfg.Config.SQLALCHEMY_ENGINE_OPTIONS == {}


def test_validate_production_config_rejects_missing_secrets(monkeypatch):
    cfg = _reload_config(monkeypatch, APP_ENV="production")
    app = _make_app(cfg)
    with pytest.raises(RuntimeError, match="SECRET_KEY is not set.*JWT_SECRET_KEY is not set"):
        config_module.validate_production_config(app)


def test_validate_production_config_rejects_dev_defaults(monkeypatch):
    cfg = _reload_config(
        monkeypatch,
        APP_ENV="production",
        SECRET_KEY="dev-secret-key-change-me",
        JWT_SECRET_KEY="dev-jwt-secret-change-me",
    )
    app = _make_app(cfg)
    with pytest.raises(RuntimeError, match="development default"):
        config_module.validate_production_config(app)


def test_validate_production_config_accepts_real_secrets(monkeypatch):
    cfg = _reload_config(
        monkeypatch,
        APP_ENV="production",
        SECRET_KEY="a" * 64,
        JWT_SECRET_KEY="b" * 64,
    )
    app = _make_app(cfg)
    config_module.validate_production_config(app)  # must not raise


def test_create_app_fails_closed_in_production(monkeypatch):
    cfg = _reload_config(monkeypatch, APP_ENV="production")
    from app import create_app

    with pytest.raises(RuntimeError, match="Refusing to start in production mode"):
        create_app(cfg.Config)


def test_create_app_succeeds_in_production_with_real_secrets(monkeypatch):
    cfg = _reload_config(
        monkeypatch,
        APP_ENV="production",
        SECRET_KEY="a" * 64,
        JWT_SECRET_KEY="b" * 64,
    )
    from app import create_app

    app = create_app(cfg.Config)
    assert app.config["APP_ENV"] == "production"
    assert app.config["SQLALCHEMY_DATABASE_URI"] == "sqlite:///dai.db"


def test_test_config_works_even_with_production_env(monkeypatch):
    """The test suite must never be blocked by a stray production env."""
    cfg = _reload_config(monkeypatch, APP_ENV="production")
    from app import create_app

    app = create_app(cfg.TestConfig)
    assert app.config["TESTING"] is True
    assert app.config["SQLALCHEMY_DATABASE_URI"] == "sqlite:///:memory:"


def _make_app(cfg):
    from flask import Flask

    app = Flask(__name__)
    app.config.from_object(cfg.Config)
    return app