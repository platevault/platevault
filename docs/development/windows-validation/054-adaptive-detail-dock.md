# Windows validation — adaptive detail-panel dock (spec 054)

> For: Claude computer-use ("cowork") on the Windows machine running PlateVault.
> You have NO access to the source repo. Everything you need is in this document.
> Report each Test as PASS / FAIL with what you observed.
> Tracks issue #1008 (real-app validation follow-up from PR #1007/#1003).
> Supersedes the 2026-07-19 version of this file (written for #1069's spec
> reconciliation, before PR #1070 and PR #1072 merged — see "What changed
> since the last version" below).

## Change facts (context — you do not act on this section)

- Spec / feature: 054 adaptive detail-panel dock. Shipped via PR #1003 (core
  mechanism), #1035 (Target detail scroll fix, #816), #1070 (3-state
  Auto/Bottom/Right control, #1066), #1072 (DetailPanel migration for
  Archive/Projects/Targets, #1067). **Note: the GitHub issue #1008 that asked
  for this scenario cites PR #1007 as the shipped implementation — that PR was
  actually closed as superseded and never merged.** Everything below describes
  what is really on `main` (`specs/054-adaptive-detail-dock/spec.md` has the
  full reconciliation if you ever need to check further, but you don't need it
  to run this script).
- Branch to test: `main`
- Touches Rust backend? **no** — frontend-only. Placement/width persist via a
  typed `detailDock` preference that is itself backed by the browser's
  `localStorage` (not a Tauri command, not the SQLite database).
- New/changed Tauri commands: none.
- Changed surfaces: every list page — Sessions, Calibration, Inbox, Archive,
  Targets, Projects — via the shared `ListPageLayout` component.
- What changed for the user: the detail panel docks to the **RIGHT (side)**
  when the window is wide (≥1400px logical width by default) and to the
  **BOTTOM** when narrow. A 3-way **Auto / Bottom / Right** control in the
  panel's header lets the user pin a placement per page (or return to
  automatic), and the side panel is drag-resizable. Inbox behaves exactly the
  same as every other page — there is **no** permanent split layout for it (a
  permanent-split design existed on paper but the owner decided against
  building it, #1068, now closed/settled — not an open question anymore).

### What changed since the last version of this file
The previous version of this doc (written 2026-07-19 for #1069) documented two
things as NOT yet shipped that have since shipped:
- The placement control was a 2-state toggle (side⇄bottom only, no way back to
  automatic) — **now a 3-state Auto/Bottom/Right control** (#1066 closed, PR
  #1070 merged). Test 2 below is rewritten for this.
- Archive/Projects/Targets hand-rolled their own detail markup instead of the
  shared `DetailPanel` container — **now fully migrated**, all six pages use
  the same container (#1067 closed, PR #1072 merged).
Both are reflected in the tests below; if you observe the OLD 2-state-toggle
behavior or a hand-rolled Archive/Projects/Targets detail panel, that is a
**regression**, not the current expected state.

## Preconditions — get the app to the right state

1. Deploy `main` on the Windows checkout `C:\dev\astro-plan`:
   - `git fetch origin`
   - `git reset --hard origin/main`   (run as its OWN command)
   - **Force rebuild (mtime trap)** — `git reset --hard` restores content
     with an old mtime so cargo/vite may skip recompiling and the app stays
     stale. This feature is frontend-only, but touch the changed files
     anyway to be safe:
     ```powershell
     Get-ChildItem 'C:\dev\astro-plan\apps\desktop\src\ui\useAdaptiveDock.ts','C:\dev\astro-plan\apps\desktop\src\ui\ResizeHandle.tsx','C:\dev\astro-plan\apps\desktop\src\components\ListPageLayout.tsx','C:\dev\astro-plan\apps\desktop\src\components\DetailDockPlacementControl.tsx','C:\dev\astro-plan\apps\desktop\src\components\DetailPanel.tsx' | ForEach-Object { $_.LastWriteTime = Get-Date }
     ```
2. A clean first-run is NOT required (these are existing pages). If the app
   is stuck on the setup wizard, reset the DB and relaunch:
   `Remove-Item 'C:\dev\astro-plan\wizard-test.db*' -Force`
3. Launch:
   ```powershell
   powershell.exe -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/k','C:\dev\astro-plan\run-dev.bat' -WorkingDirectory 'C:\dev\astro-plan'"
   ```
   Wait for the window (process `desktop_shell.exe`, Vite on `localhost:5173`).
4. Prepare data: you need at least a few rows on Sessions or Calibration and
   one Inbox item with several files attached (so its file list is long enough
   to require scrolling), so a detail panel can open with substantial content.
   If the library is empty, add a light-frames root in Settings › Data Sources
   and run a scan. If data already exists, skip.
5. Sanity: the app renders a real page (not a blank window). If blank → see
   Troubleshooting.

## Tests

### Test 1 — Placement flips side ⇄ bottom with window width (5 pages)
Steps:
1. On each of **Sessions, Calibration, Archive, Projects, and Targets** in
   turn: select a row so the detail panel appears.
2. Make the window **wide** — maximize it, or resize to well over 1400px
   across.
3. Observe where the detail panel sits.
4. Now **narrow** the window by dragging its edge until it is clearly narrow
   (roughly half-screen, under ~1400px across — try ~1100px, the shell's
   documented minimum).
5. Observe again. Repeat for the next page.
Expected (all 5 pages, same behavior):
- Wide (≥ ~1400px): the detail panel sits to the **RIGHT** of the table
  (side-by-side), full height, with a vertical drag handle on its left edge.
- Narrow (< ~1400px): the detail panel moves to the **BOTTOM**, under a
  full-width table, and the drag handle disappears.
- The flip happens at the same ~1400px width on every page (none of these
  five pages uses a different threshold). The selected row/detail content
  survives the flip — it does not reset or close.
FAIL if:
- The panel stays bottom-docked at full width, or stays side-docked when
  narrow, on any of the five pages; the flip happens at a visibly different
  width on one page vs. another; it oscillates rapidly at a steady width; or
  the table/panel visibly overlap.

### Test 2 — Auto / Bottom / Right placement control, per-page independence, persists across restart
Steps:
1. On **Calibration**, select a row so the detail panel shows, with the
   window **wide** (so it's currently side-docked via Auto).
2. In the detail panel's header, find a 3-icon control (a wand/magic-wand
   icon, a bottom-panel icon, and a right-panel icon — hover each for its
   name: "Auto", "Bottom", "Right").
3. Click **"Bottom"**. Observe the panel move to the bottom, even though the
   window is still wide.
4. Click **"Right"**. Observe the panel move back to the side, even though
   nothing about the window changed.
5. Click **"Auto"**. Now resize the window narrow, then wide again — confirm
   the panel now follows the width rule again (bottom when narrow, side when
   wide), proving "Auto" actually cleared the pin rather than just relabeling
   the last state.
6. Go to a DIFFERENT page (e.g. **Sessions**) and confirm its own control
   still reads whatever state it was in before (independent of what you just
   did on Calibration).
7. Back on Calibration, click **"Bottom"** to pin it, then fully close the
   app (`Get-Process desktop_shell,cargo | Stop-Process -Force`) and relaunch
   via the Precondition step 3 command. Return to Calibration and reselect
   the same (or any) row.
Expected:
- Each of the three control options changes the placement immediately and
  visibly, independent of window width, except "Auto" which resumes the
  width-based rule.
- Sessions' control state is unaffected by whatever you set on Calibration.
- After restart, Calibration is still pinned to **Bottom** — the pin survived
  the app restart.
FAIL if:
- Only two states are selectable (no working "Auto" that resumes width-based
  behavior) — this would be a reversion of the #1066 fix.
- Setting a pin on one page changes another page's placement.
- The pin does not survive a full app restart.

### Test 3 — Drag-resizable side split, width persists
Steps:
1. On any list page with a wide window and the panel **side-docked** (pin to
   "Right" if needed), find the vertical drag handle on the boundary between
   the table and the detail panel (cursor becomes a left-right resize arrow
   when hovering it).
2. Drag it left and right. Observe the panel width change smoothly (no jumps
   or lag).
3. Drag it as far as it will go in each direction.
4. Restart the app (as in Test 2 step 7) and return to the same page with the
   panel side-docked.
Expected:
- Dragging resizes the side panel smoothly; the table reflows to fit.
- The width is **clamped** — it will not shrink below a usable minimum
  (~320px) nor grow past about half the window's width.
- After restart, the panel returns to your dragged width, not the ~420px
  default.
FAIL if:
- No draggable handle exists; dragging is jerky/laggy or does nothing; the
  panel can be dragged to zero / off-screen / past half the window; or the
  width resets to default on restart.

### Test 4 — Target detail content stays reachable in both placements (#816 scroll containment)
Steps:
1. Open a **Target**'s detail on the Targets page — pick one with several
   sections of detail (aliases, notes, coverage, links) if available; if not,
   add a couple of aliases and a notes entry to one target first so there's
   enough content to require scrolling.
2. With the panel **side-docked** (pin to "Right"), scroll the detail panel
   downward. Confirm you can reach and read the aliases list, the "add alias"
   control, the display-label section, the notes section (and save a note),
   and the panel's own close (✕) affordance at the very bottom/top of the
   header.
3. Pin to **"Bottom"** and repeat the same scroll-to-the-end check.
4. Also try this at a real narrow AND real short window (drag the OS window
   down to roughly 1100×720) in both placements.
Expected:
- All lower content is reachable by scrolling **within the panel** (one
  scrollbar, not two nested ones), in both placements and at the smaller
  window size — no content is cut off below the visible panel edge.
FAIL if:
- Any content (aliases, notes, display-label, or the close affordance) is
  cut off and cannot be reached by scrolling in either placement or at the
  smaller window size, or two nested scrollbars appear.

### Test 5 — Inbox: same mechanism as other pages, and its file list stays fully visible (#553)
Steps:
1. Go to **Inbox** with at least one item that has several files attached.
   Select it so the detail panel shows.
2. Repeat Test 1's resize (wide → narrow) on this page.
3. With the panel open (either placement), find the files/metadata list in
   the detail body. Scroll the panel down until you can see every file in
   that list, including the last one.
Expected:
- Step 2: Inbox behaves **identically** to Sessions/Calibration/Archive/
  Targets/Projects — side dock when wide, bottom dock when narrow. There is
  **no** permanent left-list/right-detail split, and no behavior different
  from the other pages.
- Step 3: every file in the list is reachable by scrolling inside the panel —
  none of it is cut off below the window's bottom edge in either placement.
FAIL if:
- Inbox does something visibly different from the other pages in step 2
  (flag it — a permanent-split design was considered but the owner decided
  against building it, so this would be an unexpected reversal, not the
  shipped state).
- Any file in the list is unreachable / cut off below the viewport in step 3
  in either placement — this would be a regression of the #553 fix.

### Test 6 — Keyboard navigation is identical in both placements
Steps:
1. On any list page (e.g. Sessions), open a detail panel pinned to **"Right"**.
   Press **Tab** repeatedly from the row you selected and confirm focus can
   reach controls inside the detail panel (e.g. the Auto/Bottom/Right control,
   an editable field, the close button).
2. Press **Escape**. Confirm the panel closes.
3. Reopen the same row, pin to **"Bottom"**, and repeat steps 1–2 (Tab reaches
   the same set of controls, Escape closes the panel).
Expected:
- Tab order reaches the same controls in the same relative order in both
  placements; Escape closes the panel in both placements, with no visible
  difference in behavior between side and bottom.
FAIL if:
- Tab skips controls in one placement that were reachable in the other, or
  Escape fails to close the panel in either placement.

## Troubleshooting
- Blank window (empty content): restart the dev server; if still blank, run
  `pnpm install` in `C:\dev\astro-plan` with `$env:CI="true"`, relaunch.
- Stale behavior after the reset: confirm you touched the changed files
  after `git reset --hard` (mtime trap). A hard refresh (Ctrl+R) reloads the
  latest Vite bundle for this frontend-only feature.
- Placement seems stuck: this feature persists state in browser
  `localStorage`, not the dev database — `wizard-test.db` resets do not
  clear it. To force a clean placement/width state, clear `localStorage` for
  the app's origin (DevTools → Application → Local Storage) or look for keys
  related to `detailDock`.
- If you see only a 2-state toggle (no "Auto") on any page, or Archive/
  Projects/Targets look like they're using a visibly different detail-panel
  container than Sessions/Calibration/Inbox, that is a regression — report it
  rather than assuming your checkout is stale (re-confirm the mtime touch
  first, but if a full relaunch still shows it, it's real).

## Report back
For each Test 1–6: PASS / FAIL + one line of what you saw. On any FAIL,
capture a screenshot and the exact on-screen text / any toast. Note the
approximate window width at which placement flips in Test 1.

**This scenario is documentation only.** Running it against the real Windows
app is a separate step for whoever owns the Tauri-MCP / computer-use lane —
issue #1008 stays open until that run happens and its results are reported
back on the issue.

## E2E-sync (coverage bookkeeping)

- **Tests 1, 2, 5 (placement flip, pin/Auto control, Inbox parity)** are
  `automatable` in principle and already have PARTIAL Layer-2/mock coverage:
  `tests/e2e/adaptive_detail_dock.spec.ts` (Playwright, mock mode) proves the
  side/bottom flip and pin-persists-across-**reload** (not a real app
  restart), but only against the Calibration page — Sessions, Archive,
  Projects, Targets, and Inbox are not exercised there. A follow-up Layer-2
  `tauri-driver` journey extending this to the other five pages, and to the
  3-state Auto/Bottom/Right control specifically (only the 2-state
  side/bottom toggle predates this file's rewrite; the mock spec was not
  re-audited here for whether it already covers "Auto" — worth checking
  before adding a duplicate), would close that gap. This document is the only
  current proof of a REAL window resize / REAL app-restart persistence for
  any of it.
- **Tests 3, 4, 6 (drag-resize pixel behavior, Target-detail scroll
  containment, real keyboard/Tab order)** are effectively `manual`: real
  pointer-drag smoothness and real Tab-order/focus behavior are not
  meaningfully provable through a mocked DOM the way a real OS-level
  interaction is. This document remains their only verification lane.
- This feature has **no new Tauri command / backend contract** (frontend-only,
  `localStorage`-backed), so no row was added to
  `specs/037-e2e-integration-testing/contracts/coverage-matrix.md` — that
  file's matrix is organized by backend feature area with L1 (real-backend)/L2
  (smoke-journey) columns, and spec 054 doesn't introduce one. Adding a
  "real-app-validation-pending" bookkeeping row there would be a new,
  differently-shaped column this file doesn't have, and another PR is
  actively editing that same file for unrelated issues (#1234/#1235/#1228)
  right now — deferring that structural question rather than forcing an
  ill-fitting edit into a file under active concurrent change.
