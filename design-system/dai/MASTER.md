# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Dai
**Generated:** 2026-08-14 16:56:25
**Category:** Banking/Traditional Finance
**Design Dials:** Variance 3/10 (Centered / Minimal) | Motion 2/10 (Subtle) | Density 6/10 (Standard)

---

## Global Rules

### Color Palette

Light theme only (V1). White/very-light-blue-gray canvas, deep navy as the primary brand and action color. Semantic tokens only — no ad-hoc hex in components.

| Role | Token | Hex | Usage |
|------|-------|-----|-------|
| Canvas | `--color-canvas` | `#F3F5F9` | App background (very light blue-gray) |
| Surface | `--color-surface` | `#FFFFFF` | Cards, sheets, app bar |
| Primary text | `--color-ink-950` | `#101828` | Headings, balances, primary copy |
| Secondary text | `--color-ink-700` | `#344054` | Labels, secondary copy |
| Muted text | `--color-ink-500` | `#667085` | Meta, hints (never below this on white) |
| Border | `--color-line` | `#E4E7EC` | Dividers, card/input borders |
| Primary / CTA | `--color-brand-700` | `#2B5095` | Primary buttons, active nav |
| Brand strong | `--color-brand-800` | `#28457C` | Pressed primary, avatar, wordmark mark |
| Brand deep | `--color-brand-900` | `#253B66` | Dashboard hero panel, login hero |
| Brand tint | `--color-brand-50` | `#F0F5FC` | Hover/tint surfaces, icon chips |
| Positive | `--color-positive-600` | `#1F8A5B` | Paid / settled / synced ONLY |
| Attention | `--color-attention-600` | `#C47A1F` | Pending sync / needs attention (calm amber) |
| Destructive | `--color-danger-600` | `#D92D20` | Voiding, logging out, serious errors ONLY |
| Focus ring | `--color-brand-600` | `#3363B4` | Keyboard focus outlines |

**Discipline**

- Green appears **only** for: paid, settled, fully synced. Never for generic success buttons.
- Amber appears **only** for: pending sync, needs-attention states.
- Red appears **only** for: voiding, destructive actions, serious errors.
- The default action is navy (`brand-700`); one strong action per screen.
- The app is **light** — white/light-blue-gray canvas with navy accents. The navy hero panel on the dashboard and the navy login hero are the brand anchors; they are not an excuse for a dark app chrome.

### Typography

- **Heading Font:** IBM Plex Sans (self-hosted via `@fontsource/ibm-plex-sans`, weights 400/500/600/700)
- **Body Font:** IBM Plex Sans
- **Mood:** financial, trustworthy, calm, professional, practical
- **Numerals:** tabular figures (`font-feature-settings: "tnum"`) for EVERY amount — money must never jitter.
- **Scale (mobile-first, base 16px):** display 40px/700 (`-0.02em`) for the hero balance; title 22px/600 for screen headings; heading 17px/600 for sections; body 16px/400; body-strong 16px/600 for customer names; caption 14px; micro 12px/500 letterspaced for labels.
- Body line-height 1.5; never below 12px for real text.

### Spacing Variables

*Density: 6/10 — Standard*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding, screen gutters |
| `--space-lg` | `24px` / `1.5rem` | Section gaps |
| `--space-xl` | `32px` / `2rem` | Large gaps between major sections |
| `--space-2xl` | `48px` / `3rem` | Section margins |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-card` | `0 1px 2px rgb(16 24 40 / 0.05)` | Cards, list containers (near-flat — trust = flat) |
| `--shadow-pop` | `0 4px 6px -2px rgb(16 24 40 / 0.06), 0 12px 24px -6px rgb(16 24 40 / 0.12)` | Desktop dialogs |
| `--shadow-docked` | `0 -8px 32px rgb(16 24 40 / 0.12)` | Bottom sheets |

No glow, no zero-offset colored halos.

---

## Component Specs

### Buttons

```css
/* Primary Button — navy, the strongest action on the screen */
.btn-primary {
  background: #2B5095;            /* brand-700 */
  color: white;
  height: 52px;
  padding: 0 20px;
  border-radius: 12px;
  font-weight: 600;
  transition: background 150ms ease;
}
.btn-primary:hover  { background: #28457C; }   /* brand-800 */
.btn-primary:active { background: #253B66; }   /* brand-900 */
.btn-primary:disabled { background: #97BCE5; } /* brand-300 */

/* Secondary Button — white with border + navy text */
.btn-secondary {
  background: white;
  color: #2B5095;
  border: 1px solid #E4E7EC;
  border-radius: 12px;
  font-weight: 600;
}
.btn-secondary:hover  { background: #F0F5FC; }  /* brand-50 */
.btn-secondary:active { background: #DDE8F7; }  /* brand-100 */

/* Danger Button — reserved for destructive actions */
.btn-danger {
  background: #D92D20;
  color: white;
  border-radius: 12px;
  font-weight: 600;
}
```

- Min height 48px (52px for primary CTAs). Rounded-xl (12px). Active state darkens.
- Hierarchy: ONE strong primary per screen; secondary actions are white buttons with navy text; ghost links for in-context actions.

### Cards / List Containers

```css
.card {
  background: white;
  border: 1px solid #E4E7EC;
  border-radius: 16px;
  box-shadow: 0 1px 2px rgb(16 24 40 / 0.05);
}
```

- Used sparingly — the app is mostly flat canvas. List containers group rows with a shared border; rows are divided by 1px lines, no per-row cards.

### Customer Row (ListRow)

```css
.list-row {
  min-height: 56px;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}
```

- Name (16px/600, truncated) · balance (tabular 15px/600, right-aligned) · secondary line (13px muted) · chevron.
- Compact and scannable: `NAME ... KSh 3,800`. Never an oversized editorial card.
- Hover tint `brand-50`; active tint `brand-100`; tap target ≥ 56px tall.

### Inputs

```css
.input {
  height: 44px;
  padding: 0 14px;
  border: 1px solid #E4E7EC;
  border-radius: 12px;
  font-size: 16px;              /* ≥16px prevents iOS zoom */
  background: white;
}
.input:focus {
  border-color: #3363B4;
  outline: none;
  box-shadow: 0 0 0 2px #DDE8F7;   /* brand-100 ring */
}
```

- Visible label above the field (never placeholder-only). AmountInput: large tabular digits with "KSh" prefix and numeric keypad.

### App Bar (Header)

```css
.app-bar {
  background: white;
  border-bottom: 1px solid #E4E7EC;
  height: 56px;
  padding-top: env(safe-area-inset-top);
  position: sticky;
  top: 0;
}
```

- Left: **Dai wordmark** (small navy book mark + "Dai" in 17px bold) on top-level screens; back button + page title on detail screens.
- Right: page actions (e.g. Add Customer) then the **account avatar** — a 44×44px navy circle with the trader's initials. Always present on authenticated screens. `aria-label="Account"`.
- The account avatar opens the Account sheet (name, phone, Settings, Log Out).
- Detail screens take an explicit `backTo` destination (e.g. customer detail → `/customers`) so back works after a refresh or deep link — never browser-history-only.
- The app bar is LIGHT. Deep navy lives in the dashboard hero panel, buttons, avatar, and login hero — not in the chrome.

### Bottom Sheets

```css
.sheet {
  background: white;
  border-radius: 20px 20px 0 0;
  box-shadow: 0 -8px 32px rgb(16 24 40 / 0.12);
  max-height: 90dvh;
}
```

- Mobile: slides up from the bottom (220ms, ease-out). Desktop: centered dialog (max-w-md), Esc + backdrop close.
- Used for: Record Credit, Record Payment, Add Customer, Account, Void confirmation. Focus is trapped; backdrop is 45% black.

### Other primitives

- `Badge`: pill, tinted bg + text + optional icon — meaning never color alone. Tones: positive (paid/settled), attention (pending), danger, neutral, brand.
- `Chip`: segmented selectable (payment method), 44px tall, selected = navy border + brand-50 bg.
- `SyncBanner`: always visible sync truth in plain language with an icon + text (never color alone): "All synced" (green) · "Offline · N changes waiting" / "Offline — you're not connected" (amber — offline NEVER shows "All synced") · "N changes waiting to sync" (amber) · error state links to Settings (red, with a Review affordance — the only manual recovery path) · "Syncing…" (brand tint). Sync is automatic: there is NO prominent "Sync Now" button anywhere; retry lives only inside the failed-ops recovery section of Settings.
- `AddCustomerSheet`: Name · Phone (optional) · **"Already owes you" (optional)** — a positive amount becomes the customer's first ledger CREDIT (never a balance field; the outbox FIFO guarantees the create op syncs before the credit). Empty or KSh 0 creates only the customer.
- `EmptyState`: icon in brand-50 square + headline + plain-language body + single CTA. Never styled like an error.
- `Skeleton`: pulsing `ink-200/60` placeholder.

---

## Style Guidelines

**Style:** Functional Minimalism

**Keywords:** practical, calm, scannable, trustworthy, information-dense where it matters, restrained, blue + white

**Key Effects:** clear hierarchy through weight and size (not decoration); compact list rows; one strong navy CTA per screen; tabular money; generous but not theatrical whitespace. **Not** oversized editorial type, and **not** a dark dashboard.

### Page Pattern

**Pattern Name:** Operate — task completion

- The trader answers one question ("who owes me, and how much?") in the first seconds, then records what happens next.
- Screen order: balance/state first, actions second, history/list third.
- Record Credit / Record Payment are bottom sheets launched from the dashboard and customer detail — never navigation destinations.

---

## Navigation & IA

- Bottom nav (3 items max): **Home** (dashboard), **Customers**, **Settings**. Icons + labels, active = navy.
- **Account** is a header control (avatar with initials) present on every authenticated screen — not a fourth nav item.
- Sync is never a navigation destination. Status lives in the slim SyncBanner; the only sync recovery surface is the failed-ops section in Settings.
- Dai is the application identity (wordmark in the app bar). The trader's ledger name ("Demo's Credit Book") is business context shown inside the dashboard hero, separate from the brand.

## Motion

- Subtle only. Transitions 150–250ms, ease-out. Sheet slide-up 220ms; list fade-in 150ms; button press 100ms.
- No scroll-reveal libraries (GSAP is not used). No decorative floating elements, no parallax, no springy overshoot. Motion must never delay an action.
- Respect `prefers-reduced-motion`: disable all animation.

---

## Anti-Patterns (Do NOT Use)

- ❌ Dark app chrome (navy headers on every screen, dark backgrounds)
- ❌ Green as the primary CTA color
- ❌ Exaggerated minimalism: oversized typography, massive whitespace, statement design
- ❌ Playful design · poor security UX · AI purple/pink gradients · glassmorphism · glowing borders · neon
- ❌ Emojis as icons (lucide SVG only)
- ❌ Missing cursor:pointer on clickable elements
- ❌ Layout-shifting hovers (scale transforms)
- ❌ Low contrast text (4.5:1 minimum; ink-500 is the muted floor on white)
- ❌ Instant state changes (always 150–300ms transitions)
- ❌ Invisible focus states (2px brand-600 ring, 2px offset)
- ❌ Charts, sparklines, analytics cards on the dashboard
- ❌ Placeholder-only labels; silent mutation of history

---

## Empty-State Honesty (critical)

Dai must NEVER confuse "the data hasn't loaded yet" with "the user has no data".

- An empty IndexedDB is not proof the account is empty; a zero-length outbox is not proof the server has nothing to import.
- On every authenticated mount, the app reconciles with the server (pull) even when there is nothing to push — a fresh browser must hydrate its dashboard from server data without requiring any mutation.
- The dashboard/customers pages only show "KSh 0 / You're all clear / 0 customers" once the server has actually been reached this session (`hydrated`). Before that: skeletons while online (hydrating); a plain-language "not loaded yet — you're offline" state when offline. An offline, unverified account must never be presented as genuinely empty.

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (SVG: lucide)
- [ ] All icons from one consistent set (lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150–300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px — mobile-first, no horizontal scroll
- [ ] No content hidden behind fixed navbars
- [ ] Touch targets ≥ 44×44px (primary CTAs 52px+)
- [ ] Money always typeset with tabular numerals
- [ ] Every screen has one strong primary action; Record Credit stays the strongest
