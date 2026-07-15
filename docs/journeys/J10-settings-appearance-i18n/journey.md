---
id: J10
title: Configure appearance, per-library defaults, and trust the app is fully localized
version: 3
status: draft
last_reviewed: 2026-07-14
actors: [astrophotographer]
surfaces: [settings, shell, audit]
interfaces: [desktop-ui]
trace:
  - pre-migration journey.md @ git 66026463
  - deltas/2026-07-14-q15-t122.md (folded — PR #826 / commit 0cdc81cc)
  - deltas/2026-07-14-q15-t126.md (not folded — still blocked, see Known gaps)
  - deltas/2026-07-14-q27-f11.md (not folded — R11a clustering tunables exist
    in the backend, crates/sessions/src/clustering.rs, but are not yet
    surfaced in any Settings pane; flagged in report for user confirmation)
  - spec 018 (settings configuration model)
  - spec 019 (bottom log viewer)
  - spec 021 (developer contract diagnostics)
  - spec 030 (UI audit revision, Q15 durable-audit unification)
  - spec 043 (UI redesign — shell, sort announcements)
  - spec 046 (i18n error codes)
  - PR #388 (Audit Log screen), PR #410 (audit detail localization),
    PR #415 (aria-sort), PR #826 (durable audit rows for settings/protection/
    equipment/source changes), commit 1f4ba13f (accessibility/theming pass)
  - PR #882 (merged, fixes #587) · PR #884 (merged, fixes #581)
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
- **Expect:** 13 panes are grouped into three sections — Library (Data
  Sources, Equipment, Ingestion, Naming & Structure, Target Resolution,
  Target Planner), Processing (Processing Tools, Calibration Matching,
  Cleanup, Source Views), and Application (Appearance, Advanced, Audit Log).
  ("Target Resolution" and "Appearance" are the displayed pane titles for
  the `catalogs` and `general` pane ids respectively — not "Catalogs"/
  "General".)
- **Expect:** Every pane auto-saves; no pane anywhere has a global "Save"
  button.
- **Trace:** apps/desktop/src/features/settings/SettingsPage.tsx (pane ids
  and nav groups), apps/desktop/messages/en.json:59,67 (displayed titles)

### S2 — Change an appearance setting {#S2}
- **Do:** In Appearance, pick a different theme, change density, and change
  font size.
- **Expect:** One of four named themes (Warm Clay, Warm Slate, Observatory,
  Espresso) or "System" (follows OS) applies live with no reload; the choice
  survives a full app restart (confirmed by a live Windows kill+relaunch
  test, docs/development/journey-run-2026-07-14.md). Density
  (compact/comfortable/spacious) and font size both rescale the shared
  design-token layer live — density rescales the `--alm-sp-*` spacing tokens
  (plus `--alm-row-height`), font size rescales the `--alm-text-*` type-scale
  tokens — consumed by component stylesheets app-wide, so both now have a
  visible effect across surfaces (paddings, gaps, and text size on Sessions,
  Inbox, Calibration, etc.), not just the Targets table and wizard rows.
  Font size persists through the settings DB (with a localStorage boot
  cache) and survives a restart; it previously reset to default on every
  remount.
- **Expect (negative):** The `--alm-row-height` token itself — the actual
  row *height* — is still consumed only by the Targets table, the
  wizard-step rows, and the Tonight sparkline's row minimum: Sessions,
  Inbox, and Calibration list rows do not get taller or shorter with
  density, even though their internal spacing now does. No first-paint
  flash of the previous theme on reload (flash-of-default is a documented
  issue for at least one other auto-saved toggle, issue #584, open — not
  verified either way for theme/density specifically by this audit).
- **Trace:** apps/desktop/src/data/theme.ts (`applyTokenScale`,
  `applyDensity`, `applyFontSize`/`FontSizeChoice`),
  apps/desktop/src/features/settings/General.tsx,
  apps/desktop/src/styles/tokens.css:157-158,
  apps/desktop/src/styles/components/merges-1.css:556. PR #882 fixes #587:
  density previously only ever touched `--alm-row-height`; font size was
  fully inert local state with no layout effect at all.

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
  it. Deep diagnostics only appear once the log level is Debug. Sources are
  restricted to a fixed, known set. Exporting produces the visible log
  window as JSON via a native save dialog.
- **Expect (negative):** The panel does not read from the durable audit
  table (it is bus-backed only, see Known gaps G3) and does not durably
  persist reads or navigation.
- **Trace:** apps/desktop/src/app/LogPanel.tsx

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
  leave keyboard/click handling dead); the entity-search catalog is fetched
  fresh each time the palette opens rather than eagerly at app boot.
- **Expect (negative):** 3 of the palette's 8 listed routes (`/review`,
  `/plans`, `/audit`) still do not exist in the route tree and silently
  redirect when selected (issue #617, still open — not addressed by the
  styling/matching/keyboard fix below).
- **Trace:** apps/desktop/src/app/Sidebar.tsx,
  apps/desktop/src/app/CommandPalette.tsx, issue #617. PR #884 fixes #581
  (unstyled palette, broken alias matching, dead keyboard nav and clicks —
  all four were one focus-race + CSS-class + matcher defect, now fixed).

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
  "Restore defaults" (7 adopting panes: Data Sources, Ingestion, Naming &
  Structure, Calibration Matching, Target Planner, Cleanup, Advanced)
  actually calls `settings.restore-defaults` or the pane's own reset and
  refetches, so the visible fields do change.
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

## Success criteria
- SC1: Every control across all 13 panes does something observable,
  persists, and round-trips a pane switch (S1–S5, S9).
- SC2: Durable-data settings/protection/equipment/source mutations each
  produce exactly one audit row per committed change, with none for
  UI-state-only keys (S3).
- SC3: Zero raw i18n keys or untranslated backend error/audit strings appear
  anywhere in a full-app sweep, and all six listed sortable tables expose
  `aria-sort` (S8).
- SC4: All panes remain usable at a window size of 1100×720 with the header/
  action bar pinned (S7).

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
