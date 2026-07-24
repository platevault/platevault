// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Audit event, operation history, and in-process event bus.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks

pub mod bus;
pub mod event;
pub mod event_bus;
pub mod stale_propagator;

pub use bus::EventBus;
pub use event::{AuditLogEntry, Outcome, Severity, SeverityFilter};
pub use event_bus::{
    ArchivePermanentlyDeleted, ArchiveSentToTrash, ArtifactClassified, EventEnvelope,
    FirstRunCompleted, InventoryConfirmed, LifecycleTransitionApplied, PlanApplyingCompleted,
    PlanApplyingPaused, PlanApplyingResumed, PlanApplyingStarted, PlanApproved, PlanDiscarded,
    PlanItemProgress, PlanRetryCreated, ProtectionDefaultChanged, ProtectionPlanAcknowledged,
    ProtectionSourceSet, SettingsChanged, SettingsMigration, SettingsRepair, SettingsSnapshot,
    Source, SourceCountByKind, TargetResolveBatchCompleted, TargetResolved,
    TOPIC_ARCHIVE_PERMANENTLY_DELETED, TOPIC_ARCHIVE_SENT_TO_TRASH, TOPIC_ARTIFACT_CLASSIFIED,
    TOPIC_FIRST_RUN_COMPLETED, TOPIC_INVENTORY_CONFIRMED, TOPIC_LIFECYCLE_TRANSITION_APPLIED,
    TOPIC_PLAN_APPLYING_COMPLETED, TOPIC_PLAN_APPLYING_PAUSED, TOPIC_PLAN_APPLYING_RESUMED,
    TOPIC_PLAN_APPLYING_STARTED, TOPIC_PLAN_APPROVED, TOPIC_PLAN_DISCARDED,
    TOPIC_PLAN_ITEM_PROGRESS, TOPIC_PLAN_RETRY_CREATED, TOPIC_PROTECTION_DEFAULT_CHANGED,
    TOPIC_PROTECTION_PLAN_ACKNOWLEDGED, TOPIC_PROTECTION_SOURCE_SET, TOPIC_SETTINGS_CHANGED,
    TOPIC_SETTINGS_MIGRATION, TOPIC_SETTINGS_REPAIR, TOPIC_SETTINGS_SNAPSHOT,
    TOPIC_TARGET_RESOLVED, TOPIC_TARGET_RESOLVE_BATCH_COMPLETED,
};
pub use stale_propagator::{PropagatorFn, StalePropagator};

pub const CRATE_NAME: &str = "audit";

// ── Backward-compat re-exports for other crates that import the old API ──────

use domain_core::{ids::Timestamp, Actor, EntityId};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub type AuditWriteResult<T> = Result<T, AuditError>;

#[derive(Debug, thiserror::Error)]
pub enum AuditError {
    #[error("audit writer failed: {0}")]
    Writer(String),
}

/// Legacy flat entry used by the old `AppendOnlyAuditWriter` trait.
/// New code should use `event::AuditLogEntry` instead.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LegacyAuditLogEntry {
    pub id: EntityId,
    pub event_type: AuditEventType,
    pub entity_type: String,
    pub entity_id: Option<EntityId>,
    pub plan_id: Option<EntityId>,
    pub plan_item_id: Option<EntityId>,
    pub timestamp: Timestamp,
    pub actor: Actor,
    pub details_json: Value,
    pub result: AuditEventResult,
}

impl LegacyAuditLogEntry {
    #[must_use]
    pub fn new(
        event_type: AuditEventType,
        entity_type: impl Into<String>,
        actor: Actor,
        result: AuditEventResult,
    ) -> Self {
        Self {
            id: EntityId::new(),
            event_type,
            entity_type: entity_type.into(),
            entity_id: None,
            plan_id: None,
            plan_item_id: None,
            timestamp: Timestamp::now_utc(),
            actor,
            details_json: Value::Object(serde_json::Map::new()),
            result,
        }
    }

    #[must_use]
    pub fn for_entity(mut self, entity_id: EntityId) -> Self {
        self.entity_id = Some(entity_id);
        self
    }

    #[must_use]
    pub fn for_plan(mut self, plan_id: EntityId) -> Self {
        self.plan_id = Some(plan_id);
        self
    }

    #[must_use]
    pub fn for_plan_item(mut self, plan_item_id: EntityId) -> Self {
        self.plan_item_id = Some(plan_item_id);
        self
    }

    #[must_use]
    pub fn with_details(mut self, details_json: Value) -> Self {
        self.details_json = details_json;
        self
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditEventType {
    PlanCreated,
    PlanApproved,
    PlanApplied,
    ItemApplied,
    ItemFailed,
    RootRemapped,
    ManifestGenerated,
    SourceViewGenerated,
    CleanupDecisionRecorded,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditEventResult {
    Success,
    Failure,
    Partial,
    Skipped,
}

pub trait AppendOnlyAuditWriter {
    #[allow(clippy::missing_errors_doc)] // trait-level; callers decide on docs
    fn append(&mut self, entry: LegacyAuditLogEntry) -> AuditWriteResult<()>;
}

#[cfg(test)]
mod tests {
    use domain_core::Actor;
    use serde_json::json;

    use super::{
        AppendOnlyAuditWriter, AuditEventResult, AuditEventType, AuditWriteResult,
        LegacyAuditLogEntry, CRATE_NAME,
    };

    #[derive(Default)]
    struct InMemoryAuditWriter {
        entries: Vec<LegacyAuditLogEntry>,
    }

    impl AppendOnlyAuditWriter for InMemoryAuditWriter {
        fn append(&mut self, entry: LegacyAuditLogEntry) -> AuditWriteResult<()> {
            self.entries.push(entry);
            Ok(())
        }
    }

    #[test]
    fn exposes_crate_name() {
        // CRATE_NAME has no consumers today: assert against Cargo.toml's real
        // `name` (CARGO_PKG_NAME) instead of mirroring the constant's own
        // literal, so a package rename that forgets to update CRATE_NAME is
        // caught.
        assert_eq!(CRATE_NAME, env!("CARGO_PKG_NAME"));
    }

    #[test]
    fn creates_audit_entry_with_default_details() {
        let entry = LegacyAuditLogEntry::new(
            AuditEventType::PlanCreated,
            "filesystem_plan",
            Actor::system(),
            AuditEventResult::Success,
        );

        assert_eq!(entry.entity_type, "filesystem_plan");
        assert_eq!(entry.actor.as_str(), "system");
        assert_eq!(entry.details_json, json!({}));
    }

    #[test]
    fn append_only_writer_records_entries_in_order() {
        let mut writer = InMemoryAuditWriter::default();
        let first = LegacyAuditLogEntry::new(
            AuditEventType::PlanApproved,
            "filesystem_plan",
            Actor::local("tester"),
            AuditEventResult::Success,
        );
        let second = LegacyAuditLogEntry::new(
            AuditEventType::ItemFailed,
            "plan_item",
            Actor::local("tester"),
            AuditEventResult::Failure,
        )
        .with_details(json!({ "reason": "destination exists" }));

        writer.append(first).unwrap();
        writer.append(second).unwrap();

        assert_eq!(writer.entries.len(), 2);
        assert_eq!(writer.entries[0].event_type, AuditEventType::PlanApproved);
        assert_eq!(writer.entries[1].event_type, AuditEventType::ItemFailed);
    }
}
