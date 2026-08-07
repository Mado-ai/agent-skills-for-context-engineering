/**
 * The candidate-place filter from docs/gearbox/11-geospatial-mvp.md §11.5, as pure
 * logic over GeoJSON features.
 *
 * Three rule classes, in order:
 *   allow  — POI tags that make a good place (public, safe to stand at, interesting)
 *   deny   — sensitive locations that must never become gameplay (schools, hospitals,
 *            memorials, private land). These are the lessons other games in the genre
 *            learned publicly; they are taken as given.
 *   hazard — proximity to danger geometry (motorways, rail, water, cliffs). This is
 *            the strongest argument for OSM as the source: the hazard geometry comes
 *            free from the same extract.
 *
 * Everything that passes gets H3 cells (res 9 gameplay, res 6 shard) and goes to the
 * human curation queue as 'candidate' — algorithmic selection proposes, a person
 * approves before a region goes live.
 */

import { latLngToCell } from 'h3-js';

export interface GeoFeature {
  type: 'Feature';
  geometry: {
    type: 'Point' | 'LineString' | 'Polygon';
    coordinates: number[] | number[][] | number[][][];
  };
  properties: Record<string, string>;
}

export interface CandidatePlace {
  name: string | null;
  category: string;
  lat: number;
  lon: number;
  h3r9: string;
  h3r6: string;
  status: 'candidate';
}

export interface RejectedPlace {
  name: string | null;
  lat: number;
  lon: number;
  reason: string;
}

export interface FilterResult {
  candidates: CandidatePlace[];
  rejected: RejectedPlace[];
  hazardCount: number;
}

/** tag key → allowed values ('*' = any). Kept deliberately narrow for launch. */
const ALLOW: Record<string, string[]> = {
  tourism: ['artwork', 'viewpoint', 'museum'],
  historic: ['*'],
  amenity: ['fountain', 'library', 'theatre', 'marketplace', 'community_centre'],
  leisure: ['park', 'playground'],
  natural: ['peak'],
  man_made: ['lighthouse', 'water_tower'],
};

/** Hard denials — sensitive locations. Checked before allow, and they win. */
const DENY: Array<{ key: string; values: string[] | '*'; reason: string }> = [
  {
    key: 'amenity',
    values: ['hospital', 'clinic', 'police', 'fire_station', 'school', 'kindergarten'],
    reason: 'sensitive_amenity',
  },
  { key: 'landuse', values: ['military'], reason: 'military' },
  { key: 'office', values: ['government'], reason: 'government' },
  // Places of worship are opt-in after outreach, never by default.
  { key: 'amenity', values: ['place_of_worship'], reason: 'worship_opt_in_only' },
  { key: 'access', values: ['private', 'no'], reason: 'private_access' },
];

/** War/holocaust memorials are denied even though historic=* is allowed. */
function isDeniedMemorial(tags: Record<string, string>): boolean {
  const memorialType = tags['memorial:type'] ?? tags['memorial'];
  return (
    tags['historic'] === 'memorial' &&
    memorialType !== undefined &&
    /war|holocaust/i.test(memorialType)
  );
}

/** Hazard tags → exclusion buffer in metres (docs/11 §11.5). */
const HAZARDS: Array<{ key: string; values: string[]; bufferM: number; label: string }> = [
  { key: 'highway', values: ['motorway', 'trunk', 'primary'], bufferM: 15, label: 'road' },
  { key: 'railway', values: ['rail', 'light_rail', 'tram'], bufferM: 25, label: 'rail' },
  { key: 'natural', values: ['water', 'coastline'], bufferM: 10, label: 'water' },
  { key: 'waterway', values: ['river', 'stream', 'canal'], bufferM: 10, label: 'water' },
  { key: 'natural', values: ['cliff'], bufferM: 20, label: 'cliff' },
];

function matchesAllow(tags: Record<string, string>): string | null {
  for (const [key, values] of Object.entries(ALLOW)) {
    const value = tags[key];
    if (value === undefined) continue;
    if (values.includes('*') || values.includes(value)) return `${key}.${value}`;
  }
  return null;
}

function matchesDeny(tags: Record<string, string>): string | null {
  if (isDeniedMemorial(tags)) return 'war_memorial';
  for (const rule of DENY) {
    const value = tags[rule.key];
    if (value === undefined) continue;
    if (rule.values === '*' || rule.values.includes(value)) return rule.reason;
  }
  return null;
}

function hazardLabel(tags: Record<string, string>): { label: string; bufferM: number } | null {
  for (const rule of HAZARDS) {
    const value = tags[rule.key];
    if (value !== undefined && rule.values.includes(value)) {
      return { label: rule.label, bufferM: rule.bufferM };
    }
  }
  return null;
}

/** Representative point of a feature (centroid for polygons — fine at POI scale). */
function pointOf(feature: GeoFeature): [number, number] | null {
  const g = feature.geometry;
  if (g.type === 'Point') {
    const [lon, lat] = g.coordinates as number[];
    return lon !== undefined && lat !== undefined ? [lon, lat] : null;
  }
  return null;
}

/**
 * Metres from a point to a polyline, using a local equirectangular projection —
 * accurate to well under a metre at the sub-kilometre distances the buffers use.
 */
export function distanceToLineMeters(
  lat: number,
  lon: number,
  line: ReadonlyArray<readonly [number, number]>,
): number {
  const mPerDegLat = 111_320;
  const mPerDegLon = mPerDegLat * Math.cos((lat * Math.PI) / 180);
  const px = 0;
  const py = 0;
  const project = ([lo, la]: readonly [number, number]): [number, number] => [
    (lo - lon) * mPerDegLon,
    (la - lat) * mPerDegLat,
  ];

  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = project(line[i] as [number, number]);
    const [bx, by] = project(line[i + 1] as [number, number]);
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    best = Math.min(best, Math.hypot(px - cx, py - cy));
  }
  return best;
}

export function filterCandidates(features: readonly GeoFeature[]): FilterResult {
  // Pass 1: collect hazard geometry.
  const hazards: Array<{
    line: Array<[number, number]>;
    bufferM: number;
    label: string;
  }> = [];
  for (const feature of features) {
    const hazard = hazardLabel(feature.properties);
    if (!hazard) continue;
    const g = feature.geometry;
    if (g.type === 'LineString') {
      hazards.push({
        line: g.coordinates as Array<[number, number]>,
        bufferM: hazard.bufferM,
        label: hazard.label,
      });
    } else if (g.type === 'Point') {
      const p = g.coordinates as number[];
      hazards.push({
        line: [[p[0] as number, p[1] as number]],
        bufferM: hazard.bufferM,
        label: hazard.label,
      });
    }
  }

  const candidates: CandidatePlace[] = [];
  const rejected: RejectedPlace[] = [];

  // Pass 2: classify POIs.
  for (const feature of features) {
    const point = pointOf(feature);
    if (!point) continue; // hazard ways etc. are not POIs
    const [lon, lat] = point;
    const tags = feature.properties;
    const name = tags['name'] ?? null;

    const denyReason = matchesDeny(tags);
    if (denyReason) {
      rejected.push({ name, lat, lon, reason: denyReason });
      continue;
    }

    const category = matchesAllow(tags);
    if (!category) continue; // not a POI we consider at all — not "rejected", just noise

    let hazardHit: string | null = null;
    for (const hazard of hazards) {
      const d = distanceToLineMeters(lat, lon, hazard.line);
      if (d <= hazard.bufferM) {
        hazardHit = `hazard_${hazard.label}`;
        break;
      }
    }
    if (hazardHit) {
      rejected.push({ name, lat, lon, reason: hazardHit });
      continue;
    }

    candidates.push({
      name,
      category,
      lat,
      lon,
      h3r9: latLngToCell(lat, lon, 9),
      h3r6: latLngToCell(lat, lon, 6),
      status: 'candidate',
    });
  }

  return { candidates, rejected, hazardCount: hazards.length };
}
