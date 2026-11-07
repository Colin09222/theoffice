# Rosa's: design notes (Mina)

## The one idea
**The page is the cake.** Sections stack like tiers: the narrow top tier (hero, with the "topper"), widening down through each tier to the cake board (the order form) and the stand (footer). Each tier is edged with a piped-frosting border. Only a custom-cake bakery could be laid out like this. Blur the words and you still see a tiered cake on a rosa mexicano background.

Why: Rosa's sells exactly one thing, a show-stopping custom cake, so the page should be built like one. The name gives us the colour too: *rosa mexicano*.

## Palette
| Name | Hex | Use |
|---|---|---|
| Rosa Mexicano | `#E4007C` | Page background, the one strong colour. Piping borders on tiers. |
| Fondant | `#FFE3EF` | Tier (section) fill. Pink, not cream. |
| Chocolate Plum | `#2A0F1A` | All body text, headings on fondant, buttons, footer "stand". |
| Quince Gold | `#C9972B` | Thin accents only: tier rules, topper star, focus ring on dark. Never as text on fondant (too low contrast). |
| Sugar Pink | `#FF8CC6` | Button text on Chocolate Plum, links on plum, hover state. |
| White | `#FFFFFF` | Large display text on Rosa Mexicano only (contrast 4.6:1, so use it only at 24px and up). |

Contrast checks: Chocolate Plum on Fondant ≈ 16:1. Sugar Pink on Chocolate Plum ≈ 8:1. White on Rosa Mexicano ≈ 4.6:1, large text only.
Banned: gradients, drop shadows, cream backgrounds, terracotta.

## Type (Builder: vendor the woff2 into fonts/, @font-face, font-display: swap)
- **Display: `@fontsource/yeseva-one`, weight 400** (latin + latin-ext so ñ works). A fat-face with high contrast that reads elegant enough for a quince and fun enough for a 5th birthday. Use it for headings, the big hero line and the button labels.
- **Body: `@fontsource/figtree`, weights 400, 600, 800.** Round, friendly and very readable on phones. Use 800 uppercase with 0.12em tracking for small labels such as form labels and "Birthday / Quinceañera / Other" tags.
- Sizes (use clamp):
  - hero h1: `clamp(2.75rem, 9vw, 6.5rem)`, line-height 0.95, colour White on Rosa Mexicano
  - h2: `clamp(2rem, 5.5vw, 3.5rem)`, line-height 1.05
  - h3: `1.5rem` Yeseva
  - body: `1.125rem` / line-height 1.6, max 62ch
  - labels: `0.8125rem`

## Layout: tiers, top to bottom (narrow to wide)
The page background is always Rosa Mexicano. Every section after the hero is a Fondant "tier" block, centred, with square corners (no radius, because cake tiers are cylinders seen side-on, so they read as rectangles). Each tier is wider than the one above it.

Tier widths (desktop): max-width 640px → 820px → 1000px → 1180px → full-bleed.
On phones (< 640px) the "tiering" comes from side margins: 28px → 20px → 12px → 6px → 0. It stays visibly stepped and is never a squeezed desktop.

**Piping border:** every tier gets a scalloped "shell piping" edge along its top and bottom: an inline SVG repeating pattern of semicircles, 12px tall, fill Rosa Mexicano biting into the Fondant (`background: url(svg) repeat-x`, scallop width 24px). Add a 2px Quince Gold rule 10px inside the top edge of each tier.

Sections in order:
1. **Topper + hero (no tier box):** on Rosa Mexicano, a small gold SVG tiara/star above the wordmark "Rosa's" (Yeseva, 1.5rem, white). The big headline "The cake everyone crowds around." sits left-aligned on desktop with the illustration `images/hero-cake.*` on the right (about 42% width). On phones the image comes first at 70% width, centred, then the text. Subhead in Fondant colour. Button: Chocolate Plum fill, Sugar Pink Yeseva text, 0 radius, padding 18px 30px, and a 3px Quince Gold offset outline on hover/focus.
2. **Tier 1 (640px): About.** "A family bakery, a family kind of cake". A single column of text, centred heading.
3. **Tier 2 (820px): What we make.** This is not three matching cards. Show it as a menu-board list: three rows split by dotted Chocolate Plum rules (2px dotted), each row with the name in Yeseva at 2rem on the left and the text on the right (stacked on phone). The Quinceañera row gets a Quince Gold 4px left bar and a tiny tiara SVG, because the quince is the star.
4. **Tier 3 (1000px): How ordering works.** Two short paragraphs and no numbered steps. One pulled line, "chocolate, definitely chocolate", set in Yeseva at 1.75rem in Rosa Mexicano (on Fondant it's ≈4.3:1, OK at that size).
5. **Tier 4 (1180px), the cake board: Order form** `id="order"`. The widest tier. Fields go in two columns on desktop and one on phones. Inputs: white fill, 2px Chocolate Plum border, 0 radius, 16px text minimum (so iOS doesn't zoom), focus border Rosa Mexicano plus a 3px Quince Gold outline. The submit button is full width on phones. The thank-you replaces the form and uses "¡Gracias!" in Yeseva at 3rem.
6. **Footer (full-bleed), the stand:** a Chocolate Plum block with Sugar Pink links, plus a centred 60%-wide gold "pedestal" bar (8px tall, Quince Gold) sitting right on top of it.

Spacing: tier inner padding is `clamp(28px, 5vw, 64px)`, with 0 gap between tiers (they sit right on each other like real tiers. The piping covers the seam).

## Illustration
`images/hero-cake` (in the project's images/ folder) is a flat vector-style illustration of a three-tier pink-and-gold cake on a Rosa Mexicano background. It's clearly a drawing, not a photo of Rosa's real cakes. Alt text: "Illustration of a three-tier pink celebration cake with a gold tiara on top." Also use it for og:image. Favicon: an inline-SVG gold tiara on a Rosa Mexicano square.
