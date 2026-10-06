---
id: J25
title: Add new sessions to a prepared processing run without disturbing its prepared inputs
version: 2
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [view-review, indexing, sessions, locations, results, projects]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 066-view-selection, 069-application-handoff, 070-results-reuse, D02, D08, D09, D16, D19, D-W34, D-W45, D-W66, specs/063-clean-rebuild-contract/decisions.md, specs/064-library-inventory/spec.md, specs/066-view-selection/spec.md, specs/069-application-handoff/spec.md, specs/070-results-reuse/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-g-refresh-an-existing-view]
---

## Goal

After new captures arrive, the prepared processing run `NGC7000-HOO-Siril`
offers "Add 2 new sessions". The user meets the Reopen prompt on the Complete
run, compares the new candidates against the saved membership, accepts one
addition, declines another, and keeps a member that no longer matches the
subject. The prepared folder stays untouched under the external application.
Done means: the refresh lists each added session with its reason, keeps the
run's exclusions, flags the re-confirmed 26 Sep session "no longer matches
subject", and shows an unreadable member as Unavailable. The accepted change
is saved as a new membership revision that survives restart and needs its own
preparation review. The prepared revision's 208 entries are unchanged
throughout. Frames of an added session copied to two locations count once.

## Preconditions

- P1: J24 completed: `NGC7000-HOO-Siril` reads Prepared, not Complete, at `Work/Processing/NGC 7000 HOO/NGC7000-HOO-Siril/` with 208 hardlink entries from saved membership revision 2 (J22). Every source is readable. A listing of its entries (path, inode, size) is recorded outside PlateVault.
- P2: Two new RedCat NGC 7000 sessions with OBJECT NGC 7000, pointing and orientation evidence and RedCat equipment headers, not yet in `Astro-T7/Captures`: one Ha 300 s session and one OIII 300 s session, each of 10 frames, dated after 30 Sep.
- P3: The J19/P5 manifest is available.
- P4: A disposable writable volume `Spare` holding an empty `Captures/` folder.
- P5: A same-size variant, with different bytes, of one named new Ha frame, kept outside PlateVault.

## Steps

### S1 — Index the new arrivals {#S1}

- **Do:** Copy both P2 sessions into `Astro-T7/Captures`, and copy the new Ha session byte for byte into `Spare/Captures`. In Settings, add `Spare/Captures` as a Captures location. Index `Astro-T7 captures` again and index `Spare captures`. Choose **Confirm equipment** with the RedCat 51 / ASI2600MM rig for both new sessions.
- **Expect:** Sessions lists the two new sessions with 10 frames each, Target NGC 7000 and rig RedCat 51 / ASI2600MM. After indexing completes, each new Ha frame lists two physical copies, on `Astro-T7` and `Spare`. Project `NGC 7000 HOO` captured Ha and captured OIII each rise by 0h 50m, and the run shows **Add 2 new sessions**.
- **Expect (negative):** `NGC7000-HOO-Siril` still reads saved membership revision 2 with 208 lights / 17h 20m, and its prepared entries equal the P1 listing. No second new Ha session appears, captured Ha does not rise by 1h 40m, and "in project" does not change. Both copies keep their bytes.
- **Trace:** flow G · VSEL-FR-12, LIB-FR-08 · LIB-AC-15 · D16, D-W66 · J19/G4

### S2 — Make an existing member unreadable {#S2}

- **Do:** Remove read permission from the 18 Sep subfolder and index `Astro-T7 captures` again.
- **Expect:** 18 Sep reads unreadable or unknown scope in Sessions.
- **Trace:** flow G · LIB-FR-06

### S2a — Re-confirm a member's Target {#S2a}

- **Do:** In Sessions, choose **Confirm Target** IC 5070 for 26 Sep.
- **Expect:** 26 Sep reads Target IC 5070 (user-confirmed) next to its original evidence, and it is no longer a candidate of subject NGC 7000. The Project's in-project and captured OIII values are unchanged, because 26 Sep is still a member of `NGC7000-HOO-Siril`.
- **Expect (negative):** The run's membership and prepared entries do not change. Source bytes still match P3, including the 26 Sep OBJECT keyword.
- **Trace:** flow G · VSEL-FR-12 · VSEL-AC-24 · D-W45, D-W66

### S2b — Meet Reopen on a Complete run {#S2b}

- **Do:** In `NGC7000-HOO-Siril`, click **Mark processing complete**. Click **Add 2 new sessions**, read the prompt, and decline Reopen.
- **Expect:** The run reads Complete and still shows **Add 2 new sessions**. Choosing it asks the user to Reopen the run first. After declining, the run still reads Complete with saved membership revision 2.
- **Expect (negative):** Completing removes no file and claims no external success. Declining opens no refresh diff and changes no membership. The prepared entries equal the P1 listing.
- **Trace:** flow G, I1 · VSEL-FR-17, RES-FR-06, RES-FR-07 · VSEL-AC-20, RES-AC-08 · D-W34

### S3 — Reopen and compare against the saved membership {#S3}

- **Do:** Click **Add 2 new sessions** again and choose **Reopen**.
- **Expect:** The run no longer reads Complete, and its prepared revision and saved membership revision 2 are unchanged. The refresh diff opens against revision 2. It lists both new sessions as added, each with the reason `Target NGC 7000 on RedCat 51 / ASI2600MM`. 18 Sep reads **Unavailable**. 26 Sep is flagged **no longer matches subject**, with an offer to remove it. The six 30 Sep exclusions stay recorded.
- **Expect (negative):** 18 Sep is not listed as removed, and 26 Sep is not removed. Membership is unchanged until a change is accepted.
- **Trace:** flow G · VSEL-FR-12, VSEL-FR-17 · VSEL-AC-06, VSEL-AC-20, VSEL-AC-24 · root edge "Refresh never removes an offline member" · D-W34, D-W45

### S4 — Keep the run unchanged {#S4}

- **Do:** Choose to keep the run unchanged.
- **Expect:** The run reads saved membership revision 2 with 208 lights / 17h 20m and no proposed revision.
- **Expect (negative):** The prepared entries still equal the P1 listing.
- **Trace:** flow G · VSEL-FR-12

### S5 — Accept one change and decline the others {#S5}

- **Do:** Click **Add 2 new sessions** again. Accept the new Ha session, decline the new OIII session, and decline the removal of 26 Sep. Click **Save run**. Quit PlateVault, relaunch, and open the run and Project `NGC 7000 HOO`.
- **Expect:** The repeated comparison again shows 18 Sep as Unavailable and 26 Sep as **no longer matches subject**, not as proposed removals. Saved membership revision 3 adds the new Ha session's 10 available frames, each once with its `Spare` copy named. The new OIII session is not in it, and 26 Sep stays a member. After the restart the run opens at revision 3. It asks for frame and calibration review of the changed inputs and needs a new preparation review before it can be prepared. The Project's Ha in-project value has risen by 0h 50m, and OIII in project is unchanged.
- **Expect (negative):** The prepared revision, its 208 entries and the inputs Siril reads are unchanged (P1 listing). No new arrival enters any prepared revision silently, and no member leaves without an explicit removal.
- **Trace:** flow G · VSEL-FR-08, VSEL-FR-12, VSEL-FR-13, VSEL-FR-14, VSEL-FR-16, PREP-FR-11 · VSEL-AC-12, VSEL-AC-15, VSEL-AC-24 · D02, D08, D09, D-W34, D-W45

### S5a — Restore the 26 Sep Target {#S5a}

- **Do:** In Sessions, choose **Confirm Target** NGC 7000 for 26 Sep. Open **Refresh selection** in the run.
- **Expect:** 26 Sep reads Target NGC 7000 (user-confirmed) and is a candidate again. The refresh no longer flags it.
- **Expect (negative):** Saved membership revision 3 is unchanged.
- **Trace:** flow G · VSEL-FR-12 · D-W45

### S6 — Restore the unreadable member {#S6}

- **Do:** Restore read permission on the 18 Sep subfolder and index `Astro-T7 captures` again.
- **Expect:** 18 Sep reads 55 frames and is still a member of both the prepared revision and saved membership revision 3.
- **Expect (negative):** No duplicate 18 Sep session appears.
- **Trace:** flow G · LIB-FR-06

### S7 — Change one copy of a new Ha frame {#S7}

- **Do:** Overwrite the P5 frame's `Spare` copy in place with its variant, restore that copy's mtime, and index `Spare captures` again.
- **Expect:** After indexing completes, the frame reads as conflicting copies on `Astro-T7` and `Spare`, needing review. NGC 7000 captured Ha integration is unchanged.
- **Expect (negative):** Captured Ha does not rise by 0h 05m, and the `Spare` copy is not offered in place of the `Astro-T7` copy. PlateVault changes neither file.
- **Trace:** flow G · LIB-FR-08 · LIB-AC-15 · D16, D19 · J19/G4

## Success criteria

- SC1: The prepared revision's entries equal the P1 listing at S1, S2b, S3, S4, S5 and S6.
- SC2: S3 lists exactly 2 added sessions, each with a reason, 6 retained exclusions, 18 Sep as Unavailable and 26 Sep as no longer matching the subject, with 0 removals.
- SC3: At S2b the Complete run accepts 0 membership changes until Reopen.
- SC4: After S5 saved revision 3 contains the new Ha session's 10 frames once each, does not contain the new OIII session, still contains 26 Sep, persists across restart, and reads as needing review before preparation.
- SC5: After S1 captured Ha has risen by exactly 0h 50m and each new Ha frame lists 2 physical copies; after S7 captured Ha is unchanged and the changed frame reads as conflicting copies.

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Product behavior follows the specs and the defaults set in decisions D02, D08, D09, D16 and D19 and workflow decisions D-W34, D-W45 and D-W66. No implementation has been validated against them.
- G2: Out of scope for this journey: preparing revision 3 into `Work/Processing/NGC 7000 HOO/NGC7000-HOO-Siril (rev 2)/` (D09, PREP-AC-21) and cleanup of the replaced entries are not exercised. Blocks readiness until covered by a step or a journey.
- G3: Out of scope for this journey: path repair after an archive transfer is distinct from refresh and is exercised in J28/S8.
- G4: Out of scope for this journey: Refresh while the external application is running on the prepared revision (VSEL-AC-12) is not exercised, and no member is a manual inclusion, so the D09 pinning of manual inclusions is not observed. Blocks readiness until covered by a step or a journey.

## Delta log

- **Δ2** 2026-10-06 · S1, S3, S4, S5, +S2a, +S2b, +S5a · behavior-change
  The run offers "Add N new sessions" for new candidates. A Complete run asks for Reopen first. A member whose Target is re-confirmed stays and is flagged "no longer matches subject" with an offer to remove it. Saving adds a membership revision that feeds "in project".
  Evidence: specs/066-view-selection VSEL-FR-12, VSEL-FR-17, VSEL-AC-06, VSEL-AC-20, VSEL-AC-24; specs/070-results-reuse RES-FR-07, RES-AC-08; workflow decisions D-W34, D-W45, D-W66 · by: journey-scribe (intent-gated)
