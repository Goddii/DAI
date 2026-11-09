# Dai — Market Trader Credit Ledger

**Dai** ("owe" in Swahili) is a mobile-first credit ledger for informal and semi-formal market traders in Kenya. It replaces the trader's memory or notebook, answering one question instantly: **"Who owes me money, and how much?"**

- Record credit and payments in seconds
- See each customer's current balance and full history
- Works offline; transactions sync safely and exactly once when connectivity returns
- Individual trader accounts with strict data isolation

## Stack

| Layer | Technology |
|---|---|
| Frontend | React, TypeScript, Vite, Tailwind CSS v4, PWA (`vite-plugin-pwa`) |
| Backend | Flask, SQLAlchemy, PostgreSQL, Flask-Migrate (Alembic) |
| Offline | IndexedDB (`idb`) + idempotent sync with client-generated UUIDs |
| Money | Integer minor units (1 KSh = 100 cents), balance always derived from the ledger |

## Repository layout

```
backend/   Flask API (app factory, blueprints, models, tests)
frontend/  React + Vite PWA
```

## Backend quick start

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env          # adjust DATABASE_URL
flask --app run.py db upgrade # or: flask db upgrade (migrations dir)
flask --app run.py seed       # optional demo data
flask --app run.py run --debug
```

Tests (SQLite in-memory by default, no database needed):

```bash
cd backend && source .venv/bin/activate
pytest
```

### PostgreSQL parity run

The suite runs unmodified against PostgreSQL and is the release gate. It
verifies eight ledger invariants, including the concurrency guards that rely
on real row locking (`WITH FOR UPDATE` — a no-op on SQLite):

1. customer data isolation between traders
2. exact derived ledger balance
3. payments never exceed the outstanding balance
4. idempotent client-UUID sync
5. duplicate sync batches never double-post
6. voiding reverses the balance without mutating history
7. concurrent payments on one customer can never overpay
8. concurrent credit + payment leave a consistent, never-negative balance

Start the local Postgres (`docker compose up -d`), create a test database,
then run:

```bash
cd backend && source .venv/bin/activate
docker exec dai-db createdb -U dai dai_test   # once
TEST_DATABASE_URL=postgresql+psycopg2://dai:dai@localhost:5432/dai_test pytest -q
```

The two concurrency tests are skipped automatically on the default SQLite
run and executed only when `TEST_DATABASE_URL` points at PostgreSQL.

### PostgreSQL (recommended for dev parity)

A `docker-compose.yml` at the repo root runs Postgres 16:

```bash
docker compose up -d
# DATABASE_URL=postgresql+psycopg2://dai:dai@localhost:5432/dai
```

The API works with SQLite (default) or PostgreSQL; production targets PostgreSQL.

## Frontend quick start

```bash
cd frontend
npm install
npm run dev          # dev server (defaults to http://localhost:5173)
npm run typecheck
npm test             # vitest
npm run build        # production build + PWA
npm run preview
```

Set `VITE_API_URL` only when the backend isn't same-origin (e.g. during development: `http://localhost:5000/api`). The production default is `/api` on the same origin, which is what the PWA expects. `VITE_*` variables are compiled into the public bundle — never put backend secrets in them.

## Deployment

### Backend — Render

`backend/render.yaml` is a Render Blueprint (web service + managed PostgreSQL).
The release step runs migrations (`flask --app run.py db upgrade`); they never
run on worker startup. The app fails closed in production: missing
`SECRET_KEY` or `JWT_SECRET_KEY` prevents boot. Replace `CORS_ORIGINS` with
the deployed frontend URL. There is no auto-seeding — the demo trader
(`0700000000` / `dai12345`) exists only when created explicitly with
`flask --app run.py seed`.

Password reset links are sent over SMTP. Set `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and `FRONTEND_URL` in Render.
Password reset requests are rate-limited; reset links expire after 30 minutes
and can be used once.
Port 587 uses STARTTLS by default; for implicit TLS (usually port 465), set
`SMTP_USE_SSL=true` and `SMTP_USE_TLS=false`. Keep SMTP credentials in Render
environment variables, never in the frontend or source control. Users can add
an email during signup or later in Settings; the address must be verified
before it can receive password reset links.

### Manually migrating Neon (Render free plan)

Render's free web services don't run a pre-deploy migration command. To apply
database migrations without Render Shell, add a GitHub Actions repository
secret named `NEON_DATABASE_URL` with the Neon connection string, then open
**Actions → Migrate Neon database → Run workflow**. The workflow applies
`flask db upgrade` and reports the current Alembic revision. Never put the
connection string in workflow files or commit it to the repository.

### Frontend — Vercel

`frontend/vercel.json` provides the SPA fallback (direct navigation to
`/customers/<uuid>`, `/settings`, …) and hardening headers (nosniff, frame
denial, referrer policy, permissions policy). The Content-Security-Policy is
emitted into `index.html` at build time: `connect-src` allows the API origin
derived from `VITE_API_URL` (origin only, never a path), falling back to
`'self'` when unset. The Vite build outputs `dist/` (auto-detected); the PWA
service worker only precaches the app shell — authenticated `/api/*`
responses are never cached. With the backend on the same origin as the
frontend, no `VITE_API_URL` is needed.

## API overview

```
POST /api/auth/register    POST /api/auth/login      POST /api/auth/logout
GET  /api/dashboard/summary
GET  /api/customers        POST /api/customers       GET /api/customers/<id>
PATCH /api/customers/<id>
GET  /api/customers/<id>/ledger
POST /api/ledger/credit    POST /api/ledger/payment  POST /api/ledger/<id>/void
POST /api/sync             GET  /api/health     GET /api/ready
```

## Key design decisions

- **Ledger is the source of truth.** Balance = sum of non-voided credits − payments. There is no mutable balance field.
- **Money is exact.** Amounts are integers in minor units; never floats.
- **Idempotent sync.** Every offline-created record carries a `client_uuid`; the server enforces uniqueness per trader, so retries and duplicate requests never double-post.
- **Corrections are explicit.** Wrong entry → void it (audit trail) → record a corrected one. History is never silently edited.
- **Payments can't exceed the balance.** Prevents accidental overpayment; credit balances are out of scope for V1.
- **Server derives the trader from the auth token.** The client never supplies `trader_id`.

## Out of scope (V1)

Inventory, POS, product catalogue, invoices, accounting reports, tax, loans/interest, SMS/WhatsApp automation, multi-shop or attendant accounts. The ledger is architected so a future notification layer (SMS/WhatsApp) can be added without touching ledger correctness.
