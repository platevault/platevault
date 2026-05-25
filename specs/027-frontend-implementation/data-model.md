# Data Model: Desktop Frontend Implementation

This documents the frontend state shapes — the TypeScript types that the UI components bind to. These are projections of the backend domain entities (defined in specs 002-026) received via Tauri commands. The frontend does not own persistence; it receives and displays.

## Frontend State Shapes

### AppPreferences (local, persisted in localStorage)

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `sidebarCollapsed` | boolean | false | Sidebar collapse state |
| `density` | `'compact' \| 'comfortable' \| 'spacious'` | 'comfortable' | Global density mode |
| `projectViewModes` | `Record<string, ViewMode>` | {} | Per-project view toggle (keyed by project ID) |
| `defaultProjectView` | `'center' \| 'pipeline' \| 'combined'` | 'combined' | Fallback when no per-project pref |
| `sessionsGroupBy` | `'none' \| 'target' \| 'month' \| 'filter' \| 'train'` | 'none' | Sessions page group mode |
| `sessionsView` | `'list' \| 'calendar'` | 'list' | Sessions page view mode |
| `tourCompleted` | `{ step1: boolean, step2: boolean, step3: boolean }` | all false | Guided tour completion |
| `setupCompleted` | boolean | false | First-run wizard completed |

### AcquisitionSession (from backend)

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | UUID |
| `session_key` | `{ target, filter, binning, gain, night }` | Immutable after confirm |
| `state` | SessionState | discovered/candidate/needs_review/confirmed/rejected/ignored |
| `confidence` | ConfidenceLevel | unknown/low/medium/high/confirmed |
| `optical_train_id` | string | Links to equipment |
| `frame_count` | number | |
| `total_integration_seconds` | number | |
| `total_size_bytes` | number | |
| `metadata` | `Record<string, MetaValue>` | Key → {value, raw, origin, confidence} |
| `target_ids` | string[] | |
| `project_ids` | string[] | Projects using this session |
| `warnings` | string[] | Reasons for review flags |

### CalibrationMaster (from backend)

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | UUID |
| `kind` | `'dark' \| 'flat' \| 'bias' \| 'dark_flat' \| 'bad_pixel_map'` | |
| `fingerprint` | `{ camera, sensor_mode, exposure_s, temp_c, gain, binning, filter? }` | Match key |
| `source_session_id` | string | |
| `created_at` | ISODate | |
| `age_days` | number | Derived |
| `size_bytes` | number | |
| `used_by_session_ids` | string[] | |
| `used_by_project_ids` | string[] | |

### Target (from backend)

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | UUID |
| `name` | string | Primary display name |
| `aliases` | string[] | For metadata matching |
| `catalog_ids` | `{ ngc?, ic?, messier? }` | |
| `kind` | `'deep_sky' \| 'planetary' \| 'lunar' \| 'solar' \| 'landscape'` | |
| `coordinates` | `{ ra?, dec? }` | Optional |
| `session_count` | number | |
| `project_count` | number | |
| `total_integration_hours` | number | |
| `coverage` | `Record<string, number>` | filter → hours |
| `recommended_hours` | `Record<string, number>` | filter → target hours (for ⚠) |

### Project (from backend)

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | UUID |
| `name` | string | User-supplied |
| `workflow_profile_id` | string | pixinsight/siril/planetary |
| `root_path` | string | Absolute |
| `state` | ProjectState | 7-state lifecycle |
| `blocked_reason` | string? | When state=blocked |
| `verification_state` | `'unreviewed' \| 'has_accepted' \| 'all_rejected'` | |
| `cleanup_state` | `{ reclaimable_bytes }` | |
| `target_ids` | string[] | |
| `source_map` | SourceMap | Sessions + cal + roles |
| `source_view_ids` | string[] | |
| `output_ids` | string[] | |
| `processing_directory` | string | Relative, default 'processing/' |
| `output_directory` | string | Relative, default 'outputs/' |
| `updated_at` | ISODate | Most recent activity |

### FilesystemPlan (from backend)

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | UUID |
| `kind` | PlanKind | project_structure/source_view/cleanup/archive/etc. |
| `state` | PlanState | 10-state lifecycle |
| `items` | PlanItem[] | Per-operation rows |
| `dry_run_result` | `{ passed, warnings, failures }` | |
| `has_destructive` | boolean | Gates extra approval checkbox |
| `reclaim_bytes` | number | |
| `created_at` | ISODate | |
| `approved_at` | ISODate? | |
| `applied_at` | ISODate? | |

### PlanItem

| Field | Type | Notes |
|-------|------|-------|
| `action` | `'mkdir' \| 'move' \| 'copy' \| 'link' \| 'junction' \| 'write' \| 'archive' \| 'trash' \| 'delete'` | |
| `source_path` | string | |
| `dest_path` | string | |
| `status` | `'pending' \| 'applied' \| 'failed' \| 'skipped' \| 'protected'` | |
| `dry_run_ok` | boolean | |
| `protection_reason` | string? | |
| `provenance` | ProvenanceOrigin | Where the item came from |

### AuditEntry (from backend)

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | |
| `timestamp` | ISODate | Full precision |
| `event_type` | string | Dot-notation: plan.approved, session.confirmed, etc. |
| `entity_type` | string | |
| `entity_id` | string | |
| `from_state` | string? | |
| `to_state` | string? | |
| `actor` | `'user' \| 'system'` | |
| `outcome` | `'applied' \| 'ok' \| 'refused' \| 'failed' \| 'paused'` | |
| `detail` | string | Structured info |

### ReviewItem (from backend)

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | UUID |
| `kind` | `'session' \| 'unclassified_file'` | Discriminator for queue rendering |
| `session_id` | string? | Present when kind='session' |
| `file_path` | string? | Present when kind='unclassified_file' |
| `confidence` | ConfidenceLevel | Sort key (ascending = needs most attention first) |
| `blocking_reasons` | string[] | Fields needing review before confirm |
| `evidence` | `Record<string, MetaValue>` | Key metadata for evidence pane |
| `suggested_target` | string? | Inferred target name |
| `suggested_filter` | string? | Inferred filter |

### SearchResult (from backend)

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Entity UUID |
| `kind` | `'session' \| 'target' \| 'project' \| 'page' \| 'action'` | Result category |
| `label` | string | Display text |
| `sublabel` | string? | Secondary text (e.g., target name for session, page path for nav) |
| `route` | string | Navigation target (hash route) |
| `score` | number | Relevance score for ordering |

### MetaValue (provenance-tracked)

| Field | Type | Notes |
|-------|------|-------|
| `value` | any | Normalized value |
| `raw` | string? | Original extracted text |
| `origin` | ProvenanceOrigin | reviewed/inferred/observed/generated/planned/applied |
| `confidence` | ConfidenceLevel | |
| `evidence_ref` | string? | What produced this value |

## Enumerations

```typescript
type SessionState = 'discovered' | 'candidate' | 'needs_review' | 'confirmed' | 'rejected' | 'ignored';
type ProjectState = 'setup_incomplete' | 'ready' | 'prepared' | 'processing' | 'completed' | 'archived' | 'blocked';
type PlanState = 'draft' | 'ready_for_review' | 'approved' | 'applying' | 'applied' | 'partially_applied' | 'failed' | 'paused' | 'cancelled' | 'discarded';
type ConfidenceLevel = 'unknown' | 'low' | 'medium' | 'high' | 'confirmed' | 'rejected';
type ProvenanceOrigin = 'reviewed' | 'inferred' | 'observed' | 'generated' | 'planned' | 'applied';
type ViewMode = 'center' | 'pipeline' | 'combined';
type PlanKind = 'project_structure' | 'source_view' | 'source_view_removal' | 'archive' | 'cleanup' | 'root_remap' | 'manifest';
```

## State Transitions (frontend-triggered)

The frontend does not enforce state machines — it calls Tauri commands that return success/failure. But it must know valid transitions to render appropriate action buttons:

- **Session**: discovered→candidate→needs_review→confirmed (confirm via Review queue); confirmed→needs_review (re-open from detail)
- **Project**: setup_incomplete→ready→prepared→processing→completed→archived; any→blocked (with reason)
- **Plan**: draft→ready_for_review→approved→applying→applied/failed/paused; draft→discarded
