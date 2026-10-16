---
id: J39
title: Clean up duplicate copies found by the automatic scan
version: 5
status: draft
last_reviewed: 2026-10-12
actors: [primary-user]
surfaces: [duplicates, status-bar, locations, indexing, activity, sessions, projects, wrap-up]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [HARNESS-V5-FEEDBACK-R1.md#round-6, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#storage-and-duplicates, HARNESS-V5-FEEDBACK-R1.md#round-8-user-2026-10-12, P-STO2, P-ISS1, HARNESS-V5-IA.md#S15, HARNESS-V5-IA.md#round-2-foundation-2026-10-09, HARNESS-V5-FEEDBACK-R1.md#e2-calibration-storage-settings, apps/prototype/src/domain/storage.ts, apps/prototype/src/store/actions/storage.ts, apps/prototype/src/domain/issues.ts, apps/prototype/src/components/app/confirm-dialog.tsx, D-W43, D-W57, D-W74, specs/071-storage-custody/spec.md, J34, J38, specs/063-clean-rebuild-contract/workflow-decisions.md#D-W93-D-W106, specs/064-library-inventory/spec.md#LIB-FR-22, specs/065-project-goals/spec.md#PRJ-FR-14-PRJ-FR-15, specs/071-storage-custody/spec.md#STO-FR-16, D-W92, D-W94, D-W97, D-W116]
---

## Goal

The user frees space taken by byte-identical extra copies of library frames.
The user finds byte-identical extra copies through Sessions' Duplicates filter and the Duplicates review. Only copies in registered locations are counted, so a connected capture card never appears. The review identifies duplicate copies but does not authorize their removal. In the open Project's Wrap up, the user reviews the Trash step's duplicate-copy offer, which names the kept copy, and moves eligible extras to the OS Trash. A copy put back from the OS Trash appears again after its location is rescanned. Done means:

- After S1 the ⚠ issue reads `6 duplicate copies · 313 MB` and the review lists 5 groups, each with its keeper preselected by the rule: the copy in the earliest-registered location, even where another copy's file is older.
- The connected capture card `Card-3`, which holds byte-identical copies of 2 library frames, adds nothing to any scan result and is never listed.
- Every copy that was moved is in the OS Trash with its original bytes. Every kept copy and every refused copy is unchanged, and nothing is permanently deleted.
- Each frame retains its named kept copy. Moving duplicate copies does not change session frame counts or mark the frame record Trashed.
- After a copy is put back and its location is rescanned, the Sessions Duplicates filter and review show it again. There is no issue dismissal or Issues hub.

## Preconditions

- P1: A development catalog seeded with the shared fixture world (G2). These Captures locations are registered in this order, all online and on volumes that have an OS Trash unless noted:
  1. `Astro-T7 captures` (`Astro-T7/Captures`) holds every session of J19/P2, plus the `4 Oct M 33` session of J32/P3 under `Astro-T7/Captures/M33/2026-10-04/`.
  2. `Cold-1 captures` (`Cold-1/Captures`) holds the `12 Sep` session of J19/P3.
  3. `Scratch captures` (`Scratch/Captures`, as in J34/P6) is on a volume with no OS Trash.

  S1 registers `Spare captures` fourth, so after S1 every P2 extra copy sits in a registered library location.

  `Astro-T7/Calibration` is the Calibration location. The fixture has no other duplicate copies in registered locations.
- P2: Five named lights, each 52,191,360 bytes, have byte-identical extra copies made outside PlateVault on 2026-10-11, after their originals were written:

  | Frame | Session | Original | Extra copies |
  |---|---|---|---|
  | M-1 | `4 Oct M 33` | `Astro-T7 captures` | `Spare/Captures/M33/2026-10-04/` |
  | M-2 | `4 Oct M 33` | `Astro-T7 captures` | `Spare/Captures/M33/2026-10-04/` |
  | N-1 | `18 Sep` Ha | `Astro-T7 captures` | `Cold-1/Captures/18 Sep/` and `Spare/Captures/18 Sep/` |
  | C-1 | `12 Sep` OIII | `Cold-1 captures` | `Spare/Captures/12 Sep/` |
  | S-1 | `30 Sep` OIII | `Astro-T7 captures` | `Scratch/Captures/30 Sep/` |

  The `Cold-1` and `Scratch` copies are already indexed as copies of their frames. Each copy keeps its original basename. One exception to "after their originals": the `Spare` copy of N-1 had its file creation and modification times set, outside PlateVault, to 2026-09-01 00:00 local, so it is the oldest file of the N-1 group (the `Astro-T7` original dates from the 18 Sep night, the `Cold-1` copy from 2026-10-11).
- P3: Volume `Spare` is mounted, has an OS Trash, holds only the P2 copies under `Spare/Captures/`, and is not registered.
- P4: Before S1, `Spare/Captures` is not registered. The P2 copies on `Cold-1` and `Scratch` are already indexed.
- P5: The isolated account's OS Trash is empty. Manifests (relative path, size, SHA-256) of every file on `Astro-T7`, `Cold-1`, `Scratch`, `Spare` and `Card-3`, and the frame count of every session, were recorded outside PlateVault before S1.
- P6: Removable volume `Card-3` (ASIAIR layout, has an OS Trash) is connected before S1 and stays connected to S7. It is not a registered location. Under `Autorun/Light/` it holds byte-identical copies of M-2 and S-1 (2 files, 104,382,720 bytes), as a capture card left uncleared after a Copy import would. None of its files is new to the library.

## Steps

### S1 — Index a folder and find duplicate sessions {#S1}

- **Do:** Register `Spare/Captures` as a Captures location named `Spare captures` (Add existing library folder) and let it index. In Sessions, select Duplicates.
- **Expect:** Sessions lists the affected sessions with duplicate-copy badges. The M-1, M-2, N-1, C-1 and S-1 copies contribute `6 duplicate copies · 313 MB`. Activity records the completed index.
- **Expect (negative):** No copy moves, and no issue is raised or listed in an Issues hub. Every session's frame count matches P5. `Card-3` is unregistered and its two copies add nothing to the Duplicates filter.
- **Trace:** LIB-FR-22; LIB-FR-03; FR-032

### S2 — Open the Duplicates review {#S2}

- **Do:** In Sessions, follow a duplicate-copy badge and read the Duplicates review.
- **Expect:** The Duplicates review opens for the affected sessions and shows their byte-identical copies in registered locations. It identifies 6 extra copies across M-1, M-2, N-1, C-1 and S-1. No `Card-3` path appears.
- **Expect (negative):** Opening the review changes no file. It offers no action to remove a copy; showing a duplicate never authorizes disposal. (LIB-FR-22)
- **Trace:** LIB-FR-22; STO-FR-11; FR-029

### S3 — Review the Project's duplicate-copy offer {#S3}

- **Do:** Open Project `NGC 7000 HOO` and its Wrap up. Proceed through Clean up with nothing selected, so the step is Skipped, then read the Trash step's duplicate-copy group.
- **Expect:** The offer names each extra copy and the kept copy. The kept copies follow PRJ-FR-15: the registered Captures or Calibration copy is kept in preference to another location, and the earliest-registered such location is kept when there is more than one. For C-1 the kept copy is in `Cold-1 captures`, not `Spare captures`.
- **Expect (negative):** The Duplicates review itself has no copy-removal action. No file moves while the Trash offer is being reviewed.
- **Trace:** PRJ-FR-14, PRJ-FR-15; LIB-FR-22; STO-FR-16

### S4 — Move one duplicate copy to the OS Trash {#S4}

- **Do:** In Wrap up's Trash step, select only the `Spare/Captures/M33/2026-10-04/` copy of M-1. Review the kept `Astro-T7 captures` copy and confirm the move.
- **Expect:** The confirmation names the extra copy and the kept copy. After confirming, the `Spare` copy of M-1 is in the OS Trash, while M-1 still has its kept copy and the `4 Oct M 33` session count is unchanged.
- **Expect (negative):** The kept copy stays in place, the frame record is not marked Trashed, and no other duplicate copy moves.
- **Trace:** PRJ-FR-15; STO-FR-16; LIB-FR-18

### S5 — Move the remaining eligible copies {#S5}

- **Do:** In Wrap up's Trash step, select the remaining eligible duplicate copies. Review the confirmation and the refusal for `Scratch`, then confirm.
- **Expect:** The confirmation lists the `Spare` copy of M-2, the `Cold-1` and `Spare` copies of N-1, and the `Spare` copy of C-1. These four copies reach the OS Trash. The `Scratch` copy of S-1 is refused because that volume has no OS Trash. M-2, N-1 and C-1 each retain their named kept copy, including C-1 in `Cold-1 captures`.
- **Expect (negative):** No kept copy moves. The refused `Scratch` copy stays unchanged, and nothing moves before confirmation.
- **Trace:** PRJ-FR-15; STO-FR-16; STO-FR-04; STO-FR-05

### S5a — Review the refused duplicate again {#S5a}

- **Do:** In Sessions, select Duplicates and open the S-1 row's Duplicates review.
- **Expect:** The review still shows the refused `Scratch` copy. The row identifies the duplicate session; no dismissed issue or Restore action is shown.
- **Expect (negative):** Reopening the review moves, trashes or writes no file.
- **Trace:** LIB-FR-22; STO-FR-16; FR-032

### S6 — Put one copy back {#S6}

- **Do:** In the OS Trash, put back the `Spare` copy of M-1. In Settings › Locations, rescan `Spare captures`. Then open Sessions' Duplicates filter.
- **Expect:** The M-1 row shows the extra copy again, and its badge opens the Duplicates review. The M-1 kept copy remains `Astro-T7 captures`, and the S-1 duplicate is still listed.
- **Expect (negative):** The put-back file matches its P5 manifest entry. M-1's session count and quality are unchanged, and no new session appears. `Card-3` remains unregistered and contributes no copy.
- **Trace:** LIB-FR-22; LIB-FR-18; PRJ-FR-15; STO-FR-16

### S6a — Read the kept copy for a tie inside one location {#S6a}

- **Do:** Outside PlateVault, copy `Astro-T7/Captures/M33/2026-10-04/` to `Astro-T7/Captures/M33/2026-10-04 copy/` and set the copies' file creation and modification times to 2026-09-01 00:00 local, so they are older than the originals. In Settings › Locations, rescan `Astro-T7 captures`. Reopen the Trash step of `NGC 7000 HOO`'s Wrap up from the step strip and read the duplicate-copy group for M-1 and M-2. Leave the step without confirming.
- **Expect:** M-1 and M-2 each have two copies in `Astro-T7 captures`, the earliest-registered location, so they tie for the kept copy. For each, the original under `M33/2026-10-04/`, which PlateVault catalogued first, is preselected as the kept copy, and the `2026-10-04 copy/` file is offered as an extra copy, although its file is older. M-1's put-back `Spare` copy is offered as well.
- **Expect (negative):** No file moves, because the user confirmed nothing. The older file times do not make a copy the kept copy.
- **Trace:** PRJ-FR-15; STO-FR-16; STO-AC-28 · D-W74, D-W116

### S7 — Verify custody {#S7}

- **Do:** Outside PlateVault, recompute the P5 manifests and frame counts, and list the OS Trash.
- **Expect:**
  - The OS Trash holds exactly 4 files: the `Spare` copy of M-2, the `Cold-1` and `Spare` copies of N-1, and the `Spare` copy of C-1. Each matches its P5 size and SHA-256.
  - Every other file on the five volumes matches P5, including the put-back M-1 copy, the `Scratch` copy of S-1 and both `Card-3` copies. The two files under `Astro-T7/Captures/M33/2026-10-04 copy/` that S6a made match the M-1 and M-2 originals.
  - Every session's frame count matches P5.
- **Expect (negative):** No file was permanently deleted, renamed or rewritten, and no original (P2 "Original" column) left its location. No `Card-3` file is in the OS Trash.
- **Trace:** specs/071-storage-custody/spec.md · D-W43, D-W74

## Success criteria

- SC1: S1 lists the five affected sessions through the Sessions Duplicates filter, and S6 shows the restored M-1 copy after rescan. Neither result is presented through an Issues hub.
- SC2: The indexed library starts with 6 extra copies. After S4, one copy is in the OS Trash; after S5, five are in the OS Trash and the unsupported `Scratch` copy is refused; after S6, putting M-1 back restores its duplicate badge.
- SC3: The Wrap up offer names the kept copy for each duplicate under PRJ-FR-15: four are in `Astro-T7 captures` and C-1 is in `Cold-1 captures`.
- SC4: Exactly 5 copies reach the OS Trash across S4 and S5, 1 copy is refused with its reason, and 1 is put back. At S7 the OS Trash holds 4 files.
- SC5: 0 files are permanently deleted, 0 originals move, 0 session frame counts change, and 0 frames read Trashed (S4, S5, S7).
- SC6: With `Card-3` connected through S1 to S7, 0 of its copies are counted or listed at S1, S2 and S6, and both its files match P5 at S7.
- SC7: S5a reopens the refused duplicate in the Duplicates review without changing files; after the put-back and rescan, Sessions lists M-1 as a duplicate again.
- SC8: At S6a, the kept copy for M-1 and M-2 is the first-catalogued original in both of the 2 tied groups, and 0 files move.

## Known gaps

- G1: Not validated. The Duplicates filter and review follow LIB-FR-22; Project duplicate-copy offers follow PRJ-FR-15 and STO-FR-16. No implementation has been validated against this journey.
- G2: Unresolved implementation qualification: P1 to P4 need a seeded catalog with indexed copies on `Cold-1` and `Scratch` and no scan recorded after them. No fixture builder exists. Blocks readiness.
- G3: (dissolved 2026-10-12): answered by Round 6 "The duplicate scan covers registered library locations only"; S1, S2, S6 and S7 now assert that the connected capture card `Card-3` (P6), holding byte-identical copies of M-2 and S-1, is never counted, listed or trashed.
- G4: (dissolved 2026-10-12): answered by Round 6 "The keeper is the copy in the earliest-registered location"; S2 now asserts it with a fixture where the oldest file (the `Spare` copy of N-1, P2) is in the last-registered location and is not the keeper.
- G5: Out of scope for this journey: a copy whose bytes change between the scan and the move (D-W74 rehashes each copy before it moves), a copy on an offline volume, and a scan canceled from the status bar. Each needs fault injection or pacing. Blocks readiness until covered by a step or a journey.
- G6: No separate duplicate-copy keeper choice is specified for the Duplicates review; removal and the kept-copy rule are specified for the Project's Wrap up Trash offer by PRJ-FR-15 and STO-FR-16.
- G7: (dissolved 2026-10-16): answered by the owner's answer of 2026-10-15/16 (D-W116). When copies in the same earliest-registered location tie for the kept copy, the copy PlateVault catalogued first is preselected. Nothing is removed without review. S6a and SC8 now assert it with copies whose files are older than the originals.

## Delta log

- **Δ2** 2026-10-12 · S1, S2, S6, S7 · behavior-change
  The duplicate scan covers registered library locations only: a connected capture card with byte-identical copies is never counted, listed or trashed.
  The keeper is the copy in the earliest-registered location, not the oldest file; the fixture now makes the `Spare` copy of N-1 the oldest file and asserts it is not kept.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "The duplicate scan covers registered library locations only" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); user answers to the PR #1788 journey questions · by: JourneysV5.R6G (intent-gated)
- **Δ4** 2026-10-15 · S1, S2, S3, S4, S5, S5a, S6 · behavior-change
  Duplicate copies are found through Sessions' Duplicates filter and review; disposal is offered in the Project's Wrap up Trash step, which names the kept copy and refuses unsupported moves.
  Evidence: D-W93 to D-W106 in specs/063-clean-rebuild-contract/workflow-decisions.md, LIB-FR-22, PRJ-FR-14, PRJ-FR-15, STO-FR-16 · by: SpecF4Writer2 (intent-gated)
- **Δ5** 2026-10-16 · +S6a, S7 · behavior-change
  A tie for the kept copy inside one location preselects the copy PlateVault catalogued first, never the oldest file; S6a reads it without moving anything.
  Evidence: D-W116 (owner's answers of 2026-10-15/16) in PR #1804, PRJ-FR-15, STO-FR-16, STO-AC-28 · by: SpecF4Answers (intent-gated)
