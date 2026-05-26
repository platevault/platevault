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
