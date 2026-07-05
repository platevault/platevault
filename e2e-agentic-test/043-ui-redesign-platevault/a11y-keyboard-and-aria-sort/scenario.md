# Verification — Cross-cutting a11y: keyboard navigation, aria-sort on the six sortable tables, overlay focus management

> Two-stage verification plan. Stage 1 = agent on the real Windows app via the
> Tauri MCP bridge (real backend; mock mode forbidden). Stage 2 = human
> keyboard/AT judgment pass in Claude Desktop, only after Stage 1 passes.
> Shared mechanics: `e2e-agentic-test/AGENT-RUNNER.md`.

## Convoy preconditions

- **Test 1.2 requires PR #415 merged** ("feat: single-column Archive page,
  richer Sessions list, and screen-reader sort announcements", branch
  `impl-043-polish-a`). On the pre-#415 base, `aria-sort` is deliberately NOT
  set anywhere (see the header comment in
  `apps/desktop/src/components/SortHeader.tsx`) — mark 1.2 BLOCKED, not FAIL.

## Scope and spec references

- Spec 043 §3 shared primitives: one shared `SortHeader` (`.alm-sorth`,
  button-in-th) across all list tables; PR #415 adds `aria-sort` on the
  enclosing `<th>` of the active column.
- The six sortable tables (PR #415 body): **Sessions, Inbox, Calibration
  (Masters), Projects, Targets, Archive**. Component files:
  `SessionsTable.tsx`, `InboxList.tsx`, `MastersTable.tsx`,
  `ProjectsTable.tsx`, `TargetsTable.tsx`, plus the Archive table from #415.
- Keyboard: primary flows must be operable without a mouse (buttons are real
  `<button>`s; nav items are links; palette is fully keyboard-driven).
- Overlays: command palette, confirm dialogs (e.g. Settings › Advanced restart
  confirms, plan-approval overlay, RemapRootDialog) must move focus in on
  open, trap Tab, close on Escape, and restore focus to the invoker.

## Preconditions (both stages)

1. Branch deployed + app launched with bridge overlay per AGENT-RUNNER.md;
   `VITE_USE_MOCKS=false`; setup completed.
2. Data present so tables render rows: at least a handful of ingested sessions
   / inbox items / one project / one target / one archived entry. If the
   library is empty, ingest the shared fixture set referenced in
   AGENT-RUNNER.md first; empty tables make sort assertions vacuous — record
   any table verified while empty as PASS-with-note "headers only".

## Stage 1 — Agent validation via Tauri MCP

### 1.1 Keyboard navigation of a primary flow (no mouse)

All input in this test goes through `webview_keyboard` only.

1. Focus start: `webview_execute_js` → `document.body.focus()`; then Tab
   repeatedly (bounded: give up after 40 tabs = FAIL) until focus is inside
   `nav.alm-sidebar`.
   - Expected: every sidebar item is reachable by Tab and shows a visible
     focus indicator (`getComputedStyle(document.activeElement)` outline /
     box-shadow is not `none`).
2. Press Enter on the Sessions item.
   - Expected: route becomes `/sessions` (link activates via keyboard).
3. Tab into the Sessions page: the search box, filter dropdowns, and every
   `.alm-sorth` header button must be focusable in a sensible order; activate
   one sort header with Enter and one with Space.
   - Expected: both keys toggle the sort (arrow glyph flips; row order
     changes).
4. Open the command palette with Ctrl+K, type `settings`... actually navigate
   via the Pages group to Settings with arrows + Enter (overlap with the
   palette scenario is intentional but minimal — here the assertion is
   keyboard-only reachability).
5. In Settings, Tab through the pane sub-nav; ArrowDown/Tab reach every pane
   button; Enter activates one.
6. FAIL if: any step needed a mouse, focus vanished (activeElement === body
   unexpectedly), or no visible focus indicator on interactive elements.

### 1.2 `aria-sort` on the six sortable tables (requires PR #415)

For EACH of the six tables — routes `/sessions`, `/inbox`, `/calibration`,
`/projects`, `/targets`, `/archive`:

1. Navigate to the route; wait for the table (`webview_wait_for` on a `table`
   containing `.alm-sorth` buttons).
2. Via `webview_execute_js` inspect all `th` elements of that table:
   - Expected: exactly ONE `th` carries `aria-sort`, valued `ascending` or
     `descending`, and it is the `th` whose `.alm-sorth` button has the
     `--active` class.
3. Click (or keyboard-activate) the SAME header: `aria-sort` on that `th`
   flips between `ascending`/`descending`, matching the visible arrow
   (▲ = ascending, ▼ = descending) and the actual first-row ordering.
4. Click a DIFFERENT column header: `aria-sort` moves to the new `th` (old one
   loses the attribute entirely — not `none`-valued leftovers on multiple
   columns; a literal `aria-sort="none"` on inactive sortable columns is also
   acceptable per ARIA, but two columns claiming ascending/descending at once
   is a FAIL).
5. Assert every `.alm-sorth` button has a non-empty `aria-label` of the form
   "Sort by <column>" (translated, no raw keys).
6. Screenshot checkpoint per table: `aria-sort-<route>.png` (6 total).
7. FAIL if: any table lacks `aria-sort` entirely (post-#415), the attribute
   sits on the button instead of the `th`, direction disagrees with the visual
   arrow or actual order, or multiple columns are simultaneously active.

### 1.3 Focus management in overlays/dialogs

Run this loop for THREE overlays: (a) command palette (Ctrl+K), (b) a confirm
dialog in Settings › Advanced (the "Restart first-run setup" confirm — cancel
it, do NOT confirm), (c) the plan-approval / any modal confirm reachable with
current data (e.g. Archive "Delete permanently" confirm — cancel it).

For each overlay:

1. Record `document.activeElement` (the invoker) before opening.
2. Open the overlay (keyboard where possible).
   - Expected: focus MOVES INTO the overlay (activeElement is inside the
     dialog/popup element; for the palette: its input).
3. Press Tab 15 times.
   - Expected: focus cycles WITHIN the overlay (never escapes to the sidebar
     or page behind).
4. Press Escape.
   - Expected: overlay closes AND focus returns to the invoking element (or a
     sensible ancestor — record exactly where it lands).
5. Assert the dialog element exposes `role="dialog"` (or is a native/Base-UI
   popup with equivalent semantics) and an accessible name (`aria-label` or
   `aria-labelledby`).
6. FAIL if: focus stays behind the overlay, Tab escapes it, Escape does not
   close, or focus is dropped to `<body>` after close.

### 1.4 Log check

`mcp__tauri__read_logs`: no error-level entries from any interaction above.

Stage 1 verdict: PASS only if 1.1, 1.3, 1.4 pass and 1.2 passes (or is BLOCKED
pre-#415). Any FAIL blocks Stage 2.

## Stage 2 — Final Claude Desktop pass

1. Unplug-the-mouse test: complete one real task end-to-end by keyboard only
   (e.g. navigate to Sessions, search, sort by Night, open a session's
   detail). Judge friction honestly: tab order sane, no keyboard traps, focus
   ring visible in BOTH a light and a dark theme (focus indicators are a
   common dark-theme casualty).
2. If Windows Narrator (or NVDA) is available: focus a sorted column header —
   it should announce the column name and "sorted ascending/descending"
   (that is what `aria-sort` exists for). Re-sort and confirm the announcement
   flips. If no screen reader is available, mark this item SKIPPED-with-note;
   the DOM assertions in Stage 1 remain the gate.
3. Overlay judgment: dialogs visually dim/scrim the background; the focused
   control on open is the least-destructive one (cancel-first for destructive
   confirms).
4. Sign-off with per-table notes and screenshots of one focused sort header
   and one open dialog.

Final verdict: PASS when both stages pass (re-run 1.2 after #415 merges if
BLOCKED).
