// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! One `PlateVault` operation per Project at a time (spec 069 PREP-FR-19,
//! PREP-AC-28; D-W100): Apply, Copy to Output and Wrap up's steps reserve the
//! Project in the write transaction that records their first durable state,
//! before any file effect, and settle it once their own record has settled.
//! No writer is held across the file work in between. `project_lifecycle.sql`
//! refuses a second active operation and any operation on a locked Project;
//! these helpers check first so the refusal names the running operation.

use platevault_model::{
    LibraryError, ProjectLifecycle, ProjectOperation, ProjectOperationKind, ProjectOperationState,
};
use sqlx::sqlite::SqliteConnection;
use sqlx::Row;
use uuid::Uuid;

use super::{from_text, now, parse_uuid, to_text, Catalog, Result};

impl Catalog {
    /// The operation running on `project_id`, if any. Read-only.
    ///
    /// # Errors
    /// `PersistenceFailure` for a corrupt record.
    pub async fn active_project_operation(
        &self,
        project_id: Uuid,
    ) -> Result<Option<ProjectOperation>> {
        let mut conn = self.reader().await?;
        active_operation(&mut conn, project_id).await
    }
}

/// The active operation of `project_id` in the caller's snapshot.
///
/// # Errors
/// `PersistenceFailure` for a corrupt record.
pub(crate) async fn active_operation(
    conn: &mut SqliteConnection,
    project_id: Uuid,
) -> Result<Option<ProjectOperation>> {
    let row = sqlx::query(
        "SELECT id, kind, state, reserved_at, settled_at FROM project_operations \
         WHERE project_id = ?1 AND state = 'active'",
    )
    .bind(project_id.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    row.map(|row| {
        Ok(ProjectOperation {
            id: parse_uuid(&row.try_get::<String, _>("id")?)?,
            project_id,
            kind: from_text(&row.try_get::<String, _>("kind")?)?,
            state: from_text(&row.try_get::<String, _>("state")?)?,
            reserved_at: row.try_get("reserved_at")?,
            settled_at: row.try_get("settled_at")?,
        })
    })
    .transpose()
}

/// Reserve `project_id` for one `kind` operation inside the caller's write
/// transaction, and return it.
///
/// # Errors
/// `NotFound` for an unknown Project; `InvalidInput` naming the running
/// operation, or for a Project whose lifecycle admits no `kind` operation.
pub(crate) async fn reserve_operation(
    conn: &mut SqliteConnection,
    project_id: Uuid,
    kind: ProjectOperationKind,
) -> Result<ProjectOperation> {
    let lifecycle: Option<String> =
        sqlx::query_scalar("SELECT lifecycle FROM projects WHERE id = ?1")
            .bind(project_id.to_string())
            .fetch_optional(&mut *conn)
            .await?;
    let lifecycle: ProjectLifecycle = from_text(
        &lifecycle.ok_or_else(|| LibraryError::NotFound(format!("project {project_id}")))?,
    )?;
    if !lifecycle.admits_operation(kind) {
        return Err(LibraryError::InvalidInput(format!(
            "a {lifecycle} Project takes no {} operation",
            to_text(&kind)?
        )));
    }
    if let Some(running) = active_operation(conn, project_id).await? {
        return Err(LibraryError::InvalidInput(format!(
            "{} is already running on this Project (operation {}); wait for it to finish",
            operation_label(running.kind),
            running.id
        )));
    }
    let operation = ProjectOperation {
        id: Uuid::new_v4(),
        project_id,
        kind,
        state: ProjectOperationState::Active,
        reserved_at: now()?,
        settled_at: None,
    };
    sqlx::query(
        "INSERT INTO project_operations (id, project_id, kind, state, reserved_at) \
         VALUES (?1, ?2, ?3, 'active', ?4)",
    )
    .bind(operation.id.to_string())
    .bind(project_id.to_string())
    .bind(to_text(&kind)?)
    .bind(&operation.reserved_at)
    .execute(&mut *conn)
    .await?;
    Ok(operation)
}

/// Settle the active operation `id` inside the caller's write transaction.
///
/// # Errors
/// `NotFound` unless `id` is an active operation.
pub(crate) async fn settle_operation(conn: &mut SqliteConnection, id: Uuid) -> Result<()> {
    let settled = sqlx::query(
        "UPDATE project_operations SET state = 'settled', settled_at = ?2 \
         WHERE id = ?1 AND state = 'active'",
    )
    .bind(id.to_string())
    .bind(now()?)
    .execute(&mut *conn)
    .await?;
    if settled.rows_affected() == 1 {
        Ok(())
    } else {
        Err(LibraryError::NotFound(format!("active Project operation {id}")))
    }
}

const fn operation_label(kind: ProjectOperationKind) -> &'static str {
    match kind {
        ProjectOperationKind::Apply => "Apply",
        ProjectOperationKind::CopyToOutput => "Copy to Output",
        ProjectOperationKind::CleanUp => "Wrap up's Clean up",
        ProjectOperationKind::Trash => "Wrap up's Trash",
        ProjectOperationKind::Archive => "Archive",
    }
}
