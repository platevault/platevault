# Feature Specification: Library: locations, indexing, sessions, Target/equipment evidence

**Feature Branch**: `063-clean-rebuild-contract`

**Spec ID**: `064-library-inventory`

**Created**: 2026-10-03

**Status**: Draft; product defaults and all human-approval gate waivers follow the root autonomous objective. Requirements analysis, implementation and verification remain required.

**Input**: Clean rebuild with selective reuse of verified code and the agreed PlateVault product flow.

## User Scenarios & Testing

### User Story 1 - Library: locations, indexing, sessions, Target/equipment evidence (Priority: P1)

Register locations and index them in place. Form metadata-homogeneous sessions, show association evidence and Target coverage, and keep offline and partial-scan state accurate.

**Why this priority**: This feature owns the workflow steps listed below without imposing unrelated product features.

**Independent Test**: Exercise the acceptance scenarios through the running product with isolated inputs. Existing baseline code does not prove the redesigned behavior.

**Acceptance Scenarios**:

- **LIB-AC-01**: Given onboarding with only Astro-T7/Captures added, when the user leaves Calibration and Results unset, then onboarding continues and the omitted roles read as not set, not as a failed setup.
- **LIB-AC-02**: Given a capture location is registered and fully indexed, then the before/after inventory of paths, names, and bytes in that location is identical.
- **LIB-AC-03**: Given one night of Ha 300 s and OIII 300 s frames, when indexing completes, then two separate sessions exist; a session with no OBJECT and insufficient other evidence shows an unresolved Target, not a guessed one.
- **LIB-AC-04**: Given a previously scanned subdirectory becomes unreadable, when the location is rescanned, then its frames are reported unreadable or of unknown scope, never Missing, and the scan scope is named incomplete.
- **LIB-AC-05**: Given Cold-1 is offline, when NGC 7000 is opened, then the 12 Sep contribution counts in captured integration with its last-observed values, shows Offline, and is not offered as an available input.
- **LIB-AC-06**: Given a wrong Target association, when the user corrects it, then the catalog association changes and the source file's header bytes are unchanged.
- **LIB-AC-07**: Given an indexing run has readable siblings and an access-denied folder, when Targets or Sessions is opened before completion, then already indexed sessions can be browsed, totals identify provisional scope, the failed folder offers Choose folder again or Retry, and siblings continue.
- **LIB-AC-08**: Given a catalog write fails or an edit uses a stale revision, when saving is attempted, then no durable success is reported; failure remains unsaved with Retry, and a stale edit is refused with the current revision available for review. Restart restores only the last committed state.
- **LIB-AC-09**: Given no account and no network, when the app starts, then Targets is the default home, Sessions, Settings and Activity are reachable, and registered local fixtures index and remain searchable without authentication.
- **LIB-AC-10**: Given an observed Ha header and a catalog correction to OIII, when regrouping is confirmed, then the corrected grouping revision is visible, original evidence and old session identities remain traceable, fixed View asset IDs are unchanged, and original file hashes match their pre-correction values.
- **LIB-AC-11**: Given two named copies with identical names but differing bytes, when remap is attempted, then the differing copy is refused. A byte-verified copy can be remapped without losing frame identities, quality decisions, or View membership.
- **LIB-AC-12**: Given a saved local target and a successful external resolver response, when enrichment is reviewed, then aliases, coordinates and provider provenance remain distinguishable from capture metadata. A resolver failure leaves the local target and indexed sessions usable.
- **LIB-AC-13**: Given the development app is running with its MCP bridge, when the test client connects and invokes indexing, queries sessions and controls navigation, then real persisted outcomes and the actual app surface are observed. The release configuration does not enable the unauthenticated development bridge.
- **LIB-AC-14**: Given a Usable frame replaced in place with its size and mtime preserved, when its location is rescanned, then the rehash marks it ChangedContent and keeps the previous decision as history. It leaves applicable usable totals, appears under the ChangedContent filter, and fixed View membership is unchanged. Restoring the reviewed bytes and rescanning returns the frame to applicable Usable totals without a new decision.
- **LIB-AC-15**: Given byte-identical copies of one session in two registered Captures locations, when indexing completes, then Sessions lists each frame once with both physical copies and captured integration counts it once. Both copies remain registered, protected and unchanged.

### Edge Cases

The [root contract](../063-clean-rebuild-contract/spec.md) governs file custody, uncertainty, exact membership, failed writes, and independent lifecycle decisions. Each acceptance scenario tests observable outcomes; no mock acknowledgment counts as terminal success.

## Requirements

### Functional Requirements

- **LIB-FR-01**: Onboarding Locations step: at least one Captures location is required. Calibration and Results are optional, and 'Set up later' is available. No workspace root is assumed. Each role supports multiple folders. Display names are editable. Each row shows path, role, access state, and online state.
- **LIB-FR-02**: Registering a location records only access and indexing intent. It does not copy, rename, move, or delete anything.
- **LIB-FR-03**: Indexing shows progress: files discovered, metadata read, unsupported, unreadable, and completed scope. Results appear progressively, and sessions already read can be browsed during indexing. Totals name the locations they cover and mark scope as provisional while a scan runs.
- **LIB-FR-04**: Sessions are metadata-homogeneous (Ha and OIII are separate). A night supports multiple sessions. The Sessions display supports grouping by night without changing session identity. OBJECT remains a label or filter, outside capture identity.
- **LIB-FR-05**: Target and equipment associations show the evidence used. Agreeing evidence permits association; unknown or conflicting evidence shows Needs review. A missing OBJECT with insufficient other evidence leaves the association unresolved. Confirm Target and Confirm equipment are available. Corrections change the catalog only, never source headers.
- **LIB-FR-06**: An incomplete or unreadable scan never marks unobserved files Missing. Readable siblings still reconcile.
- **LIB-FR-07**: An offline location keeps its last-observed metadata and quality decisions. Access denied names the failure and offers Choose folder again or Retry; other locations continue. Locate/remap to another verified location preserves asset identities using the same-asset proof in D11 of the root decision register.
- **LIB-FR-08**: Target search opens a Target page showing captured integration, library-wide usable integration, and Unreviewed integration by channel. Availability is a separate state. Offline contributions show their last observation and are not offered as available inputs. Usable totals come only from library-scope quality decisions. Content-identical copies in different locations count once as one logical capture that names every physical copy.
- **LIB-FR-09**: Persisted quality decisions are Unreviewed, Usable or Unusable; new frames start Unreviewed and measurement never sets Usable. Applicability is separate: ChangedContent preserves the previous decision when bytes differ or its historical review basis is absent. It exposes a distinct filter outside applicable Usable/Unreviewed totals until reconfirmed or the reviewed bytes return. Offline/unreadable inputs retain labelled last-observed quality, not an inferred content change.
- **LIB-FR-10**: PV-LIB owns local-first Targets as default home, Sessions, Settings, shared main navigation and Activity operation outcomes. Core indexing and inspection need no account or network.
- **LIB-FR-11**: Failed catalog writes remain unsaved with Retry. Version checks detect external changes before overwriting app-written entries; stale edits are refused rather than merged silently. Only durable commits report saved success.
- **LIB-FR-12**: Catalog metadata corrections include Target, equipment and grouping values. Original observed evidence remains separate; regrouping creates a traceable revision and never mutates fixed View asset membership or source headers.
- **LIB-FR-13**: The target catalog supports local records, coordinate/alias search, explicit associations and provider-provenance enrichment through the shared resolver/matching contracts. Unavailable external services do not block core library use or fabricate associations.
- **LIB-FR-14**: Development builds include a functional Tauri MCP bridge for application control and verification. Production builds do not expose that development bridge; production MCP shipping is optional future work.

### Owned interaction steps

- A1
- A2
- A3
- A4
- B1
- Cross-flow: Location offline
- Cross-flow: Partial scan
- Cross-flow: Unsaved catalog write fails
- Cross-flow: External changes
- Targets, Sessions, main navigation and Activity surfaces

### Key Entities

Use the [root vocabulary](../063-clean-rebuild-contract/spec.md#key-entities). Feature-specific evidence and decisions retain their input identity, scope, and revision.

## Success Criteria

### Measurable Outcomes

- **PV-LIB-SC-01**: Every acceptance scenario produces its stated outcome and refusal behavior.
- **PV-LIB-SC-02**: Every owned interaction step has a requirement and independently observable acceptance evidence.
- **PV-LIB-SC-03**: Original inputs remain unchanged except through separately reviewed and approved filesystem operations.

## Assumptions

- [Product flow](../../docs/reviews/2026-10-03-product-flow-and-journeys.md) supplies the confirmed interactions and illustrative worked example.
- This feature is independently specified; dependencies on other feature contracts are resolved in planning.
- Conservative defaults and all human-approval gate waivers follow the root autonomous objective and decision register. Tests, requirements analysis, independent review and delivery evidence remain mandatory.

## Decisions before feature approval

- Root decisions D01, D08, D10, D11, D15, D16, D17 and D18 define geometry evidence, failed-write recovery, quality, equipment/remap proof, grouping revisions, location availability, development MCP and target enrichment. Their implementation still requires fixture and platform evidence.
