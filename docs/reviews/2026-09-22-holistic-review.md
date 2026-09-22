# PlateVault repository review

Date: 2026-09-22
Snapshot: `8198209b5be118e785e4ea85cea3f26e0ea43c1c`
Scope: application logic, architecture, filesystem safety, performance, features, interface design, testing, delivery, engineering processes, tooling and repository structure.

## Assessment

PlateVault's weakest boundaries are where reviewed decisions become inventory, filesystem outcomes become database records, and verification results become release permission.

Prioritize correctness and recovery before adding another major feature. Approved classifications can be discarded during ingestion. Concurrent ingestion can lose session membership. Filesystem recovery can record an inaccessible, untouched file as successfully removed. Archive disposal bypasses the normal reviewed-plan flow. Release publication does not depend on the independent hard release gate.

The architecture does not need wholesale replacement. Retain the pure domain crates and context-specific persistence. Preserve bounded metadata caching, explicit plan approval, typed contracts and generated tokens. The immediate need is consistent use of those mechanisms across production paths.

This challenged source review includes focused executable checks. It does not certify a release. The frontend could not launch with the provisioned dependencies. Rust workspace tests could not resolve an uncached locked dependency. Those environmental blockers are not counted as application defects.

## Method, evidence and limits

Seven reviewers inspected independent domains. Seven different challengers then checked their findings against callers, guards, tests and contradictory requirements. The completed workers used the configured `@max` role, resolving to `openai-codex/gpt-6-astra:auto`, without an effort override.

Direct `agent: "@max"` dispatch failed. A supervised OMP dispatcher temporarily routed scouts and reviewers to `@max`; global configuration stayed unchanged. Parent tool cards did not show its children. All 14 dispatches reported `modelRole: max`; reports name Astra. The cancelled default-scout batch contributes no findings.

The seven reports contained **54 findings: 45 accepted and nine downgraded**. No numbered finding was rejected entirely, but challengers rejected several subclaims. These are not 54 unique defects: three pairs overlap directly, and other findings share underlying causes. Stable IDs remain below so every original finding can be traced.

Severity means:

- **P1:** prioritize before widening release exposure; data integrity, recovery, operational responsiveness or release-control risk.
- **P2:** confirmed conditional defect or material workflow problem; schedule after the immediate safety work.
- **P3:** maintenance or product-scope improvement, or a risk needing further evidence.

Evidence labels distinguish **reproduced**, **source-established**, **conditional**, and **recommendation**. Source-established findings have traced implementations and independent review, but were not all exercised end to end. Confidence is high for the described source mechanisms. Production incidence, platform-specific behavior and performance magnitude remain unmeasured unless explicitly stated.

The snapshot contains 3,162 tracked files. Reviewers inspected selected implementation paths and cross-boundary behavior; this count does not imply a line-by-line audit of every file. Source citations below are repository-relative and refer to the snapshot above.

### Executed checks

| Check | Result | What it establishes |
|---|---|---|
| Committed `.config/wt.toml` and `.worktreeinclude` | Pass | Both project provisioning files exist in the reviewed commit. |
| `wt -y step copy-ignored` | Completed, zero additional files copied | Provisioning was attempted; dependency completeness was not established. |
| ESLint-baseline and orphan Vanilla Extract tooling tests | Two test files passed, zero failed | These two tooling checks work for their existing fixtures. This is not application-test coverage. |
| Production recovery classifier with inaccessible disposable source | Defect reproduced | `PermissionDenied` became `Completed` while source bytes remained unchanged. |
| Actual journey validator with incomplete and contradictory run records | Defects reproduced | Missing provenance and aggregate pass with a failing step both returned zero errors. |
| Actual journey validator after retiring a versioned step | Defect reproduced | A valid earlier run and retirement delta both became unknown-step errors. |
| `cargo test --locked --offline -p sessions` | Blocked, exit 101 | Cached registry lacks locked `skymath` 0.7.2; no Rust workspace tests ran. |
| Storybook, then direct Vite launch | Blocked | pnpm refused automatic module removal; direct Vite lacked `@vanilla-extract/vite-plugin`. |
| Beads synchronization | Blocked | Database endpoint was unreachable. No issue-store health, claim or synchronization success is asserted. |

The recovery probe included the production classifier unchanged. Its disposable harness replaced only the `camino::Utf8Path` wrapper with `std::path::Path`. It exercised the actual classifier, not startup or database recovery. All probes used disposable data. No application source was changed.

Full commands, outputs, model provenance and limitations are in [verification.json](2026-09-22-holistic-evidence/verification.json). No live accessibility, contrast, keyboard, responsive-layout, packaged updater or external-processor certification was possible. No dependency-advisory scan covering all dependencies or live branch-protection inspection was performed.

## Immediate priorities

| Priority | Work package | Findings | Completion evidence |
|---|---|---|---|
| 1 | Make approval, ingestion and acknowledgement agree | COR-01, COR-02, COR-06, SEC-06 | Approved type survives ingestion; concurrent membership survives; transient failures remain retryable; new source mutations require a captured baseline. |
| 2 | Prevent false filesystem success and destination replacement | SEC-02, SEC-04, SEC-05, COR-08 | Competing destination bytes survive; failed probes remain unknown; recovery uses the same paths/actions as execution; finalization is repeatable. |
| 3 | Restore the reviewed archive/recovery workflow | PROD-01-04, UX-01-02 | Every disposal has reviewed scope and durable per-item outcomes; recovery advances after resume, retry and discard. |
| 4 | Make release and CI decisions dependable | DEL-01-06, PROC-01-02 | Publication waits for hard checks and complete artifacts; E2E serves the changed inputs; mixed paths cannot reduce check coverage. |
| 5 | Stabilize session truth and calibration | COR-03-05, COR-07 | Resolution cannot change capture identity; contradictory members remain visible; assignment and its authoritative audit commit together. |
| 6 | Correct filtered inventory and remove known scaling costs | PERF-01-06, PERF-08 | Filtering precedes pagination; watcher lookup is linear; blocking I/O leaves async workers; only needed catalogue records are cloned. |

These packages define dependencies and completion outcomes. They do not authorize implementation. In particular, changing session identity requires a reconciliation policy for existing memberships and project references.

## Architecture, domain logic and data integrity

### What to preserve

The workspace separates metadata, sessions and calibration algorithms from application orchestration and SQL repositories. Project creation already groups project, source, channel and scaffolding records in a composite transaction. SQLite enables foreign keys and WAL. Inbox repair uses durable links rather than relying solely on broadcast delivery.

The newer immutable-session machinery distinguishes evidence states and capture identity more carefully than the live legacy ingestion path. Its transaction rollback handling is useful. However, reviewed production callers still reach legacy `acquisition_session` ingestion. Tests and exports of successor code do not establish that the desktop uses it.

The pre-1.0 database policy explicitly requires a fresh baseline and rejects schema divergence. Missing historical development migrations are therefore not reported as a defect. See `docs/release/pre-1-0-database-baseline.md:3-27` and `apps/desktop/src-tauri/src/lib.rs:625-648`.

### Findings

**COR-01 · P1 · Source-established: ingestion discards approved frame-type overrides.**
Confirmation stores the reviewed type in the plan item category, but ingestion loads only paths and decides eligibility from the raw header again. A file approved as light with missing or incorrect `IMAGETYP` can be omitted from sessions; a raw light approved as dark can still enter them. Consume the frozen decision and define an explicit policy for historical category-less rows. Verify both override directions through confirm, apply and listener completion.
Evidence: `crates/app/inbox/src/confirm.rs:424-444,570-574,931-939`; `crates/persistence/targets/src/repositories/q_targets_ingest.rs:282-297`; `crates/app/targets/src/ingest_sessions.rs:191-198,716-728`.

**COR-02 · P1 · Source-established: concurrent ingestion can lose or duplicate session membership.**
Session upsert reads a JSON membership array and later replaces it through an independent pool statement. The session-key index permits duplicate keys. The ordinary event listener is sequential, but its separately spawned repair task can process another plan concurrently. Per-plan locks do not protect a shared session.

Use one transaction or an atomic normalized-membership contract. Verify repair/listener interleavings for both first insertion and append.
Evidence: `crates/app/targets/src/ingest_sessions.rs:563-622`; `crates/persistence/targets/src/repositories/q_targets_ingest.rs:336-434`; `crates/app/inbox/src/plan_listener.rs:51-74,114-124,225-228`; `crates/persistence/core/migrations/0001_initial_schema.sql:2979-2980`.

**COR-03 · P2 · Source-established: resolving a target changes session identity.**
The grouping key uses raw OBJECT before resolution and a canonical UUID afterward. Backfill updates the relationship but not the key or memberships. Later ingestion can split one capture run; replay can put one frame into two sessions.

Separate immutable capture identity from target enrichment, or reconcile identity and references transactionally. Test unresolved-to-resolved ingestion, replay and aliases converging on one target.
Evidence: `crates/app/targets/src/ingest_sessions.rs:219-249,675-697`; `crates/app/targets/src/ingest_resolution.rs:143-166`; `crates/persistence/targets/src/repositories/q_targets_ingest.rs:445-463`.

**COR-04 · P1 · Source-established: grouping conceals contradictory calibration metadata.**
The live key omits offset and camera identity. Fingerprint updates preserve the first non-null values. Frames with incompatible offsets or known different cameras can therefore share a session represented by only the first fingerprint. Assignment can accept a master compatible with only part of that session.

Partition using the established domain contract or represent heterogeneity explicitly and refuse incompatible assignment. Reverse ingestion order in verification. Exposure is a soft scoring dimension; readout-specific consequences were not established and are not claimed.
Evidence: `crates/app/targets/src/ingest_sessions.rs:355-401,493-503`; `crates/persistence/calibration/src/repositories/q_calibration.rs:187-210`; `crates/app/calibration/src/matching/loaders.rs:39-53`; `crates/calibration/core/src/assign.rs:69-78,120-145`.

**COR-05 · P2 · Source-established: invalid capture dates become synthetic acquisition evidence.**
Absent or unparsable `DATE-OBS` falls back to the current time, which becomes grouping and observing-night evidence. A malformed nonempty value also sets the exposure-start-presence flag. The fallback is deliberate, but its persistence makes replay depend on ingestion time and distorts provenance and age scoring. Preserve absent/invalid evidence and choose a deterministic fallback policy without silently making old files uningestable.
Evidence: `crates/app/targets/src/ingest_sessions.rs:374-401,493-503,515-532`; `crates/app/calibration/src/matching/loaders.rs:45-53`; `crates/calibration/core/src/rules/dark.rs:125-131`.

**COR-06 · P1 · Source-established: transient ingestion failure can be acknowledged permanently.**
A database error aborts the ingestion loop. Its listener wrapper logs the error. Completion can still resolve the inbox item and delete the link used by repair. This requires the ingestion write to fail while later acknowledgement writes succeed. Required fingerprint writes can also fail through logged-only paths.

Preserve durable retry ownership until required writes finish; distinguish excluded files from retryable persistence failures.
Evidence: `crates/app/targets/src/ingest_sessions.rs:119-155,251-278`; `crates/app/inbox/src/plan_listener.rs:220-239,266-282,582-610`; `crates/app/inbox/src/repair.rs:20-35,43-83`.

**COR-07 · P2 · Source-established: calibration changes and authoritative audit are separate commits.**
Assignment or removal can commit before audit insertion fails, returning an error after changing state. Concurrent replacement can also make unassign audit the predecessor rather than the row actually removed. The API does not promise an expected-assignment precondition, so that stronger concurrency allegation was rejected. Commit the mutation and durable audit together; keep live notifications post-commit and best-effort.
Evidence: `crates/app/calibration/src/matching/assign.rs:130-163,200-231`; `crates/persistence/calibration/src/repositories/calibration_assignment.rs:83-134`; `crates/audit/src/bus.rs:188-218`.

**COR-08 · P1 · Source-established: prepared-view finalization is neither atomic nor replay-idempotent.**
Every finalizer invocation allocates a new view ID. View and member inserts are independent; member failures are logged before the plan can become applied. Recovery after a crash or terminal-write failure can repeat finalization and create another view.

Use a stable plan-scoped identity for finalization. Commit its bookkeeping atomically. Keep a recoverable finalization state rather than pretending completed filesystem work can always be rolled back.
Evidence: `crates/app/core/src/plan_apply/finalizers.rs:84-128`; `crates/app/core/src/plan_apply/terminal.rs:126-162`; `crates/persistence/plans/src/repositories/prepared_source_views.rs:70-111`; `crates/app/projects/src/source_view_generate/generate.rs:525-547`.

## Filesystem safety, security and privacy

The executor rejects static descendant symlinks, checks protected sources, requires destructive confirmation and validates approval tokens. Process launching uses separate arguments rather than shell interpolation. Updater endpoint and signature configuration exist. No reachable SQL injection, shell injection, arbitrary-plan import execution or unsigned-update bypass was established.

Those protections do not cover every mutation path or every interval between checking a pathname and using it.

| ID | Priority and evidence | Finding, scope and recommendation | Source anchors |
|---|---|---|---|
| SEC-01 | P2, source-established; downgraded | Direct manifest projection follows a planted `notes` directory link outside the project. The established impact is redirected generated metadata. Arbitrary-code execution and unconditional destruction were not established. Use an anchored no-follow writer and exclusive publication. | `crates/project/structure/src/manifest.rs:216-233`; `crates/app/projects/src/project_manifests.rs:219-227,368-394`; `apps/desktop/src-tauri/src/commands/lifecycle.rs:235-253` |
| SEC-02 | P1, source-established | Existence-check then rename/persist/copy is not atomic no-clobber. A concurrent acquisition, synchronization or export writer can lose its destination bytes. Use true no-replace publication across moves, marker writes, explicit copies and exports. Static pre-existing files are generally rejected. | `crates/fs/executor/src/ops/move_op.rs:63-71,102-125`; `crates/fs/executor/src/ops/write_manifest_op.rs:36-77`; `crates/fs/executor/src/ops/link_op.rs:47-75`; `crates/fs/pathsafe/src/export_dest.rs:155-162` |
| SEC-03 | P2, conditional source-established | An active writer can replace a checked ancestor before the executor's later path-based mutation. Static links are rejected; the gap requires directory-entry control and an already authorized operation. Retain directory/source identity through handle-relative no-follow operations. | `crates/fs/executor/src/ops/path_gate.rs:75-116`; `crates/fs/executor/src/run/loop_.rs:446-494,517-532`; `crates/fs/executor/src/ops/delete_op.rs:43-53` |
| SEC-04 | P1, component reproduced | Recovery converts every metadata-probe error to absence, then reports a removal complete. The probe produced `PermissionDenied → Completed` while the source remained unchanged. Preserve unknown/error states. Verify volume availability before interpreting absence. | `crates/fs/executor/src/reconcile.rs:82-102`; `crates/app/core/src/plan_apply/reconcile.rs:105-129`; `crates/persistence/plans/src/repositories/plan_apply.rs:926-947,1000-1022` |
| SEC-05 | P2, source-established | Execution accepts rootless absolute source-view destinations through `plans.destination_root`; recovery omits that fallback and marks them ambiguous/failed. Raw archive-to-trash actions also resolve differently. Share effective-action and path-resolution contracts across execution and recovery. | `crates/app/projects/src/source_view_generate/generate.rs:552-619`; `crates/app/core/src/plan_apply/paths.rs:214-222,285-303`; `crates/app/core/src/plan_apply/reconcile.rs:59-64,157-170` |
| SEC-06 | P2, source-established | Approval commits before freshness capture. Missing sources or snapshot-write failures leave approval valid; absent snapshot fields make CAS accept a later replacement without comparison. Require successful baselines atomically for new source-mutating approvals. Explicitly exempt source-free actions. | `crates/app/core/src/plans/approve.rs:80-112`; `crates/fs/executor/src/ops/cas_check.rs:41-45,101-115`; `crates/app/core/src/plan_apply/paths.rs:336-340` |
| SEC-07 | P2, source-established | Startup invokes `downloadAndInstall`; the later user action only relaunches. This contradicts staged-install comments and acceptance language. Tests preserve the early install behavior. Resolve download policy separately. Separate download, installation and restart. Verify the behavior on actual packaged platforms. | `apps/desktop/src/app/Shell.tsx:123-126`; `apps/desktop/src/data/updateSubscription.ts:89-115,131-168`; `apps/desktop/src/data/updateSubscription.test.ts:62-75,124-136` |

Null CSP and broad renderer capabilities warrant a separate permission-minimization review. Without an untrusted-data-to-script path, they are hardening opportunities rather than proven XSS or RCE. Likewise, timing defects require concurrent writers; an inert image header does not supply that capability.

## Features and end-to-end workflows

"Implemented" below means reachable source wiring, not successful runtime certification.

| Capability | Assessment | Main remaining issue |
|---|---|---|
| Inbox classification, catalogue-in-place, reviewed movement | Implemented core | Approved evidence is not preserved consistently through ingestion and acknowledgement. |
| Acquisition and calibration inventory | Implemented, with correctness gaps | Session identity, heterogeneous fingerprints, pagination and deep links. |
| Calibration matching and assignment | Reachable | Contradictory session inputs and mutation/audit atomicity; numerical correctness was not exhaustively reviewed. |
| Target catalogue and project association | Implemented core | Known project targets are missing from list projection and grouping. |
| Project creation, source editing, lifecycle | Implemented core | Prepared-view finalization, output-scope ambiguity and stale manifests. |
| Source views and tool manifests | Implemented | Execution/recovery contracts disagree; post-change refresh is incomplete. |
| Cleanup, archive and restore | Partial safety consistency | Restore uses reviewed plans; disposal bypasses them and loses mixed-failure details. |
| Settings, onboarding, localization and themes | Reachable | Selected error, pending, localization and docking paths need repair and rendered verification. |
| External processor handoff | Configuration and launch implemented | Actual PixInsight/WBPP, planetary and lunar compatibility was not exercised. |
| Accepted-output management | Scope conflict | README promises output tracking; newer requirements exclude managed outputs and the UI defaults to an empty section. |

### Product findings


- **PROD-01 · P1:** Archive trash and permanent delete execute directly against earlier archive paths, without generating and approving the new disposal plan. Typed `DELETE`, containment and permanent-delete policy are real safeguards, but approving an earlier archive is not reviewing later disposal. Route disposal through the shared reviewed-plan executor. Evidence: `apps/desktop/src/features/archive/ArchivePage.tsx:124-127,192-196`; `crates/app/core/src/plans/archive.rs:124-198,215-314`.

- **PROD-02 · P1:** If at least one archive-disposal item succeeds, other failures are reduced to logs. The durable event records a success count without failed-item detail. Preserve per-item outcomes and partial-success state. Evidence: `crates/app/core/src/plans/archive.rs:147-193,261-309`; `crates/audit-types/src/event_bus.rs:326-340`.

- **PROD-03 · P2, same defect as UX-01:** Trash and permanent-delete errors have no visible page/modal mutation-error path or global handler. Restore and reveal do surface errors. Add actionable failure feedback to these two operations. Evidence: `apps/desktop/src/features/archive/ArchivePage.tsx:124-127,192-196`; `apps/desktop/src/features/archive/store.ts:117-140`; `apps/desktop/src/data/queryClient.ts:15-25`.

- **PROD-04 · P1:** RecoveryBanner omits retry-created and discarded callbacks. Successful Resume also fails to invoke the callback that removes the recovery queue head. Retries can remain attached to the original review, and completed work can remain at the head. Centralize queue transitions for resume, retry and discard. Evidence: `apps/desktop/src/features/recovery/RecoveryBanner.tsx:59,68-79`; `apps/desktop/src/features/plans/PlanReviewOverlay.tsx:258-265,317-345,393-414`.

- **PROD-05 · P3, downgraded scope issue:** The Outputs section receives no data, while README advertises output tracking. Newer requirements explicitly exclude managed processing outputs, and observed artifacts exist elsewhere. Choose and document the intended boundary; this is not evidence that full output management must be built. Evidence: `apps/desktop/src/features/projects/ProjectBottomDetail.tsx:96-109`; `apps/desktop/src/features/projects/OutputsCleanupSections.tsx:47-75,103-105`; `README.md:30-32`; `specs/030-ui-audit-revision/spec.md:1154,1324`.

- **PROD-06 · P2:** Project target cells always render an em dash and the grouping accessor returns null. Detail DTOs know the canonical target; list DTOs omit it. Populate the list projection and grouping accessor. The challenger rejected the original target-sorting claim: no target sort is offered. Evidence: `apps/desktop/src/features/projects/ProjectsTable.tsx:44,97-98,116-120,260-262`; `crates/contracts/core/src/projects_v2.rs:144-189`.

- **PROD-07 · P2:** Router validation accepts `frameFilter`, but Sessions initializes its local kind to light and ignores that URL field. A non-light selected session can then be cleared because it is absent from the wrong dataset. Use one state contract for navigation and filtering. Evidence: `apps/desktop/src/app/router.tsx:49-56`; `apps/desktop/src/features/sessions/SessionsPage.tsx:107-138,165-201,254-267`.

- **PROD-08 · P2:** Manifests load into component-local state only when project ID changes. Source edits generate manifests but invalidate only project detail, leaving the same mounted accordion stale. Put manifest reads in the existing invalidation system or publish an explicit revision. Evidence: `apps/desktop/src/features/projects/ManifestsAccordion.tsx:55-80`; `apps/desktop/src/features/projects/store.ts:309-325`; `crates/app/projects/src/project_setup/sources.rs:140,257`.

### Recommended product additions

The following additions are recommendations. They are not missing contractual requirements:

1. **Recovery and partial-result workspace.** Show interrupted work, failed items, retained sources and next safe actions in one place. Build on existing plans and durable outcomes rather than adding another execution engine.
2. **Session evidence inspector.** Explain grouping, original versus approved metadata, conflicts and calibration consequences. This makes the richer evidence model useful to users once production integration is complete.
3. **Large-library operational status.** Show scan/reconciliation progress, cancellation state, unavailable roots and last verified inventory freshness. Measure the underlying work before inventing progress percentages.
4. **Interoperability verification matrix.** Maintain small real fixtures for supported processor profiles and declared Windows/Linux/macOS behavior. Tool launch success alone does not prove usable prepared inputs.
5. **Explicit output boundary.** Either provide a narrowly defined accepted-output registry, or remove the empty promise and explain the distinction between observed artifacts and managed outputs.

This review recommends deferring cloud synchronization, collaborative editing and image processing. They would add custody and conflict problems before the local safety workflow is consistent.

## Performance and resource use

Useful existing controls include a bounded 50,000-entry metadata cache, expiry, same-key extraction coalescing, Arc-backed values, bounded watcher ingress and overflow recovery. Classification also has an early cached-response path. Avoid discarding these controls when changing scheduling or data ownership.

| ID | Priority | Established mechanism | Recommended change and measurement |
|---|---|---|---|
| PERF-01 | P1 | Cold/forced classification and source-group processing perform synchronous traversal, hashing and extraction on async workers. Cached item responses can skip this. | Move bounded filesystem work to blocking execution; measure unrelated command latency for cold, forced and cache-hit cases. |
| PERF-02 | P1 | Watcher reconciliation linearly searches stored rows once per known path. K paths cause K(K+1)/2 comparisons: 50,005,000 at K=10,000. Traversal is also synchronous. | Index rows by path and offload traversal; compare outcomes and measured scheduler latency. The comparison count comes from analysis. No benchmark measured it. |
| PERF-03 | P2 | Each selected nonempty root fetches the entire project-source relation before filtering. R roots and P joined rows produce O(RP) decoded work. | Restrict SQL to requested session IDs; preserve ordering and inspect actual query plans before adding indexes. |
| PERF-04 | P2 | A new list-state wrapper invalidates filtering and progressive-reveal derivation. Growing prefixes are repeatedly mapped and sorted. | Stabilize dependencies and derive filtered/sorted data once. Measure filter calls, rows visited and sort work, including heavily filtered catalogues. |
| PERF-05 | P2 | Superseded geometry requests discard useful same-night results while backend computation continues. New requests repeat still-uncached IDs. | Track generation and in-flight IDs; reuse same-generation results without accepting stale-night data. Test delayed, out-of-order completion. |
| PERF-06 | P2 | Cached target search deep-clones the entire owned catalogue before filtering. | Filter shared data first and clone only returned records. Measure allocations and executed query keys; do not assume every keystroke causes IPC. |
| PERF-07 | P3, downgraded | An empty virtualizer range falls back to every row, intentionally accommodating tests. Actual costly production occurrence is unverified. | Measure row counts during real mount and hidden-to-visible transitions before changing behavior or increasing severity. |
| PERF-08 | P2, correctness | Frame-type filtering happens after pagination. An older dark session can be excluded behind a page of flat/bias sessions. An empty filtered result drops the root and its continuation signal. | Filter the relation before pagination and skip irrelevant session-type queries. Verify mixed-type page boundaries and `has_more`. |

Source anchors:

- PERF-01: `crates/app/inbox/src/classify.rs:128-170,193-219,600-611,769-791`; `crates/app/targets/src/metadata_cache.rs:20-24,50-61,83-106`.
- PERF-02: `apps/desktop/src-tauri/src/watcher.rs:191-205,319-366`; `crates/workflow/artifacts/src/reconciler.rs:99-139`.
- PERF-03: `crates/app/core/src/inventory.rs:71-93`; `crates/persistence/targets/src/repositories/inventory.rs:275-307`.
- PERF-04-05: `apps/desktop/src/features/targets/TargetsPage.tsx:159-165`; `apps/desktop/src/features/targets/useTargetsPageFilters.ts:123-181`; `apps/desktop/src/features/targets/useTargetsTableRows.ts:95-198,261-303`; `apps/desktop/src-tauri/src/commands/target_lookup.rs:464-495`.
- PERF-06: `crates/app/targets/src/target_management/list.rs:31-78`; `apps/desktop/src/features/targets/store.ts:103-112`.
- PERF-07: `apps/desktop/src/features/targets/useTargetsTableRows.ts:305-324`; `apps/desktop/src/features/targets/TargetsTable.tsx:383-384,449-458`.
- PERF-08: `crates/persistence/targets/src/repositories/inventory.rs:138-254`; `crates/app/core/src/inventory.rs:80-86,142-159`.

No latency percentage, memory saving or frame-rate improvement is claimed. Preserve cache behavior, alias search, ordering, stale-generation protection and watcher recovery while removing repeated work.

## Interface design, accessibility and interaction

The interface uses dense tables and explicit review controls for filesystem work. Shared table states distinguish loading, error, empty and filtered-empty. Reduced-motion CSS, localization infrastructure and adaptive detail placement are present. Source inspection cannot establish contrast, visual hierarchy, actual focus return or responsive quality.

The design priority is clearer operational truth: what the user approved, what is still running, what partially failed and what can safely happen next. Decorative redesign would not resolve those problems.

| ID | Priority | Finding and bounded recommendation | Source anchors |
|---|---|---|---|
| UX-01 | P2 | Same destructive-error feedback defect as PROD-03; count once in implementation planning. | `apps/desktop/src/features/archive/ArchivePage.tsx:127-130,191-196`; `apps/desktop/src/features/archive/store.ts:119-141` |
| UX-02 | P2 | In pending archive/remap flows, disabling footer Cancel leaves Escape, backdrop and header close unguarded. Closing does not cancel backend work. Guard all dismissal routes or retain an independent outcome surface. Source-view generation already has surviving toasts. | `apps/desktop/src/components/Modal.tsx:143-179`; `apps/desktop/src/features/archive/ArchivePage.tsx:122-125,318-334`; `apps/desktop/src/features/settings/RemapRootDialog.tsx:84-115` |
| UX-03 | P3, downgraded | Initially open modal mounts skip explicit invoker capture. Actual focus-return failure depends on the component library's fallback and was not reproduced. Verify production keyboard flows before declaring a conformance failure. | `apps/desktop/src/components/Modal.tsx:127-134,164`; `apps/desktop/src/features/settings/RemapRootDialog.tsx:59,104-107` |
| UX-04 | P2 | Global command filtering is disabled while static pages/actions are always rendered. Search does not narrow those commands. Filter static commands separately while retaining server-filtered alias results. | `apps/desktop/src/app/CommandPalette.tsx:40-48,170-203,249,287-331` |
| UX-05 | P2 | Palette query replacement leaves previous results selectable without current-query loading/error state. Either search rejection clears both result sets. Add query-specific status and stale-result policy. A visibly false empty-message claim was rejected. | `apps/desktop/src/app/CommandPalette.tsx:170-203,258-284` |
| UX-06 | P2 | Plan actions/outcomes and palette kinds render raw enum strings. Localized headings do not translate safety vocabulary. Use exhaustive localized label maps while retaining raw machine values in contracts. | `apps/desktop/src/features/plans/PlanReviewOverlay.tsx:446-487,619-628`; `apps/desktop/src/app/CommandPalette.tsx:277` |
| UX-07 | P2 | Dock resizing is pointer-only; the separator is not keyboard-operable. Placement choices are useful but do not provide equivalent width adjustment. Add keyboard resizing, bounds and accessible value semantics. | `apps/desktop/src/ui/ResizeHandle.tsx:16-25`; `apps/desktop/src/ui/useAdaptiveDock.ts:127-146`; `apps/desktop/src/components/ListPageLayout.tsx:337-357` |
| UX-08 | P2 | Saved dock width is not clamped on window resize or restore. A 1200px preference from a 2560px window can exceed the supported 1100px minimum when pinned Right. Clamp effective width; preserve preference deliberately. Actual clipping was not measured. | `apps/desktop/src/ui/useAdaptiveDock.ts:83-125,150-155`; `apps/desktop/src/components/ListPageLayout.tsx:306-310`; `apps/desktop/src/components/ListPageLayout.css.ts:18-30,78-88` |
| UX-09 | P3 | `DESIGN.md` describes obsolete navigation, token names and primitive ownership. It tells contributors to edit generated `apps/desktop/src/styles/tokens.css`. Update authoring guidance to source tokens and actual components; do not restore obsolete navigation to satisfy stale prose. | `DESIGN.md:35-48,126-155`; `apps/desktop/src/styles/tokens.css:1-3,56-114`; `apps/desktop/package.json:28-32` |

**Additional challenger finding · P2:** Remap verification can return for path A after the user has edited the field to B. The response restores A's verification and enables applying `verification.newPath`, despite B being visible. Associate results with the input generation or cancel/ignore stale verification. Evidence: `apps/desktop/src/features/settings/RemapRootDialog.tsx:61-96,147-153`. This additional source-established finding is outside the 54 original findings. No driven UI reproduction verified it.

Rendered follow-up should cover archive partial failures, delayed remap verification, palette search replacement, Portuguese safety labels and docking at 1100×720, 1440px and 2560px widths. These checks are proposed. No layout measurements verified them. Start with actual component stories. Continue with the native workflow because browser mocks do not prove native filesystem behavior.

## Testing, release engineering and dependencies

The repository has unit, contract, integration and real-UI test structures, contract generation, dependency policy, performance ratchets and release attestations. The main concern is whether changes activate the right checks and whether publication waits for their results. More happy-path test files would not repair those connections.

| ID | Priority | Finding and recommendation | Source anchors |
|---|---|---|---|
| DEL-01 | P1 | E2E activation and dist-cache identity omit catalogue JSON, Inlang settings and splash HTML inputs. Dispatched E2E can also restore stale dist. Preview serves it without rebuilding. Include all build inputs and prove freshness with a warmed-cache change. Main CI testing localization is not equivalent counterevidence. | `.github/workflows/e2e.yml:262-352,793-838`; `apps/desktop/vite.config.ts:35-51,68-76` |
| DEL-02 | P1 | The failure-alert workflow has no checkout. Its label/issue commands lack `--repo` or `GH_REPO`. Repository-qualified API calls in earlier steps do not supply later CLI context. Qualify each operation and decode the issue body correctly. Normal workflow notifications may still occur. | `.github/workflows/e2e-alert.yml:35-154` |
| DEL-03 | P2, downgraded latent risk | Optional Windows signing replaces installer bytes after updater metadata/signatures are published, without regenerating them. An earlier artifact-collection mismatch blocks that lane first. Repair the handoff. Sign final bytes before publishing matching updater metadata. No broken downloaded update was observed. | `.github/workflows/release-please.yml:161-170,243-251,291-329`; `apps/desktop/src-tauri/tauri.conf.json:43-45,59-65` |
| DEL-04 | P1 | Release creation/publication does not wait for the independent hard Release Gate or all platform artifacts. Independent matrix success can expose a partial release. Build artifacts into a draft/staging release. Verify them before one gated publication transition. | `.github/workflows/release-please.yml:63-78,161-170`; `.github/workflows/release-gate.yml:24-53,245-260`; `release-please-config.json:1-43` |
| DEL-05 | P2; same as PROC-02 | The performance consumer recognizes three crate names but not the helper's ALL/empty selection. Root manifest and lockfile changes can skip the ratchet. Preserve force-full dependency changes even when combined with unrelated mapped crates. | `.github/workflows/ci.yml:833-873`; `scripts/ci-affected-crates.sh:24-31,64-115` |
| DEL-06 | P2; same as PROC-01 | Fallback checks aggregate recognized paths, not every path. Adding README.md to an unclassified deny.toml change suppresses full fallback and can skip the supply-chain lane. Test monotonicity: adding a changed file must not reduce coverage. | `.github/workflows/ci.yml:138-243,788-830` |
| DEL-07 | P3, downgraded | CI generates Rust JUnit and browser failure traces but does not upload them. Failures still fail jobs and text logs remain. Retain bounded, privacy-reviewed diagnostics to reduce debugging cost. | `.config/nextest.toml:144-157`; `apps/desktop/playwright.config.ts:29-47`; `.github/workflows/ci.yml:540-588,883-907` |

The Windows challenger also identified app-local `target` collection paths despite a root Cargo workspace. Treat this as a signing-lane readiness issue requiring staging verification, not evidence that unsigned builds fail. Its external-action corroboration used mutable upstream v1 source: [build.ts](https://github.com/tauri-apps/tauri-action/blob/v1/src/build.ts) and [utils.ts](https://github.com/tauri-apps/tauri-action/blob/v1/src/utils.ts). Pin and verify the exact action implementation before changing artifact handling.

### Test investments that address the findings

- Fault injection between business mutation, audit, enrichment, finalization and acknowledgement.
- Deterministic concurrency barriers for repair/listener membership and final destination publication.
- Recovery fixtures for inaccessible roots, unrecorded successful operations and partially completed disposal.
- Producer-to-consumer decision tables for CI selection, ALL/empty sentinels, lockfiles and mixed known/unknown paths.
- Delayed frontend promises for remap, palette and geometry, with out-of-order completion.
- Warm-cache E2E artifact freshness and a staging release that deliberately fails one hard gate or platform leg.

No dependency is labeled deprecated or vulnerable merely because of age or a prerelease version. The review did not complete a registry/advisory audit. Follow up with manifest-versus-lock inventory, supported toolchain verification, advisory review and final shipped-artifact inspection. Do not run blanket upgrades as a substitute for reproducing the reported defects.

## Engineering processes, workflows, tooling and structure

### Process findings

| ID | Priority | Finding and recommendation | Source anchors |
|---|---|---|---|
| PROC-01 | P2, downgraded; same as DEL-06 | Unknown paths must be classified per file. Aggregate fallback allows a recognized documentation edit to hide an unclassified policy/config change. | `.github/workflows/ci.yml:138-243,788-830` |
| PROC-02 | P2; same as DEL-05 | The affected-crate helper and performance consumer disagree about full-workspace work. Test their combined contract, including lockfile-plus-unrelated-crate changes. | `scripts/ci-affected-crates.sh:24-31,80-115`; `.github/workflows/ci.yml:833-873` |
| PROC-03 | P2 | SpecKit workflow ordering conflicts with gate prerequisites. Assignment commands produce/consume YAML, while gates require Markdown. An advertised implementation route is also marked deprecated. Choose one supported execution contract and generate/check derivatives. Installed-runner enforcement remains unverified. | `.specify/workflows/speckit-full/workflow.yml:44-73,116-120`<br>`gates.yaml:37-52,135-139,368-376`<br>`.specify/extensions/agent-assign/commands/assign.md:114-145`<br>`.specify/extensions/agent-assign/commands/execute.md:51-57`<br>`.specify/gates/nodes.json:25-89` |
| PROC-04 | P3, downgraded | Global pre-commit exclusions remove process/config files from filename-based hook coverage. The wrapper proves only that some hook ran. Exact external Gitleaks behavior was not established, so a complete scanner bypass is not claimed. Inspect the pinned hook. Test excluded-only and mixed synthetic positives. | `.pre-commit-config.yaml:16,26,45-48`; `scripts/precommit-verify.sh:23-41`; `CONTRIBUTING.md:28-42` |
| PROC-05 | P2, reproduced | Journey lint accepts missing provenance and aggregate pass with a failing step. The index trusts the latest record. Validate required run fields and outcome consistency, respecting full/changed-only/smoke semantics. | `docs/journeys/journeys.py:62-95,174-202`; `docs/journeys/FORMAT.md:153-181` |
| PROC-06 | P2, reproduced | Current headings define allowed IDs for all historical runs and deltas. Retiring S2 in v2 makes a retained valid v1 run and retirement delta invalid. Validate against versioned identity or explicit retirement metadata; do not rewrite historical evidence. | `docs/journeys/journeys.py:149-188`; `docs/journeys/FORMAT.md:104-111,225-233` |
| PROC-07 | P3, downgraded | Just recipes name bugfix/tinyspec workflows absent from the checked-in workflow registry. Lightweight extension commands do exist, and the external runner may supply additional discovery. Verify clean-environment resolution before calling the recipes broken. | `justfile:219-223`; `.specify/workflows/workflow-registry.json:3-26`; `.specify/extensions/bugfix/extension.yml:15-25`; `.specify/extensions/tinyspec/extension.yml:15-25` |

### Structural improvements

**Consolidate competing authorities.** Workflow YAML, `gates.yaml`, compiled nodes, extension commands and design prose encode overlapping contracts. The evidence establishes contradictions between these representations. Their quantity alone is not a defect. Choose an authoritative representation for each contract. Verify generated or descriptive derivatives against it.

**Complete production integration before deleting legacy paths.** The richer immutable session/project machinery is test-reachable, while reviewed desktop paths still use older orchestration. Maintain a route-to-command-to-use-case map and explicit transition criteria. Neither a new module nor a deprecated comment proves old code is dead.

**Keep existing ownership boundaries.** Context-local app and persistence crates are useful. Consolidate repeated transaction, path-resolution and publication guarantees in existing shared owners. Avoid a new general-purpose framework or whole-workspace reorganization.

**Make contributor verification explicit.** Document which commands require Rust caches, generated contracts, locale generation, frontend dependencies and native prerequisites. Separate a quick source/tooling check from actual application and release certification. Record the observed provisioning mismatch in reproducibility follow-up. Exclude it from application bug counts.

**Distinguish evidence quality from evidence volume.** Keep exact-commit run records, independent review, conservative change selection and serialized shared state. Repair their validation and connections. Removing them would not resolve contradictory workflow definitions or false-positive pass records.

## Antipatterns and code smells across domains

1. **Log-and-continue after required persistence failure.** Ingestion, fingerprints and view finalization can lose authoritative work while advancing lifecycle state. Classify required versus optional work explicitly.
2. **Check-then-act filesystem guarantees.** Existence and containment checks are useful, but do not replace atomic no-clobber publication or identity-preserving mutation.
3. **Multiple representations of one workflow.** Live execution, recovery, archive disposal and successor APIs disagree on paths, actions or acknowledgement. Reuse the established contract rather than copying another partial interpretation.
4. **Derived identity from mutable enrichment or wall-clock fallback.** Target resolution and missing timestamps can change grouping without new capture evidence.
5. **Tests preserving convenience rather than the user contract.** Update tests expect early installation; virtualization includes an all-row test accommodation. Review the intended behavior before adding assertions that preserve either mechanism.
6. **Broad invalidation and unnecessary ownership copies.** New wrapper objects and whole-catalogue clones defeat existing caches and memoization.
7. **Passing gates that do not consume the changed input.** Stale E2E artifacts, mixed-path selection and weak journey validation can produce reassuring results without the intended evidence.

No blanket deletion list is justified. The strongest deprecation evidence concerns the advertised SpecKit route and stale design-authoring instructions, not proven unused application modules. Trace registrations, callers, persistence compatibility and generated contracts before removing code.

## Challenger corrections retained in this report

| Original overreach | Accepted conclusion |
|---|---|
| Two ordinary listener events race | The listener is sequential; its independent repair task creates the supported cross-plan interleaving. |
| Every differing capture dimension is a hard calibration mismatch | Offset and known camera conflicts support the finding. Exposure is soft scoring; readout impact was not established. |
| Manifest redirection implies unconditional arbitrary destruction | The reliable static-link case redirects generated metadata; priority reduced to P2. |
| Every repeated classification blocks on I/O | Cached item responses can return before traversal; cold/forced and source-group paths remain affected. |
| Empty virtualizer fallback proves production rendering failure | Mechanism exists; production occurrence and cost require rendering evidence. P3. |
| Null modal invoker proves failed focus return | Explicit capture is missing; library fallback remains unverified. P3. |
| Project target sorting is broken | Target display and grouping are broken; the table does not offer target sorting. |
| Output management is necessarily an unimplemented requirement | Newer scope excludes managed outputs. Resolve documentation/UI scope before implementing a feature. |
| Enabling Windows signing immediately proves invalid downloadable updates | Artifact collection fails earlier; signature ordering is a latent design risk requiring staging. |
| Missing artifacts mean CI ignores test failures | Tests still fail; lost trace/JUnit retention is a P3 diagnostic problem. |
| Pre-commit exclusions prove the entire Gitleaks chain is bypassed | Filename coverage is incomplete; the pinned external hook's behavior is unresolved. |
| Missing local workflow IDs prove all lightweight workflows are unavailable | Extension commands exist; external workflow discovery was not inspected. |

## Delivery and remaining verification

This report and its evidence are persisted in the review worktree. No application fix, commit, push, release, dependency installation or external issue creation is claimed. The inaccessible Beads store prevented durable issue creation and synchronization; the report remains the available record.

Release readiness requires reproducing the P1 application paths with disposable data and repairing the release dependency graph. It also requires native UI and packaged-platform checks with provisioned dependencies. Resolve product-scope questions separately from defects. A passing build alone would not prove the concurrency, recovery, artifact freshness or publication guarantees described here.

### Evidence index

| Domain | First review | Independent challenge |
|---|---|---|
| Logic and architecture | [logic-review.md](2026-09-22-holistic-evidence/logic-review.md) | [logic-challenge.md](2026-09-22-holistic-evidence/logic-challenge.md) |
| Security and filesystem safety | [security-review.md](2026-09-22-holistic-evidence/security-review.md) | [security-challenge.md](2026-09-22-holistic-evidence/security-challenge.md) |
| Performance | [performance-review.md](2026-09-22-holistic-evidence/performance-review.md) | [performance-challenge.md](2026-09-22-holistic-evidence/performance-challenge.md) |
| Features and workflows | [product-review.md](2026-09-22-holistic-evidence/product-review.md) | [product-challenge.md](2026-09-22-holistic-evidence/product-challenge.md) |
| Design and interaction | [design-review.md](2026-09-22-holistic-evidence/design-review.md) | [design-challenge.md](2026-09-22-holistic-evidence/design-challenge.md) |
| Testing and delivery | [delivery-review.md](2026-09-22-holistic-evidence/delivery-review.md) | [delivery-challenge.md](2026-09-22-holistic-evidence/delivery-challenge.md) |
| Processes and tooling | [process-review.md](2026-09-22-holistic-evidence/process-review.md) | [process-challenge.md](2026-09-22-holistic-evidence/process-challenge.md) |

The evidence preserves original claims and rejected subclaims for traceability. The consolidated conclusions above, including challenger qualifications, take precedence over an unqualified first-wave statement.
