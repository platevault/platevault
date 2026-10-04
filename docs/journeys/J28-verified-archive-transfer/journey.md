---
id: J28
title: Archive retained sessions with verified transfer and View reference repair
version: 1
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [archive, storage, view-review, preparation]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 071-storage-custody, D06, D09, D11, specs/063-clean-rebuild-contract/decisions.md, specs/071-storage-custody/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-j-verified-archive-transfer]
---

## Goal

The user moves a View's capture sessions to archive storage in one reviewed
transfer that also rebuilds the View's references, and can trust that no source
is retired before its destination copy and every affected reference are
verified. Done means: the five sessions live on `Archive` with verified hashes;
every source retired was retired only after destination and reference
verification, while it still matched its copied snapshot; an interrupted,
failing or drifted item keeps its source and its recorded phase; and the View's
membership and exclusions are unchanged, with archived inputs reading Offline
when `Archive` is unplugged.

## Preconditions

- P1: Fresh replay of J24 and J26 (J25 and J27 not run). `NGC7000 HOO - Siril` is Prepared with 208 hardlink entries under `Work/Processing/NGC7000-HOO-Siril` on `Astro-T7`, and has been marked Complete as in J27/S2. Siril is not running.
- P2: A disposable writable volume `Archive` with free space for the five sessions, and a second disposable volume that can be mounted under the same name `Archive`.
- P3: The J19/P5 manifest and a SHA-256 list of the five sessions' files are recorded. `Cold-1` stays offline.
- P4: Write permission is removed from the View folder that holds the prepared entries of one named 24 Sep frame, so that its reference cannot be rebuilt (fault fixture for S8; G3).
- P5: For one named 26 Sep frame, a backup of its original bytes and nanosecond mtime and a replacement file of identical size with different bytes, kept outside PlateVault. A fault control pauses that item after destination verification and before source retirement (G5).

## Steps

### S1 — Start an archive {#S1}

- **Do:** In Storage, select the five member sessions of `NGC7000 HOO - Siril`, click **Archive**, and choose `Archive/NGC7000` as destination.
- **Expect:** The plan shows destination paths, bytes, source identities, affected Views, and proposed reference updates.
- **Expect (negative):** Session membership and View exclusions read fixed by the plan.
- **Trace:** flow J · STO-FR-06

### S2 — Meet an impostor destination {#S2}

- **Do:** Unmount `Archive` and mount the second P2 volume under the same name, then return to the plan.
- **Expect:** The plan states that the volume at that path is a different volume than the intended destination and blocks approval.
- **Trace:** flow J · STO-FR-06 · D06, D11

### S3 — Check the real destination {#S3}

- **Do:** Unmount the impostor and remount the original `Archive`.
- **Expect:** The plan shows the intended volume identity matching, its free space, and that it is writable.
- **Trace:** flow J · STO-FR-06

### S4 — Choose how references are rebuilt {#S4}

- **Do:** Open the `NGC7000 HOO - Siril` reference entry in the plan and choose a supported reference mode (symlink to the archived file).
- **Expect:** It shows the current mode (hardlink) and that a hardlink cannot be rebuilt across volumes; the choices are a supported reference mode or retaining the local copy with its unreclaimed bytes. After the choice the plan reads symlink.
- **Expect (negative):** No mode was chosen implicitly before the user's choice.
- **Trace:** flow J · STO-FR-06

### S5 — Review and approve the transfer {#S5}

- **Do:** Click **Review transfer**, inspect source and destination paths and the rebuilt-reference effects, and approve.
- **Expect:** The transfer runs with per-item phases: copied, durably written, destination hash verified against the source snapshot, reference rebuilt, source retired. Expected and observed reclaimed bytes are reported separately.
- **Trace:** flow J · STO-FR-07 · D06

### S6 — Interrupt the transfer {#S6}

- **Do:** Unplug `Archive` while items are still being copied.
- **Expect:** The transfer stops and shows, per item, destination-verified, source-retained, reference-updated, and pending work, with **Retry**.
- **Expect (negative):** No item whose destination or references are unverified has its source retired; those sources still match P3.
- **Trace:** flow J recovery branch, cross-flow "Archive interruption" · STO-FR-08 · STO-AC-05 · D06

### S7 — Retry after reconnecting {#S7}

- **Do:** Reconnect `Archive` and click **Retry**.
- **Expect:** Retry revalidates the destination volume identity and the recorded item identities, then resumes the recorded work. Items already verified keep their recorded phases.
- **Expect (negative):** A partially written destination file is not treated as verified because its name exists.
- **Trace:** flow J recovery branch · STO-FR-08 · D06, D09

### S7a — Change a source before retirement {#S7a}

- **Do:** When the P5 pause reports the named 26 Sep frame destination-verified and awaiting retirement, overwrite its source with the P5 replacement, restore its recorded mtime, and release the pause.
- **Expect:** That item reads blocked with source drift named. Its source path keeps the replacement bytes, `Archive/NGC7000` keeps the verified snapshot, and both are listed for review. Other items keep their recorded phases.
- **Expect (negative):** Neither version is retired, overwritten or chosen automatically.
- **Trace:** flow J recovery branch · STO-FR-07 · STO-AC-14 · D06

### S8 — Inspect a failed reference rebuild {#S8}

- **Do:** When the transfer settles, open the per-item outcomes and the 24 Sep frame of P4.
- **Expect:** Each affected reference reports completed, blocked, or uncertain. The P4 frame's reference reads blocked and its source is retained; the S7a item still reads blocked by drift; every other item reads source retired only after its destination and references verified. The View reads 208 lights / 17h 20m with the same six exclusions and still reads Complete.
- **Expect (negative):** The blocked item's source is not retired. The identity-preserving reference repair does not reopen the View or create a membership or preparation revision, and no hardlink is converted without the S4 choice.
- **Trace:** flow J open sequencing detail · STO-FR-07 · root SC-007 · D06, D09

### S9 — Repair the blocked reference {#S9}

- **Do:** Restore write permission on the P4 folder and click **Retry** for the blocked item.
- **Expect:** Its reference rebuilds and verifies; only then its source is retired.
- **Trace:** flow J · STO-FR-07 · D06

### S9a — Resolve the drifted item {#S9a}

- **Do:** Restore the P5 frame's original bytes and recorded mtime, review the item's current evidence, and click **Retry** for it.
- **Expect:** The current source matches its snapshot again, the destination and its references re-verify, and only then is the source retired.
- **Expect (negative):** The archived copy still matches P3, and no other item changes phase.
- **Trace:** flow J · STO-FR-07 · STO-AC-14 · D06

### S10 — Unplug the archive later {#S10}

- **Do:** Unplug `Archive`. Open NGC 7000, then `NGC7000 HOO - Siril`, and click **Open in Siril**.
- **Expect:** Captured and usable totals and View membership are unchanged, and the archived inputs read Offline. Opening is refused because inputs are unavailable, with the options to reconnect the archive or review another verified location.
- **Expect (negative):** Unavailable inputs are not omitted from the handoff.
- **Trace:** flow J · STO-FR-08 · STO-AC-05

## Success criteria

- SC1: 0 sources are retired before their destination hash and all affected references verify (S6, S8, S9).
- SC2: After S6, 100% of unretired sources match P3.
- SC3: The View reads 208 / 17h 20m with 6 exclusions and stays Complete before and after the transfer (S1, S8, S10).
- SC4: 0 implicit reference-mode conversions occur (S4, S8).
- SC5: The impostor volume blocks approval (S2).
- SC6: With `Archive` unplugged, Open is refused and 0 inputs are omitted (S10).
- SC7: The drifted source is retired 0 times while it differs from its snapshot (S7a, S8); it retires only after re-verification (S9a).

## Known gaps

- G1: Not validated — the rebuilt application does not exist. Product behavior follows the specs and the defaults that the authorized autonomous run set in decisions D06, D09, and D11; no implementation has been validated against them.
- G2: Unresolved implementation qualification — no fault fixture yet produces a destination hash mismatch; the hash-failure branch is not exercised. Blocks readiness.
- G3: Unresolved implementation qualification — the prepared View layout that P4 depends on is unspecified, and the method of source retirement after verification is not named by the flow. Blocks readiness.
- G4: Out of scope for this journey — Direct-source configuration paths affected by a move are not exercised because no journey prepares a Direct-source View. Blocks readiness until covered by a step or a journey.
- G5: Unresolved implementation qualification: no fault control yet pauses an item after destination verification and before retirement (P5). S7a depends on it, and no source-retirement acceptance is complete until S7a passes. Blocks readiness.

## Delta log

- No entries (initial draft, version 1).
