// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `project.update` — patch whitelisted metadata fields (name/tool/notes).

use audit::bus::EventBus;
use audit::event_bus::Source;
use contracts_core::projects_v2::{ProjectUpdateRequest, ProjectUpdateResult};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use domain_core::ids::new_id;
use domain_core::project::validate::{is_read_only, is_tool_locked, validate_name};
use persistence_db::repositories::projects as repo;
use sqlx::SqlitePool;

use app_core_errors::bus_err;

use super::{db_err, str_to_error_code};

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
    let is_mosaic_changing = req.is_mosaic.is_some_and(|m| m != row.is_mosaic);

    if !name_changing && !tool_changing && !notes_changing && !is_mosaic_changing {
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
        req.is_mosaic,
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
    if is_mosaic_changing {
        fields_updated.push("isMosaic".to_owned());
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
