//! Event envelope and payload types for the hybrid event bus.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

use domain_core::ids::Timestamp;
use domain_core::lifecycle::data_asset::EntityType;

/// Who caused the event to be emitted.
#[derive(
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    JsonSchema,
    Type,
)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    User,
    Restore,
    System,
}

/// Versioned event envelope wrapping any serialisable payload.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EventEnvelope<P: Type> {
    pub contract_version: String,
    pub topic: String,
    pub source: Source,
    pub emitted_at: Timestamp,
    pub payload: P,
}

impl<P: Type> EventEnvelope<P> {
    #[must_use]
    pub fn new(topic: impl Into<String>, source: Source, payload: P) -> Self {
        Self {
            contract_version: "1.0.0".to_owned(),
            topic: topic.into(),
            source,
            emitted_at: Timestamp::now_utc(),
            payload,
        }
    }
}

/// Payload for the `lifecycle.transition.applied` topic.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleTransitionApplied {
    pub entity_type: EntityType,
    pub entity_id: String,
    pub from_state: String,
    pub to_state: String,
    pub actor: String,
    pub at: Timestamp,
}

pub const TOPIC_LIFECYCLE_TRANSITION_APPLIED: &str = "lifecycle.transition.applied";

/// Per-kind source counts for the `first_run.completed` audit event.
///
/// `calibration` replaces the former `dark`, `flat`, and `bias` fields now
/// that the source-folder kind is unified into a single `calibration` bucket.
/// Per-image frame type is detected from image metadata (FITS `IMAGETYP`),
/// not from the source-folder kind.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct SourceCountByKind {
    pub light_frames: usize,
    pub calibration: usize,
    pub project: usize,
    pub inbox: usize,
}

/// Payload for the `first_run.completed` topic (spec 003).
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct FirstRunCompleted {
    pub completed_at: String,
    pub source_count_by_kind: SourceCountByKind,
}

pub const TOPIC_FIRST_RUN_COMPLETED: &str = "first_run.completed";

// ── Native filesystem control audit events (spec 004) ─────────────────────

/// Kind of picker that failed.
#[derive(
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    JsonSchema,
    Type,
)]
#[serde(rename_all = "snake_case")]
pub enum PickerKind {
    Directory,
    File,
}

/// Payload for the `native.picker.failed` topic (spec 004).
///
/// Audit event emitted when an OS picker dialog fails.
/// Does NOT include path or path_hash fields (A2 decision: correlate via entity_id).
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct NativePickerFailed {
    pub picker_kind: PickerKind,
    pub error_code: String,
    pub request_id: String,
}

pub const TOPIC_NATIVE_PICKER_FAILED: &str = "native.picker.failed";

/// Payload for the `native.reveal.failed` topic (spec 004).
///
/// Audit event emitted when a reveal-in-OS operation fails.
/// Does NOT include path or path_hash fields (A2 decision: correlate via entity_id).
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct NativeRevealFailed {
    pub error_code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_id: Option<String>,
    pub request_id: String,
}

pub const TOPIC_NATIVE_REVEAL_FAILED: &str = "native.reveal.failed";

// ── Settings audit events (spec 018, T005) ────────────────────────────────

/// Payload for the `settings.changed` topic (spec 018, T005).
///
/// Emitted for non-noisy key writes when the value actually changed.
/// Noisy keys (pattern, protectedCategories, plans.list.default_age_cutoff_days,
/// rememberFollowLogs) appear in `settings.snapshot` instead.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct SettingsChanged {
    /// The settings key that was written.
    pub key: String,
    /// Value before the write (JSON value).
    pub prior_value: serde_json::Value,
    /// Value after the write (JSON value).
    pub new_value: serde_json::Value,
    /// ISO-8601 timestamp.
    pub at: String,
}

pub const TOPIC_SETTINGS_CHANGED: &str = "settings.changed";

/// Payload for the `settings.snapshot` topic (spec 018, T005).
///
/// Emitted at session start and after a 5-minute inactivity debounce following
/// noisy-key writes (R-Aud-1). Contains the current value of noisy keys only.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSnapshot {
    /// Reason the snapshot was taken: "session_start" or "inactivity_debounce".
    pub trigger: String,
    /// Snapshot of noisy key values at the time of emission.
    pub noisy_keys: serde_json::Value,
    /// ISO-8601 timestamp.
    pub at: String,
}

pub const TOPIC_SETTINGS_SNAPSHOT: &str = "settings.snapshot";

/// Payload for the `settings.repair` topic (spec 018, T005).
///
/// Emitted at warn level when a stored settings value fails schema validation
/// and is reset to its in-code default (T019).
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct SettingsRepair {
    /// The settings key that was reset.
    pub key: String,
    /// The invalid stored value that triggered the repair.
    pub invalid_value: serde_json::Value,
    /// The default value restored.
    pub default_value: serde_json::Value,
    /// ISO-8601 timestamp.
    pub at: String,
}

pub const TOPIC_SETTINGS_REPAIR: &str = "settings.repair";

// ── Plan lifecycle audit events (spec 017, A7) ────────────────────────────────

/// Payload for the `plan.approved` topic (spec 017, A7).
///
/// Emitted when a reviewer approves a plan. Includes the actor and prior state.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanApproved {
    /// Stable plan id.
    pub plan_id: String,
    /// Prior state before approval (always `ready_for_review`).
    pub prior_state: String,
    /// Actor who approved the plan.
    pub actor: String,
    /// ISO-8601 timestamp of approval.
    pub approved_at: String,
}

pub const TOPIC_PLAN_APPROVED: &str = "plan.approved";

/// Payload for the `plan.discarded` topic (spec 017, A7, A5).
///
/// Emitted when a plan is soft-deleted. The audit record is retained even after
/// the plan's `discardedAt` is set.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanDiscarded {
    /// Stable plan id.
    pub plan_id: String,
    /// State at the time of discard.
    pub prior_state: String,
    /// ISO-8601 timestamp of discard.
    pub discarded_at: String,
}

pub const TOPIC_PLAN_DISCARDED: &str = "plan.discarded";

/// Payload for the `plan.retry_created` topic (spec 017, A7).
///
/// Emitted when a retry plan is created from a terminal parent.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanRetryCreated {
    /// The new (retry) plan id.
    pub new_plan_id: String,
    /// The terminal parent plan id.
    pub parent_plan_id: String,
    /// Which items filter was used: "failed", "cancelled", or "all".
    pub items_filter: String,
    /// Number of items materialised into the retry plan.
    pub items_total: i64,
    /// ISO-8601 timestamp.
    pub at: String,
}

pub const TOPIC_PLAN_RETRY_CREATED: &str = "plan.retry_created";

/// Payload for the `archive.sent_to_trash` topic (spec 017, R-Archive-2).
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveSentToTrash {
    pub plan_id: String,
    pub items_moved: i64,
    pub at: String,
}

pub const TOPIC_ARCHIVE_SENT_TO_TRASH: &str = "archive.sent_to_trash";

/// Payload for the `archive.permanently_deleted` topic (spec 017, R-Archive-2).
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct ArchivePermanentlyDeleted {
    pub plan_id: String,
    pub items_deleted: i64,
    pub at: String,
}

pub const TOPIC_ARCHIVE_PERMANENTLY_DELETED: &str = "archive.permanently_deleted";

// ── Plan apply audit events (spec 025, A7) ────────────────────────────────────

/// Payload for the `plan.applying.started` topic (spec 025, A7).
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanApplyingStarted {
    pub plan_id: String,
    pub run_id: String,
    pub items_total: i64,
    pub at: String,
}

pub const TOPIC_PLAN_APPLYING_STARTED: &str = "plan.applying.started";

/// Payload for the `plan.item.progress` topic (spec 025, A7).
///
/// Emitted per item state transition. `failure` is present when
/// `new_state` is `"failed"` or `"stale"`.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanItemProgress {
    pub plan_id: String,
    pub run_id: String,
    pub item_id: String,
    pub prior_state: String,
    pub new_state: String,
    pub at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_recoverable: Option<bool>,
}

pub const TOPIC_PLAN_ITEM_PROGRESS: &str = "plan.item.progress";

/// Payload for the `plan.applying.paused` topic (spec 025, A7, R-Pause-1).
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanApplyingPaused {
    pub plan_id: String,
    pub run_id: String,
    pub pause_reason: String,
    pub at: String,
}

pub const TOPIC_PLAN_APPLYING_PAUSED: &str = "plan.applying.paused";

/// Payload for the `plan.applying.resumed` topic (spec 025, A7, R-Pause-1).
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanApplyingResumed {
    pub plan_id: String,
    pub run_id: String,
    pub at: String,
}

pub const TOPIC_PLAN_APPLYING_RESUMED: &str = "plan.applying.resumed";

/// Payload for the `plan.applying.completed` topic (spec 025, A7).
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanApplyingCompleted {
    pub plan_id: String,
    pub run_id: String,
    pub terminal_state: String,
    pub items_applied: i64,
    pub items_failed: i64,
    pub items_skipped: i64,
    pub items_cancelled: i64,
    pub at: String,
}

pub const TOPIC_PLAN_APPLYING_COMPLETED: &str = "plan.applying.completed";

// ── Catalog download audit events (spec 014, T007-event, R-3.1) ───────────────

/// Payload for the `catalog.manifest.fetched` topic (spec 014, R-3.1).
///
/// Emitted when the catalog manifest has been downloaded and verified.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct CatalogManifestFetched {
    /// Number of catalog entries in the manifest.
    pub catalog_count: usize,
    /// ETag returned by the server for subsequent conditional fetches.
    pub etag: Option<String>,
    pub at: String,
}

pub const TOPIC_CATALOG_MANIFEST_FETCHED: &str = "catalog.manifest.fetched";

/// Payload for the `catalog.download.started` topic (spec 014, R-3.1).
///
/// Emitted when download of a single catalog artifact has started.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDownloadStarted {
    pub catalog_id: String,
    pub at: String,
}

pub const TOPIC_CATALOG_DOWNLOAD_STARTED: &str = "catalog.download.started";

/// Payload for the `catalog.download.progress` topic (spec 014, R-3.1).
///
/// Emitted periodically during a catalog download for progress UI.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDownloadProgress {
    pub catalog_id: String,
    /// Bytes received so far.
    pub bytes_received: u64,
    /// Total bytes expected (0 if unknown).
    pub bytes_total: u64,
    pub at: String,
}

pub const TOPIC_CATALOG_DOWNLOAD_PROGRESS: &str = "catalog.download.progress";

/// Payload for the `catalog.download.completed` topic (spec 014, R-3.1).
///
/// Emitted when a catalog has been verified and installed into SQLite.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDownloadCompleted {
    pub catalog_id: String,
    /// Audit event id that correlates with the `catalog.download` contract response.
    pub audit_id: String,
    pub at: String,
}

pub const TOPIC_CATALOG_DOWNLOAD_COMPLETED: &str = "catalog.download.completed";

/// Payload for the `catalog.download.failed` topic (spec 014, R-3.1).
///
/// Emitted when a catalog download or verification failed. The previously
/// installed catalog (if any) remains active.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDownloadFailed {
    pub catalog_id: String,
    /// Contract error code.
    pub error_code: String,
    pub message: String,
    pub at: String,
}

pub const TOPIC_CATALOG_DOWNLOAD_FAILED: &str = "catalog.download.failed";

/// Payload for the `tool.launch` topic (spec 011, T009).
///
/// Emitted after a processing tool is spawned (or attempted) for a project.
/// `outcome` values mirror `LaunchOutcome` in the data model:
///   `spawned` | `spawn_failed` | `tool_not_configured` | `executable_not_found`
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolLaunchEvent {
    pub launch_id: String,
    pub project_id: String,
    pub tool_id: String,
    /// Resolved working directory passed to the child process.
    pub working_dir: Option<String>,
    /// BLAKE3 hex of `canonicalized_executable_path || rendered_argv`.
    pub args_hash: Option<String>,
    /// `spawned` | `spawn_failed` | `tool_not_configured` | `executable_not_found`
    pub outcome: String,
    pub at: String,
}

pub const TOPIC_TOOL_LAUNCH: &str = "tool.launch";

// ── Artifact observation audit events (spec 012, T007/T007b/FR-008) ──────────

/// Payload for the `artifact.detected` topic (spec 012, T007).
///
/// Emitted when a new `ProcessingArtifact` row is created.
/// Constitution III: file was observed, never written or opened.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactDetected {
    /// UUID of the new `ProcessingArtifact` row.
    pub artifact_id: String,
    pub project_id: String,
    /// Project-relative path of the observed file.
    pub path: String,
    pub kind: String,
    pub tool: String,
    pub classification_source: String,
    pub classification_confidence: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_launch_id: Option<String>,
    pub detected_at: String,
}

pub const TOPIC_ARTIFACT_DETECTED: &str = "artifact.detected";

/// Payload for the `artifact.updated` topic (spec 012, T007, A8).
///
/// Emitted when a tool overwrites a path already indexed; the row is updated
/// in-place (`content_hash` refreshed). No new `artifact.detected` is emitted.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactUpdated {
    pub artifact_id: String,
    pub project_id: String,
    pub path: String,
    pub tool: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prior_content_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_content_hash: Option<String>,
    pub updated_at: String,
}

pub const TOPIC_ARTIFACT_UPDATED: &str = "artifact.updated";

/// Payload for the `artifact.missing` topic (spec 012, T007).
///
/// Emitted when a reconciliation scan finds that a previously `present` file
/// is no longer on disk (state → `missing`).
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactMissing {
    pub artifact_id: String,
    pub project_id: String,
    pub path: String,
    pub at: String,
}

pub const TOPIC_ARTIFACT_MISSING: &str = "artifact.missing";

/// Payload for the `artifact.recovered` topic (spec 012, T007).
///
/// Emitted when a `missing` artifact is found again on disk.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactRecovered {
    pub artifact_id: String,
    pub project_id: String,
    pub path: String,
    pub at: String,
}

pub const TOPIC_ARTIFACT_RECOVERED: &str = "artifact.recovered";

/// Payload for the `artifact.classify.override` topic (spec 012, T014).
///
/// Emitted when a user manually overrides an artifact's classification kind.
/// Override is sticky; subsequent re-classifications skip manual rows (T015).
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactClassifyOverride {
    pub artifact_id: String,
    pub project_id: String,
    pub new_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub at: String,
}

pub const TOPIC_ARTIFACT_CLASSIFY_OVERRIDE: &str = "artifact.classify.override";

/// Payload for the `artifact.classify.override.cleared` topic (spec 012, T014, A6).
///
/// Emitted when a `kind: null` call deletes the override row and triggers
/// rule re-classification.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactClassifyOverrideCleared {
    pub artifact_id: String,
    pub project_id: String,
    /// Kind the artifact held before the override was cleared.
    pub prior_kind: String,
    /// Kind assigned by rule re-classification after clearing.
    pub new_kind: String,
    pub at: String,
}

pub const TOPIC_ARTIFACT_CLASSIFY_OVERRIDE_CLEARED: &str = "artifact.classify.override.cleared";

/// Payload for the `artifact.user_resolved` topic (spec 012).
///
/// Emitted when the user marks a `missing` artifact as resolved.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactUserResolved {
    pub artifact_id: String,
    pub project_id: String,
    pub at: String,
}

pub const TOPIC_ARTIFACT_USER_RESOLVED: &str = "artifact.user_resolved";

/// Payload for the `workflow.run_completed` topic (spec 012, FR-010, R-Event-Light).
///
/// Emitted when the attribution pass sets `ToolLaunch.completed_at`.
/// Spec 024 subscribes to this event to write `workflow_run` manifests.
/// Source is always `system` for this event.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunCompleted {
    pub project_id: String,
    pub tool_id: String,
    pub tool_launch_id: String,
    pub completed_at: String,
    /// UUIDs of `ProcessingArtifact` rows attributed to this launch.
    pub artifact_ids: Vec<String>,
}

pub const TOPIC_WORKFLOW_RUN_COMPLETED: &str = "workflow.run_completed";

// ── Spec 016: Source Protection ───────────────────────────────────────────

/// Payload for the `protection.source.set` topic (spec 016 T016).
///
/// Emitted every time a per-source protection override is written or updated.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProtectionSourceSet {
    pub source_id: String,
    pub prior_level: String,
    pub new_level: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prior_categories: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_categories: Option<Vec<String>>,
    pub at: String,
}

pub const TOPIC_PROTECTION_SOURCE_SET: &str = "protection.source.set";

/// Payload for the `protection.plan.acknowledged` topic (spec 016 T025).
///
/// Emitted when the user explicitly acknowledges a protected plan item before
/// plan execution proceeds.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProtectionPlanAcknowledged {
    pub plan_id: String,
    pub item_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    pub resolved_level: String,
    pub reason: String,
    pub at: String,
}

pub const TOPIC_PROTECTION_PLAN_ACKNOWLEDGED: &str = "protection.plan.acknowledged";

// ── Guided first project flow audit events (spec 010) ────────────────────────

/// Payload for the `inventory.confirmed` topic (spec 010 / spec 005 T027).
///
/// Emitted when an inbox item is confirmed into inventory through the normal
/// confirm path. `source` on the envelope MUST be checked by guided-flow
/// subscriber: ignore events where `source == Restore`.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct InventoryConfirmed {
    /// The inbox item id that was confirmed.
    pub inbox_item_id: String,
    /// The resulting plan id.
    pub plan_id: String,
    pub at: String,
}

pub const TOPIC_INVENTORY_CONFIRMED: &str = "inventory.confirmed";

/// Payload for the `guided_flow.state.corrupted` diagnostic topic (spec 010,
/// FR-010, R-Corrupt).
///
/// Emitted when the guided_flow_state row fails to deserialize. The row is
/// reset to Idle before this event is emitted.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct GuidedFlowStateCorrupted {
    /// Raw corrupt value that was found in the database.
    pub corrupt_raw: String,
    /// Parse error detail.
    pub parse_error: String,
    pub at: String,
}

pub const TOPIC_GUIDED_FLOW_STATE_CORRUPTED: &str = "guided_flow.state.corrupted";
