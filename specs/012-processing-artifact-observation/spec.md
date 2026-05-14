# Feature Specification: Processing Artifact Observation

**Feature Branch**: `012-processing-artifact-observation`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify how the app observes outputs from PixInsight, Siril, planetary/lunar tools, and future workflow profiles without becoming the processing tool."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Observe Processing Outputs (Priority: P1)

As a user, I want the app to notice processing outputs and associate them with projects so that project lifecycle and archive decisions include generated artifacts.

**Why this priority**: The app prepares and observes processing work but does not process images itself.

**Independent Test**: Add representative output files to a project folder and confirm the app records them as processing artifacts linked to the project.

**Acceptance Scenarios**:

1. **Given** a project folder contains supported workflow outputs, **When** the project is scanned, **Then** artifacts are recorded with type, path, workflow, and observation source.
2. **Given** an artifact is inferred from naming or folder placement, **When** it is shown in detail, **Then** the inference is separate from reviewed project state.
3. **Given** an artifact is deleted outside the app, **When** the project is rescanned, **Then** the artifact state becomes missing or stale rather than silently disappearing.

---

### User Story 2 - Use Workflow Profiles (Priority: P2)

As a user, I want artifact observation to be driven by workflow profiles so that PixInsight, Siril, and future tools can use different expected folders and outputs.

**Why this priority**: Hardcoding PixInsight would contradict the product boundary.

**Independent Test**: Configure a PixInsight project and a Siril project with different artifact rules and confirm each observes the expected output taxonomy.

**Acceptance Scenarios**:

1. **Given** a PixInsight project, **When** outputs are scanned, **Then** PixInsight-specific artifact categories are recognized.
2. **Given** a Siril project, **When** outputs are scanned, **Then** Siril-specific artifact categories are recognized without PixInsight labels.
3. **Given** an unknown workflow artifact appears, **When** it is shown, **Then** the user can review or ignore it without breaking the project.

### Edge Cases

- Tool output folders contain temporary files.
- Same artifact appears under multiple names or symbolic links.
- Artifact naming conflicts with source data.
- Workflow profile rules are updated after artifacts were observed.
- Large output folders need incremental scanning.

### Domain Questions To Resolve

- Exact first-release artifact categories for PixInsight.
- Minimum Siril artifact taxonomy for first release.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST observe processing artifacts as project-linked data.
- **FR-002**: Artifact observation MUST preserve the distinction between observed files and reviewed project state.
- **FR-003**: Artifact rules MUST be defined by workflow profile.
- **FR-004**: PixInsight-specific artifact naming MUST NOT leak into non-PixInsight projects.
- **FR-005**: Artifact state MUST support present, missing, stale, ignored, and reviewed states or equivalent final vocabulary.
- **FR-006**: Observed artifacts MUST be included in project lifecycle and cleanup/archive planning.
- **FR-007**: The app MUST NOT process images or replace external processing tools.

### Key Entities

- **Processing Artifact**: Output file or folder observed under a project.
- **Artifact Rule**: Workflow-profile rule for recognizing artifact paths and types.
- **Artifact State**: Current review and availability state of an artifact.
- **Workflow Profile**: Tool or process-specific rules for prepared sources and artifacts.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: PixInsight and Siril artifact rules can coexist without UI hardcoding.
- **SC-002**: A project detail view can list observed artifacts by type and state.
- **SC-003**: Missing artifacts remain auditable after rescan.

## Assumptions

- Processing tools own actual processing.
- Project artifact observation is local filesystem based.

## Out of Scope

- Running workflow scripts.
- Editing processing outputs.
- Uploading artifacts to remote services.
