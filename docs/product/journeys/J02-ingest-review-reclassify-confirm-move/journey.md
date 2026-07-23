> **MIGRATED:** current truth now lives at
> `docs/journeys/J02-ingest-review-reclassify-confirm-move/journey.md`. This file and
> its deltas are frozen legacy history.

## Journey 2 — Ingest → review/reclassify → confirm (move mode)

**Goal:** take files sitting in an inbox drop folder (unorganized) and get
them safely into the registered light-frames library, with any missing
metadata resolved along the way.

**Preconditions:** an inbox root and at least one registered light-frames
root are set up; files exist under the inbox.

**Narrative flow:**

1. On **Inbox**, **Rescan** picks up new folders. Selecting a folder classifies
   it: a folder mixing frame types (e.g. lights and darks together) is never
   shown as one ambiguous "mixed" item — it materializes as several
   single-type items (e.g. `light · Ha · 300s`, `light · Ha · 120s`,
   `dark · 300s`), each still visibly grouped back to its shared source
   folder. Grouping the list by target/frame-type nests correctly, and a
   status-bar breakdown always matches the queue's real contents.
2. If a file is missing a mandatory piece of metadata for its frame type
   (most commonly filter for lights, or target when there's no filter and no
   coordinates), the item surfaces a **needs-review** state: a danger banner
   names exactly what's missing, affected rows get "needs `<attribute>`"
   badges, and **Confirm** is disabled — both in the UI and if you try to
   invoke confirm directly, the backend independently rejects with a typed
   `inbox.missing_path_attributes` error.
3. The user resolves it with the **bulk reclassify** control: select the
   affected files, set the missing value (frame type, filter, exposure, or
   binning), and apply to the selection. This only ever rewrites PlateVault's
   own index — file bytes are never touched, and the override survives a
   rescan. Once resolved, the item automatically re-partitions into a clean
   single-type item and Confirm re-enables.
4. **Confirm** turns a classified item into a plan (never a file move by
   itself). If more than one destination library root is registered for that
   frame type, the user is forced to pick one via a root picker before a plan
   is generated; with exactly one valid root, it's chosen automatically. The
   confirmed item stays visible in the queue, now marked "planned" — it does
   not disappear.
5. Files only move when a plan is **applied** (see Journey 3's review/apply
   step, which is shared with catalogue-mode plans) — the plan's destination
   path is resolved from the per-frame-type folder pattern (e.g.
   `{target}/{filter}/{date}/light/`) and shown in full before anything
   happens.

**Touch & validate:**

- List chrome: search, file-type filter, kind filter, group control and both
  secondary sorts, every sortable column header, Rescan; the detection/name
  column must render a distinguishing name for every item, including files
  sitting directly in a root.
- Needs-review gate: banner names the exact missing attribute; affected rows
  badged; Confirm visibly disabled (distinguishable from enabled at a
  glance); direct IPC confirm rejected with the typed error; list-level state
  badge and detail-panel state must agree for the same item.
- Bulk reclassify: select-all; a homogeneous selection applies cleanly; a
  selection spanning *different detected types* must warn before overwriting;
  after any override, the file shows override provenance and a reset path;
  overrides survive a rescan.
- Confirm: with one valid root (auto-picked, stated); with 2+ roots (picker
  forced); item transitions classified → planned visibly in the queue.
- Plan review overlay: opens from "Review plans (N)"; every item shows
  action, **source and destination**, protection; Escape and Discard both
  close without mutation; per-item Apply and Apply-all both work and both
  report per-item outcomes; a failed item is identifiable by name with a
  reason.
- Post-apply: an explicit success signal with a path to the result (e.g.
  "View session"); inbox badge, "Confirm all (N)" counter, and status-bar
  breakdown all decrement consistently; the applied action appears in the
  Audit Log with outcome.
- Frame-type vocabulary: the status-bar breakdown and type badges use
  normalized frame-type names (one spelling per type).
- Per-file surfaces: the Files popover opens from the list row and the
  FileInspector opens per file, showing the same per-file metadata the
  needs-review gate computes over; the row's file count and the detail's
  file count agree for the same item; if per-file metadata fails to load,
  the detail shows an explicit error state and Confirm stays disabled.
- Selection identity: the detail panel tracks the selected *item*, not its
  list position — changing search or filters never silently swaps which
  item the detail (and its Confirm/reclassify controls) targets.
- Destination-root select (detail header): the choice arms the selected
  item only — selecting another item returns the control to Auto; the
  displayed value always equals the value a confirm would use; two roots
  with the same folder name are distinguishable in the options.
- Reveal: the selected item's source folder is revealable from the detail
  ("Show in File Explorer"), or the surface documents its exemption from
  the reveal contract explicitly.

**Safety & trust notes:** confirming never moves a file — only a plan
application does; a stale plan (source file changed on disk after confirm)
refuses to apply rather than silently applying an outdated action list; a
destination collision is refused rather than silently overwritten, and the
refusal itself gets an audit record.

**Scenario files:**
`e2e-agentic-test/041-inbox-plan-surface/mixed-folder-single-type-subitems/scenario.md`,
`.../missing-mandatory-gate/scenario.md`,
`.../reclassify-field-agnostic/scenario.md`,
`.../confirm-move-vs-catalogue/scenario.md`,
`.../plan-overlay-apply-audit/scenario.md`,
`e2e-agentic-test/025-filesystem-plan-application/plan-overlap-guard/scenario.md`,
`e2e-agentic-test/journeys/grand-inbox-journey/scenario.md` (canonical
end-to-end version of Journeys 2–4).

**Known gaps (2026-07-04):**
- The generic, registry-driven per-property reclassify editor exists at the
  IPC level (`inbox_property_registry` / `inbox_reclassify_v2`); the shipped
  UI only exposes the common fields (frame type, filter, exposure, binning).
- Cross-plan overlap protection (two plans racing to touch the same files)
  requires **PR #408** (open).
