# Data Model: Astro Library Manager

## Modeling Rules

- Database records are canonical for relationships, lifecycle, policy, plans,
  audit history, operation state, and user decisions.
- Actual image files remain on disk and are referenced through `LibraryRoot` plus
  normalized root-relative paths.
- Generated manifests, source views, and artifact registries are protected
  projections derived from canonical records unless explicitly imported through a
  future reviewed operation.
- Inferred classifications and matches always carry confidence, evidence, and
  review state.
- Acquisition sessions are immutable source records. User corrections create
  reviewed metadata/relationship updates rather than rewriting source identity.

## Common Value Types

### EntityId

- `id`: stable UUID or ULID.
- `created_at`, `updated_at`: UTC timestamps.
- `created_by`: local actor identity or `system`.

### Confidence

- `score`: numeric value from 0.0 to 1.0.
- `level`: `unknown`, `low`, `medium`, `high`, `confirmed`, `rejected`.
- `evidence_refs`: references to metadata keys, paths, rules, user decisions, or
  prior observations.
- `explanation`: short user-visible reason.

### ReviewState

- `unreviewed`
- `confirmed`
- `corrected`
- `rejected`
- `ignored`

### RootRelativePath

- `root_id`
- `relative_path`
- `display_path`
- `path_kind`: `normal`, `symlink`, `junction`, `hard_link`, `mount`, `unknown`
- `case_fold_key`: optional path comparison key for case-insensitive roots.
- `platform_flags`: long path, reserved name, invalid character, normalization
  warning, or root unavailable warning.

## Entities

### LibraryRoot

Represents a user-registered root such as `D:\Astrophotography`.

Fields:
- `id`
- `name`
- `absolute_path`
- `platform`: `windows`, `macos`, `linux`, `unknown`
- `root_kind`: `local_disk`, `external_disk`, `network_share`, `removable`,
  `unknown`
- `identity_hints`: volume serial, device id, filesystem id, label, or mount
  hint when available.
- `availability_state`: `available`, `missing`, `moved_candidate`, `disabled`
- `scan_settings_id`
- `created_at`, `updated_at`

Relationships:
- Has many `FileRecord`
- Has many `RootRemapEvent`
- Has one active `ScanSettings`

Validation:
- Path must be absolute for the platform.
- Root deletion never deletes stored records; it marks the root disabled.

### RootRemapEvent

Records drive or mount recovery.

Fields:
- `id`
- `library_root_id`
- `old_absolute_path`
- `new_absolute_path`
- `reason`
- `verified_sample_count`
- `created_at`

### ScanSettings

Fields:
- `id`
- `follow_links`: default false
- `hash_mode`: `none`, `lazy`, `selected`, `eager`
- `include_patterns`
- `exclude_patterns`
- `protected_patterns`
- `metadata_extract_mode`: `none`, `headers_only`, `headers_and_sidecars`
- `max_parallelism`

### FileRecord

Represents a discovered file, directory, link, generated source view item, or
processing artifact path.

Fields:
- `id`
- `root_id`
- `relative_path`
- `display_name`
- `item_type`: `file`, `directory`, `symlink`, `junction`, `hard_link`,
  `mount_point`, `unknown`
- `file_kind`: `fits`, `xisf`, `video`, `image`, `sidecar`, `project_file`,
  `plan_file`, `directory`, `unknown`
- `size_bytes`
- `modified_at`, `created_at_fs`
- `link_target`: optional, stored without traversal by default.
- `hash_status`: `not_requested`, `pending`, `hashed`, `failed`, `skipped`
- `content_hash`: optional
- `metadata_status`: `not_requested`, `pending`, `extracted`, `partial`,
  `failed`, `unsupported`
- `classification`: current best `ClassificationAssignment`
- `protection_status`: `protected`, `candidate`, `unknown`
- `last_seen_scan_id`

Relationships:
- May have many `MetadataEntry`
- May be part of one or more `FileSet`
- May be linked to `ProcessingArtifact`, `ProjectOutput`, `ObservingPlanReference`,
  `SourceViewItem`, or `CalibrationMaster`

### MetadataEntry

Stores raw and normalized metadata.

Fields:
- `id`
- `file_record_id`
- `source`: `fits_header`, `xisf_property`, `sidecar`, `path_rule`,
  `user_entry`, `tool_observation`
- `raw_key`
- `raw_value`
- `normalized_key`
- `normalized_value`
- `unit`
- `confidence`
- `extracted_at`

Validation:
- Raw values are preserved even when normalization fails.

### ClassificationAssignment

Fields:
- `id`
- `file_record_id`
- `category`: `raw_light`, `calibration_dark`, `calibration_bias`,
  `calibration_flat`, `calibration_dark_flat`, `calibration_master`,
  `project_like`, `app_project`, `final_output`, `processing_artifact`,
  `source_view`, `manifest`, `note`, `unknown`
- `confidence`
- `review_state`
- `rule_id`
- `assigned_at`

### Target

Represents an astronomical, planetary, lunar, solar, or landscape subject.

Fields:
- `id`
- `primary_name`
- `target_kind`: `deep_sky`, `mosaic`, `planetary`, `lunar`, `solar`,
  `landscape`, `unknown`
- `catalog_ids`: JSON array or child table entries
- `coordinates`: optional RA/Dec or body-specific coordinates
- `description`
- `review_state`
- `created_at`, `updated_at`

Relationships:
- Has many `TargetAlias`
- Has many `AcquisitionSessionTarget`
- Has many `ProjectTarget`
- Has many `ProjectOutput`
- Has many `ObservingPlanReference`
- Has many notes

### TargetAlias

Fields:
- `id`
- `target_id`
- `alias`
- `source`
- `confidence`

Validation:
- Alias comparison should support configured case and punctuation normalization.

### ObservingPlanReference

Represents NINA plans or other capture-plan artifacts.

Fields:
- `id`
- `file_record_id`
- `target_id`: optional
- `acquisition_session_id`: optional
- `plan_tool`: `nina`, `sharpcap`, `unknown`, extensible
- `plan_name`
- `metadata_summary`
- `review_state`

Validation:
- v1 stores references and metadata only. It does not execute, schedule, or fully
  edit plans.

### Equipment

Fields:
- `id`
- `equipment_type`: `camera`, `telescope`, `lens`, `reducer`, `rotator`,
  `focuser`, `filter_wheel`, `filter`, `mount`, `site`, `capture_software`,
  `processing_software`, `unknown`
- `manufacturer`
- `model`
- `serial_or_identifier`
- `aliases`
- `review_state`

### OpticalTrain

Fields:
- `id`
- `name`
- `camera_id`
- `telescope_or_lens_id`
- `filter_wheel_id`
- `reducer_id`
- `rotator_id`
- `focuser_id`
- `site_id`
- `notes`
- `setup_fingerprint`
- `review_state`

Relationships:
- Has many `OpticalTrainComponent`
- Used by acquisition and calibration sessions.

### AcquisitionSession

Immutable source grouping for captured lights or related raw material.

Fields:
- `id`
- `session_key`
- `capture_started_at`
- `capture_ended_at`
- `night_key`
- `source_root_id`
- `source_location_summary`
- `capture_software_id`
- `optical_train_id`
- `setup_fingerprint`
- `status`: `candidate`, `confirmed`, `rejected`, `superseded`
- `confidence`
- `review_state`

Relationships:
- Has many `AcquisitionSessionTarget`
- Has many `FileSet`
- Has many `ProjectSource`
- Has many `ObservingPlanReference`

Validation:
- Source identity fields are immutable after confirmation. Corrections are stored
  through aliases, relationship changes, or review records.

### AcquisitionSessionTarget

Fields:
- `id`
- `acquisition_session_id`
- `target_id`
- `role`: `primary`, `secondary`, `unknown`
- `evidence`
- `review_state`

### CalibrationSession

Independent grouping of calibration frames.

Fields:
- `id`
- `session_key`
- `calibration_kind`: `dark`, `bias`, `flat`, `dark_flat`, `mixed`, `unknown`
- `capture_started_at`
- `capture_ended_at`
- `night_key`
- `source_root_id`
- `optical_train_id`
- `setup_fingerprint`
- `temperature_c`
- `gain`
- `offset`
- `binning`
- `filter_id`: optional for flats/dark flats
- `exposure_seconds`: optional
- `status`
- `confidence`
- `review_state`

Relationships:
- Has many `FileSet`
- May produce many `CalibrationMaster`
- May match many `AcquisitionSession` through `CalibrationMatchCandidate`

### CalibrationMaster

Reusable master calibration artifact.

Fields:
- `id`
- `file_record_id`
- `master_kind`: `master_dark`, `master_bias`, `master_flat`,
  `master_dark_flat`, `bad_pixel_map`, `unknown`
- `created_by_tool_id`
- `created_at_observed`
- `source_calibration_session_id`
- `provenance_summary`
- `compatibility_fingerprint`
- `review_state`

Relationships:
- May be selected by many projects.
- Has many `CalibrationMatchCandidate`

### FileSet

Logical set of related files.

Fields:
- `id`
- `set_kind`: `lights`, `darks`, `biases`, `flats`, `dark_flats`, `masters`,
  `videos`, `sidecars`, `outputs`, `unknown`
- `frame_count`
- `total_size_bytes`
- `metadata_summary`
- `confidence`

Relationships:
- Has many `FileSetItem`
- Belongs optionally to `AcquisitionSession`, `CalibrationSession`, `Project`,
  or `ProcessingArtifact`

### WorkflowProfile

Defines processing-tool expectations.

Fields:
- `id`
- `profile_key`: `pixinsight_wbpp`, `planetary_lunar_common`, `siril_future`,
  extensible
- `display_name`
- `profile_kind`: `deep_sky`, `planetary_lunar`, `solar`, `landscape`, `generic`
- `source_view_defaults`
- `artifact_ruleset_id`
- `cleanup_policy_template_id`
- `lifecycle_hints`
- `version`

### SoftwareTool

Fields:
- `id`
- `name`
- `tool_kind`: `capture`, `stacking`, `sharpening`, `editing`, `processing`,
  `planning`, `unknown`
- `known_file_markers`
- `known_folder_markers`
- `version_hint`

Examples:
- SharpCap as capture software.
- PixInsight/WBPP as processing profile.
- Common planetary/lunar tools as software context before detailed profile
  support.

### Project

App-managed processing project envelope.

Fields:
- `id`
- `project_key`
- `display_name`
- `project_root_id`
- `project_relative_path`
- `workflow_profile_id`
- `lifecycle_state`
- `verification_state`: `not_ready`, `outputs_recorded`, `verified`,
  `rejected`, `unknown`
- `cleanup_state`: `not_reviewed`, `eligible`, `reviewed`, `applied`, `blocked`
- `archive_state`: `not_archived`, `planned`, `archived`, `restored`
- `created_at`, `updated_at`

Relationships:
- Has many `ProjectTarget`
- Has many `ProjectSource`
- Has many `ProjectPanel`
- Has many `ProcessingAttempt`
- Has many `ProcessingArtifact`
- Has many `ProjectOutput`
- Has many `SourceView`
- Has one active `CleanupPolicy`
- Has many `ProjectManifest`

Validation:
- App-managed projects must have the supported outer project structure.
- Nonconforming brownfield folders are `ProjectLikeMaterial`, not `Project`.

### ProjectTarget

Fields:
- `id`
- `project_id`
- `target_id`
- `role`: `primary`, `secondary`, `panel_target`, `reference`

### ProjectPanel

Supports mosaics.

Fields:
- `id`
- `project_id`
- `panel_key`
- `display_name`
- `target_id`
- `coordinates_or_geometry`
- `notes`

Relationships:
- Has many `ProjectSource`

### ProjectSource

Selected source relationship for a project.

Fields:
- `id`
- `project_id`
- `source_type`: `acquisition_session`, `calibration_session`,
  `calibration_master`, `file_set`, `file_record`, `panel`
- `source_id`
- `panel_id`: optional
- `role`: `light`, `dark`, `bias`, `flat`, `dark_flat`, `master`, `reference`,
  `output`, `other`
- `selection_state`: `candidate`, `selected`, `rejected`, `superseded`
- `reason`
- `review_state`

### CalibrationMatchCandidate

Fields:
- `id`
- `project_id`: optional
- `acquisition_session_id`
- `calibration_session_id`: optional
- `calibration_master_id`: optional
- `calibration_kind`
- `score`
- `confidence_level`
- `hard_mismatches`
- `soft_mismatches`
- `match_reasons`
- `decision`: `undecided`, `accepted`, `rejected`, `overridden`
- `decided_at`

Validation:
- Accepted candidates become `ProjectSource` records for a project or reviewed
  library relationships for later reuse.

### SourceView

Project-local tool-friendly source projection.

Fields:
- `id`
- `project_id`
- `workflow_profile_id`
- `strategy`: `manifest_only`, `symlink`, `junction`, `hard_link`, `copy`,
  `hybrid`
- `root_relative_path`
- `plan_id`
- `status`: `planned`, `generated`, `stale`, `removed`, `failed`
- `created_at`

Relationships:
- Has many `SourceViewItem`

### SourceViewItem

Fields:
- `id`
- `source_view_id`
- `source_file_record_id`
- `generated_file_record_id`
- `link_kind`
- `target_relative_path`
- `tracked_for_cleanup`: boolean

### ProcessingAttempt

Fields:
- `id`
- `project_id`
- `workflow_profile_id`
- `attempt_name`
- `started_at`
- `ended_at`
- `status`: `planned`, `running`, `paused`, `completed`, `abandoned`,
  `superseded`
- `notes`

### ProcessingArtifact

Observed tool-managed/user-managed file or directory.

Fields:
- `id`
- `project_id`
- `processing_attempt_id`: optional
- `file_record_id`
- `artifact_type`: `registered`, `calibrated`, `debayered`, `local_normalized`,
  `drizzle`, `integration_cache`, `temporary`, `log`, `process_icon`,
  `tool_project_file`, `manual_note`, `unknown`
- `tool_id`
- `observed_at`
- `classification_confidence`
- `cleanup_eligibility`
- `protected_reason`

### ProjectOutput

Fields:
- `id`
- `project_id`
- `target_id`: optional
- `panel_id`: optional
- `file_record_id`
- `output_kind`: `final_image`, `final_stack`, `drizzle_result`,
  `published_export`, `preview`, `rejected`, `unknown`
- `verification_state`: `unreviewed`, `accepted`, `rejected`, `superseded`
- `protected`: default true for final outputs
- `notes`

### ProjectManifest

Generated protected documentation/export artifact.

Fields:
- `id`
- `project_id`
- `manifest_kind`: `json`, `jsonl_events`, `markdown`
- `format_version`
- `file_record_id`
- `generated_from_revision`
- `status`: `current`, `stale`, `failed`, `removed`
- `generated_at`

Validation:
- Manifests are generated from canonical records. Manual edits are not canonical
  in v1.

### CleanupPolicy

Fields:
- `id`
- `scope`: `global`, `project`, `resource`
- `parent_policy_id`
- `project_id`: optional
- `default_action`: `keep`, `archive`, `trash`, `delete_disabled`
- `permanent_delete_enabled`: default false
- `requires_final_verification`: default true
- `protected_categories`
- `artifact_type_rules`
- `version`

### CleanupTreeNode

Fields:
- `id`
- `project_id`
- `parent_node_id`
- `node_kind`: `directory`, `subdirectory`, `resource`, `artifact_group`,
  `artifact_type`, `file`
- `display_name`
- `file_record_id`: optional
- `artifact_type`: optional
- `policy_mode`: `inherit`, `enabled`, `disabled`, `override`
- `effective_action`: `keep`, `archive`, `trash`, `delete`
- `estimated_size_bytes`
- `protected_reason`

### FilesystemPlan

Reviewable plan for all filesystem mutations.

Fields:
- `id`
- `plan_kind`: `ingest_move`, `project_create`, `source_view_generate`,
  `source_view_remove`, `archive`, `cleanup`, `root_remap`, `manifest_generate`
- `status`: `draft`, `ready_for_review`, `approved`, `applying`,
  `partially_applied`, `applied`, `failed`, `cancelled`, `superseded`
- `summary`
- `estimated_reclaimable_bytes`
- `created_at`
- `approved_at`
- `applied_at`
- `created_from_operation_id`

Relationships:
- Has many `PlanItem`
- Has many `PlanApproval`
- Has many `AuditLogEntry`

### PlanItem

Fields:
- `id`
- `plan_id`
- `action`: `mkdir`, `move`, `copy`, `link`, `junction`, `hard_link`,
  `write_manifest`, `archive`, `trash`, `delete`, `remove_generated_link`,
  `record_only`
- `source_root_id`, `source_relative_path`: optional
- `destination_root_id`, `destination_relative_path`: optional
- `preconditions`
- `conflict_policy`: `fail_if_exists`, `rename_with_suffix`, `skip_if_exists`,
  `manual_resolution_required`
- `protection_status`
- `dry_run_result`
- `apply_status`: `pending`, `applied`, `failed`, `skipped`, `rolled_back`
- `failure_message`

Validation:
- Permanent delete is invalid unless enabled by policy and explicitly approved.
- Existing destination overwrite is invalid unless the conflict policy explicitly
  prevents silent overwrite.

### PlanApproval

Fields:
- `id`
- `plan_id`
- `approved_by`
- `approval_scope`
- `approval_note`
- `created_at`

### AuditLogEntry

Immutable audit record.

Fields:
- `id`
- `event_type`: `plan_created`, `plan_approved`, `plan_applied`,
  `item_applied`, `item_failed`, `root_remapped`, `manifest_generated`,
  `source_view_generated`, `cleanup_decision_recorded`
- `entity_type`
- `entity_id`
- `plan_id`: optional
- `plan_item_id`: optional
- `timestamp`
- `actor`
- `details_json`
- `result`: `success`, `failure`, `partial`, `skipped`

Validation:
- Audit entries are append-only.

### RuleOrTemplate

Fields:
- `id`
- `rule_kind`: `classification`, `naming`, `retention`, `protected_folder`,
  `alias`, `taxonomy`, `metadata_keyword_map`
- `name`
- `definition_json`
- `enabled`
- `scope`
- `version`

### OperationState

Tracks long-running operations.

Fields:
- `id`
- `operation_type`: `scan_root`, `extract_metadata`, `classify`,
  `match_calibration`, `generate_plan`, `apply_plan`, `observe_workspace`,
  `generate_manifest`
- `status`: `queued`, `running`, `pausing`, `paused`, `cancelling`,
  `cancelled`, `completed`, `failed`
- `progress_current`
- `progress_total`
- `current_message`
- `started_at`, `finished_at`
- `resume_token`
- `error_code`
- `error_message`

## State Transitions

### Project Lifecycle

```text
candidate
  -> active
  -> source_mapped
  -> prepared
  -> processing
  -> finalized
  -> verified
  -> cleanup_reviewed
  -> archived
  -> retired
```

Allowed side transitions:
- Any state before `archived` may return to `active` when sources or outputs are
  revised.
- `verified` is required before cleanup candidates can default to archive/trash.
- `archived` can move to `active` through a restore/reopen workflow.

### Filesystem Plan

```text
draft -> ready_for_review -> approved -> applying -> applied
                                      -> partially_applied
                                      -> failed
draft -> cancelled
ready_for_review -> cancelled
```

### Acquisition Session

```text
candidate -> confirmed
candidate -> rejected
confirmed -> superseded
```

`confirmed` sessions are immutable source identities. Supersession records why
a candidate grouping was replaced without deleting history.
