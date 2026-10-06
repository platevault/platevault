---
id: J24
title: Prepare a verified run folder beside its Results folder and open the application
version: 2
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [preparation, run-workspace, projects]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 069-application-handoff, 070-results-reuse, D02, D04, D09, D13, D15, D19, D-W3, D-W5, D-W49, D-W51, D-W67, specs/063-clean-rebuild-contract/decisions.md, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/069-application-handoff/spec.md, specs/070-results-reuse/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-f-prepare-and-open-the-view]
---

## Goal

The user turns the reviewed run into one verified input layout and opens the
application, without omitting any selected input, reusing any existing folder,
or changing any original. The run prepares into
`<output>/<Project>/<Run>/`, and its Results go to the sibling
`<Run> Results/` folder.

Done means:
- `Work/Processing/NGC 7000 HOO/NGC7000-HOO-Siril/` reads Prepared only after its 208 entries match the confirmed membership.
- Results are recorded at `Work/Processing/NGC 7000 HOO/NGC7000-HOO-Siril Results/`.
- Siril opens on that preparation, and quitting Siril leaves the run not Complete.
- A partial preparation names its blocked inputs and offers no verified Open. Retry completes only the recorded items.
- A new preparation revision goes to a new `(rev 2)` folder and leaves the first folder unchanged.

## Preconditions

- P1: J23 completed.
- P2: The Siril profile's capability evidence (J23/S8) records exact file-list input and that Siril does not write into its input files. If that evidence is unknown or write-prone, Linked View and Direct source are blocked (D04), and S1 to S3 change accordingly (G2).
- P3: Folders `Processing/` and `Outputs/` exist on the `Astro-T7` volume (shown below as `Work/Processing` and `Work/Outputs`). Both are writable, with free space for two full copies of the 28 Sep session.
- P4: A network share `Scratch` is mounted with `Processing/` writable. The share supports neither links nor OS Trash (macOS deletes immediately there). `Scratch/Processing/NGC 7000 HOO/NGC7000-HOO-Siril/keep.txt` exists with unrelated content and a recorded SHA-256.
- P5: No run has been prepared in this catalog, so no last-used parent exists.
- P6: The J19/P5 manifest is available.
- P7: One of the three 28 Sep frames made unreadable in S15 is named. A backup of its original bytes and nanosecond mtime is kept outside PlateVault, together with a replacement file of identical size and different pixel bytes. A fault control pauses Prepare after that item's source snapshot is recorded and before terminal success (G5).
- P8: For one named 26 Sep frame, a backup of its original bytes and nanosecond mtime is kept outside PlateVault, together with a same-size variant whose pixel bytes differ. Overwriting the frame in place keeps its inode, so its hardlink entry exposes the variant.

## Steps

### S1 — Read the input modes {#S1}

- **Do:** In `NGC7000-HOO-Siril`, open the Prepare step's input-mode choice.
- **Expect:** **Linked View** is suggested; **Direct source**, **Copy** and supported **Clone** are alternatives. Each names its semantics and required storage, and the suggested link type and its limits are shown.
- **Trace:** flow F1 · PREP-FR-04 · D04

### S2 — Try Direct source {#S2}

- **Do:** Select **Direct source** and read its handoff.
- **Expect:** The profile hands Siril the exact original paths of the 208 included frames through a file list or configuration, with no links or copies. If the profile can only hand off whole folders, the handoff is refused, because the 30 Sep folder also holds six excluded frames, and supported alternatives are shown.
- **Expect (negative):** No overinclusive folder handoff is accepted.
- **Trace:** flow F1 direct-source branch, cross-flow "Direct-source exclusion unsupported by tool" · PREP-FR-05 · PREP-AC-04 · root FR-005 · D04

### S3 — Return to Linked View and choose hardlinks {#S3}

- **Do:** Select **Linked View**, change the link type from symlink to hardlink, and confirm.
- **Expect:** The confirmation names the hardlink limits: same-volume eligibility, permission and filesystem checks, and the risk that an application writing into a linked input would alter the source.
- **Expect (negative):** The link type does not change without that explicit confirmation.
- **Trace:** flow F1 · PREP-FR-04 · PREP-AC-08

### S4 — Choose a parent where the run folder exists {#S4}

- **Do:** Click **Choose location...** and choose `Scratch/Processing` as the parent.
- **Expect:** No parent was preselected. The review proposes `Scratch/Processing/NGC 7000 HOO/NGC7000-HOO-Siril/`, states that the folder already exists with unrelated content, and asks for another name or location.
- **Expect (negative):** `keep.txt` and the existing folder are unchanged (SHA-256 matches P4). The existing folder is not reused or cleared.
- **Trace:** flow F2, cross-flow "Destination collision" · PREP-FR-06 · PREP-AC-02 · root FR-004 · D-W51

### S5 — Lose the chosen parent {#S5}

- **Do:** Unmount `Scratch`, then continue.
- **Expect:** The review states that the chosen parent is unavailable and prompts for another choice.
- **Expect (negative):** No other drive is selected silently.
- **Trace:** flow F2 failure branch · PREP-FR-06 · PREP-AC-09

### S6 — Choose the run location {#S6}

- **Do:** Click **Choose location...** and choose `Work/Processing` as the parent.
- **Expect:** The review shows the run folder `Work/Processing/NGC 7000 HOO/NGC7000-HOO-Siril/`, named from the Project and the run.
- **Trace:** flow F2 · PREP-FR-06 · PREP-AC-01 · D-W51

### S7 — Read the Results folder {#S7}

- **Do:** Read the Results location.
- **Expect:** It reads `Work/Processing/NGC 7000 HOO/NGC7000-HOO-Siril Results/`, a sibling of the run folder, and it is recorded on the run for Result discovery.
- **Expect (negative):** The Results folder is not inside the run folder, so Siril cannot read its own output as input.
- **Trace:** flow F3 · PREP-FR-07 · PREP-AC-01 · D-W51

### S8 — Review preparation and confirm membership {#S8}

- **Do:** Click **Review preparation**, read it, and confirm the exact membership and the saved selection criteria.
- **Expect:**
  - The review shows Project `NGC 7000 HOO` and subject NGC 7000, the selection (208 lights, five sessions), profile Siril and the source references.
  - It shows the calibration assignments (automatic and accepted), the 24 Sep exception with its reason, and excluded count 6.
  - It shows the run and Results paths, mode Linked View (hardlink), operation count, expected footprint and available space.
  - Saved selection criteria are shown apart from browsing filters.
  - Source presence, destination collisions, permissions and hardlink eligibility read checked.
- **Expect (negative):** Nothing is created under `Work/Processing` before S9. Unknown or omitted inputs are not counted as prepared. No calibration input that reads Suggested or Needs review is handed off.
- **Trace:** flow F4 · PREP-FR-08 · PREP-AC-01, PREP-AC-13 · CAL-FR-08 · D02, D-W5

### S9 — Prepare the run {#S9}

- **Do:** Click **Prepare run**.
- **Expect:** The operation reads Running with progress. It ends Prepared only after the 208 prepared entries match the confirmed membership and their source snapshots. **Open in Siril**, **Reveal run folder** and preparation details appear.
- **Expect (negative):** The start acknowledgment does not read as success. The manifest still equals P6, and no library quality state changes.
- **Trace:** flow F5 · PREP-FR-09, PREP-FR-10 · root SC-003 · VSEL-FR-11

### S10 — Open with a missing executable {#S10}

- **Do:** Move the Siril application out of its located path, then click **Open in Siril**.
- **Expect:** PlateVault offers **Choose application** and **Reveal run folder**.
- **Expect (negative):** The run stays Prepared, with its decisions and entries unchanged.
- **Trace:** flow F6 failure branch · PREP-FR-10 · PREP-AC-10

### S10a — Open after an input changed {#S10a}

- **Do:** Restore Siril to its located path. Overwrite the P8 frame in place with its variant, restore its recorded mtime, and click **Open in Siril**.
- **Expect:** Siril is not launched. The P8 frame's entry is named as changed since its preparation snapshot, and the run reads unverified.
- **Expect (negative):** Open does not launch on the changed bytes, and PlateVault writes nothing to the frame or its entry.
- **Trace:** flow F6 failure branch, cross-flow "External changes" · PREP-FR-10 · PREP-AC-15 · D19

### S11 — Open Siril {#S11}

- **Do:** Restore the P8 frame's original bytes and recorded mtime. Click **Open in Siril**, inspect the prepared inputs in Siril, then quit Siril.
- **Expect:** Open re-verifies every entry against its preparation snapshot, then Siril opens on the prepared run folder. PlateVault records the launch separately from processing completion.
- **Expect (negative):** Quitting Siril does not mark the run Complete.
- **Trace:** flow F6 · PREP-FR-10 · PREP-AC-10, PREP-AC-15 · root edge "External application exit"

### S12 — Start a disposable check run {#S12}

- **Do:** In Project `NGC 7000 HOO`, start a processing run `28 Sep Ha copy check` on subject NGC 7000 and rig RedCat. The picker starts with every candidate selected; leave only 28 Sep selected. Choose Siril, let Calibrate assign automatically, and save the run.
- **Expect:** The summary reads 56 frames / 4h 40m in Project `NGC 7000 HOO`, and the readiness line reads every group matched.
- **Trace:** flow C5, E1 · VSEL-FR-01, VSEL-FR-03 · CAL-FR-02 · D-W49, D-W5

### S13 — Meet a destination that cannot link {#S13}

- **Do:** Remount `Scratch`. Keep Linked View, choose `Scratch/Processing` as the parent, and click **Review preparation**.
- **Expect:** The run folder reads `Scratch/Processing/NGC 7000 HOO/28 Sep Ha copy check/`. The review states that linking is unavailable at that destination and offers Clone, Copy or Direct source, each with its footprint and consequences.
- **Expect (negative):** Nothing is written to `Scratch` until a mode is chosen, and Linked View does not silently become a full copy.
- **Trace:** flow F4, cross-flow "Unsupported input mode" · PREP-FR-04, PREP-FR-06, PREP-FR-08 · PREP-AC-03

### S14 — Choose patched copies and another Results parent {#S14}

- **Do:** Choose **Copy** with isolated patched copies for the 28 Sep correction. Click **Change Results location...** and choose `Work/Outputs`.
- **Expect:** The review shows a full-copy footprint, the patched effective focal length for every copy, and Results location `Work/Outputs/28 Sep Ha copy check Results/`.
- **Expect (negative):** Results are not written to `Work/Outputs` itself or inside the run folder.
- **Trace:** flow E4, F3 · PREP-FR-03, PREP-FR-07 · D15, D-W51 · G6

### S15 — Prepare with blocked inputs {#S15}

- **Do:** Confirm membership in **Review preparation**. Remove read permission from three 28 Sep source frames and click **Prepare run**. While it runs, click **Mark processing complete** in this run, then in `24 Sep flat check` (J23/S7).
- **Expect:**
  - In `28 Sep Ha copy check`, **Mark processing complete** is refused and names this run's running preparation.
  - The unrelated `24 Sep flat check` is not blocked and reads Complete.
  - The outcome reads Partial, with 53 prepared and 3 blocked entries, each blocked entry named with its path.
  - The choices are **Retry** for the journaled blocked entries, **Review preparation again**, and keeping the partial run unchanged.
- **Expect (negative):** No verified Open is offered. The three sources are untouched. `28 Sep Ha copy check` does not read Complete.
- **Trace:** flow F5 failure branch, cross-flow "Partial preparation" · PREP-FR-09 · PREP-AC-05 · RES-FR-07 · RES-AC-07 · root FR-004 · D09

### S15a — Retry into source drift {#S15a}

- **Do:** Restore read permission on the three frames. Arm the P7 pause and choose **Retry**. When the pause reports the P7 frame's source snapshot recorded, overwrite that source with its replacement, restore its recorded mtime, and release the pause.
- **Expect:** The P7 item reads blocked, with source drift named. The other two retried entries read prepared after their copies re-read to match their source snapshots. The outcome reads Partial, with 55 prepared and 1 blocked.
- **Expect (negative):** No verified Open is offered, and the P7 item never reads Prepared. PlateVault writes nothing to the changed source.
- **Trace:** flow F5 failure branch · PREP-FR-09 · PREP-AC-14 · D09

### S16 — Retry and verify custody {#S16}

- **Do:** Restore the P7 frame's original bytes and recorded mtime, and choose **Retry**. Then compare a prepared copy's header with its original and recompute the manifest.
- **Expect:** Retry prepares the journaled entry only after its source matches a fresh snapshot and its copy re-reads to match. The run reads Prepared, with 56 entries matching its membership. The prepared copy carries the patched focal length.
- **Expect (negative):** The original is byte-identical and the manifest equals P6. Retry does not infer completion from filenames already present.
- **Trace:** flow F5 · PREP-FR-03, PREP-FR-09 · PREP-AC-06, PREP-AC-14 · D09, D15

### S17 — Prepare a second revision {#S17}

- **Do:** In `28 Sep Ha copy check`, choose **Exclude from run** on one 28 Sep frame and save the run. Click **Review preparation**, confirm, and click **Prepare run**.
- **Expect:**
  - The review proposes a new run folder, `Scratch/Processing/NGC 7000 HOO/28 Sep Ha copy check (rev 2)/`.
  - The review keeps the Results location `Work/Outputs/28 Sep Ha copy check Results/`, shared by both revisions.
  - Revision 2 ends Prepared with 55 entries. The run lists both preparation revisions.
- **Expect (negative):** The first folder `28 Sep Ha copy check/` keeps its 56 entries unchanged. No existing folder is reused, replaced or cleared. The excluded frame's library quality is unchanged.
- **Trace:** flow F5 · PREP-FR-11 · PREP-AC-12, PREP-AC-21 · VSEL-FR-15 · D09, D-W51, D-W67

## Success criteria

- SC1: Prepared appears only when all 208 entries match the confirmed membership (S9). Every Prepare ends in exactly one of Prepared, Partial, Failed, Canceled or Paused.
- SC2: The run folder is `<parent>/NGC 7000 HOO/<run>/`, and its Results folder is a sibling outside it, in S6 and S7 and again in S13 and S14.
- SC3: `keep.txt` and its folder are unchanged (S4), and no drive is substituted silently (S5).
- SC4: The capture and calibration manifest equals P6 after S9 and after S16. Prepare changes 0 quality states.
- SC5: The partial outcome reports exactly 53 prepared and 3 blocked, with no verified Open (S15). After Retry the run reads 56 Prepared (S16).
- SC6: When linking is unsupported, the review offers alternatives, and 0 files reach `Scratch` before a choice is made (S13).
- SC7: Launching and quitting Siril leave the run not Complete. A missing executable leaves it Prepared (S10, S11).
- SC8: Only the copies carry the patched value (S16).
- SC9: The drifted P7 item reads Prepared 0 times while its source differs from its snapshot (S15a), and the manifest equals P6 after S16.
- SC10: Siril launches 0 times while the P8 entry differs from its snapshot (S10a), and it launches after the S11 re-verification.
- SC11: Revision 2 lands in a new `(rev 2)` folder, with 55 entries. The first folder still holds its 56 entries, and both revisions share one Results folder (S17).

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Product behavior follows the specs, the decisions D02, D04, D09, D13, D15 and D19 set by the authorized autonomous run, and the user's workflow decisions cited above. No implementation has been validated against them.
- G2: Unresolved implementation qualification: Siril's exact handoff, its folder-versus-list input and its input-write behavior (P2) need a profile capability probe (D04). The S2 branch and S3 depend on it. Blocks readiness.
- G3: Out of scope for this journey: per-item input-mode changes within one preparation (D04, PREP-FR-08) are not exercised. Blocks readiness until covered by a step or a journey.
- G4: Unresolved implementation qualification: the specs do not say which preparation phases offer Cancel or Pause "where safe". The Canceled and Paused outcomes are not exercised. Blocks readiness.
- G5: Unresolved implementation qualification: no fault control yet pauses Prepare between a source snapshot and terminal success (P7), and S15a depends on it. Blocks readiness.
- G6: Unresolved product question: PREP-FR-07 says an override parent "gets the run's Results folder under it". It does not say whether the `<Project>/` level is kept there. S14 assumes `Work/Outputs/<Run> Results/`. Blocks readiness.

## Delta log

- **Δ2** 2026-10-06 · S1, S4, S6, S7, S8, S9, S10, S12, S13, S14, S15, +S17 · behavior-change
  Views are processing runs in a Project. A run prepares to `<output>/<Project>/<Run>/`, Results go to the sibling `<Run> Results/`, and each new revision gets a `(rev 2)` folder. The check runs are created in the Project, and their pickers start with every candidate selected.
  Evidence: specs/069-application-handoff PREP-FR-06, PREP-FR-07, PREP-FR-11, PREP-AC-01, PREP-AC-21; D-W3, D-W49, D-W51, D-W67 · by: JourneysC (intent-gated)
