# Command Surface Contract

All commands are Tauri IPC commands exposed via tauri-specta with dotted names
matching the frontend's `invoke()` calls.

## Query Commands

| Command Name | Arguments | Returns | Group |
|-------------|-----------|---------|-------|
| `sessions.list` | filters?, sort?, group_by? | `AcquisitionSession[]` | sessions |
| `sessions.get` | id | `SessionDetail` | sessions |
| `sessions.calendar` | start_month, end_month | `CalendarData` | sessions |
| `calibration.masters.list` | group_by?, filters? | `CalibrationMaster[]` | calibration |
| `calibration.masters.get` | id | `MasterDetail` | calibration |
| `calibration.matches` | session_id | `MatchCandidate[]` | calibration |
| `targets.list` | search? | `Target[]` | targets |
| `targets.get` | id | `TargetDetail` | targets |
| `projects.list` | filters? | `Project[]` | projects |
| `projects.get` | id | `ProjectDetail` | projects |
| `plans.list` | filters? | `FilesystemPlan[]` | plans |
| `plans.get` | id | `PlanDetail` | plans |
| `audit.list` | filters?, pagination? | `{ entries: AuditEntry[], total: number }` | audit |
| `audit.export` | filters? | `string` | audit |
| `review.queue` | filter? | `ReviewItem[]` | review |
| `roots.list` | — | `LibraryRoot[]` | roots |
| `equipment.list` | — | `Equipment[]` | roots |
| `settings.get` | scope | `SettingsData` | settings |
| `preferences.get` | — | `AppPreferences` | preferences |
| `search.global` | query | `SearchResult[]` | search |

## Mutation Commands

| Command Name | Arguments | Returns | Group |
|-------------|-----------|---------|-------|
| `sessions.transition` | id, action, metadata? | `AcquisitionSession` | sessions |
| `sessions.split` | id, split_at_index | `{ original, new }` | sessions |
| `sessions.merge` | ids | `AcquisitionSession` | sessions |
| `projects.create_plan` | wizard_state | `FilesystemPlan` | projects |
| `plans.approve` | id, delete_acknowledged? | `FilesystemPlan` | plans |
| `plans.apply` | id | `OperationHandle` | plans |
| `plans.discard` | id | `void` | plans |
| `settings.update` | scope, values | `void` | settings |
| `roots.register` | path, category, scan_settings | `LibraryRoot` | roots |
| `roots.remap` | root_id, new_path | `RemapVerification` | roots |
| `roots.remap.apply` | root_id, verified | `void` | roots |
| `scan.start` | root_ids? | `OperationHandle` | roots |
| `preferences.set` | key, value | `void` | preferences |
| `tour.complete_step` | step | `void` | tour |

## Preserved Commands (spec 002)

These existing commands are NOT renamed or modified:

| Command Name (specta) | Tauri Name | Module |
|-----------------------|------------|--------|
| `provenanceRead` | `provenance_read` | lifecycle |
| `lifecycleTransitionApply` | `lifecycle_transition_apply` | lifecycle |
| `lifecycleTransitionPreview` | `lifecycle_transition_preview` | lifecycle |
| `lifecycleLedgerList` | `lifecycle_ledger_list` | lifecycle |

## Command Groups → Modules

| Module File | Commands | Count |
|------------|----------|-------|
| `sessions.rs` | sessions.* | 5 |
| `calibration.rs` | calibration.* | 3 |
| `targets.rs` | targets.* | 2 |
| `projects.rs` | projects.* | 3 |
| `plans.rs` | plans.* | 4 |
| `audit.rs` | audit.* | 2 |
| `review.rs` | review.* | 1 |
| `roots.rs` | roots.*, scan.*, equipment.* | 5 |
| `settings.rs` | settings.* | 2 |
| `preferences.rs` | preferences.* | 2 |
| `search.rs` | search.* | 1 |
| `tour.rs` | tour.* | 1 |
| **Total** | | **31** |
