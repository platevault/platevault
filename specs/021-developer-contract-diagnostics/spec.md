# Feature Specification: Developer Contract Diagnostics

**Feature Branch**: `021-developer-contract-diagnostics`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify API/contract diagnostics as developer-facing references, not normal user settings."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Inspect Contract References (Priority: P2)

As a developer or advanced tester, I want to inspect operation contract versions and JSON schemas so that frontend, Tauri, and core boundaries can be debugged.

**Why this priority**: Contract diagnostics are useful for development but should not clutter normal Settings.

**Independent Test**: Open a developer diagnostics surface and confirm contract versions, schema names, and JSON export are available without appearing as a normal Settings menu entry.

**Acceptance Scenarios**:

1. **Given** developer diagnostics are available, **When** the user opens them, **Then** contract references and versions are visible.
2. **Given** normal Settings is open, **When** sections are listed, **Then** API Contracts is not shown as a normal section.
3. **Given** a contract diagnostic export is requested, **When** it completes, **Then** the file is JSON.

### Edge Cases

- Contract version mismatch between generated TypeScript and Rust DTOs.
- Schema file missing during development.
- Diagnostic export fails.
- User opens diagnostics in a production build.

### Domain Questions To Resolve

- Whether diagnostics are hidden behind a command palette, developer mode, or docs link.
- Which contract mismatches should be blocking during app startup.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: API contract references MUST NOT appear as a normal Settings section.
- **FR-002**: Developer diagnostics MAY expose contract versions, schema names, generated type references, and JSON export.
- **FR-003**: Diagnostic controls MUST be clearly labeled as developer/testing tools.
- **FR-004**: Contract mismatch warnings MUST be actionable for developers.
- **FR-005**: JSON MUST be the only diagnostic export format unless a later spec adds another.

### Key Entities

- **Contract Reference**: Schema or generated type boundary between UI, Tauri, and core.
- **Diagnostic Export**: JSON snapshot of contract/runtime diagnostic state.
- **Contract Mismatch**: Version or schema disagreement detected at build or runtime.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Normal users do not encounter API Contract settings.
- **SC-002**: Developers can inspect contract metadata during prototype and implementation debugging.
- **SC-003**: Diagnostic export uses JSON consistently.

## Assumptions

- JSON Schema contracts remain the language-neutral transport boundary.
- Developer diagnostics may be hidden or conditional in production.

## Out of Scope

- User-facing API configuration.
- Multiple export formats.
