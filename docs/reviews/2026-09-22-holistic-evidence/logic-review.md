# Wave-one correctness and architecture review

## Review basis and limitations

Model identity exposed by the harness: **openai-codex/gpt-6-astra**. The dispatch role selector itself is not exposed, so I cannot independently attest that it was configured as `@max`.

This report covers the supplied snapshot through read-only source inspection. No files were written; no commands, builds, formatters, linters, tests, database operations, server startup, or runtime validation were performed. Reproducers below are proposals, not executed results. There are no rendered-interface or visual claims.

The file inventory accompanying this report identifies the inspected sections and targeted lookups. This was a cross-boundary review, not an exhaustive audit of every file under `crates/`. FITS/XISF binary parsing, filesystem executor internals, complete archive/delete flows, all topology repositories, all command-ledger implementations, and every migration trigger are outside the inspected depth. Filesystem mutation findings are limited to their app/persistence orchestration.

No existing `graphify-out/graph.json` was found. Direct source search was used; graph generation and prose-validation tooling were not run because this assignment prohibits writes and validation.

## Domain boundaries and traced flows

- **Metadata:** `RawFileMetadata` is optional header data; the evidence model separately represents known/absent/invalid/contradictory values, validates finite decimals, and bounds payload sizes (`crates/metadata/core/src/evidence.rs:8-80,101-141`). Physical rotator angle and sky orientation are distinct in the raw contract.
- **Sessions:** legacy `SessionKey` serializes target/filter/binning/gain/night (`crates/sessions/src/key.rs:53-108`). New immutable identities additionally model operation identity, exact capture fields, optical profile, exposure, geometry and camera identities (`crates/sessions/src/identity.rs:61-185`). Framing clustering is a separate domain concern, rather than a reason to mutate session identity.
- **Live ingestion:** desktop boot starts the inbox listener (`apps/desktop/src-tauri/src/lib.rs:718-721`). Both the listener and repair sweep reach `complete_applied_plan`, which registers masters, ingests light frames, and disposes of the inbox link (`crates/app/inbox/src/plan_listener.rs:220-239`; `crates/app/inbox/src/repair.rs:43-83`). Light ingestion writes the legacy `acquisition_session` and `acquisition_fingerprint` stores.
- **Calibration:** loaders construct pure `SessionInfo`/`MasterInfo` values, the domain engine ranks candidates, and app assignment persists the result. Desktop commands expose this path (`apps/desktop/src-tauri/src/commands/calibration.rs:85-111`). The newer handoff snapshot code accepts a caller-owned SQLite connection and advances its head with an expected generation (`crates/app/calibration/src/session_handoff/snapshots.rs:63-134,162-229`).
- **Projects:** live creation builds a project, source links, inferred channels and scaffolding plan through one composite repository call; app/core subsequently attempts the approved scaffolding flow (`crates/app/projects/src/project_setup/create.rs:389-405`; `crates/app/core/src/project_create.rs:51-84`). Prepared-view generation is exposed by the desktop and enters the shared filesystem-plan executor.
- **Persistence/recovery:** SQLite uses WAL, explicit foreign keys and a bounded busy timeout; the current pre-1.0 release contract is a single edited-in-place baseline, not supported upgrades from prior development schemas. Boot refuses divergence rather than silently using the wrong schema (`apps/desktop/src-tauri/src/lib.rs:625-648`). Legacy plans left applying are made recoverable at startup, and terminal-write failures are not announced as successful (`crates/app/core/src/plan_apply/lifecycle.rs:12-31`; `crates/app/core/src/plan_apply/terminal.rs:20-54,148-162`).

### Important caller-tracing result

Repository-wide exact-symbol searches found `session_materialization::apply::run_apply` callers in integration tests, but no production Rust adapter call; likewise, the new `apply_update_view`/`run_apply_loop` callers found were tests and exports, not desktop commands. The frontend has hand-written materialization command names, but that is not proof of backend registration. Consequently, stronger new identity/transaction code is **not counterevidence** against defects in the verified live legacy path. I do not classify the new code as obsolete, and this report does not assert that every spec-062 feature is unreachable.

## Concrete strengths

1. **Domain algorithms are separable from I/O.** Calibration takes explicit metadata inputs and session identity is distinct from topology. This makes behavioral reproductions possible without a desktop runtime.
2. **New evidence contracts reject ambiguity instead of encoding it as zero.** The finite-number checks, private field-evidence state and validated deserialization materially improve trust boundaries (`crates/metadata/core/src/evidence.rs:101-180`).
3. **Project creation has a useful atomic boundary.** Project/source/channel/scaffolding rows are assembled before `create_project_tx`, avoiding the formerly fragmented creation sequence (`crates/app/projects/src/project_setup/create.rs:302-399`). Later readiness/event writes remain outside that transaction; the strength is limited to the composite creation itself.
4. **Recovery does not depend solely on broadcast delivery.** Inbox repair uses persisted links and startup runs a sweep; plan execution also has boot recovery and honest terminal-write failure reporting. COR-06 identifies a hole in acknowledgement policy, not absence of recovery infrastructure.
5. **The new materialization implementation explicitly rolls back SQL errors.** Its `tx_try!` helper avoids returning pooled connections with manually opened write transactions (`crates/app/inbox/src/session_materialization/apply.rs:65-87`). This is error-path protection, not proof that task abortion/crash recovery is complete.
6. **Migration divergence is an explicit release boundary.** The documented baseline reset policy means missing historical upgrade scripts are not, by themselves, a finding (`docs/release/pre-1-0-database-baseline.md:3-27`).

## Findings

### COR-01 — Approved frame-type overrides are discarded by live session ingestion

**Severity:** P1 · **Confidence:** High · **Type:** Defect

**Evidence:** `crates/app/inbox/src/confirm.rs:424-448,527-528,570-574,931-939`; `crates/persistence/targets/src/repositories/q_targets_ingest.rs:282-297`; `crates/app/targets/src/ingest_sessions.rs:191-198,716-728`.

**Causal trace:** Confirmation explicitly prioritizes manual and durable classification overrides. It freezes the approved frame type in provenance and stores it in the plan item's `category`. After apply, the repository loads only source/destination paths, dropping that approved category. `ingest_light_frame` reads the header again and `is_light_frame` decides eligibility solely from raw IMAGETYP.

**Proposed reproducer:** Classify a valid FITS file with absent/incorrect IMAGETYP as light, confirm and apply its plan. The move/catalogue succeeds, but ingestion returns `NotLight` and creates no acquisition-session membership. Conversely, override a raw light header to dark and apply it: this path still treats it as a light.

**Impact:** User-reviewed classification can disagree with persisted inventory; successfully processed light frames disappear from the session workflow, while explicitly reclassified non-light frames can enter light sessions.

**Counterevidence checked:** Confirmation already persists the correct decision; the defect is not missing override storage. Ingestion's re-read may legitimately obtain metadata, but is not authoritative for the approved type.

**Recommended fix:** Load the approved item category/frozen provenance and use that decision for ingestion eligibility. Keep header extraction for fields not pinned by the approved plan. Define an explicit policy for older rows lacking approved classification.

**Verification needed:** End-to-end source-only fixture tests for missing IMAGETYP overridden to light, light overridden to dark, and unchanged standard classifications; assert resulting memberships and resolved inbox state.

### COR-02 — Session read/modify/write loses memberships across concurrent plans

**Severity:** P1 · **Confidence:** High · **Type:** Defect

**Evidence:** `crates/app/targets/src/ingest_sessions.rs:563-622`; `crates/persistence/targets/src/repositories/q_targets_ingest.rs:336-345,356-398,409-434`; `crates/persistence/core/migrations/0001_initial_schema.sql:2979-2980`; `crates/app/inbox/src/plan_listener.rs:37-63,225-228`.

**Causal trace:** `upsert_session` reads the existing JSON membership set, merges one frame in memory and replaces the entire column in a later pool statement. There is no encompassing transaction or CAS. The completion mutex is keyed by **plan ID**, not session identity. Listener and repair tasks can therefore process different plans targeting the same session concurrently. If no row exists, two lookups can both insert because the session-key index is non-unique.

**Proposed reproducer:** Use two plans with the same grouping key and different files. Barrier both tasks immediately after session lookup. With an existing row, release both updates: one newly added frame is lost. With no existing row, release both inserts: duplicate sessions are created.

**Impact:** Durable session membership becomes incomplete or duplicated despite both plans succeeding. BTreeSet deduplication does not prevent lost updates.

**Counterevidence checked:** The keyed mutex prevents event/repair duplication for one plan only. WAL and a busy timeout serialize individual writers, not this multi-statement read/modify/write operation.

**Recommended fix:** Place lookup and membership mutation inside one `BEGIN IMMEDIATE` transaction, or use a normalized membership table with an atomic uniqueness contract. Establish whether duplicate keys are legitimate before adding a unique constraint; do not blindly change the shared schema.

**Verification needed:** Deterministic concurrent first-insert and append reproductions, plus retry-after-contention coverage asserting every distinct frame survives exactly once.

### COR-03 — Resolving a target changes session identity and defeats replay stability

**Severity:** P2 · **Confidence:** High · **Type:** Defect

**Evidence:** `crates/app/targets/src/ingest_sessions.rs:219-249,675-697`; `crates/app/targets/src/ingest_resolution.rs:143-166`; `crates/persistence/targets/src/repositories/q_targets_ingest.rs:336-345,445-463`.

**Causal trace:** A cache miss uses raw OBJECT as the key target. After the resolver populates the cache, the same metadata uses the canonical target UUID instead. Target backfill changes `canonical_target_id`, but does not reconcile the stored session key or existing membership. Subsequent frames from the same observing run therefore look up a different session; re-ingesting an earlier applied plan can put the same file into another session.

**Proposed reproducer:** Ingest frame A while its OBJECT is absent from the resolver cache. Resolve/cache that target and run backfill. Ingest frame B with identical grouping metadata, or replay A's ingest. Observe raw-name-keyed and UUID-keyed sessions instead of one stable membership set.

**Impact:** Session fragmentation depends on network/cache timing; replay is not idempotent across resolution progress, affecting source counts and project membership.

**Counterevidence checked:** Backfill does propagate the resolved target, but only the relationship field; it does not repair identity or merge rows. The cache-first association function genuinely returns the different key input after resolution.

**Recommended fix:** Separate immutable capture/group identity from enrichable target resolution, or implement an explicit transactional reconciliation that also handles memberships and project references. Do not simply rename keys if an equivalent canonical session already exists.

**Verification needed:** Offline→resolved ingestion and replay cases, including two aliases resolving to one target and already-linked projects.

### COR-04 — Live grouping merges frames that require different calibration

**Severity:** P1 · **Confidence:** High · **Type:** Defect

**Evidence:** `crates/app/targets/src/ingest_sessions.rs:239-249,349-401,493-503`; `crates/sessions/src/key.rs:78-88`; `crates/persistence/calibration/src/repositories/q_calibration.rs:175-210`; `crates/app/calibration/src/matching/loaders.rs:34-53`; `crates/calibration/core/src/rules/dark.rs:36-60`.

**Causal trace:** Live session identity includes target/filter/binning/gain/night but excludes offset, camera identity, readout mode and exposure. Ingestion appends all matching-key frames. Fingerprint upsert keeps the first non-null offset, camera, exposure and other values, and matching later evaluates that single fingerprint for the whole session. In particular, offset and a known camera-body mismatch are hard calibration dimensions.

**Proposed reproducer:** Ingest two light frames with identical existing key fields but offsets 10 and 50. They share one session, whose fingerprint retains whichever offset arrived first. Offer a dark matching only that first offset: it can be assigned to the session containing the incompatible second frame. Reversing file order changes which dark is considered compatible.

**Impact:** Session-level calibration recommendations can be wrong for a subset of their member images; ingestion order changes the answer without any mixed/incompatible state being surfaced.

**Counterevidence checked:** The newer immutable `CaptureDiscriminators` include offset/readout/raster and stronger identity (`crates/sessions/src/identity.rs:61-72,116-124`), but the live listener calls the legacy path. First-non-null preservation protects against missing later metadata, not contradictory metadata.

**Recommended fix:** Ensure the live grouping contract partitions on calibration-relevant exact dimensions, or explicitly represent heterogeneous fingerprints and refuse single-session assignment until resolved. Prefer completing the intended immutable-session integration over creating another identity definition.

**Verification needed:** Order-independent ingestion tests for differing offset, camera body, readout mode and exposure; verify both session boundaries and observable matching results.

### COR-05 — Missing or invalid capture dates become fabricated acquisition evidence

**Severity:** P2 · **Confidence:** High · **Type:** Defect

**Evidence:** `crates/app/targets/src/ingest_sessions.rs:374-401,493-503,515-532`; `crates/app/calibration/src/matching/loaders.rs:45-53`; `crates/calibration/core/src/rules/dark.rs:125-131`.

**Causal trace:** `parse_date_obs` returns `now_utc()` for absent or unparseable values. That value drives both session identity and a stored observing-night fingerprint. Separately, `has_exposure_start_utc` is true for any nonempty string, even one that failed parsing. Downstream matching sees the invented night as normal date evidence.

**Proposed reproducer:** Ingest a frame with `DATE-OBS='invalid'`; inspect its fingerprint and observe `has_exposure_start_utc=true` and today's night. Re-ingest after the UTC-noon boundary: the same file derives another key. Missing DATE-OBS has the same unstable key, although its presence flag is false.

**Impact:** Acquisition provenance and age/proximity scoring become false; replay/session grouping depends on ingestion time rather than captured data.

**Counterevidence checked:** The fallback is intentional and documented, but its effects conflict with replay stability and truthful metadata. Supplying a UTC observer does not make a missing capture timestamp valid.

**Recommended fix:** Return an explicit parse/absence result, preserve absent/invalid night evidence, and use an approved deterministic fallback only when the user supplies one. Derive the presence flag from successful parsing, not string nonemptiness.

**Verification needed:** Missing/malformed/valid timestamp cases and replay across a clock boundary; assert no synthetic acquisition date reaches matching.

### COR-06 — A transient ingestion database failure is acknowledged permanently

**Severity:** P1 · **Confidence:** High · **Type:** Defect

**Evidence:** `crates/app/targets/src/ingest_sessions.rs:131-155`; `crates/app/inbox/src/plan_listener.rs:220-239,261-290,582-610`; `crates/app/inbox/src/repair.rs:20-35,43-83`.

**Causal trace:** `ingest_light_frames` propagates a database error and stops processing remaining rows. Its listener wrapper logs the error and returns unit. `complete_applied_plan` then marks the inbox item resolved and deletes its plan link. That link is also the durable work queue used by repair, so the sweep cannot retry the un-ingested remainder.

**Proposed reproducer:** Fail one session/file-record write midway through a multi-frame applied plan, allow later inbox transition queries to succeed, then run repair. The item is resolved and its link absent while some frames have no session membership; repair reports no work for that plan.

**Impact:** Temporary lock/storage/query failures become permanent catalog gaps with no retryable status. The user sees a completed ingestion.

**Counterevidence checked:** Calibration master registration correctly propagates its failure before deleting the link. Deliberately tolerating per-file unreadable metadata is separate from swallowing the function's database failure.

**Recommended fix:** Distinguish permanent per-file exclusions from retryable persistence errors. Preserve the link or create an explicit durable ingestion task until all required writes complete; optionally persist an item-level checkpoint to avoid rescanning successful items.

**Verification needed:** Inject a single transient database failure at different frame positions, recover the database, and confirm repair fills every membership before acknowledging the inbox item.

### COR-07 — Calibration mutations and authoritative audit are not atomic

**Severity:** P2 · **Confidence:** High · **Type:** Defect

**Evidence:** `crates/app/calibration/src/matching/assign.rs:130-163,200-231`; `crates/persistence/calibration/src/repositories/calibration_assignment.rs:83-114,124-134`; `crates/audit/src/bus.rs:188-209`; `apps/desktop/src-tauri/src/commands/calibration.rs:101-111`.

**Causal trace:** Assignment upsert commits through the pool, then `write_assignment_audit` makes another database write. Unassign reads the existing assignment, deletes it, then writes its audit. If the authoritative audit insert fails, the command returns an error after the business mutation has already committed. Unassign also deletes by `(session_id, calibration_type)`, not the ID it read, permitting a concurrent replacement to be deleted while auditing the older assignment.

**Proposed reproducer:** Force only the authoritative audit insert to fail. Assignment returns an error but remains assigned; unassign returns an error but has removed the row. For the race, pause unassign after `get`, replace the assignment, then resume its delete: the replacement is removed while the payload names the predecessor.

**Impact:** Failed commands alter user state without the required history. A retried unassign can return not-found, preventing the lost audit from being reconstructed through the same command.

**Counterevidence checked:** The bus distinguishes durable audit from best-effort live publication correctly. The missing piece is sharing the transaction with the mutation, not making transient event delivery mandatory.

**Recommended fix:** Commit mutation and authoritative audit/outbox in one transaction. Delete the exact expected assignment or serialize read/delete/audit under that transaction; publish notifications after commit.

**Verification needed:** Audit-write failure injection for assign/unassign, concurrent reassignment during unassign, and post-commit broadcast failure proving committed mutations remain successful and audited.

### COR-08 — Prepared-view finalization is neither atomic nor replay-idempotent

**Severity:** P1 · **Confidence:** High · **Type:** Defect

**Evidence:** `crates/app/core/src/plan_apply/finalizers.rs:44-128`; `crates/persistence/plans/src/repositories/prepared_source_views.rs:70-111`; `crates/app/core/src/plan_apply/terminal.rs:126-162`; `crates/app/projects/src/source_view_generate/generate.rs:525-543`; `apps/desktop/src-tauri/src/commands/prepared_views.rs:129-134`.

**Causal trace:** The live generation finalizer creates a fresh view UUID on every invocation, inserts a `current` view, then inserts its members through independent pool statements. Item failures are logged and ignored. Terminal handling subsequently marks the filesystem plan applied. A crash/terminal-write failure after finalization can lead to replay, which creates another view rather than resuming the first. The comment claiming idempotency is not implemented by these inserts.

**Proposed reproducer:** Apply a generation plan with several successful links and fail its second `insert_view_item`; allow terminal persistence to succeed. The view is current but incompletely records its files. Separately, run the finalizer twice for the same completed plan, modeling recovery after an unwritten terminal: two view records are created.

**Impact:** Database membership diverges from the successfully materialized directory; missing entries cannot participate correctly in later verification/removal/regeneration. Recovery can create duplicate logical views.

**Counterevidence checked:** The repository insert is unconditional and no plan ID/idempotency key is carried in `InsertPreparedSourceView`. Per-view identity cannot deduplicate when each attempt creates a new view ID. The new update-view snapshot path is not the traced desktop generation caller.

**Recommended fix:** Give finalization a stable plan-scoped identity and atomically commit the view plus all successful members. Keep a durable finalization-needed state until the bookkeeping commit succeeds; filesystem work already completed should not have to be repeated.

**Verification needed:** Failure at each view/item insert, repeated finalization, crash between finalization and plan terminal commit, and later remove/regenerate operations proving every on-disk link is represented once.

## Prioritized roadmap

1. **Protect current user inventory first:** fix COR-01, COR-02 and COR-06 together at the approved-plan→ingestion boundary. Preserve reviewed classification, serialize durable membership changes, and acknowledge only completed ingestion.
2. **Stabilize identity and metadata:** resolve COR-03 through COR-05 as one deliberate identity-contract decision. Use the existing richer immutable model where feasible; avoid another parallel identity implementation. Include migration/reconciliation of existing memberships in that decision.
3. **Close transaction/recovery gaps:** implement COR-07 and COR-08 with mutation/audit atomicity and stable finalization identity. Failure-injection and concurrent interleaving cases are more valuable here than additional happy-path tests.
4. **Wave-two integration review:** explicitly trace production registration for the immutable session, project update-view and calibration-handoff surfaces; then review lease loss, task abortion and crash recovery across their command ledger and manual transaction boundaries. Their presence in the tree should not be treated as proof that the live legacy defects are superseded.

No obsolete-code deletion is recommended from this review. All eight findings are grounded in a traced live path or its directly called repository; the newer test-reachable implementations are context and counterevidence, not falsely reported production failures.

## Inspection inventory

- `crates/app/targets/src/ingest_sessions.rs`: Live light-frame ingestion, session identity, metadata fingerprints, target propagation, and replay behavior; production sections and selected embedded tests inspected.
- `crates/app/targets/src/ingest_resolution.rs`: Cache-first target association, pending resolution, and subsequent canonical-target availability.
- `crates/app/inbox/src/confirm.rs`: Approved classification precedence and persistence of category/frozen provenance.
- `crates/app/inbox/src/plan_listener.rs`: Production event subscription, keyed locks, ingestion completion, calibration registration entry, and inbox-link disposal.
- `crates/app/inbox/src/repair.rs`: Startup/periodic repair driven by outstanding inbox-plan links.
- `crates/persistence/targets/src/repositories/q_targets_ingest.rs`: Applied-item loading and nontransactional session lookup/append/insert SQL.
- `crates/sessions/src/key.rs`: Legacy pipe-delimited session identity and observing-night derivation.
- `crates/sessions/src/identity.rs`: New immutable, operation-scoped identities and exact capture discriminators.
- `crates/sessions/src/clustering.rs`: Framing boundaries, geometry types, tolerance definitions, and entry-point contract; not the entire clustering implementation.
- `crates/metadata/core/src/lib.rs`: Raw metadata contract, frame-type normalization, and distinctions between physical rotation and sky orientation.
- `crates/metadata/core/src/evidence.rs`: Typed evidence states, input bounds, finite-number validation, and constructor/deserialization invariants.
- `crates/calibration/core/src/lib.rs`: Pure matching inputs, mixed-session guard, kind dispatch, and candidate selection.
- `crates/calibration/core/src/rules/dark.rs`: Gain/offset/camera compatibility and exposure/temperature scoring.
- `crates/calibration/core/src/rules/bias.rs`: Bias hard dimensions and age scoring.
- `crates/app/calibration/src/matching/loaders.rs`: Session/master fingerprint loading and persisted matching-settings precedence.
- `crates/app/calibration/src/matching/masters.rs`: Master list/detail, compatibility computation, usage, and missing-source annotations.
- `crates/app/calibration/src/matching/assign.rs`: Assignment/unassignment mutation and authoritative audit sequencing.
- `crates/persistence/calibration/src/repositories/calibration_assignment.rs`: Assignment upsert/delete/read semantics and independent pool writes.
- `crates/persistence/calibration/src/repositories/q_calibration.rs`: Targeted inspection of first-non-null acquisition-fingerprint merge SQL.
- `crates/app/calibration/src/session_handoff/snapshots.rs`: Immutable handoff snapshot creation and successor-head CAS.
- `crates/app/inbox/src/session_materialization/apply.rs`: New session materialization transactions, cancellation checkpoints, result snapshots, rollback and failure helpers.
- `crates/app/inbox/src/session_materialization/mod.rs`: Command-ledger versus domain-write ownership boundary.
- `crates/app/projects/src/project_setup/create.rs`: Project path validation, source snapshots, composite creation, readiness and event publication.
- `crates/app/core/src/project_create.rs`: Live create orchestration and bounded scaffolding auto-apply reporting.
- `crates/app/projects/src/update_view/apply.rs`: New update-view state transitions, install loop, snapshot finalization, and failure handling.
- `crates/app/projects/src/update_view/plan.rs`: Targeted base-snapshot capture and plan identity references.
- `crates/app/projects/src/source_view_generate/generate.rs`: Targeted live prepared_view_generation plan construction.
- `crates/app/core/src/plan_apply/lifecycle.rs`: Crash recovery and live/paused cancellation paths; initial production sections inspected.
- `crates/app/core/src/plan_apply/terminal.rs`: Completed-run finalizers, terminal persistence and event ordering; initial cancellation dispatch.
- `crates/app/core/src/plan_apply/finalizers.rs`: Prepared-view generation/removal/regeneration and project/archive lifecycle finalization.
- `crates/persistence/plans/src/repositories/prepared_source_views.rs`: Prepared-view and item insertion/read/update semantics.
- `crates/persistence/core/src/lib.rs`: SQLite pool policy, migration detection/execution, backup primitive, and divergence errors.
- `crates/persistence/core/migrations/0001_initial_schema.sql`: Targeted session indexes, assignment/view tables, and immutable materialization schema references; not a complete SQL audit.
- `crates/audit/src/bus.rs`: Targeted authoritative-audit versus event-broadcast persistence boundary.
- `apps/desktop/src-tauri/src/lib.rs`: Targeted migration boot/refusal and production inbox-listener wiring.
- `apps/desktop/src-tauri/src/commands/calibration.rs`: Live calibration matching and assignment delegation.
- `apps/desktop/src-tauri/src/commands/projects.rs`: Project-create production caller located.
- `apps/desktop/src-tauri/src/commands/prepared_views.rs`: Prepared-view generation production caller located.
- `apps/desktop/src-tauri/src/bootstrap/specta.rs`: Calibration command registration located.
- `docs/memory/ARCHITECTURE.md`: Architecture context treated as descriptive data and checked against source.
- `docs/release/pre-1-0-database-baseline.md`: Explicit fresh-baseline-only migration policy; counterevidence against reporting unsupported development upgrades as a defect.
