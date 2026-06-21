# Phase 1 Contracts: Inbox Confirmation & Reviewable Plan Surface

**Feature**: 041-inbox-plan-surface | **Date**: 2026-06-20

Language-neutral operation contracts (Principle V). These map to Tauri commands via `tauri-specta`; the **generated `bindings/index.ts` is authoritative** (camelCase). New fields are additive on existing DTOs where possible. Errors use the existing `ContractError { code, message, severity, retryable }` envelope.

Legend: 🆕 new operation · ✳️ changed/extended existing operation.

## Sources

### ✳️ `sources.register` / `sources.register_batch`
Add **`organization_state`** to the per-source request.
- Request (per source): `{ kind, path, scan_depth, organization_state: 'organized' | 'unorganized' }`
  - `inbox` kind MUST be `unorganized`; non-inbox sources MUST supply an explicit value (UI-enforced).
- Response: unchanged shape; the persisted source now carries `organization_state`.
- Errors: `source.invalid_organization_state` if `inbox` kind is sent as `organized`.

### 🆕 `sources.set_organization_state`
Change a source's organization state after registration (affects only future confirms).
- Request: `{ source_id, organization_state }`
- Response: `{ source_id, organization_state }`
- Errors: `source.not_found`; `source.invalid_organization_state`.

### ✳️ `sources.list`
Each returned source includes `organization_state`.

## Inbox — review surface

### ✳️ `inbox.list` (`list_unacknowledged_across_roots`)
Each item gains the source's `organization_state` (so the list can show move-vs-catalogue intent) and the effective per-type composition needed for grouping/labels. No breaking changes.

### 🆕 `inbox.item.metadata`
Per-file metadata for the selected item's files (US2/FR-010), reading persisted `inbox_file_metadata` + effective overrides.
- Request: `{ inbox_item_id }`
- Response: `{ inbox_item_id, files: [ { relative_file_path, frame_type_effective, image_typ, filter, exposure_s, gain, binning_x, binning_y, temperature_c, object, date_obs, instrume, telescop, naxis1, naxis2, stack_count, is_master, override_stale } ] }`
  - `*_effective` reflects override-if-present-else-extracted.
- Errors: `inbox.item.not_found`.

### 🆕 `inbox.stats`
Per-type queue breakdown (US6/FR-021).
- Request: `{}` (across all unacknowledged roots)
- Response: `{ per_type: [ { frame_type, folder_count, master_count, image_count } ], totals: { folders, masters, images } }`

## Inbox — overrides

### ✳️ `inbox.reclassify`
Extend overrides beyond frame type and support multi-file scope (US3/FR-013/FR-014).
- Request: `{ inbox_item_id, overrides: [ { file_path, frame_type?, filter?, exposure_s?, binning? } ] }`
  - Any subset of fields may be set per file; omitted fields are left unchanged.
  - A multi-select apply-to-all expands to one entry per selected file (the count reported back equals the number of files).
- Response: `{ inbox_item_id, updated_type, applied_count, breakdown: [...] }`
  - `applied_count` MUST equal the number of files whose overrides were applied (FR-014); `breakdown` is rebuilt (FR-015).
- Errors: `inbox.file.not_found_in_evidence` (path not in the item's evidence — must match the item, no cross-item leakage).
- Notes: overrides persist keyed to `(relative_file_path, size, mtime)` (R-4); a file whose size/mtime changed since override returns it as `override_stale`.

## Inbox — confirm & plan

### ✳️ `inbox.confirm`
Confirm now produces a plan whose actions are decided **per file by the source's organization_state**, auto-splitting by frame type (US4/US5/FR-017/FR-020).
- Request: `{ inbox_item_id, content_signature, destructive_destination?: 'archive' | 'os_trash' }`
  - (No `action` discriminator needed for the move/catalogue split — it's derived from organization_state.)
- Response: `{ inbox_item_id, plan_id, plan_state, items_total, actions_summary: { move, catalogue }, registered_as_master }`
  - The item moves to `plan_open` and **stays visible as planned** (FR-002). `actions_summary` lets the UI show "N move / M catalogue".
- Errors: `classification.stale` (signature mismatch — rescan); `inbox.has.open.plan`.

### 🆕 `inbox.plan` (in-context)
Fetch the plan(s) linked to an inbox item for the in-context plan panel (US1/FR-003/FR-004) — reads via `inbox_plan_links`.
- Request: `{ inbox_item_id }`
- Response: `{ plan_id, state, actions: [ { index, action: 'move'|'catalogue'|'archive'|'trash', from_path, to_path, destination_preview, requires_destructive_confirm } ] }`

### 🆕 `inbox.plan.apply` / 🆕 `inbox.plan.apply_all`
Explicit apply (FR-003/FR-003a) reusing the existing executor/audit/CAS pipeline.
- `apply`: `{ plan_id }` → `{ plan_id, state, applied, failed, skipped }`
- `apply_all`: `{}` → applies all pending planned items; `{ results: [ { plan_id, state, applied, failed, skipped } ] }`; each action individually audited.
- Errors: `plan.stale` (CAS mismatch — refuse/pause, FR-007); `plan.volume_unavailable`; `plan.disk_full`.

### ✳️ `inbox.plan.cancel` (reuse `plans.discard`)
Cancel a planned item's plan before apply (FR-006): `{ plan_id }` → `{ plan_id, state: 'discarded' }`; item returns to `classified`, no files moved.

## Contract test intentions (for /speckit.tasks)

- Confirm from an **organized** source → plan contains only `catalogue` actions; no file moves; applying records `file_record`s in place.
- Confirm from an **unorganized** source → plan contains `move` actions with pattern-resolved destinations.
- Confirm a **mixed-provenance** item → plan contains both `move` and `catalogue` items (per-file).
- Confirm a **mixed-type** folder → one action group per frame type (auto-split).
- `inbox.reclassify` with multi-file filter override → `applied_count` equals selection; effective filter updated; breakdown stays.
- Override persists across a rescan with unchanged file; goes `override_stale` when size/mtime changes.
- `inbox.plan.apply` refuses a stale plan (CAS) instead of moving changed files.
- `inbox.stats` per-type counts equal the seeded fixture.
- `sources.register` rejects `inbox` kind with `organized`.
