//! Spec 029 plan stubs exposed to the Tauri webview.
//!
//! Stub implementations returning hardcoded fixture data matching the mock
//! layer until the real persistence layer is wired.

use contracts_core::lifecycle::PlanState;
use contracts_core::plans::{
    DryRunResult, FilesystemPlan, PlanDetail, PlanItem, PlanItemAction, PlanItemStatus, PlanKind,
    PlanSafetySummary,
};
use contracts_core::provenance::ProvenanceOrigin;
use contracts_core::roots::IpcOperationHandle;

/// `plans.list` — returns all filesystem plans.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "plans.list")]
pub async fn plans_list(
    filters: Option<serde_json::Value>,
) -> Result<Vec<FilesystemPlan>, String> {
    tracing::debug!("stub: plans.list filters={filters:?}");
    Ok(stub_plans())
}

/// `plans.get` — returns a single plan detail.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "plans.get")]
pub async fn plans_get(id: String) -> Result<PlanDetail, String> {
    tracing::debug!("stub: plans.get id={id}");
    let base = stub_plans().into_iter().next().unwrap();
    Ok(PlanDetail {
        id: id.clone(),
        kind: base.kind,
        state: base.state,
        items: base.items.clone(),
        dry_run_result: base.dry_run_result,
        has_destructive: base.has_destructive,
        reclaim_bytes: base.reclaim_bytes,
        created_at: base.created_at,
        approved_at: base.approved_at,
        applied_at: base.applied_at,
        summary: PlanSafetySummary {
            item_count: base.items.len() as u32,
            reclaim_bytes: base.reclaim_bytes,
            trash_count: 0,
            archive_count: 1,
            delete_count: 0,
            protected_count: 1,
        },
    })
}

/// `plans.approve` — approve a plan for application.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "plans.approve")]
pub async fn plans_approve(
    id: String,
    delete_acknowledged: Option<bool>,
) -> Result<FilesystemPlan, String> {
    tracing::debug!("stub: plans.approve id={id} delete_acknowledged={delete_acknowledged:?}");
    let mut plan = stub_plans().into_iter().next().unwrap();
    plan.id = id;
    plan.state = PlanState::Approved;
    plan.approved_at = Some("2026-05-25T12:30:00Z".to_owned());
    Ok(plan)
}

/// `plans.apply` — apply an approved plan, returning an operation handle.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "plans.apply")]
pub async fn plans_apply(id: String) -> Result<IpcOperationHandle, String> {
    tracing::debug!("stub: plans.apply id={id}");
    Ok(IpcOperationHandle {
        operation_id: format!("op-plan-apply-{id}"),
        kind: "plan_apply".to_owned(),
    })
}

/// `plans.discard` — discard a plan.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "plans.discard")]
pub async fn plans_discard(id: String) -> Result<(), String> {
    tracing::debug!("stub: plans.discard id={id}");
    Ok(())
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

fn stub_plans() -> Vec<FilesystemPlan> {
    vec![
        FilesystemPlan {
            id: "plan-001".to_owned(),
            kind: PlanKind::ProjectStructure,
            state: PlanState::ReadyForReview,
            items: vec![
                PlanItem {
                    action: PlanItemAction::Mkdir,
                    source_path: String::new(),
                    dest_path: "/astro/projects/NGC7000_NB".to_owned(),
                    status: PlanItemStatus::Pending,
                    dry_run_ok: true,
                    protection_reason: None,
                    provenance: ProvenanceOrigin::Generated,
                },
                PlanItem {
                    action: PlanItemAction::Link,
                    source_path: "/astro/raw/NGC7000/Ha/light_001.fits".to_owned(),
                    dest_path: "/astro/projects/NGC7000_NB/lights/Ha/light_001.fits".to_owned(),
                    status: PlanItemStatus::Pending,
                    dry_run_ok: true,
                    protection_reason: None,
                    provenance: ProvenanceOrigin::Generated,
                },
                PlanItem {
                    action: PlanItemAction::Write,
                    source_path: String::new(),
                    dest_path: "/astro/projects/NGC7000_NB/manifest.json".to_owned(),
                    status: PlanItemStatus::Pending,
                    dry_run_ok: true,
                    protection_reason: None,
                    provenance: ProvenanceOrigin::Generated,
                },
            ],
            dry_run_result: DryRunResult { passed: 3, warnings: 0, failures: 0 },
            has_destructive: false,
            reclaim_bytes: 0,
            created_at: "2026-05-20T22:00:00Z".to_owned(),
            approved_at: None,
            applied_at: None,
        },
        FilesystemPlan {
            id: "plan-002".to_owned(),
            kind: PlanKind::Cleanup,
            state: PlanState::Approved,
            items: vec![
                PlanItem {
                    action: PlanItemAction::Archive,
                    source_path: "/astro/projects/NGC7000_NB/processing/registered".to_owned(),
                    dest_path: "/astro/archive/NGC7000_NB_registered.tar".to_owned(),
                    status: PlanItemStatus::Pending,
                    dry_run_ok: true,
                    protection_reason: None,
                    provenance: ProvenanceOrigin::Generated,
                },
                PlanItem {
                    action: PlanItemAction::Trash,
                    source_path: "/astro/projects/NGC7000_NB/processing/drizzle_data".to_owned(),
                    dest_path: String::new(),
                    status: PlanItemStatus::Protected,
                    dry_run_ok: false,
                    protection_reason: Some("output depends on drizzle data".to_owned()),
                    provenance: ProvenanceOrigin::Generated,
                },
            ],
            dry_run_result: DryRunResult { passed: 1, warnings: 1, failures: 0 },
            has_destructive: true,
            reclaim_bytes: 3_145_728_000,
            created_at: "2026-05-21T10:00:00Z".to_owned(),
            approved_at: Some("2026-05-21T10:30:00Z".to_owned()),
            applied_at: None,
        },
    ]
}
