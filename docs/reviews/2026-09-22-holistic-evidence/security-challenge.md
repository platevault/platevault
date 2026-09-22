# Wave-two security challenge

Model identity exposed by the harness: openai-codex/gpt-6-astra. The requested @max alias is not independently exposed. This is a source-only snapshot review, not a patch-introduction review. All seven numbered findings were independently traced; six are accepted and one is downgraded. No numbered finding is rejected.

## SEC-01 — DOWNGRADE to P2: manifest projection traverses a planted directory link

The containment defect is real. `apps/desktop/src-tauri/src/commands/lifecycle.rs:235-253` invokes the projection after a successful project transition. `crates/app/projects/src/project_manifests.rs:368-394` obtains the project path from the database; `:219-227` appends `notes` and calls the writer. `crates/project/structure/src/manifest.rs:216-233` uses `create_dir_all`, follows `target.exists()`, then writes through the pathname without a no-follow gate. An existing directory symlink at `notes` can therefore redirect the generated manifest, including its notes snapshot, into a writable outside directory. The notes embedding is visible at `crates/app/projects/src/project_manifests.rs:203-215`.

Counterevidence: this is not an arbitrary-path instruction embedded in a FITS header. An attacker or external process must control the managed project's notes entry, or the user must introduce linked content there. The reliable static case creates a timestamped generated file; a pre-existing regular final file causes a skip rather than overwrite. The tests at `crates/project/structure/src/manifest.rs:313-338` exercise ordinary creation and sequential idempotence, not linked directories. The executor gate is irrelevant to this separate caller. I downgrade P1 to P2 because the demonstrated impact is bounded redirected metadata creation/privacy exposure, not unconditional destruction or arbitrary-content execution. A dangling final link adds a filename-prediction precondition and should not drive the headline severity.

Remaining verification: lifecycle and workflow triggers with a Unix directory link and Windows junction; assert no outside file, truthful audit, and successful ordinary projection. No such scenario was executed.

## SEC-02 — ACCEPT, P1: publication can replace a racing destination

`crates/fs/executor/src/ops/move_op.rs:102-125` checks absence before an ordinary rename. Its cross-device path uses temporary copying followed by `persist` at `:63-71`; the initial destination check is not repeated atomically at publication. `crates/fs/executor/src/ops/write_manifest_op.rs:36-52,69-77` has the same check/persist pattern. `crates/fs/executor/src/ops/link_op.rs:47-50,68-75` permits explicit copy after an existence check and copies directly to the final path. `crates/fs/pathsafe/src/export_dest.rs:155-162` performs a second check followed by ordinary rename. The export route is reachable through `apps/desktop/src-tauri/src/commands/audit.rs:300-325`; executor dispatch routes Move, Link and WriteManifest into these primitives at `crates/fs/executor/src/run/dispatch.rs:46-50,91-101`.

Counterevidence: static existing files are refused; symlink/hardlink creation itself does not overwrite an existing entry. The copy finding applies specifically to Materialization::Copy, not all link kinds. Exclusive temporary creation and atomic replacement protect against partial publication, not replacement of a competitor's file. `crates/fs/pathsafe/src/export_dest.rs:336-355` tests a destination appearing during the writer callback, which the later check catches; it does not cover appearance after that check. `crates/fs/executor/src/ops/move_op.rs:247-260` covers a pre-existing destination, likewise not the race. Concurrent acquisition/sync or another exporter supplies a realistic writer; inert metadata alone does not. P1 is justified by silent loss of the competing destination and, for a successful move, removal of the approved source.

Remaining verification: deterministic collision barriers at final publication and direct-copy open, including the longer cross-volume copy window. Assert competitor bytes survive, source remains after conflict, and platform-specific no-replace behavior. Windows outcomes were not exercised.

## SEC-03 — ACCEPT, P2: path containment is not retained through mutation

`crates/fs/executor/src/ops/path_gate.rs:75-116` walks descendant components with lstat and returns a pathname. `crates/fs/executor/src/run/loop_.rs:446-494` resolves and CAS-checks that pathname; `:517-532` then transfers it to a blocking task. `crates/fs/executor/src/run/dispatch.rs:68-72` dispatches a confirmed delete, and `crates/fs/executor/src/ops/delete_op.rs:43-53` ultimately calls path-based remove_file. A checked ancestor swapped for a link after these checks redirects the eventual lookup. Missing destination components also terminate the earlier walk, while move later creates parents (`crates/fs/executor/src/ops/move_op.rs:113-125`).

Counterevidence: static descendant links are rejected, non-NotFound lstat failures are hard errors, protected sources are refused (`crates/fs/executor/src/run/loop_.rs:495-515`), and delete requires explicit confirmation independently of protection (`:411-435`). Those guards narrow the trigger but do not hold directory identity across dispatch. The attack needs active directory-entry control and an already authorized mutation, not merely an untrusted image. A different-privilege shared-storage writer is the meaningful security case; a same-user local process already has broad powers. P2 correctly reflects those preconditions.

Remaining verification: controlled ancestor swaps after CAS, with an outside sentinel and an approved/confirmed operation; independently cover destination creation and Windows reparse points. Do not claim a static-symlink executor exploit from this evidence.

## SEC-04 — ACCEPT, P1: failed filesystem probes can heal an unperformed removal

`crates/fs/executor/src/reconcile.rs:82-90,100-102` converts every symlink_metadata error to absence and absence to Completed for Remove. Recovery selects pending as well as applying rows (`crates/persistence/plans/src/repositories/plan_apply.rs:926-947`), so the affected item need never have run. The app persists Completed as succeeded at `crates/app/core/src/plan_apply/reconcile.rs:105-129`, and repository code changes both item state and counters at `crates/persistence/plans/src/repositories/plan_apply.rs:1000-1022`. Boot invokes this path at `apps/desktop/src-tauri/src/lib.rs:668-684`.

Counterevidence: an unresolved database root produces an ambiguous path rather than success. However, `crates/app/core/src/plan_apply/paths.rs:351-364` resolves stored root paths without establishing that their storage is online, and reconciliation has no availability gate. Dangling-link tests at `crates/fs/executor/src/reconcile.rs:157-184` deliberately and correctly treat an existing link as present. Repository tests at `crates/persistence/plans/src/repositories/plan_apply.rs:1478-1565` verify row selection/healing but do not establish filesystem availability. EACCES and I/O errors are sufficient; disconnected storage is an additional case whose mount layout matters. The defensible impact is false removal success, omitted resume work and inaccurate retention/audit state—not actual destruction by recovery itself.

Remaining verification: nonprivileged EACCES, injected I/O error and an unavailable registered volume, contrasted with genuine completion. Ensure unknown state is surfaced and reconnecting permits recovery without false succeeded counts.

## SEC-05 — ACCEPT, P2: source-view destination encoding disagrees with recovery

`crates/app/projects/src/source_view_generate/generate.rs:552-555` stores the plan destination root; `:575-583,600-619` stores rootless absolute mkdir/link destinations. Live mapping explicitly uses the plan fallback at `crates/app/core/src/plan_apply/paths.rs:285-303`. Recovery's row type/query omit that field (`crates/persistence/plans/src/repositories/plan_apply.rs:903-912,932-942`), and `crates/app/core/src/plan_apply/reconcile.rs:157-170` requires a root ID before accepting even an absolute path. The resulting None yields Ambiguous for Create (`crates/fs/executor/src/reconcile.rs:87-90`), persisted failed by `crates/app/core/src/plan_apply/reconcile.rs:133-146`.

Counterevidence: this is conservative failure rather than an escape or false success. The ordinary truth-table tests for unresolved destinations correctly expect ambiguity; they do not exercise the current generator's valid encoding. The persistence test at `crates/persistence/plans/src/repositories/plan_apply.rs:1478-1511` uses a rooted move, not these source-view items. The first-wave reproducer is valid but narrower than the actual impact: every unreconciled rootless Create item becomes ambiguous, including items that had not started, not only successful items whose durable outcome was lost.

Remaining verification: interrupted generated plans with both completed-unrecorded and never-started mkdir/link/copy items; verify shared live/recovery resolution and correct classification. Existing destinations alone should not be treated as sufficient content-integrity evidence after fixing resolution.

## SEC-06 — ACCEPT, P2: missing approval snapshots allow replacement-source mutation

`crates/app/core/src/plans/approve.rs:80-112` persists approval before capture, skips failed metadata capture and logs rather than propagates snapshot-write failures. `crates/fs/executor/src/ops/cas_check.rs:41-45` explicitly accepts two absent snapshot fields. `crates/app/core/src/plan_apply/paths.rs:336-340` forwards them unchanged, and `crates/fs/executor/src/run/loop_.rs:466-494` consumes that permissive result before dispatch. A normal source removed before approval and replaced by another regular file before apply therefore supplies a reachable wrong-object move/delete scenario.

Counterevidence: permissive legacy behavior is deliberate and tested at `crates/fs/executor/src/ops/cas_check.rs:151-158`; that does not make failure to establish baselines for newly approved source mutations safe. Source-free mkdir/marker operations must remain exempt. A source still absent generally makes the primitive fail; this is not an absent-file-success claim. Existing snapshots detect size/mtime changes, and protection/confirmation continue to apply. Atomic snapshot persistence also cannot establish cryptographic identity from size/mtime alone; the proposed fix should not be advertised as that stronger guarantee.

Remaining verification: missing/unreadable source during new approval, snapshot-write failure, then same-path replacement before apply; verify no approved mutation is left authorized without its required baseline. Separately exercise legacy policy and source-free operations.

## SEC-07 — ACCEPT, P2: startup invokes installation before the user action

`apps/desktop/src/app/Shell.tsx:123-126` starts the subscription. `apps/desktop/src/data/updateSubscription.ts:96-115,157-168` checks and invokes downloadAndInstall before entering ready; `:140-146` makes the later action only relaunch. This contradicts the same module's staged-install promise at `:7-12,89-92`. The user-acceptance sequence also appears in `specs/051-tauri-shell-integration/spec.md:386-392`.

Important counterevidence: `apps/desktop/src/data/updateSubscription.test.ts:62-75,124-136` explicitly expects downloadAndInstall during checking and acknowledges successful installation before restart. Thus the issue is not missing test coverage alone: tests preserve the mistaken staging contract. The journey at `docs/journeys/J17-software-update-install/journey.md:74-81` is stricter still, forbidding even background download; its no-download claim conflicts with current staged-flow comments and must not be silently treated as the current policy. The narrower finding—install is invoked before the advertised explicit install/restart action—survives these conflicts. The fixed HTTPS endpoint/public key (`apps/desktop/src-tauri/tauri.conf.json:63-70`) and updater capability (`apps/desktop/src-tauri/capabilities/default.json:19`) are present. No unsigned-update bypass, data upload or guaranteed premature restart is established. Global offline-policy violation is also unsupported without a global offline promise; it is not part of the accepted defect.

Remaining verification: actual packaged signed fixture updates on supported platforms, observing install timing and active-work disruption separately from explicit relaunch. Resolve the download-versus-install product contract before revising the mocked tests. No plugin binary or installer behavior was executed here.

## Material omission confirmed separately

The report mentions archive-to-trash only as future verification, but the live/recovery mismatch is already source-provable: live mapping turns raw archive into Trash when the plan chooses trash (`crates/app/core/src/plan_apply/paths.rs:214-222`), while recovery unconditionally maps raw archive to Relocate and resolves archive_path (`crates/app/core/src/plan_apply/reconcile.rs:59-64,108-115`). The recovery query omits destructive_destination (`crates/persistence/plans/src/repositories/plan_apply.rs:932-942`). After successful OS trash with an unrecorded outcome and no archive destination, recovery reports Ambiguous rather than completed removal. This is an additional instance of SEC-05's split execution/recovery contract, P2, not an eighth counted finding. A source-only regression scenario should cover it alongside destination-root resolution.

## Exclusions and limitations

No repository writes, installs, tests, builds, formatting, linting, runtime validation, database access, external publication, or additional delegation occurred. Source and test bodies were inspected, not executed. All visual claims remain unverified. This challenge traced the seven claims rather than independently auditing every metadata parser, IPC command, SQL query or configured process launch. Null CSP and broad capabilities remain hardening questions, not proven script-execution chains. No additional RCE, SQL injection, shell injection, import execution or data-upload finding is asserted. Timing attacks require a concurrent writer, and platform semantics remain a verification obligation.

## Prioritized roadmap

1. Prevent silent clobber with atomic no-replace publication across moves, marker writes, explicit copies and exports (SEC-02).
2. Preserve probe errors/volume availability during recovery and unify effective-action/path resolution (SEC-04, SEC-05 and archive-to-trash omission).
3. Require successful baseline capture/persistence for newly approved source mutations (SEC-06).
4. Contain direct manifest projections and retain directory/source identity through executor mutation (SEC-01, SEC-03).
5. Separate update download, installation and relaunch according to an explicit product contract, then test actual packaged platforms (SEC-07).

| ID | Verdict | Severity |
|---|---|---|
| SEC-01 | DOWNGRADE | P2 |
| SEC-02 | ACCEPT | P1 |
| SEC-03 | ACCEPT | P2 |
| SEC-04 | ACCEPT | P1 |
| SEC-05 | ACCEPT | P2 |
| SEC-06 | ACCEPT | P2 |
| SEC-07 | ACCEPT | P2 |

Totals: 6 accepted, 1 downgraded, 0 rejected; 7 numbered findings challenged.
