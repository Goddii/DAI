# Design

<!-- impeccable:design-schema 1 -->

## Identity

Dai is a **blue + white financial ledger** for Kenyan market traders. It should feel like a well-kept credit book, not a fintech billboard: calm, trustworthy, fast, and plainly legible. The emotional target is **"this number can be trusted"** — achieved through restraint, strong typography, generous spacing, and a disciplined color system, not through decoration.

### Design personality

- **Calm** — soft light-blue-gray canvas, flat surfaces, low noise, no gradients.
- **Trustworthy** — deep navy anchors; money is always typeset with tabular numerals; numbers are large and unambiguous.
- **Practical** — dense enough to scan a customer list quickly; nothing decorative; every element earns its place.
- **Distinctly Kenyan** — plain commerce language (KSh, "Owes you", "Mama Fruits"), not international SaaS vocabulary.

### Mode

**Operate** (per impeccable): the trader completes a task — record credit, record payment, find a customer, see a balance. Scanability, consistency, native expectations, and the real usage scene outrank expression. Brand lives in precise details: the navy ledger header, the tabular amounts, the single strong CTA per screen.

## Color tokens

Light theme only in V1. Semantic tokens, no ad-hoc hex.

| Token | Value | Usage |
|---|---|---|
| `--color-canvas` | `#F3F5F9` | App background (very light blue-gray) |
| `--color-surface` | `#FFFFFF` | Cards, sheets, headers |
| `--color-ink-950` | `#101828` | Primary text (near-black navy) |
| `--color-ink-700` | `#344054` | Secondary text |
| `--color-ink-500` | `#667085` | Muted/tertiary text |
| `--color-ink-300` | `#98A2B3` | Placeholder text, disabled |
| `--color-line` | `#E4E7EC` | Dividers, card borders, input borders |
| `--color-brand-50` | `#F0F5FC` | Tinted chip background |
| `--color-brand-100` | `#DDE8F7` | Selected row tint, hover tint |
| `--color-brand-200` | `#C2D7F0` | Focus rings, pressed tints |
| `--color-brand-600` | `#3363B4` | Secondary brand actions (secondary button) |
| `--color-brand-700` | `#2B5095` | Primary action default (navy) |
| `--color-brand-800` | `#28457C` | Primary action pressed / strong navy |
| `--color-brand-900` | `#253B66` | Deep navy (header, logo, big numbers on light) |
| `--color-brand-950` | `#17254A` | Deepest navy (text on light, dark surfaces) |
| `--color-positive-50` | `#E9F7EF` | "Paid"/"settled"/"synced" chip bg |
| `--color-positive-600` | `#1F8A5B` | Positive text/icon |
| `--color-positive-700` | `#157347` | Positive text on light, pressed |
| `--color-attention-50` | `#FDF3E3` | "Pending"/"attention" chip bg |
| `--color-attention-600` | `#C47A1F` | Amber text/icon (calm amber, not neon) |
| `--color-attention-700` | `#9A5B13` | Amber text on light, pressed |
| `--color-danger-50` | `#FDEBEA` | Destructive chip bg |
| `--color-danger-600` | `#D92D20` | Destructive actions, serious errors |
| `--color-danger-700` | `#B42318` | Destructive text/pressed |

**Discipline**

- Green appears **only** for: paid, settled, fully synced. Never for generic success buttons.
- Amber appears **only** for: pending sync, needs-attention (large outstanding balances).
- Red appears **only** for: voiding, deleting, serious errors.
- The default button is navy (`brand-700`); the CTA hierarchy is one strong action per screen.

## Typography

- **Family:** IBM Plex Sans (self-hosted via `@fontsource/ibm-plex-sans`; weights 400/500/600/700). Chosen for a trustworthy, financial character that still reads human — not corporate grotesque, not playful.
- **Numerals:** tabular figures (`font-feature-settings: "tnum"`) for *every* amount so columns and balances line up and never jitter.
- **Scale** (mobile-first, rem-based, base 16px):

| Token | Size / Weight | Usage |
|---|---|---|
| `text-display` | 40px / 700, `-0.02em` | Hero balance on dashboard/customer detail |
| `text-title` | 22px / 600 | Screen titles |
| `text-heading` | 17px / 600 | Card titles, section headers |
| `text-body` | 16px / 400 | Default body, list names |
| `text-body-strong` | 16px / 600 | Customer names in lists |
| `text-caption` | 14px / 400 | Secondary info, meta |
| `text-micro` | 12px / 500, letterspaced | Labels, badges, eyebrows |

- Body line-height 1.5; never below 12px for real text (micro labels excepted at 12px with strong weight).
- Big amounts use `text-display` with tabular numerals — the single most important number on the screen gets the single most important type.

## Spacing & layout

- **Rhythm:** 4px base grid. Core scale: 4, 8, 12, 16, 24, 32, 48. Section gaps 24–32; card padding 16–20; screen gutters 16–20.
- **Measure:** content column max-width ~480px on phone; on desktop the app centers a phone-like column (max 560px) so it never turns into a wide dashboard. Desktop is a courtesy, mobile is the product.
- **Touch targets:** minimum 44×44px for all interactive elements; primary CTAs 52–56px tall. Icon buttons get expanded hit areas.
- **Radius:** cards 16px, inputs/buttons 12px, chips/pills 999px, sheets 20px top corners.
- **Shadows:** near-flat (trust = flat). Card: `0 1px 2px rgb(16 24 40 / 0.05)`. Sheet: `0 -8px 32px rgb(16 24 40 / 0.12)`. No glow.

## Components (small, deliberate set)

| Component | Notes |
|---|---|
| `Button` | primary (navy), secondary (white + border + navy text), ghost, danger. Min height 48px. Active state darkens 8%. |
| `IconButton` | 44×44 hit area, lucide icon 22px, subtle pressed tint. |
| `Input` / `AmountInput` | Visible label above field (never placeholder-only). AmountInput: large tabular digits, "KSh" prefix, numeric keypad on mobile. |
| `Card` | White surface, 16px radius, 1px line border. Used sparingly — the app is mostly flat canvas. |
| `ListRow` | Customer row: name (body-strong) + balance (tabular) + chevron; 56px+ tall. |
| `Badge` | Text + tinted bg + icon where useful; never color-only. |
| `Chip` | Segmented control (payment method: Cash / M-Pesa / Other). |
| `BottomSheet` | Record Credit / Record Payment flows; 20px top radius, drag-free, close button + backdrop 45% black. |
| `SyncBanner` | "Saved locally · waiting for connection…" (amber) / "All synced" (green, transient) — always paired with an icon + text. |
| `EmptyState` | Icon + headline + plain-language body + single CTA. Never styled like an error. |
| `Skeleton` | Loading placeholder for lists/cards. |
| `Header` | Navy app bar on key screens; white with border on screens with sheets. |
| `BottomNav` | 3 items max: Home, Customers, Settings. Icons + labels, active = navy. |

## Navigation & IA

- Bottom nav: **Home** (dashboard), **Customers**, **Settings**. Top-level only.
- Record Credit / Record Payment are **bottom sheets** launched from Home or Customer detail — the fastest possible path, one thumb.
- Customer detail: balance hero → actions → history. Back via header back button (and Android system back).

## Motion

- Subtle only. Transitions 150–250ms, ease-out. Sheet slide-up 220ms; list item fade-in 150ms; button press 100ms.
- Respect `prefers-reduced-motion`: disable slide/fade animations.
- No decorative floating elements, no parallax, no springy overshoot. Motion must never delay an action.

## UX copy (plain language)

Record Credit · Record Payment · Owes you · Balance · History · Paid · Saved locally · Synced · Waiting for connection · "You haven't added any customers yet." · "You're all clear. Nobody currently owes you money."

## Accessibility

- Text contrast ≥ 4.5:1 for body (ink-700 on white = 8.9:1; ink-500 on white = 4.6:1 — keep muted text at ink-500 minimum on white).
- All interactive elements ≥ 44px; focus-visible rings (2px brand-600, offset 2px).
- Color never carries meaning alone (badges = icon + text + color).
- Full keyboard operation on desktop; visible focus order.
- `aria-label` on icon-only controls; `role="dialog"` + focus trap in sheets.

## Anti-patterns (banned)

- Purple/indigo/gradient "AI SaaS" looks; glassmorphism; glowing borders; neon.
- Emoji as icons (lucide SVG only).
- Charts, sparklines, and analytics cards on the dashboard.
- Placeholder-only labels; errors shown only at the top of a form.
- Silent mutation of history — voiding is always explicit and visible.
