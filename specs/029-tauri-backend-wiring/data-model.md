# Data Model: Tauri Backend Wiring

This spec does not introduce new persistent entities. It defines Rust DTO types
in `crates/contracts/core` that mirror the frontend's type expectations for the
stub command surface. Domain specs will later promote these stubs to real
domain-backed types.

## DTO Types Required

All types derive `Serialize, Deserialize, specta::Type, Clone`.

### Enumerations

| Enum | Variants | Notes |
|------|----------|-------|
| `SessionState` | discovered, candidate, needs_review, confirmed, rejected, ignored | Mirrors frontend |
| `ProjectState` | setup_incomplete, ready, prepared, processing, completed, archived, blocked | |
| `PlanState` | draft, ready_for_review, approved, applied, failed, discarded | |
| `PlanKind` | project_structure, source_view, cleanup, archive | |
| `ConfidenceLevel` | high, medium, low, unknown, confirmed, rejected | |
| `ProvenanceOrigin` | header, inferred, user, computed, default, missing | |
| `ViewMode` | command_center, pipeline, combined | |

### Structs (response DTOs)

| Struct | Key Fields | Used By |
|--------|-----------|---------|
| `AcquisitionSession` | id, target, filter, night, integration_time, state, confidence | sessions.list |
| `SessionDetail` | session + framesets, cal_matches, projects, history | sessions.get |
| `CalibrationMaster` | id, kind, filter, camera, fingerprint, frame_count, state | calibration.masters.list |
| `MasterDetail` | master + provenance, usage, compatible_sessions | calibration.masters.get |
| `Target` | id, name, catalog_id, type, ra, dec, constellation | targets.list |
| `TargetDetail` | target + aliases, sessions, projects, outputs, observing_notes | targets.get |
| `Project` | id, name, target, state, created, profile | projects.list |
| `ProjectDetail` | project + sessions, calibration, source_views, outputs, lifecycle | projects.get |
| `FilesystemPlan` | id, kind, state, item_count, total_size, created | plans.list |
| `PlanDetail` | plan + items, diff, approval_state | plans.get |
| `AuditEntry` | id, timestamp, event_type, entity_type, entity_id, actor, outcome | audit.list |
| `ReviewItem` | session + blocking_reasons, evidence, suggestions | review.queue |
| `LibraryRoot` | id, path, category, state, file_count, last_scan | roots.list |
| `Equipment` | id, camera, telescope, filter_wheel, filters | equipment.list |
| `SettingsData` | scope, values (JSON object) | settings.get |
| `SearchResult` | entity_type, id, label, detail, score | search.global |
| `AppPreferences` | key-value map | preferences.get |
| `CalendarData` | months with session cards | sessions.calendar |
| `MatchCandidate` | master_id, score, reason | calibration.matches |
| `RemapVerification` | root_id, old_path, new_path, matched_files, missing_files | roots.remap |
| `OperationHandle` | id, status, progress | scan.start, plans.apply |

### Request DTOs

Most commands use inline argument structs. Complex ones:

| Struct | Fields | Used By |
|--------|--------|---------|
| `TransitionRequest` | id, action, metadata | sessions.transition |
| `WizardState` | wizard_state (JSON object) | projects.create_plan |
| `PlanApproval` | id, delete_acknowledged | plans.approve |
| `RootRegistration` | path, category, scan_settings | roots.register |
| `RemapRequest` | root_id, new_path | roots.remap |

## Relationship to Existing Types

The `contracts_core` crate already has `lifecycle` and `provenance` modules
from spec 002. New DTO modules are added alongside them — not replacing them.
Domain specs will later refine these DTOs as real domain types emerge.
