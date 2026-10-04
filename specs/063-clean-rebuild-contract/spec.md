# Feature Specification: Clean rebuild product contract

**Feature Branch**: `063-clean-rebuild-contract`

**Created**: 2026-10-03

**Status**: Draft; conservative product decisions and all human-approval gate waivers are authorized. Requirements analysis and implementation verification remain required.

**Input**: Rebuild PlateVault cleanly, preserve the old code as a recoverable reference, and reuse code where it satisfies the agreed product contract.

The [product flow](../../docs/reviews/2026-10-03-product-flow-and-journeys.md) supplies the interaction details and worked example. This specification defines shared behavior and feature ownership. It does not authorize product implementation or claim that the redesigned flows run.

## User Scenarios & Testing

### User Story 1 - Inspect captures without reorganizing files (Priority: P1)

The user registers capture folders and inspects their sessions while indexing proceeds. A Project and a processing application are optional.

**Why this priority**: Library inspection is the first useful workflow and requires no file mutation.

**Independent Test**: Register a capture folder, index its headers, and inspect sessions without creating a Project or a View.

**Acceptance Scenarios**:

1. **Given** only a Captures location, **When** onboarding continues without Calibration or Results locations, **Then** indexing is available and the omitted roles show as unset.
2. **Given** Ha and OIII captures from one night, **When** indexing completes, **Then** separate metadata-homogeneous sessions appear; grouping the display by night preserves those boundaries.
3. **Given** a registered folder, **When** indexing and catalog corrections complete, **Then** source paths and bytes remain unchanged.
4. **Given** an unreadable descendant or an offline location, **When** indexing runs, **Then** its unobserved files retain last-observed information and show uncertainty rather than Missing.

### User Story 2 - Review a standalone input selection (Priority: P1)

The user selects sessions and frames, saves a View, and prepares exact inputs for an external application. Selection and quality decisions have separate scopes.

**Why this priority**: An exact handoff makes library inspection useful without imposing Project administration.

**Independent Test**: Create a standalone View from selected sessions, review its membership, prepare supported inputs, and open the application after verification.

**Acceptance Scenarios**:

1. **Given** selected sessions, **When** filters, sort order, or paging change, **Then** the selected identities remain fixed and hidden selected rows are counted.
2. **Given** six excluded frames, **When** the View is saved, **Then** those files remain on disk and other Views and library quality decisions remain unchanged.
3. **Given** a Direct-source View, **When** a tool would consume excluded files through a whole-folder handoff, **Then** that handoff is refused and supported alternatives are shown.
4. **Given** selected inputs become unreadable during preparation, **When** the operation settles, **Then** blocked inputs are named and verified Open is unavailable.
5. **Given** a destination collision, **When** preparation is reviewed, **Then** unrelated existing entries remain unchanged and require another path or a revised plan.

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

The user accepts reusable products, marks a processing attempt Complete, and chooses cleanup or archive independently.

**Why this priority**: Completion must not hide unaccepted outputs or authorize file removal.

**Independent Test**: Complete a View with no Result, review its cleanup, and interrupt an archive transfer using disposable fixtures.

**Acceptance Scenarios**:

1. **Given** no accepted Result, **When** the user marks processing complete, **Then** the View becomes Complete and no cleanup starts.
2. **Given** accepted products and unknown files, **When** cleanup opens, **Then** protected products remain in Keep and unknown files remain unselected.
3. **Given** a location without safe OS Trash support, **When** approved cleanup runs, **Then** affected files are retained and no permanent-delete fallback executes.
4. **Given** an archive verification or reference-repair failure, **When** transfer settles, **Then** sources are retained and completed, pending, and uncertain phases remain visible.

### User Story 5 - Plan observing independently of processing (Priority: P2)

The user chooses a planning site, reviews observing windows, and explicitly opts into reminders or exports a calendar snapshot.

**Why this priority**: Planning supports capture goals without changing library membership or starting processing.

**Independent Test**: Switch planning sites, enable default-site reminders explicitly, and export selected windows.

**Acceptance Scenarios**:

1. **Given** sessions from multiple capture sites, **When** the planning site changes, **Then** session sites and Project membership remain unchanged.
2. **Given** reminders disabled, **When** the user browses plans, **Then** no reminders or indexing jobs start.
3. **Given** selected observing windows, **When** calendar export is confirmed, **Then** the snapshot contains exactly those windows with the displayed site and time-zone basis.

### Edge Cases

- Missing OBJECT never substitutes for missing coordinates or controls capture identity.
- Unknown geometry does not become zero distance or automatic inclusion.
- Failed catalog writes remain visibly unsaved with Retry.
- Start acknowledgments do not imply durable operation success.
- Refresh never removes an offline member as though it were absent.
- Source corrections never patch originals or write through prepared links.
- Cleanup never follows link targets or removes the last retained copy without proof.
- External application exit does not imply processing success or View completion.

## Requirements

### Functional Requirements

- **FR-001**: The product MUST allow indexing in place without a Project, a processing profile, or compulsory file organization.
- **FR-002**: Sessions MUST group homogeneous capture evidence. OBJECT is a label or filter; Target enrichment MUST NOT change capture identity.
- **FR-003**: A View MUST retain reviewed input identities independently of browsing filters and an optional Project. Refresh MUST present changes for approval.
- **FR-004**: Preparation MUST account for every selected input. Unsupported modes, missing inputs, and collisions MUST have explicit outcomes without silent omission or fallback.
- **FR-005**: Direct-source handoff MUST pass exact reviewed membership without staging. Profiles that can write into inputs, or whose input-write behavior is unknown, MUST refuse Linked and Direct-source handoff and offer isolated Copy or supported Clone instead.
- **FR-006**: Catalog quality decisions, View exclusions, and Project rejection MUST have explicit scopes. Measurements MUST NOT make those decisions automatically.
- **FR-007**: Pixel review MUST retain scientific input semantics and invalid-sample evidence. Measurement MUST use linear samples independently of display stretch.
- **FR-008**: Measurements MUST identify method, units, source, and input basis. Failed fits MUST remain failures; imported values MUST NOT silently replace built-in values.
- **FR-009**: Observed artifacts, accepted Results, reusable masters, and Complete MUST remain separate states. Complete MUST require neither a Result nor cleanup.
- **FR-010**: Cleanup MUST operate on approved View-scoped entries through OS Trash. Unsafe or unavailable Trash MUST retain affected files without permanent deletion.
- **FR-011**: Archive and reviewed filing MUST verify destinations and affected references before source retirement. Interruption MUST preserve recoverable phases and fixed membership.
- **FR-012**: Failed writes and incomplete operations MUST remain visible. Unknown, unreadable, and offline evidence MUST NOT be represented as absence or success.
- **FR-013**: Projects MUST remain optional goals with independent capture checklists. Meeting a checklist MUST NOT complete a Project automatically.
- **FR-014**: Planning-site selection, capture sites, and Project membership MUST remain independent. Reminders MUST require opt-in and name the default site.
- **FR-015**: Core library use MUST remain local-first without an account. External applications own calibration, registration, integration, and final image production.
- **FR-016**: The old application and existing uncommitted work MUST remain recoverable during rebuilding. Source-code reuse MUST NOT imply importing old catalog decisions.

### Feature ownership

The stable feature keys identify contract owners. They are not a chronological implementation order.

| Feature key | Owned behavior | Primary journey steps |
| --- | --- | --- |
| PV-LIB | Locations, indexing, homogeneous sessions, Target/equipment evidence, coverage | A1, A2, A3, A4, B1 |
| PV-PRJ | Optional Projects and capture checklists | B2 |
| PV-VSEL | Selection workspace, geometry, scoped quality, saved membership, refresh | B4, C1, C2, C3, C4, C5, C6, D4, D5, G |
| PV-PIX | Pixel review, measurements, star details, metric imports | D1, D2, D3, D6 |
| PV-CAL | Calibration suggestions, explanations, exceptions, master adoption | E1, E2, H4 |
| PV-PREP | Profiles, modes, paths, preparation, verified external handoff | E3, E4, F1, F2, F3, F4, F5, F6 |
| PV-RES | Result discovery, acceptance, provenance, reuse, Complete | H1, H2, H3, H3a, I1 |
| PV-STO | Selectable cleanup, retained-original proof, verified archive, filing | I2, I3, I4, I5, J, L |
| PV-PLAN | Sites, windows, reminders, calendar export | B3, K |

### Key Entities

- **Library**: Indexed files, locations, evidence, quality decisions, and relationships.
- **Session**: A metadata-homogeneous acquisition group; night grouping changes display only.
- **Target**: A sky subject or region with coverage, plans, Projects, and Results.
- **Project**: An optional goal spanning Targets, panels, equipment, and capture sites.
- **View**: Named reviewed input membership with optional Project and preparation revisions.
- **Result**: A manually accepted final or reusable product with actual lineage.
- **Operation**: Reviewed intent and per-item outcomes for preparation, cleanup, archive, or filing.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Each of the 44 interaction steps (40 numbered steps plus G, J, K, and L) has exactly one primary feature owner. Journeys B, D, E, H, and I span owning features.
- **SC-002**: Indexing and review fixtures leave 100% of original paths and file bytes unchanged.
- **SC-003**: Every requested handoff input is verified or explicitly blocked; zero selected inputs disappear silently.
- **SC-004**: Given confirmed membership of the worked five-session selection, its 208 lights and 17h20m integration remain fixed across sorting, filtering, explicit saving, and restart.
- **SC-005**: Display-stretch changes produce zero changes in saved quality values or source samples.
- **SC-006**: Complete without a Result removes zero files. An unsupported-Trash fixture removes zero files even after approved cleanup.
- **SC-007**: Archive failure fixtures retain source data until destination and reference verification succeed.
- **SC-008**: Every displayed measurement has method, units, and source, or an explicit unavailable state.

## Assumptions

- The linked product flow is the functional interview record. Existing implementation labels are evidence about the old application only.
- PV-LIB owns the usable local-first Targets/Sessions/Activity navigation, catalog failed-write and external-drift rules. PV-PREP owns external-launch lifecycle separation; PV-STO owns no-follow cleanup and reviewed collisions. Baseline preservation is verified against source commit `94a3dc958c13e297baf501aa2721efa2c2628622` and the separately retained dirty review worktree, not through a user-interface assertion.
- Existing preparation-mode and platform scope remains intact. A delivery slice does not redefine release scope.
- Pixel review and scientific measurement are read-only; the product does not produce calibrated, registered, integrated, or stretched output images.
- Optional future capabilities listed in the product flow remain deferred.

## Scoped decisions before feature approval

The user authorized conservative product defaults and, on 2026-10-04, waived every repository human-approval gate with no human signoff. The [autonomous objective](autonomous-objective.md) records the instruction; the [decision register](decisions.md) records defaults. Analysis, tests, independent exact-head review, Sniff and original-file protection remain required.

| Decision area | Consuming owners |
| --- | --- |
| Geometry and standalone preselection defaults | PV-VSEL, PV-PRJ |
| Untouched-frame inclusion default | PV-VSEL |
| Raw/CFA and imported measurement semantics | PV-PIX |
| Exact profile and per-item input-mode support | PV-PREP, PV-RES |
| Adopted master storage | PV-CAL |
| Archive failure sequencing | PV-STO |
| Reminder defaults and app-closed behavior | PV-PLAN |
| Draft persistence and concurrent edits | PV-VSEL |
| View revisions, retries, reopening, and completion blockers | PV-VSEL, PV-PREP, PV-RES, PV-STO |
| Quality precedence and Project progress | PV-LIB, PV-PRJ, PV-VSEL |

The existing constitution prohibits debayering. A raw/CFA review specification must define supported read-only channel handling or seek an explicit constitutional amendment before adding debayered preview behavior.

## Autonomous acceptance

The [approved objective](autonomous-objective.md) requires all non-deferred requirements in specs 064 through 072, backend integration and restart proof, followed by a clean-slate frontend. A functional Tauri MCP bridge is mandatory in development builds and is the means of application verification. Production MCP shipping is an optional future feature. After five failed fixes per issue, record a reproducible deferred backlog item and continue independent work; there is no global time cap.
