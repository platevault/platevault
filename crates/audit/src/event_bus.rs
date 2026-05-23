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
