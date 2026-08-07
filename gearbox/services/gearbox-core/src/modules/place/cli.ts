#!/usr/bin/env tsx
/**
 * Place ingest CLI — the offline half of the pipeline in
 * docs/gearbox/11-geospatial-mvp.md §11.5.
 *
 *   pnpm --filter @gearbox/core exec tsx src/modules/place/cli.ts in.geojson out.json
 *
 * Input: a GeoJSON FeatureCollection (e.g. `osmium export extract.osm.pbf`).
 * Output: candidate places with H3 cells, ready for the curation queue, plus the
 * rejection list with reasons — the reviewer needs to see what was excluded and why.
 *
 * Missing by declared design until infrastructure exists: PostGIS load, the review
 * console, and the ODbL-splitting places/place_gameplay tables from docs/11 §11.9.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { filterCandidates, type GeoFeature } from './domain/placeFilter.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: cli.ts <input.geojson> <output.json>');
  process.exit(2);
}

const collection = JSON.parse(readFileSync(input, 'utf8')) as { features: GeoFeature[] };
const result = filterCandidates(collection.features);

writeFileSync(output, JSON.stringify(result, null, 2), 'utf8');
console.log(
  `[places] ${result.candidates.length} candidates, ${result.rejected.length} rejected, ` +
    `${result.hazardCount} hazard features. © OpenStreetMap contributors.`,
);
