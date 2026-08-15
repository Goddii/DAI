"""Backend entrypoint.

Development:  flask --app run.py run --debug   (or: python run.py)
Commands:     flask --app run.py db upgrade    (migrations)
              flask --app run.py seed          (demo data)
Production:   gunicorn --bind 0.0.0.0:$PORT run:app
              (never python run.py — the dev server must not run in prod)
"""

import os
from datetime import timedelta

import click
from flask.cli import with_appcontext

from app import create_app
from app.extensions import db
from app.models import Customer, LedgerEntry, Trader

app = create_app()


@app.cli.command("seed")
@with_appcontext
def seed_command():
    """Create a demo trader with sample customers and ledger entries."""
    existing = Trader.query.filter_by(phone="0700000000").first()
    if existing:
        click.echo("Demo trader already exists (0700000000).")
        return

    from werkzeug.security import generate_password_hash

    import uuid

    trader = Trader(
        name="Demo Trader",
        phone="0700000000",
        password_hash=generate_password_hash("dai12345"),
    )
    db.session.add(trader)
    db.session.flush()

    demo = [
        ("Mary Wanjiku", "0722111001", None, [(850_00, "Tomatoes + onions"), (400_00, "Vegetables")], [(500_00, "MPESA", None)]),
        ("John Kamau", None, "Buys sukuma every morning", [(3800_00, None)], []),
        ("Peter Otieno", "0733444555", None, [(2450_00, "Credit for the week")], [(2000_00, "CASH", "Paid part")]),
        ("Mama Fruits", None, None, [(1200_00, None)], [(1200_00, "CASH", "Settled")]),
    ]
    for name, phone, notes, credits, payments in demo:
        customer = Customer(
            trader_id=trader.id,
            client_uuid=str(uuid.uuid4()),
            name=name,
            phone=phone,
            notes=notes,
        )
        db.session.add(customer)
        db.session.flush()
        for amount, note in credits:
            db.session.add(
                LedgerEntry(
                    trader_id=trader.id,
                    customer_id=customer.id,
                    type="CREDIT",
                    amount=amount,
                    note=note,
                    client_uuid=str(uuid.uuid4()),
                )
            )
        for amount, method, note in payments:
            db.session.add(
                LedgerEntry(
                    trader_id=trader.id,
                    customer_id=customer.id,
                    type="PAYMENT",
                    amount=amount,
                    payment_method=method,
                    note=note,
                    client_uuid=str(uuid.uuid4()),
                )
            )

    db.session.commit()
    click.echo("Seeded demo trader: phone 0700000000 / password dai12345")


if __name__ == "__main__":
    if app.config.get("APP_ENV") == "production":
        # The dev server is not a production server: no debug mode, no
        # Werkzeug reloader, no guaranteed concurrency. Refuse loudly.
        raise SystemExit(
            "Refusing to run the development server in production "
            "(APP_ENV=production). Start with: "
            "gunicorn --bind 0.0.0.0:$PORT run:app"
        )
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
