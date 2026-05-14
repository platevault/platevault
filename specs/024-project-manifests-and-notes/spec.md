# Feature Specification: Project Manifests And Notes

**Feature Branch**: `024-project-manifests-and-notes`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify project manifests, manifest checkpoints, and notes as app-owned documentation for projects and generated source views."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generate Project Manifest (Priority: P1)

As a user, I want a project manifest that documents the sources, calibration choices, workflow resources, generated views, and project state so that project setup is reproducible.

**Why this priority**: Project creation/onboarding needs a durable documentation artifact without turning generated files into source truth.

**Independent Test**: Create a project from reviewed Inventory items and confirm a manifest record captures selected lights, flats, darks, bias, workflow, project resources, and generated source views.

**Acceptance Scenarios**:

1. **Given** a project is created, **When** resources are generated, **Then** a manifest checkpoint is recorded.
2. **Given** project sources change, **When** the project is updated, **Then** a new manifest checkpoint records the changed source map.
3. **Given** a manifest is exported, **When** the user opens it, **Then** it clearly marks itself as generated documentation.

---

### User Story 2 - Keep Project Notes (Priority: P2)

As a user, I want project notes to live with the project record so that processing context, assumptions, and cleanup decisions are preserved.

**Why this priority**: Notes were part of the story inventory and are distinct from logs and manifests.

**Independent Test**: Add notes to a project, edit them after project state changes, and confirm notes appear in project detail and manifest checkpoints where appropriate.

**Acceptance Scenarios**:

1. **Given** a project exists, **When** a note is added, **Then** it is visible in project detail.
2. **Given** a note is edited, **When** the edit saves, **Then** audit metadata records the change.
3. **Given** a manifest checkpoint is created, **When** notes are included, **Then** the checkpoint identifies which notes snapshot was used.

### Edge Cases

- Manifest export path already exists.
- Project source changes after manifest generation.
- Note contains paths or multiline processing instructions.
- User onboards a project with an existing manifest.
- Manifest export fails after project state is saved.

### Domain Questions To Resolve

- Final manifest file format and filename.
- Whether notes are included directly in exported manifests or referenced by id.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Project manifest checkpoints MUST document project source mappings, calibration choices, workflow profile, generated source views, and project lifecycle state.
- **FR-002**: Manifests MUST be generated documentation, not canonical source truth.
- **FR-003**: Project notes MUST be editable from project detail or Edit project.
- **FR-004**: Note changes MUST be auditable.
- **FR-005**: Manifest exports MUST record success or failure.
- **FR-006**: Onboarding an existing project MUST detect existing manifest-like files and ask how to handle them.
- **FR-007**: Manifest checkpoints MUST reference Inventory and project records by stable ids where available.

### Key Entities

- **Project Manifest**: Generated project documentation artifact or stored checkpoint.
- **Manifest Checkpoint**: Versioned record of project source map and lifecycle state.
- **Project Note**: User-authored project documentation with audit metadata.
- **Manifest Export Event**: Log/audit event for manifest write attempt.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can inspect a project manifest checkpoint and understand which Inventory items were used.
- **SC-002**: Notes remain attached after project source mappings change.
- **SC-003**: Failed manifest exports are visible in logs and do not corrupt project state.

## Assumptions

- Project records live in the local store.
- Exported manifests may be regenerated from the database.

## Out of Scope

- Rich text note editing.
- Remote documentation publishing.
