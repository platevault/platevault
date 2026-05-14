# Feature Specification: Bottom Log Viewer

**Feature Branch**: `019-bottom-log-viewer`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify the log viewer as a full-width bottom fold-out panel with log level and remembered follow behavior, not a focus rail."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open Logs Without Losing Context (Priority: P1)

As a user, I want logs to open at the bottom of the app and consume application space so that I can inspect operation messages while keeping the current workspace visible.

**Why this priority**: Logs were explicitly moved out of the side/focus area and into a bottom fold-out.

**Independent Test**: Trigger an operation, open the log panel, and confirm it expands full-width across the bottom while resizing the workspace above it.

**Acceptance Scenarios**:

1. **Given** the log panel is closed, **When** the user opens it, **Then** it expands across the full bottom section.
2. **Given** the panel is open, **When** it expands, **Then** it takes vertical space from the app rather than floating over content.
3. **Given** the current page has selected details, **When** logs open, **Then** selection context remains unchanged.

---

### User Story 2 - Filter Log Noise (Priority: P2)

As a user, I want to choose a log level and optionally follow live logs so that I can troubleshoot without leaving the workflow.

**Why this priority**: Log controls should be useful but not expose irrelevant internal toggles.

**Independent Test**: Change the log level, toggle follow logs, close and reopen the panel, and confirm the follow preference is remembered.

**Acceptance Scenarios**:

1. **Given** logs include info, warning, and error events, **When** a log level is selected, **Then** the panel filters to that level and above.
2. **Given** follow logs is toggled, **When** the panel is closed and reopened, **Then** the chosen follow state is remembered.
3. **Given** a log event is shown, **When** metadata is inspected, **Then** request id and entity metadata are present without needing a setting.

### Edge Cases

- Thousands of log events.
- Logs arrive while panel is closed.
- User filters to a level with no entries.
- Operation fails while panel is collapsed.
- Reduced-motion users open and close the panel.

### Domain Questions To Resolve

- Maximum retained log lines in the UI.
- Whether logs are persisted across app restarts.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Logs MUST be shown in a full-width bottom fold-out panel.
- **FR-002**: Opening logs MUST consume app layout space instead of overlaying important content.
- **FR-003**: The panel MUST include log level filtering.
- **FR-004**: Follow logs MUST be a panel control whose last state is remembered.
- **FR-005**: Settings MUST NOT include "follow logs by default".
- **FR-006**: Request id and entity metadata MUST always be available in log entries.
- **FR-007**: Log export, if offered, MUST use JSON and MUST NOT expose export format as a user setting.
- **FR-008**: Logs MUST use functional labels and avoid "rail" terminology.

### Key Entities

- **Log Entry**: Timestamped event with level, message, request id, entity metadata, and optional operation id.
- **Log Level Filter**: UI state controlling visible severity.
- **Follow State**: Remembered preference for auto-scrolling to new log events.
- **Operation Log Context**: Request/entity metadata linked to actions and lifecycle events.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can open logs from any main page without losing the selected item.
- **SC-002**: The panel can show representative operation failures without layout overlap.
- **SC-003**: Log level and follow behavior work with keyboard navigation.

## Assumptions

- Logs are local and tied to audit/operation events.
- The bottom panel appears within the desktop app shell.

## Out of Scope

- Remote log streaming.
- Arbitrary export formats.
