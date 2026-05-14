# Feature Specification: Token Pattern Builder

**Feature Branch**: `015-token-pattern-builder`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify the token-based pattern builder for project folders and archive locations, without freeform path text."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Build Project Folder Pattern (Priority: P1)

As a user configuring naming, I want to build project folder patterns by selecting metadata tokens and separators so that folder names are valid and predictable.

**Why this priority**: Freeform pattern text is unclear and error-prone.

**Independent Test**: Build a pattern using target, project, date, camera, telescope, filter, and separators and confirm the preview updates.

**Acceptance Scenarios**:

1. **Given** the pattern builder is open, **When** the user adds a metadata token, **Then** the token appears in the pattern preview.
2. **Given** the user types a separator, **When** it is `/`, `-`, `_`, or space, **Then** it can be inserted between tokens.

---

### User Story 2 - Build Archive Location Pattern (Priority: P2)

As a user configuring archive behavior, I want archive location patterns to use the same token builder so that cleanup/archive plans are consistent with project naming.

**Why this priority**: Archive paths must be predictable before plan approval.

**Independent Test**: Build an archive pattern and confirm a sample archive destination is shown.

**Acceptance Scenarios**:

1. **Given** an archive pattern, **When** sample metadata changes, **Then** the preview path updates.
2. **Given** a path separator would create an invalid path, **When** the user attempts to insert it, **Then** the app prevents or warns.

### Edge Cases

- Missing metadata values.
- Duplicate separators.
- Invalid filesystem characters on Windows/macOS/Linux.
- Extremely long generated paths.

### Domain Questions To Resolve

- Which metadata tokens are allowed in v1?
- Should telescope represent optical tube, lens, or telescope configuration?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Project folder patterns MUST NOT be edited as unrestricted freeform text.
- **FR-002**: Archive location patterns MUST NOT be edited as unrestricted freeform text.
- **FR-003**: Builder MUST offer metadata tokens including target, project, date, camera, telescope, filter, and workflow.
- **FR-004**: Builder MUST allow separators including `/`, `-`, `_`, and space.
- **FR-005**: Builder MUST show a preview for representative metadata.
- **FR-006**: Builder MUST validate generated paths against OS path rules before saving.

### Key Entities

- **Pattern Token**: A named metadata placeholder.
- **Separator Token**: Literal separator inserted between metadata tokens.
- **Pattern Preview**: Example generated path.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can create valid project and archive patterns without typing raw template syntax.
- **SC-002**: Invalid pattern outputs are caught before they affect project creation or archive plans.
- **SC-003**: Users can identify all tokens available for folder naming from the UI.

## Assumptions

- Metadata tokens map to extracted or user-entered fields.
- Missing metadata can be represented by fallback labels or validation warnings.

## Out of Scope

- Arbitrary scripting or expression evaluation in patterns.
- Automatic renaming of existing project folders.
