# ADR 0005 — OpenStreetMap for place data, with table separation for ODbL

- Status: accepted
- Date: 2026-08
- Deciders: user (decision 6)

## Context

The location-based game needs a database of real-world places. Options were OSM,
a commercial POI/VPS provider, player-generated places, or a hybrid.

## Decision

OpenStreetMap extracts plus our own curation. OSM-derived data lives in `places`;
gameplay data we author ourselves lives in `place_gameplay`, joined by reference.

## Rationale

No per-request cost, no ToS restriction on game use, and — decisively — OSM carries
the _hazard geometry_ (motorway, railway, water, cliff) that lets dangerous locations
be excluded automatically at ingest. No commercial POI feed provides that.

ODbL is share-alike for a Derivative Database when publicly distributed. Internal use
and serving results to our own app is generally not distribution, but the boundary is
fact-specific and a games company tends to approach it (public APIs, data partnerships,
acquisition diligence). Separating the tables now means any such obligation attaches to
the OSM-derived table only, and the gameplay IP stays cleanly separable.

## Consequences

- `© OpenStreetMap contributors` attribution must appear in-app.
- A human curation queue is required before a region goes live.
- Coverage is uneven outside cities; the launch is one city, not one country.

## Open

Legal review of the derived-database question before launch. This ADR describes the
licence's shape; it is not legal advice.
