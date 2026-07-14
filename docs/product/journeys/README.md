---
config: user-journeys/1
reporter: github-issues
reporter_labels: [bug, phase:build]
fix_loop: dispatch-coder
fix_loop_max_iterations: 3
runs_keep: 20
---

# User journeys

End-to-end user journeys for PlateVault: what a user does, what they must
observe, validated against the running product. `FORMAT.md` is the spec for
every file in this directory; `INDEX.md` is the generated routing table
(regenerate with `python3 docs/product/journeys/journeys.py index
docs/product/journeys`, never hand-edit). This file is the per-project
configuration.

Findings filed to GitHub also carry the matching `journey-<n>` label
(existing taxonomy: `journey-1` … `journey-17` correspond to J01…J17).

Legacy artifacts kept in this directory: `wave0-rerun-plan.md` and
`wave0-task-index.md` (the pre-format Wave-0 rerun sheets) and each
journey's `deltas/` folder — historical evidence only, superseded by the
FORMAT journey bodies and Δ logs.

## Interface profiles

### windows-desktop
- kind: desktop-mcp
- exclusive: true

The real Tauri desktop app running on Windows, driven from WSL through the
Tauri MCP bridge (mirrored WSL → `127.0.0.1:9223` — WSL and Windows share
that port space). This is the only profile valid for journey validation:
the Vite/mockIPC runtime fakes backend responses and MUST NOT be used to
validate journeys (see `docs/development/testing.md`).

- Launch/reset from WSL via `powershell.exe` + the Windows checkout's
  `run-dev-mcp.bat` (never `cmd`/`start`). The Windows checkout is a
  SEPARATE clone — push here, pull there; after `git reset --hard`, `touch`
  a `.rs` file to force recompile (stale mtimes leave a stale binary).
- Wizard/db reset: wipe `wizard-test.db` — the DB is the first-run source
  of truth. WSL cannot enumerate Windows AppData.
- Driving quirks: 2s JS eval timeout (avoid zombie loops), navigate in two
  steps (nav then probe), NEVER send modifier-key combos (renderer freeze).
  Recovery: kill `desktop_shell`, relaunch `run-dev-mcp.bat`.
- Use `VITE_E2E` inputs where journeys need deterministic fixtures. Layer-2
  tauri-driver journeys live in `tests/e2e`; the manual click-scripts for
  each journey live in `docs/development/windows-journeys/`.
- State leakage prevention: validation runs only against the Windows
  checkout's dev database and `tempfile`-style scratch folders — never
  against real user libraries; this repo checkout is never the app's
  working directory, so no fixture can land in it.

## Surface map

Maps changed file paths to journey `surfaces:` names for changed-only
validation. Agent judgment bridges anything unmapped.

| path glob | surfaces |
|---|---|
| `apps/desktop/src/features/setup/**` | first-run-setup |
| `apps/desktop/src/features/settings/**` | settings |
| `apps/desktop/src/features/inbox/**` | inbox |
| `apps/desktop/src/features/sessions/**` | sessions |
| `apps/desktop/src/features/projects/**` | projects |
| `apps/desktop/src/features/targets/**` | targets |
| `apps/desktop/src/features/calibration/**` | calibration |
| `apps/desktop/src/features/cleanup/**` | cleanup |
| `apps/desktop/src/features/archive/**` | archive |
| `apps/desktop/src/features/audit/**` | audit |
| `crates/fs/planner/**` | plans |
| `crates/calibration/**` | calibration |
| `crates/targeting/**` | targets |
| `crates/audit/**` | audit |

(The `apps/desktop/src` feature layout is indicative — validators should
trust the repo over this table and propose corrections.)

## Intent-evidence sources

In priority order: merged PRs (`gh pr view`), `specs/<nnn>-*/spec.md` +
`tasks.md` (SpecKit is the product workflow), grilling decision docs under
`docs/product/`, commit messages on `main`, `docs/development/` handover
and campaign docs. A "refactor"/"cleanup" commit is NOT intent evidence for
a behavior change.

## Notes

- Backend-vs-UI protocol (user rule): validators announce when a check is
  backend-only IPC, classify findings backend-vs-UI, and use the real UI
  for anything visually validatable.
- Layout invariant: action bars/headers always visible, only content
  scrolls; verify at 1100×720.
- Reveal-control labels are OS-native ("Show in File Explorer" on Windows).
- Every campaign wave ships per-journey delta docs (Δ entries + run files
  satisfy this rule going forward).
