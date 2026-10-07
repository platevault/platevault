# Feature Specification: Library: locations, indexing, sessions, Target/equipment evidence

**Feature Branch**: `063-clean-rebuild-contract`

**Spec ID**: `064-library-inventory`

**Created**: 2026-10-03

**Status**: Draft; product defaults and all human-approval gate waivers follow the root autonomous objective. Requirements analysis, implementation and verification remain required.

**Input**: Clean rebuild with selective reuse of verified code and the agreed PlateVault product flow.

## User Scenarios & Testing

### User Story 1 - Library: locations, indexing, sessions, Target/equipment evidence (Priority: P1)

Register locations, including OS-mounted network volumes, and index them in place. Form metadata-homogeneous sessions, show association evidence and Target coverage, and keep offline and partial-scan state accurate. Index what Import lands without an Inbox. Point Sessions at sessions that need a Target or belong to no Project. Keep Trashed frames out of every list and total except the Sessions "Trashed" filter.

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
- **LIB-AC-09**: Given no account and no network, when the app starts, then Home opens; Targets, Sessions, Import, Settings and Activity are reachable, and registered local fixtures index and remain searchable without authentication. (D-W7, D-W39)
- **LIB-AC-10**: Given an observed Ha header and a catalog correction to OIII, when regrouping is confirmed, then the corrected grouping revision is visible, original evidence and old session identities remain traceable, the asset IDs fixed in each processing run (View) are unchanged, and original file hashes match their pre-correction values. (D-W3)
- **LIB-AC-11**: Given two named copies with identical names but differing bytes, when remap is attempted, then the differing copy is refused. A byte-verified copy can be remapped without losing frame identities, quality decisions, or run membership. (D-W3)
- **LIB-AC-12**: Given a saved local target and a successful external resolver response, when enrichment is reviewed, then aliases, coordinates and provider provenance remain distinguishable from capture metadata. A resolver failure leaves the local target and indexed sessions usable.
- **LIB-AC-13**: Given the development app is running with its MCP bridge, when the test client connects and invokes indexing, queries sessions and controls navigation, then real persisted outcomes and the actual app surface are observed. The release configuration does not enable the unauthenticated development bridge.
- **LIB-AC-14**: Given a Usable frame replaced in place with its size and mtime preserved, when its location is rescanned, then the rehash marks it ChangedContent and keeps the previous decision as history. It leaves applicable usable totals, appears under the ChangedContent filter, and fixed run membership is unchanged. Restoring the reviewed bytes and rescanning returns the frame to applicable Usable totals without a new decision. (D-W3)
- **LIB-AC-15**: Given byte-identical copies of one session in two registered Captures locations, when indexing completes, then Sessions lists each frame once with both physical copies and captured integration counts it once. Both copies remain registered, protected and unchanged. When one copy is later replaced in place with its size and mtime preserved, the next rescan of its location names the pair conflicting copies. The capture still counts once, and neither copy is offered in place of the other.
- **LIB-AC-16**: Given an offline location whose copies are fixed run members, when Retire location is reviewed and confirmed, then the review named the location and the sessions, runs, Projects and Results that reference its copies. It stated that no file changes. If the location's availability changed after the review, confirmation is refused and a new review is required. Its copies then read Retired, never Missing, and leave integration totals. The run names them unresolved with its membership and prepared revision unchanged. Reselecting the location is refused, and registering its folder again succeeds and counts each capture once. (D-W3)
- **LIB-AC-17**: Given Import has copied one night of Ha lights to Astro-T7/Captures and some flats and darks to the Calibration location. When Import finishes, the lights appear in Sessions as sessions with no Inbox or confirm step. The flats and darks appear in the Calibration library and in no Sessions list. Some files Import held back: Unclassified frames, SHA-256 duplicates, and files still being written. None of those appear in the catalog. (D-W24)
- **LIB-AC-18**: Given session A has no confirmed Target, and session B's confirmed Target and rig match no Project's subjects and rigs, when Sessions opens, then the "Needs a Target" filter lists A and not B. "Not in any Project" lists B and not A, and offers Create Project and Add to Project. Confirming A's Target moves A out of "Needs a Target". Adding B's Target to a Project as a subject, with B's rig listed on that Project, moves B out of "Not in any Project". Neither filter assigns B to any run. (D-W33, D-W35, D-W37, D-W39, D-W59)
- **LIB-AC-19**: Given 12 Unusable frames were moved to the OS Trash from a Project's Done / Archive sheet, the user opens Sessions, Targets, Home, a run's session picker, Project candidates, frame review or any total. Those frames are absent there and counted nowhere. Two of them are members of a run that was Complete when they were trashed, and that run's fixed membership still lists those two, marked "Trashed". The Sessions "Trashed" filter lists all 12 with their last-observed metadata and the operation that trashed them. A rescan of their location reports none of them Missing. After the user restores them with Put back in the OS Trash and rescans the location, they return as Unusable and count wherever Unusable frames count. (D-W43, D-W52)
- **LIB-AC-20**: Given a Captures location on a network share the OS has already mounted, when it is registered and indexed, then its row is flagged as a network volume and hashing shows progress. When the share is unmounted mid-hash, the location reads Offline, no frame reads Missing, and completed hashes are kept. When it is mounted again, hashing resumes with the remaining files and does not rehash completed ones. PlateVault offers no way to mount a share or enter an SMB or URL address. (D-W12)

### Edge Cases

The [root contract](../063-clean-rebuild-contract/spec.md) governs file custody, uncertainty, exact membership, failed writes, and independent lifecycle decisions. Each acceptance scenario tests observable outcomes; no mock acknowledgment counts as terminal success.

## Requirements

### Functional Requirements

- **LIB-FR-01**: Onboarding Locations step: at least one Captures location is required. Calibration and Results are optional, and 'Set up later' is available. No workspace root is assumed. Each role supports multiple folders. Display names are editable. Each row shows path, role, volume kind (local, removable or network), access state, and online state. (D-W12)
- **LIB-FR-02**: Registering a location, including Import's "Add existing library folder", records only access and indexing intent and indexes the folder in place. It does not copy, rename, move, or delete anything. (D-W11)
- **LIB-FR-03**: Indexing shows progress: files discovered, metadata read, unsupported, unreadable, and completed scope. Results appear progressively, and sessions already read can be browsed during indexing. Totals name the locations they cover and mark scope as provisional while a scan runs.
- **LIB-FR-04**: Sessions are metadata-homogeneous (Ha and OIII are separate). A night supports multiple sessions. The Sessions display supports grouping by night without changing session identity. OBJECT remains a label or filter, outside capture identity.
- **LIB-FR-05**: Target and equipment associations show the evidence used. Agreeing evidence permits association; unknown or conflicting evidence shows Needs review. A missing OBJECT with insufficient other evidence leaves the association unresolved. Confirm Target and Confirm equipment are available; Confirm equipment sets the session's rig, the optical train whose filter list PLAN-EQ-FR-01 defines. A session whose FILTER value matches no filter on its confirmed rig shows that filter as unknown in its Sessions row, with the "Add {value} to {rig}" prompt of PLAN-EQ-FR-04. Corrections change the catalog only, never source headers. (D-W31, D-W37)
- **LIB-FR-06**: An incomplete or unreadable scan never marks unobserved files Missing. Readable siblings still reconcile.
- **LIB-FR-07**: An offline location keeps its last-observed metadata and quality decisions. Access denied names the failure and offers Choose folder again or Retry; other locations continue. Locate/remap to another verified location preserves asset identities using the same-asset proof in D11 of the root decision register.
- **LIB-FR-08**: Target search opens a Target page showing captured integration, library-wide usable integration, and Unreviewed integration by channel. Availability is a separate state. Offline contributions show their last observation and are not offered as available inputs. Usable totals come only from library-scope quality decisions. Content-identical copies in different locations count once as one logical capture that names every physical copy.
- **LIB-FR-09**: Persisted quality decisions are Unreviewed, Usable or Unusable; new frames start Unreviewed and measurement never sets Usable. Applicability is separate: ChangedContent preserves the previous decision when bytes differ or its historical review basis is absent. It exposes a distinct filter outside applicable Usable/Unreviewed totals until reconfirmed or the reviewed bytes return. Offline/unreadable inputs retain labelled last-observed quality, not an inferred content change.
- **LIB-FR-10**: PV-LIB owns local-first Sessions, the Target page (LIB-FR-08), Settings, shared main navigation and Activity operation outcomes. The Targets list belongs to PV-PLAN (PLAN-TGT-FR-01), and so do the Settings > Equipment filter lists; Settings > Goal templates belongs to PV-PRJ and Settings > Naming to PV-STO. The app opens on Home, the Projects dashboard (PV-PRJ), and main navigation gives Import (PV-STO) and Planning, the Targets list, their own entries. Core indexing and inspection need no account or network. (D-W7, D-W17, D-W39)
- **LIB-FR-11**: Failed catalog writes remain unsaved with Retry. Version checks detect external changes before overwriting app-written entries; stale edits are refused rather than merged silently. Only durable commits report saved success.
- **LIB-FR-12**: Catalog metadata corrections include Target, equipment and grouping values. Original observed evidence remains separate; regrouping creates a traceable revision and never mutates fixed run asset membership or source headers. (D-W3)
- **LIB-FR-13**: The target catalog supports local records, coordinate/alias search, explicit associations and provider-provenance enrichment through the shared resolver/matching contracts. Unavailable external services do not block core library use or fabricate associations.
- **LIB-FR-14**: Development builds include a functional Tauri MCP bridge for application control and verification. Production builds do not expose that development bridge; production MCP shipping is optional future work.
- **LIB-FR-15**: Retire location is an explicit, reviewed exit for a location the user does not expect to verify again, such as a deleted root or one moved without stable folder identity. Review names the location, root and availability and the assets, sessions, runs, Projects and Results that reference its copies, and states that retiring deletes, moves or modifies no file. Retirement is catalog-only: it reads and changes no file bytes, so D19 rehashing does not apply. Confirmation re-reads the location and is refused on a stale review or revision, when its availability differs from the reviewed availability, and while an operation affecting the location is Running or has unfinished items. A retired location is never reselected, rescanned or remapped. Its copies read Retired, never Missing; they are not offered as inputs, counted as available or included in captured, usable or Unreviewed integration or Project progress. Their last-observed metadata and decisions remain inspectable as history. Fixed run memberships and prepared revisions keep their asset IDs and name retired copies unresolved (D02). Retirement frees the root from the overlap check, so its folder can be registered again as a new location with new asset identities. No retired quality decision, Target or equipment association, or catalog correction transfers to them automatically; their sessions start from their own evidence. (D-W3)
- **LIB-FR-16**: Import (PV-STO) places files and the library indexes them as they land. Lights land in a Captures location and appear in Sessions as sessions, with no Inbox and no separate confirm step. Calibration frames (darks, flats, bias frames and masters) land in a Calibration location and appear in the Calibration library, never in Sessions. The catalog never gains a file that Import held back: an Unclassified frame until the user gives it a type, a file whose SHA-256 matches an indexed frame, or a file still being written. A skipped duplicate adds no copy and leaves the existing frame's identity, decisions and totals unchanged. (D-W24)
- **LIB-FR-17**: Sessions offers the filters "Needs a Target" and "Not in any Project". "Needs a Target" lists sessions with no confirmed Target, including unresolved and Needs review associations. "Not in any Project" lists sessions with a confirmed Target that are neither a candidate of any Project nor a member of any Project's run. A candidate is a session whose confirmed Target is one of a Project's subjects and whose rig is one of that Project's rigs (PV-PRJ owns the rule). "Not in any Project" offers Create Project, prefilled with the session's Target as subject and its rig. It also offers Add to Project, which adds the Target as a subject and, when the Project lacks it, the session's rig. When it adds the rig, a visible note names it before saving. Both filters derive from current associations, Project subjects and rigs, and run memberships. They assign nothing to a run, and their counts are the ones Home reports as "N sessions need a Target · M not in any Project". (D-W33, D-W35, D-W37, D-W39, D-W45, D-W59)
- **LIB-FR-18**: A frame moved to the OS Trash from a Project's Done / Archive sheet (STO-FR-14) keeps its catalog record with the state Trashed. The record keeps its identity, SHA-256, last-observed metadata, quality history and the operation that trashed it. Every query and total excludes Trashed frames. That covers run session pickers, Project candidates, frame review, Sessions, Targets, Home, overviews and goals. It also covers captured, usable and Unreviewed integration, and Storage footprints and duplicate candidates. A session whose frames are all Trashed leaves Sessions. The Sessions "Trashed" filter is the only list that shows them, with one exception: a frame trashed after its run was Complete still shows in that run's fixed membership, marked "Trashed". Fixed run memberships and prepared revisions keep their asset IDs and never offer a Trashed frame as an input. A rescan never reports a Trashed frame Missing. PlateVault offers no restore of its own. After the user chooses Put back in the OS Trash, a rescan that finds the file at its recorded path with a matching SHA-256 returns it as Unusable. The Trashed episode stays as history. Different bytes at that path follow the ChangedContent rule in LIB-FR-09. (D-W43, D-W52)
- **LIB-FR-19**: A location may sit on a network share that the OS has already mounted. PlateVault does not mount shares and accepts no SMB or URL address. A location on a network volume is flagged as one in its row. Hashing on a network volume shows progress and is resumable: an interruption or unmount keeps completed hashes, and hashing resumes with the remaining files once the share is mounted again. An unmounted network location reads Offline under LIB-FR-07, never Missing or deleted. (D-W12)

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
- Target page, Sessions, main navigation and Activity surfaces
- Import landing: lights to Sessions, calibration frames to the Calibration library (with PV-STO)
- Sessions filters: Needs a Target, Not in any Project, Trashed
- Cross-flow: Network volume unmounted

### Key Entities

Use the [root vocabulary](../063-clean-rebuild-contract/spec.md#key-entities). Feature-specific evidence and decisions retain their input identity, scope, and revision. This feature adds:

- **Processing run (View)**: the UI name for a View; it belongs to exactly one Project and uses one subject and one rig. This spec calls it a run.
- **Rig**: an optical train. A session has one rig, taken from its confirmed equipment association.
- **Trashed frame**: a catalog record kept for traceability after its file went to the OS Trash. It is hidden from every query and total except the Sessions "Trashed" filter and the fixed membership of a run that was Complete when it was trashed. (D-W43, D-W52)
- **Network volume**: a location on an OS-mounted network share, flagged in its row, hashed resumably and read Offline when unmounted.

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
- Root decision D19 binds usable totals, logical-capture proof and remap to their recorded identity and SHA-256. Metadata-only captured totals and labelled last-observed offline or unreadable counts stay as LIB-FR-07 and LIB-FR-08 specify.
- Root decision D11 adds the explicit Retire location exit. Retired copies leave integration totals, since a retired location never returns through reselect as an Offline one can.
- Workflow decisions D-W3, D-W7, D-W11, D-W12, D-W17, D-W24, D-W31, D-W33, D-W35, D-W37, D-W39, D-W43, D-W45, D-W52 and D-W59 (settled 2026-10-06) apply here. They set the run terminology, Home and navigation, in-place registration, network volumes and Import landing. They also set the rig and its unknown-filter prompt, the Sessions filters and the Trashed state. The candidate rule itself belongs to PV-PRJ, Import and the trash operation to PV-STO, and the Targets list and rig filter lists to PV-PLAN.
