> **MIGRATED:** current truth now lives at
> `docs/journeys/J04-sessions-review-derived/journey.md`. This file and
> its deltas are frozen legacy history.

## Journey 4 — Sessions review (derived groupings, live membership)

**Goal:** see acquisition sessions (a night's worth of a target/filter
combination) as a read-only, always-current view — without a separate
review/approve step.

**Preconditions:** at least one inbox item has been confirmed and its plan
applied (Journey 2 or 3).

**Narrative flow:**

1. Before anything is confirmed and applied, **Sessions** shows nothing for
   that data — sessions are derived from already-confirmed inventory, never
   from raw, unreviewed scans.
2. Once a plan applies, the corresponding acquisition session(s) appear
   automatically, with counts matching what was actually moved/catalogued.
   There is no additional "review this session" step — the confirm gate the
   user already passed in the Inbox is the only gate.
3. The Sessions list and detail deliberately have **no** Confirm, Re-open,
   Reject, or Ignore controls, and no "review-state" pills (e.g.
   needs-review/candidate) — a prior, now-removed session-lifecycle
   state machine was intentionally dropped in favor of this simpler
   derived-view model.
4. Session metadata (e.g. notes) can still be edited post-hoc; editing does
   not require reopening or re-confirming anything, and doesn't trigger any
   lifecycle transition.
5. Rescanning the inbox does not resurrect a review state or duplicate
   sessions — the view is deterministic over confirmed metadata.

**Touch & validate:**

- List chrome: target/filter/camera filters, group + secondary sorts, every
  sortable header; each session row must be distinguishable even when FITS
  metadata is missing (identity falls back to something human-readable, not
  N identical "Session — date" rows of dashes).
- Detail panel: opens on row select and closes on Escape/✕; shows the
  session's frame type and calibration linkage in addition to what the row
  already showed; unresolved values render as an explicit unresolved state,
  not bare dashes that look like confirmed-empty.
- Links: each linked project chip navigates to that project selected;
  "Show in File Explorer" opens the session's own folder (not a root
  ancestor).
- Derivation: before any apply, the list is empty; after an apply, rows
  appear with counts matching the plan; a rescan neither duplicates sessions
  nor resurrects any review state; confirm there are no review/lifecycle
  controls anywhere on the page.
- Notes: edit, autosave signal, persistence across navigation (once the
  notes field ships — its absence is a coverage failure of this journey).

**Safety & trust notes:** this journey is intentionally "boring" — it's a
read view over already-reviewed, already-applied data, and its absence of
review controls is a deliberate simplification, not a missing feature.

**Scenario files:**
`e2e-agentic-test/041-inbox-plan-surface/sessions-derived-inventory/scenario.md`,
`e2e-agentic-test/043-sessions-parity/sessions-inbox-parity/scenario.md`
(Inbox-level interaction parity — filter/camera dropdowns, grouping, virtualized
list, sort).

**Known gaps (2026-07-04):**
- Inbox-level interaction parity (dropdowns, grouping hint footer, `aria-sort`)
  requires **PR #415** (open); without it the Sessions list is functionally
  complete but visually/interaction-behind the Inbox.
