# Corner Spokes — Design notes (Nico)

**Why, in one line:** a warm, hand-made "street-corner workshop" look — cream paper, navy ink, a burnt-orange bike frame — with the sign-up form on the one dark, yellow-lit panel so nobody can miss it.

---

## Palette: "Saturday Workshop"

| Name | Hex | Use |
|---|---|---|
| Cream Paper | `#FBF6EC` | Page background, text on dark panels |
| Workbench | `#F3EAD8` | Alternate section band (What I fix cards bg / How it works band) |
| Navy Ink | `#1E2A38` | Body text, headings, sign-up panel + footer background |
| Tread Grey | `#4A5563` | Secondary text, small print on light backgrounds |
| Frame Orange | `#B83A14` | Primary buttons on light backgrounds, step numbers, accent rules |
| Frame Orange Dark | `#8F2C0E` | Primary button hover/active |
| Sunny Yellow | `#F5C542` | Sign-up button, focus ring on dark backgrounds, highlight |
| Sunny Yellow Light | `#FFD966` | Sign-up button hover |
| Grease Line | `#D9CDB8` | Borders, dividers, card outlines (decorative only) |
| Focus Blue | `#1D4ED8` | Focus ring on light backgrounds |
| Pine (success) | `#1F6F43` | Success message (light panel text on dark form, see CSS) |
| Brick (error) | `#9F1D1D` | Error message text on light error box |

Contrast checks (WCAG, approx.):
- Navy Ink on Cream Paper ≈ 13.6:1 (AAA)
- Tread Grey on Cream Paper ≈ 7.2:1 (AAA)
- White on Frame Orange ≈ 5.9:1 (AA, normal text)
- Cream Paper on Navy Ink ≈ 13.6:1; Navy Ink on Sunny Yellow ≈ 9.6:1 (AAA)
- Focus Blue on Cream Paper ≈ 6.4:1; Sunny Yellow on Navy Ink ≈ 9.6:1 (both well over the 3:1 needed for focus indicators)
- Form inputs: Navy Ink text on white, 2px Tread Grey border (≥3:1 against the field).

## Type pairing (system fonts only, nothing off-site)

- **Headings — "Workshop Slab":**
  `font-family: Rockwell, "Roboto Slab", "Zilla Slab", "DejaVu Serif", Georgia, Cambria, "Times New Roman", serif;`
  Weight 700, tight leading (1.1). Slab serifs feel like a painted shop sign.
- **Body — "System Sans":**
  `font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;`
  Weight 400/600, 1.6 line height, base 1.0625rem (17px), max line length ~65ch.
- Scale (fluid with `clamp`): h1 2.25 → 3.5rem, h2 1.75 → 2.375rem, h3 1.125 → 1.25rem.

## Layout: "Single-column stack, dark sign-up anchor"

Mobile-first single column (max width 68rem, 1.25rem side padding). Widens into two columns only where it helps. Section order:

1. **Top bar** (`.site-header`) — wordmark "Corner Spokes" left, small "Join the list" link-button right that jumps to `#join`. Not sticky.
2. **Hero** (`.hero`) — headline, subline, primary button "Join the list" (→ `#join`). Illustration `images/hero.jpg` below text on mobile, right column from 52rem. It's a flat illustration, not a photo; alt text: "Illustration of a bike on a repair stand with a wrench and toolbox."
3. **What I fix** (`#fix`, `.fix`) — heading, intro, list of 4 items as cards (`.fix-list`, 1 col → 2 cols at 40rem). Each card: bold item name + short line. Small print (`.small-print`) under the list.
4. **How it works** (`#how`, `.how`, Workbench band) — heading, ordered list of 3 steps (`.steps`) with big orange numbers drawn by CSS counters (1 col → 3 cols at 52rem). Note line (`.note`) underneath with an orange left rule.
5. **Sign-up** (`#join`, `.signup`) — **the eye-catcher**: full-bleed Navy Ink panel, the only dark block above the footer, with a Sunny Yellow top stripe. Inside, a centred white form card (`.signup-card`) with heading, intro, two labelled fields (First name (optional), Email), big full-width Sunny Yellow button. Status area (`.form-status`, `aria-live="polite"`) shows `.is-success` or `.is-error`. Small print under the form. Hidden spam-trap wrapper `.hp` (visually hidden, `aria-hidden`, `tabindex="-1"` on the input).
6. **Footer** (`.site-footer`) — continues the Navy Ink, separated by a Grease Line rule; the two footer lines from the copy.

Both "Join the list" buttons above point to `#join`; `scroll-behavior: smooth` unless the visitor prefers reduced motion. `scroll-margin-top` on sections.

## Key classes for the builder

`.wrap` (centred container) · `.btn` + `.btn-primary` (orange) / `.btn-signup` (yellow) / `.btn-small` · `.eyebrow` not used (no extra text) · `.visually-hidden` · `.skip-link` (to `#main`) · `.field`, `.field label`, `.field input` · `.form-status.is-success` / `.is-error` (put the error's own message in a `<p class="error-detail">` inside) · `button[disabled]` / `[aria-busy="true"]` styled for the "Adding you…" state.

## Images

- `images/hero.jpg` — generated flat illustration (bike on a repair stand, wrench, toolbox). No text in it. Illustration, so no "photo of the real stand" confusion; still use the alt text above.
- `images/favicon.svg` — hand-written SVG spoked wheel, navy/yellow/orange. Use `<link rel="icon" href="images/favicon.svg" type="image/svg+xml">`. Can double as og:image fallback only if a raster isn't needed; prefer `images/hero.jpg` for og:image.

## Accessibility

- Visible focus on everything: 3px Focus Blue outline + 3px offset on light; Sunny Yellow on dark (`.signup`, `.site-footer`).
- Labels always visible above inputs (placeholders are examples only).
- Min tap target 44px; inputs 48px tall, 16px+ font so iOS doesn't zoom.
- Respects `prefers-reduced-motion`.
- No content added beyond Hugo's copy.
