# Quickstart: Per-Frame Inventory with Live Session Membership

**Feature**: 048-per-frame-inventory | **Date**: 2026-07-04

End-to-end validation of the feature once implemented. Assumes the desktop app running (Windows dev loop per project memory) with a test library root.

## Scenario 1 — Inventory is complete and correctly sized (US1)

1. Ingest a folder of **light** frames and a folder of **calibration** (dark/flat/bias) frames through Inbox → confirm → **Apply**.
2. Open the acquisition session → it lists every applied light frame; disk total is non-zero and equals the sum of file sizes.
3. Open the calibration session → it lists every applied calibration frame with real per-frame sizes (previously empty).
4. Verify via `inventory.frame.list { session_id }`: `present_count` and `present_size_bytes` are correct; no frame has `size_bytes = 0`.

## Scenario 2 — External change detected, no files touched (US2)

1. With a session applied, outside the app **delete** one frame and **move** another to a sibling folder under the same root.
2. Trigger `inventory.reconcile.run { root_id, reason: 'on_demand' }` (or reopen the library if on-open is enabled).
3. Flag-missing root (default): both frames show `missing`, remain listed flagged, and present counts/totals drop accordingly.
4. Confirm **no filesystem mutation**: the deleted file is not recreated; nothing else moved/created/deleted by the app.
5. Restore the deleted file → next reconcile flips it back to present (recovered).
6. Set the root to **auto-reconcile**, repeat the delete → the frame is dropped from active membership but its record is retained as `missing` (query shows it with `include_missing: true`).

## Scenario 3 — Relink a moved frame by sha256 (US2/R3)

1. For a `missing` frame whose file you moved, call `inventory.frame.relink { frame_id, candidate_relative_path }` pointing at the moved file.
2. Matching file → `relinked: true` and the record re-homes to the new path (sha256 confirmed on demand).
3. Point at a different same-size frame → `hash.mismatch`, no re-home (proves size is not the key).

## Scenario 4 — Raw sub-frame cleanup, reviewable (US3)

1. Run `cleanup.candidates.scan { scope: { session_id } }`.
2. Individual raw sub-frames appear as candidates grouped by session; `total_reclaimable_bytes` equals the sum of selected present frames' real sizes.
3. Protected frames/categories are absent; `missing` frames are absent.
4. `cleanup.plan.generate { selected_frame_ids }` returns a reviewable plan (archive/trash, `.astro-plan-archive/<planId>/`) with **no** filesystem mutation until explicit Apply.

## Scenario 5 — Per-root config in the wizard (US4)

1. In the setup wizard, add a root → the reconcile-mode + detection-trigger controls appear with documented defaults (flag-missing, live on, symlinks off).
2. Set a removable/network root to **live off** → reconciliation relies on on-demand/scheduled/on-open; app holds no live watch on it.
3. Change an existing root's config in settings → `inventory.root_config.get` reflects it; behavior applies on the next reconcile.

## Scenario 6 — Calibration match awareness (US5)

1. Establish a calibration match, then delete the referenced calibration frame outside the app; reconcile.
2. The match is flagged "source missing / unverifiable" and remains present (not invalidated/removed).
3. Restore the frame → flag clears on next reconcile.

## Gates before closing

- `just lint` / `just test` (per-crate to dodge the workspace-red baseline) / `just typecheck` green.
- `speckit-verify` against FR-001..FR-025 and SC-001..SC-006.
- Real-app: `verify-on-windows` scenario covering Scenarios 1, 2, 4, 5; matching tauri-driver Layer-2 journey + coverage-matrix update.
