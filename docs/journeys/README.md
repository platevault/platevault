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
(regenerate with `journeys.py index`, never hand-edit). This file is the
per-project configuration — frontmatter holds the settings, the sections
below hold the guidance agents need to run journeys here.

Findings filed to GitHub also carry the matching `journey-<n>` label
(existing taxonomy: `journey-1` … `journey-17` correspond to J01…J17).

Two product rules cut across nearly every journey and are stated once here
instead of being repeated per journey:

- **Reviewable filesystem mutation.** Every move, copy, archive, or delete is
  proposed as a plan first; only approving and applying a plan mutates files,
  and every applied action gets an audit record.
- **Every action answers back.** Each mutating step names its success signal
  (toast, navigation, visible state change) and its failure signal (refusal
  reason, per-item error) — a badge changing somewhere else is not sufficient
  evidence of a completed step.

## Interface profiles

### desktop-ui
- kind: desktop-mcp
- exclusive: true

PlateVault ships as a Tauri v2 desktop app; the only real-app validation path
today is the Windows build driven through the Tauri MCP bridge from WSL
(`driver_session host=localhost port=9223`, mirrored WSL networking reaches
Windows services via `localhost`). `exclusive: true` because only one
validator can hold the Windows checkout/app process at a time. The
Vite/mockIPC runtime fakes backend responses and MUST NOT be used to
validate journeys (see `docs/development/testing.md`).

Launch/reset mechanics (full detail in `docs/development/windows-journeys/`
per-journey docs):
- Deploy on the Windows checkout (`C:\dev\astro-plan`), not WSL:
  `git fetch origin` then `git reset --hard origin/main` as its own command.
- **Recompile trap:** `git reset --hard` restores content but keeps old
  mtimes, so cargo skips rebuilding and the app silently runs a stale
  binary — touch changed `.rs` files to force a recompile before relaunch.
  Frontend-only changes just need a hard refresh.
- **Reset to fresh first-run:** delete `wizard-test.db*` in the Windows
  checkout root; clearing `localStorage` alone is not a reset (causes a
  `/`↔`/setup` redirect loop) — the DB is first-run source of truth.
- **Launch:** `run-dev.bat` in the Windows checkout (`run-dev-mcp.bat` when
  driving through the bridge), detached via
  `powershell.exe -NoProfile -Command "Start-Process ..."`; app process is
  `desktop_shell.exe`, Vite on `localhost:5173`, real backend
  (`VITE_USE_MOCKS=false`).
- **Driving quirks:** 2s JS eval timeout (avoid zombie loops), navigate in
  two steps (nav then probe), NEVER send modifier-key combos (renderer
  freeze). Recovery: kill `desktop_shell`, relaunch `run-dev-mcp.bat`.
- Native OS pickers (folder choosers, etc.) cannot be driven by the bridge;
  relaunch with `VITE_E2E=1` to expose `data-testid` stand-in inputs/buttons
  for those steps.
- Prefer `webview_execute_js` invoking `window.__TAURI__.core.invoke(...)`
  for direct backend calls; `ipc_execute_command` rejects many real commands
  but is useful for scripted backend probes. Backend-only IPC probes are not
  a substitute for UI-level Expects — anything visually/interactively
  observable must be validated in the real webview, not IPC-only. Validators
  announce when a check is backend-only IPC and classify findings
  backend-vs-UI.
- **State leakage prevention:** validation runs only against the Windows
  checkout's dev database and `tempfile`-style scratch folders — never
  against real user libraries; this repo checkout is never the app's working
  directory, so no fixture can land in it.

Pointers: `docs/development/windows-journeys/` (per-journey Windows
validation docs with exact click sequences and troubleshooting) and
`.claude/rules/50-tauri-mcp.md` (Tauri MCP driving surface, points into the
`mcp-tauri` APM context doc).

## Surface map

Maps changed file paths to journey `surfaces:` names for changed-only
validation. Agent judgment bridges anything unmapped.

| path glob | surfaces |
|---|---|
| `apps/desktop/src/features/setup/**` | setup |
| `apps/desktop/src/features/settings/**` | settings, equipment, observing-sites |
| `apps/desktop/src/app/**` | shell, activity |
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
trust the repo over this table and propose corrections. Only surfaces used
by migrated journeys are authoritative; names for not-yet-migrated areas
are proposals for `journey-write` to confirm.)

## Intent-evidence sources

Where an agent should look for proof that a behavior change was intentional
(amendment gating, see FORMAT.md), in this repo's actual conventions:

- Merged PRs (`gh pr list --state merged`, `gh pr view <n>`).
- `specs/NNN-*/` SpecKit feature artifacts (spec.md, plan.md, tasks.md).
- Grilling decision docs under `docs/product/`.
- `docs/development/*handover*` and orchestration/campaign logs under
  `docs/development/`.
- `CHANGELOG.md` and commit messages on `main`.

A "refactor"/"cleanup" commit is NOT intent evidence for a behavior change.

## Notes

Legacy journey history (pre-migration) lives under
`docs/product/journeys/JNN-slug/` — baseline narratives plus per-task
`deltas/*.md`, and the pre-format Wave-0 rerun sheets
(`wave0-rerun-plan.md`, `wave0-task-index.md`). Those files are frozen;
this directory is where current truth now lives for migrated journeys. Not
every journey has been migrated yet — check `INDEX.md` here first, fall
back to `docs/product/user-journeys.md` for anything not yet migrated.

Cross-cutting validator rules (user-mandated):

- Layout invariant: action bars/headers always visible, only content
  scrolls; verify at 1100×720.
- Reveal-control labels are OS-native ("Show in File Explorer" on Windows).
- Every campaign wave ships per-journey delta docs — Δ entries + run files
  satisfy this rule going forward.
