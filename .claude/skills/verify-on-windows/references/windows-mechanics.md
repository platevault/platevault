# Windows verification mechanics (PlateVault / astro-plan)

Canonical, tested steps for running and driving the real Tauri desktop app on
Windows. Source: project memory (`windows-dev-loop`, `spec-033-windows-verify-loop`,
`tauri-mcp-windows-verify-mechanics`, `vite-deps-reoptimize-blank-screen`) and
`docs/development/testing.md`. When you generate a scenario, copy the *relevant*
steps into it verbatim — the Windows agent has none of this context.

## Checkouts are separate

- WSL repo: `/home/sjors/dev/astro-plan` (where you edit/commit/push).
- Windows app checkout: `C:\dev\astro-plan` (= `/mnt/c/dev/astro-plan` from WSL).
- The app serves **from the Windows checkout**. Changes reach it only after
  **commit → push → `git reset --hard origin/<branch>` on Windows**. Frontend HMR
  and Rust both build from `C:\dev\astro-plan`.

## Launch (native Windows, never over /mnt/c)

Launch **detached** with `powershell.exe` (not `cmd /mnt/c` — nested-quote escaping
and a trailing-space-before-`&&` bug corrupt env vars). A `run-dev.bat` at repo
root holds, each on its own line (no `&&`):

```
cd /d C:\dev\astro-plan
set ALM_DB_URL=sqlite://C:\dev\astro-plan\wizard-test.db?mode=rwc
cargo tauri dev
```

Launch: `powershell.exe -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/k','C:\dev\astro-plan\run-dev.bat' -WorkingDirectory 'C:\dev\astro-plan'"`

- App process = `desktop_shell.exe`; Vite on `localhost:5173`.
- `.env` has `VITE_USE_MOCKS=false` (real backend).
- Kill: `Get-Process desktop_shell,cargo | Stop-Process -Force`.

## Reset to a clean first-run

The **DB is the first-run source of truth** (clearing localStorage alone causes a
`/`↔`/setup` redirect loop / navigation-throttle hang). Reset = fresh DB:

```
Remove-Item 'C:\dev\astro-plan\wizard-test.db*' -Force
```

then relaunch. (`ALM_DB_URL` overrides the default `%APPDATA%\dev.astro-plan.astro-library-manager\alm.db`;
WSL often can't enumerate Windows AppData — verify with PowerShell `Test-Path`.)

## Deploy a branch + the RECOMPILE TRAP

```
cd C:\dev\astro-plan
git fetch origin
git reset --hard origin/<branch>     # run as its OWN command (a guard rejects it bundled with other git)
```

- **`git reset --hard` restores file content but leaves an OLD mtime**, so cargo
  thinks the binary is newer and **skips recompiling** — the app stays stale
  (symptom: a command that IS in the code returns "not found"). After reset,
  **touch changed `.rs` files** to force a rebuild:
  `Get-ChildItem <files>.rs | ForEach-Object { $_.LastWriteTime = Get-Date }`,
  then relaunch (`cargo tauri dev` recompiles). Verify binary mtime > source mtime.
- **Frontend-only change**: a hard refresh (Ctrl+R) suffices — Vite serves from
  disk on full reload. Rust changes REQUIRE the cargo-tauri-dev relaunch.
- `pnpm install` alone does NOT recompile Rust; only `cargo tauri dev` does.

## Blank screen (empty #root) recovery

Two Vite/pnpm causes: (1) a mid-session `pnpm install` re-optimized deps → stale
import graph → restart the dev server; (2) cold Vite start hits the
`@rollup/rollup-win32-x64-msvc` optional-native bug → `pnpm install` in the
Windows checkout with `$env:CI="true"`, then relaunch.

## Driving the app programmatically (Tauri MCP bridge) — optional

For an agent that can reach the bridge (vs. pure screen/vision computer-use):

- Launch with the dev overlay so `withGlobalTauri` + the bridge are on:
  `cargo tauri dev --config src-tauri\tauri.dev.conf.json` (bridge is
  `#[cfg(debug_assertions)]`, WS on `0.0.0.0:9223`).
- Connect over WSL↔Windows NAT: `driver_session host=<gateway> port=9223`, where
  `gateway = ip route show default | awk '{print $3}'` (e.g. 172.23.112.1).
  Firewall already allows 9223.
- **Invoke a command directly** (bridge rejects many via `ipc_execute_command`):
  `webview_execute_js` → `window.__TAURI__.core.invoke('<snake_command>', {args})`.
- **Native folder pickers can't be driven**: launch with `VITE_E2E=1` to expose
  `data-testid="e2e-path-input-<kind>"` / `e2e-add-path-btn-<kind>`
  (kinds: light_frames, calibration, project, inbox). Set the React-controlled
  input via the native value setter + dispatch `input`, then click the button in a
  **separate** call so React state commits.
- Throwaway DB read-only from WSL: python `sqlite3` `file:...?mode=ro&immutable=1`;
  base64-encode output (grep/tool output otherwise mangles string literals).

## Automated E2E (Layer 2) — the tool the scenario must stay in sync with

- `just test-e2e` runs the built app through its real UI → real IPC → real backend
  via `tauri-driver` (smoke journeys; required on Windows + Linux). Layer-1
  (`just test-integration` = `cargo test --workspace`) is real backend + real
  SQLite, no UI.
- New features MUST ship real-stack coverage and update the mapping in
  `specs/037-e2e-integration-testing/contracts/coverage-matrix.md`.
- WSL has no webview, so the tauri-driver IPC run is validated on Windows / CI
  Stage B — not in a WSL headless run. (WSL Playwright under `tests/e2e/` is for
  mocks-backed render smoke only; the Playwright **MCP** browser can't reach
  WSL-bound servers.)

## Pushing workflow files

Pushing `.github/workflows/*` over HTTPS fails ("OAuth App without workflow
scope") — push via SSH (`git push git@github.com:...`).
