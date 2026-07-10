//! Pure audit event, envelope, and publisher-seam types — no SQL, no runtime.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks
//!
//! Split out of `audit` (2026-07) so `persistence_db` can consume these types
//! without depending on `audit`'s `EventBus`, which itself depends on
//! `persistence_db` for the `events` table SQL. `audit` re-exports everything
//! here so existing `audit::event_bus::X` / `audit::X` import paths keep
//! compiling unchanged.

pub mod event;
pub mod event_bus;
pub mod publisher;

pub use event::{AuditLogEntry, Outcome, Severity, SeverityFilter};
pub use event_bus::{
    ArchivePermanentlyDeleted, ArchiveSentToTrash, ArtifactClassified, EventEnvelope,
    FirstRunCompleted, GuidedFlowStateCorrupted, InventoryConfirmed, LifecycleTransitionApplied,
    PlanApplyingCompleted, PlanApplyingPaused, PlanApplyingResumed, PlanApplyingStarted,
    PlanApproved, PlanDiscarded, PlanItemProgress, PlanRetryCreated, ProtectionDefaultChanged,
    ProtectionPlanAcknowledged, ProtectionSourceSet, SettingsChanged, SettingsMigration,
    SettingsRepair, SettingsSnapshot, Source, SourceCountByKind, TargetResolveBatchCompleted,
    TargetResolved, TOPIC_ARCHIVE_PERMANENTLY_DELETED, TOPIC_ARCHIVE_SENT_TO_TRASH,
    TOPIC_ARTIFACT_CLASSIFIED, TOPIC_FIRST_RUN_COMPLETED, TOPIC_GUIDED_FLOW_STATE_CORRUPTED,
    TOPIC_INVENTORY_CONFIRMED, TOPIC_LIFECYCLE_TRANSITION_APPLIED, TOPIC_PLAN_APPLYING_COMPLETED,
    TOPIC_PLAN_APPLYING_PAUSED, TOPIC_PLAN_APPLYING_RESUMED, TOPIC_PLAN_APPLYING_STARTED,
    TOPIC_PLAN_APPROVED, TOPIC_PLAN_DISCARDED, TOPIC_PLAN_ITEM_PROGRESS, TOPIC_PLAN_RETRY_CREATED,
    TOPIC_PROTECTION_DEFAULT_CHANGED, TOPIC_PROTECTION_PLAN_ACKNOWLEDGED,
    TOPIC_PROTECTION_SOURCE_SET, TOPIC_SETTINGS_CHANGED, TOPIC_SETTINGS_MIGRATION,
    TOPIC_SETTINGS_REPAIR, TOPIC_SETTINGS_SNAPSHOT, TOPIC_TARGET_RESOLVED,
    TOPIC_TARGET_RESOLVE_BATCH_COMPLETED,
};
pub use publisher::EventPublisher;

pub const CRATE_NAME: &str = "audit_types";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "audit_types");
    }
}
