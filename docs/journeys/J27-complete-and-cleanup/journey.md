---
id: J27
title: Mark a processing attempt complete and clean up selected View files
version: 1
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [results, cleanup, storage, view-review]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 070-results-reuse, 071-storage-custody, D05, D09, D16, specs/063-clean-rebuild-contract/decisions.md, specs/070-results-reuse/spec.md, specs/071-storage-custody/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-i-completion-and-selectable-cleanup]
---

## Goal

The user records that a processing attempt is finished, independently of any
accepted Result, and then sends chosen regenerable files to the OS Trash while
originals, accepted products, masters, and unknown files stay protected. Done
means: both Views read Complete and nothing was removed by completing them; the
cleanup removes only the reviewed selection, to the OS Trash, without following
link targets; an entry that may hold the last copy of a capture is refused; and a
location without safe Trash refuses removal with no permanent-delete fallback.

## Preconditions

- P1: Fresh replay of J24 and J26 (J25 not run). Siril is not running. `output/` of `NGC7000-HOO-Siril` also holds one file PlateVault does not recognize.
- P2: `28 Sep Ha copy check` (J24/S16) is Prepared on `Scratch`, which has no OS Trash, and has no Result.
- P3: Before S1, one 30 Sep original capture that is a member of `NGC7000 HOO - Siril` is deleted outside PlateVault and the OS Trash is emptied, so its prepared hardlink holds the last copy of its bytes.
- P4: The OS Trash is otherwise empty. A manifest (path, size, SHA-256) of the accepted products, the adopted master and its generated source, and the remaining captures is recorded.
- P5: A second final image saved by the user outside the View, at `Work/Finals/NGC7000-HOO-crop.tif`.

## Steps

### S1 — Complete an attempt with no Result {#S1}

- **Do:** Open `28 Sep Ha copy check` and click **Mark processing complete**.
- **Expect:** The View reads Complete with no accepted Result, and **Clean up View** is offered as a separate action.
- **Expect (negative):** No file is removed and no cleanup starts.
- **Trace:** flow I1, cross-flow "Completion with no Result" · RES-FR-06 · RES-AC-06 · root SC-006

### S2 — Complete the main attempt {#S2}

- **Do:** Open `NGC7000 HOO - Siril` and click **Mark processing complete**.
- **Expect:** The View reads Complete; its accepted Results are unchanged.
- **Expect (negative):** Completion removes nothing and does not claim that Siril processing stopped or succeeded.
- **Trace:** flow I1 · RES-FR-06 · D09

### S3 — Edit a Complete View {#S3}

- **Do:** In `NGC7000 HOO - Siril`, try **Exclude from View** on an included frame. Then edit the View's notes, and attach `Work/Finals/NGC7000-HOO-crop.tif` as a Final image and accept it.
- **Expect:** The exclusion is refused until **Reopen** is chosen explicitly, because it would create a new membership revision. The notes edit and the Result acceptance are accepted, the crop reads User-linked, and the View stays Complete.
- **Expect (negative):** No membership or preparation revision takes effect while the View reads Complete; editing notes and accepting a Result neither reopen it nor change its fixed membership.
- **Trace:** D09

### S4 — Open cleanup {#S4}

- **Do:** Click **Clean up View**.
- **Expect:** Groups show counts, sizes, a proposed action, and **Inspect files**. Calibrated intermediates, registered intermediates, other recognized intermediates, and temporary files and caches are preselected. Prepared input links, verified duplicate candidates, the log, the manifest, and the unknown file are unselected. The accepted Ha and OIII stacks and the generated master source sit in a separate **Keep** group.
- **Expect (negative):** No original capture is listed as a candidate, and the default selection does not cover the whole View directory.
- **Trace:** flow I2 · STO-FR-01, STO-FR-03 · STO-AC-01 · D05, D16

### S5 — Inspect and choose files {#S5}

- **Do:** Expand **Registered intermediates** and deselect one file. Select **Prepared inputs**. Leave the unknown file unselected.
- **Expect:** Each file shows its path, role, other View or Project references, retained-original evidence, and estimated bytes. Link sizes are not presented as guaranteed reclaimed bytes.
- **Expect (negative):** Selecting the intermediate groups leaves the Keep group unselected.
- **Trace:** flow I3 · STO-FR-02, STO-FR-03

### S6 — See what a protected product affects {#S6}

- **Do:** Select the accepted OIII stack in Keep and read the review, then deselect it.
- **Expect:** The review names the product and its dependent View `NGC7000 HOO combine`.
- **Expect (negative):** Nothing is removed.
- **Trace:** flow I2 · STO-FR-01

### S7 — Review cleanup {#S7}

- **Do:** Click **Review cleanup**.
- **Expect:** The review lists exactly the selected and retained entries; the default action is **Send to OS Trash**. Trash support for `Work` shows movable and blocked counts. The P3 hardlink entry is blocked for insufficient retained-original proof; the other 207 prepared entries show a verified retained original.
- **Expect (negative):** No entry with stale identity, missing retained-copy proof, an unavailable source, or ambiguous ownership is approved.
- **Trace:** flow I4 · STO-FR-04 · STO-AC-04

### S8 — Send the selected files to Trash {#S8}

- **Do:** Confirm **Send selected files to Trash**.
- **Expect:** Progress shows per-item outcomes and a partial summary naming the blocked entry. The View records which prepared inputs and products were removed and which remain. The removed entries appear in the OS Trash. The View still reads Complete.
- **Expect (negative):** Link targets are not followed: the remaining captures, accepted products, master and its source, and the unknown file match P4. The deselected registered intermediate and the P3 hardlink entry remain. Reviewed cleanup neither reopens the View nor changes its fixed membership.
- **Trace:** flow I5 · STO-FR-05 · root SC-006 · D09

### S9 — Restore from the OS Trash {#S9}

- **Do:** In the OS Trash, put back one removed intermediate.
- **Expect:** The file returns to its View path. PlateVault states that restoration cannot be guaranteed after the Trash is emptied.
- **Trace:** flow I5 recovery

### S10 — Meet a location without safe Trash {#S10}

- **Do:** In `28 Sep Ha copy check`, open **Clean up View**, select **Prepared inputs**, review, and confirm **Send selected files to Trash**.
- **Expect:** Trash support reads unsupported for `Scratch`, the affected copies are refused, and **Keep files** and **Reveal location** are offered.
- **Expect (negative):** No permanent-delete fallback is offered and no copy is removed.
- **Trace:** flow I4, I5, cross-flow "Cleanup/Trash failure" · STO-FR-04, STO-FR-05 · STO-AC-03 · root FR-010

## Success criteria

- SC1: Completing either View removes 0 files and starts 0 cleanups (S1, S2).
- SC2: The default preselection contains only recognized intermediates and temporary files; Keep and the unknown file are unselected (S4, S5).
- SC3: Every removed entry is in the OS Trash; the P4 manifest still matches (S8).
- SC4: The last-copy hardlink is refused and remains (S7, S8).
- SC5: On `Scratch`, 0 files are removed and no permanent-delete action exists (S10).
- SC6: A Complete View refuses membership edits until Reopen, accepts a notes edit and a Result acceptance, and still reads Complete after reviewed cleanup (S3, S8).

## Known gaps

- G1: Not validated — the rebuilt application does not exist. Product behavior follows the specs and the defaults that the authorized autonomous run set in decisions D05, D09, and D16; no implementation has been validated against them.
- G2: Out of scope for this journey — Direct-source cleanup (only processing outputs attributed to the View are eligible; originals never are, STO-AC-02) needs a prepared Direct-source View that no journey prepares yet. Blocks readiness until covered.
- G3: Out of scope for this journey — removing replaced prepared entries after a refresh (D09) is not exercised. Blocks readiness until covered by a step or a journey.

## Delta log

- No entries (initial draft, version 1).
