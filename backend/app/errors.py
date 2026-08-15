"""API error handling.

All errors return JSON in a consistent shape:
    {"error": {"message": "...", "code": "...", "details": {...}}}

Messages are human-readable and safe to show to users. Internal details
(stack traces, SQL errors) are never leaked.
"""

from flask import jsonify, request
from sqlalchemy.exc import IntegrityError


class ApiError(Exception):
    """An expected, user-facing API error."""

    def __init__(self, status: int, message: str, code: str | None = None, details: dict | None = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.code = code
        self.details = details or {}


def bad_request(message: str, code: str | None = None, details: dict | None = None) -> ApiError:
    return ApiError(400, message, code, details)


def not_found(message: str = "Not found.", code: str | None = None) -> ApiError:
    return ApiError(404, message, code)


def conflict(message: str, code: str | None = None) -> ApiError:
    return ApiError(409, message, code)


def _payload(err: ApiError) -> dict:
    return {
        "error": {
            "message": err.message,
            "code": err.code,
            "details": err.details,
        }
    }


def register_error_handlers(app):
    @app.errorhandler(ApiError)
    def handle_api_error(err):
        return jsonify(_payload(err)), err.status

    @app.errorhandler(IntegrityError)
    def handle_integrity_error(err):
        # Unique constraint violations surface as a clean conflict.
        app.logger.warning("IntegrityError on %s: %s", request.path, err.orig)
        return (
            jsonify(
                {
                    "error": {
                        "message": "That record already exists or conflicts with existing data.",
                        "code": "conflict",
                    }
                }
            ),
            409,
        )

    @app.errorhandler(404)
    def handle_404(err):
        return (
            jsonify({"error": {"message": "That page or record doesn't exist.", "code": "not_found"}}),
            404,
        )

    @app.errorhandler(405)
    def handle_405(err):
        return (
            jsonify({"error": {"message": "Method not allowed.", "code": "method_not_allowed"}}),
            405,
        )

    @app.errorhandler(400)
    def handle_400(err):
        return (
            jsonify({"error": {"message": "Bad request.", "code": "bad_request"}}),
            400,
        )

    @app.errorhandler(500)
    def handle_500(err):
        app.logger.exception("Unhandled error on %s", request.path)
        return (
            jsonify(
                {
                    "error": {
                        "message": "Something went wrong on our side. Please try again.",
                        "code": "internal",
                    }
                }
            ),
            500,
        )
