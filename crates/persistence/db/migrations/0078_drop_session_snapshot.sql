-- Migration 0078: drop the `session_snapshot` table (issue #712).
--
-- Completes the cleanup migration 0050 began. Migration 0005 created this
-- table to freeze session review context on every transition into or out of
-- `confirmed` / `rejected` / `needs_review` (spec 002 FR-005, T047).
--
-- Migration 0050 dropped `acquisition_session.state` and
-- `calibration_session.state` — the columns holding the very values that
-- triggered a snapshot — when spec 041 FR-051 made sessions derived,
-- already-confirmed inventory with no review lifecycle. No writer has
-- existed since: `EntityType` (crates/domain/core/src/lifecycle/data_asset.rs)
-- carries no session variant, so a session transition cannot be expressed as
-- a `TransitionCommand`, and `transition_lifecycle` is generic over
-- `LifecycleRepository` with no `SqlitePool` to reach a raw-SQL writer.
--
-- The table has therefore been unwritable, and permanently empty, since 0050.
-- Its Rust writer (`repositories/session_snapshot.rs`) is removed in the same
-- change; its only caller was its own test.
--
-- Indices are dropped explicitly before the table for clarity; SQLite drops
-- them with the table regardless.

DROP INDEX IF EXISTS idx_session_snapshot_session;
DROP INDEX IF EXISTS idx_session_snapshot_audit;

DROP TABLE IF EXISTS session_snapshot;
