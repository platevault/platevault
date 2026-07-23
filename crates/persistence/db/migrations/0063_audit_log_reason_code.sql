-- Migration 0063: audit_log_entry reason_code (spec 030 T120, Q15/#647).
--
-- Generalizes the durable audit_log_entry row from a lifecycle-transition
-- record to a generic mutation record (FR-130-FR-134). `entity_type` and
-- `trigger` already carry no CHECK constraint (0002_lifecycle.sql), so the
-- EntityType tag-set generalization (settings/protection/equipment) needs no
-- DDL — the real surface is the Rust EntityType enum and its generated TS
-- union. before->after value pairs for non-lifecycle mutations are carried
-- in the existing `payload` JSON column, not new columns.
--
-- The only schema change: a first-class, queryable reason/code column for
-- refused/failed outcomes (data-model.md "Migration shape (T120)"). Resulting
-- column set: audit_id, entity_type, entity_id, from_state, to_state,
-- trigger, actor, outcome, severity, request_id, at, payload, reason_code.

ALTER TABLE audit_log_entry ADD COLUMN reason_code TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_outcome ON audit_log_entry(outcome, reason_code);
