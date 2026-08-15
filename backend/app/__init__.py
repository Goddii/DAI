"""Application factory."""

import logging

from flask import Flask, jsonify, request
from werkzeug.middleware.proxy_fix import ProxyFix

from config import Config


def create_app(config_object=None) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_object or Config)

    if (
        app.config.get("APP_ENV") == "production"
        and not app.config.get("TESTING")
    ):
        from config import validate_production_config

        validate_production_config(app)

    _configure_logging(app)

    # Deployments run behind a proxy (Render, Docker, etc.): trust the
    # single-hop X-Forwarded-For so request.remote_addr is the real client
    # IP. Without this, every user appears to come from the proxy and the
    # login rate limiter keys all users together.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    from app.extensions import db, jwt, migrate

    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)

    # Keep JSON key order stable (matches DB column order in payloads).
    app.json.sort_keys = False

    _register_blueprints(app)
    _register_error_handlers(app)
    _register_cors(app)
    _register_security_headers(app)
    _register_jwt_handlers(app)
    return app


def _register_security_headers(app):
    """Defense-in-depth for API responses (the HTML app gets its own set
    from the static host, see frontend/vercel.json)."""

    @app.after_request
    def add_security_headers(resp):
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=(), payment=()"
        )
        return resp


def _configure_logging(app):
    """Small stdlib setup — no heavy framework.

    Production logs at INFO; development at DEBUG. No request bodies, tokens
    or passwords are ever logged — the codebase logs identifiers only.
    """
    level = logging.DEBUG if app.config.get("APP_ENV") != "production" else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


def _register_blueprints(app):
    from app.blueprints import auth_bp, customers_bp, dashboard_bp, health_bp, ledger_bp, sync_bp

    app.register_blueprint(auth_bp.bp)
    app.register_blueprint(customers_bp.bp)
    app.register_blueprint(ledger_bp.bp)
    app.register_blueprint(dashboard_bp.bp)
    app.register_blueprint(sync_bp.bp)
    app.register_blueprint(health_bp.bp)


def _register_error_handlers(app):
    from app.errors import register_error_handlers

    register_error_handlers(app)


def _register_cors(app):
    allowed = set(app.config.get("CORS_ORIGINS") or [])

    @app.after_request
    def add_cors_headers(resp):
        origin = request.headers.get("Origin")
        if origin in allowed:
            resp.headers["Access-Control-Allow-Origin"] = origin
            resp.headers["Access-Control-Allow-Credentials"] = "true"
            resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
            resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
            resp.headers["Access-Control-Max-Age"] = "600"
            # The echoed origin must be part of the cache key, or a shared
            # cache could serve a credentialed response to another origin.
            resp.headers["Vary"] = "Origin"
        return resp

    @app.before_request
    def handle_preflight():
        if request.method == "OPTIONS":
            return ("", 204)


def _register_jwt_handlers(app):
    # flask-jwt-extended's default callbacks return raw responses; override
    # them so every auth failure uses the app's consistent error shape and
    # a 401 status (missing token, invalid token, expired token).
    from app.extensions import jwt

    @jwt.unauthorized_loader
    def _missing_token(_reason):
        return (
            jsonify(
                {
                    "error": {
                        "message": "Please log in to continue.",
                        "code": "unauthorized",
                    }
                }
            ),
            401,
        )

    @jwt.invalid_token_loader
    def _invalid_token(_reason):
        return (
            jsonify(
                {
                    "error": {
                        "message": "Your session is not valid. Please log in again.",
                        "code": "unauthorized",
                    }
                }
            ),
            401,
        )

    @jwt.expired_token_loader
    def _expired_token(_header, _payload):
        return (
            jsonify(
                {
                    "error": {
                        "message": "Your session has expired. Please log in again.",
                        "code": "session_expired",
                    }
                }
            ),
            401,
        )


