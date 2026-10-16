# Feature Specification: Results in Output/, Copy to Output and the master offer

**Feature Branch**: `063-clean-rebuild-contract`

**Spec ID**: `070-results-reuse`

**Created**: 2026-10-03

**Amended**: 2026-10-14, to the F4 Project model, D-W93 to D-W106.

**Status**: Draft; product defaults and all human-approval gate waivers follow the root autonomous objective. Requirements analysis, implementation and verification remain required.

**Input**: Clean rebuild with selective reuse of verified code and the agreed PlateVault product flow.

## User Scenarios & Testing

### User Story 1 - Results in Output/, Copy to Output and the master offer (Priority: P1)

A Project's Results are the files in its `Output/` folder. The user saves finished images there from their tool, or uses Copy to Output on a file in `Processing/`, such as a WBPP master. Tools never write into `Output/`, so a rerun can't overwrite a Result, and no Result needs accepting. A mosaic keeps each panel's result in `Output/Panels/` and the finished mosaic in `Output/`. PlateVault records no lineage, and a Result is never an input to a Project. The Output step also offers once, for adoption, a generated master found in `Processing/` (D-W93, D-W98).

**Why this priority**: This feature owns the workflow steps listed below without imposing unrelated product features.

**Independent Test**: Exercise the acceptance scenarios through the running product with isolated inputs. Existing baseline code does not prove the redesigned behavior.

**Acceptance Scenarios**:

- **RES-AC-01**: Given the Project's `Output/` holds a final image and a file still being written, when the Output step opens, then both are listed, the final image as a Result with no Accept action, and the growing file reads "Still being written". (D-W85, D-W98)
- **RES-AC-02**: Given a WBPP master light in `Processing/WBPP/master/`, when the user chooses Copy to Output… and picks it, then a verified copy lands in `Output/` and joins the table, and the file in `Processing/` is unchanged. (D-W98)
- **RES-AC-03**: Withdrawn (D-W93). There is no acceptance and no lineage to upgrade; RES-AC-28 covers a tool rerun that leaves `Output/` unchanged.
- **RES-AC-04**: Withdrawn (D-W93). A Result is never a Project input.
- **RES-AC-05**: Withdrawn (D-W93). There are no product inputs, so no profile needs product-input support.
- **RES-AC-06**: Given an empty `Output/`, when the user closes the Project, then it closes; no Result is required and no file is removed from `Output/`. (D-W97, D-W98)
- **RES-AC-07**: Given Apply running on the Project, when the user opens Wrap up, then it is refused and names the running Apply. This rule is provisional, like the Wrap up gate. Otherwise closing needs neither a Result nor evidence that an external job stopped. (D-W97, D-W100)
- **RES-AC-08**: Withdrawn (D-W94, D-W97). There is no Finished run to reopen, and a Closed Project has no Reopen (provisional).
- **RES-AC-09**: Withdrawn (D-W93, D-W98). No Result is accepted or reused, so no acceptance digest exists.
- **RES-AC-10**: Withdrawn (D-W98). A Result needs no acceptance.
- **RES-AC-11**: Given a mosaic Project with the panel groups Panel 1 to Panel 4. The user saves each panel's stack in its folder, `Output/Panels/Panel-1/` to `Output/Panels/Panel-4/`, and the assembled image in `Output/`. Then the Output step lists each panel's result under its panel and the assembled image as the mosaic. PlateVault infers no panel from a header or file name. (D-W95, D-W98)
- **RES-AC-12**: Given a mosaic Project with no assembled image, when the user closes it, then no mosaic Result is required or shown as missing. (D-W95)
- **RES-AC-13**: Withdrawn (D-W93). A Result is never an input to another Project.
- **RES-AC-14**: Withdrawn (D-W93). A Result is never an input, from any rig.
- **RES-AC-15**: Given the Project's `Processing/` gains a generated master dark, when the Output step opens, then the once-only Add to calibration library offer of CAL-FR-06 appears there. (D-W55, D-W98)
- **RES-AC-16**: Withdrawn (D-W94). There are no prepared revisions.
- **RES-AC-17**: Withdrawn (D-W72).
- **RES-AC-18**: Withdrawn (D-W72).
- **RES-AC-19**: Withdrawn (D-W94). There is no run to move to the Project's Trash.
- **RES-AC-20**: Withdrawn (D-W94).
- **RES-AC-21**: Withdrawn (D-W94).
- **RES-AC-22**: Withdrawn (D-W94).
- **RES-AC-23**: Given the user saves an image into `Output/` from their tool, then it appears in the table without a scan, with the State "Still being written" until it settles. Rescan is in the step's More menu. (D-W85, D-W98)
- **RES-AC-24**: Given three files in `Output/`, when the user changes one's Kind and Channel with their dropdowns, then the row keeps the new values, and nothing asks for acceptance. (D-W85, D-W98)
- **RES-AC-25**: Given the user chooses Copy to Output…, then the native file dialog opens in `Processing/` with image-file filters, and a file with the same name already in `Output/` is never overwritten. (D-W98)
- **RES-AC-26**: Reserved. It was drafted and withdrawn (D-W97) within PR #1804 and never reached main; Wrap up's Trash step offers the files in `Processing/` (PRJ-FR-15).
- **RES-AC-27**: Given the user keeps `final/` and `drafts/` subfolders inside `Output/`, then the table lists each file with its path relative to `Output/`, and PlateVault creates, renames and moves no folder inside it. (D-W85, D-W98)
- **RES-AC-28**: Given the user reruns WBPP and it overwrites `Processing/WBPP/master/`, then the copy in `Output/` is unchanged and the Output step lists the same Results. (D-W93, D-W98)

### Edge Cases

The [root contract](../063-clean-rebuild-contract/spec.md) governs file custody, uncertainty, exact membership, failed writes, and independent lifecycle decisions. Each acceptance scenario tests observable outcomes; no mock acknowledgment counts as terminal success.

- A file the user removes from `Output/` outside PlateVault leaves the table at the next watch event, and nothing keeps it as a Result. (D-W98)

## Requirements

### Functional Requirements

- **RES-FR-01**: The Output step lists the files in the Project's `Output/` folder in a table with the columns File, Kind, Channel and State, with availability where known. PlateVault watches the folder and adds files as they are written, with no manual scan; Rescan stays in the step's More menu. A file still being written reads "Still being written" in its State. The user keeps any layout inside `Output/`: PlateVault prescribes only `Output/Panels/` in a mosaic (RES-FR-08), watches every subfolder and records each file's path relative to the folder. Every file in `Output/` is a Result, with no acceptance step. Kind and Channel are dropdowns in each row: Kind (Final image, Linear integration, Channel product, Mosaic panel, Assembled mosaic, or another explicit kind) may be prefilled from evidence, and the user can change it. Files in `Output/` stay protected: Clean up and Trash never list them, and Close keeps them (RES-FR-06). (D-W85, D-W98)
- **RES-FR-02**: **Copy to Output…** is a visible toolbar action on the Output step. It picks a file through the native file dialog, opening in the Project's `Processing/` folder (provisional), and copies it into `Output/` with verified transfer (STO-FR-07): the copy is re-read and compared with the source's SHA-256 before it is listed. An existing file at the destination is never overwritten; the user picks another name. Tools never write into `Output/`, so a tool rerun that overwrites files in `Processing/` never changes a Result. (D-W93, D-W98)
- **RES-FR-03**: Withdrawn (D-W93). Result lineage and provenance are out of scope: PlateVault doesn't record which inputs produced which output.
- **RES-FR-04**: Withdrawn (D-W98). No Result needs accepting; every file in `Output/` is a Result.
- **RES-FR-05**: Withdrawn (D-W93). Results are never inputs to a Project, so there is no Results picker, no product input and no composition rule.
- **RES-FR-06**: Close project… keeps `Output/`. PlateVault never moves or deletes a file in it, and neither Clean up nor Trash lists it (PRJ-FR-14, STO-FR-01). Closing needs no Result and never infers that an external job stopped or succeeded. (D-W26, D-W97, D-W98)
- **RES-FR-07**: Provisional: one PlateVault operation runs per Project at a time (PREP-FR-19). Copy to Output and the master offer change no Project input, and a Closed Project's Output step is read-only. External launch or exit is never a completion or success signal. (D-W97, D-W100)
- **RES-FR-08**: In a mosaic, `Output/Panels/` holds a folder for each panel group for that panel's result, and the finished mosaic goes in `Output/` itself. Provisional: the folder takes the group's name under the folder-name rule of PRJ-FR-27, with no `PANEL_` token, so the group "Panel 1" gets `Output/Panels/Panel-1/`. A file belongs to the panel whose folder it was saved in; PlateVault infers no panel from a header or file name. The user assembles the mosaic in their tool; PlateVault assembles nothing, and a mosaic with no assembled image is not incomplete. (D-W95, D-W98, D-W114)
- **RES-FR-09**: Withdrawn (D-W72).
- **RES-FR-10**: Withdrawn (D-W94). There are no runs, so there is no Move run to Trash, Restore or Empty Trash.
- **RES-FR-11**: PlateVault watches the Project's `Processing/` folder for generated calibration masters and passes each one it newly finds to CAL, which offers it once on the Output step (CAL-FR-06, provisional). The Output step lists no other `Processing/` file, and a tool rerun may overwrite them (D-W93). (D-W98)

### Owned interaction steps

- H1
- H2
- H3
- H3a: Withdrawn (D-W93). Results are never inputs to a Project.
- I1
- Cross-flow: Closing with no Result
- Output step: Results, Copy to Output and the master offer
- Mosaic outputs in `Output/Panels/`

### Key Entities

Use the [root vocabulary](../063-clean-rebuild-contract/spec.md#key-entities). Feature-specific evidence and decisions retain their input identity, scope, and revision. This feature adds:

- **Result**: a file in the Project's `Output/` folder. It needs no acceptance, has no recorded lineage and is never an input. (D-W93, D-W98)
- **Output folder**: `<Project>/Output/`, which tools never write into and which Close keeps. (D-W98)

## Success Criteria

### Measurable Outcomes

- **PV-RES-SC-01**: Every acceptance scenario produces its stated outcome and refusal behavior.
- **PV-RES-SC-02**: Every owned interaction step has a requirement and independently observable acceptance evidence.
- **PV-RES-SC-03**: Original inputs remain unchanged except through separately reviewed and approved filesystem operations.
- **PV-RES-SC-04**: In the rerun fixture, a tool rerun that overwrites `Processing/` changes zero files in `Output/`. (D-W98)

## Assumptions

- [Product flow](../../docs/reviews/2026-10-03-product-flow-and-journeys.md) supplies the confirmed interactions and illustrative worked example.
- This feature is independently specified; dependencies on other feature contracts are resolved in planning.
- Conservative defaults and all human-approval gate waivers follow the root autonomous objective and decision register. Tests, requirements analysis, independent review and delivery evidence remain mandatory.

## Decisions before feature approval

- Root decision D04 defines qualified profile support. Closing without a Result remains supported and never infers external processing success; D09's reopening and revisions are withdrawn (D-W94, D-W97).
- Root decision D19 binds Copy to Output and the master offer to re-verified content.
- Workflow decisions D-W4, D-W56, D-W67 and D-W73 (the Results folder, attach, reuse as inputs and group Results) are superseded by D-W93, D-W94 and D-W98, and D-W72's run Trash is withdrawn with runs.
- Workflow decisions D-W76 and D-W81 renamed Complete to Finish run; with runs gone, Close project keeps `Output/` and Clean up removes the View (D-W97).
- Workflow decision D-W85 (Round 9, 2026-10-12) sets the table, the watcher with Rescan in More, and the Kind and Channel dropdowns, which the Output step keeps. Its Accept and Ignore, Attach…, Revision column, Finish run gate and reuse of accepted Results are superseded by D-W93 and D-W98.
- Workflow decisions D-W93 and D-W98 (the F4 Project model, owner, 2026-10-14) make `Output/` the Project's Results with Copy to Output, keep tools out of it, drop lineage, acceptance and outputs as inputs, and move the master offer to `Processing/`. Provisional: the master offer from `Processing/`, the Copy to Output dialog opening in `Processing/`, one PlateVault operation per Project (D-W100) and the name of each panel's folder in `Output/Panels/`.
