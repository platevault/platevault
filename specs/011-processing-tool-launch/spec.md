# Feature Specification: Processing Tool Launch

**Feature Branch**: `011-processing-tool-launch`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify direct tool launch for project workflows, including configured paths for PixInsight, Siril, and future tools, with project-level actions."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure Tool Paths (Priority: P1)

As a user, I want to configure executable paths for supported processing tools so that project actions can open the right tool when supported by the desktop platform.

**Why this priority**: "Enable direct tool launch" is only useful when tool paths are configured per workflow.

**Independent Test**: Configure PixInsight and Siril executable paths in Settings and confirm project actions become available only for configured tools.

**Acceptance Scenarios**:

1. **Given** PixInsight path is configured, **When** a PixInsight-compatible project is selected, **Then** Open in PixInsight is available.
2. **Given** Siril path is not configured, **When** a Siril-compatible project is selected, **Then** Open in Siril is disabled or explains that setup is required.
3. **Given** a configured path no longer exists, **When** launch is attempted, **Then** the app logs the failure and shows a clear notification.

---

### User Story 2 - Launch From Project Actions (Priority: P2)

As a user, I want project rows and project details to offer Open, Edit, and Open in tool actions so that routine work is one click and alternatives stay in the More menu.

**Why this priority**: The agreed action model keeps common actions inline and alternatives grouped consistently.

**Independent Test**: Select a project and confirm Open, Edit, and configured tool launch actions appear consistently in row and detail actions.

**Acceptance Scenarios**:

1. **Given** a project has a folder path, **When** the user chooses Open, **Then** the native OS opens the project location.
2. **Given** a project has a configured workflow tool, **When** the user chooses Open in tool, **Then** the tool launches with the project path or supported project file.
3. **Given** a launch fails, **When** the failure is handled, **Then** no project state transition is recorded except a launch failure event.

### Edge Cases

- Tool executable path is missing, inaccessible, or points to the wrong app.
- Tool supports launch but not direct project-file opening.
- Multiple workflow profiles can open the same project.
- Launch command contains spaces or platform-specific path conventions.
- User disables direct launch globally.

### Domain Questions To Resolve

- Exact launch arguments for PixInsight and Siril.
- Whether workflow profiles should support multiple installed tool versions.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Settings MUST allow configuring executable paths for each supported processing tool.
- **FR-002**: Project actions MUST include Open, Edit, and Open in configured tool where applicable.
- **FR-003**: Tool launch MUST be unavailable or clearly blocked when no valid executable path is configured.
- **FR-004**: Launch failures MUST be logged with request and project metadata.
- **FR-005**: Tool launch MUST NOT mutate project lifecycle state except for audit/logging of the launch attempt.
- **FR-006**: Workflow profiles MUST remain tool-agnostic and extensible beyond PixInsight.
- **FR-007**: The app MUST use native Tauri shell/process APIs for launch in implementation.

### Key Entities

- **Processing Tool**: Supported executable such as PixInsight or Siril.
- **Tool Path Setting**: User-configured executable location and validation state.
- **Workflow Profile**: Project workflow that may support one or more processing tools.
- **Launch Attempt**: Auditable attempt to open a project in a tool.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can configure PixInsight and Siril paths without editing files.
- **SC-002**: Tool-specific project actions are visible only when meaningful for the project and configuration.
- **SC-003**: Failed launch attempts are visible in notifications and logs.

## Assumptions

- Tauri desktop is the first launch adapter.
- Processing remains outside the app boundary.

## Out of Scope

- Automating image processing.
- Installing external tools.
- Building tool-specific script editors.
