---
id: J42
title: Work from launch to an open Project's View with the keyboard only
version: 2
status: draft
last_reviewed: 2026-10-12
actors: [primary-user]
surfaces: [keyboard, shell, status-bar, home, projects, sessions, import, locations, settings, appearance, calibration, view, output, wrap-up, activity]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [HARNESS-V5-FEEDBACK-R1.md#shell-and-navigation-foundation, HARNESS-V5-FEEDBACK-R1.md#copy-rules-every-screen-every-slice, HARNESS-V5-FEEDBACK-R1.md#d-review, HARNESS-V5-FEEDBACK-R1.md#round-5, P-SB3, P-STO2, P-PLAN2, HARNESS-V5-IA.md#source-list-sidebar, HARNESS-V5-IA.md#S6, HARNESS-V5-IA.md#round-2-foundation-2026-10-09, HARNESS-V5-IA.md#round-2b-foundation-status-bar-and-p-cal3-2026-10-09, HARNESS-V5-IA.md#fix-pass-2026-10-09, apps/prototype/src/app/command-palette.tsx, apps/prototype/src/app/navigation.ts, apps/prototype/src/app/history.tsx, apps/prototype/src/app/shortcuts.tsx, apps/prototype/src/app/shell.tsx, apps/prototype/src/components/app/row-menu.tsx, apps/prototype/src/components/app/clearable-input.tsx, apps/prototype/src/components/app/confirm-dialog.tsx, apps/prototype/src/features/v5/d-review/shortcuts.tsx, apps/prototype/src/features/v5/d-review/frame-review.tsx, apps/prototype/src/features/t1/settings/appearance-page.tsx, D-W14, D-W22, D-W42, D-W53, D-W54, specs/067-frame-review/spec.md, J16, J22, J38, FR-025, FR-026, FR-031, PRJ-FR-07, PRJ-FR-14, PRJ-FR-27, PRJ-FR-28, VSEL-FR-02, VSEL-FR-03, VSEL-FR-14, VSEL-FR-16, LIB-FR-21, CAL-FR-09, PREP-FR-04, PREP-FR-06, PREP-FR-16, RES-FR-01, RES-FR-02, D-W93 to D-W106]
---

## Goal

The user works through PlateVault without a pointer. They launch it, find their
way with the shortcuts list, go-to keys, the command palette and Back, act on
rows through their menus and Enter, use search fields and sheets, and cancel
running work from the status bar. Then they open a Project and use its steps to
inspect Sessions, Calibrate, View, Output and Wrap up. Shortcuts stay out of the way
while the user types, and nothing destructive happens without a confirmation
that has focus.
Done means:

- From launch through the Project's Wrap up step, every step is done with the keyboard. The pointer is never moved or clicked.
- The open Project `NGC 7000 HOO` holds five Ready sessions with settled calibration and 214 lights in one group. Its View is not applied, and its Output folder is empty.
- No keystroke typed into a field triggered a shortcut. The one destructive action opened was canceled at a confirmation that had focus, so nothing was trashed.
- After each dialog, menu or sheet closes, focus is back on the control that opened it.
- No file under the registered locations changed.

## Preconditions

- P1: The open Project `NGC 7000 HOO` has subject NGC 7000 and rig RedCat, and holds five Ready sessions with settled calibration and 214 lights in one group. The Project's View has not been applied. A Siril profile is configured.
- P2: The Project's `Output/` folder is empty.
- P3: Preferences are at their defaults: single-key shortcuts on and sidebar expanded.
- P4: On macOS, System Settings › Keyboard › Keyboard navigation is on, so Tab reaches every control. No pointer is used after launch (G3).
- P5: The status bar shows no issue other than what the J21 state raises, and no work is running.
- P6: A rescan of `Astro-T7 captures` takes long enough to move focus onto it (G2).
- P7: The J19/P5 manifest is available.

## Steps

### S1 — Launch and read the shortcuts list {#S1}

- **Do:** Launch PlateVault. Press **?**, read the list, then press **Esc**.
- **Expect:** Home opens. **?** opens the Keyboard shortcuts dialog with "Shortcuts are off while you type in a field." and a Single-key shortcuts switch. Its list includes:
  - ⌘K, ?, /, [, ⇧F10, ↑ ↓, Space and Esc.
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

### S5 — Inspect Project actions with the keyboard {#S5}

- **Do:** On the `NGC 7000 HOO` Project page, Tab to the **Project ▾** menu and press Enter. Read the menu, then press **Esc**.
- **Expect:** The menu offers **Edit…** and **Duplicate…**. **Esc** closes it, and focus returns to **Project ▾**.
- **Expect (negative):** Opening and closing the menu changes no Project setting, group, session or file.
- **Trace:** FR-025 · PRJ-FR-07 · PRJ-FR-30 · PRJ-FR-32

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

### S9 — Open the Project from the command palette {#S9}

- **Do:** Press **⌘K**, type `NGC 7000 HOO`, and press Enter on its highlighted Project result.
- **Expect:**
  - The palette lists `NGC 7000 HOO` under Projects. Enter opens its Project page.
  - The Project page offers Sessions, Calibrate, View, Output and Wrap up. Its first step is Sessions.
  - No step creates or names a processing run; frame Review remains in session intake.
- **Expect (negative):** Typing in the palette's field triggers no shortcut.
- **Trace:** PRJ-FR-07 · PRJ-FR-32 · D-W94

### S10 — Open the Sessions step {#S10}

- **Do:** Tab to the Project's **Sessions** step and press Enter.
- **Expect:** Sessions lists the Project's five sessions in its group. The rows show session and frame counts, and the group belongs to rig RedCat.
- **Expect (negative):** Opening the step adds no suggested session and changes no Project membership.
- **Trace:** PRJ-FR-07 · PRJ-FR-09 · PRJ-FR-27 · VSEL-FR-02 · D-W94 to D-W96

### S11 — Read the Calibrate step {#S11}

- **Do:** Tab to the Project's **Calibrate** step and press Enter.
- **Expect:** Calibrate shows the read-only calibration check and its diagram for the Project's groups and nights.
- **Expect (negative):** Opening Calibrate reassigns no calibration and changes no Project input.
- **Trace:** PRJ-FR-07 · CAL-FR-09 · LIB-FR-23 · D-W101

### S12 — Review the Apply sheet without applying {#S12}

- **Do:** Tab to the Project's **View** step and press Enter. Tab to **Apply…** and press Enter. Read the sheet, then press **Esc**.
- **Expect:** The sheet shows the Project folder tree with `View/`, `Processing/Siril/` and `Output/`, the 214 light entries, the Symlinks mode and its limits, and the footprint `Linked · 0 B`. **Esc** closes the sheet and returns focus to **Apply…**.
- **Expect (negative):** Closing the sheet starts no Apply. The View remains unapplied and no file changes.
- **Trace:** VSEL-FR-14 · VSEL-FR-16 · PREP-FR-04 · PREP-FR-06 · PREP-FR-16 · PREP-AC-01 · D-W98 · D-W100

### S13 — Read the Output step {#S13}

- **Do:** Tab to the Project's **Output** step and press Enter.
- **Expect:** Output lists Results from the Project's `Output/` folder. This fixture has no Results, so the table is empty and Copy to Output… is available.
- **Expect (negative):** Opening Output accepts no file and changes no folder.
- **Trace:** PRJ-FR-07 · RES-FR-01 · RES-FR-02 · D-W98

### S14 — Read the Project's Wrap up steps {#S14}

- **Do:** Tab to the Project's **Wrap up** step and press Enter. Read the step list without proceeding.
- **Expect:**
  - Wrap up lists Clean up, Trash and Archive in that order.
  - The Project remains open. Its sessions, View and Output are unchanged.
- **Expect (negative):** Reading Wrap up proceeds through no custody step and closes no Project.
- **Trace:** PRJ-FR-14 · PRJ-FR-15 · PRJ-FR-32 · D-W80 · D-W97

### S15 — Verify custody {#S15}

- **Do:** Outside PlateVault, recompute the J19/P5 manifest.
- **Expect:** Every path, size and SHA-256 matches.
- **Expect (negative):** No file was written, moved or trashed by any step.
- **Trace:** root SC-002

## Success criteria

- SC1: Steps S1 to S14 are completed with 0 pointer events after launch.
- SC2: At S10 the Project lists five Ready sessions with 214 lights in one RedCat group, and at S12 its Apply sheet shows 214 light entries in the Project's View layout.
- SC3: Typing in a field (S3, S9) triggers 0 shortcuts. With single-key shortcuts off (S8), 0 single-key shortcuts fire, and ⌘K still opens the palette.
- SC4: Focus returns to the opener after each of these 5 closes: the shortcuts dialog (S1), the row menu (S4), the confirmation (S5), the sheet (S6) and the palette (S8). After Cancel it lands on the bell (S7).
- SC5: No Project is duplicated or closed (S5, S14), no import starts (S6), no Apply starts (S12), and no registered source file changes (S15).

## Known gaps

- G1: Not validated. Behavior follows the harness v5 design: HARNESS-V5-FEEDBACK-R1.md §Shell and navigation, §D Review and §Round 5 (P-SB3, navigation, "Click a result to act"), and HARNESS-V5-IA.md §Screens S6, §Round 2 and 2b foundations and §Fix pass (apps/prototype/design/ on ui-harness-v5 @ b5e813a5). Round 5 work (status-bar counters, the source list without Plan and Storage, Enter on a focused row) is in progress in the prototype. No implementation has been validated against this journey.
- G2: Unresolved implementation qualification: S7 needs a rescan that runs long enough to focus (P6). No pacing fixture exists. Blocks readiness.
- G3: Unresolved implementation qualification: SC1 needs a driver that sends only key events and records any pointer event, on both interface profiles. No such driver is set up. Blocks readiness.
- G4: Out of scope for this journey: the filmstrip view, Compare (C), the review filters (⌥1 to ⌥4), Unreviewed (U), Pick (P, Shift+P), the review shortcuts sheet, palette actions such as theme and language, and the Space checkbox toggle in tables. J22/S11a covers P, Shift+P and the filters with a pointer.
- G5: Out of scope for this journey: the order in which Tab reaches each region (toolbar, source list, page, status bar), and the focus target after a confirmed (not canceled) destructive action. Neither is stated in the v5 design.

## Delta log
- **Δ2** 2026-10-15 · S1, S5, S9, S10, S11, S12, S13, S14 · behavior-change
  The keyboard path now follows the Project's Sessions, Calibrate, View, Output and Wrap up steps. Apply remains pending until the user chooses it; frame review is in session intake.
  Evidence: D-W94 to D-W106, PRJ-FR-07, PRJ-FR-14, PRJ-FR-27, VSEL-FR-14, PREP-FR-06 and RES-FR-01 · by: SpecF4Writer2 (intent-gated)
