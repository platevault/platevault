# Feature Specification: Native Filesystem Controls

**Feature Branch**: `004-native-filesystem-controls`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Replace prototype file/folder workarounds with native Tauri controls for choosing directories, choosing master files, revealing locations, and validating selected paths."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Choose Source Directories (Priority: P1)

As an astrophotographer setting up sources, I want source roots to use native directory selection so that I cannot accidentally choose files for source roots.

**Why this priority**: Source roots define future scans and ingestion boundaries.

**Independent Test**: Select a raw source, calibration source, and project source using the native picker and confirm only directories are accepted.

**Acceptance Scenarios**:

1. **Given** a source root field, **When** the user opens the picker, **Then** the picker allows directory selection only.
2. **Given** a chosen directory, **When** the selection returns, **Then** the source table stores and displays the selected directory path.

---

### User Story 2 - Choose Master Files (Priority: P2)

As a user adding an existing master calibration, I want the file picker to allow only supported image files so that master paths cannot point to arbitrary folders or unsupported files.

**Why this priority**: Master calibration uses file semantics while source roots use directory semantics.

**Independent Test**: Add a master dark and confirm only `.fits`, `.xisf`, and `.tiff` filters are offered, with the combined filter selected by default.

**Acceptance Scenarios**:

1. **Given** a master toggle is enabled, **When** the picker opens, **Then** it selects files only.
2. **Given** the file filter dropdown, **When** the picker opens, **Then** FITS, XISF, TIFF, and combined filters are available.

---

### User Story 3 - Reveal Item Locations (Priority: P3)

As a user reviewing Inbox, Inventory, or Project items, I want `Open location` to reveal the selected file or folder in the OS file browser.

**Why this priority**: Current prototype actions only show notes and do not perform the expected desktop action.

**Independent Test**: Click `Open location` on an Inbox item, Inventory item, and Project and confirm the OS file browser opens at the right location.

**Acceptance Scenarios**:

1. **Given** an item with a valid path, **When** the user chooses `Open location`, **Then** the OS file browser reveals that path.
2. **Given** an item with a missing path, **When** the user chooses `Open location`, **Then** the app shows a non-destructive error and logs the failure.

### Edge Cases

- Path no longer exists.
- File reveal is requested for a folder and folder reveal is requested for a file.
- Permission denied from OS picker or reveal command.
- Windows, macOS, and Linux reveal behavior differs.

### Domain Questions To Resolve

- Which Tauri plugin/API is canonical for file dialogs and path reveal?
- Should reveal failures create user-facing notifications, log entries, or both?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Source root selection MUST use a native directory picker.
- **FR-002**: Source root selection MUST reject files.
- **FR-003**: Master calibration selection MUST use a native file picker.
- **FR-004**: Master calibration file selection MUST offer FITS, XISF, TIFF, and combined filters.
- **FR-005**: `Open location` MUST use a native OS reveal/open-location action.
- **FR-006**: Failed picker or reveal operations MUST be logged with request id and entity metadata.
- **FR-007**: The UI MUST remove prototype upload-style controls where native Tauri controls are available.

### Key Entities

- **Source Root Selection**: A selected directory path and source role.
- **Master File Selection**: A selected file path, frame type, and extension filter.
- **Reveal Operation**: A request to reveal a known path in the OS file browser.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users cannot select files for source roots in supported desktop builds.
- **SC-002**: Users can reveal paths from Inbox, Inventory, and Projects in one action.
- **SC-003**: Missing-path reveal failures show a clear error without mutating app state.
- **SC-004**: All prototype comments for native picker/reveal workarounds are removed or mapped to implemented Tauri controls.

## Assumptions

- Tauri desktop runtime is available for production builds.
- Browser-only prototype fallback may remain for local dev but must be clearly separated from production behavior.

## Out of Scope

- Moving, deleting, or modifying selected files.
- Batch filesystem operations.
