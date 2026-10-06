---
id: J30
title: File selected sessions into a managed library location after review
version: 1
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [filing, sessions, storage, view-review]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 071-storage-custody, D06, D09, D14, D19, specs/063-clean-rebuild-contract/decisions.md, specs/071-storage-custody/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-l-optional-reviewed-filing]
---

## Goal

Long after indexing in place, the user chooses to organize some sessions into a
managed library location by approving exactly the file operations shown. Done
means: the approved session's files are at the previewed destination paths with
their original basenames and verified bytes; a collision blocked its item
without touching the existing file; an item whose reference could not be
updated, and a failed cross-volume transfer, each preserved its source; and
session boundaries and View membership are unchanged.

## Preconditions

- P1: Fresh replay of J24 (J25–J28 not run). `NGC7000 HOO - Siril` is Prepared with 208 hardlink entries and has been marked Complete as in J27/S2.
- P2: Folder `Astro-T7/Library` exists (same volume as the captures) and the disposable volume `Archive` holds `Library/`; both are writable.
- P3: The J19/P5 manifest is available.
- P4: A helper outside PlateVault that saves a named file's bytes and nanosecond mtime, then overwrites it in place with a same-size variant whose bytes differ and restores the saved mtime. The helper later restores the saved bytes and mtime.
- P5: A fault control that makes the affected-reference update of a second named 30 Sep frame fail during filing until it is disarmed (G3).

## Steps

### S1 — Propose filing {#S1}

- **Do:** In Sessions, select 26 Sep and 30 Sep, click **File into library**, and choose `Astro-T7/Library` as destination.
- **Expect:** The plan previews every relative destination path with original basenames, file counts (35 and 48), collisions (none), transfer footprint, and affected View references, and names the files as already indexed.
- **Expect (negative):** Indexing has moved nothing. Online fixture paths and hashes match their P3 entries; offline Cold-1 entries are compared after remount rather than claimed rehashed while unavailable.
- **Trace:** flow L · STO-FR-09 · D14

### S2 — Meet a collision {#S2}

- **Do:** Outside PlateVault, create a file at one 26 Sep destination path shown in the plan. Click **Review filing**.
- **Expect:** That item reads blocked by a collision and the plan asks for another path or a revised plan.
- **Expect (negative):** The existing file is byte-identical afterwards and is never overwritten.
- **Trace:** flow L, cross-flow "Destination collision" · STO-FR-09 · STO-AC-06 · D14

### S3 — Revise the plan {#S3}

- **Do:** Remove 26 Sep from the plan and click **Review filing** again.
- **Expect:** The plan lists only 30 Sep's 48 files with no collision.
- **Trace:** flow L · STO-FR-09

### S4 — Approve the displayed operations {#S4}

- **Do:** With the P4 helper, overwrite one named 30 Sep source frame after the S3 review. Arm the P5 fault. Then approve the displayed file operations and reference changes.
- **Expect:** Item progress and final outcomes are reported; each affected reference reports completed, blocked, or uncertain. The P4 frame's item is blocked because its bytes differ from the reviewed plan. The P5 frame's item is blocked by its named reference, its source is still at its original path with its P3 hash, and `NGC7000 HOO - Siril` still resolves that frame there. The other 46 files move.
- **Expect (negative):** No operation runs that the plan did not display. Neither blocked frame's source path is removed, and every View reference resolves to an existing path.
- **Trace:** flow L · STO-FR-09 · STO-AC-15, STO-AC-16 · root FR-011 · D14, D19

### S4a — File the restored frame {#S4a}

- **Do:** With the P4 helper, restore the frame's saved bytes and mtime. Review filing for the blocked item again and approve it.
- **Expect:** The item re-verifies and moves to its previewed path, and its affected references report completed.
- **Expect (negative):** No other item moves again.
- **Trace:** flow L · STO-FR-09 · STO-AC-15 · D19

### S4b — Retry the reference-blocked item {#S4b}

- **Do:** Disarm the P5 fault and click **Retry** for the P5 frame's item.
- **Expect:** Its destination verifies against the reviewed digest and its affected references report completed; only then is the frame at its previewed path and gone from its source path.
- **Expect (negative):** No other item moves again.
- **Trace:** flow L · STO-FR-09 · STO-AC-16 · root FR-011 · D14

### S5 — Verify the result {#S5}

- **Do:** Inspect Sessions and `NGC7000 HOO - Siril`, and hash the 48 destination files.
- **Expect:** The 48 files are at the previewed paths with the P3 hashes and no longer at their source paths. 30 Sep is still one session of 48 frames. The View reads 208 lights / 17h 20m with the same six exclusions, its 30 Sep references point to the filed files, and it still reads Complete.
- **Expect (negative):** No header is patched by filing, no session is merged, and no other session's files move. The identity-preserving reference repair does not reopen the View or create a membership or preparation revision.
- **Trace:** flow L · STO-FR-09 · D09, D14

### S6 — Interrupt a cross-volume filing {#S6}

- **Do:** Select 24 Sep, click **File into library**, choose `Archive/Library`, approve, and unplug `Archive` during the transfer.
- **Expect:** Each item reports its verified, pending, blocked or failed phase. Pending, failed and unverified 24 Sep items remain at their source paths with P3 hashes. Already verified items may have retired their sources only after destination and reference verification.
- **Expect (negative):** No source is retired after failed verification. Session boundaries and View membership are unchanged.
- **Trace:** flow L, J · STO-FR-07, STO-FR-09 · D06

## Success criteria

- SC1: The collision file is byte-identical after S2 and 0 files are overwritten.
- SC2: Exactly 48 files move across S4, S4a and S4b, each with its original basename and P3 hash (S5).
- SC3: Sessions stay at exactly 7 light sessions, and View membership stays 208 / 17h 20m (S5, S6).
- SC4: After S6, every pending, failed or unverified item retains its original source and hash. Every retired source has recorded destination hash and reference verification.
- SC5: The changed frame moves 0 times while it differs from the reviewed plan (S4).
- SC6: While its reference update fails, the P5 frame's source path is removed 0 times and the View resolves it (S4); it moves only after S4b verification.

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Product behavior follows the specs and the defaults that the authorized autonomous run set in decisions D06, D09, D14, and D19; no implementation has been validated against them.
- G2: Unresolved implementation qualification — the relative layout under the destination (folder structure beyond retained basenames, D14) is not fixed; S1 and S2 rely on the preview rather than a predicted path. Retrying the S6 filing is not exercised. Blocks readiness.
- G3: Unresolved implementation qualification: no fault control yet fails one item's reference update during filing (P5). The flow also names no same-volume mechanism that keeps a source path until its destination and references verify. S4 and S4b depend on both. Blocks readiness.

## Delta log

- No entries (initial draft, version 1).
