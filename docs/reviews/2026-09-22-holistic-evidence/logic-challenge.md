# Wave-two challenge: logic and architecture

Model identity exposed by the harness: openai-codex/gpt-6-astra. The dispatch role selector is unavailable, so I cannot independently attest to the @max selector.

## Basis and scope

All eight numbered findings survive independent source inspection, with qualifications to COR-04, COR-05, and COR-07 below. This is a holistic snapshot assessment, not a claim that these defects were introduced by a particular patch. No source, report, database, or other file was written. No builds, tests, formatters, linters, installs, runtime validation, or server processes were run. All proposed reproductions remain unexecuted. There are no visual claims.

Paths below are relative to the permitted worktree. The first-wave report was treated as untrusted claims. I independently inspected the ingestion producer, listener/repair routing, relevant repositories, calibration assignment guards and scoring, generation-plan routing and terminal finalization, and selected existing tests.

## Domain boundaries and architectural conclusions

The live desktop starts the inbox listener at apps/desktop/src-tauri/src/lib.rs:718-722. That listener and a separately spawned repair task converge on complete_applied_plan, then call app_core_targets::ingest_sessions::ingest_light_frames and legacy acquisition_session persistence (crates/app/inbox/src/plan_listener.rs:114-124,220-239). The boundary carrying approved classification into ingestion is defective; the event itself is explicitly dispatched, not silently dropped (plan_listener.rs:163-201).

Calibration metadata is projected from one acquisition_fingerprint into pure SessionInfo (crates/app/calibration/src/matching/loaders.rs:34-66), evaluated by calibration_core, and persisted by app assignment orchestration. Desktop commands directly call that path (apps/desktop/src-tauri/src/commands/calibration.rs:85-111). The mixed-session guard exists, but the live fingerprint writer always inserts session_type='light', not a detected heterogeneous state.

Project creation passes project, sources, channels, plan and plan items through create_project_tx; readiness and event publication occur afterward (crates/app/projects/src/project_setup/create.rs:389-422). This is a useful but limited transaction boundary. Prepared-view generation uses origin='prepared_view_generation' and origin_path=project_id (crates/app/projects/src/source_view_generate/generate.rs:525-547); the terminal dispatcher explicitly routes that value to finalize_view_generation (crates/app/core/src/plan_apply/terminal.rs:126-143). Thus COR-08 is on a connected production path, not an orphaned implementation.

The newer immutable session materialization and project update-view implementations do not supersede the demonstrated legacy paths. Exact-call searches found run_apply callers in crates/app/core/tests/session_materialization/mod.rs and apply_update_view/run_apply_loop callers in crates/app/projects/tests/update_view_plan.rs, but no production invocation in the searched crates and desktop Rust tree. The new materialization rollback macro at crates/app/inbox/src/session_materialization/apply.rs:65-87 is real counterevidence to a blanket claim that the repository never handles transactional errors. It is not protection for legacy ingestion. No obsolete-code deletion is justified by this review.

## COR-01 — ACCEPT, P1

Approved frame-type overrides are discarded by live session ingestion.

Evidence: crates/app/inbox/src/confirm.rs:424-444 chooses effective_frame_type and stores it in the resolved row; confirm.rs:570-574 persists it as plan item category; confirm.rs:931-939 defines manual override, durable override, extracted value precedence. crates/persistence/targets/src/repositories/q_targets_ingest.rs:282-297 selects only paths. crates/app/targets/src/ingest_sessions.rs:191-198 rereads metadata and gates exclusively on is_light_frame; its accepted raw-header strings are at 716-728.

Causal result: a successfully catalogued or moved frame approved as light but lacking a raw light IMAGETYP is skipped. A raw light approved as dark still passes this eligibility check. The approved value is already persisted, so the fix belongs at consumption, not override storage.

Counterevidence: both move and catalogue paths freeze classification, and ingestion supports catalogue source-path fallback (ingest_sessions.rs:137-146). Neither guard recovers the omitted category. The raw-type unit test at ingest_sessions.rs:756-764 explicitly rejects absent image_typ; the catalogue parity test at crates/app/core/tests/ingest_sessions_integration.rs:328-389 covers standard raw light headers, not reviewed disagreement. Metadata rereading is valid for other fields, not as a substitute for the approved decision.

Remaining verification: exercise confirm→apply→listener for absent IMAGETYP overridden to light and light overridden to dark, asserting acquisition membership and inbox completion. Preserve compatibility policy for historical category-less rows explicitly.

## COR-02 — ACCEPT, P1

Session read/modify/write loses memberships across concurrent plans.

Evidence: crates/app/targets/src/ingest_sessions.rs:563-622 reads frame_ids, merges a BTreeSet, then issues a separate replacement update or insert. crates/persistence/targets/src/repositories/q_targets_ingest.rs:336-345,356-398,409-434 executes those through independent pool operations. The session-key index is non-unique (crates/persistence/core/migrations/0001_initial_schema.sql:2979-2980).

Counterevidence: the event listener awaits one event handler at a time (crates/app/inbox/src/plan_listener.rs:133-160), so two consecutive bus events alone are not a valid concurrency reproducer. However the repair sweep is a separately spawned task (114-124), and it calls the same completion path for persisted orphan links (crates/app/inbox/src/repair.rs:43-83). The completion mutex is keyed by plan ID (plan_listener.rs:51-74,225-228), not the derived session key. Consequently repair of one plan can race with the listener ingesting another plan into the same session, even if only one filesystem plan is normally applied at a time.

Causal result: two reads of membership S can independently write S+A and S+B, losing one addition; two empty lookups can create duplicate sessions. SQLite writer serialization and BTreeSet deduplication do not serialize this composite operation. Existing backfill tests supply an already-fixed key and run sequentially (ingest_sessions.rs:1004-1027); they do not defend this interleaving.

Remaining verification: deterministic barriers around lookup for repair/listener cross-plan append and first insert; assert all distinct frame IDs survive exactly once. Use a transaction/atomic membership contract rather than relying on the per-plan mutex.

## COR-03 — ACCEPT, P2

Resolving a target changes grouping identity and defeats replay stability.

Evidence: crates/app/targets/src/ingest_resolution.rs:143-166 returns a canonical target ID on a normalized cache hit. crates/app/targets/src/ingest_sessions.rs:219-249 chooses that ID as the key target, otherwise raw OBJECT. Backfill at 675-697 only invokes the canonical-target relationship update; its repository SQL changes canonical_target_id, not session_key (crates/persistence/targets/src/repositories/q_targets_ingest.rs:445-463).

Causal result: the same capture metadata derives a raw-name key before resolution and a UUID key afterward. Subsequent frames fragment the session; repeated ingestion can place the same frame ID into another session. The file-record uniqueness contract cannot prevent membership in two acquisition_session JSON arrays.

Counterevidence: target backfill and linked-project propagation are implemented. The integration test unknown_object_session_backfills_after_resolve at crates/app/core/tests/ingest_sessions_integration.rs:395-458 verifies the relationship is filled, but stops before another ingest or replay. The unit test at ingest_sessions.rs:1004-1027 passes the same literal 'sk-2' to both upserts, bypassing the production key-changing behavior. Neither test contradicts the finding.

Remaining verification: unresolved→cached ingestion of another same-run frame, repeated ingestion of the first frame, alias convergence, and existing project references. Reconciliation must avoid abandoning references if sessions are merged.

## COR-04 — ACCEPT, P1, with a narrower proven claim

Live grouping merges frames with contradictory calibration dimensions, and first-non-null fingerprints conceal that contradiction.

Evidence: crates/app/targets/src/ingest_sessions.rs:493-503 constructs identity only from target, filter, binning, gain, and capture date. Its fingerprint writer records offset, camera identity and exposure at 355-401. crates/persistence/calibration/src/repositories/q_calibration.rs:187-210 inserts a light fingerprint and keeps the first non-null value for each dimension. crates/app/calibration/src/matching/loaders.rs:39-53 then loads exactly that one fingerprint for the entire session.

The offset reproducer is valid: two frames with offsets 10 and 50 can share the grouping key, while assignment sees only the first offset. Actual assignment checks offset equality for dark/bias and camera conflicts at crates/calibration/core/src/assign.rs:120-145. A master matching the first frame can therefore be accepted for the merged session. The mixed-session guard at assign.rs:69-73 does not help because ingestion never marks this contradiction mixed. The apparently protective observer-location guard is explicitly a no-op at assign.rs:75-78, so missing location does not block this path.

Corrections: do not describe every listed dimension as a hard matching dimension. Dark exposure is a soft penalty (crates/calibration/core/src/rules/dark.rs:62-99), and dark suggestion gain/offset checks are relaxable by configuration (36-52). Readout mode was not shown to be consumed by the current legacy matcher, so its calibration consequence is not independently established here. Offset and known camera disagreement are sufficient to retain P1. The homogeneous ingestion-to-matching test at crates/app/core/tests/ingest_sessions_integration.rs:556-650 confirms a real fingerprint/matcher path but does not test conflicting member metadata.

Remaining verification: reverse ingestion order for offset and camera conflicts and compare assignment/suggestion output. Test exposure separately as confidence correctness, not an unconditional incompatibility claim. Choose partitioning or explicit heterogeneous-state rejection using an existing domain contract.

## COR-05 — ACCEPT, P2, with intent qualification

Invalid or missing capture dates are stored as acquisition-night evidence and produce time-dependent identity.

Evidence: crates/app/targets/src/ingest_sessions.rs:521-532 returns now_utc for missing/unparseable values. That parser drives the session key at 493-503 and the stored observing night at 374-381. has_exposure_start_utc is based on nonempty string presence, not parse success (374). The matching loader passes the stored date through (crates/app/calibration/src/matching/loaders.rs:45-53), and the dark evaluator consumes it in apply_age_rule (crates/calibration/core/src/rules/dark.rs:125-131).

Counterevidence and correction: the fallback is explicitly deliberate, documented at ingest_sessions.rs:515-520, and the valid-date UTC behavior is tested at 779-799. Therefore 'an unexpected fallback was accidentally added' would be unsupported. The defect is its interaction with persistent capture identity and acquisition evidence: missing capture data is no longer distinguishable from an actual current-night capture, malformed nonempty input asserts exposure-start presence, and replay after the observing-night boundary changes identity. The date flag does not currently hard-block matching; assign.rs:75-78 confirms the old guard is disabled. Thus this is inaccurate provenance/grouping/scoring, not an asserted guard bypass.

Remaining verification: absent, malformed and valid values with a controlled clock across observing-night boundaries; assert deterministic replay and explicit absent/invalid evidence in matcher input. The first-wave proposed behavior change needs an explicit fallback policy, rather than simply removing ingestability of old files.

## COR-06 — ACCEPT, P1

A transient database ingestion failure is permanently acknowledged.

Evidence: crates/app/targets/src/ingest_sessions.rs:131-155 propagates query/ingestion errors and exits the remaining loop. Its API documentation at 119-123 distinguishes these database failures from already-handled metadata/IO skips. crates/app/inbox/src/plan_listener.rs:266-282 logs and swallows the propagated error. complete_applied_plan continues to transition_via_plan_id (231-239), which updates the inbox state and deletes its plan link (582-610). Repair enumerates persisted orphan links and depends on retaining them (crates/app/inbox/src/repair.rs:20-35,43-83).

Counterevidence: registration errors do propagate before acknowledgement, and unreadable individual files are intentionally best-effort. Neither justifies swallowing a database failure that aborts all remaining frames. The listener/repair architecture is a real recovery system, but deletion of its work record makes this particular failure unrecoverable through the normal sweep. The finding must retain its trigger condition: the ingestion write fails transiently while later state/link writes succeed; it does not claim permanent database outage can still delete the link.

Remaining verification: fail one ingestion write/query, let subsequent transition writes succeed, then restore the database and run repair. Confirm acknowledgement is withheld until required ingestion succeeds, while genuine per-file exclusions remain nonblocking.

## COR-07 — ACCEPT, P2, with a concurrency qualification

Calibration mutation and authoritative audit are not atomic.

Evidence: crates/app/calibration/src/matching/assign.rs:130-163 commits assignment before write_assignment_audit; unassign reads, deletes, then audits at 200-231. Repository upsert and delete execute independent pool statements (crates/persistence/calibration/src/repositories/calibration_assignment.rs:83-114,124-134). EventBus::write_audit performs another authoritative insert and propagates that insert's error (crates/audit/src/bus.rs:188-209). The desktop adapter returns these app errors directly (apps/desktop/src-tauri/src/commands/calibration.rs:101-111).

Causal result: an audit-only insertion failure returns a failed command after the assignment changed. Retried unassign may see no row and cannot recreate that successful removal's audit. The existing durable-audit test at crates/app/core/tests/calibration_integration.rs:548-622 covers successful sequential assignment/removal only; it proves normal history exists, not rollback under audit failure.

Counterevidence and correction: best-effort bus publication after a successful authoritative audit is intentional and correct (bus.rs:211-218). Also, because unassign's API addresses session/type, deleting a concurrent replacement is not by itself provably contrary to its requested final state. The independently established concurrency defect is inaccurate audit attribution: a replacement committed between get and delete can be removed while the emitted payload identifies the predecessor. Do not overstate this as an expected-assignment precondition already present in the API.

Remaining verification: audit-only insert failures for both mutations, and interleaving replacement between unassign's read/delete while asserting the history describes the row actually removed. Commit business mutation and authoritative audit together; live notifications can remain post-commit/best-effort.

## COR-08 — ACCEPT, P1

Prepared-view finalization is non-atomic and not replay-idempotent.

Evidence: crates/app/core/src/plan_apply/finalizers.rs:84-128 allocates a fresh view ID, independently inserts the view and items, and logs item insertion failures without propagating them. Repository inserts are unconditional pool operations (crates/persistence/plans/src/repositories/prepared_source_views.rs:70-111). The schema has no stable plan identity or project uniqueness that would deduplicate attempts (crates/persistence/core/migrations/0001_initial_schema.sql:1804-1829). Terminal dispatch invokes finalization before complete_run (crates/app/core/src/plan_apply/terminal.rs:126-162).

Counterevidence: best-effort finalization is explicitly intended not to undo filesystem work, and completed-plan audit/event publication is withheld when the terminal database write fails. Neither makes view bookkeeping durable. The idempotency comment at finalizers.rs:51-52 is contradicted by the fresh IDs and unconditional inserts. On an item insertion error, the plan can become applied with a current view missing successfully created links. On terminal-write failure or crash after finalization, the plan remains recoverable: lifecycle.rs:12-31 makes interrupted applying plans resumable. A subsequent finalizer invocation does not identify the earlier logical view and inserts another.

Caller proof: apps/desktop/src-tauri/src/commands/prepared_views.rs:129-134 calls generate_source_view; its persisted origin is prepared_view_generation (crates/app/projects/src/source_view_generate/generate.rs:525-547), explicitly handled in terminal.rs:128-134. The new update-view implementation is not counterevidence. Prepared-source-view repository list_view_items at 135-148 reads only recorded rows, so missing database membership cannot be recovered merely by reading this view.

Remaining verification: fail each insert in turn; invoke finalization twice for the same plan; exercise crash/recovery between bookkeeping and complete_run; then verify/removal/regeneration must enumerate every materialized link once. A stable plan-scoped identity and all-or-nothing bookkeeping are needed without pretending filesystem rollback is free.

## Material omissions and unsupported breadth

1. Confirmed extension of COR-06, not an additional counted finding: fingerprint and geometry backfill failures are swallowed even inside ingest_light_frame (crates/app/targets/src/ingest_sessions.rs:251-278). Therefore making ingest_light_frames_if_applicable return its current Result is insufficient by itself: required calibration fingerprint persistence can fail while the outer function reports success and the inbox work record is deleted. The fix must classify which enrichment writes are required or separately retryable. Framing binding has the same logged-only posture; its independent downstream impact was not fully traced here.
2. COR-04's offset/camera examples are established, but readout-specific matching impact and exposure-as-hard-incompatibility should be removed from categorical claims.
3. COR-07's audit-attribution race is established; an API promise to delete only a particular prior assignment is not.
4. No additional numbered defect is proposed for project creation's post-transaction readiness/event writes, manual transaction task abortion, lease loss, or paused cancellation. Their complete failure contracts/callers were not traced deeply enough to assert an extra defect. The inspected cancellation path explicitly distinguishes active-token signalling from direct paused-state persistence (crates/app/core/src/plan_apply/lifecycle.rs:73-169); it is not accurate to characterize cancellation as wholly unhandled.
5. No migration finding: the supported pre-1.0 release input is a fresh baseline, not historical development databases (docs/release/pre-1-0-database-baseline.md:3-27), and boot explicitly refuses migration divergence (apps/desktop/src-tauri/src/lib.rs:625-648). This does not constitute a full baseline/trigger audit.

## Prioritized roadmap

First protect the approved-plan→inventory boundary: COR-01, COR-02, COR-06, including required fingerprint-write failure semantics. Next establish stable grouping and truthful acquisition evidence across COR-03–COR-05, with reconciliation of already-stored memberships rather than a third competing identity model. In parallel at the design level, specify stable prepared-view finalization identity and transactionally complete bookkeeping for COR-08. Then close assignment/audit atomicity and accurate concurrent attribution for COR-07. Before claiming the immutable successors solve production defects, prove command registration and complete cancellation/crash/lease-loss behavior through those actual adapters.

Verification exclusions: no reproducer was executed; selected tests were read, not run. No full audit of FITS/XISF parsing, filesystem executor safety, archive/delete flows, every migration/trigger, new command-ledger implementation, or rendered UI was performed. No existing graph was available; graph creation was not attempted because writes were prohibited.

## Final verdict table

| ID | Verdict | Severity |
|---|---|---|
| COR-01 | ACCEPT | P1 |
| COR-02 | ACCEPT | P1 |
| COR-03 | ACCEPT | P2 |
| COR-04 | ACCEPT | P1 |
| COR-05 | ACCEPT | P2 |
| COR-06 | ACCEPT | P1 |
| COR-07 | ACCEPT | P2 |
| COR-08 | ACCEPT | P1 |

Totals: 8 accepted, 0 downgraded, 0 rejected. Severity totals: 5 P1, 3 P2. Rejected findings: none. Material scope qualifications above do not erase the supported core defects.
