// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Read-only queries for `session.materialization.query` and
//! `session.materialization.result_session.list` contract endpoints.

use sqlx::SqlitePool;

use persistence_core::DbResult;
use persistence_sessions::repositories::materialization::{
    get_operation_by_public_id, get_result_snapshot_by_operation_public_id,
    MaterializationOperationRow, MaterializationResultSnapshotRow,
};
use persistence_sessions::repositories::sessions::{
    current_change_sequence, list_sessions_at_watermark, SessionListFilter, SessionRow,
};

/// Fetch the `session_materialization_operation` for a contract query.
///
/// # Errors
///
/// Returns [`persistence_core::DbError::NotFound`] when the operation does not
/// exist.
pub async fn query_operation(
    pool: &SqlitePool,
    operation_public_id: &str,
) -> DbResult<MaterializationOperationRow> {
    get_operation_by_public_id(pool, operation_public_id).await
}

/// Fetch the result snapshot for a terminal `applied` operation.
///
/// # Errors
///
/// Returns [`persistence_core::DbError::NotFound`] when the operation has no
/// result snapshot (i.e. it is not yet `applied`).
pub async fn query_result_snapshot(
    pool: &SqlitePool,
    operation_public_id: &str,
) -> DbResult<MaterializationResultSnapshotRow> {
    get_result_snapshot_by_operation_public_id(pool, operation_public_id).await
}

/// Parameters for `session.list` watermarked queries.
pub struct SessionListParams<'a> {
    pub canonical_target_public_id: Option<&'a str>,
    pub kind_filter: Option<&'a str>,
    pub page_size: i64,
    pub cursor_created_at: Option<&'a str>,
    pub cursor_public_id: Option<&'a str>,
}

/// Return a watermarked first page of sessions, resolving the watermark from
/// the current `repository_change` sequence.
///
/// # Errors
///
/// Returns [`persistence_core::DbError`] on SQL errors.
pub async fn list_sessions_first_page(
    pool: &SqlitePool,
    params: &SessionListParams<'_>,
) -> DbResult<(i64, Vec<SessionRow>)> {
    // Resolve canonical_target row_id when a public_id is provided.
    let target_row_id: Option<i64> = if let Some(t) = params.canonical_target_public_id {
        let row: Option<(i64,)> =
            sqlx::query_as("SELECT row_id FROM spec062_target WHERE public_id = ?")
                .bind(t)
                .fetch_optional(pool)
                .await?;
        row.map(|r| r.0)
    } else {
        None
    };

    let watermark = current_change_sequence(pool).await?;
    let filter = SessionListFilter {
        canonical_target_row_id: target_row_id,
        kind: params.kind_filter,
        ..Default::default()
    };
    let rows = list_sessions_at_watermark(
        pool,
        watermark,
        &filter,
        params.cursor_created_at,
        params.cursor_public_id,
        params.page_size,
    )
    .await?;
    Ok((watermark, rows))
}

/// Return a subsequent page of sessions at a previously captured watermark.
///
/// # Errors
///
/// Returns [`persistence_core::DbError`] on SQL errors.
pub async fn list_sessions_next_page(
    pool: &SqlitePool,
    watermark: i64,
    params: &SessionListParams<'_>,
) -> DbResult<Vec<SessionRow>> {
    let target_row_id: Option<i64> = if let Some(t) = params.canonical_target_public_id {
        let row: Option<(i64,)> =
            sqlx::query_as("SELECT row_id FROM spec062_target WHERE public_id = ?")
                .bind(t)
                .fetch_optional(pool)
                .await?;
        row.map(|r| r.0)
    } else {
        None
    };

    let filter = SessionListFilter {
        canonical_target_row_id: target_row_id,
        kind: params.kind_filter,
        ..Default::default()
    };
    list_sessions_at_watermark(
        pool,
        watermark,
        &filter,
        params.cursor_created_at,
        params.cursor_public_id,
        params.page_size,
    )
    .await
}
