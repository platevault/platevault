// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `project.channels.reinfer` / `project.channels.dismiss_drift` — recompute
//! channels from scratch, or clear the drift banner without recomputing.

use audit::bus::EventBus;
use audit::event_bus::Source;
use contracts_core::projects_v2::{
    ProjectChannelDto, ProjectChannelsDismissDriftRequest, ProjectChannelsDismissDriftResult,
    ProjectChannelsReinferRequest, ProjectChannelsReinferResult,
};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use domain_core::ids::{new_id, Timestamp};
use domain_core::project::channels::reinfer_channels as domain_reinfer;
use domain_core::project::validate::is_read_only;
use persistence_db::repositories::projects as repo;
use sqlx::SqlitePool;

use app_core_errors::bus_err;

use super::{channel_dto_from_domain, channel_totals_by_filter, db_err, persist_channels};

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

    let channel_totals = channel_totals_by_filter(&sources);
    let channel_dtos: Vec<ProjectChannelDto> =
        channels.into_iter().map(|c| channel_dto_from_domain(c, &now, &channel_totals)).collect();

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
