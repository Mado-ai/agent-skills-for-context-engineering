import { ACCESS_RANK, type AccessLevel } from '../domain/common.js';
import type { AgentContract } from '../domain/agent.js';

/**
 * Scope derivation.
 *
 * A tool declares the scopes it needs; an agent holds a set derived from its
 * contract. Nothing is implicit: a scope an agent does not hold is a denial,
 * and the derivation is the only place that maps access levels onto
 * capabilities.
 */

/** Capability scopes conferred by each access level, cumulatively. */
const CAPABILITY_BY_LEVEL: Record<AccessLevel, string[]> = {
  read: ['registry:read', 'memory:read', 'quality:read', 'telemetry:read'],
  write: ['task:write', 'delegation:write', 'memory:write', 'quality:write', 'artifact:write'],
  admin: ['registry:write', 'budget:write', 'policy:read'],
  owner: ['policy:write', 'secrets:grant', 'finance:commit', 'legal:bind', 'data:destructive', 'publish:external'],
};

/**
 * Scopes that an access level alone never confers — each needs an explicit
 * contract grant as well, so a broadly-privileged agent still cannot reach
 * them by accident.
 */
export const EXPLICIT_GRANT_SCOPES = new Set(['memory:authoritative', 'net:egress']);

/** Scopes only the Owner holds. An agent reaches these only via an approval token. */
export const OWNER_ONLY_SCOPES = new Set([
  'policy:write',
  'secrets:grant',
  'finance:commit',
  'legal:bind',
  'data:destructive',
  'publish:external',
]);

export function deriveScopes(contract: AgentContract): Set<string> {
  const level = contract.access_level;
  const scopes = new Set<string>();

  for (const [name, list] of Object.entries(CAPABILITY_BY_LEVEL) as [AccessLevel, string[]][]) {
    if (ACCESS_RANK[name] <= ACCESS_RANK[level]) for (const s of list) scopes.add(s);
  }

  // Data domains are scopes too, so a tool can require "finance.ledger" and be
  // gated on the contract's data scope rather than on its access level.
  for (const domain of contract.data_scope.domains) scopes.add(domain);
  for (const excluded of contract.data_scope.excluded_domains) scopes.delete(excluded);

  if (contract.memory_policy.may_write_authoritative && ACCESS_RANK[level] >= ACCESS_RANK.admin) {
    scopes.add('memory:authoritative');
  }

  return scopes;
}

/** True when `child` claims no scope the `parent` does not already hold. */
export function scopesWithinParent(child: Set<string>, parent: Set<string>): string[] {
  const excess: string[] = [];
  for (const s of child) if (!parent.has(s)) excess.push(s);
  return excess;
}
