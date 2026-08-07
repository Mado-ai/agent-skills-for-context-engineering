# ADR 0003 — scrypt for password hashing, with a migration path to argon2id

- Status: accepted
- Date: 2026-08

## Context

argon2id is the current recommendation for password hashing. Every mainstream Node
implementation is a native addon, and native builds fail often enough across Alpine
images, ARM CI runners and sandboxes to be a recurring operational cost on a small team.

## Decision

Use Node's built-in `crypto.scrypt` at N=2^15, r=8, p=1 (~32 MB per hash), with the
parameters encoded in the stored hash string: `scrypt$N$r$p$salt$hash`.

## Rationale

scrypt is memory-hard, standard-library, and adequate at these parameters. The encoded
prefix means an upgrade is a per-user rehash on next successful login rather than a
flag day: `needsRehash()` already drives that path for parameter increases, and the
algorithm field lets the same mechanism carry an algorithm change.

## Consequences

- No native dependency anywhere in the build.
- Each verification costs ~30–50 ms of CPU. Login is rate-limited accordingly.
- `dummyHash()` gives the unknown-account path the same cost as the real one, which is
  what makes the no-enumeration guarantee hold in timing as well as in response body.

## Revisit when

A native toolchain is already a hard requirement for another reason, or a pure-JS
argon2id implementation reaches acceptable performance.
