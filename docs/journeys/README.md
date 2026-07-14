---
config: user-journeys/1
reporter: github-issues
reporter_labels: []
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
validator can hold the Windows checkout/app process at a time.

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
- **Launch:** `run-dev.bat` in the Windows checkout, detached via
  `powershell.exe -NoProfile -Command "Start-Process ..."`; app process is
  `desktop_shell.exe`, Vite on `localhost:5173`, real backend
  (`VITE_USE_MOCKS=false`).
- Native OS pickers (folder choosers, etc.) cannot be driven by the bridge;
  relaunch with `VITE_E2E=1` to expose `data-testid` stand-in inputs/buttons
  for those steps.
- Prefer `webview_execute_js` invoking `window.__TAURI__.core.invoke(...)`
  for direct backend calls; `ipc_execute_command` rejects many real commands
  but is useful for scripted backend probes. Backend-only IPC probes are not
  a substitute for UI-level Expects — anything visually/interactively
  observable must be validated in the real webview, not IPC-only.

Pointers: `docs/development/windows-journeys/` (per-journey Windows
validation docs with exact click sequences and troubleshooting) and
`.claude/rules/50-tauri-mcp.md` (Tauri MCP driving surface, points into the
`mcp-tauri` APM context doc).

## Surface map

| path glob | surfaces |
|---|---|
| `apps/desktop/src/features/setup/**` | setup, data-sources |
| `apps/desktop/src/features/calibration/**` | calibration |
| `crates/calibration/**` | calibration |
| `apps/desktop/src/features/inbox/**` | inbox-confirm |

## Intent-evidence sources

Where an agent should look for proof that a behavior change was intentional
(amendment gating, see FORMAT.md), in this repo's actual conventions:

- Merged PRs (`gh pr list --state merged`, `gh pr view <n>`).
- `specs/NNN-*/` SpecKit feature artifacts (spec.md, plan.md, tasks.md).
- `docs/development/*handover*` and orchestration/campaign logs under
  `docs/development/`.
- `CHANGELOG.md`.

## Notes

Legacy journey history (pre-migration) lives under
`docs/product/journeys/JNN-slug/` — baseline narratives plus per-task
`deltas/*.md`. Those files are frozen; this directory is where current truth
now lives for migrated journeys. Not every journey has been migrated yet —
check `INDEX.md` here first, fall back to `docs/product/user-journeys.md`
for anything not yet migrated.
