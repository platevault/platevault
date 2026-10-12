---
id: J22
title: Review frames and record scoped quality decisions in a processing run
version: 4
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [frame-review, view-review, targets, projects]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 066-view-selection, 067-frame-review, D02, D03, D08, D10, D19, D-W13, D-W14, D-W15, D-W22, D-W36, D-W40, D-W42, D-W44, D-W53, D-W54, D-W66, specs/063-clean-rebuild-contract/decisions.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/066-view-selection/spec.md, specs/067-frame-review/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-d-inspect-frames-and-quality, HARNESS-V5-IA.md#S6, HARNESS-V5-IA.md#fix-pass, HARNESS-V5-FEEDBACK-R1.md#d-review, HARNESS-V5-FEEDBACK-R1.md#copy-rules, HARNESS-V5-FEEDBACK-R1.md#round-6]
---

## Goal

In the Review step of processing run `NGC7000-HOO-Siril`, the user inspects
frames and star measurements in the table, filmstrip and grid views, culls with
Lightroom-style hotkeys, and records quality at two levels: library quality,
which is global, and "Reject for this Project only" for the rare case. X
rejects a frame library-wide: it reads Unusable in the library, leaves the
run's draft at once and becomes a purge candidate, while its file stays on
disk. A large bulk mark asks first. Imported measurements keep their
provenance and never read as content-verified. Done means the run's saved
membership revision 2 reads Ha 111 / 9h 15m, OIII 97 / 8h 05m and 208 lights /
17h 20m, leaves out the six trailed 30 Sep frames, and survives restart. Every
included frame reads Picked (library Usable). Of the six rejected frames, five
read "Rejected · Library" (library Unusable) and one reads "Rejected · This
Project" with library quality Unreviewed. A frame whose bytes change in place
stops counting as Usable until its reviewed bytes return. PlateVault writes,
moves or trashes no source file.

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

- **Do:** Click the run's **Review** step and read the status line. Click **Measure frames**.
- **Expect:** Frame review opens in the table view. The frame table sits at the top across the full width at about 8 rows. The preview, with its histogram and star cutouts, fills the rest, and the plots run across the session in the bottom strip. Every measurement column reads Not measured, and the status line reads `214 frames shown of 214` and "214 frames not measured." beside **Measure frames**. After the click it announces "Measuring 214 frames, the current frame first.", **Cancel** replaces **Measure frames**, and progress shows in the status line as native measurements are computed.
- **Expect (negative):** Opening Review starts no measurement; only **Measure frames** does.
- **Trace:** flow D1 · PIX-FR-01, PIX-FR-10 · PIX-AC-01 · D-W13, D-W22 · HARNESS-V5-IA.md S6, Fix pass "Review layout" (Measure frames in the status line)

### S2 — Inspect a frame while measuring runs {#S2}

- **Do:** While measurement runs, click a 30 Sep frame row, then a different frame's measurement-plot point. Open the inspector and hover the ① marker beside one measured value.
- **Expect:** Each chosen frame is highlighted in the table, the plots and the preview at once. The inspector shows header metadata. Each measured value shows with its units and a ① marker, whose tooltip names its source, method, basis and time. Measurement keeps progressing.
- **Expect (negative):** No inline paragraph explains a measured value.
- **Trace:** flow D1, D2 · PIX-FR-01, PIX-FR-02 · D03 · HARNESS-V5-FEEDBACK-R1.md Copy rules "Measured values", §D (source notes become ① tooltips)

### S3 — Cancel measurement {#S3}

- **Do:** Click **Cancel** in the status line before measurement finishes.
- **Expect:** Further measurement stops, the status line reads "Measurement canceled; N not measured." with N the frames still without a value, and **Measure frames** returns. Frames without a value read **Not measured**; values already computed remain. The draft still includes 214 lights.
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

- **Do:** Select frames with FWHM above 3.5", then clear the selection.
- **Expect:** Exactly the measured frames with FWHM above 3.5" are selected, and the plots highlight them. Any frame without an FWHM value is named Not measured and stays unselected.
- **Expect (negative):** Threshold selection changes no quality state and no membership.
- **Trace:** flow D2 · PIX-FR-08, PIX-FR-15 · PIX-AC-14 · D-W13

### S7b — Inspect the corners at 1:1 {#S7b}

- **Do:** On a measured 30 Sep frame press **⌘I** (Ctrl+I off macOS). Turn on the FWHM overlay and the eccentricity overlay and read the tiles. Press **⌘I** again. Then turn the corner inspector on and off with the toolbar's **Corners** toggle.
- **Expect:** **⌘I** replaces the preview with nine tiles of the current frame at 1:1, named Top left, Top, Top right, Left, Centre, Right, Bottom left, Bottom and Bottom right. With both overlays on, each tile draws its stars' FWHM circles and eccentricity whiskers and names its FWHM and eccentricity. The second **⌘I**, and the **Corners** toggle, switch between the tiles and the preview, and the same frame stays current throughout.
- **Expect (negative):** The corner inspector starts no measurement and changes no quality state or membership. A tile's FWHM and eccentricity values do not change with the display stretch.
- **Trace:** flow D2 · PIX-FR-03, PIX-FR-05 · HARNESS-V5-FEEDBACK-R1.md §D "Corner inspector" · prototype d-review/corners.tsx

### S8 — Reject the six trailed frames {#S8}

- **Do:** Open NGC 7000's Target page, read its OIII integration, and return to the Review step. Press **⌥1** to list every frame. Make each of the six trailed 30 Sep frames current in turn and press **X**. Then read NGC 7000's Target page again and return to the Review step.
- **Expect:** Each **X** applies at once: the frame reads "Rejected · Library", its member state reads "Out of draft · Rejected", and the next frame becomes current. After the sixth, the draft holds 208 lights and Review's status line reads `6 rejected, unsaved` with **Save run** and **Discard**, while Select's step state still reads `Saved r1`. On the Target page, NGC 7000's Unreviewed OIII integration is 0h 30m lower than before S8, and its usable integration still reads 0h 00m.
- **Expect (negative):** No **X** asks for confirmation. The six files stay on disk at their paths and nothing goes to the OS Trash: the manifest still matches P4. Saved membership revision 1 and the Project's "in project", "captured" and rejection records do not change.
- **Trace:** flow D4, D5 · PIX-FR-13 · VSEL-FR-15 · VSEL-AC-23 · D-W42, D-W54 · HARNESS-V5-IA.md Fix pass "Review drafts" · HARNESS-V5-FEEDBACK-R1.md §Round 6 "Reject is library-wide by default", "Target library facts" · messages review_quality_rejected_library, review_member_rejected

### S9 — Find and restore a rejected frame {#S9}

- **Do:** Press **⌥3** and read the list. Press **⌥1**, turn auto-advance off, make one of the six rejected frames current and press **U**. Read the draft, then press **X** on it again. Turn auto-advance back on.
- **Expect:** **⌥3** lists exactly the six frames, each "Rejected · Library". After **U** the frame reads Unreviewed and stays current, its mark is announced with "Back in the run's draft.", the draft holds 209 lights, and the status line reads `5 rejected, unsaved`. After **X** it reads "Rejected · Library" again, the draft holds 208 lights and the status line reads `6 rejected, unsaved`.
- **Expect (negative):** Neither mark asks for confirmation. Saved membership revision 1 is unchanged, and the restored frame's file never moved.
- **Trace:** flow D4, D5 · PIX-FR-13 · VSEL-FR-15 · VSEL-AC-23 · D-W54 · HARNESS-V5-FEEDBACK-R1.md §Round 6 "Reject is library-wide by default" (no separate "Exclude from run") · messages review_key_filter, review_mark_draft_back

### S10 — Read the run totals and save {#S10}

- **Do:** Click **Save run** in Review's status line. Read Select's step state and selection summary, then open Project `NGC 7000 HOO`.
- **Expect:** Review's unsaved note is gone, and Select reads `Saved r2`. The summary reads Ha 111 / 9h 15m and OIII 97 / 8h 05m across 24, 26 and 30 Sep, and 208 lights / 17h 20m, with no unresolved member, and its library-Unusable count reads 6. The Project reads Ha `9h 15m in project` with `12h 35m captured`, and OIII `8h 05m in project` with `10h 35m captured`. The six rejected frames leave "in project" and still count "captured".
- **Expect (negative):** Saving changes no library quality state: the six still read "Rejected · Library" and every other frame reads Unreviewed. No file is moved, and nothing goes to the OS Trash.
- **Trace:** flow D4, C5 · VSEL-FR-08, VSEL-FR-12, VSEL-FR-15, VSEL-FR-16 · VSEL-AC-23 · PRJ-FR-04, PRJ-FR-21 · D02, D-W44, D-W54, D-W66 · HARNESS-V5-IA.md Fix pass "Review drafts"

### S11 — Mark the included frames Usable {#S11}

- **Do:** Press **⌥4** to list the Unreviewed frames, press **⌘A** (Ctrl+A off macOS), then press **P**. Read the confirmation and cancel it. Press **P** again and confirm.
- **Expect:** **⌥4** lists exactly the 208 included frames, and **⌘A** selects all of them: the status bar reads `208 selected`. **P** opens a confirmation that reads "Mark 208 frames Usable?", in the bulk-mark form of Round 6. After cancelling, every listed frame still reads Unreviewed. After confirming, those 208 frames read Picked (library Usable), **⌥4** shows "No Unreviewed frames", and NGC 7000 usable integration reads Ha 9h 15m and OIII 8h 05m.
- **Expect (negative):** No frame is marked before the confirmation is accepted, and the cancelled confirmation marks none. The six rejected frames stay "Rejected · Library". Run membership does not change: the draft holds 208 lights, no unsaved note shows, and Select reads `Saved r2`.
- **Trace:** flow D5 · VSEL-FR-11 · LIB-FR-08 · VSEL-AC-05 · D10, D-W42 · HARNESS-V5-FEEDBACK-R1.md §Round 6 "Large bulk marks need confirmation" ("Mark 120 frames Unusable?") · messages review_select_all_shown, review_empty_unreviewed

### S11a — Cull with hotkeys {#S11a}

- **Do:** In the table make F1 current and press **X**. Press **⌥3**, then **⌥1**. Make F1 current again. Turn auto-advance off and press **P**, then **Shift+P**. Turn auto-advance back on.
- **Expect:** **X** applies at once: F1 reads "Rejected · Library", and F2 becomes current. The draft holds 207 lights and lists F1 with the reason "Rejected". The status line reads `1 rejected, unsaved` with **Save run** and **Discard**, while Select's step state still reads `Saved r2`. NGC 7000 usable Ha reads 9h 10m. **⌥3** lists F1 and the six rejected 30 Sep frames, and **⌥1** lists every frame. With auto-advance off, **P** makes F1 Picked again, F1 stays current, the draft holds 208 lights, the `1 rejected, unsaved` note is gone, and NGC 7000 usable Ha reads 9h 15m. **Shift+P** keeps F1 Picked and makes F2 current.
- **Expect (negative):** No single-frame P, X or U mark asks for confirmation. F1's file stays on disk and nothing goes to the OS Trash. Saved membership revision 2 is unchanged throughout, and the rejection changes Review's draft, not Select's.
- **Trace:** flow D5 · PIX-FR-13, PIX-FR-14 · VSEL-FR-15 · PIX-AC-12, VSEL-AC-23 · D-W14, D-W42, D-W53, D-W54 · HARNESS-V5-IA.md S6, Fix pass "Review drafts" · HARNESS-V5-FEEDBACK-R1.md §Round 6 "Reject is library-wide by default"

### S11b — Reject a frame for this Project only {#S11b}

- **Do:** On F2 open the frame menu and choose **Reject for this Project**. Read the confirmation and confirm with **Reject 1 frame**. Read the Project's Ha goal. Then choose **Clear Project reject** on F2 and read the goal again.
- **Expect:** The confirmation is titled "Reject <F2's file name> for NGC 7000 HOO?", reads "This Project only. Library quality stays." and lists "Rejected · This Project: 1 frame", "Out of NGC 7000 HOO's totals" and "Out of the NGC7000-HOO-Siril draft". Afterwards F2 reads "Rejected · This Project" and its library quality stays Usable. The draft holds 207 lights and lists F2 with the reason "Rejected", and the status line reads `1 rejected, unsaved`. Ha reads `9h 10m in project`, and its captured value stays `12h 35m`. After **Clear Project reject**, F2 reads Picked, the draft holds 208 lights, the unsaved note is gone, and Ha reads `9h 15m in project`.
- **Expect (negative):** NGC 7000 usable Ha stays 9h 15m. No single-key hotkey performs this action, and nothing changes before the confirmation. Saved membership revision 2 is unchanged.
- **Trace:** flow D5 · PIX-FR-14 · VSEL-FR-11, VSEL-FR-15 · VSEL-AC-11, PRJ-AC-08 · PRJ-FR-04 · D10, D-W42, D-W44, D-W54, D-W66 · HARNESS-V5-IA.md S6 (secondary "Reject for this Project only") · HARNESS-V5-FEEDBACK-R1.md §Round 6 "Reject is library-wide by default" ("Reject for this Project only" stays in the frame menu)

### S12 — Meet a goal without closing the Project {#S12}

- **Do:** Open Project `NGC 7000 HOO` and read the Ha goal. Edit the Ha goal from 10h to 9h and read it again. Edit it back to 10h.
- **Expect:** Before the edit, Ha reads `9h 15m in project` against goal 10h, unmet, with `12h 35m captured` beside it. At 9h it reads met. Back at 10h it reads unmet again. The Project stays open throughout.
- **Expect (negative):** Meeting a goal creates no run, marks no Project Done and changes no quality state.
- **Trace:** flow B2 · PRJ-FR-04 · PRJ-AC-03 · D10, D-W36, D-W66

### S13 — Narrow one rejection to this Project in the grid {#S13}

- **Do:** Press **G**, then **⌥3**. Select only the first of the six rejected 30 Sep frames in default order, choose **Reject for this Project** from its frame menu and confirm with **Reject 1 frame**. Then press **U** on it and read the list. Return to the table view. Leave the Review step and open it again in the grid.
- **Expect:** The grid shows the six rejected frames. After the Project reject, the first frame reads "Rejected · Library and this Project". After **U** it reads "Rejected · This Project", its library quality is Unreviewed, and its mark is announced with "Still out of the run's draft: rejected for this Project.". **⌥3** still lists exactly the six frames, five labelled "Rejected · Library" and one "Rejected · This Project". The table keeps the same selection, current frame, filter and sort as the grid. On reopening, the grid shows the cached thumbnails with no pending state.
- **Expect (negative):** The draft holds 208 lights throughout, and no unsaved note appears. NGC 7000 usable integration and the Project's "in project" and "captured" values are unchanged. **U** asks for no confirmation, and saved membership revision 2 is unchanged.
- **Trace:** flow D5 · PIX-FR-11, PIX-FR-12, PIX-FR-13, PIX-FR-14 · VSEL-FR-15 · PIX-AC-16 · PRJ-FR-04 · D10, D-W40, D-W42, D-W54, D-W66 · HARNESS-V5-FEEDBACK-R1.md §Round 6 "Reject is library-wide by default" · messages review_quality_rejected_both, review_mark_draft_still_out

### S14 — Import measurements {#S14}

- **Do:** Overwrite the P6 frame in place with its variant and restore its recorded mtime. Click **Import** in Review's status line, choose the P3 CSV in **Import measurements**, review the mapping, and confirm it. Then restore the P6 frame's original bytes and recorded mtime.
- **Expect:** The mapping review lists matched rows, the row with no matching frame, and the ambiguous row, with units and source/method. It also lists the P6 row for review, because the frame's bytes differ from the digest recorded when PlateVault measured it. After confirmation, imported values show as "Imported, unverified", with their units, next to native values. Every frame without an imported value, the P6 frame included, reads "–" in the FWHM imported column.
- **Expect (negative):** No imported value attaches to the P6 frame, and no imported value reads verified. Every native value, rejection and quality state stays as it was, and the run still reads 208 lights.
- **Trace:** flow D6, cross-flow "External changes" · PIX-FR-06, PIX-FR-07, PIX-FR-08 · PIX-AC-04, PIX-AC-11 · D03, D19 · HARNESS-V5-IA.md Fix pass "Review layout" (Import measurements in the status line) · HARNESS-V5-FEEDBACK-R1.md §D ("Absent imports read '–'")

### S15 — Inspect unresolved import rows {#S15}

- **Do:** Open the ambiguous row, the row with no matching frame, and the column with no units.
- **Expect:** The ambiguous row is attached to no frame until the user resolves it. The row with no matching frame is attached to none, and the column reads unavailable.
- **Expect (negative):** The column is not shown as built-in FWHM or HFR.
- **Trace:** flow D6 failure branch · PIX-FR-07 · PIX-AC-05

### S15a — Replace a reviewed frame in place {#S15a}

- **Do:** Outside PlateVault, overwrite the P5 frame with its replacement and restore its recorded mtime. Open NGC 7000 and read its usable Ha integration. Index `Astro-T7 captures` again, then open the run's Review step and click **Measure frames**.
- **Expect:** Before the rescan, usable Ha still reads 9h 15m, labelled as last verified at S11. After the rescan completes, the frame reads ChangedContent with its previous Picked decision kept as history, and it is listed under the ChangedContent filter. NGC 7000 usable Ha integration reads 9h 10m, labelled as verified at this rescan. In frame review its cached values never read valid, its imported S14 values show as history, its thumbnail is decoded again, and it reads Not measured until **Measure frames**. Then it is measured again from its current bytes, and the earlier cached values show as history for the earlier content.
- **Expect (negative):** Opening NGC 7000 starts no rehash. The frame counts as neither Usable nor Unreviewed after the rescan. No quality decision is recorded, and the run still reads 208 lights / 17h 20m.
- **Trace:** flow D1 · LIB-FR-09, PIX-FR-01, PIX-FR-06, PIX-FR-12 · LIB-AC-14, PIX-AC-10 · root FR-017 · D10, D19 · J19/G4

### S15b — Restore the reviewed bytes {#S15b}

- **Do:** Restore the P5 frame's original bytes and recorded mtime, index `Astro-T7 captures` again, and reopen the Review step.
- **Expect:** The rehash matches the reviewed digest. The frame reads Picked, NGC 7000 usable Ha integration reads 9h 15m, its earlier cached values read valid again, and its imported values read content unverified again.
- **Expect (negative):** The restoration records no new quality decision. Source bytes equal P4 again.
- **Trace:** flow D1 · LIB-FR-09, PIX-FR-01 · LIB-AC-14 · J19/G4

### S16 — Restart with an unsaved rejection {#S16}

- **Do:** Make one included 30 Sep frame current and press **X**, without saving. Quit PlateVault, relaunch, and reopen `NGC7000-HOO-Siril`'s Review step. Choose **Resume** on the recovered change, then make that frame current and press **P**.
- **Expect:** After relaunch, Select reads `Saved r2` with 208 lights / 17h 20m, the same six rejected frames left out and the same measurement sources. The S11 to S13 quality states are unchanged, and the frame reads "Rejected · Library", because **X** wrote library quality at once. A notice reads "Recovered unsaved changes" with **Resume** and **Discard**. After **Resume**, the draft holds 207 lights and Review's status line reads `1 rejected, unsaved`. After **P**, the frame reads Picked, the draft holds 208 lights and the unsaved note is gone.
- **Expect (negative):** The unsaved rejection is not applied to the saved revision without the user's action: revision 2 still holds 208 lights. The frame's file stays on disk.
- **Trace:** root SC-004 · VSEL-FR-13, VSEL-FR-15 · D08, D-W54 · HIGH-LEVEL-DESIGN.md ("Recovered unsaved changes" with Resume and Discard) · HARNESS-V5-FEEDBACK-R1.md §Round 6 "Reject is library-wide by default"

## Success criteria

- SC1: The run reads exactly Ha 111 / 9h 15m, OIII 97 / 8h 05m and 208 / 17h 20m after S10 and after S16, and the Project reads Ha 9h 15m and OIII 8h 05m in project, with 12h 35m and 10h 35m captured, after S10.
- SC2: Source bytes equal P4 for 100% of files at S5, at S5b and at the end.
- SC3: Measured values are identical with the stretch on and off (S5); the failed fit shows 0 width numbers (S7).
- SC4: Library quality changes only at S8 (six frames), S9 (one frame, restored and rejected again), S11 (208 frames, after one confirmation), S11a (F1, restored), S13 (one frame back to Unreviewed), S16 (one frame, restored) and through S15a/S15b applicability. Project-only rejection changes 0 library totals (S11b, S13).
- SC5: The draft holds 207 lights after each rejection of an included frame and 208 after each restore (S11a, S11b, S16), and 208 after S8; saved revision 2 changes 0 times between S10 and S16.
- SC6: S14 attaches 0 imported values to the P6 frame and shows 0 imported values as verified.
- SC7: With the replacement in place, the frame reads ChangedContent, usable Ha reads 9h 10m and its cached values read valid 0 times (S15a); after S15b usable Ha reads 9h 15m again.
- SC8: Measurement starts exactly three times, at S1, S4 and S15a, each time from **Measure frames**. Opening Review and the corner inspector (S7b) start 0 measurements, and S7b shows exactly 9 tiles.
- SC9: Exactly one bulk mark asks for confirmation, the 208-frame **P** at S11 ("Mark 208 frames Usable?"), and 0 frames are marked before it is accepted; 0 single-frame marks ask (S8, S9, S11a, S13, S16).
- SC10: 0 files are moved or sent to the OS Trash by any step: the six rejected frames (S8) and F1 (S11a) stay on disk.

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Product behavior follows the harness v5 design (`apps/prototype/design/HARNESS-V5-IA.md` S6 and Fix pass, `HARNESS-V5-FEEDBACK-R1.md` Copy rules and §D, on `ui-harness-v5` @ b5e813a5, and Round 6 @ 4f470775), the specs and the defaults set in decisions D02, D03, D08, D10 and D19 and workflow decisions D-W13, D-W14, D-W15, D-W22, D-W40, D-W42, D-W44, D-W53, D-W54 and D-W66. No implementation has been validated against them.
- G2: Unresolved implementation qualification: numerical measurement methods, metric set, masks, saturation, background, aperture and tolerances need fixture qualification in PIX planning (D03). The P2 fixture is mono, so CFA inspection as the recorded mosaic plane (D03) is not exercised. Blocks readiness.
- G3: Out of scope for this journey: no fixture holds NaN, infinity or masked samples, so PIX-AC-08's invalid-sample evidence is not exercised. Blocks readiness until covered by a step or a journey.
- G4: Out of scope for this journey: a frame shared with a second Project's candidates (PIX-AC-13) and its Rejected state in other Projects' runs (PIX-AC-12) are not observed, because the fixture has one NGC 7000 Project. A session entering a draft with library-Unusable frames that start visibly excluded (VSEL-AC-13) is not exercised. Blocks readiness until covered by a step or a journey.
- G5: Out of scope for this journey: no frame is trashed before this journey. J34/S7 covers a Trashed frame's absence from frame review (PIX-AC-19), and J33/S6 covers run-group review across panels (PIX-AC-18). Review from a library session (library marks only) is covered by J37. Review from a Project's candidates (HARNESS-V5-FEEDBACK-R1.md §D) is not exercised. Blocks readiness until covered by a step or a journey.
- G6: (dissolved 2026-10-12): answered by Round 6 "Reject is library-wide by default"; S8, S9, S10, S13 and S16 now assert X as the way a frame leaves the run: it reads "Rejected · Library" (library Unusable), leaves the draft at once, stays on disk, and U or P brings it back, while "Reject for this Project only" stays in the frame menu (S11b, S13).
- G7: (dissolved 2026-10-12): answered by Round 6 "Large bulk marks need confirmation"; S11 now asserts ⌥4, ⌘A and P on the 208 included frames asking "Mark 208 frames Usable?", with no frame marked before it is accepted.
- G8: Unresolved product question: Round 6 asks for confirmation on large bulk marks ("⌘A then P/X/U on many frames", "Mark 120 frames Unusable?") but sets no size. Options: (a, recommended) every mark on a ⌘A "Select all shown" selection asks, whatever its count; (b) a fixed frame count; (c) every mark on more than one frame. Single-frame P, X and U never ask. S8 and S13 mark frames one at a time so they do not depend on it, and a mark on a small multi-frame selection (for example six frames selected in the grid) is not exercised. Blocks readiness.
- G9: Unresolved product question: what **Discard** does to a Review draft made by X. X writes library Unusable at once, so the frame "leaves every run", but Discard returns the draft to the saved revision, which still holds the frame (the prototype's discardRunDraft changes nothing else). Options: (a, recommended) Discard also returns the frames its X marks covered to their previous library quality, so they rejoin the run consistently; (b) Discard resets only the draft, and the run counts library-Unusable frames until the next save; (c) Review offers no Discard for library rejections, and only U or P undo them. S8, S11a and S16 read Discard and use P or U instead of pressing it. Blocks readiness.

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
