---
id: J02
title: Move newly-arrived frames from an inbox drop folder into the library
version: 1
status: active
last_reviewed: 2026-07-14
actors: [astrophotographer]
surfaces: [inbox, plans, audit]
interfaces: [windows-desktop]
trace:
  - pre-migration journey.md @ git 66026463
  - deltas/2026-07-14-jval-docdrift.md
  - e2e-agentic-test/041-inbox-plan-surface/mixed-folder-single-type-subitems/scenario.md
  - e2e-agentic-test/041-inbox-plan-surface/missing-mandatory-gate/scenario.md
  - e2e-agentic-test/041-inbox-plan-surface/reclassify-field-agnostic/scenario.md
  - e2e-agentic-test/041-inbox-plan-surface/confirm-move-vs-catalogue/scenario.md
  - e2e-agentic-test/041-inbox-plan-surface/plan-overlay-apply-audit/scenario.md
  - e2e-agentic-test/025-filesystem-plan-application/plan-overlap-guard/scenario.md
  - e2e-agentic-test/journeys/grand-inbox-journey/scenario.md
---

## Goal

The user has raw frame files sitting unorganized in an inbox drop folder and
wants them safely relocated into the registered light-frames library, with
any missing per-frame metadata resolved before anything moves. "Done" is:
every file that started in the inbox now lives at its computed destination
path under a registered library root, no file was moved without an
explicit, reviewed plan, and the action is visible in the audit history.

## Preconditions

- P1: At least one inbox root and at least one registered light-frames
  library root exist.
- P2: One or more files sit under the inbox root, not yet scanned.

## Steps

### S1 — Rescan the inbox and see items split by type {#S1}
- **Do:** Trigger a rescan of the inbox.
- **Expect:** New folders under the inbox appear as queue items. A folder
  whose files mix frame types (e.g. lights and darks together) never
  materializes as one ambiguous "mixed" item — it appears as several
  single-type items (e.g. `light · Ha · 300s`, `light · Ha · 120s`,
  `dark · 300s`), each still visibly grouped back to its shared source
  folder. Grouping the list by target or frame type nests these items
  correctly, and the status-bar breakdown count matches the queue's real
  contents using one normalized name per frame type.
- **Expect (negative):** No queue item is shown as an undifferentiated
  "mixed" type when its files can be split by detected frame type.

### S2 — Inspect an item's per-file detail {#S2}
- **Do:** Select a queue item and open its detail.
- **Expect:** The detail shows the same per-file metadata (frame type,
  filter, exposure, binning, gain, temperature, target, date) that the
  needs-review gate (S3) computes over; the file count shown on the list
  row and the file count shown in the detail agree. The detail continues
  to track the item the user selected even if the user changes the search
  text or an active filter afterward. The item's source folder can be
  revealed in the OS file manager from the detail.
- **Expect (negative):** Changing search or filter text never silently
  re-targets the open detail panel to a different item. If per-file
  metadata fails to load, the detail shows an explicit error state rather
  than an empty or stale one, and Confirm stays disabled.

### S3 — Resolve missing metadata via bulk reclassify {#S3}
- **Do:** For an item flagged as needing review (missing a mandatory
  attribute for its frame type — most commonly filter for lights, or
  target when there is no filter and no coordinates), select the affected
  files and set the missing value (frame type, filter, exposure, or
  binning) in one action.
- **Expect:** The needs-review item shows a banner naming exactly what is
  missing, and affected rows carry a "needs `<attribute>`" badge; Confirm
  is disabled while unresolved. Applying a value to a selection that
  shares one detected type applies cleanly; a selection spanning different
  detected types warns before overwriting. Once every file in the item has
  the missing value, the item re-partitions into a clean single-type item
  and Confirm re-enables automatically. The override is visible with its
  provenance and a reset path, and it survives a later rescan.
- **Expect (negative):** Resolving a missing value never rewrites the
  source file's bytes — only PlateVault's own index changes. Attempting to
  confirm an unresolved item is rejected independently of the UI: a direct
  confirm request against that item fails with a typed
  `inbox.missing_path_attributes` error.

### S4 — Choose a destination library root, when more than one applies {#S4}
- **Do:** If more than one registered library root can receive the item's
  frame type, pick one from the item's destination-root control (default:
  Auto).
- **Expect:** With exactly one valid root, the picker is not shown and
  that root is used automatically. With two or more valid roots, the
  control lists them distinguishably (two roots sharing a folder name are
  still told apart) and defaults to Auto. The choice arms only the
  selected item — selecting a different item returns the control to Auto
  for that item, and the value shown always equals the root a confirm
  would actually use.

### S5 — Confirm a classified item into a plan {#S5}
- **Do:** Confirm a fully-classified (not needs-review) item.
- **Expect:** Confirm turns the item into a reviewable plan; it never
  moves a file by itself. If no destination root was pre-selected in S4
  and more than one valid root exists, confirm still proceeds, a toast
  tells the user to choose a destination, and the root choice surfaces
  inside the plan review surface (S6) rather than an inline dialog at
  confirm time. Once a plan exists, the item stays visible in the queue,
  now marked "planned" — it does not disappear from the list.
- **Expect (negative):** No file on disk changes as a result of Confirm
  alone.

### S6 — Review the plan before anything touches disk {#S6}
- **Do:** Open the plan review surface (e.g. via a "Review plans (N)"
  control) for one or more planned items.
- **Expect:** Every plan item shows its action, its source and destination
  path in full, and any protection status. Closing the review (Escape or
  Discard) causes no mutation. A pending destination-root choice from S5
  is resolvable from inside this surface.
- **Expect (negative):** Nothing under the inbox or the destination root
  changes as a result of opening or discarding this review.

### S7 — Apply the plan {#S7}
- **Do:** Apply one plan item, or apply all reviewed plan items.
- **Expect:** Each item reports its own outcome; a failed item is
  identifiable by name with a reason. Files move to the path resolved from
  the per-frame-type folder pattern (e.g. `{target}/{filter}/{date}/light/`).
  On success, an explicit signal names the result with a path to it (e.g.
  "View session").
- **Expect (negative):** A plan whose source file changed on disk since it
  was confirmed refuses to apply rather than silently applying an outdated
  action list. A destination collision is refused rather than silently
  overwritten.

### S8 — Verify the applied outcome {#S8}
- **Do:** Return to the inbox queue and to the audit history after an
  apply.
- **Expect:** The inbox badge, the "Confirm all (N)" counter, and the
  status-bar breakdown all decrement consistently for the moved files. The
  applied action, and any refused destination collision, appear in the
  audit history with their outcome.

## Success criteria

- SC1: After S1, a source folder mixing frame types produces N single-type
  queue items (N = distinct detected type/setting combinations in that
  folder), not 1 mixed item.
- SC2: An item missing a mandatory attribute cannot be confirmed through
  either the UI (Confirm disabled) or a direct confirm request (typed
  `inbox.missing_path_attributes` rejection) — S3.
- SC3: Every file present in the inbox before S1 is, by the end of S7,
  either present at its resolved destination path under a registered
  library root, or still queued with a named reason it was not moved.
- SC4: Every successful apply in S7 and every refused destination
  collision in S7 has a matching row in the audit history (S8).
- SC5: A plan whose source file changed after confirm is refused at apply
  time, never silently applied (S7).

## Known gaps

- G1: The generic, registry-driven per-property reclassify editor exists
  at the IPC level (`inbox_property_registry` / `inbox_reclassify_v2`);
  the shipped UI in S3 only exposes the common fields (frame type, filter,
  exposure, binning) — carried from legacy doc.

## Delta log
