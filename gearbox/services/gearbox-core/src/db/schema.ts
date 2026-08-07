/**
 * Drizzle schema — MVP subset (docs/gearbox/04-data-model.md §4.3).
 *
 * Two conventions appear on almost every table and both exist to prevent an expensive
 * migration later (§4.4):
 *   ownerScopeId  — multi-tenancy seam. Today it equals userId; when organizations
 *                   land it points at an org row instead.
 *   hlc           — hybrid logical clock, for offline/local merge (docs/05 §5.9).
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** citext prevents a whole class of duplicate-identity bugs on email/handle/slug. */
const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    email: citext('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    passwordHash: text('password_hash'), // null when OIDC-only
    status: text('status').notNull().default('active'), // active | suspended | deleted
    ageBand: text('age_band').notNull().default('adult'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('users_email_key').on(t.email), index('users_status_idx').on(t.status)],
);

export const profiles = pgTable(
  'profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    handle: citext('handle').notNull(),
    displayName: text('display_name').notNull(),
    pronouns: text('pronouns'),
    bio: text('bio'),
    avatarId: uuid('avatar_id'),
    locale: text('locale').notNull().default('en'),
    hlc: bigint('hlc', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('profiles_handle_key').on(t.handle)],
);

/**
 * Device-bound credentials. Required for offline/local-mode auth
 * (docs/gearbox/07-authz-security.md §7.4) and they make a stolen refresh token
 * useless on its own.
 */
export const deviceIdentities = pgTable(
  'device_identities',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    publicKey: text('public_key').notNull(), // base64url Ed25519
    platform: text('platform').notNull(),
    deviceName: text('device_name'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('device_identities_user_key').on(t.userId, t.publicKey),
    index('device_identities_user_idx').on(t.userId),
  ],
);

/**
 * Refresh tokens are stored hashed and grouped into families. Presenting an already-
 * used token is treated as theft and revokes the whole family
 * (docs/gearbox/07-authz-security.md §7.3).
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey(),
    familyId: uuid('family_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => deviceIdentities.id, { onDelete: 'set null' }),
    tokenHash: text('token_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('refresh_tokens_hash_key').on(t.tokenHash),
    index('refresh_tokens_family_idx').on(t.familyId),
    index('refresh_tokens_user_idx').on(t.userId),
  ],
);

/** Single-use challenges for device assertion. Replay defense (§7.4 step 2). */
export const authChallenges = pgTable(
  'auth_challenges',
  {
    nonce: text('nonce').primaryKey(),
    deviceId: uuid('device_id').notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('auth_challenges_device_idx').on(t.deviceId)],
);

/**
 * Append-only. Written in the same transaction as the state change it describes —
 * fire-and-forget logging loses exactly the events you get asked about
 * (docs/gearbox/03-architecture.md §3.6).
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey(),
    actorId: uuid('actor_id'),
    actorType: text('actor_type').notNull().default('user'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id'),
    outcome: text('outcome').notNull(), // allow | deny | error
    context: jsonb('context').notNull().default({}),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_events_actor_idx').on(t.actorId, t.at),
    index('audit_events_resource_idx').on(t.resourceType, t.resourceId, t.at),
  ],
);

export const environments = pgTable(
  'environments',
  {
    id: uuid('id').primaryKey(),
    ownerScopeId: uuid('owner_scope_id').notNull(),
    ownerScopeType: text('owner_scope_type').notNull().default('user'),
    slug: citext('slug').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    visibility: text('visibility').notNull().default('private'),
    networkMode: text('network_mode').notNull().default('online'),
    currentVersionId: uuid('current_version_id'),
    safetyConfig: jsonb('safety_config').notNull().default({}),
    hlc: bigint('hlc', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('environments_owner_slug_key').on(t.ownerScopeId, t.slug)],
);

export const environmentMembers = pgTable(
  'environment_members',
  {
    environmentId: uuid('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    grantedBy: uuid('granted_by'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.environmentId, t.userId] }),
    index('environment_members_user_idx').on(t.userId, t.role),
  ],
);

/** Durable player game state. Live positions live in Redis, never here (docs/11 §11.5). */
export const playerStates = pgTable('player_states', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  level: integer('level').notNull().default(1),
  xp: bigint('xp', { mode: 'number' }).notNull().default(0),
  homeH3R6: bigint('home_h3_r6', { mode: 'bigint' }),
  trustScore: text('trust_score').notNull().default('1.0'),
  lastFixAt: timestamp('last_fix_at', { withTimezone: true }),
  hlc: bigint('hlc', { mode: 'bigint' })
    .notNull()
    .default(sql`0`),
});

export const schema = {
  users,
  profiles,
  deviceIdentities,
  refreshTokens,
  authChallenges,
  auditEvents,
  environments,
  environmentMembers,
  playerStates,
};
