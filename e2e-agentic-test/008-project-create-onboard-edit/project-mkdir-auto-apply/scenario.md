# Project creation — mkdir-only folder plan auto-applies (PR #411)

> Two-stage verification plan. Runner mechanics: see
> `e2e-agentic-test/AGENT-RUNNER.md`. Stage 1 must fully PASS before Stage 2.

## Coverage

- PR #411 (**MERGED** into `redesign-ui-platevault`, 2026-07-04): creating a
  project now creates its folder structure on disk immediately. Mkdir-only
  plans (every action ∈ {`mkdir`, `write_manifest`}, ≥1 `mkdir`) auto-apply
  via the SAME approve+apply use-cases as a manual click; plans with any
  move/copy/link/delete/archive action still require explicit review
  (constitution II deviation, user decision 2026-07-04: reviewability
  preserved as RECORD — plan row + `plan.approved` audit event with actor
  `auto.mkdir_only` + per-item apply audit records).
- Spec 008 (project create wizard) toast contract:
  - `scaffoldApplied: true` → success toast
    `Project "{name}" created — project folders created on disk.`
  - `scaffoldApplied: false` → error toast `Project "{name}" created, but
    folder creation failed. The folder plan remains available for review.`
  - `scaffoldApplied` null/absent → plain `Project "{name}" created.`
- Executor: new `ExecutorItemAction::Mkdir` (`create_dir_all`, idempotent on
  existing dirs, `conflict.destination_exists` when a NON-directory is in the
  way). Pre-#411, mkdir fell through to `NoOp` — folders were never created.
- Backend commands: `projects_create` (response now carries
  `scaffoldApplied`), `plans_list`/`plans_get`, audit surfaces.

## PR interplay — read before running

**#411 is merged; #414 (path root-anchoring) may not be.** Without #414 the
wizard submits the RELATIVE path `projects/<slug>`, and the executor resolves
it against the process CWD — folders will materialize under
`C:\dev\astro-plan\projects\<slug>` (the dev-app CWD), NOT under your
registered project library. That is the known bug #414 fixes; for THIS
scenario it is an accepted (and asserted) pre-#414 location. Run
`project-path-root-anchoring/scenario.md` after #414 merges for the corrected
location. Determine which world you are in first (check whether #414 is in
`git log` on the deployed branch) and use the matching expected path below:
- pre-#414: `EXPECT_BASE = C:\dev\astro-plan\projects\<slug>`
- post-#414: `EXPECT_BASE = <registered project root>\<slug>`

## Preconditions and fixtures

- Branch: `redesign-ui-platevault` tip (≥ #411 merge). **Rust changed** —
  apply the RECOMPILE TRAP (touch `crates/fs/executor/src/lib.rs`,
  `crates/app/core/src/lib.rs`, then relaunch).
- Real backend; bridge overlay; window 1100×720.
- Setup completed with a registered project root
  `C:\dev\astro-plan\test-data\projects` (from the wizard journey scenario).
- Names used: success run `E2E Mkdir Alpha` (slug `e2e-mkdir-alpha`), failure
  run `E2E Mkdir Blocked` (slug `e2e-mkdir-blocked`).
- Failure fixture (create ONLY before the failure test, step 7): a FILE
  occupying the folder destination —
  `Set-Content '<EXPECT_BASE-for-e2e-mkdir-blocked>' 'blocker'`
  (a plain file at the exact path where the project folder would be created).

## Stage 1 — Agent validation via Tauri MCP

Start `ipc_monitor` before step 1.

1. **Reach the project wizard.** Navigate Projects → New project. Complete
   the steps with minimal input: name `E2E Mkdir Alpha`, default workflow
   profile (PixInsight/WBPP); advance to the review step (the wizard permits
   creating without selected sessions — if a step blocks, record exactly which
   and with what message; that is a scenario-blocking discrepancy, not a
   silent skip).
2. **Create.** Click `data-testid="wizard-create-btn"`.
   **Expected (IPC):** one `projects_create` call; response contains
   `projectId`, `planId`, and `scaffoldApplied: true`.
3. **Success toast.** **Expected:** success-variant toast with EXACT text
   `Project "E2E Mkdir Alpha" created — project folders created on disk.`
   then navigation to `/projects` where the new project is listed.
   [SCREENSHOT create-success-toast]
4. **Folders really exist on disk.** From WSL/PowerShell, `Test-Path` the
   expected base (per PR-interplay note) and its tool-specific children
   (e.g. `lights/`, `darks/`, `flats/` — record the actual set created).
   **Expected:** the directories exist; they are empty; NO user files were
   moved or copied anywhere (constitution I/III boundary).
5. **Reviewability-as-record (constitution II deviation).** Via bridge invoke
   `plans_list` (or open the plans surface) and locate the scaffolding plan
   by `planId` from step 2.
   **Expected:** the plan row exists in an applied state; the audit trail
   contains a `plan.approved` event with actor `auto.mkdir_only` plus
   per-item apply audit records. (DB read-only spot-check acceptable if the
   UI lacks a per-plan audit view.)
6. **Idempotence guard.** Verify vs the plan items: every action in the plan
   is `mkdir` or `write_manifest` — if the wizard's plan ever contains a
   move/copy/link/delete/archive item, auto-apply firing is a FAIL (the
   predicate must have refused it and left the plan for manual review).
7. **Failure path — file in the way.** Create the blocker file fixture, then
   run the wizard again with name `E2E Mkdir Blocked` and click Create.
   **Expected (IPC):** `projects_create` succeeds (project record created)
   with `scaffoldApplied: false`.
   **Expected (UI):** error-variant toast with EXACT text
   `Project "E2E Mkdir Blocked" created, but folder creation failed. The
   folder plan remains available for review.` The app still navigates to
   `/projects`; the project exists. [SCREENSHOT create-failure-toast]
8. **Nothing overwritten; plan stays reviewable.** From WSL: the blocker file
   still exists with content `blocker` (never overwritten — constitution II).
   The failed plan is still present in a reviewable (non-applied) state via
   `plans_list`; the apply attempt left per-item audit records including the
   `conflict.destination_exists` outcome.
9. **Log check.** `read_logs`: the failed apply is a handled, typed outcome —
   no panic/stack trace; success run logged plan approval + apply.

### Stage 1 verdict

- **PASS**: success run → `scaffoldApplied: true`, exact success toast, real
  directories on disk, plan+audit record trail; failure run →
  `scaffoldApplied: false`, exact failure toast, blocker file byte-identical,
  plan reviewable.
- **FAIL** (fatal): folders NOT created despite success toast (the pre-#411
  NoOp regression); blocker file overwritten or deleted; auto-apply firing on
  a plan containing user-file actions; failure run showing the success toast;
  missing `plan.approved` / actor `auto.mkdir_only` audit trail.

## Stage 2 — Final Claude Desktop pass

1. **Message truthfulness.** Judge the three-toast contract as a user: the
   success toast only appears when folders verifiably exist; the failure
   toast makes clear the PROJECT was still created and where to go next. If
   the failure toast leaves the user with no discoverable path to the
   reviewable plan, flag it as a UX gap (with screenshot) even though Stage 1
   passed.
2. **Folder structure sanity.** Open the created folder in File Explorer:
   structure matches what the wizard's "What will exist on disk" preview
   promised; naming matches the project name/slug expectations.
3. **Copy/i18n.** Both toasts and all wizard-step strings are real English —
   no raw keys (`projects_wizard_toast_created_folders`), no `{name}`
   leakage.
4. **Layout + themes.** At 1100×720 the wizard action bar (Back/Next/Create)
   is always visible; only step content scrolls; toasts do not cover the
   action bar. Repeat the review-step screenshot in a second theme.
5. **Sign-off.** PASS requires all items PASS. Cleanup: delete the two E2E
   projects if a delete affordance exists (otherwise document them), remove
   the blocker file and created folders.
