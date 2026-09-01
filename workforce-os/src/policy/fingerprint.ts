import { createHash } from 'node:crypto';

/**
 * Canonical JSON: object keys sorted at every depth, so two structurally equal
 * argument objects always hash identically regardless of key order. This is
 * what makes an approval token bind to *these exact arguments* — reordering
 * keys must not produce a different fingerprint, and changing any value must.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function hashCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export interface ActionFingerprintInput {
  action: string;
  tool_name: string | null;
  args: Record<string, unknown>;
  actor_agent_id: string;
  project_id: string | null;
}

/**
 * The binding an approval token carries. A token minted for one action cannot
 * be replayed against a different action, different arguments, a different
 * agent, or a different project, because all four are inside the hash.
 */
export function actionFingerprint(input: ActionFingerprintInput): string {
  return hashCanonical({
    action: input.action,
    tool_name: input.tool_name,
    args: input.args,
    actor_agent_id: input.actor_agent_id,
    project_id: input.project_id,
  });
}

export function argsFingerprint(args: Record<string, unknown>): string {
  return hashCanonical(args);
}
