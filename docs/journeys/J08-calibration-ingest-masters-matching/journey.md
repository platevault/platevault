---
id: J08
title: Ingest calibration masters and match them to sessions
version: 6
status: draft
last_reviewed: 2026-07-15
actors: [astrophotographer]
surfaces: [inbox-confirm, calibration]
interfaces: [desktop-ui]
trace: [docs/product/journeys/J08-calibration-ingest-masters-matching/journey.md @ 66026463, deltas/2026-07-14-jval-docdrift.md, deltas/2026-07-14-q15-t122.md, deltas/2026-07-14-q16-t128.md, deltas/2026-07-14-q16-t129.md, deltas/2026-07-14-q16-t131.md, deltas/2026-07-14-q16-t132.md, deltas/2026-07-14-q16-t133.md, docs/journeys/J08-calibration-ingest-masters-matching/journey.md pilot (PR #848), spec-040 MasterDetector, spec-030 FR-135-FR-140, issue-619, issue-620, PR #851, PR #849, PR #910, PR #939 (fixes #551), spec-054-adaptive-detail-dock (FR-001, FR-004)]
---

## Goal
An astrophotographer gets calibration master frames (darks/flats/bias) into
the library as individually tracked items, then matches them against
acquisition sessions that need calibration. Done means: every ingested
master is a distinct, correctly typed Calibration-page row with trustworthy
(never fabricated) fingerprint data, and every session assigned a master was
assigned through an explicit, confirmable action — never silently.

## Preconditions
- P1: A calibration root is registered (Journey 1, S2).
- P2: Master and light frames are available to ingest.

## Steps
### S1 — Ingest calibration files through the Inbox {#S1}
- **Do:** Point the calibration root at a folder containing several master
  files (e.g. two darks, a flat, a bias) and ingest through the same Inbox
  pipeline used for lights.
- **Expect:** A file classifies as an individual master item — with its own
  type and fingerprint (gain, temperature, binning, filter where relevant) —
  when: an authoritative stack/combine count in its metadata (Siril
  `STACKCNT`/`NCOMBINE`) is greater than 1; or, when no such count is
  present, its filename/path or `IMAGETYP` carries a master naming
  convention ("master" / "_stacked"). When a stack/combine count IS present,
  it is decisive and overrides a naming convention that disagrees with it
  (e.g. a file named `dark_master_stacked.fit` whose count is 1 is NOT a
  master).
- **Expect (negative):** A folder of masters never classifies as one
  folder-level aggregate item; a raw (non-stacked) dark/flat/bias with an
  ordinary filename, no master naming, and no decisive stack count never
  appears as a master; a stack count of 1 is never overridden by a
  "master"/"_stacked" filename into a false-positive master.
- **Trace:** spec-040 MasterDetector; PR #851 (fix(master-detect): let Siril
  STACKCNT evidence beat filename heuristics — closed issue #753: decisive
  header evidence from any registered detector now outranks an earlier,
  naming-only, possibly-wrong verdict from another detector, regardless of
  detector registration order).

  In the Inbox list itself (pre-confirm), a materialized single-file master
  item now reads by its own authoritative `frameType` rather than the
  legacy folder-level `groupFrameType`, so a lone master item no longer
  mislabels as "Mixed". The classification pill in the Type column is
  quieter (no longer louder than the duplicate frame-type text already
  shown in the Format column for master rows), and the former "Detection"
  column is renamed "Path" and shows the source root's own basename for a
  root-level row instead of a literal "(root)" placeholder shared
  indistinguishably across every root. PR #910 fixes #550, #555, #556
  (`apps/desktop/src/features/inbox/InboxList.tsx`,
  `inboxStatsFromItems.ts`, `grouping.ts`). #549 (mixed-folder placeholder
  double-counting extracted masters) was investigated but is explicitly
  left open — the reporter found no safe frontend-only fix; it needs a
  backend change in `crates/app/inbox`/`crates/persistence/db` (parent
  leaf-folder rows are never retired once single-type sub-items are
  materialized).

  A master item's own pre-confirm Inbox detail view never claims the
  required-attribute gate is "all clear" when it has no per-file metadata
  to evaluate: masters bypass `classify()`'s per-file metadata persistence
  (`crates/app/inbox/src/metadata.rs`), so `fileMetadata` is always empty
  for a master item, and the detail's "No file metadata" empty state now
  appends an explicit caveat ("Required-attribute status is checked when
  you confirm.") instead of silently implying nothing is missing — the
  backend's own `inbox.missing_path_attributes` gate at confirm time is
  independent and can still reject the item. The underlying gap (masters
  never getting a real per-file metadata row) is a backend/data-model
  change still open, overlapping PR #854's in-flight
  `classify.rs`/`confirm.rs`/`reclassify.rs` work; this fix only stops the
  detail view from implying certainty it doesn't have.
  Evidence: PR #939 (fixes #551) — `apps/desktop/src/features/inbox/
  InboxDetail.tsx`.

### S2 — Confirm and register masters {#S2}
- **Do:** Confirm and apply the inbox item(s) covering the ingested masters.
- **Expect:** Each master registers into the calibration store as its own
  item.

### S3 — Browse the Calibration page {#S3}
- **Do:** Open the Calibration page.
- **Expect:** One row per master file. When the master's camera is
  registered under a friendly name in Settings → Equipment, the row (and
  detail, S4) shows that name instead of the raw instrument string the
  capture program wrote into the file header — matching is
  case-insensitive and covers every alias, and renaming the camera in
  Settings updates the list immediately. A master whose camera is not
  registered still shows the raw header string; a master with no camera
  recorded stays blank. This resolution is display-only — calibration
  match scoring still compares the raw header values. Fingerprint columns are
  kind-conditional per an explicit applicability matrix — a dark's
  temperature/gain columns don't apply to a bias and render as an explicit
  not-applicable marker, never inferred from missing data. Sort headers,
  search, and group-by work; a kind filter appears once a second kind
  exists; a search and/or kind filter that matches nothing reads as a
  filter miss — naming the active filter and offering a "Clear filters"
  action — not an empty library, and only when showable masters actually
  exist (a library holding only never-shown kinds still gets the
  onboarding "run a scan" copy, not a misleading filter-miss state).
  Composed identifying strings (meta lines, cells) omit absent
  tokens rather than showing a placeholder inside the joined string. Master
  *light* frames never appear here. Only dark/flat/bias kinds surface in
  this v1 — `dark_flat` and `bad_pixel_map` are out of scope by design.
- **Expect (negative):** A metadata-less master never shows a fabricated
  value such as "Gain 0 · Exposure 0s · Size 0 KB"; no missing numeric ever
  renders as 0; a missing value never carries a source pill, while a real 0
  always renders "0" with its source pill.
- **Trace:** issue-619, issue-620, spec-030 FR-135-FR-140; PR #849 (missing
  calibration/file details render as an explicit unresolved state instead of
  zero/placeholder values — `RenderValue`/`PropertyTable` shared renderer,
  `master-applicability.ts`, migration 0065 dropping the hardcoded
  `0 AS size_bytes` view column).

### S4 — Open master detail {#S4}
- **Do:** Open a master's detail panel. Resize the window across the
  wide-window threshold.
- **Expect:** The master detail uses the same adaptive dock as other list
  pages (see J04/S4): a full-height, drag-resizable side panel on a wide
  window (width and a per-page pin both persist across restarts), a bottom
  dock when narrow. The panel leads with information not already on the list row
  (full metadata, provenance, related entities, history, actions) and trims
  echoed list columns to a small identifying summary. A "Used by" list of
  the sessions the master is assigned to opens and navigates. Age/created
  date is visible as a value, not only as an aging warning. A metadata-less
  field renders an explicit unresolved chip, never a plausible-looking zero.
- **Expect (negative):** The panel is never a raw dump of every available
  field with no more information than its row.
- **Trace:** issue-619, spec-030 FR-135-FR-140; PR #849. Corrected:
  "Used by" links sessions only, not projects — the panel's only other
  linked-entity list is "Compatible" sessions, whose backing
  `compatible_sessions` field the backend hardcodes to an empty vec today
  (`crates/app/calibration/src/matching.rs` `masters_get`, per
  `MasterDetail.tsx` file-header note), so it never has anything to
  navigate yet; dropped rather than claimed
  (`apps/desktop/src/features/calibration/MasterDetail.tsx:313-330`).
  spec-054/FR-001, FR-004 (adaptive side/bottom dock, resizable+persistent
  width, per-page pin).

### S5 — Use master actions {#S5}
- **Do:** Trigger "Use in project", "Replace master", and the platform-native
  reveal-in-file-manager action from master detail.
- **Expect:** Each performs its documented action with an answer-back, or is
  absent entirely — a rendered button with no behavior is a failing state.
  The reveal action opens the master's own folder using the OS-native label
  (e.g. "Show in File Explorer" on Windows).

### S6 — Review ranked candidate sessions {#S6}
- **Do:** From a project, or the Calibration page's matching view, select an
  unassigned master.
- **Expect:** Ranked candidate sessions to calibrate appear before any
  assignment, each showing real context (target, filter, night, frame
  count) with a confidence value and mismatch indicators. A session whose
  fingerprint fails a hard rule (e.g. wrong gain) shows with a mismatch
  indicator rather than being silently hidden. Absent context never
  fabricates a value (no "1x1" binning placeholder, no empty-string camera)
  — absence renders as an explicit unresolved state.
- **Expect (negative):** Matching results are unaffected by missing-value
  display handling — ranking is computed on option-typed session/master
  info, never on the display DTO.
- **Trace:** issue-620, spec-030 FR-135-FR-140; PR #849
  (`crates/app/calibration/src/matching.rs` de-zeroing).

### S7 — Assign a master to a session {#S7}
- **Do:** Assign a candidate master to a session; separately, cancel an
  in-progress assignment.
- **Expect:** Confirming records the assignment, updates the "used by" list,
  and answers back. The same master's usage is visible from the
  session/project side (round-trip navigation).
- **Expect (negative):** Cancelling fires no backend call; no assignment is
  ever applied without an explicit confirm — matching never auto-applies a
  calibration assignment.

### S8 — Change a calibration matching tolerance {#S8}
- **Do:** In Settings → Calibration Matching, toggle a hard "match required"
  requirement (camera, binning, gain, or offset) or change a soft tolerance
  (sensor temperature, dark/bias age).
- **Expect:** The change is durably persisted and still holds after an app
  restart.
- **Trace:** spec-030 FR-130-FR-134 (durable audit intent); issue-647.

## Success criteria
- SC1: Ingesting a folder of correctly-named/tagged, or STACKCNT-confirmed,
  master files (S1) yields one Calibration-page row per master (S3), each
  showing real values or an explicit unresolved state — never a fabricated
  zero.
- SC2: An unassigned master's candidate list (S6) is visible before any
  assignment and every hard-rule mismatch is shown, never hidden.
- SC3: No calibration assignment ever applies without an explicit confirm
  (S7).

## Known gaps
<!-- - G1: <step or environment that cannot be validated, and why> -->

## Delta log

- **Δ2** 2026-07-17 · S1 · behavior-change
  In the pre-confirm Inbox list, a single-file materialized master item no
  longer mislabels as "Mixed" (now reads by its own frame type); the Type
  pill is quieter, and the former "Detection" column is renamed "Path" and
  shows each source root's own basename instead of an indistinguishable
  "(root)" placeholder.
  Evidence: PR #910 (fixes #550, #555, #556) · by: journey-scribe
  (intent-gated)

- **Δ3** 2026-07-17 · S1 · behavior-change
  A master item's pre-confirm Inbox detail view no longer implies "all
  clear" for the required-attribute gate when it has no per-file metadata
  to evaluate — masters bypass per-file metadata persistence entirely, so
  the empty state now appends an explicit caveat that the gate is checked
  at confirm time instead. The underlying per-file-metadata gap for masters
  remains open.
  Evidence: PR #939 (fixes #551) · by: journey-scribe (intent-gated)

- **Δ4** 2026-07-17 · S4 · behavior-change
  Master detail now uses the shared adaptive dock: full-height resizable
  side panel on a wide window (width + per-page pin persist), bottom dock
  when narrow — same mechanism as Sessions/Projects/Archive/Targets.
  Evidence: spec-054-adaptive-detail-dock (FR-001, FR-004) · by:
  journey-scribe (intent-gated)

- **Δ5** 2026-07-20 · S3 · behavior-change
  A search and/or kind filter that matches nothing on the Calibration page
  now names the active filter and offers a "Clear filters" action, and only
  when showable masters actually exist — previously a search miss always
  rendered the "No calibration masters — run a scan" onboarding copy even
  when masters existed, indistinguishable from a truly empty library.
  Evidence: PR #1291 (closes #669, #812) · by: journey-scribe (intent-gated)

- **Δ6** 2026-07-20 · S3 · behavior-change
  Masters now display the camera's registered friendly name (Settings →
  Equipment) instead of the raw instrument header string, case-insensitive
  across aliases; an unregistered camera still shows the raw string.
  Display-only — match scoring is unaffected.
  Evidence: PR #1341 · by: journey-scribe (intent-gated)
