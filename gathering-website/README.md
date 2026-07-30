# Gathering — website

A production-ready marketing and booking site for **Gathering**: a coffee house, a ticketed
buffet room, and a basket kitchen. Static HTML/CSS/JS — no build step, no framework, no
dependencies. Drop the folder on any static host.

> *Because sharing is caring!*

## The business model the site encodes

Three revenue lines, each with a different access rule:

| Line | Access | Booking |
|---|---|---|
| **Buffet room** | Ticketed, capped, priority-ordered | Required |
| **Baskets & sharing boxes** | Delivered, occasion-dressed | 24–48h lead |
| **Coffee house** | Walk-in | Never |

### Five services in a thirteen-hour day

Each service is a separate event with its own hard seat count. Nothing is overbooked.

| Service | Window | Seats | Member hold | Guest | Member |
|---|---|---|---|---|---|
| The Breakfast Buffet | 7:30 – 9:30 | 40 | 35% | $24 | $19 |
| The Ranch | 11:00 – 13:30 | 48 | 40% | $34 | $27 |
| The Healthy Buffet | 14:00 – 16:00 | 32 | 35% | $29 | $23 |
| The Dessert Buffet | 16:30 – 18:00 | 36 | 45% | $26 | $21 |
| The Dinner Buffet | 18:30 – 20:30 | 44 | 50% | $46 | $37 |

### Membership is booking priority, not exclusivity

Two levers, and they are the entire product:

1. **Booking window** — Guest 2 days, Member 7 days, Circle 14 days.
2. **The member hold** — 35–50% of every room is withheld from guests until 24 hours before
   doors. Guests see `capacity − hold`; members see the whole room. This is why one service
   can read *“member seats only”* to a guest and *“24 seats open”* to a member at the same
   moment.

When a room is gone, the waiting list is ranked: Circle → Members → Guests.

### Baskets: five fixed, dressed for the occasion

The line-up never changes (Classic Brunch, Deluxe Sharing, Ultimate Gathering, Savoury Snack,
Fruit & Refreshments). Two axes vary:

- **14 occasion dressings** across the calendar (Valentine's, Ramadan Iftar, Eid, Mother's Day,
  Graduation, Gender Reveal, Canada Day, Halloween, Christmas, …)
- **4 daypart drop windows**, each built from the buffet running in the kitchen at that hour —
  a morning drop is pastry-forward off the Breakfast pass, an evening drop is mezze off Dinner.

Member discount 10%, Circle 18% + free local delivery. Standard baskets need 24h lead,
occasion dressing needs 48h — the builder enforces both.

## Pages

| File | What it does |
|---|---|
| `index.html` | Hero, live "now serving" rail, today's five services, membership pitch, baskets, counter |
| `buffets.html` | 14-day date rail, per-service seat counts, booking + waitlist, seat-hold table, fortnight heat grid |
| `membership.html` | Tier comparison, hold breakdown, live waitlist modelling, tier switching |
| `baskets.html` | Occasion + daypart + date builder, the fixed five, add-ons, cart and checkout |
| `coffee-house.html` | Counter menu, the buffet pass-through, hours and today's rhythm |
| `account.html` | Bookings, waitlist ranks, deliveries, tier switching, profile |
| `about.html` | The three businesses, why the rooms are capped, FAQ |

## Code

```
assets/
  css/gathering.css   design tokens + component library (one file, no preprocessor)
  js/data.js          catalogue: services, tiers, baskets, occasions, counter menu, FAQ
  js/store.js         state, seat-availability engine, bookings, waitlist, cart (localStorage)
  js/ui.js            header/footer/strip, icons, toasts, scroll reveal, status vocabulary
  js/booking.js       service cards + the booking/waitlist dialog
  js/pages.js         per-page controllers, dispatched on <body data-page>
  img/                brand photography and the basket/gift menu sheets
```

`store.js` is the interesting file. `availability(dateISO, serviceId, tierId)` returns everything
any UI needs about one service on one date — phase (past/live/today/future), status
(open/last-seats/member-only/full/locked), seats left for that tier, hold size, price, waitlist
depth — and every surface on the site renders from that one call.

## Running it

```bash
cd gathering-website
python3 -m http.server 8000   # or: npx serve .
```

Open <http://localhost:8000>. Switch tier on `membership.html` or `account.html` and watch every
seat count, price and date lock recalculate.

## Wiring it to a real backend

Bookings persist to `localStorage` so the whole booking policy is demonstrable without a server.
Three functions are the seam — replace their bodies with API calls and nothing else changes:

- `simulatedTaken(iso, svc)` → `GET /availability?date=&service=` (real seats sold)
- `book(iso, serviceId, party, details)` → `POST /bookings` (must re-check capacity server-side)
- `joinWaitlist(...)` / `placeOrder(...)` → `POST /waitlist`, `POST /orders`

Seat limits are enforced client-side here for the demo. In production the capacity check must be
transactional on the server — that is the one rule the business cannot afford to get wrong.

Payments, email confirmations and the waitlist-release notification job are backend work and are
not included.
