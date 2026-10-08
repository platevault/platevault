// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Home's running work (spec 065 PRJ-FR-17 section 6): which scans,
//! measurement runs, preparation revisions, imports and storage operations
//! are Running, read in one catalog snapshot. Each feature's own read loads
//! the record. Read-only.

use sqlx::sqlite::SqliteConnection;
use sqlx::Connection;
use uuid::Uuid;

use super::{parse_uuid, Catalog, Result};

/// The ids of every Running operation, each kind in start order.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct RunningOperations {
    pub scans: Vec<Uuid>,
    pub measurements: Vec<Uuid>,
    pub preparations: Vec<Uuid>,
    pub imports: Vec<Uuid>,
    pub storage: Vec<Uuid>,
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
            preparations: running(
                &mut snapshot,
                "SELECT id FROM preparation_revisions WHERE state = 'running' \
                 ORDER BY started_at, id",
            )
            .await?,
            imports: running(
                &mut snapshot,
                "SELECT id FROM import_operations WHERE state = 'running' ORDER BY created_at, id",
            )
            .await?,
            storage: running(
                &mut snapshot,
                "SELECT id FROM storage_operations WHERE state = 'running' ORDER BY created_at, id",
            )
            .await?,
        };
        snapshot.rollback().await?;
        Ok(running)
    }
}

async fn running(conn: &mut SqliteConnection, sql: &'static str) -> Result<Vec<Uuid>> {
    let ids: Vec<String> = sqlx::query_scalar(sql).fetch_all(&mut *conn).await?;
    ids.iter().map(|id| parse_uuid(id)).collect()
}
