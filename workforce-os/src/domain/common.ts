import { z } from 'zod';

export const RoleLevel = z.enum(['chief', 'master', 'specialist', 'ephemeral']);
export type RoleLevel = z.infer<typeof RoleLevel>;

/** Ordered from least to most authority. Used for delegation bound checks. */
export const ROLE_RANK: Record<RoleLevel, number> = {
  ephemeral: 0,
  specialist: 1,
  master: 2,
  chief: 3,
};

export const AccessLevel = z.enum(['read', 'write', 'admin', 'owner']);
export type AccessLevel = z.infer<typeof AccessLevel>;

export const ACCESS_RANK: Record<AccessLevel, number> = {
  read: 0,
  write: 1,
  admin: 2,
  owner: 3,
};

export const RiskClass = z.enum(['read', 'low', 'medium', 'high', 'critical']);
export type RiskClass = z.infer<typeof RiskClass>;

export const RISK_RANK: Record<RiskClass, number> = {
  read: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export const AgentStatus = z.enum([
  'draft',
  'validated',
  'testing',
  'approved',
  'active',
  'paused',
  'merged',
  'retired',
]);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const ActivationMode = z.enum([
  'scheduled',
  'event',
  'session',
  'ephemeral',
  'manual',
]);
export type ActivationMode = z.infer<typeof ActivationMode>;

export const Priority = z.enum(['low', 'normal', 'high', 'critical']);
export type Priority = z.infer<typeof Priority>;

export const MemoryLayer = z.enum(['working', 'episodic', 'project', 'authoritative']);
export type MemoryLayer = z.infer<typeof MemoryLayer>;

/** Authoritative outranks everything inferred. Order is precedence, high first. */
export const MEMORY_PRECEDENCE: Record<MemoryLayer, number> = {
  authoritative: 3,
  project: 2,
  episodic: 1,
  working: 0,
};

export const Timestamp = z.string().datetime();

export const Json = z.record(z.unknown());

export function nowIso(): string {
  return new Date().toISOString();
}
