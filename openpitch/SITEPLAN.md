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
│   ├── /solutions/clubs       🟡
│   ├── /solutions/academies   🟡
│   └── /solutions/coaches     🟡
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
| `/hardware` | Sell the capture rig | Camera spec, install, connectivity, what's in the box | Request a quote | 🟡 (needs hardware spec) |
| `/solutions/*` | Audience targeting | Pain points + outcomes per segment | Segment-specific signup | 🟡 |
| `/resources/*` | SEO + education | Blog posts, how-to guides, glossary | Newsletter / signup | 🟡 |
| `/demo` | Proof without signup | Read-only sample analysis report | Create account | 🟡 |
| `/privacy`, `/terms` | Legal/compliance | Policy text | — | 🟡 |
| `/dashboard` | Deliver the product | Full pipeline tools | (in-app) | ✅ 🔒 |

## Audience targeting (segments)

| Segment | Need | Landing page | Tier | Messaging hook |
|---------|------|--------------|------|----------------|
| **Coach** | Tactical + physical analysis, fast | `/solutions/coaches` | Club | "Every match analysed by Monday morning." |
| **Club admin** | Broadcast + value for money | `/solutions/clubs` | Club | "One camera. Broadcast + data room." |
| **Academy / org** | Multi-team, seats, API | `/solutions/academies` | Academy | "Standardised analysis across every age group." |
| **Scout** | Player metrics, clips | (feature within Club) | Club | "Distance, speed and highlights per player." |

Routing of CTAs already deep-links to signup (`/?signup`); per-segment pages
will carry segment context into onboarding (planned).

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

## How the hardware ties in (pending spec)

`/hardware` and `/how-it-works` are the marketing surface for the capture rig;
the backend ingestion layer (device registry, stream ingest, live/batch jobs)
is the technical counterpart. Both are blocked on the hardware structure:
camera model, stream protocol/codec, edge compute, connectivity, and scale.
Once provided, this plan gets a `/hardware` content spec and the sitemap a
device-pairing/onboarding flow under `/dashboard`.

## Build order (proposed)

1. `/how-it-works` + `/demo` (public proof) — strongest conversion lift, no new backend.
2. `/hardware` — once the hardware spec lands.
3. `/solutions/*` segment pages — audience targeting.
4. `/resources/*` + SEO scaffolding (sitemap, meta, OG, JSON-LD).
5. `/privacy` + `/terms` — before any public launch.
```
