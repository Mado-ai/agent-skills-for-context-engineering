import { randomBytes } from 'node:crypto';

/**
 * Time-sortable identifiers (ULID-shaped: 48-bit millisecond timestamp followed
 * by 80 bits of randomness, Crockford base32).
 *
 * Sortability is load-bearing, not cosmetic: the audit tables carry no
 * autoincrement column, so `ORDER BY event_id` is the insertion order. That
 * keeps the schema portable to PostgreSQL without a sequence.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeTime(ms: number, length: number): string {
  let out = '';
  let value = ms;
  for (let i = length - 1; i >= 0; i--) {
    out = ALPHABET[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

function encodeRandom(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % 32];
  return out;
}

export const ID_PREFIXES = {
  project: 'prj',
  loop: 'loop',
  template: 'tpl',
  agent: 'agt',
  contractVersion: 'cver',
  instance: 'inst',
  task: 'tsk',
  packet: 'pkt',
  artifact: 'art',
  gate: 'qg',
  evaluation: 'qev',
  capa: 'capa',
  memory: 'mem',
  event: 'evt',
  call: 'call',
  approval: 'apr',
  token: 'tok',
  budget: 'bdg',
  usage: 'use',
  job: 'job',
  trace: 'trc',
  secretRef: 'sec',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

export function newId(kind: IdKind, now: number = Date.now()): string {
  return `${ID_PREFIXES[kind]}_${encodeTime(now, 10)}${encodeRandom(10)}`;
}

export function newTraceId(now: number = Date.now()): string {
  return newId('trace', now);
}

export function isId(kind: IdKind, value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(`${ID_PREFIXES[kind]}_`);
}
