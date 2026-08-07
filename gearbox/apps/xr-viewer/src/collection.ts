/**
 * The room's contents.
 *
 * Every item here is a *collected* item: something a player picked up at a real place
 * in the world, which now lives in their persistent room. The provenance block is the
 * whole point of the bridge (docs/gearbox/11-geospatial-mvp.md §11.9) — "the one I
 * caught at the harbour with Sam, in October" is what makes someone decorate a room
 * instead of reading an inventory list.
 *
 * Coordinates are real Copenhagen places, matching the launch-city assumption in
 * docs/gearbox/01-assumptions-risks.md A18.
 */

export type ItemForm = 'lantern' | 'echo' | 'compass' | 'charm' | 'prism';

export interface CollectedItem {
  readonly id: string;
  readonly name: string;
  readonly form: ItemForm;
  /** Emissive colour — each item is a light source in the room. */
  readonly light: number;
  readonly provenance: {
    readonly place: string;
    readonly area: string;
    readonly lat: number;
    readonly lon: number;
    readonly h3r9: string;
    readonly collectedAt: string;
    readonly withUsers: readonly string[];
  };
}

export const COLLECTION: readonly CollectedItem[] = [
  {
    id: '018f-lantern',
    name: 'Harbour Lantern',
    form: 'lantern',
    light: 0xe39a33,
    provenance: {
      place: 'Nyhavn Quayside',
      area: 'Indre By',
      lat: 55.6797,
      lon: 12.5905,
      h3r9: '8918584c0f3ffff',
      collectedAt: '2026-10-12 19:44',
      withUsers: ['@sam'],
    },
  },
  {
    id: '018f-echo',
    name: 'Cistern Echo',
    form: 'echo',
    light: 0x5aa7d6,
    provenance: {
      place: 'Cisternerne',
      area: 'Frederiksberg',
      lat: 55.6717,
      lon: 12.5218,
      h3r9: '8918584c1b7ffff',
      collectedAt: '2026-11-03 14:10',
      withUsers: [],
    },
  },
  {
    id: '018f-compass',
    name: 'Round Tower Compass',
    form: 'compass',
    light: 0x46a758,
    provenance: {
      place: 'Rundetaarn',
      area: 'Indre By',
      lat: 55.6813,
      lon: 12.5757,
      h3r9: '8918584c0c3ffff',
      collectedAt: '2026-09-21 11:02',
      withUsers: ['@mira', '@sam'],
    },
  },
  {
    id: '018f-charm',
    name: 'Kayak Charm',
    form: 'charm',
    light: 0xe39a33,
    provenance: {
      place: 'Islands Brygge Harbour Bath',
      area: 'Amager Vest',
      lat: 55.6642,
      lon: 12.5806,
      h3r9: '8918584c2a7ffff',
      collectedAt: '2026-08-08 17:26',
      withUsers: ['@mira'],
    },
  },
  {
    id: '018f-prism',
    name: 'Observatory Prism',
    form: 'prism',
    light: 0x8fc1e3,
    provenance: {
      place: 'Østervold Observatory',
      area: 'Indre By',
      lat: 55.6873,
      lon: 12.5735,
      h3r9: '8918584c087ffff',
      collectedAt: '2026-11-30 21:58',
      withUsers: ['@sam'],
    },
  },
];

/** Wall dashboard content — a first-party spatial app, not a HUD. */
export const DASHBOARD = {
  title: 'Collection',
  stats: [
    { label: 'Places visited', value: '38' },
    { label: 'Items collected', value: '5' },
    { label: 'Co-op encounters', value: '3' },
    { label: 'Cells explored', value: '112' },
  ],
  footnote: 'Room synced 4 min ago · online',
} as const;
