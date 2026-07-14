---
id: J08
title: Ingest calibration masters and match them to sessions
version: 1
status: draft
last_reviewed: 2026-07-14
actors: [astrophotographer]
surfaces: [inbox-confirm, calibration]
interfaces: [desktop-ui]
trace: [docs/product/journeys/J08-calibration-ingest-masters-matching/journey.md, spec-040 MasterDetector, issue-619, issue-620, issue-647, spec-030 FR-130-FR-140]
---

## Goal
An astrophotographer gets calibration master frames (darks/flats/bias) into
the library as individually tracked items, then matches them against
acquisition sessions that need calibration. Done means: every ingested
master is a distinct, correctly typed Calibration-page row with trustworthy
(never fabricated) fingerprint data, and every session assigned a master was
assigned through an explicit, confirmable, audited action — never silently.

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
  only when its filename contains a master marker ("master" / "_stacked")
  **or** its `IMAGETYP` contains "master". Files without either marker
  ingest as ordinary calibration frames, not masters.
- **Expect (negative):** A folder of masters never classifies as one
  folder-level aggregate item; a raw (non-stacked) dark/flat/bias with an
  ordinary filename and no `IMAGETYP=master` never appears as a master.
- **Trace:** spec-040 MasterDetector.

### S2 — Confirm and register masters {#S2}
- **Do:** Confirm and apply the inbox item(s) covering the ingested masters.
- **Expect:** Each master registers into the calibration store as its own
  item.

### S3 — Browse the Calibration page {#S3}
- **Do:** Open the Calibration page.
- **Expect:** One row per master file. Fingerprint columns are
  kind-conditional per an explicit applicability matrix — a dark's
  temperature/gain columns don't apply to a bias and render as an explicit
  not-applicable marker, never inferred from missing data. Sort headers,
  search, and group-by work; a kind filter appears once a second kind
  exists; a search with no matches reads as a filter miss, not an empty
  library. Composed identifying strings (meta lines, cells) omit absent
  tokens rather than showing a placeholder inside the joined string. Master
  *light* frames never appear here. Only dark/flat/bias kinds surface in
  this v1 — `dark_flat` and `bad_pixel_map` are out of scope by design.
- **Expect (negative):** A metadata-less master never shows a fabricated
  value such as "Gain 0 · Exposure 0s · Size 0 KB"; no missing numeric ever
  renders as 0; a missing value never carries a source pill, while a real 0
  always renders "0" with its source pill.
- **Trace:** issue-619, issue-620, spec-030 FR-135-FR-140.

### S4 — Open master detail {#S4}
- **Do:** Open a master's detail panel.
- **Expect:** The panel leads with information not already on the list row
  (full metadata, provenance, related entities, history, actions) and trims
  echoed list columns to a small identifying summary. "Used by" and
  "Compatible" lists open and navigate. Age/created date is visible as a
  value, not only as an aging warning. A metadata-less field renders an
  explicit unresolved chip, never a plausible-looking zero.
- **Expect (negative):** The panel is never a raw dump of every available
  field with no more information than its row.
- **Trace:** issue-619, spec-030 FR-135-FR-140.

### S5 — Use master actions {#S5}
- **Do:** Trigger "Use in project", "Replace master", and "Show in File
  Explorer" from master detail.
- **Expect:** Each performs its documented action with an answer-back, or is
  absent entirely — a rendered button with no behavior is a failing state.
  "Show in File Explorer" opens the master's own folder.

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
- **Trace:** issue-620, spec-030 FR-135-FR-140.

### S7 — Assign a master to a session {#S7}
- **Do:** Assign a candidate master to a session; separately, cancel an
  in-progress assignment.
- **Expect:** Confirming records the assignment, updates the usage count,
  and answers back; un-assigning reverses it. The same master's usage is
  visible from the session/project side (round-trip navigation).
- **Expect (negative):** Cancelling fires no backend call; no assignment is
  ever applied without an explicit confirm — matching never auto-applies a
  calibration assignment.

### S8 — Change a calibration matching tolerance {#S8}
- **Do:** In Settings → Calibration Matching, change the "Offset tolerance"
  setting (or another tolerance such as temperature/aging requirements).
- **Expect:** The change immediately changes what the matching engine
  considers a clean candidate set (visible at S6), persists across restart,
  and writes one durable, workflow-severity audit row carrying the old→new
  value.
- **Expect (negative):** Merely opening the Calibration settings pane (a
  read) produces no audit row.
- **Trace:** issue-647, spec-030 FR-130-FR-134.

## Success criteria
- SC1: Ingesting a folder of correctly-named/tagged master files (S1) yields
  one Calibration-page row per master (S3), each showing real values or an
  explicit unresolved state — never a fabricated zero.
- SC2: An unassigned master's candidate list (S6) is visible before any
  assignment and every hard-rule mismatch is shown, never hidden.
- SC3: Every tolerance/offset change under Settings → Calibration Matching
  (S8) is durably audited with old→new value, and no assignment applies
  without an explicit confirm (S7).

## Known gaps
<!-- - G1: <step or environment that cannot be validated, and why> -->

## Delta log
<!-- Window since last_reviewed. Format:
- **Δ<version>** <date> · <step ids> · behavior-change
  <what changed, user-visibly>
  Evidence: <PR/spec/commit refs> · by: <author>
-->
