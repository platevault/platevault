// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

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
pub enum Outcome {
    Applied,
    Refused,
    Failed,
}

impl Outcome {
    /// DB column value (matches the `audit_log_entry.outcome` CHECK constraint).
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Applied => "applied",
            Self::Refused => "refused",
            Self::Failed => "failed",
        }
    }
}

/// Visibility tier for the audit event (FR-008).
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
pub enum Severity {
    Workflow,
    Diagnostic,
}

impl Severity {
    /// DB column value (matches the `audit_log_entry.severity` CHECK constraint).
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Workflow => "workflow",
            Self::Diagnostic => "diagnostic",
        }
    }

    /// Default UI severity for newly minted audit entries (FR-008).
    ///
    /// Workflow is the visible tier; diagnostic stays log-only behind the
    /// spec 019 panel toggle.
    #[must_use]
    pub const fn default_for_entry() -> Self {
        Self::Workflow
    }
}

/// Severity filter for timeline reads (T045).
///
/// Default UI timelines render `WorkflowOnly`; the spec 019 log panel can
/// flip to `All` to surface diagnostic entries.
#[derive(
    Clone,
    Copy,
    Debug,
    Default,
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
pub enum SeverityFilter {
    /// Default for primary surfaces.
    #[default]
    WorkflowOnly,
    /// Include diagnostic-tier entries (log panel toggle).
    All,
}

impl SeverityFilter {
    /// `true` when the supplied severity should be included.
    #[must_use]
    pub const fn includes(self, severity: Severity) -> bool {
        match self {
            Self::All => true,
            Self::WorkflowOnly => matches!(severity, Severity::Workflow),
        }
    }
}

/// Durable, append-only record of a mutation attempt.
///
/// Spec 030 FR-133 (T120, Q15/#647): generalized from a lifecycle-transition
/// record to a generic mutation record — `entity_type` extends beyond the
/// lifecycle `DataAsset` families (see `EntityType::Settings/Protection/
/// Equipment`), `trigger` doubles as the generic `action`, and `reason_code`
/// is the first-class machine-readable detail for `refused`/`failed`
/// outcomes. `from_state`/`to_state` stay lifecycle-transition-specific;
/// non-lifecycle mutations carry their before→after value pair in `payload`
/// instead (data-model.md "Audit Entry — Generalized Mutation Record").
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
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
    /// Machine-readable reason/code for `refused`/`failed` outcomes; `None`
    /// for `applied` (T120 migration: nullable `reason_code` column).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<String>,
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
            reason_code: None,
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

    /// Attach the machine-readable reason/code for a `refused`/`failed` outcome.
    #[must_use]
    pub fn with_reason_code(mut self, reason_code: impl Into<String>) -> Self {
        self.reason_code = Some(reason_code.into());
        self
    }
}
