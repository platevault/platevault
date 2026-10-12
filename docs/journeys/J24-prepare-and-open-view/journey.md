---
id: J24
title: Prepare a verified run folder beside its Results folder and open the application
version: 4
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [preparation, view-review, projects, status-bar]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 069-application-handoff, 070-results-reuse, D02, D04, D09, D13, D15, D19, D-W3, D-W5, D-W49, D-W51, D-W67, D-W72, specs/063-clean-rebuild-contract/decisions.md, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/069-application-handoff/spec.md, specs/070-results-reuse/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-f-prepare-and-open-the-view, HARNESS-V5-IA.md#S5, HARNESS-V5-IA.md#fix-pass, HARNESS-V5-FEEDBACK-R1.md#c-run-and-run-group, HARNESS-V5-FEEDBACK-R1.md#b-projects-project-new-project-start-run-trash-wrap-up, HARNESS-V5-FEEDBACK-R1.md#round-5, P-SB3, HARNESS-V5-FEEDBACK-R1.md#round-6, HARNESS-V5-FEEDBACK-R1.md#input-modes, P-PREP2, INPUT-MODES-RESEARCH.md]
---

## Goal

The user turns the reviewed run into one verified input layout and opens the
application, without omitting any selected input, reusing any existing folder,
or changing any original. Prepare's input mode is Automatic by default: every
input gets an independent copy, cloned where the volume can clone and copied
otherwise, and Prepare shows the real extra space it took. The run prepares
into `<output>/<Project>/<Run>/`, and its Results go to the sibling
`<Run> Results/` folder unless the user picks another Results location.

Done means:
- `Work/Processing/NGC 7000 HOO/NGC7000-HOO-Siril/` reads Prepared only after its 208 frame entries match the confirmed membership. Every entry is recorded as cloned, and the footprint reads "0 B extra · cloned".
- Results are recorded at `Work/Processing/NGC 7000 HOO/NGC7000-HOO-Siril Results/`.
- Siril opens on that preparation only after its entries re-verify, and quitting Siril leaves the run not Complete.
- A partial preparation names its blocked inputs and offers no verified Open. Retry completes only the recorded items. While Prepare runs, the run can be neither completed nor moved to the Project's Trash.
- A new preparation revision goes to a new `(rev 2)` folder, leaves the first folder unchanged, and sends its Results to the run's one Results folder.

## Preconditions

- P1: J23 completed.
- P2: The Siril profile's capability evidence (J23/S8) records that Siril needs a folder of frames and does not write into its input files. If that evidence is unknown or write-prone, Link to originals is blocked (D04), and S3 changes accordingly (G2).
- P3: Folders `Processing/` and `Outputs/` exist on the `Astro-T7` volume (shown below as `Work/Processing` and `Work/Outputs`), which also holds the captures and the Calibration library. Both are writable, with free space for two full copies of the 28 Sep session. `Astro-T7` clones within one volume (APFS on macOS; Btrfs or XFS with reflink, or ReFS, elsewhere) and supports symbolic links.
- P4: A network share `Scratch` is mounted with `Processing/` writable. The share supports no links and no OS Trash (macOS deletes immediately there), and a file prepared there from `Astro-T7` is a plain copy. `Scratch/Processing/NGC 7000 HOO/NGC7000-HOO-Siril/keep.txt` exists with unrelated content and a recorded SHA-256.
- P5: No run has been prepared in this catalog, so no last-used parent exists.
- P6: The J19/P5 manifest is available.
- P7: One of the three 28 Sep frames made unreadable in S15 is named. A backup of its original bytes and nanosecond mtime is kept outside PlateVault, together with a replacement file of identical size and different pixel bytes. A fault control pauses Prepare after that item's source snapshot is recorded and before terminal success (G5).
- P8: For one named 26 Sep frame, a backup of its original bytes and nanosecond mtime is kept outside PlateVault, together with a same-size variant whose pixel bytes differ. The read-only flag of that frame's prepared entry can be cleared outside PlateVault.

## Steps

### S1 — Read the input modes {#S1}

- **Do:** In `NGC7000-HOO-Siril`, open the Prepare step. Read the Application and Input mode sections, then choose Siril under Application.
- **Expect:** Application lists the application profiles by name, each with Verified or Not verified, Read-only, Write-prone or Writes unknown, and a ① marker whose tooltip holds its capability evidence; Siril reads Verified and Read-only. Once Siril is chosen, the Application profile check reads met. Input mode reads Automatic, chosen by default, and offers Independent copy, Link to originals and Give PixInsight the file list as overrides. Each names its semantics in a help tip: Automatic picks the safest option for each item; Independent copy gives the application its own copy of every input, cloned where the volume can clone and copied otherwise; Link to originals points the run folder at the originals; Give PixInsight the file list places nothing in the run folder. The Input mode check reads met with Automatic.
- **Expect (negative):** No mode that points at the originals is chosen for the user, and Prepare… is not refused for want of an input mode.
- **Trace:** flow F1 · PREP-FR-04 · D04 · HARNESS-V5-IA.md S5 Prepare ("profile, mode") · HARNESS-V5-FEEDBACK-R1.md §Input modes P-PREP2 ("three Prepare modes, Automatic by default") · INPUT-MODES-RESEARCH.md §10 · prototype c-runs/prepare-step.tsx ProfileSection

### S2 — Try Give PixInsight the file list {#S2}

- **Do:** Try to choose **Give PixInsight the file list** and read why it is unavailable.
- **Expect:** With Siril chosen it reads not available, because Siril always needs a folder of frames. Input mode stays Automatic, and Independent copy and Link to originals stay choosable.
- **Expect (negative):** No handoff of the source folders is offered: Siril is never handed the 30 Sep folder, which also holds the six rejected frames.
- **Trace:** flow F1 direct-source branch, cross-flow "Direct-source exclusion unsupported by tool" · PREP-FR-05 · PREP-AC-04 · root FR-005 · D04 · HARNESS-V5-FEEDBACK-R1.md §Input modes P-PREP2 ("Give PixInsight the file list: WBPP only. Siril always needs a folder.")

### S3 — Read the Link to originals warning {#S3}

- **Do:** Choose **Link to originals**, read its warning and cancel it. Choose it again and confirm the warning. Then choose **Automatic** again.
- **Expect:** The warning names that the run folder points at the originals, that an application that edits a frame edits the original, and that PlateVault re-hashes the originals after the run. After cancelling, Input mode still reads Automatic. After confirming, the Input mode check reads Link to originals. After choosing Automatic again, it reads Automatic.
- **Expect (negative):** Input mode does not become Link to originals without that confirmation, and switching modes links, copies or writes nothing. Choosing Automatic asks for no confirmation.
- **Trace:** flow F1 · PREP-FR-04 · PREP-AC-08 · HARNESS-V5-FEEDBACK-R1.md §Input modes P-PREP2 ("Link to originals (opt-in, with a warning)", "The originals are re-hashed after the run") · G2

### S4 — Choose a parent where the run folder exists {#S4}

- **Do:** In the Run folder section click **Choose folder…**, pick `Scratch/Processing` and click **Use**.
- **Expect:** Before the choice, the layout preview reads `<output>/` marked Not chosen, then `NGC 7000 HOO/`, `NGC7000-HOO-Siril/` marked New and `NGC7000-HOO-Siril Results/` marked "Results · every revision". After the choice it proposes `Scratch/Processing/NGC 7000 HOO/NGC7000-HOO-Siril/`, and the Run folder check reads "NGC7000-HOO-Siril exists" and blocks Prepare until another name or location is chosen.
- **Expect (negative):** `keep.txt` and the existing folder are unchanged (SHA-256 matches P4). The existing folder is not reused or cleared.
- **Trace:** flow F2, cross-flow "Destination collision" · PREP-FR-06 · PREP-AC-02 · root FR-004 · D-W51 · HARNESS-V5-IA.md S5 Prepare (layout preview `<output>/<Project>/<Run>/`)

### S5 — Lose the chosen parent {#S5}

- **Do:** Unmount `Scratch`, then continue.
- **Expect:** The review states that the chosen parent is unavailable and prompts for another choice.
- **Expect (negative):** No other drive is selected silently.
- **Trace:** flow F2 failure branch · PREP-FR-06 · PREP-AC-09

### S6 — Choose the run location {#S6}

- **Do:** Click **Change folder…**, pick `Work/Processing` and click **Use**.
- **Expect:** The layout preview shows the run folder `Work/Processing/NGC 7000 HOO/NGC7000-HOO-Siril/`, named from the Project and the run and marked New, and the Run folder check reads met.
- **Trace:** flow F2 · PREP-FR-06 · PREP-AC-01 · D-W51 · HARNESS-V5-IA.md S5 Prepare

### S7 — Read the Results folder {#S7}

- **Do:** Read the Results line of the layout preview.
- **Expect:** It reads `NGC7000-HOO-Siril Results/` at the Project level, marked "Results · every revision", which places it at `Work/Processing/NGC 7000 HOO/NGC7000-HOO-Siril Results/`, a sibling of the run folder, and it is recorded on the run for Result discovery.
- **Expect (negative):** The Results folder is not inside the run folder, so Siril cannot read its own output as input.
- **Trace:** flow F3 · PREP-FR-07 · PREP-AC-01 · D-W51

### S8 — Review preparation and confirm membership {#S8}

- **Do:** Read the Prepare step's Review section, then click **Prepare…** and read the confirmation.
- **Expect:**
  - The Review section shows `208 frames` and the count of masters assigned in J23. Its checks read met: Run state, Saved membership (the saved revision), Calibration, Application profile (Siril), Input mode Automatic, Run folder, Free space as "<bytes> of <free> free", Source presence as "N sources readable", and Inputs.
  - The confirmation is titled "Prepare NGC7000-HOO-Siril?", names Siril and the Automatic input mode, and lists "Creates Work/Processing/NGC 7000 HOO/NGC7000-HOO-Siril" and the N entries it writes, with N the 208 frames plus the assigned masters.
  - Its button reads "Prepare N inputs" with the same N.
- **Expect (negative):** Nothing is created under `Work/Processing` before the confirmation is accepted in S9. Unknown or omitted inputs are not counted as prepared. No calibration input that reads Suggested or Needs review is handed off. The confirmation lists no "Unchanged" or "What stays" items.
- **Trace:** flow F4 · PREP-FR-08 · PREP-AC-01, PREP-AC-13 · CAL-FR-08 · D02, D-W5 · HARNESS-V5-FEEDBACK-R1.md Copy rules ("No 'Unchanged / What stays' lists") · prototype c-runs/prepare-step.tsx prepareChanges

### S9 — Prepare the run {#S9}

- **Do:** Click **Prepare N inputs** in the confirmation. Watch the status bar and the Preparation section until it settles.
- **Expect:** The Preparation section shows the operation as Running with progress, and the status bar's middle shows it as running work with a mini progress bar. It ends Prepared only after the 208 prepared frame entries match the confirmed membership and their source snapshots, and the status bar then reads Idle. The Preparation section reads Prepared, shows the folder `NGC7000-HOO-Siril/`, the mode Automatic with every entry recorded as cloned, the membership revision it prepared and the time, a footprint reading "0 B extra · cloned", "Prepared · N/N", "Blocked · 0" and **Open in Siril**. Each entry is read-only once verified. In the step bar Prepare reads Prepared, and Next reads "Open in application".
- **Expect (negative):** The start acknowledgment does not read as success. No entry is a link to an original. The manifest still equals P6, and no library quality state changes.
- **Trace:** flow F5 · PREP-FR-09, PREP-FR-10 · root SC-003 · VSEL-FR-11 · HARNESS-V5-FEEDBACK-R1.md §C ("show the footprint (prepared bytes) there"), Round 5 P-SB3 (running work in the status bar), §Input modes P-PREP2 ("Footprint is real", "Entries are made read-only once verified")

### S10 — Open with a missing executable {#S10}

- **Do:** Move the Siril application out of its located path, then click **Open in Siril**.
- **Expect:** Open is refused: "Open blocked" names "Siril not located" in its blockers, and the Preparation section's last launch reads "Not located".
- **Expect (negative):** The run stays Prepared, with its decisions and entries unchanged.
- **Trace:** flow F6 failure branch · PREP-FR-10 · PREP-AC-10 · HARNESS-V5-FEEDBACK-R1.md Copy rules (terse refusals) · prototype c-runs/actions.ts openPreparation

### S10a — Open after an entry changed {#S10a}

- **Do:** Restore Siril to its located path. Overwrite the P8 frame's original in place with its variant, restore its recorded mtime, read its entry in the Preparation section, and compute the entry's SHA-256 outside PlateVault. Then, outside PlateVault, clear the read-only flag on that frame's entry in `NGC7000-HOO-Siril/`, overwrite the entry with the variant, and click **Open in Siril**.
- **Expect:** The P8 entry reads cloned and read-only. After the original changes, the entry still holds its prepared bytes: its SHA-256 equals the P8 backup's. After the entry itself is overwritten, Siril is not launched. Open is refused with the P8 entry named as "Changed since its preparation snapshot: its SHA-256 differs.". The Preparation section reads Unverified, with "Unverified since <time> · 1 entry changed" naming that entry.
- **Expect (negative):** Changing the original changes no prepared entry, and Open does not launch on the changed entry. PlateVault writes nothing to the frame or its entry.
- **Trace:** flow F6 failure branch, cross-flow "External changes" · PREP-FR-10 · PREP-AC-15 · D19 · HARNESS-V5-FEEDBACK-R1.md §Input modes P-PREP2 ("Independent copy", "Entries are made read-only once verified")

### S11 — Open Siril {#S11}

- **Do:** Restore the P8 frame's original bytes and recorded mtime, and overwrite its entry with the same backup bytes. Click **Open in Siril**, inspect the prepared inputs in Siril, then quit Siril.
- **Expect:** Open re-verifies every entry against its preparation snapshot, then Siril opens on the prepared run folder. A notice reads "Opened NGC7000-HOO-Siril in Siril" with "N entries re-verified before launch; Work/Processing/NGC 7000 HOO/NGC7000-HOO-Siril.", the Unverified state clears, and the last launch reads "Opened". PlateVault records the launch separately from processing completion.
- **Expect (negative):** Quitting Siril does not mark the run Complete; its header still reads Open and offers **Complete**.
- **Trace:** flow F6 · PREP-FR-10 · PREP-AC-10, PREP-AC-15 · root edge "External application exit" · HARNESS-V5-IA.md S5 Prepare ("Open re-verifies")

### S12 — Start a disposable check run {#S12}

- **Do:** In Project `NGC 7000 HOO`, click **Start run…** and choose subject NGC 7000, rig RedCat and, under "Profile (optional)", Siril, and start the run. Choose **Rename** on the run header and rename it `28 Sep Ha copy check`. In its Select step every candidate starts selected; leave only 28 Sep selected. Let Calibrate assign automatically, and save the run.
- **Expect:** The new run is named `NGC 7000 RedCat` until the rename; afterwards its header and the Project's Runs table read `28 Sep Ha copy check`. The summary reads 56 frames / 4h 40m in Project `NGC 7000 HOO`, and the readiness line reads every group matched. Its Prepare step shows Siril chosen under Application.
- **Expect (negative):** Renaming changes no subject, rig, profile or membership, and creates no folder.
- **Trace:** flow C5, E1 · VSEL-FR-01, VSEL-FR-03 · CAL-FR-02 · D-W49, D-W5 · HARNESS-V5-FEEDBACK-R1.md §B Start run sheet ("Keep to subject, rig and profile (optional)"), §Round 6 "Rename runs and Projects" (Start run stays subject + rig + profile, auto-named)

### S13 — Meet a destination that cannot link {#S13}

- **Do:** Remount `Scratch`. Choose `Scratch/Processing` as the run folder's parent. Read the Input mode section and the Review checks, then try to choose **Link to originals**.
- **Expect:** The layout preview reads `Scratch/Processing/NGC 7000 HOO/28 Sep Ha copy check/`. Link to originals reads blocked, with blockers that name the missing link support at that destination, and cannot be chosen. Input mode stays Automatic, and Automatic and Independent copy stay choosable, each with its semantics.
- **Expect (negative):** Nothing is written to `Scratch` before a preparation is confirmed. No mode silently becomes another: Input mode changes only when the user chooses one.
- **Trace:** flow F4, cross-flow "Unsupported input mode" · PREP-FR-04, PREP-FR-06, PREP-FR-08 · PREP-AC-03 · HARNESS-V5-FEEDBACK-R1.md §Input modes P-PREP2 · INPUT-MODES-RESEARCH.md §10 ("Run folder on NAS, source local": never Link to originals) · prototype c-runs/prepare-step.tsx ModeSection

### S14 — Choose patched copies and another Results parent {#S14}

- **Do:** Read the Results line. Choose **Independent copy**, and in Corrected metadata choose **Patched copy** for the 28 Sep correction. Click **Change Results location...** and choose `Work/Outputs`.
- **Expect:** Before the change, the Results line reads `28 Sep Ha copy check Results/` beside the run folder, at `Scratch/Processing/NGC 7000 HOO/`, the default. The patched effective focal length shows for every copy, the Corrected metadata check reads met, and the Results location reads `Work/Outputs/NGC 7000 HOO/28 Sep Ha copy check Results/`.
- **Expect (negative):** Results are not written to `Work/Outputs` itself, to `Work/Outputs/28 Sep Ha copy check Results/` without the Project level, or inside the run folder. Patched copy is never accepted with Link to originals or Give PixInsight the file list.
- **Trace:** flow E4, F3 · PREP-FR-03, PREP-FR-07 · D15, D-W51 · HARNESS-V5-FEEDBACK-R1.md §Round 6 "Results location override stays" (default: beside the run folder)

### S15 — Prepare with blocked inputs {#S15}

- **Do:** Remove read permission from three 28 Sep source frames. Click **Prepare…**, read the confirmation and confirm. While it runs, click **Complete** and then **Move to Trash** in this run's header. Then click **Complete** in `24 Sep flat check` (J23/S7).
- **Expect:**
  - Before the start, the Source presence check reads "3 sources unreadable · Partial", and the confirmation lists "3 inputs blocked · Partial".
  - In `28 Sep Ha copy check`, **Complete** and **Move to Trash** are each refused ("Complete blocked", "Move to Trash blocked"), and each refusal names this run's running preparation among its blockers.
  - The unrelated `24 Sep flat check` is not blocked and reads Complete.
  - The outcome reads "Partial 53/56", in the Preparation section and on the step bar's Prepare step, with "Prepared · 53/56" and "Blocked · 3" listing each blocked entry by its path and reason.
  - **Retry** is offered for the journaled blocked entries, and the partial run stays as it is until the user acts.
- **Expect (negative):** No verified Open is offered. The three sources are untouched. `28 Sep Ha copy check` is not Complete, stays outside the Project's Trash, and its folders are in place.
- **Trace:** flow F5 failure branch, cross-flow "Partial preparation" · PREP-FR-09 · PREP-AC-05 · RES-FR-07, RES-FR-10 · RES-AC-07, RES-AC-20 · root FR-004, FR-009 · D09, D-W72 · HARNESS-V5-IA.md S5 (Prepare "Partial lists"; Refusals name their blockers), Fix pass "Gate words"

### S15a — Retry into source drift {#S15a}

- **Do:** Restore read permission on the three frames. Arm the P7 pause and choose **Retry**. When the pause reports the P7 frame's source snapshot recorded, overwrite that source with its replacement, restore its recorded mtime, and release the pause.
- **Expect:** The P7 item reads blocked, with source drift named. The other two retried entries read prepared after their copies re-read to match their source snapshots. The outcome reads "Partial 55/56", with 55 prepared and 1 blocked.
- **Expect (negative):** No verified Open is offered, and the P7 item never reads Prepared. PlateVault writes nothing to the changed source.
- **Trace:** flow F5 failure branch · PREP-FR-09 · PREP-AC-14 · D09

### S16 — Retry and verify custody {#S16}

- **Do:** Restore the P7 frame's original bytes and recorded mtime, and choose **Retry**. Then compare a prepared copy's header with its original and recompute the manifest.
- **Expect:** Retry prepares the journaled entry only after its source matches a fresh snapshot and its copy re-reads to match. The run reads Prepared, with 56 entries matching its membership, every entry recorded as copied, and its footprint reads the 56 copies' size as copied, in the form "12.4 GB copied". The prepared copy carries the patched focal length.
- **Expect (negative):** No entry reads cloned or linked, because `Scratch` can do neither. The original is byte-identical and the manifest equals P6. Retry does not infer completion from filenames already present.
- **Trace:** flow F5 · PREP-FR-03, PREP-FR-09 · PREP-AC-06, PREP-AC-14 · D09, D15 · HARNESS-V5-FEEDBACK-R1.md §Input modes P-PREP2 ("Footprint is real": "12.4 GB copied")

### S17 — Prepare a second revision {#S17}

- **Do:** In `28 Sep Ha copy check`'s Review step, open the frame menu of one named 28 Sep frame other than F1 and F2, choose **Reject for this Project**, confirm with **Reject 1 frame**, and click **Save run**. Open Prepare, read it, click **Prepare…**, read the confirmation and confirm. Then open Project `NGC 7000 HOO` and `NGC7000-HOO-Siril`.
- **Expect:**
  - The frame reads "Rejected · This Project", and its library quality stays Usable. The run saves membership revision 2 with 55 frames.
  - The Preparation section marks the first preparation "Membership changed · prepare r<new revision>".
  - The layout preview proposes a new run folder, `Scratch/Processing/NGC 7000 HOO/28 Sep Ha copy check (rev 2)/`, marked "New · rev 2", and keeps the Results line `28 Sep Ha copy check Results/` ("Results · every revision") at `Work/Outputs/NGC 7000 HOO/`, shared by both revisions.
  - The confirmation is titled "Prepare 28 Sep Ha copy check (rev 2)?".
  - Revision 2 ends Prepared with 55 entries: the section reads "Preparation (rev 2)" and the step bar's Prepare reads "Prepared (rev 2)". The run lists both preparation revisions.
  - The Project reads Ha `9h 10m in project`, and its captured value stays `12h 35m`.
- **Expect (negative):** The first folder `28 Sep Ha copy check/` keeps its 56 entries unchanged. No existing folder is reused, replaced or cleared, and no second Results folder is proposed for revision 2. `NGC7000-HOO-Siril` still reads `Saved r2` with 208 lights and Prepared, with its entries unchanged (G10).
- **Trace:** flow F5 · PREP-FR-06, PREP-FR-07, PREP-FR-11 · PREP-AC-12, PREP-AC-21 · VSEL-FR-11, VSEL-FR-15 · PRJ-FR-04 · D09, D-W51, D-W54, D-W67 · HARNESS-V5-IA.md S5 Prepare ("`(rev N)`") · HARNESS-V5-FEEDBACK-R1.md §Round 6 "Reject is library-wide by default" ("Reject for this Project only" stays in the frame menu)

## Success criteria

- SC1: Prepared appears only when all 208 entries match the confirmed membership (S9). Every Prepare ends in exactly one of Prepared, Partial, Failed, Canceled or Paused.
- SC2: The run folder is `<parent>/NGC 7000 HOO/<run>/`, and its Results folder is a sibling outside it in S6 and S7 and again in S13. After the S14 override the Results folder is `Work/Outputs/NGC 7000 HOO/<run> Results/`, still outside the run folder.
- SC3: `keep.txt` and its folder are unchanged (S4), and no drive is substituted silently (S5).
- SC4: The capture and calibration manifest equals P6 after S9 and after S16. Prepare changes 0 quality states.
- SC5: The partial outcome reports exactly 53 prepared and 3 blocked, with no verified Open (S15). After Retry the run reads 56 Prepared (S16).
- SC6: When linking is unsupported, Link to originals reads blocked while Automatic and Independent copy stay choosable, and 0 files reach `Scratch` before a preparation is confirmed (S13).
- SC7: Launching and quitting Siril leave the run not Complete. A missing executable leaves it Prepared, with Open refused and the launch reading "Not located" (S10, S11).
- SC8: Only the copies carry the patched value (S16).
- SC9: The drifted P7 item reads Prepared 0 times while its source differs from its snapshot (S15a), and the manifest equals P6 after S16.
- SC10: Siril launches 0 times while the P8 entry differs from its snapshot (S10a), and it launches after the S11 re-verification. Changing the P8 original changes its cloned entry 0 times (S10a).
- SC11: Revision 2 lands in a new `(rev 2)` folder, with 55 entries. The first folder still holds its 56 entries, both revisions share one Results folder, and the Project-only reject changes library quality 0 times (S17).
- SC12: While Prepare runs, **Complete** and **Move to Trash** are each refused with the running preparation named. After S15, `28 Sep Ha copy check` is still on the Project's run list, outside the Project's Trash, with its folders in place.
- SC13: The footprint reads "0 B extra · cloned" for `NGC7000-HOO-Siril`, with every entry recorded as cloned (S9), and the 56 copies' size as copied for `28 Sep Ha copy check`, with all 56 entries recorded as copied (S16).
- SC14: Input mode reads Automatic until the user chooses another; Link to originals is chosen only after its warning is confirmed (S3), and Give PixInsight the file list is available for Siril 0 times (S2).

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Product behavior follows the harness v5 design (`apps/prototype/design/HARNESS-V5-IA.md` S5 and Fix pass, `HARNESS-V5-FEEDBACK-R1.md` Copy rules, §B, §C and Round 5, on `ui-harness-v5` @ b5e813a5, Round 6 @ 4f470775 and §Input modes P-PREP2 @ d609ff55), the specs, the decisions D02, D04, D09, D13, D15 and D19 set by the authorized autonomous run, and the user's workflow decisions cited above. No implementation has been validated against them.
- G2: Unresolved implementation qualification: Siril's exact handoff and its input-write behavior (P2) need a profile capability probe (D04). S3 depends on it. Blocks readiness.
- G3: Out of scope for this journey: Automatic deciding per item across mixed volumes, so that one preparation holds both cloned and copied entries (D04, PREP-FR-08), and the re-hash of the originals after a Link to originals run, are not exercised. Blocks readiness until covered by a step or a journey.
- G4: Unresolved implementation qualification: the specs do not say which preparation phases offer Cancel or Pause "where safe". The Canceled and Paused outcomes are not exercised. Blocks readiness.
- G5: Unresolved implementation qualification: no fault control yet pauses Prepare between a source snapshot and terminal success (P7), and S15a depends on it. Blocks readiness.
- G6: (dissolved 2026-10-12): answered by §Input modes P-PREP2 (hard links are no longer a mode of their own, Automatic is the default, Link to originals is opt-in with a warning); S1 now asserts Automatic preselected, S3 the Link to originals warning and its confirmation, S9 and S16 the real footprint ("0 B extra · cloned", the copied size), and S10a an entry that an original's change cannot reach.
- G7: (dissolved 2026-10-12): answered by Round 6 "Results location override stays"; S14 now asserts the default Results folder beside the run folder and the override to `Work/Outputs/NGC 7000 HOO/28 Sep Ha copy check Results/`.
- G8: (dissolved 2026-10-12): answered by Round 6 "Rename runs and Projects"; S12 now asserts the run starting as `NGC 7000 RedCat` and its rename on the run header to `28 Sep Ha copy check`.
- G9: (dissolved 2026-10-12): answered by Round 6 "Reject is library-wide by default"; S17 now makes revision 2 with "Reject for this Project only" on one 28 Sep frame, whose library quality stays Usable, as in J22/S11b.
- G10: Unresolved product question: what a rejection made in one run does to another open run of the same Project whose saved revision holds the frame. Round 6 says an X'd frame "leaves every run", and a Project-only reject takes the frame out of the Project's totals, but saved and prepared revisions never change on a mark (D-W54, VSEL-FR-14). S17 asserts only that `NGC7000-HOO-Siril` keeps saved revision 2 and its prepared entries. Options: (a, recommended) every other open run that holds the frame gets a Review draft without it ("1 rejected, unsaved"), and its saved and prepared revisions change only on Save run and a new Prepare; (b) other runs show nothing until their next Refresh selection, which lists the frame as rejected; (c) only the run where the mark was made changes, and other runs keep the frame until the user removes it there. Blocks readiness.

## Delta log

- **Δ2** 2026-10-06 · S1, S4, S6, S7, S8, S9, S10, S12, S13, S14, S15, +S17 · behavior-change
  Views are processing runs in a Project. A run prepares to `<output>/<Project>/<Run>/`, Results go to the sibling `<Run> Results/`, and each new revision gets a `(rev 2)` folder that shares that one Results folder. The check runs are created in the Project, and their pickers start with every candidate selected. A running preparation refuses Move run to Trash exactly as it refuses Mark processing complete.
  Evidence: specs/069-application-handoff PREP-FR-06, PREP-FR-07, PREP-FR-11, PREP-AC-01, PREP-AC-21. D-W3, D-W49, D-W51, D-W67 at e4476231. D-W67, D-W72. 069 PREP-FR-06, PREP-FR-07, PREP-FR-11 and PREP-AC-21 as amended. 070 RES-FR-07, RES-FR-10, RES-AC-20 · by: JourneysC (intent-gated)
- **Δ3** 2026-10-12 · S1, S2, S3, S4, S6, S7, S8, S9, S10, S10a, S11, S12, S13, S14, S15, S15a, S16, S17 · behavior-change
  Prepare shows Application (profile cards with evidence), Input mode (Linked run, Direct source, Copy, Clone, none preselected) and a layout preview, with checks and a confirmation that names what it creates. The outcome shows the footprint (prepared bytes), "Partial 53/56" with Prepared and Blocked lists, and "(rev 2)".
  Open refuses tersely with its blockers ("Siril not located", changed entries), replacing Choose application / Reveal run folder. The header's actions read Complete and Move to Trash. Start run takes the profile as optional.
  Evidence: HARNESS-V5-IA.md §Screens S5 (Prepare: "profile, mode, layout preview, (rev N), Partial lists, Open re-verifies"; Refusals) and §Fix pass ("Gate words"); HARNESS-V5-FEEDBACK-R1.md §Copy rules, §Screens B (Start run sheet) and C ("show the footprint (prepared bytes)"), §Round 5 P-SB3; prototype src/features/v5/c-runs/prepare-step.tsx, actions.ts, run.tsx and messages/en-GB.json (apps/prototype/ on ui-harness-v5 @ b5e813a5); user instruction 2026-10-12 · by: JourneysV5.U3Runs (intent-gated)
- **Δ4** 2026-10-12 · S1, S2, S3, S8, S9, S10a, S11, S12, S13, S14, S16, S17 · behavior-change
  Input mode is Automatic by default, with Independent copy, Link to originals (opt-in, with a warning) and Give PixInsight the file list (not for Siril); hard links and Direct source are gone. Entries are cloned or copied, read-only once verified, and the footprint shows the real extra space ("0 B extra · cloned", "12.4 GB copied").
  The check run starts auto-named and is renamed on the run header, keeps the Results location override, and gets revision 2 from a Project-only reject.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Rename runs and Projects", "Results location override stays", "Reject is library-wide by default" (apps/prototype/design/ on ui-harness-v5 @ 4f470775) and §Input modes (user, 2026-10-10) P-PREP2 (@ d609ff55; research INPUT-MODES-RESEARCH.md); user answers to the PR #1788 journey questions · by: JourneysV5.R6B (intent-gated)
