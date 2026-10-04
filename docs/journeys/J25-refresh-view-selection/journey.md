---
id: J25
title: Refresh a saved View's selection without disturbing its prepared inputs
version: 1
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [view-review, indexing, sessions]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 066-view-selection, 069-application-handoff, D02, D08, D09, specs/063-clean-rebuild-contract/decisions.md, specs/066-view-selection/spec.md, specs/069-application-handoff/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-g-refresh-an-existing-view]
---

## Goal

After new captures arrive, the user compares a saved, prepared View against its
saved criteria, accepts some changes and declines others, and keeps the existing
preparation untouched underneath the external application. Done means: the
comparison lists each added session with its reason, keeps manual inclusions and
explicit exclusions recorded, and shows an unreadable member as Unavailable; the
accepted change exists only as a proposed membership revision that needs its own
review; and the prepared revision's 208 entries are unchanged throughout.

## Preconditions

- P1: J24 completed; `Work/Processing/NGC7000-HOO-Siril` is Prepared with 208 hardlink entries. A listing of its entries (path, inode, size) is recorded outside PlateVault.
- P2: Two new RedCat NGC 7000 sessions with full geometry evidence and RedCat equipment evidence, not yet in `Astro-T7/Captures`: one Ha 300 s session and one OIII 300 s session, each of 10 frames, dated after 30 Sep.
- P3: The J19/P5 manifest is available.

## Steps

### S1 — Index the new arrivals {#S1}

- **Do:** Copy both P2 sessions into `Astro-T7/Captures` and index `Astro-T7 captures` again. Choose **Confirm equipment** with the RedCat 51 / ASI2600MM record for both new sessions.
- **Expect:** Sessions lists the two new sessions with 10 frames each and confirmed RedCat equipment.
- **Expect (negative):** `NGC7000 HOO - Siril` still reads 208 lights / 17h 20m; its prepared entries equal the P1 listing.
- **Trace:** flow G · VSEL-FR-12 · J19/G4

### S2 — Make an existing member unreadable {#S2}

- **Do:** Remove read permission from the 18 Sep subfolder and index `Astro-T7 captures` again.
- **Expect:** 18 Sep reads unreadable or unknown scope in Sessions.
- **Trace:** flow G · LIB-FR-06

### S3 — Compare against the saved criteria {#S3}

- **Do:** Reopen `NGC7000 HOO - Siril` and click **Refresh selection**.
- **Expect:** The comparison shows the saved criteria and, against the reviewed membership, lists both new sessions as added with reason matching the saved criteria. 18 Sep and 24 Sep read as manual inclusions outside those criteria. The six 30 Sep exclusions stay recorded. 18 Sep reads **Unavailable**.
- **Expect (negative):** 18 Sep is not listed as removed. Membership is unchanged until a change is accepted.
- **Trace:** flow G · VSEL-FR-12 · VSEL-AC-06 · root edge "Refresh never removes an offline member"

### S4 — Keep the View unchanged {#S4}

- **Do:** Choose to keep the existing View unchanged.
- **Expect:** The View reads 208 lights / 17h 20m with no proposed revision.
- **Expect (negative):** The prepared entries still equal the P1 listing.
- **Trace:** flow G · VSEL-FR-12

### S5 — Accept one change and decline another {#S5}

- **Do:** Click **Refresh selection** again. Accept the new Ha session and decline the new OIII session. Click **Save View**.
- **Expect:** A proposed membership revision exists that adds the new Ha session's available frames; the new OIII session is not in it. The revision asks for frame and calibration review of the changed inputs and needs a new Review preparation before it can be prepared.
- **Expect (negative):** The prepared revision, its 208 entries, and the inputs Siril reads are unchanged (P1 listing). No new arrival enters any prepared View silently.
- **Trace:** flow G · VSEL-FR-12, PREP-FR-11 · D02, D08, D09

### S6 — Restore the unreadable member {#S6}

- **Do:** Restore read permission on the 18 Sep subfolder and index `Astro-T7 captures` again.
- **Expect:** 18 Sep reads 55 frames and is still a member of both the prepared revision and the proposed revision.
- **Expect (negative):** No duplicate 18 Sep session appears.
- **Trace:** flow G · LIB-FR-06

## Success criteria

- SC1: The prepared revision's entries equal the P1 listing at S1, S4, S5, and S6.
- SC2: S3 lists exactly 2 added sessions, each with a reason, 2 manual inclusions, 6 retained exclusions, and 18 Sep as Unavailable with 0 removals.
- SC3: After S5 the proposed revision contains the new Ha session and not the new OIII session, and reads as needing review before preparation.

## Known gaps

- G1: Not validated — the rebuilt application does not exist. Product behavior follows the specs and the defaults that the authorized autonomous run set in decisions D02, D08, and D09; no implementation has been validated against them.
- G2: Unresolved — whether repeated refresh keeps manual inclusions pinned, and the folder used to prepare a new revision, are not settled by D01–D18 (flow decision 9). Preparing the S5 revision, and cleanup of replaced entries, are not exercised. Blocks readiness.
- G3: Out of scope for this journey — path repair after an archive transfer is distinct from refresh and is exercised in J28/S8.

## Delta log

- No entries (initial draft, version 1).
