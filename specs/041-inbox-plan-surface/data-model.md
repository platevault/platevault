# Phase 1 Data Model: Inbox Confirmation & Reviewable Plan Surface

**Feature**: 041-inbox-plan-surface | **Date**: 2026-06-20

Schema deltas are additive in a single migration **`0045_inbox_plan_surface.sql`** (current head is 0044). Existing tables referenced: `registered_sources` (0006/0032), `inbox_items`/`inbox_classifications`/`inbox_classification_evidence`/`inbox_classification_breakdown`/`inbox_plan_links` (0020+0042/0043), `plans`/`plan_items` (planner), `file_record` (0002).

## Entities

### Source organization state (extends `registered_sources`)

A per-source flag deciding move-vs-catalogue, **orthogonal** to `kind`.

| Field | Type | Notes |
|---|---|---|
| `organization_state` | TEXT NOT NULL | `'organized'` (catalogue in place) \| `'unorganized'` (propose move plan). Default `'unorganized'` at DDL; UI forces explicit choice for non-inbox sources; `inbox` kind always `'unorganized'`. |

- **Backfill (existing rows)**: `inbox` kind → `unorganized`; all other kinds → `organized` (existing libraries assumed already organized — custody-safe).
- **Mutable**: editable via source settings; affects only future confirms.
- **Validation**: CHECK constraint on the two values.

### File metadata record (new table `inbox_file_metadata`)

Persisted per-file header metadata (1:1 with an evidence row), surfaced for review/override/grouping.

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `inbox_item_id` | TEXT NOT NULL FK → inbox_items(id) | |
| `relative_file_path` | TEXT NOT NULL | matches `inbox_classification_evidence.relative_file_path` |
| `filter` | TEXT NULL | FILTER |
| `exposure_s` | REAL NULL | EXPTIME/EXPOSURE seconds |
| `gain` | TEXT NULL | GAIN |
| `binning_x` | INTEGER NULL | XBINNING |
| `binning_y` | INTEGER NULL | YBINNING |
| `temperature_c` | REAL NULL | CCD/sensor temp |
| `object` | TEXT NULL | OBJECT (target) |
| `date_obs` | TEXT NULL | ISO/FITS datetime |
| `instrume` | TEXT NULL | camera |
| `telescop` | TEXT NULL | telescope |
| `naxis1` | INTEGER NULL | width |
| `naxis2` | INTEGER NULL | height |
| `stack_count` | INTEGER NULL | STACKCNT/NCOMBINE |
| `file_size_bytes` | INTEGER NULL | cheap identity for override staleness (R-4) |
| `file_mtime` | TEXT NULL | cheap identity for override staleness (R-4) |

- **Constraint**: `UNIQUE(inbox_item_id, relative_file_path)`.
- **Lifecycle**: upserted during classify/reclassify; rows for a removed file are pruned on rescan.

### Override (extends `inbox_classification_evidence`)

Effective value of a field = `override_* ?? metadata`. Existing `manual_override` (frame_type) is retained.

| Field | Type | Notes |
|---|---|---|
| `override_filter` | TEXT NULL | user filter correction |
| `override_exposure_s` | REAL NULL | user exposure correction |
| `override_binning` | TEXT NULL | user binning correction (e.g. `"2x2"`) |
| `override_stale` | INTEGER NOT NULL DEFAULT 0 | set when file size/mtime changed since override (R-4) |

- Existing `manual_override` continues to override `frame_type`.
- **Identity / persistence**: overrides survive rescan while the file's `(relative_file_path, file_size_bytes, file_mtime)` is unchanged; otherwise `override_stale=1` and the override is surfaced as stale, not silently applied.

### Plan catalogue action (extends planner / `plan_items.action`)

| Value | Notes |
|---|---|
| `action = 'catalogue'` | New action: no FS move. `from_*` = `to_*` (file stays). At apply, upserts `file_record` + links, writes audit "catalogued in place". `requires_destructive_confirm = 0`. |

- Existing actions (`move`/`archive`/`trash`/`delete`) unchanged.
- A single inbox confirm MAY produce a plan mixing `move` and `catalogue` items (per-file provenance, R-8).
- Plan↔item linkage via existing `inbox_plan_links`.

### Per-type stats (query/view, no new table)

Aggregate over unacknowledged items:

| Field | Meaning |
|---|---|
| `frame_type` | light/dark/bias/flat/dark_flat (+ `unclassified`) |
| `folder_count` | folders containing this type |
| `master_count` | `is_master_item` rows with this `master_frame_type` |
| `image_count` | files of this type (from `inbox_classification_breakdown.count`) |

Backed by `inbox_classification_breakdown` + `inbox_items` (no re-classification).

## State transitions (inbox item)

Existing states: `pending_classification → classified → plan_open → resolved`.

- **Confirm (unorganized provenance present)** → plan created (`inbox_plan_links`), item → `plan_open`, **stays visible as "planned"** (US1/FR-002). Item → `resolved` only after the plan is **applied**.
- **Confirm (all files organized)** → catalogue plan (all `catalogue` actions); applying it records `file_record`s in place; item → `resolved`. (Still a reviewable plan per US1; no FS move.)
- **Cancel plan** → plan discarded, item returns to `classified`.
- **Stale** (source files changed pre-apply) → apply refused/paused (executor CAS), surfaced for regeneration (FR-007).

## Validation & invariants

- `organization_state` ∈ {organized, unorganized}; `inbox` kind ⇒ unorganized.
- Effective frame type / filter / exposure / binning = override if present (and not stale) else extracted metadata.
- Overrides never write to user files (app-side only — FR-016).
- Catalogue action performs no filesystem mutation; only DB + audit.
- A confirm's plan destinations come from `resolve_v1(active_pattern, effective_metadata)`.

## Migration 0045 summary (DDL intent)

1. `ALTER TABLE registered_sources ADD COLUMN organization_state TEXT NOT NULL DEFAULT 'unorganized' CHECK (organization_state IN ('organized','unorganized'));`
2. Backfill `organization_state` for existing rows (inbox→unorganized, others→organized).
3. `CREATE TABLE inbox_file_metadata (...)` with `UNIQUE(inbox_item_id, relative_file_path)`.
4. `ALTER TABLE inbox_classification_evidence ADD COLUMN override_filter TEXT; ... override_exposure_s REAL; ... override_binning TEXT; ... override_stale INTEGER NOT NULL DEFAULT 0;`
5. Extend `plan_items.action` CHECK to include `'catalogue'` (recreate-table migration pattern as SQLite requires for CHECK changes).

## Iteration 2026-06-21: Destination model

New / changed data:

- **Per-type destination pattern settings**: a stored token pattern per type (light, flat, master-flat, bias, master-bias, dark, master-dark) with built-in defaults; lives in the settings table/use-case. Invalid/empty → built-in default. (FR-025/FR-026/FR-026b)
- **Confirm/plan request — destination root**: `inbox_confirm` request gains an optional destination `root_id`. Resolution: non-inbox default = source's own root (in place); inbox = required chosen root; >1 candidate root for the frame type = required selection; exactly one = auto. (FR-027–FR-030)
- **Candidate-root resolution**: derive valid destination roots for a frame type from `registered_sources` (by kind/type); optional future per-type "primary/default root" concept for auto-select.
- **Classification — missing path attributes**: classification surfaces a per-file `missing_path_attributes` set (the path-load-bearing attributes absent for that file's resolved type); plan generation is rejected while non-empty. (FR-032/FR-033)
- **Plan/preview — absolute destination**: plan actions carry the absolute destination (`registered_sources.path` + relative), not just the relative path. (FR-031)

## Iteration 2026-06-23: Single-type sub-items at ingest (Pivot)

New migration **`0049_inbox_single_type.sql`** (renumbered from 0048 during the redesign-ui-platevault merge — 0048 was already taken by `0048_target_notes.sql`; **0046 + 0047 already taken** by `0046_session_canonical_target.sql` + `0047_target_constellation_magnitude.sql` — the latter renamed by PR #317 to resolve the dual-0046). Changes the inbox unit of work from one-row-per-leaf-folder to **one row per single-type group within a leaf folder**, adds source-group provenance, replaces fixed override columns with a generic per-file override table, broadens the missing-metadata gate, adds extended extracted metadata, and drops the session review lifecycle. References research decisions R-9…R-18.

### Source group (new table `inbox_source_groups`)

A leaf folder's provenance record ("ingested together"). One row per discovered leaf folder; each holds N single-type `inbox_items` after classify. (R-12)

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `root_id` | TEXT NOT NULL FK → registered_sources | library root (separate from relative path — Constitution I) |
| `relative_path` | TEXT NOT NULL | leaf folder path relative to root |
| `discovered_at` | TEXT NOT NULL | first scan time |
| `last_scanned_at` | TEXT NOT NULL | most recent rescan |
| `content_signature` | TEXT NULL | folder-level signature (partial 65 KB read, `signature.rs`); cheap, no eager hashing (Constitution: lazy hashing) |
| `format` | TEXT NULL | dominant file format of the folder (fits/xisf/video) |
| `lane` | TEXT NULL | move-vs-catalogue lane (derived from source `organization_state`) |
| `child_count` | INTEGER NOT NULL DEFAULT 0 | number of single-type sub-items materialized from this group |

- **Constraint**: `UNIQUE(root_id, relative_path)`.
- **Lifecycle**: written at scan (one row per leaf folder, alongside individual master items as today); `content_signature`/`last_scanned_at` refreshed on rescan; `child_count` updated when classify (re)materializes children.

### Single-type sub-item (alters `inbox_items`)

Each `inbox_item` is now one homogeneous frame-type group within a source group (e.g. `(root) · dark · -10°C · 300s`), replacing the folder-level item. (R-9, R-11)

| Field | Type | Notes |
|---|---|---|
| `source_group_id` | TEXT NULL FK → inbox_source_groups(id) | parent provenance; NULL only for legacy `plan_open` rows during migration |
| `group_key` | TEXT NOT NULL | deterministic canonical serialization of the normalized/bucketed identity tuple (fixed order from the R-9 recipe; missing dims render an explicit sentinel, e.g. `filter=∅`). Needs-review bucket uses a reserved sentinel key. |
| `group_label` | TEXT NULL | display label `"(root) · <type> · <discriminating dims>"` (R-12); for lights the canonical resolved target name (R-17), not the raw OBJECT string |
| `frame_type` | TEXT NULL | **authoritative** per-item frame type; always set when `result = 'classified'`; NULL for `pending_classification`/needs-review |

- **`content_signature`** semantics change: now **per-sub-group** = `folder_signature(sorted(per-file sigs of files in that group))`, reusing `signature.rs` primitives (R-11). The source group keeps the folder-level signature.
- **Identity constraint**: replace `UNIQUE(root_id, relative_path)` (`0020_inbox.sql`) → **`UNIQUE(root_id, relative_path, group_key)`** (composite identity `(root_id, relative_path, group_key)`). Requires the SQLite table-rebuild migration pattern.
- **Stability**: group keys are deterministic from (normalized metadata + recipe), so rescans of unchanged content produce identical keys (items don't churn). A file whose metadata/override changes moves groups — correct churn, surfaced via `override_stale`.

### Generic per-file override (new table `inbox_file_overrides`)

Replaces the fixed `override_filter/override_exposure_s/override_binning` columns on `inbox_classification_evidence`. Overrides now **re-partition** files into sub-items, so they are keyed at source-group + file + property granularity (NOT at sub-item id, which may be created/destroyed by the override). (R-13)

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `source_group_id` | TEXT NOT NULL FK → inbox_source_groups(id) | persistence anchor that survives re-partitioning |
| `relative_file_path` | TEXT NOT NULL | file within the source group |
| `property_key` | TEXT NOT NULL | key from the property registry (R-13), e.g. `filter`, `temperatureC`, `gain`, `frameType`, `target` |
| `value` | TEXT NOT NULL | user-provided value (typed per registry; stored as text/JSON) |
| `file_size_bytes` | INTEGER NULL | cheap identity for override staleness (R-4) |
| `file_mtime` | TEXT NULL | cheap identity for override staleness (R-4) |
| `override_stale` | INTEGER NOT NULL DEFAULT 0 | set when file size/mtime changed since override (R-4) |
| `set_at` | TEXT NOT NULL | when the override was recorded |

- **Constraint**: `UNIQUE(source_group_id, relative_file_path, property_key)`.
- **Precedence**: user override **>** FITS/XISF value (R-13). Overrides are app-side INDEX metadata only and are **never** written back to FITS/XISF files (Constitution I).
- **Editing semantics**: fills only MISSING/unreadable properties (header is authoritative); correcting a present-but-wrong frame type is the one exception (the retained `manual_override` "correct classification" action).
- **Data migration**: existing `inbox_classification_evidence.override_filter` / `override_exposure_s` / `override_binning` / `manual_override` values migrate into `inbox_file_overrides` rows (property keys `filter`/`exposureS`/`binning`/`frameType`); those columns are then dropped. Staleness keying (size+mtime) carries over.

### Per-sub-item classification (alters `inbox_classifications`)

- `inbox_classifications` becomes **per-sub-item** (one classification per single-type item).
- `result` CHECK collapses: `CHECK (result IN ('classified','unclassified'))` — **`'mixed'` is dropped** as a terminal result. A mixed folder simply yields multiple single-type items; an item missing mandatory attributes (incl. unclassifiable frame type) lands in the per-source-group **needs-review** sub-item (sentinel group key) which blocks plan creation until resolved via reclassify. (R-14, R-15)

### Extended extracted metadata (alters `inbox_file_metadata`)

New per-file fields added to support the R-9 grouping recipe and R-18 semantics. None were extracted before (FITS reader read only the 13 core fields); until a dimension is extracted it behaves as best-effort ("(unknown)" bucket + warning, does not block). **All nullable.** (R-9 gap, R-13 registry, R-18)

| Field | Type | FITS keyword → fallback | Notes |
|---|---|---|---|
| `offset` | INTEGER NULL | `OFFSET` / `BLKLEVEL` | grouping dim for all 4 types |
| `set_temp_c` | REAL NULL | `SET-TEMP` | dark grouping (default temp source) |
| `ccd_temp_c` | REAL NULL | `CCD-TEMP` → `DET-TEMP` (DWARF III) | deviation-warning source |
| `ra_deg` | REAL NULL | `RA` (decimal, preferred) ← `OBJCTRA` (sexagesimal→decimal) | light pointing + R-17 target resolution |
| `dec_deg` | REAL NULL | `DEC` (decimal, preferred) ← `OBJCTDEC` (sexagesimal→decimal) | light pointing + R-17 |
| `rotator_angle_deg` | REAL NULL | `ROTATANG` (= `ROTATOR`, mechanical) | flat↔light match key, light grouping (tolerant); may be absent (R-18) |
| `rotator_name` | TEXT NULL | `ROTNAME` | device id; informational |
| `sky_rotation_deg` | REAL NULL | `OBJCTROT` (sky PA) | informational only — NOT a flat key (R-18) |
| `readout_mode` | TEXT NULL | `READOUTM` | optional grouping dim, default OFF |
| `focal_length_mm` | REAL NULL | `FOCALLEN`; XISF `Instrument:Telescope:FocalLength`×1000 | optic-train composite (light+flat) |
| `pixel_size_um` | REAL NULL | `XPIXSZ` / `PIXSIZE`; XISF `Image:PixelSize` | feeds the FOV-aware target radius (R-17) together with `focal_length_mm` + `naxis1/2` |
| `observer_lat` | REAL NULL | `SITELAT` → `OBSGEO-B` → `LAT-OBS` | future grouping only |
| `observer_long` | REAL NULL | `SITELONG` → `OBSGEO-L` → `LONG-OBS` | future grouping; prerequisite for UTC-fallback night binning |
| `observer_elev` | REAL NULL | `SITEELEV` → `OBSGEO-H` → `ALT-OBS` | future grouping only |
| `date_loc` | TEXT NULL | `DATE-LOC` (local) | observing-night = local calendar date under noon boundary (no longitude needed); R-18 |
| `date_end` | TEXT NULL | `DATE-END` | dark-run span heuristic |
| `mjd_avg` | REAL NULL | `MJD-AVG` (exposure midpoint, NINA 3.2+) | ordering / dark-run span / UTC math (preferred) |
| `mjd_obs` | REAL NULL | `MJD-OBS` (exposure start) | ordering / dark-run span fallback |

### Sessions — lifecycle drop (E)

Reverse the planned session **review lifecycle** (spec 045). Acquisition + calibration sessions become **derived, already-confirmed inventory** (like calibration masters today). (R-16)

- **Remove** the review-state columns and their transitions from the acquisition/calibration session model: the `discovered / candidate / needs_review / confirmed / rejected` states, the Confirm/Re-open/Reject affordances, and the type-aware review predicate. Reduces the spec 006 six-state `SessionState`.
- `session_key` is deterministic once per-file metadata is fixed at inbox confirm — nothing remains to review.
- Sessions expose **derived, confirmed inventory + an editable metadata view only**; editing re-opens the same per-file metadata/override table (`inbox_file_overrides` / `inbox_file_metadata`) that defines the session, with no lifecycle gate.
- **Cross-spec**: obsoletes most of spec **045-review-state-real** (mark superseded) and reduces spec **006** `SessionState`. Run `/speckit.sync.conflicts` after apply. Constitution boundary intact (reviewable plans retained; no image processing; durable DB audit retained).

## Migration 0048 summary (DDL intent)

1. `CREATE TABLE inbox_source_groups (...)` with `UNIQUE(root_id, relative_path)`.
2. Rebuild `inbox_items` (SQLite table-rebuild pattern, required for the UNIQUE change): add `source_group_id`, `group_key`, `group_label`, `frame_type`; change `content_signature` to per-sub-group; replace `UNIQUE(root_id, relative_path)` → `UNIQUE(root_id, relative_path, group_key)`.
3. `CREATE TABLE inbox_file_overrides (...)` with `UNIQUE(source_group_id, relative_file_path, property_key)`.
4. Rebuild `inbox_classifications` to collapse the `result` CHECK to `('classified','unclassified')` (drop `'mixed'`).
5. `ALTER TABLE inbox_file_metadata` add the extended extracted fields (`offset`, `set_temp_c`, `ccd_temp_c`, `ra_deg`, `dec_deg`, `rotator_angle_deg`, `rotator_name`, `sky_rotation_deg`, `readout_mode`, `focal_length_mm`, `pixel_size_um`, `observer_lat`/`_long`/`_elev`, `date_loc`, `date_end`, `mjd_avg`, `mjd_obs`) — all nullable.
6. Remove the session review-state columns/transitions from the session model (lifecycle drop, E).
7. Data migration of `inbox_classification_evidence.override_*` / `manual_override` into `inbox_file_overrides` rows; then drop those columns.

### Migration 0048 re-derivation approach (RQ6)

Re-derivation is **filesystem-free** because per-file metadata is already persisted (`inbox_file_metadata`):

1. For each existing folder-level `inbox_items` row → create an `inbox_source_groups` row (copy `root_id`, `relative_path`, `content_signature`, `format`, `lane`).
2. Partition the folder's persisted evidence + metadata by the R-9 recipe → insert child single-type `inbox_items` (with `group_key`/`group_label`/`frame_type` and the per-sub-group signature). Folders never classified (no persisted metadata) → one `pending_classification` child that splits on next classify.
3. Migrate `override_*` / `manual_override` columns → `inbox_file_overrides` rows (keyed by source group + file + property).
4. **`plan_open` items are NOT re-split** (a plan is linked 1:1 via `inbox_plan_links`). Keep such an item as a single legacy sub-item (with `source_group_id` possibly NULL) carrying its plan link until the plan resolves/discards; re-derivation into sub-items happens on the next classify after the plan closes. (Safe path; documented.)

## Validation & invariants (Iteration 2026-06-23)

- **Item↔plan is strictly 1:1** — the `inbox_plan_links` PK is preserved; satisfied structurally now that one type ⇒ one plan (the `("split","mixed")` confirm branch is deleted, R-15).
- **Composite item identity** = `(root_id, relative_path, group_key)`; `group_key` is deterministic from normalized/bucketed metadata + the active R-9 recipe.
- A plan is created **only from a fully-resolved single-type sub-item**; an item carrying any missing mandatory attribute (grouping ∪ path tokens, R-14) cannot create a plan and `inbox.confirm` rejects it (broadened `missing_path_attributes`). Splitting/recalculating happens **before** confirm, never inside plan creation.
- **One `rootId` per single-type item** (the per-item destination); multi-candidate-root flow retained, multi-category root caching removed (R-15).
- Override precedence (user > FITS) and "never write to user files" (Constitution I) carry forward; overrides are index-only.
