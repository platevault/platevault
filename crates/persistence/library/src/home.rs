// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Home's running work (spec 065 PRJ-FR-17 section 6): which scans,
//! measurement runs, preparation revisions, Prepare all revisions of run
//! groups, imports, run Clean ups and Empty Trashes, archive transfers, Done
//! / Archive trash moves and other storage operations are Running, read in
//! one catalog snapshot. Each feature's own read loads the record. Read-only.

use sqlx::sqlite::SqliteConnection;
use sqlx::Connection;
use uuid::Uuid;

use super::{parse_uuid, Catalog, Result};

/// The ids of every Running operation, each kind in start order.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct RunningOperations {
    pub scans: Vec<Uuid>,
    pub measurements: Vec<Uuid>,
    /// Running revisions of a run, or of a panel run outside a Running
    /// Prepare all (a panel run retried on its own).
    pub preparations: Vec<Uuid>,
    /// Running Prepare all revisions; their panel runs' revisions are theirs.
    pub group_preparations: Vec<Uuid>,
    pub imports: Vec<Uuid>,
    pub storage: RunningStorage,
}

/// Running storage work, each listed once by the feature that owns it.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct RunningStorage {
    /// Running run Clean ups and Empty Trashes; their storage operations are
    /// theirs, through Empty Trash's folder moves.
    pub cleanups: Vec<Uuid>,
    /// Running archive and restore transfers; their storage operations are
    /// theirs.
    pub archives: Vec<Uuid>,
    /// The storage operations of Done / Archive trash moves that are Running.
    pub trash_moves: Vec<Uuid>,
    /// Running storage operations of no Clean up, Empty Trash, archive
    /// transfer or trash move.
    pub operations: Vec<Uuid>,
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
                "SELECT r.id FROM preparation_revisions r WHERE r.state = 'running' \
                 AND NOT EXISTS (SELECT 1 FROM group_preparations g \
                 WHERE g.id = r.group_preparation_id AND g.outcome = 'running') \
                 ORDER BY r.started_at, r.id",
            )
            .await?,
            group_preparations: running(
                &mut snapshot,
                "SELECT id FROM group_preparations WHERE outcome = 'running' \
                 ORDER BY started_at, id",
            )
            .await?,
            imports: running(
                &mut snapshot,
                "SELECT id FROM import_operations WHERE state = 'running' ORDER BY created_at, id",
            )
            .await?,
            storage: running_storage(&mut snapshot).await?,
        };
        snapshot.rollback().await?;
        Ok(running)
    }
}

async fn running_storage(conn: &mut SqliteConnection) -> Result<RunningStorage> {
    Ok(RunningStorage {
        cleanups: running(
            conn,
            "SELECT id FROM run_cleanups WHERE state = 'running' ORDER BY created_at, id",
        )
        .await?,
        archives: running(
            conn,
            "SELECT id FROM archive_transfers WHERE state = 'running' ORDER BY created_at, id",
        )
        .await?,
        trash_moves: running(
            conn,
            "SELECT t.op_id FROM trash_moves t JOIN storage_operations o ON o.id = t.op_id \
             WHERE t.settled_at IS NULL AND o.state = 'running' ORDER BY o.created_at, o.id",
        )
        .await?,
        operations: running(
            conn,
            "SELECT o.id FROM storage_operations o WHERE o.state = 'running' \
             AND NOT EXISTS (SELECT 1 FROM run_cleanups c WHERE c.op_id = o.id) \
             AND NOT EXISTS (SELECT 1 FROM archive_transfers a WHERE a.storage_op_id = o.id) \
             AND NOT EXISTS (SELECT 1 FROM trash_moves t WHERE t.op_id = o.id) \
             ORDER BY o.created_at, o.id",
        )
        .await?,
    })
}

async fn running(conn: &mut SqliteConnection, sql: &'static str) -> Result<Vec<Uuid>> {
    let ids: Vec<String> = sqlx::query_scalar(sql).fetch_all(&mut *conn).await?;
    ids.iter().map(|id| parse_uuid(id)).collect()
}
