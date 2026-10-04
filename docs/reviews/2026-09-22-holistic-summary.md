# PlateVault repository review summary

Reviewed snapshot: `8198209b5be118e785e4ea85cea3f26e0ea43c1c`
Review date: 2026-09-22

[Detailed findings, source citations and evidence](2026-09-22-holistic-review.md)

## Assessment

PlateVault has useful functionality and explicit architectural boundaries. Its safety guarantees are applied inconsistently across complete workflows. Prioritize data integrity, recovery and release controls before expanding features or redesigning the interface.

Seven domain reviews and seven independent challenges assessed 54 findings. Challengers retained 45 and downgraded nine. Some findings overlap. Most were established from source and were not reproduced end to end.

## Highest priorities

### Ingestion and session integrity

Approved frame-type overrides can be discarded when ingestion rereads the original header. Concurrent ingestion and repair can overwrite session membership. A transient database failure can still result in an inbox item being acknowledged, removing its normal retry path.

Target resolution and missing capture timestamps can change grouping identity. Frames with conflicting calibration metadata can share a session whose fingerprint hides the conflict.

Make approved classification, stable session identity, persistence and completion acknowledgement one coherent contract. See COR-01 through COR-07.

### Filesystem safety and recovery

Recovery can interpret permission errors as successful removal. A component reproduction returned `Completed` while the inaccessible source file remained unchanged.

Destination checks followed by ordinary rename or copy can overwrite a file created by another process between those operations. Execution and recovery interpret certain source-view destinations differently. Prepared-view finalization can leave incomplete records or create duplicates when repeated.

Preserve uncertainty during recovery. Use atomic no-overwrite publication. Finalize database records transactionally and without duplication on retry. See SEC-02 through SEC-06 and COR-08.

### Archive and recovery workflows

Archive disposal bypasses the normal reviewed-plan flow. Mixed success and failure can lose per-item failure details. Destructive errors can lack visible feedback. Recovery queues do not consistently advance after resume, retry or discard.

Route disposal through the existing plan engine. Retain durable, visible outcomes for every item. See PROD-01 through PROD-04 and UX-01 through UX-02.

### CI and release controls

E2E selection and cache keys omit build inputs, allowing stale UI artifacts. Certain manifest and lockfile changes can skip performance checks. Adding a documentation change can reduce coverage for an otherwise unclassified configuration change.

Release publication does not wait for the independent hard release gate and complete platform artifacts. The failure-alert workflow lacks repository context for some GitHub CLI commands.

Test CI routing as application logic. Publish only verified final artifacts after the required checks pass. See DEL-01 through DEL-06 and PROC-01 through PROC-02.

## Performance and interaction

The identified performance costs include quadratic watcher reconciliation, blocking filesystem work on async workers, repeated global SQL reads and whole-catalogue cloning. Target filtering and geometry work can repeat unnecessarily. Filtering after pagination also causes incorrect inventory results.

Interaction defects include stale asynchronous remap results, command-palette search and loading behavior, pointer-only dock resizing, untranslated safety labels and inconsistent pending-dialog dismissal.

Measure costs before assigning speedup targets. Frontend dependency failures prevented a rendered UI review, so visual quality and accessibility conformance remain unverified. See PERF-01 through PERF-08 and the design section of the detailed report.

## Processes, tooling and structure

SpecKit workflow and gate definitions conflict. Design-authoring instructions describe obsolete navigation and generated-file ownership. Journey validation accepts incomplete or contradictory pass records and mishandles retired step IDs. Both journey-validation defects were reproduced against the actual validator.

Consolidate competing sources of authority while retaining useful safeguards. The evidence does not justify a wholesale architecture rewrite, blanket dependency upgrade or broad dead-code deletion. See PROC-03 through PROC-07 and UX-09.

## Code smells, idioms and abstraction boundaries

Code smells were reviewed through correctness, architecture and performance analysis. The review did not audit every Rust or TypeScript construct for language idioms.

The strongest findings concern behavioral contracts:

| Pattern | Evidence | Recommended boundary |
|---|---|---|
| Required persistence failures logged and ignored | COR-06, COR-08 | Return required failures and preserve retry ownership until durable work completes. |
| Read-modify-write JSON membership | COR-02 | Use a transaction or an atomic normalized-membership operation. |
| Separate business mutation and audit commits | COR-07 | Expose a transaction-scoped operation for changes requiring an authoritative audit. |
| Execution and recovery resolve the same paths differently | SEC-05 | Share one effective-action and path-resolution contract. |
| Repeated destination checks followed by ordinary publication | SEC-02 | Use an atomic no-overwrite filesystem primitive across mutation paths. |
| Late asynchronous results remain actionable | UX remap follow-up, UX-05, PERF-05 | Define stale-result handling per query or input generation; share a helper where semantics match. |
| Whole-catalogue clones and unstable derived-state wrappers | PERF-04, PERF-06 | Filter borrowed or shared data before cloning and stabilize memoization inputs. |
| Change-selection producers and consumers disagree | DEL-05, DEL-06, PROC-01, PROC-02 | Give CI selection one tested contract for full-workspace work and unknown paths. |

Prefer existing context-local modules for these guarantees. Add an abstraction when independent callers need the same invariant. Similar syntax alone does not justify a generic repository layer, universal async hook or new framework.

The review identified duplicated and inconsistent guarantees, rather than proving that the repository needs more layers overall. Trace callers and registrations before deleting successor or legacy modules.

## Recommended sequence

1. Fix ingestion correctness and acknowledgement.
2. Fix filesystem recovery, destination publication and finalization.
3. Repair archive and recovery interactions.
4. Connect CI evidence to release permission.
5. Optimize measured bottlenecks and interaction defects.
6. Consider a session evidence inspector, unified recovery workspace and explicit output-management scope.

## Verification and limits

Two tooling test files passed. Focused probes reproduced the recovery false-success defect and both journey-validation defects.

Rust workspace tests were blocked by an uncached locked dependency. Frontend launch was blocked by incomplete provisioned dependencies. No full-suite, live UI or packaged-release pass is claimed. Application code was unchanged by the review.

The detailed report records source anchors, challenger corrections, verification commands, environmental limitations and links to all 14 readable review artifacts.
