import { z } from 'zod';
import { Json, MemoryLayer } from './common.js';

/**
 * Provenance is mandatory. A record that cannot say where it came from cannot
 * be trusted by a downstream agent, and the provenance quality check reads
 * exactly these fields.
 */
export const Provenance = z.object({
  origin: z.enum(['human', 'agent', 'tool', 'import', 'system']),
  origin_id: z.string().default(''),
  trace_id: z.string().nullable().default(null),
  task_id: z.string().nullable().default(null),
  evidence_refs: z.array(z.string()).default([]),
  note: z.string().default(''),
});
export type Provenance = z.infer<typeof Provenance>;

export const MemoryRecord = z.object({
  memory_id: z.string(),
  layer: MemoryLayer,
  scope_project_id: z.string().nullable(),
  agent_id: z.string().nullable(),
  key: z.string(),
  content: Json,
  source: z.string(),
  provenance: Provenance,
  confidence: z.number().min(0).max(1).nullable(),
  authoritative: z.boolean(),
  supersedes_id: z.string().nullable(),
  superseded_by_id: z.string().nullable(),
  ttl_expires_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type MemoryRecord = z.infer<typeof MemoryRecord>;

export const WriteMemoryInput = z.object({
  layer: MemoryLayer,
  key: z.string().min(1).max(200),
  content: Json,
  scope_project_id: z.string().nullable().default(null),
  source: z.string().min(1).default('agent'),
  provenance: Provenance.partial().default({}),
  /** Required for anything inferred; authoritative records omit it. */
  confidence: z.number().min(0).max(1).nullable().default(null),
  supersedes_id: z.string().nullable().default(null),
  ttl_seconds: z.number().int().positive().nullable().default(null),
});
export type WriteMemoryInput = z.infer<typeof WriteMemoryInput>;

export const MemoryQuery = z.object({
  key: z.string().optional(),
  key_prefix: z.string().optional(),
  layer: MemoryLayer.optional(),
  project_id: z.string().nullable().optional(),
  include_superseded: z.boolean().default(false),
  include_expired: z.boolean().default(false),
  limit: z.number().int().min(1).max(500).default(50),
});
export type MemoryQuery = z.infer<typeof MemoryQuery>;
