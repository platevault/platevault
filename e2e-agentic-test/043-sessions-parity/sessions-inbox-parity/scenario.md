# Sessions — Inbox interaction parity (row identity, virtualization, filters, testids)

> Two-stage verification plan for the Sessions list reaching Inbox-level
> interaction parity (spec 043 §4, delivered by PR #415). Stage 1: agent via
> Tauri MCP bridge on the real Windows app. Stage 2: Claude Desktop human
> pass after Stage 1 PASS. Real backend required (`VITE_USE_MOCKS=false`).
> Shared mechanics: `e2e-agentic-test/AGENT-RUNNER.md`.

## Feature facts (context)

- Spec 043 §4 "Sessions" (Inbox is the interaction reference for list
  pages) + spec 041 FR-051 (review-state machine removed — no State column,
  no review filter). PR #415 (`impl-043-polish-a`, base
  `redesign-ui-platevault`) delivers:
  - FLAT default view shows each row's TARGET IDENTITY in the Target cell
    (previously blank when ungrouped) and drops the stray synthetic "ALL"
    header row.
  - New Filter + Camera single-select dropdowns beside search (options
    derived from the UNFILTERED inventory so picking one never removes the
    other's options).
  - Windowed rendering via the shared Table `virtualized` mode with a
    sticky header (testid `sessions-virtual-sizer`).
  - Per-row stable testid `sessions-row-<id>`; wrapper `sessions-list`;
    grouped-mode footer hint `sessions-grouping-hint` ("Grouped by Target ›
    Filter"); group headers `sessions-group-<dimension>-<key>`.
  - `aria-sort` on the active column `<th>` via shared `ariaSortFor`.
- Surface: `apps/desktop/src/features/sessions/SessionsPage.tsx`,
  `SessionsTable.tsx`. Columns: Target · Filter · Frames · Integration ·
  Night · Camera · Projects. Default sort: night desc.
- IPC: `inventory_list` `{ req: { filters… } }` → grouped inventory
  (sources → sessions). Sessions are DERIVED inventory — they exist only
  after light frames were ingested through the Inbox.
- Inbox parity references (for the side-by-side checks): Inbox uses
  `inbox-list`, `inbox-grouping-hint`, `inbox-group-<dimension>-<key>`.

### Convoy preconditions

- **Requires PR #415 merged into `redesign-ui-platevault`.** If not merged,
  report the whole scenario `BLOCKED — PR #415 not merged`; do not run
  against the base branch (the parity features do not exist there).

## Preconditions

1. Branch `redesign-ui-platevault` (post-#415) deployed on
   `C:\dev\astro-plan`; PR #415 is frontend-only, but reset+rebuild per
   AGENT-RUNNER.md anyway (other convoy PRs may have touched Rust).
2. Fresh DB + setup completed, THEN ingest real light frames so sessions
   exist: run the fixture generator on Windows and ingest via the Inbox —
   follow the **calibration journey scenario Preconditions + Phase 1**
   (`e2e-agentic-test/journeys/calibration-journey-ingest-to-match/scenario.md`),
   which produces ≥ 2 sessions with distinct targets (M 42 / NGC 7000),
   filters (Ha / OIII), and one camera. Minimum bar for this scenario:
   **≥ 2 sessions, ≥ 2 distinct targets, ≥ 2 distinct filters**.
3. Bridge connected; IPC capture on.

## Stage 1 — Agent validation via Tauri MCP

### Test 1 — Flat default: row identity + no synthetic header

1. Navigate to **Sessions**. Ensure Group-by is empty (clear any persisted
   dims — the control lives in the top bar; storage key
   `sessions.grouping.dims.v1`).
2. `webview_execute_js`:
   ```js
   (() => ({
     list: !!document.querySelector('[data-testid="sessions-list"]'),
     rows: [...document.querySelectorAll('[data-testid^="sessions-row-"]')].length,
     groups: [...document.querySelectorAll('[data-testid^="sessions-group-"]')].length,
     hint: !!document.querySelector('[data-testid="sessions-grouping-hint"]'),
     firstRowText: document.querySelector('[data-testid^="sessions-row-"]')?.textContent.trim().slice(0,120),
   }))();
   ```
Expected:
- `list: true`; `rows ≥ 2`; `groups === 0` (NO synthetic "ALL" header);
  `hint: false` (no grouping hint when flat).
- Every row's Target cell shows its target name (M 42 / NGC 7000 …) — the
  first cell is NOT empty in flat mode. 📸 checkpoint.
FAIL if: any `sessions-group-` testid exists while dims are empty, rows lack
the `sessions-row-<id>` testid, or Target cells are blank when flat.

### Test 2 — Row identity matches the backend payload

1. Capture the `inventory_list` response (ipc_get_captured) and pick one
   session `{ id, target, filter, frames, camera }`.
2. Assert the DOM row `[data-testid="sessions-row-<id>"]` contains that
   target, filter, frames count, and camera text.
Expected: exact text match per field (missing backend values render `—`).
FAIL if: the row shows values from a DIFFERENT session (row-identity bug) or
formats frames/integration wrongly vs payload.

### Test 3 — Virtualized viewport with sticky header

1. Assert `[data-testid="sessions-virtual-sizer"]` exists (shared Table
   windowed scroll container).
2. If the ingested corpus is small (a handful of sessions), windowing cannot
   be exercised by count; instead verify the structure: the scroll container
   scrolls while the `<thead>` stays visible (scroll the container via JS
   and screenshot).
3. If ≥ ~100 sessions are available (optional bulk fixture), also assert
   rendered `sessions-row-` count < total sessions.
Expected: sizer present; header sticky during scroll; only the list
scrolls, the top bar never moves.
FAIL if: the sizer testid is missing (means the table did not adopt the
shared virtualized mode) or the header scrolls away.

### Test 4 — Filter + Camera dropdowns (Inbox-parity toolbar)

1. In the top bar, locate the **Filter** and **Camera** selects (next to
   search). Read their options.
2. Select filter `Ha`. Assert only Ha sessions remain (check each visible
   row's filter cell) and the row count drops accordingly.
3. With Ha active, open the Camera select: its options must still list ALL
   cameras from the unfiltered inventory (options derived pre-filter).
4. Set Camera to the fixture camera; then set Filter back to All.
5. Combine with search: type a target name; verify search AND field filters
   compose (intersection).
Expected: as inline; clearing all filters restores the full list.
FAIL if: either dropdown is missing (parity feature absent), options vanish
based on the other filter, or filters don't compose with search.

### Test 5 — Grouping parity: headers, indent, hint footer

1. Set Group-by to **Target**, then a second dimension **Filter**.
2. Assert `sessions-group-target-*` and nested `sessions-group-filter-*`
   headers exist, leaf rows are indented, and the footer hint
   `sessions-grouping-hint` reads the localized equivalent of
   "Grouped by Target › Filter".
3. Collapse a target group (click header; `aria-expanded` flips) — its
   children AND nested filter groups hide.
4. Clear grouping → headers and hint disappear, flat rows return.
Expected: as inline. 📸 while grouped.
FAIL if: hint missing/wrong order, collapse leaves orphan children, or
clearing leaves the synthetic header.

### Test 6 — aria-sort on the active `<th>`

1. `webview_execute_js`:
   ```js
   (() => [...document.querySelectorAll('.alm-sessions-table th[aria-sort]')]
     .map(th => [th.textContent.trim(), th.getAttribute('aria-sort')]))();
   ```
2. Click the **Night** header (default active desc) once; re-run.
3. Click **Target**; re-run.
Expected: exactly ONE th carries aria-sort at all times; Night starts
`descending`; toggling flips to `ascending`; switching column moves the
attribute to Target with `ascending`.
FAIL if: zero/multiple aria-sort headers or stale direction.

### Test 7 — Selection opens the detail without losing list state

1. With filter `Ha` + sort Target asc applied, click a row.
2. Assert URL gains `?selected=<id>`, the SessionDetail panel opens, and the
   list retains the filter + sort + scroll state.
3. Close the detail; row's selected styling clears.
Expected: as inline.
FAIL if: selecting resets filters/sort or the detail shows a different
session than the clicked row id.

**Stage 1 verdict**: PASS = Tests 1–7 green + no new ERROR logs
(`read_logs`).

## Stage 2 — Final Claude Desktop pass (only after Stage 1 PASS)

Window 1100×720; run in Warm Slate AND Observatory themes.

1. **Parity feel**: put Inbox and Sessions side by side (navigate between
   them): same table density, same group-header styling, same footer-hint
   placement, same toolbar rhythm (search → field filters → group-by). Judge
   whether a user would perceive them as the same list system.
2. **Layout discipline**: top bar pinned; ONLY the table scrolls; the
   grouping hint footer stays pinned below the list; detail panel does not
   push the action bar off-screen at 1100×720.
3. **Row identity readability**: in flat mode the target names make the list
   scannable without grouping — judge column width balance (Target should
   not truncate common designations).
4. **Empty/edge states**: apply a filter combination with no matches — the
   empty copy is localized and helpful; clearing is obvious.
5. **i18n**: dropdown labels, hint footer, empty states — no raw keys.
6. Sign-off with screenshots (flat, grouped, filtered, detail open; both
   themes).

## Verdict rubric

- **PASS**: all Stage 1 tests green + Stage 2 signed off.
- **BLOCKED**: PR #415 unmerged.
- **FAIL**: missing parity features (testids/filters/virtualized viewport),
  row-identity mismatches vs `inventory_list` payload, aria-sort violations,
  layout/i18n violations.
- Report per test PASS/FAIL/BLOCKED + the verbatim JS-probe outputs for
  Tests 1, 2, 6.
