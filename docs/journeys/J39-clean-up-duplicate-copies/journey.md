---
id: J39
title: Clean up duplicate copies found by the automatic scan
version: 2
status: draft
last_reviewed: 2026-10-12
actors: [primary-user]
surfaces: [duplicates, issues, status-bar, locations, indexing, activity, sessions, import]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [HARNESS-V5-FEEDBACK-R1.md#round-6, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#storage-and-duplicates, P-STO2, HARNESS-V5-IA.md#S15, HARNESS-V5-IA.md#round-2-foundation-2026-10-09, HARNESS-V5-FEEDBACK-R1.md#e2-calibration-storage-settings, apps/prototype/src/domain/storage.ts, apps/prototype/src/store/actions/storage.ts, apps/prototype/src/domain/issues.ts, apps/prototype/src/components/app/confirm-dialog.tsx, D-W43, D-W57, D-W74, specs/071-storage-custody/spec.md, J34, J38]
---

## Goal

The user frees space taken by byte-identical extra copies of library frames.
They do not start a scan. PlateVault checks for duplicates after every index and
import, and raises one ⚠ issue when it finds any. From that issue the user opens
the Duplicates review. The scan covers registered library locations only, so a
connected capture card never raises the warning. Each group there already has
its keeper preselected: the copy in the earliest-registered location. The
user changes one keeper, then moves the other copies to the OS Trash, one group
at a time or all at once, and puts one copy back. Project-scoped clean-up of
duplicate copies stays in the Project's Wrap up (J34). Done means:

- After S1 the ⚠ issue reads `6 duplicate copies · 313 MB` and the review lists 5 groups, each with its keeper preselected by the rule: the copy in the earliest-registered location, even where another copy's file is older.
- The connected capture card `Card-3`, which holds byte-identical copies of 2 library frames, adds nothing to any scan result and is never listed.
- Every copy that was moved is in the OS Trash with its original bytes. Every kept copy and every refused copy is unchanged, and nothing is permanently deleted.
- Every frame keeps exactly one copy, its session frame counts do not change, and no frame reads Trashed.
- A copy put back from the OS Trash shows as a duplicate again after the next index, with no scan started by hand.

## Preconditions

- P1: A development catalog seeded with the shared fixture world (G2). These Captures locations are registered in this order, all online and on volumes that have an OS Trash unless noted:
  1. `Astro-T7 captures` (`Astro-T7/Captures`) holds every session of J19/P2, plus the `4 Oct M 33` session of J32/P3 under `Astro-T7/Captures/M33/2026-10-04/`.
  2. `Cold-1 captures` (`Cold-1/Captures`) holds the `12 Sep` session of J19/P3.
  3. `Scratch captures` (`Scratch/Captures`, as in J34/P6) is on a volume with no OS Trash.

  S1 registers `Spare captures` fourth, so after S1 every P2 extra copy sits in a registered library location.

  `Astro-T7/Calibration` is the Calibration location. No other issue is raised (the status bar shows only the ⚠ counter that S1 raises).
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
- P4: No duplicate scan has run since the P2 copies were indexed.
- P5: The isolated account's OS Trash is empty. Manifests (relative path, size, SHA-256) of every file on `Astro-T7`, `Cold-1`, `Scratch`, `Spare` and `Card-3`, and the frame count of every session, were recorded outside PlateVault before S1.
- P6: Removable volume `Card-3` (ASIAIR layout, has an OS Trash) is connected before S1 and stays connected to S7. It is not a registered location. Under `Autorun/Light/` it holds byte-identical copies of M-2 and S-1 (2 files, 104,382,720 bytes), as a capture card left uncleared after a Copy import would. None of its files is new to the library.

## Steps

### S1 — Index a folder and see the scan run on its own {#S1}

- **Do:** Register `Spare/Captures` as a Captures location named `Spare captures` (Add existing library folder) and let it index. Watch the status bar, then open Activity.
- **Expect:**
  - The index runs, and then a duplicate scan runs as background work in the status bar without the user starting it.
  - Activity records the index and, after it, the scan.
  - When the scan settles, the status bar shows ⚠ 1. The ⚠ popout and the Issues hub list `6 duplicate copies · 313 MB`.
- **Expect (negative):** The user is never asked to scan. No file is moved, renamed, written or trashed, and every session's frame count matches P5. The `Spare` copies create no new session. The connected `Card-3` raises no duplicates issue: with its 2 copies counted, the issue would read 8 copies and 418 MB, and it reads 6 copies and 313 MB.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 Storage and duplicates "Duplicates are scanned automatically after each index and import, as a background operation. A non-zero result raises a ⚠ issue" · src/store/actions/storage.ts duplicate-scan · J38/S11

### S2 — Open the Duplicates review {#S2}

- **Do:** Follow the duplicates issue. Read every group.
- **Expect:** The Duplicates review lists 5 groups, one per frame: M-1, M-2, N-1, C-1 and S-1. Each group shows the frame's file name, SHA-256 and each copy's location and path. One copy per group is preselected to keep, the copy in the earliest-registered location (P1 order, `Spare captures` last):
  - M-1, M-2, N-1 and S-1: the `Astro-T7 captures` copy.
  - C-1: the `Cold-1 captures` copy.

  N-1 lists 3 copies, and the others list 2. The review's total reads 6 copies and 313 MB.
- **Expect (negative):** Opening the review moves nothing. No action anywhere in the review deletes a file permanently. N-1's keeper is not the `Spare` copy, although that copy is the group's oldest file (P2). No group lists a `Card-3` path: M-2 and S-1 each list 2 copies, not 3.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 Storage and duplicates "groups of byte-identical copies, each with the copy to keep preselected" · HARNESS-V5-FEEDBACK-R1.md §Round 6 "The duplicate scan covers registered library locations only. Capture cards never raise the duplicates warning. The keeper is the copy in the earliest-registered location." · src/domain/storage.ts DuplicateGroup · D-W74

### S3 — Change the keeper of one group {#S3}

- **Do:** In the C-1 group, choose Keep this copy on the `Spare/Captures` copy.
- **Expect:** The `Spare` copy of C-1 is now the group's keeper, and the `Cold-1` copy is the one that would move.
- **Expect (negative):** Changing the keeper moves no file, and no other group's keeper changes.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 Storage and duplicates "Keep this copy"

### S4 — Clean up one group {#S4}

- **Do:** In the M-1 group, choose Move the others to the OS Trash. Read the confirmation, then confirm.
- **Expect:**
  - Before anything moves, a confirmation names the one copy that moves (`Spare/Captures/M33/2026-10-04/` M-1) and the copy kept (`Astro-T7 captures`).
  - After confirming, the `Spare` copy of M-1 is in the OS Trash and M-1 lists one copy.
  - The M-1 group leaves the review, and the issue reads `5 duplicate copies · 261 MB`.
- **Expect (negative):** The kept M-1 copy is unchanged. M-1 does not read Trashed and is not listed under the Sessions Trashed filter. `4 Oct M 33` keeps its frame count, and M-1's quality and run memberships do not change. No other group's copies move.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 Storage and duplicates "Move the others to the OS Trash, per group and for all. Nothing is deleted permanently" · src/components/app/confirm-dialog.tsx · D-W43, D-W74

### S5 — Clean up all groups at once {#S5}

- **Do:** Choose Move the others to the OS Trash for all groups. Read the confirmation, then confirm.
- **Expect:**
  - The confirmation lists 5 copies to move: the `Spare` copy of M-2, the `Cold-1` and `Spare` copies of N-1, the `Cold-1` copy of C-1, and the `Scratch` copy of S-1.
  - After confirming, the first 4 of those are in the OS Trash.
  - The `Scratch` copy of S-1 is refused as a terse refusal that counts 1 copy, with the reason that `Scratch` has no OS Trash in its disclosure.
  - The review lists only the S-1 group, and the issue reads `1 duplicate copy · 52.2 MB`.
  - M-2, N-1 and C-1 each list one copy. C-1's copy is in `Spare/Captures`, as chosen in S3.
- **Expect (negative):** No kept copy moves, and the refused `Scratch` copy is unchanged and not deleted. Nothing is moved before the confirmation.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 Storage and duplicates · HARNESS-V5-FEEDBACK-R1.md §Copy rules "Errors and refusals are terse" · D-W43 (OS Trash only) · J34/S9a (copy on a volume with no OS Trash refused)

### S6 — Put one copy back {#S6}

- **Do:** In the OS Trash, put back the `Spare` copy of M-1. In Settings › Locations, Rescan `Spare captures`. Then follow the duplicates issue again.
- **Expect:**
  - After the rescan a duplicate scan runs on its own, and the issue reads `2 duplicate copies · 104 MB`.
  - The review lists the M-1 group again with 2 copies, keeper `Astro-T7 captures`, and the S-1 group.
- **Expect (negative):** The put-back file is byte-identical to its P5 manifest entry. M-1's session, quality and memberships are unchanged, and no new session appears. `Card-3`, still connected, adds no copy and no group: S-1 lists 2 copies and no group lists M-2.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 Storage and duplicates "after each index" · messages location_rescan · J34/S10

### S7 — Verify custody {#S7}

- **Do:** Outside PlateVault, recompute the P5 manifests and frame counts, and list the OS Trash.
- **Expect:**
  - The OS Trash holds exactly 4 files: the `Spare` copy of M-2, the `Cold-1` and `Spare` copies of N-1, and the `Cold-1` copy of C-1. Each matches its P5 size and SHA-256.
  - Every other file on the five volumes matches P5, including the put-back M-1 copy, the `Scratch` copy of S-1 and both `Card-3` copies.
  - Every session's frame count matches P5.
- **Expect (negative):** No file was permanently deleted, renamed or rewritten, and no original (P2 "Original" column) left its location. No `Card-3` file is in the OS Trash.
- **Trace:** specs/071-storage-custody/spec.md · D-W43, D-W74

## Success criteria

- SC1: 0 scans are started by hand. A scan runs after each of the 2 indexes (S1, S6).
- SC2: The issue reads, in order, `6 duplicate copies · 313 MB` (S1), `5 duplicate copies · 261 MB` (S4), `1 duplicate copy · 52.2 MB` (S5) and `2 duplicate copies · 104 MB` (S6).
- SC3: All 5 preselected keepers match the earliest-registered rule at S2: 4 `Astro-T7 captures` copies and 1 `Cold-1 captures` copy, and 0 keepers are the `Spare` copy of N-1 (the oldest file).
- SC4: Exactly 5 copies reach the OS Trash across S4 and S5, 1 copy is refused with its reason, and 1 is put back. At S7 the OS Trash holds 4 files.
- SC5: 0 files are permanently deleted, 0 originals move, 0 session frame counts change, and 0 frames read Trashed (S4, S5, S7).
- SC6: With `Card-3` connected through S1 to S7, 0 of its copies are counted or listed at S1, S2 and S6, and both its files match P5 at S7.

## Known gaps

- G1: Not validated. Behavior follows the harness v5 design: HARNESS-V5-FEEDBACK-R1.md §Round 5 Storage and duplicates and P-STO2 (apps/prototype/design/ on ui-harness-v5 @ b5e813a5), with D-W74 for the keep-one-copy rule. At b5e813a5 the prototype scans only on demand from the Storage tab and has no clean-up in it. Automatic scanning and the Duplicates review are Round 5 work in progress, and the library-only scan and earliest-registered keeper of HARNESS-V5-FEEDBACK-R1.md §Round 6 (ui-harness-v5 @ 4f470775) are not yet in the prototype. No implementation has been validated against this journey.
- G2: Unresolved implementation qualification: P1 to P4 need a seeded catalog with indexed copies on `Cold-1` and `Scratch` and no scan recorded after them. No fixture builder exists. Blocks readiness.
- G3: (dissolved 2026-10-12): answered by Round 6 "The duplicate scan covers registered library locations only"; S1, S2, S6 and S7 now assert that the connected capture card `Card-3` (P6), holding byte-identical copies of M-2 and S-1, is never counted, listed or trashed.
- G4: (dissolved 2026-10-12): answered by Round 6 "The keeper is the copy in the earliest-registered location"; S2 now asserts it with a fixture where the oldest file (the `Spare` copy of N-1, P2) is in the last-registered location and is not the keeper.
- G5: Out of scope for this journey: a copy whose bytes change between the scan and the move (D-W74 rehashes each copy before it moves), a copy on an offline volume, and a scan canceled from the status bar. Each needs fault injection or pacing. Blocks readiness until covered by a step or a journey.
- G6: Out of scope for this journey: duplicate copies of a Project's frames offered in that Project's Wrap up. J34 covers them.
- G7: Unresolved product question: which copy is the keeper when two or more copies of a group sit in the same earliest-registered location (for example a session folder duplicated inside `Astro-T7 captures`)? Round 6 dropped the "then the oldest" tie-break. Options: (a, recommended) the copy PlateVault catalogued first in that location, which stays stable however file times change; (b) the oldest file, as Round 5 read, which a copy tool that rewrites file times can change; (c) no preselection for such a group, so the user must choose before Move the others is offered. No step covers this case. Blocks readiness.

## Delta log

- **Δ2** 2026-10-12 · S1, S2, S6, S7 · behavior-change
  The duplicate scan covers registered library locations only: a connected capture card with byte-identical copies is never counted, listed or trashed.
  The keeper is the copy in the earliest-registered location, not the oldest file; the fixture now makes the `Spare` copy of N-1 the oldest file and asserts it is not kept.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "The duplicate scan covers registered library locations only" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); user answers to the PR #1788 journey questions · by: JourneysV5.R6G (intent-gated)
