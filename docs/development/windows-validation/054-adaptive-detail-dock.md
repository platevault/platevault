# Windows validation — adaptive detail-panel dock (spec 054)

> For: Claude computer-use ("cowork") on the Windows machine running PlateVault.
> You have NO access to the source repo. Everything you need is in this document.
> Report each Test as PASS / FAIL with what you observed.
> Tracks issue #1008. PR under test: #1007.

## Change facts (context — you do not act on this section)
- Spec / feature: 054 adaptive-detail-dock
- Branch to test: `feat/adaptive-detail-dock`
- Touches Rust backend? yes (only via a `main` merge — inbox/targets fixes; the
  dock feature itself is **frontend-only**) · Frontend behaviors under test: yes
- New/changed Tauri command(s): none (placement/width persist via app
  preferences / localStorage, not a backend command)
- Changed surfaces: every list page — /sessions, /calibration, /archive,
  /projects, /targets, /inbox — plus Settings › General
- What changed for the user: the detail panel now docks to the RIGHT when the
  window is wide and to the BOTTOM when narrow, with a per-page Auto/Bottom/Right
  toggle that is remembered, a drag-resizable side split, a scroll-safe Target
  detail, a permanent right-split Inbox, and pinned identity columns on Targets.

## Preconditions — get the app to the right state
1. Deploy the branch on the Windows checkout `C:\dev\astro-plan`:
   - `git fetch origin`
   - `git reset --hard origin/feat/adaptive-detail-dock`   (run as its OWN command)
   - The branch includes merged Rust changes, so force a rebuild (mtime trap):
     `Get-ChildItem C:\dev\astro-plan\crates -Recurse -Filter *.rs | ForEach-Object { $_.LastWriteTime = Get-Date }`
2. A clean first-run is NOT required (these are existing pages). If the app is
   stuck on the setup wizard, reset the DB and relaunch:
   `Remove-Item 'C:\dev\astro-plan\wizard-test.db*' -Force`
3. Launch: `powershell.exe -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/k','C:\dev\astro-plan\run-dev.bat' -WorkingDirectory 'C:\dev\astro-plan'"`
   Wait for the window (process `desktop_shell.exe`, Vite on `localhost:5173`).
   First launch recompiles Rust — allow several minutes.
4. Prepare data: you need at least a few targets and one inbox item. If the
   library is empty, add a light-frames root in Settings › Data Sources and run a
   scan so /targets and /inbox have rows. If targets already exist, skip.
5. Sanity: the app renders a real page (not a blank window). If blank → see
   Troubleshooting.

## Tests

### Test 1 — Auto placement flips side ⇄ bottom with window width
Steps:
1. Go to **Sessions** (or Calibration/Archive) and select a row so the detail
   panel appears.
2. Make the window **wide** — maximize it (well over 1500px across).
3. Observe where the detail panel sits.
4. Now **narrow** the window by dragging its left/right edge until it is clearly
   narrow (roughly half-screen, under ~1400px across).
5. Observe again.
Expected:
- Wide: the detail panel sits to the **RIGHT** of the table (side-by-side), full
  height.
- Narrow: the detail panel moves to the **BOTTOM**, under a full-width table.
- The flip happens as you cross the threshold; it does not flicker back and forth
  while you hold a steady width near the boundary.
FAIL if:
- The panel stays bottom-docked at full width, or stays side-docked when narrow;
  or it oscillates rapidly at a steady width; or the table/panel visibly overlap.

### Test 2 — Per-page Auto/Bottom/Right toggle, and it persists across restart
Steps:
1. On **Targets**, select a target so the detail panel shows. Keep the window wide.
2. Find the **Auto / Bottom / Right** control — it appears both in the detail
   panel's top bar and in **Settings › General** (a row per page). Use either.
3. Click **Bottom**. Observe.
4. Click **Right**. Observe.
5. Click **Auto**. Observe.
6. Set Targets to **Bottom** and leave it. Go to **Sessions**, confirm its own
   control still reads **Auto** (independent per page).
7. Fully close the app (`Get-Process desktop_shell,cargo | Stop-Process -Force`)
   and relaunch via the Precondition step 3 command. Return to **Targets**.
Expected:
- Bottom → panel bottom-docks regardless of width. Right → panel side-docks
  (window permitting). Auto → follows width (Test 1 behavior).
- The active segment is visibly highlighted and matches the current placement.
- Sessions stays Auto while Targets is Bottom (per-page, not global).
- **After restart, Targets is still Bottom** (the choice persisted).
FAIL if:
- A segment does nothing; or changing Targets also changes Sessions; or the
  selection resets to Auto after restart.

### Test 3 — Drag-resizable side split, width persists
Steps:
1. On **Targets** (or Sessions) with a wide window and the panel **side-docked**
   (set the toggle to Right if needed), find the vertical **drag handle** on the
   boundary between the table and the detail panel (cursor becomes a
   left-right resize arrow when hovering it).
2. Drag it left and right. Observe the panel width change.
3. Drag it as far as it will go in each direction.
4. Restart the app (as in Test 2) and return to the same page.
Expected:
- Dragging resizes the side panel smoothly; the table reflows to fit.
- The width is **clamped** — it will not shrink below a usable minimum
  (~320px) nor grow past about half the window.
- After restart, the panel returns to **your dragged width**, not the default.
FAIL if:
- No draggable handle exists; or dragging does nothing; or the panel can be
  dragged to zero / off-screen / past half the window; or width resets on restart.

### Test 4 — Target detail content is fully reachable (no clipping) — #816
Steps:
1. Open a **Target** with plenty of detail (aliases, notes, coverage, links).
2. With the panel **side-docked** (Right), scroll the detail panel to the bottom.
3. Confirm you can see/reach the lower content: **aliases, display label, notes,
   coverage, external links, and the panel's Back button.**
4. Switch the toggle to **Bottom** and repeat the scroll-to-bottom check.
Expected:
- All lower content is reachable by scrolling **within the panel**, in BOTH side
  and bottom placement. The Back button is visible/clickable.
- There is a single scroll region inside the panel (no double/nested scrollbars).
FAIL if:
- Any lower content (aliases/notes/coverage/links/Back) is cut off and cannot be
  scrolled to in either placement; or two nested scrollbars appear.

### Test 5 — Inbox is a permanent right split (never bottom) — #553
Steps:
1. Go to **Inbox** with at least one item. Select an item.
2. Observe the layout at a **wide** window.
3. **Narrow** the window substantially (down toward the ~1100px minimum).
4. Try the Auto/Bottom/Right toggle if present for Inbox.
Expected:
- Inbox shows a **left item list (~360px) + a full-height detail panel on the
  RIGHT** taking the rest of the width — at every width, including narrow.
- The detail's **FILES list is fully visible** (not cut off below the viewport).
- Inbox **never** switches to a bottom dock, even when narrow; it has no
  Bottom/Right choice (it is a forced split).
FAIL if:
- Inbox ever bottom-docks; or the FILES list is clipped below the window; or the
  item list is full-width with the detail underneath.

### Test 6 — Targets pinned identity columns + conditional horizontal scroll — #FR-006
Steps:
1. Go to **Targets** with the window **wide** and the panel side-docked (Right).
2. Note the leftmost columns: the **favorite star** and the **designation**.
3. Drag the resize handle (Test 3) to make the side panel wide, squeezing the
   table narrow — or narrow the whole window.
4. Scroll the table **horizontally** if a scrollbar appears.
Expected:
- The **star + designation columns stay pinned to the left** and remain visible
  while the other columns scroll horizontally beside them.
- A horizontal scrollbar appears **only** when the table is too narrow for all
  columns; at full width there is no horizontal scrollbar and no clipped cells.
FAIL if:
- The star/designation scroll away with the rest; or a horizontal scrollbar is
  present at full width; or cells are clipped with no way to scroll to them.

## Troubleshooting
- Blank window (empty content): restart the dev server; if still blank, run
  `pnpm install` in `C:\dev\astro-plan` with `$env:CI="true"`, relaunch.
- Stale behavior after the reset: confirm you touched the `.rs` files after
  `git reset --hard` so cargo rebuilt (mtime trap). For frontend-only doubts, a
  hard refresh (Ctrl+R) reloads the latest Vite bundle.

## Report back
For each Test 1–6: PASS / FAIL + one line of what you saw. On any FAIL, capture a
screenshot and the exact on-screen text / any toast. Note the window width
(approx px) at which placement flips, for Test 1.
