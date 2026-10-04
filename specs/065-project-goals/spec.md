# Feature Specification: Optional Projects and capture checklist

**Feature Branch**: `063-clean-rebuild-contract`

**Spec ID**: `065-project-goals`

**Created**: 2026-10-03

**Status**: Draft; product defaults recorded in D01 through D18 under the user-authorized specification-gate waiver. Requirements analysis, implementation and verification remain pending.

**Input**: Clean rebuild with selective reuse of verified code and the agreed PlateVault product flow.

## User Scenarios & Testing

### User Story 1 - Optional Projects and capture checklist (Priority: P1)

Named goals spanning Targets, panels, equipment, and capture sites, with optional checklist progress and no side effects.

**Why this priority**: This feature owns the workflow steps listed below without imposing unrelated product features.

**Independent Test**: Exercise the acceptance scenarios through the running product with isolated inputs. Existing baseline code does not prove the redesigned behavior.

**Acceptance Scenarios**:

- **PRJ-AC-01**: Given the NGC 7000 Target, when the user creates 'NGC 7000 HOO' with Ha 10h and OIII 10h items, then NGC 7000 is prefilled and each item shows captured and usable progress per channel.
- **PRJ-AC-02**: Given a Project is created and edited, then no file changed, no View exists, and every frame's quality state is unchanged.
- **PRJ-AC-03**: Given Project-accepted Ha integration reaches its 10h goal, when progress is recalculated, then that item shows met and the Project stays open; captured and library-usable totals remain separately labelled.
- **PRJ-AC-04**: Given linked sessions from Backyard and a second site, then the Project shows both sessions with their own capture sites and has no single-site field.
- **PRJ-AC-05**: Given an unmet checklist, when Create View is chosen, then the View can be created without changing the goal or closing the Project.
- **PRJ-AC-06**: Given explicitly linked sessions and accepted products, when the Projects surface opens, then their identities, capture sites, associated Views and products are shown. Editing the Project or its equipment does not change existing View membership.
- **PRJ-AC-07**: Given integration, exposure-preference and calibration checklist items, when progress is calculated, then integration shows captured and library-usable hours separately, while exposure/calibration show criterion evidence or unknown rather than fabricated hour totals.
- **PRJ-AC-08**: Given a library-Usable frame in a session explicitly linked to a Project, when it is rejected only for that Project, then Project-accepted progress decreases while captured and library-usable totals remain unchanged. A library-Unreviewed frame contributes to captured progress but not Project-accepted progress.

### Edge Cases

The [root contract](../063-clean-rebuild-contract/spec.md) governs file custody, uncertainty, exact membership, failed writes, and independent lifecycle decisions. Each acceptance scenario tests observable outcomes; no mock acknowledgment counts as terminal success.

## Requirements

### Functional Requirements

- **PRJ-FR-01**: New Project takes a name, optional notes, a prefilled Target, and further Targets or explicit mosaic panels under root decisions D01 and D12. A Project is never required for library inspection or View creation.
- **PRJ-FR-02**: The Project records the equipment chosen for initial session preselection, which VSEL consumes.
- **PRJ-FR-03**: Optional checklist items include desired integration per channel, frame count, exposure preference, panel coverage, equipment and missing calibration. Each item names its criterion and progress basis.
- **PRJ-FR-04**: Integration and frame-count goals show captured, library-usable and Project-accepted progress separately. Project-accepted progress is the fixed met-goal basis: library-Usable frames not rejected for this Project. Other checklist kinds show evidence or unknown. An unmet item never blocks creating a View, and a met checklist never closes the Project automatically.
- **PRJ-FR-05**: Creating or editing a Project writes only catalog goals and associations: no file changes, no View generation, no quality-state changes.
- **PRJ-FR-06**: A Project has no single capture site; its sessions keep their own capture sites.
- **PRJ-FR-07**: The Projects surface lists goals, checklists, linked sessions, Views, and accepted products.
- **PRJ-FR-08**: Session linkage is explicit and inspectable. Project edits, checklist changes and linkage changes never rewrite source files, library quality decisions, or existing fixed View membership.

### Owned interaction steps

- B2
- Projects surface

### Key Entities

Use the [root vocabulary](../063-clean-rebuild-contract/spec.md#key-entities). Feature-specific evidence and decisions retain their input identity, scope, and revision.

## Success Criteria

### Measurable Outcomes

- **PV-PRJ-SC-01**: Every acceptance scenario produces its stated outcome and refusal behavior.
- **PV-PRJ-SC-02**: Every owned interaction step has a requirement and independently observable acceptance evidence.
- **PV-PRJ-SC-03**: Original inputs remain unchanged except through separately reviewed and approved filesystem operations.

## Assumptions

- [Product flow](../../docs/reviews/2026-10-03-product-flow-and-journeys.md) supplies the confirmed interactions and illustrative worked example.
- This feature is independently specified; dependencies on other feature contracts are resolved in planning.
- Conservative product defaults and human specification-gate waivers are authorized for this run. The root decision register applies; tests, requirements analysis, independent review and delivery checks remain mandatory.

## Decisions before feature approval

- Root decisions D01, D10 and D12 define framing, checklist kinds/progress basis and explicit Project-session linkage. Automatic geometry remains subject to qualified evidence.
