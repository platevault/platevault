# Quickstart: Inbox Confirmation & Reviewable Plan Surface

**Feature**: 041-inbox-plan-surface | **Date**: 2026-06-20

Manual end-to-end verification on the real desktop app (Windows verify loop: push → pull on `C:\dev\astro-plan` → `run-dev.bat` recompile → verify). Maps to the spec's user-story acceptance scenarios. Use a throwaway `wizard-test.db` (back up, then wipe to get a fresh first-run).

## Setup

1. Prepare two source folders:
   - **Unorganized**: a capture dump with a mixed folder (e.g. lights + a `stacked-16_*.fits` master) and at least one folder needing organizing.
   - **Organized**: a small already-sorted library folder.
2. Launch the app (fresh DB). In the wizard, add both sources.

## US4 — Organization state at add-time (FR-019a/b)

1. When adding the **non-inbox** sources, verify you are **required to choose** `Already organized (leave in place)` vs `Needs organizing (move into library)` — no silent default — and that an explanation / flow diagram is shown.
2. Mark the capture dump **unorganized** and the sorted library **organized**.
3. (Optional) verify the choice is editable later in source settings.

## US2 — Structured list, grouping, metadata (FR-008/009/010/011)

1. Open the **Inbox**. Verify the list rows are **structured (no pills)**, fit the sidebar, and nothing overflows (check at 1100×720).
2. Group by **target → frame type → filter**; verify nested, collapsible groups; items missing a dimension fall under a clear "none" group.
3. Select a multi-type folder; verify the detail panel shows **per-file metadata** (image type, filter, exposure, binning, gain, temperature, object, date) and an **explicit composition** (e.g. "12 light, 1 master dark") rather than a bare "mixed".
4. Select a calibration **master** (single file); verify it resolves (no "Loading classification…" hang) and shows its master type.

## US3 — Overrides beyond type + multi-select apply-all (FR-013/014/015)

1. Select several files with a blank/wrong **filter**; apply a filter override to the whole selection.
2. Verify every selected file shows the new filter, the reported **count equals the selection size**, and the **breakdown stays visible** and updates.
3. Override **frame type** on some files and confirm it flows into the composition and destinations.
4. Rescan the source; verify overrides **persist** (unchanged files keep their overrides); modify a file and verify its override is surfaced as **stale**.

## US1 — Reviewable plan in-context (FR-001/002/003/004/006/007 + FR-003a)

1. Confirm an item from the **unorganized** source.
2. Verify the item **stays visible as "planned" (greyed)**, and an **in-context plan panel** appears at the bottom of the central area listing the move actions with **destination previews** — and that you were **not** navigated to the Archive page.
3. Verify the files have **not** moved on disk yet.
4. Click **Cancel**; verify the plan is discarded and the item returns to unconfirmed, files untouched.
5. Confirm again, then **Apply**; verify files move to the resolved destinations, an **audit record** is written per action, and the item leaves the queue.
6. Confirm an item, change a source file on disk, then Apply; verify the app **refuses** (stale) rather than moving the changed file.
7. Confirm several items, then **Apply all**; verify all pending plans apply and each action is audited.

## US4 — Move vs catalogue-in-place (FR-017/018/019)

1. Confirm an item from the **organized** source; verify the plan contains **catalogue** actions (no moves), applying it records the files **in place** (no file movement), and the item resolves.
2. Confirm a **mixed-provenance** item (files from both an organized and an unorganized source); verify the plan contains **both** catalogue and move actions (per-file).
3. Confirm a calibration master from the unorganized source; verify it gets a **move plan** and is registered as a master (consistent with lights).

## US5 — Auto-split mixed folders (FR-020)

1. Confirm the mixed light+dark folder; verify the plan contains a **distinct action per frame type** with separate destinations, with **no separate Split step**.

## US6 — Per-type stats (FR-021)

1. View the queue summary; verify it shows **folders/masters/images per type** matching the seeded contents (not a bare "N folders").

## US7 — Archive-vs-Trash control (FR-022/023)

1. Generate a plan with a destructive action; verify a **clearly labelled Archive-vs-System-Trash** control appears in the plan/review surface, defaulting to **Archive**, with its meaning explained.
2. Switch to System Trash; apply; verify destructive files go to the system trash (recoverable), audited.

## Regression / gates

- `cargo test -p app_core inbox`, `-p persistence_db`, `-p fs_planner`, `-p fs_executor` green.
- `cd apps/desktop && npx tsc --noEmit` clean (ignore pre-existing baseUrl deprecation); `npx vitest run src/features/inbox src/features/setup src/features/calibration` green.
- No console errors on the inbox/calibration surfaces (SC-009).
