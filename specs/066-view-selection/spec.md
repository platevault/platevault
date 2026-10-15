# Feature Specification: Project inputs: adding sessions, exclusions, pending changes and the Apply sheet

**Feature Branch**: `063-clean-rebuild-contract`

**Spec ID**: `066-view-selection`

**Created**: 2026-10-03

**Amended**: 2026-10-06, to the settled workflow decisions D-W1 to D-W71, on 2026-10-07 to the answers D-W72 to D-W74, on 2026-10-08 to the decision D-W75, and on 2026-10-14 to the F4 Project model, D-W93 to D-W106.

**Status**: Draft; product defaults and all human-approval gate waivers follow the root autonomous objective. Requirements analysis, implementation and verification remain required.

**Input**: Clean rebuild with selective reuse of verified code and the agreed PlateVault product flow.

## User Scenarios & Testing

### User Story 1 - Project inputs: adding sessions, exclusions, pending changes and the Apply sheet (Priority: P1)

The user adds Ready sessions whose calibration is settled to a Project, excludes frames where needed, and reviews every change in the Apply sheet before the View changes. Exclusions are local to the Project, and the Project never changes library quality. Once the View exists, every change is pending until Apply, and the sheet shows exactly what Apply will do.

**Why this priority**: This feature owns the workflow steps listed below without imposing unrelated product features.

**Independent Test**: Exercise the acceptance scenarios through the running product with isolated inputs. Existing baseline code does not prove the redesigned behavior.

**Acceptance Scenarios**:

- **VSEL-AC-01**: Given Project NGC 7000 HOO with subject NGC 7000 and rig RedCat/ASI2600MM. Ready, settled NGC 7000 sessions exist on RedCat and on Esprit/ASI533MC, one RedCat session carries a different OBJECT, and one more RedCat session has no confirmed Target. When the user opens Add sessions…, then the RedCat NGC 7000 sessions are listed first as suggestions, including the one with the different OBJECT, and the Esprit sessions follow. The session with no Target is not offered. (D-W33, D-W37, D-W96)
- **VSEL-AC-02**: Given a suggested session with no pointing evidence, then it shows Position unknown and no distance value (not 0). It can still be added, it sorts after sessions with geometry evidence, and once added it joins its rig's group flagged "Framing unknown". (D-W33, D-W95)
- **VSEL-AC-03**: Given five selected sessions (2 Ha, 3 OIII), when the user filters to Ha and then sorts and pages, then 'Selected outside current filters: 3' shows, all five stay selected, and Show selected lists five.
- **VSEL-AC-04**: Given the worked five sessions in a Project and the 30 Sep OIII session with 48 frames, when the user excludes six frames from the Project, then OIII reads 97 / 8h05m and the total 208 / 17h20m. The files remain, and the Target's usable total and other Projects stay the same. (D-W94)
- **VSEL-AC-05**: Withdrawn (D-W78). A Project makes no quality decision; LIB-AC-22 covers a review change on a Project's sessions.
- **VSEL-AC-06**: Given a Project whose View exists, when a new matching session is indexed and its calibration settled, then the Project shows it as a suggestion. Adding it creates a pending change, and the View is unchanged until Apply. An offline session stays in the Project and reads Unavailable, and explicit exclusions persist. (D-W96, D-W100)
- **VSEL-AC-07**: Withdrawn (D-W1, D-W8). Every input belongs to a Project; VSEL-AC-16 covers adding sessions from a Target or from selected Sessions.
- **VSEL-AC-08**: Given sessions are listed in Add sessions…, when they are checked, then session identities, source headers and Target associations remain unchanged. Each suggestion's reason names the confirmed Target and rig that match, never an OBJECT-only match. (D-W33, D-W96)
- **VSEL-AC-09**: Given an unreadable or offline source in the Project, when the Apply sheet opens, then the source is named unresolved, not an empty session. Reconnect, locate or explicit removal are offered, and Apply cannot omit it silently. (D-W100)
- **VSEL-AC-10**: Given a Project with a View, when its subjects, rigs or goals or any library quality decision change, then its sessions and View stay unchanged, and a quality change shows as a pending removal labelled with its source. (D-W94, D-W100)
- **VSEL-AC-11**: Withdrawn (D-W79). There is no Project-scoped reject, and the Project offers no quality action.
- **VSEL-AC-12**: Given an external application reading the View, when the user adds a session, then the View is unchanged until Apply. Apply then builds a new View and keeps the old one as `View (previous)/` (PREP-FR-06). (D-W93, D-W100)
- **VSEL-AC-13**: Given a selected Ready session with Usable and library-Unusable frames plus an unavailable frame, when it is added, then the Usable frames are included, library-Unusable frames start visibly excluded, and the unavailable frame remains named unresolved. Explicit inclusion changes only the Project's inputs, and the Apply sheet confirms them. (D-W78, D-W100)
- **VSEL-AC-14**: Withdrawn (D-W1, D-W33). Every input starts inside a Project, and Add sessions… lists the suggestions first, as VSEL-AC-01 states.
- **VSEL-AC-15**: Given a session whose frames also have byte-identical copies in a second registered Captures location, when the user adds it and applies, then each frame enters the View once. Each frame names its other physical copy, and the summary counts each frame once.
- **VSEL-AC-16**: Given selected Sessions in no Project, when the user chooses Add to Project, then PlateVault asks for a Project, new or existing, and adds the sessions only once that Project exists. Nothing is processed outside a Project. (D-W1, D-W94)
- **VSEL-AC-17**: Given Project Cygnus 2026 with subjects NGC 7000 and IC 1396, when the user adds sessions of both, then each subject's sessions sit in their own framing groups and count toward that subject's goals. (D-W9, D-W95)
- **VSEL-AC-18**: Given a Project on rig RedCat, when the user adds an Esprit session, then a visible note says Esprit is added to the Project's rigs, and the session joins a group of its own, so no group mixes rigs. (D-W59, D-W95)
- **VSEL-AC-19**: Given sessions S1 and S2 that Projects P and Q both hold, when the user removes S1 from P, then S1 stays in Q, and P's removal is pending until Apply. (D-W94, D-W96)
- **VSEL-AC-20**: Given a Closed Project, when a new matching session appears, then the Closed Project shows no suggestion and takes no pending change; Duplicate… is the way to add it. (D-W97)
- **VSEL-AC-21**: Withdrawn (D-W94). There are no mosaic run groups; VSEL-AC-30 covers what the Apply sheet lists.
- **VSEL-AC-22**: Withdrawn (D-W94). There is no setup shared across panel runs; VSEL-AC-31 covers Apply with an offline original.
- **VSEL-AC-23**: Withdrawn (D-W78). Projects have no Review step; frames are reviewed in session intake (LIB-FR-20).
- **VSEL-AC-24**: Given a session the Project holds whose Target is later re-confirmed as another Target, when the Sessions step opens, then the session is still in the Project with its new Target shown, and nothing is removed without the user. (D-W94)
- **VSEL-AC-25**: Given a frame of a Closed Project's session later goes to the OS Trash from another Project's Wrap up, when the Closed Project opens, then its sessions still list that frame, marked "Trashed". The frame appears in no suggestion list or open Project total. (D-W52, D-W97)
- **VSEL-AC-26**: Withdrawn (D-W72).
- **VSEL-AC-27**: Withdrawn (D-W94, D-W100). There is no run Refresh; VSEL-AC-32 covers the files PlateVault didn't place.
- **VSEL-AC-28**: Given a Copies View in which a tool rewrote one copy's header, when the Apply sheet opens, then it lists that copy as differing from what PlateVault placed. The new View gets a fresh copy from the original, and the changed one stays in `View (previous)/`. (D-W100)
- **VSEL-AC-29**: Given an open Apply sheet, when a Library rejection reaches the Project, then choosing Apply is refused and the sheet refreshes with the new removal listed. This refusal is provisional. (D-W100)
- **VSEL-AC-30**: Given a Project whose View exists, with two sessions added, one moved from group RedCat to "RedCat · Framing 2", a flat reassignment on one session and a switch from Symlinks to Copies. When the user chooses Apply…, then the sheet lists the frames added, the move with its from and to groups, the calibration change labelled with its source, and the mode switch. It shows the new View as a folder tree, "re-add View in your tool" for the new group level, and the space needed for two full Views. (D-W99, D-W100)
- **VSEL-AC-31**: Given one original of an added session is on an offline location, when the user chooses Apply…, then the sheet lists that original as offline and Apply is disabled. Nothing in the View or in `View (previous)/` changes. (D-W100)
- **VSEL-AC-32**: Given a View that holds a DSS `.Info.txt` beside each light and a note the user saved there, when the Apply sheet opens, then each file is listed with a tick box. After Apply only the ticked files are in the new View, and the unticked ones stay in `View (previous)/`. (D-W100)

### Edge Cases

The [root contract](../063-clean-rebuild-contract/spec.md) governs file custody, uncertainty, exact membership, failed writes, and independent lifecycle decisions. Each acceptance scenario tests observable outcomes; no mock acknowledgment counts as terminal success.

- A session the Project holds stays when its Target or rig association changes, and it still counts "in project" and "captured". (D-W94, D-W96)
- A Trashed record never appears in Add sessions…, the suggestions or a Project's totals. A frame trashed while a Closed Project held it still shows there, marked "Trashed". (D-W43, D-W52, D-W97)

## Requirements

### Functional Requirements

- **VSEL-FR-01**: Every processing input lives in a Project. A session joins only when the user adds it (PRJ-FR-08), and several Projects may hold the same session. Outputs are never inputs. (D-W1, D-W93, D-W94)
- **VSEL-FR-02**: The Project's Sessions step lists its groups with their sessions and frame counts, its suggestions (PRJ-FR-09) and its pending changes (VSEL-FR-12). There is no run pipeline; PRJ-FR-07 owns the Project page steps. This feature owns adding sessions, exclusions, pending changes and the Apply sheet. (D-W94)
- **VSEL-FR-03**: Add sessions… opens a picker over Ready sessions, with the Project's suggestions first, each with the reason it matches, `Target <subject> on <rig>`. A session whose calibration isn't settled shows "Choose its flats first" (or its darks or bias) and can't be selected. A session of another rig or Target can be added explicitly, and adding it adds its rig or Target to the Project with a visible note (PRJ-FR-02). Sessions with no confirmed Target, sessions that still need review and Trashed records stay out of it; when matching sessions still need review or calibration, the picker links to Sessions filtered to Needs review or Needs calibration. An OBJECT label never vetoes a session and never assigns a Target. Footprint and pointing evidence, where present, order the list by overlap and then angular separation. Each row shows session, date/time, channel, exposure, frames, integration, availability, distance, footprint evidence and the group it would join. (D-W33, D-W59, D-W78, D-W95, D-W96, D-W105)
- **VSEL-FR-04**: Missing geometry: FOV from confirmed equipment (image dimensions, effective focal length, pixel scale, binning) is shown with its provenance. A footprint also needs pointing and orientation evidence. Otherwise the session shows FOV unknown or Position unknown and sorts after sessions with evidence. Missing geometry never removes a session; once added, it joins its rig's group flagged "Framing unknown" (PRJ-FR-31). OBJECT never stands in for coordinates, and unknown geometry is never shown as zero distance. (D-W33, D-W95)
- **VSEL-FR-05**: Filters: date/time, night, channel, exposure range, quality state, calibration state, location, availability, and OBJECT text (including Missing OBJECT). Expanded filters: gain, offset, binning, temperature, rig and group. Active filters show as chips with a match count. Columns sort by value; sky-distance and overlap sorting appear when evidence exists. Rows show counts per quality state; measurement columns show 'Not measured' where no value exists. (D-W95, D-W96)
- **VSEL-FR-06**: Select with checkboxes or Select matching. Filters change the session list, not the selected IDs. Show 'Selected outside current filters: N', Show selected, and an explicit Clear selection. Sorting, paging, and the sky toggle keep the selection. Each selection shows its reason.
- **VSEL-FR-07**: Linked sky-coverage toggle: the table stays primary, and highlighting links footprints and rows both ways. In a mosaic, the toggle draws each panel group's outline from its sessions' footprints, which is the panel map of PRJ-FR-29. PlateVault does no stitching. (D-W95)
- **VSEL-FR-08**: The summary shows included frames and integration by channel, per group and for the Project, names unresolved inputs, and keeps Unreviewed and library-Unusable counts visible. Each LIB logical capture enters the Project and its totals once and names its other physical copies. (D-W95)
- **VSEL-FR-09**: Offline, missing, unreadable, and retired inputs are flagged. Last-observed counts are never treated as verified counts. Options: reconnect (not for retired inputs), locate a copy, or remove explicitly. Apply never silently omits an input.
- **VSEL-FR-10**: Exclude from Project is the default exclusion scope, and excluded rows can be shown or restored. Files stay on disk; other Projects and library state are unchanged. Once the View exists, an exclusion is a pending change. (D-W94, D-W100)
- **VSEL-FR-11**: Withdrawn (D-W78, D-W79). Quality is library-wide, and frames are marked in session intake (LIB-FR-20, PIX-FR-14). The Project offers no quality action, and saving or applying never changes quality state.
- **VSEL-FR-12**: Once the View exists, every change to the Project's inputs is pending until the user chooses Apply: sessions or frames added or removed, sessions moved between groups, group renames, calibration reassignments, a mode switch, and changes arriving from elsewhere, such as a Library rejection or calibration reassigned on a session, each labelled with its source. Nothing touches the View before Apply, and before the first Apply there is no View to change. The Sessions step lists the pending changes with their sources, and each can be discarded. A session the Project holds stays when its own Target or rig association changes, and its row shows the change. Unobservable sessions show as Unavailable, not removed. A Closed Project takes no pending change. Pending changes never change the View without the user's Apply. (D-W94, D-W97, D-W100, D-W106)
- **VSEL-FR-13**: Saving a Project edit commits it under D08, as a pending change once the View exists. Failed writes remain unsaved with Retry and stale edits are refused as in LIB-AC-08. Restart restores the last committed state with its pending changes and distinguishes unfinished work.
- **VSEL-FR-14**: Apply… opens a sheet that shows the exact changes: frames added or removed, sessions moved with their from and to groups, calibration changes and a mode switch. It shows layout changes with "re-add View in your tool", the new View as a folder tree (PREP-FR-16), and copies that differ from what PlateVault placed: the new View always gets fresh copies from the originals, and the changed versions stay in `View (previous)/`. It lists the files PlateVault didn't place (VSEL-FR-20) and the space needed; with Copies, Apply needs room for two full Views while it runs. For SASpro, a Project that mixes dark versions with the same settings reads that it needs two passes (PREP-FR-17). When any original the build needs is offline, the sheet lists the offline originals and Apply is disabled, so nothing changes (PREP-FR-06). (D-W99, D-W100)
- **VSEL-FR-15**: Adding a session includes its Usable frames; library-Unusable frames start visibly excluded and require explicit inclusion. A later Library rejection becomes a pending removal labelled with its source (VSEL-FR-12). Unavailable frames remain named unresolved. The Apply sheet confirms the exact inputs under D02. (D-W78, D-W100)
- **VSEL-FR-16**: The View step holds the application (PREP-FR-01), the input mode (PREP-FR-04), the count of pending changes, Apply… and, once the View exists, Open in {app} (PREP-FR-10). The first Apply builds the View; there is no separate Start processing (provisional copy). A Project keeps no membership revisions: its sessions, groups and exclusions are the desired state, and the View is the applied state. Where they differ, the Project says so with the pending count. (D-W94, D-W100)
- **VSEL-FR-17**: Withdrawn (D-W94, D-W97). There is no Finished run membership to lock or reopen; VSEL-FR-20 covers the files PlateVault didn't place.
- **VSEL-FR-18**: Withdrawn (D-W94). There are no mosaic run groups (PRJ-FR-29); VSEL-FR-21 covers refusing a stale Apply sheet.
- **VSEL-FR-19**: Withdrawn (D-W94). There are no run groups; a mosaic is a Project with panel groups (PRJ-FR-29).
- **VSEL-FR-20**: Files PlateVault didn't place in the View, such as DSS `.Info.txt`, Siril `process/` and the user's notes, are listed in the Apply sheet, each with a tick box (owner: "confirm with the user first"). After the swap only ticked files move into the new View, and unticked ones stay in `View (previous)/` (STO-FR-10). PlateVault never deletes such a file. (D-W100)
- **VSEL-FR-21**: Provisional: Apply is refused when anything changed after its sheet opened, and the sheet refreshes with the latest changes and names what changed. The sheet records the Project revision it was built from (D08). (D-W100)

### Owned interaction steps

- B4
- C1
- C2
- C3
- C4
- C5
- C6
- D4
- D5
- G
- Cross-flow: Missing OBJECT
- Cross-flow: Missing geometry
- Cross-flow: Selection hidden by filters
- Project Sessions step: groups, suggestions, Add sessions… and exclusions
- Pending changes and the Apply sheet (D-W100)
- View step: application, input mode, Apply… and Open in {app}

### Key Entities

Use the [root vocabulary](../063-clean-rebuild-contract/spec.md#key-entities). Feature-specific evidence and decisions retain their input identity, scope, and revision.

- **Project inputs**: the sessions the Project holds, its groups and its exclusions, which are its desired state. (D-W94)
- **View**: the Project's applied state, which Apply builds from the originals (PREP). (D-W100)
- **Pending change**: a change to the Project's inputs after its View exists, labelled with its source, until Apply or Discard. (D-W100)
- **Suggestion**: a Ready session that matches the Project's subjects and rigs and that the Project doesn't hold (PRJ-FR-09). (D-W96)

## Success Criteria

### Measurable Outcomes

- **PV-VSEL-SC-01**: Every acceptance scenario produces its stated outcome and refusal behavior.
- **PV-VSEL-SC-02**: Every owned interaction step has a requirement and independently observable acceptance evidence.
- **PV-VSEL-SC-03**: Original inputs remain unchanged except through separately reviewed and approved filesystem operations.
- **PV-VSEL-SC-04**: In the fixtures, zero sessions are processed outside a Project, zero groups mix rigs, and zero View entries change before Apply. (D-W1, D-W95, D-W100)

## Assumptions

- [Product flow](../../docs/reviews/2026-10-03-product-flow-and-journeys.md) supplies the confirmed interactions and illustrative worked example.
- This feature is independently specified; dependencies on other feature contracts are resolved in planning.
- Conservative defaults and all human-approval gate waivers follow the root autonomous objective and decision register. Tests, requirements analysis, independent review and delivery evidence remain mandatory.
- The user interface calls the Project's input folder the View.

## Decisions before feature approval

- Root decisions D01, D02, D08, D10, D12, D15 and D16 define geometry, draft inclusion, explicit saving and stale-edit recovery, quality scopes, panel/session linkage, grouping corrections and single membership for content-identical copies, as D-W94 to D-W100 amend them.
- Root decision D19 governs Project totals and logical-capture membership: a drifted copy never counts twice or substitutes for another, offline sessions stay named with labeled last-observed counts, and Apply re-verifies each item.
- Workflow decisions D-W14, D-W33, D-W43, D-W52 and D-W59 (settled 2026-10-06) apply here as D-W94 to D-W96 amend them: suggestions follow confirmed Target and rig, geometry orders them and forms framing groups, and every available frame starts included.
- Workflow decisions D-W78 and D-W79 (Round 9, 2026-10-12) supersede D-W42 and D-W54 here: the Project has no Review step and no quality action, and only Ready sessions are suggested.
- Workflow decision D-W100 (the F4 Project model, owner, 2026-10-14) makes every change pending until Apply and sets the Apply sheet. It withdraws runs, membership revisions, Refresh, run groups and D-W75. The stale-sheet refusal of VSEL-FR-21 and the "no separate Start processing" copy are provisional.
