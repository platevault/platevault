---
id: J19
title: Index capture folders in place and inspect sessions on first use
version: 1
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [onboarding, locations, indexing, sessions, targets]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, D01, D08, D11, D15, D18, specs/063-clean-rebuild-contract/spec.md, specs/063-clean-rebuild-contract/decisions.md, specs/064-library-inventory/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-a-first-use-and-indexing]
---

## Goal

The user registers folders that already hold captures and calibration frames,
indexes them where they are, and inspects sessions and the evidence behind each
Target and equipment association. No Project, processing application, account,
network connection, workspace root, or file reorganization is required. Done
means: Sessions lists the seven fixture light sessions as separate
metadata-homogeneous sessions, unresolved associations read Needs review instead
of a guess, an unreadable or offline location reads as uncertain rather than
Missing, and every file in the registered folders is byte-identical to the
pre-run manifest.

## Preconditions

- P1: A clean development build of the rebuilt PlateVault (D17) with no catalog and no network connection; first launch shows onboarding.
- P2: Volume `Astro-T7` holds `Captures/` with one subfolder per session. The five dated sessions use mono 300 s lights from the RedCat 51 / ASI2600MM train at one gain, offset, temperature and 1x1 binning, captured at the Backyard coordinates. The separate `other camera` session uses the second camera and optical train named below. A plain-text note is an unsupported item. The 30 Sep session also carries the frame-review properties of J22/P2.

  | Session | Channel | Lights | OBJECT | Pointing | Orientation | Optics keywords |
  | --- | --- | --- | --- | --- | --- | --- |
  | 18 Sep | Ha | 55 | NGC 7000 | yes | no | yes |
  | 24 Sep | OIII | 20 | absent | absent | absent | yes |
  | 26 Sep | OIII | 35 | `Cygnus field` | yes, overlapping NGC 7000 | yes | yes |
  | 28 Sep | Ha | 56 | NGC 7000 | yes | yes | telescope and focal length absent |
  | 30 Sep | OIII | 48 | NGC 7000 | yes | yes | yes |
  | other camera | Ha | any | NGC 7000 | yes, overlapping | yes | a second camera and optical train |

- P3: Volume `Cold-1` is mounted and holds `Captures/` with a 12 Sep OIII RedCat session (OBJECT, pointing, orientation present) captured at the coordinates of the second saved site used in J20/P2.
- P4: `Astro-T7/Calibration/` holds the calibration fixture of J23/P2.
- P5: A manifest (relative path, size, SHA-256) of every file under the three folders, recorded outside PlateVault before S1.
- P6: A catalog-write fault fixture that makes the next catalog write fail on demand (G3).

## Steps

### S1 — Read the Locations step {#S1}

- **Do:** Launch PlateVault and read the onboarding Locations step without adding anything.
- **Expect:** Captures is marked required; Calibration and Results are marked optional; **Set up later** is offered. Onboarding cannot continue until a capture location exists and names Captures as the missing role.
- **Expect (negative):** No step asks for a processing application, a Project, a View location, a workspace root, or an account.
- **Trace:** flow A1 · LIB-FR-01 · root FR-015 · D18

### S2 — Add the first capture location {#S2}

- **Do:** Click **Add capture location**, choose `Astro-T7/Captures` in the native folder picker, and enter the display name `Astro-T7 captures`.
- **Expect:** A row shows `Astro-T7 captures`, its path, role Captures, access state, and Online.
- **Expect (negative):** No indexing progress appears before S5. No file under the folder is created, renamed, moved, or deleted (P5 still matches).
- **Trace:** flow A1 · LIB-FR-01, LIB-FR-02

### S3 — Add another folder for the same role {#S3}

- **Do:** Click **Add another location** and choose `Cold-1/Captures` with role Captures.
- **Expect:** A second Captures row appears with its own path and Online state; the first row is unchanged.
- **Trace:** flow A1 · LIB-FR-01

### S4 — Configure the optional roles {#S4}

- **Do:** Click **Add calibration location** and choose `Astro-T7/Calibration`. Leave Results unset and continue.
- **Expect:** Onboarding continues. Results reads as not set.
- **Expect (negative):** The unset Results role is not shown as an error, warning, or failed setup.
- **Trace:** flow A2 · LIB-FR-01 · LIB-AC-01

### S5 — Start indexing with one denied location {#S5}

- **Do:** Outside PlateVault, remove read permission from `Astro-T7/Calibration`. Click **Start indexing**.
- **Expect:** Progress shows files discovered, metadata read, unsupported items (at least the P2 note file), unreadable items, and completed scope. The Calibration row names the access failure and offers **Choose folder again** and **Retry**. Both Captures locations keep indexing.
- **Expect (negative):** The denied folder is not reported as empty and none of its files is labelled Missing.
- **Trace:** flow A3, A4 · LIB-FR-03, LIB-FR-06, LIB-FR-07

### S6 — Browse while indexing runs {#S6}

- **Do:** Before indexing finishes, click **Open library** and open Sessions.
- **Expect:** Sessions whose metadata has been read are listed and can be inspected. Totals name the locations they cover and are marked provisional.
- **Expect (negative):** No total implies that unscanned folders or data outside the registered locations are included.
- **Trace:** flow A4 · LIB-FR-03 · G5

### S7 — Recover the denied location {#S7}

- **Do:** Restore read permission on `Astro-T7/Calibration` and click **Retry** on its row.
- **Expect:** The row clears its failure and the calibration frames are indexed.
- **Expect (negative):** Retrying one location does not reset or re-create sessions already read from the Captures locations.
- **Trace:** flow A4 · LIB-FR-07

### S8 — Inspect the resulting sessions {#S8}

- **Do:** After indexing completes, review Sessions; toggle display grouping by night on and off.
- **Expect:** Exactly seven light sessions: the six P2 sessions and the 12 Sep Cold-1 session, each with its channel, exposure, frame count, and location. Calibration frames do not appear as light sessions. Grouping by night changes the display only; session boundaries and counts are identical with grouping on and off.
- **Expect (negative):** No session mixes Ha and OIII frames. No frame reads Usable; every frame reads Unreviewed.
- **Trace:** flow A3, A4 · LIB-FR-04, LIB-FR-09 · LIB-AC-03

### S9 — Review association evidence {#S9}

- **Do:** Open **Inspect session** for 30 Sep, 24 Sep, 26 Sep, and 28 Sep.
- **Expect:** Each association names the evidence used, with observed and confirmed evidence shown separately. 30 Sep reads Target NGC 7000 from its pointing evidence, with which its OBJECT label agrees. 24 Sep reads an unresolved Target with **Needs review**. 26 Sep shows the conflict between its `Cygnus field` label and its pointing. 28 Sep shows its equipment association as **Needs review**.
- **Expect (negative):** 24 Sep is not assigned a guessed Target. No OBJECT label by itself assigns a Target or supplies coordinates; 26 Sep is not assigned a `Cygnus field` Target.
- **Trace:** flow A3 · LIB-FR-05 · LIB-AC-03 · D01, D11

### S10 — Confirm and correct associations in the catalog {#S10}

- **Do:** Choose **Confirm Target** NGC 7000 for 24 Sep and for 26 Sep. Choose **Confirm equipment** with the RedCat 51 / ASI2600MM camera/optical-train record for the five Astro-T7 RedCat sessions (18, 24, 26, 28, and 30 Sep).
- **Expect:** Each session shows the confirmed association next to its original evidence; 26 Sep still displays its `Cygnus field` label; 28 Sep's equipment no longer reads Needs review. Any grouping revision created by a confirmation keeps the previous session identity traceable.
- **Expect (negative):** Source bytes still match P5, including the 26 Sep OBJECT keyword and the absent 28 Sep optics keywords. Session boundaries and frame counts do not change. The 12 Sep session's equipment stays observed, not confirmed.
- **Trace:** flow A3 · LIB-FR-05 · LIB-AC-06 · root FR-002 · D11, D15 · G2

### S11 — See a failed catalog write {#S11}

- **Do:** Arm the P6 fault, then choose **Confirm equipment** with its own camera/optical-train record for the other-camera session. Disarm the fault and click **Retry**.
- **Expect:** While the fault is armed the edited value stays visibly unsaved with an error and **Retry**. After Retry it reads saved.
- **Expect (negative):** The value never reads Saved before the write succeeds.
- **Trace:** flow cross-flow "Unsaved catalog write fails" · root FR-012 · D08

### S12 — Rescan with an unreadable session folder {#S12}

- **Do:** Remove read permission from the 18 Sep subfolder and index `Astro-T7 captures` again.
- **Expect:** The 18 Sep frames read unreadable or unknown scope, the scan scope is named incomplete, and the session keeps its last-observed metadata. Other sessions reconcile normally.
- **Expect (negative):** No 18 Sep frame reads Missing and the session is not removed.
- **Trace:** flow A3, cross-flow "Partial scan" · LIB-FR-06 · LIB-AC-04 · G4

### S13 — Restore the session folder {#S13}

- **Do:** Restore read permission on the 18 Sep subfolder and index `Astro-T7 captures` again.
- **Expect:** 18 Sep reads 55 frames with no uncertainty marker.
- **Expect (negative):** No duplicate 18 Sep session appears.
- **Trace:** flow A3 · LIB-FR-06

### S14 — Verify custody {#S14}

- **Do:** Outside PlateVault, recompute the manifest of the three folders and compare it with P5.
- **Expect:** Every path, size, and SHA-256 matches.
- **Trace:** root SC-002 · LIB-AC-02

### S15 — Take Cold-1 offline {#S15}

- **Do:** Eject `Cold-1`.
- **Expect:** Its row reads Offline. The 12 Sep session stays listed with its last-observed metadata, marked as last observed rather than currently verified, and an Offline state.
- **Expect (negative):** No 12 Sep frame reads Missing and the session is not removed.
- **Trace:** flow A3, cross-flow "Location offline" · LIB-FR-07 · LIB-AC-05 · D11

## Success criteria

- SC1: After S8, exactly 7 light sessions exist and none mixes channels; night grouping leaves boundaries and counts identical (S8).
- SC2: The S14 manifest equals P5 for 100% of files.
- SC3: Zero frames read Missing at S5, S12, and S15; 18 Sep reads 55 frames again after S13.
- SC4: After S10, 24 Sep and 26 Sep read NGC 7000 (user-confirmed), the five RedCat sessions read confirmed equipment, and their source headers equal P5 (S10, S14).
- SC5: After S7, the Calibration row has no failure and its frames are indexed; the failure offered both recovery actions (S5).
- SC6: At the end, 0 frames read Usable (S8).
- SC7: A failing catalog write never reads Saved (S11).

## Known gaps

- G1: Not validated — the rebuilt application does not exist. Product behavior follows the specs and the defaults that the authorized autonomous run set in decisions D01, D08, D11, D15, and D18; no implementation has been validated against them.
- G2: Unresolved implementation qualification — the flow names no control for creating the explicit camera/optical-train record (D11) used in S10. Same-asset locate/remap (LIB-FR-07, D11) and "locate a known copy" are not exercised in this journey. Blocks readiness.
- G3: Unresolved implementation qualification — no fault-injection mechanism exists yet for the S11 catalog-write failure (P6). Blocks readiness.
- G4: Unresolved implementation qualification — the flow names no control for re-indexing an already registered location; S12 and S13 assume one. Blocks readiness.
- G5: Unresolved implementation qualification — S6 needs indexing to run long enough to observe; fixture sizing or a slow volume is unspecified. Blocks readiness.

## Delta log

- No entries (initial draft, version 1).
