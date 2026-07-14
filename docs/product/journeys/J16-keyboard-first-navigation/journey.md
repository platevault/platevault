## Journey 16 — Keyboard-first navigation & window management

**Goal:** an efficiency-focused user drives PlateVault mostly without the
mouse: jump to pages, search entities globally, act on the current
selection, and manage panel/window real estate.

**Preconditions:** any library state.

**Narrative flow:**

1. **Ctrl/⌘+K** opens the command palette anywhere: type-to-filter pages,
   backend-searched targets/sessions/projects, and context actions. Enter
   navigates; Escape closes; arrows move selection.
2. List pages support keyboard row traversal (↑/↓ moves selection, the
   detail panel follows); Escape closes the detail panel; sort headers are
   keyboard-reachable and announced.
3. Sidebar collapse, log-panel expand, and detail-panel orientation are
   persistent layout choices; collapsed-sidebar icons keep tooltips.
4. "Open view in new window" pops the current view into a separate OS
   window — the intended home for the Activity log or a plan review during
   long operations.
5. Every overlay (palette, plan review, dialogs) closes on Escape and traps
   focus while open.

**Touch & validate:**

- Palette: open/close/reopen from every page; every listed route exists in
  the route tree (assert programmatically); entity search returns backend
  results; executing each action class (navigate, create, open-window)
  does what it says; styled overlay (not document-flow content).
- Keyboard-only pass of one full list page: reach the search box, traverse
  rows, open/close the detail, trigger the row's primary action, sort a
  column — without a pointer.
- Focus: visible focus ring on every interactive element traversed; focus
  returns to the invoking control after an overlay closes.
- New-window action: opens, renders the chosen view, and its lifetime is
  independent of the main window's navigation; the intended close
  affordance is explicit (OS titlebar at minimum) and closing it never
  tears down the main window.
- Persistence: collapse/expand and panel states survive restart.

**Safety & trust notes:** none filesystem-related; this journey carries the
"expert workbench" brand promise.

**Scenario files:**
`e2e-agentic-test/043-ui-redesign-platevault/global-search-command-palette/scenario.md`,
`.../a11y-keyboard-and-aria-sort/scenario.md`, plus *(to be authored)*
`e2e-agentic-test/journeys/keyboard-first-navigation/scenario.md`.
