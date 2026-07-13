---
status: applied
created: 2026-06-23
applied: 2026-06-23
change_request: "Pre-implementation artifact corrections for the single-type ingest iteration, surfaced by /speckit.analyze — alignment only, no new product behavior. (C1) Renumber the new migration 0046->0047 throughout data-model.md and tasks.md T061 (file 0047_inbox_single_type.sql): two 0046_*.sql already exist on main (0046_session_canonical_target, 0046_target_constellation_magnitude) so a third 0046 breaks sqlx::migrate!. (C2) Mark FR-020, User Story 5, and SC-008 (auto-split of mixed folders) SUPERSEDED by FR-034/FR-050/SC-012. (C3) Fix research.md R-9 extraction-gap table rotation row: ROTATANG->rotatorAngleDeg (mechanical, flat-match key), OBJCTROT->skyRotationDeg (informational only). (C6) Refresh plan.md Summary, Technical Context, and Constitution Check to cover US8-US16 / FR-025-FR-054 and re-assert the post-design constitution gate. (C4) Add or explicitly scope a task for flat<->light ROTATANG matching + metadata-quality warning and UI surfacing (FR-040). (C5) Add pixel-size (XPIXSZ/PIXSIZE) to the extended extraction set (FR-053/T062) so the FOV-aware target radius (FR-052/R-17/T074) is computable, or define a fixed-radius fallback. (C8) Specify in FR-047/R-14/T070 that 'target' is a hard mandatory light key satisfiable by coordinate auto-resolution OR user pick; no pointing and no set target -> needs-review. (C9) Note in FR-017/Edge Cases that under source-groups a single-type sub-item has uniform provenance. (C10) Mark the pre-iteration inbox.reclassify and inbox.confirm contract shapes superseded; inbox.confirm 'action' is removed (not optional no-op)."
scope: "Feature-wide (artifact alignment / pre-implementation correction)"
---

## Change Summary

Align the spec-041 artifacts with the already-decided single-type ingest pivot before implementation begins: fix a migration-number collision, retire requirements the pivot superseded, correct an internal rotation-keyword contradiction, close two thin coverage gaps (flat<->light rotation matching; FOV pixel-size), refresh the plan's constitution gate for the expanded scope, and reconcile stale contract shapes. No new product behavior — corrections only.

## Implementation Progress

- **Tasks completed**: T001–T060 (prior iterations, merged to `main`; 60 of 79 total).
- **Remaining**: T061–T079 (single-type ingest + Phase 13), 0 of 19 started.
- **Current phase**: Phase 12 (foundational T061/T062 not yet begun).
- **Files changed on branch**: 0 (fresh branch `041-single-type-impl` off `origin/main`).
- **Potential task completions to mark**: none (no code yet).
- **Adhoc changes**: None.

## Impact Assessment

| Artifact | Action | Details |
|----------|--------|---------|
| spec.md | Modify | C2 supersede FR-020 / US5 / SC-008; C8 FR-047 target-mandatory clarification; C9 FR-017 + Edge Cases provenance note |
| plan.md | Modify | C6 refresh Summary, Technical Context, Constitution Check for US8–US16 / FR-025–FR-054; head 0045→0047; re-assert post-design gate |
| tasks.md | Modify + Add | C1 T061 migration 0046→0047; C4 add flat<->light rotation task (T080); C5 T062 pixel-size + T074 FOV fallback note; C8 T070 target-gate note |
| data-model.md | Modify | C1 rename 0046_inbox_single_type.sql → 0047 (heading, "head after 0045", iteration title, DDL summary); C5 add pixel-size field to extended `inbox_file_metadata` |
| research.md | Modify | C3 fix R-9 extraction-gap rotation row (ROTATANG=key, OBJCTROT=informational); C5 pixel-size in R-9 table + R-17 FOV-radius fallback; C8 R-14 target-mandatory note |
| contracts/operations.md | Modify | C10 mark pre-iteration `inbox.reclassify` (fixed-field) and `inbox.confirm` (`action` optional/no-op) shapes SUPERSEDED by the 2026-06-23 section; state `action` is **removed** |
| quickstart.md | Modify | Add T079 verification scenarios for the flat-rotation deviation warning (C4) and the FOV-radius fallback (C5) |

## Risk Checks

- [x] No completed tasks invalidated — T061–T079 unstarted; FR-020/US5/SC-008 supersession is documentation-only (their impl T036/T037 was already retired by the applied single-type pivot; no code rework).
- [x] No scope boundary violations — all changes align artifacts with the already-decided pivot; C4/C5 surface small impl already implied by FR-040 / FR-052, not new intent.
- [x] No downstream dependency breaks — migration renumber 0046→0047 is isolated; new task T080 adds no ordering conflict (depends on T062/T064).

## Planned Changes

### spec.md
- **C2 / FR-020**: append `**[SUPERSEDED by FR-034 / FR-050 / SC-012]**` and a one-line rationale — under single-type sub-items a mixed folder materializes N single-type items at classify, each confirmed into its own 1:1 plan; there is no mixed item to auto-split.
- **C2 / User Story 5**: prefix the US5 heading with `[SUPERSEDED]` and add a note pointing to US10 (single-type sub-items at ingest) as the replacement; keep the text for history.
- **C2 / SC-008**: mark `[SUPERSEDED by SC-012]` (a mixed folder produces N single-type items and zero "mixed" items).
- **C8 / FR-047**: add a sentence — `target` is a hard mandatory attribute for light frames, satisfiable by coordinate auto-resolution (FR-052) **or** an explicit user pick; a light with no pointing and no user-set target routes to the needs-review bucket (consistent with US15 scenario 3).
- **C9 / FR-017 + Edge Cases**: add a note — under the source-group model a single-type sub-item derives from one leaf folder = one source = one `organization_state`, so its provenance is uniform; the earlier "one item's plan MAY contain both catalogue and move actions" / mixed-provenance edge case no longer applies at the sub-item level.

### plan.md
- **C6 / Summary + Technical Context**: extend to cover the destination-model iteration (US8–US9 / FR-025–FR-033) and the single-type ingest iteration (US10–US16 / FR-034–FR-054); correct "7 user stories (US1–US7), 28 functional requirements" → the current 16 user stories / FR-001–FR-054 count; correct "currently through 0044 … New migration 0045" → "0045 applied; this iteration adds 0047 (0046 numbers are already taken)".
- **C6 / Constitution Check**: re-assert the post-design gate for the new scope — add explicit notes that the session-lifecycle drop (FR-051) keeps reviewable plans + durable audit (Principle II/V), coordinate target resolution adds no heavy dependency (Principle IV), generic overrides remain index-only / never written to files (Principle I/III), and extended extraction stays lazy (no eager hashing). Record verdict PASS.

### tasks.md
- **C1 / T061**: change "Migration 0046" → "Migration 0047" and name the file `0047_inbox_single_type.sql`; add a parenthetical noting 0046 is already used by `0046_session_canonical_target.sql` and `0046_target_constellation_magnitude.sql`.
- **C4 / new T080 [US16/US10]** (Phase 12): flat<->light rotation matching — compare a flat group's `ROTATANG` against the light group's `ROTATANG` (near-exact), emit the metadata-quality warning on any deviation, honour `flat_rotation_required` (default off) when `ROTATANG` is absent, and surface the warning in the UI (FR-040). Depends on T062 (extraction) + T064 (grouping).
- **C5 / T062**: add `XPIXSZ`/`PIXSIZE` (pixel size, with XISF fallback) to the extended-extraction field list (FR-053).
- **C5 / T074**: add a note — the FOV-aware radius uses `FOCALLEN` + pixel size + `NAXIS1/2`; when pixel size is unavailable, fall back to a configurable fixed radius (FR-052/R-17).
- **C8 / T070**: add a note — the derived mandatory set treats `target` as a hard light key satisfiable by auto-resolution or user pick; unresolved + no pointing → needs-review.

### data-model.md
- **C1**: rename the migration throughout — "Iteration 2026-06-23: Single-type sub-items … New migration `0046_inbox_single_type.sql` (head after 0045)" → `0047_inbox_single_type.sql` (head after 0045; 0046 is already taken); update the "## Migration 0046 summary (DDL intent)" heading and the "Migration 0046 re-derivation approach" heading to 0047.
- **C5**: add `pixel_size_um REAL NULL` (FITS `XPIXSZ`/`PIXSIZE`; XISF `Image:PixelSize`) to the extended `inbox_file_metadata` field table and the DDL summary; note it feeds the FOV-radius computation (R-17).

### research.md
- **C3 / R-9 extraction-gap table**: replace the single conflated `rotation | OBJCTROT | ROTATANG | light+flat grouping` row with two rows consistent with R-18 and the property registry — `rotatorAngleDeg | ROTATANG (= ROTATOR, mechanical) | — | flat-match key + tolerant light grouping` and `skyRotationDeg | OBJCTROT (sky PA) | — | informational only, NOT a flat key`.
- **C5 / R-9 + R-17**: add a `pixelSize | XPIXSZ/PIXSIZE | XISF Image:PixelSize` row to the extraction table; in R-17 note that the FOV-aware radius is `FOCALLEN` + pixel size + sensor dimensions, with a configurable fixed-radius fallback when pixel size is absent.
- **C8 / R-14**: note in the mandatory-property discussion that `target` (light) is satisfiable by coordinate auto-resolution (R-17) or user pick and otherwise lands in needs-review.

### contracts/operations.md
- **C10**: add a `**[SUPERSEDED by the Iteration 2026-06-23 section below]**` marker on the original `inbox.reclassify` (fixed-field `{ filter?, exposure_s?, binning? }`) and `inbox.confirm` blocks; in the 2026-06-23 `inbox.confirm` delta, change "`action` becomes optional / no-op" → "`action` is **removed**" so the contract states a single, unambiguous shape.

### quickstart.md
- Add two T079 verification scenarios: (1) a flat group whose `ROTATANG` differs from the matched light group surfaces the rotation-deviation warning (C4); (2) a light with `FOCALLEN` but no pixel size still resolves target candidates using the fixed-radius fallback (C5).
