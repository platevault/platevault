# Implementation Plan: Processing Tool Launch

**Branch**: `011-processing-tool-launch` | **Date**: 2026-05-20 | **Spec**:
[spec.md](./spec.md)

## Summary

Replace the mockup `Open in {tool}` button's no-op handler with a real launch
pipeline: Settings owns the per-tool executable path; `crates/workflow/
profiles/` owns per-tool launch profiles (display name, args template,
capability flags); `crates/app/core/usecases/tool_launch.rs` resolves a
project + tool pair into a concrete `Command`, spawns the detached child,
records a `ToolLaunch` row, and emits a `tool_launch` audit event. The CTA
remains visually identical to the mockup; the wiring is new.

## Constitution Check

- **I. Local-First File Custody**: Launch never copies, moves, or hashes
  user images. It reads a precomputed source-view folder path (owned by
  specs 017 / 026) and passes it to the tool. Library roots and relative
  paths are reused via existing inventory APIs.
- **II. Reviewable Filesystem Mutation**: Launch is not a filesystem
  mutation; no plan is required. The audit envelope still records the
  attempt for traceability, and failure modes do not write files.
- **III. PixInsight Boundary**: The use case spawns the tool and walks
  away. The app does not script PixInsight, watch its menus, or interpret
  in-tool state. Artifact observation is spec 012 and is decoupled from the
  launch process via the `launch_id` handle.
- **IV. Research-Led Domain Modeling**: Supported tool list, path
  discovery heuristics, argument templates, and detach semantics are
  captured in `research.md` with explicit alternatives considered.
- **V. Portable Contracts and Durable Records**: Two JSON Schema contracts
  (`tool.launch`, `tool.profile.list`) define the boundary; Tauri is the
  first adapter. `ToolLaunch` is persisted in SQLite and survives app
  restart; `ToolProfile` is settings-backed.

## Architecture

### Layering

```
apps/desktop (Tauri + React)
  └─ features/projects/* (CTA: projectFooter / rowMenuGroupsForLifecycle)
       └─ tauri command: tool.launch / tool.profile.list
            └─ crates/app/core/usecases/tool_launch.rs
                 ├─ crates/workflow/profiles/        (ToolProfile + args template)
                 ├─ crates/persistence/db            (ToolLaunch row, settings read)
                 ├─ crates/project/structure         (resolve project root + source-view)
                 ├─ std::process::Command            (detached spawn)
                 └─ crates/audit                     (tool_launch event)
```

### Settings Layer (Tool Workflows section)

Settings owns:

- `toolProfiles[]` rows keyed by `tool_id` (`pixinsight`, `siril`,
  `planetary_suite`, plus user-added entries in a future spec).
- Per-tool `executable_path` (string, validated on save).
- Per-tool `enabled` flag (lets the user hide a tool from project CTAs
  without deleting the path).

The settings store is the canonical read source for the launch use case.
`crates/workflow/profiles/` owns the *static* parts (display name, args
template, capability flags) and is seeded for the three first-class tools.
Settings owns the *user-mutable* parts (executable path, enabled flag).

### Use Case Layer

`crates/app/core/src/usecases/tool_launch.rs`:

- `launch(ToolLaunchRequest) -> ToolLaunchResponse`:
  1. Load `Project` by id; reject with `project.not_found` if missing.
  2. Load `ToolProfile` by `tool_id`; reject with `tool.not_configured`
     when no profile exists or `enabled = false` or `executable_path` is
     empty.
  3. Validate `executable_path` resolves to an extant, executable file;
     reject with `tool.executable.not_found` otherwise.
  4. Resolve project working folder: prefer the project's generated
     source-view folder (read via `crates/project/structure`); fall back
     to the project root.
  5. Render the profile's `args_template` against the substitution
     vocabulary (`{folder}`, `{file}` — see research R3). Profiles
     declaring `supports_open_folder = false` skip the folder token and
     rely on `cwd`.
  6. Spawn a detached child process. On failure, return `launch.failed`
     with the OS error string normalised.
  7. Persist a `ToolLaunch` row with `launched_at`, `pid`, `project_id`,
     `tool_id`.
  8. Emit a `tool_launch` audit event referencing both the project and
     the new `launch_id`.
- `list_profiles(ToolProfileListRequest) -> ToolProfileListResponse`:
  thin read over `crates/workflow/profiles/` joined with settings.

The use case returns `launch_id` and `pid` (Option) so spec 012 can later
correlate artifacts back to a project. `pid` may be `None` on platforms
where the OS does not surface it before detach completes.

### Per-Platform Invocation

`crates/workflow/profiles/` exposes a `LaunchInvocation` builder:

- **Windows**: `Command::new(exe).args(rendered).current_dir(cwd)
  .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)`.
- **macOS**: For `.app` bundles, prefer `open -a "PixInsight" --args …
  --background` semantics via a small helper; for plain executables, use
  `Command::new(exe)` + `setsid`-style detach (`pre_exec` setsid on
  unix).
- **Linux**: `Command::new(exe).args(rendered).current_dir(cwd)`,
  detach with `setsid` via `pre_exec`. Optionally support `flatpak run`
  prefix when the profile declares it.

The detach implementation lives in `crates/workflow/profiles/launch.rs`
behind a platform `cfg` boundary; the use case is platform-agnostic.

### Crate Boundary Summary

- `crates/workflow/profiles/`: `ToolProfile`, `LaunchInvocation`,
  per-platform spawn helpers, args-template parser. Owns the seed list
  for PixInsight, Siril, Planetary Suite.
- `crates/persistence/db/`: `ToolLaunch` table, settings table extension
  for tool paths.
- `crates/app/core/`: orchestration use case + Tauri command adapter.
- `crates/audit/`: new `tool_launch` event kind.
- `apps/desktop/src/features/projects/`: replace the in-memory mock
  click handler with a `tool.launch` dispatch; resolve the right
  `tool_id` from the project's workflow binding.
- `apps/desktop/src/features/settings/`: add a "Tool Workflows" section
  that lists profiles and exposes path inputs + auto-detect button.

### UI Behaviour Deltas vs Mockup

- `projectFooter()` and `rowMenuGroupsForLifecycle()` keep their label
  output. The button becomes disabled when the resolved `ToolProfile` is
  missing or invalid; the tooltip explains why (`Tool path not
  configured`, `Tool executable missing`).
- Successful launch shows a toast with the tool name; failures show a
  toast with an inline "Configure path" or "Re-configure" link, depending
  on the error code.

## Phasing

### Phase 0 — Research (this spec)

- Supported tool list + paired tools (R1).
- Path discovery heuristics per OS (R2).
- Argument template grammar and tool-by-tool argument shape (R3).
- Detach + post-launch tracking model (R4).

### Phase 1 — Design

- Finalise `data-model.md` (`ToolProfile`, `ToolLaunch`,
  `WorkflowBinding` reference).
- Finalise contracts (`tool.launch`, `tool.profile.list`).
- Cross-check the audit event shape with spec 005.

### Phase 2 — Implementation (deferred, gated by review)

1. Seed `crates/workflow/profiles/` with PixInsight, Siril, Planetary
   Suite profiles.
2. Add `ToolLaunch` table + migration in `crates/persistence/db/`.
3. Implement `crates/app/core/usecases/tool_launch.rs` with fakes for the
   spawn boundary.
4. Generate Rust + TS DTOs from the two contracts.
5. Add Tauri commands and replace mockup click handlers with dispatches.
6. Wire the Settings → Tool Workflows section, including auto-detect.
7. Playwright smoke: launch each tool via a stub executable; assert
   `ToolLaunch` row exists and audit event fired.

## Cross-Spec Links

- **Spec 002 (Data Lifecycle State Model)**: launch never causes a
  lifecycle edge; this is enforced by the use case (no transition call).
- **Spec 009 (Project Lifecycle Model)**: `ready → processing` remains a
  separate user action; the CTA does not imply a transition.
- **Spec 012 (Processing Artifact Observation)**: consumes `launch_id`
  emitted here.
- **Spec 018 (Settings Configuration Model)**: owns the storage and UI
  pattern for the Tool Workflows section.
- **Spec 026 (Generated Project Source View Removal)**: defines the
  resolved source-view path that launch passes to the tool.

## Risks

- **Detach semantics drift across platforms**: getting "the tool keeps
  running after the app closes" right requires platform-specific code.
  Mitigation: isolate detach in one module with platform `cfg` blocks and
  cover it with `#[cfg(test)]` integration tests using a stub binary.
- **Path discovery false positives**: pre-filling the wrong PixInsight
  install path could be confusing. Mitigation: always mark
  auto-discovered values as "auto-detected" and require explicit Save.
- **Argument template injection**: if `args_template` is user-editable in
  a later spec, a hostile profile could substitute arbitrary tokens.
  Mitigation: this spec keeps profiles seeded and read-only from the UI;
  a future "custom tool" spec will tighten the grammar before exposing
  edits.
