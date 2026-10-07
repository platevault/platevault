# Feature Specification: Calibration matching, exceptions, and master adoption

**Feature Branch**: `063-clean-rebuild-contract`

**Spec ID**: `068-calibration-inputs`

**Created**: 2026-10-03

**Status**: Draft; product defaults and all human-approval gate waivers follow the root autonomous objective. Requirements analysis, implementation and verification remain required.

**Input**: Clean rebuild with selective reuse of verified code and the agreed PlateVault product flow.

## User Scenarios & Testing

### User Story 1 - Calibration matching, exceptions, and master adoption (Priority: P1)

Calibration for each processing run (View) is automatic by default. When a run reaches its Calibrate step, compatible masters or raw sets for the run's one rig are assigned without user action, and a readiness line gives the result. The full requirement table sits behind Review matches, with explanations, alternatives and scoped exceptions with reasons. Generated masters found in a run's Results are offered once, in that run's Results step, for explicit adoption (D-W5, D-W37, D-W55).

**Why this priority**: This feature owns the workflow steps listed below without imposing unrelated product features.

**Independent Test**: Exercise the acceptance scenarios through the running product with isolated inputs. Existing baseline code does not prove the redesigned behavior.

**Acceptance Scenarios**:

- **CAL-AC-01**: Given a run with Ha and OIII sessions on one rig and compatible darks and flats, when the run reaches Calibrate, then those inputs are assigned automatically per light group. The readiness line reads every group matched. Review matches lists each assignment as Automatic with its Why this match (D-W5).
- **CAL-AC-02**: Given the 24 Sep OIII session with an automatic 30 Sep flat assignment, when the user picks the 26 Sep flat set in Review matches, then Why this match shows its optical-train state as unknown. The readiness line counts it as needing review, and preparation review lists it as unresolved (D-W5).
- **CAL-AC-03**: Given a scoped exception with a reason for the 26 Sep flats, then the flats' evidence is unchanged and another run still shows the criterion as unknown (D-W3).
- **CAL-AC-04**: Given a detected generated master that has not been adopted, then no run ever assigns or suggests it (D-W5).
- **CAL-AC-05**: Given explicit adoption, then the master appears in Calibration with its origin and provenance and can be assigned automatically where every criterion is compatible (D-W5).
- **CAL-AC-06**: Given a light group whose best match has an unknown or incompatible criterion, when the run reaches Calibrate, then the match is not assigned automatically and the readiness line names the group as needing review. Verified handoff stays blocked until acceptance, a scoped exception, another input or exclusion resolves it (D-W5).
- **CAL-AC-07**: Given a generated master in a processing folder, when adoption is confirmed, then its copy is durably written and re-read/hash verified at the chosen calibration-library destination before reuse is registered. Failed verification retains the candidate and no reusable record is claimed.
- **CAL-AC-08**: Given adoption is reviewed and an unrelated file then appears at the master's destination path, when adoption is confirmed, then it is refused for that path and names the existing file. That file stays byte-identical, no copy is written, nothing is registered and the generated source remains. A free path then adopts under CAL-AC-07.
- **CAL-AC-09**: Given an adoption review recorded the candidate's identity and SHA-256, when the source bytes change before confirmation, or after the copy verifies but before registration, then adoption is blocked with source drift named. Nothing is registered or suggested, and no copy is offered for reuse; any copy already written is named and stays unregistered. A new review of the current bytes is required before adoption.
- **CAL-AC-10**: Given an adopted master's library copy replaced in place with its size and mtime preserved, when a compatible run reaches Calibrate, then the master reads drifted against its adoption digest. It is neither assigned automatically, suggested nor accepted, and it stays protected with its adoption provenance as history. Restoring the adopted bytes restores automatic assignment with no new adoption (D-W5).
- **CAL-AC-11**: Given a run whose calibration policy has automatic assignment turned off, when it reaches Calibrate, then compatible matches show as suggestions and none is assigned until accepted in Review matches (D-W5).
- **CAL-AC-12**: Given a run's Results contain a generated master flat that PlateVault has not seen before, when the run's Results step next opens, then Add to calibration library is offered once there. After Dismiss it is not offered again for that file and digest, and it stays listed as a candidate in Calibration, where it can still be adopted (D-W5, D-W55).
- **CAL-AC-13**: Given a mosaic run group of three panel runs, where Panel 3 was taken on nights with a different flat set, when calibration is matched, then each panel run has its own assignments and readiness line. Panel 3's flats differ from Panel 1's, and the group lists readiness per panel. An unresolved requirement in Panel 3 names Panel 3 and leaves other panels' assignments unchanged (D-W41).
- **CAL-AC-14**: Given a run on the RedCat/ASI2600MM rig, and a library that also holds darks from another camera and flats from another optical train, when matching runs, then the other camera's darks are not candidates. The other train's flats read incompatible on optical train. Review matches has no camera grouping (D-W37).

### Edge Cases

The [root contract](../063-clean-rebuild-contract/spec.md) governs file custody, uncertainty, exact membership, failed writes, and independent lifecycle decisions. Each acceptance scenario tests observable outcomes; no mock acknowledgment counts as terminal success.

- When more than one input is fully compatible, the top-ranked one is assigned automatically and the others are listed as alternatives in Review matches. A ranking tie that leaves no single top input is not assigned automatically and needs review (D-W5).
- An automatic assignment the user replaces stays replaced: matching again for an unchanged group never overrides the user's choice (D-W5).
- A Results master that is dismissed and later changes content is a new candidate and is offered once again (D-W5).

## Requirements

### Functional Requirements

- **CAL-FR-01**: The Calibration surface lists masters and raw calibration sets from indexed locations, grouped by camera, settings, channel, and relevant geometry, with compatibility and missing evidence. It includes the calibration frames Import routes to a Calibration location (LIB-FR-16, STO-IMP-FR-02). This is the library-wide surface; a run's Calibrate step matches only against its own rig (CAL-FR-10) (D-W24, D-W37).
- **CAL-FR-02**: Matching is automatic by default. When a run reaches Calibrate, each light group whose best match has every criterion compatible is assigned that match automatically, recorded as Automatic under CAL-FR-08. A match with any unknown or incompatible criterion is never assigned automatically and stays a suggestion that needs review. The run's calibration policy can turn automatic assignment off, so that every match stays a suggestion until accepted. Suggestions stay visibly distinct from automatic and accepted assignments. When the run's membership revision changes, matching runs again for the changed groups (D-W5).
- **CAL-FR-03**: Why this match lists compatible, incompatible, and unknown criteria for every automatic, suggested and accepted assignment, and remains available after assignment (D-W5).
- **CAL-FR-04**: Raw calibration sets (for example, flats) can be assigned for an external application that builds its own masters.
- **CAL-FR-05**: In Review matches, for a mismatch or unknown criterion, the user can choose another input, exclude the session, defer, or record a scoped exception with a reason. Review matches also lets the user replace an automatic assignment with another input. The criterion and reason are kept. An exception never rewrites master evidence or makes a master universally compatible (D-W5).
- **CAL-FR-06**: Detected candidate masters show Add to calibration library, with type, camera/settings, channel, source evidence, and origin. A generated master that Results discovery (RES-FR-01) newly finds in a run's Results is offered once, in that run's Results step. Dismiss records the decline for that file and digest, so the offer does not return; the candidate stays listed in Calibration. Adoption needs explicit confirmation and records actual provenance. Detection alone never makes a master available for reuse. Candidate and adopted masters are protected by default (STO consumes this) (D-W5, D-W55).
- **CAL-FR-07**: Adopted master storage follows D05 in the root decision register. Adoption never leaves a reusable master disposable along with its processing folder. Adoption review records the candidate's identity and SHA-256, and the evidence shown is bound to that digest. Copying hashes the bytes it reads and compares them with the reviewed digest; the destination re-read must match it, and immediately before registration the source's current identity and digest must still match. Any mismatch blocks adoption and registers nothing. Adoption checks the destination path during review and again immediately before writing; an existing entry there is never overwritten and blocks adoption until another path or destination is chosen. The generated source retained after verified adoption remains protected Keep until separately reviewed as a verified duplicate.
- **CAL-FR-08**: Every assignment, whether automatic or accepted in Review matches, records the selected calibration identities, their SHA-256 and evidence for the run revision (D19). An adopted master is assigned automatically, suggested or accepted only while its current bytes match its adoption digest; on drift it reads drifted, stays protected and needs review. Preparation re-verifies every assignment under PREP-FR-09. Unaccepted suggestions never enter a verified handoff. Unresolved requirements stay named and need acceptance, exception, alternate input or explicit exclusion (D-W5).
- **CAL-FR-09**: The Calibrate step shows one readiness line for the run. It counts light groups that are matched (automatic or accepted), that need review (unknown, incompatible or missing), and that have a scoped exception or exclusion. Examples: "Calibration ready · 6 of 6 groups matched" and "5 of 6 groups matched · 1 needs review". Review matches opens the full requirement table. Each row is a light group and a calibration type it requires, with the assigned or suggested input, its state and Why this match. The states are Automatic, Suggested, Accepted, Excepted, Excluded and Needs review (D-W5).
- **CAL-FR-10**: A run uses one rig, so matching covers one camera and one optical train. Inputs from another camera are never candidates. Flats need the run's optical-train evidence: an unknown train reads unknown, and a different train reads incompatible. The requirement table groups by settings, channel and geometry, not by camera (D-W37).
- **CAL-FR-11**: In a mosaic run group, calibration is matched per panel run. The group shares one calibration policy, automatic assignment on (the default) or off; each panel run has its own assignments, readiness line, exceptions and exclusions. The group lists each panel's readiness, and an exception recorded in one panel run does not apply to another (D-W41, D-W55).
- **CAL-FR-12**: Calibration-matching evidence for a Project's candidate sessions, per subject and channel, supplies the missing-calibration and exposure-mismatch warnings that PRJ shows (PRJ-FR-11). Producing this evidence assigns nothing, sets no goal and never blocks a run (D-W29).

### Owned interaction steps

- E1
- E2
- H4
- Cross-flow: Calibration mismatch
- Calibration surface
- Calibrate step: readiness line and Review matches (D-W5)
- Run-group calibration per panel (D-W41)

### Key Entities

Use the [root vocabulary](../063-clean-rebuild-contract/spec.md#key-entities). Feature-specific evidence and decisions retain their input identity, scope, and revision.

- **Processing run (View)**: the unit whose Calibrate step matches calibration; it belongs to one Project and uses one rig (D-W1, D-W37). A mosaic subject's runs form a run group with one run per panel (D-W38).
- **Calibration assignment**: the input chosen for one calibration type of one light group in a run revision, in state Automatic, Suggested, Accepted, Excepted, Excluded or Needs review (D-W5).
- **Calibration policy**: the run setting that turns automatic assignment on (default) or off; a run group shares one policy across its panel runs (D-W5, D-W41, D-W55).

## Success Criteria

### Measurable Outcomes

- **PV-CAL-SC-01**: Every acceptance scenario produces its stated outcome and refusal behavior.
- **PV-CAL-SC-02**: Every owned interaction step has a requirement and independently observable acceptance evidence.
- **PV-CAL-SC-03**: Original inputs remain unchanged except through separately reviewed and approved filesystem operations.
- **PV-CAL-SC-04**: For a run whose every calibration requirement has a fully compatible match, Calibrate needs no user action and the readiness line reads ready (D-W5).
- **PV-CAL-SC-05**: No match with an unknown or incompatible criterion is ever assigned automatically (D-W5).

## Assumptions

- [Product flow](../../docs/reviews/2026-10-03-product-flow-and-journeys.md) supplies the confirmed interactions and illustrative worked example.
- This feature is independently specified; dependencies on other feature contracts are resolved in planning.
- Conservative defaults and all human-approval gate waivers follow the root autonomous objective and decision register. Tests, requirements analysis, independent review and delivery evidence remain mandatory.

## Decisions before feature approval

- Root decisions D05 and D13 define durable master adoption and evidence-based matching/assignment. Compatibility tolerances must be visible and fixture-qualified, never invented.
- Root decision D19 binds adoption, suggestions and accepted assignments to re-verified content; D05 is its adoption form.
- Workflow decision D-W5 (2026-10-06) amends the root D13 acceptance rule: fully compatible matches are assigned automatically and recorded with identity and SHA-256; any unknown or incompatible criterion still needs an explicit choice. D-W37 limits each run to one rig, and D-W41 matches calibration per panel run. D-W55 fixes the calibration policy as automatic assignment on or off and places the once-only master offer in the run's Results step. D-W24 routes Import's calibration frames to the Calibration library, and D-W29 makes missing calibration and exposure mismatch Project warnings.
