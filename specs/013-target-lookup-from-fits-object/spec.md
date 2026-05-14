# Feature Specification: Target Lookup From FITS OBJECT

**Feature Branch**: `013-target-lookup-from-fits-object`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify target lookup using FITS OBJECT as a search hint, with catalog selection and manual correction."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Use FITS OBJECT As Target Hint (Priority: P1)

As a user importing lights, I want the app to use the FITS `OBJECT` keyword as a target lookup hint so that target suggestions start from capture metadata.

**Why this priority**: Users expect light frames to contain target hints and do not want mandatory catalog downloads.

**Independent Test**: Import light frames with `OBJECT=M31` and confirm the target suggestion uses that value.

**Acceptance Scenarios**:

1. **Given** a light frame has `OBJECT`, **When** metadata is extracted, **Then** the target lookup uses that value as the initial query.
2. **Given** multiple object values exist in one session, **When** suggestions are shown, **Then** the app warns and asks the user to choose.

---

### User Story 2 - Select Catalog Suggestions (Priority: P2)

As a user, I want target suggestions constrained by selected catalogs so that lookup results match my preferred naming sources.

**Why this priority**: Catalog preferences differ and should not require every catalog to be downloaded locally.

**Independent Test**: Enable Messier and NGC catalogs and verify suggestions prioritize those catalogs.

**Acceptance Scenarios**:

1. **Given** catalog lookup is enabled, **When** the app can connect to Sesame/SIMBAD, **Then** it searches with selected catalog preferences.
2. **Given** lookup is unavailable, **When** the user reviews the target, **Then** manual target entry remains available.

### Edge Cases

- Missing `OBJECT`.
- Generic `OBJECT` values such as "Light" or "Target".
- Multiple targets in one folder.
- Network unavailable.
- Ambiguous catalog aliases.

### Domain Questions To Resolve

- Which online provider is canonical for v1 target lookup?
- How should selected catalog preferences influence ranking versus filtering?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Light frame metadata extraction MUST preserve the raw FITS `OBJECT` value.
- **FR-002**: Target lookup MUST use FITS `OBJECT` as a hint, not as an automatic final target.
- **FR-003**: Users MUST be able to manually select or correct the target.
- **FR-004**: Settings MUST allow selecting available catalogs such as Messier, NGC, IC, LBN, LDN, and Sharpless.
- **FR-005**: Lookup MUST work without requiring first-run catalog downloads.
- **FR-006**: Lookup failures MUST be non-blocking and logged.

### Key Entities

- **Object Hint**: Raw metadata value used for lookup.
- **Target Suggestion**: Candidate target name, identifiers, and coordinates.
- **Catalog Preference**: Enabled catalog list used for suggestion ranking/filtering.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Common target names in FITS `OBJECT` produce usable suggestions.
- **SC-002**: Users can correct target suggestions before project creation.
- **SC-003**: Lookup can be skipped or unavailable without blocking ingestion.

## Assumptions

- Target lookup uses online providers when available.
- FITS metadata extraction exists before target lookup is finalized.

## Out of Scope

- Full observing-plan authoring.
- Mandatory local catalog cache.
