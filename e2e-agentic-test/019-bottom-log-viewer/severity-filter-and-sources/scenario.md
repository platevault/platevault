# Verification — Bottom log panel: severity filtering, multiple event sources, follow-tail, export

> Two-stage verification plan. Stage 1 = agent on the real Windows app via the
> Tauri MCP bridge (real backend; mock mode forbidden). Stage 2 = human visual
> pass in Claude Desktop, only after Stage 1 passes.
> Shared mechanics: `e2e-agentic-test/AGENT-RUNNER.md`.
> Companion scenario (do NOT duplicate): `e2e-agentic-test/019-bottom-log-viewer/
> event-source-class/scenario.md` already covers the per-row source CSS class
> and the layout-consumption check in click-by-click form.

## Scope and spec references (spec 019 bottom-log-viewer)

- FR-001/FR-002: full-width bottom fold-out panel that consumes layout space
  (does not overlay).
- FR-003: level filter covering `all`, `info`, `warn`, `error` (+ `debug`).
- FR-004/FR-005: Follow-tail is a panel control with remembered state; there is
  NO "follow logs by default" setting.
- FR-007: export is JSON only, no format picker.
- FR-009: bounded UI buffer (500 entries).
- FR-013: `source` is a closed enum: `audit | diagnostic | catalog | plan |
  workflow | lifecycle | inventory | settings | project | target | tool`.
- FR-014: `diagnostic` entries hidden unless log level is `debug` (and the
  debug-gated "Include diagnostics" toggle is on).
- Known gap (not a failure): `sourceFilter` exists in `LogPanelContext` and the
  filter logic honors it, but NO UI control sets it yet — only the LEVEL filter
  has chips. Do not hunt for a source-filter control.
- Source of truth: `apps/desktop/src/app/LogPanel.tsx`, `LogPanelContext.tsx`,
  `apps/desktop/src/data/logStore.ts`.

## Preconditions (both stages)

1. Branch deployed + app launched with bridge overlay per AGENT-RUNNER.md;
   `VITE_USE_MOCKS=false`; setup completed with ≥1 registered source.
2. Settings → Advanced → Log level is `Info` at start (default).

## Stage 1 — Agent validation via Tauri MCP

### 1.1 Expand / collapse consumes layout (FR-001/FR-002)

1. Measure the main content area height (`webview_execute_js`:
   `document.querySelector('.alm-frame__main').getBoundingClientRect().height`).
2. Click the bottom log strip's expand control; wait for the expanded panel.
3. Re-measure the main content height.
   - Expected: expanded panel spans the full window width; main content height
     SHRANK by roughly the panel height (layout consumption, not overlay).
   - FAIL if the content height is unchanged (overlay) or the panel is not
     full-width.
4. Press Escape → panel collapses to the strip. Re-open for the next tests.
5. Screenshot checkpoints: `logpanel-collapsed.png`, `logpanel-expanded.png`.

### 1.2 Generate entries from at least two distinct sources

1. With the panel open, go to Settings → Advanced and flip the Log level
   dropdown Info→Warn→Info (generates `settings`-source entries).
2. Go to Settings → Data Sources and toggle a source-protection override on
   one registered source, then back (generates `audit`-source entries).
   (The setup/sources lane owns deep Data Sources behavior; here it is only an
   event generator.)
3. Assert via DOM: the newest rows (newest-first ordering) include at least one
   row whose visible source label is `settings` and one whose label is `audit`.
   Every visible source label MUST be one of the 11 closed-enum values
   (FR-013).
   - FAIL if: no new rows appear (logging regression), or a source label
     outside the enum renders.

### 1.3 Severity filtering (FR-003)

1. Enumerate the filter chips in the panel header.
   - Expected: exactly All / Error / Warn / Info / Debug (translated labels;
     no raw `log_level_*` keys).
2. Click **Error**.
   - Expected: every remaining visible row has level `error`; if there are no
     error entries, an empty list (or empty-state) is shown — the
     settings/audit info rows from 1.2 MUST disappear.
3. Click **Info**.
   - Expected: the rows from 1.2 are visible again; no `warn`/`error`-only rows
     remain.
4. Click **All** → all buffered entries visible again.
5. Assert filter state resets to `All` after closing and reopening the panel
   (session-only filter, per LogPanel header comment).

### 1.4 Diagnostics gating (FR-014)

1. With Log level = `Info`: assert NO visible row has source `diagnostic`, and
   the "Include diagnostics" toggle is absent or inert per the debug gate.
2. Set Settings → Advanced → Log level to `Debug`. Assert the "Include
   diagnostics" control is now available in the panel; enable it. If
   diagnostic entries exist they must now render.
3. Restore Log level to `Info`.

### 1.5 Follow-tail state is remembered (FR-004/FR-005)

1. Toggle Follow off (or on — flip it from its current state). Close the panel,
   reopen it.
   - Expected: the Follow toggle retains the flipped state.
2. Assert Settings (all panes, especially Advanced) contains NO "follow logs by
   default" setting (FR-005) — a text search of the Advanced pane DOM is
   sufficient.
3. Restore Follow to on.

### 1.6 Export is JSON-only (FR-007)

1. Locate the Export control in the panel header.
   - Expected: activating it opens a native save dialog pre-filled with a
     `.json` filename (`astro-log-export-<ts>.json`) and a single JSON filter.
     There is NO format selector in the panel.
   - Native dialogs cannot be driven by the bridge: it is sufficient to assert
     the control exists and, if the dialog opens, cancel it. Full export
     content verification is a Stage 2 item.
2. `mcp__tauri__read_logs`: no error-level entries produced by this scenario's
   steps (an export-cancel must not log an error).

Stage 1 verdict: PASS only if 1.1–1.6 pass (known-gap notes allowed). Any FAIL
blocks Stage 2.

## Stage 2 — Final Claude Desktop pass

1. Complete one real export to disk; open the file: valid JSON array of
   entries, each carrying id (audit rows prefixed `aud:`), time, level, source,
   message.
2. Visual: expanded panel at 1100×720 in one light + one dark theme — chips,
   follow toggle, export control all visible without horizontal scrolling; row
   text legible; severity styling distinguishable (error vs info) in both
   themes.
3. Scroll behavior: with Follow on, new entries keep the list pinned to the
   newest; manually scrolling away pauses following (no jump-back fight).
4. Copy check: all header/chip/empty-state text is natural English, no raw
   keys.
5. Sign-off with screenshots (expanded panel, error-filter view) per theme.

Final verdict: PASS when both stages pass.
