# Feature Specification: Validation Bugfix & Remediation

> **⚠ Partial supersession (2026-06-18)**: the catalog signature-verification work here (D5 minisign,
> `catalog.manifest.fetch` / `catalog.download`, tasks T002 / T064 / T068) is superseded by
> [Spec 035 — SIMBAD Target Resolution](../035-simbad-target-resolution/spec.md), which drops catalog
> download + signing in favour of on-demand SIMBAD resolution. The non-catalog 033 remediation work
> (setup wizard, tool detection, etc.) is unaffected.

**Feature Branch**: `main` (worked on `main` per the 2026-06-17 handover and the validated Windows sync loop; not a dedicated feature branch)

**Created**: 2026-06-17

**Status**: Draft

**Input**: User description: remediate the gaps found in the 2026-06 autonomous-run independent validation so the application actually works for a real user against the real backend (not fixtures), with two mutually-aligned verification deliverables: a reproducible automated test suite and a manually-validated interactive runbook.

## Context & Framing

This is a **remediation** feature, not greenfield. The desktop app (design-v4 UI) and the
backend crates already exist; gates are green (`cargo test` 1087, `vitest` 465, clippy/fmt/typecheck).
But green gates only prove *tested* logic. Independent validation
(`docs/development/autonomous-run-2026-06-validation-findings.md`) found that many features are
**implemented yet cannot fire on real data**, several event subscribers are **never started at
runtime**, the filesystem-apply path has **safety holes**, and there is **contract/schema drift**
with no conformance tests. This feature turns each diagnosed issue into a testable requirement and
fixes it.

Hard boundaries (Project Constitution):

- **§II Reviewable Filesystem Mutation** — every move/copy/archive/delete/trash is a reviewable
  plan, applied explicitly, never silently overwriting, with a per-item audit record; destructive
  operations prefer archive/trash over permanent deletion.
- **§III PixInsight Boundary** — the app organizes, maps, prepares, observes, documents, and plans;
  it never calibrates, debayers, registers, integrates, or edits images.
- **§V Durable Records** — the database is the canonical relationship and audit record; manifests
  and source views are reproducible projections.

Out of scope: rebuilding the design-v4 UI; adding new product surfaces beyond what the validated
specs already promised; image processing of any kind.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Safe filesystem plan application (Priority: P1)

As a library owner applying an approved cleanup/move plan, I need every file action to resolve to
the correct location under my library root, refuse anything that would escape the root or follow a
symlink/junction, and record an audit row for every item — including bulk cancellations — so that
applying a plan can never silently damage, lose, or misplace my irreplaceable image files.

**Why this priority**: Safety-critical and a Constitution §II promise. No real plan application can
ship until this holds; it gates every other destructive workflow.

**Independent Test**: Construct a plan containing a normal item, a path that escapes the library
root, a symlinked path, a destination collision, and a stale (changed-on-disk) item; apply it; assert
the escaping/symlinked/stale/colliding items are refused with the correct reason, the safe item
applies, every item (and every bulk-cancelled item) has an audit row, and the library is left in a
recoverable state.

**Acceptance Scenarios**:

1. **Given** a plan item whose resolved path lies outside the registered library root, **When** the
   plan is applied, **Then** the item is refused before any mutation and an audit row records the
   refusal reason (root escape).
2. **Given** a plan item whose path traverses a symlink or junction, **When** the plan is applied,
   **Then** the item is refused (the scan/apply must not follow links unless explicitly enabled) and
   audited.
3. **Given** a destructive (delete/trash) item, **When** the plan is reviewed, **Then** it carries an
   explicit destructive-confirmation signal that is independent of whether the source is protected,
   and the item is not applied until that confirmation is satisfied.
4. **Given** a destination file already exists, **When** the item is applied, **Then** the action is
   refused (no silent overwrite) and audited.
5. **Given** a batch of pending items is cancelled in bulk, **When** the cancellation completes,
   **Then** each cancelled item has its own audit row (not a single aggregate update).
6. **Given** a destructive item with the destination preference set to trash, **When** applied on a
   platform with a working recycle bin/trash, **Then** the file is moved to the OS trash (not
   permanently deleted) and audited; archive remains the fallback when trash is unavailable.

### User Story 2 - Background features actually run (Priority: P1)

As a user working through the app, I expect manifests to generate when a workflow completes,
processing artifacts to be detected as they appear on disk, and the guided first-project coach to
advance as I complete each real step — without me restarting the app or doing anything manual —
because these features are advertised but currently never activate at runtime.

**Why this priority**: Highest leverage — a single startup-wiring pass activates five features
(005/010/012/019/024) that are implemented and tested but never started. Without it, those features
are dead in the running app regardless of their code quality.

**Independent Test**: Run the real backend; complete a workflow and observe a manifest auto-generate;
drop an artifact file into a watched project root and observe it detected and classified with the
correct event emitted; complete each guided step's real action and observe the coach advance to the
next step.

**Acceptance Scenarios**:

1. **Given** the app has started, **When** a workflow run completes, **Then** its project manifest is
   generated automatically and persisted, resolving the project root via an async database lookup.
2. **Given** a registered project root is being watched, **When** a new processing artifact appears,
   **Then** it is detected, classified, and both the detected and classified domain events are emitted
   with payloads matching their published contract.
3. **Given** the guided first-project flow is active, **When** the user completes a step's real action
   (e.g., confirms inbox, creates a project, opens a tool), **Then** the coach advances to the next
   step driven by the corresponding domain event, ignoring replayed/restore events; the coach is
   rendered by the chosen tour component and never traps focus or blocks the underlying UI.

### User Story 3 - Real data flows end to end (Priority: P1)

As a user who has ingested a real folder of captures, I expect my sessions to appear grouped by
library root, calibration matching to suggest real master candidates, my targets to link to their
sessions and projects, and global search to find my real targets and aliases — because today these
read fixtures or unpopulated keys and show nothing for real libraries.

**Why this priority**: Without real data plumbing, the core value proposition is invisible on a real
library; this unblocks 006/007/023 and is a precondition for protection gating (US4).

**Independent Test**: Ingest a real sample folder; verify sessions appear grouped under their root;
verify calibration suggestions come from real master rows matched on populated fingerprints; verify a
target's detail shows its real sessions/projects; verify Cmd+K returns real targets/aliases for a typed
query.

**Acceptance Scenarios**:

1. **Given** a folder is ingested and confirmed, **When** the user opens the inventory, **Then** the
   resulting sessions carry their library root association and appear grouped under that root.
2. **Given** sessions and masters have metadata-derived fingerprints, **When** the user views
   calibration matches, **Then** suggestions are produced from real master rows (not fixtures) using
   the populated calibration/acquisition fingerprints.
3. **Given** a target was identified during ingestion, **When** the user opens that target, **Then**
   its linked sessions and projects are shown (the target association is persisted from ingestion).
4. **Given** the user types a query in global search, **When** results return, **Then** they reflect a
   real cross-entity query over targets, aliases, sessions, and projects (not query-ignoring fixtures).

### User Story 4 - Protected sources actually block cleanup (Priority: P2)

As a cautious library owner, I need cleanup and archive plans over a protected source to be blocked
and audited, because today the protection gate can never trigger on a plan produced by real code.

**Why this priority**: Constitution §II requires protected categories to gate cleanup. The gate exists
but is structurally dead; it depends on the cleanup-plan generator built/repaired in US1's vicinity, so
it sequences after the safety work.

**Independent Test**: Mark a source protected; generate a real cleanup/archive plan that includes items
from that source; verify the plan is blocked with the protected items identified (carrying their real
source identity), and that the block and any default-protection change are audited.

**Acceptance Scenarios**:

1. **Given** a source is protected, **When** a real cleanup/archive plan including that source is
   generated, **Then** the plan's items carry real source identity and category and the protection check
   blocks the protected items.
2. **Given** a blocked plan, **When** the user inspects it, **Then** each protected item identifies its
   originating source, and the block is recorded as an audit event.
3. **Given** the user changes the global default protection, **When** the change is saved, **Then** it is
   persisted and a default-changed audit event is recorded.

### User Story 5 - Trustworthy project lifecycle (Priority: P2)

As a user managing projects, I need a project's lifecycle state to be single-sourced, its blocked
banner to show the real reason, and automatic lifecycle transitions to be audited — because today two
tables can diverge, auto-transitions write no audit, and the blocked reason is hardcoded.

**Why this priority**: Lifecycle integrity affects trust in the project surface and the audit record
(§V), but is not safety-critical to the filesystem.

**Independent Test**: Drive a project through user-triggered and automatic transitions; verify both
surfaces read one canonical state; trigger a real block condition and verify the banner shows the
correct typed reason; verify auto-block/auto-ready and unarchive transitions write audit rows.

**Acceptance Scenarios**:

1. **Given** a project's state is changed via the user action and via an automatic transition, **When**
   both surfaces are read, **Then** they report the same canonical lifecycle state (no divergence).
2. **Given** a project is blocked by a specific condition (e.g., a missing source or unconfigured tool),
   **When** the user views the project, **Then** the blocked banner shows that specific typed reason, not
   a generic placeholder.
3. **Given** an automatic block, ready, or unarchive transition occurs, **When** the audit log is
   inspected, **Then** a corresponding audit row exists.
4. **Given** the lifecycle filter, **When** the user filters, **Then** they can select multiple lifecycle
   states at once.

### User Story 6 - Settings persist and contracts hold (Priority: P2)

As a user changing settings, I expect my changes (e.g., calibration aging threshold) to actually save
and take effect, and the data the UI exchanges with the backend to conform to a single agreed contract —
because today some settings are silently dropped and several contract versions/shapes have drifted.

**Why this priority**: Silent data-loss erodes trust and produces confusing behavior; contract drift is a
latent correctness hazard caught by no test today.

**Independent Test**: Change the aging threshold and reload; verify it persisted and that a consumer uses
it (not a hardcoded value); run schema-conformance tests over the affected operations and verify request
and response payloads validate against one agreed contract version.

**Acceptance Scenarios**:

1. **Given** the user sets the calibration aging threshold, **When** the app reloads, **Then** the value
   is persisted to a real settings scope/key and the calibration view uses it (no hardcoded threshold).
2. **Given** a settings change, **When** it is committed, **Then** the configured snapshot/debounce
   behavior runs (the snapshot is actually emitted, not merely scheduled in dead code).
3. **Given** the operations whose contracts drifted (log viewer version/cursor/export, artifact classify
   shape, project-create lifecycle value), **When** conformance tests run, **Then** the runtime payloads
   validate against the single agreed contract and mismatches fail the test.

### User Story 7 - Catalog integrity and authenticity (Priority: P3)

As a user importing a target catalog, I need its signature cryptographically verified, unknown licenses
rejected rather than silently downgraded, and catalog data written atomically — because today only the
checksum is verified, unknown licenses fall back to public-domain, and the writes are non-transactional.

**Why this priority**: Important for authenticity/licensing correctness, but real catalog downloads are
externally blocked today (the catalog repo is unpublished), so it is not yet user-exposed.

**Independent Test**: Import a catalog with a valid signature (accepted), a tampered/invalid signature
(rejected), and an unknown license code (rejected, not downgraded); interrupt a write mid-way and verify
no partial catalog/attribution remains; verify catalog slugs resolve consistently (no silent drop to
unknown).

**Acceptance Scenarios**:

1. **Given** a catalog manifest with a signature, **When** it is imported, **Then** the signature is
   cryptographically verified against the trusted key and a tampered signature is rejected.
2. **Given** a catalog entry with an unrecognized license code, **When** it is imported, **Then** the
   import hard-fails rather than silently treating it as public-domain.
3. **Given** a catalog upsert plus its attribution, **When** the write is interrupted, **Then** neither is
   left partially applied (the two writes are atomic).
4. **Given** catalog slugs defined by the lookup and the licensing layers, **When** a catalog is resolved,
   **Then** the slugs match and entries are not silently skipped as unknown.

### User Story 8 - Developer surface and remaining UI affordances (Priority: P3)

As a developer (and as a user), I need the developer diagnostics to actually capture calls and be absent
from release builds, and a set of smaller UI affordances (destructive-destination choice, "show ignored"
search entry, accurate inventory references, dynamic frame-type) to work as specified.

**Why this priority**: Lower user impact and partly developer-only; valuable for completeness and to clear
stale/misleading surfaces, but not blocking the core journey.

**Independent Test**: In a dev build, exercise an operation and verify the recording proxy captured it and
export writes to a chosen path; in a release build, verify the developer surface is absent; in the UI,
verify the destructive-destination toggle, the "show ignored" search entry, dynamic mixed frame-type, and
per-item inventory references behave as specified.

**Acceptance Scenarios**:

1. **Given** a dev build, **When** an operation runs, **Then** the recording proxy auto-captures it and an
   export succeeds to a user-chosen path.
2. **Given** a release build, **When** the app runs, **Then** the developer diagnostics surface is absent
   (compiled out), not merely hidden.
3. **Given** the inbox confirm screen, **When** the user chooses a destructive destination, **Then** the
   choice is surfaced and honored (not silently defaulted).
4. **Given** the command palette, **When** the user invokes "show ignored items", **Then** the entry exists
   and works; and mixed frame-type is derived from content, not a fixture string.

### User Story 9 - Provably working: aligned automated suite + interactive runbook (Priority: P1)

As the product owner, I need two verification artifacts that together prove the app works end to end on
real data and stay in lockstep: (1) a reproducible automated test suite I can run headless with no manual
steps, and (2) a manually-validated interactive runbook I follow against the real Windows binary — both
covering exactly the same feature/use-case set, joined by a traceability matrix with zero gaps.

**Why this priority**: This is the acceptance instrument for the whole feature; "verify before closing"
requires real-backend evidence, and the user has made the dual, aligned verification a first-class
requirement.

**Independent Test**: Run the full automated suite headless and confirm it passes deterministically with no
human interaction; follow the interactive runbook against the real binary and confirm each step's observed
result; open the traceability matrix and confirm every feature/use-case maps to at least one automated test
and one runbook step, with no unmatched rows on either side.

**Acceptance Scenarios**:

1. **Given** a clean checkout, **When** the automated suite is run headless (unit + integration +
   UI + real-backend end-to-end), **Then** it completes deterministically with no manual steps and every
   user story and functional requirement has at least one passing automated acceptance test.
2. **Given** the interactive runbook, **When** the user follows it against the real Windows-native binary,
   **Then** each item states a concrete action and an observable expected result, traceable to a functional
   requirement, and the core user journey is exercised on real (non-fixture) data.
3. **Given** the traceability matrix, **When** it is reviewed, **Then** every feature/use-case row links to
   its automated test(s) and its runbook step(s), and there are no feature/use-cases covered by only one of
   the two (no coverage gaps in either direction).
4. **Given** the four already-fixed defects (index-route redirect, masters-list null-safety, startup
   listener wiring, design-token/lint repair), **When** the suite runs, **Then** each has a regression test
   that would fail if the defect reappeared.

### Edge Cases

- A plan item resolves to a path on a different volume than the library root (cross-device move): must
  still apply safely and audited, or be refused with a clear reason — never silently lose the file.
- A plan item's source changed on disk after approval (stale baseline): must be refused as stale, using a
  staleness baseline captured at approval time.
- Two registered library roots overlap or a root is remapped to a new drive: path resolution must use the
  correct root and remain recoverable after remapping.
- A watched root is removed or becomes unavailable while the artifact watcher runs: detection must degrade
  without crashing the app.
- A guided step's domain event never fires (the user does something unexpected): the coach must allow
  dismissal and not strand the user.
- The OS trash/recycle bin is unavailable on the platform: destructive actions fall back to archive and the
  fallback is recorded.
- A settings value is set to a boundary (zero/very large aging threshold): it persists and the consumer
  handles it without error.
- A real-backend end-to-end test runs where no display server is present: the headless harness must still
  drive the real backend deterministically.

## Requirements *(mandatory)*

### Functional Requirements

**Filesystem-apply safety (US1)**

- **FR-001**: The system MUST resolve every plan item's path against its registered library root and MUST
  refuse, before any mutation, any item whose resolved path escapes that root.
- **FR-002**: The system MUST refuse to apply any plan item whose path traverses a symlink or junction
  unless link-following is explicitly enabled for that root/operation, and MUST audit the refusal.
- **FR-003**: The system MUST represent destructive confirmation as a signal distinct from a source's
  protection status, and MUST NOT apply a destructive item until its destructive confirmation is satisfied.
- **FR-004**: The system MUST refuse to overwrite an existing destination (no silent overwrite) and MUST
  audit the refusal.
- **FR-005**: The system MUST write a per-item audit record for every applied, refused, failed, or cancelled
  plan item, including each item cancelled as part of a bulk cancellation.
- **FR-006**: The system MUST prefer the OS trash/recycle bin for destructive removal where available and
  MUST fall back to archive when trash is unavailable, recording which destination was used.
- **FR-007**: The system MUST leave the library in a recoverable state after a partial or failed plan
  application (rollback or clearly audited partial completion), with no silent data loss.

**Background feature activation (US2)**

- **FR-008**: The system MUST automatically generate and persist a project manifest when a workflow run
  completes, resolving the project root via a database lookup.
- **FR-009**: The system MUST watch registered project roots and MUST detect new processing artifacts as
  they appear, emitting both the artifact-detected and artifact-classified domain events with payloads that
  conform to their published contracts.
- **FR-010**: The system MUST advance the guided first-project coach when the user completes a step's real
  action, driven by the corresponding domain event and ignoring replayed/restore-sourced events.
- **FR-011**: The guided coach MUST render via the selected tour component, MUST keep the underlying UI
  interactive (non-modal), and MUST allow dismissal at any step.

**Real data plumbing (US3)**

- **FR-012**: Ingestion (inbox confirm/apply) MUST associate created sessions with their library root so
  that real sessions appear grouped under that root in the inventory.
- **FR-013**: The system MUST populate calibration and acquisition fingerprints from extracted metadata and
  MUST back the masters list/detail with real persisted rows so calibration matching produces real
  suggestions.
- **FR-014**: Ingestion MUST persist the target association for identified captures so a target's detail
  shows its real linked sessions and projects.
- **FR-015**: Global search MUST execute a real cross-entity query over targets, aliases, sessions, and
  projects and MUST reflect the user's query (no query-ignoring fixtures).

**Protection gating (US4)**

- **FR-016**: Real cleanup/archive plan generators MUST tag each item with its real source identity and
  category and MUST invoke the protection check so protected sources block as required.
- **FR-017**: Protected plan items MUST carry their originating source identity in the response, and the
  block MUST be recorded as an audit event.
- **FR-018**: The system MUST persist global default protection settings and MUST record a default-changed
  audit event when they change.

**Lifecycle integrity (US5)**

- **FR-019**: The system MUST maintain a single canonical project lifecycle state read consistently by both
  the user-triggered and automatic transition surfaces (no divergent tables).
- **FR-020**: The system MUST persist a typed blocked reason and MUST surface that specific reason in the
  project blocked banner.
- **FR-021**: The system MUST write an audit record for automatic block, ready, and unarchive transitions.
- **FR-022**: The lifecycle filter MUST allow selecting multiple lifecycle states simultaneously.

**Settings & contract fidelity (US6)**

- **FR-023**: User settings changes (including the calibration aging threshold) MUST persist to a real
  settings scope/key and MUST be read by their consumer rather than a hardcoded value; the system MUST NOT
  silently drop a user-entered setting.
- **FR-024**: The system MUST execute the configured settings snapshot/debounce behavior (the snapshot is
  actually emitted).
- **FR-025**: The system MUST exchange request and response payloads that conform to a single agreed contract
  version for each operation, and MUST have automated conformance tests that fail on drift (covering at least
  the log-viewer version/cursor/export, artifact-classify shape, and project-create lifecycle value).

**Catalog integrity (US7)**

- **FR-026**: The system MUST cryptographically verify a catalog manifest's signature against the trusted key
  before accepting it, and MUST reject a tampered or invalid signature.
- **FR-027**: The system MUST reject catalog entries with unrecognized license codes rather than silently
  downgrading them to public-domain.
- **FR-028**: The system MUST apply a catalog upsert and its attribution atomically (no partial state on
  interruption).
- **FR-029**: Catalog slugs MUST resolve consistently across the lookup and licensing layers so entries are
  not silently skipped as unknown.

**Developer surface & remaining affordances (US8)**

- **FR-030**: In a development build, the system MUST auto-capture operations via the recording proxy and MUST
  allow exporting captured calls to a user-chosen path.
- **FR-031**: In a release build, the developer diagnostics surface MUST be absent (compiled out), not merely
  hidden.
- **FR-032**: The inbox confirm flow MUST surface the destructive-destination choice and honor it (no silent
  default).
- **FR-033**: The command palette MUST provide a working "show ignored items" entry, mixed frame-type MUST be
  derived from content rather than a fixed value, and inventory references MUST be shown per item where the
  spec requires.

**Verification deliverables (US9)**

- **FR-034**: The system MUST provide a reproducible automated test suite spanning unit, integration, UI, and
  real-backend end-to-end layers that runs headless with no manual steps and in which every user story and
  every functional requirement has at least one passing automated acceptance test.
- **FR-035**: The system MUST provide a manually-validated interactive runbook in which each item states a
  concrete action and an observable expected result, is traceable to a functional requirement, and which
  exercises the core user journey against the real binary on real (non-fixture) data.
- **FR-036**: The system MUST provide a traceability matrix mapping every feature/use-case to its automated
  test(s) and its runbook step(s), with no feature/use-case covered by only one of the two artifacts.
- **FR-037**: The four already-fixed defects (index-route redirect to the sessions view; masters list
  rendering with null fingerprints; startup wiring of the inbox plan listener and log forwarder; design-token
  and lint repair) MUST each have a regression test that fails if the defect reappears.

**Cross-cutting reconciliations (decided in planning/research, enforced here)**

- **FR-038**: The system MUST use a single canonical vocabulary for destructive destinations across all
  operations and contracts (resolving the prior `archive`/`os_trash` vs `trash`/`archive`/`none` drift).
- **FR-039**: Completion of any requirement MUST be evidenced only by passing automated tests and validated
  runbook steps; prior per-spec task checkboxes MUST NOT be relied upon as completion evidence.

### Key Entities *(include if feature involves data)*

- **Library Root**: a registered base location; relative item paths resolve against it; supports remapping and
  must be modeled separately from relative paths.
- **Plan & Plan Item**: a reviewable set of proposed filesystem actions; each item carries source identity,
  category, protection status, a destructive-confirmation signal, a staleness baseline captured at approval,
  and resolves to a path under a library root.
- **Audit Event**: a durable record of an attempted action and its outcome (applied/refused/failed/cancelled,
  with reason); the canonical history (§V).
- **Session**: an acquisition/calibration grouping associated with a library root and (where identified) a
  target; carries metadata-derived fingerprints.
- **Master / Calibration Fingerprint**: real persisted calibration master rows and the fingerprints used to
  match sessions to them.
- **Target & Alias**: catalog/user target identity with aliases; linked to sessions and projects; searchable.
- **Project & Lifecycle State**: a single canonical lifecycle state with a typed blocked reason; transitions
  (user and automatic) are audited.
- **Protection Default & Protected Source**: configured protected categories and per-source protection that
  gate cleanup/archive plans.
- **Catalog & Attribution**: imported target catalog data with a verified signature, a recognized license, and
  an attribution record written atomically.
- **Domain Event**: a runtime event (e.g., inventory-confirmed, project-created, tool-opened, workflow-run
  completed, artifact-detected/classified) emitted by the backend and consumed by subscribers and the UI.
- **Verification Artifact Set**: the automated test suite, the interactive runbook, and the traceability matrix
  that binds them.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user can complete the full core journey on a real sample library — ingest a folder →
  see sessions grouped → split a mixed folder via inbox → get real calibration suggestions → create a
  project → generate a reviewable plan → apply it safely → see manifests/notes persist → have cleanup
  blocked on a protected source → find a real target via global search — with zero crashes and zero
  unhandled errors.
- **SC-002**: 100% of applied plan items (and 100% of bulk-cancelled items) have a corresponding audit
  record; 100% of root-escaping, symlinked, stale, or colliding items are refused before mutation in test.
- **SC-003**: The five previously-inert background features (manifest generation, artifact detection,
  guided auto-advance, inbox auto-resolve, live log forwarding) are observed firing at runtime against the
  real backend without any manual restart.
- **SC-004**: 100% of functional requirements and user stories have at least one passing automated
  acceptance test, and the full suite runs headless to completion with no manual steps.
- **SC-005**: The traceability matrix shows 0 feature/use-cases covered by only the automated suite or only
  the runbook (no one-sided coverage), and every runbook item maps to a functional requirement.
- **SC-006**: Settings the user changes persist across a reload in 100% of tested settings controls (no
  silent drops), and contract-conformance tests pass for every operation previously flagged as drifted.
- **SC-007**: A catalog import with a tampered signature or an unknown license is rejected in 100% of test
  cases; no unsigned/unknown-license catalog data is ever accepted.
- **SC-008**: All project-quality gates remain green (workspace tests, lint, type-check, component tests),
  and the four already-fixed defects each have a regression test that fails when the defect is reintroduced.
- **SC-009**: In a release build, the developer diagnostics surface is provably absent (no developer route
  or commands reachable), verified by an automated check.

## Assumptions

- The canonical issue list is `docs/development/autonomous-run-2026-06-validation-findings.md`; prior per-spec
  `tasks.md` checkboxes are treated as unreliable and are not used as completion evidence.
- The design-v4 UI (specs 031/032) is approved and is NOT rebuilt; remediation wires the existing UI to real
  commands.
- "Targets" remains a primary-navigation entry (design-v4 is canonical); spec 023's prior "must not be primary
  nav" requirement is realigned to design-v4 as part of this feature.
- The guided tour uses react-joyride (pinned to the 3.1 line); the load-bearing work is the event→step-advance
  subscriber, which is built regardless of the rendering library.
- Real-backend automated verification runs headless in the Linux/WSL environment (offscreen display + real
  SQLite IPC); the interactive runbook runs against the Windows-native binary where a real window is visible to
  the user.
- Two safety-critical stubs are replaced with vetted, permissively-licensed libraries (catalog signature
  verification; OS trash), consistent with the project's "deliberate dependencies" rule; other narrow,
  well-tested hand-rolled code is kept.
- Real catalog downloads remain externally blocked (the catalog repository is unpublished); catalog integrity
  work is verified against local/test fixtures and is not gated on the external repo shipping.
- Work proceeds on `main` with direct commits per story (per the 2026-06-17 handover), and the Windows runtime
  mirror is synced from `origin/main`.
- The three cross-cutting reconciliations (destructive-destination vocabulary, the two project-lifecycle
  tables, the catalog slug mismatch) are decided explicitly during planning/research before the dependent
  stories are implemented.
