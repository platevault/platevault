---
id: J28
title: Archive Project sessions with verified transfer from Wrap up and Sessions
version: 7
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [archive, wrap-up, projects, sessions, view-review, locations, activity, status-bar, issues]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 066-view-selection, 069-application-handoff, 071-storage-custody, D02, D06, D09, D11, D19, D-W3, D-W20, D-W26, D-W46, D-W77, D-W80, D-W81, P-WRAP1, P-ARC1, P-STO2, P-SB3, specs/063-clean-rebuild-contract/decisions.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/066-view-selection/spec.md, specs/069-application-handoff/spec.md, specs/071-storage-custody/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-j-verified-archive-transfer, HARNESS-V5-IA.md#S9, HARNESS-V5-IA.md#S12, HARNESS-V5-IA.md#S16, HARNESS-V5-IA.md#S17, HARNESS-V5-FEEDBACK-R1.md#copy-rules, HARNESS-V5-FEEDBACK-R1.md#domain-and-seed, HARNESS-V5-FEEDBACK-R1.md#b-projects, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#round-6, HARNESS-V5-FEEDBACK-R1.md#input-modes-user-2026-10-10-research-designinput-modes-researchmd, D-W93, D-W94, D-W97, D-W100, PRJ-FR-14, PRJ-FR-25, PRJ-FR-30, PREP-FR-10, STO-FR-06, STO-FR-07, STO-FR-08, STO-FR-13, STO-AC-07, VSEL-FR-09, D-W111]
---

## Goal

The user archives the sessions of Project `NGC 7000 HOO` from the Archive step of its Wrap up, and separately archives a session in no Project from Sessions. Done means:
- The user chooses `Archive/NGC7000` and reviews every source and destination path.
- After **Close project…**, each session transfers only after its destination hash and affected View references verify. The Project reads Closing until the operation succeeds, then Archived.
- The symlinks of its View follow the transferred sessions.
- 28 Sep stays on `Astro-T7` because another Project that is not Closed holds it. Being another Project's suggestion does not keep 30 Sep.
- An interrupted, failing or drifted item retains its source and recorded phase in Activity.
- `4 Oct M 33`, which belongs to no Project, goes from Sessions to the Default `Archive/Long-term` through a reviewed transfer.
- Retiring an offline archive location changes no files. Its copies read Retired and are not available inputs.
- The Closed Project cannot be reopened or have archived sessions restored. **Duplicate…** is the way to continue it.

## Preconditions

- P1: Fresh replay of J34 through S5. Project `NGC 7000 HOO` is open and its Wrap up has Clean up Skipped (J34/S3b) and Trash current; no frame has been trashed, and Archive is read-only. The Project has no pending changes. Its View is in Symlinks mode and holds the J34/P1 symlinks, among them 35 to the 35 frames of 26 Sep. Open Project `NGC 7000 Ha deep` holds 28 Sep. 30 Sep is only a suggestion of open Project `NGC 7000 SHO`. The View's application is not running.
- P2: The J34/P9 volume `Archive`, with free space for the four archived sessions and `4 Oct M 33`, holds the archive locations `Archive/NGC7000`, marked Default in Settings › Locations, and `Archive/Long-term`. A second disposable volume can be mounted under the same name `Archive`.
- P3: The J19/P5 manifest and a SHA-256 list of the five member sessions' files are recorded. `Cold-1` stays offline.
- P4: A fault control makes the repoint of one named View symlink fail until it is released: the symlink to the 26 Sep frame F-ref, which is not the P5 frame (fault fixture for S8; G3).
- P5: For one named 26 Sep frame, a backup of its original bytes and nanosecond mtime and a replacement file of identical size with different bytes, kept outside PlateVault. A fault control pauses that item after destination verification and before source retirement (G5).
- P6: Before S1, the `4 Oct M 33` session is added under `Astro-T7/Captures/M33/2026-10-04/` and indexed: 16 Ha 300 s `RedCat` lights with Target M 33 and rig `RedCat` Confirmed. M 33 is a subject of no Project, and no Project holds the session. A SHA-256 list of its files is recorded.
- P7: Closed Project `NGC 7000 first light` holds the 24 Sep session. It was closed with no Archive and kept its Symlinks View, which holds 20 symlinks to 24 Sep frames under `Astro-T7/Captures/`. Its sessions, goals, Close snapshot and Wrap up record are recorded outside PlateVault.

## Steps

### S1 — Start the archive from the Wrap up Archive step {#S1}

- **Do:** In `NGC 7000 HOO`'s Wrap up, choose **Proceed** on the Trash step with nothing selected. In the Archive step, read the Destination, keep `Archive/NGC7000`, and expand each session row.
- **Expect:**
  - Trash reads Skipped, and Archive is current.
  - Destination lists `Archive/NGC7000`, preselected and marked Default, and `Archive/Long-term`.
  - The step lists 18, 24, 26 and 30 Sep, selected, with their 158 files. 28 Sep is not selectable, and its status names `NGC 7000 Ha deep`, which holds it. 30 Sep is selected although `NGC 7000 SHO` suggests it. Each to path sits under `Archive/NGC7000`, laid out by the saved naming templates with original basenames. The step also shows bytes, source identities, the affected Project View entries and proposed reference updates.
- **Expect (negative):** Nothing moves, and the Project's sessions stay unchanged. 28 Sep has no to path, and the sessions and totals of `NGC 7000 Ha deep` are unchanged.
- **Trace:** flow J · HARNESS-V5-IA.md S9 · P-WRAP1, P-ARC1 · PRJ-FR-14 · STO-FR-06, STO-FR-13 · STO-AC-17 · root FR-011 · D-W20, D-W26, D-W46, D-W77, D-W80

### S1a — Change the Default, then pick this Project's destination {#S1a}

- **Do:** Without proceeding, open Settings › Locations, read the archive locations and choose **Make default** on `Archive/Long-term`. Return to the Archive step and read its Destination. Then choose `Archive/NGC7000` there, read Settings › Locations again, and return to the Archive step.
- **Expect:**
  - Settings › Locations lists both archive locations, each with its disk use, and exactly one carries the Default pill: first `Archive/NGC7000`, then `Archive/Long-term`.
  - Because the Project had not picked a destination of its own, the Archive step's Destination then preselects `Archive/Long-term`, marked Default.
  - After choosing `Archive/NGC7000` in the Archive step, Settings › Locations still marks `Archive/Long-term` Default. The Archive step lists the same sessions, files and to paths under `Archive/NGC7000` as at S1.
- **Expect (negative):** Make default and the Destination choice move no file and start no transfer. No to path sits under `Archive/Long-term`, and choosing the Project's destination does not change the Default.
- **Trace:** HARNESS-V5-IA.md S9, S16 · HARNESS-V5-FEEDBACK-R1.md Domain and seed (P-ARC1), Round 5 (P-STO2) · STO-FR-06

### S2 — Meet an impostor destination {#S2}

- **Do:** Unmount `Archive` and mount the second P2 volume under the same name, then return to the Archive step.
- **Expect:** The step states that the volume at that path is a different volume than the intended destination. **Close project…** is disabled with a terse `Archive blocked` refusal that names it.
- **Trace:** flow J · STO-FR-06 · STO-AC-10 · D06, D11, D-W77

### S3 — Check the real destination {#S3}

- **Do:** Unmount the impostor, remount the original `Archive`, and return to the Archive step.
- **Expect:** The step shows the intended volume identity matching, its free space, and that it is writable, and **Close project…** is available again.
- **Trace:** flow J · STO-FR-06

### S4 — Read the reference updates {#S4}

- **Do:** In the Archive step, open the affected View references for the Project's sessions.
- **Expect:** The step lists each affected View symlink with its current target under `Astro-T7/Captures/` and its proposed target under `Archive/NGC7000`. When a session moves, its View symlinks are repointed. The symlinks to 28 Sep frames are not repointed because that session stays on `Astro-T7`. The step also lists the 20 symlinks in the View that Closed Project `NGC 7000 first light` kept (P7), with proposed targets under `Archive/NGC7000`.
- **Expect (negative):** The step offers no reference-mode choice, and no entry changes kind: no symlink is replaced by a copy. The Closed Project's View is not a reason to keep 24 Sep in place.
- **Trace:** flow J · STO-FR-06 · STO-AC-10, STO-AC-27 · D-W81, D-W111 · HARNESS-V5-FEEDBACK-R1.md §Input modes ("Archiving with links": a symlinked entry is repointed when its session moves) · G7

### S5 — Review and approve the transfer {#S5}

- **Do:** In the Archive step, inspect each selected file's from and to paths and the reference updates. Choose **Close project…**, read its confirmation and confirm.
- **Expect:**
  - The confirmation lists the four archive moves and the outcomes of Clean up and Trash, both Skipped.
  - The transfer runs as one archive operation, and the Project reads Closing. The status bar's running work names it with a mini progress bar, the Archive step shows its progress, and Activity lists it.
  - Each item passes the phases copied, durably written, destination hash verified against the source snapshot, references updated, and source retired. Expected and observed reclaimed bytes are reported separately.
- **Expect (negative):** No 28 Sep file is copied or retired. The Project does not read Archived until every selected transfer item and affected reference has succeeded.
- **Trace:** flow J · HARNESS-V5-IA.md S9, S17 · HARNESS-V5-FEEDBACK-R1.md Round 5 (P-SB3, P-STO2) · PRJ-FR-14 · PRJ-AC-31 · STO-FR-07, STO-FR-13 · D06, D19

### S6 — Interrupt the transfer {#S6}

- **Do:** Unplug `Archive` while items are still being copied. Then read the status bar, open its issue counters' popouts, open the transfer's Activity entry, and open Settings › Locations.
- **Expect:**
  - The transfer stops, and its Activity entry shows, per item, destination-verified, source-retained, reference-updated and pending work, with **Retry**.
  - The status bar's running work no longer names the transfer. The counters' popouts list the stopped transfer and the two `Archive` locations as offline, each with its action.
  - Settings › Locations reads `Archive/NGC7000` and `Archive/Long-term` Offline, apart from the transfer's per-item phases.
  - The Project still reads Closing.
- **Expect (negative):** No item whose destination or references are unverified has its source retired; those sources still match P3. The Project does not read Archived.
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
- **Expect:**
  - Each affected reference reports completed, blocked, or uncertain. F-ref's View symlink repoint reads blocked: that symlink still points at its source path, and the source is retained. The S7a item still reads blocked by drift. Every other archived item reads source retired only after its destination and references verified.
  - Each of the View's 33 other 26 Sep symlinks points at its `Archive/NGC7000` path, and so does every View symlink to another retired source. The View's 28 Sep symlinks still resolve on `Astro-T7`.
  - The Project still reads Closing, and its sessions, goals and totals are unchanged.
- **Expect (negative):** The blocked item's source is not retired. The reference repair changes no Project's sessions, and no View entry changes kind.
- **Trace:** flow J open sequencing detail · STO-FR-07 · STO-AC-10 · root FR-011, SC-007 · D06, D09 · HARNESS-V5-FEEDBACK-R1.md §Input modes (Q-ARCHIVE-LINKS)

### S9 — Repair the blocked reference {#S9}

- **Do:** Release the P4 fault and choose **Retry** for F-ref in the transfer's Activity entry.
- **Expect:** Its View symlink repoints to its `Archive/NGC7000` path and verifies; only then is its source retired.
- **Trace:** flow J · STO-FR-07 · D06

### S9a — Resolve the drifted item {#S9a}

- **Do:** Restore the P5 frame's original bytes and recorded mtime, review the item's current evidence, and choose **Retry** for it in the transfer's Activity entry.
- **Expect:** The current source matches its snapshot again, the destination and its references re-verify, and only then is the source retired. With every item settled, 18, 24, 26 and 30 Sep read Archived, and the Project reads Archived. The 20 symlinks of `NGC 7000 first light`'s kept View point to the 24 Sep frames under `Archive/NGC7000`, and Activity records the repoint for that Project.
- **Expect (negative):** The archived copy still matches P3, and no other item changes phase. `NGC 7000 first light` stays Closed with the sessions, goals, snapshot and Wrap up record P7 recorded, and it gains no pending change.
- **Trace:** flow J · HARNESS-V5-IA.md S9 · STO-FR-06, STO-FR-07 · STO-AC-14, STO-AC-27 · D06, D19, D-W111

### S9b — Open the archive review from Sessions {#S9b}

- **Do:** In Sessions, choose the **Not in any Project** filter, select `4 Oct M 33` and choose **Archive…**. Read the Destination and the review, then close the review without approving. List `Astro-T7/Captures/M33/2026-10-04/` and `Archive`.
- **Expect:**
  - **Not in any Project** lists `4 Oct M 33`.
  - The Destination lists `Archive/Long-term`, preselected and marked Default since S1a, and `Archive/NGC7000`.
  - The review is the same reviewed transfer as the Wrap up Archive step's. It lists `4 Oct M 33` with its 16 files, each destination path under `Archive/Long-term`, laid out by the saved naming templates with original basenames, with bytes and source identities. It shows the destination volume identity, its free space and that it is writable.
  - It names no affected Project and proposes no reference update, because the session is in no Project.
- **Expect (negative):** Nothing transfers: the M 33 files are still at their source paths and match P6, and `Archive` gains no file. The review proposes no other session and no path under `Archive/NGC7000`. Settings › Locations still marks `Archive/Long-term` Default.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 6 ("Archive… from Sessions": sessions in no Project, same reviewed transfer as Wrap up) · HARNESS-V5-IA.md S12, S16 · P-ARC1 · STO-FR-06 · LIB-FR-17 · G9

### S9c — Archive the session in no Project {#S9c}

- **Do:** In Sessions, choose **Archive…** on `4 Oct M 33` again, keep `Archive/Long-term`, and approve **Archive**. Read the status bar while it runs, the transfer's Activity entry, and the session's row.
- **Expect:** The transfer runs as one archive operation: the status bar's running work names it with a mini progress bar, and Activity lists it. Each of the 16 items passes copied, durably written, destination hash verified against the source snapshot, and source retired. `4 Oct M 33` then reads Archived at its `Archive/Long-term` path.
- **Expect (negative):** No source is retired before its destination verifies, and every archived file matches P6. No file goes to `Archive/NGC7000`. No Project, goal or Wrap up step changes.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 6 ("Archive… from Sessions") · HARNESS-V5-IA.md S17 · STO-FR-06, STO-FR-07 · D06, D19

### S10 — Unplug the archive later {#S10}

- **Do:** Unplug `Archive`. Open Project `NGC 7000 HOO`, read its sessions and totals, and choose **Open in {app}** on its View step.
- **Expect:** The Project's captured and usable totals remain unchanged, and its archived sessions read Offline. Its View still names the unavailable originals. **Open in {app}** is refused before launch: it names the symlink targets it cannot re-verify and offers to reconnect the archive, and the View reads unverified.
- **Expect (negative):** No unavailable input is omitted, and the application is never launched on a partial View.
- **Trace:** flow J · PREP-FR-10 · STO-FR-08, VSEL-FR-09 · STO-AC-07 · PRJ-FR-25 · D-W3, D-W97

### S11 — Review retiring the lost archive {#S11}

- **Do:** With `Archive` still unplugged, open Settings › Locations, choose the Offline location `Archive/NGC7000`, and choose **Retire location**.
- **Expect:** The review names the location, its root and Offline state, and the four sessions with their 158 copies. It also names Project `NGC 7000 HOO` and the affected entries in its View that reference those copies. It states that retiring deletes, moves or modifies no file.
- **Expect (negative):** Nothing is retired before confirmation.
- **Trace:** flow A4, cross-flow "Location offline" · HARNESS-V5-IA.md S16 · HARNESS-V5-FEEDBACK-R1.md Round 5 (P-STO2) · LIB-FR-15 · LIB-AC-16 · D11

### S11a — Confirm after the archive returns {#S11a}

- **Do:** Leave the S11 review open, plug `Archive` back in until its location reads Online, then confirm **Retire location**.
- **Expect:** Retirement is refused because the location's availability changed since the review, and a new review is required. Unplug `Archive` again and click **Retire location** to open a fresh review that reads Offline.
- **Expect (negative):** Nothing is retired and no copy reads Retired or Missing. PlateVault reads no archived file bytes for the refusal and changes no file.
- **Trace:** flow A4 · LIB-FR-15 · LIB-AC-16 · D11, D19

### S12 — Retire the location {#S12}

- **Do:** Confirm the fresh **Retire location** review. Read Settings › Locations, Sessions and the Target NGC 7000. Open Project `NGC 7000 HOO` and choose **Open in {app}** on its View step.
- **Expect:**
  - The location reads Retired, and its 158 copies read Retired. `Archive/Long-term` keeps its Default pill. Sessions still lists `4 Oct M 33` as Archived at its `Archive/Long-term` path.
  - NGC 7000 captured integration falls by exactly 13h 10m, and its usable integration counts no retired copy.
  - The Project still holds its five sessions. Every frame of 18, 24, 26 and 30 Sep is named unresolved and Retired, and its 28 Sep frames still resolve. **Open in {app}** is refused and names the retired inputs.
- **Expect (negative):** No copy reads Missing. The Project's sessions are unchanged, and no retired copy is offered as an input.
- **Trace:** flow A4 · HARNESS-V5-IA.md S9, S16 · P-ARC1 · LIB-FR-15, VSEL-FR-09 · LIB-AC-16 · PREP-FR-10 · PRJ-FR-25 · D02, D11

### S13 — Register the archive folder again {#S13}

- **Do:** Plug `Archive` back in. In Settings › Locations, try to reselect the retired location. Then add `Archive/NGC7000` as a Captures location with **Add capture location** and index it.
- **Expect:** Reselect is not offered for the retired location. The new location registers without an overlap conflict, and the 158 archived lights appear as its Unreviewed assets in new sessions beside the retired copies. 18, 26 and 30 Sep read Target NGC 7000 Associated from their pointing within its footprint, as in J19/S9, and each shows its OBJECT only as a label. 24 Sep, which has no pointing, reads an unresolved Target and is the only new session under **Needs a Target**. NGC 7000 captured integration rises by exactly 11h 30m.
- **Expect (negative):** No retired copy is counted again. No session lists OBJECT as Target evidence, and 26 Sep's `Cygnus field` label is no conflict. No retired quality decision, Target or equipment confirmation, or correction transfers. The new sessions add nothing to usable integration, and 24 Sep counts toward no NGC 7000 total until its Target is confirmed again. No Project suggests the new sessions until their rig is confirmed again. The Archived Project still names the frames of its archived sessions unresolved and Retired. The archived files match P3.
- **Trace:** flow A4 · HARNESS-V5-IA.md S16 · HARNESS-V5-FEEDBACK-R1.md Round 5 (Sessions: OBJECT is a label, P-STO2) · HIGH-LEVEL-DESIGN.md §10 glossary (OBJECT) · LIB-FR-02, LIB-FR-05, LIB-FR-15, PRJ-FR-09, PRJ-FR-25 · LIB-AC-16, STO-IMP-AC-05 · D01, D11

## Success criteria

- SC1: 0 sources are retired before their destination hash and all affected references verify (S6, S8, S9).
- SC2: After S6, 100% of unretired sources match P3.
- SC3: The Project's sessions and goals are unchanged by archive transfer, and its View holds no entry for its library-Unusable frames (S1, S8, S10).
- SC4: 0 View entries change kind and 0 reference-mode choices are offered. Each affected View symlink is repointed to its session's `Archive/NGC7000` path, and F-ref's source is retired only after its repoint verifies (S4, S8, S9, S9a).
- SC5: The impostor volume disables Close project… (S2).
- SC6: With `Archive` unplugged, Open in {app} on the Project's View is refused and 0 inputs are omitted (S10).
- SC7: The drifted source is retired 0 times while it differs from its snapshot (S7a, S8); it retires only after re-verification (S9a).
- SC8: Retiring changes 0 files and 0 copies read Missing (S12). After S13 captured integration rises by exactly 11h 30m, the 18, 26 and 30 Sep lights, so no capture is counted twice and no retired association transfers.
- SC9: Confirming a review whose availability has since changed retires 0 locations (S11a).
- SC10: 0 of the 56 28 Sep files are copied, moved or retired from S1 through S9a; the session stays on `Astro-T7` because another Project that is not Closed holds it.
- SC11: Make default moves 0 files, and the archive goes to the Project's chosen `Archive/NGC7000`, with 0 to paths under the Default `Archive/Long-term` (S1a, S5).
- SC12: Archiving `4 Oct M 33` from Sessions moves exactly 16 files, all to the Default `Archive/Long-term`, retires 0 sources before their destination verifies and changes 0 Projects. Closing its review first moves 0 files (S9b, S9c).
- SC13: All 20 symlinks of the View that Closed Project `NGC 7000 first light` kept point to `Archive/NGC7000` after S9a, Activity records 1 repoint for it, and its sessions, goals, snapshot and Wrap up record change 0 times (S4, S9a).

## Known gaps

- G1: Not validated. The rebuilt application does not exist. Product behavior follows the harness v5 design (HARNESS-V5-IA.md S9, S12, S16 and S17; HARNESS-V5-FEEDBACK-R1.md P-WRAP1, P-ARC1 and Round 5 P-STO2, P-SB3 and Sessions, on ui-harness-v5 @ b5e813a5; Round 6 @ 4f470775). It also follows the specs, the defaults that the authorized autonomous run set in decisions D06, D09, D11 and D19, and the workflow decisions D-W3, D-W20, D-W26 and D-W46. No implementation has been validated against them.
- G2: Unresolved implementation qualification: no fault fixture yet produces a destination hash mismatch, so the hash-failure branch is not exercised. Blocks readiness.
- G3: Unresolved implementation qualification: no fault control yet makes one symlink's repoint fail (P4), and the flow does not name the method of source retirement after verification. Blocks readiness.
- G4: (dissolved 2026-10-12): answered by §Round 7 P-PREP3: there is no file-list mode, so the Project's inputs are links or copies in its View.
- G5: Unresolved implementation qualification: no fault control yet pauses an item after destination verification and before retirement (P5). S7a depends on it, and no source-retirement acceptance is complete until S7a passes. Blocks readiness.
- G6: (dissolved 2026-10-12): answered by Round 6 "Archive… from Sessions"; S9b and S9c now assert that a session in no Project is archived from Sessions through the same reviewed transfer as Wrap up, to the Default `Archive/Long-term`, with nothing moved before approval. Archiving part of a Project from Sessions stays open as G9.
- G7: (dissolved 2026-10-12): answered by §Input modes "Archiving with links" (Q-ARCHIVE-LINKS) and §Round 7 P-PREP3 (no hard links); S4, S8, S9 and SC4 assert that the View's symlinks are repointed and that no reference-mode choice is offered.
- G8: Library-wide duplicate copies are J39's. Closed and Archived Projects have no Reopen or restore action (PRJ-FR-25, STO-FR-13).
- G9: Unresolved product question: Round 6 lets Sessions archive sessions that are in no Project. The F4 specs start Archive from the Archive step of a Project's Wrap up (STO-FR-06, STO-FR-13) and name no Sessions entry point. Round 6 also says nothing about a Sessions selection that holds a session of a Project or a session a Project suggests. S9b and S9c follow Round 6 and select only a session in no Project. Blocks readiness until a human decides.
- G10: (dissolved 2026-10-12): answered by §Round 7 P-PREP3. The Project View entries are symlinks, so with `Archive` unplugged or retired its View holds no readable inputs. PREP-FR-10, STO-FR-08 and VSEL-FR-09 refuse Open on the unavailable View, and S10 and S12 assert the refusal.

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
- **Δ5** 2026-10-12 · S4, S8, S9a, S10, S12 · behavior-change
  P-PREP3: `NGC7000-HOO-Siril` holds symlinks, so Archive repoints the symlinks of its 152 moved members as well as those of `26 Sep symlink check`, and Open on either run is refused while the archive is Offline or Retired (G10 dissolved).
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 7 (user, 2026-10-12) P-PREP3 (apps/prototype/design/ on ui-harness-v5 @ 12638a7c) · by: JourneysV5.R7Prep3 (intent-gated)
- **Δ6** 2026-10-15 · S1, S1a, S2, S3, S4, S5, S6, S8, S9, S9a, S9b, S9c, S10, S12, S13 · behavior-change
  Archive is the last step of Wrap up, and its Proceed is Close project…, which an unmet gate such as an impostor volume disables. The Project reads Closing until the transfer succeeds, then Archived, and stays locked with no Reopen or session restore.
  The Project's single Symlinks View replaces the run views. Archive repoints its symlinks, and Open in {app} re-verifies their targets and is refused while the archive is Offline or Retired.
  Evidence: D-W93 to D-W106 (F4 Project model, owner's answers of 2026-10-14) in PR #1804, 065 PRJ-FR-14, PRJ-FR-25, PRJ-FR-30; 069 PREP-FR-10; 071 STO-FR-06 to STO-FR-08, STO-FR-13, STO-AC-07 · by: SpecF4Writer2, SpecF4Writer3 (intent-gated)
- **Δ7** 2026-10-16 · S4, S9a · behavior-change
  Archive repoints the symlinks of a Closed Project's kept View when it moves their originals, records the repoint and changes nothing else in that Project.
  Evidence: D-W111 (owner's answers of 2026-10-15/16) in PR #1804, FR-011, PRJ-FR-25, STO-FR-06, STO-AC-27 · by: SpecF4Answers (intent-gated)
