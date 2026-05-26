# Feature Specification: Settings Configuration Model

> **See Spec 030**: UI implementation of this feature must follow
> [Spec 030 — UI Audit & Revision](../030-ui-audit-revision/spec.md)
> for layout, navigation, and component patterns.

**Feature Branch**: `018-settings-configuration-model`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify the settings model after the UI review: plain labels, one setting per line, hover information, auto-save, no internal technical controls, and grouped submenus that match user workflows."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Understand Every Setting (Priority: P1)

As a user, I want each setting to have a plain label, a single-line control, and an information affordance so that configuration does not feel like internal implementation leakage.

**Why this priority**: The user identified multiple settings whose names and controls were unclear.

**Independent Test**: Open Settings and inspect each setting row; confirm each row has one control line, an information icon, clear label text, and no save button.

**Acceptance Scenarios**:

1. **Given** Settings is open, **When** a setting row is displayed, **Then** it has one primary line with label, info affordance, and control.
2. **Given** a user hovers the information affordance, **When** help opens, **Then** it explains the setting in user language.
3. **Given** a setting changes, **When** the control value changes, **Then** the app saves automatically and shows lightweight status.

---

### User Story 2 - Configure Workflow-Relevant Rules (Priority: P2)

As a user, I want settings grouped by workflow domain so that source behavior, calibration matching, project naming, tools, catalogs, logs, and safety are easy to find.

**Why this priority**: Settings should match product workflows, not code modules.

**Independent Test**: Navigate each settings section and confirm controls are grouped under Sources, Calibration, Projects, Tools, Catalogs, Safety, Logs, and Appearance or equivalent final names.

**Acceptance Scenarios**:

1. **Given** a user needs calibration matching, **When** they open Settings, **Then** matching rules are grouped under Calibration.
2. **Given** a user needs project folder naming, **When** they open Settings, **Then** pattern builder controls are grouped under Projects.
3. **Given** a user needs log display preferences, **When** they open Settings, **Then** only workflow-relevant log display controls are shown.

### Edge Cases

- User changes a setting while an operation is running.
- Auto-save fails.
- Setting requires native path selection.
- A setting is only relevant when another feature is enabled.
- A setting has invalid values after version upgrade.

### Domain Questions To Resolve

- Final menu names for Settings sections.
- Which settings are project-level overrides versus global defaults.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Settings MUST use plain user-facing labels and avoid internal terms such as marker write queue, project envelope, prepared sources layout, structure normalization, material kinds, reuse scope, or metadata repair unless reworked into clear user concepts.
- **FR-002**: Settings MUST show one setting per line.
- **FR-003**: Each setting row MUST include an information affordance that explains what the setting changes, how the app uses it, what the options mean, and any workflow or safety consequence; it MUST NOT merely restate the label.
- **FR-004**: Settings MUST auto-save changes and MUST NOT require a global Save button.
- **FR-005**: Destructive or high-risk setting changes MUST show confirmation before applying.
- **FR-006**: Density MUST be fixed by the desktop design system; Settings MUST NOT expose compact/comfortable density controls.
- **FR-007**: Light/dark mode MUST be available as an icon control in the app shell and as a persisted appearance setting if exposed.
- **FR-008**: Project folder and archive location patterns MUST use the token pattern builder, not freeform text.
- **FR-009**: Calibration matching settings MUST be per calibration frame type.
- **FR-010**: Catalog settings MUST allow selecting available catalog families and target lookup behavior.
- **FR-011**: Tool settings MUST configure executable paths for each supported processing tool.
- **FR-012**: API contract settings MUST NOT appear as a normal user settings section.
- **FR-013**: Log settings MUST not expose export format or request/entity metadata toggles; request/entity metadata is always present and export is JSON when offered.

### Key Entities

- **Setting Section**: Workflow-oriented group of settings.
- **Setting Row**: Label, information affordance, control, validation, and auto-save state.
- **Setting Help**: Short explanation shown on hover/focus.
- **Setting Change Event**: Auditable configuration change.
- **Project Override**: Project-specific configuration that overrides global defaults.

### Absorbed Settings Keys (2026-05-22 ripple absorption)

The following keys were flagged across multiple prior ratification passes and
are now absorbed into the v1 settings model.

**Library context**

- `current_library_id` (`string?`, uuid): tracks which library is currently
  open; drives `?lib=<library_id>` URL injection across all `<Link>` components
  (spec 020 R-Lib-V1). Single-library v1 always has one value; slot is reserved.
- `devMode` (`boolean`, default `false`): runtime toggle for the developer-mode
  surface (recording proxy, `/dev/contracts` route). Only meaningful when the
  binary is compiled with the Cargo feature `dev-tools`; in release builds this
  key is read-only and hidden from Settings UI (spec 021 R-DevFeature).

**Plans**

- `plans.list.default_age_cutoff_days` (`number`, default `90`, `0` = show all):
  UI hides terminal plans older than this threshold by default (spec 017 R-Ret-1).

**Log viewer**

- `rememberFollowLogs` (`boolean`, default `false`): persists the "follow tail"
  toggle state in the log viewer across app restarts (spec 019 E-019-3).

**Target lookup**

- `target_lookup.active_catalogs` (`string[]`, catalog_id enum): backend-derived
  active catalog set for `target.lookup`; default is all 13 v1 catalogs per
  spec 014. User can disable specific catalogs in Settings (spec 013 R-2.2).

**Calibration matching**

- `calibration.dark_temp_tolerance` (`number`, default `2.0` °C): dark frame
  temperature matching tolerance (spec 007 A5).
- `calibration.dark.override_penalty` / `calibration.flat.override_penalty` /
  `calibration.bias.override_penalty` (`number`, default `0.3`, range `[0, 1]`):
  per-frame-type confidence penalty applied when a user overrides the
  auto-suggested calibration match (spec 007 R-OverridePenalty).
- `calibration.prefill_suggestion` (`boolean`, default `true`): when true, the
  assign dialog opens pre-filled with the top candidate; user must confirm
  (spec 007 R-Prefill).

**Tool launching**

- `tools.<tool_id>.bundle_id` (`string?`, macOS only): per-tool macOS bundle
  identifier used for `open -b` launching; seed values for known tools
  (PixInsight, Siril); user-editable for custom installs (spec 011 R-BundleId).

**Workflow profile (artifact watcher)**

- `workflow_profile.<profile_id>.watch_extensions` (`string[]`): per-workflow-
  profile allow-list of file extensions the watcher monitors (spec 012 R-ExtAllow).
- `workflow_profile.<profile_id>.launch_attribution_window_hours` (`number`,
  default `6`): per-workflow-profile attribution window for matching artifacts
  to tool launches (spec 012 C3).

**FITS classifier**

- `imagetyp_normalization.user_mappings` (`Array<{ imagetyp_string: string,
  frame_type: enum }>`): user-extensible table for IMAGETYP strings not covered
  by the built-in normalization table; empty array default (spec 005
  R-IMAGETYP-Norm).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every visible setting can be explained without referring to internal implementation names.
- **SC-002**: Users can configure common setup, calibration, project naming, tool path, catalog, safety, log, and appearance preferences from Settings.
- **SC-003**: Settings changes persist without a global save action.
- **SC-004**: No visible settings section is named API Contracts.

## Assumptions

- Project-specific configuration lives in the Edit project pane when it only applies to one project.
- Developer diagnostics can expose contract references outside normal user settings.

## Out of Scope

- Implementing persistence migrations.
- Designing every final tooltip copy string.

## Implementation Status

The Settings surface is implemented as a mockup in the desktop shell. Behavior
captured in code already and reflected in this spec:

- **One-setting-per-line**: `SettingsPage.tsx` renders each setting as a single
  row with label, info affordance, and a single control. No save button is
  present anywhere on the page.
- **Auto-save on every change**: `updateSettings(key, value)` in
  `apps/desktop/src/data/settings.ts` writes immediately to a localStorage-backed
  store under the versioned key `alm.settings.v1` and broadcasts to subscribers.
- **No-op guard**: `updateSettings` short-circuits when the new value equals the
  prior value. This prevents redundant persistence, redundant notifications, and
  redundant audit entries for "phantom" changes.
- **Noisy-key log policy**: `pattern` and `protectedCategories` are marked
  noisy. Updates to these keys still persist, but do not append an entry to the
  application log on every keystroke. All other keys log an `info`-level entry
  to the `settings` source on change. This bounds the audit log against
  token-editor and free-text drag activity while keeping discrete toggles
  individually auditable.
- **Per-source override scaffolding**: The Naming & Structure section exposes
  per-source override stubs alongside the global token pattern builder. The
  resolution model is global default → per-source override, with no further
  inheritance levels in v1.
- **Theme persistence separation**: The light/dark/system selector persists
  under a separate localStorage key (`alm.theme`) managed by
  `apps/desktop/src/app/theme.tsx`. Theme is intentionally not part of
  `SettingsState v1`, so theme changes never participate in the settings
  audit stream and never invalidate the settings schema.
- **Wired sections**: Data Sources, Ingestion & Review, Naming & Structure,
  Calibration, Tool Workflows, Catalogs, Cleanup & Archive, Source Protection,
  Application Log, Appearance, and Advanced. API Contracts is not a user
  section per FR-012.

Persistence to the library SQLite database, schema migration, and an audit
event stream remain unimplemented and are tracked in `plan.md`,
`data-model.md`, `contracts/`, and `tasks.md`.
