// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Trashed frames (LIB-FR-18, D-W43, D-W52). The storage custody moves a frame to
//! the OS Trash and records it here. The catalog keeps the record, with its
//! identity, digest, last-observed metadata and quality history, in the state
//! Trashed, and every list and total leaves it out through `live_assets`. Each
//! trash is one episode: the operation, the SHA-256 it verified before the move,
//! and the runs that were Complete then, whose fixed membership still shows the
//! frame marked Trashed. The app restores nothing itself; a rescan that finds
//! the recorded path again closes the episode, which stays as history.

use std::collections::BTreeSet;

use platevault_model::{Asset, Availability, LibraryError};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqliteRow;
use sqlx::{Connection, Row, SqliteConnection};
use uuid::Uuid;

use super::{
    from_json, listed_sessions, load_asset, now, parse_uuid, scoped, to_json, Catalog, Members,
    Result, MAX_PAGE,
};

/// One frame the storage custody moved to the OS Trash.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashedFrame {
    pub asset_id: Uuid,
    /// SHA-256 of the bytes the custody verified immediately before the move (D19).
    pub sha256: String,
    /// The runs that were Complete when the frame was trashed (D-W52).
    pub complete_view_ids: Vec<Uuid>,
}

/// One stay of a frame in the OS Trash.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEpisode {
    pub asset_id: Uuid,
    /// The storage operation that trashed the frame.
    pub storage_operation_id: Uuid,
    pub sha256: String,
    pub trashed_at: String,
    /// The runs that were Complete at trash time, sorted.
    pub complete_view_ids: Vec<Uuid>,
    /// When a rescan found the recorded path again and the record left Trashed.
    pub put_back_at: Option<String>,
}

/// A Trashed frame as the Sessions "Trashed" filter lists it.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashedAsset {
    /// The kept record: identity, digest, last-observed metadata and quality.
    pub asset: Asset,
    pub session_id: Option<Uuid>,
    /// The open episode.
    pub episode: TrashEpisode,
}

/// A page of Trashed frames, newest trash first, optionally of one session.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashedQuery {
    pub session_id: Option<Uuid>,
    pub offset: u32,
    pub limit: u32,
}

impl Catalog {
    /// Record frames the storage operation moved to the OS Trash, all or none.
    /// Each record turns Trashed and opens an episode; nothing reads or moves a
    /// file. Recording a frame its own operation already trashed with the same
    /// digest changes nothing, so a resumed operation can record again.
    ///
    /// # Errors
    /// `InvalidInput` for no frames, a repeated frame, a malformed digest, a copy
    /// of a retired location, or a frame another operation trashed;
    /// `IdentityConflict` when the digest differs from the record's; `NotFound`
    /// for an unknown asset.
    pub async fn record_trashed(
        &self,
        storage_operation_id: Uuid,
        frames: &[TrashedFrame],
    ) -> Result<Vec<TrashedAsset>> {
        let mut seen = BTreeSet::new();
        if frames.is_empty() || !frames.iter().all(|frame| seen.insert(frame.asset_id)) {
            return Err(LibraryError::InvalidInput(
                "trashed frames must be unique and non-empty".into(),
            ));
        }
        if let Some(frame) = frames.iter().find(|frame| !valid_sha256(&frame.sha256)) {
            return Err(LibraryError::InvalidInput(format!(
                "asset {} needs a lowercase hex SHA-256",
                frame.asset_id
            )));
        }
        let recorded = write_txn!(self, |conn| {
            let trashed_at = now()?;
            let mut recorded = Vec::with_capacity(frames.len());
            for frame in frames {
                let asset = load_asset(conn, frame.asset_id).await?;
                if let Some(open) = open_episode(conn, asset.id).await? {
                    if open.storage_operation_id == storage_operation_id
                        && open.sha256 == frame.sha256
                    {
                        let session_id = session_of(conn, asset.id).await?;
                        recorded.push(TrashedAsset { asset, session_id, episode: open });
                        continue;
                    }
                    let reason =
                        format!("is already Trashed by operation {}", open.storage_operation_id);
                    return Err(refused(&asset, &reason));
                }
                match asset.availability {
                    Availability::Trashed => {
                        return Err(refused(&asset, "is already Trashed"));
                    }
                    Availability::Retired => {
                        return Err(refused(&asset, "is a copy of a retired location"));
                    }
                    _ => {}
                }
                if asset.fingerprint.content_sha256.as_ref().is_some_and(|sha| *sha != frame.sha256)
                {
                    return Err(scoped(
                        LibraryError::IdentityConflict(format!(
                            "asset {} was trashed with bytes other than its recorded digest",
                            asset.id
                        )),
                        asset.relative_path.clone(),
                        Some(asset.id),
                    ));
                }
                let mut views = frame.complete_view_ids.clone();
                views.sort_unstable();
                views.dedup();
                sqlx::query(
                    "UPDATE assets SET availability = 'trashed', verification_pending = 0 \
                     WHERE id = ?1",
                )
                .bind(asset.id.to_string())
                .execute(&mut *conn)
                .await?;
                sqlx::query(
                    "INSERT INTO asset_trash_episodes (asset_id, storage_operation_id, sha256, \
                     trashed_at, complete_view_ids) VALUES (?1, ?2, ?3, ?4, ?5)",
                )
                .bind(asset.id.to_string())
                .bind(storage_operation_id.to_string())
                .bind(&frame.sha256)
                .bind(&trashed_at)
                .bind(to_json(&views)?)
                .execute(&mut *conn)
                .await?;
                let episode = TrashEpisode {
                    asset_id: asset.id,
                    storage_operation_id,
                    sha256: frame.sha256.clone(),
                    trashed_at: trashed_at.clone(),
                    complete_view_ids: views,
                    put_back_at: None,
                };
                let session_id = session_of(conn, asset.id).await?;
                let asset = load_asset(conn, asset.id).await?;
                recorded.push(TrashedAsset { asset, session_id, episode });
            }
            recorded
        });
        Ok(recorded)
    }

    /// The Sessions "Trashed" filter's frames: each Trashed frame of a session the
    /// filter lists, with its kept record and open episode, newest trash first.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn trashed_assets(&self, query: &TrashedQuery) -> Result<Vec<TrashedAsset>> {
        let mut conn = self.reader().await?;
        let listed: BTreeSet<Uuid> =
            listed_sessions(&mut conn, false, None, Members::Trashed).await?.into_iter().collect();
        let rows = sqlx::query(
            "SELECT e.*, a.session_id FROM asset_trash_episodes e \
             JOIN assets a ON a.id = e.asset_id \
             WHERE e.put_back_at IS NULL AND a.availability = 'trashed' \
             AND (?1 IS NULL OR a.session_id = ?1) ORDER BY e.trashed_at DESC, e.id DESC",
        )
        .bind(query.session_id.map(|id| id.to_string()))
        .fetch_all(&mut *conn)
        .await?;
        let limit = if query.limit == 0 { MAX_PAGE } else { query.limit.min(MAX_PAGE) };
        let mut page = Vec::new();
        let mut skipped = 0_u32;
        for row in &rows {
            let session_id: Option<String> = row.try_get("session_id")?;
            let session_id = session_id.as_deref().map(parse_uuid).transpose()?;
            if !session_id.is_some_and(|id| listed.contains(&id)) {
                continue;
            }
            if skipped < query.offset {
                skipped += 1;
                continue;
            }
            let episode = episode_from_row(row)?;
            let asset = load_asset(&mut conn, episode.asset_id).await?;
            page.push(TrashedAsset { asset, session_id, episode });
            if page.len() >= usize::try_from(limit).unwrap_or(usize::MAX) {
                break;
            }
        }
        Ok(page)
    }

    /// Every trash episode of one asset, oldest first, closed ones included.
    ///
    /// # Errors
    /// `NotFound` for an unknown asset.
    pub async fn trash_episodes(&self, asset_id: Uuid) -> Result<Vec<TrashEpisode>> {
        let mut conn = self.reader().await?;
        load_asset(&mut conn, asset_id).await?;
        let rows =
            sqlx::query("SELECT * FROM asset_trash_episodes WHERE asset_id = ?1 ORDER BY id")
                .bind(asset_id.to_string())
                .fetch_all(&mut *conn)
                .await?;
        rows.iter().map(episode_from_row).collect()
    }
}

/// The asset's open episode: it is in the OS Trash as far as the catalog knows.
pub async fn open_episode(
    conn: &mut SqliteConnection,
    asset_id: Uuid,
) -> Result<Option<TrashEpisode>> {
    sqlx::query("SELECT * FROM asset_trash_episodes WHERE asset_id = ?1 AND put_back_at IS NULL")
        .bind(asset_id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .as_ref()
        .map(episode_from_row)
        .transpose()
}

/// A rescan found the recorded path again: the record leaves Trashed and its open
/// episode becomes history.
pub async fn close_episode(
    conn: &mut SqliteConnection,
    asset_id: Uuid,
    put_back_at: &str,
) -> Result<()> {
    sqlx::query(
        "UPDATE asset_trash_episodes SET put_back_at = ?1 WHERE asset_id = ?2 \
         AND put_back_at IS NULL",
    )
    .bind(put_back_at)
    .bind(asset_id.to_string())
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn session_of(conn: &mut SqliteConnection, asset_id: Uuid) -> Result<Option<Uuid>> {
    let session: Option<String> = sqlx::query_scalar("SELECT session_id FROM assets WHERE id = ?1")
        .bind(asset_id.to_string())
        .fetch_one(&mut *conn)
        .await?;
    session.as_deref().map(parse_uuid).transpose()
}

fn episode_from_row(row: &SqliteRow) -> Result<TrashEpisode> {
    Ok(TrashEpisode {
        asset_id: parse_uuid(&row.try_get::<String, _>("asset_id")?)?,
        storage_operation_id: parse_uuid(&row.try_get::<String, _>("storage_operation_id")?)?,
        sha256: row.try_get("sha256")?,
        trashed_at: row.try_get("trashed_at")?,
        complete_view_ids: from_json(&row.try_get::<String, _>("complete_view_ids")?)?,
        put_back_at: row.try_get("put_back_at")?,
    })
}

fn refused(asset: &Asset, reason: &str) -> LibraryError {
    scoped(
        LibraryError::InvalidInput(format!("asset {} {reason}", asset.id)),
        asset.relative_path.clone(),
        Some(asset.id),
    )
}

fn valid_sha256(text: &str) -> bool {
    text.len() == 64 && text.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}
