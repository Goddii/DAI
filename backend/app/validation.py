"""Input validation.

Small hand-rolled validators: full control over messages, no extra deps.
The API contract uses integer minor units (cents) for all amounts
(`amount_minor`), so there is never float ambiguity about money.
"""

import re

from app.errors import bad_request

PHONE_RE = re.compile(r"^\+?[0-9]{9,15}$")


def require_fields(data: dict, *fields: str) -> None:
    missing = [f for f in fields if not data.get(f)]
    if missing:
        raise bad_request(
            "Missing required field(s): " + ", ".join(missing),
            code="missing_fields",
            details={"fields": missing},
        )


def validate_name(value, field: str = "name", max_len: int = 120) -> str:
    if value is None:
        raise bad_request(f"Please provide a {field}.", code="invalid_" + field)
    text = str(value).strip()
    if not text:
        raise bad_request(f"Please provide a {field}.", code="invalid_" + field)
    if len(text) > max_len:
        raise bad_request(
            f"{field.capitalize()} is too long (max {max_len} characters).",
            code="invalid_" + field,
        )
    return text


def validate_optional_text(value, field: str, max_len: int = 255) -> str | None:
    if value is None or value == "":
        return None
    text = str(value).strip()
    if len(text) > max_len:
        raise bad_request(
            f"{field.capitalize()} is too long (max {max_len} characters).",
            code="invalid_" + field,
        )
    return text or None


def validate_phone(value) -> str | None:
    """Optional phone. Normalized to digits with optional leading +."""
    if value is None or value == "":
        return None
    text = str(value).strip().replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
    if not PHONE_RE.match(text):
        raise bad_request(
            "That phone number doesn't look right. Use digits only, e.g. 0722123456.",
            code="invalid_phone",
        )
    return text


def validate_integer(
    value,
    field: str,
    *,
    min_value: int | None = None,
    max_value: int | None = None,
) -> int:
    """Strict integer parsing with structured errors.

    Rejects floats outright (even integral ones like 12.0): the API contract
    is JSON integers, and silently accepting floats opens the door to
    precision loss. Booleans, None and non-numeric values are rejected too.
    Digit strings (e.g. "100") are accepted for tolerant clients.
    """
    if isinstance(value, bool) or value is None or isinstance(value, float):
        raise bad_request(
            f"Please enter a valid {field}.", code="invalid_" + field
        )
    try:
        result = int(value)
    except (TypeError, ValueError):
        raise bad_request(
            f"Please enter a valid {field}.", code="invalid_" + field
        )
    if min_value is not None and result < min_value:
        raise bad_request(
            f"{field.capitalize()} must be at least {min_value}.",
            code="invalid_" + field,
        )
    if max_value is not None and result > max_value:
        raise bad_request(
            f"{field.capitalize()} must be at most {max_value}.",
            code="invalid_" + field,
        )
    return result


def validate_amount_minor(value, max_amount: int = 100_000_000_000) -> int:
    """Amount in minor units (cents). Must be an integer > 0.

    Non-integer values are rejected, never truncated: 12.5 must not become
    12 (a silent KSh 0.50 loss).
    """
    if isinstance(value, bool) or value is None:
        raise bad_request("Please enter an amount.", code="invalid_amount")
    if isinstance(value, float):
        raise bad_request(
            "Amounts must be whole numbers (minor units).",
            code="invalid_amount",
        )
    try:
        amount = int(value)
    except (TypeError, ValueError):
        raise bad_request("Please enter a valid amount.", code="invalid_amount")
    if amount <= 0:
        raise bad_request("Amount must be more than zero.", code="invalid_amount")
    if amount > max_amount:
        raise bad_request("That amount is too large.", code="invalid_amount")
    return amount


PAYMENT_METHODS = {"CASH", "MPESA", "OTHER"}


def validate_payment_method(value) -> str | None:
    if value is None or value == "":
        return None
    method = str(value).strip().upper()
    if method not in PAYMENT_METHODS:
        raise bad_request(
            "Payment method must be Cash, M-Pesa or Other.",
            code="invalid_payment_method",
        )
    return method


def validate_password(value) -> str:
    if value is None or not isinstance(value, str):
        raise bad_request("Please choose a password.", code="invalid_password")
    if len(value) < 6:
        raise bad_request("Password must be at least 6 characters.", code="invalid_password")
    if len(value) > 128:
        raise bad_request("Password is too long.", code="invalid_password")
    return value
