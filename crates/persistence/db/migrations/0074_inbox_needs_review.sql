-- Migration 0074: spec 058 FR-028 — needs-review becomes its own field.
--
-- Today `inbox_items.group_key` carries three jobs at once:
--
--   1. the item's classification identity  ("type=light·bin=1x1·...")
--   2. its needs-review status             ("__needs_review__")
--   3. a uniqueness discriminator          ("type=light·resolved=<item-id>")
--
-- Job 3 exists only to dodge the `(root_id, relative_path, group_key)` UNIQUE
-- constraint when `clear_needs_review_sentinel` promotes a resolved item in
-- place and a sibling already holds the natural key. That synthetic key is why
-- a resolved item's identity is unstable across a resolve, and #1086 made the
-- sentinel MORE load-bearing rather than less.
--
-- FR-028 splits job 2 out into this column so `group_key` can be narrowed to
-- job 1 alone (T007) and job 3 can be deleted outright (T006) — two rows
-- sharing a classification identity in one folder ARE the same item, so the
-- existing ON CONFLICT is the correct convergence behaviour rather than
-- something to route around.
--
-- Additive and metadata-only: one column, defaulted, no table rebuild and no
-- CHECK-constraint surgery. Deliberately NO BACKFILL — D-004 declares this
-- feature greenfield, so existing rows are not migrated from the sentinel.
-- See issue #1177 for the audit of whether that licence still holds.
--
-- NOTE for whoever renumbers: PR #1048 independently claims 0072/0073 for
-- onboarding and must move to 0075/0076. Verified 2026-07-20 that main tops
-- out at 0073, so 0074 was free at authoring time.

ALTER TABLE inbox_items
    ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0
        CHECK (needs_review IN (0, 1));
