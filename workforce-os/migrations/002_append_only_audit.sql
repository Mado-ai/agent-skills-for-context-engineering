-- Append-only enforcement for the audit surfaces.
--
-- The repository layer exposes no update/delete path for these tables; these
-- triggers make that a database-level guarantee too, so a future direct-SQL
-- caller cannot quietly rewrite history. On PostgreSQL the equivalent is a
-- BEFORE UPDATE OR DELETE trigger raising an exception, plus REVOKE
-- UPDATE,DELETE on the table from the application role.
--
-- tool_calls is the one exception: a call row is written before execution and
-- completed after it, so a single UPDATE is permitted while the row is still in
-- the 'requested' phase. Any later mutation, and every DELETE, is refused.

CREATE TRIGGER events_no_update
BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'events is append-only');
END;

CREATE TRIGGER events_no_delete
BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'events is append-only');
END;

CREATE TRIGGER tool_calls_no_delete
BEFORE DELETE ON tool_calls
BEGIN
  SELECT RAISE(ABORT, 'tool_calls is append-only');
END;

CREATE TRIGGER tool_calls_settle_once
BEFORE UPDATE ON tool_calls
WHEN OLD.phase <> 'requested'
BEGIN
  SELECT RAISE(ABORT, 'tool_calls row is already settled');
END;

CREATE TRIGGER quality_evaluations_no_update
BEFORE UPDATE ON quality_evaluations
BEGIN
  SELECT RAISE(ABORT, 'quality_evaluations is append-only');
END;

CREATE TRIGGER quality_evaluations_no_delete
BEFORE DELETE ON quality_evaluations
BEGIN
  SELECT RAISE(ABORT, 'quality_evaluations is append-only');
END;

CREATE TRIGGER usage_records_no_update
BEFORE UPDATE ON usage_records
BEGIN
  SELECT RAISE(ABORT, 'usage_records is append-only');
END;

CREATE TRIGGER usage_records_no_delete
BEFORE DELETE ON usage_records
BEGIN
  SELECT RAISE(ABORT, 'usage_records is append-only');
END;

-- Contract versions are immutable once written; a change means a new version.
CREATE TRIGGER agent_contract_versions_immutable_body
BEFORE UPDATE OF contract, contract_hash, version, agent_id ON agent_contract_versions
BEGIN
  SELECT RAISE(ABORT, 'contract versions are immutable; create a new version');
END;

CREATE TRIGGER agent_contract_versions_no_delete
BEFORE DELETE ON agent_contract_versions
BEGIN
  SELECT RAISE(ABORT, 'contract versions are immutable');
END;

-- An approval token may be consumed or revoked, never re-pointed at a
-- different action, actor, or approval.
CREATE TRIGGER approval_tokens_immutable_binding
BEFORE UPDATE OF action_fingerprint, actor_agent_id, approval_id, token_hash, expires_at ON approval_tokens
BEGIN
  SELECT RAISE(ABORT, 'approval token binding is immutable');
END;

CREATE TRIGGER approval_tokens_single_use
BEFORE UPDATE OF consumed_at ON approval_tokens
WHEN OLD.consumed_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'approval token already consumed');
END;
