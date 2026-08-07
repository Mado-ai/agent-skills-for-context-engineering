/**
 * Audit is a module, not a decorator (docs/gearbox/03-architecture.md §3.6).
 *
 * Every sensitive action writes an event. In the Drizzle implementation the write
 * shares the transaction with the state change it describes, so an action can never be
 * applied without its audit record.
 */

export type AuditOutcome = 'allow' | 'deny' | 'error';
export type ActorType = 'user' | 'system' | 'ai_agent' | 'device';

export interface AuditEvent {
  actorId: string | null;
  actorType: ActorType;
  /** Dotted, stable, machine-greppable: 'identity.token.issue'. */
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: AuditOutcome;
  context?: Record<string, unknown>;
}

export interface AuditSink {
  record(event: AuditEvent): Promise<void>;
}

export const AUDIT_ACTIONS = {
  USER_REGISTER: 'identity.user.register',
  TOKEN_ISSUE: 'identity.token.issue',
  TOKEN_REFRESH: 'identity.token.refresh',
  TOKEN_REUSE_DETECTED: 'identity.token.reuse_detected',
  LOGIN_FAILED: 'identity.login.failed',
  DEVICE_REGISTER: 'identity.device.register',
  DEVICE_REVOKE: 'identity.device.revoke',
  DEVICE_ASSERTION_FAILED: 'identity.device.assertion_failed',
} as const;
