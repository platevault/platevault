---
id: J16
title: Drive PlateVault end to end without a pointer
version: 1
status: active
last_reviewed: 2026-07-14
actors: [astrophotographer]
surfaces: [shell]
interfaces: [windows-desktop]
trace:
  - docs/product/journeys/J16-keyboard-first-navigation/journey.md @ 66026463 (pre-migration doc)
  - PR #530 (a11y/theming/design-system consistency — commit 1f4ba13f: keyboard-operable
    table rows + focus-visible ring on primitives)
  - issue #747 (Inbox has zero keyboard shortcuts, open)
  - issue #797 (Sidebar nav items lack :focus-visible, open)
  - issue #771 (Sessions detail panel does not close on Escape, open)
  - issue #842 (Log panel expand state does not persist across restart, open)
  - issue #844 (Modal overlays do not return focus to the invoking control, open)
  - issue #581 (Command palette matching/keyboard-nav report, open)
  - issue #810 (--alm-focus-ring token misused as outline-color on 3 selectors, open)
  - issue #660 (Projects Edit pane overlay has no dialog chrome/Escape/focus-trap, open)
  - issue #767 (Plan-review overlay can get stuck open after Apply all, open)
  - e2e-agentic-test/043-ui-redesign-platevault/global-search-command-palette/scenario.md
  - e2e-agentic-test/043-ui-redesign-platevault/a11y-keyboard-and-aria-sort/scenario.md
---

## Goal

An efficiency-focused user drives PlateVault primarily without a mouse: jump
to any page or entity from anywhere, traverse and act on list rows, manage
persistent panel layout, and pop the current view into its own OS window for
long-running work. Done means every one of those actions is reachable,
operable, and observable using only the keyboard, from any page.

## Preconditions

- P1: The app is running with the main window focused; any library state
  (empty or populated) is sufficient to reach every step.
- P2: For the command palette's entity-search results (S1) to return
  non-empty results, at least one target, session, or project exists;
  otherwise the palette still opens and still lists pages/actions.

## Steps

### S1 — Open the command palette from anywhere {#S1}
- **Do:** Press Ctrl+K (Cmd+K on macOS) from any page; type to filter; press
  Enter on a highlighted entry; press Escape.
- **Expect:** The palette opens as a styled overlay (not raw document-flow
  content) showing Pages and Actions groups; after a short pause, typing
  a query that matches a target/session/project adds a Results group sourced
  from the backend search; Enter on the highlighted item navigates to a page,
  jumps to the matched entity, or runs the action (e.g. "Open in new
  window" — see S2); Escape closes the palette without navigating.
- **Expect (negative):** Pressing Ctrl/Cmd+K again while the palette is open
  closes it rather than opening a second instance.
- **Trace:** `apps/desktop/src/app/CommandPalette.tsx` (cmdk + base-ui
  Dialog); Known gap G6.

### S2 — Pop the current view into its own window {#S2}
- **Do:** From the palette's Actions group, choose "Open in new window."
- **Expect:** A new, independent OS window opens rendering the same route;
  its lifetime and navigation are independent of the main window; the
  intended close affordance is the OS window titlebar.
- **Expect (negative):** Closing the new window never closes or navigates
  the main window, and closing the main window never force-closes windows
  opened this way.
- **Trace:** `apps/desktop/src/lib/window.ts`.

### S3 — Traverse a list page by keyboard {#S3}
- **Do:** Tab to a list page's table, move the focused row with ArrowUp and
  ArrowDown, then press Enter or Space on a focused row; separately, Tab to
  a sortable column header and activate it.
- **Expect:** Arrow keys move focus row-to-row without a pointer; Enter or
  Space on the focused row performs exactly what a click on that row would
  (typically opening its detail panel); the focused row and every
  Tab-reachable control show a visible focus ring; sortable headers are
  keyboard-reachable and expose `aria-sort` when active.
- **Expect (negative):** Moving focus with the arrow keys alone does not
  perform the row's action — only Enter/Space activates it, so keyboard
  users can browse without triggering navigation by accident.
- **Trace:** `apps/desktop/src/ui/Table.tsx`; Known gaps G2, G7.

### S4 — Close a list page's detail panel by keyboard {#S4}
- **Do:** With a row's detail panel open, press Escape.
- **Expect:** The detail panel closes and focus returns to the list.
- **Expect (negative):** Escape never mutates the selected record or
  triggers any state transition — it only dismisses the panel.
- **Trace:** Known gap G3 (confirmed broken on at least one list page).

### S5 — Layout choices persist across restart {#S5}
- **Do:** Collapse the sidebar and expand the Activity log panel, then
  restart the app.
- **Expect:** Sidebar collapse/expand state is restored after restart;
  while collapsed, each sidebar icon still exposes its full label via a
  native tooltip on hover/focus.
- **Expect (negative):** none scoped — see Known gap G4 for the log panel's
  non-persistence, which is a real gap, not a trust violation.
- **Trace:** `apps/desktop/src/app/Sidebar.tsx` (`usePreference`); Known gap
  G4.

### S6 — Overlays trap focus and close on Escape {#S6}
- **Do:** Open an overlay built on the shared Modal (the command palette,
  a confirm dialog, a plan-review overlay); press Tab repeatedly; press
  Escape.
- **Expect:** Tab cycles only among controls inside the open overlay
  (focus never escapes to the page behind it); Escape closes the overlay;
  a backdrop click also dismisses it where enabled.
- **Expect (negative):** Focus does not currently return to the control
  that opened the overlay after it closes — carried as Known gap G5, not
  claimed as working. Not every overlay in the app is built on the shared
  Modal; the exceptions in Known gap G8 do not reliably trap focus or
  close on Escape.
- **Trace:** `apps/desktop/src/components/Modal.tsx`; Known gaps G5, G8.

## Success criteria

- SC1: Ctrl/Cmd+K opens the palette from every page, and every route listed
  in its Pages group resolves to an existing route (S1).
- SC2: 100% of rows on a list page are reachable via ArrowUp/ArrowDown and
  activatable via Enter/Space without a pointer (S3).
- SC3: Sidebar collapse/expand state matches its pre-restart value 100% of
  the time after an app restart (S5).
- SC4: "Open in new window" produces a window that survives independently
  of the main window: closing either one leaves the other window and its
  navigation state unaffected (S2).
- SC5: Every Tab-reachable control exercised in S1–S3 and S6 shows a
  visible focus indicator (S3, S6), except the specific components named
  in Known gaps G2 and G7.

## Known gaps

- G1: Inbox has no keyboard shortcuts at all (no confirm/reject/skip
  accelerators, no J/K row navigation) — the shared `useHotkeys` hook only
  has bindings left for the command palette and the log panel; an
  "Inbox ActionSidebar" binding referenced in that hook's own comment was
  orphaned when `ActionSidebar` was deleted, with no replacement. Tracked
  as GitHub issue #747 (open).
- G2: The primary Sidebar nav links (`apps/desktop/src/app/Sidebar.tsx`,
  `.alm-sidebar__item`) have no `:focus-visible` rule at all, unlike other
  interactive elements in the app that follow the `--alm-focus-ring`
  convention — Tab-focus on the main nav has no reliable visible
  indicator. Tracked as GitHub issue #797 (open).
- G3: List-page detail panels do not reliably close on Escape — confirmed
  on the Sessions page, where only the ✕ button closes the panel. Tracked
  as GitHub issue #771 (open).
- G4: The Activity log panel's expand/collapse state does not persist
  across restart (plain `useState`, no preference wiring), unlike the
  sidebar's collapse state which does persist. Tracked as GitHub issue
  #842 (open).
- G5: The shared `Modal` component wraps base-ui's Dialog in controlled
  mode without a registered `Dialog.Trigger`, so focus does not return to
  the control that opened an overlay once it closes. Tracked as GitHub
  issue #844 (open).
- G6: An open, unresolved report describes the command palette as
  unstyled with broken search matching (a single-letter query returns
  results but a specific catalogue-id query returns none) and
  non-functional keyboard navigation/clicks. No merged fix evidence found;
  carried as-is rather than corrected. Tracked as GitHub issue #581 (open).
- G7: The `--alm-focus-ring` token is misapplied as an `outline-color`
  (invalid CSS) on three specific selectors (Targets guidance cell,
  Calibration session popover, Inbox files trigger), so no focus ring
  renders on those elements despite following the naming convention.
  Tracked as GitHub issue #810 (open).
- G8: Two overlays outside the shared `Modal` component don't reliably
  trap focus or close on Escape: the Projects Edit pane (renders full-window
  with no dialog chrome, no Escape, no focus trap — issue #660, open) and
  the Inbox plan-review overlay, which can get stuck open with an empty
  body — Escape/✕/backdrop all fail — after "Apply all" empties its plan
  list (issue #767, open).

## Delta log

(none — this is the version-1 migrated baseline; the pre-migration
journey.md and the issues folded above are recorded in `trace:`.)
