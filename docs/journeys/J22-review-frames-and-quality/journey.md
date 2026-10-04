---
id: J22
title: Review frames and record scoped quality decisions while building a View
version: 1
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [frame-review, view-review, targets, projects]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 066-view-selection, 067-frame-review, 065-project-goals, 064-library-inventory, D02, D03, D08, D10, specs/063-clean-rebuild-contract/decisions.md, specs/066-view-selection/spec.md, specs/067-frame-review/spec.md, specs/065-project-goals/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-d-inspect-frames-and-quality]
---

## Goal

While building a View, the user inspects frames and star measurements, excludes
poor frames from this View only, and records library usability decisions only
through explicit, scoped confirmations. Imported measurements keep their
provenance. Done means the saved View reads Ha 111 / 9h 15m, OIII 97 / 8h 05m
and 208 lights / 17h 20m, with six 30 Sep exclusions. Its last committed
revision survives restart. Library quality changes only through the scoped
confirmations in S11 and S13; a frame whose bytes change in place stops counting
as Usable until its reviewed bytes return. PlateVault writes no source file.

## Preconditions

- P1: J21 completed; saved View `NGC7000 HOO - Siril` holds five sessions (214 lights included, all Unreviewed) and no measurement is cached.
- P2: Frame-review properties of the J19 fixture: six named 30 Sep OIII frames have visibly trailed stars; one of the other 42 frames contains a saturated star whose PSF fit fails, at a recorded pixel position; at least one frame has a well-exposed unsaturated star at a recorded position.
- P3: A PixInsight SubframeSelector CSV export covering the five sessions with FWHM values, plus one row naming a file in no session, one filename present in two session subfolders, and one column with no units and no native equivalent.
- P4: The J19/P5 manifest is available.
- P5: For one named 18 Sep Ha frame, a backup of its original bytes and nanosecond mtime, and a replacement file of identical size with different pixel bytes, both kept outside PlateVault.

## Steps

### S1 — Open frame review {#S1}

- **Do:** Click **Review frames**.
- **Expect:** Every frame reads pending; progress is visible as native measurements are computed.
- **Trace:** flow D1 · PIX-FR-01

### S2 — Inspect a frame while measuring runs {#S2}

- **Do:** While measurement runs, click a 30 Sep frame row, then a different frame's measurement-plot point. Open the disclosure.
- **Expect:** Each chosen frame is highlighted in the list, plot, and preview at once. The disclosure shows header metadata and each measurement's source, method, and units. Measurement keeps progressing.
- **Trace:** flow D1, D2 · PIX-FR-01, PIX-FR-02 · D03

### S3 — Cancel measurement {#S3}

- **Do:** Click **Cancel** before measurement finishes.
- **Expect:** Further measurement stops. Frames without a value read **Not measured**; values already computed remain. The draft still includes 214 lights.
- **Expect (negative):** Cancel discards no selection, inclusion, or exclusion.
- **Trace:** flow D1, cross-flow "Measurement pending/failed" · PIX-FR-01 · PIX-AC-01

### S4 — Resume by reopening review {#S4}

- **Do:** Leave Frames and click **Review frames** again.
- **Expect:** Values computed before S3 appear immediately as cached; the remaining frames read pending and are measured until progress completes.
- **Trace:** flow D1 · PIX-FR-01 · PIX-AC-01

### S5 — Inspect pixels without changing data {#S5}

- **Do:** On a 30 Sep frame, zoom to full resolution, pan, compare the fixed center and corner regions, step to the next and previous frame, and apply then remove a strong display stretch.
- **Expect:** The preview responds to each control. The frame's measured values are identical with the stretch on and off.
- **Expect (negative):** Source bytes still match P4; no measurement is recomputed from the stretched display.
- **Trace:** flow D2 · PIX-FR-03, PIX-FR-04 · PIX-AC-02 · root SC-005 · D03

### S6 — Inspect a fitted star {#S6}

- **Do:** Enable **Stars** and select the well-exposed star of P2.
- **Expect:** Details show its location, measurement state, PSF model, shape and width values, any warnings, and observed, fitted, and residual cutouts when available. HFR and FWHM carry distinct labels and units.
- **Trace:** flow D3 · PIX-FR-05, PIX-FR-06

### S7 — Inspect a failed fit {#S7}

- **Do:** Select the saturated star of P2.
- **Expect:** It reads failed fit with a saturation warning.
- **Expect (negative):** No FWHM or other fitted-width number is shown for it.
- **Trace:** flow D3 · PIX-FR-05 · PIX-AC-03

### S8 — Exclude six frames from this View {#S8}

- **Do:** Select the six trailed 30 Sep frames and click **Exclude from View**.
- **Expect:** The six frames read excluded in this View and the 30 Sep row reads 42 of 48 in the View.
- **Expect (negative):** The six files remain on disk. Their library quality stays Unreviewed; the NGC 7000 usable total, other Views, and Project rejection state do not change.
- **Trace:** flow D4 · VSEL-FR-10 · VSEL-AC-04

### S9 — Show and restore excluded rows {#S9}

- **Do:** Show excluded rows, restore one, then exclude it again.
- **Expect:** The restored frame returns to the View (43 of 48) and leaves it again (42 of 48).
- **Trace:** flow D4 · VSEL-FR-10

### S10 — Read the View totals {#S10}

- **Do:** Read the selection summary.
- **Expect:** It reads Ha 111 / 9h 15m, OIII 97 / 8h 05m across 24, 26, and 30 Sep, and 208 lights / 17h 20m, with no unresolved member.
- **Expect (negative):** No library quality state has changed. Exact membership is not yet confirmed; that happens in Review preparation (J24/S8).
- **Trace:** flow D4, C5 · VSEL-FR-08 · VSEL-AC-04 · root SC-004 · D02

### S11 — Mark included frames usable {#S11}

- **Do:** Select the 208 included frames, click **Mark included frames usable**, read the named scope, and confirm.
- **Expect:** The confirmation names library scope and 208 frames. Afterwards those frames read Usable and NGC 7000 usable integration reads Ha 9h 15m and OIII 8h 05m.
- **Expect (negative):** The six excluded frames stay Unreviewed. View membership does not change.
- **Trace:** flow D5 · VSEL-FR-11, LIB-FR-08 · VSEL-AC-05 · D10

### S12 — Meet a checklist item without closing the Project {#S12}

- **Do:** Open Project `NGC 7000 HOO`, read Ha progress, edit the Ha item from 10h to 9h, and read it again.
- **Expect:** Before the edit, Ha reads usable 9h 15m and unmet. After the edit, Ha reads met; OIII reads usable 8h 05m and unmet. The Project stays open.
- **Expect (negative):** Meeting an item creates no View and changes no quality state.
- **Trace:** flow B2 · PRJ-FR-04 · PRJ-AC-03 · D10

### S13 — Apply the other scopes {#S13}

- **Do:** For one excluded 30 Sep frame choose **Mark unusable in library**, read the scope, and confirm. For a second excluded frame choose **Reject for Project**, read the scope, and confirm.
- **Expect:** The first confirmation names library scope; the frame then reads Unusable, NGC 7000 usable integration is unchanged, and Unreviewed OIII integration falls by 0h 05m. The second confirmation names Project `NGC 7000 HOO`; the Project shows the frame as Project-rejected, and its library quality stays Unreviewed.
- **Expect (negative):** The Project rejection changes no library usable total. Neither action changes the View's 208 included frames.
- **Trace:** flow D5 · VSEL-FR-11 · D10

### S13a — See an Unusable frame start excluded {#S13a}

- **Do:** From Sessions, create a standalone View from 30 Sep only and read its frames. Close it without saving.
- **Expect:** 47 frames are included (the 42 Usable and 5 Unreviewed frames). The frame marked Unusable in S13 reads visibly excluded with an explicit include action.
- **Expect (negative):** The Unusable frame is not included without that explicit action. `NGC7000 HOO - Siril` is unchanged.
- **Trace:** flow C5 · VSEL-FR-08 · D02

### S14 — Import measurements {#S14}

- **Do:** Click **Import measurements**, choose the P3 CSV, review the mapping, and confirm it.
- **Expect:** The mapping review lists matched rows, the unmatched row, and the ambiguous row, with units and source/method. After confirmation, imported values show as imported, with their units, next to native values.
- **Expect (negative):** No native value is replaced. No frame is excluded, restored, or changes quality, and the View still reads 208.
- **Trace:** flow D6 · PIX-FR-06, PIX-FR-07, PIX-FR-08 · PIX-AC-04 · D03

### S15 — Inspect unresolved import rows {#S15}

- **Do:** Open the ambiguous row, the unmatched row, and the column with no units.
- **Expect:** The ambiguous row is attached to no frame until the user resolves it; the unmatched row is attached to none; the column reads unavailable.
- **Expect (negative):** The column is not shown as built-in FWHM or HFR.
- **Trace:** flow D6 failure branch · PIX-FR-07 · PIX-AC-05

### S15a — Replace a reviewed frame in place {#S15a}

- **Do:** Outside PlateVault, overwrite the P5 frame with its replacement and restore its recorded mtime. Index `Astro-T7 captures` again, then click **Review frames**.
- **Expect:** After the rescan completes, the frame reads ChangedContent with its previous Usable decision kept as history, it is listed under the ChangedContent filter, and NGC 7000 usable Ha integration reads 9h 10m. In Review frames its cached measurements never read valid; the frame is measured again from its current bytes, and the earlier values show as history for the earlier content.
- **Expect (negative):** The frame counts as neither Usable nor Unreviewed. No quality decision is recorded, and the View still reads 208 lights / 17h 20m.
- **Trace:** flow D1 · LIB-FR-09, PIX-FR-01 · LIB-AC-14, PIX-AC-10 · D10 · J19/G4

### S15b — Restore the reviewed bytes {#S15b}

- **Do:** Restore the P5 frame's original bytes and recorded mtime, index `Astro-T7 captures` again, and reopen **Review frames**.
- **Expect:** The rehash matches the reviewed digest. The frame reads Usable, NGC 7000 usable Ha integration reads 9h 15m, and its earlier cached measurements read valid again.
- **Expect (negative):** The restoration records no new quality decision. Source bytes equal P4 again.
- **Trace:** flow D1 · LIB-FR-09, PIX-FR-01 · LIB-AC-14 · J19/G4

### S16 — Save, then restart with an unsaved change {#S16}

- **Do:** Click **Save View**. Restore one excluded frame without saving, quit PlateVault, relaunch, and reopen `NGC7000 HOO - Siril`.
- **Expect:** The View restores the last committed revision: 208 lights / 17h 20m with the same six exclusions, measurement sources, and S11/S13 quality states. The unsaved restore is identified separately as a recoverable unsaved operation.
- **Expect (negative):** The unsaved restore is not applied to the committed revision without the user's action.
- **Trace:** root SC-004 · VSEL-FR-13 · D08

## Success criteria

- SC1: The View reads exactly Ha 111 / 9h 15m, OIII 97 / 8h 05m, and 208 / 17h 20m after S10 and after S16.
- SC2: Source bytes equal P4 for 100% of files at S5 and at the end.
- SC3: Measured values are identical with stretch on and off (S5); the failed fit shows 0 width numbers (S7).
- SC4: Library quality decisions change only at S11 (208 frames) and S13 (1 frame); the Project rejection changes 0 library totals, and S15a and S15b change applicability only.
- SC5: S14 replaces 0 native values and lists both the unmatched and the ambiguous row.
- SC6: The Project stays open after the Ha item is met (S12).
- SC7: With the replacement in place, the frame reads ChangedContent, usable Ha reads 9h 10m and its cached values read valid 0 times (S15a); after S15b usable Ha reads 9h 15m again.

## Known gaps

- G1: Not validated — the rebuilt application does not exist. Product behavior follows the specs and the defaults that the authorized autonomous run set in decisions D02, D03, D08, and D10; no implementation has been validated against them.
- G2: Unresolved implementation qualification — numerical measurement methods, metric set, masks, saturation, background, aperture, and tolerances need fixture qualification in PIX planning (D03). The P2 fixture is mono; CFA inspection as the recorded mosaic plane (D03) is not exercised. Blocks readiness.

## Delta log

- No entries (initial draft, version 1).
