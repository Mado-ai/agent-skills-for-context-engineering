# TOOL_GATEWAY.md

## 1. The premise

An agent never holds a callable. It holds a **tool id** and must ask the gateway.
Everything an agent can do to the outside world passes through one function, and
that function can refuse.

The mandate's rule — agents must never get raw unrestricted infrastructure
access — is honoured most cleanly by the catalogue's *absence*: there is no
shell tool, no SQL tool, no eval tool, at any risk level. A capability that does
not exist cannot be misconfigured into existence.

---

## 2. Risk classes

| Class | Meaning | Approval | Min level |
|---|---|---|---|
| **R0** | read-only internal | no | L1 |
| **R1** | low-risk internal write | no | L1 |
| **R2** | external, reversible | no | L2 |
| **R3** | sensitive external | **owner approval + token** | L3 |
| **R4** | owner approval mandatory | **owner approval + token** | L3 |
| **R5** | prohibited for autonomous execution | **never runs for an agent** | — |

The class sets the *default* policy. A contract may **tighten** it
(`requires_approval_override=True`) but never loosen it — loosening is an owner
decision expressed by approving a request, not a property a contract can assert
about itself. Contract validation rejects `requires_approval_override=False`.

**R5 is a genuine hard stop.** Verified: an L5 Chief, holding the tool in its
contract, presenting a *valid owner-issued token*, is still refused. R5 is the
one class an approval cannot unlock from inside the runtime.

---

## 3. The policy chain

Every call runs all of this before the handler is reached. Cheapest and most
decisive checks first, so a denied call costs a permission lookup rather than a
rate-limit query and a schema pass.

```
 1. contract grants this specific tool?        holding 'tool.call' is not
                                               permission for a given tool
 2. capability + project isolation
 3. tool's own project scope
 4. level floor for the risk class
 5. R5 hard stop
 6. approval + single-use token (R3/R4)
 7. per-task call ceiling from the contract
 8. rate limit (sliding window over the audit log)
 9. budget pre-flight
10. VALIDATE ARGUMENTS against the input schema
--- execute ---
11. validate the tool's OUTPUT against its schema
--- audit ---
```

**Step 10 is the most important line of defence here.** Tool arguments come from
a language model. A tool whose arguments are taken on faith is an injection
vector regardless of how well the permission model is designed.

**Step 11** exists because a tool returning an unexpected shape would otherwise
put malformed data into an agent's context, where it becomes the next prompt.

The rate limit reads the audited call log rather than an in-memory counter, so it
survives a process restart.

---

## 4. Execution tokens

An approval does **not** modify permissions. It mints a token bound to:

- one approval, one agent, one task, one tool
- a **hash of the exact parameters** that were shown to the owner
- a use count (1 by default) and an expiry

The parameter binding closes the substitution attack: getting "email the
accountant" approved does not authorise emailing anyone else. Verified —
changing `to` or `subject` after approval is refused with
`parameters differ from what was approved`.

Redemption is atomic: `uses < max_uses` is in the UPDATE's WHERE clause, so two
concurrent redemptions of a single-use token cannot both succeed.

Secrets are stored as SHA-256 and compared with `hmac.compare_digest`. The
plaintext is returned exactly once, at mint time. A leaked database yields no
usable tokens.

---

## 5. Audit

Every call is recorded, **including blocked ones** — those are the interesting
ones for security review, so they get the same fidelity as successes.

Only a **hash** of the arguments is stored. Arguments can carry sensitive
payloads; the hash is enough to prove what was attempted and to correlate a
retry, without the audit table becoming a second copy of the data.

`tool_calls` is written through the write-behind batcher (ADR-0007). The
*decision* to allow the call is always made synchronously; only the record of it
is deferred.

---

## 6. Reference catalogue

Inert by design — nothing here touches a network, a shell, or a real external
system. They exist so the policy chain can be exercised end to end and so
benchmarks have deterministic work.

| Tool | Class | Note |
|---|---|---|
| `kb.search` | R0 | internal knowledge search |
| `calc.stats` | R0 | pure computation |
| `note.write` | R1 | internal write |
| `cms.draft` | R2 | reversible draft |
| `email.send` | R3 | **simulated**; irreversible flag set |
| `cms.publish` | R4 | **simulated**; irreversible |
| `finance.transfer` | R5 | **never executes** |

A real adapter replaces the handler. The policy chain around it does not change,
which is the point of the split.
