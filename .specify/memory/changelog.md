# Merged Features Log

### Settings Configuration Model — 2026-06-23
**Branch:** `018-settings-configuration-model` (+ `018-followup-t046-t033`, `018-closeout`)
**Spec:** specs/018-settings-configuration-model
**PRs:** #348, #350, #352

**What was added:**
- Reconciled the spec to the as-built **scope/values** settings architecture
  (`settings.get { scope }` / `settings.update { scope, values }` + restore-defaults
  and source-override commands) after drift from specs 035/041/042.
- US1–US4 settings surface: read/update with auto-save (no global save), SQLite
  persistence (migration `0013_settings.sql`), audit stream (changed/snapshot/repair),
  per-source overrides, restore-defaults.
- US5: rule-free `migrate_v1_to_v2` migration harness + audit summary.
- New keys: `tool_watch_extensions`, `tool_attribution_window_hours`,
  `tools.<id>.bundle_id` (ToolProfile-validated + seeded defaults).
- Removed the vestigial `rowDensity` settings key (T032); display density is now
  an Appearance preference (`prefs.density`, spec 043).
- Desktop: per-pane restore-defaults action, per-source override panel, backend
  `settings_overridable_keys` command.

**New Components:**
- `crates/app/settings` (`app_core_settings`): `lib.rs`, `descriptors.rs`, `migrate.rs`.
- `crates/domain/core/src/settings.rs` (durable types), `crates/persistence/db/.../settings.rs`.
- `crates/audit` settings events; `apps/desktop/src-tauri/src/commands/settings.rs`;
  `apps/desktop/src/features/settings/*` panes + `useAutoSave.ts`.

**Verification:** `cargo test -p app_core_settings -p domain_core -p persistence_db -p app_core`
green; `just typecheck`, clippy, rustfmt clean; live T034 walkthrough (real Tauri
app via MCP bridge); SpecKit `verify` pass (FR/SC reconciled to as-built).

**Tasks Completed:** 42/46 (4 obsolete, 0 open).

**Known follow-up (non-blocking):** FR-006 keeps density as an Appearance
preference owned by spec 043 — the per-table density control was removed, the
single global Appearance density choice is retained.

### Calibration Matching Rules — 2026-06-23 (close-out)
**Spec:** specs/007-calibration-matching-rules — Status: Completed
Verified (speckit): all 12 FR implemented; per-type dark/flat/bias matching engine, ranking, assign, override in `crates/calibration/core`. Gates green (`calibration_core` 74). 11 open tasks all DEFERRED (JSON-schema contract-runner). SC-001 accepted: matcher per-type keys are backend-configurable with defaults; the per-criterion surface is the spec-018 Calibration pane (FR-009 split). No contradiction with 018.

### Project Manifests and Notes — 2026-06-23 (close-out)
**Spec:** specs/024-project-manifests-and-notes — Status: Completed
Verified (speckit): manifest writer/checkpoints, project notes, audit, subscriber startup all shipped + tested. Fixed at close-out: project notes now self-fetch on drawer reload (`ProjectNotesSection` → `getProjectNote`), closing the SC-002/US2 display gap (+ test). Corrected a stale `tasks.md` deferral (workflow_run subscriber IS wired). 5 open tasks DEFERRED (FR-006 onboarding [010], export-copy [017/025], JSON-schema contract tests).
