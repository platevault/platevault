---
id: J22
title: Review session frames and record quality decisions
version: 8
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [frame-review, sessions, targets, projects, home]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 066-view-selection, 067-frame-review, D02, D03, D08, D10, D19, D-W13, D-W14, D-W15, D-W22, D-W36, D-W40, D-W79, D-W96, D-W53, D-W78, specs/063-clean-rebuild-contract/decisions.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/066-view-selection/spec.md, specs/067-frame-review/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-d-inspect-frames-and-quality, HARNESS-V5-IA.md#S6, HARNESS-V5-IA.md#fix-pass, HARNESS-V5-FEEDBACK-R1.md#d-review, HARNESS-V5-FEEDBACK-R1.md#copy-rules, HARNESS-V5-FEEDBACK-R1.md#round-6, 068-calibration-inputs, D-W93, D-W94, D-W97, D-W100, D-W101, D-W105, specs/063-clean-rebuild-contract/spec.md, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/068-calibration-inputs/spec.md, D-W118]
---

## Goal

In the Review step of the `30 Sep` session's intake, the user inspects its 48
frames and star measurements in the table, filmstrip and grid views, culls with
Lightroom-style hotkeys, and records one library-wide quality decision per
frame. X rejects a frame library-wide: it reads Unusable in the library, while
its file stays on disk. A mark on a ⌘A or threshold selection asks first, and single-frame and hand-picked marks never ask. Imported measurements keep
their provenance and never read as content-verified. Done means the intake
review is finished and the `30 Sep` session is Ready with 42 Usable and six
Unusable frames. Every Usable frame reads Picked and every rejected frame reads
"Rejected · Library": there is no Project-only rejection. The user adds the
session to Project `NGC 7000 HOO` only once it is Ready with settled
calibration. A later mark on a frame of a session that the open Project holds
is a pending change labelled with its source, the View stays unchanged until
Apply, and a Closed or Archived Project doesn't change. A frame whose bytes change in place stops counting as Usable until its reviewed bytes return. PlateVault writes,
moves or trashes no source file.

## Preconditions

- P1: J21 completed: Project `NGC 7000 HOO` is open, its View exists, and it holds the four Ready sessions 18, 24, 26 and 28 Sep with settled calibration (166 lights). The `30 Sep` OIII session has 48 frames and is not in the Project; its Target and rig are confirmed, its calibration is settled, all 48 frames are Unreviewed, and no measurement is cached. The J19 fixture includes the 28 Sep Ha frames F1 and F2 in a session already held by the Project.
- P2: Frame-review properties of the J19 fixture: six named 30 Sep OIII frames have visibly trailed stars; one of the other 42 frames contains a saturated star whose PSF fit fails, at a recorded pixel position; at least one frame has a well-exposed unsaturated star at a recorded position.
- P3: A PixInsight SubframeSelector CSV export covering the five sessions with FWHM values, plus one row naming a file in no session, one filename present in two session subfolders, and one column with no units and no native equivalent.
- P4: The J19/P5 manifest is available.
- P5: For one named 18 Sep Ha frame, a backup of its original bytes and nanosecond mtime, and a replacement file of identical size with different pixel bytes, both kept outside PlateVault.
- P6: For one named 26 Sep OIII frame that P3 names, a backup of its original bytes and nanosecond mtime and a same-size variant with different pixel bytes, both kept outside PlateVault.
- P7: Two named 28 Sep Ha frames, F1 and F2, adjacent in the default list order.

## Steps

### S1 — Open frame review {#S1}

- **Do:** Open the `30 Sep` session's Review step in intake and read the status line. Click **Measure frames**.
- **Expect:** Frame review opens in the table view. The frame table sits at the top across the full width at about 8 rows. The preview, with its histogram and star cutouts, fills the rest, and the plots run across the session in the bottom strip. Every measurement column reads Not measured, and the status line reads `48 frames shown of 48` and "48 frames not measured." beside **Measure frames**. After the click it announces "Measuring 48 frames, the current frame first.", **Cancel** replaces **Measure frames**, and progress shows in the status line as native measurements are computed.
- **Expect (negative):** Opening Review starts no measurement; only **Measure frames** does.
- **Trace:** LIB-FR-20 · PIX-FR-01, PIX-FR-10, PIX-FR-18 · PIX-AC-01 · D-W78, D-W94

### S2 — Inspect a frame while measurement runs {#S2}

- **Do:** While measurement runs, click a 30 Sep frame row, then a different frame's measurement-plot point. Open the inspector and hover the ① marker beside one measured value.
- **Expect:** Each chosen frame is highlighted in the table, the plots and the preview at once. The inspector shows header metadata. Each measured value shows with its units and a ① marker, whose tooltip names its source, method, basis and time. Measurement keeps progressing.
- **Expect (negative):** No inline paragraph explains a measured value.
- **Trace:** flow D1, D2 · PIX-FR-01, PIX-FR-02 · D03 · HARNESS-V5-FEEDBACK-R1.md Copy rules "Measured values", §D (source notes become ① tooltips)

### S3 — Cancel measurement {#S3}

- **Do:** Click **Cancel** in the status line before measurement finishes.
- **Expect:** Further measurement stops, the status line reads "Measurement canceled; N not measured." with N the frames still without a value, and **Measure frames** returns. Frames without a value read **Not measured**; values already computed remain. Cancel changes no library mark, session readiness, Project membership, pending change, or View.
- **Expect (negative):** Cancel discards no selection, quality mark or draft change.
- **Trace:** flow D1, cross-flow "Measurement pending/failed" · PIX-FR-01 · PIX-AC-01

### S4 — Resume by reopening review {#S4}

- **Do:** Leave the Review step and open it again. Read the measurement columns, then click **Measure frames**.
- **Expect:** Values computed before S3 appear immediately as cached, and the remaining frames read Not measured. After **Measure frames**, those frames are measured until the status line reads "Every readable frame has a built-in value."
- **Expect (negative):** Reopening Review starts no measurement and recomputes no cached value.
- **Trace:** flow D1 · PIX-FR-01 · PIX-AC-01 · prototype d-review/measure-bar.tsx (Review opens idle)

### S5 — Inspect pixels without changing data {#S5}

- **Do:** On a 30 Sep frame press **Z** to zoom to 1:1 and pan. Compare the fixed centre and corner regions. Press **→** and **←** (then **K** and **J**) to step frames. Press **C**, choose a reference frame, zoom and pan, and press **C** again. Press **F** twice. Set the display stretch to Strong, then back to Linear.
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

- **Do:** Use the Review step's **Select by threshold…** action to select frames with FWHM above 3.5", press **X**, read the confirmation and cancel it, then clear the selection.
- **Expect:** Exactly the measured frames with FWHM above 3.5" are selected, and the plots highlight them. Any frame without an FWHM value is named Not measured and stays unselected. **X** on the threshold selection opens a confirmation that names the number of selected frames, whatever that number is. After **Cancel**, no frame's quality has changed.
- **Expect (negative):** The threshold selection and the cancelled mark change no quality state and no membership.
- **Trace:** flow D2 · PIX-FR-08, PIX-FR-14, PIX-FR-15 · PIX-AC-14, PIX-AC-21 · D-W13, D-W118 · HARNESS-V5-FEEDBACK-R1.md Round 9 C10

### S7b — Inspect the corners at 1:1 {#S7b}

- **Do:** On a measured 30 Sep frame press **⌘I** (Ctrl+I off macOS). Turn on the FWHM overlay and the eccentricity overlay and read the tiles. Press **⌘I** again. Then turn the corner inspector on and off with the toolbar's **Corners** toggle.
- **Expect:** **⌘I** replaces the preview with nine tiles of the current frame at 1:1, named Top left, Top, Top right, Left, Centre, Right, Bottom left, Bottom and Bottom right. With both overlays on, each tile draws its stars' FWHM circles and eccentricity whiskers and names its FWHM and eccentricity. The second **⌘I**, and the **Corners** toggle, switch between the tiles and the preview, and the same frame stays current throughout.
- **Expect (negative):** The corner inspector starts no measurement and changes no quality state or membership. A tile's FWHM and eccentricity values do not change with the display stretch.
- **Trace:** flow D2 · PIX-FR-03, PIX-FR-05 · HARNESS-V5-FEEDBACK-R1.md §D "Corner inspector" · prototype d-review/corners.tsx

### S8 — Reject the six trailed frames {#S8}

- **Do:** Open NGC 7000's Target page, read its OIII integration, and return to the `30 Sep` session's Review step. Press **⌥1** to list every frame. Make each of the six trailed 30 Sep frames current in turn and press **X**. Then read NGC 7000's Target page again and return to the session's Review step.
- **Expect:** Each **X** applies at once: the frame reads "Rejected · Library" and the next frame becomes current. After the sixth, the session Review lists six Rejected and 42 Unreviewed frames. On the Target page, NGC 7000's Unreviewed OIII integration is 0h 30m lower than before S8, and its usable OIII integration is unchanged. The session is not Ready until its remaining frames are reviewed.
- **Expect (negative):** No **X** asks for confirmation. The six files stay on disk at their paths and nothing goes to the OS Trash: the manifest still matches P4. No Project holds this session yet, so this step creates no Project pending change.
- **Trace:** PIX-FR-13, PIX-FR-14, PIX-FR-18 · PIX-AC-12, PIX-AC-20 · LIB-FR-20 · D-W78, D-W79

### S9 — Find and restore a rejected frame {#S9}

- **Do:** Press **⌥3** and read the list. Press **⌥1**, turn auto-advance off, make one of the six rejected frames current and press **U**. Read its library quality, then press **X** on it again. Turn auto-advance back on.
- **Expect:** **⌥3** lists exactly the six frames, each "Rejected · Library". After **U** the frame reads Unreviewed and stays current. After **X** it reads "Rejected · Library" again. The session has six Rejected and 42 Unreviewed frames throughout the step.
- **Expect (negative):** Neither mark asks for confirmation. The restored frame's file never moved, and neither mark creates a Project membership revision or changes a Project View.
- **Trace:** PIX-FR-13, PIX-FR-14, PIX-FR-18 · PIX-AC-12 · LIB-FR-20 · D-W78, D-W79

### S9a — Mark a hand-picked selection without a confirmation {#S9a}

- **Do:** With **⌥1** listing every frame, ⌘-click (Ctrl-click off macOS) two of the six rejected frames so that only they are selected, and press **U**. Select the same two frames again the same way and press **X**.
- **Expect:** Neither mark asks for confirmation. After **U** both frames read Unreviewed, and after **X** both read "Rejected · Library" again. The session again lists six Rejected and 42 Unreviewed frames.
- **Expect (negative):** No confirmation opens for a selection picked by hand. Neither file moves, and no Project changes, because no Project holds this session yet.
- **Trace:** PIX-FR-13, PIX-FR-14, PIX-FR-15 · PIX-AC-16, PIX-AC-21 · LIB-FR-20 · D-W118

### S10 — Finish reviewing the session's remaining frames {#S10}

- **Do:** Choose the session's Review step, leave the six rejected frames, press **⌥4** to list the 54 Unreviewed frames, choose **Mark rest usable**, read its confirmation and confirm. Then select all 42 Unreviewed `30 Sep` frames with **⌘A**, press **P**, and confirm the mark. Choose **Finish review**, then add the Ready `30 Sep` session to Project `NGC 7000 HOO` from its session row.
- **Expect:** The **Mark rest usable** confirmation names the number of Unreviewed frames. The ⌘A confirmation names 42 frames. Nothing changes until the user confirms. After confirming, those frames read Picked (library Usable), and the six rejected frames remain Unusable. **Finish review** makes the session Ready. Only after the user adds it does it join the Project. The Project's inputs are the 42 Usable frames, which contribute 3h 30m of OIII; the six Unusable frames remain Unusable.
- **Expect (negative):** No session joins the Project before the user adds it. Reviewing, marking frames and adding the session moves no source file and sends nothing to the OS Trash.
- **Trace:** LIB-FR-20, LIB-FR-23 · PIX-FR-14, PIX-FR-18, PIX-AC-20, PIX-AC-21 · PRJ-FR-08, PRJ-FR-09 · VSEL-FR-03, VSEL-FR-15 · D-W78, D-W79, D-W94, D-W96, D-W105, D-W118 · owner's answer, 2026-10-19 (astro-plan-rzbzu.1)

### S11 — Check that the Project's frames are all reviewed {#S11}

- **Do:** Open Project `NGC 7000 HOO` and read its Sessions step. Then open Sessions filtered to **Needs review**.
- **Expect:** The Sessions step lists five Ready sessions, 18, 24, 26, 28 and 30 Sep, with 208 included frames, and the six Unusable 30 Sep frames show as excluded. Ha reads `9h 15m in project` and OIII reads `8h 05m in project`. **Needs review** lists none of the five, because a Ready session has no Unreviewed frame left to mark.
- **Expect (negative):** No included frame reads Unreviewed. Reading the Project marks no frame and opens no confirmation, and the Project's View changes only through Apply.
- **Trace:** PRJ-FR-04, PRJ-FR-08 · LIB-FR-17, LIB-FR-20 · PIX-FR-14 · D-W78, D-W96

### S11a — Cull with hotkeys {#S11a}

- **Do:** Open the Ready 28 Sep session and reopen its Review step. In the table make F1 current and press **X**. Press **⌥3**, then **⌥1**. Make F1 current again. Turn auto-advance off and press **P**, then **Shift+P**. Turn auto-advance back on.
- **Expect:** **X** applies at once: F1 reads "Rejected · Library", and F2 becomes current. Project `NGC 7000 HOO` shows one pending removal labelled with the Library rejection as its source; its View is unchanged until Apply. **⌥3** lists F1 only, because 28 Sep has no other rejected frame, and **⌥1** lists every frame of the session. With auto-advance off, **P** makes F1 Picked again, F1 stays current, and the Project's pending removal for F1 clears. **Shift+P** keeps F1 Picked and makes F2 current.
- **Expect (negative):** No single-frame P, X or U mark asks for confirmation. F1's file stays on disk and nothing goes to the OS Trash. The Project's View does not change before Apply.
- **Trace:** PIX-FR-13, PIX-FR-14, PIX-FR-18 · PIX-AC-12 · LIB-FR-20 · VSEL-FR-12, VSEL-FR-15 · D-W78, D-W79, D-W100

### S11b — Check Project quality controls {#S11b}

- **Do:** On F2 open the frame menu and inspect the available quality actions. Open Project `NGC 7000 HOO` and inspect its Sessions step.
- **Expect:** The frame menu offers only the library-wide P, X and U quality actions and no Project-scoped reject or clear action. The Project Sessions step lists changes to its inputs with their source; the View remains unchanged until Apply.
- **Expect (negative):** No Project-only quality state or quality control changes the Project's totals. No file moves or goes to the OS Trash.
- **Trace:** PIX-FR-14 · LIB-FR-20 · VSEL-FR-12 · PRJ-FR-08 · D-W78, D-W79, D-W94, D-W100

### S12 — Meet a goal without closing the Project {#S12}

- **Do:** Open Project `NGC 7000 HOO` and read the Ha goal. Edit the Ha goal from 10h to 9h and read it again. Edit it back to 10h.
- **Expect:** Before the edit, Ha reads `9h 15m in project` against goal 10h, unmet, with `12h 35m captured` beside it. At 9h it reads met. Back at 10h it reads unmet again. The Project stays open throughout.
- **Expect (negative):** Meeting a goal does not close the Project and changes no quality state.
- **Trace:** flow B2 · PRJ-FR-04 · PRJ-AC-03 · D10, D-W36, D-W66

### S13 — Reject a frame in the grid and pick it again {#S13}

- **Do:** Reopen the Ready 28 Sep session's Review step. Press **G**, make F1 current and press **X**, then press **⌥3**. Return to the table view. Leave Review, reopen the 28 Sep session's Review step, make F1 current and press **P**.
- **Expect:** In the grid, **X** applies at once: F1 reads "Rejected · Library" in the session, and its library quality changes immediately. The open Project shows a pending removal labelled with its source, while the View stays unchanged until Apply. **⌥3** lists F1, the session's only rejected frame. The table and grid keep the same selection, current frame, filter and sort; cached thumbnails show no pending state. After Review is reopened, **P** makes F1 Picked again, and the Project's pending removal for F1 clears.
- **Expect (negative):** There is no Project-only rejection, run draft, or saved membership revision. The library rejection does not change the View before Apply, and no file moves.
- **Trace:** PIX-FR-11, PIX-FR-12, PIX-FR-13, PIX-FR-14, PIX-FR-18 · PIX-AC-12, PIX-AC-16 · LIB-FR-20 · VSEL-FR-12, VSEL-FR-15 · PRJ-FR-04 · D-W78, D-W79, D-W100

### S14 — Import measurements {#S14}

- **Do:** Overwrite the P6 frame in place with its variant and restore its recorded mtime. Click **Import** in Review's status line, choose the P3 CSV in **Import measurements**, review the mapping, and confirm it. Then restore the P6 frame's original bytes and recorded mtime.
- **Expect:** The mapping review lists matched rows, the row with no matching frame, and the ambiguous row, with units and source/method. It also lists the P6 row for review, because the frame's bytes differ from the digest recorded when PlateVault measured it. After confirmation, imported values show as "Imported, unverified", with their units, next to native values. Every frame without an imported value, the P6 frame included, reads "–" in the FWHM imported column.
- **Expect (negative):** No imported value attaches to the P6 frame, and no imported value reads verified. Every native value, rejection and quality state stays as it was; no Project membership or View changes until Apply.
- **Trace:** flow D6, cross-flow "External changes" · PIX-FR-06, PIX-FR-07, PIX-FR-08 · PIX-AC-04, PIX-AC-11 · D03, D19 · HARNESS-V5-IA.md Fix pass "Review layout" (Import measurements in the status line) · HARNESS-V5-FEEDBACK-R1.md §D ("Absent imports read '–'")

### S15 — Inspect unresolved import rows {#S15}

- **Do:** Open the ambiguous row, the row with no matching frame, and the column with no units.
- **Expect:** The ambiguous row is attached to no frame until the user resolves it. The row with no matching frame is attached to none, and the column reads unavailable.
- **Expect (negative):** The column is not shown as built-in FWHM or HFR.
- **Trace:** flow D6 failure branch · PIX-FR-07 · PIX-AC-05

### S15a — Replace a reviewed frame in place {#S15a}

- **Do:** Outside PlateVault, overwrite the P5 frame with its replacement and restore its recorded mtime. Open NGC 7000 and read its usable Ha integration. Index `Astro-T7 captures` again, then reopen the Ready session's Review step and click **Measure frames**.
- **Expect:** Before the rescan, usable Ha still reads 9h 15m, with the last-verified label it had before this step. After the rescan completes, the frame reads ChangedContent with its previous Picked decision kept as history, and it is listed under the ChangedContent filter. NGC 7000 usable Ha integration reads 9h 10m, labelled as verified at this rescan. In frame review its cached values never read valid, its imported S14 values show as history, its thumbnail is decoded again, and it reads Not measured until **Measure frames**. Then it is measured again from its current bytes, and the earlier cached values show as history for the earlier content.
- **Expect (negative):** Opening NGC 7000 starts no rehash. The frame counts as neither Usable nor Unreviewed after the rescan. No quality decision is recorded.
- **Trace:** flow D1 · LIB-FR-09, PIX-FR-01, PIX-FR-06, PIX-FR-12 · LIB-AC-14, PIX-AC-10 · root FR-017 · D10, D19 · J19/G4

### S15b — Restore the reviewed bytes {#S15b}

- **Do:** Restore the P5 frame's original bytes and recorded mtime, index `Astro-T7 captures` again, and reopen the Ready session's Review step.
- **Expect:** The rehash matches the reviewed digest. The frame reads Picked, NGC 7000 usable Ha integration reads 9h 15m, its earlier cached values read valid again, and its imported values read content unverified again. No Closed or Archived Project changes.
- **Expect (negative):** The restoration records no new quality decision. Source bytes equal P4 again.
- **Trace:** flow D1 · LIB-FR-09, PIX-FR-01 · LIB-AC-14 · J19/G4

### S16 — Restart with a pending Project change {#S16}

- **Do:** Reopen Review on Ready session `28 Sep`, press **X** on one included frame, and quit PlateVault. Relaunch, open Project `NGC 7000 HOO` and inspect its Sessions step. Reopen the session's Review and press **P** on that frame.
- **Expect:** After relaunch, the frame still reads "Rejected · Library" and the Project Sessions step retains the pending removal labelled with the Library rejection as its source. The View has not changed. After **P**, the frame reads Picked and the pending removal clears.
- **Expect (negative):** The library quality decision is not an unsaved draft and needs no Resume or Discard. The frame's file stays on disk, and the Project View changes only through Apply.
- **Trace:** LIB-FR-20 · PIX-FR-14, PIX-FR-18 · VSEL-FR-12, VSEL-FR-13, VSEL-FR-15 · D-W78, D-W79, D-W100

## Success criteria

- SC1: After S10 the `30 Sep` session is Ready, its 42 Usable OIII frames contribute 3h 30m, its six Unusable frames are excluded from Project inputs, and the user has added the session to `NGC 7000 HOO`.
- SC2: Source bytes equal P4 for 100% of files at S5, at S5b and at the end.
- SC3: Measured values are identical with the stretch on and off (S5); the failed fit shows 0 width numbers (S7).
- SC4: Library quality changes only through the marks in S8, S9, S9a, S10, S11a, S13 and S16, and through S15a/S15b applicability. No Project-only quality state exists (S11b, S13).
- SC5: S8 leaves exactly six frames Rejected and 42 Unreviewed; S10 leaves 42 Usable and six Unusable; and S13/S16 each show one Library-sourced pending removal that clears when the frame is marked Picked. The View changes zero times before Apply.
- SC6: S14 attaches 0 imported values to the P6 frame and shows 0 imported values as verified.
- SC7: With the replacement in place, the frame reads ChangedContent, usable Ha reads 9h 10m and its cached values read valid 0 times (S15a); after S15b usable Ha reads 9h 15m again.
- SC8: Measurement starts exactly three times, at S1, S4 and S15a, each time from **Measure frames**. Opening Review and the corner inspector (S7b) start 0 measurements, and S7b shows exactly 9 tiles.
- SC9: The ⌘A **P** on 42 frames at S10 and the threshold **X** at S7a ask for confirmation, and zero frames are marked before a confirmation is accepted or after one is cancelled. Zero single-frame or hand-picked marks ask (S8, S9, S9a, S11a, S13, S16).
- SC10: 0 files are moved or sent to the OS Trash by any step: the six rejected frames (S8) and F1 (S11a, S13) stay on disk.

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Product behavior follows the harness v5 design (`apps/prototype/design/HARNESS-V5-IA.md` S6 and Fix pass, `HARNESS-V5-FEEDBACK-R1.md` Copy rules and §D, on `ui-harness-v5` @ b5e813a5, and Round 6 @ 4f470775), the specs and the defaults set in decisions D02, D03, D08, D10 and D19 and workflow decisions D-W13, D-W14, D-W15, D-W22, D-W40, D-W42, D-W44, D-W53, D-W54 and D-W66. No implementation has been validated against them.
- G2: Unresolved implementation qualification: numerical measurement methods, metric set, masks, saturation, background, aperture and tolerances need fixture qualification in PIX planning (D03). The P2 fixture is mono, so CFA inspection as the recorded mosaic plane (D03) is not exercised. Blocks readiness.
- G3: Out of scope for this journey: no fixture holds NaN, infinity or masked samples, so PIX-AC-08's invalid-sample evidence is not exercised. Blocks readiness until covered by a step or a journey.
- G4: Out of scope for this journey: a frame shared by two Projects and its library-wide Rejected state in both (PIX-AC-12) are not observed, because the fixture has one NGC 7000 Project. A Ready session added with library-Unusable frames visibly excluded (VSEL-AC-13) is not exercised. Blocks readiness until covered by a step or a journey.
- G5: Out of scope for this journey: no frame is trashed before this journey. J34/S7 covers a Trashed frame's absence from frame review (PIX-AC-19). Mosaic panel progress and the panel map are not exercised. Blocks readiness until covered by a step or a journey.
- G6: (dissolved 2026-10-12): answered by Round 6 "Reject is library-wide by default"; S8, S9, S10, S13 and S16 now assert X as the way a frame leaves the run: it reads "Rejected · Library" (library Unusable), leaves the draft at once, stays on disk, and U or P brings it back, while "Reject for this Project only" stays in the frame menu (S11b, S13).
- G7: (dissolved 2026-10-12): answered by Round 6 "Large bulk marks need confirmation"; S10 now asserts ⌥4, ⌘A and P on the 42 Unreviewed frames asking for confirmation, with no frame marked before it is accepted.
- G8: (dissolved 2026-10-16; D-W118, amended by the owner's answer, 2026-10-19, astro-plan-rzbzu.1): every mark on a ⌘A or threshold selection asks, whatever its count; single-frame and hand-picked marks never ask. "Mark rest usable" also asks and names the count. S7a asserts the threshold confirmation, S9a a hand-picked two-frame mark with none, S10 the ⌘A confirmation, and S3's Mark rest usable confirmation.
- G9: (dissolved 2026-10-15): D-W78 moves review into session intake and D-W94 removes runs, so there is no Review draft and no Discard to define. Library marks are durable when made, and reopened Review is allowed on a Ready session. Its marks reach open Projects that hold the session as labelled pending changes (D-W100) and never change a Closed or Archived Project (D-W97; LIB-FR-20, PIX-FR-18, VSEL-FR-12). The owner's answer on 2026-10-19 (astro-plan-rzbzu.1) settles that a mark setting a frame to Unreviewed, and a grouping correction that re-splits a held session, reach every open Project holding it as a labelled pending change; there the session reads Needs review, and Apply waits until Ready.
- G10: Rests on D-W96's provisional count of every matching suggestion (S12). That product question is unrelated to the 2026-10-19 D-W118 answer and remains open in this journey.

## Delta log

- **Δ2** 2026-10-06 · S1, S10 to S13, S15a, S16, +S5a, +S5b, +S7a, +S11a, +S11b · behavior-change
  Review is a step of processing run `NGC7000-HOO-Siril`, with table, filmstrip and grid views, Lightroom hotkeys, and threshold selection. Quality has two levels, library (P/X/U) and "Reject for this Project only", and rejecting a frame in Review removes it from the draft. Goals read "in project"; the standalone-View step 13a is retired.
  Evidence: specs/067-frame-review PIX-FR-10 to PIX-FR-16, PIX-AC-12, PIX-AC-14 to PIX-AC-17; specs/066-view-selection VSEL-FR-15, VSEL-AC-23; specs/065-project-goals PRJ-AC-08, PRJ-FR-04 and PRJ-FR-21 with workflow decisions D-W13, D-W14, D-W15, D-W22, D-W40, D-W42, D-W44, D-W53, D-W54 and D-W66 at d45a22ad · by: journey-scribe (intent-gated)
- **Δ3** 2026-10-12 · S1, S2, S3, S4, S5, S11a, S11b, S13, S14, S15a, +S7b · behavior-change
  Review opens idle: only Measure frames in the status line starts or resumes measuring; provenance moves into ① tooltips, and absent imports read "–". A corner inspector (⌘/Ctrl+I or Corners) shows nine 1:1 tiles with FWHM and eccentricity overlays.
  Rejections show as Review's own draft ("1 rejected, unsaved", with Save run and Discard), while Select keeps "Saved r2". Reject for this Project now asks for a confirmation that names its scope.
  Evidence: HARNESS-V5-IA.md §Screens S6 and §Fix pass ("Review drafts", "Review layout"); HARNESS-V5-FEEDBACK-R1.md §Copy rules "Measured values" and §Screens D (corner inspector, ① NoteMarker); prototype src/features/v5/d-review/frame-review.tsx, measure-bar.tsx, corners.tsx and messages/en-GB.json (apps/prototype/ on ui-harness-v5 @ b5e813a5); user instruction 2026-10-12 · by: JourneysV5.U3Runs (intent-gated)
- **Δ4** 2026-10-12 · S3, S8, S9, S10, S11, S11a, S11b, S13, S14, S16 · behavior-change
  There is no Exclude from run: X rejects the six trailed frames library-wide (Unusable, out of the draft at once, files kept, purge candidates), U brings one back, and Save run makes revision 2.
  Marking the 208 included frames Usable is ⌥4, ⌘A and P, which asks "Mark 208 frames Usable?". One rejected frame is narrowed to this Project with the frame-menu reject and U.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Reject is library-wide by default", "Large bulk marks need confirmation", "Target library facts" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); user answers to the PR #1788 journey questions · by: JourneysV5.R6B (intent-gated)
- **Δ5** 2026-10-15 · S1, S8, S9, S10, S11, S11a, S11b, S13, S15a, S15b, S16 · behavior-change
  Frame review is the session intake Review step. A session must be Ready and have settled calibration before it can be added to a Project; re-review marks on sessions held by open Projects become labelled pending changes, and the View changes only through Apply. Library quality has one scope and no Project-only reject: S11b and S13 assert that the frame menu has no Project-only quality action (D-W79). P1 starts from J21, whose Project holds four sessions, and S10 adds 30 Sep. G9 is dissolved and G10 is new.
  Evidence: D-W78, D-W79, D-W93 to D-W106 (F4 Project model, owner's answers of 2026-10-14) in PR #1804, 064 LIB-FR-20, LIB-FR-23, 065 PRJ-FR-08, PRJ-FR-09, 066 VSEL-FR-12, VSEL-FR-15, 067 PIX-FR-14, PIX-FR-18 · by: SpecF4Writer2 (intent-gated)
- **Δ6** 2026-10-16 · S7a, S10, +S9a · behavior-change
  A mark on a ⌘A or threshold selection asks first, whatever its count, and a single-frame or hand-picked mark never asks: S7a cancels a threshold mark, and new S9a marks two hand-picked frames with no confirmation. G8 is dissolved. S11 now checks that the Project's Ready sessions hold no Unreviewed frame, since a Ready session is fully reviewed (D-W78).
  Evidence: D-W118 (owner's second batch of 2026-10-16) in PR #1804, PIX-FR-14, PIX-FR-15, PIX-AC-21, FR-029; D-W78, LIB-FR-20 · by: EncodeOwnerAnswers2 (intent-gated)
- **Δ7** 2026-10-17 · S7a · behavior-change
  S7a selects the frames through the Review step's **Select by threshold…** action.
  Evidence: HARNESS-V5-FEEDBACK-R1.md Round 9 C10 · D-W78 · PIX-FR-08 · by: JourneysR9c (intent-gated)
- **Δ8** 2026-10-19 · S10 · behavior-change
  **Mark rest usable** asks for confirmation and names the number of Unreviewed frames.
  Evidence: PIX-FR-14 · D-W118 · owner's answer, 2026-10-19 in astro-plan-rzbzu.1 · by: OwnerAnswersDocsFix (intent-gated)
