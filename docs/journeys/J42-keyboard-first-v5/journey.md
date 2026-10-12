---
id: J42
title: Work from launch to a culled, saved run with the keyboard only
version: 1
status: draft
last_reviewed: 2026-10-12
actors: [primary-user]
surfaces: [keyboard, shell, status-bar, home, projects, sessions, import, locations, settings, appearance, view-review, frame-review, activity]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [HARNESS-V5-FEEDBACK-R1.md#shell-and-navigation-foundation, HARNESS-V5-FEEDBACK-R1.md#copy-rules-every-screen-every-slice, HARNESS-V5-FEEDBACK-R1.md#d-review, HARNESS-V5-FEEDBACK-R1.md#round-5, P-SB3, P-STO2, P-PLAN2, HARNESS-V5-IA.md#source-list-sidebar, HARNESS-V5-IA.md#S6, HARNESS-V5-IA.md#round-2-foundation-2026-10-09, HARNESS-V5-IA.md#round-2b-foundation-status-bar-and-p-cal3-2026-10-09, HARNESS-V5-IA.md#fix-pass-2026-10-09, apps/prototype/src/app/command-palette.tsx, apps/prototype/src/app/navigation.ts, apps/prototype/src/app/history.tsx, apps/prototype/src/app/shortcuts.tsx, apps/prototype/src/app/shell.tsx, apps/prototype/src/components/app/row-menu.tsx, apps/prototype/src/components/app/clearable-input.tsx, apps/prototype/src/components/app/confirm-dialog.tsx, apps/prototype/src/features/v5/d-review/shortcuts.tsx, apps/prototype/src/features/v5/d-review/frame-review.tsx, apps/prototype/src/features/t1/settings/appearance-page.tsx, D-W14, D-W22, D-W42, D-W53, D-W54, specs/067-frame-review/spec.md, J16, J22, J38]
---

## Goal

The user works through PlateVault without a pointer. They launch it, find their
way with the shortcuts list, go-to keys, the command palette and Back, act on
rows through their menus and Enter, use search fields and sheets, and cancel
running work from the status bar. Then they open the run's Review step, cull
frames with the review hotkeys and save the run. Shortcuts stay out of the way
while the user types, and nothing destructive happens without a confirmation
that has focus.
Done means:

- From launch to the saved run, every step is done with the keyboard. The pointer is never moved or clicked.
- `NGC7000-HOO-Siril` holds saved membership revision 2 with 212 lights. F1 and F2 read Rejected with scope Library and are out of the run.
- No keystroke typed into a field triggered a shortcut. The one destructive action opened was canceled at a confirmation that had focus, so nothing was trashed.
- After each dialog, menu or sheet closes, focus is back on the control that opened it.
- No file under the registered locations changed.

## Preconditions

- P1: J21 completed, as in J22/P1. `NGC7000-HOO-Siril` of `NGC 7000 HOO` holds saved membership revision 1 with five sessions (214 lights, all Unreviewed). No measurement is cached. The Project's only run is `NGC7000-HOO-Siril`.
- P2: F1 and F2 are the first two frames in Review's default order for `NGC7000-HOO-Siril` (as J22/P7, adjacent in the default list order).
- P3: Preferences are at their defaults: single-key shortcuts on, Review auto-advance on, sidebar expanded.
- P4: On macOS, System Settings › Keyboard › Keyboard navigation is on, so Tab reaches every control, and no system shortcut uses ⌃1 to ⌃6. No pointer is used after launch (G3).
- P5: The status bar shows no issue other than what the J21 state raises, and no work is running.
- P6: A rescan of `Astro-T7 captures` takes long enough to move focus onto it (G2).
- P7: The J19/P5 manifest is available.

## Steps

### S1 — Launch and read the shortcuts list {#S1}

- **Do:** Launch PlateVault. Press **?**, read the list, then press **Esc**.
- **Expect:** Home opens. **?** opens the Keyboard shortcuts dialog with "Shortcuts are off while you type in a field." and a Single-key shortcuts switch. Its list includes:
  - ⌘K, ?, /, [, ⌘↩, ⌃1–6, ⇧F10, ↑ ↓, Space and Esc.
  - A G sequence for each source-list item: G H Home, G P Projects, G T Targets, G S Sessions, G C Calibration, G A Activity and G , Settings.

  **Esc** closes the dialog, and focus returns to where it was before **?**.
- **Expect (negative):** The list has no go-to entry for Plan or Storage.
- **Trace:** src/app/shortcuts.tsx shortcutRows · HARNESS-V5-FEEDBACK-R1.md §Round 5 Navigation "Storage and Plan leave the source list", P-PLAN2, P-STO2

### S2 — Move around with go-to keys, the sidebar toggle and Back {#S2}

- **Do:** Press **G** then **P**, then **G** then **S**. Press **[** twice. Press Tab until the toolbar's Back control has focus, press Enter, then Tab to Forward and press Enter.
- **Expect:**
  - **G P** opens Projects, and **G S** opens Sessions. The source list marks the current item each time.
  - The first **[** collapses the sidebar, and the second expands it.
  - Back returns to Projects, and Forward returns to Sessions. Each control is named Back or Forward when it has focus.
- **Expect (negative):** None of these keys changes a catalog record.
- **Trace:** src/app/navigation.ts goKey · src/app/history.tsx HistoryControl · HARNESS-V5-FEEDBACK-R1.md §Shell and navigation 3 "Back"

### S3 — Search a list with the keyboard {#S3}

- **Do:** On Sessions, press **/**. Type `gp`, then press **Esc**. Type `Sep`, Tab to the field's clear (×) button and press Enter.
- **Expect:**
  - **/** puts focus in the Sessions search field.
  - `gp` appears in the field and filters the list. **Esc** empties the field, and focus stays in it.
  - `Sep` filters the list to the September sessions. The × button empties the field, focus returns to the field, and every session is listed again.
- **Expect (negative):** Typing `g` then `p` in the field does not open Projects, and no other shortcut fires while the field has focus.
- **Trace:** src/components/app/clearable-input.tsx · HARNESS-V5-FEEDBACK-R1.md §Copy rules "Every text field that filters or searches gets a clear (×) button" · messages shortcuts_description

### S4 — Act on a row with Enter and its menu {#S4}

- **Do:** Press **G H**. Tab to the `NGC 7000 HOO` row in Home's Projects section. Press **⇧F10**, read the menu, then press **Esc**. Press Enter.
- **Expect:** **⇧F10** opens the row's context menu, named after the row. Arrow keys move through its items. **Esc** closes it, and focus is back on the row. Enter on the row opens the `NGC 7000 HOO` Project page.
- **Expect (negative):** Opening and closing the menu runs none of its items.
- **Trace:** src/components/app/row-menu.tsx openMenuFromKeyboard · HARNESS-V5-FEEDBACK-R1.md §Round 5 "Home rows open the Project page", "Click a result to act" · HARNESS-V5-FEEDBACK-R1.md §Shell and navigation 4 context-menu helpers

### S5 — Back out of a destructive action {#S5}

- **Do:** On the Project page, Tab to the `NGC7000-HOO-Siril` row in Runs. Press **⇧F10**, choose Move to Trash with the arrow keys and Enter. Read the confirmation, then press **Esc**.
- **Expect:** A confirmation titled `Move NGC7000-HOO-Siril to the Trash?` opens, and keyboard focus is inside it. **Esc** closes it, and focus returns to the run's row. The run is still listed in Runs and not in the Project's Trash.
- **Expect (negative):** Choosing the menu item does not trash the run by itself. No keystroke other than activating the confirm button could trash it, and none did.
- **Trace:** src/components/app/confirm-dialog.tsx · messages run_trash_title, run_move_to_trash · HARNESS-V5-IA.md §Screens S8

### S6 — Open a sheet and return {#S6}

- **Do:** Tab to the toolbar's Import button and press Enter. Press **Esc**.
- **Expect:** The Import sheet opens over the page with focus inside it. **Esc** closes it, the Project page is still shown, and focus is back on the Import button.
- **Expect (negative):** Opening and closing the sheet starts no import.
- **Trace:** HARNESS-V5-IA.md §Screens S13 "sheet over /import" · HARNESS-V5-IA.md §Fix pass "Sheets"

### S7 — Cancel running work from the status bar {#S7}

- **Do:** Press **G ,**. Move to Locations, Tab to the Rescan action of `Astro-T7 captures` and press Enter. While it runs, Tab to the running work in the status bar, Tab to its Cancel and press Enter.
- **Expect:**
  - The rescan shows as running work in the middle of the status bar.
  - Cancel becomes visible when the item has keyboard focus.
  - Activating Cancel stops the rescan, and the bar reads "Idle". Focus moves to the notifications bell.
- **Expect (negative):** Canceling removes no session and changes no file.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 P-SB3 "Cancel on hover/focus" · HARNESS-V5-IA.md §Round 2b status bar · J38/S10

### S8 — Turn single-key shortcuts off and on {#S8}

- **Do:** Move to Settings › Appearance and Tab to the Keyboard section's Single-key shortcuts switch. Press Space. Press **G P**, then **⌘K**, then **Esc**. Tab back to the switch and press Space.
- **Expect:**
  - The switch reads off.
  - **G P** does nothing, and the page stays on Settings › Appearance.
  - **⌘K** still opens the command palette, and **Esc** closes it with focus back where it was.
  - After the second Space the switch reads on.
- **Expect (negative):** While the setting is off, no single key opens a page or a dialog.
- **Trace:** src/features/t1/settings/appearance-page.tsx · messages settings_shortcuts_help "⌘K and Ctrl+K always work" · HARNESS-V5-IA.md §Screens S16 "Appearance (… shortcuts)"

### S9 — Jump to the run's Review step {#S9}

- **Do:** Press **⌘K**, type `NGC7000-HOO`, and press Enter on the highlighted `NGC7000-HOO-Siril` item. Then press **⌃2**.
- **Expect:**
  - The palette lists `NGC7000-HOO-Siril` under Runs, highlighted. Enter opens the run.
  - **⌃2** opens its Review step. The frame table is at the top with F1 as the current frame, and measurement starts.
  - The run's step bar marks Review as the current step.
- **Expect (negative):** Typing in the palette's field triggers no shortcut.
- **Trace:** src/app/command-palette.tsx · src/app/shell.tsx NextActionButton (⌃1–⌃6) · HARNESS-V5-IA.md §Screens S5, S6

### S10 — Move through the frames {#S10}

- **Do:** Tab into the frame table. Press **↓**, then **↑**. Press **J**, then **K**, then **→**, then **←**.
- **Expect:**
  - The table is one Tab stop, and focus lands on the current frame's row.
  - **↓**, **J** and **→** make F2 current, and **↑**, **K** and **←** make F1 current again. Focus follows the current frame, and the preview shows the current frame each time.
  - One more Tab moves focus out of the table.
- **Expect (negative):** Moving through frames marks nothing and changes no draft.
- **Trace:** HARNESS-V5-IA.md §Fix pass "Roving focus follows the current frame in the table, filmstrip and grid (one Tab stop each)" · src/features/v5/d-review/shortcuts.tsx

### S11 — Cull with the hotkeys {#S11}

- **Do:** With F1 current, press **X**. With F2 current, press **Shift+X**.
- **Expect:**
  - **X** marks F1 Rejected with scope Library at once, and F2 becomes current (auto-advance).
  - **Shift+X** marks F2 Rejected and makes the third frame current.
  - Review's status line reads `2 rejected, unsaved` with Save run and Discard. The run's Select step still reads saved revision 1.
- **Expect (negative):** No mark asks for confirmation. Saved membership revision 1 is unchanged until S14.
- **Trace:** HARNESS-V5-IA.md §Screens S6 hotkeys, §Fix pass "Review drafts" · D-W14, D-W42, D-W53, D-W54 · J22/S11a

### S12 — Switch views and inspect {#S12}

- **Do:** Press **G**, then **↓**, then **G**. Press **T** three times. Press **Z**, then **Z**. Press **⌘I**, then **⌘I**. Press **F**, then **Esc**.
- **Expect:**
  - **G** shows the grid. **↓** moves the current frame down one grid row, and the second **G** returns to the table with that frame current.
  - **T** cycles the table through its three heights and back to the first.
  - **Z** shows the preview at 1:1, and the second **Z** shows it at Fit.
  - **⌘I** shows the corner inspector's nine tiles, and the second **⌘I** hides them.
  - **F** shows the frame fullscreen, and **Esc** leaves fullscreen.
- **Expect (negative):** None of these keys marks a frame or changes the draft, which still reads `2 rejected, unsaved`.
- **Trace:** HARNESS-V5-IA.md §Screens S6 · HARNESS-V5-FEEDBACK-R1.md §D Review "Corner inspector (Ctrl/⌘+I)" · src/features/v5/d-review/frame-review.tsx

### S13 — Select all frames and clear the selection {#S13}

- **Do:** Press **⌘A**, read the status bar, then press **Esc**.
- **Expect:** All 214 listed frames are selected, and the left of the status bar reads `214 selected`. **Esc** clears the selection, and the selection count leaves the status bar.
- **Expect (negative):** Selecting and clearing marks no frame and changes no draft.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 P-SB3 "the selection count when a list has a selection" · review_key_escape "Leave fullscreen, then clear selection"

### S14 — Save the run with the keyboard {#S14}

- **Do:** Press **⌘↩**, then Enter.
- **Expect:**
  - **⌘↩** moves focus to the Save run button, and Enter saves.
  - The run reads saved membership revision 2 with 212 lights. F1 and F2 are out of the run as Rejected, and the status line no longer reads unsaved.
- **Expect (negative):** **⌘↩** alone does not save. Saving changes no library quality beyond the two S11 marks, and writes no source file.
- **Trace:** HARNESS-V5-IA.md §Fix pass "a Save run Next focuses the Save button" · src/app/shell.tsx NextActionButton · messages domain_next_save_run

### S15 — Verify custody {#S15}

- **Do:** Outside PlateVault, recompute the J19/P5 manifest.
- **Expect:** Every path, size and SHA-256 matches.
- **Expect (negative):** No file was written, moved or trashed by any step.
- **Trace:** root SC-002

## Success criteria

- SC1: Steps S1 to S14 are completed with 0 pointer events after launch.
- SC2: At S14 the run holds saved revision 2 with exactly 212 lights, and exactly 2 frames (F1, F2) read Rejected with scope Library.
- SC3: Typing in a field (S3, S9) triggers 0 shortcuts. With single-key shortcuts off (S8), 0 single-key shortcuts fire, and ⌘K still opens the palette.
- SC4: Focus returns to the opener after each of these 5 closes: the shortcuts dialog (S1), the row menu (S4), the confirmation (S5), the sheet (S6) and the palette (S8). After Cancel it lands on the bell (S7).
- SC5: 0 runs are trashed (S5), 0 imports start (S6), and 0 files change (S15).

## Known gaps

- G1: Not validated. Behavior follows the harness v5 design: HARNESS-V5-FEEDBACK-R1.md §Shell and navigation, §D Review and §Round 5 (P-SB3, navigation, "Click a result to act"), and HARNESS-V5-IA.md §Screens S6, §Round 2 and 2b foundations and §Fix pass (apps/prototype/design/ on ui-harness-v5 @ b5e813a5). Round 5 work (status-bar counters, the source list without Plan and Storage, Enter on a focused row) is in progress in the prototype. No implementation has been validated against this journey.
- G2: Unresolved implementation qualification: S7 needs a rescan that runs long enough to focus (P6). No pacing fixture exists. Blocks readiness.
- G3: Unresolved implementation qualification: SC1 needs a driver that sends only key events and records any pointer event, on both interface profiles. No such driver is set up. Blocks readiness.
- G4: Out of scope for this journey: the filmstrip view, Compare (C), the review filters (⌥1 to ⌥4), Unreviewed (U), Pick (P, Shift+P), the review shortcuts sheet, palette actions such as theme and language, and the Space checkbox toggle in tables. J22/S11a covers P, Shift+P and the filters with a pointer.
- G5: Out of scope for this journey: the order in which Tab reaches each region (toolbar, source list, page, status bar), and the focus target after a confirmed (not canceled) destructive action. Neither is stated in the v5 design.

## Delta log

- No entries (initial draft, version 1).
