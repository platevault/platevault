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
