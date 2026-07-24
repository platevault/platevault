// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `project.source.add` / `project.source.remove` — link/unlink an Inventory
//! session, recomputing channels and the `setup_incomplete`/`ready`
//! auto-transition on each side.

use audit::bus::EventBus;
use audit::event_bus::Source;
use contracts_core::projects_v2::{
    ProjectChannelDto, ProjectSourceAddRequest, ProjectSourceAddResult, ProjectSourceRemoveRequest,
    ProjectSourceRemoveResult,
};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use domain_core::ids::{new_id, Timestamp};
use domain_core::project::channels::{merge_channels, Channel};
use domain_core::project::validate::is_source_remove_locked;
use persistence_plans::repositories::projects as repo;
use sqlx::SqlitePool;

use app_core_errors::bus_err;

use super::{
    channel_dto_from_domain, channel_totals_by_filter, db_err, infer_from_sources,
    maybe_auto_ready, maybe_regress_to_incomplete, persist_channels, source_snapshot,
    source_to_dto, write_source_change_manifest,
};

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
    if domain_core::project::validate::is_read_only(&row.lifecycle) {
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

    let snap = source_snapshot(pool, &req.inventory_session_id).await?;
    let src_data = repo::InsertProjectSource {
        id: &src_id,
        project_id: &req.project_id,
        inventory_session_id: &req.inventory_session_id,
        name_snapshot: &snap.name,
        frames_snapshot: snap.frames,
        filter_snapshot: &snap.filter,
        exposure_snapshot: &snap.exposure,
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

    write_source_change_manifest(pool, bus, &req.project_id).await;

    let added_row = repo::ProjectSourceRow {
        id: src_id,
        project_id: req.project_id.clone(),
        inventory_session_id: req.inventory_session_id.clone(),
        name_snapshot: snap.name,
        frames_snapshot: snap.frames,
        filter_snapshot: snap.filter,
        exposure_snapshot: snap.exposure,
        linked_at: now.clone(),
    };

    let channel_totals = channel_totals_by_filter(&all_sources);
    let channel_dtos: Vec<ProjectChannelDto> =
        merged.into_iter().map(|c| channel_dto_from_domain(c, &now, &channel_totals)).collect();

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

    write_source_change_manifest(pool, bus, &req.project_id).await;

    Ok(ProjectSourceRemoveResult {
        project_id: req.project_id.clone(),
        removed_source_id: req.project_source_id.clone(),
        audit_id,
        new_lifecycle,
    })
}
