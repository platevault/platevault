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
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct SourceCountByKind {
    pub light_frames: usize,
    pub dark: usize,
    pub flat: usize,
    pub bias: usize,
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
