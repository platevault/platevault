//! Reviewable filesystem plans and plan item boundaries.

use domain_core::{Actor, EntityId, PlanStatus, Timestamp};
use serde::{Deserialize, Serialize};

pub const CRATE_NAME: &str = "fs_planner";

pub type PlanResult<T> = Result<T, PlanError>;

#[derive(Debug, thiserror::Error)]
pub enum PlanError {
    #[error("plan must be ready for review before approval; current status is {0:?}")]
    NotReadyForApproval(PlanStatus),
    #[error("plan contains permanent delete items without explicit delete approval")]
    DeleteApprovalRequired,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct FilesystemPlan {
    pub id: EntityId,
    pub plan_kind: PlanKind,
    pub status: PlanStatus,
    pub summary: String,
    pub estimated_reclaimable_bytes: u64,
    pub created_at: Timestamp,
    pub approved_at: Option<Timestamp>,
    pub applied_at: Option<Timestamp>,
    pub created_from_operation_id: Option<String>,
    pub items: Vec<PlanItem>,
    pub approvals: Vec<PlanApproval>,
}

impl FilesystemPlan {
    #[must_use]
    pub fn draft(plan_kind: PlanKind, summary: impl Into<String>) -> Self {
        Self {
            id: EntityId::new(),
            plan_kind,
            status: PlanStatus::Draft,
            summary: summary.into(),
            estimated_reclaimable_bytes: 0,
            created_at: Timestamp::now_utc(),
            approved_at: None,
            applied_at: None,
            created_from_operation_id: None,
            items: Vec::new(),
            approvals: Vec::new(),
        }
    }

    pub fn add_item(&mut self, item: PlanItem) {
        self.items.push(item);
    }

    pub fn mark_ready_for_review(&mut self) {
        self.status = PlanStatus::ReadyForReview;
    }

    #[allow(clippy::missing_errors_doc)] // error variants documented on PlanError type
    pub fn approve(&mut self, approval: PlanApproval) -> PlanResult<()> {
        if self.status != PlanStatus::ReadyForReview {
            return Err(PlanError::NotReadyForApproval(self.status));
        }

        if self.items.iter().any(PlanItem::requires_delete_approval)
            && !approval.permanent_delete_approved
        {
            return Err(PlanError::DeleteApprovalRequired);
        }

        self.approved_at = Some(approval.created_at);
        self.status = PlanStatus::Approved;
        self.approvals.push(approval);
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanKind {
    IngestMove,
    ProjectCreate,
    SourceViewGenerate,
    SourceViewRemove,
    Archive,
    Cleanup,
    RootRemap,
    ManifestGenerate,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PlanItem {
    pub id: EntityId,
    pub plan_id: EntityId,
    pub action: PlanItemAction,
    pub source_root_id: Option<EntityId>,
    pub source_relative_path: Option<String>,
    pub destination_root_id: Option<EntityId>,
    pub destination_relative_path: Option<String>,
    pub preconditions: Vec<PlanPrecondition>,
    pub conflict_policy: ConflictPolicy,
    pub protection_status: ProtectionStatus,
    pub dry_run_result: DryRunResult,
    pub apply_status: PlanItemApplyStatus,
    pub failure_message: Option<String>,
}

impl PlanItem {
    #[must_use]
    pub fn new(plan_id: EntityId, action: PlanItemAction) -> Self {
        Self {
            id: EntityId::new(),
            plan_id,
            action,
            source_root_id: None,
            source_relative_path: None,
            destination_root_id: None,
            destination_relative_path: None,
            preconditions: Vec::new(),
            conflict_policy: ConflictPolicy::FailIfExists,
            protection_status: ProtectionStatus::Unprotected,
            dry_run_result: DryRunResult::NotRun,
            apply_status: PlanItemApplyStatus::Pending,
            failure_message: None,
        }
    }

    #[must_use]
    pub const fn requires_delete_approval(&self) -> bool {
        matches!(self.action, PlanItemAction::Delete)
    }

    pub fn add_precondition(&mut self, precondition: PlanPrecondition) {
        self.preconditions.push(precondition);
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanItemAction {
    Mkdir,
    Move,
    Copy,
    Link,
    Junction,
    HardLink,
    WriteManifest,
    Archive,
    Trash,
    Delete,
    RemoveGeneratedLink,
    RecordOnly,
    /// Record-in-place: no filesystem mutation; marks the item as catalogued.
    /// spec 041 (inbox plan surface).
    Catalogue,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum PlanPrecondition {
    SourceExists { root_id: EntityId, relative_path: String },
    DestinationMissing { root_id: EntityId, relative_path: String },
    RootAvailable { root_id: EntityId },
    GeneratedByApp { record_id: EntityId },
    PlanRevisionMatches { expected_revision: u64 },
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictPolicy {
    FailIfExists,
    RenameWithSuffix,
    SkipIfExists,
    ManualResolutionRequired,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum ProtectionStatus {
    Unprotected,
    Protected { reason: String },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum DryRunResult {
    NotRun,
    Passed,
    Failed { message: String },
    Warning { message: String },
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanItemApplyStatus {
    Pending,
    Applied,
    Failed,
    Skipped,
    RolledBack,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PlanApproval {
    pub id: EntityId,
    pub plan_id: EntityId,
    pub approved_by: Actor,
    pub approval_scope: ApprovalScope,
    pub approval_note: String,
    pub permanent_delete_approved: bool,
    pub created_at: Timestamp,
}

impl PlanApproval {
    #[must_use]
    pub fn new(
        plan_id: EntityId,
        approved_by: Actor,
        approval_scope: ApprovalScope,
        approval_note: impl Into<String>,
    ) -> Self {
        Self {
            id: EntityId::new(),
            plan_id,
            approved_by,
            approval_scope,
            approval_note: approval_note.into(),
            permanent_delete_approved: false,
            created_at: Timestamp::now_utc(),
        }
    }

    #[must_use]
    pub const fn with_permanent_delete_approval(mut self) -> Self {
        self.permanent_delete_approved = true;
        self
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalScope {
    EntirePlan,
    SelectedItems,
}

#[cfg(test)]
mod tests {
    use domain_core::{Actor, PlanStatus};

    use super::{
        ApprovalScope, FilesystemPlan, PlanApproval, PlanError, PlanItem, PlanItemAction, PlanKind,
        CRATE_NAME,
    };

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "fs_planner");
    }

    #[test]
    fn approves_ready_plan_without_delete_items() {
        let mut plan = FilesystemPlan::draft(PlanKind::ProjectCreate, "Create project envelope");
        plan.add_item(PlanItem::new(plan.id, PlanItemAction::Mkdir));
        plan.mark_ready_for_review();
        let approval = PlanApproval::new(
            plan.id,
            Actor::local("tester"),
            ApprovalScope::EntirePlan,
            "Reviewed",
        );

        plan.approve(approval).unwrap();

        assert_eq!(plan.status, PlanStatus::Approved);
        assert_eq!(plan.approvals.len(), 1);
        assert!(plan.approved_at.is_some());
    }

    #[test]
    fn blocks_approval_before_review_state() {
        let mut plan = FilesystemPlan::draft(PlanKind::Cleanup, "Cleanup generated artifacts");
        let approval = PlanApproval::new(
            plan.id,
            Actor::local("tester"),
            ApprovalScope::EntirePlan,
            "Reviewed",
        );

        assert!(matches!(
            plan.approve(approval).unwrap_err(),
            PlanError::NotReadyForApproval(PlanStatus::Draft)
        ));
    }

    #[test]
    fn blocks_delete_without_explicit_delete_approval() {
        let mut plan = FilesystemPlan::draft(PlanKind::Cleanup, "Delete generated artifact");
        plan.add_item(PlanItem::new(plan.id, PlanItemAction::Delete));
        plan.mark_ready_for_review();
        let approval = PlanApproval::new(
            plan.id,
            Actor::local("tester"),
            ApprovalScope::EntirePlan,
            "Reviewed",
        );

        assert!(matches!(plan.approve(approval).unwrap_err(), PlanError::DeleteApprovalRequired));
    }
}
