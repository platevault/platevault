# Feature Specification: Calibration matching, exceptions, and master adoption

**Feature Branch**: `063-clean-rebuild-contract`

**Spec ID**: `068-calibration-inputs`

**Created**: 2026-10-03

**Status**: Draft; product defaults and all human-approval gate waivers follow the root autonomous objective. Requirements analysis, implementation and verification remain required.

**Input**: Clean rebuild with selective reuse of verified code and the agreed PlateVault product flow.

## User Scenarios & Testing

### User Story 1 - Calibration matching, exceptions, and master adoption (Priority: P1)

Calibration for each processing run (View) is automatic by default. When a run reaches its Calibrate step, compatible masters or raw sets for the run's one rig are assigned without user action, and a readiness line gives the result. The requirement table stays on the step, with explanations, alternatives, scoped exceptions with reasons, and No calibration. Generated masters found in a run's Results are offered once, in that run's Results step, for explicit adoption. The Calibration library imports master files after checking their headers, replaces a master for every unfinished run that uses it, flags old masters, and hides masters the user no longer wants offered (D-W5, D-W37, D-W55, D-W82).

**Why this priority**: This feature owns the workflow steps listed below without imposing unrelated product features.

**Independent Test**: Exercise the acceptance scenarios through the running product with isolated inputs. Existing baseline code does not prove the redesigned behavior.

**Acceptance Scenarios**:

- **CAL-AC-01**: Given a run with Ha and OIII sessions on one rig and compatible darks and flats, when the run reaches Calibrate, then those inputs are assigned automatically per light group. The readiness line reads every group matched. The requirement table lists each assignment as Automatic with its Why this match (D-W5).
- **CAL-AC-02**: Given the 24 Sep OIII session with an automatic 30 Sep flat assignment, when the user picks the 26 Sep flat set in the requirement table, then Why this match shows its optical-train state as unknown. The readiness line counts it as needing review, and preparation review lists it as unresolved (D-W5).
- **CAL-AC-03**: Given a scoped exception with a reason for the 26 Sep flats, then the flats' evidence is unchanged and another run still shows the criterion as unknown (D-W3).
- **CAL-AC-04**: Given a detected generated master that has not been adopted, then no run ever assigns or suggests it (D-W5).
- **CAL-AC-05**: Given explicit adoption, then the master appears in Calibration with its origin and provenance and can be assigned automatically where every criterion is compatible (D-W5).
- **CAL-AC-06**: Given a light group whose best match has an unknown or incompatible criterion, when the run reaches Calibrate, then the match is not assigned automatically and the readiness line names the group as needing review. Verified handoff stays blocked until acceptance, a scoped exception, another input or exclusion resolves it (D-W5).
- **CAL-AC-07**: Given a generated master in a processing folder, when adoption is confirmed, then its copy is durably written and re-read/hash verified at the chosen calibration-library destination before reuse is registered. Failed verification retains the candidate and no reusable record is claimed.
- **CAL-AC-08**: Given adoption is reviewed and an unrelated file then appears at the master's destination path, when adoption is confirmed, then it is refused for that path and names the existing file. That file stays byte-identical, no copy is written, nothing is registered and the generated source remains. A free path then adopts under CAL-AC-07.
- **CAL-AC-09**: Given an adoption review recorded the candidate's identity and SHA-256, when the source bytes change before confirmation, or after the copy verifies but before registration, then adoption is blocked with source drift named. Nothing is registered or suggested, and no copy is offered for reuse; any copy already written is named and stays unregistered. A new review of the current bytes is required before adoption.
- **CAL-AC-10**: Given an adopted master's library copy replaced in place with its size and mtime preserved, when a compatible run reaches Calibrate, then the master reads drifted against its adoption digest. It is neither assigned automatically, suggested nor accepted, and it stays protected with its adoption provenance as history. Restoring the adopted bytes restores automatic assignment with no new adoption (D-W5).
- **CAL-AC-11**: Given a run whose calibration policy has automatic assignment turned off, when it reaches Calibrate, then compatible matches show as suggestions and none is assigned until accepted in the requirement table (D-W5).
- **CAL-AC-12**: Given a run's Results contain a generated master flat that PlateVault has not seen before, when the run's Results step next opens, then Add to calibration library is offered once there. After Hide, it is not offered again for that file and digest, and it stays listed as a candidate in Calibration, where it can still be adopted (D-W5, D-W55).
- **CAL-AC-13**: Given a mosaic run group of three panel runs, where Panel 3 was taken on nights with a different flat set, when calibration is matched, then each panel run has its own assignments and readiness line. Panel 3's flats differ from Panel 1's, and the group lists readiness per panel. An unresolved requirement in Panel 3 names Panel 3 and leaves other panels' assignments unchanged (D-W41).
- **CAL-AC-14**: Given a run on the RedCat/ASI2600MM rig, and a library that also holds darks from another camera and flats from another optical train, when matching runs, then the other camera's darks are not candidates. The other train's flats read incompatible on optical train. The requirement table has no camera grouping (D-W37).
- **CAL-AC-15**: Given three master files chosen in Import masters (a dark at 0 °C, gain 100, offset 50 for camera X that matches no library master, a second copy of a library master's bytes, and a bias whose camera and settings match library master B), then the preview table reads New, Duplicate and Replaces B, each with the kind, camera, gain and offset, temperature and exposure read from its headers. Nothing is imported until the user confirms, and the Duplicate is not imported. (D-W82)
- **CAL-AC-16**: Given dark master D at v1, assigned in two unfinished runs and in one Finished run, when the user chooses Replace… on D and picks a new compatible dark file, then the confirmation lists the two unfinished runs. After the user confirms, D shows v2 marked Latest and v1 below it, both unfinished runs use v2, and the Finished run keeps v1 as its recorded calibration. (D-W82)
- **CAL-AC-17**: Given the age threshold is 90 days and the library holds a dark made 120 days ago, a flat made 200 days ago and a bias made 30 days ago, then the dark reads "Old · 120 d" and the flat and bias carry no badge. When the old dark is assigned in an unfinished run, an issue names that run; while no unfinished run uses it, no issue is raised. (D-W82)
- **CAL-AC-18**: Given a library master that no run uses, when the user chooses Hide, then it leaves the list, is never matched or offered, and Show hidden lists it with Restore. Hide on a master that a run uses is refused, and the refusal names those runs. (D-W76, D-W82)
- **CAL-AC-19**: Given a run at Calibrate with three light groups whose bias requirement has no compatible master, when the user selects the three rows and chooses No calibration, then the rows read No calibration with no reason asked, and Proceed is enabled once every other row has an input. The table stays visible after every row is resolved. (D-W82)
- **CAL-AC-20**: Given library master D that no run uses and library master B that one run uses, when the user chooses Move to Trash on D and confirms, then D's file goes to the OS Trash and D leaves the library. Move to Trash on B is refused, and the refusal names that run. (D-W82)
- **CAL-AC-21**: Given a run for an application that builds its own masters, with two light sessions that each have raw flats and a library with raw dark and bias sets, when the run reaches Calibrate, then the raw flats are offered per light session, and the raw dark and bias sets are offered as well. (D-W82)
- **CAL-AC-22**: Given flat master F at v3 (Latest) and an unfinished run R of Project P that uses v2, then R's row and Calibrate step, P's row and page, and v2's row in F's version list each read "Uses F v2 · Latest is v3" with Update. Choosing Update on P opens a confirmation listing R; confirming moves R to v3, and every notice clears. A Finished run that uses v2 shows no notice, and Move to Trash on v2 is refused while that run uses it. (D-W82, D-W92)

### Edge Cases

The [root contract](../063-clean-rebuild-contract/spec.md) governs file custody, uncertainty, exact membership, failed writes, and independent lifecycle decisions. Each acceptance scenario tests observable outcomes; no mock acknowledgment counts as terminal success.

- When more than one input is fully compatible, the top-ranked one is assigned automatically and the others are listed as alternatives in the requirement table. A ranking tie that leaves no single top input is not assigned automatically and needs review (D-W5).
- An automatic assignment the user replaces stays replaced: matching again for an unchanged group never overrides the user's choice (D-W5).
- A Results master that is hidden and later changes content is a new candidate and is offered once again (D-W5).

## Requirements

### Functional Requirements

- **CAL-FR-01**: The Calibration surface lists masters and raw calibration sets (flats, darks and bias) from indexed locations, grouped by camera, settings, channel, and relevant geometry, with compatibility and missing evidence. It includes the calibration frames Import routes to a Calibration location (LIB-FR-16, STO-IMP-FR-02). This is the library-wide surface; a run's Calibrate step matches only against its own rig (CAL-FR-10) (D-W24, D-W37, D-W82).
- **CAL-FR-02**: Matching is automatic by default. When a run reaches Calibrate, each light group whose best match has every criterion compatible is assigned that match automatically, recorded as Automatic under CAL-FR-08. A match with any unknown or incompatible criterion is never assigned automatically and stays a suggestion that needs review. The run's calibration policy can turn automatic assignment off, so that every match stays a suggestion until accepted. Suggestions stay visibly distinct from automatic and accepted assignments. When the run's membership revision changes, matching runs again for the changed groups (D-W5).
- **CAL-FR-03**: Why this match lists compatible, incompatible, and unknown criteria for every automatic, suggested and accepted assignment, and remains available after assignment (D-W5).
- **CAL-FR-04**: Raw calibration sets can be assigned for an external application that builds its own masters. Raw flats are offered per light session, because the application stacks them as part of that session. Raw dark and bias sets are offered as well (D-W82).
- **CAL-FR-05**: In the requirement table, for a mismatch or unknown criterion, the user can choose another input, exclude the session, defer, or record a scoped exception with a reason. The user can also mark one or more selected rows **No calibration** for their type, which needs no reason. The requirement table also lets the user replace an automatic assignment with another input. The criterion and reason are kept. An exception never rewrites master evidence or makes a master universally compatible (D-W5, D-W82).
- **CAL-FR-06**: Detected candidate masters show Add to calibration library, with type, camera/settings, channel, source evidence, and origin. A generated master that Results discovery (RES-FR-01) newly finds in a run's Results is offered once, in that run's Results step, alongside Import masters in the library (CAL-FR-13). Hide records the decline for that file and digest, so the offer does not return; the candidate stays listed in Calibration. Adoption needs explicit confirmation and records actual provenance. Detection alone never makes a master available for reuse. Candidate and adopted masters are protected by default (STO consumes this) (D-W5, D-W55, D-W82).
- **CAL-FR-07**: Adopted master storage follows D05 in the root decision register. Adoption never leaves a reusable master disposable along with its processing folder. Adoption review records the candidate's identity and SHA-256, and the evidence shown is bound to that digest. Copying hashes the bytes it reads and compares them with the reviewed digest; the destination re-read must match it, and immediately before registration the source's current identity and digest must still match. Any mismatch blocks adoption and registers nothing. Adoption checks the destination path during review and again immediately before writing; an existing entry there is never overwritten and blocks adoption until another path or destination is chosen. The generated source retained after verified adoption remains protected Keep until separately reviewed as a verified duplicate.
- **CAL-FR-08**: Every assignment, whether automatic or accepted in the requirement table, records the selected calibration identities, for a master its version, their SHA-256 and evidence for the run revision (D19). An adopted master is assigned automatically, suggested or accepted only while its current bytes match its adoption digest; on drift it reads drifted, stays protected and needs review. Preparation re-verifies every assignment under PREP-FR-09. Unaccepted suggestions never enter a verified handoff. Unresolved requirements stay named and need acceptance, exception, alternate input or explicit exclusion (D-W5).
- **CAL-FR-09**: The Calibrate step shows one readiness line for the run and, below it, the requirement table, which stays visible after every requirement is resolved. The line counts light groups that are matched (automatic or accepted), that need review (unknown, incompatible or missing), and that have a scoped exception, an exclusion or No calibration. Examples: "Calibration ready · 6 of 6 groups matched" and "5 of 6 groups matched · 1 needs review". Each row is a light group and a calibration type it requires, with the assigned or suggested input, its state and Why this match. The match criteria (exposure, gain, offset, temperature and binning) are visible columns. The input cell is a picker that lists the recommended master first, shows its matching metadata on hover, and searches the other masters. Selecting rows offers Assign, which sets one master for every selected row, and No calibration. The states are Automatic, Suggested, Accepted, Excepted, Excluded, No calibration and Needs review. Proceed is disabled until every row has an input or No calibration (D-W5, D-W77, D-W82).
- **CAL-FR-10**: A run uses one rig, so matching covers one camera and one optical train. Inputs from another camera are never candidates. Flats need the run's optical-train evidence: an unknown train reads unknown, and a different train reads incompatible. The requirement table groups by settings, channel and geometry, not by camera (D-W37).
- **CAL-FR-11**: In a mosaic run group, calibration is matched per panel run. The group shares one calibration policy, automatic assignment on (the default) or off; each panel run has its own assignments, readiness line, exceptions and exclusions. The group lists each panel's readiness, and an exception recorded in one panel run does not apply to another (D-W41, D-W55).
- **CAL-FR-12**: Calibration-matching evidence for a Project's candidate sessions, per subject and channel, supplies the missing-calibration and exposure-mismatch warnings that PRJ shows (PRJ-FR-11). Producing this evidence assigns nothing, sets no goal and never blocks a run (D-W29).
- **CAL-FR-13**: Import masters in the Calibration library lets the user pick master files through the native file dialog, with several files at once and FITS and XISF filters. A preview table then shows each file with its kind, camera, gain and offset, temperature and exposure read from its headers, and its match: **New**, **Replaces {master}** when its kind and settings match an existing library master, or **Duplicate** when its bytes match a library master. A file whose headers do not identify it as a master is named and not imported. Confirming imports the selected files into a Calibration location under the Import custody rules (STO-IMP-FR-03 to STO-IMP-FR-05); a Duplicate is skipped. A file that Replaces a master follows CAL-FR-14 (D-W82).
- **CAL-FR-14**: A library master is one record with an ordered list of **versions**. The record holds its kind, its camera and the settings it matches; each version is one file with its SHA-256, its adoption provenance and its date. Exactly one version is current and is marked **Latest** wherever the master shows. Replace… on a master, and an Import masters file that Replaces it (CAL-FR-13), use the same file choice and matching step and add a version that becomes Latest. The confirmation lists every unfinished run that uses an older version, and confirming moves those runs to Latest; their Calibrate steps re-verify it under CAL-FR-08. Finished runs keep the version they recorded. Matching and automatic assignment use only the Latest version (D-W82).
- **CAL-FR-15**: Darks, bias and dark-flats older than N days carry an "Old · {n} d" badge in the Calibration library, where N is a setting that defaults to 90; flats are exempt. The badge looks at the Latest version only. An old master shows an issue only while it is assigned in an unfinished run: on that run's row and on the master's row, naming the run (D-W82, D-W92).
- **CAL-FR-16**: Hide acts on the whole master with all its versions. It removes the master from the Calibration list, matching and offers without touching its file; Show hidden lists hidden masters with Restore. Hide is refused while a run uses the master, and the refusal names those runs. Hide on a Results offer is the decline of CAL-FR-06 (D-W76, D-W82).
- **CAL-FR-17**: **Move to Trash** sits beside Hide. On a version that is not Latest it moves that version's file to the OS Trash and removes the version; on the master it moves every version's file and removes the master. Its review names each file with its identity and SHA-256. It is refused while any run, Finished or not, uses a version it would remove, and the refusal names those runs. PV-STO executes the move under the custody rules of STO-FR-04 and STO-FR-05: execution re-verifies the file immediately before the move (D19), files go to the OS Trash only with no permanent delete, and a location without OS Trash refuses the move and leaves the file in place (D-W82).
- **CAL-FR-18**: While an open Project's unfinished run uses a version of a master that is not Latest, the app says so on the affected rows, never in a list of its own (D-W92): on the run's row and its Calibrate step, on the Project's row and page, and on that version's row in the master's version list. Each notice reads "Uses {master} v{n} · Latest is v{m}" and offers **Update**. Update opens the confirmation of CAL-FR-14, listing the runs it moves; on a Project it lists every unfinished run of that Project that uses an older version. Finished runs never show the notice and are never moved (D-W82, D-W92).

### Owned interaction steps

- E1
- E2
- H4
- Cross-flow: Calibration mismatch
- Calibration surface: Import masters, Replace… and master versions with Latest, Update notices, Old badge, Hide and Show hidden, Move to Trash (D-W82)
- Calibrate step: readiness line and requirement table, with Assign and No calibration (D-W5, D-W82)
- Run-group calibration per panel (D-W41)

### Key Entities

Use the [root vocabulary](../063-clean-rebuild-contract/spec.md#key-entities). Feature-specific evidence and decisions retain their input identity, scope, and revision.

- **Processing run (View)**: the unit whose Calibrate step matches calibration; it belongs to one Project and uses one rig (D-W1, D-W37). A mosaic subject's runs form a run group with one run per panel (D-W38).
- **Calibration assignment**: the input chosen for one calibration type of one light group in a run revision, in state Automatic, Suggested, Accepted, Excepted, Excluded or Needs review; for a master it names the version (D-W5, D-W82).
- **Library master**: one record per kind, camera and matched settings, with ordered versions; one version is Latest, and every version keeps its file, SHA-256 and provenance (D-W82).
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
- Workflow decision D-W82 (Round 9 C9 and C2, 2026-10-12) adds Import masters with a header-checked preview, Replace… across unfinished runs, the age badge, and Hide for library masters. It keeps the requirement table on the Calibrate step instead of behind Review matches, and No calibration needs no reason. The owner's answers of 2026-10-14 make a master one record with versions and a Latest version, with Update notices on the rows of runs and Projects still using an older one, add Move to Trash for library masters, keep the Results-step offer and keep raw flats per light session with raw dark and bias sets. How many darks and bias masters one light session matches is not settled.
