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

> **[SUPERSEDED by the "Iteration 2026-06-23 — single-type ingest contract changes" section below]** — this fixed-field shape (`{ filter?, exposure_s?, binning? }`) is replaced by the field-agnostic property-map + bulk form. Retained for history.

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

> **[SUPERSEDED by the "Iteration 2026-06-23 — single-type ingest contract changes" section below]** — the auto-split-by-frame-type / `action` discriminator semantics are removed (every item is single-type). Retained for history.

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

## Iteration 2026-06-23 — single-type ingest contract changes

Source: `pending-iteration.md` "Contract Deltas" (single-type ingest pivot: A single-type sub-items at ingest, B field-agnostic reclassify, C generalized missing-mandatory gate, D source-group provenance, E lifecycle drop). Same legend (🆕 new · ✳️ changed). All DTOs are specta camelCase; the generated TS surface (`packages/contracts`, tauri-specta `bindings/index.ts`) MUST be regenerated as a follow-up task — no code is generated here.

### ✳️ `inbox.list` → `InboxListItem`
- **ADD** `frameType: string` — always set for classified single-type items.
- **ADD** `sourceGroupId: string`, `groupKey: string`, `groupLabel: string` (D — source-group provenance).
- **ADD** `sourceGroup: { relativePath: string; label: string; siblingCount: u32 }` — provenance, "ingested together".
- **ADD** `missingMandatory: string[]` — per-item rollup of missing mandatory attributes (per-file detail lives in the metadata DTO).
- The existing `group_target` / `group_frame_type` / `group_date` / `group_filter` / `group_exposure` / `group_instrument` display keys become **the item's own per-item facts** (one item = one group); retained for the frontend grouping tree.
- `is_master` / `master_frame_type` unchanged.

### ✳️ `inbox.confirm` → `InboxConfirmRequest` / `Response`
- **REMOVE** the `("split","mixed")` semantics. `action` is **removed** (every item is single-type, so confirm has one unambiguous behavior); a mixed folder yields multiple single-type items rather than a split action.
- `rootId` (optional) = **THE single per-item destination root**. Keep the `destination_root_required` typed error + `candidate_roots` for the >1-candidate flow; per-category root caching removed.
- Response: keep `actions_summary { moveCount, catalogueCount }` and `destinations[]`; drop per-type group semantics.

### ✳️ `inbox.reclassify` → field-agnostic + bulk (source-group scope)
- **REQUEST**: `{ sourceGroupId | inboxItemId, overrides: [ { filePath, properties: Record<string, JsonValue> } ], bulk?: [ { property: string, value: JsonValue, filePaths?: string[] } ] }`.
  - `properties` are validated against the property registry (see `inbox.property_registry`); precedence is **user override > FITS/XISF**.
  - `bulk` applies one value across many files; omitted `filePaths` = all files in the source group.
  - Operates at **source-group scope** (a reclassify re-partitions files into sub-items, so it can split or merge groups).
- **RESPONSE**: the re-materialized sub-items `[ { inboxItemId, groupKey, groupLabel, frameType, fileCount, missingMandatory: string[] } ]`, plus `needsReviewCount`.

### 🆕 `inbox.property_registry`
- Returns the typed property registry so the UI can render a generic, future-proof metadata editor.
- Response: `[ { key, kind, unit, overridable, appliesTo: string[], validation } ]`.

### 🆕 `inbox.target_recommendations` (R-17 coordinate-based target resolution)
- **REQUEST**: `{ inboxItemId | sourceGroupId }` (a light sub-group).
- **RESPONSE**: `{ candidates: [ { targetId, name, separationDeg } ], pointing: { raDeg, decDeg } | null, objectHint: string | null }`.
  - FOV-aware nearest-neighbor ranking by angular separation within the configured radius; empty when no pointing is available. `objectHint` carries the `OBJECT` header for display only — never used for matching/search.
  - The UI also supports free-text search + manual set; the chosen `targetId` is written via `inbox.reclassify` (property `target`).

### ✳️ `inbox.item.metadata` → `InboxFileMetadata`
- ADD the newly extracted per-file fields (all optional), so the metadata table and grouping can display/edit them: `offset`, `setTempC`, `ccdTempC`, `raDeg`, `decDeg`, `rotatorAngleDeg` (`ROTATANG`, mechanical/flat key), `rotatorName` (`ROTNAME`), `skyRotationDeg` (`OBJCTROT`, informational only), `readoutMode`, `focalLengthMm`, `observerLat` / `observerLong` / `observerElev`, `dateLoc`, `dateEnd`, `mjdAvg`.
- **NOTE** — rotation is split into `rotatorAngleDeg` (mechanical, flat-match key) vs `skyRotationDeg` (informational, NOT a flat key). This split MUST stay consistent with the property registry (`rotatorAngleDeg` vs `skyRotationDeg`) and the data-model.

### ✳️ `inbox.missing_path_attributes` (error code)
- Broaden meaning to **missing mandatory (grouping + path) attributes** (no longer path tokens only). Keep the existing **wire code id** for compatibility; the details payload lists per-file missing attributes.

### ✳️ Session contracts (E — lifecycle drop)
- **REMOVE** session review-state operations and fields (`confirm` / `reopen` / `reject`, `reviewFilter`). Sessions expose **derived, already-confirmed inventory** plus an **editable metadata view** (no review lifecycle gate).
