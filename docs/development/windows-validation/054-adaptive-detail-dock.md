# Windows validation — adaptive detail-panel dock (spec 054)

> For: Claude computer-use ("cowork") on the Windows machine running PlateVault.
> You have NO access to the source repo. Everything you need is in this document.
> Report each Test as PASS / FAIL with what you observed.
> Tracks issue #1069 (spec reconciliation). Shipped via PR #1003 (+ #1035, #1060).

## Change facts (context — you do not act on this section)

- Spec / feature: 054 adaptive detail-panel dock, reconciled 2026-07-19
  against what actually shipped (see `specs/054-adaptive-detail-dock/spec.md`
  for the full reconciliation — the feature was originally designed with a
  third "permanent split" placement and Targets-specific column pinning;
  **neither shipped**, so this script only covers the two placements that
  are actually on `main`).
- Branch to test: `main`
- Touches Rust backend? **no** — frontend-only (placement/width persist via
  browser `localStorage`, not a Tauri command or `AppPreferences`).
- New/changed Tauri commands: none.
- Changed surfaces: every list page — Sessions, Calibration, Inbox, Archive,
  Targets, Projects — via the shared `ListPageLayout` component.
- What changed for the user: the detail panel now docks to the **RIGHT
  (side)** when the window is wide and to the **BOTTOM** when narrow, with a
  per-page pin toggle that is remembered, and a drag-resizable side split.
  There is **no** three-way Auto/Bottom/Right control — only a single toggle
  button that flips between the two pinned states (see Test 2's known-bug
  note, #1066). Inbox behaves the same as every other page here; it does
  **not** get a permanent split layout (that was designed but never shipped
  — see #1068 for the open decision about whether it ever will).

## Preconditions — get the app to the right state

1. Deploy `main` on the Windows checkout `C:\dev\astro-plan`:
   - `git fetch origin`
   - `git reset --hard origin/main`   (run as its OWN command)
   - **Force rebuild (mtime trap)** — `git reset --hard` restores content
     with an old mtime so cargo/vite may skip recompiling and the app stays
     stale. This feature is frontend-only, but touch the changed files
     anyway to be safe:
     ```powershell
     Get-ChildItem 'C:\dev\astro-plan\apps\desktop\src\ui\useAdaptiveDock.ts','C:\dev\astro-plan\apps\desktop\src\components\ListPageLayout.tsx' | ForEach-Object { $_.LastWriteTime = Get-Date }
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
   one Inbox item, so a detail panel can open. If the library is empty, add a
   light-frames root in Settings › Data Sources and run a scan. If data
   already exists, skip.
5. Sanity: the app renders a real page (not a blank window). If blank → see
   Troubleshooting.

## Tests

### Test 1 — Placement flips side ⇄ bottom with window width
Steps:
1. Go to **Sessions** (or Calibration/Archive/Targets/Projects) and select a
   row so the detail panel appears.
2. Make the window **wide** — maximize it, or resize to well over 1400px
   across.
3. Observe where the detail panel sits.
4. Now **narrow** the window by dragging its edge until it is clearly narrow
   (roughly half-screen, under ~1400px across — try ~1100px).
5. Observe again.
Expected:
- Wide (≥ ~1400px): the detail panel sits to the **RIGHT** of the table
  (side-by-side), full height, with a vertical drag handle on its left edge.
- Narrow (< ~1400px): the detail panel moves to the **BOTTOM**, under a
  full-width table, and the drag handle disappears.
- The flip happens as you cross ~1400px; it should not flicker while you
  hold a steady width near that boundary.
FAIL if:
- The panel stays bottom-docked at full width, or stays side-docked when
  narrow; or it oscillates rapidly at a steady width; or the table/panel
  visibly overlap.

### Test 2 — Placement pin toggle persists across restart (note: no "Auto" — #1066)
Steps:
1. On **Calibration** (or any list page), select a row so the detail panel
   shows, with the window **wide** (side-docked).
2. Find the small pin/toggle button in the detail panel's header bar (an
   arrow icon — right-pointing when bottom-docked, down-pointing when
   side-docked).
3. Click it. Observe the placement flip.
4. Click it again. Observe it flip back.
5. Leave it pinned to one state (e.g. click until it reads bottom-docked).
   Fully close the app (`Get-Process desktop_shell,cargo | Stop-Process
   -Force`) and relaunch via the Precondition step 3 command. Return to the
   same page and reselect the row.
Expected:
- Each click flips the panel between side and bottom, regardless of the
  current window width.
- After restart, the pinned placement is **still in effect** (persisted).
- **Known gap (#1066, not a regression to report)**: there is no "Auto"
  option — the toggle only ever alternates between the two pinned states.
  Once you've clicked it, resizing the window no longer changes placement
  (it stays pinned) until you click the toggle again. This is expected
  current behavior, not a bug to file — it's already tracked.
FAIL if:
- The toggle does nothing; the pin does not persist across restart; or
  clicking it navigates away / errors instead of flipping placement.

### Test 3 — Drag-resizable side split, width persists
Steps:
1. On any list page with a wide window and the panel **side-docked**, find
   the vertical **drag handle** on the boundary between the table and the
   detail panel (cursor becomes a left-right resize arrow when hovering it).
2. Drag it left and right. Observe the panel width change.
3. Drag it as far as it will go in each direction.
4. Restart the app (as in Test 2) and return to the same page with the
   panel side-docked.
Expected:
- Dragging resizes the side panel smoothly; the table reflows to fit.
- The width is **clamped** — it will not shrink below a usable minimum
  (~320px) nor grow past about half the window.
- After restart, the panel returns to your dragged width, not the default
  (~420px).
FAIL if:
- No draggable handle exists; dragging does nothing; the panel can be
  dragged to zero / off-screen / past half the window; or the width resets
  to default on restart.

### Test 4 — Detail panel content stays reachable in both placements (containment)
Steps:
1. Open a **Target**'s detail on the Targets page — this page's detail
   historically had content clipped below the fold (#816, fixed by #1035).
   Pick a target with several sections of detail (aliases, notes, coverage,
   links) if available.
2. With the panel **side-docked**, scroll the detail panel to the bottom.
3. Confirm you can see/reach the lower content.
4. Toggle to **bottom-docked** (Test 2's toggle) and repeat the
   scroll-to-bottom check.
Expected:
- All lower content is reachable by scrolling **within the panel**, in both
  placements — no content is cut off below the visible panel edge.
FAIL if:
- Any content is cut off and cannot be reached by scrolling in either
  placement, or two nested scrollbars appear.

### Test 5 — Inbox uses the same mechanism as other pages (not a permanent split)
Steps:
1. Go to **Inbox** with at least one item. Select an item so the detail
   panel shows.
2. Repeat Test 1 (resize wide → narrow) on this page.
Expected:
- Inbox behaves **identically** to Sessions/Calibration/Archive/Targets/
  Projects: side dock when wide, bottom dock when narrow. There is no
  permanent left-list/right-detail split, and no different behavior from the
  other pages.
FAIL if:
- Inbox does something visibly different from the other pages tested in
  Test 1 (this would indicate the permanent-split design landed after all —
  flag it, since it isn't expected on `main` and #1068 is still an open
  decision, not a shipped feature).

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
  prefixed `alm-dock-`.

## Report back
For each Test 1–5: PASS / FAIL + one line of what you saw. On any FAIL,
capture a screenshot and the exact on-screen text / any toast. Note the
approximate window width at which placement flips in Test 1.

## Not covered by this script (in flight, not on `main`)

- **3-state Auto/Bottom/Right placement control** (#1066, PR #1070 open) —
  Test 2 above documents the current 2-state toggle as expected behavior.
  Once #1070 merges, this script needs a new test for the Auto state and
  this note should be removed.
- **Archive/Projects/Targets migration to the shared `DetailPanel`
  component** (#1067, PR #1072 open) — these three pages currently hand-roll
  their own detail markup rather than using the same shared container as
  Sessions/Calibration/Inbox. This is not independently visually testable
  (the containment behavior should look the same either way if each page's
  hand-rolled version is correct), but is worth knowing if Test 4 fails
  specifically on Archive or Projects and not on Sessions/Calibration/Inbox
  — that asymmetry would be consistent with #1067's still-open gap.
- **Permanent Inbox split / Targets pinned columns** — these were part of
  the original design but are an **open product decision** (#1068) and a
  **superseded, untracked design idea** respectively; neither is expected on
  `main`. Test 5 above exists specifically to confirm Inbox has NOT silently
  gained different behavior.
