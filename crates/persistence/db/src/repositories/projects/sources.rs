// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `project_sources` table CRUD.

use sqlx::{SqliteConnection, SqlitePool};

use crate::{DbError, DbResult};

use super::{InsertProjectSource, ProjectSourceRow};

/// List the ids of every project linked (via `project_sources`) to a given
/// `inventory_session_id` (an `acquisition_session.id`).
///
/// Spec 041 R-17/FR-052: the read side of target propagation — a session with
/// no linked project simply returns an empty vec (not an error).
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn list_project_ids_for_session(
    pool: &SqlitePool,
    inventory_session_id: &str,
) -> DbResult<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT project_id FROM project_sources WHERE inventory_session_id = ?",
    )
    .bind(inventory_session_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

/// Whether any of this project's linked sessions has had a raw-frame archived
/// via an applied cleanup plan (spec 008 Q27 F-Framing-6, Q25 "raw-subs-archived"
/// reopen warning).
///
/// Reuses the real raw-frame cleanup mechanism
/// (`app_core::cleanup_generator::generate_raw_frame_plan`, `category =
/// "raw_frames"`, `action = "archive"`): a succeeded archive item under an
/// applied plan, whose `source_id` is one of this project's linked sessions,
/// is durable evidence the project's raw subs are no longer all on disk under
/// original custody — the reopen path degrades to a warning rather than a
/// silent no-op (Q19 "raw kept & protected by default" is what the warning
/// protects).
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn has_archived_raw_frames_for_project(
    pool: &SqlitePool,
    project_id: &str,
) -> DbResult<bool> {
    let row: Option<(i64,)> = sqlx::query_as(
        "SELECT 1 FROM plan_items pi
         JOIN plans p ON p.id = pi.plan_id
         WHERE pi.category = 'raw_frames'
           AND pi.action = 'archive'
           AND pi.item_state = 'succeeded'
           AND p.state = 'applied'
           AND pi.source_id IN (
               SELECT inventory_session_id FROM project_sources WHERE project_id = ?
           )
         LIMIT 1",
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.is_some())
}

/// Insert a project source link row.
///
/// Returns `DbError::Database` (UNIQUE violation) when the
/// `(project_id, inventory_session_id)` pair already exists.
///
/// # Errors
///
/// Returns [`DbError::Database`] on constraint violation or query failure.
pub async fn insert_project_source(
    pool: &SqlitePool,
    data: &InsertProjectSource<'_>,
) -> DbResult<()> {
    let mut conn = pool.acquire().await?;
    insert_project_source_conn(&mut conn, data).await
}

/// Connection-level variant of [`insert_project_source`]. See
/// [`super::crud::insert_project_conn`].
///
/// # Errors
///
/// Returns [`DbError::Database`] on constraint violation or query failure.
pub(super) async fn insert_project_source_conn(
    conn: &mut SqliteConnection,
    data: &InsertProjectSource<'_>,
) -> DbResult<()> {
    sqlx::query(
        "INSERT INTO project_sources
            (id, project_id, inventory_session_id,
             name_snapshot, frames_snapshot, filter_snapshot, exposure_snapshot, linked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(data.id)
    .bind(data.project_id)
    .bind(data.inventory_session_id)
    .bind(data.name_snapshot)
    .bind(data.frames_snapshot)
    .bind(data.filter_snapshot)
    .bind(data.exposure_snapshot)
    .bind(data.linked_at)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Delete a project source link by its row id (the `inventory_session_id` UUID).
///
/// Returns the number of rows deleted (0 if the source was not found).
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn delete_project_source(
    pool: &SqlitePool,
    project_id: &str,
    inventory_session_id: &str,
) -> DbResult<u64> {
    let result = sqlx::query(
        "DELETE FROM project_sources WHERE project_id = ? AND inventory_session_id = ?",
    )
    .bind(project_id)
    .bind(inventory_session_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

/// Fetch all sources for a project, ordered by linked_at ascending.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn list_project_sources(
    pool: &SqlitePool,
    project_id: &str,
) -> DbResult<Vec<ProjectSourceRow>> {
    let rows: Vec<(String, String, String, String, i64, String, String, String)> = sqlx::query_as(
        "SELECT id, project_id, inventory_session_id,
                    name_snapshot, frames_snapshot, filter_snapshot, exposure_snapshot, linked_at
             FROM project_sources WHERE project_id = ? ORDER BY linked_at ASC",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(
                id,
                project_id,
                inventory_session_id,
                name_snapshot,
                frames_snapshot,
                filter_snapshot,
                exposure_snapshot,
                linked_at,
            )| {
                ProjectSourceRow {
                    id,
                    project_id,
                    inventory_session_id,
                    name_snapshot,
                    frames_snapshot,
                    filter_snapshot,
                    exposure_snapshot,
                    linked_at,
                }
            },
        )
        .collect())
}

/// Get a single project source row by project_id + inventory_session_id.
///
/// # Errors
///
/// Returns [`DbError::NotFound`] when not found.
pub async fn get_project_source(
    pool: &SqlitePool,
    project_id: &str,
    inventory_session_id: &str,
) -> DbResult<ProjectSourceRow> {
    let row: Option<(String, String, String, String, i64, String, String, String)> =
        sqlx::query_as(
            "SELECT id, project_id, inventory_session_id,
                    name_snapshot, frames_snapshot, filter_snapshot, exposure_snapshot, linked_at
             FROM project_sources WHERE project_id = ? AND inventory_session_id = ?",
        )
        .bind(project_id)
        .bind(inventory_session_id)
        .fetch_optional(pool)
        .await?;

    let (
        id,
        project_id,
        inventory_session_id,
        name_snapshot,
        frames_snapshot,
        filter_snapshot,
        exposure_snapshot,
        linked_at,
    ) = row.ok_or_else(|| {
        DbError::NotFound(format!("project_source {inventory_session_id} on {project_id}"))
    })?;

    Ok(ProjectSourceRow {
        id,
        project_id,
        inventory_session_id,
        name_snapshot,
        frames_snapshot,
        filter_snapshot,
        exposure_snapshot,
        linked_at,
    })
}
