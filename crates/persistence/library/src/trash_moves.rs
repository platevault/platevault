// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The OS Trash moves of a Done Project's Done / Archive sheet (spec 071
//! STO-FR-14/15/16, LIB-FR-18, D-W43, D-W70, D-W74): each approved move's
//! journal operation and the frame, intermediate or copy each of its items
//! moves, and the catalog side of an item's outcome.
//!
//! The catalog only records; the custody executor in core re-verifies and
//! moves the files through the storage journal.

use std::collections::BTreeSet;

use platevault_model::{LibraryError, ObservationFingerprint, RefusedMove, Revision, TrashOffer};
use sqlx::{Connection, Row, SqliteConnection};
use uuid::Uuid;

use super::{
    db_revision, from_json, from_text, json_ids, now, parse_uuid, revision, to_json, to_text,
    Catalog, Result,
};

/// One journal item of a move: what the approval named and what it moves.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrashMoveItem {
    /// The item's seq in the move's journal operation.
    pub seq: u32,
    /// The frame key, result id or copy asset id the approval named.
    pub item_id: Uuid,
    /// The frame copy this item moves, or the Results file.
    pub target: TrashTarget,
    /// The Complete runs whose fixed membership lists a rejected frame.
    pub complete_view_ids: Vec<Uuid>,
    /// The catalog took the item's Trashed outcome.
    pub recorded: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TrashTarget {
    Asset(Uuid),
    Result(Uuid),
}

/// A recorded move.
#[derive(Clone, Debug)]
pub struct TrashMoveRecord {
    pub op_id: Uuid,
    pub project_id: Uuid,
    pub offer: TrashOffer,
    pub project_revision: Revision,
    /// Approved items refused before anything moved.
    pub refused: Vec<RefusedMove>,
    pub items: Vec<TrashMoveItem>,
    pub settled: bool,
}

impl Catalog {
    /// Record the move a journal operation executes: its approval's offer
    /// and revision, the items refused before anything moved, and what each
    /// journal item moves.
    ///
    /// # Errors
    /// `InvalidInput` for a move with no item; `PersistenceFailure` when the
    /// write cannot commit.
    pub async fn record_trash_move(
        &self,
        op_id: Uuid,
        project_id: Uuid,
        offer: TrashOffer,
        project_revision: Revision,
        refused: &[RefusedMove],
        items: &[TrashMoveItem],
    ) -> Result<TrashMoveRecord> {
        if items.is_empty() {
            return Err(LibraryError::InvalidInput("a trash move needs an item".into()));
        }
        write_txn!(self, |conn| {
            sqlx::query(
                "INSERT INTO trash_moves (op_id, project_id, offer, project_revision, refused, \
                 created_at, settled_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
            )
            .bind(op_id.to_string())
            .bind(project_id.to_string())
            .bind(to_text(&offer)?)
            .bind(db_revision(project_revision)?)
            .bind(to_json(refused)?)
            .bind(now()?)
            .execute(&mut *conn)
            .await?;
            for item in items {
                let (asset, result) = match item.target {
                    TrashTarget::Asset(id) => (Some(id.to_string()), None),
                    TrashTarget::Result(id) => (None, Some(id.to_string())),
                };
                sqlx::query(
                    "INSERT INTO trash_move_items (op_id, seq, item_id, asset_id, result_id, \
                     complete_view_ids, recorded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
                )
                .bind(op_id.to_string())
                .bind(i64::from(item.seq))
                .bind(item.item_id.to_string())
                .bind(asset)
                .bind(result)
                .bind(to_json(&item.complete_view_ids)?)
                .execute(&mut *conn)
                .await?;
            }
        });
        self.trash_move(op_id).await
    }

    /// # Errors
    /// `NotFound` for an operation no trash move recorded.
    pub async fn trash_move(&self, op_id: Uuid) -> Result<TrashMoveRecord> {
        let mut conn = self.reader().await?;
        let row = sqlx::query("SELECT * FROM trash_moves WHERE op_id = ?1")
            .bind(op_id.to_string())
            .fetch_optional(&mut *conn)
            .await?
            .ok_or_else(|| LibraryError::NotFound(format!("trash move {op_id}")))?;
        let rows = sqlx::query("SELECT * FROM trash_move_items WHERE op_id = ?1 ORDER BY seq")
            .bind(op_id.to_string())
            .fetch_all(&mut *conn)
            .await?;
        let mut items = Vec::with_capacity(rows.len());
        for item in &rows {
            let seq: i64 = item.try_get("seq")?;
            let asset: Option<String> = item.try_get("asset_id")?;
            let result: Option<String> = item.try_get("result_id")?;
            let target = match (asset, result) {
                (Some(asset), None) => TrashTarget::Asset(parse_uuid(&asset)?),
                (None, Some(result)) => TrashTarget::Result(parse_uuid(&result)?),
                _ => {
                    return Err(LibraryError::PersistenceFailure("corrupt trash move item".into()))
                }
            };
            items.push(TrashMoveItem {
                seq: u32::try_from(seq)
                    .map_err(|_| LibraryError::PersistenceFailure("corrupt item seq".into()))?,
                item_id: parse_uuid(&item.try_get::<String, _>("item_id")?)?,
                target,
                complete_view_ids: from_json(&item.try_get::<String, _>("complete_view_ids")?)?,
                recorded: item.try_get::<Option<String>, _>("recorded_at")?.is_some(),
            });
        }
        Ok(TrashMoveRecord {
            op_id,
            project_id: parse_uuid(&row.try_get::<String, _>("project_id")?)?,
            offer: from_text(&row.try_get::<String, _>("offer")?)?,
            project_revision: revision(row.try_get("project_revision")?)?,
            refused: from_json(&row.try_get::<String, _>("refused")?)?,
            items,
            settled: row.try_get::<Option<String>, _>("settled_at")?.is_some(),
        })
    }

    /// The move of `offer` for `project` that an interruption left unsettled.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn unsettled_trash_move(
        &self,
        project: Uuid,
        offer: TrashOffer,
    ) -> Result<Option<Uuid>> {
        let mut conn = self.reader().await?;
        let id: Option<String> = sqlx::query_scalar(
            "SELECT op_id FROM trash_moves WHERE project_id = ?1 AND offer = ?2 \
             AND settled_at IS NULL ORDER BY created_at LIMIT 1",
        )
        .bind(project.to_string())
        .bind(to_text(&offer)?)
        .fetch_optional(&mut *conn)
        .await?;
        id.as_deref().map(parse_uuid).transpose()
    }

    /// Note that the catalog took the Trashed outcome of items `seqs`. A
    /// Results file a move trashed reads Missing, as a rescan would record it.
    ///
    /// # Errors
    /// `PersistenceFailure` when the write cannot commit.
    pub async fn record_trash_move_outcomes(&self, op_id: Uuid, seqs: &[u32]) -> Result<()> {
        if seqs.is_empty() {
            return Ok(());
        }
        write_txn!(self, |conn| {
            let at = now()?;
            for seq in seqs {
                let result: Option<String> = sqlx::query_scalar(
                    "SELECT result_id FROM trash_move_items WHERE op_id = ?1 AND seq = ?2",
                )
                .bind(op_id.to_string())
                .bind(i64::from(*seq))
                .fetch_optional(&mut *conn)
                .await?
                .flatten();
                if let Some(result) = result {
                    sqlx::query(
                        "UPDATE result_candidates SET availability = 'missing', updated_at = ?2 \
                         WHERE id = ?1",
                    )
                    .bind(result)
                    .bind(&at)
                    .execute(&mut *conn)
                    .await?;
                }
                sqlx::query(
                    "UPDATE trash_move_items SET recorded_at = ?3 WHERE op_id = ?1 AND seq = ?2",
                )
                .bind(op_id.to_string())
                .bind(i64::from(*seq))
                .bind(&at)
                .execute(&mut *conn)
                .await?;
            }
        });
        Ok(())
    }

    /// Settle a move once its journal operation settled and every outcome
    /// is recorded.
    ///
    /// # Errors
    /// `PersistenceFailure` when the write cannot commit.
    pub async fn settle_trash_move(&self, op_id: Uuid) -> Result<()> {
        write_txn!(self, |conn| {
            sqlx::query(
                "UPDATE trash_moves SET settled_at = ?2 WHERE op_id = ?1 AND settled_at IS NULL",
            )
            .bind(op_id.to_string())
            .bind(now()?)
            .execute(&mut *conn)
            .await?;
        });
        Ok(())
    }

    /// The Complete runs whose latest saved membership includes one of
    /// `copies` (D-W52): their fixed membership lists the frame Trashed.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn complete_runs_holding(&self, copies: &BTreeSet<Uuid>) -> Result<Vec<Uuid>> {
        let mut conn = self.reader().await?;
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT DISTINCT v.id FROM views v \
             JOIN view_revisions r ON r.view_id = v.id AND r.revision = v.revision \
             JOIN view_members m ON m.revision_row = r.id AND m.state = 'included' \
             JOIN view_member_copies mc ON mc.revision_row = m.revision_row \
                 AND mc.member_key = m.member_key \
             WHERE v.completion = 'complete' \
             AND mc.asset_id IN (SELECT value FROM json_each(?1)) ORDER BY v.id",
        )
        .bind(json_ids(copies)?)
        .fetch_all(&mut *conn)
        .await?;
        ids.iter().map(|id| parse_uuid(id)).collect()
    }

    /// The observation an adopted master was installed with: the kept
    /// library copy its generated source relies on.
    ///
    /// # Errors
    /// `NotFound` for an unknown master.
    pub async fn adopted_master_fingerprint(&self, master: Uuid) -> Result<ObservationFingerprint> {
        let mut conn = self.reader().await?;
        let fingerprint: String =
            sqlx::query_scalar("SELECT fingerprint FROM adopted_masters WHERE id = ?1")
                .bind(master.to_string())
                .fetch_optional(&mut *conn)
                .await?
                .ok_or_else(|| LibraryError::NotFound(format!("adopted master {master}")))?;
        from_json(&fingerprint)
    }
}
