---
id: J04
title: Review acquisition sessions as a derived, always-current inventory
version: 1
status: active
last_reviewed: 2026-07-14
actors: [astrophotographer]
surfaces: [sessions, projects]
interfaces: [desktop-ui]
trace:
  - docs/product/journeys/J04-sessions-review-derived/journey.md @ 66026463 (pre-migration doc)
  - docs/product/journeys/J04-sessions-review-derived/deltas/2026-07-14-jval-docdrift.md
  - PR #415
---

## Goal

See acquisition sessions — a night's worth of a target/filter combination,
already confirmed and applied through the Inbox — as a read-only, always
up-to-date inventory list, without performing any separate review or
approval step. Done means: every applied plan is reflected as session
row(s) with correct counts, every row is identifiable and filterable, and
the view carries no leftover review-state controls.

## Preconditions

- P1: At least one Inbox item has been confirmed and its plan applied
  (journey J02 or J03), so confirmed inventory exists to derive sessions
  from.
- P2: The library root(s) backing that inventory are connected (not
  missing/disabled) — root reconnect scenarios are out of scope here (see
  Known gaps G3).

## Steps

### S1 — Sessions stays empty until inventory is confirmed {#S1}
- **Do:** Open Sessions before any Inbox item has been confirmed and
  applied.
- **Expect:** The list shows no rows for that data.
- **Expect (negative):** Raw, unreviewed scan results never appear as
  sessions — derivation only reads already-confirmed inventory.

### S2 — Sessions appear automatically after a plan applies {#S2}
- **Do:** Confirm an Inbox item and apply its plan (J02/J03), then open
  Sessions.
- **Expect:** The corresponding session row(s) appear with no additional
  "review this session" action; frame counts match what the plan actually
  moved/catalogued. Each row remains distinguishable even when FITS
  target/filter/camera fields are null — identity falls back to the
  session's own name, never to a row of bare dashes.
- **Expect (negative):** No Confirm, Re-open, Reject, or Ignore control and
  no review-state pill (e.g. needs-review/candidate) appears anywhere on
  the page — the Inbox confirm gate the user already passed is the only
  gate.

### S3 — Filter, group, and sort the session list {#S3}
- **Do:** Use the Filter and Camera dropdowns, the Group-by control
  (Target/Filter/Night/Camera/Month), click a sortable column header, and
  set a secondary sort.
- **Expect:** Dropdown options are populated from the full, unfiltered
  session set (picking one filter never removes the other options); the
  active sort column exposes `aria-sort`; a "Grouped by X" hint appears
  under the list while grouping is active.
- **Expect (negative):** There is no frame-type filter — sessions are light
  frames only; calibration frames are handled on their own surface.
- **Trace:** PR #415.

### S4 — Open a session's detail {#S4}
- **Do:** Select a session row.
- **Expect:** A detail panel opens showing the session's attribute set —
  target, filter, frame count, exposure, total integration time (when
  derivable), night, camera, gain, binning, sensor temperature, and
  confirmed-by — each carrying a source badge (FITS/User/Inferred/Default)
  where a source is recorded; a field with no value renders as an em dash;
  linked projects render as clickable chips, or "None" if unlinked.
- **Expect (negative):** Closing the panel (✕ or Escape) never mutates the
  session or triggers any lifecycle transition.

### S5 — Follow a linked project from session detail {#S5}
- **Do:** Click a linked project chip in session detail.
- **Expect:** Navigation lands on Projects with that project selected.

### S6 — Reveal the session's own source folder {#S6}
- **Do:** With a resolvable source path, click the reveal action ("Show in
  File Explorer" on Windows) in session detail.
- **Expect:** The OS file browser opens directly to the session's own
  folder, not a library-root ancestor. If the reveal call fails, an error
  toast is shown and the panel stays open.
- **Expect (negative):** The reveal action is not offered at all when no
  source path can be resolved for the selection (never a dead/no-op
  button).

### S7 — Rescan the Inbox without disturbing Sessions {#S7}
- **Do:** Re-run an Inbox scan of an already-confirmed source.
- **Expect:** Session count and identities stay the same.
- **Expect (negative):** Rescanning never duplicates a session and never
  reintroduces a review/approval state that was intentionally dropped from
  this view.

## Success criteria

- SC1: Before any plan applies, Sessions shows 0 rows for that inventory
  (S1).
- SC2: After a plan applies, session row count and per-row frame counts
  match the applied plan exactly (S2).
- SC3: 0 review-lifecycle controls (Confirm/Re-open/Reject/Ignore, review
  pill) are present anywhere on the Sessions list or detail (S2, S4).
- SC4: 100% of rows remain uniquely identifiable when FITS metadata is
  null — no row reduces to indistinguishable dashes (S2).
- SC5: Selecting a linked-project chip lands on that exact project,
  pre-selected, every time (S5).
- SC6: Reveal opens the session's own folder, never a root ancestor (S6).
- SC7: A rescan changes neither session count nor introduces any
  review-state indicator (S7).

## Known gaps

- G1: Session notes/annotation editing is not implemented — there is no
  notes field on the session DTO or in the Sessions UI (carried from
  legacy doc; verified absent by inspection of
  `apps/desktop/src/bindings/index.ts` and
  `apps/desktop/src/features/sessions/`). Its absence remains a coverage
  gap for this journey until it ships.
- G2: `PropertyTable` (used for session detail) renders a source badge next
  to a value regardless of whether that value is present, so a missing
  field can show a badge (e.g. "FITS") next to a bare dash — tracked as
  GitHub issue #620 (open). A fix (unresolved-value handling decoupled
  from source-badge rendering) exists on the unmerged branch
  `impl/q16-missing-value`; not yet on `main`.
- G3: Library-root connectivity edge cases for a session's backing source
  (missing/disabled/reconnect_required) are out of scope for this
  journey — covered by first-run-setup / library-root management
  journeys.

## Delta log

(none — this is the version-1 migrated baseline; the pre-migration
journey.md and folded delta are recorded in `trace:` above.)
