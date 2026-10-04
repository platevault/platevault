# Feature Specification: View workspace: session selection, frame membership, quality decisions, refresh

**Feature Branch**: `063-clean-rebuild-contract`

**Spec ID**: `066-view-selection`

**Created**: 2026-10-03

**Status**: Draft; product defaults and all human-approval gate waivers follow the root autonomous objective. Requirements analysis, implementation and verification remain required.

**Input**: Clean rebuild with selective reuse of verified code and the agreed PlateVault product flow.

## User Scenarios & Testing

### User Story 1 - View workspace: session selection, frame membership, quality decisions, refresh (Priority: P1)

One persistent workspace that builds a named View's reviewed membership from sessions and frames. Exclusions are local to the View; library usability changes only when the user chooses so. Saved criteria support an explicit refresh diff.

**Why this priority**: This feature owns the workflow steps listed below without imposing unrelated product features.

**Independent Test**: Exercise the acceptance scenarios through the running product with isolated inputs. Existing baseline code does not prove the redesigned behavior.

**Acceptance Scenarios**:

- **VSEL-AC-01**: Given Project NGC 7000 HOO with RedCat/ASI2600MM equipment and overlapping sessions, one labelled with a different OBJECT and one from another camera, when the user creates a View from the Project, then the overlapping RedCat sessions are preselected, including the mismatched label, and the other-camera session is visible and unselected.
- **VSEL-AC-02**: Given a session with no pointing evidence, then it shows Position unknown, has no distance value (not 0), is not preselected, and can be added with its checkbox.
- **VSEL-AC-03**: Given five selected sessions (2 Ha, 3 OIII), when the user filters to Ha and then sorts and pages, then 'Selected outside current filters: 3' shows, all five stay selected, and Show selected lists five.
- **VSEL-AC-04**: Given the worked five-session membership is confirmed and the 30 Sep OIII session contains 48 frames, when six frames are excluded from the View, then OIII reads 97 / 8h05m and the total 208 / 17h20m; the files remain; the Target's usable total and other Views are unchanged.
- **VSEL-AC-05**: Given reviewed included frames and no explicit quality action, when the View is saved and handed to Review preparation, then no library quality state changes; after Mark included frames usable is confirmed with its named scope, only those frames become Usable and Target usable integration rises.
- **VSEL-AC-06**: Given a saved View, when a new matching session is indexed and Refresh selection runs, then the session appears as 'added' with a reason and membership is unchanged until accepted; an offline member shows Unavailable, not removed; explicit exclusions persist.
- **VSEL-AC-07**: Given a Target or selected Sessions, when a standalone View is created, then no Project is created and Sessions, Frames, Preview and Calibration share the same selection without a forced wizard.
- **VSEL-AC-08**: Given geometric preselection, when candidates are checked, then session identities, source headers and Target associations remain unchanged; selection reasons show the actual evidence, not an OBJECT-only match.
- **VSEL-AC-09**: Given an unreadable or offline selected source, when selection is reviewed, then the source is named unresolved, not an empty session; reconnect, locate or explicit removal are offered and handoff cannot omit it silently.
- **VSEL-AC-10**: Given a fixed View, when Project equipment/goals or library quality decisions change, then its reviewed asset membership and prepared revision remain unchanged.
- **VSEL-AC-11**: Given a Project-owned View, when Reject for Project is confirmed, then only the scoped Project rejection record changes; library quality and the Target's library-usable total remain unchanged. Mark unusable in library changes only the confirmed library scope and never silently removes fixed View members.
- **VSEL-AC-12**: Given a running external application using a prepared revision, when a Refresh diff is accepted, then a new View membership revision is saved but the prepared entries and external inputs remain unchanged until separately reviewed preparation.
- **VSEL-AC-13**: Given a selected session contains available Unreviewed, Usable and library-Unusable frames plus an unavailable frame, when it enters a draft, then available Unreviewed/Usable frames are included, library-Unusable frames start visibly excluded, and the unavailable frame remains named unresolved. Explicit inclusion changes only the draft and preparation requires membership confirmation.
- **VSEL-AC-14**: Given a Target-originated or standalone View with no reviewed session selection, when it opens, then it has no automatically selected sessions; suggestions can be inspected and checked explicitly.
- **VSEL-AC-15**: Given a session whose frames also have byte-identical copies in a second registered Captures location, when Refresh selection adds it and the change is accepted, then each frame enters membership once. Each member names its other physical copy, and the summary counts each frame once.

### Edge Cases

The [root contract](../063-clean-rebuild-contract/spec.md) governs file custody, uncertainty, exact membership, failed writes, and independent lifecycle decisions. Each acceptance scenario tests observable outcomes; no mock acknowledgment counts as terminal success.

## Requirements

### Functional Requirements

- **VSEL-FR-01**: Create View from a Project (carrying Project context and equipment), from a Target, or from selected Sessions. Standalone Views need no Project.
- **VSEL-FR-02**: One workspace where Sessions, Frames, Preview, and Calibration share one selection, with no forced wizard. It holds the View name, an optional Project, and an optional profile. Review preparation gathers the open selection choices.
- **VSEL-FR-03**: Geometric suggestions come from Target or Project framing or mosaic panels. Relevance uses known footprints and configured overlap, not centre distance alone; angular separation helps ordering. Only sessions from the Project's chosen equipment are preselected; other equipment is visible for manual inclusion. A missing or different OBJECT never vetoes a match. Each candidate shows session, date/time, channel, exposure, camera/optical train, frames, integration, availability, distance, and footprint evidence.
- **VSEL-FR-04**: Missing geometry: FOV from confirmed equipment (image dimensions, effective focal length, pixel scale, binning) is shown with its provenance. A footprint also needs pointing and orientation evidence. Otherwise the candidate shows FOV unknown or Position unknown. Pointing-only candidates are listed by radius and never preselected. Sessions without position remain manually selectable. OBJECT never stands in for coordinates, and unknown geometry is never shown as zero distance.
- **VSEL-FR-05**: Filters: date/time, night, channel, exposure range, equipment, quality state, location, availability, and OBJECT text (including Missing OBJECT). Expanded filters: Target, camera, gain, offset, binning, temperature. Active filters show as chips with a match count. Columns sort by value; sky-distance and overlap sorting appear when evidence exists. Rows show counts per quality state; measurement columns show 'Not measured' where no value exists.
- **VSEL-FR-06**: Select with checkboxes or Select matching. Filters change the candidate list, not the selected IDs. Show 'Selected outside current filters: N', Show selected, and an explicit Clear selection. Sorting, paging, and the sky toggle keep the selection. Each selection shows its reason.
- **VSEL-FR-07**: Linked sky-coverage toggle: the table stays primary, and highlighting links footprints and rows both ways. Mosaic footprints are shown; there is no stitching.
- **VSEL-FR-08**: The summary shows intended included frames and integration by channel, names unresolved membership, and keeps Unreviewed and library-Unusable counts visible. Each LIB logical capture enters membership and totals once and names its other physical copies.
- **VSEL-FR-09**: Offline, missing, and unreadable inputs are flagged. Last-observed counts are never treated as verified counts. Options: reconnect, locate a copy, or remove explicitly. Handoff never silently omits a selected source.
- **VSEL-FR-10**: Exclude from View is the default exclusion scope, and excluded rows can be shown or restored. Files stay on disk; other Views and library state are unchanged.
- **VSEL-FR-11**: Library decisions: Mark included frames usable, Mark unusable in library, and Reject for Project (Project-owned Views). Each confirmation names its scope. Saving or preparing a View never changes quality state.
- **VSEL-FR-12**: Save View stores the criteria and reviewed membership, kept separate from browsing filters. Refresh selection shows sessions and frames added or removed against the reviewed membership, with reasons that include manual inclusions. Explicit exclusions are kept. Unobservable members show as Unavailable, not removed. Each change can be accepted or declined, or the View kept unchanged. Changed inputs need image and calibration review again. Membership never changes without approval. Refresh is separate from path repair.
- **VSEL-FR-13**: Explicit Save commits the draft revision under D08. Failed writes remain unsaved with Retry and stale edits are refused as in LIB-AC-08. Restart restores the last committed membership and distinguishes unfinished work.
- **VSEL-FR-14**: Project edits and changed library quality decisions never silently alter fixed View membership. Accepting a refresh creates a new reviewed revision, not an in-place mutation of prepared inputs; PREP owns separate preparation review.
- **VSEL-FR-15**: Selecting a session initially includes its available Unreviewed/Usable frames; library-Unusable frames start visibly excluded and require explicit inclusion. Unavailable frames remain named unresolved. Review preparation confirms exact membership under D02.

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
- View review surface host

### Key Entities

Use the [root vocabulary](../063-clean-rebuild-contract/spec.md#key-entities). Feature-specific evidence and decisions retain their input identity, scope, and revision.

## Success Criteria

### Measurable Outcomes

- **PV-VSEL-SC-01**: Every acceptance scenario produces its stated outcome and refusal behavior.
- **PV-VSEL-SC-02**: Every owned interaction step has a requirement and independently observable acceptance evidence.
- **PV-VSEL-SC-03**: Original inputs remain unchanged except through separately reviewed and approved filesystem operations.

## Assumptions

- [Product flow](../../docs/reviews/2026-10-03-product-flow-and-journeys.md) supplies the confirmed interactions and illustrative worked example.
- This feature is independently specified; dependencies on other feature contracts are resolved in planning.
- Conservative defaults and all human-approval gate waivers follow the root autonomous objective and decision register. Tests, requirements analysis, independent review and delivery evidence remain mandatory.

## Decisions before feature approval

- Root decisions D01, D02, D08, D09, D10, D12, D15 and D16 define geometry, draft inclusion, explicit saving and stale-edit recovery, immutable preparation revisions, quality scopes, panel/session linkage, grouping corrections and single membership for content-identical copies.
- Root decision D19 binds View totals and logical-capture membership to re-verified content; preparation enforces it per item.
