# Feature Specification: Clean rebuild product contract

**Feature Branch**: `063-clean-rebuild-contract`

**Created**: 2026-10-03

**Status**: Draft; conservative product decisions and all human-approval gate waivers are authorized. Requirements analysis and implementation verification remain required.

**Input**: Rebuild PlateVault cleanly, preserve the old code as a recoverable reference, and reuse code where it satisfies the agreed product contract.

The [product flow](../../docs/reviews/2026-10-03-product-flow-and-journeys.md) supplies the interaction details and worked example. The [workflow redesign](decisions.md#workflow-redesign-2026-10-06) of 2026-10-06 (decisions D-W1 through D-W74) amends it: every processing run (View) belongs to a Project, and Home is a dashboard rather than the Targets list. Where the product flow and a D-W decision disagree, the decision governs. This specification defines shared behavior and feature ownership. It does not authorize product implementation or claim that the redesigned flows run.

## User Scenarios & Testing

### User Story 1 - Inspect captures without reorganizing files (Priority: P1)

The user registers capture folders and inspects their sessions while indexing proceeds. A Project and a processing application are optional for inspection, Import and planning; only a processing run needs a Project (D-W1).

**Why this priority**: Library inspection is the first useful workflow and requires no file mutation.

**Independent Test**: Register a capture folder, index its headers, and inspect sessions without creating a Project or a processing run (View).

**Acceptance Scenarios**:

1. **Given** only a Captures location, **When** onboarding continues without Calibration or Results locations, **Then** indexing is available and the omitted roles show as unset.
2. **Given** Ha and OIII captures from one night, **When** indexing completes, **Then** separate metadata-homogeneous sessions appear; grouping the display by night preserves those boundaries.
3. **Given** a registered folder, **When** indexing and catalog corrections complete, **Then** source paths and bytes remain unchanged.
4. **Given** an unreadable descendant or an offline location, **When** indexing runs, **Then** its unobserved files retain last-observed information and show uncertainty rather than Missing.

### User Story 2 - Review a processing run's input selection (Priority: P1)

The user creates a Project with a subject and a rig, starts a processing run in it, selects sessions from the run's candidates, saves the run, and prepares exact inputs for an external application. Selection and quality decisions have separate scopes (D-W1, D-W3, D-W37).

**Why this priority**: An exact handoff makes library inspection useful. The Project is a light container: a name, its subjects and its rigs are enough to start a run.

**Independent Test**: Create a Project with one subject and one rig, start a run, review its membership, prepare supported inputs, and open the application after verification.

**Acceptance Scenarios**:

1. **Given** selected sessions, **When** filters, sort order, or paging change, **Then** the selected identities remain fixed and hidden selected rows are counted.
2. **Given** six excluded frames, **When** the run is saved, **Then** those files remain on disk and other runs and library quality decisions remain unchanged. (D-W3)
3. **Given** a Direct-source run, **When** a tool would consume excluded files through a whole-folder handoff, **Then** that handoff is refused and supported alternatives are shown. (D-W3)
4. **Given** selected inputs become unreadable during preparation, **When** the operation settles, **Then** blocked inputs are named and verified Open is unavailable.
5. **Given** a destination collision, **When** preparation is reviewed, **Then** unrelated existing entries remain unchanged and require another path or a revised plan.
6. **Given** no Project exists, **When** the user tries to start a processing run, **Then** the product asks for a Project (new or existing), one of its subjects and one of its rigs before the run exists; no standalone run is created. (D-W1, D-W8, D-W9, D-W37)
7. **Given** a Project with rigs A and B, **When** a run on rig A opens its session picker, **Then** only candidate sessions of the run's subject captured with rig A are offered. (D-W33, D-W37)

### User Story 3 - Review measurements without changing capture data (Priority: P2)

The user inspects pixels and measurements while retaining the original scientific samples. Display settings do not influence measured quality.

**Why this priority**: Measurements support review decisions but do not replace the user's judgment.

**Independent Test**: Inspect a frame, change display stretch, select a star, and compare native and imported measurement provenance.

**Acceptance Scenarios**:

1. **Given** a frame with valid measurements, **When** display stretch changes, **Then** measurement values and source bytes remain unchanged.
2. **Given** a failed or saturated-star fit, **When** its details open, **Then** failure and warnings are visible without a substitute fitted-width number.
3. **Given** ambiguous imported measurement rows, **When** import is reviewed, **Then** mappings require confirmation and no rejection or membership decision is imported.
4. **Given** computed measurements, **When** review completes, **Then** no frame becomes Usable or excluded without a separate scoped action.

### User Story 4 - Finish processing and recover storage safely (Priority: P2)

The user accepts reusable products, marks a run Complete, and chooses its Clean up independently. Later the user marks the Project Done and decides on Archive and on trashing rejected frames in the Project's Done / Archive sheet (D-W26, D-W43).

**Why this priority**: Completion must not hide unaccepted outputs or authorize file removal.

**Independent Test**: Complete a run with no Result, review its Clean up, interrupt an archive transfer, and review the Project's trash offer using disposable fixtures.

**Acceptance Scenarios**:

1. **Given** no accepted Result, **When** the user marks the run Complete, **Then** the run becomes Complete and no Clean up starts. (D-W26)
2. **Given** a Complete run prepared with links and copies, with accepted products and unknown files in its Results folder, **When** Clean up opens, **Then** it lists only the run's prepared links, clones and copies. The products and unknown files stay off the list. (D-W26)
3. **Given** a location without safe OS Trash support, **When** approved cleanup runs, **Then** affected files are retained and no permanent-delete fallback executes.
4. **Given** an archive verification or reference-repair failure, **When** transfer settles, **Then** sources are retained and completed, pending, and uncertain phases remain visible.
5. **Given** a Project the user marks Done, **When** its Done / Archive sheet opens, **Then** it offers Archive and "Move N rejected frames to Trash (size)". Archive keeps every session that is a member of a run in another Project not marked Done. Nothing moves until the user approves. (D-W26, D-W43, D-W46)
6. **Given** the trash offer, **When** its frames are listed, **Then** it covers only the Project's candidate frames that are library-Unusable, excludes every Project-only reject, and lists each refused frame with its reason. (D-W42, D-W43)

### User Story 5 - Plan observing independently of processing (Priority: P2)

The user chooses a planning site, reviews observing windows, and explicitly opts into reminders or exports a calendar snapshot.

**Why this priority**: Planning supports capture goals without changing library membership or starting processing. The Planner works on Targets and needs no Project (D-W16).

**Independent Test**: Switch planning sites, enable default-site reminders explicitly, and export selected windows.

**Acceptance Scenarios**:

1. **Given** sessions from multiple capture sites, **When** the planning site changes, **Then** session sites and Project membership remain unchanged.
2. **Given** reminders disabled, **When** the user browses plans, **Then** no reminders or indexing jobs start.
3. **Given** selected observing windows, **When** calendar export is confirmed, **Then** the snapshot contains exactly those windows with the displayed site and time-zone basis.
4. **Given** a Project page, **When** it opens, **Then** it shows planning for its own subjects with "Open in Planner", and the Planner itself lists Targets regardless of Projects. (D-W16)

### User Story 6 - Work Projects from the Home dashboard (Priority: P1)

The user opens Home, sees every Project with its goal progress, stage and one Next action, and acts on new sessions that need a Target, belong to no Project, are unreviewed or are ready to add to a run (D-W35, D-W39).

**Why this priority**: Home is the control panel for capture and processing. It must show what to do next without hiding the library.

**Independent Test**: Index sessions for two Projects plus one session with no confirmed Target, then read Home's sections, top line and Next actions.

**Acceptance Scenarios**:

1. **Given** indexed sessions, **When** Home opens, **Then** it shows the six Home sections of FR-020 in order. (D-W39)
2. **Given** three sessions with no confirmed Target and two with a confirmed Target that no Project lists, **When** Home opens, **Then** the top line reads "3 sessions need a Target · 2 not in any Project". (D-W35)
3. **Given** a Project with new unreviewed candidate frames and a blocked run, **When** Home computes its Next action, **Then** it shows "Review N new frames", which opens frame review filtered to Unreviewed. (D-W27, D-W35)
4. **Given** a goal of Ha 10h with 6h10 in the Project's runs and 9h15 across all candidates and run members, **When** progress shows, **Then** it reads "Ha 6h10 in project · 9h15 captured · goal 10h", and the goal is unmet. (D-W36, D-W66)

### Edge Cases

- Missing OBJECT never substitutes for missing coordinates or controls capture identity. A session without a confirmed Target is never a candidate; Home lists it under "need a Target". (D-W33, D-W35)
- Unknown geometry does not become zero distance or automatic inclusion. Geometry never decides candidacy; it orders candidates and assigns mosaic panels. (D-W33, D-W38)
- A session captured with a rig the Project does not list is not a candidate, even when its confirmed Target is a subject. (D-W37)
- A Trashed frame disappears from candidates, run pickers, frame review, goals, totals and Home. The Sessions "Trashed" filter shows it, and so does the fixed membership of a run that was Complete when the frame was trashed, marked "Trashed". (D-W43, D-W52)
- Failed catalog writes remain visibly unsaved with Retry.
- Start acknowledgments do not imply durable operation success.
- Refresh never removes an offline member as though it were absent.
- Source corrections never patch originals or write through prepared links.
- Cleanup never follows link targets or removes the last retained copy without proof.
- External application exit does not imply processing success or run completion. (D-W3)

## Requirements

### Functional Requirements

- **FR-001**: The product MUST allow indexing in place without a Project, a processing profile, or compulsory file organization.
- **FR-002**: Sessions MUST group homogeneous capture evidence. OBJECT is a label or filter; Target enrichment MUST NOT change capture identity.
- **FR-003**: A processing run (View) MUST belong to exactly one Project and use exactly one of its subjects and one of its rigs. A run MUST retain reviewed input identities independently of browsing filters. Refresh MUST present changes for approval. Reuse across Projects MUST go through Results as inputs, never through sharing a run. (D-W1, D-W8, D-W9, D-W37)
- **FR-004**: Preparation MUST account for every selected input. Unsupported modes, missing inputs, and collisions MUST have explicit outcomes without silent omission or fallback.
- **FR-005**: Direct-source handoff MUST pass exact reviewed membership without staging. Profiles that can write into inputs, or whose input-write behavior is unknown, MUST refuse Linked and Direct-source handoff and offer isolated Copy or supported Clone instead.
- **FR-006**: Library quality (P/X/U, global), run exclusions, and "Reject for this Project only" MUST have explicit scopes. A Project-only reject MUST NOT change library quality, other Projects or run membership. Measurements MUST NOT make those decisions automatically. (D-W42)
- **FR-007**: Pixel review MUST retain scientific input semantics and invalid-sample evidence. Measurement MUST use linear samples independently of display stretch.
- **FR-008**: Measurements MUST identify method, units, source, and input basis. Failed fits MUST remain failures; imported values MUST NOT silently replace built-in values.
- **FR-009**: Observed artifacts, accepted Results, reusable masters, and a run's Complete MUST remain separate states. Complete MUST require neither a Result nor Clean up. A run that is no longer wanted MAY be moved to its Project's Trash instead (soft delete). Move run to Trash MUST be refused while an operation affecting the run is Running, and while one of its accepted Results is an input to another run; the refusal MUST name each blocker. Moving a run to Trash MUST move no file. A run in the Project's Trash MUST be hidden everywhere except the Project's Trash list, and Restore MUST bring it back exactly as it was. Only Empty Trash, for one run or for all, MAY remove a run. Before it does, it MUST show what goes: the run record, its prepared folders and, only when the user ticks it, its Results folder. Those files MUST go to the OS Trash only. Library frames and quality decisions MUST NOT change, and after Empty Trash, Put back in the OS Trash restores files only. (D-W26, D-W72)
- **FR-010**: A run's Clean up MUST operate on approved run-scoped entries (prepared links, clones and copies) through OS Trash. Unsafe or unavailable Trash MUST retain affected files without permanent deletion. Trashing rejected capture frames, processing intermediates or duplicate copies MUST NOT be part of a run's Clean up. Only the Project's Done / Archive sheet offers it, apart from the intermediates in the Results folder of a run emptied from the Project's Trash when the user ticks that folder (FR-009). (D-W26, D-W43, D-W70, D-W72, D-W74)
- **FR-011**: Archive MUST verify destinations and affected references before source retirement. Interruption MUST preserve recoverable phases and fixed membership. Project Archive MUST keep every session that is a member of a run in another Project not marked Done; being another Project's candidate MUST NOT count. Reviewed filing is withdrawn with "File into library": Import (PV-STO) replaces it, and Import Move MUST keep each source until its destination verifies. (D-W11, D-W26, D-W46)
- **FR-012**: Failed writes and incomplete operations MUST remain visible. Unknown, unreadable, and offline evidence MUST NOT be represented as absence or success.
- **FR-013**: Every processing run MUST belong to a Project; a Project holds one or more subjects (Targets or mosaics, at any separation), the rigs taking part, and goals per subject and channel. Meeting goals MUST NOT mark a Project Done; only the user does. Library inspection, Import and the Planner MUST NOT require a Project. (D-W1, D-W9, D-W16, D-W26)
- **FR-014**: Planning-site selection, capture sites, and Project membership MUST remain independent. Reminders MUST require opt-in and name the default site.
- **FR-015**: Core library use MUST remain local-first without an account. External applications own calibration, registration, integration, and final image production.
- **FR-016**: The old application and existing uncommitted work MUST remain recoverable during rebuilding. Source-code reuse MUST NOT imply importing old catalog decisions.
- **FR-017**: Assigning, opening, preparing, reusing, cleaning, archiving or trashing a recorded file, or retiring it as a source after archive, MUST re-verify its recorded identity and SHA-256 immediately before the effect. A mismatch MUST name the drift and block that item. Counting a file toward a decision- or proof-bound total MUST use its last completed verification, from review, inspection, acceptance, readable rescan or reuse, and MUST label that verification time. Counts MUST exclude an item whose latest verification found drift or is pending, and showing a total MUST NOT start a rehash. Metadata-only captured totals of Unreviewed captures, and labelled last-observed counts of offline or unreadable inputs of locations that are not retired, MUST stay visible as D19 scopes them. Catalog-only Retire location reads no file bytes and is exempt from rehashing; it MUST still commit only against its review, expected revision and unchanged availability (D19). (D-W11, D-W43)
- **FR-018**: A Project's candidates MUST be derived, never assigned: every session whose confirmed Target is one of the Project's subjects and whose rig is one of the Project's rigs. A run's session picker MUST offer only candidates of the run's subject on the run's rig. (D-W33, D-W37)
- **FR-019**: Sessions MUST be assigned only to runs, as each run's revisioned membership. A Project's members MUST be inherited from its runs outside its Trash. Goal progress MUST show "in project" and "captured". "in project" counts the frames in the latest saved memberships of the Project's runs outside its Trash, minus each run's exclusions and the frames rejected for the Project. "captured" counts the frames of all candidates plus the members of those runs. A member that stops being a candidate MUST stay in its run and still count "in project". The members of a run in the Project's Trash MUST stop counting in both, unless they are still candidates, and MUST count again after Restore. Goal met and Home's Next action MUST use "in project" only. (D-W34, D-W36, D-W42, D-W44, D-W45, D-W66, D-W72)
- **FR-020**: Home MUST be a dashboard with these six sections, in order:
  1. Actions: Import, New Project, Plan tonight.
  2. Projects, each with goals, stage and one Next action.
  3. New sessions needing work.
  4. Tonight.
  5. Target status.
  6. Running work.

  Its top line MUST read "N sessions need a Target · M not in any Project". Done Projects MUST stay hidden behind a "Show done" filter. PV-PRJ owns the section contents and the Next rule. (D-W27, D-W35, D-W39, D-W48)
- **FR-021**: Moving rejected frames to the OS Trash MUST be offered only from a Done Project's Done / Archive sheet. It MUST cover only that Project's library-Unusable candidate frames, MUST exclude Project-only rejects, MUST list refused frames with their reason, and MUST NOT permanently delete. A Trashed record MUST stay for traceability. It MUST appear only under the Sessions "Trashed" filter and, marked "Trashed", in the fixed membership of a run that was Complete when the frame was trashed. The same sheet MUST also offer "Move N processing intermediates to Trash (size)" and "Move N duplicate copies to Trash (size)" under the same trash rules. It MUST keep final Results and adopted masters, and it MUST keep one copy of every frame. When the Project's Trash holds runs, the sheet MUST also offer Empty Trash under FR-009. (D-W43, D-W52, D-W70, D-W72, D-W74)
- **FR-022**: Each run's stage MUST be one of Select, Review, Calibrate, Prepare, Results, Done or Clean up, and Clean up MUST be offered, never required. At any stage the user MAY move the run to the Project's Trash under FR-009. A run in the Trash leaves the stage rail and is listed in the Project's Trash list with its stage. The Project page MUST show a stage rail with each run's stage. A Project MUST end with Done; Archive MUST be offered after Done and MUST NOT be required. (D-W3, D-W7, D-W26, D-W72)
- **FR-023**: The interface MUST call a View a "processing run". It MUST label goal progress "in project" and "captured", MUST NOT say "not in a run", and MUST never show an "in project" value above its "captured" value. (D-W3, D-W36, D-W66)

### Feature ownership

The stable feature keys identify contract owners. They are not a chronological implementation order.

| Feature key | Owned behavior | Primary journey steps |
| --- | --- | --- |
| PV-LIB | Locations, indexing (including what Import lands), homogeneous sessions (including the "Trashed" filter), the Target page, Target/equipment and rig evidence, coverage | A1, A2, A3, A4, B1 |
| PV-PRJ | Projects (required for runs): subjects, rigs, derived candidates, inherited members, goals and goal templates, the effect of Project-only rejects on progress, Home dashboard, Project page with its stage rail and Trash list, Project Done / Archive sheet and its trash offers | B2, Home, Project page, Done / Archive sheet |
| PV-VSEL | Run creation inside a Project, session picker over candidates, mosaic run groups and panel assignment, run exclusions, saved membership, refresh | B4, C1, C2, C3, C4, C5, C6, D4, D5, G |
| PV-PIX | Frame review, P/X/U marks and the "Reject for this Project only" action, measurements, star details, metric imports | D1, D2, D3, D6 |
| PV-CAL | Automatic calibration matching, explanations, exceptions, master adoption | E1, E2, H4 |
| PV-PREP | Profiles, modes, paths, preparation, verified external handoff | E3, E4, F1, F2, F3, F4, F5, F6 |
| PV-RES | Result discovery, acceptance, provenance, reuse, run Complete, Move run to Trash, Restore and Empty Trash | H1, H2, H3, H3a, I1 |
| PV-STO | Import (sources, preview, Copy or Move, naming templates), run Clean up, retained-original proof, verified archive, OS Trash custody for Import Move, emptied runs, trashed frames and duplicate copies | I2, I3, I4, I5, J, L (withdrawn), Import |
| PV-PLAN | Planner on Targets, the Targets list (My targets, Browse catalogues, presets, rig selector), rig filter lists in Settings > Equipment, sites, windows, Tonight data for Home, reminders, calendar export | B3, K, Targets list |

The journey step IDs come from the product flow. Home, the Project page with its Trash list, the Done / Archive sheet, Import and the Targets list are surfaces added or redefined by the 2026-10-06 redesign; they have no product-flow step ID yet. Step L (reviewed filing) is withdrawn and Import replaces it. (D-W7, D-W11, D-W17, D-W39, D-W72)

### Cross-spec flow

The stage model of the 2026-10-06 redesign runs across the feature specs (D-W1, D-W3, D-W26):

1. Library: Import (PV-STO) or Add existing library folder, then indexing (PV-LIB); sessions appear in Sessions and on the Target page. The Planner works on the Targets list without a Project (PV-PLAN, D-W11, D-W16).
2. Project: the user creates a Project with subjects, rigs and goals, optionally from a goal template. Candidates follow from confirmed Target and rig; Home and the Project page show progress and Next (PV-PRJ, D-W30, D-W33, D-W39).
3. Each processing run, inside one Project with one subject and one rig fixed at creation, moves through these stages (D-W50):
   1. Select: session picker over candidates and saved membership (PV-VSEL). A mosaic subject creates a run group with one run per panel (D-W38).
   2. Review: frame review with library quality or Project-only reject; rejecting a frame removes it from the run's draft (PV-PIX, PV-VSEL, D-W42, D-W54).
   3. Calibrate: automatic matching with a readiness line (PV-CAL, D-W5).
   4. Prepare: verified handoff (PV-PREP).
   5. Results: discovered from the run's sibling Results folder and accepted (PV-RES, D-W4, D-W51).
   6. Done: the user marks the run Complete (PV-RES). At any stage the user can instead move a run that is no longer wanted to the Project's Trash, where it is hidden until the user restores it or empties the Trash. Moving it moves no file. Empty Trash sends its prepared folders to the OS Trash, and its Results folder only when the user ticks it (PV-RES, D-W72).
   7. Clean up: run-scoped removal of prepared links, clones and copies, offered once the run is Complete (PV-STO).
4. Project Done / Archive: the user completes or moves to Trash each open run, then marks the Project Done. The sheet offers Archive, three moves to the OS Trash (rejected frames, processing intermediates and duplicate copies) and Empty Trash for the Project's Trash. PV-PRJ owns the offers, eligibility and refusals; PV-STO executes the custody steps. A Done Project can be Reopened, even after Archive, and reopening moves no files (D-W26, D-W43, D-W46, D-W69, D-W70, D-W72, D-W74).

### Key Entities

- **Library**: Indexed files, locations, evidence, quality decisions, and relationships.
- **Session**: A metadata-homogeneous acquisition group with one rig; night grouping changes display only.
- **Catalog**: The library database of locations, files, sessions and decisions. "Catalogue" names an astronomical catalogue, as in the Targets list's Browse catalogues (PV-PLAN).
- **Target**: A sky subject or region with coverage, plans, Projects, and Results. Several objects in one field are one Target, with the others listed as aliases or "also in field". (D-W9)
- **Rig**: An optical train. A Project lists the rigs taking part; each run uses one. (D-W37)
- **Project**: The required container for processing runs. It holds one or more subjects (Targets or mosaics), its rigs, goals per subject and channel, Project-only rejects, and an open or Done state; a Done Project can be Reopened, even after Archive. Its candidates are derived and its members are inherited from its runs. (D-W1, D-W9, D-W33, D-W34, D-W46, D-W69)
- **Processing run (View)**: Named reviewed input membership with one Project, and one subject and one rig fixed at creation, plus a stage and preparation revisions. A run that is no longer wanted can be moved to its Project's Trash, restored from it unchanged, or removed by Empty Trash; none of these changes library frames or quality decisions. Runs of one mosaic subject form a run group, one run per panel. (D-W3, D-W8, D-W38, D-W50, D-W72)
- **Result**: A manually accepted final or reusable product with actual lineage.
- **Operation**: Reviewed intent and per-item outcomes for preparation, Clean up, archive, Import, or trashing. (D-W11, D-W43)

## Success Criteria

### Measurable Outcomes

- **SC-001**: Each of the 44 interaction steps (40 numbered steps plus G, J, K, and L) has exactly one primary feature owner, and so does each redesign surface (Home, Project page, Done / Archive sheet, Import, Targets list). Journeys B, D, E, H, and I span owning features. (D-W11, D-W17, D-W39)
- **SC-002**: Indexing and review fixtures leave 100% of original paths and file bytes unchanged.
- **SC-003**: Every requested handoff input is verified or explicitly blocked; zero selected inputs disappear silently.
- **SC-004**: Given confirmed membership of the worked five-session selection, its 208 lights and 17h20m integration remain fixed across sorting, filtering, explicit saving, and restart.
- **SC-005**: Display-stretch changes produce zero changes in saved quality values or source samples.
- **SC-006**: Complete without a Result removes zero files. An unsupported-Trash fixture removes zero files even after approved cleanup.
- **SC-007**: Archive failure fixtures retain source data until destination and reference verification succeed.
- **SC-008**: Every displayed measurement has method, units, and source, or an explicit unavailable state.
- **SC-009**: In the worked fixture, zero runs exist outside a Project and zero runs contain sessions from more than one rig. (D-W1, D-W37)
- **SC-010**: In a Done / Archive trash fixture, zero Project-only rejects and zero refused frames reach the OS Trash, and zero files are permanently deleted. (D-W43)
- **SC-011**: Across Home fixtures covering each Next rule, Home shows the first applicable action every time, and no goal reads met while its "in project" value is below the goal. (D-W35, D-W36)

## Assumptions

- The linked product flow is the functional interview record. Existing implementation labels are evidence about the old application only.
- PV-LIB owns the usable local-first Sessions, Target page and Activity navigation, catalog failed-write and external-drift rules. PV-PLAN owns the Targets list and PV-PRJ owns Home. PV-PREP owns external-launch lifecycle separation; PV-STO owns Import, no-follow cleanup and reviewed collisions. Baseline preservation is verified against source commit `94a3dc958c13e297baf501aa2721efa2c2628622` and the separately retained dirty review worktree, not through a user-interface assertion. (D-W11, D-W17, D-W39)
- Existing preparation-mode and platform scope remains intact. A delivery slice does not redefine release scope.
- Pixel review and scientific measurement are read-only; the product does not produce calibrated, registered, integrated, or stretched output images.
- Optional future capabilities listed in the product flow remain deferred.

## Scoped decisions before feature approval

The user authorized conservative product defaults and, on 2026-10-04, waived every repository human-approval gate with no human signoff. The [autonomous objective](autonomous-objective.md) records the instruction; the [decision register](decisions.md) records defaults. Analysis, tests, independent exact-head review, Sniff and original-file protection remain required.

| Decision area | Consuming owners |
| --- | --- |
| Candidate rule and geometry use (D01 as amended by D-W33, D-W37, D-W38) | PV-VSEL, PV-PRJ |
| Untouched-frame inclusion default | PV-VSEL |
| Raw/CFA and imported measurement semantics | PV-PIX |
| Exact profile and per-item input-mode support | PV-PREP, PV-RES |
| Adopted master storage | PV-CAL |
| Archive failure sequencing | PV-STO |
| Reminder defaults and app-closed behavior | PV-PLAN |
| Draft persistence and concurrent edits | PV-VSEL |
| Run revisions, retries, reopening, and completion blockers | PV-VSEL, PV-PREP, PV-RES, PV-STO |
| Quality precedence and Project progress (D10 as amended by D-W36, D-W42, D-W44, D-W66, D-W72) | PV-LIB, PV-PRJ, PV-VSEL |
| Content-bound consumption of recorded files | All feature owners |
| Workflow redesign 2026-10-06 (D-W1 through D-W74) | All feature owners |

The existing constitution prohibits debayering. A raw/CFA review specification must define supported read-only channel handling or seek an explicit constitutional amendment before adding debayered preview behavior.

## Autonomous acceptance

The [approved objective](autonomous-objective.md) requires all non-deferred requirements in specs 064 through 072, backend integration and restart proof, followed by a clean-slate frontend. A functional Tauri MCP bridge is mandatory in development builds and is the means of application verification. Production MCP shipping is an optional future feature. After five failed fixes per issue, record a reproducible deferred backlog item and continue independent work; there is no global time cap.
