# Verification — Settings: every pane renders; Ingestion persistence; Target Planner usable-altitude

> Two-stage verification plan. Stage 1 = agent on the real Windows app via the
> Tauri MCP bridge (real backend; mock mode forbidden). Stage 2 = human visual
> pass in Claude Desktop, only after Stage 1 passes.
> Shared mechanics: `e2e-agentic-test/AGENT-RUNNER.md`.
> Coordination: Data Sources pane depth (add/remove/rescan/remap roots,
> protection overrides) is owned by the setup/sources lane — see their
> scenarios under `e2e-agentic-test/003-first-run-source-setup/`. Here Data
> Sources is only smoke-checked for render. Appearance is covered by
> `e2e-agentic-test/018-settings-configuration-model/appearance-themes/`.

## Scope and spec references

- Spec 018 FR-001..FR-004 (plain labels, one setting per line, info
  affordance, auto-save with no global Save button), FR-013 (log settings
  minimalism).
- Spec 030 P12 (Ingestion pane backed by dedicated
  `ingestion.settings.get`/`ingestion.settings.update` commands; invoke names
  `ingestion_settings_get` / `ingestion_settings_update`).
- Spec 044 (Target Planner pane, usable-altitude threshold; persisted in
  localStorage `alm:planner:usableAltDeg`, clamped 0–90, default 30).
- Source of truth: `apps/desktop/src/features/settings/SettingsPage.tsx`,
  `Ingestion.tsx`, `PlannerSettings.tsx`,
  `apps/desktop/src/features/targets/altitude-settings.ts`.

Ground truth — the Settings sub-nav MUST show exactly these panes in these
groups (12 panes, 3 groups):

| Group | Panes (order) |
|---|---|
| Library | Data Sources (`sources`), Equipment, Ingestion, Naming, Catalogs, Planner |
| Processing | Tools, Calibration (`cal`), Cleanup |
| Application | General, Advanced, Audit Log (`audit`) |

Active pane button carries `alm-settings__nav-item--active` +
`aria-current="page"`. The detail area is `[data-testid="SettingsPage"]`. An
auto-save "Saved" indicator (`.alm-settings__saved-indicator`,
`aria-live="polite"`) appears after scope-based saves.

Ingestion known consumer status (report, don't fail): the persisted values are
durable but no scan pipeline reads them yet (P12 note in `Ingestion.tsx`).

## Preconditions (both stages)

1. Branch deployed + app launched with bridge overlay per AGENT-RUNNER.md;
   `VITE_USE_MOCKS=false`; setup completed with ≥1 source root.

## Stage 1 — Agent validation via Tauri MCP

### 1.1 Pane inventory and routing

1. Navigate to Settings. Enumerate `.alm-settings__nav-group` blocks and their
   `.alm-settings__nav-item` buttons.
   - Expected: exactly the 12 panes / 3 groups from the table, in order, with
     translated labels (no raw `settings_nav_pane_*` keys).
2. Click EVERY pane once, in order. After each click assert:
   a. The clicked button has `aria-current="page"` and the active class; no
      other button does.
   b. The header subtitle updates to the pane's title.
   c. `[data-testid="SettingsPage"]` contains rendered controls (child element
      count > 0) — not blank, no error boundary text
      (search DOM for "Something went wrong" / stack traces).
3. Deep link: navigate the router to `/settings/planner` (via
   `webview_execute_js` history push or the palette). Assert the Planner pane
   is the active pane on load.
4. Screenshot checkpoints: `settings-nav.png`, plus `pane-<id>.png` for any
   pane that shows anything anomalous.
5. FAIL if: a pane is missing/extra/blank, errors, or deep-linking lands on
   the wrong pane.

### 1.2 Global auto-save convention (spec 018 FR-004)

1. Assert NO pane renders a global "Save" button (scan each pane's DOM for a
   submit-style Save/Apply control; per-row action buttons like "Restore
   defaults", "Export", "Add" are fine).
2. On a scope-saved pane (e.g. Calibration), change one value and assert the
   "Saved" indicator appears in the top bar and the element has
   `aria-live="polite"`.

### 1.3 Ingestion pane persists via its dedicated IPC pair

1. Open the Ingestion pane. Start `mcp__tauri__ipc_monitor`.
2. Reload the webview, reopen Settings → Ingestion. `ipc_get_captured`:
   - Expected: an `ingestion_settings_get` invoke returning `Ok` with fields
     `scanOnStartup`, `followSymlinks`, `followJunctions`, `hashingMode` (plus
     unrendered fields such as `watcherEnabled`).
3. Toggle **Follow symbolic links** (default false → true).
   - Expected: ONE `ingestion_settings_update` invoke whose request carries
     `followSymlinks: true` AND round-trips the unrendered fields unchanged
     (no field dropped — clobber guard).
4. Change **File hashing** to `eager`. Expected: another update invoke with
   `hashingMode: "eager"`.
5. Full restart persistence: kill and relaunch the app (per AGENT-RUNNER.md),
   return to the pane.
   - Expected: Follow symbolic links still ON, hashing still `eager` (values
     came back from `ingestion_settings_get`, not defaults).
6. Click **Restore defaults**.
   - Expected: an update invoke with the documented defaults
     (`scanOnStartup: true`, `followSymlinks: false`, `followJunctions: false`,
     `hashingMode: "lazy"`) and the UI reflects them.
7. FAIL if: any invoke errors, persistence does not survive restart, or
   restore-defaults leaves stale values.

### 1.4 Target Planner usable-altitude threshold (spec 044)

1. Open the Planner pane. Assert one numeric input (0–90, step 1) with an
   aria-label and a degree unit label; default value 30 on a fresh profile.
2. Type `45` and press Enter.
   - Expected: `localStorage.getItem('alm:planner:usableAltDeg') === '45'`.
3. Clamp check: type `120`, blur the field.
   - Expected: field self-corrects to `90`; localStorage holds `90`.
4. Non-numeric check: type `abc`, blur. Expected: field reverts to the stored
   value (`90`); localStorage unchanged.
5. Effect check: navigate to Targets → Planner view and confirm the
   imaging-time/visible-tonight column reacts to the threshold (set 90 → far
   less/none usable time than at 30 for the same target list). NOTE: the
   displayed planner values are the spec 044 interim model — assert only that
   they CHANGE with the threshold, not their astronomical accuracy.
6. Reload the webview: pane shows `90` (localStorage persistence). Then
   restore `30`.
7. FAIL if: clamping, persistence, or the reactive effect is absent.

### 1.5 Log check

`mcp__tauri__read_logs`: no error-level entries from the pane sweep or the
persistence round-trips.

Stage 1 verdict: PASS only if 1.1–1.5 pass. Any FAIL blocks Stage 2.

## Stage 2 — Final Claude Desktop pass

1. Walk all 12 panes at 1100×720 in one light + one dark theme: every pane
   honors the settings layout (one setting per line, label left / control
   right, info affordance per row — spec 018 FR-002/FR-003); nothing clipped
   or overflowing; group titles legible.
2. The pane sub-nav + content both scroll independently where needed; the
   Settings top bar stays pinned (layout convention).
3. Copy check: labels are plain user vocabulary (no internal jargon, spec 018
   FR-001); info texts actually explain the setting.
4. Ingestion + Planner: toggles/inputs feel immediate; the Saved indicator (or
   silent auto-save) never demands a manual save.
5. Sign-off with screenshots of at least Data Sources, Ingestion, Planner,
   Advanced, Audit Log panes.

Final verdict: PASS when both stages pass.
