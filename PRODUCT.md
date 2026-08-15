# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

User-specified: React + TypeScript + Vite + Tailwind CSS (v4) frontend with PWA support; Flask + SQLAlchemy + PostgreSQL backend with Alembic migrations. React Router for navigation, lucide-react for icons, `idb` for IndexedDB offline storage. No component library — hand-rolled Tailwind components from a small design system. No heavy state-management library — plain hooks + context.

## Users

- **Trader** (primary user, phone): an informal or semi-formal market trader in Kenya (e.g. Madaraka Market) who sells goods to regular customers on informal credit. Records credit and payments with one thumb, under time pressure, on a low-to-mid-range Android phone, with patchy connectivity. Non-technical; needs large tap targets, short forms, plain language, and a number they can trust.

## Product Purpose

Dai replaces the trader's memory or notebook with a fast, trustworthy digital credit ledger. The product answers one question instantly: **"Who owes me money, and how much?"** The trader can record credit and payments in seconds, see each customer's current balance, and keep the full history — all while offline, with transactions syncing safely when connectivity returns.

## Positioning

A mobile-first credit ledger for Kenyan market commerce: KSh currency, plain human language ("Credit", "Payment", "Owes you", "Balance"), names like "Mama Fruits" or "Peter from kiosk", offline-first recording, and idempotent sync — not a generic accounting SaaS bolted onto an invoicing model.

## Operating Context

- The trader records a credit or payment at the stall while customers wait; every interaction must be seconds, not minutes.
- Connectivity is intermittent; recording must never be blocked by the network.
- Money is in Kenya Shillings (KSh). Amounts must be exact — no floating point.
- Customers are identified by name, nickname, or description; phone is optional.
- A customer may owe nothing today and receive credit again tomorrow; zero-balance customers are kept, not deleted.

## Capabilities and Constraints

Confirmed capabilities:

- Dashboard: total owed to the trader, number of customers who owe, top outstanding customers, quick actions for Record Credit / Record Payment.
- Customers: searchable list with current balance per customer; create, rename, edit notes.
- Customer detail: current balance, outstanding state, Record Credit / Record Payment actions, full transaction history.
- Ledger: credit and payment entries (partial and full payments), exact derived balances, transaction voiding with audit trail (void, don't mutate).
- Offline: full local operation via IndexedDB; pending transactions queue with client-generated UUIDs; idempotent sync when connectivity returns; visible sync status.
- Authentication: individual trader accounts (phone + password), protected routes, per-trader data isolation enforced server-side.

Confirmed decisions:

- Money stored as integer minor units (1 KSh = 100 cents) in the database; balance always derived from the ledger, never a mutable field.
- Payments cannot exceed the current outstanding balance (prevents accidental overpayment; credit balances are out of scope).
- Transaction corrections happen by voiding the wrong entry and recording a new one — history is never silently mutated.
- Server derives the trader from the auth context; the client never supplies the trader ID.
- Sync is idempotent per (trader, client_uuid); duplicate submissions never create duplicate entries.
- Phone (unique) is the login identifier; email optional. Passwords hashed with werkzeug; JWT tokens for sessions.
- Light theme only for V1 (practical trader app); dark mode is a future enhancement.
- SMS and WhatsApp are NOT in V1; the ledger is architected so a notification service can be added later without touching ledger correctness.

## Brand Commitments

- Name: Dai ("owe / to claim" in Swahili).
- Distinct blue + white financial ledger identity: deep navy primary, calm blue secondary, very light blue-gray canvas, green only for paid/settled/synced, amber for attention/pending, red used sparingly for destructive actions.
- No purple gradients, no glassmorphism, no glowing borders, no generic AI-SaaS dashboard clutter, no unnecessary charts.
- Plain language everywhere: "Record Credit", "Record Payment", "Owes you", "Balance", "History" — never accounting jargon.
- Functional rather than decorative; every visual element earns its place.

## Evidence on Hand

No real business data exists yet. Numbers in the build are authorable demonstration data. No invented commercial claims.

## Product Principles

1. The one question: the app must answer "who owes me money, and how much?" at a glance, without explanation.
2. Seconds matter more than features: recording credit or payment must be a two-tap flow; anything that doesn't help record, understand, or find is not in V1.
3. Offline is normal, not an error: recording never blocks on the network; sync is automatic, idempotent, and visible.
4. Trust over decoration: calm, predictable, transparent numbers; corrections are visible (void + re-record), never silent.
5. Human language, not accounting: customers, credit, payment, balance, history.

## Accessibility & Inclusion

- Minimum 44px touch targets; one-handed thumb operation on phones.
- Meaning is never conveyed by color alone — always paired with a label, icon, or text.
- Keyboard-operable desktop experience with visible focus states.
- Readable outdoors: strong contrast, high text legibility, no reliance on subtle color differences.
