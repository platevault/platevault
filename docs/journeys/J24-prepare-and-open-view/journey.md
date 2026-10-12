---
id: J24
title: Prepare a verified run folder beside its Results folder and open the application
version: 5
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [preparation, view-review, projects, status-bar]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 069-application-handoff, 070-results-reuse, D02, D04, D09, D13, D15, D19, D-W3, D-W5, D-W49, D-W51, D-W67, D-W72, specs/063-clean-rebuild-contract/decisions.md, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/069-application-handoff/spec.md, specs/070-results-reuse/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-f-prepare-and-open-the-view, HARNESS-V5-IA.md#S5, HARNESS-V5-IA.md#fix-pass, HARNESS-V5-FEEDBACK-R1.md#c-run-and-run-group, HARNESS-V5-FEEDBACK-R1.md#b-projects-project-new-project-start-run-trash-wrap-up, HARNESS-V5-FEEDBACK-R1.md#round-5, P-SB3, HARNESS-V5-FEEDBACK-R1.md#round-6, HARNESS-V5-FEEDBACK-R1.md#round-7, P-PREP3, RUN-VIEWS-OPTIONS.md]
---

## Goal

The user turns the reviewed run into one verified run view and opens the
application, without omitting any selected input, reusing any existing folder,
or changing any original. Prepare's run view is Symlinks by default, as set in
Settings: the run folder holds symlinks to the catalogue originals and takes no
space. Copies is the alternative: the run folder holds temporary copies, which
are removed when the run completes. On Windows, Symlinks need Windows Developer
Mode. The run prepares into `<output>/<Project>/<Run>/`, and its Results go to
the sibling `<Run> Results/` folder unless the user picks another Results
location.

Done means:
- `Work/Processing/NGC 7000 HOO/NGC7000-HOO-Siril/` reads Prepared only after its 208 frame entries match the confirmed membership. Every entry is a symlink to its catalogue original, and the footprint reads "Linked · 0 B".
- On Windows with Developer Mode off, Prepare in Symlinks is refused and creates nothing.
- Results are recorded at `Work/Processing/NGC 7000 HOO/NGC7000-HOO-Siril Results/`.
- Siril opens on that preparation only after its entries re-verify, and quitting Siril leaves the run not Complete.
- A partial preparation names its blocked inputs and offers no verified Open. Retry completes only the recorded items. While Prepare runs, the run can be neither completed nor moved to the Project's Trash.
- A new preparation revision goes to a new `(rev 2)` folder, leaves the first folder unchanged, and sends its Results to the run's one Results folder.

## Preconditions

- P1: J23 completed.
- P2: The Siril profile's capability evidence (J23/S8) records that Siril needs a folder of frames and does not write into its input files. If that evidence is unknown or write-prone, whether Symlinks stays choosable is an open product question (J23/G7), and S1 depends on the probe (G2).
- P3: Folders `Processing/` and `Outputs/` exist on the `Astro-T7` volume (shown below as `Work/Processing` and `Work/Outputs`), which also holds the captures and the Calibration library. Both are writable, with free space for two full copies of the 28 Sep session. `Astro-T7` supports symbolic links.
- P4: A network share `Scratch` is mounted with `Processing/` writable. The share holds no symlinks and has no OS Trash (macOS deletes immediately there), so a file prepared there from `Astro-T7` is a copy. `Scratch/Processing/NGC 7000 HOO/NGC7000-HOO-Siril/keep.txt` exists with unrelated content and a recorded SHA-256.
- P5: No run has been prepared in this catalog, so no last-used parent exists.
- P6: The J19/P5 manifest is available.
- P7: One of the three 28 Sep frames made unreadable in S15 is named. A backup of its original bytes and nanosecond mtime is kept outside PlateVault, together with a replacement file of identical size and different pixel bytes. A fault control pauses Prepare after that item's source snapshot is recorded and before terminal success (G5).
- P8: For one named 26 Sep frame, a backup of its original bytes and nanosecond mtime is kept outside PlateVault, together with a same-size variant whose pixel bytes differ.
- P9: Settings › Applications' Default run view reads Symlinks. On the `desktop-ui` (Windows) lane, Windows Developer Mode is off at the start, and the validator can turn it on in Windows Settings. The `desktop-ui-macos` lane has no Developer Mode prerequisite.

## Steps

### S1 — Read the run view modes {#S1}

- **Do:** In `NGC7000-HOO-Siril`, open the Prepare step. Read the Application and Run view sections, then choose Siril under Application.
- **Expect:** Application lists the application profiles by name, each with Verified or Not verified, Read-only, Write-prone or Writes unknown, and a ① marker whose tooltip holds its capability evidence; Siril reads Verified and Read-only. Once Siril is chosen, the Application profile check reads met. Run view reads Symlinks, the Settings default, and offers Copies. Each names its semantics in a help tip: Symlinks puts symlinks to the catalogue originals in the run folder ("Linked · 0 B"); Copies puts temporary copies there, removed when the run completes ("N frames copied · X GB").
- **Expect (negative):** Run view offers exactly these two modes. Switching between them links, copies or writes nothing and asks for no confirmation.
- **Trace:** flow F1 · PREP-FR-04 · D04 · HARNESS-V5-IA.md S5 Prepare ("profile, mode") · HARNESS-V5-FEEDBACK-R1.md §Round 7 P-PREP3 ("two view modes, Symlinks by default", "a default in Settings") · RUN-VIEWS-OPTIONS.md · prototype c-runs/prepare-step.tsx ProfileSection

### S1a — Meet the Windows Developer Mode refusal {#S1a}

- **Do:** On the `desktop-ui` lane, with Developer Mode off (P9), click **Prepare…** and open the refusal's disclosure. Choose **Use copies for this run**, then read Run view and the Default run view in Settings › Applications. Choose **Symlinks** again and click **Prepare…**. Choose **Open Windows settings**, turn Developer Mode on, return to PlateVault and click **Check again**.
- **Expect:**
  - Prepare is refused: "Can't prepare · symlinks need Windows Developer Mode ▸", and the disclosure offers **Open Windows settings**, **Check again** and **Use copies for this run**.
  - After **Use copies for this run**, Run view reads Copies for this run, and Default run view still reads Symlinks. Choosing Symlinks again brings the refusal back.
  - **Open Windows settings** opens Windows Settings at its Developer Mode setting. After **Check again**, the refusal clears, Run view reads Symlinks and its check reads met.
- **Expect (negative):** Nothing is created under `Work/Processing` while Prepare is refused. Run view becomes Copies only when the user chooses **Use copies for this run**, and that choice leaves the Settings default unchanged. On the `desktop-ui-macos` lane the step is skipped: Prepare shows no Developer Mode check and is never refused for it.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 7 P-PREP3 ("Windows prerequisite": checked in setup, in Settings and at Prepare), Copy rules (terse refusals)

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
  - The Review section shows `208 frames` and the count of masters assigned in J23. Its checks read met: Run state, Saved membership (the saved revision), Calibration, Application profile (Siril), Run view Symlinks, Run folder, Free space as "<bytes> of <free> free", Source presence as "N sources readable", and Inputs.
  - The confirmation is titled "Prepare NGC7000-HOO-Siril?", names Siril and the Symlinks run view, and lists "Creates Work/Processing/NGC 7000 HOO/NGC7000-HOO-Siril" and the N entries it writes, with N the 208 frames plus the assigned masters.
  - Its button reads "Prepare N inputs" with the same N.
- **Expect (negative):** Nothing is created under `Work/Processing` before the confirmation is accepted in S9. Unknown or omitted inputs are not counted as prepared. No calibration input that reads Suggested or Needs review is handed off. The confirmation lists no "Unchanged" or "What stays" items.
- **Trace:** flow F4 · PREP-FR-08 · PREP-AC-01, PREP-AC-13 · CAL-FR-08 · D02, D-W5 · HARNESS-V5-FEEDBACK-R1.md Copy rules ("No 'Unchanged / What stays' lists") · prototype c-runs/prepare-step.tsx prepareChanges

### S9 — Prepare the run {#S9}

- **Do:** Click **Prepare N inputs** in the confirmation. Watch the status bar and the Preparation section until it settles.
- **Expect:** The Preparation section shows the operation as Running with progress, and the status bar's middle shows it as running work with a mini progress bar. It ends Prepared only after the 208 prepared frame entries match the confirmed membership and their source snapshots, and the status bar then reads Idle. The Preparation section reads Prepared, shows the folder `NGC7000-HOO-Siril/`, the run view Symlinks with every entry a symlink to its catalogue original, the membership revision it prepared and the time, a footprint reading "Linked · 0 B", "Prepared · N/N", "Blocked · 0" and **Open in Siril**. In the step bar Prepare reads Prepared, and Next reads "Open in application".
- **Expect (negative):** The start acknowledgment does not read as success. No entry is a copy. The manifest still equals P6, and no library quality state changes.
- **Trace:** flow F5 · PREP-FR-09, PREP-FR-10 · root SC-003 · VSEL-FR-11 · HARNESS-V5-FEEDBACK-R1.md §C ("show the footprint (prepared bytes) there"), Round 5 P-SB3 (running work in the status bar), §Round 7 P-PREP3 ("Symlinks (default)": "Linked · 0 B")

### S10 — Open with a missing executable {#S10}

- **Do:** Move the Siril application out of its located path, then click **Open in Siril**.
- **Expect:** Open is refused: "Open blocked" names "Siril not located" in its blockers, and the Preparation section's last launch reads "Not located".
- **Expect (negative):** The run stays Prepared, with its decisions and entries unchanged.
- **Trace:** flow F6 failure branch · PREP-FR-10 · PREP-AC-10 · HARNESS-V5-FEEDBACK-R1.md Copy rules (terse refusals) · prototype c-runs/actions.ts openPreparation

### S10a — Open after an original changed {#S10a}

- **Do:** Restore Siril to its located path. Overwrite the P8 frame's original in place with its variant, restore its recorded mtime, read its entry in the Preparation section, and click **Open in Siril**.
- **Expect:** The P8 entry reads as a symlink to that original. Siril is not launched: Open is refused with the P8 entry named as "Changed since its preparation snapshot: its SHA-256 differs.". The Preparation section reads Unverified, with "Unverified since <time> · 1 entry changed" naming that entry.
- **Expect (negative):** Open does not launch on the changed entry. PlateVault writes nothing to the frame or its entry.
- **Trace:** flow F6 failure branch, cross-flow "External changes" · PREP-FR-10 · PREP-AC-15 · D19 · HARNESS-V5-IA.md S5 Prepare ("Open re-verifies") · HARNESS-V5-FEEDBACK-R1.md §Round 7 P-PREP3 (the run folder holds symlinks to the catalogue originals)

### S11 — Open Siril {#S11}

- **Do:** Restore the P8 frame's original bytes and recorded mtime. Click **Open in Siril**, inspect the prepared inputs in Siril, then quit Siril.
- **Expect:** Open re-verifies every entry against its preparation snapshot, then Siril opens on the prepared run folder. A notice reads "Opened NGC7000-HOO-Siril in Siril" with "N entries re-verified before launch; Work/Processing/NGC 7000 HOO/NGC7000-HOO-Siril.", the Unverified state clears, and the last launch reads "Opened". PlateVault records the launch separately from processing completion.
- **Expect (negative):** Quitting Siril does not mark the run Complete; its header still reads Open and offers **Complete**.
- **Trace:** flow F6 · PREP-FR-10 · PREP-AC-10, PREP-AC-15 · root edge "External application exit" · HARNESS-V5-IA.md S5 Prepare ("Open re-verifies")

### S12 — Start a disposable check run {#S12}

- **Do:** In Project `NGC 7000 HOO`, click **Start run…** and choose subject NGC 7000, rig RedCat and, under "Profile (optional)", Siril, and start the run. Choose **Rename** on the run header and rename it `28 Sep Ha copy check`. In its Select step every candidate starts selected; leave only 28 Sep selected. Let Calibrate assign automatically, and save the run.
- **Expect:** The new run is named `NGC 7000 RedCat` until the rename; afterwards its header and the Project's Runs table read `28 Sep Ha copy check`. The summary reads 56 frames / 4h 40m in Project `NGC 7000 HOO`, and the readiness line reads every group matched. Its Prepare step shows Siril chosen under Application.
- **Expect (negative):** Renaming changes no subject, rig, profile or membership, and creates no folder.
- **Trace:** flow C5, E1 · VSEL-FR-01, VSEL-FR-03 · CAL-FR-02 · D-W49, D-W5 · HARNESS-V5-FEEDBACK-R1.md §B Start run sheet ("Keep to subject, rig and profile (optional)"), §Round 6 "Rename runs and Projects" (Start run stays subject + rig + profile, auto-named)

### S13 — Meet a destination that cannot link {#S13}

- **Do:** Remount `Scratch`. Choose `Scratch/Processing` as the run folder's parent. Read the Run view section and the Review checks, then choose **Copies**.
- **Expect:** The layout preview reads `Scratch/Processing/NGC 7000 HOO/28 Sep Ha copy check/`. With Symlinks, the Run view check reads blocked with "Scratch: no symlinks", and Prepare cannot start. After choosing Copies, the check reads met, and Run view's help tip reads that the copies are removed when the run completes.
- **Expect (negative):** Nothing is written to `Scratch` before a preparation is confirmed. Run view does not become Copies until the user chooses it.
- **Trace:** flow F4, cross-flow "Unsupported input mode" · PREP-FR-04, PREP-FR-06, PREP-FR-08 · PREP-AC-03 · HARNESS-V5-FEEDBACK-R1.md §Round 7 P-PREP3 ("Copies") · prototype c-runs/prepare-step.tsx ModeSection, messages/en-GB.json `run_mode_no_symlinks`

### S14 — Choose patched copies and another Results parent {#S14}

- **Do:** Read the Results line. In Corrected metadata choose **Patched copy** for the 28 Sep correction. Click **Change Results location...** and choose `Work/Outputs`.
- **Expect:** Before the change, the Results line reads `28 Sep Ha copy check Results/` beside the run folder, at `Scratch/Processing/NGC 7000 HOO/`, the default. The patched effective focal length shows for every copy, the Corrected metadata check reads met, and the Results location reads `Work/Outputs/NGC 7000 HOO/28 Sep Ha copy check Results/`.
- **Expect (negative):** Results are not written to `Work/Outputs` itself, to `Work/Outputs/28 Sep Ha copy check Results/` without the Project level, or inside the run folder. Patched copy is never accepted with Symlinks.
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
- **Expect:** Retry prepares the journaled entry only after its source matches a fresh snapshot and its copy re-reads to match. The run reads Prepared, with 56 entries matching its membership, every entry a copy, and its footprint reads "56 frames copied · 12.4 GB". The prepared copy carries the patched focal length.
- **Expect (negative):** No entry is a symlink, because `Scratch` holds none. The original is byte-identical and the manifest equals P6. Retry does not infer completion from filenames already present.
- **Trace:** flow F5 · PREP-FR-03, PREP-FR-09 · PREP-AC-06, PREP-AC-14 · D09, D15 · HARNESS-V5-FEEDBACK-R1.md §Round 7 P-PREP3 ("Copies": "N frames copied · X GB")

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
- SC6: When the destination holds no symlinks, Symlinks reads blocked until the user chooses Copies, and 0 files reach `Scratch` before a preparation is confirmed (S13).
- SC7: Launching and quitting Siril leave the run not Complete. A missing executable leaves it Prepared, with Open refused and the launch reading "Not located" (S10, S11).
- SC8: Only the copies carry the patched value (S16).
- SC9: The drifted P7 item reads Prepared 0 times while its source differs from its snapshot (S15a), and the manifest equals P6 after S16.
- SC10: Siril launches 0 times while the P8 entry differs from its snapshot (S10a), and it launches after the S11 re-verification.
- SC11: Revision 2 lands in a new `(rev 2)` folder, with 55 entries. The first folder still holds its 56 entries, both revisions share one Results folder, and the Project-only reject changes library quality 0 times (S17).
- SC12: While Prepare runs, **Complete** and **Move to Trash** are each refused with the running preparation named. After S15, `28 Sep Ha copy check` is still on the Project's run list, outside the Project's Trash, with its folders in place.
- SC13: The footprint reads "Linked · 0 B" for `NGC7000-HOO-Siril`, with every entry a symlink (S9), and "56 frames copied · 12.4 GB" for `28 Sep Ha copy check`, with every entry a copy (S16).
- SC14: Run view reads Symlinks, the Settings default, until the user chooses Copies (S1, S13). On Windows with Developer Mode off, Prepare in Symlinks is refused with its three actions, **Use copies for this run** changes the Settings default 0 times, and **Check again** clears the refusal once Developer Mode is on (S1a).

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Product behavior follows the harness v5 design (`apps/prototype/design/HARNESS-V5-IA.md` S5 and Fix pass, `HARNESS-V5-FEEDBACK-R1.md` Copy rules, §B, §C and Round 5, on `ui-harness-v5` @ b5e813a5, Round 6 @ 4f470775 and Round 7 P-PREP3 @ 12638a7c), the specs, the decisions D02, D04, D09, D13, D15 and D19 set by the authorized autonomous run, and the user's workflow decisions cited above. No implementation has been validated against them.
- G2: Unresolved implementation qualification: Siril's exact handoff and its input-write behavior (P2) need a profile capability probe (D04). S1 depends on it. Blocks readiness.
- G3: (dissolved 2026-10-12): answered by §Round 7 P-PREP3: Run view is one mode per run, Symlinks or Copies, so no preparation mixes entry kinds, and no original is re-hashed after a run.
- G4: Unresolved implementation qualification: the specs do not say which preparation phases offer Cancel or Pause "where safe". The Canceled and Paused outcomes are not exercised. Blocks readiness.
- G5: Unresolved implementation qualification: no fault control yet pauses Prepare between a source snapshot and terminal success (P7), and S15a depends on it. Blocks readiness.
- G6: (dissolved 2026-10-12): answered by §Round 7 P-PREP3 (Symlinks by default from Settings, Copies as the alternative, no hard links or junctions); S1 asserts Symlinks preselected, S1a the Windows Developer Mode refusal, S9 and S16 the footprints ("Linked · 0 B", "56 frames copied · 12.4 GB"), and S10a an original's change caught when Open re-verifies.
- G7: (dissolved 2026-10-12): answered by Round 6 "Results location override stays"; S14 now asserts the default Results folder beside the run folder and the override to `Work/Outputs/NGC 7000 HOO/28 Sep Ha copy check Results/`.
- G8: (dissolved 2026-10-12): answered by Round 6 "Rename runs and Projects"; S12 now asserts the run starting as `NGC 7000 RedCat` and its rename on the run header to `28 Sep Ha copy check`.
- G9: (dissolved 2026-10-12): answered by Round 6 "Reject is library-wide by default"; S17 now makes revision 2 with "Reject for this Project only" on one 28 Sep frame, whose library quality stays Usable, as in J22/S11b.
- G10: Unresolved product question: what a rejection made in one run does to another open run of the same Project whose saved revision holds the frame. Round 6 says an X'd frame "leaves every run", and a Project-only reject takes the frame out of the Project's totals, but saved and prepared revisions never change on a mark (D-W54, VSEL-FR-14). S17 asserts only that `NGC7000-HOO-Siril` keeps saved revision 2 and its prepared entries. Options: (a, recommended) every other open run that holds the frame gets a Review draft without it ("1 rejected, unsaved"), and its saved and prepared revisions change only on Save run and a new Prepare; (b) other runs show nothing until their next Refresh selection, which lists the frame as rejected; (c) only the run where the mark was made changes, and other runs keep the frame until the user removes it there. Blocks readiness.

## Delta log

- **Δ2** 2026-10-06 · S1, S4, S6, S7, S8, S9, S10, S12, S13, S14, S15, +S17 · behavior-change
  Views are processing runs in a Project. A run prepares to `<output>/<Project>/<Run>/`, Results go to the sibling `<Run> Results/`, and each new revision gets a `(rev 2)` folder that shares that one Results folder. The check runs are created in the Project, and their pickers start with every candidate selected. A running preparation refuses Move run to Trash exactly as it refuses Mark processing complete.
  Evidence: specs/069-application-handoff PREP-FR-06, PREP-FR-07, PREP-FR-11, PREP-AC-01, PREP-AC-21. D-W3, D-W49, D-W51, D-W67 at e4476231. D-W67, D-W72. 069 PREP-FR-06, PREP-FR-07, PREP-FR-11 and PREP-AC-21 as amended. 070 RES-FR-07, RES-FR-10, RES-AC-20 · by: JourneysC (intent-gated)
- **Δ3** 2026-10-12 · S1, old 2, old 3, S4, S6, S7, S8, S9, S10, S10a, S11, S12, S13, S14, S15, S15a, S16, S17 · behavior-change
  Prepare shows Application (profile cards with evidence), Input mode (Linked run, Direct source, Copy, Clone, none preselected) and a layout preview, with checks and a confirmation that names what it creates. The outcome shows the footprint (prepared bytes), "Partial 53/56" with Prepared and Blocked lists, and "(rev 2)".
  Open refuses tersely with its blockers ("Siril not located", changed entries), replacing Choose application / Reveal run folder. The header's actions read Complete and Move to Trash. Start run takes the profile as optional.
  Evidence: HARNESS-V5-IA.md §Screens S5 (Prepare: "profile, mode, layout preview, (rev N), Partial lists, Open re-verifies"; Refusals) and §Fix pass ("Gate words"); HARNESS-V5-FEEDBACK-R1.md §Copy rules, §Screens B (Start run sheet) and C ("show the footprint (prepared bytes)"), §Round 5 P-SB3; prototype src/features/v5/c-runs/prepare-step.tsx, actions.ts, run.tsx and messages/en-GB.json (apps/prototype/ on ui-harness-v5 @ b5e813a5); user instruction 2026-10-12 · by: JourneysV5.U3Runs (intent-gated)
- **Δ4** 2026-10-12 · S1, old 2, old 3, S8, S9, S10a, S11, S12, S13, S14, S16, S17 · behavior-change
  Input mode is Automatic by default, with Independent copy, Link to originals (opt-in, with a warning) and Give PixInsight the file list (not for Siril); hard links and Direct source are gone. Entries are cloned or copied, read-only once verified, and the footprint shows the real extra space ("0 B extra · cloned", "12.4 GB copied").
  The check run starts auto-named and is renamed on the run header, keeps the Results location override, and gets revision 2 from a Project-only reject.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Rename runs and Projects", "Results location override stays", "Reject is library-wide by default" (apps/prototype/design/ on ui-harness-v5 @ 4f470775) and §Input modes (user, 2026-10-10) P-PREP2 (@ d609ff55; research INPUT-MODES-RESEARCH.md); user answers to the PR #1788 journey questions · by: JourneysV5.R6B (intent-gated)
- **Δ5** 2026-10-12 · S1, +S1a, retired old 2 and 3, S8, S9, S10a, S11, S13, S14, S16 · behavior-change
  Run view replaces Input mode: Symlinks by default from Settings ("Linked · 0 B"), or Copies, which are temporary and removed when the run completes ("56 frames copied · 12.4 GB"). On Windows, Prepare in Symlinks needs Developer Mode and is refused without it, offering Open Windows settings, Check again and Use copies for this run. Old steps 2 (the file-list mode) and 3 (the linked-originals warning) are retired, and no original is re-hashed after a run.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 7 (user, 2026-10-12) P-PREP3 (apps/prototype/design/ on ui-harness-v5 @ 12638a7c; research RUN-VIEWS-OPTIONS.md) · by: JourneysV5.R7Prep3 (intent-gated)
