---
id: J28
title: Archive a Done Project's sessions with verified transfer and run reference repair
version: 2
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [archive, storage, projects, view-review, preparation, locations]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 071-storage-custody, D02, D06, D09, D11, D19, D-W3, D-W20, D-W26, D-W46, D-W72, specs/063-clean-rebuild-contract/decisions.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/071-storage-custody/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-j-verified-archive-transfer]
---

## Goal

After marking the Project `NGC 7000 HOO` Done, the user archives its member
sessions from the Done / Archive sheet in one reviewed transfer. The transfer
also rebuilds the references of the Project's processing runs, and the user can
trust that no source is retired before its destination copy and every affected
reference are verified. Done means: 18, 24, 26 and 30 Sep live on `Archive`
with verified hashes, and 28 Sep stays on `Astro-T7` because another open
Project's run uses it. Every source retired was retired only after destination
and reference verification, while it still matched its copied snapshot. An
interrupted, failing or drifted item keeps its source and its recorded phase.
The membership and exclusions of `NGC7000-HOO-Siril` are unchanged, and its
archived inputs read Offline when `Archive` is unplugged. When the archive
location is later retired, its copies read Retired, leave totals, change no file
and stay named in the run.

## Preconditions

- P1: Fresh replay of J34 through S5: the Archive review is open on the `NGC 7000 HOO` Done / Archive sheet, returned to without approval, and no frame has been trashed. Every remaining run of the Project is Complete; J27/S14b and J34/S3a emptied the others from the Project's Trash, which is now empty. J25 and run Clean up (J27/S4 to J27/S11) were not run, so `NGC7000-HOO-Siril` reads Complete and keeps its 208 hardlink entries under `Work/Processing/NGC 7000 HOO/NGC7000-HOO-Siril/` on `Astro-T7`. The open Project `NGC 7000 Ha deep` has the runs `Ha deep v1` (Complete) and `Ha deep` (Prepared), each with 28 Sep as a member. 30 Sep is only a candidate of the open Project `NGC 7000 SHO`. Siril is not running.
- P2: A disposable writable volume `Archive` with free space for the four archived sessions, and a second disposable volume that can be mounted under the same name `Archive`.
- P3: The J19/P5 manifest and a SHA-256 list of the five member sessions' files are recorded. `Cold-1` stays offline.
- P4: Write permission is removed from the run folder that holds the prepared entries of one named 24 Sep frame, so that its reference cannot be rebuilt (fault fixture for S8; G3).
- P5: For one named 26 Sep frame, a backup of its original bytes and nanosecond mtime and a replacement file of identical size with different bytes, kept outside PlateVault. A fault control pauses that item after destination verification and before source retirement (G5).

## Steps

### S1 — Start the archive from the Done / Archive sheet {#S1}

- **Do:** In the open Archive review on the `NGC 7000 HOO` Done / Archive sheet, choose `Archive/NGC7000` as destination.
- **Expect:** The plan lists 18, 24, 26 and 30 Sep with their 158 files and lists 28 Sep as kept because `NGC 7000 Ha deep` uses it. 30 Sep is proposed although it is a candidate of `NGC 7000 SHO`. Each destination path sits under `Archive/NGC7000`, laid out by the saved naming templates with original basenames. The plan also shows bytes, source identities, the affected runs, including `NGC7000-HOO-Siril`, and proposed reference updates.
- **Expect (negative):** Session membership and run exclusions read fixed by the plan. 28 Sep has no destination path, and the membership and totals of `Ha deep v1` and `Ha deep` are unchanged.
- **Trace:** flow J, Done / Archive sheet · STO-FR-06, STO-FR-13 · STO-AC-17 · root FR-011 · D-W20, D-W26, D-W46

### S2 — Meet an impostor destination {#S2}

- **Do:** Unmount `Archive` and mount the second P2 volume under the same name, then return to the plan.
- **Expect:** The plan states that the volume at that path is a different volume than the intended destination and blocks approval.
- **Trace:** flow J · STO-FR-06 · STO-AC-10 · D06, D11

### S3 — Check the real destination {#S3}

- **Do:** Unmount the impostor and remount the original `Archive`.
- **Expect:** The plan shows the intended volume identity matching, its free space, and that it is writable.
- **Trace:** flow J · STO-FR-06

### S4 — Choose how references are rebuilt {#S4}

- **Do:** Open the `NGC7000-HOO-Siril` reference entry in the plan and choose a supported reference mode (symlink to the archived file).
- **Expect:** It shows the current mode (hardlink) and that a hardlink cannot be rebuilt across volumes. The choices are a supported reference mode or retaining the local copy with its unreclaimed bytes. After the choice the plan reads symlink.
- **Expect (negative):** No mode was chosen implicitly before the user's choice.
- **Trace:** flow J · STO-FR-06 · STO-AC-10

### S5 — Review and approve the transfer {#S5}

- **Do:** Click **Review transfer**, inspect source and destination paths and the rebuilt-reference effects, and approve.
- **Expect:** The transfer runs with per-item phases: copied, durably written, destination hash verified against the source snapshot, reference rebuilt, source retired. Expected and observed reclaimed bytes are reported separately.
- **Expect (negative):** No 28 Sep file is copied or retired.
- **Trace:** flow J · STO-FR-07 · D06, D19

### S6 — Interrupt the transfer {#S6}

- **Do:** Unplug `Archive` while items are still being copied, then open Storage.
- **Expect:** The transfer stops and shows, per item, destination-verified, source-retained, reference-updated, and pending work, with **Retry**. Storage lists the same transfer with the same per-item phases, separately from location availability.
- **Expect (negative):** No item whose destination or references are unverified has its source retired; those sources still match P3.
- **Trace:** flow J recovery branch, cross-flow "Archive interruption" · STO-FR-08, STO-FR-11 · STO-AC-05 · D06

### S7 — Retry after reconnecting {#S7}

- **Do:** Reconnect `Archive` and click **Retry**.
- **Expect:** Retry revalidates the destination volume identity and the recorded item identities, then resumes the recorded work. Items already verified keep their recorded phases.
- **Expect (negative):** A partially written destination file is not treated as verified because its name exists.
- **Trace:** flow J recovery branch · STO-FR-08 · STO-AC-05 · D06, D09

### S7a — Change a source before retirement {#S7a}

- **Do:** When the P5 pause reports the named 26 Sep frame destination-verified and awaiting retirement, overwrite its source with the P5 replacement, restore its recorded mtime, and release the pause.
- **Expect:** That item reads blocked with source drift named. Its source path keeps the replacement bytes, `Archive/NGC7000` keeps the verified snapshot, and both are listed for review. Other items keep their recorded phases.
- **Expect (negative):** Neither version is retired, overwritten or chosen automatically.
- **Trace:** flow J recovery branch · STO-FR-07 · STO-AC-14 · D06, D19

### S8 — Inspect a failed reference rebuild {#S8}

- **Do:** When the transfer settles, open the per-item outcomes and the 24 Sep frame of P4.
- **Expect:** Each affected reference reports completed, blocked, or uncertain. The P4 frame's reference reads blocked and its source is retained. The S7a item still reads blocked by drift. Every other archived item reads source retired only after its destination and references verified. `NGC7000-HOO-Siril` reads 208 lights / 17h 20m with the same six exclusions and still reads Complete, and its 28 Sep members still resolve on `Astro-T7`.
- **Expect (negative):** The blocked item's source is not retired. The identity-preserving reference repair does not reopen the run or create a membership or preparation revision, and no hardlink is converted without the S4 choice.
- **Trace:** flow J open sequencing detail · STO-FR-07 · STO-AC-10 · root FR-011, SC-007 · D06, D09

### S9 — Repair the blocked reference {#S9}

- **Do:** Restore write permission on the P4 folder and click **Retry** for the blocked item.
- **Expect:** Its reference rebuilds and verifies; only then is its source retired.
- **Trace:** flow J · STO-FR-07 · D06

### S9a — Resolve the drifted item {#S9a}

- **Do:** Restore the P5 frame's original bytes and recorded mtime, review the item's current evidence, and click **Retry** for it.
- **Expect:** The current source matches its snapshot again, the destination and its references re-verify, and only then is the source retired.
- **Expect (negative):** The archived copy still matches P3, and no other item changes phase.
- **Trace:** flow J · STO-FR-07 · STO-AC-14 · D06, D19

### S10 — Unplug the archive later {#S10}

- **Do:** Unplug `Archive`. Open NGC 7000, then `NGC7000-HOO-Siril`, and click **Open in Siril**.
- **Expect:** Captured and usable totals and run membership are unchanged, and the 152 archived member inputs read Offline. Opening is refused because inputs are unavailable, with the options to reconnect the archive or review another verified location.
- **Expect (negative):** Unavailable inputs are not omitted from the handoff, and the available 28 Sep inputs are not handed off alone.
- **Trace:** flow J · STO-FR-08, VSEL-FR-09 · STO-AC-07 · D-W3

### S11 — Review retiring the lost archive {#S11}

- **Do:** With `Archive` still unplugged, open Locations, choose the Offline location that holds `Archive/NGC7000`, and click **Retire location**.
- **Expect:** The review names the location, its root and Offline state, and the four sessions with their 158 copies. It also names the run `NGC7000-HOO-Siril`, any other run that references those copies, Project `NGC 7000 HOO` and any Result that references them. It states that retiring deletes, moves or modifies no file.
- **Expect (negative):** Nothing is retired before confirmation.
- **Trace:** flow A4, cross-flow "Location offline" · LIB-FR-15 · LIB-AC-16 · D11

### S11a — Confirm after the archive returns {#S11a}

- **Do:** Leave the S11 review open, plug `Archive` back in until its location reads Online, then confirm **Retire location**.
- **Expect:** Retirement is refused because the location's availability changed since the review, and a new review is required. Unplug `Archive` again and click **Retire location** to open a fresh review that reads Offline.
- **Expect (negative):** Nothing is retired and no copy reads Retired or Missing. PlateVault reads no archived file bytes for the refusal and changes no file.
- **Trace:** flow A4 · LIB-FR-15 · LIB-AC-16 · D11, D19

### S12 — Retire the location {#S12}

- **Do:** Confirm the fresh **Retire location** review. Open Sessions, NGC 7000 and `NGC7000-HOO-Siril`, and click **Open in Siril**.
- **Expect:** The location reads Retired, and its 158 copies read Retired. NGC 7000 captured integration falls by exactly 13h 10m, and its usable integration counts no retired copy. The run still lists its 208 members and six exclusions and reads Complete. Each of its 152 archived members is named unresolved and Retired, and its 56 28 Sep members still resolve. Opening is refused and names the retired inputs.
- **Expect (negative):** No copy reads Missing. The run's membership, exclusions and prepared revision are unchanged, and no retired copy is offered as an input.
- **Trace:** flow A4 · LIB-FR-15, VSEL-FR-09 · LIB-AC-16 · D02, D11

### S13 — Register the archive folder again {#S13}

- **Do:** Plug `Archive` back in. In Locations, try to reselect the retired location. Then add `Archive/NGC7000` as a Captures location with **Add existing library folder** and index it.
- **Expect:** Reselect is not offered for the retired location. The new location registers without an overlap conflict, and the 158 archived lights appear as its Unreviewed assets in new sessions beside the retired copies. 18 and 30 Sep read Target NGC 7000 suggested from their own agreeing OBJECT and pointing evidence. 24 Sep reads an unresolved Target and 26 Sep a conflicting one, both **Needs review**, as in J19/S9. NGC 7000 captured integration rises by exactly 8h 35m.
- **Expect (negative):** No retired copy is counted again. No retired quality decision, Target or equipment confirmation, or correction transfers, so the new sessions add nothing to usable integration, and 24 Sep and 26 Sep count toward no NGC 7000 total until confirmed again. The new sessions are candidates of no Project until their Target and rig are confirmed. `NGC7000-HOO-Siril` still names its 152 archived members unresolved and Retired. The archived files match P3.
- **Trace:** flow A4 · LIB-FR-02, LIB-FR-05, LIB-FR-15, PRJ-FR-09 · LIB-AC-16, STO-IMP-AC-05 · D01, D11

## Success criteria

- SC1: 0 sources are retired before their destination hash and all affected references verify (S6, S8, S9).
- SC2: After S6, 100% of unretired sources match P3.
- SC3: `NGC7000-HOO-Siril` reads 208 / 17h 20m with 6 exclusions and stays Complete before and after the transfer (S1, S8, S10).
- SC4: 0 implicit reference-mode conversions occur (S4, S8).
- SC5: The impostor volume blocks approval (S2).
- SC6: With `Archive` unplugged, Open is refused and 0 inputs are omitted (S10).
- SC7: The drifted source is retired 0 times while it differs from its snapshot (S7a, S8); it retires only after re-verification (S9a).
- SC8: Retiring changes 0 files and 0 copies read Missing (S12). After S13 captured integration rises by exactly 8h 35m, so no capture is counted twice and no retired association transfers.
- SC9: Confirming a review whose availability has since changed retires 0 locations (S11a).
- SC10: 0 of the 56 28 Sep files are copied, moved or retired from S1 through S9a, and the membership and totals of `Ha deep v1` and `Ha deep` are unchanged.

## Known gaps

- G1: Not validated. The rebuilt application does not exist. Product behavior follows the specs and the defaults that the authorized autonomous run set in decisions D06, D09, D11 and D19, and the workflow decisions D-W3, D-W20, D-W26 and D-W46. No implementation has been validated against them.
- G2: Unresolved implementation qualification: no fault fixture yet produces a destination hash mismatch, so the hash-failure branch is not exercised. Blocks readiness.
- G3: Unresolved implementation qualification: the prepared run layout that P4 depends on is unspecified, and the flow does not name the method of source retirement after verification. Blocks readiness.
- G4: Out of scope for this journey: Direct-source configuration paths affected by a move are not exercised because no journey prepares a Direct-source run. Blocks readiness until covered by a step or a journey.
- G5: Unresolved implementation qualification: no fault control yet pauses an item after destination verification and before retirement (P5). S7a depends on it, and no source-retirement acceptance is complete until S7a passes. Blocks readiness.
- G6: Out of scope for this journey: S6 shows Storage's transfer phases, but Storage's location availability, run footprints and duplicate candidates (STO-AC-12, D16) are not exercised. Archive of selected sessions started from Storage rather than from the Done / Archive sheet (STO-FR-06) is not exercised either. Blocks readiness until covered by a step or a journey.

## Delta log

- **Δ2** 2026-10-06 · S1, S5, S6, S8, S10, S11, S12, S13, P1, P2, +SC10 · behavior-change
  Archive now starts from the Done / Archive sheet of a Done Project and keeps 28 Sep, which the open Project `NGC 7000 Ha deep` uses. A candidate-only use does not keep 30 Sep. Destinations follow the naming templates. Views are processing runs named per D-W51. Storage shows transfer phases during the interruption. P1 follows J34's run states, where the runs that are no longer wanted were moved to the Project's Trash and emptied from it.
  Evidence: D-W3, D-W20, D-W26, D-W46 (workflow decisions, settled 2026-10-06); 071 STO-FR-06, STO-FR-11, STO-FR-13, STO-AC-17; 063 FR-011 at e4476231, plus D-W72, 065 PRJ-AC-16 and 071 STO-FR-13, STO-AC-18 · by: agent (intent-gated, user instruction)
