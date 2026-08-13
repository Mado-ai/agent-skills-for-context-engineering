# Brand direction for digital surfaces

Every Little Founders screen must look like it came off the same press as the posters. This is the
canonical spec. If a build drifts from it, this file wins.

## The look, in one line

**Light, airy, rounded and friendly** — cream ground, navy type, one bright accent per element,
circular icon badges, dashed connectors, and a navy band at the bottom. Never dark chrome, never
dense, never monospace as a personality.

## Tokens

| Token | Hex | Use |
|---|---|---|
| Cream | `#F7F4EC` | Page ground. Never text |
| White | `#FFFFFF` | Cards sitting on cream |
| Navy | `#0D1B3D` | All headings and body text. Footer band |
| Teal | `#00B9A7` | Sub-headings, section labels, "growth" |
| Sunshine | `#FFC83D` | Ideas, stars, rules under headings |
| Energy | `#FF7A1A` | Action — primary buttons, "rebuild" |
| Sky | `#4DB6F2` | People, questions, "rethink" |
| Green | `#5FA63F` | Little Sprouts tier |
| Purple | `#7B5EA6` | Young Founders tier |
| Rose | `#E0526E` | Used sparingly, for warmth |

Body text is navy at 80–100% opacity. Muted text is navy mixed with cream, never grey.

**Dark mode** swaps the cream ground for deep navy and keeps every accent. It is the same design
in a different light — not a different design.

## Type

- **Headings:** Nunito ExtraBold → `"Nunito", ui-rounded, "SF Pro Rounded", system-ui`.
  Large, tight, navy, `text-wrap: balance`.
- **Body:** Inter → `"Inter", system-ui, -apple-system`.
- **Section labels:** body font, uppercase, `.14em` letter-spacing, **teal**, small.
- **Numbers:** body font with `font-variant-numeric: tabular-nums`. Monospace is only for
  arithmetic being shown as working — never for labels, never for atmosphere.

## The five signature components

**1. Circular icon badge.** A solid brand-colour circle with a white line icon inside. This is the
single most recognisable device in the system. Squares and rounded rects are wrong.

```css
.badge-circle { width: 3.4rem; aspect-ratio: 1; border-radius: 50%; display: grid; place-items: center; }
```

**2. Numbered step with dashed connector.** Circle badge, small numbered pip, label in Nunito
ExtraBold, description below, joined left-to-right by a **dashed teal arrow**.

**3. Star divider.** A thin rule with a Sunshine star centred on it, between major sections.

**4. Sunshine underline.** Page headings get a short thick Sunshine rule beneath them, left-aligned,
about 4–5rem wide.

**5. Navy footer band.** Full-bleed navy strip carrying the tagline with each word in a different
brand colour — the poster's `Question. Rethink. Improve. Create.` treatment.

## Decorative motifs

Stars (Sunshine and Teal), paper planes, dashed flight paths, small circles. They carry no meaning
and label nothing — they make a page feel in motion. Use them at the edges, never over content.

## Cards

White on cream, `border-radius: 20–24px`, 1px `#E3DCCA` border, generous padding, soft shadow.
Content breathes: never pack a card to its edges.

## Buttons

- **Primary:** Energy fill, white text, `border-radius: 14px`, weight 800.
- **Secondary:** white fill, navy text, 2px border.
- **Pill toggles:** fully rounded, navy fill when pressed.

## What to avoid

- Dark backgrounds as the default state
- Monospace type as a look
- Square or rounded-square icon badges
- Grey neutrals — bias every neutral toward cream or navy
- Dense tables where a card grid would read better
- More than one bright accent competing inside a single component

## Applied to each book

| Book | Tier accent | Notes |
|---|---|---|
| How Is It Made? | Sunshine | Warmest, largest type, most decoration. Ages 5–8 |
| Mission Control | Sky | Checklists and countdowns |
| Reverse. Rethink. Rebuild. | Purple + the four step colours (Sunshine → Energy → Sky → Teal) | Magnifier, question mark, bulb, rocket |
| GO OVERSEAS! | Energy | Most content per screen, but the same light treatment. Maturity comes from density of *thinking*, not from dark chrome |
