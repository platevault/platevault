-- Migration 0069: onboarding redesign persistence (spec 056, T001).
--
-- Replaces the legacy spec-010 guided-coach state machine (single-row
-- current_step_id/completed_step_ids/dismissed) with a per-item projection:
-- one row per registry item, plus a section-level flags singleton. The item
-- registry itself (page/topic/prerequisite/seed_query/anchor) is code, not a
-- table (data-model.md "Item registry (code, not DB)").
--
-- `guided_flow_state` (0030_guided_flow.sql) is dropped: FR-027 greenfield
-- removal, no data migrated. Migration 0030 itself stays shipped and
-- untouched (append-only history).

DROP TABLE IF EXISTS guided_flow_state;

-- ── onboarding_state — per-item rows ─────────────────────────────────────────
--
-- item_id: stable dot-notation id from the item registry (e.g.
--          `inbox.confirm_first`). Rows exist for every registry item once
--          onboarding is initialized (seeded on first activation and on
--          restore via the same derivation, FR-014). Unknown item_ids (from a
--          future registry shrink) are ignored on read.
-- state:   unchecked | auto_checked | manually_checked | dismissed.
--          auto_checked/manually_checked/dismissed are terminal for live
--          events and for repeat manual actions — an event or a repeat
--          manual call never downgrades or re-ticks a settled item
--          (idempotent writes; data-model.md "State transitions").
-- source:  seed | event | user — what set the current state.
CREATE TABLE IF NOT EXISTS onboarding_state (
    item_id TEXT NOT NULL PRIMARY KEY,
    state   TEXT NOT NULL CHECK (state IN ('unchecked', 'auto_checked', 'manually_checked', 'dismissed')),
    at      TEXT NOT NULL,
    source  TEXT NOT NULL CHECK (source IN ('seed', 'event', 'user'))
);

-- ── onboarding_flags — singleton ─────────────────────────────────────────────
--
-- Same singleton pattern as the retired 0030_guided_flow.sql.
--
-- orientation_done_at: set on first finish OR skip of the walk (FR-004);
--                       NULL = walk auto-runs on next launch after first-run
--                       completion.
-- section_hidden_at:   set by "Remove getting started" (FR-013) OR
--                       automatically by the backend settle path when the
--                       last open item settles and every group is
--                       complete/dismissed (FR-031 auto-hide); cleared only
--                       by restore (FR-014). Auto-hide is transition-
--                       triggered — restore leaves a still-complete section
--                       visible until a new settle or explicit removal.
-- sidebar_collapsed:   persisted user collapse choice for the accordion
--                       section (FR-012).
CREATE TABLE IF NOT EXISTS onboarding_flags (
    singleton_id       INTEGER NOT NULL PRIMARY KEY CHECK (singleton_id = 1),
    orientation_done_at TEXT,
    section_hidden_at   TEXT,
    sidebar_collapsed   INTEGER NOT NULL DEFAULT 0
);
