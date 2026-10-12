---
id: J28
title: Archive a finished Project's sessions from Wrap up, and a session in no Project from Sessions, with verified transfer and run reference repair
version: 4
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [archive, wrap-up, projects, sessions, view-review, preparation, locations, activity, status-bar, issues]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 071-storage-custody, D02, D06, D09, D11, D19, D-W3, D-W20, D-W26, D-W46, D-W72, P-WRAP1, P-ARC1, P-STO2, P-SB3, P-PREP2, specs/063-clean-rebuild-contract/decisions.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/071-storage-custody/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-j-verified-archive-transfer, HARNESS-V5-IA.md#S9, HARNESS-V5-IA.md#S12, HARNESS-V5-IA.md#S16, HARNESS-V5-IA.md#S17, HARNESS-V5-FEEDBACK-R1.md#copy-rules, HARNESS-V5-FEEDBACK-R1.md#domain-and-seed, HARNESS-V5-FEEDBACK-R1.md#b-projects, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#round-6, HARNESS-V5-FEEDBACK-R1.md#input-modes-user-2026-10-10-research-designinput-modes-researchmd]
---

## Goal

Once every run of Project `NGC 7000 HOO` is Complete, the user archives its
member sessions from the Archive step of the Project's Wrap up stage, to an
archive location chosen there, in one reviewed transfer. The transfer also
repoints the symlinks of the Project's Link to originals run, and the user can
trust that no source is retired before its destination copy and every affected
reference are verified. Later the user archives a session that is in no
Project from Sessions, through the same reviewed transfer. Done means: 18, 24,
26 and 30 Sep live on the chosen archive location `Archive/NGC7000` with
verified hashes, and 28 Sep stays on `Astro-T7` because another open Project's
run uses it. Changing the Default archive location moved no file, and the
Project's own choice won over it. Every source retired was retired only after
destination and reference verification, while it still matched its copied
snapshot. An interrupted, failing or drifted item keeps its source and its
recorded phase, readable in the transfer's Activity entry. The membership of
`NGC7000-HOO-Siril` is unchanged, it still leaves out the six rejected 30 Sep
frames, its cloned entries are untouched, and its archived inputs read Offline
when `Archive` is unplugged. `4 Oct M 33`, in no Project, lives on the Default
`Archive/Long-term` after its own reviewed transfer. When the archive location
is later retired in Settings › Locations, its copies read Retired, leave
totals, change no file and stay named in the runs.

## Preconditions

- P1: Fresh replay of J34 through S5: the `NGC 7000 HOO` Wrap up stage is current, with Clean up runs Skipped (J34/S3b) and Trash and Archive To do. The Archive review was read and cancelled, no frame has been trashed, and the Project is open. Every remaining run of the Project is Complete; J27/S14b and J34/S3a emptied the others from the Project Trash, which is now empty. J25 and run Clean up (J27/S4 to J27/S11a) were not run, so `NGC7000-HOO-Siril` reads Complete and keeps its 208 cloned frame entries and its masters' entries under `Work/Processing/NGC 7000 HOO/NGC7000-HOO-Siril/` on `Astro-T7`, and the Link to originals run `26 Sep symlink check` (J34/P1) reads Complete with its 35 symlinks to the 26 Sep captures. The open Project `NGC 7000 Ha deep` has the runs `Ha deep v1` (Complete) and `Ha deep` (Prepared), each with 28 Sep as a member. 30 Sep is only a candidate of the open Project `NGC 7000 SHO`. Siril is not running.
- P2: The J34/P9 volume `Archive`, with free space for the four archived sessions and `4 Oct M 33`, holds the archive locations `Archive/NGC7000`, marked Default in Settings › Locations, and `Archive/Long-term`. A second disposable volume can be mounted under the same name `Archive`.
- P3: The J19/P5 manifest and a SHA-256 list of the five member sessions' files are recorded. `Cold-1` stays offline.
- P4: A fault control makes the repoint of one named symlink of `26 Sep symlink check` fail until it is released: the symlink of the 26 Sep frame F-ref, which is not the P5 frame (fault fixture for S8; G3).
- P5: For one named 26 Sep frame, a backup of its original bytes and nanosecond mtime and a replacement file of identical size with different bytes, kept outside PlateVault. A fault control pauses that item after destination verification and before source retirement (G5).
- P6: Before S1, the `4 Oct M 33` session of J32/P3 is added under `Astro-T7/Captures/M33/2026-10-04/` and indexed: 16 Ha 300 s `RedCat` lights with Target M 33 and rig `RedCat` Confirmed. M 33 is a subject of no Project, so the session is a candidate of no Project and a member of no run. A SHA-256 list of its files is recorded.

## Steps

### S1 — Start the archive from the Wrap up Archive step {#S1}

- **Do:** In the `NGC 7000 HOO` Wrap up stage, read the Archive step's Destination, keep `Archive/NGC7000`, and choose **Archive…**.
- **Expect:**
  - Destination lists `Archive/NGC7000`, preselected and marked Default, and `Archive/Long-term`.
  - The review lists 18, 24, 26 and 30 Sep with their 158 files and lists 28 Sep as kept because `NGC 7000 Ha deep` uses it. 30 Sep is proposed although it is a candidate of `NGC 7000 SHO`. Each destination path sits under `Archive/NGC7000`, laid out by the saved naming templates with original basenames. The review also shows bytes, source identities, the affected runs `NGC7000-HOO-Siril` and `26 Sep symlink check`, and proposed reference updates.
- **Expect (negative):** Session membership and the runs' rejections read fixed by the review. 28 Sep has no destination path, and the membership and totals of `Ha deep v1` and `Ha deep` are unchanged.
- **Trace:** flow J · HARNESS-V5-IA.md S9 · P-WRAP1, P-ARC1 · STO-FR-06, STO-FR-13 · STO-AC-17 · root FR-011 · D-W20, D-W26, D-W46

### S1a — Change the Default, then pick this Project's destination {#S1a}

- **Do:** Close the review without approving. In Settings › Locations, read the archive locations and choose **Make default** on `Archive/Long-term`. Return to the Archive step and read its Destination. Then choose `Archive/NGC7000` there, read Settings › Locations again, and choose **Archive…** to reopen the review.
- **Expect:**
  - Settings › Locations lists both archive locations, each with its disk use, and exactly one carries the Default pill: first `Archive/NGC7000`, then `Archive/Long-term`.
  - Because the Project had not picked a destination of its own, the Archive step's Destination then preselects `Archive/Long-term`, marked Default.
  - After choosing `Archive/NGC7000` in the Archive step, Settings › Locations still marks `Archive/Long-term` Default. The reopened review lists the same sessions, files and destination paths under `Archive/NGC7000` as at S1.
- **Expect (negative):** Make default and the Destination choice move no file and start no transfer. No destination path sits under `Archive/Long-term`, and choosing the Project's destination does not change the Default.
- **Trace:** HARNESS-V5-IA.md S9, S16 · HARNESS-V5-FEEDBACK-R1.md Domain and seed (P-ARC1), Round 5 (P-STO2) · STO-FR-06

### S2 — Meet an impostor destination {#S2}

- **Do:** Unmount `Archive` and mount the second P2 volume under the same name, then return to the review.
- **Expect:** The review states that the volume at that path is a different volume than the intended destination, and approval is blocked with a terse `Archive blocked` refusal that names it.
- **Trace:** flow J · STO-FR-06 · STO-AC-10 · D06, D11

### S3 — Check the real destination {#S3}

- **Do:** Unmount the impostor, remount the original `Archive`, and return to the review.
- **Expect:** The review shows the intended volume identity matching, its free space, and that it is writable, and approval is no longer blocked.
- **Trace:** flow J · STO-FR-06

### S4 — Read the reference updates {#S4}

- **Do:** In the review, open the reference entries of `26 Sep symlink check` and `NGC7000-HOO-Siril`.
- **Expect:** `26 Sep symlink check` lists its 35 symlinks, each with its current target under `Astro-T7/Captures/` and its new target under `Archive/NGC7000`, to be repointed when 26 Sep moves. `NGC7000-HOO-Siril` is listed as affected, because 152 of its members move, and proposes no update to its prepared entries, because each one is a clone.
- **Expect (negative):** The review offers no reference-mode choice, and no entry changes kind: no clone is replaced by a link, and no symlink by a copy. No hard link is proposed.
- **Trace:** flow J · STO-FR-06 · STO-AC-10 · HARNESS-V5-FEEDBACK-R1.md §Input modes (P-PREP2; "Archiving with links": a symlinked entry is repointed when its session moves; hard links removed as a mode) · G7

### S5 — Review and approve the transfer {#S5}

- **Do:** In the review, inspect source and destination paths and the reference updates, and approve **Archive**.
- **Expect:**
  - The transfer runs as one archive operation. The status bar's running work names it with a mini progress bar, the Archive step shows its progress, and Activity lists it.
  - Each item passes the phases copied, durably written, destination hash verified against the source snapshot, references updated, and source retired. Expected and observed reclaimed bytes are reported separately.
- **Expect (negative):** No 28 Sep file is copied or retired. Approving Archive does not mark the Project Done, and the Project still reads open.
- **Trace:** flow J · HARNESS-V5-IA.md S9, S17 · HARNESS-V5-FEEDBACK-R1.md Round 5 (P-SB3, P-STO2) · STO-FR-07 · D06, D19

### S6 — Interrupt the transfer {#S6}

- **Do:** Unplug `Archive` while items are still being copied. Then read the status bar, open its issue counters' popouts, open the transfer's Activity entry, and open Settings › Locations.
- **Expect:**
  - The transfer stops, and its Activity entry shows, per item, destination-verified, source-retained, reference-updated and pending work, with **Retry**.
  - The status bar's running work no longer names the transfer. The counters' popouts list the stopped transfer and the two `Archive` locations as offline, each with its action.
  - Settings › Locations reads `Archive/NGC7000` and `Archive/Long-term` Offline, apart from the transfer's per-item phases.
- **Expect (negative):** No item whose destination or references are unverified has its source retired; those sources still match P3.
- **Trace:** flow J recovery branch, cross-flow "Archive interruption" · HARNESS-V5-IA.md S16, S17 · HARNESS-V5-FEEDBACK-R1.md Round 5 (P-SB3, P-STO2) · STO-FR-08, STO-FR-11 · STO-AC-05 · D06

### S7 — Retry after reconnecting {#S7}

- **Do:** Reconnect `Archive` and choose **Retry** on the transfer's Activity entry.
- **Expect:** Retry revalidates the destination volume identity and the recorded item identities, then resumes the recorded work. Items already verified keep their recorded phases.
- **Expect (negative):** A partially written destination file is not treated as verified because its name exists.
- **Trace:** flow J recovery branch · STO-FR-08 · STO-AC-05 · D06, D09

### S7a — Change a source before retirement {#S7a}

- **Do:** When the P5 pause reports the named 26 Sep frame destination-verified and awaiting retirement, overwrite its source with the P5 replacement, restore its recorded mtime, and release the pause.
- **Expect:** That item reads blocked with source drift named. Its source path keeps the replacement bytes, `Archive/NGC7000` keeps the verified snapshot, and both are listed for review. Other items keep their recorded phases.
- **Expect (negative):** Neither version is retired, overwritten or chosen automatically.
- **Trace:** flow J recovery branch · STO-FR-07 · STO-AC-14 · D06, D19

### S8 — Inspect a failed reference rebuild {#S8}

- **Do:** When the transfer settles, open its per-item outcomes in its Activity entry, and the P4 frame F-ref.
- **Expect:** Each affected reference reports completed, blocked, or uncertain. F-ref's symlink repoint reads blocked, its symlink still points at its source path, and its source is retained. The S7a item still reads blocked by drift. Every other archived item reads source retired only after its destination and references verified, and each of the 33 other 26 Sep symlinks points at its `Archive/NGC7000` path. `NGC7000-HOO-Siril` reads 208 lights / 17h 20m, still leaves out the six rejected 30 Sep frames and still reads Complete. Its cloned entries match their J34/P10 listing, and its 28 Sep members still resolve on `Astro-T7`.
- **Expect (negative):** The blocked item's source is not retired. The identity-preserving reference repair reopens neither run and creates no membership or preparation revision, and no prepared entry changes kind.
- **Trace:** flow J open sequencing detail · STO-FR-07 · STO-AC-10 · root FR-011, SC-007 · D06, D09 · HARNESS-V5-FEEDBACK-R1.md §Input modes (Q-ARCHIVE-LINKS)

### S9 — Repair the blocked reference {#S9}

- **Do:** Release the P4 fault and choose **Retry** for F-ref in the transfer's Activity entry.
- **Expect:** Its symlink repoints to its `Archive/NGC7000` path and verifies; only then is its source retired.
- **Trace:** flow J · STO-FR-07 · D06

### S9a — Resolve the drifted item {#S9a}

- **Do:** Restore the P5 frame's original bytes and recorded mtime, review the item's current evidence, and choose **Retry** for it in the transfer's Activity entry.
- **Expect:** The current source matches its snapshot again, the destination and its references re-verify, and only then is the source retired. With every item settled, 18, 24, 26 and 30 Sep read Archived, all 35 symlinks of `26 Sep symlink check` point at `Archive/NGC7000`, and the Project still reads open.
- **Expect (negative):** The archived copy still matches P3, and no other item changes phase.
- **Trace:** flow J · HARNESS-V5-IA.md S9 · STO-FR-07 · STO-AC-14 · D06, D19

### S9b — Open the archive review from Sessions {#S9b}

- **Do:** In Sessions, choose the **Not in any Project** filter, select `4 Oct M 33` and choose **Archive…**. Read the Destination and the review, then close the review without approving. List `Astro-T7/Captures/M33/2026-10-04/` and `Archive`.
- **Expect:**
  - **Not in any Project** lists `4 Oct M 33`.
  - The Destination lists `Archive/Long-term`, preselected and marked Default since S1a, and `Archive/NGC7000`.
  - The review is the same reviewed transfer as the Wrap up Archive step's. It lists `4 Oct M 33` with its 16 files, each destination path under `Archive/Long-term`, laid out by the saved naming templates with original basenames, with bytes and source identities. It shows the destination volume identity, its free space and that it is writable.
  - It names no affected run and proposes no reference update, because the session is in no Project.
- **Expect (negative):** Nothing transfers: the M 33 files are still at their source paths and match P6, and `Archive` gains no file. The review proposes no other session and no path under `Archive/NGC7000`. Settings › Locations still marks `Archive/Long-term` Default.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 6 ("Archive… from Sessions": sessions in no Project, same reviewed transfer as Wrap up) · HARNESS-V5-IA.md S12, S16 · P-ARC1 · STO-FR-06 · LIB-FR-17 · G9

### S9c — Archive the session in no Project {#S9c}

- **Do:** In Sessions, choose **Archive…** on `4 Oct M 33` again, keep `Archive/Long-term`, and approve **Archive**. Read the status bar while it runs, the transfer's Activity entry, and the session's row.
- **Expect:** The transfer runs as one archive operation: the status bar's running work names it with a mini progress bar, and Activity lists it. Each of the 16 items passes copied, durably written, destination hash verified against the source snapshot, and source retired. `4 Oct M 33` then reads Archived at its `Archive/Long-term` path.
- **Expect (negative):** No source is retired before its destination verifies, and every archived file matches P6. No file goes to `Archive/NGC7000`. No Project, run, goal or Wrap up step changes.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 6 ("Archive… from Sessions") · HARNESS-V5-IA.md S17 · STO-FR-06, STO-FR-07 · D06, D19

### S10 — Unplug the archive later {#S10}

- **Do:** Unplug `Archive`. Open NGC 7000, then `NGC7000-HOO-Siril`, and read its members. Then open `26 Sep symlink check` and click **Open in Siril**.
- **Expect:** Captured and usable totals and the membership of `NGC7000-HOO-Siril` are unchanged, and its 152 archived members read Offline. Opening `26 Sep symlink check` is refused because its 35 inputs are unavailable, with the options to reconnect the archive or review another verified location.
- **Expect (negative):** Unavailable inputs are not omitted from the handoff.
- **Trace:** flow J · STO-FR-08, VSEL-FR-09 · STO-AC-07 · D-W3 · G10

### S11 — Review retiring the lost archive {#S11}

- **Do:** With `Archive` still unplugged, open Settings › Locations, choose the Offline location `Archive/NGC7000`, and choose **Retire location**.
- **Expect:** The review names the location, its root and Offline state, and the four sessions with their 158 copies. It also names the runs `NGC7000-HOO-Siril` and `26 Sep symlink check`, which reference those copies, Project `NGC 7000 HOO` and any Result that references them. It states that retiring deletes, moves or modifies no file.
- **Expect (negative):** Nothing is retired before confirmation.
- **Trace:** flow A4, cross-flow "Location offline" · HARNESS-V5-IA.md S16 · HARNESS-V5-FEEDBACK-R1.md Round 5 (P-STO2) · LIB-FR-15 · LIB-AC-16 · D11

### S11a — Confirm after the archive returns {#S11a}

- **Do:** Leave the S11 review open, plug `Archive` back in until its location reads Online, then confirm **Retire location**.
- **Expect:** Retirement is refused because the location's availability changed since the review, and a new review is required. Unplug `Archive` again and click **Retire location** to open a fresh review that reads Offline.
- **Expect (negative):** Nothing is retired and no copy reads Retired or Missing. PlateVault reads no archived file bytes for the refusal and changes no file.
- **Trace:** flow A4 · LIB-FR-15 · LIB-AC-16 · D11, D19

### S12 — Retire the location {#S12}

- **Do:** Confirm the fresh **Retire location** review. Read Settings › Locations and the Wrap up Archive step's Destination. Open Sessions, NGC 7000 and `NGC7000-HOO-Siril`. Then open `26 Sep symlink check` and click **Open in Siril**.
- **Expect:**
  - The location reads Retired, and its 158 copies read Retired. The Archive step's Destination no longer lists `Archive/NGC7000`, and `Archive/Long-term` keeps its Default pill. Sessions still lists `4 Oct M 33` as Archived at its `Archive/Long-term` path.
  - NGC 7000 captured integration falls by exactly 13h 10m, and its usable integration counts no retired copy.
  - `NGC7000-HOO-Siril` still lists its 208 members, still leaves out the six rejected 30 Sep frames and reads Complete. Each of its 152 archived members is named unresolved and Retired, and its 56 28 Sep members still resolve. Opening `26 Sep symlink check` is refused and names its 35 retired inputs.
- **Expect (negative):** No copy reads Missing. Each run's membership, rejections and prepared revision are unchanged, and no retired copy is offered as an input.
- **Trace:** flow A4 · HARNESS-V5-IA.md S9, S16 · P-ARC1 · LIB-FR-15, VSEL-FR-09 · LIB-AC-16 · D02, D11 · G10

### S13 — Register the archive folder again {#S13}

- **Do:** Plug `Archive` back in. In Settings › Locations, try to reselect the retired location. Then add `Archive/NGC7000` as a Captures location with **Add capture location** and index it.
- **Expect:** Reselect is not offered for the retired location. The new location registers without an overlap conflict, and the 158 archived lights appear as its Unreviewed assets in new sessions beside the retired copies. 18, 26 and 30 Sep read Target NGC 7000 Associated from their pointing within its footprint, as in J19/S9, and each shows its OBJECT only as a label. 24 Sep, which has no pointing, reads an unresolved Target and is the only new session under **Needs a Target**. NGC 7000 captured integration rises by exactly 11h 30m.
- **Expect (negative):** No retired copy is counted again. No session lists OBJECT as Target evidence, and 26 Sep's `Cygnus field` label is no conflict. No retired quality decision, Target or equipment confirmation, or correction transfers, so the new sessions add nothing to usable integration, and 24 Sep counts toward no NGC 7000 total until its Target is confirmed again. The new sessions are candidates of no Project until their rig is confirmed again. `NGC7000-HOO-Siril` still names its 152 archived members unresolved and Retired. The archived files match P3.
- **Trace:** flow A4 · HARNESS-V5-IA.md S16 · HARNESS-V5-FEEDBACK-R1.md Round 5 (Sessions: OBJECT is a label, P-STO2) · HIGH-LEVEL-DESIGN.md §10 glossary (OBJECT) · LIB-FR-02, LIB-FR-05, LIB-FR-15, PRJ-FR-09 · LIB-AC-16, STO-IMP-AC-05 · D01, D11

## Success criteria

- SC1: 0 sources are retired before their destination hash and all affected references verify (S6, S8, S9).
- SC2: After S6, 100% of unretired sources match P3.
- SC3: `NGC7000-HOO-Siril` reads 208 / 17h 20m, leaves out the 6 rejected 30 Sep frames and stays Complete before and after the transfer (S1, S8, S10).
- SC4: 0 prepared entries change kind and 0 reference-mode choices are offered. After S9a, 35 of 35 symlinks of `26 Sep symlink check` point at `Archive/NGC7000`, and F-ref's source is retired only after its repoint verifies (S4, S8, S9, S9a).
- SC5: The impostor volume blocks approval (S2).
- SC6: With `Archive` unplugged, Open of `26 Sep symlink check` is refused and 0 inputs are omitted (S10).
- SC7: The drifted source is retired 0 times while it differs from its snapshot (S7a, S8); it retires only after re-verification (S9a).
- SC8: Retiring changes 0 files and 0 copies read Missing (S12). After S13 captured integration rises by exactly 11h 30m, the 18, 26 and 30 Sep lights, so no capture is counted twice and no retired association transfers.
- SC9: Confirming a review whose availability has since changed retires 0 locations (S11a).
- SC10: 0 of the 56 28 Sep files are copied, moved or retired from S1 through S9a, and the membership and totals of `Ha deep v1` and `Ha deep` are unchanged.
- SC11: Make default moves 0 files, and the archive goes to the Project's chosen `Archive/NGC7000`, with 0 destination paths under the Default `Archive/Long-term` (S1a, S5). After S12, the Destination lists 0 retired locations.
- SC12: Archiving `4 Oct M 33` from Sessions moves exactly 16 files, all to the Default `Archive/Long-term`, retires 0 sources before their destination verifies and changes 0 Projects or runs. Closing its review first moves 0 files (S9b, S9c).

## Known gaps

- G1: Not validated. The rebuilt application does not exist. Product behavior follows the harness v5 design (HARNESS-V5-IA.md S9, S12, S16 and S17; HARNESS-V5-FEEDBACK-R1.md P-WRAP1, P-ARC1 and Round 5 P-STO2, P-SB3 and Sessions, on ui-harness-v5 @ b5e813a5; Round 6 @ 4f470775; Input modes P-PREP2 @ d609ff55), the specs and the defaults that the authorized autonomous run set in decisions D06, D09, D11 and D19, and the workflow decisions D-W3, D-W20, D-W26 and D-W46. No implementation has been validated against them.
- G2: Unresolved implementation qualification: no fault fixture yet produces a destination hash mismatch, so the hash-failure branch is not exercised. Blocks readiness.
- G3: Unresolved implementation qualification: no fault control yet makes one symlink's repoint fail (P4), and the flow does not name the method of source retirement after verification. Blocks readiness.
- G4: Out of scope for this journey: the file list of a **Give PixInsight the file list** run (P-PREP2, which replaces Direct source), whose paths a move affects, is not exercised because no journey prepares such a run. Blocks readiness until covered by a step or a journey.
- G5: Unresolved implementation qualification: no fault control yet pauses an item after destination verification and before retirement (P5). S7a depends on it, and no source-retirement acceptance is complete until S7a passes. Blocks readiness.
- G6: (dissolved 2026-10-12): answered by Round 6 "Archive… from Sessions"; S9b and S9c now assert that a session in no Project is archived from Sessions through the same reviewed transfer as Wrap up, to the Default `Archive/Long-term`, with nothing moved before approval. Archiving part of a Project from Sessions stays open as G9.
- G7: (dissolved 2026-10-12): answered by §Input modes P-PREP2 "Archiving with links" (Q-ARCHIVE-LINKS); hard links are no longer a mode, so S4, S8, S9 and SC4 now assert that the symlinks of `26 Sep symlink check` are repointed, that the clones of `NGC7000-HOO-Siril` need no update, and that no reference-mode choice is offered.
- G8: Out of scope for this journey: Restore of the Archived sessions after the Project is Reopened is J34's (S12a). Library-wide duplicate copies are J39's.
- G9: Unresolved product question: Round 6 lets Sessions archive sessions that are in no Project, but says nothing about a selection that also holds a session of a Project, a candidate or a member of a run, or about archiving part of an open Project before its Wrap up (STO-FR-06 still offers Archive for selected sessions). S9b selects only a session in no Project. Blocks readiness until a human decides.
- G10: Unresolved product question: under P-PREP2 the entries of `NGC7000-HOO-Siril` are independent, read-only clones, so with `Archive` unplugged (S10) or retired (S12) its run folder still holds every verified input. STO-FR-08 and VSEL-FR-09 refuse opening while inputs are Offline or Retired, a guard written for links. Whether **Open in Siril** on that run is refused, or opens from its verified entries while naming its originals Offline or Retired, is not decided, so S10 and S12 check the refusal only on the symlink run `26 Sep symlink check`. Blocks readiness until a human decides.

## Delta log

- **Δ2** 2026-10-06 · S1, S5, S6, S8, S10, S11, S12, S13, P1, P2, +SC10 · behavior-change
  Archive now starts from the Done / Archive sheet of a Done Project and keeps 28 Sep, which the open Project `NGC 7000 Ha deep` uses. A candidate-only use does not keep 30 Sep. Destinations follow the naming templates. Views are processing runs named per D-W51. Storage shows transfer phases during the interruption. P1 follows J34's run states, where the runs that are no longer wanted were moved to the Project's Trash and emptied from it.
  Evidence: D-W3, D-W20, D-W26, D-W46 (workflow decisions, settled 2026-10-06); 071 STO-FR-06, STO-FR-11, STO-FR-13, STO-AC-17; 063 FR-011 at e4476231, plus D-W72, 065 PRJ-AC-16 and 071 STO-FR-13, STO-AC-18 · by: agent (intent-gated, user instruction)
- **Δ3** 2026-10-12 · S1, +S1a, S2, S3, S4, S5, S6, S7, S8, S9, S9a, S11, S12, S13 · behavior-change
  Archive starts from the Archive step of the Project's Wrap up, before Mark Done, so the Project stays open. The destination is an archive location: the Default unless the Project picks another, and picking one for the Project leaves the Default set in Settings › Locations unchanged (new S1a).
  With no Storage tab, transfer phases and Retry are read in the transfer's Activity entry and the status bar, and locations are retired and re-registered in Settings › Locations. OBJECT is only a label, so re-indexed 26 Sep reads NGC 7000 from its pointing (captured rises 11h 30m, not 8h 35m).
  Evidence: HARNESS-V5-IA.md §Screens S9, S16, S17; HARNESS-V5-FEEDBACK-R1.md §Copy rules, §Domain and seed (P-WRAP1, P-ARC1), §Screens B, §Round 5 (P-SB3, Sessions, P-STO2) (apps/prototype/design/ on ui-harness-v5 @ b5e813a5); HIGH-LEVEL-DESIGN.md §10 glossary (OBJECT); user instruction 2026-10-12 · by: JourneysV5.U5WrapUp (intent-gated)
- **Δ4** 2026-10-12 · S1, S4, S5, S8, S9, S9a, +S9b, +S9c, S10, S11, S12 · behavior-change
  Round 6: a session in no Project is archived from Sessions (select, then Archive…) through the same reviewed transfer as Wrap up (new S9b, S9c; G6 dissolved). The six 30 Sep frames are rejected, not excluded.
  P-PREP2: hard links are gone, so the reference-mode choice is retired. `NGC7000-HOO-Siril` holds clones that need no update, and the Link to originals run `26 Sep symlink check` has its symlinks repointed, with one failed repoint retried (G7 dissolved). Its Open is the one refused while inputs are Offline or Retired (G10).
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Archive… from Sessions", "Reject is library-wide by default" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); §Input modes (user, 2026-10-10) P-PREP2, "Archiving with links" (@ d609ff55); user answers to the PR #1788 journey questions · by: JourneysV5.R6E (intent-gated)
