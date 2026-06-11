-- Migration 0015: plan_apply_runs and plan_apply_events tables (spec 025).
--
-- Constitution §II: every item attempt writes an audit record; rollback
-- attempts are logged separately; append-only ensures the chain is
-- reconstructable (FR-003, SC-001).
-- Constitution §V: durable records owned by the database; events are
-- append-only projections.
--
-- R-Run-1: PlanApplyRun is mandatory in v1.
-- R-CAS-1: CAS approved→applying is atomic; run row created at same time.

CREATE TABLE IF NOT EXISTS plan_apply_runs (
    id               TEXT PRIMARY KEY NOT NULL,
    plan_id          TEXT NOT NULL REFERENCES plans(id),
    approval_token   TEXT NOT NULL,
    started_at       TEXT NOT NULL,
    ended_at         TEXT,
    terminal_state   TEXT CHECK (terminal_state IN ('applied','partially_applied','failed','cancelled','paused')),
    items_total      INTEGER NOT NULL DEFAULT 0,
    items_applied    INTEGER NOT NULL DEFAULT 0,
    items_failed     INTEGER NOT NULL DEFAULT 0,
    items_skipped    INTEGER NOT NULL DEFAULT 0,
    items_cancelled  INTEGER NOT NULL DEFAULT 0,
    items_pending    INTEGER NOT NULL DEFAULT 0,
    pause_reason     TEXT    -- last pause reason: 'volume.unavailable' | 'disk.full' | 'item.stale'
);

CREATE INDEX IF NOT EXISTS plan_apply_runs_plan ON plan_apply_runs (plan_id);

-- Append-only audit table: one row per item state transition.
-- item_id is NULL for plan-level transitions (start / terminal).
CREATE TABLE IF NOT EXISTS plan_apply_events (
    id           TEXT PRIMARY KEY NOT NULL,
    run_id       TEXT NOT NULL REFERENCES plan_apply_runs(id),
    plan_id      TEXT NOT NULL,
    item_id      TEXT,   -- NULL for plan-level events
    prior_state  TEXT NOT NULL,
    new_state    TEXT NOT NULL,
    at           TEXT NOT NULL,
    -- Failure detail (set when new_state = 'failed' or 'stale')
    failure_code          TEXT,
    failure_message       TEXT,
    failure_recoverable   INTEGER,  -- 0/1 boolean
    -- Rollback detail (set when a rollback was attempted)
    rollback_attempted    INTEGER,  -- 0/1 boolean
    rollback_outcome      TEXT CHECK (rollback_outcome IN ('succeeded','failed','not_applicable') OR rollback_outcome IS NULL),
    rollback_message      TEXT
);

-- Primary access patterns: by plan (audit reconstruction) and by time (ordering).
CREATE INDEX IF NOT EXISTS plan_apply_events_plan ON plan_apply_events (plan_id, at ASC);
CREATE INDEX IF NOT EXISTS plan_apply_events_run  ON plan_apply_events (run_id, at ASC);

-- Add 'stale' to item_state check on plan_items (R-FS-1).
-- SQLite does not support ALTER TABLE ADD CONSTRAINT on existing tables; we
-- handle the stale state in application code and verify via the executor.
-- The existing check already allows 'failed'; 'stale' is tracked in
-- plan_apply_events.new_state and via a separate item flag column.
ALTER TABLE plan_items ADD COLUMN item_stale INTEGER NOT NULL DEFAULT 0;
