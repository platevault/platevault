# Contracts: Per-Frame Inventory with Live Session Membership

**Feature**: 048-per-frame-inventory | **Date**: 2026-07-04

Language-neutral operation contracts (Constitution V). Realized as Rust DTOs in `crates/contracts/core`, exposed via Tauri commands, and generated into `packages/contracts` TS bindings (tauri-specta). Command names below are canonical; the registered Tauri fn name MUST match the invoke target exactly (no specta rename on the invoke target — known pitfall). All requests/responses carry the standard result-wrapper + error-code envelope (spec-046 error-code registry).

## Operations

### `inventory.frame.list`
List per-frame inventory entries for a session or root, for surfaces and cleanup.
- **Request**: `{ scope: { session_id } | { root_id }, include_missing?: bool }`
- **Response**: `{ frames: [ { frame_id, root_id, relative_path, frame_type: 'light'|'dark'|'flat'|'bias', size_bytes, state: 'present'|'missing'|'protected', session_id } ], present_count, present_size_bytes }`
- **Notes**: `present_*` exclude `missing`. Read-only.

### `inventory.reconcile.run`
Run a reconciliation pass over a root (on-demand trigger; also invoked internally by live/scheduled/on-open triggers).
- **Request**: `{ root_id, reason: 'on_demand'|'on_open'|'scheduled'|'live_event' }`
- **Response (long-running)**: operation-status stream/handle → `{ scanned, present, newly_missing, recovered, size_backfilled, progress_pct }` then terminal summary.
- **Errors**: `root.unavailable` (e.g., removable drive absent) → frames reported unavailable, NOT deleted. No filesystem mutation under any outcome.

### `inventory.frame.relink`
User-initiated relink of a surfaced missing frame to a candidate file under the same root, confirmed by sha256.
- **Request**: `{ frame_id, candidate_relative_path }`
- **Response**: `{ relinked: bool, matched_hash: string }` on success; `hash.mismatch` error when sha256 differs (no re-home). sha256 computed on demand for exactly the two files involved; never eager, never size/mtime.

### `inventory.root_config.get` / `inventory.root_config.set`
Read/write a root's reconcile mode + detection triggers (spec-018 settings KV under the hood).
- **get Request**: `{ root_id }` → **Response**: `{ reconcile_mode, detection: { live, scheduled, on_open, follow_symlinks } }` (defaults filled when unset).
- **set Request**: `{ root_id, reconcile_mode?, detection?: { live?, scheduled?, on_open?, follow_symlinks? } }` → validated + persisted. Used by the wizard step and root settings.

### `cleanup.candidates.scan` / `cleanup.plan.generate` (extend existing, PR #389)
The two-step D11 flow, now consuming per-frame records.
- **scan Request**: `{ scope: { root_id } | { session_id }, kinds?: ['light','dark','flat','bias'] }`
- **scan Response**: `{ candidates: [ { frame_id, session_id, frame_type, size_bytes, protection, confidence } ], total_reclaimable_bytes }` — grouped by `session_id`; excludes `missing` and `protected`. Read-only.
- **generate Request**: `{ selected_frame_ids }` → **Response**: reviewable plan (spec-017 PlanItem path ops; archive/trash vocab; `.astro-plan-archive/<planId>/` destination). Read-only until explicit Apply; Apply reuses the shared path with the PR #408 overlap guard.

## Events (spec-002 audit event bus)

- `frame.missing` — a recorded frame found absent during reconcile `{ frame_id, root_id, relative_path, reason }`.
- `frame.recovered` — a missing frame found present again.
- `frame.size_backfilled` — a size-0 record corrected `{ frame_id, size_bytes }`.
- `frame.relinked` — user relink succeeded `{ frame_id, from_path, to_path, sha256 }`.
- `calibration_match.source_missing` / `calibration_match.source_recovered` — match flag set/cleared.

All events are records-only; none imply a filesystem mutation.

## Contract invariants

- Every operation that could touch disk is either read-only (list/scan/reconcile) or an explicit, reviewable, user-approved plan Apply (cleanup) — reconciliation is NEVER a mutation (FR-008).
- Errors use the spec-046 error-code registry; `root.unavailable` and `hash.mismatch` are non-destructive terminal states.
- Long-running `inventory.reconcile.run` follows the portable long-running-operation status pattern (Constitution V) and reports progress (SC-005).
