# Feature Specification: Calibration Matching Rules

**Feature Branch**: `007-calibration-matching-rules`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify configurable calibration matching rules per calibration type, with recommendations and manual override."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure Matching Per Calibration Type (Priority: P1)

As an astrophotographer, I want dark, bias, and flat matching rules configured separately so that the app recommends calibrations using criteria that make sense for each type.

**Why this priority**: Matching requirements differ by calibration type and user workflow.

**Independent Test**: Configure dark, bias, and flat matching fields independently and verify recommendations change per type.

**Acceptance Scenarios**:

1. **Given** dark matching excludes temperature, **When** recommendations are generated, **Then** dark candidates are not rejected solely because temperature differs.
2. **Given** flat matching includes filter and optical train, **When** recommendations are generated, **Then** flats are grouped by those fields.
3. **Given** flats exist from the same light session or observing night, **When** recommendations are generated, **Then** those flats are preferred over compatible flats from other nights.
4. **Given** no same-session or same-night flats are available, **When** recommendations are generated, **Then** compatible flats from other nights remain eligible instead of blocking the project.

---

### User Story 2 - Manual Override (Priority: P2)

As a user preparing a project, I want to manually select calibration frames even when automatic recommendations disagree.

**Why this priority**: Users explicitly need final control over calibration assignment.

**Independent Test**: Select a calibration manually that is not the top recommendation and confirm the project uses the manual choice.

**Acceptance Scenarios**:

1. **Given** recommended calibrations exist, **When** the user selects a different calibration, **Then** the manual selection is preserved.
2. **Given** manual selection conflicts with a recommendation, **When** the project is reviewed, **Then** the app shows the conflict without blocking the user.

### Edge Cases

- Darks without reliable temperature metadata.
- Flats captured at different gain/offset from lights.
- Flats captured after midnight but still belonging to the same observing night.
- Multiple light sessions on adjacent calendar dates that should not share flats unless same-night/session matching or compatibility fallback allows it.
- Missing camera or telescope metadata.
- Existing master file instead of a calibration directory.

### Domain Questions To Resolve

- Which fields are default match criteria per type?
- Should bias matching include exposure or treat exposure as implicit?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support frame types `light`, `dark`, `flat`, `bias`, and `dark flat` in the domain model.
- **FR-002**: Project setup MUST expose dark, bias, and flat selection separately.
- **FR-003**: Dark flats MUST NOT appear in the initial project setup workflow unless a later spec enables them.
- **FR-004**: Matching rules MUST be configurable per calibration type.
- **FR-005**: Recommendations MUST remain recommendations and MUST allow manual override.
- **FR-006**: Master calibration mode MUST allow selecting a file instead of a directory.
- **FR-007**: Matching explanations MUST be inspectable outside routine ledger rows.
- **FR-008**: Flat recommendations MUST prioritize flats from the same light session and observing night before considering compatible flats from other nights.
- **FR-009**: Same-night flat matching MUST use observing-night/session semantics, not plain calendar-date equality.
- **FR-010**: If same-session or same-night flats are unavailable, flat recommendations MUST fall back to flats that match the configured calibration compatibility fields.

### Key Entities

- **Calibration Type**: Dark, bias, flat, or dark flat.
- **Matching Rule**: Selected metadata fields used for recommendations.
- **Observing Night**: The acquisition night/session grouping used to associate after-midnight captures with the same practical imaging session.
- **Calibration Recommendation**: Candidate relationship between light data and calibration data.
- **Manual Override**: User-selected calibration assignment.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can configure matching rules for darks, bias, and flats independently.
- **SC-002**: Users can complete project calibration assignment even with incomplete metadata.
- **SC-003**: Manual calibration choices are preserved across project edits.
- **SC-004**: Flat recommendation explanations show whether a candidate was selected by same-session, same-night, or compatibility fallback behavior.

## Assumptions

- Light frames are the anchor for project calibration recommendations.
- Metadata extraction can provide camera, telescope, filter, exposure, gain, offset, binning, and temperature when available.

## Out of Scope

- Pixel-level calibration validation.
- Automatic calibration application.
