# Security slice — wave-one source review

Model identity exposed by harness: `openai-codex/gpt-6-astra`. The `@max` role alias is not independently exposed. Snapshot supplied by coordinator: `8198209b5be118e785e4ea85cea3f26e0ea43c1c`.

## Scope and evidence

The inventory above distinguishes implementation sections read from targeted symbol/call-site inspection. This review traced filesystem custody, plan approval/application/recovery, manifest projections, export destinations, IPC/native operations, configured process launching, updater behavior and selected privacy boundaries. Findings are established from source; proposed reproductions below were **not run**, as requested. No tools modified the repository or accessed application/user databases. No builds, tests, formatters, installations, server starts, network requests or rendered-surface checks were performed.

Threat distinctions matter: a static untrusted directory can supply symlinks, whereas the executor race findings require a concurrent writer to an approved tree. None of the latter is presented as exploitation by an inert FITS header alone. No remote-code-execution or arbitrary manifest-import claim is made.

## Concrete strengths and counterevidence

- The main executor has real lexical containment and lstat-based symlink/junction checks, not merely string prefix checking (`crates/fs/executor/src/ops/path_gate.rs:56-116`). It resolves the paths actually supplied to dispatch, including archive destinations (`crates/fs/executor/src/run/dispatch.rs:23-60`). Static descendant symlinks in those rooted operations are rejected.
- Destructive confirmation is independent of protection, and the effective archive-to-trash action participates in the confirmation decision (`crates/app/core/src/plan_apply/paths.rs:306-330`; `crates/fs/executor/src/run/loop_.rs:411-441`). Permanent deletion also checks confirmation in the primitive (`crates/fs/executor/src/ops/delete_op.rs:33-53`).
- Approval uses a stored random token, rejects mismatch, and has SQL state CAS; reopening atomically clears token and approval timestamp (`crates/app/core/src/plan_apply/paths.rs:123-152`; `crates/persistence/plans/src/repositories/plans.rs:454-461,509-513`). Lack of HMAC alone is not a demonstrated vulnerability under this local threat model.
- Overlapping in-process plan runs are serialized through the overlap gate and registry (`crates/app/core/src/plan_apply/paths.rs:79-110`). That does not cover external acquisition/sync tools or pathname aliases.
- Cross-volume moves use temporary output rather than exposing partially copied final files, and attempt rollback if source deletion fails (`crates/fs/executor/src/ops/move_op.rs:63-72,176-205`). The final no-clobber race remains, as detailed below.
- Export paths must be absolute, the parent is canonicalized, reserved filenames are rejected, and temporary files use exclusive creation (`crates/fs/pathsafe/src/export_dest.rs:68-98,166-180`). These are useful protections despite the final publication race.
- Tool execution passes separate argv to `Command`, including on Windows and Linux; macOS uses a fixed `/usr/bin/open` command for bundles (`crates/workflow/profiles/src/launch.rs:139-207`). The inspected code does not concatenate untrusted filenames into a shell command. Configured profiles, enabled state and working-directory containment are checked before launch (`crates/app/core/src/tool_launch.rs:230-324`).
- Inspected approval/recovery repository queries bind values, including a bound JSON array for plan IDs (`crates/persistence/plans/src/repositories/plan_apply.rs:932-947`); no SQL-injection finding was established.
- Updater configuration includes a fixed HTTPS endpoint and signing public key (`apps/desktop/src-tauri/tauri.conf.json:63-70`). Automation bridges are feature-gated; MCP additionally needs explicit runtime opt-in (`apps/desktop/src-tauri/src/lib.rs:111-136,281-294`). This review did not independently verify release build feature selection.
- SIMBAD resolver construction branches on `online_enabled`, with network clients built only in the online branch (`crates/targeting/resolver/src/simbad/resolver.rs:62-89`). This is separate from updater networking.

## Findings

### SEC-01 — Manifest projections follow a planted notes-directory symlink outside the project

**P1 · High confidence · Defect**

**Evidence:** `apps/desktop/src-tauri/src/commands/lifecycle.rs:235-253`; `crates/app/projects/src/project_manifests.rs:219-227,368-394`; `crates/project/structure/src/manifest.rs:216-233`.

**Causal trace:** A successful project lifecycle transition calls `write_lifecycle_manifest`. That reloads `projects.path`, appends `notes`, then calls `write_manifest_file`. The writer uses `create_dir_all`, `target.exists()` and `std::fs::write`; neither it nor these callers invokes the executor's no-follow gate. `create_dir_all` and the later write traverse an existing `notes` symlink/junction.

**Realistic preconditions / proposed reproducer:** For an already managed project whose directory can contain externally supplied content, replace `notes/` with a symlink to a writable outside directory, then perform a normal successful lifecycle transition. The manifest is written outside the project. A static planted directory link is sufficient; no timing race or crafted IPC required. A dangling link at the predicted timestamped final filename is also not rejected by `target.exists()`, although that variant requires predicting the name.

**Impact:** Breaks project containment and writes notes snapshots/project metadata into an unintended directory, potentially a synced/shared directory. The reliable static-directory-link case creates a generated manifest rather than overwriting an arbitrary existing filename; the finding does not overstate it as arbitrary-content RCE.

**Counterevidence:** Executor-controlled marker writes are separately gated, but this projection is outside the executor. The notes adapter also contains risky direct writes, but the inspected production notes-update IPC passes `None` for its optional root; that adapter is not used as evidence of a reachable arbitrary overwrite here.

**Recommended fix:** Route manifest projection through a shared, anchored no-follow writer; reject linked descendant directories and publish files exclusively. Keep the project directory handle through creation/publication rather than only checking string paths beforehand.

**Verification still needed:** Exercise lifecycle and source-change/workflow manifest triggers with a symlinked `notes` directory, Windows junction, dangling final link and ordinary directory. Confirm refusal, no outside write, and truthful failure audit.

### SEC-02 — Final publication is atomic replacement, not atomic no-clobber

**P1 · High confidence · Defect**

**Evidence:** `crates/fs/executor/src/ops/move_op.rs:63-71,102-125`; `crates/fs/executor/src/ops/write_manifest_op.rs:36-52,69-77`; `crates/fs/pathsafe/src/export_dest.rs:155-162`; `crates/fs/executor/src/ops/link_op.rs:47-50,68-75`. Export reachability: `apps/desktop/src-tauri/src/commands/audit.rs:300-325`.

**Causal trace:** Moves check destination existence and subsequently call ordinary rename; cross-volume publication uses `NamedTempFile::persist`. Marker publication also uses `persist`. Exports recheck existence and then call ordinary rename. These steps do not atomically reserve a previously absent final name. On Unix, a destination created after the check is replaced. Explicit copy materialization similarly checks and later calls `std::fs::copy`, which can truncate a newly appearing destination.

**Realistic preconditions / proposed reproducer:** Use an approved move or explicit-copy plan into a directory also written by acquisition/synchronization software. Introduce a different destination file after the existence check but before rename/copy. For the cross-volume move, the entire temporary-copy duration lies between the initial existence check and final replacement, making this more than a theoretical single-instruction window. A racing export to the same final name provides a second route.

**Impact:** Silent loss of the other writer's destination contents despite the application's conflict/no-overwrite contract. Requires concurrent local/shared-storage writes; a static pre-existing normal file is normally refused.

**Counterevidence:** Exclusive creation of temporary files and atomic rename prevent partial final publication, but do not make publication no-replace. The in-process plan-overlap registry does not coordinate other programs or independent exports.

**Recommended fix:** Use true no-replace publication and report a destination conflict on atomic failure. Use platform no-replace rename or an appropriate exclusively published temporary-file primitive; do not substitute another last-moment existence check. Copy to private temporary output and publish no-clobber rather than copying directly into the final path.

**Verification still needed:** Deterministic barrier-based collisions for same-volume move, cross-volume copy publication, marker creation, explicit-copy materialization and audit/log export. Assert the competing file survives unchanged and the source is not deleted after failed publication. Include Unix and Windows semantics.

### SEC-03 — Executor containment can be invalidated between lstat and pathname mutation

**P2 · High confidence · Defect**

**Evidence:** `crates/fs/executor/src/ops/path_gate.rs:75-116`; `crates/fs/executor/src/run/loop_.rs:446-494,517-532`; `crates/fs/executor/src/ops/delete_op.rs:52-53`; `crates/fs/executor/src/ops/move_op.rs:114-125`.

**Causal trace:** The gate lstat-checks path components and returns a string-backed `ResolvedPath`. Source CAS is another pathname lookup. The item and paths are then queued to `spawn_blocking`, whose primitives resolve the same names again through ordinary filesystem APIs. No anchored directory handle or no-follow-at-use guarantee survives the gate. Missing destination components stop the symlink walk, after which `create_dir_all` can traverse a newly installed link.

**Realistic preconditions / proposed reproducer:** A process with write access to an approved tree waits until the gate/CAS finish, renames a checked ancestor, and replaces it with a symlink to an outside directory containing the same basename. Release the blocking mutation. An already confirmed delete can remove the outside file; a move can relocate outside content or publish outside the intended root. This requires active concurrency and directory-write access, not just importing a static image.

**Impact:** The app may perform a mutation outside the scope the user reviewed. On shared storage this can turn a remotely writable subdirectory into an action against other files accessible to the desktop user.

**Counterevidence:** Static links are rejected, and CAS catches many source changes before dispatch. Neither defense protects the interval after the checks.

**Recommended fix:** Anchor traversal and mutation to directory handles; prohibit linked/reparse traversal at the actual open/rename/unlink operation and retain source identity through the mutation. Apply equivalent platform-specific protections. Rechecking immediately before mutation only shrinks the race.

**Verification still needed:** Controlled ancestor-swap races before source open/delete and destination publication, including newly created destination parents and Windows junctions. Demonstrate that the outside sentinel is untouched.

### SEC-04 — Recovery interprets inaccessible storage as a successfully completed removal

**P1 · High confidence · Defect**

**Evidence:** `crates/fs/executor/src/reconcile.rs:82-90,100-102`; `crates/persistence/plans/src/repositories/plan_apply.rs:898-947`; `crates/app/core/src/plan_apply/reconcile.rs:105-129`.

**Causal trace:** Recovery includes all pending/applying items from a crashed plan. `entry_present` reduces every `symlink_metadata` error to `false`. For a removal, false becomes `Completed`; the app then persists `succeeded`. A permission-denied/I/O failure is therefore indistinguishable from actual absence, and an offline/unmounted source can also look absent despite the registered root still resolving to its stored pathname.

**Realistic preconditions / proposed reproducer:** Interrupt an applying delete/trash plan before a later pending item runs. Before restarting, make the source parent inaccessible to the desktop user, or disconnect its storage. Recovery marks the item succeeded even though its source was never removed and returns when the storage does.

**Impact:** Incorrect irreversible-action audit and plan counters, skipped work on resume, and false user assurance that files were deleted/trashed. This can be a privacy/retention failure without any attacker.

**Counterevidence:** The classifier correctly counts dangling symlinks as entries and makes several relocate states ambiguous. The unsafe step is collapsing probe errors/offline storage into proof of completion.

**Recommended fix:** Preserve probe errors as an explicit unknown state and require root availability/identity before interpreting absence. Auto-heal removal only when available filesystem evidence genuinely supports it; otherwise require review. Do not record pending items as completed solely on an unqualified negative stat result.

**Verification still needed:** Recovery under EACCES, I/O errors and disconnected roots, contrasted with a genuinely completed deletion. Confirm ambiguous status and that resume remains possible after reconnecting.

### SEC-05 — Recovery cannot resolve destinations of currently generated source-view plans

**P2 · High confidence · Defect**

**Evidence:** `crates/app/projects/src/source_view_generate/generate.rs:552-555,575-583,600-603`; `crates/app/core/src/plan_apply/paths.rs:285-303`; `crates/persistence/plans/src/repositories/plan_apply.rs:903-912,938-942`; `crates/app/core/src/plan_apply/reconcile.rs:105-115,157-170`.

**Causal trace:** Current source-view generation deliberately stores absolute item destinations with no `to_root_id`, and puts their containing root in `plans.destination_root`. Normal execution recognizes that plan-level fallback. Recovery does not load that field; its `resolve` function requires a root ID even when the stored destination is absolute. The destination becomes `None`, so a completed link/mkdir is classified ambiguous and persisted failed.

**Realistic preconditions / proposed reproducer:** Apply a source-view generation plan and interrupt it after a link/directory is created but before its outcome is durably recorded. Restart. Recovery cannot probe the existing destination because `to_root_id` is absent, even though the current executor had a valid destination root.

**Impact:** Ordinary crash recovery falsely reports repair-required failures for successful current-format operations. Subsequent retry may encounter the already-created destination and cannot simply redo the work. This is a custody/recovery defect, not an attacker-controlled escape.

**Counterevidence:** Returning ambiguous is safer than guessing success. The defect is disagreement between live execution and recovery, not excessive permissiveness in this particular branch.

**Recommended fix:** Reuse one resolution contract for execution and recovery, including plan-level destination root, effective action and archive destination semantics. Preserve required parent-plan fields in the recovery query rather than maintaining a second reduced resolver.

**Verification still needed:** Crash between filesystem success and durable outcome for generated mkdir, symlink, hardlink and explicit-copy items; verify their correct resolved paths and appropriate evidence-based verdicts. Also exercise archive-to-trash effective action, whose live mapping differs from the raw action string used by recovery.

### SEC-06 — Approval can authorize mutation without any source freshness baseline

**P2 · High confidence · Defect**

**Evidence:** `crates/app/core/src/plans/approve.rs:80-112`; `crates/fs/executor/src/ops/cas_check.rs:41-45,101-115`; `crates/app/core/src/plan_apply/paths.rs:336-340`.

**Causal trace:** Approval is persisted before source snapshots are captured. Missing/unreadable sources produce no snapshot; persistence errors are logged but approval still succeeds. `check_cas` immediately accepts an item with both fields absent, without even checking source existence. If another file later occupies that path, the executor acts on the replacement with no comparison to the reviewed file.

**Realistic preconditions / proposed reproducer:** Generate a plan for a file, remove it before approving, approve successfully, then place a different file at the same path before applying. A move/archive acts on the new file; a separately confirmed destructive action can remove it. Acquisition pipelines that reuse names make this realistic without malicious code.

**Impact:** The reviewed/approved source identity is not bound to the subsequently mutated object. A token proves approval of the plan row but does not compensate for a deliberately absent source baseline.

**Counterevidence:** When snapshots exist, size/mtime comparison catches many changes. A still-missing source will generally cause the operation itself to fail; the defect is replacement after an approval that had no baseline, not claiming absent files can be successfully moved.

**Recommended fix:** For source-mutating actions, fail approval on missing/unreadable sources or snapshot persistence failure. Commit validated snapshots and the approval transition atomically. Require explicit reapproval for legacy snapshotless mutations; exempt genuinely source-free operations explicitly.

**Verification still needed:** Missing source at approval, unreadable source, snapshot database error, and replacement before apply. Assert no approved mutation of a replacement and no approved state left behind after failed snapshot capture.

### SEC-07 — Startup updater installs before the stated explicit install/restart action

**P2 · High confidence · Defect**

**Evidence:** `apps/desktop/src/app/Shell.tsx:123-126`; `apps/desktop/src/data/updateSubscription.ts:89-115,131-146,157-168`; `apps/desktop/src-tauri/tauri.conf.json:63-70`.

**Causal trace:** Mounting the shell starts the update subscription, which calls `checkForUpdate`. On an available update it calls `downloadAndInstall` immediately. The later user action only calls `relaunch`. The same module documents that checking never installs and that installation is deferred, while its later comment explicitly acknowledges that the version is already installed on disk.

**Realistic preconditions / proposed reproducer:** Launch a release build with an available validly signed update and network access. Do not select restart. Observe that the install API has already been invoked as part of startup. Platform installer/relaunch behavior needs runtime verification, but the pre-consent install invocation is explicit in source.

**Impact:** Violates the advertised staged-update consent boundary and may replace application files or trigger installer behavior while work is in progress. Startup also contacts the configured GitHub endpoint independently of target-resolution offline settings. This is not an unsigned-update bypass and no astrophotography file upload was found.

**Counterevidence:** Endpoint/signature configuration is present and the explicit relaunch is deferred. Those protections do not defer installation.

**Recommended fix:** Separate check/download from install using the updater's staged APIs, and make installation the explicit user action. Clarify update-network policy separately from astronomical online lookup; only claim global offline behavior if all network initiators honor it.

**Verification still needed:** Platform-specific signed fixture update: after startup/download, installed version/files remain unchanged; explicit user confirmation performs install/relaunch. Exercise failure, cancellation and in-flight filesystem-plan behavior without publishing externally.

## Exclusions, non-findings and limitations

- No source-only visual or accessibility claims are made; all visual behavior is unverified.
- `csp` is null and the main/splash/child-window capability includes webview creation, opener, updater and process permissions. This is a defense-in-depth opportunity, but no untrusted-data-to-script execution chain was established, so it is not inflated into a reachable XSS/RCE finding. Tighten CSP/capabilities after mapping real renderer needs.
- Marker parsing uses typed JSON and checks the version. Exact-symbol search found the parser's visible consumers in tests, not a production path that imports and executes an externally supplied mutation plan. Consequently no arbitrary-plan-import exploit is claimed. FITS/XISF parser internals and every onboarding ingestion branch were not exhaustively reviewed in this slice.
- Risky notes adapter writes were inspected but not promoted as a production exploit: the inspected note-update command supplies no disk root, and the sync helper's discovered callers were tests. The reachable manifest writer is reported separately.
- SQL review was targeted, not an audit of every repository query. No shell interpolation was found in inspected production launch/reveal paths. External processing tools' own parsers/startup scripts are outside this review.
- Feature gating is source evidence, not proof of actual shipped artifacts. No dependency implementation, binary, OS permission measurement, exploit execution or release-signature validation was performed.
- Recovery does not verify content identity in its general presence classifier. A blanket claim that interrupted copy materialization is silently healed was deliberately withheld: current source-view destinations hit SEC-05 first. After fixing resolution, recovery must not mistake partial or unrelated output for completed creation.
- Timing findings require a concurrent writer; static data does not create that writer. Permissions restricting all concurrent access reduce their exploitability but do not satisfy the application's no-overwrite/containment guarantees on shared or actively used storage.

## Prioritized roadmap

1. **Close reachable custody escapes/data loss:** SEC-01 anchored projection writes and SEC-02 true no-clobber publication. Share low-level primitives rather than fixing one caller at a time.
2. **Make recovery conservative and consistent:** SEC-04 error/offline handling and SEC-05 shared resolution, then action-specific identity/completeness evidence before auto-healing.
3. **Bind approval to real sources:** SEC-06 required snapshots and atomic approval transition. Preserve user review when files disappear or change.
4. **Eliminate the active-writer escape window:** SEC-03 handle-relative no-follow filesystem operations, including source identity and destination publication.
5. **Honor update consent and document network scope:** SEC-07 separate download/install/relaunch and verify per platform.
6. **Wave-two hardening:** renderer CSP/capability minimization, artifact-level release feature audit, broader metadata/import resource-limit review and privacy review of exported diagnostics. These are investigation priorities, not additional established vulnerabilities.

All reproduction and verification work remains pending by explicit assignment constraint.

## Inspection inventory

- `crates/fs/executor/src/run/loop_.rs`: Traced path resolution, destructive confirmation, source CAS, protection checks, blocking dispatch, and terminal-state handling.
- `crates/fs/executor/src/run/dispatch.rs`: Traced each executor action to filesystem primitives and the resolved archive destination.
- `crates/fs/executor/src/ops/path_gate.rs`: Inspected lexical containment and component-by-component symlink/junction rejection.
- `crates/fs/executor/src/ops/move_op.rs`: Inspected same-volume rename, cross-volume temporary copy, publication, source deletion, and rollback.
- `crates/fs/executor/src/ops/link_op.rs`: Inspected symlink, hard-link and explicit-copy materialization.
- `crates/fs/executor/src/ops/delete_op.rs`: Inspected permanent deletion and explicit-confirmation guard.
- `crates/fs/executor/src/ops/write_manifest_op.rs`: Inspected marker idempotence, temporary writing and publication.
- `crates/fs/executor/src/ops/cas_check.rs`: Inspected freshness snapshot capture and permissive missing-snapshot behavior.
- `crates/fs/executor/src/reconcile.rs`: Inspected filesystem-presence recovery classifier.
- `crates/fs/pathsafe/src/export_dest.rs`: Inspected absolute-path validation, canonical parent, exclusive temporary creation and final publication.
- `crates/app/core/src/plan_apply/apply.rs`: Traced approval validation, root resolution, overlap registration, state CAS and executor startup.
- `crates/app/core/src/plan_apply/paths.rs`: Inspected approval-token equality, root precedence, action mapping, protection and destructive flags.
- `crates/app/core/src/plan_apply/reconcile.rs`: Traced recovery path resolution and persistence of healed outcomes.
- `crates/app/core/src/plans/approve.rs`: Inspected approval persistence and subsequent best-effort filesystem snapshots.
- `crates/persistence/plans/src/repositories/plan_apply.rs`: Inspected startup sweep, pending/applying recovery selection, bound SQL and recovered-state persistence.
- `crates/persistence/plans/src/repositories/plans.rs`: Targeted inspection of approval/reopen SQL and token invalidation.
- `crates/project/structure/src/manifest.rs`: Inspected manifest rendering and direct disk projection writer.
- `crates/project/structure/src/notes.rs`: Inspected notes adapter; distinguished unsafe-looking primitives from production reachability.
- `crates/project/structure/src/lib.rs`: Inspected versioned marker parser and working-folder containment.
- `crates/app/projects/src/project_manifests.rs`: Traced lifecycle/workflow triggers through project DB path to disk writes.
- `crates/app/projects/src/project_notes.rs`: Inspected notes size/lifecycle guards, DB storage and optional disk projection.
- `crates/app/projects/src/source_view_generate/generate.rs`: Targeted tracing of copy opt-in, destination-root persistence and rootless absolute item destinations.
- `crates/app/core/src/tool_launch.rs`: Inspected configured-profile lookup, canonical working-directory checks, spawn request and audit.
- `crates/workflow/profiles/src/launch.rs`: Inspected platform-specific argv-based process launch, without shell interpolation.
- `apps/desktop/src-tauri/src/commands/manifests.rs`: Inspected manifest retrieval, notes update and reveal entry points.
- `apps/desktop/src-tauri/src/commands/lifecycle.rs`: Confirmed reachable lifecycle-triggered manifest writes.
- `apps/desktop/src-tauri/src/commands/native.rs`: Inspected picker, reveal and Linux process fallback.
- `apps/desktop/src-tauri/src/commands/tools.rs`: Inspected process-launch/settings IPC boundary.
- `apps/desktop/src-tauri/src/commands/audit.rs`: Targeted tracing of export into shared export destination validator.
- `apps/desktop/src-tauri/src/lib.rs`: Inspected updater and feature/runtime gating of automation bridges.
- `apps/desktop/src-tauri/capabilities/default.json`: Inspected window permissions, opener, updater, process and webview creation grants.
- `apps/desktop/src-tauri/tauri.conf.json`: Inspected disabled CSP, fixed HTTPS updater endpoint and embedded public key.
- `apps/desktop/src/data/updateSubscription.ts`: Inspected automatic startup check/download/install and separate relaunch action.
- `apps/desktop/src/app/Shell.tsx`: Confirmed unconditional startup subscription call.
- `crates/targeting/resolver/src/simbad/resolver.rs`: Targeted inspection of offline network-client gating.
