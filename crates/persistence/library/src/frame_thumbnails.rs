// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Frame review thumbnails (spec 067 PIX-FR-12, D-W40) in the library
//! catalog: one cached display-only decode per asset, bound to the SHA-256 of
//! the bytes it was decoded from and the observation they were read under.
//! A thumbnail is current while that observation is the asset's recorded one
//! and, once the catalog records a digest, while the digests agree. Reading
//! thumbnails reads no source; storing one changes no other row.

use std::collections::{BTreeSet, HashMap};

use platevault_model::{AppliedStretch, Asset, Availability, LibraryError, ObservationFingerprint};
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::{
    fingerprint_matches, from_json, json_ids, load_asset, load_assets, parse_uuid, to_json,
    Catalog, Result,
};

/// A decoded thumbnail as the catalog stores it: 8-bit gray values and, when
/// any block is fully masked, its mask codes, row-major.
#[derive(Clone, Debug, PartialEq)]
pub struct StoredThumbnail {
    pub asset_id: Uuid,
    pub sha256: String,
    /// The observation the bytes were read under, with `sha256`.
    pub fingerprint: ObservationFingerprint,
    pub stretch: AppliedStretch,
    pub plane: u32,
    pub level: u8,
    pub width: u32,
    pub height: u32,
    pub gray: Vec<u8>,
    pub mask: Option<Vec<u8>>,
    pub decoded_at: String,
}

/// An asset with its current thumbnail, if one is cached.
#[derive(Clone, Debug)]
pub struct ThumbnailBasis {
    pub asset: Asset,
    pub thumbnail: Option<StoredThumbnail>,
}

impl Catalog {
    /// Each asset in request order with the thumbnail cached for its current
    /// observation and recorded digest, decided in one reader snapshot. A
    /// Retired or Trashed asset has none. Reads no source and writes nothing.
    ///
    /// # Errors
    /// `InvalidInput` for an asset listed twice; `NotFound` for an unknown
    /// asset; `PersistenceFailure` for an unreadable catalog.
    pub async fn thumbnail_bases(&self, assets: &[Uuid]) -> Result<Vec<ThumbnailBasis>> {
        let mut ids = BTreeSet::new();
        if let Some(twice) = assets.iter().find(|id| !ids.insert(**id)) {
            return Err(LibraryError::InvalidInput(format!("asset {twice} is listed twice")));
        }
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let loaded = load_assets(&mut snapshot, &ids).await?;
        let rows = sqlx::query(
            "SELECT * FROM frame_thumbnails WHERE asset_id IN (SELECT value FROM json_each(?1))",
        )
        .bind(json_ids(&ids)?)
        .fetch_all(&mut *snapshot)
        .await?;
        snapshot.rollback().await?;
        drop(conn);
        let mut cached: HashMap<Uuid, Vec<StoredThumbnail>> = HashMap::new();
        for row in &rows {
            let thumbnail = thumbnail_from_row(row)?;
            cached.entry(thumbnail.asset_id).or_default().push(thumbnail);
        }
        let mut by_id: HashMap<Uuid, Asset> =
            loaded.into_iter().map(|asset| (asset.id, asset)).collect();
        Ok(assets
            .iter()
            .filter_map(|id| by_id.remove(id))
            .map(|asset| {
                let thumbnail = cached
                    .remove(&asset.id)
                    .and_then(|stored| stored.into_iter().find(|stored| current(&asset, stored)));
                ThumbnailBasis { asset, thumbnail }
            })
            .collect())
    }

    /// Store a thumbnail and drop the asset's other thumbnails in one commit,
    /// when the observation it was decoded under is still the asset's current
    /// one and the asset is neither Retired nor Trashed. Returns whether it was
    /// stored: a source that changed after it was read stores nothing.
    ///
    /// # Errors
    /// `NotFound` for an unknown asset; `PersistenceFailure`.
    pub async fn store_thumbnail(&self, thumbnail: &StoredThumbnail) -> Result<bool> {
        let fingerprint = to_json(&thumbnail.fingerprint)?;
        let stretch = to_json(&thumbnail.stretch)?;
        let stored = write_txn!(self, |conn| {
            let asset = load_asset(conn, thumbnail.asset_id).await?;
            if current(&asset, thumbnail) {
                let asset_id = thumbnail.asset_id.to_string();
                sqlx::query("DELETE FROM frame_thumbnails WHERE asset_id = ?1 AND sha256 <> ?2")
                    .bind(&asset_id)
                    .bind(&thumbnail.sha256)
                    .execute(&mut *conn)
                    .await?;
                sqlx::query(
                    "INSERT OR REPLACE INTO frame_thumbnails (asset_id, sha256, fingerprint, \
                     stretch, plane, level, width, height, gray, mask, decoded_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                )
                .bind(&asset_id)
                .bind(&thumbnail.sha256)
                .bind(&fingerprint)
                .bind(&stretch)
                .bind(i64::from(thumbnail.plane))
                .bind(i64::from(thumbnail.level))
                .bind(i64::from(thumbnail.width))
                .bind(i64::from(thumbnail.height))
                .bind(thumbnail.gray.as_slice())
                .bind(thumbnail.mask.as_deref())
                .bind(&thumbnail.decoded_at)
                .execute(&mut *conn)
                .await?;
                true
            } else {
                false
            }
        });
        Ok(stored)
    }
}

/// The thumbnail applies to the asset as recorded now.
fn current(asset: &Asset, thumbnail: &StoredThumbnail) -> bool {
    !matches!(asset.availability, Availability::Retired | Availability::Trashed)
        && fingerprint_matches(&asset.fingerprint, &thumbnail.fingerprint)
}

fn thumbnail_from_row(row: &SqliteRow) -> Result<StoredThumbnail> {
    let number = |column: &str| -> Result<i64> { Ok(row.try_get::<i64, _>(column)?) };
    let out_of_range =
        |column: &str| LibraryError::PersistenceFailure(format!("thumbnail {column} out of range"));
    Ok(StoredThumbnail {
        asset_id: parse_uuid(&row.try_get::<String, _>("asset_id")?)?,
        sha256: row.try_get("sha256")?,
        fingerprint: from_json(&row.try_get::<String, _>("fingerprint")?)?,
        stretch: from_json(&row.try_get::<String, _>("stretch")?)?,
        plane: u32::try_from(number("plane")?).map_err(|_| out_of_range("plane"))?,
        level: u8::try_from(number("level")?).map_err(|_| out_of_range("level"))?,
        width: u32::try_from(number("width")?).map_err(|_| out_of_range("width"))?,
        height: u32::try_from(number("height")?).map_err(|_| out_of_range("height"))?,
        gray: row.try_get("gray")?,
        mask: row.try_get("mask")?,
        decoded_at: row.try_get("decoded_at")?,
    })
}
