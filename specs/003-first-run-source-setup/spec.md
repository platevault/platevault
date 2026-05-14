# Feature Specification: First-Run Source Setup

**Feature Branch**: `003-first-run-source-setup`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify the one-time setup wizard for selecting initial data sources, validating selections, previewing scan results, and restarting setup later."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Select Required Sources (Priority: P1)

As a new user, I want setup to require at least one selected source for each required source category so that the app starts with usable scan inputs.

**Why this priority**: Setup must prevent empty configuration that makes guided first steps impossible.

**Independent Test**: Attempt to proceed through setup without selecting a directory for each required source category and confirm the wizard blocks progress with row-level errors.

**Acceptance Scenarios**:

1. **Given** a source step with no selected directory, **When** the user clicks Next, **Then** the wizard highlights the missing row and stays on the step.
2. **Given** all required source rows have directories, **When** the user clicks Next, **Then** the wizard advances.

---

### User Story 2 - Preview Scan Results (Priority: P2)

As a user completing setup, I want the scan preview to show what each source will include before finishing setup.

**Why this priority**: Users need confidence that the app will ingest the intended folders.

**Independent Test**: Select sample source directories, click Preview scan, and confirm the expanded preview lists per-source directories/files and warnings.

**Acceptance Scenarios**:

1. **Given** valid source paths, **When** the user starts preview scan, **Then** the wizard shows a spinner while scanning.
2. **Given** scan preview completes, **When** results render, **Then** each source shows the full list of included directories/files and row-level warnings.
3. **Given** scan preview has not completed, **When** the user tries to finish setup, **Then** Finish remains disabled.

---

### User Story 3 - Restart Setup Later (Priority: P3)

As a user, I want to restart the setup wizard from Settings so that I can correct first-run source choices.

**Why this priority**: Users asked how to reinitiate setup and expect a clear entry point.

**Independent Test**: Use Settings to restart setup and confirm the wizard opens without creating a permanent main navigation screen.

**Acceptance Scenarios**:

1. **Given** setup has completed, **When** the user chooses Restart setup in Settings, **Then** the setup wizard opens.
2. **Given** setup is restarted, **When** the user completes it, **Then** source settings update and the wizard closes.

### Edge Cases

- Duplicate source names.
- Duplicate source roots.
- Missing directories.
- Inaccessible directories.
- Very large source roots.
- Mixed folders that include lights and calibration frames.

### Domain Questions To Resolve

- Which source categories are required for first setup versus optional later additions?
- Should existing source settings prefill the restarted setup wizard?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Setup MUST be a page-by-page wizard, not a permanent main-screen panel.
- **FR-002**: Setup MUST allow skipping the entire wizard.
- **FR-003**: Setup MUST NOT allow proceeding from a required source step until each required row has a directory.
- **FR-004**: Setup MUST validate duplicate source names and duplicate source roots.
- **FR-005**: Setup MUST provide a Preview scan action that shows expanded per-source results.
- **FR-006**: Setup MUST show a loading state while preview scan is running.
- **FR-007**: Setup MUST allow finishing only after preview scan completes or the whole wizard is skipped.
- **FR-008**: Setup MUST be restartable from Settings.
- **FR-009**: First-run setup MUST include source steps for Raw Sources, Calibration Sources, Project Sources, and Inbox Sources.
- **FR-010**: First-run setup MUST explain that project creation happens later in the guided Projects workflow.
- **FR-011**: First-run setup MUST start with a welcome page that explains setup scope, the skip option, and what the user will configure.
- **FR-012**: First-run setup MUST include clarification pages before directory selection so users understand each source category, what they should select for it, and the post-setup guided workflow.
- **FR-013**: Each source selection page MUST explain the category-specific action the user is expected to take.

### Key Entities

- **Setup Source**: Source name, category, selected root, scan rule, validation state.
- **Source Category**: Raw Sources, Calibration Sources, Project Sources, or Inbox Sources.
- **Scan Preview Result**: Included directories/files and warnings per source.
- **Setup Session**: Current wizard run and completion/skip state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can complete setup with valid sources in under 5 minutes.
- **SC-002**: Invalid source rows are identified before scan preview runs.
- **SC-003**: Preview scan results render without browser crashes for representative fixture trees.
- **SC-004**: Restarting setup preserves or updates source settings predictably.

## Assumptions

- Project creation happens after setup in the guided first-project flow.
- Source roots are directories only.

## Out of Scope

- Creating the first project.
- Moving data into Inventory.
- Applying filesystem mutations.
