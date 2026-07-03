# Worked example

Below is a complete scenario generated for a real change (spec-006: the Ignore
action + Reveal-in-OS on the Sessions page). It shows the expected output
quality — every fact the Windows agent needs is inline, every Test is observable,
and the E2E-sync section keeps manual and automated coverage honest.

The invoking agent produced this after reading its own diff. Two artifacts are
generated: the **scenario file** (handed to Windows cowork) and the **E2E-sync
notes** (kept for the PR).

---

## Artifact 1 — the scenario file

_Saved to `docs/development/windows-validation/006-ignore-reveal.md`._

```markdown
# Windows validation — Ignore a session + Reveal its folder in Explorer

> For: Claude computer-use ("cowork") on the Windows machine running PlateVault.
> You have NO access to the source repo. Everything you need is in this document.
> Report each Test as PASS / FAIL with what you observed.

## Change facts (context — you do not act on this section)
- Spec / feature: 006 inventory-library-lifecycle
- Branch to test: `006-inventory-reconcile`
- Touches Rust backend? yes (an enum was removed) · Frontend only? no
- Tauri commands exercised: `inventory_session_review` (Ignore) and
  `native_reveal` (Reveal in OS) — both pre-existing.
- Changed surfaces: the Sessions page (`/sessions`) and its detail panel.
- What changed for the user: a session now has an **Ignore** button (distinct
  from Reject) that hides it from the default list but keeps it recoverable, and
  a **Reveal in OS** button that opens the session's source folder in Windows
  Explorer. The old frame-type (light/dark/flat/bias) filter was removed.

## Preconditions
1. Deploy the branch on `C:\dev\astro-plan`:
   - `git fetch origin`
   - `git reset --hard origin/006-inventory-reconcile`   (own command)
   - Rust changed, so force a rebuild (mtime trap):
     `Get-ChildItem C:\dev\astro-plan\crates\app\core\src\inventory.rs,C:\dev\astro-plan\crates\contracts\core\src\inventory.rs | ForEach-Object { $_.LastWriteTime = Get-Date }`
2. Launch:
   `powershell.exe -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/k','C:\dev\astro-plan\run-dev.bat' -WorkingDirectory 'C:\dev\astro-plan'"`
   Wait for the window (process `desktop_shell.exe`; Vite on localhost:5173). It
   recompiles Rust on first launch — allow a few minutes.
3. Reach some sessions: click **Sessions** in the left nav. If the list is empty,
   add a library root that contains light-frame FITS files (Settings → Data
   sources → add a light-frames root) and run a scan, then return to Sessions.
   You need at least one session whose state shows **"Needs review"**.
4. Sanity: the Sessions list renders with rows (not a blank window).

## Tests

### Test 1 — Ignore hides a session from the default list
Steps:
1. On /sessions, click a row whose state is "Needs review". A detail panel opens
   at the bottom with action buttons in its header.
2. Note the session's target/name. Click the **Ignore** button.
Expected:
- A toast reads **"Session ignored."**
- The row disappears from the default list (ignored sessions are excluded by
  default).
FAIL if:
- There is no Ignore button, OR clicking it shows an error toast, OR the row
  stays in the default list, OR the app crashes / goes blank.

### Test 2 — Ignored session is recoverable via Cmd+K
Steps:
1. Press **Ctrl+K** to open the command palette.
2. Type "ignored", select **"Show ignored items"**.
3. Confirm the session from Test 1 is now listed. Click it, then click **Re-open review**.
Expected:
- The palette navigates to the Sessions page filtered to ignored items, and the
  Test-1 session appears there.
- After Re-open, it returns to the "Needs review" family and shows in the default
  list again.
FAIL if:
- "Show ignored items" is absent, OR the filtered view is empty / does not show
  the session, OR Re-open does not restore it.

### Test 3 — Reveal in OS opens the source folder
Steps:
1. Select any session. In the detail header, click **Reveal in OS**.
Expected:
- A **Windows Explorer** window opens at (or selecting) the session's source
  folder on disk.
FAIL if:
- No Explorer window opens, OR an error toast ("Could not open the location.")
  appears, OR it opens the wrong/parent path with nothing highlighted.

### Test 4 — No frame-type filter on Sessions
Steps:
1. Look at the Sessions toolbar (top of the list).
Expected:
- There is a **Review** filter and a search box, and **no** "Frame type"
  (light/dark/flat/bias) dropdown.
FAIL if:
- A frame-type dropdown is present.

## Troubleshooting
- Blank window: restart the dev server; if still blank, run `pnpm install` in
  `C:\dev\astro-plan` with `$env:CI="true"`, relaunch.
- Ignore/Reveal button missing or behaving like the old build: the binary is
  stale — confirm you touched the two `.rs` files after reset so cargo rebuilt.

## Report back
Per Test: PASS / FAIL + one line of what you saw. On FAIL, screenshot + exact
on-screen text / toast.
```

---

## Artifact 2 — E2E-sync notes (kept for the PR, not sent to Windows)

- **Ignore action** — `automatable`. Add a Layer-2 `tauri-driver` journey under
  `tests/e2e/` (or the repo's E2E dir): open /sessions → Ignore a needs-review
  session → assert it leaves the default list → open Cmd+K "Show ignored" →
  assert it appears → Re-open → assert it returns. Add a row to
  `specs/037-e2e-integration-testing/contracts/coverage-matrix.md` under the
  Sessions area. (Backend already covered by the `sessions_integration.rs`
  Layer-1 tests; the store dispatch is unit-covered.)
- **Cmd+K "Show ignored" route** — `automatable`; same journey as above covers it.
- **Frame-type filter removed** — `automatable`; a simple UI assertion (absence).
- **Reveal in OS** — `manual only`. `native_reveal` launches an external Explorer
  window; `tauri-driver` cannot assert an OS-level window. The command wiring is
  unit-tested (`revealInventory.test.ts` asserts the invoke + args), but the
  actual OS reveal must be validated by computer-use. Record it as manual so it is
  not assumed E2E-covered.
