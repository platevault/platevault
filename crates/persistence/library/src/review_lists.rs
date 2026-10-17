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
    asset_from_row, json_ids, load_assets, load_location, projects, CaptureView, Catalog, Result,
};

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
