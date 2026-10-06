---
id: J22
title: Review frames and record scoped quality decisions in a processing run
version: 2
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [frame-review, view-review, targets, projects]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 066-view-selection, 067-frame-review, D02, D03, D08, D10, D19, D-W13, D-W14, D-W15, D-W22, D-W36, D-W40, D-W42, D-W44, D-W53, D-W54, D-W66, specs/063-clean-rebuild-contract/decisions.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/066-view-selection/spec.md, specs/067-frame-review/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-d-inspect-frames-and-quality]
---

## Goal

In the Review step of processing run `NGC7000-HOO-Siril`, the user inspects
frames and star measurements in the table, filmstrip and grid views, culls with
Lightroom-style hotkeys, excludes poor frames from this run only, and records
quality at two levels: library quality, which is global, and "Reject for this
Project only". Imported measurements keep their provenance and never read as
content-verified. Done means the run's saved membership revision reads Ha 111 /
9h 15m, OIII 97 / 8h 05m and 208 lights / 17h 20m, with six 30 Sep exclusions,
and survives restart. Every included frame reads Picked (library Usable). Of the
six excluded frames, five read Rejected with scope Library and one reads
Rejected with scope This Project. A frame whose bytes change in place stops
counting as Usable until its reviewed bytes return. PlateVault writes no
source file.

## Preconditions

- P1: J21 completed: `NGC7000-HOO-Siril` holds saved membership revision 1 with the five sessions (214 lights, all Unreviewed), and no measurement is cached. Project `NGC 7000 HOO` reads Ha `9h 15m in project` with `12h 35m captured` against goal 10h, and OIII `8h 35m in project` with `10h 35m captured` against goal 12h.
- P2: Frame-review properties of the J19 fixture: six named 30 Sep OIII frames have visibly trailed stars; one of the other 42 frames contains a saturated star whose PSF fit fails, at a recorded pixel position; at least one frame has a well-exposed unsaturated star at a recorded position.
- P3: A PixInsight SubframeSelector CSV export covering the five sessions with FWHM values, plus one row naming a file in no session, one filename present in two session subfolders, and one column with no units and no native equivalent.
- P4: The J19/P5 manifest is available.
- P5: For one named 18 Sep Ha frame, a backup of its original bytes and nanosecond mtime, and a replacement file of identical size with different pixel bytes, both kept outside PlateVault.
- P6: For one named 26 Sep OIII frame that P3 names, a backup of its original bytes and nanosecond mtime and a same-size variant with different pixel bytes, both kept outside PlateVault.
- P7: Two named 28 Sep Ha frames, F1 and F2, adjacent in the default list order.

## Steps

### S1 — Open frame review {#S1}

- **Do:** Click the run's **Review** step.
- **Expect:** Frame review opens in the table view. The frame table sits at the top across the full width at about 8 rows. The preview, with its histogram and star cutouts, fills the rest, and the plots run across the session in the bottom strip. Every frame reads pending, and progress is visible as native measurements are computed.
- **Trace:** flow D1 · PIX-FR-01, PIX-FR-10 · D-W13, D-W22

### S2 — Inspect a frame while measuring runs {#S2}

- **Do:** While measurement runs, click a 30 Sep frame row, then a different frame's measurement-plot point. Open the disclosure.
- **Expect:** Each chosen frame is highlighted in the table, the plots and the preview at once. The disclosure shows header metadata and each measurement's source, method and units. Measurement keeps progressing.
- **Trace:** flow D1, D2 · PIX-FR-01, PIX-FR-02 · D03

### S3 — Cancel measurement {#S3}

- **Do:** Click **Cancel** before measurement finishes.
- **Expect:** Further measurement stops. Frames without a value read **Not measured**; values already computed remain. The draft still includes 214 lights.
- **Expect (negative):** Cancel discards no selection, inclusion or exclusion.
- **Trace:** flow D1, cross-flow "Measurement pending/failed" · PIX-FR-01 · PIX-AC-01

### S4 — Resume by reopening review {#S4}

- **Do:** Leave the Review step and open it again.
- **Expect:** Values computed before S3 appear immediately as cached; the remaining frames read pending and are measured until progress completes.
- **Trace:** flow D1 · PIX-FR-01 · PIX-AC-01

### S5 — Inspect pixels without changing data {#S5}

- **Do:** On a 30 Sep frame press **Z** to zoom to 1:1 and pan. Compare the fixed centre and corner regions. Press **→** and **←** (then **K** and **J**) to step frames. Press **C**, choose a reference frame, zoom and pan, and press **C** again. Press **F** twice. Apply a strong display stretch, then remove it.
- **Expect:** **Z** toggles between fit and 1:1. Each arrow and **J**/**K** press makes the next or previous frame current. Compare mode shows the current frame beside the reference with linked zoom and pan. **F** enters and leaves fullscreen. The preview, thumbnails and histogram respond to the stretch, and the frame's measured values are identical with the stretch on and off.
- **Expect (negative):** Source bytes still match P4; no measurement is recomputed from the stretched display.
- **Trace:** flow D2 · PIX-FR-03, PIX-FR-04, PIX-FR-13 · PIX-AC-02 · root SC-005 · D03, D-W13, D-W14

### S5a — Switch views and table heights {#S5a}

- **Do:** With the table at about 8 rows, drag its handle to about 12 rows. Press **T** three times. Press **G**, then return to the table view.
- **Expect:** The first **T** shows the one-line filmstrip with thumbnails, the second the full-height table, and the third the table at the dragged 12-row height. **G** shows the grid of thumbnails. The table, filmstrip and grid show the same frame as current, and the plots and preview show that frame. The grid shows a pending state for any thumbnail not yet decoded.
- **Expect (negative):** Decoding a thumbnail starts no built-in measurement, and no thumbnail value is used as a measurement.
- **Trace:** flow D2 · PIX-FR-02, PIX-FR-10, PIX-FR-11, PIX-FR-12 · PIX-AC-07, PIX-AC-15 · D-W22, D-W40

### S5b — Change frame names and columns {#S5b}

- **Do:** Switch the frame-name display template to another preset. Hide one column. Sort by FWHM. Hover a frame name, then open the inspector.
- **Expect:** The Name column re-renders for every frame with the new preset. The hidden column disappears from the table. Sorting orders frames by FWHM value. The full path shows on hover and in the inspector.
- **Expect (negative):** No file is renamed; the manifest still matches P4.
- **Trace:** flow D2 · PIX-FR-16 · PIX-AC-17 · D-W15

### S6 — Inspect a fitted star {#S6}

- **Do:** Enable **Stars** and select the well-exposed star of P2.
- **Expect:** Details show its location, measurement state, PSF model, shape and width values, any warnings, and observed, fitted and residual cutouts when available. HFR and FWHM carry distinct labels and units.
- **Trace:** flow D3 · PIX-FR-05, PIX-FR-06

### S7 — Inspect a failed fit {#S7}

- **Do:** Select the saturated star of P2.
- **Expect:** It reads failed fit with a saturation warning.
- **Expect (negative):** No FWHM or other fitted-width number is shown for it.
- **Trace:** flow D3 · PIX-FR-05 · PIX-AC-03

### S7a — Select by threshold {#S7a}

- **Do:** Select frames with FWHM above 3.5", then clear the selection.
- **Expect:** Exactly the measured frames with FWHM above 3.5" are selected, and the plots highlight them. Any frame without an FWHM value is named Not measured and stays unselected.
- **Expect (negative):** Threshold selection changes no quality state and no membership.
- **Trace:** flow D2 · PIX-FR-08, PIX-FR-15 · PIX-AC-14 · D-W13

### S8 — Exclude six frames from this run {#S8}

- **Do:** Select the six trailed 30 Sep frames and click **Exclude from run**.
- **Expect:** The six frames read excluded in this run, and the 30 Sep row reads 42 of 48 in the run.
- **Expect (negative):** The six files remain on disk. Their library quality stays Unreviewed. The NGC 7000 usable total, the other runs of the Project and the Project's rejection records do not change.
- **Trace:** flow D4 · VSEL-FR-10 · VSEL-AC-04 · D-W3

### S9 — Show and restore excluded rows {#S9}

- **Do:** Show excluded rows, restore one, then exclude it again.
- **Expect:** The restored frame returns to the run (43 of 48) and leaves it again (42 of 48).
- **Trace:** flow D4 · VSEL-FR-10

### S10 — Read the run totals and save {#S10}

- **Do:** Read the selection summary. Click **Save run**, then open Project `NGC 7000 HOO`.
- **Expect:** The summary reads Ha 111 / 9h 15m and OIII 97 / 8h 05m across 24, 26 and 30 Sep, and 208 lights / 17h 20m, with no unresolved member. The run reads saved membership revision 2. The Project reads Ha `9h 15m in project` with `12h 35m captured`, and OIII `8h 05m in project` with `10h 35m captured`. The six excluded frames leave "in project" and still count "captured".
- **Expect (negative):** No library quality state has changed.
- **Trace:** flow D4, C5 · VSEL-FR-08, VSEL-FR-12, VSEL-FR-16 · VSEL-AC-04 · PRJ-FR-04, PRJ-FR-21 · D02, D-W44, D-W66

### S11 — Mark included frames usable {#S11}

- **Do:** Select the 208 included frames, click **Mark included frames usable**, read the named scope, and confirm.
- **Expect:** The confirmation names library scope and 208 frames. Afterwards those frames read Picked (library Usable), and NGC 7000 usable integration reads Ha 9h 15m and OIII 8h 05m.
- **Expect (negative):** The six excluded frames stay Unreviewed. Run membership does not change.
- **Trace:** flow D5 · VSEL-FR-11 · LIB-FR-08 · VSEL-AC-05 · D10, D-W42

### S11a — Cull with hotkeys {#S11a}

- **Do:** In the table make F1 current and press **X**. Press **⌘3**, then **⌘1**. Make F1 current again. Turn auto-advance off and press **P**, then **Shift+P**. Turn auto-advance back on.
- **Expect:** **X** applies at once: F1 reads Rejected with scope Library, and F2 becomes current. The draft holds 207 lights and lists F1 with the reason "Rejected". NGC 7000 usable Ha reads 9h 10m. **⌘3** lists only F1, and **⌘1** lists every frame. With auto-advance off, **P** makes F1 Picked again, F1 stays current, and the draft holds 208 lights with NGC 7000 usable Ha 9h 15m. **Shift+P** keeps F1 Picked and makes F2 current.
- **Expect (negative):** No mark asks for confirmation. Saved membership revision 2 is unchanged throughout.
- **Trace:** flow D5 · PIX-FR-13, PIX-FR-14 · VSEL-FR-15 · PIX-AC-12, VSEL-AC-23 · D-W14, D-W42, D-W53, D-W54

### S11b — Reject a frame for this Project only {#S11b}

- **Do:** On F2 open the frame menu and choose **Reject for this Project only**. Read the Project's Ha goal. Then choose **Clear Project reject** on F2 and read the goal again.
- **Expect:** F2 reads Rejected with scope This Project and its library quality stays Usable. The draft holds 207 lights and lists F2 with the reason "Rejected". Ha reads `9h 10m in project`, and its captured value stays `12h 35m`. After **Clear Project reject**, F2 reads Picked, the draft holds 208 lights, and Ha reads `9h 15m in project`.
- **Expect (negative):** NGC 7000 usable Ha stays 9h 15m. No single-key hotkey performs this action. Saved membership revision 2 is unchanged.
- **Trace:** flow D5 · PIX-FR-14 · VSEL-FR-11, VSEL-FR-15 · VSEL-AC-11, PRJ-AC-08 · PRJ-FR-04 · D10, D-W42, D-W44, D-W54, D-W66

### S12 — Meet a goal without closing the Project {#S12}

- **Do:** Open Project `NGC 7000 HOO` and read the Ha goal. Edit the Ha goal from 10h to 9h and read it again. Edit it back to 10h.
- **Expect:** Before the edit, Ha reads `9h 15m in project` against goal 10h, unmet, with `12h 35m captured` beside it. At 9h it reads met. Back at 10h it reads unmet again. The Project stays open throughout.
- **Expect (negative):** Meeting a goal creates no run, marks no Project Done and changes no quality state.
- **Trace:** flow B2 · PRJ-FR-04 · PRJ-AC-03 · D10, D-W36, D-W66

### S13 — Mark the excluded frames in the grid {#S13}

- **Do:** Show excluded rows and press **G**. Select the six excluded 30 Sep frames and press **X**. Then select only the first of them, press **U**, and choose **Reject for this Project only** from its frame menu. Press **⌘3**. Return to the table view. Leave the Review step and open it again in the grid.
- **Expect:** All six read Rejected with scope Library after **X**, and NGC 7000 Unreviewed OIII integration falls by 0h 30m. After **U** and the Project reject, the first frame reads Rejected with scope This Project and its library quality is Unreviewed. **⌘3** lists exactly the six frames, with five labelled Library and one labelled This Project. The table keeps the same selection, current frame, filter and sort as the grid. On reopening, the grid shows the cached thumbnails with no pending state.
- **Expect (negative):** The draft still holds 208 lights, and NGC 7000 usable integration and the Project's "in project" and "captured" values are unchanged. No mark asks for confirmation.
- **Trace:** flow D5 · PIX-FR-11, PIX-FR-12, PIX-FR-13, PIX-FR-14 · VSEL-FR-15 · PIX-AC-16 · PRJ-FR-04 · D10, D-W40, D-W42, D-W54, D-W66

### S14 — Import measurements {#S14}

- **Do:** Overwrite the P6 frame in place with its variant and restore its recorded mtime. Click **Import measurements**, choose the P3 CSV, review the mapping, and confirm it. Then restore the P6 frame's original bytes and recorded mtime.
- **Expect:** The mapping review lists matched rows, the row with no matching frame, and the ambiguous row, with units and source/method. It also lists the P6 row for review, because the frame's bytes differ from the digest recorded when PlateVault measured it. After confirmation, imported values show as imported and content unverified, with their units, next to native values.
- **Expect (negative):** No imported value attaches to the P6 frame, and no imported value reads verified. Every native value, exclusion and quality state stays as it was, and the run still reads 208 lights.
- **Trace:** flow D6, cross-flow "External changes" · PIX-FR-06, PIX-FR-07, PIX-FR-08 · PIX-AC-04, PIX-AC-11 · D03, D19

### S15 — Inspect unresolved import rows {#S15}

- **Do:** Open the ambiguous row, the row with no matching frame, and the column with no units.
- **Expect:** The ambiguous row is attached to no frame until the user resolves it. The row with no matching frame is attached to none, and the column reads unavailable.
- **Expect (negative):** The column is not shown as built-in FWHM or HFR.
- **Trace:** flow D6 failure branch · PIX-FR-07 · PIX-AC-05

### S15a — Replace a reviewed frame in place {#S15a}

- **Do:** Outside PlateVault, overwrite the P5 frame with its replacement and restore its recorded mtime. Open NGC 7000 and read its usable Ha integration. Index `Astro-T7 captures` again, then open the run's Review step.
- **Expect:** Before the rescan, usable Ha still reads 9h 15m, labelled as last verified at S11. After the rescan completes, the frame reads ChangedContent with its previous Picked decision kept as history, and it is listed under the ChangedContent filter. NGC 7000 usable Ha integration reads 9h 10m, labelled as verified at this rescan. In frame review its cached values never read valid, its imported S14 values show as history, and its thumbnail is decoded again. The frame is measured again from its current bytes, and the earlier cached values show as history for the earlier content.
- **Expect (negative):** Opening NGC 7000 starts no rehash. The frame counts as neither Usable nor Unreviewed after the rescan. No quality decision is recorded, and the run still reads 208 lights / 17h 20m.
- **Trace:** flow D1 · LIB-FR-09, PIX-FR-01, PIX-FR-06, PIX-FR-12 · LIB-AC-14, PIX-AC-10 · root FR-017 · D10, D19 · J19/G4

### S15b — Restore the reviewed bytes {#S15b}

- **Do:** Restore the P5 frame's original bytes and recorded mtime, index `Astro-T7 captures` again, and reopen the Review step.
- **Expect:** The rehash matches the reviewed digest. The frame reads Picked, NGC 7000 usable Ha integration reads 9h 15m, its earlier cached values read valid again, and its imported values read content unverified again.
- **Expect (negative):** The restoration records no new quality decision. Source bytes equal P4 again.
- **Trace:** flow D1 · LIB-FR-09, PIX-FR-01 · LIB-AC-14 · J19/G4

### S16 — Restart with an unsaved change {#S16}

- **Do:** Exclude one included 30 Sep frame without saving. Quit PlateVault, relaunch, and reopen `NGC7000-HOO-Siril`. Then discard the unsaved exclusion.
- **Expect:** The run restores saved membership revision 2: 208 lights / 17h 20m with the same six exclusions and measurement sources. The S11 to S13 quality states are unchanged. The unsaved exclusion is identified separately as a recoverable unsaved operation. After discarding it, the draft holds 208 lights.
- **Expect (negative):** The unsaved exclusion is not applied to the saved revision without the user's action.
- **Trace:** root SC-004 · VSEL-FR-13 · D08

## Success criteria

- SC1: The run reads exactly Ha 111 / 9h 15m, OIII 97 / 8h 05m and 208 / 17h 20m after S10 and after S16, and the Project reads Ha 9h 15m and OIII 8h 05m in project, with 12h 35m and 10h 35m captured, after S10.
- SC2: Source bytes equal P4 for 100% of files at S5, at S5b and at the end.
- SC3: Measured values are identical with the stretch on and off (S5); the failed fit shows 0 width numbers (S7).
- SC4: Library quality changes only at S11 (208 frames), S11a (F1, restored), S13 (six frames, then one back to Unreviewed) and through S15a/S15b applicability. Project-only rejection changes 0 library totals (S11b, S13).
- SC5: The draft holds 207 lights after each rejection of an included frame and 208 after each restore (S11a, S11b); saved revision 2 changes 0 times between S10 and S16.
- SC6: S14 attaches 0 imported values to the P6 frame and shows 0 imported values as verified.
- SC7: With the replacement in place, the frame reads ChangedContent, usable Ha reads 9h 10m and its cached values read valid 0 times (S15a); after S15b usable Ha reads 9h 15m again.

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Product behavior follows the specs and the defaults set in decisions D02, D03, D08, D10 and D19 and workflow decisions D-W13, D-W14, D-W15, D-W22, D-W40, D-W42, D-W44, D-W53, D-W54 and D-W66. No implementation has been validated against them.
- G2: Unresolved implementation qualification: numerical measurement methods, metric set, masks, saturation, background, aperture and tolerances need fixture qualification in PIX planning (D03). The P2 fixture is mono, so CFA inspection as the recorded mosaic plane (D03) is not exercised. Blocks readiness.
- G3: Out of scope for this journey: no fixture holds NaN, infinity or masked samples, so PIX-AC-08's invalid-sample evidence is not exercised. Blocks readiness until covered by a step or a journey.
- G4: Out of scope for this journey: a frame shared with a second Project's candidates (PIX-AC-13) and its Rejected state in other Projects' runs (PIX-AC-12) are not observed, because the fixture has one NGC 7000 Project. A session entering a draft with library-Unusable frames that start visibly excluded (VSEL-AC-13) is not exercised. Blocks readiness until covered by a step or a journey.
- G5: Out of scope for this journey: no frame is trashed before this journey. J34/S7 covers a Trashed frame's absence from frame review (PIX-AC-19), and J33/S6 covers run-group review across panels (PIX-AC-18).

## Delta log

- **Δ2** 2026-10-06 · S1, S10 to S13, S15a, S16, +S5a, +S5b, +S7a, +S11a, +S11b · behavior-change
  Review is a step of processing run `NGC7000-HOO-Siril`, with table, filmstrip and grid views, Lightroom hotkeys, and threshold selection. Quality has two levels, library (P/X/U) and "Reject for this Project only", and rejecting a frame in Review removes it from the draft. Goals read "in project"; the standalone-View step 13a is retired.
  Evidence: specs/067-frame-review PIX-FR-10 to PIX-FR-16, PIX-AC-12, PIX-AC-14 to PIX-AC-17; specs/066-view-selection VSEL-FR-15, VSEL-AC-23; specs/065-project-goals PRJ-AC-08, PRJ-FR-04 and PRJ-FR-21 with workflow decisions D-W13, D-W14, D-W15, D-W22, D-W40, D-W42, D-W44, D-W53, D-W54 and D-W66 at d45a22ad · by: journey-scribe (intent-gated)
