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

## Iteration 2026-06-21 — Destination model (US8/US9)

1. **Calibration structure**: confirm an unorganized dark/bias/flat and verify the destination uses the per-type pattern (no `unclassified`/`nofilter` target segment) — e.g. darks under `darks/<exposure>/`, flats under `flats/<filter>/<date>/`, masters under `masters/...` with no date.
2. **Per-type pattern config**: edit a type's pattern in Settings, re-confirm, and verify the destination follows the edited pattern; clear it and verify fallback to the built-in default.
3. **Inbox root selection**: with >1 light root registered, confirm an inbox light item and verify a destination-root picker appears and Apply is blocked until a root is chosen.
4. **Single-root auto**: with exactly one calibration root, confirm a calibration item and verify the root is chosen automatically (no prompt).
5. **In-place default**: confirm a non-inbox unorganized item and verify it defaults to its own root.
6. **Full path**: verify each plan action shows the full absolute destination (root + relative).
7. **Missing-attribute gate**: confirm a light frame with no DATE-OBS and verify the plan is blocked and the file is surfaced for input (like missing IMAGETYP); supply the date and verify the gate clears and the destination updates.

## Iteration 2026-06-23 verification scenarios (single-type ingest)

Run on the real desktop app (Windows verify loop: push → pull on `C:\dev\astro-plan` → `run-dev.bat` recompile → verify); drive via tauri-MCP where applicable. Maps to US10–US15 and R-17/R-18. Seed a mixed leaf folder (lights of two filters + darks), a folder missing a mandatory attribute (e.g. lights with no FILTER), and lights with valid RA/DEC pointing.

1. **Single-type sub-grouping at ingest (US10/US13)**: classify a **mixed leaf folder** (lights of two filters + darks). Verify it materializes into **N single-type sub-items** — one per group, e.g. `(root) · dark · …`, `(root) · light · Ha · …`, `(root) · light · OIII · …` — with **zero "mixed" items** in the list. Verify the **provenance tree** shows the parent folder → its children ("ingested together"), and each child carries its `frameType` and group label.
2. **Field-agnostic reclassify, index-only (US11)**: open the **metadata table** for a sub-item and set a **missing** property (e.g. temperature, gain, or target) on one file; then use **bulk "set all per attribute"** to apply a value across the source group. Verify properties already **present in the header are shown read-only** (gap-filling, not rewriting), the generic table accepts arbitrary registry properties, and the **source files on disk are unchanged** (index-only — confirm size + mtime, no header rewrite).
3. **Missing-mandatory gate + re-split (US12 / split-before-confirm)**: classify the folder of **lights with no FILTER** (a missing mandatory attribute). Verify the files land in a per-source-group **"Needs review" sub-item** that **blocks plan creation** (confirm is refused). Supply the missing filter via the metadata editor; verify the inbox **re-runs classification and re-splits** — the needs-review item resolves into proper single-type sub-item(s) and becomes **confirmable**. Confirm splitting happens **before** confirm, never inside plan creation.
4. **Single-type confirm, 1:1 plan (US10)**: confirm a single-type item. Verify it confirms with **one destination root** (a single dropdown; auto-chosen when only one candidate), there is **no split path / no per-type action groups**, and the item↔plan relationship stays **strictly 1:1**.
5. **Coordinate target resolution + project propagation (US15 / R-17)**: open a **light sub-group with RA/DEC** pointing. Verify the app presents **recommended targets ranked by FOV-aware angular proximity** (haversine within a radius from FOCALLEN + pixel size), plus free-text search and manual set — and that the `OBJECT` header is used only as the initial display name, never for matching. Choose a target; verify it becomes the sub-group's canonical target (drives the label) and **auto-propagates to the linked project**.
6. **Sessions as derived inventory — lifecycle drop (US14)**: open the **Sessions** page. Verify there are **no Confirm / Re-open / Reject** review actions and no review-state filter — sessions are **derived and already-confirmed** inventory. Verify the per-file **metadata remains editable** (opening the same metadata table from the session), but with no lifecycle gate.
7. **Rotation warning on flats (R-18)**: confirm a **flat** whose `ROTATANG` deviates from the matching light group's `ROTATANG`. Verify a **warning surfaces** ("rotation differs by X° — flat may not be valid for these lights"). Note: matching is at the group level on the recorded mechanical angle; **manual-rotator drift within a session is not detectable** (ROTATANG stays at the set value), so only the flat-group-vs-light-group deviation can be flagged.

## Regression / gates

- `cargo test -p app_core inbox`, `-p persistence_db`, `-p fs_planner`, `-p fs_executor` green.
- `cd apps/desktop && npx tsc --noEmit` clean (ignore pre-existing baseUrl deprecation); `npx vitest run src/features/inbox src/features/setup src/features/calibration` green.
- No console errors on the inbox/calibration surfaces (SC-009).
