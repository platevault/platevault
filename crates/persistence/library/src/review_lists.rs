// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Frame review lists (spec 067 PIX-FR-14, PIX-FR-17, PIX-FR-18): the logical
//! captures (D16) of a Project's candidate sessions, read in one catalog
//! snapshot. Each capture comes with the copy it is reviewed through and its
//! applicable quality; quality is the library's only (D-W79). Trashed copies
//! are never listed, so a capture whose copies are all Trashed is left out.
//! Reads no source and writes nothing.

use std::collections::hash_map::Entry;
use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;

use platevault_model::{
    ApplicableQuality, Asset, Availability, LibraryError, NativePath, ReviewContext,
};
use sqlx::sqlite::SqliteConnection;
use sqlx::Connection;
use uuid::Uuid;

use super::{
    asset_from_row, json_ids, load_assets, load_location, parse_uuid, path_from_key, projects,
    CaptureView, Catalog, Result,
};
use sqlx::Row;

/// One logical capture of a review context, outside the Trash.
#[derive(Clone, Debug)]
pub struct ReviewCapture {
    /// The copy the capture is reviewed and marked through: the copy whose
    /// library decision applies, else an Available copy, else the smallest id.
    pub asset: Asset,
    /// The copy's absolute path.
    pub path: NativePath,
    pub session_id: Uuid,
    /// The capture's applicable quality over its copies outside the Trash.
    pub quality: ApplicableQuality,
    pub other_copies: Vec<Uuid>,
}

/// A review context's Project and its live captures.
#[derive(Clone, Debug)]
pub struct ReviewBasis {
    pub project_id: Uuid,
    pub captures: Vec<ReviewCapture>,
}

/// An asset outside the Trash with its absolute path.
#[derive(Clone, Debug)]
pub struct ReviewAsset {
    pub asset: Asset,
    pub path: NativePath,
}

/// An asset with its location root, read together for correction-entry checks.
#[derive(Clone, Debug)]
pub struct CorrectionEntryAsset {
    pub asset: Asset,
    pub root: Option<PathBuf>,
}

#[cfg(feature = "test-counters")]
thread_local! {
    static CORRECTION_ENTRY_BATCH_READS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

impl Catalog {
    #[cfg(feature = "test-counters")]
    fn count_correction_entry_batch_read() {
        CORRECTION_ENTRY_BATCH_READS.with(|reads| reads.set(reads.get() + 1));
    }

    /// Each requested asset, in request order, with its registered location root,
    /// read in one catalog snapshot. Unrepresentable roots are absent. Unknown
    /// assets are omitted so the correction transaction preserves its error order.
    ///
    /// # Errors
    /// `InvalidInput` for an asset listed twice; `PersistenceFailure` when the
    /// catalog cannot be read.
    pub async fn correction_entry_assets(&self, ids: &[Uuid]) -> Result<Vec<CorrectionEntryAsset>> {
        #[cfg(feature = "test-counters")]
        Self::count_correction_entry_batch_read();
        let mut unique = BTreeSet::new();
        if let Some(twice) = ids.iter().find(|id| !unique.insert(**id)) {
            return Err(LibraryError::InvalidInput(format!("asset {twice} is listed twice")));
        }
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let rows = sqlx::query(asset_sql!(
            "WHERE a.id IN (SELECT value FROM json_each(?1)) ORDER BY a.id"
        ))
        .bind(json_ids(&unique)?)
        .fetch_all(&mut *snapshot)
        .await?;
        let assets: Vec<Asset> = rows.iter().map(asset_from_row).collect::<Result<_>>()?;
        let location_ids: BTreeSet<Uuid> = assets.iter().map(|asset| asset.location_id).collect();
        let locations = sqlx::query(
            "SELECT id, path_key FROM locations \
             WHERE id IN (SELECT value FROM json_each(?1))",
        )
        .bind(json_ids(&location_ids)?)
        .fetch_all(&mut *snapshot)
        .await?;
        let mut roots = HashMap::with_capacity(locations.len());
        for row in &locations {
            let id = parse_uuid(&row.try_get::<String, _>("id")?)?;
            let path = path_from_key(&row.try_get::<Vec<u8>, _>("path_key")?)?.to_path_buf().ok();
            roots.insert(id, path);
        }
        snapshot.rollback().await?;
        let by_id: HashMap<Uuid, Asset> = assets.into_iter().map(|asset| (asset.id, asset)).collect();
        ids.iter()
            .filter_map(|id| by_id.get(id).map(|asset| (id, asset)))
            .map(|(_, asset)| {
                let root = roots.get(&asset.location_id)
                    .ok_or_else(|| LibraryError::NotFound(format!("location {}", asset.location_id)))?;
                Ok(CorrectionEntryAsset { asset: asset.clone(), root: root.clone() })
            })
            .collect()
    }
}

#[cfg(feature = "test-counters")]
impl Catalog {
    pub fn correction_entry_batch_reads_for_test() -> usize {
        CORRECTION_ENTRY_BATCH_READS.with(std::cell::Cell::get)
    }
    pub fn reset_correction_entry_batch_reads_for_test() {
        CORRECTION_ENTRY_BATCH_READS.with(|reads| reads.set(0));
    }

}
#[cfg(all(test, feature = "test-counters"))]
mod tests {
    use super::*;
    use platevault_model::{CaptureKey, CaptureMetadata, FileIdentity, GroupingResult, ImageFormat,
        LocationRole, ObservationFingerprint, PathSensitivity, ScanBatch, ScanFile, SessionCandidate,
        VolumeIdentity, VolumeKind};
    use crate::LocationRegistration;
    use std::path::Path;

    #[tokio::test]
    async fn correction_entry_assets_loads_all_frames_in_one_batch() {
        let dir = tempfile::tempdir().unwrap();
        let catalog = Catalog::open(&dir.path().join("catalog.sqlite")).await.unwrap();
        let root = dir.path().join("captures");
        std::fs::create_dir(&root).unwrap();
        let identity = FileIdentity {
            volume: VolumeIdentity { filesystem: "apfs".into(), stable_id: Some("test-volume".into()),
                file_ids_stable: false, case: PathSensitivity::Sensitive,
                normalization: PathSensitivity::Sensitive }, file_id: None,
        };
        let location = catalog.register_location(&LocationRegistration {
            name: "captures".into(), path: NativePath::from_path(&root),
            role: LocationRole::Captures, identity: identity.clone(), volume_kind: VolumeKind::Local,
        }).await.unwrap();
        let files = ["one.fits", "two.fits"].into_iter().enumerate().map(|(index, name)| ScanFile {
            relative_path: NativePath::from_path(Path::new(name)),
            fingerprint: ObservationFingerprint { identity: identity.clone(), size_bytes: 1,
                modified_ns: index as i128 + 1, content_sha256: None },
            format: ImageFormat::Fits, metadata: CaptureMetadata::default(),
        }).collect();
        let operation = catalog.begin_scan(location.id, None).await.unwrap();
        catalog.apply_scan_batch(operation.id, &identity, &ScanBatch { files, ..ScanBatch::default() },
            |assets: &[Asset]| GroupingResult { sessions: vec![SessionCandidate {
                key: CaptureKey("test".into()), asset_ids: assets.iter().map(|asset| asset.id).collect(),
                provisional: Vec::new(), date_basis: None, framing: None,
            }] }).await.unwrap();
        let assets = catalog.location_assets(location.id).await.unwrap();
        let ids = [assets[1].id, assets[0].id];
        Catalog::reset_correction_entry_batch_reads_for_test();
        let found = catalog.correction_entry_assets(&ids).await.unwrap();
        assert_eq!(Catalog::correction_entry_batch_reads_for_test(), 1);
        assert_eq!(found.iter().map(|entry| entry.asset.id).collect::<Vec<_>>(), ids);
        assert!(found.iter().all(|entry| entry.root.as_deref() == Some(root.as_path())));
        catalog.close().await.unwrap();
    }
}

impl Catalog {
    /// The context's live captures from one catalog snapshot: a Project lists
    /// its candidate sessions' frames.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project; `PersistenceFailure` when the
    /// catalog cannot be read.
    pub async fn review_basis(&self, context: ReviewContext) -> Result<ReviewBasis> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let basis = match context {
            ReviewContext::ProjectCandidates { project_id } => {
                candidates_basis(&mut snapshot, project_id).await?
            }
        };
        snapshot.rollback().await?;
        Ok(basis)
    }

    /// Each asset in request order with its absolute path.
    ///
    /// # Errors
    /// `InvalidInput` for an asset listed twice or a Trashed frame, which
    /// frame review never lists; `NotFound` for an unknown asset.
    pub async fn review_assets(&self, ids: &[Uuid]) -> Result<Vec<ReviewAsset>> {
        let mut unique = BTreeSet::new();
        if let Some(twice) = ids.iter().find(|id| !unique.insert(**id)) {
            return Err(LibraryError::InvalidInput(format!("asset {twice} is listed twice")));
        }
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let assets = load_assets(&mut snapshot, &unique).await?;
        if let Some(trashed) =
            assets.iter().find(|asset| asset.availability == Availability::Trashed)
        {
            return Err(LibraryError::InvalidInput(format!(
                "asset {} is in the Trash and is never listed in frame review",
                trashed.id
            )));
        }
        let mut roots = Roots::new();
        let mut by_id = HashMap::with_capacity(assets.len());
        for asset in assets {
            let path = absolute(&mut snapshot, &mut roots, &asset).await?;
            by_id.insert(asset.id, ReviewAsset { asset, path });
        }
        snapshot.rollback().await?;
        ids.iter()
            .map(|id| by_id.remove(id).ok_or_else(|| LibraryError::NotFound(format!("asset {id}"))))
            .collect()
    }
}

/// Location roots by id, each read once.
pub type Roots = HashMap<Uuid, PathBuf>;

/// The asset's absolute path below its location's root.
pub async fn absolute(
    conn: &mut SqliteConnection,
    roots: &mut Roots,
    asset: &Asset,
) -> Result<NativePath> {
    let root = match roots.entry(asset.location_id) {
        Entry::Occupied(root) => root.into_mut(),
        Entry::Vacant(slot) => {
            slot.insert(load_location(conn, asset.location_id).await?.path.to_path_buf()?)
        }
    };
    Ok(NativePath::from_path(&root.join(asset.relative_path.relative_path()?)))
}

async fn candidates_basis(conn: &mut SqliteConnection, project: Uuid) -> Result<ReviewBasis> {
    projects::require_project(conn, project).await?;
    let candidates = projects::candidates(conn, project).await?;
    let mut session_of: HashMap<Uuid, Uuid> = HashMap::new();
    let mut sessions = BTreeSet::new();
    for candidate in &candidates {
        sessions.insert(candidate.session_id);
        for asset in &candidate.asset_ids {
            session_of.entry(*asset).or_insert(candidate.session_id);
        }
    }
    let sessions: Vec<Uuid> = sessions.into_iter().collect();
    let ids: BTreeSet<Uuid> = session_of.keys().copied().collect();
    let all = live_assets(conn, &ids).await?;
    let captures_of = CaptureView::read(conn, &sessions, &all).await?;
    let mut roots = Roots::new();
    let mut captures = Vec::new();
    for (key, present) in captures_of.group(&all) {
        let Some(asset) = reviewed_copy(&present) else {
            continue;
        };
        captures.push(ReviewCapture {
            path: absolute(conn, &mut roots, asset).await?,
            session_id: session_of[&asset.id],
            quality: captures_of.quality(&key),
            other_copies: present.iter().map(|copy| copy.id).filter(|id| *id != asset.id).collect(),
            asset: asset.clone(),
        });
    }
    Ok(ReviewBasis { project_id: project, captures })
}

/// The copy a capture is reviewed and marked through, so a mark updates the
/// decision that speaks for the capture instead of conflicting with it: a
/// decided copy first, then an Available one, then the smallest id.
pub fn reviewed_copy<'a>(copies: &[&'a Asset]) -> Option<&'a Asset> {
    copies.iter().copied().min_by_key(|copy| {
        let decided = matches!(
            copy.applicable_quality(),
            ApplicableQuality::Usable
                | ApplicableQuality::Unusable
                | ApplicableQuality::VerificationPending { .. }
        );
        (!decided, copy.availability != Availability::Available, copy.id)
    })
}

/// The assets of `ids` outside the Trash, in id order.
pub async fn live_assets(conn: &mut SqliteConnection, ids: &BTreeSet<Uuid>) -> Result<Vec<Asset>> {
    let query = asset_sql!(live "WHERE a.id IN (SELECT value FROM json_each(?1)) ORDER BY a.id");
    let rows = sqlx::query(query).bind(json_ids(ids)?).fetch_all(&mut *conn).await?;
    rows.iter().map(asset_from_row).collect()
}
