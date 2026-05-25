//! Spec 029 project stubs exposed to the Tauri webview.
//!
//! Stub implementations returning hardcoded fixture data matching the mock
//! layer until the real persistence layer is wired.

use contracts_core::lifecycle::{PlanState, ProjectState};
use contracts_core::JsonAny;
use contracts_core::plans::{
    DryRunResult, FilesystemPlan, PlanItem, PlanItemAction, PlanItemStatus, PlanKind,
};
use contracts_core::projects::{
    CleanupEligibility, CleanupState, OutputVerification, Project, ProjectArtifactGroup,
    ProjectDetail, ProjectOutput, ProjectSource, ProjectSourceView, SourceMap, SourceRole,
    SourceSelection, SourceViewStrategy, VerificationState,
};
use contracts_core::provenance::ProvenanceOrigin;
use contracts_core::sessions::ConfidenceLevel;

/// `projects.list` — returns all projects.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "projects.list")]
pub async fn projects_list(
    filters: Option<JsonAny>,
) -> Result<Vec<Project>, String> {
    tracing::debug!("stub: projects.list filters={filters:?}");
    Ok(stub_projects())
}

/// `projects.get` — returns a single project detail.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "projects.get")]
pub async fn projects_get(id: String) -> Result<ProjectDetail, String> {
    tracing::debug!("stub: projects.get id={id}");
    let base = stub_projects().into_iter().next().unwrap();
    Ok(ProjectDetail {
        id: id.clone(),
        name: base.name,
        workflow_profile_id: base.workflow_profile_id,
        root_path: base.root_path,
        state: base.state,
        blocked_reason: base.blocked_reason,
        verification_state: base.verification_state,
        cleanup_state: base.cleanup_state,
        integration_hours: base.integration_hours,
        target_ids: base.target_ids,
        source_map: base.source_map,
        source_view_ids: base.source_view_ids,
        output_ids: base.output_ids,
        processing_directory: base.processing_directory,
        output_directory: base.output_directory,
        updated_at: base.updated_at,
        targets: vec!["NGC 7000".to_owned()],
        sources: vec![
            ProjectSource {
                role: SourceRole::Light,
                name: "NGC 7000 Ha".to_owned(),
                frames: 18,
                hours: "3.0h".to_owned(),
                selection: SourceSelection::Selected,
                warning: None,
            },
            ProjectSource {
                role: SourceRole::Dark,
                name: "Dark 300s -10C".to_owned(),
                frames: 30,
                hours: "2.5h".to_owned(),
                selection: SourceSelection::Selected,
                warning: None,
            },
            ProjectSource {
                role: SourceRole::Flat,
                name: "Flat L".to_owned(),
                frames: 20,
                hours: "0.0h".to_owned(),
                selection: SourceSelection::Candidate,
                warning: Some("age > 60 days".to_owned()),
            },
        ],
        source_views: vec![ProjectSourceView {
            name: "WBPP Source View".to_owned(),
            strategy: SourceViewStrategy::Symlink,
            link_count: 68,
            plan_ref: "plan-sv-001".to_owned(),
        }],
        outputs: vec![
            ProjectOutput {
                id: "out-001".to_owned(),
                filename: "NGC7000_SHO_v1.tif".to_owned(),
                kind: "final".to_owned(),
                size_bytes: 268_435_456,
                date: "2026-05-18".to_owned(),
                verification: OutputVerification::Accepted,
                protected: true,
            },
            ProjectOutput {
                id: "out-002".to_owned(),
                filename: "NGC7000_SHO_v0_draft.tif".to_owned(),
                kind: "draft".to_owned(),
                size_bytes: 268_435_456,
                date: "2026-05-16".to_owned(),
                verification: OutputVerification::Superseded,
                protected: false,
            },
        ],
        artifacts: vec![
            ProjectArtifactGroup {
                artifact_type: "registered".to_owned(),
                count: 45,
                total_size_bytes: 3_145_728_000,
                cleanup_eligibility: CleanupEligibility::Eligible,
                confidence: ConfidenceLevel::High,
                tool: "PixInsight/StarAlignment".to_owned(),
                protected: false,
                warning: None,
            },
            ProjectArtifactGroup {
                artifact_type: "drizzle_data".to_owned(),
                count: 45,
                total_size_bytes: 1_572_864_000,
                cleanup_eligibility: CleanupEligibility::Archive,
                confidence: ConfidenceLevel::Medium,
                tool: "PixInsight/DrizzleIntegration".to_owned(),
                protected: false,
                warning: Some("may be needed for re-integration".to_owned()),
            },
        ],
        lifecycle_stage_index: 3,
        audit_count: 12,
        plan_count: 2,
        cleanup_bytes: 4_718_592_000,
        cleanup_label: "4.4 GB reclaimable".to_owned(),
        total_integration_label: "12.5h total".to_owned(),
        on_disk_label: "8.2 GB".to_owned(),
        notes_count: 3,
        manifest_count: 1,
    })
}

/// `projects.create_plan` — create a filesystem plan from wizard state.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "projects.create_plan")]
pub async fn projects_create_plan(
    wizard_state: JsonAny,
) -> Result<FilesystemPlan, String> {
    tracing::debug!("stub: projects.create_plan wizard_state={wizard_state:?}");
    Ok(FilesystemPlan {
        id: "plan-new-001".to_owned(),
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
        ],
        dry_run_result: DryRunResult { passed: 2, warnings: 0, failures: 0 },
        has_destructive: false,
        reclaim_bytes: 0,
        created_at: "2026-05-25T12:00:00Z".to_owned(),
        approved_at: None,
        applied_at: None,
    })
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

fn stub_projects() -> Vec<Project> {
    vec![
        Project {
            id: "proj-001".to_owned(),
            name: "NGC 7000 Narrowband".to_owned(),
            workflow_profile_id: "wbpp-sho".to_owned(),
            root_path: "/astro/projects/NGC7000_NB".to_owned(),
            state: ProjectState::Processing,
            blocked_reason: None,
            verification_state: VerificationState::HasAccepted,
            cleanup_state: CleanupState { reclaimable_bytes: 4_718_592_000 },
            integration_hours: 12.5,
            target_ids: vec!["550e8400-e29b-41d4-a716-446655440201".to_owned()],
            source_map: SourceMap {
                lights: vec!["/astro/raw/NGC7000/Ha".to_owned()],
                darks: vec!["/astro/calibration/darks/300s_-10C".to_owned()],
                flats: vec!["/astro/calibration/flats/L".to_owned()],
                bias: vec!["/astro/calibration/bias".to_owned()],
                dark_flats: vec![],
            },
            source_view_ids: vec!["sv-001".to_owned()],
            output_ids: vec!["out-001".to_owned(), "out-002".to_owned()],
            processing_directory: "/astro/projects/NGC7000_NB/processing".to_owned(),
            output_directory: "/astro/projects/NGC7000_NB/output".to_owned(),
            updated_at: "2026-05-20T22:15:00Z".to_owned(),
        },
        Project {
            id: "proj-002".to_owned(),
            name: "M31 LRGB".to_owned(),
            workflow_profile_id: "wbpp-lrgb".to_owned(),
            root_path: "/astro/projects/M31_LRGB".to_owned(),
            state: ProjectState::Ready,
            blocked_reason: None,
            verification_state: VerificationState::Unreviewed,
            cleanup_state: CleanupState { reclaimable_bytes: 0 },
            integration_hours: 8.0,
            target_ids: vec!["550e8400-e29b-41d4-a716-446655440202".to_owned()],
            source_map: SourceMap {
                lights: vec!["/astro/raw/M31/L".to_owned()],
                darks: vec![],
                flats: vec![],
                bias: vec![],
                dark_flats: vec![],
            },
            source_view_ids: vec![],
            output_ids: vec![],
            processing_directory: "/astro/projects/M31_LRGB/processing".to_owned(),
            output_directory: "/astro/projects/M31_LRGB/output".to_owned(),
            updated_at: "2026-05-19T20:00:00Z".to_owned(),
        },
        Project {
            id: "proj-003".to_owned(),
            name: "IC 1396 SHO".to_owned(),
            workflow_profile_id: "wbpp-sho".to_owned(),
            root_path: "/astro/projects/IC1396_SHO".to_owned(),
            state: ProjectState::SetupIncomplete,
            blocked_reason: Some("missing calibration frames".to_owned()),
            verification_state: VerificationState::Unreviewed,
            cleanup_state: CleanupState { reclaimable_bytes: 0 },
            integration_hours: 2.0,
            target_ids: vec!["550e8400-e29b-41d4-a716-446655440203".to_owned()],
            source_map: SourceMap::default(),
            source_view_ids: vec![],
            output_ids: vec![],
            processing_directory: "/astro/projects/IC1396_SHO/processing".to_owned(),
            output_directory: "/astro/projects/IC1396_SHO/output".to_owned(),
            updated_at: "2026-05-18T18:00:00Z".to_owned(),
        },
    ]
}
