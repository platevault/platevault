---
id: J03
title: Catalogue an already-organized folder without moving files
version: 4
status: draft
last_reviewed: 2026-07-14
actors: [astrophotographer]
surfaces: [inbox-confirm, plans, sessions, audit]
interfaces: [desktop-ui]
trace:
  - pre-migration journey.md @ git 42c596d68b621a46e54e647fdb7c48716fdb68c1
  - docs/product/journeys/J03-ingest-confirm-catalogue-in-place/deltas/2026-07-14-jval-docdrift.md
  - PR #898 (framing-attribution backend applies identically on
    catalogue-in-place confirms)
  - docs/product/journeys/J03-ingest-confirm-catalogue-in-place/deltas/2026-07-14-q27-f5.md,
    2026-07-14-q27-f10.md (legacy pre-merge drafts; superseded by S2 below
    — no Inbox UI surface shipped)
  - docs/development/windows-journeys/journey-11-framing-clustering-attribution.md
  - PR #938 (fixes #768 — destination-root picker was shown regardless of
    the item's source-root organization state)
  - spec-054-adaptive-detail-dock (FR-014, FR-015 — permanent Inbox split)
---

## Goal

The user has a light-frames (or similar) folder that is already organized
exactly the way they want it, and wants PlateVault to know about those files
— so they show up in Sessions, projects, and calibration matching — without
moving, copying, or rewriting a single byte on disk. Done means: the files
are indexed and visible in derived views, and the file set and content
hashes on disk are byte-for-byte unchanged from before confirm.

## Preconditions

- P1: A library root is registered with organization state **organized** —
  either chosen explicitly on the setup wizard's per-root Organized/
  Unorganized control (including when the wizard is reopened via
  Settings → Advanced → "Restart setup wizard", which prefills the same
  control for already-registered roots), or by registering a new non-inbox
  root via Settings → Data Sources' "Add" flow, which has no
  organization-state picker and defaults every non-inbox category to
  organized automatically (inbox-category roots always default to
  unorganized). The root contains files that are not yet in PlateVault's
  index.
- P2: The organized root's new files have been surfaced into the Inbox
  queue — for an **inbox-category** root this happens via Inbox's own
  "Rescan all roots"; for a non-inbox organized root, the user has run
  **Rescan** on that specific root from Settings → Data Sources (Inbox's
  "Rescan all roots" only reaches roots of category `inbox` and does not
  surface other roots' new files).

## Steps

### S1 — Classify files from the organized root {#S1}
- **Do:** The user opens Inbox and reviews an item whose files came from the
  organized root (surfaced per P2).
- **Expect:** The item classifies exactly as it would from any other root —
  a folder mixing frame types materializes as separate single-type items,
  and an item missing mandatory metadata (e.g. filter, target) shows the
  same needs-review gate with Confirm disabled until resolved, as in the
  move-mode journey. Reviewing the item's detail uses the same permanent
  Inbox split as move-mode (see J02/S2): a narrow item list on the left,
  full-height detail on the right, at every window width — never a bottom
  dock, and the detail's own file list scrolls within that right pane
  rather than overflowing the window.
- **Expect (negative):** The Inbox detail for an organized-root item never
  renders as a bottom strip and its file list is never cut off below the
  window — same layout guarantee as move-mode (J02/S2).
- **Trace:** crates/app/inbox/src/confirm.rs (needs-review gate is
  root-agnostic); spec-054/FR-014, FR-015 (see J02/S2 for the layout
  detail, shared across both ingest modes).

### S2 — Confirm the item {#S2}
- **Do:** The user clicks Confirm on the classified item.
- **Expect:** The response reports a move count of 0 and a catalogue count
  equal to the file count; every resulting plan action is "catalogue in
  place" (destination equals source, staying under the organized root); no
  destination-root picker is shown.
- **Expect (negative):** No destination-root picker appears — there is
  nothing to pick, since the files are staying where they are.
- **Trace:** crates/app/inbox/src/confirm.rs:293-303 (OrganizationState::
  Organized routes every file to the `catalogue` action);
  `apps/desktop/src/features/inbox/InboxDetail.tsx` `applicableRoots`
  (filtered by the item's `organizationState`, not just frame-type
  category, per PR #938 fixes #768 — previously the picker rendered
  whenever more than one applicable root existed for the frame type, even
  for an organized-source item, though any selection there was silently
  ignored server-side).
- **Expect (negative — backend-only capability):** For a light-frame item,
  the same server-side attribution pass described in J02/S5 runs here too
  — ranked framing/project candidates are computed identically regardless
  of organized-vs-unorganized routing (the pass runs before the
  catalogue/move branch decides the plan action), and a `chosenAttribution`
  pick persists membership at confirm time with zero filesystem I/O. No
  Inbox UI surfaces this for catalogue-mode confirms any more than it does
  for move-mode ones. Tracked as issue #943.
- **Trace:** crates/app/inbox/src/confirm.rs (attribution pass runs before
  the `is_light_item`-gated catalogue/move dispatch, so it is
  organization-state-agnostic); see J02/S5's trace for the UI-absence
  evidence. Issue: #943.

### S3 — Review the plan {#S3}
- **Do:** The user opens the plan review overlay ("Review plans (N)"), the
  same overlay used for move-mode plans.
- **Expect:** Each item reads as a catalogue action, still shows its
  (unchanged) path, and Escape/Discard both close without mutation.
- **Expect (negative):** The destructive-destination control (Archive vs.
  System Trash) is absent for a plan made entirely of catalogue actions —
  it only appears when at least one action in the plan requires destructive
  confirmation.
- **Trace:** apps/desktop/src/features/inbox/PlanPanel.tsx (destructive
  control rendered only when an action requires destructive confirm, per
  `PlanPanel.test.tsx: 'does NOT show the destructive control when no
  action requires destructive confirm'`).

### S4 — Apply the plan {#S4}
- **Do:** The user applies the plan (per-item or Apply-all).
- **Expect:** The catalogue action writes the files' identity and metadata
  into the library's index; an explicit success signal appears; the files
  become visible in Sessions; the apply is recorded in the Audit Log with
  outcome, exactly as a move-mode apply is.
- **Expect (negative):** The on-disk file set and content hashes for the
  organized root are unchanged byte-for-byte after apply — the executor
  performs no filesystem I/O for a catalogue action (it is a documented
  no-op). If a file under review changed on disk after confirm, the item is
  refused as stale rather than silently catalogued with outdated metadata
  (same staleness gate the shared apply pipeline uses for move plans).
- **Trace:** crates/fs/executor/src/ops/catalogue_op.rs; crates/fs/executor/
  src/run.rs:620 (`ExecutorItemAction::Catalogue`); crates/app/core/src/
  plan_apply.rs (stale/`item.stale` gate applies ahead of per-action
  dispatch, action-agnostic).

### S5 — Mixed-root run routes independently per root {#S5}
- **Do:** In the same Inbox session, the user confirms one item sourced from
  an organized root and another item of the same frame type sourced from an
  unorganized (inbox) root.
- **Expect:** The organized-root item's plan is entirely catalogue actions;
  the unorganized-root item's plan is entirely move actions — the routing
  is decided purely by each file's source root's organization state, never
  by frame type or file kind.

## Success criteria

- SC1: For a confirm sourced entirely from an organized root, the confirm
  response reports `move_count == 0` and `catalogue_count == file_count`
  (S2).
- SC2: After apply, the organized root's file set and per-file content
  hashes are identical to their pre-apply values (S4).
- SC3: After apply, every applied file is visible in Sessions and has an
  Audit Log entry recording the catalogue outcome (S4).
- SC4: In a mixed-root run, catalogue-vs-move routing matches each item's
  source root's organization state 100% of the time, independent of frame
  type (S5).

## Known gaps

None specific to catalogue-in-place mode. The legacy doc's only referenced
gap (cross-plan overlap protection, tracked via Journey 2's shared
confirm/plan pipeline) shipped in PR #408 (merged 2026-07-04) and is
provably closed — dropped rather than carried forward.

## Delta log

- **Δ2** 2026-07-17 · S2 · behavior-change
  Confirm's backend attribution pass (framing/project matching,
  `chosenAttribution` apply-path) now runs identically on organized-root
  (catalogue-mode) confirms as on move-mode confirms — but no Inbox UI
  surfaces it either way yet.
  Evidence: PR #898 · by: journey-scribe (intent-gated)

- **Δ3** 2026-07-17 · S2 · behavior-change
  The destination-root picker is now correctly suppressed for an item
  sourced from an organized root even when more than one root would
  otherwise be applicable to its frame type — previously it rendered
  regardless of the item's organization state, and any selection there was
  silently ignored server-side (catalogue-mode confirms always resolve to
  the source root).
  Evidence: PR #938 (fixes #768) · by: journey-scribe (intent-gated)

- **Δ4** 2026-07-17 · S1 · behavior-change
  Reviewing an organized-root item now uses the same permanent Inbox
  left/right split as move-mode (never a bottom dock at any width), with
  the detail's file list scrolling within the full-height right pane.
  Evidence: spec-054-adaptive-detail-dock (FR-014, FR-015) · by:
  journey-scribe (intent-gated)
