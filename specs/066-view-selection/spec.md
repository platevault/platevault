# Feature Specification: Processing run workspace: candidate selection, frame membership, quality decisions, refresh, run groups

**Feature Branch**: `063-clean-rebuild-contract`

**Spec ID**: `066-view-selection`

**Created**: 2026-10-03

**Amended**: 2026-10-06, to the settled workflow decisions D-W1 to D-W71.

**Status**: Draft; product defaults and all human-approval gate waivers follow the root autonomous objective. Requirements analysis, implementation and verification remain required.

**Input**: Clean rebuild with selective reuse of verified code and the agreed PlateVault product flow.

## User Scenarios & Testing

### User Story 1 - Processing run workspace: candidate selection, frame membership, quality decisions, refresh (Priority: P1)

A processing run (View) lives inside a Project and covers one subject on one rig. Its Select step starts from the subject's candidate sessions on that rig and builds the run's reviewed, revisioned membership from sessions and frames. Exclusions are local to the run. Library quality changes only when the user chooses so. Saved criteria support an explicit refresh diff. A mosaic subject creates a run group with one run per panel.

**Why this priority**: This feature owns the workflow steps listed below without imposing unrelated product features.

**Independent Test**: Exercise the acceptance scenarios through the running product with isolated inputs. Existing baseline code does not prove the redesigned behavior.

**Acceptance Scenarios**:

- **VSEL-AC-01**: Given Project NGC 7000 HOO with subject NGC 7000 and rigs RedCat/ASI2600MM and Esprit/ASI533MC. Sessions of confirmed Target NGC 7000 exist on both rigs, and one RedCat session carries a different OBJECT. One more RedCat session has no confirmed Target. When the user starts a processing run on subject NGC 7000 with rig RedCat, then the picker lists every available RedCat session of NGC 7000 and starts with all of them selected, including the one with the different OBJECT. The picker omits the Esprit sessions and the session with no Target. (D-W33, D-W37, D-W49)
- **VSEL-AC-02**: Given a candidate session with no pointing evidence, then it shows Position unknown and no distance value (not 0). It is still a candidate, it sorts after sessions with geometry evidence, and its checkbox works like any other. (D-W33)
- **VSEL-AC-03**: Given five selected sessions (2 Ha, 3 OIII), when the user filters to Ha and then sorts and pages, then 'Selected outside current filters: 3' shows, all five stay selected, and Show selected lists five.
- **VSEL-AC-04**: Given the worked five-session membership is confirmed and the 30 Sep OIII session contains 48 frames. When the user excludes six frames from the run, then OIII reads 97 / 8h05m and the total 208 / 17h20m. The files remain, and the Target's usable total and other runs stay the same. (D-W3)
- **VSEL-AC-05**: Given reviewed included frames and no explicit quality action, when the run is saved and handed to Review preparation, then no library quality state changes; after Mark included frames usable is confirmed with its named scope, only those frames become Usable and Target usable integration rises. (D-W3, D-W42)
- **VSEL-AC-06**: Given a saved run that is not Complete, when a new candidate session for its subject and rig is indexed, then the run offers 'Add 1 new session'. Choosing it opens the refresh diff with the session marked 'added' and its reason. Membership stays the same until the user accepts the change and saves. An offline member stays in membership and reads Unavailable, and explicit exclusions persist. (D-W34)
- **VSEL-AC-07**: Withdrawn (D-W1, D-W8). Every run belongs to a Project, which removes the standalone View scenario; VSEL-AC-16 covers starting a run from a Target or from selected Sessions.
- **VSEL-AC-08**: Given candidates are listed, when they are checked, then session identities, source headers and Target associations remain unchanged; each selection reason names the confirmed Target and rig that made the session a candidate, never an OBJECT-only match. (D-W33, D-W37)
- **VSEL-AC-09**: Given an unreadable or offline selected source, when selection is reviewed, then the source is named unresolved, not an empty session; reconnect, locate or explicit removal are offered and handoff cannot omit it silently.
- **VSEL-AC-10**: Given a fixed run, when the Project's rigs, subjects or goals or any library quality decision change, then its reviewed asset membership and prepared revision remain unchanged. (D-W34)
- **VSEL-AC-11**: Given a run, when "Reject for this Project only" is confirmed for frames, then only the Project-scoped rejection record changes; library quality and the Target's library-usable total remain unchanged. Mark unusable in library changes only the confirmed library scope and never silently removes fixed run members. (D-W42)
- **VSEL-AC-12**: Given a running external application using a prepared revision, when a Refresh diff is accepted, then a new run membership revision is saved but the prepared entries and external inputs remain unchanged until separately reviewed preparation. (D-W34)
- **VSEL-AC-13**: Given a selected session contains available Unreviewed, Usable and library-Unusable frames plus an unavailable frame, when it enters a draft, then available Unreviewed/Usable frames are included, library-Unusable frames start visibly excluded, and the unavailable frame remains named unresolved. Explicit inclusion changes only the draft and preparation requires membership confirmation.
- **VSEL-AC-14**: Withdrawn (D-W1, D-W33). Every run starts inside a Project, and its picker starts from its candidates, as VSEL-AC-01 states.
- **VSEL-AC-15**: Given a session whose frames also have byte-identical copies in a second registered Captures location, when Refresh selection adds it and the change is accepted, then each frame enters membership once. Each member names its other physical copy, and the summary counts each frame once.
- **VSEL-AC-16**: Given a Target or selected Sessions in no Project, when the user chooses Start a processing run, then PlateVault first asks for Create Project or Add to Project. Either one adds the Target as a subject. PlateVault creates the run only after that Project exists. From then on the run belongs to that one Project; the user can neither move it nor share it with another Project. (D-W1, D-W8)
- **VSEL-AC-17**: Given Project Cygnus 2026 with subjects NGC 7000 and IC 1396, when the user starts a processing run, then exactly one subject must be chosen. The picker lists only that subject's candidates, and the run's Select, Review, Calibrate, Prepare, Results and Done steps belong to that run alone. (D-W3, D-W9)
- **VSEL-AC-18**: Given a run on rig RedCat/ASI2600MM, when the user searches or clears every filter in the picker, then no session from another rig appears and no mixed-equipment warning exists. Processing the Esprit sessions needs a second run on rig Esprit. (D-W37)
- **VSEL-AC-19**: Given runs Ha-only and HOO in one Project, with session S1 in both and session S2 a candidate in neither. When the user saves a new Ha-only membership revision that removes S1, then S1 stays a Project member through HOO and S2 is not a member. Each run's revisions still show the earlier membership. (D-W34)
- **VSEL-AC-20**: Given a Complete run and two new candidate sessions, then the run shows 'Add 2 new sessions'. Choosing it asks the user to Reopen the run first; declining leaves the run Complete and its membership unchanged. After Reopen, the refresh diff lists both sessions as 'added', and accepting and saving creates a new membership revision. (D-W34)
- **VSEL-AC-21**: Given mosaic subject NGC 7000 Mosaic with three panels defined by center and rotation. Candidate pointing falls inside Panel 1 for two sessions and inside Panel 3 for one. One more session falls between Panels 1 and 2, one falls off every panel, and one has unknown pointing. When the user starts a processing run on that subject, then PlateVault creates a run group with three panel runs. Each in-panel session joins its panel run, with its pointing evidence as the reason. PlateVault flags the ambiguous, off-panel and unknown sessions, and each waits for the user to assign a panel or leave it out. The only choice offered is the run group; a single whole-mosaic run is not offered. (D-W38)
- **VSEL-AC-22**: Given that run group, when the user sets the profile, input mode and calibration policy once, then all three panel runs show the same setup. When the user runs Review all, frame review opens over every panel run with a Panel column and a Panel filter. Each panel run keeps its own status, so Panel 2 can read Select while Panels 1 and 3 read Review. (D-W38, D-W41)
- **VSEL-AC-23**: Given an open run whose draft holds 56 frames of the 28 Sep Ha session. In the Review step the user presses X on two of them and chooses Reject for this Project only on a third. Then the draft holds 53 frames and lists the three with the reason "Rejected". Pressing U on one of the two restores it to the draft. Saved membership revisions and the prepared revision stay as they were until the user saves and reprepares. (D-W54)
- **VSEL-AC-24**: Given a saved run with member session S whose Target is later re-confirmed as another Target, when the run's Refresh opens, then S is still a member and counts "in project" and "captured". Refresh flags it "no longer matches subject" with an offer to remove it, and S leaves the run only if the user accepts the removal and saves. (D-W45, D-W66)
- **VSEL-AC-25**: Given a Complete run whose fixed membership includes a frame that later goes to the OS Trash from the Done / Archive sheet. When the run opens, its membership still lists that frame, marked "Trashed". The frame appears in no picker, candidate list or run total. (D-W52)
- **VSEL-AC-26**: Given an open run at Review, when the user marks it Abandoned, then its picker, exclusions and Save are read-only, and its membership revisions and prepared revision are unchanged. 'Add N new sessions' asks for Reopen first. After Reopen the run is back at Review and accepts changes again. (D-W64, D-W71)

### Edge Cases

The [root contract](../063-clean-rebuild-contract/spec.md) governs file custody, uncertainty, exact membership, failed writes, and independent lifecycle decisions. Each acceptance scenario tests observable outcomes; no mock acknowledgment counts as terminal success.

- A member that stops being a candidate, for example after its Target is re-confirmed or its rig association changes, stays a member and still counts "in project" and "captured". Refresh flags it "no longer matches subject" and offers to remove it; it leaves only when the user accepts. (D-W34, D-W45, D-W65, D-W66)
- A Trashed record never appears in the picker, among candidates or in a run's totals. A frame trashed after its run was Complete still shows in that run's fixed membership, marked "Trashed". (D-W43, D-W52)

## Requirements

### Functional Requirements

- **VSEL-FR-01**: A processing run (View) always lives inside a Project and has exactly one subject and one rig, both taken from the Project's lists. Start a processing run appears on the Project page, on a Target and on selected Sessions. From a Target or Sessions outside any Project, the action first offers Create Project or Add to Project, and PlateVault creates the run only after that. A run belongs to exactly one Project for good. Another Project reuses its products only by picking its Results as inputs (RES). Every run starts from a Project, so standalone and Target-only runs do not exist. The subject and rig stay fixed once the run exists; another subject or rig needs another run. (D-W1, D-W8, D-W9, D-W37, D-W50)
- **VSEL-FR-02**: The run's pipeline is Select, Review, Calibrate, Prepare, Results and Done, and it belongs to each run, not to the Project. At any step the user can mark the run Abandoned instead (VSEL-FR-17). Its steps share one selection across Sessions, Frames, Preview and Calibration. The user can move between steps freely; a later step names what it still needs. The run holds its name, its Project, its subject, its rig and an optional profile. This feature owns the Select step. Review preparation gathers the open selection choices. (D-W3, D-W64)
- **VSEL-FR-03**: Candidates for a run are the sessions whose confirmed Target is the run's subject and whose rig is the run's rig. The picker starts with every available candidate selected, each with the reason `Target <subject> on <rig>`. The picker offers candidates only. Sessions from another rig, sessions with no confirmed Target or a different Target, and Trashed records stay out of it. A session outside the candidates becomes one after the user confirms its Target or adds its Target to the Project as a subject. An OBJECT label never vetoes a candidate and never assigns a Target. Candidacy follows Target and rig only. Footprint and pointing evidence, where present, order candidates by overlap and then angular separation. In a mosaic, the same evidence assigns panels (VSEL-FR-18). Each candidate shows session, date/time, channel, exposure, frames, integration, availability, distance, footprint evidence and, in a run group, its panel. (D-W33, D-W37, D-W43, D-W49)
- **VSEL-FR-04**: Missing geometry: FOV from confirmed equipment (image dimensions, effective focal length, pixel scale, binning) is shown with its provenance. A footprint also needs pointing and orientation evidence. Otherwise the candidate shows FOV unknown or Position unknown and sorts after candidates with evidence. Missing geometry never removes a candidate. In a run group, a candidate without pointing cannot be assigned to a panel automatically and is flagged. OBJECT never stands in for coordinates, and unknown geometry is never shown as zero distance. (D-W33, D-W38)
- **VSEL-FR-05**: Filters: date/time, night, channel, exposure range, quality state, location, availability, and OBJECT text (including Missing OBJECT). Expanded filters: gain, offset, binning, temperature. In a run group, a Panel filter adds Panel N and Flagged. The run's rig fixes the camera and optical train for raw sessions, so the picker has no equipment or camera filter. When the run is created, its input filters also offer Results beside sessions. They list accepted products under RES-FR-05, from runs on any rig and shown with their rig, because the one-rig rule covers raw frames only. Active filters show as chips with a match count. Columns sort by value; sky-distance and overlap sorting appear when evidence exists. Rows show counts per quality state; measurement columns show 'Not measured' where no value exists. (D-W4, D-W37, D-W38, D-W56)
- **VSEL-FR-06**: Select with checkboxes or Select matching. Filters change the candidate list, not the selected IDs. Show 'Selected outside current filters: N', Show selected, and an explicit Clear selection. Sorting, paging, and the sky toggle keep the selection. Each selection shows its reason.
- **VSEL-FR-07**: Linked sky-coverage toggle: the table stays primary, and highlighting links footprints and rows both ways. In a run group, the toggle draws each panel outline from its center and rotation, with the sessions assigned to it. PlateVault does no stitching. (D-W38)
- **VSEL-FR-08**: The summary shows intended included frames and integration by channel, names unresolved membership, and keeps Unreviewed and library-Unusable counts visible. Each LIB logical capture enters membership and totals once and names its other physical copies. In a run group, the summary is shown per panel run and for the group. (D-W38)
- **VSEL-FR-09**: Offline, missing, unreadable, and retired inputs are flagged. Last-observed counts are never treated as verified counts. Options: reconnect (not for retired inputs), locate a copy, or remove explicitly. Handoff never silently omits a selected source.
- **VSEL-FR-10**: Exclude from run is the default exclusion scope, and excluded rows can be shown or restored. Files stay on disk; other runs and library state are unchanged. (D-W3)
- **VSEL-FR-11**: Quality has two levels. Library quality (Usable, Unusable, Unreviewed) is global, and "Reject for this Project only" writes the Project-scoped rejection record, leaving library quality and other Projects unchanged. The single-frame marks P, X and U, which apply at once with no confirmation and auto-advance, and the single-frame "Reject for this Project only" belong to frame review (PIX-FR-13, PIX-FR-14). This requirement covers only the bulk scoped actions on a multi-frame selection in the run workspace: Mark included frames usable, Mark unusable in library and Reject for this Project only. Each bulk confirmation names its scope. Saving or preparing a run never changes quality state. (D-W14, D-W42)
- **VSEL-FR-12**: Save run stores the criteria and reviewed membership as a new membership revision, kept separate from browsing filters. When new candidates that match the saved criteria appear, the run offers 'Add N new sessions', which opens Refresh selection. Refresh selection shows sessions and frames added or removed against the reviewed membership, with reasons that include manual inclusions. Manual inclusions stay pinned across every refresh: they are never proposed for removal for falling outside the criteria, and only an explicit removal ends one (D09). A member that stops being a candidate stays a member, carries the flag "no longer matches subject" and is offered for removal. Explicit exclusions are kept. Unobservable members show as Unavailable, not removed. Each change can be accepted or declined, or the run kept unchanged. Changed inputs need image and calibration review again. Membership never changes without approval. Refresh is separate from path repair. (D-W34, D-W45)
- **VSEL-FR-13**: Explicit Save commits the draft revision under D08. Failed writes remain unsaved with Retry and stale edits are refused as in LIB-AC-08. Restart restores the last committed membership and distinguishes unfinished work.
- **VSEL-FR-14**: Project edits (rigs, subjects, goals) and changed library quality decisions never silently alter fixed run membership. Accepting a refresh creates a new reviewed revision, not an in-place mutation of prepared inputs; PREP owns separate preparation review. (D-W34)
- **VSEL-FR-15**: Selecting a session initially includes its available Unreviewed/Usable frames; library-Unusable frames start visibly excluded and require explicit inclusion. Rejecting a frame in an open run's Review step, with X or Reject for this Project only, removes it from that run's draft with the reason "Rejected"; un-rejecting it restores it. Saved membership revisions and prepared revisions stay unchanged. Unavailable frames remain named unresolved. Review preparation confirms exact membership under D02. (D-W54)
- **VSEL-FR-16**: Sessions are assigned only to runs, as each run's revisioned membership. Every saved membership revision is kept, with its time and the changes it accepted. A Project has no session list of its own: its members are the sessions in the current membership revision of any of its runs, and candidates in no run are not members. PRJ counts goal progress from these members. (D-W34)
- **VSEL-FR-17**: A Complete or Abandoned run accepts no membership change; an Abandoned run is kept read-only, its frames stop counting "in project", and its members still count "captured" (PRJ-FR-04). When new candidates appear, the run still shows 'Add N new sessions'. Choosing it asks for Reopen first (RES), and declining leaves the run unchanged. Reopen returns the run to the stage it was in, and the action then opens Refresh selection under VSEL-FR-12. (D-W34, D-W64, D-W71)
- **VSEL-FR-18**: Starting a run on a mosaic subject creates a run group: one panel run per panel of the subject, and no single whole-mosaic run. PlateVault assigns each candidate to a panel by checking its pointing against the panel's center and rotation, and the reason names that evidence. PlateVault flags a session that falls in more than one panel, falls outside every panel, or has no pointing. The user assigns each flagged session to a panel or leaves it out; PlateVault assigns nothing silently. Each panel run has its own membership revision and status. The group holds one shared setup (profile, input mode, calibration policy); changing it changes every panel run. (D-W38, D-W41)
- **VSEL-FR-19**: Group actions act on every panel run. Review all opens frame review over all panel runs, with a Panel column and a Panel filter (PIX renders the review). Prepare all opens one preparation review for every panel run (PREP). The group shows each panel run's status and reports every group action's outcome per panel; one panel's failure never changes another panel's status. Calibration is matched per panel run (CAL). (D-W38, D-W41)

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
- Run workspace host for the Select, Review, Calibrate and Prepare steps
- Start a processing run inside a Project (subject and rig)
- Add N new sessions (refresh), including Reopen of a Complete or Abandoned run
- Mosaic run group: panel assignment, shared setup, Review all

### Key Entities

Use the [root vocabulary](../063-clean-rebuild-contract/spec.md#key-entities). Feature-specific evidence and decisions retain their input identity, scope, and revision.

- **Processing run (View)**: belongs to one Project and holds one subject and one rig, both fixed at creation, an optional profile, its pipeline status (including Abandoned) and its membership revisions. (D-W1, D-W3, D-W8, D-W9, D-W37, D-W50, D-W64)
- **Candidate**: a session whose confirmed Target is a subject of the Project and whose rig is one of the Project's rigs. Candidacy is derived and never stored as an assignment. (D-W33, D-W37)
- **Membership revision**: the reviewed set of sessions and frames for one run at one save, with reasons and accepted changes. (D-W34)
- **Run group**: the set of panel runs created for one mosaic subject, with one shared setup. (D-W38)
- **Panel run**: a run in a run group, tied to one panel, with its own membership revision and status. (D-W38)

## Success Criteria

### Measurable Outcomes

- **PV-VSEL-SC-01**: Every acceptance scenario produces its stated outcome and refusal behavior.
- **PV-VSEL-SC-02**: Every owned interaction step has a requirement and independently observable acceptance evidence.
- **PV-VSEL-SC-03**: Original inputs remain unchanged except through separately reviewed and approved filesystem operations.
- **PV-VSEL-SC-04**: In the fixtures, zero runs exist without a Project and zero picker rows come from a rig other than the run's rig. Zero sessions join a panel run without pointing evidence or an explicit user choice. (D-W1, D-W37, D-W38)

## Assumptions

- [Product flow](../../docs/reviews/2026-10-03-product-flow-and-journeys.md) supplies the confirmed interactions and illustrative worked example.
- This feature is independently specified; dependencies on other feature contracts are resolved in planning.
- Conservative defaults and all human-approval gate waivers follow the root autonomous objective and decision register. Tests, requirements analysis, independent review and delivery evidence remain mandatory.
- The user interface says "processing run" where this contract's root vocabulary says View.

## Decisions before feature approval

- Root decisions D01, D02, D08, D09, D10, D12, D15 and D16 define geometry, draft inclusion, explicit saving and stale-edit recovery, immutable preparation revisions, quality scopes, panel/session linkage, grouping corrections and single membership for content-identical copies.
- Root decision D19 governs run totals and logical-capture membership: a drifted copy never counts twice or substitutes for another, offline members stay named with labeled last-observed counts, and preparation re-verifies each item.
- Workflow decisions D-W1, D-W3, D-W4, D-W8, D-W9, D-W14, D-W33, D-W34, D-W37, D-W38, D-W41, D-W42, D-W43, D-W45, D-W49, D-W50, D-W52, D-W54, D-W56, D-W64, D-W65, D-W66 and D-W71 (settled 2026-10-06) apply here. They replace the standalone View, geometric preselection and per-Project equipment preselection. Candidacy now follows confirmed Target and rig. Geometry orders candidates and assigns mosaic panels. Round 6 settled that every available candidate starts selected and the subject and rig are fixed. It also settled that a rejected frame leaves the draft, a non-candidate member stays until removed, and Results from another rig may be inputs. Round 7 adds the read-only Abandoned run state, which Reopen returns to its earlier stage.
