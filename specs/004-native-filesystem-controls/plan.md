# Implementation Plan: Native Filesystem Controls

**Branch**: `004-native-filesystem-controls` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-native-filesystem-controls/spec.md`

## Summary

Replace the ad-hoc `@tauri-apps/plugin-dialog` dynamic import in
`AddFolderButton` (spec 003) and the toast-only "Open location" action
with three contract-driven Tauri operations:
`native.directory.pick`, `native.file.pick`, and `native.reveal`. The
directory and file pickers use `@tauri-apps/plugin-dialog`. Reveal-in-OS
uses `tauri-plugin-opener` (preferred for cross-platform per-file
reveal) with a hand-written fallback that calls `open -R` on macOS,
`explorer.exe /select,` on Windows, and a freedesktop `xdg-open` on the
containing directory on Linux when the desktop environment lacks
per-file reveal. Cancellation is a non-error null response. All three
operations are exposed as Tauri commands but described first by the
language-neutral JSON Schemas under `contracts/`.

## Technical Context

**Language/Version**: TypeScript 5.x (frontend) and Rust 1.75+ (Tauri core).  
**Primary Dependencies**: React 18, Tauri 2.x, `@tauri-apps/plugin-dialog`,
`tauri-plugin-opener` (with `@tauri-apps/api/shell` as documented
fallback for the Reveal action).  
**Storage**: None. All three operations are transient and stateless.
The audit log records failures via the existing `crates/audit/` sink.  
**Testing**: Vitest + React Testing Library for picker hooks, Playwright
MCP for end-to-end picker and reveal flows (where the OS dialog can be
intercepted), contract conformance tests under `tests/contract/`,
`cargo test` for the Rust command handlers and the Linux-DE fallback
logic.  
**Target Platform**: Desktop (Windows 10+, macOS 12+, Linux X11/Wayland)
via Tauri.  
**Project Type**: Desktop app — `apps/desktop/` + Rust crates.  
**Performance Goals**: Picker open latency ≤ 200ms p95; reveal command
dispatch ≤ 100ms p95 (the OS file browser launch time is excluded).  
**Constraints**: No follow-the-symlink behavior by default. No
filesystem mutation. Cancellation MUST NOT log at error level. Long
Windows paths and UNC paths MUST round-trip without corruption.  
**Scale/Scope**: Single-user, single-library. Each operation is a
single path. No batching in v1.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Local-first file custody**: PASS. All three operations preserve
  user-owned file location. The pickers return absolute paths; the
  reveal action only opens the OS file browser. No copy, move, or
  index of file content occurs.
- **Reviewable filesystem mutation**: PASS BY EXEMPTION. None of the
  operations mutate the filesystem. They are read-only picker and
  reveal actions and are explicitly out of scope for the
  reviewable-plan workflow owned by spec 025.
- **PixInsight boundary**: PASS. No image processing happens here.
- **Research-led domain modeling**: PASS. `research.md` records picker
  semantics, filter strategy, and Reveal-in-OS per-platform commands
  with explicit options-considered and recommended defaults.
- **Portable contracts and durable records**: PASS. Three JSON Schema
  contracts describe the surface, so a future remote backend can
  implement the same operations without binding to Tauri internals.
- **Cross-platform path safety**: PARTIAL. The plan handles Windows
  long paths, UNC, macOS `open -R`, and Linux DE variance. Symlink
  policy is constitutionally "do not follow unless explicit"; the
  pickers MUST surface what the user clicked even if it is a symlink,
  but they MUST NOT resolve it server-side. Open question: should the
  reveal action canonicalize through symlinks before launching the OS
  file browser? Recommended default is no (preserve the link target
  visible to the user); flagged in research §3.

Re-check after Phase 1 design: confirm the Linux DE matrix (GNOME,
KDE, XFCE, Cinnamon) is covered by the chosen `tauri-plugin-opener`
release.

## Project Structure

### Documentation (this feature)

```text
specs/004-native-filesystem-controls/
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   ├── native.directory.pick.json
│   ├── native.file.pick.json
│   └── native.reveal.json
├── spec.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/desktop/
├── src/
│   ├── shared/native/picker.ts             # NEW: directory + file picker hooks
│   ├── shared/native/reveal.ts             # NEW: reveal-in-OS hook
│   ├── features/setup/steps/StepRaw.tsx    # consumer: replaces ad-hoc dialog import
│   ├── features/setup/steps/StepCalibration.tsx  # consumer
│   ├── features/setup/steps/StepProject.tsx      # consumer
│   ├── features/setup/steps/StepInbox.tsx        # consumer
│   └── features/settings/DataSources.tsx   # consumer: settings add-source
├── src-tauri/
│   ├── Cargo.toml                          # adds tauri-plugin-opener
│   ├── capabilities/default.json           # adds dialog + opener allowlist
│   └── src/commands/native.rs              # NEW: tauri commands wiring contracts

crates/
├── app/core/                                # use-cases: pick_directory, pick_file, reveal_path
└── contracts/core/                          # Rust DTOs mirroring JSON contracts

packages/contracts/                          # JSON Schemas + generated TS types

tests/
├── contract/native_picker.rs                # NEW: schema conformance
├── contract/native_reveal.rs                # NEW: schema conformance
└── integration/reveal_in_os.spec.ts         # NEW: Playwright end-to-end
```

**Structure Decision**: Follow the existing Astro monorepo split. The
three operations are stateless and have no domain model, so they
live in `crates/app/core/` as thin use cases plus Tauri command
adapters in `apps/desktop/src-tauri/`. The frontend wraps them in two
hooks (`useDirectoryPicker`, `useFilePicker`, `useRevealInOs`) so
feature pages do not invoke `tauri.invoke` directly.

## Architecture Notes

### Picker Dispatch

Both pickers delegate to `@tauri-apps/plugin-dialog`'s `open()` with
different option sets:

- `pickDirectory({ defaultPath? })` → `open({ directory: true,
  multiple: false, defaultPath })`.
- `pickFile({ filters, defaultPath? })` → `open({ directory: false,
  multiple: false, defaultPath, filters })`.

The filters array for `pickFile` is constructed from the contract's
filter list. The combined `All supported` filter is the
`extensions: ["fit", "fits", "xisf", "tif", "tiff"]` entry and is the
first entry so it becomes the default.

A null return value from `plugin-dialog` indicates cancellation; the
hook returns `{ path: null, cancelled: true }` and does not throw.

### Reveal-In-OS Dispatch

`tauri-plugin-opener` exposes `revealItemInDir(path)` which on macOS
and Windows highlights the target file/folder; on Linux it falls back
to opening the containing directory. The Rust command wraps this and
catches:

- `path.not_exists` if the entry is missing.
- `os.command_failed` if the plugin returns an error from the
  underlying syscall.

If `tauri-plugin-opener` becomes unsuitable on any platform, the
fallback is a hand-rolled command using `@tauri-apps/api/shell` and
the per-platform commands documented in `research.md` §3.

### Contract Boundary

Every call from React goes through `tauri.invoke("native_directory_pick" |
"native_file_pick" | "native_reveal", payload)`. The payload is the
`request` half of the corresponding JSON Schema; the return value is
the `response` half. Errors are returned as a structured `{ code,
message }` matching the schema's error enum so the UI can render
contract-defined error copy.

### Audit Logging

`os.command_failed` and `path.not_exists` reveal errors emit an audit
event `native.reveal.failed` carrying `{ entity_kind?, entity_id?,
request_id }`. Raw path and path hash are NOT included in the audit
payload (A2: correlate via `entity_id` only; no PII in audit exports).
Cancellation is NOT logged. Picker permission denials emit
`native.picker.failed` with `{ picker_kind, error_code, request_id }`.

### Build-Flag Fallback

The browser-only fallback (`window.prompt` in `AddFolderButton`)
survives behind a build flag (`VITE_TAURI=false`) so component tests
and Storybook runs do not require a Tauri runtime. Production builds
MUST set `VITE_TAURI=true` and the fallback MUST throw if invoked.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations to justify. The feature reduces complexity by replacing
three ad-hoc surfaces (stub picker, toast reveal, no master picker)
with a single contract-driven set of operations.
