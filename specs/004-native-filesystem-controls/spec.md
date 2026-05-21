# Feature Specification: Native Filesystem Controls

**Feature Branch**: `004-native-filesystem-controls`  
**Created**: 2026-05-09  
**Last Updated**: 2026-05-20  
**Status**: Draft  
**Input**: User description: "Replace prototype file/folder workarounds with native Tauri controls for choosing directories, choosing master files, revealing locations, and validating selected paths."

## Implementation Status: NOT YET IMPLEMENTED

The only existing wiring is a stub picker in
`apps/desktop/src/features/welcome/WelcomePage.tsx` that returns canned
paths. No native picker, no Reveal-in-OS action, and no file-type filters
have been wired into the Tauri shell. Specs 003 (first-run), 005 (inbox),
006 (inventory), 008 (project create), and 017 (cleanup review) all assume
these controls exist; this feature provides them.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Choose Source Directories (Priority: P1)

As an astrophotographer registering source roots, I want directory
selection for raw, calibration, project, and inbox source roots to use
the OS-native directory picker so that I cannot accidentally choose a
file, a missing path, or a URL.

**Why this priority**: Source roots define the boundaries every
downstream scanner, matcher, and cleanup planner reads from. A wrong
root breaks all of inventory, calibration matching, and project
preparation. This is also the unblocker for spec 003 (first-run) and
the Settings "Add source" flow.

**Independent Test**: With a fresh app build, open first-run, click "Add
raw source", and verify the native directory picker opens with directory
selection only. Repeat for calibration, project, and inbox source kinds.
Cancel each picker and confirm no row is added.

**Acceptance Scenarios**:

1. **Given** a source-root field for any of `raw`, `calibration`,
   `project`, or `inbox`, **When** the user opens the picker, **Then**
   the OS-native directory picker opens with directory selection only
   (no file selection mode toggle).
2. **Given** a chosen directory, **When** the picker returns, **Then**
   the absolute, OS-canonical path is delivered to the calling form.
3. **Given** the picker is open, **When** the user cancels with
   Escape/Cmd-W/Close, **Then** the form treats the action as a no-op
   and emits no error.
4. **Given** a default path is supplied (e.g. the parent of an existing
   raw source), **When** the picker opens, **Then** the dialog opens
   anchored at that directory when supported by the host OS.

---

### User Story 2 — Choose Master Calibration Files (Priority: P2)

As a user attaching an existing master dark, master flat, master bias,
or master flat-dark, I want the file picker to offer file-type filters
limited to FITS, XISF, and TIFF so that I cannot point a master entry at
a JPEG, a sidecar text file, or a directory.

**Why this priority**: Calibration uses file semantics (the master is
one file), while source roots use directory semantics. Without filters
users can register unsupported extensions that the metadata adapter
crates will refuse to parse, causing downstream confusion.

**Independent Test**: Open the "Add master" affordance, confirm the
native file picker opens with selectable filters labeled `FITS
(*.fit, *.fits)`, `XISF (*.xisf)`, `TIFF (*.tif, *.tiff)`, and `All
supported`. Confirm `All supported` is the default. Confirm directories
cannot be chosen.

**Acceptance Scenarios**:

1. **Given** the user is adding a master calibration file, **When** the
   picker opens, **Then** it opens in file-selection mode (not
   directory mode) with the `All supported` filter active.
2. **Given** the filter dropdown, **When** the user opens it, **Then**
   `FITS`, `XISF`, `TIFF`, `All supported`, and `All files` filters are
   available in that order.
3. **Given** a default path is supplied (e.g. the calibration source
   root), **When** the picker opens, **Then** the dialog opens anchored
   at that directory when supported by the host OS.
4. **Given** a chosen file, **When** the picker returns, **Then** the
   absolute path is delivered along with the matched filter label so
   downstream code can record the user's declared frame type.

---

### User Story 3 — Reveal Item Locations In The OS File Browser (Priority: P3)

As a user reviewing an Inbox item, an Inventory row, a Project
manifest, or a calibration master, I want `Reveal in OS` (a.k.a.
`Open location`) to open the OS file browser with the target selected.

**Why this priority**: Today's prototype actions render a toast or a
note and do nothing on disk. Revealing locations is the bridge between
the app's organized view and the user's existing folder habits, and is
the lowest-risk filesystem affordance (read-only, no mutation).

**Independent Test**: Pick a row in Inbox, Inventory, and Projects.
Click `Reveal in OS` on each. Confirm the OS file browser opens at the
expected directory with the target file selected on macOS and Windows,
and at the containing directory on Linux when per-file selection is not
supported by the desktop environment.

**Acceptance Scenarios**:

1. **Given** an item with a valid existing path, **When** the user
   chooses `Reveal in OS`, **Then** the OS file browser opens and the
   target is highlighted/selected on platforms that support per-file
   reveal (macOS Finder, Windows Explorer).
2. **Given** an item with a valid path on a Linux desktop without
   per-file reveal support, **When** the user chooses `Reveal in OS`,
   **Then** the OS file browser opens at the containing directory and
   the app records that reveal-with-selection was not available.
3. **Given** an item whose path no longer exists, **When** the user
   chooses `Reveal in OS`, **Then** the app shows a non-destructive
   error (`path.not_exists`) and logs the failure with the request id
   and the entity id/kind.
4. **Given** a permission failure or command failure from the OS,
   **When** the reveal action is attempted, **Then** the app surfaces
   `os.command_failed` to the user with a copy-to-clipboard path so
   they can paste it into their file browser.

### Edge Cases

- Path no longer exists at reveal time (drive ejected, parent
  renamed).
- File reveal is requested for a folder, or folder reveal is requested
  for a file — both should succeed by revealing the actual entry.
- Permission denied by the OS picker or the reveal command.
- Windows, macOS, and Linux reveal behavior differs: macOS `open -R`
  highlights, Windows `explorer.exe /select,` highlights, Linux behavior
  depends on the desktop environment.
- Sandboxed builds where the dialog allowlist is missing the required
  capability.
- Long Windows paths (>260 chars) and UNC paths.
- Network-mounted paths that resolve slowly.

### Domain Questions To Resolve

- Should reveal failures create user-facing notifications only, audit-log
  entries only, or both? Default leans both: a toast plus a structured
  log entry.
- Should the `All supported` filter combine FITS+XISF+TIFF extensions
  into one filter row, or be exposed as a separate "Supported astro
  formats" preset?
- Should the directory picker remember the last-chosen parent per source
  kind to anchor the next open?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Source root selection MUST use the OS-native directory
  picker exposed through `@tauri-apps/plugin-dialog`.
- **FR-002**: Source root selection MUST reject files. The picker MUST
  be opened with `directory: true` and `multiple: false`.
- **FR-003**: Master calibration selection MUST use the OS-native file
  picker exposed through `@tauri-apps/plugin-dialog`.
- **FR-004**: Master calibration file selection MUST offer filters for
  FITS (`fit`, `fits`), XISF (`xisf`), TIFF (`tif`, `tiff`), an `All
  supported` combined filter (default), and an `All files` escape
  hatch.
- **FR-005**: `Reveal in OS` MUST use a native OS reveal/open-location
  action via `tauri-plugin-opener` (preferred) or `@tauri-apps/api/shell`
  with the per-platform commands specified in `research.md`.
- **FR-006**: Failed picker or reveal operations MUST be logged with
  request id, entity kind, entity id (when available), and the
  contract error code.
- **FR-007**: The UI MUST remove prototype upload-style controls and the
  `pickFolderStub` once the Tauri picker is available, except behind an
  explicit build flag for browser-only tests.
- **FR-008**: User cancellation of any picker MUST be returned as a
  non-error null/empty response. Cancellation is not an error and MUST
  NOT be logged at error level.
- **FR-009**: All three operations MUST be invoked through the
  language-neutral JSON Schema contracts in `contracts/native.*.json`
  so a future remote backend can implement the same surface.

### Key Entities

- **PickerRequest**: A transient operation. Carries `kind` (`directory`
  or `file`), optional `default_path`, and optional `filters`. Not
  persisted.
- **PickerResult**: A transient operation result. Carries `path` (the
  selected absolute path) or null on cancellation, plus the matched
  filter label when applicable.
- **RevealRequest**: A transient operation. Carries `path`. Not
  persisted.
- **RevealResult**: A transient operation result. Carries `revealed`
  (boolean) and the platform's selection mode.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users cannot select files for source roots in supported
  desktop builds.
- **SC-002**: Users can reveal paths from Inbox, Inventory, Projects,
  and calibration masters in one action.
- **SC-003**: Missing-path reveal failures show a clear error without
  mutating any app state and without emitting a panic in the Rust core.
- **SC-004**: All prototype comments referencing the stub picker or the
  "Open location" toast are removed or replaced with implemented Tauri
  controls.
- **SC-005**: The three contracts in `contracts/` validate against
  Draft 2020-12 JSON Schema and have round-trip Rust DTOs.

## Assumptions

- Tauri 2.x desktop runtime is available for production builds.
- `@tauri-apps/plugin-dialog` and `tauri-plugin-opener` are available
  and acceptable to add to the project dependency manifest.
- Browser-only prototype fallback may remain for local dev but MUST be
  clearly separated from production behavior via a build-time flag.

## Out of Scope

- Moving, deleting, or modifying selected files (handled by spec 025).
- Batch filesystem operations.
- Drag-and-drop file/folder onto the app window (future feature).
- Watching directories for new files (handled by inbox watcher spec).
