---
id: J10
title: Configure appearance, per-library defaults, and trust the app is fully localized
version: 7
status: draft
last_reviewed: 2026-07-17
actors: [astrophotographer]
surfaces: [settings, shell, audit, framing]
interfaces: [desktop-ui]
trace:
  - pre-migration journey.md @ git 66026463
  - deltas/2026-07-14-q15-t122.md (folded — PR #826 / commit 0cdc81cc)
  - deltas/2026-07-14-q15-t126.md (not folded — still blocked, see Known gaps)
  - deltas/2026-07-14-q27-f11.md (folded 2026-07-17 — the R11a clustering
    tunables now ship in a real Settings → Framing pane, PR #927; see S10)
  - PR #927 (Settings → Framing pane: pointing/rotation/mosaic-envelope
    tunables)
  - docs/development/windows-journeys/journey-11-framing-clustering-attribution.md
  - spec 018 (settings configuration model)
  - spec 019 (bottom log viewer)
  - spec 021 (developer contract diagnostics)
  - spec 030 (UI audit revision, Q15 durable-audit unification)
  - spec 043 (UI redesign — shell, sort announcements)
  - spec 046 (i18n error codes)
  - spec 055 Phase 4 (whole-app engine zoom, T030/T032/T033)
  - PR #388 (Audit Log screen), PR #410 (audit detail localization),
    PR #415 (aria-sort), PR #826 (durable audit rows for settings/protection/
    equipment/source changes), commit 1f4ba13f (accessibility/theming pass)
  - PR #882 (merged, fixes #587) · PR #884 (merged, fixes #581)
  - PR #902 (merged, fixes #582, #583) · PR #909 (merged, fixes #584)
  - PR #914 (merged, carried nJ09c/nJ10a review nit: palette catalog
    caching)
  - spec 055 (typography rework) Phase 2, T010–T015
---

## Goal
The user configures the app's look, per-library behavior defaults, and
observing-planner tunables from one place, and can trust that every setting
they touch actually takes effect and survives a restart, and that nothing in
the interface — including error text and audit detail — ever shows them a raw
technical string. "Done" for a single settings change is: the control reflects
its new value immediately, a restart still shows that value, and (for
durable-data settings) the change is discoverable afterward in the Audit Log.

## Preconditions
- P1: Setup is complete with at least one registered source, so every pane
  has real data to act on.

Note: Release builds lack the /dev/contracts palette entry by design
(dev-tools compile-time gate, spec 021).

## Steps

### S1 — Open Settings and find a pane {#S1}
- **Do:** Navigate to Settings from the pinned sidebar entry.
- **Expect:** 14 panes are grouped into three sections — Library (Data
  Sources, Equipment, Ingestion, Naming & Structure, Target Resolution,
  Target Planner, Framing), Processing (Processing Tools, Calibration
  Matching, Cleanup, Source Views), and Application (Appearance, Advanced,
  Audit Log).
  ("Target Resolution" and "Appearance" are the displayed pane titles for
  the `catalogs` and `general` pane ids respectively — not "Catalogs"/
  "General".)
- **Expect:** Every pane auto-saves; no pane anywhere has a global "Save"
  button. In Target Resolution, the SIMBAD-resolution online toggle (both
  the compact and full render sites) shows a loading placeholder until its
  persisted value is fetched, rather than flashing its in-code default
  (previously ON) then snapping to the real value.
- **Trace:** apps/desktop/src/features/settings/SettingsPage.tsx (pane ids
  and nav groups), apps/desktop/messages/en.json:59,67 (displayed titles).
  PR #909 fixes #584
  (apps/desktop/src/features/settings/ResolverSettingsControl.tsx).

### S2 — Change an appearance setting {#S2}
- **Do:** In Appearance, pick a different theme, change density, change font
  size, and change the whole-app Zoom setting (or use Ctrl+= / Ctrl+- / Ctrl+0
  anywhere in the app, outside a text field).
- **Expect:** One of four named themes (Warm Clay, Warm Slate, Observatory,
  Espresso) or "System" (follows OS) applies live with no reload; the choice
  survives a full app restart (confirmed by a live Windows kill+relaunch
  test, docs/development/journey-run-2026-07-14.md). Density
  (compact/comfortable/spacious) rescales the `--alm-sp-*` spacing tokens
  (plus `--alm-row-height`); font size is a three-stop dial — Small/Default/
  Large writes a single integer `<html>` font-size of 12/14/16px (bumped
  from a 13px default) that the `--alm-text-*` type-scale tokens (rem,
  re-derived from the 14px default) resolve against app-wide, so every
  consuming surface (Sessions, Inbox, Calibration, sidebar/settings group
  labels, wizard fine print, the Planner SVG axis labels, the toast dismiss
  glyph — previously-hardcoded sizes included) scales together, not just the
  Targets table and wizard rows. Font size persists through the settings DB
  (with a localStorage boot cache) and survives a restart; it previously
  reset to default on every remount. Zoom is a separate, VS Code-style whole-app engine zoom that
  stacks with font size rather than replacing it: five steps (90/100/110/
  125/150%), default 100%. The Zoom select in Appearance and the Ctrl+=
  (also Ctrl+Shift+= and the numpad +) / Ctrl+- / Ctrl+0 shortcuts drive the
  same persisted choice; Ctrl+0 always resets to 100%. Zoom persists the
  same way as font size (settings DB + localStorage boot cache) and is
  re-applied once at startup.
- **Expect (negative):** The `--alm-row-height` token itself — the actual
  row *height* — is still consumed only by the Targets table, the
  wizard-step rows, and the Tonight sparkline's row minimum: Sessions,
  Inbox, and Calibration list rows do not get taller or shorter with
  density, even though their internal spacing now does. No computed text
  size is ever fractional or below the dial stop's documented floor (11px
  at Default; the previous fractional multiplier — e.g. `11.70px` at Small —
  and the 10px micro-size token are both gone). No first-paint flash of the
  previous theme on reload; not verified either way for theme/density
  specifically by this audit, but the same flash-of-default defect on
  another auto-saved toggle (the SIMBAD-resolution toggle in Target
  Resolution) is now fixed — see S1's Target Resolution pane, PR #909 fixes
  #584 (the toggle now shows a loading skeleton, never its in-code default,
  before the persisted value resolves). Zoom's engine call
  (`getCurrentWebview().setZoom`) is a Tauri-only API: in the browser dev
  server, vitest, and Playwright mock mode the call is a guarded no-op — the
  Zoom setting still persists and the control still reflects the chosen
  step, but the webview itself does not visually rescale outside a real
  desktop build. At the documented envelope edge (a min-size 1100×720
  window at 150% zoom, which is above the shipped 125% CI-pinned floor), the
  spec records the resulting ~733px CSS viewport as accepted layout
  degradation, not guarded — spec 054 (adaptive detail dock) is tracked
  separately (PR #937) and is not a dependency of this phase.
- **Trace:** apps/desktop/src/data/theme.ts (`applyTokenScale`,
  `applyDensity`, `applyFontSize`/`FontSizeChoice`/`FONT_SIZE_ROOT_PX`/
  `roundedTextScalePx`, `ZOOM_STEPS`/`useZoomChoice`/`setZoomChoice`/
  `applyZoom`/`stepZoomIn`/`stepZoomOut`/`resetZoom`),
  apps/desktop/src/app/Shell.tsx (Ctrl+=/-/0 `useHotkeys` bindings),
  apps/desktop/src/features/settings/General.tsx,
  apps/desktop/src-tauri/capabilities/default.json
  (`core:webview:allow-set-webview-zoom`),
  apps/desktop/src/styles/tokens.css (`--alm-text-*` rem scale),
  apps/desktop/src/styles/reset.css (`html { font-size: 14px }`),
  apps/desktop/src/styles/components/merges-1.css:556. PR #882 fixes #587:
  density previously only ever touched `--alm-row-height`; font size was
  fully inert local state with no layout effect at all. Spec 055 Phase 2
  (T010–T012) replaced the 0.9/1.0/1.15 fractional-px multiplier with the
  integer dial described above; Phase 4 (T030) adds Zoom.

### S3 — Change a durable-data setting and find it in the Audit Log {#S3}
- **Do:** Change a durable-data setting (e.g. add/remove an Equipment item),
  then open Audit Log.
- **Expect:** A new audit row exists for the change with a before→after
  value pair, actor `user`, and an outcome; the same is true for equipment
  create/delete, source register/enable/disable/delete/remap, and source
  protection set/acknowledge — actions that previously produced no durable
  row at all.
- **Expect (negative):** Rapidly typing into the Naming pattern builder and
  then committing produces exactly one audit row at the final value, not one
  per keystroke (the `pattern` descriptor is registered `noisy: true`).
  Toggling a UI-state-only key (e.g. "remember follow-logs") produces no
  audit row.
- **Trace:** PR #826 (commit 0cdc81cc); crates/app/settings/src/descriptors.rs
  (`pattern` key, `noisy: true`); crates/app/calibration/src/equipment.rs:140
  (`write_audit`). Caution: Calibration Matching's own tolerance fields are
  NOT a safe example for this step today — every save on that pane is
  silently rejected by an unrelated bug (issue #639, open,
  apps/desktop/src/features/settings/CalibrationMatching.tsx:92-97,
  `exposureToleranceS` hardcoded `null` fails backend deserialisation), and
  `calibration_tolerances_update` is not wired to `write_audit` at all
  (apps/desktop/src-tauri/src/commands/calibration_tolerances.rs).

### S4 — Confirm Ingestion settings persist but do not yet drive scans {#S4}
- **Do:** Toggle "Follow symbolic links", "Follow NTFS junctions", and file
  hashing mode in Ingestion; navigate away and back, then restart.
- **Expect:** Every toggle round-trips a pane switch and a restart.
- **Expect (negative):** No scan, watch, or ingest pipeline currently reads
  these values — toggling them does not change scan behavior (see Known
  gaps G2).

### S5 — Set the Target Planner's usable-altitude threshold {#S5}
- **Do:** In Target Planner, set the usable-altitude threshold (0–90°,
  default 30°).
- **Expect:** The input reflects the newly typed value once committed
  (blur/Enter).
- **Expect (negative):** As of this audit, out-of-range input (e.g. 150°) is
  **not** clamped at commit time, and the value does **not** survive a pane
  switch or app restart — it reverts to the 30° default (issue #823, open,
  filed 2026-07-14, same journey run; likely the same settings-descriptor
  gap as #822/#645). Whether an in-range change immediately affects the
  Targets planner table's imaging-time/visible-tonight columns within the
  same session (before persistence) is unverified by this audit.
- **Trace:** apps/desktop/src/features/settings/PlannerSettings.tsx,
  apps/desktop/src/features/targets/altitude-settings.ts,
  crates/app/settings/src/descriptors.rs (`usableAltitudeDeg`), issue #823

### S6 — Use the bottom log panel {#S6}
- **Do:** Expand the collapsible bottom log strip; filter by severity
  (Error/Warn/Info/Debug chips); lower the log level to Debug.
- **Expect:** Expanding shrinks the main content area rather than covering
  it. The severity filter is a floor, not an exact match — selecting Warn
  also shows Error rows (more severe), not just rows tagged exactly Warn.
  Deep diagnostics only appear once the log level is Debug. Sources are
  restricted to a fixed, known set. Each row shows the entity or request it
  relates to as visible text rather than requiring the reader to infer it.
  Exporting produces the visible log window as JSON via a native save
  dialog.
- **Expect (negative):** The panel does not read from the durable audit
  table (it is bus-backed only, see Known gaps G3) and does not durably
  persist reads or navigation.
- **Trace:** apps/desktop/src/app/LogPanel.tsx,
  apps/desktop/src/app/LogPanelContext.tsx. PR #902 fixes #582 (level
  filter was exact-match) and #583 (rows lacked visible entity/request
  context).

### S7 — Use the shell: sidebar, command palette, layout {#S7}
- **Do:** Collapse/expand the left sidebar; reload the app; open the command
  palette (Ctrl+K) and navigate to a listed page; resize the window to
  1100×720.
- **Expect:** Sidebar collapse state persists across reload and keeps
  per-item tooltips. Every page keeps its header/action bar pinned while
  only its content scrolls, down to 1100×720. The command palette now
  renders fully styled (a `.alm-palette*` floating overlay, not bare
  document flow); search matching is alias-aware and reuses the Targets
  page's own tested matcher (a compact query like "M31" now matches a
  spaced designation like "M 31"); arrow-key navigation and clicking a
  result both navigate reliably (a focus-ownership race between the
  input's autofocus and the dialog's own focus management previously could
  leave keyboard/click handling dead); the entity-search catalog is cached
  briefly across opens and only auto-refreshes after a short interval,
  rather than re-fetching in full on every open.
- **Expect (negative):** 3 of the palette's 8 listed routes (`/review`,
  `/plans`, `/audit`) still do not exist in the route tree and silently
  redirect when selected (issue #617, still open — not addressed by the
  styling/matching/keyboard fix below).
- **Trace:** apps/desktop/src/app/Sidebar.tsx,
  apps/desktop/src/app/CommandPalette.tsx, issue #617. PR #884 fixes #581
  (unstyled palette, broken alias matching, dead keyboard nav and clicks —
  all four were one focus-race + CSS-class + matcher defect, now fixed). PR
  #914 fixes a carried nJ10a-review nit: the palette no longer re-fetches
  the full target catalog on every open.

### S8 — Confirm no raw strings leak anywhere in the sweep {#S8}
- **Do:** Walk every pane and the log panel/audit log, including error and
  refusal states, in a non-English locale if available.
- **Expect:** Every user-facing string, including backend error codes and
  audit-log detail text for events emitted after PR #410, routes through the
  translation catalog. Every sortable table (Sessions, Inbox, Calibration,
  Projects, Targets, Archive) announces its active sort column/direction via
  `aria-sort` to assistive technology.
- **Expect (negative):** Audit-log rows emitted before PR #410 fall back to
  their originally stored English text rather than crashing or showing a raw
  key (decision D23, intentional).
- **Trace:** apps/desktop/src/components/SortHeader.tsx, PR #410, PR #415

### S9 — Use Danger controls and Restore defaults {#S9}
- **Do:** In Advanced, export settings via the native file dialog; use
  "Restart first-run setup" and "Restart guided flow" (two distinct
  controls); use "Reset preferences". In any pane offering "Restore
  defaults", use it.
- **Expect:** "Restart first-run setup" is confirm-gated (inline
  confirm/cancel) before it reopens the source-registration wizard.
  "Restore defaults" (8 adopting panes: Data Sources, Ingestion, Naming &
  Structure, Calibration Matching, Target Planner, Framing, Cleanup,
  Advanced) actually calls `settings.restore-defaults` or the pane's own
  reset and refetches, so the visible fields do change.
- **Expect (negative):** As of this audit, "Export database" and "Reset
  preferences" are `console.log` no-ops — no backend call, no file, no
  confirmation (issue #601, open,
  apps/desktop/src/features/settings/Advanced.tsx:148-149). "Restart guided
  flow" has no confirm gate at all, asymmetric with "Restart first-run
  setup" (issue #827, open). "Restore defaults" fires immediately on click
  with no confirmation step anywhere it is used, and never states which
  settings it is about to reset, so a user cannot tell whether a given
  instance resets a whole pane or one subsection of it (issues #802 and
  #837, both open, apps/desktop/src/features/settings/SettingsKit.tsx:142-186).
- **Trace:** apps/desktop/src/features/settings/Advanced.tsx,
  apps/desktop/src/features/settings/SettingsKit.tsx, issue #601,
  issue #802, issue #827, issue #837

### S10 — Tune framing clustering tolerances in the Framing pane {#S10}
- **Do:** In Library → Framing, change the pointing tolerance fraction, the
  no-equipment pointing fallback, the rotation tolerance, and the mosaic
  panel-matching envelope; commit each with blur or Enter; use its Restore
  Defaults control.
- **Expect:** On a fresh install the four fields read the R11a shipped
  defaults (0.1 fraction-of-FOV pointing tolerance, 0.2° no-equipment
  fallback, 3° rotation tolerance, 1.0 fraction-of-FOV mosaic envelope) with
  no global Save button, matching every other auto-save pane. Each committed
  value is clamped to its documented range (pointing fraction 0.01–2.0,
  fallback 0.01–10°, rotation 0.1–45°, mosaic envelope 0.1–5.0) and survives
  a pane switch and an app restart through the real settings store. Restore
  Defaults resets all four fields and re-fetches. These tunables drive the
  framing clustering used by a project's light-session grouping (J05) and
  the Inbox-confirm attribution ranking (J02/S5, J03/S2) — changing them
  here changes clustering/ranking outcomes on the next derivation, not
  retroactively for framings already marked `user_adjusted`.
- **Expect (negative):** This pane is the *only* real frontend UI this
  framing feature has — the framing list/merge/split/reassign surface and
  the Inbox-confirm attribution-candidate picker referenced by J02/S5 and
  J03/S2 do not exist in any page; editing these tunables has no visible
  effect anywhere else in the app within this same session. Tracked as
  issue #943.
- **Trace:** apps/desktop/src/features/settings/Framing.tsx,
  crates/app/settings/src/descriptors.rs (bounds),
  crates/sessions/src/clustering.rs, crates/app/inbox/src/attribution.rs
  (`tolerance_params`), tests/e2e/settings_framing.spec.ts,
  docs/development/windows-journeys/journey-11-framing-clustering-attribution.md.

## Success criteria
- SC1: Every control across all 14 panes does something observable,
  persists, and round-trips a pane switch (S1–S5, S9, S10).
- SC2: Durable-data settings/protection/equipment/source mutations each
  produce exactly one audit row per committed change, with none for
  UI-state-only keys (S3).
- SC3: Zero raw i18n keys or untranslated backend error/audit strings appear
  anywhere in a full-app sweep, and all six listed sortable tables expose
  `aria-sort` (S8).
- SC4: All panes remain usable at a window size of 1100×720 with the header/
  action bar pinned (S7).
- SC5: The app shell stays intact (sidebar, page bar, content all visible)
  with no horizontal overflow at the shipped zoom envelope's 125%/150%
  window×zoom pairs (S2); CI-pinned in
  tests/e2e/settings_appearance_i18n.spec.ts ("Whole-app zoom envelope
  pins").

## Known gaps
- G1: (dissolved 2026-07-15, resolved 2026-07-15) — tracked as issue #587;
  Appearance font-size control now persists and rescales the shared token
  layer, via PR #882 — see S2.
- G2: (dissolved 2026-07-15) — tracked as issue #878; no pipeline consumes ingestion settings yet.
- G3: (dissolved 2026-07-15) — tracked as issue #647; log panel not backed by durable audit table.
- G5: (dissolved 2026-07-15) — tracked as issue #647; close-check folded into #647.

## Delta log

- **Δ2** 2026-07-15 · S2 · behavior-change
  Density and font size now rescale the shared spacing/type-scale design
  tokens live, giving both a visible effect app-wide (not just the Targets
  table/wizard row-height token); font size now persists across a restart
  instead of resetting on every remount.
  Evidence: PR #882 (fixes #587) · by: journey-scribe (intent-gated)

- **Δ3** 2026-07-15 · S7 · behavior-change
  The command palette now renders styled, matches aliases the same way the
  Targets page does, and its keyboard/click selection works reliably (a
  focus-ownership race previously could leave it dead). The 3 dead
  Pages-group routes remain unfixed.
  Evidence: PR #884 (fixes #581) · by: journey-scribe (intent-gated)

- **Δ4** 2026-07-17 · S1, S9, +S10 · behavior-change
  A new Library → Framing pane (14th pane) surfaces the four R11a
  clustering-tolerance tunables (pointing fraction, no-equipment fallback,
  rotation tolerance, mosaic envelope) with auto-save and Restore Defaults —
  the only real UI the framing feature has today.
  Evidence: PR #927 · by: journey-scribe (intent-gated)

- **Δ5** 2026-07-17 · S1, S6, S7 · behavior-change
  Target Resolution's SIMBAD toggle now shows a loading placeholder instead
  of flashing its wrong in-code default before the persisted value loads.
  The log panel's severity filter is now a floor (Warn also shows Error)
  instead of an exact match, and rows show their related entity/request as
  visible text. The command palette now caches its target catalog briefly
  across opens instead of re-fetching in full every time.
  Evidence: PR #909 (fixes #584), PR #902 (fixes #582, #583), PR #914
  (carried nJ10a review nit, no matching issue) · by: journey-scribe
  (intent-gated)

- **Δ6** 2026-07-17 · S2 · behavior-change
  Font size is now a three-integer-stop dial (12/14/16px root, default
  bumped from 13px) instead of a 0.9/1.0/1.15 fractional-px multiplier; the
  `--alm-text-*` scale is rem-derived so every stop's computed size is
  integer, never fractional, with an 11px floor guaranteed at Default. The
  11 previously-hardcoded px sizes (sidebar/settings group labels, wizard
  titles/fine print, Planner SVG axis text, toast glyph) now scale with the
  dial too.
  Evidence: spec 055 Phase 2 (T010–T012) · by: journey-scribe (intent-gated)
- **Δ7** 2026-07-17 · S2, +SC5 · behavior-change
  Appearance gains a whole-app engine Zoom control (VS Code-style, stacks
  with Font Size rather than replacing it): five steps (90/100/110/125/
  150%), default 100%, driven by a new Zoom select and by app-owned
  Ctrl+= (+ Ctrl+Shift+= / numpad +) / Ctrl+- / Ctrl+0 keyboard shortcuts
  (window-local `tinykeys` bindings, not Tauri global shortcuts). Zoom
  persists the same way as font size (settings DB write-through + a
  localStorage boot cache) and is re-applied once at startup, right after
  font size. The engine write uses Tauri's `setZoom` (true WebView2/
  WKWebView/WebKitGTK layout zoom, not CSS `zoom`); since WebView2 exposes
  no zoom-change event, the app always writes the value from its own state
  and never reads it back from the engine. Outside a real desktop build
  (browser dev server, vitest, Playwright mock mode) the engine call is a
  guarded no-op — the setting still persists and the control still reflects
  the chosen step. Max zoom is capped at 150% (user decision 2026-07-17);
  spec 054 (adaptive detail dock) is tracked separately (PR #937), not a
  dependency here, and the resulting layout
  degradation at min-window (1100×720) × 150% is documented and accepted,
  not guarded. Two CI pins cover the accepted envelope: 1100×720×125% and
  1320×864×150%, both emulated in mock mode as an 880×576 viewport (no
  engine zoom in mock mode, so a pre-shrunk viewport stands in for the
  zoomed CSS viewport) — shell (sidebar, page bar, content) stays intact
  with no horizontal overflow at either pin.
  Evidence: spec 055 Phase 4 (T030/T032), branch feat/app-zoom (PR not yet
  merged at authoring time) · by: journey-scribe (intent-gated)
