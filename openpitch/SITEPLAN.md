# Play Metrics — Site Plan

The single reference for the website's structure, content, audiences and
targeting. Status legend: ✅ built · 🟡 planned · 🔒 auth-gated.

## Sitemap

```
/                      ✅  Landing (marketing hero + sign in / create account)
├── /features          ✅  Product capabilities
├── /pricing           ✅  Plans & tiers
├── /about             ✅  Mission + contact form
├── /how-it-works      🟡  Capture → produce → analyse, step by step
├── /hardware          🟡  Camera/capture offering (pending hardware spec)
├── /solutions         🟡  Audience landing hub
│   ├── /solutions/coaches     🟡
│   ├── /solutions/academies   🟡  (clubs + multi-pitch)
│   ├── /solutions/parents     🟡
│   └── /solutions/players     🟡  (incl. Solo Mode)
├── /scouts            🟡  Scout marketplace (gated, consented data)
├── /p/:slug           🟡  Public player profiles (opt-in, guardian-gated)
├── /resources         🟡  Content hub (SEO)
│   ├── /resources/blog        🟡
│   └── /resources/guides      🟡
├── /demo              🟡  Public sample report (no login) → CTA to sign up
├── /privacy           🟡  Privacy policy (legal)
├── /terms             🟡  Terms of service (legal)
└── /dashboard         ✅ 🔒  The app
    ├── new analysis (upload / demo / detector)
    ├── analyses (rename / delete / select)
    ├── results (broadcast, possession, charts, heatmaps, players, highlights)
    └── account modal (change password, sign out)
```

## Navigation

**Header (signed out):** Features · Pricing · About · Sign in
**Header (signed in):** Dashboard · {email → account modal} · Log out
**Footer:** Features · Pricing · About · Sign in · (legal: Privacy · Terms 🟡)

> When `/how-it-works`, `/hardware`, and `/solutions` ship, header becomes:
> Product (▾ Features, How it works, Hardware) · Solutions (▾) · Pricing · Resources · Sign in.

## Pages — purpose, content, primary CTA

| Page | Purpose | Key content | Primary CTA | Status |
|------|---------|-------------|-------------|--------|
| `/` | Convert visitors | Hero, value pills, 3 feature cards, auth box | Create account | ✅ |
| `/features` | Explain capabilities | 6 capability cards (capture, CV tracking, homography, analytics, highlights, privacy) | Get started (`/?signup`) | ✅ |
| `/pricing` | Monetise | Starter / Club / Academy tiers | Choose plan → `/?signup`; Academy → `/about` | ✅ |
| `/about` | Trust + contact | Mission, 3 proof points, contact form | Send message | ✅ |
| `/how-it-works` | Reduce uncertainty | Numbered capture→produce→analyse flow, sample media | Try the demo | 🟡 |
| `/hardware` | Sell the capture rig | UniFi 3-package model, install topology, edge rack, what's in the box | Request a quote | 🟡 (spec received) |
| `/solutions/*` | Audience targeting | Pain points + outcomes per segment | Segment-specific signup | 🟡 |
| `/resources/*` | SEO + education | Blog posts, how-to guides, glossary | Newsletter / signup | 🟡 |
| `/demo` | Proof without signup | Read-only sample analysis report | Create account | 🟡 |
| `/privacy`, `/terms` | Legal/compliance | Policy text | — | 🟡 |
| `/dashboard` | Deliver the product | Full pipeline tools | (in-app) | ✅ 🔒 |

## Audience targeting (segments)

| Segment | Need | Landing page | Tier | Messaging hook |
|---------|------|--------------|------|----------------|
| **Coach** | Tactical + physical analysis, fast | `/solutions/coaches` | Growth/Pro | "Every match analysed by Monday morning." |
| **Club / academy admin** | Multi-team, seats, multi-pitch | `/solutions/academies` | Pro | "One brain per site, every pitch covered." |
| **Parent** | Child progress + highlights | `/solutions/parents` | (incl.) | "Watch them grow — safely, privately." |
| **Player** | Own profile + Solo Mode | `/solutions/players` | Solo/Starter | "Film on your phone, build your profile." |
| **Scout** | Player metrics, gated access | scout marketplace | marketplace | "Discover talent — on verified, consented data." |
| **Federation** | Aggregate dashboards | (contracted) | enterprise | "Standardised analysis across the league." |

Routing of CTAs already deep-links to signup (`/?signup`); per-segment pages
will carry segment context into onboarding (planned). **Child-safety note:** all
parent/player/scout surfaces are private-by-default and guardian-gated for
minors — this constrains the public marketing of any player data (see
`ARCHITECTURE.md` §cross-cutting).

## SEO targeting

- **Primary keywords:** automated sports camera, AI football analysis, soccer
  video analytics, automatic highlights, player tracking from video.
- **Long-tail / content (`/resources`):** "how to film a football match with one
  camera", "possession stats from video", "soccer heatmap explained".
- **Segments × geography:** clubs / academies / grassroots, tuned per region as
  rollout markets are confirmed.
- **Per-page SEO:** unique `<title>` + meta description, Open Graph image,
  `sitemap.xml` + `robots.txt`, JSON-LD `Product`/`FAQPage` (planned with the
  marketing pages).

## How the hardware ties in (spec received — v4 reference)

The capture rig is a **UniFi-grounded, three-package** model (see
`ARCHITECTURE.md` for the full four-layer pipeline):

| Package | Pitch | Cameras (UniFi Protect) |
|---------|-------|--------------------------|
| **Starter** | 5-a-side | AI Pro 4K + G5 PTZ + G5 Bullet |
| **Growth** | 7-a-side | + G5 Pro 4K + indoor AP |
| **Pro** | 11-a-side | + 2× G5 Pro 4K (multi-angle) |

- `/hardware` content = packages table, install topology (PoE/Cat6, elevation,
  sightlines), edge rack (gateway/NVR/AI Key/UPS), and "what's in the box".
- `/pricing` tiers map **Starter / Growth / Pro** (+ a phone-only **Solo Mode**
  on-ramp that needs no facility hardware).
- Backend counterpart is **built** as a prototype: capture-site registry
  (`/api/sites`, device pairing), edge→cloud ingest (`/api/ingest/matches`
  with device-key auth + idempotency), and heartbeat. See `ARCHITECTURE.md`
  for what's ✅ vs 🟡 vs ⬜.
- New in-app onboarding flow (planned): create site → pick package → pair
  devices (show one-time key) → device heartbeat → matches auto-appear.

## Build order (proposed)

1. `/how-it-works` + `/demo` (public proof) — strongest conversion lift, no new backend.
2. `/hardware` — once the hardware spec lands.
3. `/solutions/*` segment pages — audience targeting.
4. `/resources/*` + SEO scaffolding (sitemap, meta, OG, JSON-LD).
5. `/privacy` + `/terms` — before any public launch.
```
