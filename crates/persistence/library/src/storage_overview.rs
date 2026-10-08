// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Storage overview reads (spec 071 STO-FR-11, D16): the library-wide
//! content-identity duplicate copies, the archive transfers, and the runs
//! and run groups with a recorded footprint. Every query here only reads;
//! none records an operation or changes a decision.

use platevault_model::{
    Availability, LibraryError, NativePath, ProjectName, StorageOperation, TransferArchive,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use super::{from_text, parse_uuid, path_from_key, Catalog, Result};

/// One live physical copy that shares its SHA-256 with another live copy.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateCopy {
    pub sha256: String,
    pub asset_id: Uuid,
    pub location_id: Uuid,
    /// The copy's path below its location's root.
    pub relative_path: NativePath,
    pub size_bytes: u64,
    pub availability: Availability,
}

/// The copies a duplicate candidate can name: live (never Trashed), in an
/// active location, hashed, and not recorded Missing.
const DUPLICATE_COPIES: &str = "WITH copies AS ( \
         SELECT a.id, a.location_id, a.path_key, a.size_bytes, a.availability, \
                a.content_sha256, l.created_at AS location_created_at \
         FROM live_assets a JOIN locations l ON l.id = a.location_id \
         WHERE l.lifecycle = 'active' AND a.content_sha256 IS NOT NULL \
           AND a.availability NOT IN ('missing', 'retired') \
     ) \
     SELECT * FROM copies WHERE content_sha256 IN ( \
         SELECT content_sha256 FROM copies GROUP BY content_sha256 HAVING COUNT(*) > 1 \
     ) \
     ORDER BY content_sha256, location_created_at, location_id, path_key";

/// A verified transfer with the Archive or restore transfer it carries, if
/// one does.
#[derive(Clone, Debug)]
pub struct VerifiedTransfer {
    pub operation: StorageOperation,
    pub archive: Option<TransferArchive>,
}

impl Catalog {
    /// Every live copy whose SHA-256 another live copy shares, grouped by
    /// digest. Trashed copies, copies of retired locations and copies
    /// recorded Missing are never listed (LIB-FR-18, D16).
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn live_duplicate_copies(&self) -> Result<Vec<DuplicateCopy>> {
        let mut conn = self.reader().await?;
        let rows = sqlx::query(DUPLICATE_COPIES).fetch_all(&mut *conn).await?;
        rows.iter()
            .map(|row| {
                let size: i64 = row.try_get("size_bytes")?;
                Ok(DuplicateCopy {
                    sha256: row.try_get("content_sha256")?,
                    asset_id: parse_uuid(&row.try_get::<String, _>("id")?)?,
                    location_id: parse_uuid(&row.try_get::<String, _>("location_id")?)?,
                    relative_path: path_from_key(&row.try_get::<Vec<u8>, _>("path_key")?)?,
                    size_bytes: u64::try_from(size).map_err(|_| {
                        LibraryError::PersistenceFailure(format!("corrupt asset size {size}"))
                    })?,
                    availability: from_text(&row.try_get::<String, _>("availability")?)?,
                })
            })
            .collect()
    }

    /// Every verified transfer that is not an Import's, newest first, with
    /// its items' recorded phases and the Archive or restore transfer it
    /// carries. Import transfers are listed by Import.
    ///
    /// # Errors
    /// `PersistenceFailure` when the journal cannot be read.
    pub async fn archive_transfers(&self) -> Result<Vec<VerifiedTransfer>> {
        let rows = {
            let mut conn = self.reader().await?;
            sqlx::query(
                "SELECT o.id, a.id AS transfer_id, a.kind, a.project_id, p.name AS project_name \
                 FROM storage_operations o \
                 LEFT JOIN archive_transfers a ON a.storage_op_id = o.id \
                 LEFT JOIN projects p ON p.id = a.project_id \
                 WHERE o.kind IN ('copy', 'move') \
                 AND NOT EXISTS (SELECT 1 FROM import_items i WHERE i.storage_op_id = o.id) \
                 ORDER BY o.created_at DESC, o.id",
            )
            .fetch_all(&mut *conn)
            .await?
        };
        let mut transfers = Vec::with_capacity(rows.len());
        for row in &rows {
            let archive = match row.try_get::<Option<String>, _>("transfer_id")? {
                Some(transfer_id) => Some(TransferArchive {
                    transfer_id: parse_uuid(&transfer_id)?,
                    kind: from_text(&row.try_get::<String, _>("kind")?)?,
                    project: ProjectName {
                        id: parse_uuid(&row.try_get::<String, _>("project_id")?)?,
                        name: row.try_get("project_name")?,
                    },
                }),
                None => None,
            };
            let operation = self.storage_operation(parse_uuid(row.try_get("id")?)?).await?;
            transfers.push(VerifiedTransfer { operation, archive });
        }
        Ok(transfers)
    }

    /// The runs with a recorded preparation revision or Results folder.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn runs_with_footprint(&self) -> Result<Vec<Uuid>> {
        let mut conn = self.reader().await?;
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT view_id FROM preparation_revisions \
             UNION SELECT view_id FROM results_folders WHERE view_id IS NOT NULL \
             ORDER BY view_id",
        )
        .fetch_all(&mut *conn)
        .await?;
        ids.iter().map(|id| parse_uuid(id)).collect()
    }

    /// The run groups with a recorded Prepare all or Assembled folder.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn groups_with_footprint(&self) -> Result<Vec<Uuid>> {
        let mut conn = self.reader().await?;
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT group_id FROM group_preparations \
             UNION SELECT group_id FROM results_folders WHERE group_id IS NOT NULL \
             ORDER BY group_id",
        )
        .fetch_all(&mut *conn)
        .await?;
        ids.iter().map(|id| parse_uuid(id)).collect()
    }
}
