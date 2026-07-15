---
id: J04
title: Review acquisition sessions as a derived, always-current inventory
version: 1
status: draft
last_reviewed: 2026-07-14
actors: [astrophotographer]
surfaces: [sessions, projects]
interfaces: [desktop-ui]
trace:
  - docs/product/journeys/J04-sessions-review-derived/journey.md @ 66026463 (pre-migration doc)
  - docs/product/journeys/J04-sessions-review-derived/deltas/2026-07-14-jval-docdrift.md
  - docs/product/journeys/J04-sessions-review-derived/deltas/2026-07-14-q16-t129.md
  - docs/product/journeys/J04-sessions-review-derived/deltas/2026-07-14-q16-t131.md
  - docs/product/journeys/J04-sessions-review-derived/deltas/2026-07-14-q16-t132.md
  - docs/product/journeys/J04-sessions-review-derived/deltas/2026-07-14-q16-t133.md
  - docs/product/journeys/J04-sessions-review-derived/deltas/2026-07-14-q27-f10.md
  - docs/development/journey-run-2026-07-14.md (live Windows validation, build 7e522c16)
  - docs/development/windows-validation-journeys-tracker.md
  - PR #415 (merged) · PR #849 (merged, Q16 missing-value rendering)
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
  moved/catalogued (live-verified 2026-07-14: a 22-file folder split into
  3 sessions with counts 4/14/4, the exact canonical gain/binning split).
  Each row's Target cell falls back to the session's own name
  (`session.target ?? session.name`) rather than a blank/dash when FITS
  target metadata is null.
- **Expect (negative):** No Confirm, Re-open, Reject, or Ignore control and
  no review-state pill (e.g. needs-review/candidate) appears anywhere on
  the page — the Inbox confirm gate the user already passed is the only
  gate (live-verified 2026-07-14: DOM/button scan found none).
- **Trace:** `apps/desktop/src/features/sessions/SessionsTable.tsx:296-299`;
  docs/development/journey-run-2026-07-14.md. Corrected: the name fallback
  is not always a *unique* discriminator — two same-night sessions that both
  lack metadata can render the identical label `Session — {date}` (open bug
  #654, P3, live-reproduced). SC4 below is narrowed to describe this
  precisely rather than claim 100% uniqueness the current fallback doesn't
  deliver.

### S3 — Filter, group, and sort the session list {#S3}
- **Do:** Use the Filter and Camera dropdowns, the Group-by control
  (Target/Filter/Night/Camera/Month), and click a sortable column header.
- **Expect:** Dropdown options are populated from the full, unfiltered
  session set (picking one filter never removes the other options); the
  active sort column exposes `aria-sort`; a "Grouped by X" hint appears
  under the list while grouping is active.
- **Expect (negative):** There is no frame-type filter — sessions are light
  frames only; calibration frames are handled on their own surface. There is
  no secondary/multi-column sort control — sort is single-column
  (`SessionSort` in `SessionsTable.tsx` carries one `{col, dir}` pair; no
  secondary-sort UI exists anywhere in the codebase).
- **Trace:** PR #415 (merged; live-confirmed 2026-07-14: dropdowns,
  grouping, `aria-sort`, footer hint all working). Corrected: the prior
  "set a secondary sort" step was unsupported by any code path
  (`apps/desktop/src/features/sessions/SessionsTable.tsx:55-58`) and not in
  PR #415's own description — dropped rather than left as an unfalsifiable
  aspiration.

### S4 — Open a session's detail {#S4}
- **Do:** Select a session row.
- **Expect:** A detail panel opens showing the session's attribute set —
  target, filter, frame count, exposure, total integration time (when
  derivable), night, camera, gain, binning, sensor temperature, and
  confirmed-by — each carrying a source badge (FITS/User/Inferred/Default)
  only when a real value is present; a field that is applicable but has no
  value renders a distinct "unresolved" chip (never a bare em dash and never
  a source badge); a field that does not apply to this entity renders a
  blank em dash with no chip.
- **Expect (negative):** Closing the panel via the ✕ control never mutates
  the session or triggers any lifecycle transition. Pressing Escape does
  **not** currently close the panel — the shared `ListPageLayout`/
  `DetailPanel` components wire `onCloseDetail` only to the ✕ button's
  `onClick`; no `keydown`/Escape listener exists in either component (open
  bug #771, live-reproduced, affects every `ListPageLayout` detail panel
  app-wide, not Sessions-specific).
- **Trace:** `apps/desktop/src/components/PropertyTable.tsx:171-205`,
  `apps/desktop/src/components/RenderValue.tsx:100-132` (Q16 shared
  renderer, PR #849, merged). Corrected: the previous "renders as an em
  dash" claim described the pre-#849 behavior (issue #620/#770: a missing
  value showed a bare dash still carrying a "FITS" source pill,
  indistinguishable from a real value); PR #849 decouples the source badge
  from missing values app-wide including Sessions detail. #770 appears
  resolved by this merge but is still open in the tracker as of this audit
  — worth a maintainer check. Corrected: the "✕ or Escape" close claim
  (carried from the pre-migration baseline) was live-tested false on
  2026-07-14 (#771); no fix has since landed
  (`apps/desktop/src/components/ListPageLayout.tsx` still has no keydown
  handler).

### S5 — Follow a linked project from session detail {#S5}
- **Do:** Click a linked project chip in session detail.
- **Expect:** Navigation lands on the Projects list. The Projects route
  supports pre-selecting a project via a `selected` search param
  (`ProjectsPage.tsx:83`), but the Sessions caller does not currently pass
  it: `SessionsPage.tsx`'s `onOpenProject` handler discards the clicked
  project's id and always navigates to `/projects` with no selection
  (`onOpenProject={() => navigate({ to: '/projects' })}` — the `id` argument
  `SessionDetail.tsx` passes is never read).
- **Trace:** `apps/desktop/src/features/sessions/SessionsPage.tsx:256`;
  `apps/desktop/src/features/projects/ProjectsPage.tsx:83`. Corrected:
  commit `eaa5f9b2` ("Sessions detail — linked projects to aux column",
  2026-06-22) dropped `navigate({ to: '/projects', search: { selected: id
  } })` in favor of the id-less call while repositioning the linked-projects
  column; the commit message describes a layout change, not this behavior
  change, so there is no intent evidence — this looks like an unintentional
  regression, not a deliberate simplification. Not caught live on
  2026-07-14 (no project was linked to the test session at that point, so
  the step was skipped rather than exercised).

### S6 — Reveal the session's source root {#S6}
- **Do:** With a resolvable source path, click the reveal action ("Show in
  File Explorer" on Windows) in session detail.
- **Expect:** The OS file browser opens. The path it opens to is the
  session's owning `InventorySource` path — which is one path per
  registered library root (`InventorySource` is "one per LibraryRoot",
  `path: root.current_path`), not a per-session subfolder. Every session
  under the same root reveals the same folder; a library root with multiple
  target/night subfolders does not let Reveal distinguish between the
  sessions inside it. If the reveal call fails, an error toast is shown and
  the panel stays open.
- **Expect (negative):** The reveal action is not offered at all when no
  source path can be resolved for the selection (never a dead/no-op
  button).
- **Trace:** `crates/app/core/src/inventory.rs:85-91` (`InventorySource.path
  = root.current_path`, one entry per `LibraryRoot`);
  `crates/contracts/core/src/inventory.rs:138-144` (doc comment: "one per
  `LibraryRoot`"). Corrected: the pre-migration baseline and this doc's
  first draft both claimed Reveal opens "the session's own folder, not a
  library-root ancestor" (SC6). Live-tested false on 2026-07-14 across
  three M 51 sessions in one root, all opening the same top-level folder
  (open bugs #567, #651, user-confirmed) — `InventorySession` carries no
  per-session path field for this to be architecturally possible today.

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
- SC4: 100% of rows render a non-blank Target-cell identity (never a bare
  dash) when FITS metadata is null (S2). Currently NOT met for uniqueness:
  two same-night sessions that both lack metadata can render the identical
  label `Session — {date}` — open bug #654.
- SC5: Selecting a linked-project chip lands on that exact project,
  pre-selected, every time (S5). Currently NOT met: no project is ever
  pre-selected — see S5 (`SessionsPage.tsx:256` drops the id argument).
- SC6: Reveal opens the session's own folder, never a root ancestor (S6).
  Currently NOT met: Reveal opens the owning library root's folder for
  every session under it — see S6 (open bugs #567, #651).
- SC7: A rescan changes neither session count nor introduces any
  review-state indicator (S7).

## Known gaps

- G1: (dissolved 2026-07-15) — tracked as issue #773; session notes editing.
- G2: (retired) — the prior G2 ("PropertyTable source badge on missing
  values, unmerged fix on `impl/q16-missing-value`") is stale. PR #849
  (merged) adopted the shared `RenderValue`/`PropertyTable` renderer on
  Sessions detail, coupling the source badge to value presence
  (`PropertyTable.tsx:201`); see S4. Retired per the id-stability rule
  (never renumbered, never reused) rather than deleted.
- G3: (dissolved 2026-07-15) — tracked as issue #889; was wrongly scoped out, now tracked (connectivity state).

## Delta log

(none — this is the version-1 migrated baseline; the pre-migration
journey.md and folded delta are recorded in `trace:` above.)
