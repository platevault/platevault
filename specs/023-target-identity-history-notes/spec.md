# Feature Specification: Target Identity, History, And Notes

**Feature Branch**: `023-target-identity-history-notes`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify target identity, aliases, target history, observing-plan references, and notes as bounded follow-on features beyond FITS OBJECT lookup."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Resolve Target Identity (Priority: P1)

As a user, I want target records to keep a stable identity with aliases and catalog references so that sessions and projects using different names can still be connected.

**Why this priority**: FITS `OBJECT` lookup is only a hint. The durable product model needs target identity and history.

**Independent Test**: Import sessions with `OBJECT=M31`, `OBJECT=Andromeda Galaxy`, and a manually selected Messier entry; confirm they can link to one target record with preserved aliases.

**Acceptance Scenarios**:

1. **Given** multiple names refer to the same target, **When** the user reviews target suggestions, **Then** the app can link them to one target identity.
2. **Given** a user manually corrects a target, **When** the correction is saved, **Then** the original hint remains visible in provenance.
3. **Given** a target has catalog aliases, **When** the target is opened, **Then** aliases and catalog identifiers are listed separately from notes.

---

### User Story 2 - See Target History (Priority: P2)

As a user, I want to see target history across sessions and projects so that I understand what data I already have and what remains to process.

**Why this priority**: Target history connects Inventory, sessions, and projects without making Targets a primary navigation destination.

**Independent Test**: Open target detail from an Inventory item or project and confirm linked sessions, projects, notes, and observing-plan references are visible.

**Acceptance Scenarios**:

1. **Given** a target has linked sessions, **When** target detail opens, **Then** acquisition history is shown by session/date/source.
2. **Given** a target has linked projects, **When** target detail opens, **Then** project references and lifecycle state are shown.
3. **Given** a target has notes, **When** notes are edited, **Then** changes are saved with audit metadata.

---

### User Story 3 - Link Observing Plan References (Priority: P3)

As a user, I want to attach observing-plan references to a target or session so that capture planning context can be preserved without making the app a planning tool.

**Why this priority**: Observing-plan references were identified in the story inventory but should remain contextual.

**Independent Test**: Attach a NINA plan reference to a target/session and confirm it appears in target history and project context.

**Acceptance Scenarios**:

1. **Given** an observing-plan file or reference exists, **When** the user links it, **Then** it is recorded as a contextual reference.
2. **Given** a linked reference is missing, **When** target detail opens, **Then** the app shows a missing-reference warning without deleting history.

### Edge Cases

- Same target has conflicting catalog coordinates.
- FITS `OBJECT` is generic or wrong.
- User intentionally splits two aliases into separate targets.
- Linked observing-plan file moved or renamed.
- Target notes contain multiline technical comments.

### Domain Questions To Resolve

- Final target identity merge/split workflow.
- Which observing-plan systems are recognized first.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Target identity MUST be a durable record separate from raw FITS `OBJECT` hints.
- **FR-002**: Target aliases and catalog identifiers MUST be stored as structured references.
- **FR-003**: Target detail MUST show linked sessions and projects contextually.
- **FR-004**: Target notes MUST be editable and auditable.
- **FR-005**: Observing-plan references MUST be contextual links, not primary navigation.
- **FR-006**: Manual target corrections MUST preserve the original hint and provenance.
- **FR-007**: Missing observing-plan references MUST warn without deleting historical records.

### Key Entities

- **Target Identity**: Durable target record with canonical display name and coordinates where known.
- **Target Alias**: Alternate name, catalog identifier, or user alias.
- **Target History Entry**: Linked session, project, artifact, note, or plan reference.
- **Observing Plan Reference**: Linked capture-plan file or external reference.
- **Target Note**: User-authored note with audit metadata.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can link multiple target name hints to one target identity.
- **SC-002**: Target history can be opened from Inventory or Projects without adding a Targets primary nav item.
- **SC-003**: Notes and observing-plan references survive target name correction.

## Assumptions

- FITS `OBJECT` target lookup exists before full target history implementation.
- Catalog metadata enrichment remains optional.

## Out of Scope

- Full observing-plan authoring.
- Mandatory local catalog cache.
- Automatic target merge without review.
