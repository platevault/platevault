> **MIGRATED:** current truth now lives at
> `docs/journeys/J10-settings-appearance-i18n/journey.md`. This file and
> its deltas are frozen legacy history.

## Journey 10 — Settings, appearance, and i18n

**Goal:** configure the app's look and feel, per-library behavior defaults,
and confirm the app is fully localized with no raw technical strings leaking
to the user.

**Preconditions:** setup completed with at least one registered source.

**Narrative flow:**

1. **Settings** groups 12 panes into three sections — Library (Data Sources,
   Equipment, Ingestion, Naming, Catalogs, Planner), Processing (Tools,
   Calibration, Cleanup), and Application (General, Advanced, Audit Log).
   Every pane auto-saves; there is no global "Save" button anywhere.
2. **Appearance** (General pane) offers four named themes plus a
   "System"-follows-OS option; switching applies live (no reload needed) and
   survives a full app restart. Density and font-size preferences live here
   too, though font-size is currently visual-only and not yet wired to
   anything outside the pane (see Known gaps).
3. **Ingestion** settings (symlink-following, hashing eagerness) persist
   through a dedicated backend round-trip and survive a restart, though no
   scan pipeline reads them yet.
4. **Target Planner** exposes a single "usable altitude" threshold
   (0–90°, default 30°) that clamps out-of-range input and immediately
   affects the (currently stub) Targets planner view.
5. The **bottom log panel** (collapsible strip) is a layout participant, not
   an overlay — expanding it shrinks the main content area rather than
   covering it. It filters by severity (chips for Error/Warn/Info/Debug),
   restricts sources to a fixed, known set, only shows deep diagnostics once
   the log level is turned down to Debug, and exports the visible log window
   as JSON only.
6. Cross-cutting to every page: a left sidebar groups Capture/Library/Work
   destinations plus a pinned Settings entry, with route-driven active
   states and a collapse/expand that persists; a global command palette
   (Ctrl+K) jumps to pages or live-searches the backend for targets/sessions/
   etc.; every page keeps its header/action bar pinned while only its content
   scrolls, at a minimum supported window size of 1100×720; and every
   user-facing string — including backend error codes and audit-log detail
   text — routes through the translation catalog rather than leaking a raw
   key or an English-only backend string.

**Touch & validate:**

- Exhaustive control sweep: every pane, every control — each toggle, select,
  number field, chip editor, table CRUD form, and dialog must (a) do
  something observable, (b) persist, and (c) round-trip (navigate away and
  back, restart where cheap). A control that does nothing is a journey
  failure, not a cosmetic note.
- Appearance: all themes incl. System-follows-OS apply live and survive
  restart; density and font-size changes have a measurable effect on at
  least the main list surfaces; no first-paint flash of a wrong toggle
  state anywhere in Settings.
- Restore defaults (each pane that has it): states its scope; resets only
  settings visible in that pane; answers back.
- Naming & Structure: the live preview resolves every token of the default
  pattern from the sample metadata — a fallback warning on the default
  configuration fails the run; chip edits (add token/separator/literal,
  reset) update the preview live and persist.
- Target Resolution: online toggle, endpoint, debounce, and timeout persist
  and gate the resolver; catalogue toggles round-trip and demonstrably
  change what Add target and the planner initialize from.
- Processing Tools: path edits validate (a missing executable is flagged)
  and preserve the tool's enabled/disabled state; Re-detect answers back
  even when nothing new is found.
- Cleanup: each per-type action choice (Keep/Archive/Trash) round-trips a
  pane switch, and its warning banner reflects the persisted state.
- Danger controls (Advanced): export produces a real file via a native
  dialog with a confirmation; reset-preferences actually resets and
  confirms; restart-first-run and restart-guided-flow are confirm-gated and
  distinct.
- Audit Log: search, date range (including a range that excludes all
  events), pagination, export; every filesystem-mutating action from other
  journeys is findable here with outcome and actor.
- Log panel: severity chips act as documented, follow toggles, export
  works, entity cross-links land on the entity selected, expand shrinks
  (never overlays) the content area.
- Shell: sidebar collapse persists and keeps per-item tooltips; palette
  (Ctrl/⌘+K) opens styled, navigates, and every listed route exists; all
  panes usable at 1100×720; no raw i18n keys or untranslated backend codes
  anywhere in the sweep.

**Safety & trust notes:** none of this journey involves filesystem mutation,
but its correctness (i18n coverage, layout convention, focus management)
underpins how trustworthy every other journey *feels* — a raw error code or a
broken layout during a destructive-plan review undermines the safety story
the rest of the app is built on.

**Scenario files:**
`e2e-agentic-test/018-settings-configuration-model/appearance-themes/scenario.md`,
`.../panes-and-persistence/scenario.md`,
`e2e-agentic-test/019-bottom-log-viewer/severity-filter-and-sources/scenario.md`,
`.../event-source-class/scenario.md`,
`e2e-agentic-test/043-ui-redesign-platevault/shell-left-nav/scenario.md`,
`.../global-search-command-palette/scenario.md`,
`.../layout-convention-1100x720/scenario.md`,
`.../a11y-keyboard-and-aria-sort/scenario.md`,
`e2e-agentic-test/046-i18n-error-codes/no-raw-keys-and-translated-errors/scenario.md`.

**Known gaps (2026-07-04):**
- Appearance's **Font size** control is component-local state only — it
  changes nothing outside the settings pane it lives in.
- The Ingestion settings pane persists values no scan pipeline currently
  consumes.
- Audit-log detail text now localizes correctly for the standard case (PR
  #410, merged) — but only for events emitted after that fix; historical
  rows fall back to their originally stored English text (documented as
  intentional, decision D23).
- `aria-sort` announcements across the app's six sortable tables require
  **PR #415** (open); pre-#415, `aria-sort` is deliberately unset anywhere.
- A `/dev/contracts` command-palette entry exists only in developer-mode
  builds (compile-time gated off in release, per spec 021) — its absence in
  a release build is expected, not a bug.
