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

## Iteration 2026-06-21: Destination model

### Decision — per-type destination patterns (FR-025/FR-026)

Today one light template (`{target}/{filter}/{date}/{frametype}/`) is applied to every frame, producing nonsensical calibration paths like `unclassified/nofilter/undated/dark/`. Decision: a **distinct, user-configurable token pattern per frame-type class**, selected by the file's resolved type (incl. master-vs-raw). Default patterns (configurable in Settings; invalid/empty → default):

| Type | Default pattern (intent) | Notes |
|------|--------------------------|-------|
| light | `{target}/{filter}/{date}/light/` | per-night, per-filter, per-target |
| flat | `flats/{filter}/{date}/` | per-night, per-filter; no target |
| dark | `darks/{exposure}/` (+ `{gain}`/`{set_temp}`/`{binning}` as configured) | no filter, no target |
| bias | `bias/` (+ `{gain}`/`{set_temp}`/`{binning}` as configured) | no filter, no date, no target |
| master flat | `masters/flats/{filter}/` | raw counterpart minus date |
| master dark | `masters/darks/{exposure}/` | raw counterpart minus date |
| master bias | `masters/bias/` | raw counterpart minus date |

Rationale (Constitution Principle IV): flats are tracked by date+filter; bias/darks ignore filter; masters are integrations so they ignore date. Token names align with the shared `crates/patterns` vocabulary. Light-master / integration routing is deferred.

### Decision — destination root resolution (FR-027–FR-031)

`confirm` currently sets `to_root_id = from_root_id` unconditionally. New rule: default to the source's own root (in place) for non-inbox; **inbox sources must move into a chosen library root** (inbox is never a destination); when >1 registered root is a valid destination for the frame type, require explicit user selection; with exactly one candidate, auto-select. The plan/preview shows the **absolute** path (`registered_sources.path` + relative).

### Path-load-bearing attribute matrix (FR-032/FR-033)

Plan generation is gated on the presence of every attribute the chosen pattern consumes, surfaced via the existing needs-review flow (like missing IMAGETYP):

| Type | Required attributes |
|------|---------------------|
| light | image type, target/object, filter, date |
| flat | image type, filter, date |
| dark | image type, exposure |
| bias | image type |
| master flat | image type, filter |
| master dark | image type, exposure |
| master bias | image type |

(Gain/`set_temp`/binning are required only when included in the configured pattern for that type. Token names align with the `crates/patterns` V1 registry: `target`, `filter`, `date`, `frame_type`, `camera`, `exposure`, `gain`, `binning`, `set_temp`.)

## Iteration 2026-06-23: Single-type ingest, field-agnostic reclassify, lifecycle drop

> Constitution Principle IV: each decision below compares options, recommends a default, and keeps configuration. Evidence citations are to `origin/main` @ `efee4e1`. Real-FITS findings dump headers from `/mnt/d/astrophotography` (Poseidon-C PRO/NINA, ZWO ASI2600MM/NINA, DWARF III) and cross-reference `docs/development/077-fits-header-analysis.md`.

## R-9 — Sub-item granularity & the grouping-key recipe

**Context**: The inbox **unit of work** is "one row per leaf folder" (R-Granularity-1, `migrations/0020_inbox.sql:13`). US10/A requires homogeneous single-type sub-items so item↔plan stays strictly 1:1.

**Decision**: The unit of work changes to **"one row per single-type group within a leaf folder."** A leaf folder becomes a **source group** (provenance, R-12); each homogeneous group is one `inbox_item`. A group is the set of files in one source folder that share an identical **group key**:

```
group_key = frame_type · ⟨ordered identity dimensions for that frame_type⟩
```

**Default identity-dimension recipes** (each dimension individually toggleable per frame type in settings; continuous-dim bucket sizes configurable):

| frame_type | Default grouping dimensions (beyond frame_type) | Notes |
|---|---|---|
| light | camera(INSTRUME), **opticTrain(TELESCOP+INSTRUME+FOCALLEN)**, filter, exposure*, gain, offset, binning(XBIN/YBIN), **pointing(RA/Dec)†**, rotation(ROTATANG)†, observing-night(DATE-LOC) | Group/match by **pointing** (RA/Dec decimal), NOT `OBJECT`. **No temperature** (same night+settings ⇒ same session). Must match the **whole optical train incl. focal length** (R-18). Pointing → canonical target via R-17. |
| dark | camera, exposure*, gain, offset, set-temp‡, binning(XBIN/YBIN), readout-mode∘ | observing-night **optional/off by default** (darks span multiple nights); optional `DATE-END`-vs-`DATE-OBS` span heuristic to detect one acquisition run. No optics. |
| bias | camera, gain, offset, binning(XBIN/YBIN), readout-mode∘, observing-night(DATE-LOC) | exposure ≈0 (not a key). No optics. |
| flat | camera, **opticTrain(TELESCOP+INSTRUME+FOCALLEN)**, filter, gain, offset, binning(XBIN/YBIN), rotation(ROTATANG)†, readout-mode∘, observing-night(DATE-LOC) | **filter required** (filter-specific). exposure **excluded** (FlatWizard varies per-frame exposure to hit target ADU). |
| master_* | — (each master = its own item) | filename-encoded metadata **not trusted** for grouping (varies per user setup). |

**Legend.** `*` exposure bucketed (canonical seconds). `†` pointing & rotation grouped **within a configurable tolerance** (NOT exact) — see R-18: `pointing_tolerance_deg` (absorbs dither/centering/drift/reconfig) and `light_rotation_tolerance_deg` (absorbs manual-rotator drift over a night). `‡` set-temp bucketed (aligned to `dark_temp_tolerance_c`). `∘` **readout-mode = optional** (off by default; see below). Every dimension is individually toggleable per frame type in settings.

**Temperature policy.** Grouping temperature = **`SET-TEMP` by default**; a toggle switches the source to **`CCD-TEMP`**. If both present and `CCD-TEMP` deviates from `SET-TEMP` by > configurable X (**default 2 °C**), surface a **metadata-quality warning** but **do NOT split** — the setpoint governs the group. Lights deliberately **do not** group by temperature.

**Decided refinements:**
- **flat `filter`** — required (filter-specific; two filters in one folder must split).
- **flat `exposure`** — excluded (FlatWizard varies per-frame exposure).
- **`READOUTM` (readout mode)** — **optional matching dim, default OFF** (verified across 4000 real files): **Player One/Poseidon** always writes `READOUTM=Low Noise` (constant across gain 0/125, offset 20); **ZWO ASI2600MM/NINA writes no `READOUTM` at all**. In practice it is constant-or-absent and adds no grouping discrimination — keep it an optional toggle (unavailable for ZWO).
- **`CAMERA` keyword — ignored entirely** (DWARF-III-only lens selector; DWARF uses TELE for astro, never WIDE). Not the camera dimension, not in the optic-train composite.
- **Pointing** — prefer decimal **`RA`/`DEC`** (full precision, plate-solved center); keep **`OBJCTRA`/`OBJCTDEC`** as sexagesimal→decimal **fallback** (same info, coarser). See R-18.

**Alternatives**:
- **(a) Coarse** — split by type only (+ filter for lights/flats). *Rejected*: under-splits; a light folder mixing exposures/targets stays one item, so it cannot map to one downstream session nor (in the catalogue/move pattern) one clean destination, defeating the 1:1 goal.
- **(b) Full identity recipe (recommended default)** — split by the full per-type identity tuple (bucketed continuous dims). Each sub-item = exactly one acquisition/calibration set → one destination, one session, one plan. Matches user intent ("darks with the same relevant dark metadata; lights with the same relevant metadata"). Item-explosion risk is bounded by bucketing and by the reality that an acquisition run shares these values.
- **(c) Raw exact-equality on all dims incl. continuous** — *Rejected*: float temperature/exposure would fork near-identical frames into many items.

**Default = (b)**, with each dimension toggleable per frame type and continuous-dim bucket sizes configurable. Tradeoff recorded: over-split (item explosion) vs under-split (residual mixing → breaks 1:1). Bucketing is the mitigation.

**Note (extraction gap — grounded in `docs/development/077-fits-header-analysis.md`).** None of the round-2 grouping inputs below are extracted today (`crates/metadata/fits/src/lib.rs:118-137` reads only the 13 core fields). A **Phase-12 foundational extraction task** must add (FITS keyword → fallback):

| New field | FITS keyword | Fallback | XISF / notes |
|---|---|---|---|
| offset | `OFFSET` | — | grouping dim for all 4 types |
| set-temp | `SET-TEMP` | — | dark grouping (default temp source) |
| ccd-temp | `CCD-TEMP` | `DET-TEMP` (DWARF III) | deviation-warning source |
| pointing RA/Dec | `RA`/`DEC` (decimal °) | `OBJCTRA`/`OBJCTDEC` (sexagesimal → convert) | light grouping + R-17 target resolution |
| rotatorAngleDeg | `ROTATANG` (= `ROTATOR`, mechanical) | — | **flat-match key** + tolerant light grouping (R-18) |
| skyRotationDeg | `OBJCTROT` (sky PA) | — | **informational only — NOT a flat key** (R-18) |
| readout mode | `READOUTM` | — | proposed calibration grouping dim |
| focal length | `FOCALLEN` | XISF `Instrument:Telescope:FocalLength`×1000 | optic-train composite |
| pixel size | `XPIXSZ` / `PIXSIZE` | XISF `Image:PixelSize` | FOV-aware target radius (R-17), with `FOCALLEN` + `NAXIS1/2` |
| observer lat/long/elev | `SITELAT`/`SITELONG`/`SITEELEV` | `OBSGEO-B/-L/-H`, `LAT-OBS`/`LONG-OBS`/`ALT-OBS` | extract for **future grouping** (user req) + needed for observing-night solar-noon binning |

Until a dimension is extracted it behaves as **best-effort** (R-14): present → groups; absent → "(unknown)" bucket + warning, does not block. **Observer longitude is a prerequisite** for correct observing-night binning (solar-noon boundary), so SITELONG/LONG-OBS extraction gates the `observing-night` dimension. **Filename-encoded metadata is explicitly NOT a grouping/extraction source** (user req: varies per user setup) — stripped masters with empty headers carry unknown calibration metadata → resolved via user override, not filename parsing.

**`optic_train` derivation.** No standard FITS keyword exists; today it's only an assigned string on calibration sessions/masters (`crates/calibration/core/src/lib.rs:151`). Decision: **we build the optic-train key ourselves as `composite(TELESCOP, INSTRUME, FOCALLEN)` and assign it as metadata.** `FOCALLEN` captures focal reducers implicitly (real data: Celestron C925 @ `FOCALLEN=525` = f/2.2 Hyperstar; APO120 @ 672 = f/5.6), which we cannot otherwise detect. **`CAMERA` and rotators are NOT part of the optic-train** (rotator is a separate match dimension — R-18). Used for **both light and flat** grouping/matching (lights must match the entire optical train). Per-source / equipment-profile override allowed; this composite also seeds a future image-train config database.

## R-10 — Pipeline ordering: classify-then-split

**Context**: Spec 005 had a separate "split" step; the single-type pivot folds materialization into the existing pipeline. Question: at scan or at classify?

**Decision**: **Scan stays lazy**; **classify materializes sub-items.**
- `scan.rs` continues to discover leaf folders + masters and compute the cheap folder `content_signature` (partial 65 KB read, `signature.rs:4`) — **no full-header reads, no eager hashing** (Constitution: lazy hashing). It now writes one **source-group** row per leaf folder (plus individual master items, as today).
- `classify.rs` already reads per-file headers and persists `inbox_file_metadata` + evidence; it now additionally **partitions the files into groups by the R-9 recipe and materializes one single-type `inbox_item` per group** (replacing the single folder-level item).

**Alternatives**:
- **(a) classify-then-split (recommended)** — keeps the directory walk header-free; header reads happen only when the user classifies an item, exactly as today.
- **(b) metadata-at-scan** — *Rejected*: would force the directory walk to read every header to know group boundaries → expensive on large libraries, violates lazy-scan.

**Default = (a).** Before classify, a source group holds one transient `pending_classification` placeholder; after classify it holds N single-type children.

## R-11 — Identity & signature stability

**Context**: Item identity today is `UNIQUE(root_id, relative_path)` (`0020_inbox.sql`). Single-type items need stable identity that doesn't churn on rescan but does churn when a file's metadata/override moves it between groups.

**Decision**:
- Item identity = **composite `(root_id, relative_path, group_key)`**; `UNIQUE(root_id, relative_path)` → `UNIQUE(root_id, relative_path, group_key)`.
- `group_key` is a deterministic canonical serialization of the normalized/bucketed dimension tuple (fixed order from the recipe; missing dims render an explicit sentinel, e.g. `filter=∅`).
- **Per-sub-group `content_signature`** = `folder_signature(sorted(per-file sigs of files in that group))`, reusing `signature.rs` primitives. The source group keeps the folder-level signature.
- **Stability**: group keys are deterministic from (normalized metadata + recipe), so rescans of unchanged content produce identical keys → items don't churn. A file whose metadata/override changes moves groups (its old and new sub-group signatures change) — correct churn, surfaced via `override_stale` (R-4 carried forward).

## R-12 — Source-group provenance

**Context**: D — each sub-item must carry its originating source-folder provenance ("ingested together").

**Decision**: Add `inbox_source_groups` (id, root_id, relative_path, discovered_at, last_scanned_at, content_signature, format, lane, child_count; `UNIQUE(root_id, relative_path)`). Each `inbox_item` gains `source_group_id` (FK), `group_key`, `group_label`, and an always-set `frame_type`. The UI shows "ingested together": parent `(root)` → children `dark · -10°C`, `light · Ha · 300s`, …. Display label format: `"(root) · <type> · <discriminating dims>"`.

## R-13 — Field-agnostic reclassifier + property registry

**Context**: Override today = fixed `{filter, exposureS, binning}` columns (R-3, migration `0045`); reclassify takes only those. B/US11 needs overriding temperature/gain/object and "any future field".

**Decision**: Introduce a **typed property registry** and make `inbox.reclassify` accept an arbitrary per-file property map validated against it.

**Property registry** (shared module, mirrored to contracts so the UI renders a generic table). Each entry: `{ key, kind, unit, source_header(s), overridable, applies_to_frame_types, validation }`.

| key | kind | unit | source header(s) | applies to |
|---|---|---|---|---|
| frameType | enum(light\|dark\|bias\|flat\|dark_flat) | — | IMAGETYP / XISF | all |
| target | string (target_id) | — | resolved by coords (R-17); `OBJECT` = hint only | light |
| filter | string | — | FILTER | light, flat |
| exposureS | number | s | EXPTIME/EXPOSURE | light, dark, (flat) |
| gain | number\|string | — | GAIN | all |
| offset | integer | ADU | OFFSET/BLKLEVEL | all (light, dark, bias, flat) |
| temperatureC | number | °C | **SET-TEMP (default) / CCD-TEMP (toggle)**, fallback `DET-TEMP` | dark (bias) |
| binning | string | NxN | XBINNING/YBINNING | all |
| camera (instrument) | string | — | INSTRUME | all |
| telescope | string | — | TELESCOP | light, flat (optic-train input) |
| opticTrain | string | — | derived: TELESCOP+INSTRUME(+DWARF `CAMERA`) · or capture keyword · or equipment-profile override | flat |
| rotatorAngleDeg | number | deg | ROTATANG (= ROTATOR; mechanical) | flat (match key), light (group, tolerant) |
| rotatorName | string | — | ROTNAME | informational (device id) |
| skyRotationDeg | number | deg | OBJCTROT (sky PA) | informational only — NOT a flat key (R-18) |
| raDeg / decDeg | number | deg | RA/DEC (decimal, preferred) ← OBJCTRA/OBJCTDEC (sexagesimal→decimal) fallback | light (pointing + R-17) |
| readoutMode | string | — | READOUTM | optional, default OFF; often deterministic from gain+offset |
| focalLengthMm | number | mm | FOCALLEN; XISF `Instrument:Telescope:FocalLength`×1000 | optic-train composite (light+flat) |
| observerLat / Long / Elev | number | °, °, m | SITE* → OBSGEO-(B/L/H) → (LAT/LONG/ALT)-OBS | **future grouping only** (not needed for night-binning) |
| observingNight | date | — | **DATE-LOC** (local) → UTC+longitude fallback | night grouping (R-18) |
| obsTimeUtc | MJD/datetime | day | MJD-AVG → MJD-OBS → DATE-AVG → DATE-OBS | ordering / dark-run span |
| dateEnd | datetime | ISO-8601 | DATE-END | dark-run span heuristic |

**Editing semantics.** The metadata editor **fills only MISSING / unreadable properties** — values present in the header are shown **read-only** (the header is authoritative; gap-filling, not rewriting). **All set values are app-side INDEX metadata only and are NEVER written back to FITS/XISF files** (Constitution I — local-first; files are user-owned and only mutated through a reviewed filesystem plan, which never edits headers). The UI states this explicitly ("for indexing only — your files are not modified"). *One explicit exception:* correcting a present-but-wrong frame type remains available as a distinct "correct classification" action (the existing `manual_override`), separate from gap-filling.

- **Precedence**: user override **>** FITS/XISF value. Overrides are **persisted as user-provided metadata** and re-drive classification → grouping → path resolution → gate.
- **Bulk**: request supports applying one value across many files (UI "set all per attribute"): `bulk: [{ property, value, filePaths? }]` (omitted `filePaths` = all files in the source group).
- **Persistence keying (critical)**: overrides now **re-partition** files into sub-items, so they are stored at **source-group + relative_file_path + property_key** granularity (table `inbox_file_overrides`), **not** at sub-item id (which may be created/destroyed by the override). This replaces the fixed `override_filter/override_exposure_s/override_binning` columns (`0045`); existing values migrate (R-16/migration approach). Staleness keying (size+mtime) carries over from R-4.

**Alternatives**: Fixed-field extension (rejected: not future-proof; the task requires temperature/gain/object/"any future field") vs typed open map (recommended). The registry gives type-safety + validation without a fixed column list.

## R-14 — Generalized missing-mandatory-metadata gate

**Context**: C — today's confirm-time `missing_path_attributes` gate (`confirm.rs:332`, `metadata.rs:140`) only covers destination-pattern tokens. Grouping now also depends on mandatory attributes that must be present before a clean single-type item exists.

**Decision**: Generalize the gate to **`missing_mandatory_attributes`** = union of:
1. **Mandatory grouping properties** for the file's effective frame type that are absent (FITS or override), AND
2. **Destination-pattern tokens** that are absent (the existing behavior).

**Mandatory-property set per frame type (default, derived not hardcoded)** = active per-type pattern tokens ∪ enabled grouping dimensions ∪ hard calibration/session keys:

| frame_type | Mandatory (default) | Conditional |
|---|---|---|
| light | frameType, target, filter, exposureS | gain/binning iff in pattern or session key |
| dark | frameType, exposureS, gain | offset iff `require_same_offset`; temperatureC iff temp-split enabled |
| bias | frameType, gain | offset iff `require_same_offset` |
| flat | frameType, filter | gain/binning iff in pattern |

- Files missing a mandatory attribute (incl. unclassifiable frame type) cannot form a valid single-type destination and are collected into a per-source-group **"Needs review" sub-item** (sentinel group key). This sub-item **blocks plan creation** until resolved via reclassify (R-13). This generalizes today's `unclassified` result + confirm-time `InboxMissingPathAttributes` block.
- `inbox.list` items and the per-file metadata DTO report the missing list (per file + per-item rollup) so the UI prompts before confirm.
- **`target` (light) is a hard mandatory key** in the derived set: it is satisfiable by coordinate auto-resolution (R-17) **or** an explicit user pick. A light sub-group with no pointing and no user-set target therefore lands in the needs-review bucket (US15 scenario 3) — `target` is not a header/pattern token but is still enforced as mandatory for lights.

**Pre-confirm completion & re-split loop.** A plan is created **only from a fully-resolved single-type sub-item**. The flow is strictly: **(1)** scan → classify materializes sub-items (incl. a needs-review bucket for files missing mandatory attrs); **(2)** the user supplies the missing values in the metadata editor (`inbox.reclassify`, field-agnostic, fill-missing-only, index-only); **(3)** the system **re-runs classification + grouping and re-materializes/re-splits the sub-items** (a needs-review bucket can split into several proper single-type sub-items as values arrive); **(4)** only once a sub-item has no missing mandatory attributes can it be confirmed into a plan. I.e. **splitting/recalculating the inbox happens before confirm**, never inside plan creation. `inbox.confirm` rejects any item still carrying missing mandatory attributes (broadened `inbox.missing_path_attributes`).

## R-15 — Confirm simplification; delete mixed/split

**Context**: A (downstream of single-type). With every item single-type, the auto-split/mixed branch (R-8, US5) is redundant.

**Decision**: Every item is single-type ⇒
- `inbox.confirm.action` is always "confirm"; **delete "split"** and the `("split","mixed")` validation (`confirm.rs:162`).
- Delete the per-type contiguous-grouping sort (`confirm.rs:197`) and the `confirm_mixed_emits_per_type_action_groups` test (`confirm.rs:1285`).
- `inbox_classifications.result` collapses: `classified | unclassified` (frame_type always set when classified); `mixed` is removed as a terminal result (a mixed folder simply yields multiple single-type items).
- **One `rootId` per item** (the existing optional `root_id` becomes THE per-item destination); keep the `destination_root_required` candidate-roots flow for >1 candidate; remove per-category root caching.
- `inbox_plan_links` 1:1 PK preserved — now satisfied structurally (one type → one plan).

**Alternatives**: Keep the split/mixed path as dead-but-present — rejected: leaves two contradictory granularity models and a redundant user gesture once confirm groups by type.

## R-16 — Folded universal-gate / session-lifecycle drop

**Context**: E — the universal-gate decision drops the planned session **review lifecycle** (spec 045) in favor of derived, already-confirmed sessions.

**Decision**: Reverse the planned session review lifecycle. Acquisition + calibration sessions become **derived, already-confirmed inventory** (like calibration masters today). Drop `discovered/candidate/needs_review/confirmed/rejected` review states, the Confirm/Re-open/Reject affordances, and the type-aware review predicate. `session_key` is deterministic once per-file metadata is fixed at inbox confirm, so there is nothing left to review. **Metadata-override persistence** (R-13) is the persisted, **editable** user metadata that defines the session; editing re-opens the same metadata table from the session, but no lifecycle gate exists.

**Migration approach (filesystem-free, re-derivation).** Per-file metadata is already persisted (`inbox_file_metadata`), so re-derivation needs no rescan:
1. For each existing folder-level `inbox_items` row → create an `inbox_source_groups` row (copy root_id, relative_path, content_signature, format, lane).
2. Partition the folder's persisted evidence+metadata by the R-9 recipe → insert child single-type `inbox_items` (group_key/label/frame_type, per-sub-group signature). Folders never classified (no persisted metadata) → one `pending_classification` child that splits on next classify.
3. Migrate `override_*`/`manual_override` columns → `inbox_file_overrides` rows.
4. **`plan_open` items are NOT re-split** (a plan is linked 1:1). Keep such an item as a single legacy sub-item carrying its plan link until the plan resolves/discards; re-derivation into sub-items happens on the next classify after the plan closes. (Safe path; documented.)

**Cross-spec**: Obsoletes most of spec **045-review-state-real** (recommend marking it superseded) and reduces the spec **006** six-state `SessionState`. **Run `/speckit.sync.conflicts` immediately after apply.** Constitution boundary intact (reviewable plans retained; no image processing; durable DB audit retained).

**Alternatives**: Keep the review lifecycle and layer single-type ingest beneath it — rejected: leaves a no-op gate (nothing left to review once metadata is fixed at confirm) and a second source of session truth.

## R-17 — Coordinate-based target resolution at light ingestion

**Context**: User req — target should be resolved by sky coordinates, not the free-text `OBJECT` string set in NINA.

**Decision**: Resolve a light sub-group's **target by sky-coordinate proximity**, not by the `OBJECT` string.

- At light ingestion (the Inbox metadata-completion step), each light sub-group has a pointing (`RA`/`DEC` decimal, fallback converted `OBJCTRA`/`OBJCTDEC`). Compute **angular (great-circle) distance** between that pointing and every entry in the target database (gen-3 targets + SIMBAD-resolved catalog — specs 013/014/023/035) via haversine on (RA, Dec).
- Present a **ranked list of recommended targets** (nearest within a **FOV-aware radius** computed from `FOCALLEN` + pixel size (`XPIXSZ`/`PIXSIZE`) + sensor dimensions (`NAXIS1/2`) by default; when pixel size is unavailable, fall back to a **configurable fixed radius**), plus **free-text search** and **manual set**. The `OBJECT` header is used **only as the initial display name** for ingestion/sessions — **never for target search/matching** (search is coordinate-only).
- The chosen `target_id` becomes the sub-group's canonical target: it drives the group **label** (canonical name, not the NINA string), unifies the group key (resolved `target_id` supersedes raw pointing buckets so dither jitter near a bucket edge can't fork one target), and **auto-propagates to any project** that consumes these lights (closes spec 035 project↔target gap #1).
- `target` is a **mandatory** light attribute (R-14) satisfiable by auto-resolution OR user pick; unresolved + unset pointing ⇒ needs-review bucket.

**Alternatives**: (a) OBJECT-string match (today's implicit behavior) — *rejected*: free-text, inconsistent, user-set in NINA. (b) **Coordinate nearest-neighbor (recommended)** — robust to naming, leverages the existing SIMBAD/target DB, and enables auto project linkage. (c) Hybrid (coords primary, OBJECT as a tiebreaker/search seed) — adopted as the UX detail.

**Cross-spec**: Extends spec **035** (name-based SIMBAD resolution) with coordinate NN and **023** (target identity/history). Flag in `/speckit.sync.conflicts`. Performance: target DB is small; a bounded scan or simple spatial index suffices (no heavy dependency — Constitution).

## R-18 — Rotation, pointing, location & time semantics (real-FITS-verified)

Verified by dumping real headers from `/mnt/d/astrophotography` (Poseidon-C PRO/NINA, ZWO ASI2600MM/NINA, DWARF III).

**Rotator keywords (real values).** On NINA lights with a manual rotator + OAG:
- `ROTATANG = 12.4320640563965` and `ROTATOR = 12.4320640563965` — **identical**; both are the **mechanical rotator angle** (NINA writes the angle into both; `ROTATOR` is NOT a device name).
- `ROTNAME = "Manual Rotator + OAG"` — the **device name**.
- `ROTSTPSZ = 0.0` — rotator step size.
- `OBJCTROT = 12.43` — the **sky position angle** of the framing (rounded); ≈ `ROTATANG` in manual-rotator setups but conceptually distinct (sky PA, not mechanical).

**Decision — rotation.**
- **Flat↔light matching uses the mechanical image-train rotation `ROTATANG` (= `ROTATOR`), never `OBJCTROT`.** Dust/vignetting are physical to the train. `OBJCTROT` is extracted **informational only**.
- **`ROTATANG` may be absent** (no integrated rotator reporting). Then flat-rotation matching is **optional + configurable**: a setting `flat_rotation_required` (default OFF) decides whether missing rotation excludes a flat; when matching without it, **emit a warning "rotation (ROTATANG) unavailable — matched without rotation"**.
- **Correction to earlier claim:** "no rotator ⇒ train rotation fixed" is **wrong**. A *mechanical* rotator still physically rotates the train even when it doesn't report an angle. The robust requirement (documented for users): **use a manual rotator configured in NINA so `ROTATANG` is recorded** — that is a prerequisite for reliable rotation matching. Without recorded rotation we cannot guarantee flat validity and fall back to the optional/warn path above.
- **Flat↔light rotation match = (near-)exact, NOT tolerance-scored.** Even a small rotation change can invalidate a flat. Compare the **flat group's `ROTATANG` against the light group's `ROTATANG`** and **WARN on any deviation** beyond a tiny float-epsilon ("rotation differs by X° — flat may not be valid for these lights"). This **replaces** the old soft `flat_rotation_tolerance_deg` (0.5°) for flat↔light applicability.
  - **Drift is NOT detectable.** With a **manual rotator**, physical drift does **not** update `ROTATANG` (it stays at the set value) — only `OBJCTROT` (sky PA, treated as informational/conflated) would move. So we **cannot** determine intra-session rotator drift. The **only determinable signal is the deviation between the flat group's recorded rotation and the light group's recorded rotation** → warn on that. Within a session `ROTATANG` is effectively constant; it varies across setups/nights.
  - **Verified (WBPP calibration order):** flat-field correction is applied to **each raw light sub-frame** during calibration, *before* registration/integration — **never to the stacked master light**. Flat↔light matching is therefore at the **raw-sub-frame / light-group** level. Stacked/auto-stacked/processed master lights are already-calibrated **derived products**, excluded from our flat matching (they remain their own inbox items).
- **Light grouping rotation** — within one session `ROTATANG` is effectively constant (manual rotators don't report drift); `light_rotation_tolerance_deg` only matters across setups/nights where the recorded angle changes. Flat applicability is judged at the **group level** (flat `ROTATANG` vs light `ROTATANG`), never per-sub (drift is invisible to us).

**Decision — pointing.** Normalize all pointing to **decimal degrees** for distance math. Extract **both** `RA`/`DEC` (decimal) and `OBJCTRA`/`OBJCTDEC` (sexagesimal); **prefer full-precision `RA`/`DEC`** (the actual plate-solved image center) and convert `OBJCTRA`/`OBJCTDEC` as **fallback** when decimal is absent. *Why decimal first (not "ignore sexagesimal"):* it is directly usable for haversine without parsing and is higher precision — real data shows `RA=272.6820°` vs `OBJCTRA="18 10 38"→272.658°`, an ~0.02° gap from second-rounding (and possibly target-catalog vs solved-center). Sexagesimal carries the **same** information, just coarser and needing conversion — so we keep it as a fallback, we don't discard it. Light grouping + target-NN (R-17) match within a configurable **`pointing_tolerance_deg`**. Lights must also match the **whole optical train** (optic-train composite incl. `FOCALLEN`).

**Decision — observing-night (corrects the longitude claim).** NINA writes **`DATE-LOC`** (real: `2025-10-17T19:23:39` local vs `DATE-OBS` `15:23:39` UTC). With local time available, observing-night = the **local** calendar date under a noon boundary — **no observer longitude required.** Source priority: **`DATE-LOC` → (UTC `MJD-AVG`/`DATE-OBS` + longitude fallback only when local time absent, e.g. DWARF)**. So `SITE*`/location extraction is **not** needed for night-binning; it is extracted only for *future* grouping (user's earlier ask).

**Location keywords (real values) — software-dependent, same physical info.**
- NINA raw lights write `SITELAT`/`SITELONG`/`SITEELEV` (e.g. `24.839`/`55.383`/`101.0`). (Per-session value differences just mean shots taken from different physical locations — **not** a grouping signal; ignore.)
- PixInsight WBPP masters write `OBSGEO-B`/`OBSGEO-L`/`OBSGEO-H` and `LAT-OBS`/`LONG-OBS`/`ALT-OBS` (doc §2.8).
- All three conventions encode the same observer geodetic location. **Decision:** extract into one `observerLat/Long/Elev` with fallback chain `SITE* → OBSGEO-(B/L/H) → (LAT/LONG/ALT)-OBS`. **Future grouping only** (not a v1 grouping key, not needed for night-binning).

**Time basis (`MJD`).** `MJD-OBS` = MJD at exposure start (numeric UTC `DATE-OBS`); `MJD-AVG` = MJD at exposure **midpoint** (numeric `DATE-AVG`); both NINA 3.2+ only. For **ordering / dark-run span / UTC math** prefer `MJD-AVG → MJD-OBS → DATE-AVG → DATE-OBS`. For **observing-night** prefer `DATE-LOC` (above). Real data: `DATE-AVG=2025-10-17T15:23:55` (midpoint) vs `DATE-OBS=…:23:39` (start).
