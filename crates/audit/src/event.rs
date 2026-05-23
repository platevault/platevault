//! `AuditLogEntry` — the durable, append-only transition record.
//! Spec 002 data-model.md §AuditLogEntry.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;

use domain_core::ids::{AuditId, EntityId, Timestamp};
use domain_core::lifecycle::data_asset::EntityType;

/// Result class for an audit event.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema,
    Type,
)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Applied,
    Refused,
    Failed,
}

/// Visibility tier for the audit event (FR-008).
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema,
    Type,
)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Workflow,
    Diagnostic,
}

/// Durable, append-only record of a lifecycle transition attempt.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct AuditLogEntry {
    pub audit_id: AuditId,
    pub entity_type: EntityType,
    pub entity_id: EntityId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_state: Option<String>,
    pub trigger: String,
    pub actor: String,
    pub outcome: Outcome,
    pub severity: Severity,
    pub request_id: EntityId,
    pub at: Timestamp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
}

impl AuditLogEntry {
    #[must_use]
    pub fn new(
        entity_type: EntityType,
        entity_id: EntityId,
        trigger: impl Into<String>,
        actor: impl Into<String>,
        outcome: Outcome,
        severity: Severity,
        request_id: EntityId,
    ) -> Self {
        Self {
            audit_id: AuditId::new(),
            entity_type,
            entity_id,
            from_state: None,
            to_state: None,
            trigger: trigger.into(),
            actor: actor.into(),
            outcome,
            severity,
            request_id,
            at: Timestamp::now_utc(),
            payload: None,
        }
    }

    #[must_use]
    pub fn with_transition(mut self, from: impl Into<String>, to: impl Into<String>) -> Self {
        self.from_state = Some(from.into());
        self.to_state = Some(to.into());
        self
    }

    #[must_use]
    pub fn with_payload(mut self, payload: Value) -> Self {
        self.payload = Some(payload);
        self
    }
}
