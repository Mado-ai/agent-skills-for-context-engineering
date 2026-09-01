import type { Repos } from '../db/repo/index.js';
import type { AppendEventInput, EventRecord } from '../domain/index.js';

/**
 * The only write path into the event log. There is no update or delete
 * counterpart anywhere in the codebase, and migration 002 backs that with
 * database triggers.
 */
export interface AuditLog {
  append(input: Partial<AppendEventInput> & { kind: string }): EventRecord;
  list(filter?: { trace_id?: string; kind?: string; project_id?: string; severity?: string; limit?: number }): EventRecord[];
}

export function createAuditLog(repos: Repos): AuditLog {
  return {
    append(input) {
      return repos.governance.appendEvent({
        kind: input.kind,
        actor_type: input.actor_type ?? 'system',
        actor_id: input.actor_id ?? null,
        trace_id: input.trace_id ?? null,
        project_id: input.project_id ?? null,
        subject_type: input.subject_type ?? null,
        subject_id: input.subject_id ?? null,
        severity: input.severity ?? 'info',
        payload: input.payload ?? {},
      });
    },
    list(filter = {}) {
      return repos.governance.listEvents(filter);
    },
  };
}
