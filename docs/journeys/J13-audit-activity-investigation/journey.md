---
id: J13
title: Reconstruct what happened to my library
version: 1
status: active
last_reviewed: 2026-07-14
actors: [astrophotographer]
surfaces: [audit, activity, archive, settings]
interfaces: [desktop-ui]
trace:
  - docs/product/journeys/J13-audit-activity-investigation/journey.md @ 66026463
  - deltas/2026-07-14-q15-t122.md (settings audit)
  - deltas/2026-07-14-q15-t123.md (protection audit)
  - deltas/2026-07-14-q15-t124.md (equipment audit)
  - deltas/2026-07-14-q15-t125.md (source audit)
  - deltas/2026-07-14-q15-t127.md (negative-space enforcement)
  - PR #826, PR #805, spec-030 FR-130–FR-134/SC-009
---

## Goal

The astrophotographer needs to reconstruct what PlateVault actually did (or
refused to do) after an unattended scan, a plan apply, a settings change, or a
forgotten background operation. Done means: they can find the specific event
by entity and/or date, see its outcome (applied / refused / failed) and the
actor that performed it, and — for anything refused or failed — see why,
without any ambiguity about whether "no matching row" means "nothing
happened" or "nothing was recorded".

## Preconditions

- P1: The app is running against an existing library with at least one
  registered data source.
- P2: At least one mutating action has already occurred that is eligible for
  the durable Audit Log — e.g. a filesystem plan apply, a settings change, a
  protection override/acknowledgement, an equipment add/edit, or a source
  register/enable/disable/remap.
- P3: At least one attempted mutation was refused or failed (e.g. a
  protection override blocked by dependents, an equipment add with a
  duplicate alias, or a source delete blocked by dependents) — establishable
  by attempting one of these from the relevant page.
- P4: The Activity panel has accumulated one or more events from the current
  session (any in-app action produces at least an info-level row).

## Steps

### S1 — Open the Activity panel {#S1}
- **Do:** Toggle the status-bar Log control.
- **Expect:** The panel opens showing a live, newest-first stream of
  in-session events, each with a severity/level and a source indicator; rows
  that reference a specific entity are visually marked as navigable.
- **Expect (negative):** Opening or closing the panel writes no Audit Log
  entry — it is a read.

### S2 — Filter the live stream by severity {#S2}
- **Do:** Select a severity chip (error / warn / info / debug).
- **Expect:** Only rows at that exact level are shown; selecting "all"
  restores the full set. A diagnostics toggle is available only when the
  app's log level setting is "debug", and only then can diagnostic-source
  rows be shown at all.
- **Expect (negative):** A severity chip that matches zero current rows
  renders as an empty filtered list scoped to this live, in-session stream —
  it must never be read as evidence that the durable Audit Log is empty.

### S3 — Cross-link a stream row to its entity {#S3}
- **Do:** Click a row referencing a project, session, target, or plan.
- **Expect:** Navigation lands directly on that entity's own page.
- **Expect (negative):** A row referencing an entity type with no dedicated
  page (settings, protection, equipment, a data source) instead opens the
  durable Audit Log pre-filtered to that entity — it never does nothing on
  click.

### S4 — Manage panel chrome {#S4}
- **Do:** Toggle follow mode; scroll up within the stream; close the panel
  once via its collapse control and once via Escape.
- **Expect:** With follow mode on, the newest row stays pinned at the top of
  the list as new events arrive; scrolling up pauses that auto-scroll without
  clearing the persisted follow preference, and returning to the top resumes
  it. Both the collapse control and Escape close the panel.

### S5 — Export the live stream {#S5}
- **Do:** Trigger the panel's Export action.
- **Expect:** A native save dialog titled for the Activity panel opens; on
  confirming a destination, a file is written with no error shown.
- **Expect (negative):** Cancelling the save dialog leaves no file written
  and shows no error.

### S6 — Open the durable Audit Log {#S6}
- **Do:** Navigate to Settings → Audit Log.
- **Expect:** A table lists attempted mutating actions across the library,
  each row showing timestamp, event, entity, outcome (applied / refused /
  failed / ok / paused), and actor.

### S7 — Find a plan apply by entity and date {#S7}
- **Do:** After applying a filesystem plan, search or filter the Audit Log to
  find that plan by its entity and by the date it ran.
- **Expect:** The plan-apply event is present with outcome=applied and an
  actor. This is the core coverage assertion of the journey (SC1).

### S8 — Find a settings, protection, equipment, or source change {#S8}
- **Do:** After changing a setting, overriding or acknowledging a protection
  rule, adding/editing equipment, or registering/enabling/disabling/remapping
  a data source, filter the Audit Log by that entity type and date.
- **Expect:** The change is present as a durable row with outcome and actor.
  An equipment record created by auto-detection (not a direct user action)
  appears with actor=system at diagnostic severity, not attributed to the
  user.
- **Expect (negative):** A refused or failed attempt in any of these four
  categories (P3's blocked override/duplicate-alias/blocked-delete case, or
  equivalent) still appears as a row, with outcome=refused or outcome=failed
  and a reason code — it is never silently dropped from the log.

### S9 — Confirm reads produce no audit noise {#S9}
- **Do:** Navigate through several pages/panes performing only reads (no
  edits, no confirmations).
- **Expect:** No new Audit Log rows appear as a result of this navigation.
- **Expect (negative):** The Audit Log's total count changes only with
  attempted mutations, never with browsing alone.

### S10 — Search and page through the Audit Log {#S10}
- **Do:** Use the free-text search box and the date-range pickers; page
  forward and back through the results.
- **Expect:** Search text and date range narrow the result set and its total
  count. A date range that excludes every event renders an explicit empty
  state, distinguishable from the loading state and from an error. Pagination
  controls move between pages and disable at the first and last page.

### S11 — Export the Audit Log {#S11}
- **Do:** Trigger the Audit Log's Export action with the current filters
  applied.
- **Expect:** A file download completes reflecting the filtered set.
- **Expect (negative):** An export failure surfaces an inline error message —
  it never fails silently.

### S12 — Review an archived project's history {#S12}
- **Do:** Open an archived project's detail view.
- **Expect:** The same kind of audit history (event, outcome, actor per row)
  appears, scoped to that project's entity id only.

## Success criteria

- SC1: Every filesystem plan apply performed during the session is findable
  in the Audit Log by entity and by date, with outcome=applied (S7) — 100%
  coverage, zero missed plan events.
- SC2: Every settings, protection, equipment, or source mutation attempt
  (applied, refused, or failed) is a durable Audit Log row carrying outcome
  and actor, and refused/failed rows carry a reason code (S8) — zero
  silently-dropped mutation attempts.
- SC3: A defined read-only page tour (S9) adds zero new Audit Log rows.
- SC4: Every Activity-panel row for project/session/target/plan cross-links
  directly to that entity's page; every other entity type lands on the Audit
  Log filtered to it (S3) — no dead-end rows.
- SC5: An Audit Log query (search or date range) matching zero events always
  renders an explicit empty state, never the loading or error state (S10).
- SC6: Both export actions (Activity panel S5, Audit Log S11) either produce
  a readable file or show an inline error — never a silent no-op.

## Known gaps

- G1: The Activity panel has session-only severity filtering plus a
  `sourceFilter` state, but no UI control (chip/toggle) currently sets that
  source/category filter — `apps/desktop/src/app/LogPanel.tsx` never calls
  `setSourceFilter`. Until that control ships, category/source filtering
  alongside severity (as originally scoped for this journey) cannot be
  exercised. Carried from the pre-migration doc; still true as of 2026-07-14.
- G2: The Activity panel reads only the in-session bus/ring buffer
  (`apps/desktop/src/data/logStore.ts`), not the durable audit store — so
  "activity is a view over the audit" (the log-panel iteration referenced as
  blocked-on-Q9 in spec-030) is not yet true. A durable settings/protection/
  equipment/source change from an earlier session is discoverable only via
  Settings → Audit Log (S6–S8), not via the Activity panel. Not yet specified
  in spec-030 per the pre-migration delta note; unconfirmed whether/when this
  ships.

## Delta log
