# Tasks: Processing Tool Launch

**Spec**: 011-processing-tool-launch | **Plan**: [plan.md](./plan.md)

Tasks are grouped by user story so each story can be developed and tested
independently. Mockup-done items are marked `[mockup]`; their post-mockup
counterparts (contract-backed, audited) are tracked as fresh tasks.

## Foundations

- **T001**. Add `crates/workflow/profiles/` types: `ToolProfile`,
  `DetachStrategy`, `LaunchInvocation`, `ArgsToken` (closed enum:
  `Literal(String)`, `Folder`, `File`). Unit-test the args-template
  parser against R3 grammar (valid + invalid samples).
- **T002**. Seed PixInsight, Siril, and Planetary Suite static profiles
  in `crates/workflow/profiles/seed.rs`. Include `bundle_id` values per
  R-BundleId (PixInsight: `com.pixinsight.PixInsight`, Siril:
  `org.free-astro.siril`, StarTools: `com.startools.startools`).
  Profile validation runs at app start; invalid seeds fail the boot.
- **T003**. Add the `tool_launches` table + migration in
  `crates/persistence/db/`. Indexes: `(project_id, launched_at desc)`.
- **T004**. Extend the settings store (spec 018 namespace
  `tool_workflows`) with `executable_path`, `enabled`, `auto_detected`
  per tool id. Settings save validates that the path is absolute and
  existent.
- **T005**. Generate Rust DTOs in `crates/contracts/core/` and TS types
  in `packages/contracts/generated/` from `tool.launch.json` and
  `tool.profile.list.json`.
- **T006**. Add a Tauri command adapter that maps `tool.launch` and
  `tool.profile.list` to the use cases.

## US 1 — Launch The Configured Tool With Project Context (P1)

- **T007**. Implement `crates/app/core/usecases/tool_launch.rs::launch`
  with the resolution pipeline from `plan.md` (project lookup → profile
  lookup → executable check → cwd resolution → args render → spawn →
  persist → audit). Inject the spawn boundary behind a trait so tests
  use a fake spawner.
- **T008**. Implement platform detach in
  `crates/workflow/profiles/launch.rs`:
  - Windows: `creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)`.
  - macOS: `open -b <bundle_id>` helper using `ToolProfile.bundle_id` when
    set (A1, R-BundleId); `setsid` via `pre_exec` fallback for plain
    binaries or when `bundle_id` is null. On quarantine error from
    `open -b`, return `macos.quarantine.detected` with notification copy
    (R-MacQuarantine).
  - Linux: `setsid` via `pre_exec`.
- **T009**. Add a `crates/audit` event kind `tool_launch` carrying
  `project_id`, `tool_id`, `launch_id`, `working_dir`, `args_hash`,
  `outcome`. Audit row is written before the use case returns.
- **T010**. Replace the in-memory click handler in
  `apps/desktop/src/features/projects/ProjectsPage.tsx` (`projectFooter`
  + `rowMenuGroupsForLifecycle`) with a `tool.launch` dispatch.
  Preserve the existing label, disabled rules, and tooltip surface.
- **T011**. Add a transient "Launched {tool}" toast on success and a
  failure toast keyed by error code with "Configure path" /
  "Re-configure" affordances.
- **T012**. Add the re-launch warning: when the most recent
  `ToolLaunch` for `(project, tool)` has `completed_at = null` and the
  recorded `pid` is still alive (best-effort `kill 0`), present a modal
  with exactly two buttons: **"Open another instance"** (dispatches
  `force=true`) and **"Cancel"** (aborts) (A3).
- **T012b**. Implement cwd library-root containment check in the launch
  use case (R-CwdContain, FR-010): canonicalize `working_dir`; verify it
  is a path-prefix descendant of a registered library root; reject with
  `cwd.outside_library_root` if not. Integration test: launch with a cwd
  outside all library roots → expect rejection.
- **T013**. Tests: contract round-trip test for `tool.launch`; unit
  tests for argv rendering across the three seeded profiles;
  integration test using a stub binary that records its argv + cwd to a
  scratch file.

## US 2 — Configure Tool Paths Without Editing Files (P2)

- **T014**. Implement
  `crates/app/core/usecases/tool_launch.rs::list_profiles` returning
  `ToolProfileSummary` rows joined with settings + filesystem
  freshness.
- **T015**. Implement auto-discovery in
  `crates/workflow/profiles/discover.rs` per R2 (Windows / macOS /
  Linux). Pure read; safe to run repeatedly.
- **T016**. Add the "Tool Workflows" section to the Settings page:
  list each tool with display name, path input, "auto-detected" badge
  when applicable, "Re-run auto-detect" button, and inline existence
  validation.
- **T017**. Wire the project CTA to disable when the resolved profile's
  `available == false`, with tooltip copy keyed off
  `configured` / `available` (`Tool path not configured` vs `Tool
  executable missing`).
- **T018**. Tests: Playwright smoke for the Settings flow (auto-detect
  → save → CTA enables). Vitest for the disabled-state copy matrix.

## US 3 — Pass Project Context On Launch (P3)

- **T019**. Add a `resolve_working_folder(project)` helper in
  `crates/project/structure/` that returns the project's generated
  source-view folder when present, else the project root.
- **T020**. Render `args_template` against the resolved folder; when
  `supports_open_folder == false`, ensure `{folder}` is absent from the
  template (validated at T001) and only `cwd` is set.
- **T021**. Surface a one-time hint on first launch of a
  `supports_open_folder = false` tool explaining that the cwd is
  anchored to the project (per US3 acceptance scenario 3).
- **T022**. Tests: stub-binary integration tests asserting the cwd and
  argv match the per-tool expectations from R3 for both
  source-view-present and source-view-absent projects.

## Cross-Cutting

- **X-1**. Steering: add an index entry for `specs/011-` once tasks
  land.
- **X-2**. Cross-link `tool_launch` audit event into spec 005's event
  catalogue.
- **X-3**. Contract drift snapshot: a generated test fails if the
  rendered argument vocabulary in `crates/workflow/profiles/` diverges
  from the closed `{folder}` / `{file}` set in R3.
- **X-4**. Spec 012 handshake: confirm `launch_id` is the public
  correlation handle and lock the field in both schemas before 012
  begins implementation.
- **X-5**. Spec 012 cross-reference (E2): `ToolLaunch.completed_at` is
  written by spec 012's attribution/event-emission pass when the
  `workflow.run_completed` event fires. This spec's `ToolLaunch` table
  MUST include the `completed_at` nullable column; spec 012 owns its
  update logic.
- **X-6**. `tool_id` derivation: Settings UI and seed code MUST enforce
  the `[a-z0-9_]+` invariant. Reject identifiers with spaces or
  uppercase characters at profile load time (C2).

## Dependency Graph

```
T001 ─► T002 ─┐
T003 ─────────┤
T004 ─────────┤
T005 ─► T006 ─┤
              └─► T007 ─► T008 ─► T009 ─► T010 ─► T011 ─► T012 ─► T013
                                                                  │
T014 (needs T005, T006) ─► T015 ─► T016 ─► T017 ─► T018           │
                                                                  │
T019 (needs T007) ─► T020 ─► T021 ─► T022                         │
                                                                  ▼
                                                            X-2 / X-3 / X-4
```

## Out of Scope

- Custom user-defined tool profiles (deferred; needs a tightened
  args-template grammar).
- Watching the tool process for exit / completion (spec 012 will pick
  this up via artifact observation, not PID polling).
- Auto-creating a project source-view folder when one is missing (owned
  by specs 017 / 026).
- Multi-version handling of the same tool (open question O1).
- Proactively removing macOS quarantine attributes (user responsibility;
  notification surfaced on detection — see R5 in research.md).
