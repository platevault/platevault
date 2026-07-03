# Scenario template

Fill EVERY bracketed field from the actual diff. Delete guidance in _italics_.
The output is one markdown file the Windows computer-use agent executes top to
bottom. Keep the Windows agent's view in mind: it sees only this file + the app.

---

```markdown
# Windows validation — [change one-liner]

> For: Claude computer-use ("cowork") on the Windows machine running PlateVault.
> You have NO access to the source repo. Everything you need is in this document.
> Report each Test as PASS / FAIL with what you observed.

## Change facts (context — you do not act on this section)
- Spec / feature: [e.g. 006 inventory-library-lifecycle]
- Branch to test: `[branch]`
- Touches Rust backend? [yes/no]  ·  Frontend only? [yes/no]
- New/changed Tauri command(s): [`snake_command(args)` or "none"]
- Changed surfaces: [routes / components, e.g. /sessions, SessionDetail]
- What changed for the user (1–3 sentences): [...]

## Preconditions — get the app to the right state
_Copy only the steps that apply; pull exact commands from windows-mechanics.md._
1. Deploy the branch on the Windows checkout `C:\dev\astro-plan`:
   - `git fetch origin`
   - `git reset --hard origin/[branch]`   (run as its OWN command)
   - [IF Rust changed] Force rebuild (mtime trap): touch the changed `.rs`
     files, e.g. `Get-ChildItem [file].rs | ForEach-Object { $_.LastWriteTime = Get-Date }`
2. [IF a clean first-run is needed] Reset the DB:
   `Remove-Item 'C:\dev\astro-plan\wizard-test.db*' -Force`
3. Launch: run `run-dev.bat` via PowerShell `Start-Process` (see below). Wait for
   the window; app process is `desktop_shell.exe`, Vite on `localhost:5173`.
   - `powershell.exe -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/k','C:\dev\astro-plan\run-dev.bat' -WorkingDirectory 'C:\dev\astro-plan'"`
4. [IF backend data needed] Seed/prepare: [exact clicks or steps to reach the
   screen under test — e.g. add a library root, run a scan, open /sessions].
5. Sanity: the app renders (not a blank window). If blank → see Troubleshooting.

## Tests
_One block per changed behavior. Numbered clicks. Observable Expected. Explicit FAIL if._

### Test 1 — [behavior name]
Steps:
1. [Navigate / click, exact labels or testids]
2. [...]
Expected:
- [Exactly what appears / changes — text, enabled state, a window opening]
FAIL if:
- [The concrete wrong outcome — nothing happens, wrong text, error toast, crash]

### Test 2 — [behavior name]
...

## Troubleshooting
- Blank window (empty content): restart the dev server; if still blank, run
  `pnpm install` in `C:\dev\astro-plan` with `$env:CI="true"`, relaunch.
- A command "not found" / stale behavior after a Rust change: the binary is
  stale — confirm you touched the `.rs` files after reset so cargo rebuilt.

## Report back
For each Test: PASS / FAIL + one line of what you saw. On any FAIL, capture a
screenshot and the exact on-screen text / any toast.
```

---

## E2E-sync section (goes in YOUR handoff to the user, not the Windows file)

For each changed behavior, record:

- **[behavior]** — `manual` (why automation isn't feasible, e.g. native OS file
  browser) OR `automatable` → [Layer-2 `tauri-driver` journey to add: file +
  what it asserts] and the `coverage-matrix.md` row to add/update
  (`specs/037-e2e-integration-testing/contracts/coverage-matrix.md`).

State plainly if a behavior is manual-only so nobody assumes it's E2E-covered.
