// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `project.list` / `project.get` — read-only DTO projections.

use contracts_core::error_code::ErrorCode;
use contracts_core::projects_v2::{
    ChannelDriftDto, ProjectCanonicalTarget, ProjectDetailDto, ProjectSummaryDto, ProjectTool,
};
use contracts_core::{ContractError, ErrorSeverity};
use persistence_plans::repositories::projects as repo;
use sqlx::SqlitePool;

use super::{channels_to_dto, db_err, source_to_dto};

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
            is_mosaic: row.is_mosaic,
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
            ProjectCanonicalTarget {
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
        channels: channels_to_dto(&channels, &sources),
        created_at: row.created_at,
        updated_at: row.updated_at,
        canonical_target,
        blocked_reason_kind: row.blocked_reason_kind,
        blocked_reason_note: row.blocked_reason_note,
        is_mosaic: row.is_mosaic,
    })
}
