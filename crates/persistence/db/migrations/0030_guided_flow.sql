-- Migration 0030: guided_flow_state singleton table (spec 010, T003).
--
-- Stores a single row tracking the guided first-project-flow coach state.
-- The singleton is enforced by the CHECK constraint on `singleton_id`.
--
-- Constitution §I:  no image files touched — metadata only.
-- Constitution §II: guided flow is read-only observing domain events.
-- Constitution §V:  SQLite is the durable record; the UI derives from it.
--
-- current_step_id:    dot-notation step id of the active step, or NULL.
-- completed_step_ids: JSON array of completed step ids (e.g. ["inbox.confirm_first"]).
-- dismissed:          1 when the coach is dismissed, 0 otherwise.
-- dismissed_at:       RFC-3339 UTC timestamp set when dismissed; NULL when not dismissed.
-- updated_at:         RFC-3339 UTC timestamp updated on every transition.

CREATE TABLE IF NOT EXISTS guided_flow_state (
    singleton_id        TEXT    NOT NULL PRIMARY KEY CHECK (singleton_id = 'guided_flow'),
    current_step_id     TEXT,
    completed_step_ids  TEXT    NOT NULL DEFAULT '[]',  -- JSON array
    dismissed           INTEGER NOT NULL DEFAULT 0,
    dismissed_at        TEXT,
    updated_at          TEXT    NOT NULL
);
