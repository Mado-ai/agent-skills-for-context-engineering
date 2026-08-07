import { describe, expect, it } from 'vitest';
import { distanceToLineMeters, filterCandidates, type GeoFeature } from './placeFilter.js';

// Copenhagen-ish coordinates. ~0.00001° lat ≈ 1.1 m.
const BASE_LAT = 55.68;
const BASE_LON = 12.57;

function poi(props: Record<string, string>, latOffsetM = 0, lonOffsetM = 0): GeoFeature {
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [
        BASE_LON + lonOffsetM / (111_320 * Math.cos((BASE_LAT * Math.PI) / 180)),
        BASE_LAT + latOffsetM / 111_320,
      ],
    },
    properties: props,
  };
}

function way(props: Record<string, string>, offsetM: number): GeoFeature {
  // A north-south line passing `offsetM` metres east of the base point.
  const lonOff = offsetM / (111_320 * Math.cos((BASE_LAT * Math.PI) / 180));
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [BASE_LON + lonOff, BASE_LAT - 0.01],
        [BASE_LON + lonOff, BASE_LAT + 0.01],
      ],
    },
    properties: props,
  };
}

describe('distanceToLineMeters', () => {
  it('measures perpendicular distance to a segment accurately at city scale', () => {
    const road = way({ highway: 'motorway' }, 50);
    const line = road.geometry.coordinates as Array<[number, number]>;
    const d = distanceToLineMeters(BASE_LAT, BASE_LON, line);
    expect(d).toBeGreaterThan(48);
    expect(d).toBeLessThan(52);
  });
});

describe('filterCandidates', () => {
  it('approves an allowed POI and assigns H3 cells at both resolutions', () => {
    const { candidates } = filterCandidates([poi({ tourism: 'museum', name: 'Nationalmuseet' })]);
    expect(candidates).toHaveLength(1);
    const c = candidates[0]!;
    expect(c.category).toBe('tourism.museum');
    expect(c.h3r9).toMatch(/^89[0-9a-f]+$/);
    expect(c.h3r6).toMatch(/^86[0-9a-f]+$/);
    expect(c.h3r9).not.toBe(c.h3r6);
  });

  it('denies sensitive locations with the reason recorded (schools, hospitals)', () => {
    const { candidates, rejected } = filterCandidates([
      poi({ amenity: 'school', name: 'A School' }),
      poi({ amenity: 'hospital', name: 'A Hospital' }),
    ]);
    expect(candidates).toHaveLength(0);
    expect(rejected.map((r) => r.reason)).toEqual(['sensitive_amenity', 'sensitive_amenity']);
  });

  it('deny beats allow: a school that is also a library is still denied', () => {
    const { candidates, rejected } = filterCandidates([
      poi({ amenity: 'school', tourism: 'museum' }),
    ]);
    expect(candidates).toHaveLength(0);
    expect(rejected[0]!.reason).toBe('sensitive_amenity');
  });

  it('denies war memorials despite the historic=* allowance', () => {
    const { candidates, rejected } = filterCandidates([
      poi({ historic: 'memorial', 'memorial:type': 'war', name: 'War Memorial' }),
      poi({ historic: 'monument', name: 'Ordinary Monument' }),
    ]);
    expect(rejected.map((r) => r.reason)).toEqual(['war_memorial']);
    expect(candidates.map((c) => c.name)).toEqual(['Ordinary Monument']);
  });

  it('excludes a fountain 8 m from a motorway but keeps one 200 m away', () => {
    const { candidates, rejected } = filterCandidates([
      way({ highway: 'motorway' }, 8),
      poi({ amenity: 'fountain', name: 'Too Close' }),
      poi({ amenity: 'fountain', name: 'Far Enough' }, 0, 200),
    ]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ name: 'Too Close', reason: 'hazard_road' });
    expect(candidates.map((c) => c.name)).toEqual(['Far Enough']);
  });

  it('applies the wider rail buffer (25 m)', () => {
    const { candidates, rejected } = filterCandidates([
      way({ railway: 'rail' }, 20),
      poi({ tourism: 'artwork', name: 'Trackside Art' }),
    ]);
    expect(candidates).toHaveLength(0);
    expect(rejected[0]!.reason).toBe('hazard_rail');
  });

  it('denies private-access places', () => {
    const { rejected } = filterCandidates([
      poi({ tourism: 'artwork', access: 'private', name: 'Private Garden Sculpture' }),
    ]);
    expect(rejected[0]!.reason).toBe('private_access');
  });

  it('ignores features that match nothing rather than rejecting them', () => {
    const { candidates, rejected } = filterCandidates([poi({ shop: 'bakery' })]);
    expect(candidates).toHaveLength(0);
    expect(rejected).toHaveLength(0); // noise, not a decision
  });

  it('places of worship are excluded by default (opt-in after outreach)', () => {
    const { rejected } = filterCandidates([poi({ amenity: 'place_of_worship' })]);
    expect(rejected[0]!.reason).toBe('worship_opt_in_only');
  });
});
