# Feature Specification: Project Create, Onboard, And Edit

**Feature Branch**: `008-project-create-onboard-edit`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify project creation and onboarding as a single project setup/edit flow that creates required resources, sources, folder structure, and project markers without separate envelope/source-generation actions."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create A Project (Priority: P1)

As a user, I want project creation to ask for required project information once and create the necessary app-owned resources so that I do not need separate technical actions like creating an envelope or retrying marker writes.

**Why this priority**: Project setup is a core workflow and must use simple functional naming.

**Independent Test**: Start Add project, provide path, project name, project type/workflow, light sessions, optional flats, darks, and bias, then confirm the app creates the project record, folder structure, project marker, and source mappings.

**Acceptance Scenarios**:

1. **Given** required project fields are valid, **When** the user creates the project, **Then** folder structure, source mappings, workflow resources, and project marker are created as one operation.
2. **Given** any creation step fails, **When** the operation stops, **Then** the app rolls back created resources where possible, logs an error, and notifies the user.
3. **Given** project creation succeeds, **When** the project opens, **Then** sources are listed directly and can be opened or inspected.

---

### User Story 2 - Onboard An Existing Project (Priority: P2)

As a user, I want to onboard an existing project folder by identifying its project information and source locations so that existing work can be tracked without recreating it.

**Why this priority**: Users already have PixInsight/Siril project structures and local folders.

**Independent Test**: Select an existing folder, provide required metadata and source mappings, and confirm the app links existing resources without duplicating them.

**Acceptance Scenarios**:

1. **Given** an existing project folder, **When** the user onboards it, **Then** the app detects or asks for source locations and creates missing app-owned tracking records.
2. **Given** a project marker already exists, **When** onboarding runs, **Then** the app reuses it or asks for confirmation if it conflicts.
3. **Given** existing source paths are missing, **When** onboarding is reviewed, **Then** the app blocks completion until required mappings are resolved or skipped intentionally.

---

### User Story 3 - Edit Project Settings (Priority: P3)

As a user, I want all project setup fields to be editable from one project settings pane so that I do not hunt for separate actions.

**Why this priority**: The user explicitly rejected separate project envelope, prepared source, marker retry, and source mapping actions.

**Independent Test**: Open Edit project and update name, path, workflow, source mappings, light sessions, flats, darks, bias, and tool settings from one pane.

**Acceptance Scenarios**:

1. **Given** a project exists, **When** the user opens Edit project, **Then** all setup fields are visible in one structured pane.
2. **Given** a user changes source mapping, **When** the edit is saved automatically or confirmed, **Then** dependent generated resources update through a single operation.

### Edge Cases

- Project path already contains files.
- Project marker write fails.
- Folder structure creation partially succeeds.
- Source mapping points to a missing Inventory item.
- User adds multiple light sessions with different optional flats.

### Domain Questions To Resolve

- Which project types/workflows are available at first release?
- Which generated resources are required for PixInsight versus Siril?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Project creation MUST use functional labels such as Add project, Edit project, Open, and Open in PixInsight/Siril.
- **FR-002**: Project creation MUST collect project path, project name, project type/workflow, and required source mappings.
- **FR-003**: Project creation MUST support one or more light sessions.
- **FR-004**: Each light session MUST allow an optional flats source.
- **FR-005**: Project creation MUST collect darks and bias separately.
- **FR-006**: Initial project setup MUST NOT expose dark flats unless a later workflow explicitly enables them.
- **FR-007**: Project creation MUST create required folder structure, project marker, and workflow resources as part of the operation.
- **FR-008**: Project creation MUST roll back, log, and notify on failure.
- **FR-009**: Onboarding MUST support existing project folders.
- **FR-010**: Project edit MUST be a single pane for project fields and source mappings.
- **FR-011**: Technical actions named Create project envelope, Generate/update prepared sources, Project label, or Retry marker write MUST NOT appear as normal user actions.

### Key Entities

- **Project**: App-owned work unit with name, path, workflow, lifecycle state, and sources.
- **Project Source Mapping**: Link from project role to one or more Inventory items or source folders.
- **Light Session**: Light frames plus optional flats for that session.
- **Project Marker**: App-owned file/record identifying the project folder.
- **Project Setup Operation**: Atomic create or onboard operation with rollback metadata.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first project can be created from confirmed sample Inventory items without invoking any separate technical actions.
- **SC-002**: Project creation failures produce a visible notification and log entry.
- **SC-003**: Editing a project never requires leaving the project settings pane to update source mappings.
- **SC-004**: Users can add at least two light sessions with different optional flats.

## Assumptions

- Initial project creation happens in the guided first-project flow after first-run source setup.
- Workflow-specific generated files are app-owned projections.

## Out of Scope

- Actual image processing.
- Remote project sync.
- Full processing-tool automation.
