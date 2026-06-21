# Phase 0 Research: Inbox Confirmation & Reviewable Plan Surface

**Feature**: 041-inbox-plan-surface | **Date**: 2026-06-20

Grounded in the existing implementation (cited where relevant). Each item: Decision / Rationale / Alternatives.

## R-1 — Catalogue-in-place action

**Context**: `crates/fs/planner` action kinds today are `Move`, `Archive`, `Trash`, `Delete` (executor `ops/`). There is **no** "record this file where it is, don't move it" action. US4/FR-018 needs cataloguing an organized source's files into the DB with no movement.

**Decision**: Add a new planner action **`Catalogue`** (no source→dest move). At apply time the executor's catalogue op performs **no filesystem mutation**; it signals the app/core apply handler to upsert a `file_record` (and link to session/target/master as appropriate) and write an audit entry "catalogued in place". The plan item's `from_*` = `to_*` (same path) and a distinct `action='catalogue'`.

**Rationale**: Keeps every confirmation — move or catalogue — inside the single reviewable-plan/audit pipeline (Principle II), so cataloguing is also reviewable and audited, and batch-apply/staleness/idempotency reuse works uniformly. Avoids a separate side-channel "register without plan" path (today's master path is exactly that side channel and is the inconsistency US4 removes).

**Alternatives**: (a) Skip plans for organized sources and write `file_record` directly on confirm — rejected: invisible, inconsistent with US1, re-creates the master side-channel. (b) Model catalogue as a zero-distance `Move` — rejected: conflates with real moves, complicates staleness/audit semantics and destination preview.

## R-2 — Per-file metadata persistence

**Context**: `RawFileMetadata` (`crates/metadata/core/src/lib.rs:210`) has 13 fields (image_typ, filter, object, exposure, gain, x/y_binning, naxis1/2, instrume, telescop, date_obs, stack_count) but is **extracted transiently during classify and discarded**; only `inbox_classification_evidence.frame_type` (+ raw_value) is stored. US2/FR-010 needs these surfaced, and US3 needs them as override baselines and for grouping (US2/FR-009 groups by filter/exposure/date).

**Decision**: Persist per-file metadata in a new table **`inbox_file_metadata`** keyed 1:1 to `inbox_classification_evidence` (by evidence id / `(inbox_item_id, relative_file_path)`), written during `classify`/`reclassify`. Columns mirror the surfaced set: filter, exposure_s, gain, binning (x/y), object, temperature, date_obs, instrume, telescop, naxis1/2, stack_count.

**Rationale**: A dedicated table keeps the evidence row lean, matches the existing 1-row-per-file evidence model, and lets grouping/stat queries read metadata without re-extraction. Extraction already happens in classify — persisting is cheap and avoids re-reading headers in the detail panel.

**Alternatives**: (a) Widen `inbox_classification_evidence` with ~10 columns — rejected: bloats the classification row and mixes concerns. (b) Re-extract on demand when the detail panel opens — rejected: re-reads headers repeatedly, slow for large folders, and can't back grouping/stats.

## R-3 — Non-type override schema

**Context**: Override today = `inbox_classification_evidence.manual_override` (frame_type only, `UNIQUE(inbox_item_id, relative_file_path)`; reclassify takes `{file_path, frame_type}`). US3/FR-013 needs overriding filter, exposure, binning (and ideally more).

**Decision**: Add nullable **override columns** to `inbox_classification_evidence`: `override_filter`, `override_exposure_s`, `override_binning` (and keep the existing frame-type `manual_override`). The *effective* value of a field is `override_* ?? persisted_metadata`. Extend the reclassify contract to carry an optional per-field override set per file (not just frame_type). The detail panel and destination resolution read effective values.

**Rationale**: Co-locating overrides on the evidence row (already 1:1 with the file, already path-keyed) is the smallest change and keeps the "effective value" computation local. Mirrors how `manual_override` already overrides `frame_type`.

**Alternatives**: (a) Generic `(evidence_id, field, value)` override table — rejected: over-engineered for a fixed small field set; harder to query for destination resolution. (b) Allow arbitrary header overrides — deferred: out of scope; the fixed set (type/filter/exposure/binning) covers the stated need.

## R-4 — Override identity (persistence across rescan) under the lazy-hashing constraint

**Context**: Clarification: overrides must **persist across rescans, keyed to file content**, invalidated only when the file changes. But the Constitution requires large-file hashing to stay **optional/lazy**, and `content_signature` today is folder-level + path-based (`crates/app/core/src/inbox/signature.rs`), not per-file content hashing.

**Decision**: Key override persistence to **`relative_file_path` + a cheap per-file identity (size + mtime)** stored alongside the evidence/metadata row. On rescan, an override re-applies if the file at the same path still has the same size+mtime; if size/mtime changed, the override is marked stale (surfaced, not silently kept). No full-content hash is computed.

**Rationale**: Satisfies "keyed to file content" in the practical sense (re-applies unless the file changed) **without** eager content hashing — honoring the lazy-hashing product constraint. Size+mtime is the same cheap-identity signal the executor already uses for plan staleness (`approved_mtime`/`approved_size_bytes`, CAS check), so it's consistent and proven.

**Alternatives**: (a) Full content hash per file — rejected: violates the optional/lazy-hashing constraint and is expensive for large FITS. (b) Path-only keying — rejected: a replaced-but-same-name file would silently inherit a wrong override.

## R-5 — In-context plan surface vs Archive page

**Context**: Plans exist (`plans`/`plan_items`, state machine, `inbox_plan_links` table from migration 0020 links plans↔inbox items). Today confirm's toast navigates to `/archive`; the Archive page (`features/archive/`) renders plan detail. US1/FR-003/FR-004 require reviewing the plan **in-context** within the inbox surface (no navigation away).

**Decision**: Reuse the existing plan/executor/audit backend unchanged; add an **in-context plan panel** at the bottom of the inbox central detail that lists the selected/planned item's plan actions (resolved via `inbox_plan_links`), with Apply/Cancel and an "apply all pending" affordance. Keep the Archive page as the global plan history; remove the confirm→/archive navigation. Planned inbox items render greyed with a "planned" badge (state `plan_open`).

**Rationale**: The plan machinery is sound; only the *surfacing* is wrong. Linking by `inbox_plan_links` lets the inbox show exactly the plan(s) for an item without a new backend. Minimizes risk and reuses staleness/audit/apply.

**Alternatives**: (a) Build a parallel inbox-only plan store — rejected: duplicates the audited plan system, splits the source of truth. (b) Keep navigating to Archive — rejected: violates FR-004.

## R-6 — Per-type statistics query

**Context**: `list_unacknowledged_across_roots` (`repositories/inbox.rs:531`) returns items but no per-type aggregation. `inbox_classification_breakdown` holds per-item per-type counts; `inbox_items.is_master_item`/`master_frame_type` mark masters. US6/FR-021 needs folders/masters/images per type across the queue.

**Decision**: Add a dedicated aggregate query (e.g. `inbox_stats_per_type`) that, across unacknowledged items, sums: folders per frame type, master count per frame type, and image (file) count per frame type — joining `inbox_items` + `inbox_classification_breakdown` (images/type) and counting `is_master_item` rows by `master_frame_type` (masters/type). Expose as a small stats DTO consumed by the queue summary.

**Rationale**: Reuses the already-maintained breakdown rows (no re-classification); a single aggregate query is cheap and keeps the list query unchanged.

**Alternatives**: compute in the frontend from the list payload — rejected: the list is capped (~500) and doesn't carry full per-file breakdown, so counts would be wrong/truncated.

## R-7 — Organization-state migration, default, and wizard placement

**Context**: `registered_sources` (migration 0006/0032) has `kind` (`light_frames|calibration|project|inbox`), `kind_subtype`, `scan_depth`, etc., but **no organization state**. Clarification: explicit per-source field, chosen at add-time for non-inbox sources (no silent default), `inbox` = unorganized; changeable later; explained in the wizard with a flow diagram.

**Decision**: Migration `0045` adds `registered_sources.organization_state TEXT NOT NULL DEFAULT 'unorganized' CHECK (organization_state IN ('organized','unorganized'))`. For **existing rows** at migration time, backfill: `inbox`-kind → `unorganized`; all other existing kinds → `organized` (existing libraries are assumed already-organized — the safe, custody-preserving backfill). For **new** non-inbox sources the UI forces an explicit choice (does not rely on the column default); `inbox` sources are set `unorganized` automatically. The choice is editable later via source settings and affects only future confirms.

**Rationale**: A NOT NULL column with a safe backfill avoids nullable ambiguity; backfilling existing non-inbox sources to `organized` honors Local-First custody (don't propose moving someone's existing library on upgrade). Forcing the choice in the UI (not via DB default) satisfies the "no silent default" clarification while keeping the schema simple.

**Alternatives**: (a) Reuse `kind_subtype` to encode it — rejected: overloads a field with unrelated meaning. (b) Nullable column meaning "unknown" — rejected: creates an ambiguous state the confirm path would have to special-case.

## R-8 — Auto-split + per-file provenance plan generation

**Context**: Spec 005 had a separate "split" step; US5/FR-020 folds split into confirm. The mixed-provenance clarification requires per-file move-vs-catalogue.

**Decision**: `confirm` builds plan actions by iterating the item's evidence rows: group files by **effective frame type** (→ one move/catalogue action group per type, each with its pattern-resolved destination), and within that decide **per file** by its source's `organization_state` (organized → `Catalogue`, unorganized → `Move`). A single confirm thus yields a plan that may contain multiple typed groups and a mix of `Move` and `Catalogue` actions. No separate user "split" action.

**Rationale**: Directly satisfies US5 (auto-split) and US4 mixed-provenance (per-file) with one pass over evidence, reusing `resolve_v1` for destinations. Keeps the user gesture to a single "Confirm".

**Alternatives**: keep an explicit Split command — rejected by clarification; redundant once confirm groups by type.

## Cross-cutting notes

- **Generated bindings are authoritative** (memory: tauri-specta/IPC casing): all new DTO fields are defined in Rust contracts and surfaced via regenerated `bindings/index.ts`; the frontend reads the generated camelCase shape (do not hand-edit `@/bindings/types`).
- **Windows verify loop**: each backend change requires push→pull→recompile→verify on the Windows app (stale-binary risk).
- **Workspace test breakage**: validate with `-p <crate>`, not `cargo test --workspace`.
- **Destination preview** (FR-024) reuses `resolve_v1`; the breakdown's `destination_preview` column can now be populated at classify/confirm time from the active pattern instead of the current `None`.
