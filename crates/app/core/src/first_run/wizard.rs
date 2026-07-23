// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The `first_run_state` singleton: get/complete/restart.

use audit::bus::EventBus;
use audit::event_bus::{FirstRunCompleted, Source, SourceCountByKind, TOPIC_FIRST_RUN_COMPLETED};
use contracts_core::first_run::{
    FirstRunCompleteResponse, FirstRunRestartResponse, FirstRunStateResponse, SourceKind,
};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use persistence_db::repositories::first_run as repo;
use sqlx::SqlitePool;

use super::db_to_contract;

/// Get the current first-run wizard state.
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn get_first_run_state(
    pool: &SqlitePool,
) -> Result<FirstRunStateResponse, ContractError> {
    repo::get_first_run_state(pool).await.map_err(db_to_contract)
}

/// Mark the first-run wizard as complete, publishing an audit event.
///
/// Checks that at least one raw and one project source exist before
/// allowing completion.
///
/// # Errors
///
/// Returns `ContractError` if preconditions are not met or on database failure.
pub async fn complete_first_run(
    pool: &SqlitePool,
    bus: &EventBus,
) -> Result<FirstRunCompleteResponse, ContractError> {
    // Let the repository check preconditions and mark complete.
    let resp = repo::complete_first_run(pool).await.map_err(|e| {
        let msg = e.to_string();
        if msg.contains("first_run.incomplete") {
            ContractError::new(
                ErrorCode::FirstrunIncomplete,
                "At least one raw source and one project source must be registered before completing first run.",
                ErrorSeverity::Blocking,
                false,
            )
        } else {
            db_to_contract(e)
        }
    })?;

    // Count sources per kind for the audit event.
    let sources = repo::list_sources(pool).await.map_err(db_to_contract)?;
    let source_count_by_kind = SourceCountByKind {
        light_frames: sources.iter().filter(|s| s.kind == SourceKind::LightFrames).count(),
        calibration: sources.iter().filter(|s| s.kind == SourceKind::Calibration).count(),
        project: sources.iter().filter(|s| s.kind == SourceKind::Project).count(),
        inbox: sources.iter().filter(|s| s.kind == SourceKind::Inbox).count(),
    };

    // Publish audit event (best-effort; do not fail the operation if the bus drops).
    let _ = bus
        .publish(
            TOPIC_FIRST_RUN_COMPLETED,
            Source::User,
            FirstRunCompleted { completed_at: resp.completed_at.clone(), source_count_by_kind },
        )
        .await;

    Ok(resp)
}

/// Restart the first-run wizard, returning existing sources as prefill.
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn restart_first_run(
    pool: &SqlitePool,
) -> Result<FirstRunRestartResponse, ContractError> {
    repo::restart_first_run(pool).await.map_err(db_to_contract)
}
