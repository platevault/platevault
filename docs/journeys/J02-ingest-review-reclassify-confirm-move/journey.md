---
id: J02
title: Move newly-arrived frames from an inbox drop folder into the library
version: 3
status: draft
last_reviewed: 2026-07-14
actors: [astrophotographer]
surfaces: [inbox-confirm, plans, audit]
interfaces: [desktop-ui]
trace:
  - pre-migration journey.md @ git 42c596d6
  - deltas/2026-07-14-jval-docdrift.md
  - PR #938 (fixes #557 — Inbox page infinite render loop)
  - PR #939 (fixes #552, #569, #553, #554 — mixed-folder banner copy,
    scrollable detail body, missing-attribute banner placement)
  - PR #898 (framing-attribution backend: ranked attribution candidates +
    chosenAttribution apply-path at Inbox confirm)
  - docs/product/journeys/J02-ingest-review-reclassify-confirm-move/deltas/2026-07-14-q27-f5.md,
    2026-07-14-q27-f6.md, 2026-07-14-q27-f10.md (legacy pre-merge drafts;
    superseded by S5 below — the shipped feature has no Inbox UI surface,
    unlike what those drafts anticipated)
  - docs/development/windows-journeys/journey-11-framing-clustering-attribution.md
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
  "mixed" type when its files can be split by detected frame type. Opening
  the Inbox page and leaving it open never spins the page in a runaway
  re-render loop (previously the page re-rendered continuously the entire
  time it was open, driven by an unstable page-status node identity and a
  freshly-allocated empty-items array while the item-list query was
  unresolved).
- **Trace (stability):** `apps/desktop/src/features/inbox/InboxPage.tsx`
  (`useSetPageStatus` call site, `listData?.items ?? []`); PR #938 fixes
  #557.

### S2 — Inspect an item's per-file detail {#S2}
- **Do:** Select a queue item and open its detail.
- **Expect:** The detail shows the same per-file metadata (frame type,
  filter, exposure, binning, gain, temperature, target, date) that the
  needs-review gate (S3) computes over; the file count shown on the list
  row and the file count shown in the detail agree. Each field is
  distinguishable as real data (with a source pill), an unresolved
  missing-but-applicable value (chip, no source pill), or a not-applicable
  value (blank/"—", no chip) — never a bare `0`/blank standing in for a
  missing value (`apps/desktop/src/components/RenderValue.tsx`,
  `InboxDetail.tsx` field wiring). The detail continues to track the item
  the user selected even if the user changes the search text or an active
  filter afterward. The detail body (property tables, mixed-summary line,
  Files popover trigger, needs-review controls) is its own scroll region,
  so content taller than the docked detail panel scrolls into view rather
  than being clipped by the panel's outer overflow. On the residual "mixed"
  parent-folder row still visible after its files are auto-split into
  single-type sub-items (S1's known `#549` case), the advisory banner reads
  "This folder is automatically split into separate single-type items —
  find and confirm each one individually in the list," not the retired
  claim that Confirm on the parent row itself produces a split.
- **Expect (negative):** Changing search or filter text never silently
  re-targets the open detail panel to a different item. If per-file
  metadata fails to load, the detail shows an explicit error state rather
  than an empty or stale one, and Confirm stays disabled. The source
  folder is NOT revealable from this detail today — `nativeReveal` is
  wired only into the Sessions feature, not Inbox; corrected from the
  legacy doc's unconditional reveal claim.
- **Trace:** `apps/desktop/src/components/RenderValue.tsx`,
  `apps/desktop/src/features/inbox/InboxDetail.tsx` (renderer wiring,
  `.alm-inbox-detail__scroll` sole scroll region per PR #939 fixes #553;
  mixed-folder banner copy per PR #939 fixes #552, #569);
  `apps/desktop/src/features/sessions/revealInventory.ts` (reveal is
  Sessions-only — no `nativeReveal` call anywhere under
  `features/inbox/`).

### S3 — Resolve missing metadata via bulk reclassify {#S3}
- **Do:** For an item flagged as needing review (missing a mandatory
  attribute for its frame type — most commonly filter for lights, or
  target when there is no filter and no coordinates), select the affected
  files and set the missing value (frame type, filter, exposure, or
  binning) in one action.
- **Expect:** The needs-review item shows a banner naming exactly what is
  missing, placed inline in the detail's Files column right below the
  per-file popover trigger it explains (not as a separate trailing
  full-width alert column), and affected rows carry a "needs `<attribute>`"
  badge; Confirm is disabled while unresolved. Applying a value to a selection of
  affected (missing-value) files applies to the whole selection in one
  call, reported as an applied count. Once every file in the item has the
  missing value, the item re-partitions into a clean single-type item and
  Confirm re-enables automatically. The override is visible with its
  provenance (a source pill distinguishing it from a FITS-derived value)
  and a reset path, and it survives a later rescan.
- **Expect (negative):** Resolving a missing value never rewrites the
  source file's bytes — only PlateVault's own index changes. Attempting to
  confirm an unresolved item is rejected independently of the UI: a direct
  confirm request against that item fails with a typed
  `inbox.missing_path_attributes` error.
- **Trace:** Removed the legacy claim "a selection spanning different
  detected types warns before overwriting" — no corroborating warning UI
  or backend check found (`InboxDetail.tsx` `handleBulkApply`/
  `handleSelectAll`, `crates/app/inbox/src/reclassify.rs`, and the
  `reclassify-field-agnostic` e2e scenario all apply uniformly with no
  type-mismatch check); carried unverified from the legacy doc's
  validation checklist into an unconditional Expect by the migration.
  "Reset path" is UNVERIFIED (not corrected): a backend primitive exists
  (`set_manual_override_reset_stale`,
  `crates/persistence/db/src/repositories/q_inbox.rs`) but no UI control
  invoking it was located — see report. Banner placement (Files-column,
  inline) per PR #939 fixes #554.

### S4 — Choose a destination library root, when more than one applies {#S4}
- **Do:** If more than one registered library root can receive the item's
  frame type, pick one from the item's destination-root control (default:
  Auto).
- **Expect:** With exactly one valid root, the picker is not shown and
  that root is used automatically. With two or more valid roots, the
  control lists each as `<folder name> · <category>` and defaults to
  Auto. The choice arms only the selected item — selecting a different
  item returns the control to Auto for that item, and the value shown
  always equals the root a confirm would actually use.
- **Expect (negative — corrected):** Two registered roots that share the
  same last path segment (e.g. `D:\Astro\library` and `E:\Backup\library`)
  are NOT told apart in the picker — the option label is
  `basename(path) · category` only, with no path-disambiguation logic
  (`apps/desktop/src/features/inbox/InboxDetail.tsx`, destination-root
  `<select>` around the `applicableRoots.map` block). The legacy/migrated
  claim that same-named roots "are still told apart" is corrected; treat
  this as a candidate product gap (see report).

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
- **Expect (negative — backend-only capability):** For a light-frame item,
  the confirm call now also computes and returns ranked attribution
  candidates matching the item against existing framings/projects (add to
  a framing, start a new framing — including a mosaic project's first new
  panel, flag an optic-train mismatch, or start a new project; a
  completed-project candidate carries a reopen flag with the raw-subs-
  archived warning) and accepts an optional per-item `chosenAttribution`
  pick that persists framing/project membership at confirm time — but
  today this is reachable only by calling the IPC command directly. No
  control in the Inbox UI displays a candidate list or lets the user make
  a pick, so this step's on-screen behavior is unchanged: Confirm still
  just turns the item into a plan with no attribution UI shown. Tracked as
  issue #943.
- **Trace:** `crates/app/inbox/src/attribution.rs`,
  `crates/app/inbox/src/confirm.rs` (`attribution_candidates`,
  `chosenAttribution`); no reference to `attribution`/`Attribution` exists
  under `apps/desktop/src/features/inbox/` — confirmed by repo-wide search
  and by `docs/development/windows-journeys/journey-11-framing-clustering-
  attribution.md`, which states this explicitly as "a real, currently-
  accurate product gap, not a testing gap." Issue: #943.

### S6 — Review the plan before anything touches disk {#S6}
- **Do:** Open the plan review surface (e.g. via a "Review plans (N)"
  control) for one or more planned items.
- **Expect:** Every plan item shows its action and its source and
  destination path in full. Closing the review (Escape or Discard) causes
  no mutation. A pending destination-root choice from S5 is resolvable
  from inside this surface.
- **Expect (negative):** Nothing under the inbox or the destination root
  changes as a result of opening or discarding this review.
- **Trace (correction):** dropped "any protection status" — the Inbox
  move-plan review surface is `PlanApprovalOverlay`/`PlanPanel.tsx`
  (`apps/desktop/src/features/inbox/`), which has no protection-status
  rendering at all. The generic `PlanReviewOverlay`
  (`apps/desktop/src/features/plans/PlanReviewOverlay.tsx`) that DOES
  gate on protection (spec-016 `PlanProtectionGate`) explicitly documents
  itself as NOT used by Inbox: "Feature-specific bulk surfaces (the
  inbox multi-plan PlanApprovalOverlay) predate it and remain separate."
  Protection is a source/archive-plan concept (spec-016); it does not
  currently apply to inbox move-mode plans.

### S7 — Apply the plan {#S7}
- **Do:** Apply one plan item, or apply all reviewed plan items.
- **Expect:** Applying reports an aggregate outcome (a toast naming the
  applied count and, when any item failed, the failed count) for both
  single-item and apply-all/apply-selected flows. Files move to the path
  resolved from the per-frame-type folder pattern (e.g.
  `{target}/{filter}/{date}/light/`).
- **Expect (negative):** A plan whose source file changed on disk since it
  was confirmed refuses to apply rather than silently applying an outdated
  action list. A destination collision is refused rather than silently
  overwritten.
- **Trace (correction):** the backend apply response
  (`InboxPlanApplyResult { inboxItemId, planId, state, error }`) carries a
  per-item error, but no inbox UI code renders it per item — only an
  aggregate count reaches the user
  (`apps/desktop/src/features/inbox/InboxPage.tsx`
  `handleApplySelected`/`handleApplyAll`). Corrected from "a failed item
  is identifiable by name with a reason." Also dropped the unverified
  "View session" post-apply link claim — no such affordance found in
  `PlanPanel.tsx`/`PlanApprovalOverlay.tsx`/`usePlanApplyProgress.ts` or
  the message catalog. Stale-source refusal is confirmed via the executor
  CAS check (`crates/fs/executor/src/run.rs::check_cas`); destination
  collision refusal is confirmed via `ErrorCode::PathCollision` +
  "never overwrite silently" (`crates/fs/executor/src/run.rs`).

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
  library root, or still queued, with the backend apply response
  recording a per-item failure reason even though the current UI only
  surfaces an aggregate applied/failed count (S7).
- SC4: Every successful apply in S7 and every refused destination
  collision in S7 has a matching row in the audit history (S8).
- SC5: A plan whose source file changed after confirm is refused at apply
  time, never silently applied (S7).

## Known gaps

- G1: (dissolved 2026-07-15) — tracked as issue #880; registry editor UI exposes only common fields.

## Delta log

- **Δ2** 2026-07-17 · S5 · behavior-change
  Confirm's backend now computes ranked framing/project attribution
  candidates for light-frame items and accepts a `chosenAttribution` pick
  that persists membership at confirm time — but no Inbox UI surfaces
  either the candidates or the pick, so nothing changes on screen for this
  step yet.
  Evidence: PR #898 · by: journey-scribe (intent-gated)

- **Δ3** 2026-07-17 · S1, S2, S3 · behavior-change
  The Inbox page no longer runs a continuous re-render loop while open
  (PR #938 fixes #557). The stale "mixed" parent-row banner (S1's known
  `#549` residual-row case) no longer promises a Confirm-triggered split
  that cannot happen — it now describes the automatic single-type-item
  split that already occurred (PR #939 fixes #552, #569). The detail body
  is now its own scroll region instead of being clipped by the docked
  panel's overflow (PR #939 fixes #553). The missing-required-attribute
  banner (S3) now renders inline in the Files column, below the popover
  trigger it explains, instead of as a separate trailing alert column (PR
  #939 fixes #554).
  Evidence: PR #938 (fixes #557), PR #939 (fixes #552, #553, #554, #569) ·
  by: journey-scribe (intent-gated)
