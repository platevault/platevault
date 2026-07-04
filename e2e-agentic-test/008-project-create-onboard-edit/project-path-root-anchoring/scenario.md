# Project path root-anchoring — folders land inside the project library (PR #414)

> Two-stage verification plan. Runner mechanics: see
> `e2e-agentic-test/AGENT-RUNNER.md`. Stage 1 must fully PASS before Stage 2.

## PRECONDITION — requires PR #414 merged (and #411 already merged)

**This scenario requires PR #414 (`fix-project-path-root-anchor`) merged into
`redesign-ui-platevault`.** It builds on #411 (mkdir auto-apply, merged): run
`project-mkdir-auto-apply/scenario.md` first — its pre-#414 branch of the
folder-location assertion becomes obsolete once this scenario passes.
#414 changes Rust including migration `0060_project_path_anchor.sql` — apply
the RECOMPILE TRAP including `crates/persistence/db/src/lib.rs` (migration
re-embed) after deploying.

## Coverage

- PR #414: `projects.path` was stored verbatim while every consumer
  (tool-launch cwd, artifact watcher, manifests, #411 mkdir executor) treats
  it as ABSOLUTE; the wizard submitted a relative `projects/<slug>`, so
  consumers silently resolved it against the process CWD — with #411 that
  means real mkdirs in whatever directory the app was started from
  (constitution I violation). Fix: anchor at creation —
  - `project_setup::create` anchors relative request paths under the
    registered project folder (`registered_sources.kind = 'project'`,
    earliest registration);
  - rejects `..` components and relative paths when NO project folder is
    registered (typed `path.invalid`);
  - absolute paths pass through; uniqueness checked on the ANCHORED path;
  - the wizard now sends the BARE slug (no `projects/` prefix — that would
    nest a redundant level);
  - tool-launch containment also accepts `registered_sources` roots;
  - migration 0060: best-effort re-anchors legacy relative rows.
- Backend commands: `projects_create`, `projects_get`/`projects_list`.

## Preconditions and fixtures

- Branch: `redesign-ui-platevault` with #414 merged; recompile trap applied;
  fresh relaunch (the migration must run — watch `read_logs` for migration
  application on boot).
- Real backend; bridge overlay; window 1100×720.
- Setup completed with registered project root
  `PROJ_ROOT = C:\dev\astro-plan\test-data\projects`.
- To also verify migration 0060 (optional step 8), the DB should contain at
  least one LEGACY project created before #414 (e.g. from the
  mkdir-auto-apply scenario run pre-#414, stored as `projects/<slug>`).
- Names: `E2E Anchor One` (slug `e2e-anchor-one`).

## Stage 1 — Agent validation via Tauri MCP

Start `ipc_monitor` before step 1.

1. **Wizard sends the bare slug.** Create a project named `E2E Anchor One`
   through the wizard (as in the mkdir scenario) and click Create.
   **Expected (IPC):** the captured `projects_create` request's `path` field
   is exactly `e2e-anchor-one` — bare slug, NO `projects/` prefix, NOT
   absolute.
2. **Stored path is anchored + absolute.** Invoke `projects_get` (or
   `projects_list`) for the new project.
   **Expected:** the persisted `path` is the ABSOLUTE
   `C:\dev\astro-plan\test-data\projects\e2e-anchor-one` (anchored under
   PROJ_ROOT — no `projects\projects` double nesting, no CWD prefix).
3. **Folders on disk in the right place (#411 × #414).** With
   `scaffoldApplied: true` and the success toast shown, `Test-Path` checks:
   **Expected:** `PROJ_ROOT\e2e-anchor-one\...` exists with the tool-specific
   children; **and** `C:\dev\astro-plan\projects\e2e-anchor-one` does NOT
   exist (the CWD-leak location must be empty — this is the core regression
   assertion). [SCREENSHOT anchored-folders]
4. **Uniqueness on the anchored path.** Run the wizard again with the SAME
   name `E2E Anchor One`.
   **Expected:** creation is rejected with the duplicate/uniqueness error
   surfaced on the name step (routed back, not a toast-only failure);
   captured error references the anchored path collision. No second folder
   appears on disk.
5. **`..` traversal rejected.** Via bridge, invoke `projects_create` directly
   with a well-formed request whose `path` is `..\escape-attempt` (copy the
   shape of the captured step-1 request; fresh `requestId` UUID, distinct
   name).
   **Expected:** typed `ContractError` code `path.invalid`; no project row
   created (`projects_list` unchanged); nothing created on disk outside
   PROJ_ROOT.
6. **Absolute path passes through.** Direct-invoke `projects_create` with
   `path` = `C:\dev\astro-plan\test-data\projects\e2e-abs-explicit` (distinct
   name, fresh requestId).
   **Expected:** success; stored path identical to the supplied absolute
   path; folders created there.
7. **No project root registered → typed rejection.** Only if the deployed
   build includes #404 (root delete/disable): disable or delete ALL
   `project`-category roots, then direct-invoke `projects_create` with a
   relative path.
   **Expected:** typed `path.invalid` (relative path with no registered
   project folder), NOT a CWD-anchored create. Restore the project root
   afterwards. If #404 is not available to unregister roots, mark SKIPPED
   with reason.
8. **Migration 0060 (optional, if a legacy row exists).** Read-only DB check
   of the pre-#414 project's `path`.
   **Expected:** formerly relative `projects/<slug>` rows are now absolute
   under the earliest project root; rows that were already absolute are
   untouched. `read_logs` from the first post-deploy boot shows migration
   0060 applied without error.
9. **Consumer smoke — tool launch containment.** If a processing tool is
   configured (PixInsight/Siril path set), use the project's "open in tool"
   affordance on `E2E Anchor One`.
   **Expected:** no containment rejection (the anchored path is accepted via
   the `registered_sources` fallback); working folder resolves inside
   PROJ_ROOT. If no tool is installed, assert via `read_logs`/error absence
   on the resolve call only, and mark the launch itself SKIPPED.
10. **Log check.** No ERROR-level entries besides the deliberate typed
    rejections in steps 4, 5, 7.

### Stage 1 verdict

- **PASS**: bare-slug request; absolute anchored persistence; folders ONLY
  under PROJ_ROOT (CWD location clean); `..` and no-root cases return
  `path.invalid`; absolute passthrough works; duplicates blocked on the
  anchored path; migration behavior confirmed where applicable.
- **FAIL** (fatal): any folder appearing under the app CWD
  (`C:\dev\astro-plan\projects\...`); stored relative path post-create;
  `..` accepted; double-nested `projects\projects` paths; migration mangling
  already-absolute rows.

## Stage 2 — Final Claude Desktop pass

1. **User-visible location.** Open the project's folder from the app (reveal
   affordance, "Show in File Explorer" label) — it opens the folder INSIDE
   the library the user chose at setup. Judge: would a user consider this
   "where my projects live"?
2. **Error comprehensibility.** Re-trigger the duplicate-name rejection via
   the wizard: the message is plain English on the name step, no raw
   `path.invalid`/`name.duplicate` codes shown to the user, no Paraglide key
   leakage.
3. **Preview truthfulness.** The wizard's directory-structure preview shown
   before Create matches the real anchored location (it must not still
   display a `projects/<slug>` relative rendering that contradicts where
   folders actually land).
4. **Layout + themes.** At 1100×720 the wizard and the project detail render
   with fixed action bars, scrolling content only; repeat one screenshot in a
   second theme.
5. **Sign-off.** PASS requires all items PASS. Cleanup: remove the E2E
   projects/folders created (`e2e-anchor-one`, `e2e-abs-explicit`) and
   document any rows intentionally left for future migration testing.
