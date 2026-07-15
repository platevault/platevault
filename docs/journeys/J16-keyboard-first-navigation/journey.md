---
id: J16
title: Drive PlateVault end to end without a pointer
version: 2
status: draft
last_reviewed: 2026-07-14
actors: [astrophotographer]
surfaces: [shell]
interfaces: [desktop-ui]
trace:
  - docs/product/journeys/J16-keyboard-first-navigation/journey.md @ 66026463 (pre-migration doc)
  - PR #530 (a11y/theming/design-system consistency — commit 1f4ba13f: keyboard-operable
    table rows + focus-visible ring on primitives)
  - issue #747 (Inbox has zero keyboard shortcuts, open)
  - issue #797 (Sidebar nav items lack :focus-visible, open)
  - issue #771 (Sessions detail panel does not close on Escape, open)
  - issue #842 (Log panel expand state does not persist across restart, open)
  - issue #844 (Modal overlays do not return focus to the invoking control, open)
  - issue #581 (Command palette unstyled — no .alm-palette* CSS anywhere; search/nav/click
    confirmed functional in a 2026-07-12 follow-up, open)
  - issue #617 (Command palette Pages group lists 3 dead routes: /review, /plans, /audit, open)
  - issue #810 (--alm-focus-ring token misused as outline-color on 3 selectors, open)
  - issue #660 (Projects Edit pane overlay has no dialog chrome/Escape/focus-trap, open)
  - issue #767 (Plan-review overlay can get stuck open after Apply all, open)
  - docs/development/journey-run-2026-07-14.md (Journey 16 section — real Windows-app
    validation: row traversal PASS, Escape-close FAIL, new-window PASS, sidebar-persist
    PASS, log-panel-persist FAIL; bridge cannot drive Tab/native-button keyboard activation)
  - e2e-agentic-test/043-ui-redesign-platevault/global-search-command-palette/scenario.md
  - e2e-agentic-test/043-ui-redesign-platevault/a11y-keyboard-and-aria-sort/scenario.md
  - PR #884 (merged, fixes #581)
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
- **Expect:** The palette now opens as a styled floating overlay (a
  `.alm-palette*` CSS block ships it; it previously rendered as bare
  document-flow markup). It shows Pages and Actions groups; after a short
  pause (200ms debounce), typing a query that matches a target/session/
  project adds a Results group — matching is now alias-aware and
  client-side, reusing the Targets page's own tested matcher, rather than
  the backend's exact-substring SQL match (a compact query like "M31" now
  matches a spaced designation like "M 31"); the entity list is fetched
  fresh each time the palette opens. Enter on the highlighted item
  navigates to a page, jumps to the matched entity, or runs the action
  (e.g. "Open in new window" — see S2); a click on a result does the same.
  Escape closes the palette without navigating. Three of the eight Pages
  entries (`/review`, `/plans`, `/audit`) are still dead routes that
  silently redirect to the app root instead of navigating (Known gap G6,
  not addressed by this fix).
- **Expect (negative):** Pressing Ctrl/Cmd+K again while the palette is open
  closes it rather than opening a second instance.
- **Trace:** `apps/desktop/src/app/CommandPalette.tsx` (cmdk + base-ui
  Dialog), `apps/desktop/src/styles/components/target-search.css`
  (`.alm-palette*`). PR #884 fixes #581 (unstyled palette, broken alias
  matching, dead keyboard nav/clicks — a focus-ownership race between the
  input's `autoFocus` and the dialog's own focus management left cmdk's
  already-correct keyboard/click handlers unreachable). Known gap G6 (dead
  routes, issue #617) remains open.

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
- **Expect:** By design, the detail panel closes and focus returns to the
  list. Today Escape does nothing on any `ListPageLayout`-based list page
  (Sessions, Calibration, Targets, Projects, Inbox, Archive) — the shared
  layout wires its close handler only to the panel's ✕ button `onClick`,
  with no keydown listener; only the ✕ closes the panel. Carried as Known
  gap G3, not claimed as working.
- **Expect (negative):** Escape never mutates the selected record or
  triggers any state transition — it only dismisses the panel (when
  dismissal is available).
- **Trace:** `apps/desktop/src/components/ListPageLayout.tsx`; Known gap G3.

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

- SC1: Ctrl/Cmd+K opens the palette from every page; 5 of the 8 routes
  listed in its Pages group resolve to an existing route today — the
  remaining 3 (`/review`, `/plans`, `/audit`) are dead links tracked as
  Known gap G6 (S1).
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

- G1: (dissolved 2026-07-15) — tracked as issue #747; Inbox has no keyboard shortcuts.
- G2: (dissolved 2026-07-15) — tracked as issue #797; Sidebar nav links lack focus-visible.
- G3: (dissolved 2026-07-15) — tracked as issue #771; list-page detail panels don't close on Escape.
- G4: (dissolved 2026-07-15) — tracked as issue #842; Activity log expand/collapse doesn't persist.
- G5: (dissolved 2026-07-15) — tracked as issue #844; Modal doesn't return focus on close.
- G6: (dissolved 2026-07-15; #581 resolved 2026-07-15 via PR #884, see S1)
  — tracked as issues #581 and #617; command palette unstyled (fixed) and
  dead routes (#617, still open).
- G7: (dissolved 2026-07-15) — tracked as issue #810; focus-ring token misapplied on three selectors.
- G8: (dissolved 2026-07-15) — tracked as issues #660 and #767; two overlays don't trap focus/Escape.

## Delta log

- **Δ2** 2026-07-15 · S1 · behavior-change
  The command palette now renders as a styled floating overlay, matches
  aliases client-side (reusing the Targets page's matcher), and its
  keyboard/click selection works reliably — a focus-ownership race
  previously left cmdk's keyboard/click handling unreachable. The 3 dead
  Pages-group routes are unaffected by this fix and remain open (#617).
  Evidence: PR #884 (fixes #581) · by: journey-scribe (intent-gated)
