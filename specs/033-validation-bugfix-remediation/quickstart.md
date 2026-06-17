# Quickstart: Spec 033 — build, run, verify

How to build the app, run it against the real backend headless, and run each verification layer. This is
the developer-facing companion to the user-facing interactive runbook (`docs/development/runbook-033-interactive.md`).

## Gates (every change must keep these green)
```bash
just lint                       # cargo fmt --check + clippy -D warnings + desktop eslint + token guard + pre-commit
cargo test --workspace          # Rust unit/integration (in-memory SQLite)
just typecheck                  # TypeScript
cd apps/desktop && pnpm test    # vitest component tests
```

## Layer 1 — Rust unit/integration (strongest backend signal)
```bash
cargo test --workspace
# focused, e.g. the safety gate:
cargo test -p fs-executor
```

## Layer 2 — mocks UI smoke (frontend logic, fast)
```bash
VITE_USE_MOCKS=true pnpm --filter @astro-plan/desktop exec vite --host 127.0.0.1 --port 5180 --strictPort
# then drive with Playwright (apps/desktop/e2e mocks specs). Routing/render/forms only; data is fixtures.
cd apps/desktop && pnpm test:e2e
```

## Layer 3 — real-backend headless (the important one)
Real Tauri app, real SQLite IPC, offscreen via xvfb (webkit2gtk + tauri-driver + WebKitWebDriver installed):
```bash
xvfb-run -a -s "-screen 0 1400x900x24" pnpm --filter @astro-plan/desktop exec tauri dev --no-watch \
  --config '{"build":{"devUrl":"http://localhost:1420","beforeDevCommand":"VITE_USE_MOCKS=false pnpm --filter @astro-plan/desktop exec vite --port 1420 --strictPort"}}'
```
- Real DB: `~/.local/share/dev.astro-plan.astro-library-manager/alm.db` (delete to re-test first-run).
- Drive programmatically with `tauri-driver` + `WebKitWebDriver` (W3C WebDriver) for real-IPC assertions.
- This layer proves the background features actually fire (SC-003) and the core journey works on real data (SC-001).

## Layer 4 — Windows-native interactive (visible to the user)
The user runs the interactive runbook against the real window. Sync + launch (driven from WSL via `powershell.exe`):
```bash
git push origin main                                   # origin = nightwatch-astro/alm (sandbox disabled for network)
```
```powershell
# Windows mirror (C:\dev\astro-plan), native git:
git config --global --add safe.directory '*'
cd C:\dev\astro-plan
git stash push -m 'mirror mods'    # only if dirty
git fetch origin; git reset --hard origin/main
pnpm install; pnpm rebuild esbuild
# kill any WSL :5173 vite first (strictPort clash). Then launch detached so a window opens:
Start-Process cmd.exe -WindowStyle Hidden -WorkingDirectory C:\dev\astro-plan\apps\desktop `
  -ArgumentList '/c','set VITE_USE_MOCKS=false&& set CHOKIDAR_USEPOLLING=true&& pnpm tauri dev > C:\dev\astro-plan\tauri-dev.log 2>&1'
# verify: tauri-dev.log shows VITE ready + Running desktop_shell.exe; Get-Process desktop_shell; Invoke-WebRequest http://127.0.0.1:5173/ -> 200
```
Stop: `Get-Process desktop_shell,cargo | Stop-Process -Force`.

## Core journey to exercise (SC-001)
ingest a folder → sessions appear & group by root → split a mixed folder via inbox → calibration suggests
real master candidates → create a project → generate a reviewable plan → apply it safely (audited, no
escape, recoverable) → manifests/notes persist → cleanup over a protected source is blocked → Cmd+K finds a
real target.

## Verification artifacts (US9)
- `docs/development/test-strategy-033.md` — scenario catalog (per spec / per layer).
- `docs/development/runbook-033-interactive.md` — the manual Windows runbook (per-screen do-X/see-Y).
- `docs/development/traceability-033.md` — FR ↔ automated test ↔ runbook step matrix (zero-gap, FR-036).
