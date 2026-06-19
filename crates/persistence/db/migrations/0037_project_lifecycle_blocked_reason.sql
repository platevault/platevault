-- Migration 0037: Typed blocked reason on `projects` (spec 033 US5, FR-020).
--
-- Adds `blocked_reason_kind` and `blocked_reason_note` to the `projects` table
-- so the BlockedBanner DTO can carry the typed reason instead of a hardcoded
-- `{ kind: "user" }` value.
--
-- `blocked_reason_kind` — discriminated enum string:
--     "source_missing" | "tool_unconfigured" | "user"
--     (extensible: new values added without a schema migration by allowing
--     NULL or CHECK removal in a future amendment if needed; for now these
--     three cover the implemented detection reasons from project_health.rs)
--
-- `blocked_reason_note` — free-form human-readable note (nullable).
--     For "user" blocks: the user-supplied message.
--     For system-detected blocks: the structured message from BlockCondition::message().
--
-- Both columns are NULL when lifecycle != "blocked", and populated when a
-- block transition is written (by project_health.rs emit_block_transition).
-- The columns are cleared (set to NULL) when the project transitions out of blocked.

ALTER TABLE projects ADD COLUMN blocked_reason_kind TEXT;
ALTER TABLE projects ADD COLUMN blocked_reason_note TEXT;
