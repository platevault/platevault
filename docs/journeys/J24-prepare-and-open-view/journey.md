---
id: J24
title: Prepare a verified View input layout and open the application
version: 1
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [preparation, view-review]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 069-application-handoff, D02, D04, D09, D13, D15, specs/063-clean-rebuild-contract/decisions.md, specs/069-application-handoff/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-f-prepare-and-open-the-view]
---

## Goal

The user turns the reviewed selection into one verified input layout with its own
output location and opens the application, without any selected input being
omitted, any unrelated folder being reused, or any original being changed.
Done means `Work/Processing/NGC7000-HOO-Siril` reads Prepared only after its
208 entries match confirmed membership. Siril opens on that preparation;
quitting Siril leaves the View not Complete. Partial preparation names blocked
inputs and offers no verified Open. Retry completes only recorded items.

## Preconditions

- P1: J23 completed.
- P2: The Siril profile's capability evidence (J23/S8) records exact file-list input and that Siril does not write into its input files. If that evidence is unknown or write-prone, Linked View and Direct source are blocked (D04) and S1–S3 change accordingly (G2).
- P3: Folders `Processing/` and `Outputs/` exist on the `Astro-T7` volume (shown below as `Work/Processing` and `Work/Outputs`), writable, with free space for a full copy of the 28 Sep session.
- P4: A network share `Scratch` is mounted with `Processing/` writable; the share supports neither links nor OS Trash (macOS deletes immediately there). `Scratch/Processing/NGC7000-HOO-Siril/keep.txt` exists with unrelated content and a recorded SHA-256.
- P5: No View has been prepared in this catalog, so no last-used parent exists.
- P6: The J19/P5 manifest is available.

## Steps

### S1 — Read the input modes {#S1}

- **Do:** In `NGC7000 HOO - Siril`, open the input-mode choice.
- **Expect:** **Linked View** is suggested; **Direct source**, **Copy**, and supported **Clone** are alternatives. Each names its semantics and required storage, and the suggested link type and its limitations are shown.
- **Trace:** flow F1 · PREP-FR-04 · D04

### S2 — Try Direct source {#S2}

- **Do:** Select **Direct source** and read its handoff.
- **Expect:** The profile hands Siril the exact original paths of the 208 included frames through a file list or configuration, with no links or copies. If the profile can only hand off whole folders, the handoff is refused because the 30 Sep folder also contains six excluded frames, and supported alternatives are shown.
- **Expect (negative):** No overinclusive folder handoff is accepted.
- **Trace:** flow F1 direct-source branch, cross-flow "Direct-source exclusion unsupported by tool" · PREP-FR-05 · PREP-AC-04 · root FR-005 · D04

### S3 — Return to Linked View and choose hardlinks {#S3}

- **Do:** Select **Linked View**, change the link type from symlink to hardlink, and confirm.
- **Expect:** The confirmation names the hardlink limitations: same-volume eligibility, permission and filesystem checks, and that an application writing into a linked input would alter the source.
- **Expect (negative):** The link type does not change without that explicit confirmation.
- **Trace:** flow F1 · PREP-FR-04

### S4 — Choose a colliding location {#S4}

- **Do:** Click **Choose location...**. Choose `Scratch/Processing` and enter `NGC7000-HOO-Siril`.
- **Expect:** No parent was preselected. The review states that the folder already exists with unrelated content and asks for another name or location.
- **Expect (negative):** `keep.txt` and the existing folder are unchanged (SHA-256 matches P4).
- **Trace:** flow F2, cross-flow "Destination collision" · PREP-FR-06 · PREP-AC-02 · root FR-004

### S5 — Lose the chosen parent {#S5}

- **Do:** Unmount `Scratch`, then continue.
- **Expect:** The review states that the chosen parent is unavailable and prompts for another choice.
- **Expect (negative):** No other drive is selected silently.
- **Trace:** flow F2 failure branch · PREP-FR-06

### S6 — Choose the View location {#S6}

- **Do:** Click **Choose location...**, choose `Work/Processing`, and confirm the name `NGC7000-HOO-Siril`.
- **Expect:** The review shows `Work/Processing/NGC7000-HOO-Siril`.
- **Trace:** flow F2 · PREP-FR-06

### S7 — Keep the default output location {#S7}

- **Do:** Read the output location and keep it.
- **Expect:** It reads `Work/Processing/NGC7000-HOO-Siril/output/` and is recorded on the View for result discovery and cleanup.
- **Trace:** flow F3 · PREP-FR-07

### S8 — Review preparation and confirm membership {#S8}

- **Do:** Click **Review preparation**, read it, and confirm the exact membership and the saved selection criteria.
- **Expect:** The review shows the selection (208 lights, five sessions), profile Siril, source references, the accepted calibration, the 24 Sep exception with its reason, excluded count 6, the View and output paths, mode Linked View (hardlink), operation count, expected footprint, and available space. Saved selection criteria are shown apart from browsing filters. Source presence, destination collisions, permissions, and hardlink eligibility read checked.
- **Expect (negative):** Nothing is created under `Work/Processing` before S9. Unknown or omitted inputs are not counted as prepared. No calibration suggestion that was never accepted is handed off.
- **Trace:** flow F4 · PREP-FR-08 · PREP-AC-01 · D02, D13

### S9 — Prepare the View {#S9}

- **Do:** Click **Prepare View**.
- **Expect:** The operation reads Running with progress and ends Prepared only after the 208 prepared entries match the confirmed membership. **Open in Siril**, **Reveal View**, and preparation details appear.
- **Expect (negative):** The start acknowledgment does not read as success. The manifest still equals P6; no library quality state changes.
- **Trace:** flow F5 · PREP-FR-09, PREP-FR-10 · root SC-003 · VSEL-FR-11

### S10 — Open with a missing executable {#S10}

- **Do:** Move the Siril application out of its located path, then click **Open in Siril**.
- **Expect:** PlateVault offers **Choose application** and **Reveal View**.
- **Expect (negative):** The View stays Prepared with its decisions and entries unchanged.
- **Trace:** flow F6 failure branch · PREP-FR-10

### S11 — Open Siril {#S11}

- **Do:** Restore Siril to its path, click **Open in Siril**, inspect the prepared inputs in Siril, then quit Siril.
- **Expect:** Siril opens on the prepared View. PlateVault records the launch separately from processing completion.
- **Expect (negative):** Quitting Siril does not mark the View Complete.
- **Trace:** flow F6 · PREP-FR-10 · root edge "External application exit"

### S12 — Start a disposable check View {#S12}

- **Do:** From Sessions, create a standalone View `28 Sep Ha copy check` from the 28 Sep session, choose Siril, accept its calibration suggestions, and click **Save View**.
- **Expect:** The summary reads 56 frames / 4h 40m and no Project.
- **Trace:** flow B4, E1 · VSEL-FR-01 · D08, D13

### S13 — Meet a destination that cannot link {#S13}

- **Do:** Remount `Scratch`. Keep Linked View, choose `Scratch/Processing` as parent with name `28 Sep Ha copy check`, and click **Review preparation**.
- **Expect:** The review states that linking is unavailable at that destination and offers Clone, Copy, or Direct source, each with its footprint and consequences.
- **Expect (negative):** Nothing is written to `Scratch` until a mode is chosen; Linked View does not silently become a full copy.
- **Trace:** flow F4, cross-flow "Unsupported input mode" · PREP-FR-04, PREP-FR-08 · PREP-AC-03

### S14 — Choose patched copies and another output parent {#S14}

- **Do:** Choose **Copy** with isolated patched copies for the 28 Sep correction. Click **Change output location...** and choose `Work/Outputs`.
- **Expect:** The review shows a full-copy footprint, the patched effective focal length for every copy, and output location `Work/Outputs/28 Sep Ha copy check/`.
- **Expect (negative):** The output is not `Work/Outputs` itself.
- **Trace:** flow E4, F3 · PREP-FR-03, PREP-FR-07 · D15

### S15 — Prepare with blocked inputs {#S15}

- **Do:** Confirm membership in **Review preparation**. Then remove read permission from three 28 Sep source frames and click **Prepare View**. While it runs, click **Mark processing complete** in this View, then in the standalone 24 Sep View (J23/S7).
- **Expect:** In `28 Sep Ha copy check`, **Mark processing complete** is refused and names the running preparation of this View. The unrelated 24 Sep View is not blocked and reads Complete. The outcome reads Partial with 53 prepared and 3 blocked entries, each blocked entry named with its path. The choices are **Retry** for the journaled blocked entries, **Review preparation again**, and keeping the partial View unchanged.
- **Expect (negative):** No verified Open is offered. The three sources are untouched. `28 Sep Ha copy check` does not read Complete.
- **Trace:** flow F5 failure branch, cross-flow "Partial preparation" · PREP-FR-09 · PREP-AC-05 · root FR-004 · D09

### S16 — Retry and verify custody {#S16}

- **Do:** Restore read permission on the three frames and choose **Retry**. Then compare a prepared copy's header with its original and recompute the manifest.
- **Expect:** Retry prepares the three journaled entries and the View reads Prepared with 56 entries matching its membership. The prepared copy carries the patched focal length.
- **Expect (negative):** The original is byte-identical and the manifest equals P6. Retry does not infer completion from filenames already present.
- **Trace:** flow F5 · PREP-FR-03, PREP-FR-09 · PREP-AC-06 · D09, D15

## Success criteria

- SC1: Prepared appears only when all 208 entries match the confirmed membership (S9); every Prepare ends in exactly one of Prepared, Partial, Failed, Canceled, or Paused.
- SC2: `keep.txt` and its folder are unchanged (S4); no drive is substituted silently (S5).
- SC3: The capture and calibration manifest equals P6 after S9 and S16; Prepare changes 0 quality states.
- SC4: The partial outcome reports exactly 53 prepared and 3 blocked, with no verified Open (S15); after Retry it reads 56 Prepared (S16).
- SC5: When linking is unsupported, the review offers alternatives and 0 files reach `Scratch` before a choice (S13).
- SC6: Launching Siril and quitting it leave the View not Complete; a missing executable leaves it Prepared (S10, S11).
- SC7: Only copies carry the patched value (S16).

## Known gaps

- G1: Not validated — the rebuilt application does not exist. Product behavior follows the specs and the defaults that the authorized autonomous run set in decisions D02, D04, D09, D13, and D15; no implementation has been validated against them.
- G2: Unresolved implementation qualification — Siril's exact handoff, folder-versus-list input, and input-write behavior (P2) need a profile capability probe (D04); S2's branch and S3 depend on it. Blocks readiness.
- G3: Unresolved — whether a View supports mixed per-item input modes is not settled by D01–D18; per-item mode changes are not exercised. Blocks readiness.
- G4: Unresolved implementation qualification — which preparation phases offer Cancel or Pause "where safe" is unspecified; Canceled and Paused outcomes are not exercised. Blocks readiness.

## Delta log

- No entries (initial draft, version 1).
