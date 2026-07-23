# Data Model: Onboarding Redesign (Spec 056)

**Date**: 2026-07-18 | **Plan**: [plan.md](plan.md) | **Migrations**: `0080_onboarding.sql`, `0081_drop_guided_flow_state.sql` ([research R6](research.md))

## Tables

### `onboarding_state` — per-item rows

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `item_id` | TEXT | PRIMARY KEY | Stable dot-notation id from the item registry (e.g. `inbox.confirm_first`). |
| `state` | TEXT | NOT NULL CHECK IN (`unchecked`, `auto_checked`, `manually_checked`, `dismissed`) | Item lifecycle state. |
| `at` | TEXT | NOT NULL | UTC RFC3339 timestamp of the last state change. |
| `source` | TEXT | NOT NULL CHECK IN (`seed`, `event`, `user`) | What set the state: seed/restore derivation, a live bus event, or a user action. |

Rows exist for every registry item once onboarding is initialized (seeded on
first activation and on restore via the same derivation — spec FR-014).
Unknown `item_id`s (from a future registry shrink) are ignored on read.

### `onboarding_flags` — singleton

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `singleton_id` | INTEGER | PRIMARY KEY CHECK (`singleton_id = 1`) | Same singleton pattern as legacy `0030_guided_flow.sql`. |
| `orientation_done_at` | TEXT | NULL | Set on first finish OR skip of the walk (FR-004); NULL = walk auto-runs on next launch after first-run completion. |
| `section_hidden_at` | TEXT | NULL | Set by "Remove getting started" (FR-013) OR automatically when the last open item settles and every group is complete/dismissed (FR-031 auto-hide, written by the backend settle path); cleared only by restore (FR-014). Auto-hide is transition-triggered — restore leaves a still-complete section visible until a new settle or explicit removal. |
| `sidebar_collapsed` | INTEGER | NOT NULL DEFAULT 0 | Persisted user collapse choice for the accordion section (FR-012). |

### Dropped

`guided_flow_state` — `DROP TABLE IF EXISTS` in `0081_drop_guided_flow_state.sql`. Migration
`0030_guided_flow.sql` itself is shipped and untouched (FR-027, greenfield:
no data migrated).

## Item registry (code, not DB)

A Rust const registry in `crates/app/core/src/onboarding.rs` (successor to the
deleted `STEP_REGISTRY`) is the single source of truth for items:

| Field | Meaning |
| --- | --- |
| `item_id` | Stable id, also the persistence key and frontend key. |
| `page` | One of `inbox`, `sessions`, `calibration`, `targets`, `projects` (FR-006). |
| `completion_topic` | `Option<&str>` — bus topic that auto-ticks it (verified inventory in [research R4](research.md)); `None` = manual item (FR-017). |
| `payload_filter` | Optional payload predicate (e.g. `tool.launch` requires `outcome == "spawned"`). |
| `prerequisite` | Optional upstream milestone + jump destination (FR-010). |
| `seed_query` | How seed/restore derives "already met" from real tables (e.g. ≥1 confirmed inventory row) (FR-014). |
| `anchor` | `data-guide-anchor` value for the L3 spotlight target (FR-022/FR-026). |

Labels, tooltip sentences, prerequisite reasons, and orientation copy are NOT
in the registry — they are Paraglide message keys derived from `item_id`
([research R9](research.md)).

## State transitions

```text
unchecked ── live event (topic match, payload filter, envelope source != "restore") ──▶ auto_checked   [source=event]
MANUAL unchecked ── user checks off ──▶ manually_checked                                               [source=user]
MANUAL unchecked ── user dismisses ──▶ dismissed                                                       [source=user]
AUTOMATIC items (unchecked | auto_checked) ── restore/reset (Settings → Advanced) ──▶ re-derived: auto_checked [source=seed] if milestone exists in DB, else unchecked
manually_checked | dismissed ── restore/reset ──▶ UNCHANGED (user progress is never discarded)
```

Rules:

- `auto_checked` / `manually_checked` / `dismissed` are terminal for live
  events — an event never downgrades or re-ticks a settled item (idempotent
  writes).
- Restore re-derives AUTOMATIC items only (those with a
  `completion_topic`/`seed_query`); `manually_checked` and `dismissed` rows
  keep their state (spec FR-014).
- No per-item undo in v1 (spec FR-017 / PQ-002); manual states are permanent —
  restore does not revert them.
- Section auto-hide (FR-031): the backend settle path (subscriber tick or
  manual `item.set_state`) sets `section_hidden_at` when the settling item
  leaves every group complete/dismissed; restore clears it.
- Envelope `source == "restore"` is filtered in the subscriber before any
  write (FR-016) — server-side, never in the UI.
- Seed and restore share one derivation routine (FR-014 / PQ-001); restore is
  idempotent.

## Derived (never stored)

- Per-page counts and the overall progress line/ring: computed from
  `onboarding_state` rows grouped by registry `page`.
- Prerequisite satisfaction: computed live from the same real tables the
  `seed_query` reads — never cached in onboarding storage.
- Accordion expanded group: derived from the current route; only the user's
  section-collapse choice persists (`sidebar_collapsed`). A group whose items
  are all settled renders as its one-line header with a done checkmark
  (FR-031) — derived from item states, not stored.
- Orientation walk auto-run decision: `first_run` completed AND
  `orientation_done_at IS NULL` AND suppression flag absent (research R8).
