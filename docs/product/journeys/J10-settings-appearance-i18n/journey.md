---
id: J10
title: Configure appearance, per-library defaults, and trust the app is fully localized
version: 1
status: active
last_reviewed: 2026-07-14
actors: [astrophotographer]
surfaces: [settings, shell, audit]
interfaces: [windows-desktop]
trace:
  - pre-migration journey.md @ git 66026463
  - deltas/2026-07-14-q15-t122.md (folded — PR #826 / commit 0cdc81cc)
  - deltas/2026-07-14-q15-t126.md (not folded — still blocked, see Known gaps)
  - deltas/2026-07-14-q27-f11.md (not folded — unverifiable, see open questions)
  - spec 018 (settings configuration model)
  - spec 019 (bottom log viewer)
  - spec 021 (developer contract diagnostics)
  - spec 030 (UI audit revision, Q15 durable-audit unification)
  - spec 043 (UI redesign — shell, sort announcements)
  - spec 046 (i18n error codes)
  - PR #388 (Audit Log screen), PR #410 (audit detail localization),
    PR #415 (aria-sort), PR #826 (durable audit rows for settings/protection/
    equipment/source changes), commit 1f4ba13f (accessibility/theming pass)
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

## Steps

### S1 — Open Settings and find a pane {#S1}
- **Do:** Navigate to Settings from the pinned sidebar entry.
- **Expect:** 13 panes are grouped into three sections — Library (Data
  Sources, Equipment, Ingestion, Naming & Structure, Catalogs, Target
  Planner), Processing (Processing Tools, Calibration Matching, Cleanup,
  Source Views), and Application (General, Advanced, Audit Log).
- **Expect:** Every pane auto-saves; no pane anywhere has a global "Save"
  button.
- **Trace:** apps/desktop/src/features/settings/SettingsPage.tsx

### S2 — Change an appearance setting {#S2}
- **Do:** In General, pick a different theme, then change density.
- **Expect:** One of four named themes (Warm Clay, Warm Slate, Observatory,
  Espresso) or "System" (follows OS) applies live with no reload; the choice
  survives a full app restart. Density (compact/comfortable/spacious) has a
  measurable effect on row spacing in at least the main list surfaces.
- **Expect (negative):** No first-paint flash of the previous theme or
  density on reload.
- **Trace:** apps/desktop/src/data/theme.ts, apps/desktop/src/features/settings/General.tsx

### S3 — Change a durable-data setting and find it in the Audit Log {#S3}
- **Do:** Change a durable-data setting (e.g. a Calibration Matching
  tolerance), then open Audit Log.
- **Expect:** A new audit row exists for the change with a before→after
  value pair, actor `user`, and an outcome; the same is true for equipment
  create/delete, source register/enable/disable/delete/remap, and source
  protection set/acknowledge — actions that previously produced no durable
  row at all.
- **Expect (negative):** Rapidly typing into the Naming pattern builder and
  then committing produces exactly one audit row at the final value, not one
  per keystroke. Toggling a UI-state-only key (e.g. "remember follow-logs")
  produces no audit row.
- **Trace:** PR #826 (commit 0cdc81cc)

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
- **Expect:** Out-of-range input is clamped to 0–90; the change is
  persisted and immediately affects the Targets planner table's imaging-time
  and visible-tonight computations, driven by real astronomy-engine output.
- **Trace:** apps/desktop/src/features/settings/PlannerSettings.tsx

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
  per-item tooltips. Every route listed in the palette exists and is
  reachable. Every page keeps its header/action bar pinned while only its
  content scrolls, down to 1100×720.
- **Trace:** apps/desktop/src/app/Sidebar.tsx, apps/desktop/src/app/CommandPalette.tsx

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
  "Restart first-run setup" and "Restart guided flow" (two distinct,
  confirm-gated controls); use "Reset preferences". In any pane offering
  "Restore defaults", use it.
- **Expect:** Export produces a real file with a confirmation. Both restart
  controls are confirm-gated and distinct from each other. Reset preferences
  actually resets and confirms. Restore defaults states its scope and resets
  only settings visible in that pane.
- **Expect (negative):** No danger control fires without an explicit confirm
  step.

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
- G1: Appearance's font-size control (General pane) is local component
  state only — it is not persisted and changes nothing outside the pane it
  lives in (apps/desktop/src/features/settings/General.tsx:36).
- G2: Ingestion settings persist durably but no scan/watch/ingest pipeline
  consumes them yet (crates/app/settings/src/ingestion.rs:22-25, explicit in
  source comment).
- G3: The bottom log panel reads only the in-memory event bus, not the
  durable audit table — user-meaningful workflow rows are not yet guaranteed
  to survive a restart from the log panel's perspective (blocked on a
  separate log-panel iteration; deltas/2026-07-14-q15-t126.md).
- G4: A `/dev/contracts` command-palette entry exists only in developer-mode
  builds (compile-time gated off in release, per spec 021) — its absence in
  a release build is expected, not a bug.
- G5: Issue #647 ("Durable audit log misses most audited action classes")
  remains open on the tracker even though commit 0cdc81cc/PR #826 appears to
  address its described symptom; not closed as of this migration — flagged
  as an open question rather than assumed stale.

## Delta log
(none — consolidated at migration; window starts fresh from `last_reviewed`)
