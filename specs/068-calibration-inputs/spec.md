# Feature Specification: Calibration matching, exceptions, and master adoption

**Feature Branch**: `063-clean-rebuild-contract`

**Spec ID**: `068-calibration-inputs`

**Created**: 2026-10-03

**Status**: Draft; product defaults and all human-approval gate waivers follow the root autonomous objective. Requirements analysis, implementation and verification remain required.

**Input**: Clean rebuild with selective reuse of verified code and the agreed PlateVault product flow.

## User Scenarios & Testing

### User Story 1 - Calibration matching, exceptions, and master adoption (Priority: P1)

An explainable compatible preselection of masters or raw sets for the chosen lights, scoped exceptions with reasons, and explicit adoption of generated masters.

**Why this priority**: This feature owns the workflow steps listed below without imposing unrelated product features.

**Independent Test**: Exercise the acceptance scenarios through the running product with isolated inputs. Existing baseline code does not prove the redesigned behavior.

**Acceptance Scenarios**:

- **CAL-AC-01**: Given selected Ha and OIII sessions with compatible darks and flats, when the calibration area opens, then those inputs are preselected per group and marked as suggestions until accepted.
- **CAL-AC-02**: Given the 24 Sep OIII session and a 26 Sep flat set with unknown optical-train state, then Why this match shows that criterion as unknown and the item is listed as unresolved in preparation review.
- **CAL-AC-03**: Given a scoped exception with a reason for the 26 Sep flats, then the flats' evidence is unchanged and another View still shows the criterion as unknown.
- **CAL-AC-04**: Given a detected generated master that has not been adopted, then no View ever preselects it.
- **CAL-AC-05**: Given explicit adoption, then the master appears in Calibration with its origin and provenance and can be preselected where compatible.
- **CAL-AC-06**: Given suggested calibrations, when Review preparation opens before assignment is accepted, then suggestions remain unaccepted and verified handoff is blocked until explicit acceptance, a scoped exception, another input or explicit exclusion resolves them.
- **CAL-AC-07**: Given a generated master in a processing folder, when adoption is confirmed, then its copy is durably written and re-read/hash verified at the chosen calibration-library destination before reuse is registered. Failed verification retains the candidate and no reusable record is claimed.
- **CAL-AC-08**: Given adoption is reviewed and an unrelated file then appears at the master's destination path, when adoption is confirmed, then it is refused for that path and names the existing file. That file stays byte-identical, no copy is written, nothing is registered and the generated source remains. A free path then adopts under CAL-AC-07.
- **CAL-AC-09**: Given an adoption review recorded the candidate's identity and SHA-256, when the source bytes change before confirmation, or after the copy verifies but before registration, then adoption is blocked with source drift named. Nothing is registered or suggested, and no copy is offered for reuse; any copy already written is named and stays unregistered. A new review of the current bytes is required before adoption.
- **CAL-AC-10**: Given an adopted master's library copy replaced in place with its size and mtime preserved, when a compatible View's Calibration area opens, then the master reads drifted against its adoption digest. It is neither suggested nor accepted, and it stays protected with its adoption provenance as history. Restoring the adopted bytes restores the suggestion with no new adoption.

### Edge Cases

The [root contract](../063-clean-rebuild-contract/spec.md) governs file custody, uncertainty, exact membership, failed writes, and independent lifecycle decisions. Each acceptance scenario tests observable outcomes; no mock acknowledgment counts as terminal success.

## Requirements

### Functional Requirements

- **CAL-FR-01**: The Calibration surface lists masters and raw calibration sets from indexed locations, grouped by camera, settings, channel, and relevant geometry, with compatibility and missing evidence.
- **CAL-FR-02**: Compatible masters or raw sets are preselected for the chosen light sessions. Suggestions stay visibly distinct from accepted assignments.
- **CAL-FR-03**: Why this match lists compatible, incompatible, and unknown criteria, and remains available after acceptance.
- **CAL-FR-04**: Raw calibration sets (for example, flats) can be assigned for an external application that builds its own masters.
- **CAL-FR-05**: For a mismatch or unknown criterion, the user can choose another input, exclude the session, defer, or record a scoped exception with a reason. The criterion and reason are kept. An exception never rewrites master evidence or makes a master universally compatible.
- **CAL-FR-06**: Detected candidate masters show Add to calibration library, with type, camera/settings, channel, source evidence, and origin. Adoption needs explicit confirmation and records actual provenance. Detection alone never makes a master available for reuse. Candidate and adopted masters are protected by default (STO consumes this).
- **CAL-FR-07**: Adopted master storage follows D05 in the root decision register. Adoption never leaves a reusable master disposable along with its processing folder. Adoption review records the candidate's identity and SHA-256, and the evidence shown is bound to that digest. Copying hashes the bytes it reads and compares them with the reviewed digest; the destination re-read must match it, and immediately before registration the source's current identity and digest must still match. Any mismatch blocks adoption and registers nothing. Adoption checks the destination path during review and again immediately before writing; an existing entry there is never overwritten and blocks adoption until another path or destination is chosen. The generated source retained after verified adoption remains protected Keep until separately reviewed as a verified duplicate.
- **CAL-FR-08**: Accept assignments explicitly records the selected calibration identities, their SHA-256 and evidence for the View revision (D19). An adopted master is suggested or accepted only while its current bytes match its adoption digest; on drift it reads drifted, stays protected and needs review. Preparation re-verifies every accepted assignment under PREP-FR-09. Unaccepted suggestions never enter a verified handoff. Unresolved requirements stay named and require acceptance, exception, alternate input or explicit exclusion.

### Owned interaction steps

- E1
- E2
- H4
- Cross-flow: Calibration mismatch
- Calibration surface

### Key Entities

Use the [root vocabulary](../063-clean-rebuild-contract/spec.md#key-entities). Feature-specific evidence and decisions retain their input identity, scope, and revision.

## Success Criteria

### Measurable Outcomes

- **PV-CAL-SC-01**: Every acceptance scenario produces its stated outcome and refusal behavior.
- **PV-CAL-SC-02**: Every owned interaction step has a requirement and independently observable acceptance evidence.
- **PV-CAL-SC-03**: Original inputs remain unchanged except through separately reviewed and approved filesystem operations.

## Assumptions

- [Product flow](../../docs/reviews/2026-10-03-product-flow-and-journeys.md) supplies the confirmed interactions and illustrative worked example.
- This feature is independently specified; dependencies on other feature contracts are resolved in planning.
- Conservative defaults and all human-approval gate waivers follow the root autonomous objective and decision register. Tests, requirements analysis, independent review and delivery evidence remain mandatory.

## Decisions before feature approval

- Root decisions D05 and D13 define durable master adoption and evidence-based matching/assignment. Compatibility tolerances must be visible and fixture-qualified, never invented.
- Root decision D19 binds adoption, suggestions and accepted assignments to re-verified content; D05 is its adoption form.
