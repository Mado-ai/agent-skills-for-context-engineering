import { RuntimeError, type AgentStatus } from '../domain/index.js';

/**
 * draft -> validated -> testing -> approved -> active -> paused -> merged/retired
 *
 * The gate that matters: nothing reaches `active` without a passing validation
 * and a passing test run. `assertTransition` enforces the shape of the walk;
 * the registry enforces the preconditions on each edge.
 */
export const LIFECYCLE_TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
  draft: ['validated', 'retired'],
  validated: ['testing', 'draft', 'retired'],
  testing: ['approved', 'draft', 'validated', 'retired'],
  approved: ['active', 'draft', 'retired'],
  active: ['paused', 'merged', 'retired'],
  paused: ['active', 'merged', 'retired'],
  merged: [],
  retired: [],
};

export function canTransition(from: AgentStatus, to: AgentStatus): boolean {
  return (LIFECYCLE_TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: AgentStatus, to: AgentStatus, agentId: string): void {
  if (!canTransition(from, to)) {
    throw new RuntimeError(
      'INVALID_LIFECYCLE_TRANSITION',
      `agent ${agentId} cannot move from ${from} to ${to}`,
      { from, to, allowed: LIFECYCLE_TRANSITIONS[from] ?? [] },
    );
  }
}
