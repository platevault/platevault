// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Home's running work (spec 065 PRJ-FR-17 section 4): which scans,
//! measurement runs, imports, Project operations (Apply, Copy to Output and
//! Wrap up's steps) and other storage operations are Running, read in one
//! catalog snapshot. A storage operation a Project operation carries is that
//! operation's, so it is listed once, under its Project (PREP-FR-19). Each
//! feature's own read loads the rest of the record. Read-only.

use platevault_model::ProjectOperation;
use sqlx::sqlite::SqliteConnection;
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::project_operations::operation_row;
use super::{parse_uuid, Catalog, Result};

/// The ids of every Running operation, each kind in start order.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct RunningOperations {
    pub scans: Vec<Uuid>,
    pub measurements: Vec<Uuid>,
    pub imports: Vec<Uuid>,
    /// Each Project's active operation, in reservation order.
    pub projects: Vec<RunningProject>,
    /// Running storage operations no Project operation carries: Sessions >
    /// Archive and other library storage work.
    pub storage: Vec<Uuid>,
}

/// A Project's one active operation with the Project's name.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RunningProject {
    pub operation: ProjectOperation,
    pub project_name: String,
}

impl Catalog {
    /// Every Running operation of each kind Home lists, from one snapshot.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn running_operations(&self) -> Result<RunningOperations> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let running = RunningOperations {
            scans: running(
                &mut snapshot,
                "SELECT id FROM scan_operations WHERE state = 'running' ORDER BY sequence",
            )
            .await?,
            measurements: running(
                &mut snapshot,
                "SELECT id FROM measurement_runs WHERE state = 'running' ORDER BY sequence",
            )
            .await?,
            imports: running(
                &mut snapshot,
                "SELECT id FROM import_operations WHERE state = 'running' ORDER BY created_at, id",
            )
            .await?,
            projects: running_projects(&mut snapshot).await?,
            storage: running(
                &mut snapshot,
                "SELECT o.id FROM storage_operations o WHERE o.state = 'running' \
                 AND NOT EXISTS (SELECT 1 FROM output_copies c \
                     WHERE c.storage_operation_id = o.id) \
                 AND NOT EXISTS (SELECT 1 FROM wrap_up_trash_items t \
                     WHERE t.storage_operation_id = o.id) \
                 AND NOT EXISTS (SELECT 1 FROM archive_moves m \
                     WHERE m.storage_operation_id = o.id AND m.project_operation_id IS NOT NULL) \
                 ORDER BY o.created_at, o.id",
            )
            .await?,
        };
        snapshot.rollback().await?;
        Ok(running)
    }
}

async fn running_projects(conn: &mut SqliteConnection) -> Result<Vec<RunningProject>> {
    let rows = sqlx::query(
        "SELECT o.id, o.project_id, o.kind, o.state, o.reserved_at, o.settled_at, p.name \
         FROM project_operations o JOIN projects p ON p.id = o.project_id \
         WHERE o.state = 'active' ORDER BY o.reserved_at, o.id",
    )
    .fetch_all(&mut *conn)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(RunningProject {
                operation: operation_row(row)?,
                project_name: row.try_get("name")?,
            })
        })
        .collect()
}

async fn running(conn: &mut SqliteConnection, sql: &'static str) -> Result<Vec<Uuid>> {
    let ids: Vec<String> = sqlx::query_scalar(sql).fetch_all(&mut *conn).await?;
    ids.iter().map(|id| parse_uuid(id)).collect()
}
