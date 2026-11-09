"""SMTP delivery for account emails."""

import smtplib
import ssl
from email.message import EmailMessage

from flask import current_app


def _send_email(recipient: str, subject: str, body: str) -> None:
    config = current_app.config
    host = config.get("SMTP_HOST")
    sender = config.get("SMTP_FROM")
    if not host or not sender:
        raise RuntimeError("SMTP_HOST and SMTP_FROM must be configured")

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = sender
    message["To"] = recipient
    message.set_content(body)

    port = int(config.get("SMTP_PORT", 587))
    timeout = int(config.get("SMTP_TIMEOUT_SECONDS", 10))
    use_ssl = config.get("SMTP_USE_SSL", False)
    use_tls = config.get("SMTP_USE_TLS", True)
    if use_ssl and use_tls:
        raise RuntimeError("Configure only one of SMTP_USE_SSL or SMTP_USE_TLS")

    client_class = smtplib.SMTP_SSL if use_ssl else smtplib.SMTP
    client_args = {"context": ssl.create_default_context()} if use_ssl else {}
    with client_class(host, port, timeout=timeout, **client_args) as client:
        if use_tls:
            client.starttls(context=ssl.create_default_context())
        username = config.get("SMTP_USER")
        password = config.get("SMTP_PASSWORD")
        if username:
            client.login(username, password or "")
        client.send_message(message)


def send_password_reset_email(recipient: str, reset_url: str) -> None:
    _send_email(
        recipient,
        "Reset your Dai password",
        "We received a request to reset your Dai password.\n\n"
        f"Use this one-time link within 30 minutes:\n{reset_url}\n\n"
        "If you did not request a reset, you can ignore this email.",
    )


def send_email_verification_email(recipient: str, verify_url: str) -> None:
    _send_email(
        recipient,
        "Verify your Dai recovery email",
        "We received a request to use this email for your Dai account.\n\n"
        f"Verify it using this one-time link within 30 minutes:\n{verify_url}\n\n"
        "If you did not request this, you can ignore this email.",
    )
