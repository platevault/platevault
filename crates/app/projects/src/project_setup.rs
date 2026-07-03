//! Project create/update/source/channel use cases (spec 008 F-3).
//!
//! Entry points:
//! - [`create`]          — validate, persist, infer channels, emit audit.
//! - [`update`]          — patch name/tool/notes; enforce tool-lock + read-only.
//! - [`add_source`]      — link an Inventory session; snapshot fields; recompute channels.
//! - [`remove_source`]   — unlink a source; gate on lifecycle; re-check ready trigger.
//! - [`reinfer_channels`]  — recompute channels from scratch; reset drift.
//! - [`dismiss_drift`]     — reset channel drift flag without changing channels.
//!
//! Auto-transition seam (spec 009): after `create`, `add_source`, and `update`
//! this module checks whether `setup_incomplete → ready` should fire (tool != null
//! AND ≥1 source linked). When the condition is met it directly updates the
//! lifecycle column via the repository. Spec 009 will own the full lifecycle
//! service; the auto-transition here is the thin seam described in tasks.md F-3
//! (R-Ready-Trigger). The `new_lifecycle` field in the response is the signal
//! the UI should surface.
//!
//! Constitution II: `create` generates a reviewable `FilesystemPlan` via
//! `crates/fs/planner` + `crates/persistence/db::repositories::plans`.  The
//! plan contains one `mkdir` item per folder required by the project's tool
//! (from `crates/project/structure::required_folders`) plus a `write_manifest`
//! item for the project marker.  The plan is returned as `plan_id` in the
//! response; the caller drives approval + application via specs 017/025.
//!
//! Constitution V: SQLite is the durable record; audit events are emitted via
//! the `EventBus` for every mutation.

use crate::project_health;
use audit::bus::EventBus;
use audit::event_bus::Source;
use contracts_core::projects_v2::{
    ChannelDriftDto, ProjectChannelDto, ProjectChannelsDismissDriftRequest,
    ProjectChannelsDismissDriftResult, ProjectChannelsReinferRequest, ProjectChannelsReinferResult,
    ProjectCreateRequest, ProjectCreateResult, ProjectDetailDto, ProjectSourceAddRequest,
    ProjectSourceAddResult, ProjectSourceDto, ProjectSourceRemoveRequest,
    ProjectSourceRemoveResult, ProjectSummaryDto, ProjectTool, ProjectUpdateRequest,
    ProjectUpdateResult,
};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use domain_core::ids::{new_id, Timestamp};
use domain_core::project::channels::{
    infer_channels, merge_channels, reinfer_channels as domain_reinfer, Channel,
};
use domain_core::project::validate::{
    is_read_only, is_source_remove_locked, is_tool_locked, validate_name, validate_tool,
};
use persistence_db::repositories::plans as plans_repo;
use persistence_db::repositories::projects as repo;
use project_structure::{required_folders, ProcessingTool as StructureTool, MARKER_FILENAME};
use sqlx::SqlitePool;

use app_core_errors::bus_err;

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Map a static `&str` validation error code (returned by `domain_core::project::validate`)
/// to the corresponding `ErrorCode` variant.
fn str_to_error_code(code: &str) -> ErrorCode {
    match code {
        "name.empty" => ErrorCode::NameEmpty,
        "name.too_long" => ErrorCode::NameTooLong,
        "tool.unknown" => ErrorCode::ToolUnknown,
        _ => {
            tracing::warn!("unknown validation code '{code}', using InternalData");
            ErrorCode::InternalData
        }
    }
}

fn db_err(e: persistence_db::DbError) -> ContractError {
    match e {
        persistence_db::DbError::NotFound(msg) => {
            ContractError::new(ErrorCode::ProjectNotFound, msg, ErrorSeverity::Blocking, false)
        }
        other => app_core_errors::db_err(other),
    }
}

/// Convert a slice of DB channel rows to contract DTOs.
fn channels_to_dto(rows: &[repo::ProjectChannelRow]) -> Vec<ProjectChannelDto> {
    rows.iter()
        .map(|r| ProjectChannelDto {
            label: r.label.clone(),
            source: r.source.clone(),
            added_at: Some(r.added_at.clone()),
        })
        .collect()
}

/// Convert a DB source row to a contract DTO.
fn source_to_dto(row: &repo::ProjectSourceRow) -> ProjectSourceDto {
    // `role` and `selection` are None until spec 003 Inventory integration
    // provides confirmed session metadata with role + selection snapshots.
    ProjectSourceDto {
        inventory_id: row.inventory_session_id.clone(),
        name: row.name_snapshot.clone(),
        frames: u32::try_from(row.frames_snapshot).unwrap_or(0),
        filter: row.filter_snapshot.clone(),
        exposure: row.exposure_snapshot.clone(),
        linked_at: row.linked_at.clone(),
        role: None,
        selection: None,
    }
}

/// Derive the filter slice from source rows and call domain `infer_channels`.
fn infer_from_sources(sources: &[repo::ProjectSourceRow]) -> Vec<Channel> {
    let filters: Vec<&str> = sources.iter().map(|s| s.filter_snapshot.as_str()).collect();
    infer_channels(&filters)
}

/// Persist channels (replace_project_channels expects `&[(&str, &str)]`).
async fn persist_channels(
    pool: &SqlitePool,
    project_id: &str,
    channels: &[Channel],
) -> Result<(), persistence_db::DbError> {
    let pairs: Vec<(String, String)> =
        channels.iter().map(|c| (c.label.clone(), c.source.clone())).collect();
    let refs: Vec<(&str, &str)> = pairs.iter().map(|(l, s)| (l.as_str(), s.as_str())).collect();
    repo::replace_project_channels(pool, project_id, &refs).await
}

/// Attempt the `setup_incomplete → ready` auto-transition (R-Ready-Trigger).
///
/// Delegates to `project_health::check_project_ready_invariant` which is the
/// single source of truth for this invariant (spec 009 P8). The lifecycle
/// service writes the audit row and publishes `project.lifecycle.ready`.
///
/// Returns the new lifecycle string if the transition was applied.
async fn maybe_auto_ready(
    pool: &SqlitePool,
    bus: &EventBus,
    project_id: &str,
    current_lifecycle: &str,
) -> Result<Option<String>, persistence_db::DbError> {
    if current_lifecycle != "setup_incomplete" {
        return Ok(None);
    }
    project_health::check_project_ready_invariant(pool, bus, project_id)
        .await
        .map_err(|e| persistence_db::DbError::NotFound(e.to_string()))
}

/// Attempt the `ready → setup_incomplete` regression when all sources removed.
async fn maybe_regress_to_incomplete(
    pool: &SqlitePool,
    project_id: &str,
    current_lifecycle: &str,
) -> Result<Option<String>, persistence_db::DbError> {
    if current_lifecycle != "ready" {
        return Ok(None);
    }
    let sources = repo::list_project_sources(pool, project_id).await?;
    if !sources.is_empty() {
        return Ok(None);
    }
    repo::update_project_lifecycle(pool, project_id, "setup_incomplete").await?;
    Ok(Some("setup_incomplete".to_owned()))
}

// ── Folder plan builder (Constitution II) ─────────────────────────────────────

/// Build and persist a reviewable `FilesystemPlan` for the project folder
/// structure (Constitution II).
///
/// Creates one `mkdir` plan item per sub-folder required by the tool
/// (from `project_structure::required_folders`) and one `write_manifest` item
/// for the app-owned project marker.  All paths are relative to the project
/// root path.  The plan is inserted in `draft` state; the caller advances it
/// through spec 017 review → spec 025 apply.
///
/// Returns the plan `id` as a `String`.
///
/// # Errors
///
/// Returns [`persistence_db::DbError`] on database failure.
async fn build_folder_plan(
    pool: &SqlitePool,
    project_id: &str,
    project_path: &str,
    tool_str: &str,
) -> Result<String, persistence_db::DbError> {
    let plan_id = new_id();
    let tool = StructureTool::parse(tool_str).unwrap_or(StructureTool::PixInsight);
    let folders = required_folders(tool);

    let plan_title = format!("Create project folder structure: {project_path}");
    let plan_data = plans_repo::InsertPlan {
        id: &plan_id,
        title: &plan_title,
        origin: "project",
        origin_path: Some(project_path),
        plan_type: "project_create",
        destructive_destination: "archive",
        parent_plan_id: None,
        total_bytes_required: 0,
    };
    plans_repo::insert_plan(pool, &plan_data).await?;

    // One mkdir item per required sub-folder.
    for (idx, folder) in folders.iter().enumerate() {
        let item_id = new_id();
        let dest = format!("{project_path}/{}", folder.0);
        let item_data = plans_repo::InsertPlanItem {
            id: &item_id,
            plan_id: &plan_id,
            item_index: i64::try_from(idx).unwrap_or(0),
            name: &folder.0,
            action: "mkdir",
            from_root_id: None,
            from_relative_path: "",
            to_root_id: None,
            to_relative_path: &dest,
            reason: "Create project sub-folder for tool workflow",
            protection: "normal",
            linked_entity: Some(project_id),
            provenance_json: None,
            archive_path: None,
            // Project setup items create app-managed folders/files; source protection
            // does not apply.
            source_id: None,
            category: None,
        };
        plans_repo::insert_plan_item(pool, &item_data).await?;
    }

    // One write_manifest item for the project marker file.
    let marker_index = i64::try_from(folders.len()).unwrap_or(0);
    let marker_dest = format!("{project_path}/{MARKER_FILENAME}");
    let marker_id = new_id();
    let marker_item = plans_repo::InsertPlanItem {
        id: &marker_id,
        plan_id: &plan_id,
        item_index: marker_index,
        name: MARKER_FILENAME,
        action: "write_manifest",
        from_root_id: None,
        from_relative_path: "",
        to_root_id: None,
        to_relative_path: &marker_dest,
        reason: "Write app-owned project marker file",
        protection: "normal",
        linked_entity: Some(project_id),
        provenance_json: None,
        archive_path: None,
        // Project marker file creation; source protection does not apply.
        source_id: None,
        category: None,
    };
    plans_repo::insert_plan_item(pool, &marker_item).await?;

    // Advance to ready_for_review so the plan is visible in the review UI.
    plans_repo::update_plan_state(pool, &plan_id, "ready_for_review").await?;

    Ok(plan_id)
}

// ── project.create ────────────────────────────────────────────────────────────

/// Create a new project.
///
/// Validates name (non-empty, ≤120 chars, unique), tool (canonical value),
/// path (unique within library). Persists the project in `setup_incomplete`,
/// links any `initial_sources`, infers channels, checks the auto-ready trigger,
/// and emits a `project.created` audit event.
///
/// Constitution II: folder structure creation is deferred to a FilesystemPlan;
/// `plan_id` is currently `None`. The caller drives folder creation via spec 025.
///
/// # Errors
///
/// Returns `ContractError` on validation failure or database error.
#[allow(clippy::too_many_lines)]
pub async fn create(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &ProjectCreateRequest,
) -> Result<ProjectCreateResult, ContractError> {
    // 1. Validate name.
    validate_name(&req.name).map_err(|code| {
        ContractError::new(
            str_to_error_code(code),
            format!("Project name error: {code}"),
            ErrorSeverity::Blocking,
            false,
        )
    })?;
    validate_tool(req.tool.as_db_str()).map_err(|code| {
        ContractError::new(
            str_to_error_code(code),
            format!("Processing tool error: {code}"),
            ErrorSeverity::Blocking,
            false,
        )
    })?;

    // 2. Check name uniqueness.
    if let Some(conflict_id) = repo::name_exists(pool, &req.name, None).await.map_err(db_err)? {
        return Err(ContractError::new(
            ErrorCode::NameDuplicate,
            "A project with this name already exists.",
            ErrorSeverity::Blocking,
            false,
        )
        .with_details(serde_json::json!({ "conflictingProjectId": conflict_id })));
    }

    // 3. Validate path non-empty.
    if req.path.trim().is_empty() {
        return Err(ContractError::new(
            ErrorCode::PathInvalid,
            "Project path must not be empty.",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // 4. Check path uniqueness.
    if let Some(collide_id) = repo::path_exists(pool, &req.path, None).await.map_err(db_err)? {
        return Err(ContractError::new(
            ErrorCode::PathCollision,
            "Another project already uses this path.",
            ErrorSeverity::Blocking,
            false,
        )
        .with_details(serde_json::json!({ "collidingProjectId": collide_id })));
    }

    let project_id = new_id();
    let now = Timestamp::now_iso();

    // Validate the optional canonical target exists (cheap point lookup) so a
    // dangling id is rejected rather than silently stored. Spec-035 additive
    // association; absent → stored as NULL (existing behaviour unchanged).
    if let Some(ctid) = req.canonical_target_id.as_deref() {
        let exists: Option<(String,)> =
            sqlx::query_as("SELECT id FROM canonical_target WHERE id = ?")
                .bind(ctid)
                .fetch_optional(pool)
                .await
                .map_err(|e| {
                    ContractError::new(
                        ErrorCode::InternalDatabase,
                        format!("{e}"),
                        ErrorSeverity::Fatal,
                        true,
                    )
                })?;
        if exists.is_none() {
            return Err(ContractError::new(
                ErrorCode::CanonicalTargetNotFound,
                "The selected target was not found.",
                ErrorSeverity::Blocking,
                false,
            )
            .with_details(serde_json::json!({ "canonicalTargetId": ctid })));
        }
    }

    // 5. Persist the project row (setup_incomplete).
    let insert = repo::InsertProject {
        id: &project_id,
        name: &req.name,
        tool: req.tool.as_db_str(),
        lifecycle: "setup_incomplete",
        path: &req.path,
        notes: req.notes.as_deref(),
        canonical_target_id: req.canonical_target_id.as_deref(),
    };
    repo::insert_project(pool, &insert).await.map_err(db_err)?;

    // 6. Link initial sources (best-effort: if a source is not found in a future
    //    Inventory table we just skip it for now — spec 003 integration is pending).
    //    For now, initial_sources lists inventory_session_ids that we trust.
    let mut source_rows: Vec<repo::ProjectSourceRow> = Vec::new();
    for inv_id in &req.initial_sources {
        let src_id = new_id();
        let src_data = repo::InsertProjectSource {
            id: &src_id,
            project_id: &project_id,
            inventory_session_id: inv_id,
            // Snapshot fields will be empty until spec 003 Inventory is wired.
            name_snapshot: "",
            frames_snapshot: 0,
            filter_snapshot: "",
            exposure_snapshot: "",
            linked_at: &now,
        };
        repo::insert_project_source(pool, &src_data).await.map_err(db_err)?;
        source_rows.push(repo::ProjectSourceRow {
            id: src_id,
            project_id: project_id.clone(),
            inventory_session_id: inv_id.clone(),
            name_snapshot: String::new(),
            frames_snapshot: 0,
            filter_snapshot: String::new(),
            exposure_snapshot: String::new(),
            linked_at: now.clone(),
        });
    }

    // 7. Infer channels from initial sources.
    let channels = infer_from_sources(&source_rows);
    persist_channels(pool, &project_id, &channels).await.map_err(db_err)?;

    // 8. Auto-transition setup_incomplete → ready if sources are present.
    let final_lifecycle = maybe_auto_ready(pool, bus, &project_id, "setup_incomplete")
        .await
        .map_err(db_err)?
        .unwrap_or_else(|| "setup_incomplete".to_owned());

    // 9. Audit.
    let audit_id = new_id();
    bus.publish(
        "project.created",
        Source::User,
        serde_json::json!({
            "auditId": audit_id,
            "projectId": project_id,
            "name": req.name,
            "tool": req.tool.as_db_str(),
            "lifecycle": final_lifecycle,
            "sourceCount": source_rows.len(),
        }),
    )
    .await
    .map_err(bus_err)?;

    let channel_dtos: Vec<ProjectChannelDto> = channels
        .into_iter()
        .map(|c| ProjectChannelDto {
            label: c.label,
            source: c.source,
            added_at: Some(now.clone()),
        })
        .collect();

    // 10. Generate the folder-structure FilesystemPlan (Constitution II).
    //     plan_id is returned so the UI can link to the spec 017 review surface.
    let plan_id = build_folder_plan(pool, &project_id, &req.path, req.tool.as_db_str())
        .await
        .map_err(db_err)?;

    Ok(ProjectCreateResult {
        project_id,
        lifecycle: final_lifecycle,
        plan_id: Some(plan_id),
        channels: channel_dtos,
        audit_id,
        created_at: now,
    })
}

// ── project.update ────────────────────────────────────────────────────────────

/// Update whitelisted metadata fields (name, tool, notes).
///
/// Enforces:
/// - `lifecycle == "archived"` → `lifecycle.read_only`
/// - `tool` change when `lifecycle in {prepared, processing, completed, blocked}` → `tool.locked`
/// - At least one field must change.
///
/// # Errors
///
/// Returns `ContractError` on validation failure or database error.
pub async fn update(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &ProjectUpdateRequest,
) -> Result<ProjectUpdateResult, ContractError> {
    let row = repo::get_project(pool, &req.project_id).await.map_err(db_err)?;

    // Check read-only lifecycle.
    if is_read_only(&row.lifecycle) {
        return Err(ContractError::new(
            ErrorCode::LifecycleReadOnly,
            "This project is archived and cannot be edited.",
            ErrorSeverity::Blocking,
            false,
        )
        .with_details(serde_json::json!({ "currentLifecycle": row.lifecycle })));
    }

    // Check tool lock.
    if req.tool.is_some() && is_tool_locked(&row.lifecycle) {
        return Err(ContractError::new(
            ErrorCode::ToolLocked,
            "Tool cannot be changed in the current lifecycle state.",
            ErrorSeverity::Blocking,
            false,
        )
        .with_details(serde_json::json!({ "currentLifecycle": row.lifecycle })));
    }

    // Check no-op.
    let name_changing = req.name.as_deref().is_some_and(|n| n != row.name);
    let tool_changing = req.tool.is_some_and(|t| t.as_db_str() != row.tool);
    let notes_changing = req.notes.as_deref().is_some_and(|n| row.notes.as_deref() != Some(n));

    if !name_changing && !tool_changing && !notes_changing {
        return Err(ContractError::new(
            ErrorCode::NoOp,
            "No fields were changed.",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // Validate new name if changing.
    if let Some(new_name) = &req.name {
        validate_name(new_name).map_err(|code| {
            ContractError::new(
                str_to_error_code(code),
                format!("Name error: {code}"),
                ErrorSeverity::Blocking,
                false,
            )
        })?;
        if let Some(conflict_id) =
            repo::name_exists(pool, new_name, Some(&req.project_id)).await.map_err(db_err)?
        {
            return Err(ContractError::new(
                ErrorCode::NameDuplicate,
                "A project with this name already exists.",
                ErrorSeverity::Blocking,
                false,
            )
            .with_details(serde_json::json!({ "conflictingProjectId": conflict_id })));
        }
    }

    let new_tool_str: Option<String> = req.tool.map(|t| t.as_db_str().to_owned());
    let updated_at = repo::update_project_fields(
        pool,
        &req.project_id,
        req.name.as_deref(),
        new_tool_str.as_deref(),
        req.notes.as_deref(),
    )
    .await
    .map_err(db_err)?;

    let mut fields_updated: Vec<String> = Vec::new();
    if name_changing {
        fields_updated.push("name".to_owned());
    }
    if tool_changing {
        fields_updated.push("tool".to_owned());
    }
    if notes_changing {
        fields_updated.push("notes".to_owned());
    }

    let audit_id = new_id();
    bus.publish(
        "project.updated",
        Source::User,
        serde_json::json!({
            "auditId": audit_id,
            "projectId": req.project_id,
            "fieldsUpdated": fields_updated,
        }),
    )
    .await
    .map_err(bus_err)?;

    Ok(ProjectUpdateResult {
        project_id: req.project_id.clone(),
        fields_updated,
        audit_id,
        updated_at,
    })
}

// ── project.source.add ────────────────────────────────────────────────────────

/// Link an Inventory session to an existing project.
///
/// Enforces:
/// - Project exists.
/// - Source not already linked (`source.already.linked`).
/// - Lifecycle not archived.
///
/// Note (D9, 2026-07-03): the old spec-002 `source.not_confirmed` gate against
/// `acquisition_sessions.state` is descoped. Post spec-041, sessions are
/// derived, already-confirmed inventory (there is no unconfirmed state left to
/// gate on), so no confirmation check runs here.
///
/// Recomputes channel inference and merges with existing manual channels.
/// Sets `channel_drift = true` when channels were manually overridden before.
/// Fires auto-transition `setup_incomplete → ready` (R-Ready-Trigger).
///
/// # Errors
///
/// Returns `ContractError` on validation failure or database error.
pub async fn add_source(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &ProjectSourceAddRequest,
) -> Result<ProjectSourceAddResult, ContractError> {
    let row = repo::get_project(pool, &req.project_id).await.map_err(db_err)?;

    // Check archived lifecycle.
    if row.lifecycle == "archived" {
        return Err(ContractError::new(
            ErrorCode::LifecycleReadOnly,
            "Sources cannot be added to an archived project.",
            ErrorSeverity::Blocking,
            false,
        )
        .with_details(serde_json::json!({ "currentLifecycle": row.lifecycle })));
    }

    // Check duplicate.
    let existing_sources =
        repo::list_project_sources(pool, &req.project_id).await.map_err(db_err)?;
    if let Some(dupe) =
        existing_sources.iter().find(|s| s.inventory_session_id == req.inventory_session_id)
    {
        return Err(ContractError::new(
            ErrorCode::SourceAlreadyLinked,
            "This inventory session is already linked to the project.",
            ErrorSeverity::Blocking,
            false,
        )
        .with_details(serde_json::json!({ "existingLinkAt": dupe.linked_at })));
    }

    // D9 (2026-07-03): no confirmation gate here — sessions are derived,
    // already-confirmed inventory post spec-041, so there is no
    // `source.not_confirmed` state to check.

    let now = Timestamp::now_iso();
    let src_id = new_id();

    let src_data = repo::InsertProjectSource {
        id: &src_id,
        project_id: &req.project_id,
        inventory_session_id: &req.inventory_session_id,
        name_snapshot: "",
        frames_snapshot: 0,
        filter_snapshot: "",
        exposure_snapshot: "",
        linked_at: &now,
    };
    repo::insert_project_source(pool, &src_data).await.map_err(db_err)?;

    // Recompute channels.
    let all_sources = repo::list_project_sources(pool, &req.project_id).await.map_err(db_err)?;
    let existing_channels =
        repo::list_project_channels(pool, &req.project_id).await.map_err(db_err)?;

    let new_inferred = infer_from_sources(&all_sources);
    let existing_domain: Vec<Channel> = existing_channels
        .iter()
        .map(|r| Channel { label: r.label.clone(), source: r.source.clone() })
        .collect();
    let merged = merge_channels(&new_inferred, &existing_domain);
    persist_channels(pool, &req.project_id, &merged).await.map_err(db_err)?;

    // Set channel_drift if there were any manual channels previously.
    let had_manual = existing_domain.iter().any(|c| c.source == "manual");
    if had_manual {
        repo::set_channel_drift(pool, &req.project_id, true).await.map_err(db_err)?;
    }

    // Auto-transition setup_incomplete → ready.
    let new_lifecycle =
        maybe_auto_ready(pool, bus, &req.project_id, &row.lifecycle).await.map_err(db_err)?;

    // Audit.
    let audit_id = new_id();
    bus.publish(
        "project.source.added",
        Source::User,
        serde_json::json!({
            "auditId": audit_id,
            "projectId": req.project_id,
            "inventorySessionId": req.inventory_session_id,
        }),
    )
    .await
    .map_err(bus_err)?;

    let added_row = repo::ProjectSourceRow {
        id: src_id,
        project_id: req.project_id.clone(),
        inventory_session_id: req.inventory_session_id.clone(),
        name_snapshot: String::new(),
        frames_snapshot: 0,
        filter_snapshot: String::new(),
        exposure_snapshot: String::new(),
        linked_at: now.clone(),
    };

    let channel_dtos: Vec<ProjectChannelDto> = merged
        .into_iter()
        .map(|c| ProjectChannelDto {
            label: c.label,
            source: c.source,
            added_at: Some(now.clone()),
        })
        .collect();

    Ok(ProjectSourceAddResult {
        project_id: req.project_id.clone(),
        source_added: source_to_dto(&added_row),
        channels: channel_dtos,
        audit_id,
        linked_at: now,
        new_lifecycle,
    })
}

// ── project.source.remove ─────────────────────────────────────────────────────

/// Remove a source link from a project.
///
/// Enforces:
/// - Project and source exist.
/// - `lifecycle not in {prepared, processing, completed, archived}` (FR-011).
/// - Last-source confirmation gate: if removing the last source, `confirm_last_source`
///   must be `true`; otherwise returns `lifecycle.last_confirmed_source`.
///
/// Checks `ready → setup_incomplete` regression after removal.
///
/// # Errors
///
/// Returns `ContractError` on validation or database error.
pub async fn remove_source(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &ProjectSourceRemoveRequest,
) -> Result<ProjectSourceRemoveResult, ContractError> {
    let row = repo::get_project(pool, &req.project_id).await.map_err(db_err)?;

    // Check lifecycle lock for source removal.
    if is_source_remove_locked(&row.lifecycle) {
        return Err(ContractError::new(
            ErrorCode::LifecycleReadOnly,
            "Sources cannot be removed in the current lifecycle state.",
            ErrorSeverity::Blocking,
            false,
        )
        .with_details(serde_json::json!({ "currentLifecycle": row.lifecycle })));
    }

    // Verify source exists.
    let sources = repo::list_project_sources(pool, &req.project_id).await.map_err(db_err)?;
    if !sources.iter().any(|s| s.inventory_session_id == req.project_source_id) {
        return Err(ContractError::new(
            ErrorCode::SourceNotFound,
            "Source not found on this project.",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // Last-source confirmation gate.
    if sources.len() == 1 && !req.confirm_last_source {
        return Err(ContractError::new(
            ErrorCode::LifecycleLastConfirmedSource,
            "Removing the last source requires explicit confirmation.",
            ErrorSeverity::Blocking,
            false,
        )
        .with_details(serde_json::json!({ "remainingConfirmedCount": 0 })));
    }

    // Delete the source row.
    repo::delete_project_source(pool, &req.project_id, &req.project_source_id)
        .await
        .map_err(db_err)?;

    // Recompute channels.
    let remaining_sources =
        repo::list_project_sources(pool, &req.project_id).await.map_err(db_err)?;
    let new_inferred = infer_from_sources(&remaining_sources);
    let existing_channels =
        repo::list_project_channels(pool, &req.project_id).await.map_err(db_err)?;
    let existing_domain: Vec<Channel> = existing_channels
        .iter()
        .map(|r| Channel { label: r.label.clone(), source: r.source.clone() })
        .collect();
    let merged = merge_channels(&new_inferred, &existing_domain);
    persist_channels(pool, &req.project_id, &merged).await.map_err(db_err)?;

    // Regress ready → setup_incomplete if no sources remain.
    let new_lifecycle =
        maybe_regress_to_incomplete(pool, &req.project_id, &row.lifecycle).await.map_err(db_err)?;

    let audit_id = new_id();
    bus.publish(
        "project.source.removed",
        Source::User,
        serde_json::json!({
            "auditId": audit_id,
            "projectId": req.project_id,
            "inventorySessionId": req.project_source_id,
        }),
    )
    .await
    .map_err(bus_err)?;

    Ok(ProjectSourceRemoveResult {
        project_id: req.project_id.clone(),
        removed_source_id: req.project_source_id.clone(),
        audit_id,
        new_lifecycle,
    })
}

// ── project.channels.reinfer ──────────────────────────────────────────────────

/// Re-infer channels from all linked sources, discarding all manual overrides.
///
/// Resets `channel_drift` to false.
///
/// # Errors
///
/// Returns `ContractError` on database error or when project is archived.
pub async fn reinfer_channels(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &ProjectChannelsReinferRequest,
) -> Result<ProjectChannelsReinferResult, ContractError> {
    let row = repo::get_project(pool, &req.project_id).await.map_err(db_err)?;

    if is_read_only(&row.lifecycle) {
        return Err(ContractError::new(
            ErrorCode::LifecycleReadOnly,
            "Channels cannot be changed on an archived project.",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    let sources = repo::list_project_sources(pool, &req.project_id).await.map_err(db_err)?;
    let filters: Vec<&str> = sources.iter().map(|s| s.filter_snapshot.as_str()).collect();
    let channels = domain_reinfer(&filters);
    persist_channels(pool, &req.project_id, &channels).await.map_err(db_err)?;
    repo::set_channel_drift(pool, &req.project_id, false).await.map_err(db_err)?;

    let now = Timestamp::now_iso();
    let audit_id = new_id();
    bus.publish(
        "project.channels.recomputed",
        Source::User,
        serde_json::json!({
            "auditId": audit_id,
            "projectId": req.project_id,
        }),
    )
    .await
    .map_err(bus_err)?;

    let channel_dtos: Vec<ProjectChannelDto> = channels
        .into_iter()
        .map(|c| ProjectChannelDto {
            label: c.label,
            source: c.source,
            added_at: Some(now.clone()),
        })
        .collect();

    Ok(ProjectChannelsReinferResult {
        project_id: req.project_id.clone(),
        channels: channel_dtos,
        audit_id,
        updated_at: now,
    })
}

// ── project.channels.dismiss_drift ───────────────────────────────────────────

/// Dismiss the channel drift banner without re-inferring.
///
/// Resets `channel_drift` flag; does not change the channel list.
///
/// # Errors
///
/// Returns `ContractError` on database error.
pub async fn dismiss_drift(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &ProjectChannelsDismissDriftRequest,
) -> Result<ProjectChannelsDismissDriftResult, ContractError> {
    // Verify project exists.
    repo::get_project(pool, &req.project_id).await.map_err(db_err)?;

    repo::set_channel_drift(pool, &req.project_id, false).await.map_err(db_err)?;

    let now = Timestamp::now_iso();
    let audit_id = new_id();
    bus.publish(
        "project.channel_drift.dismissed",
        Source::User,
        serde_json::json!({
            "auditId": audit_id,
            "projectId": req.project_id,
        }),
    )
    .await
    .map_err(bus_err)?;

    Ok(ProjectChannelsDismissDriftResult {
        project_id: req.project_id.clone(),
        audit_id,
        dismissed_at: now,
    })
}

// ── Read: list + get ──────────────────────────────────────────────────────────

/// List all projects as summary DTOs.
///
/// # Errors
///
/// Returns `ContractError` on database error.
pub async fn list(pool: &SqlitePool) -> Result<Vec<ProjectSummaryDto>, ContractError> {
    let rows = repo::list_projects(pool).await.map_err(db_err)?;
    let mut dtos = Vec::with_capacity(rows.len());
    for row in rows {
        let sources = repo::list_project_sources(pool, &row.id).await.map_err(db_err)?;
        let tool = ProjectTool::from_db_str(&row.tool).map_err(|e| {
            ContractError::new(ErrorCode::InternalData, e, ErrorSeverity::Fatal, false)
        })?;
        dtos.push(ProjectSummaryDto {
            id: row.id,
            name: row.name,
            tool,
            lifecycle: row.lifecycle,
            path: row.path,
            notes: row.notes,
            channel_drift: row.channel_drift,
            source_count: u32::try_from(sources.len()).unwrap_or(0),
            created_at: row.created_at,
            updated_at: row.updated_at,
            blocked_reason_kind: row.blocked_reason_kind,
            blocked_reason_note: row.blocked_reason_note,
        });
    }
    Ok(dtos)
}

/// Get a single project with full sources + channels.
///
/// # Errors
///
/// Returns `ContractError` on database error or when not found.
pub async fn get(pool: &SqlitePool, id: &str) -> Result<ProjectDetailDto, ContractError> {
    let row = repo::get_project(pool, id).await.map_err(db_err)?;
    let sources = repo::list_project_sources(pool, id).await.map_err(db_err)?;
    let channels = repo::list_project_channels(pool, id).await.map_err(db_err)?;

    let tool = ProjectTool::from_db_str(&row.tool)
        .map_err(|e| ContractError::new(ErrorCode::InternalData, e, ErrorSeverity::Fatal, false))?;

    // Spec 035 US1 #2: surface the associated canonical target (LEFT JOIN);
    // `None` when the project has no canonical-target association.
    let canonical_target =
        repo::get_project_canonical_target(pool, id).await.map_err(db_err)?.map(|ct| {
            contracts_core::projects_v2::ProjectCanonicalTarget {
                id: ct.id,
                primary_designation: ct.primary_designation,
                common_name: ct.common_name,
            }
        });

    Ok(ProjectDetailDto {
        id: row.id,
        name: row.name,
        tool,
        lifecycle: row.lifecycle,
        path: row.path,
        notes: row.notes,
        channel_drift: ChannelDriftDto {
            has_new_sources: row.channel_drift,
            suggested_action: if row.channel_drift {
                "re_infer".to_owned()
            } else {
                "dismiss".to_owned()
            },
        },
        sources: sources.iter().map(source_to_dto).collect(),
        channels: channels_to_dto(&channels),
        created_at: row.created_at,
        updated_at: row.updated_at,
        canonical_target,
        blocked_reason_kind: row.blocked_reason_kind,
        blocked_reason_note: row.blocked_reason_note,
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use persistence_db::Database;

    async fn setup() -> (SqlitePool, EventBus) {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let bus = EventBus::with_pool(db.pool().clone());
        (db.pool().clone(), bus)
    }

    fn make_create_req(name: &str, tool: ProjectTool) -> ProjectCreateRequest {
        ProjectCreateRequest {
            request_id: new_id(),
            name: name.to_owned(),
            tool,
            path: format!("projects/{name}"),
            initial_sources: vec![],
            notes: None,
            canonical_target_id: None,
        }
    }

    #[tokio::test]
    async fn create_project_setup_incomplete_no_sources() {
        let (pool, bus) = setup().await;
        let req = make_create_req("NGC 7000 NB", ProjectTool::PixInsight);
        let result = create(&pool, &bus, &req).await.unwrap();
        assert_eq!(result.lifecycle, "setup_incomplete");
        assert!(result.channels.is_empty());
        // Constitution II: create always produces a folder-structure plan.
        assert!(result.plan_id.is_some(), "create must return a plan_id");
    }

    #[tokio::test]
    async fn create_project_duplicate_name_rejected() {
        let (pool, bus) = setup().await;
        let req = make_create_req("NGC 7000 NB", ProjectTool::PixInsight);
        create(&pool, &bus, &req).await.unwrap();
        let req2 = ProjectCreateRequest { path: "projects/other".to_owned(), ..req };
        let err = create(&pool, &bus, &req2).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::NameDuplicate);
    }

    #[tokio::test]
    async fn create_project_duplicate_path_rejected() {
        let (pool, bus) = setup().await;
        let req = make_create_req("NGC 7000 NB", ProjectTool::PixInsight);
        create(&pool, &bus, &req).await.unwrap();
        let req2 = ProjectCreateRequest { name: "Other Name".to_owned(), ..req };
        let err = create(&pool, &bus, &req2).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PathCollision);
    }

    #[tokio::test]
    async fn create_project_empty_name_rejected() {
        let (pool, bus) = setup().await;
        let req = make_create_req("", ProjectTool::PixInsight);
        let err = create(&pool, &bus, &req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::NameEmpty);
    }

    #[tokio::test]
    async fn update_project_name() {
        let (pool, bus) = setup().await;
        let create_req = make_create_req("Old Name", ProjectTool::PixInsight);
        let created = create(&pool, &bus, &create_req).await.unwrap();

        let update_req = ProjectUpdateRequest {
            request_id: new_id(),
            project_id: created.project_id.clone(),
            name: Some("New Name".to_owned()),
            tool: None,
            notes: None,
        };
        let result = update(&pool, &bus, &update_req).await.unwrap();
        assert!(result.fields_updated.contains(&"name".to_owned()));
    }

    #[tokio::test]
    async fn update_archived_project_rejected() {
        let (pool, bus) = setup().await;
        let create_req = make_create_req("My Project", ProjectTool::PixInsight);
        let created = create(&pool, &bus, &create_req).await.unwrap();

        // Manually set lifecycle to archived.
        repo::update_project_lifecycle(&pool, &created.project_id, "archived").await.unwrap();

        let update_req = ProjectUpdateRequest {
            request_id: new_id(),
            project_id: created.project_id,
            name: Some("New Name".to_owned()),
            tool: None,
            notes: None,
        };
        let err = update(&pool, &bus, &update_req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::LifecycleReadOnly);
    }

    #[tokio::test]
    async fn add_source_triggers_ready_transition() {
        let (pool, bus) = setup().await;
        let create_req = make_create_req("NGC 7000 NB", ProjectTool::PixInsight);
        let created = create(&pool, &bus, &create_req).await.unwrap();
        assert_eq!(created.lifecycle, "setup_incomplete");

        let add_req = ProjectSourceAddRequest {
            request_id: new_id(),
            project_id: created.project_id.clone(),
            inventory_session_id: "inv-001".to_owned(),
        };
        let result = add_source(&pool, &bus, &add_req).await.unwrap();
        assert_eq!(result.new_lifecycle, Some("ready".to_owned()));
    }

    #[tokio::test]
    async fn add_source_duplicate_rejected() {
        let (pool, bus) = setup().await;
        let create_req = make_create_req("NGC 7000 NB", ProjectTool::PixInsight);
        let created = create(&pool, &bus, &create_req).await.unwrap();

        let add_req = ProjectSourceAddRequest {
            request_id: new_id(),
            project_id: created.project_id.clone(),
            inventory_session_id: "inv-001".to_owned(),
        };
        add_source(&pool, &bus, &add_req).await.unwrap();
        let err =
            add_source(&pool, &bus, &ProjectSourceAddRequest { request_id: new_id(), ..add_req })
                .await
                .unwrap_err();
        assert_eq!(err.code, ErrorCode::SourceAlreadyLinked);
    }

    #[tokio::test]
    async fn remove_source_last_requires_confirmation() {
        let (pool, bus) = setup().await;
        let create_req = make_create_req("NGC 7000 NB", ProjectTool::PixInsight);
        let created = create(&pool, &bus, &create_req).await.unwrap();

        let add_req = ProjectSourceAddRequest {
            request_id: new_id(),
            project_id: created.project_id.clone(),
            inventory_session_id: "inv-001".to_owned(),
        };
        add_source(&pool, &bus, &add_req).await.unwrap();

        // Attempt remove without confirmation.
        let rm_req = ProjectSourceRemoveRequest {
            request_id: new_id(),
            project_id: created.project_id.clone(),
            project_source_id: "inv-001".to_owned(),
            confirm_last_source: false,
        };
        let err = remove_source(&pool, &bus, &rm_req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::LifecycleLastConfirmedSource);
    }

    #[tokio::test]
    async fn remove_source_with_confirmation_succeeds() {
        let (pool, bus) = setup().await;
        let create_req = make_create_req("NGC 7000 NB", ProjectTool::PixInsight);
        let created = create(&pool, &bus, &create_req).await.unwrap();

        let add_req = ProjectSourceAddRequest {
            request_id: new_id(),
            project_id: created.project_id.clone(),
            inventory_session_id: "inv-001".to_owned(),
        };
        add_source(&pool, &bus, &add_req).await.unwrap();

        let rm_req = ProjectSourceRemoveRequest {
            request_id: new_id(),
            project_id: created.project_id.clone(),
            project_source_id: "inv-001".to_owned(),
            confirm_last_source: true,
        };
        let result = remove_source(&pool, &bus, &rm_req).await.unwrap();
        assert_eq!(result.new_lifecycle, Some("setup_incomplete".to_owned()));
    }

    #[tokio::test]
    async fn remove_source_from_prepared_rejected() {
        let (pool, bus) = setup().await;
        let create_req = make_create_req("NGC 7000 NB", ProjectTool::PixInsight);
        let created = create(&pool, &bus, &create_req).await.unwrap();

        // Add a source so lifecycle can be moved to ready.
        let add_req = ProjectSourceAddRequest {
            request_id: new_id(),
            project_id: created.project_id.clone(),
            inventory_session_id: "inv-001".to_owned(),
        };
        add_source(&pool, &bus, &add_req).await.unwrap();
        // Move to prepared manually (lifecycle gate test).
        repo::update_project_lifecycle(&pool, &created.project_id, "prepared").await.unwrap();

        let rm_req = ProjectSourceRemoveRequest {
            request_id: new_id(),
            project_id: created.project_id.clone(),
            project_source_id: "inv-001".to_owned(),
            confirm_last_source: true,
        };
        let err = remove_source(&pool, &bus, &rm_req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::LifecycleReadOnly);
    }

    #[tokio::test]
    async fn reinfer_clears_drift_flag() {
        let (pool, bus) = setup().await;
        let create_req = make_create_req("NGC 7000 NB", ProjectTool::PixInsight);
        let created = create(&pool, &bus, &create_req).await.unwrap();

        // Artificially set drift.
        repo::set_channel_drift(&pool, &created.project_id, true).await.unwrap();

        let req = ProjectChannelsReinferRequest {
            request_id: new_id(),
            project_id: created.project_id.clone(),
        };
        reinfer_channels(&pool, &bus, &req).await.unwrap();
        let detail = get(&pool, &created.project_id).await.unwrap();
        assert!(!detail.channel_drift.has_new_sources);
    }

    #[tokio::test]
    async fn dismiss_drift_clears_flag() {
        let (pool, bus) = setup().await;
        let create_req = make_create_req("NGC 7000 NB", ProjectTool::PixInsight);
        let created = create(&pool, &bus, &create_req).await.unwrap();

        repo::set_channel_drift(&pool, &created.project_id, true).await.unwrap();

        let req = ProjectChannelsDismissDriftRequest {
            request_id: new_id(),
            project_id: created.project_id.clone(),
        };
        dismiss_drift(&pool, &bus, &req).await.unwrap();
        let detail = get(&pool, &created.project_id).await.unwrap();
        assert!(!detail.channel_drift.has_new_sources);
    }

    #[tokio::test]
    async fn list_projects_returns_summary() {
        let (pool, bus) = setup().await;
        create(&pool, &bus, &make_create_req("A", ProjectTool::PixInsight)).await.unwrap();
        create(&pool, &bus, &make_create_req("B", ProjectTool::Siril)).await.unwrap();
        let list = list(&pool).await.unwrap();
        assert_eq!(list.len(), 2);
    }

    // ── Constitution II: folder plan tests ────────────────────────────────────

    #[tokio::test]
    async fn create_returns_plan_id() {
        let (pool, bus) = setup().await;
        let req = make_create_req("NGC 7000 NB", ProjectTool::PixInsight);
        let result = create(&pool, &bus, &req).await.unwrap();
        assert!(
            result.plan_id.is_some(),
            "create must return a plan_id for the folder-structure plan"
        );
    }

    #[tokio::test]
    async fn create_pixinsight_plan_has_correct_folders() {
        use persistence_db::repositories::plans as plans_repo;

        let (pool, bus) = setup().await;
        let req = make_create_req("NGC 7000 PI", ProjectTool::PixInsight);
        let result = create(&pool, &bus, &req).await.unwrap();

        let plan_id = result.plan_id.expect("plan_id must be present");
        let plan = plans_repo::get_plan(&pool, &plan_id, false).await.unwrap();
        let items = plans_repo::list_plan_items(&pool, &plan_id).await.unwrap();

        assert_eq!(plan.state, "ready_for_review", "plan should be ready for review");
        assert_eq!(plan.origin, "project");

        let actions: Vec<&str> = items.iter().map(|i| i.action.as_str()).collect();
        // PixInsight: 6 mkdir + 1 write_manifest = 7 items
        let mkdir_count = actions.iter().filter(|&&a| a == "mkdir").count();
        let manifest_count = actions.iter().filter(|&&a| a == "write_manifest").count();
        assert_eq!(
            mkdir_count, 6,
            "PixInsight needs 6 sub-folders (lights, darks, flats, bias, output, processing)"
        );
        assert_eq!(manifest_count, 1, "exactly one marker write item");

        let folder_names: Vec<&str> =
            items.iter().filter(|i| i.action == "mkdir").map(|i| i.name.as_str()).collect();
        assert!(folder_names.contains(&"lights"));
        assert!(folder_names.contains(&"darks"));
        assert!(folder_names.contains(&"flats"));
        assert!(folder_names.contains(&"bias"));
        assert!(folder_names.contains(&"output"));
        assert!(folder_names.contains(&"processing"));

        // Marker item name should be the app marker filename
        let has_marker = items.iter().any(|i| i.name == ".astro-plan-project.json");
        assert!(has_marker, "marker file item must be present");
    }

    #[tokio::test]
    async fn create_siril_plan_has_five_folders() {
        use persistence_db::repositories::plans as plans_repo;

        let (pool, bus) = setup().await;
        let req = make_create_req("M31 Siril", ProjectTool::Siril);
        let result = create(&pool, &bus, &req).await.unwrap();

        let plan_id = result.plan_id.expect("plan_id must be present");
        let items = plans_repo::list_plan_items(&pool, &plan_id).await.unwrap();

        let mkdir_count = items.iter().filter(|i| i.action == "mkdir").count();
        // Siril: 5 sub-folders (no processing/)
        assert_eq!(mkdir_count, 5);
        let folder_names: Vec<&str> =
            items.iter().filter(|i| i.action == "mkdir").map(|i| i.name.as_str()).collect();
        assert!(!folder_names.contains(&"processing"), "Siril has no processing/ folder");
    }

    // ── spec 035 US1 #2: project ↔ canonical_target association ──────────────────

    /// Insert a minimal `canonical_target` row so the create use case's existence
    /// check passes and the FK target is present.
    async fn seed_canonical_target(pool: &SqlitePool, id: &str) {
        sqlx::query(
            "INSERT INTO canonical_target
                (id, simbad_oid, primary_designation, object_type, ra_deg, dec_deg, source, resolved_at)
             VALUES (?, NULL, 'M 31', 'galaxy', 10.68, 41.27, 'resolved', '2026-01-01T00:00:00Z')",
        )
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn create_without_canonical_target_stores_null() {
        let (pool, bus) = setup().await;
        let req = make_create_req("No Target Project", ProjectTool::PixInsight);
        let result = create(&pool, &bus, &req).await.unwrap();
        let stored =
            repo::get_project_canonical_target_id(&pool, &result.project_id).await.unwrap();
        assert_eq!(stored, None, "absent canonicalTargetId must persist as NULL");
    }

    #[tokio::test]
    async fn create_with_canonical_target_persists_and_reads_back() {
        let (pool, bus) = setup().await;
        let ctid = "11111111-1111-5111-8111-111111111111";
        seed_canonical_target(&pool, ctid).await;

        let mut req = make_create_req("Targeted Project", ProjectTool::PixInsight);
        req.canonical_target_id = Some(ctid.to_owned());
        let result = create(&pool, &bus, &req).await.unwrap();

        let stored =
            repo::get_project_canonical_target_id(&pool, &result.project_id).await.unwrap();
        assert_eq!(stored.as_deref(), Some(ctid), "canonicalTargetId must round-trip");
    }

    #[tokio::test]
    async fn create_with_unknown_canonical_target_is_rejected() {
        let (pool, bus) = setup().await;
        let mut req = make_create_req("Dangling Target", ProjectTool::PixInsight);
        req.canonical_target_id = Some("22222222-2222-5222-8222-222222222222".to_owned());
        let err = create(&pool, &bus, &req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::CanonicalTargetNotFound);
    }

    // ── spec 035 US1 #2: canonical target surfaced on the detail READ path ───────

    #[tokio::test]
    async fn get_returns_canonical_target_with_designation_and_common_name() {
        let (pool, bus) = setup().await;
        let ctid = "33333333-3333-5333-8333-333333333333";
        seed_canonical_target(&pool, ctid).await;
        // A common_name alias so the read populates `common_name`.
        sqlx::query(
            "INSERT INTO target_alias (id, target_id, alias, normalized, kind)
             VALUES ('a1', ?, 'Andromeda Galaxy', 'andromeda galaxy', 'common_name')",
        )
        .bind(ctid)
        .execute(&pool)
        .await
        .unwrap();

        let mut req = make_create_req("Detail With Target", ProjectTool::PixInsight);
        req.canonical_target_id = Some(ctid.to_owned());
        let created = create(&pool, &bus, &req).await.unwrap();

        let detail = get(&pool, &created.project_id).await.unwrap();
        let ct = detail.canonical_target.expect("canonical_target must be present");
        assert_eq!(ct.id, ctid);
        assert_eq!(ct.primary_designation, "M 31");
        assert_eq!(ct.common_name.as_deref(), Some("Andromeda Galaxy"));
    }

    #[tokio::test]
    async fn get_canonical_target_is_none_without_alias_common_name() {
        let (pool, bus) = setup().await;
        let ctid = "44444444-4444-5444-8444-444444444444";
        seed_canonical_target(&pool, ctid).await; // no common_name alias

        let mut req = make_create_req("Detail No Common Name", ProjectTool::PixInsight);
        req.canonical_target_id = Some(ctid.to_owned());
        let created = create(&pool, &bus, &req).await.unwrap();

        let detail = get(&pool, &created.project_id).await.unwrap();
        let ct = detail.canonical_target.expect("association present");
        assert_eq!(ct.primary_designation, "M 31");
        assert_eq!(ct.common_name, None, "no common-name alias → null");
    }

    #[tokio::test]
    async fn get_returns_no_canonical_target_when_unassociated() {
        let (pool, bus) = setup().await;
        let req = make_create_req("Detail No Target", ProjectTool::PixInsight);
        let created = create(&pool, &bus, &req).await.unwrap();

        let detail = get(&pool, &created.project_id).await.unwrap();
        assert!(detail.canonical_target.is_none(), "no association → None");
    }
}
