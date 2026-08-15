"""Health endpoints.

/api/health  — liveness: the process is up (used by the frontend's
               connectivity probe and by load balancers).
/api/ready   — readiness: the process can actually serve (database
               reachable). Returns 503 while the database is unreachable,
               with no internal details.
"""

from flask import Blueprint, jsonify
from sqlalchemy import text

from app.extensions import db

bp = Blueprint("health", __name__, url_prefix="/api")


@bp.get("/health")
def health():
    return jsonify({"status": "ok"})


@bp.get("/ready")
def ready():
    try:
        db.session.execute(text("SELECT 1"))
    except Exception:
        return jsonify({"status": "not_ready"}), 503
    return jsonify({"status": "ready"})
