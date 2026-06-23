---
status: applied
created: 2026-06-23
applied: 2026-06-23
change_request: "Change the inbox unit of work from one-item-per-leaf-folder to single-type sub-grouped items at INGEST (A); make the reclassifier field-agnostic over a typed property registry (B); define a generalized missing-mandatory-metadata gate (C); add source-group provenance (D); and fold in the universal-gate decision: drop the session review lifecycle and persist user metadata overrides as the source of derived, already-confirmed sessions (E)."
scope: "Pivot"
---

## Change Summary

Replace the folder-level inbox item with **homogeneous single-type sub-items materialized at classify time** — every inbox item becomes one frame-type group (e.g. `(root) · light · Ha · 300s`, `(root) · dark · -10°C · 300s`), so item↔plan stays strictly 1:1, the mixed/"split" branch is deleted, destination-library selection collapses to one dropdown per item, the reclassifier becomes field-agnostic over a typed property registry, the missing-attribute gate generalizes to all mandatory grouping + path attributes, and each sub-item carries its originating source-folder provenance. The session review lifecycle is dropped — sessions become derived, already-confirmed inventory whose identity is fixed by the inbox-confirmed (and now persisted, editable) per-file metadata.

This is a **Pivot-scale** in-place iteration (user-directed, with the universal-gate/lifecycle-drop folded in). It reworks several completed 041 tasks and has cross-spec impact on 045 (review-state) and 006 (SessionState lifecycle).

## Implementation Progress

- **Tasks completed**: T001–T059 complete (47 of 60 in spec accounting; the spec's own count treats some as deferred), **T060** (~) live-Windows E2E is the only open task.
- **Current phase**: 041 is effectively **landed on `main`** (merged via PR #311/#312 lineage; inbox plan-surface shipped). This iterate opens a **new phase (Phase 12)** on top of the shipped feature.
- **Files changed on branch**: 0 (fresh worktree off `origin/main` @ `efee4e1`; this iterate is design-only).
- **Potential task completions to mark**: None new.
- **Adhoc changes**: None.

### Completed tasks this iterate REWORKS or RETIRES (risk)

| Task | Current state | Effect of this iterate |
|---|---|---|
| T002 (migration 0045) | [x] | Superseded/extended by a new migration (0046) that re-derives granularity + generic overrides. |
| T005 (inbox contracts) | [x] | Contract shapes change: list item gains group/provenance/missing fields; confirm drops `action="split"`; reclassify becomes field-agnostic. |
| T016/T024–T028 (reclassify fixed-field overrides) | [x] | Reworked: fixed `{filter,exposureS,binning}` → typed property map + bulk; overrides re-key to source-group/file (because they now re-partition items). |
| T036/T037 (US5 auto-split, per-type contiguous groups) | [x] | **Retired**: every item is single-type; the per-type-group sort, the `("split","mixed")` path, and `confirm_mixed_emits_per_type_action_groups` are deleted. |
| T053 (destination-root resolution) | [x] | Simplified: one `rootId` per single-type item; multi-candidate flow retained, multi-category caching removed. |
| T056/T057 (missing_path_attributes gate) | [x] | Generalized to `missing_mandatory_attributes` (grouping + path); now also gates sub-item formation, not just confirm. |

**User acknowledged** (decision 2026-06-23): iterate in place on 041 and fold in the lifecycle drop, accepting that completed work is reworked.

## Impact Assessment

| Artifact | Action | Details |
|----------|--------|---------|
| spec.md | Modify | New US10–US14; new FR-034…FR-052; new SC-012…SC-017; rewrite US5 (auto-split) as **retired**; update Key Entities (Source group, Sub-item, Property registry, Override→derived session); update Edge Cases (continuous-dim bucketing, needs-review bucket, plan_open during migration). |
| plan.md | Modify | Add Phase 12 (single-type ingest) + Phase 13 (lifecycle drop); update affected source-file map (scan/classify/reclassify/confirm/plan_listener, new property-registry module, contracts, migration 0046, sessions/lifecycle removal). |
| research.md | Modify | Add R-9…R-16 (granularity/grouping recipe, pipeline ordering, identity+signature, provenance, property registry, missing gate, confirm simplification, lifecycle drop). |
| data-model.md | Modify | New `inbox_source_groups`; `inbox_items` granularity + columns + composite UNIQUE; new `inbox_file_overrides`; per-sub-item classification; migration 0046 re-derivation; SessionState lifecycle removal. |
| contracts/operations.md | Modify | `inbox.list`, `inbox.confirm`, `inbox.reclassify` deltas; new `inbox.property_registry`; broaden `inbox.missing_path_attributes`; drop session review ops; regenerate TS surface. |
| tasks.md | Add | Phase 12 + Phase 13 task block (T061…); mark retired tasks. |
| quickstart.md | Modify | Add single-type-ingest + field-agnostic-reclassify + lifecycle-drop verification scenarios. |
| checklists/ | Modify | Re-open requirements checklist for the new US/FR/SC. |

## Risk Checks

- [x] Completed tasks invalidated — **YES, acknowledged**: T036/T037 retired; T002/T005/T024–T028/T053/T056/T057 reworked. User chose in-place iterate.
- [ ] No scope boundary violations — **Pivot**: changes the core inbox granularity invariant (R-Granularity-1) and folds in lifecycle removal (reverses spec 045). Within user-approved scope.
- [ ] No downstream dependency breaks — **Cross-spec impact**: spec 045 (review-state-real) is largely obsoleted; spec 006 SessionState six-state lifecycle is reduced. **MUST run `/speckit.sync.conflicts` after apply.** Constitution boundary preserved (no image processing; plans remain reviewable; lazy scans retained).

---

# Research Decisions (→ research.md R-9 … R-16)

> Constitution Principle IV: each decision compares options, recommends a default, and keeps configuration. Evidence citations are to `origin/main` @ `efee4e1`.

## R-9 — Sub-item granularity & the grouping-key recipe (A, RQ1)

**Decision.** The inbox **unit of work** changes from "one row per leaf folder" (R-Granularity-1, `migrations/0020_inbox.sql:13`) to **"one row per single-type group within a leaf folder."** A leaf folder becomes a **source group** (provenance, R-12); each homogeneous group is one `inbox_item`.

A group is the set of files in one source folder that share an identical **group key**:

```
group_key = frame_type · ⟨ordered identity dimensions for that frame_type⟩
```

**Default identity-dimension recipes** (each dimension individually toggleable in settings):

**Default grouping recipes (user-specified, 2026-06-23 round 2):**

| frame_type | Default grouping dimensions (beyond frame_type) | Notes |
|---|---|---|
| light | camera(INSTRUME), **opticTrain(TELESCOP+INSTRUME+FOCALLEN)**, filter, exposure*, gain, offset, binning(XBIN/YBIN), **pointing(RA/Dec)†**, rotation(ROTATANG)†, observing-night(DATE-LOC) | Group/match by **pointing** (RA/Dec decimal), NOT `OBJECT`. **No temperature** (same night+settings ⇒ same session). Must match the **whole optical train incl. focal length** (R-18). Pointing → canonical target via R-17. |
| dark | camera, exposure*, gain, offset, set-temp‡, binning(XBIN/YBIN), readout-mode∘ | observing-night **optional/off by default** (darks span multiple nights); optional `DATE-END`-vs-`DATE-OBS` span heuristic to detect one acquisition run. No optics. |
| bias | camera, gain, offset, binning(XBIN/YBIN), readout-mode∘, observing-night(DATE-LOC) | exposure ≈0 (not a key). No optics. |
| flat | camera, **opticTrain(TELESCOP+INSTRUME+FOCALLEN)**, filter, gain, offset, binning(XBIN/YBIN), rotation(ROTATANG)†, readout-mode∘, observing-night(DATE-LOC) | **filter required** (filter-specific). exposure **excluded** (FlatWizard varies per-frame exposure to hit target ADU). |
| master_* | — (each master = its own item) | filename-encoded metadata **not trusted** for grouping (varies per user setup). |

**Legend.** `*` exposure bucketed (canonical seconds). `†` pointing & rotation grouped **within a configurable tolerance** (NOT exact) — see R-18: `pointing_tolerance_deg` (absorbs dither/centering/drift/reconfig) and `light_rotation_tolerance_deg` (absorbs manual-rotator drift over a night). `‡` set-temp bucketed (aligned to `dark_temp_tolerance_c`). `∘` **readout-mode = optional** (off by default; see below). Every dimension is individually toggleable per frame type in settings.

**Temperature policy (confirmed).** Grouping temperature = **`SET-TEMP` by default**; a toggle switches the source to **`CCD-TEMP`**. If both present and `CCD-TEMP` deviates from `SET-TEMP` by > configurable X (**default 2 °C**), surface a **metadata-quality warning** but **do NOT split** — the setpoint governs the group. Lights deliberately **do not** group by temperature.

**Decided refinements (2026-06-23):**
- **flat `filter`** — confirmed required (filter-specific; two filters in one folder must split).
- **flat `exposure`** — confirmed excluded (FlatWizard varies per-frame exposure).
- **`READOUTM` (readout mode)** — **optional matching dim, default OFF** (verified across 4000 real files): **Player One/Poseidon** always writes `READOUTM=Low Noise` (constant across gain 0/125, offset 20); **ZWO ASI2600MM/NINA writes no `READOUTM` at all**. In practice it is constant-or-absent and adds no grouping discrimination — keep it an optional toggle (unavailable for ZWO).
- **`CAMERA` keyword — ignored entirely** (DWARF-III-only lens selector; DWARF uses TELE for astro, never WIDE). Not the camera dimension, not in the optic-train composite.
- **Pointing** — prefer decimal **`RA`/`DEC`** (full precision, plate-solved center); keep **`OBJCTRA`/`OBJCTDEC`** as sexagesimal→decimal **fallback** (same info, coarser). See R-18.

**Options considered.**
- **(a) Coarse** — split by type only (+ filter for lights/flats). *Rejected*: under-splits; a light folder mixing exposures/targets stays one item, so it cannot map to one downstream session nor (in the catalogue/move pattern) one clean destination, defeating the 1:1 goal.
- **(b) Full identity recipe (recommended default)** — split by the full per-type identity tuple (bucketed continuous dims). Each sub-item = exactly one acquisition/calibration set → one destination, one session, one plan. Matches the user's explicit intent ("darks with the same relevant dark metadata; lights with the same relevant metadata"). Item-explosion risk is bounded by bucketing and by the reality that an acquisition run shares these values.
- **(c) Raw exact-equality on all dims incl. continuous** — *Rejected*: float temperature/exposure would fork near-identical frames into many items.

**Default = (b)**, with each dimension toggleable per frame type and continuous-dim bucket sizes configurable. Tradeoff recorded: over-split (item explosion) vs under-split (residual mixing → breaks 1:1). Bucketing is the mitigation.

**Note (extraction gap — grounded in `docs/development/077-fits-header-analysis.md`).** None of the round-2 grouping inputs below are extracted today (`crates/metadata/fits/src/lib.rs:118-137` reads only the 13 core fields). **Phase-12 foundational extraction task** must add (FITS keyword → fallback):

| New field | FITS keyword | Fallback | XISF / notes |
|---|---|---|---|
| offset | `OFFSET` | — | grouping dim for all 4 types |
| set-temp | `SET-TEMP` | — | dark grouping (default temp source) |
| ccd-temp | `CCD-TEMP` | `DET-TEMP` (DWARF III) | deviation-warning source |
| pointing RA/Dec | `RA`/`DEC` (decimal °) | `OBJCTRA`/`OBJCTDEC` (sexagesimal → convert) | light grouping + R-17 target resolution |
| rotation | `OBJCTROT` | `ROTATANG` | light + flat grouping |
| readout mode | `READOUTM` | — | proposed calibration grouping dim |
| focal length | `FOCALLEN` | XISF `Instrument:Telescope:FocalLength`×1000 | optic-train composite |
| observer lat/long/elev | `SITELAT`/`SITELONG`/`SITEELEV` | `OBSGEO-B/-L/-H`, `LAT-OBS`/`LONG-OBS`/`ALT-OBS` | extract for **future grouping** (user req) + needed for observing-night solar-noon binning |

Until a dimension is extracted it behaves as **best-effort** (R-14): present → groups; absent → "(unknown)" bucket + warning, does not block. **Observer longitude is a prerequisite** for correct observing-night binning (solar-noon boundary), so SITELONG/LONG-OBS extraction gates the `observing-night` dimension. **Filename-encoded metadata is explicitly NOT a grouping/extraction source** (user req: varies per user setup) — stripped masters with empty headers carry unknown calibration metadata → resolved via user override, not filename parsing.

**`optic_train` derivation (decided 2026-06-23).** No standard FITS keyword exists; today it's only an assigned string on calibration sessions/masters (`crates/calibration/core/src/lib.rs:151`). Decision: **we build the optic-train key ourselves as `composite(TELESCOP, INSTRUME, FOCALLEN)` and assign it as metadata.** `FOCALLEN` captures focal reducers implicitly (real data: Celestron C925 @ `FOCALLEN=525` = f/2.2 Hyperstar; APO120 @ 672 = f/5.6), which we cannot otherwise detect. **`CAMERA` and rotators are NOT part of the optic-train** (rotator is a separate match dimension — R-18). Used for **both light and flat** grouping/matching (lights must match the entire optical train). Per-source / equipment-profile override allowed; this composite also seeds a future image-train config database.

## R-10 — Pipeline ordering: classify-then-split (A, RQ2)

**Decision.** **Scan stays lazy**; **classify materializes sub-items.**
- `scan.rs` continues to discover leaf folders + masters and compute the cheap folder `content_signature` (partial 65 KB read, `signature.rs:4`) — **no full-header reads, no eager hashing** (Constitution: lazy hashing). It now writes one **source-group** row per leaf folder (plus individual master items, as today).
- `classify.rs` already reads per-file headers and persists `inbox_file_metadata` + evidence; it now additionally **partitions the files into groups by the R-9 recipe and materializes one single-type `inbox_item` per group** (replacing the single folder-level item).

**Options considered.**
- **(a) classify-then-split (recommended)** — keeps the directory walk header-free; header reads happen only when the user classifies an item, exactly as today.
- **(b) metadata-at-scan** — *Rejected*: would force the directory walk to read every header to know group boundaries → expensive on large libraries, violates lazy-scan.

**Default = (a).** Before classify, a source group holds one transient `pending_classification` placeholder; after classify it holds N single-type children.

## R-11 — Identity & signature stability (A, RQ3)

**Decision.**
- Item identity = **composite `(root_id, relative_path, group_key)`**; `UNIQUE(root_id, relative_path)` (`0020_inbox.sql`) → `UNIQUE(root_id, relative_path, group_key)`.
- `group_key` is a deterministic canonical serialization of the normalized/bucketed dimension tuple (fixed order from the recipe; missing dims render an explicit sentinel, e.g. `filter=∅`).
- **Per-sub-group `content_signature`** = `folder_signature(sorted(per-file sigs of files in that group))`, reusing `signature.rs` primitives. The source group keeps the folder-level signature.
- **Stability**: group keys are deterministic from (normalized metadata + recipe), so rescans of unchanged content produce identical keys → items don't churn. A file whose metadata/override changes moves groups (its old and new sub-group signatures change) — correct churn, surfaced via `override_stale` (R-4 carried forward).

## R-12 — Source-group provenance (D, RQ —)

**Decision.** Add `inbox_source_groups` (id, root_id, relative_path, discovered_at, last_scanned_at, content_signature, format, lane, child_count; `UNIQUE(root_id, relative_path)`). Each `inbox_item` gains `source_group_id` (FK), `group_key`, `group_label`, and an always-set `frame_type`. The UI shows "ingested together": parent `(root)` → children `dark · -10°C`, `light · Ha · 300s`, …. Display label format: `"(root) · <type> · <discriminating dims>"`.

## R-13 — Field-agnostic reclassifier + property registry (B, RQ4)

**Decision.** Introduce a **typed property registry** and make `inbox.reclassify` accept an arbitrary per-file property map validated against it.

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

**Editing semantics (user req 2026-06-23).** The metadata editor **fills only MISSING / unreadable properties** — values present in the header are shown **read-only** (the header is authoritative; gap-filling, not rewriting). **All set values are app-side INDEX metadata only and are NEVER written back to FITS/XISF files** (Constitution I — local-first; files are user-owned and only mutated through a reviewed filesystem plan, which never edits headers). The UI states this explicitly ("for indexing only — your files are not modified"). *One explicit exception:* correcting a present-but-wrong frame type remains available as a distinct "correct classification" action (the existing `manual_override`), separate from gap-filling.

- **Precedence**: user override **>** FITS/XISF value. Overrides are **persisted as user-provided metadata** and re-drive classification → grouping → path resolution → gate.
- **Bulk**: request supports applying one value across many files (UI "set all per attribute"): `bulk: [{ property, value, filePaths? }]` (omitted `filePaths` = all files in the source group).
- **Persistence keying (critical)**: overrides now **re-partition** files into sub-items, so they are stored at **source-group + relative_file_path + property_key** granularity (table `inbox_file_overrides`), **not** at sub-item id (which may be created/destroyed by the override). This replaces the fixed `override_filter/override_exposure_s/override_binning` columns (`0045`); existing values migrate (R-16). Staleness keying (size+mtime) carries over from R-4.

**Options considered.** Fixed-field extension (rejected: not future-proof; the task requires temperature/gain/object/"any future field") vs typed open map (recommended). The registry gives type-safety + validation without a fixed column list.

## R-14 — Generalized missing-mandatory-metadata gate (C, RQ5)

**Decision.** Generalize the confirm-time `missing_path_attributes` gate (`confirm.rs:332`, `metadata.rs:140`) to **`missing_mandatory_attributes`** = union of:
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

**Pre-confirm completion & re-split loop (user req 2026-06-23).** A plan is created **only from a fully-resolved single-type sub-item**. The flow is strictly: **(1)** scan → classify materializes sub-items (incl. a needs-review bucket for files missing mandatory attrs); **(2)** the user supplies the missing values in the metadata editor (`inbox.reclassify`, field-agnostic, fill-missing-only, index-only); **(3)** the system **re-runs classification + grouping and re-materializes/re-splits the sub-items** (a needs-review bucket can split into several proper single-type sub-items as values arrive); **(4)** only once a sub-item has no missing mandatory attributes can it be confirmed into a plan. I.e. **splitting/recalculating the inbox happens before confirm**, never inside plan creation. `inbox.confirm` rejects any item still carrying missing mandatory attributes (broadened `inbox.missing_path_attributes`).

## R-15 — Confirm simplification; delete mixed/split (A, RQ7 downstream)

**Decision.** Every item is single-type ⇒
- `inbox.confirm.action` is always "confirm"; **delete "split"** and the `("split","mixed")` validation (`confirm.rs:162`).
- Delete the per-type contiguous-grouping sort (`confirm.rs:197`) and the `confirm_mixed_emits_per_type_action_groups` test (`confirm.rs:1285`).
- `inbox_classifications.result` collapses: `classified | unclassified` (frame_type always set when classified); `mixed` is removed as a terminal result (a mixed folder simply yields multiple single-type items).
- **One `rootId` per item** (the existing optional `root_id` becomes THE per-item destination); keep the `destination_root_required` candidate-roots flow for >1 candidate; remove per-category root caching.
- `inbox_plan_links` 1:1 PK preserved — now satisfied structurally (one type → one plan).

## R-16 — Folded universal-gate / session-lifecycle drop (E)

**Decision.** Reverse the planned session **review lifecycle** (spec 045). Acquisition + calibration sessions become **derived, already-confirmed inventory** (like calibration masters today). Drop `discovered/candidate/needs_review/confirmed/rejected` review states, the Confirm/Re-open/Reject affordances, and the type-aware review predicate. `session_key` is deterministic once per-file metadata is fixed at inbox confirm, so there is nothing left to review. **Metadata-override persistence** (R-13) is the persisted, **editable** user metadata that defines the session; editing re-opens the same metadata table from the session, but no lifecycle gate exists.

**Cross-spec.** Obsoletes most of spec **045-review-state-real** (recommend marking it superseded) and reduces the spec **006** six-state `SessionState`. **Run `/speckit.sync.conflicts` immediately after apply.** Constitution boundary intact (reviewable plans retained; no image processing; durable DB audit retained).

## R-17 — Coordinate-based target resolution at light ingestion (user req 2026-06-23)

**Decision.** Resolve a light sub-group's **target by sky-coordinate proximity**, not by the `OBJECT` string.

- At light ingestion (the Inbox metadata-completion step), each light sub-group has a pointing (`RA`/`DEC` decimal, fallback converted `OBJCTRA`/`OBJCTDEC`). Compute **angular (great-circle) distance** between that pointing and every entry in the target database (gen-3 targets + SIMBAD-resolved catalog — specs 013/014/023/035) via haversine on (RA, Dec).
- Present a **ranked list of recommended targets** (nearest within a **FOV-aware radius** computed from `FOCALLEN` + pixel size by default), plus **free-text search** and **manual set**. The `OBJECT` header is used **only as the initial display name** for ingestion/sessions — **never for target search/matching** (search is coordinate-only).
- The chosen `target_id` becomes the sub-group's canonical target: it drives the group **label** (canonical name, not the NINA string), unifies the group key (resolved `target_id` supersedes raw pointing buckets so dither jitter near a bucket edge can't fork one target), and **auto-propagates to any project** that consumes these lights (closes spec 035 project↔target gap #1; [[spec-035-implementation]]).
- `target` is a **mandatory** light attribute (R-14) satisfiable by auto-resolution OR user pick; unresolved + unset pointing ⇒ needs-review bucket.

**Options considered.** (a) OBJECT-string match (today's implicit behavior) — *rejected*: free-text, inconsistent, user-set in NINA. (b) **Coordinate nearest-neighbor (recommended)** — robust to naming, leverages the existing SIMBAD/target DB, and enables auto project linkage. (c) Hybrid (coords primary, OBJECT as a tiebreaker/search seed) — adopted as the UX detail.

**Cross-spec.** Extends spec **035** (name-based SIMBAD resolution) with coordinate NN and **023** (target identity/history). Flag in `/speckit.sync.conflicts`. Performance: target DB is small; a bounded scan or simple spatial index suffices (no heavy dependency — Constitution).

## R-18 — Rotation, pointing, location & time semantics (real-FITS-verified 2026-06-23)

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
- **Flat↔light rotation match = (near-)exact, NOT tolerance-scored (user req 2026-06-23).** Even a small rotation change can invalidate a flat. Compare the **flat group's `ROTATANG` against the light group's `ROTATANG`** and **WARN on any deviation** beyond a tiny float-epsilon ("rotation differs by X° — flat may not be valid for these lights"). This **replaces** the old soft `flat_rotation_tolerance_deg` (0.5°) for flat↔light applicability.
  - **Drift is NOT detectable (user clarification 2026-06-23).** With a **manual rotator**, physical drift does **not** update `ROTATANG` (it stays at the set value) — only `OBJCTROT` (sky PA, treated as informational/conflated) would move. So we **cannot** determine intra-session rotator drift. The **only determinable signal is the deviation between the flat group's recorded rotation and the light group's recorded rotation** → warn on that. Within a session `ROTATANG` is effectively constant; it varies across setups/nights.
  - **Verified (WBPP calibration order):** flat-field correction is applied to **each raw light sub-frame** during calibration, *before* registration/integration — **never to the stacked master light**. Flat↔light matching is therefore at the **raw-sub-frame / light-group** level. Stacked/auto-stacked/processed master lights are already-calibrated **derived products**, excluded from our flat matching (they remain their own inbox items).
- **Light grouping rotation** — within one session `ROTATANG` is effectively constant (manual rotators don't report drift); `light_rotation_tolerance_deg` only matters across setups/nights where the recorded angle changes. Flat applicability is judged at the **group level** (flat `ROTATANG` vs light `ROTATANG`), never per-sub (drift is invisible to us).

**Decision — pointing.** Normalize all pointing to **decimal degrees** for distance math. Extract **both** `RA`/`DEC` (decimal) and `OBJCTRA`/`OBJCTDEC` (sexagesimal); **prefer full-precision `RA`/`DEC`** (the actual plate-solved image center) and convert `OBJCTRA`/`OBJCTDEC` as **fallback** when decimal is absent. *Why decimal first (not "ignore sexagesimal"):* it is directly usable for haversine without parsing and is higher precision — real data shows `RA=272.6820°` vs `OBJCTRA="18 10 38"→272.658°`, an ~0.02° gap from second-rounding (and possibly target-catalog vs solved-center). Sexagesimal carries the **same** information, just coarser and needing conversion — so we keep it as a fallback, we don't discard it. Light grouping + target-NN (R-17) match within a configurable **`pointing_tolerance_deg`**. Lights must also match the **whole optical train** (optic-train composite incl. `FOCALLEN`).

**Decision — observing-night (corrects the longitude claim).** NINA writes **`DATE-LOC`** (real: `2025-10-17T19:23:39` local vs `DATE-OBS` `15:23:39` UTC). With local time available, observing-night = the **local** calendar date under a noon boundary — **no observer longitude required.** Source priority: **`DATE-LOC` → (UTC `MJD-AVG`/`DATE-OBS` + longitude fallback only when local time absent, e.g. DWARF)**. So `SITE*`/location extraction is **not** needed for night-binning; it is extracted only for *future* grouping (user's earlier ask).

**Location keywords (real values) — software-dependent, same physical info.**
- NINA raw lights write `SITELAT`/`SITELONG`/`SITEELEV` (e.g. `24.839`/`55.383`/`101.0`). (Per-session value differences just mean shots taken from different physical locations — **not** a grouping signal; ignore.)
- PixInsight WBPP masters write `OBSGEO-B`/`OBSGEO-L`/`OBSGEO-H` and `LAT-OBS`/`LONG-OBS`/`ALT-OBS` (doc §2.8).
- All three conventions encode the same observer geodetic location. **Decision:** extract into one `observerLat/Long/Elev` with fallback chain `SITE* → OBSGEO-(B/L/H) → (LAT/LONG/ALT)-OBS`. **Future grouping only** (not a v1 grouping key, not needed for night-binning).

**Time basis (`MJD`, agreed).** `MJD-OBS` = MJD at exposure start (numeric UTC `DATE-OBS`); `MJD-AVG` = MJD at exposure **midpoint** (numeric `DATE-AVG`); both NINA 3.2+ only. For **ordering / dark-run span / UTC math** prefer `MJD-AVG → MJD-OBS → DATE-AVG → DATE-OBS`. For **observing-night** prefer `DATE-LOC` (above). Real data: `DATE-AVG=2025-10-17T15:23:55` (midpoint) vs `DATE-OBS=…:23:39` (start).

---

# Contract Deltas (language-neutral; regenerate TS surface)

> Files: `crates/contracts/core/src/inbox.rs`, `packages/contracts/`, `specs/041-inbox-plan-surface/contracts/operations.md`. specta camelCase.

### `inbox.list` → `InboxListItem`
- **ADD** `frameType: string` (always set for classified single-type items).
- **ADD** `sourceGroupId: string`, `groupKey: string`, `groupLabel: string` (D).
- **ADD** `sourceGroup: { relativePath: string; label: string; siblingCount: u32 }` (provenance "ingested together").
- **ADD** `missingMandatory: string[]` (per-item rollup; per-file detail in metadata DTO).
- Existing `group_target/group_frame_type/group_date/group_filter/group_exposure/group_instrument` become the item's own facts (one item = one group); retained for the frontend grouping tree.
- `is_master` / `master_frame_type` unchanged.

### `inbox.confirm` → `InboxConfirmRequest` / `Response`
- **REMOVE** the `("split","mixed")` semantics; `action` becomes optional/no-op (document; default behavior = confirm the single-type item).
- `rootId` (optional) = THE per-item destination root; keep `destination_root_required` typed error + `candidate_roots`.
- Response: drop per-type group semantics; keep `actions_summary {moveCount, catalogueCount}`, `destinations[]`.

### `inbox.reclassify` → field-agnostic + bulk
- **REQUEST**: `{ sourceGroupId | inboxItemId, overrides: [{ filePath, properties: Record<string, JsonValue> }], bulk?: [{ property: string, value: JsonValue, filePaths?: string[] }] }`. `properties` validated against the registry; precedence user > FITS.
- **RESPONSE**: the re-materialized set of sub-items (a reclassify can split/merge groups), each with `{ inboxItemId, groupKey, groupLabel, frameType, fileCount, missingMandatory[] }`, plus `needsReviewCount`.
- Reclassify operates at **source-group scope** (because it re-partitions); block only the affected source group's open plans.

### NEW `inbox.property_registry`
- Returns the typed registry (`[{ key, kind, unit, overridable, appliesTo[], validation }]`) so the UI renders a generic, future-proof metadata editor.

### NEW `inbox.target_recommendations` (R-17)
- REQUEST: `{ inboxItemId | sourceGroupId }` (a light sub-group). RESPONSE: `{ candidates: [{ targetId, name, separationDeg }], pointing: { raDeg, decDeg } | null, objectHint: string | null }` — ranked by angular separation within the configured radius; empty when no pointing. The UI also supports free search + manual set; the chosen `targetId` is written via `inbox.reclassify` (property `target`) and propagates to projects.

### `inbox.item.metadata` → `InboxFileMetadata`
- ADD the new extracted fields to the per-file DTO: `offset`, `setTempC`, `ccdTempC`, `raDeg`, `decDeg`, `rotationDeg`, `readoutMode`, `focalLengthMm`, `observerLat/Long/Elev` (all optional) — so the metadata table and grouping can display/edit them.

### `inbox.missing_path_attributes` (error code)
- Broaden meaning to **missing mandatory (grouping + path)** attributes; keep the wire code id for compatibility; details payload lists per-file missing attributes.

### Session contracts (E)
- **REMOVE** session review-state operations/fields (confirm/reopen/reject; `reviewFilter`). Sessions expose derived, confirmed inventory + an editable metadata view.

---

# Data-Model Deltas (→ new migration `0046_inbox_single_type.sql`)

- **NEW** `inbox_source_groups(id PK, root_id, relative_path, discovered_at, last_scanned_at, content_signature, format, lane, child_count)` — `UNIQUE(root_id, relative_path)`.
- **ALTER** `inbox_items`: ADD `source_group_id` (FK→inbox_source_groups), `group_key`, `group_label`, `frame_type` (authoritative); `content_signature` becomes per-sub-group. Replace `UNIQUE(root_id, relative_path)` → `UNIQUE(root_id, relative_path, group_key)` (SQLite table rebuild).
- **NEW** `inbox_file_overrides(id PK, source_group_id, relative_file_path, property_key, value, file_size_bytes, file_mtime, override_stale, set_at)` — `UNIQUE(source_group_id, relative_file_path, property_key)`. **Migrate** existing `inbox_classification_evidence.override_filter/override_exposure_s/override_binning/manual_override` into rows; then drop those columns.
- `inbox_classifications`: becomes per-sub-item; `result` CHECK collapses to `('classified','unclassified')` (drop `mixed`).
- **Sessions/lifecycle (E)**: remove the review-state columns/transitions from the acquisition/calibration session model; sessions are derived + editable-metadata only.

## Migration approach (RQ6)

Re-derivation is **filesystem-free** because per-file metadata is already persisted (`inbox_file_metadata`):
1. For each existing folder-level `inbox_items` row → create an `inbox_source_groups` row (copy root_id, relative_path, content_signature, format, lane).
2. Partition the folder's persisted evidence+metadata by the R-9 recipe → insert child single-type `inbox_items` (group_key/label/frame_type, per-sub-group signature). Folders never classified (no persisted metadata) → one `pending_classification` child that splits on next classify.
3. Migrate `override_*`/`manual_override` columns → `inbox_file_overrides` rows.
4. **`plan_open` items are NOT re-split** (a plan is linked 1:1). Keep such an item as a single legacy sub-item carrying its plan link until the plan resolves/discards; re-derivation into sub-items happens on the next classify after the plan closes. (Safe path; documented.)

---

# Planned Changes (per artifact — what `apply` will execute)

### spec.md
- Add **US10 Single-type sub-items at ingest**, **US11 Field-agnostic reclassify (typed registry + bulk)**, **US12 Missing-mandatory gate + needs-review bucket**, **US13 Source-group provenance**, **US14 Sessions as derived inventory (lifecycle drop)**, **US15 Coordinate-based target resolution at light ingestion + project propagation (R-17)**, **US16 Extended header extraction (offset/temp/pointing/rotation/readout/focal/observer-location; R-9 gap, R-18)**.
- Rewrite **US5** (auto-split) as **Retired** with a pointer to US10.
- Add **FR-034…FR-052** (granularity, recipe+config, bucketing, classify-then-split, composite identity, per-sub-group signature, provenance fields, property registry, field-agnostic+bulk reclassify, override persistence/keying, generalized gate, needs-review bucket, confirm simplification, one-root-per-item, lifecycle drop, derived sessions, migration).
- Add **SC-012…SC-017** (e.g. "a mixed folder yields N single-type items, 0 mixed"; "every item has exactly ≤1 plan"; "reclassify accepts any registry property incl. temperature/gain/object"; "no item with missing mandatory attrs can create a plan"; "no session exposes a review action").
- Update **Key Entities** (Source group; Single-type sub-item; Property registry; Override→derived session) and **Edge Cases** (continuous-dim bucketing; needs-review bucket; plan_open during migration; override moves a file between sub-items).

### plan.md
- Add **Phase 12 — Single-type ingest** and **Phase 13 — Lifecycle drop**; extend the source-file map: `scan.rs` (source groups), `classify.rs` (materialize sub-items), `reclassify.rs` (field-agnostic + source-group scope), `confirm.rs` (delete split/per-type sort; one root), new property-registry module, `metadata/{fits,xisf,core}` (extract CCD-TEMP/offset), `contracts/core/inbox.rs` + `packages/contracts`, `migrations/0046`, sessions/lifecycle removal, `plan_listener.rs`.

### research.md
- Add **R-9 … R-18** verbatim from the "Research Decisions" section above (incl. R-17 coordinate target resolution, R-18 rotation/pointing semantics + tolerances + MJD time basis).

### data-model.md
- Add the entities/migration/lifecycle deltas from "Data-Model Deltas" above.

### contracts/operations.md
- Apply the "Contract Deltas" above; add `inbox.property_registry`; remove session review ops.

### tasks.md
- Mark **T036/T037 Retired**; flag **T002/T005/T024–T028/T053/T056/T057 Reworked**.
- Add **Phase 12** tasks (foundational extraction; migration 0046; source-group + sub-item materialization in scan/classify; composite identity+signature; property registry crate + contract; field-agnostic+bulk reclassify; generic override persistence + migration of old columns; generalized gate + needs-review bucket; confirm simplification + delete split; contracts + binding regen; Layer-1 + vitest).
- Add **Phase 13** tasks (drop session review states/affordances; derived sessions; editable-metadata view; `sync.conflicts` with 045/006).

### quickstart.md
- Add scenarios: mixed folder → N single-type items + provenance tree; reclassify sets temperature/gain/object via the generic table (+ "set all"); missing-mandatory → needs-review bucket blocks plan; sessions show no review actions.

### checklists/requirements.md
- Re-open for US10–US14 / FR-034–FR-052 / SC-012–SC-017.

---

## After apply (workflow)
1. `/speckit.iterate.apply` → propagate the above into the artifacts.
2. `/speckit.sync.conflicts` → reconcile with **045** (mark superseded) and **006** (SessionState reduction). *(Mandatory — cross-spec impact.)*
3. `/speckit.tasks` regen if needed → `/speckit.analyze` → `/speckit.checkpoint.commit`.
4. Implementation does NOT begin until spec/plan/research/data-model/contracts/tasks pass review (Constitution gate).
