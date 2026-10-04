---
id: J30
title: File selected sessions into a managed library location after review
version: 1
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [filing, sessions, storage, view-review]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 071-storage-custody, D06, D09, D14, specs/063-clean-rebuild-contract/decisions.md, specs/071-storage-custody/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-l-optional-reviewed-filing]
---

## Goal

Long after indexing in place, the user chooses to organize some sessions into a
managed library location by approving exactly the file operations shown. Done
means: the approved session's files are at the previewed destination paths with
their original basenames and verified bytes; a collision blocked its item
without touching the existing file; a failed cross-volume transfer preserved its
source; and session boundaries and View membership are unchanged.

## Preconditions

- P1: Fresh replay of J24 (J25–J28 not run). `NGC7000 HOO - Siril` is Prepared with 208 hardlink entries and has been marked Complete as in J27/S2.
- P2: Folder `Astro-T7/Library` exists (same volume as the captures) and the disposable volume `Archive` holds `Library/`; both are writable.
- P3: The J19/P5 manifest is available.

## Steps

### S1 — Propose filing {#S1}

- **Do:** In Sessions, select 26 Sep and 30 Sep, click **File into library**, and choose `Astro-T7/Library` as destination.
- **Expect:** The plan previews every relative destination path with original basenames, file counts (35 and 48), collisions (none), transfer footprint, and affected View references, and names the files as already indexed.
- **Expect (negative):** Indexing alone has moved nothing; the manifest still equals P3.
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

- **Do:** Approve the displayed file operations and reference changes.
- **Expect:** Item progress and final outcomes are reported; each affected reference reports completed, blocked, or uncertain.
- **Expect (negative):** No operation runs that the plan did not display.
- **Trace:** flow L · STO-FR-09

### S5 — Verify the result {#S5}

- **Do:** Inspect Sessions and `NGC7000 HOO - Siril`, and hash the 48 destination files.
- **Expect:** The 48 files are at the previewed paths with the P3 hashes and no longer at their source paths. 30 Sep is still one session of 48 frames. The View reads 208 lights / 17h 20m with the same six exclusions, its 30 Sep references point to the filed files, and it still reads Complete.
- **Expect (negative):** No header is patched by filing, no session is merged, and no other session's files move. The identity-preserving reference repair does not reopen the View or create a membership or preparation revision.
- **Trace:** flow L · STO-FR-09 · D09, D14

### S6 — Interrupt a cross-volume filing {#S6}

- **Do:** Select 24 Sep, click **File into library**, choose `Archive/Library`, approve, and unplug `Archive` during the transfer.
- **Expect:** The outcome reports the transfer as unverified or failed per item; the 24 Sep sources remain at their original paths and match P3.
- **Expect (negative):** No source is retired after failed verification. Session boundaries and View membership are unchanged.
- **Trace:** flow L, J · STO-FR-07, STO-FR-09 · D06

## Success criteria

- SC1: The collision file is byte-identical after S2 and 0 files are overwritten.
- SC2: Exactly 48 files move in S4, each with its original basename and P3 hash (S5).
- SC3: Sessions stay at exactly 7 light sessions, and View membership stays 208 / 17h 20m (S5, S6).
- SC4: After S6, 100% of 24 Sep sources remain at their original paths.

## Known gaps

- G1: Not validated — the rebuilt application does not exist. Product behavior follows the specs and the defaults that the authorized autonomous run set in decisions D06, D09, and D14; no implementation has been validated against them.
- G2: Unresolved implementation qualification — the relative layout under the destination (folder structure beyond retained basenames, D14) is not fixed; S1 and S2 rely on the preview rather than a predicted path. Retrying the S6 filing is not exercised. Blocks readiness.

## Delta log

- No entries (initial draft, version 1).
