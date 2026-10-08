// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Frame review thumbnails (spec 067 PIX-FR-12, D-W40). A thumbnail cached for
//! a frame's current observation and recorded digest is served from the
//! catalog without reading the source. Any other frame reads Pending while the
//! PIX decoder decodes plane 0 through a verified contained read and renders
//! it under the auto display stretch. Decoding never starts, joins or feeds
//! measurement, and writes nothing but the thumbnail cache.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex, MutexGuard, PoisonError};

use base64::Engine as _;
use persistence_library::{Catalog, ContainedRead, StoredThumbnail, ThumbnailBasis};
use platevault_pixels as px;
use platevault_pixels::display;
use tokio::sync::Semaphore;
use uuid::Uuid;

use super::{applied_stretch, container_of, now, pixel_error, FrameReview, BASE64};
use crate::library::{blocking, InventoryProbe};
use crate::{
    availability_reason, reasons, Availability, FrameThumbnail, LibraryError,
    ObservationFingerprint, PreviewTile, ThumbnailEntry, ThumbnailState,
};

/// Thumbnails decoded at once; each holds one decoded frame in memory.
const THUMBNAIL_DECODES: usize = 2;

/// Background thumbnail decodes and the failures they left.
pub(super) struct ThumbnailWork {
    decodes: Arc<Semaphore>,
    jobs: StdMutex<Jobs>,
    /// Set when frame review is dropped; decoding stops at its next checkpoint.
    stopped: AtomicBool,
}

#[derive(Default)]
struct Jobs {
    in_flight: HashSet<Uuid>,
    /// The last failed decode per asset, kept while the asset's recorded
    /// observation is the one it failed under.
    failed: HashMap<Uuid, Failure>,
}

struct Failure {
    fingerprint: ObservationFingerprint,
    reason: String,
    message: String,
}

impl Default for ThumbnailWork {
    fn default() -> Self {
        Self {
            decodes: Arc::new(Semaphore::new(THUMBNAIL_DECODES)),
            jobs: StdMutex::default(),
            stopped: AtomicBool::new(false),
        }
    }
}

impl ThumbnailWork {
    pub(super) fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
    }

    fn jobs(&self) -> MutexGuard<'_, Jobs> {
        self.jobs.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The entry for one asset; queues a decode when none is current.
    fn entry(&self, basis: ThumbnailBasis, queue: &mut Vec<Decode>) -> ThumbnailEntry {
        let ThumbnailBasis { asset, thumbnail } = basis;
        let asset_id = asset.id;
        let unavailable = |availability| ThumbnailState::Unavailable {
            reason: availability_reason(availability).into(),
        };
        let state = if matches!(asset.availability, Availability::Retired | Availability::Trashed) {
            unavailable(asset.availability)
        } else if let Some(stored) = thumbnail {
            ThumbnailState::Ready { thumbnail: Box::new(frame_thumbnail(stored)) }
        } else if asset.availability != Availability::Available {
            unavailable(asset.availability)
        } else if let Some(container) = container_of(asset.format) {
            let (state, queued) = self.claim(asset_id, &asset.fingerprint);
            if queued {
                queue.push(Decode { asset_id, container, recorded: asset.fingerprint });
            }
            state
        } else {
            ThumbnailState::Unreadable {
                reason: reasons::UNSUPPORTED_FORMAT.into(),
                message: format!("asset {asset_id} is not FITS or XISF"),
            }
        };
        ThumbnailEntry { asset_id, state }
    }

    /// Unreadable while the last failure was under `recorded`; otherwise
    /// Pending, with whether this request starts the asset's decode.
    fn claim(&self, asset_id: Uuid, recorded: &ObservationFingerprint) -> (ThumbnailState, bool) {
        let mut jobs = self.jobs();
        if let Some(failure) =
            jobs.failed.get(&asset_id).filter(|failure| failure.fingerprint == *recorded)
        {
            let state = ThumbnailState::Unreadable {
                reason: failure.reason.clone(),
                message: failure.message.clone(),
            };
            drop(jobs);
            return (state, false);
        }
        let queued = jobs.in_flight.insert(asset_id);
        drop(jobs);
        (ThumbnailState::Pending, queued)
    }

    /// Clear the decode; remember a failure under the observation it was
    /// requested for. A canceled decode leaves nothing behind.
    fn settle(&self, decode: &Decode, outcome: Result<(), LibraryError>) {
        let mut jobs = self.jobs();
        jobs.in_flight.remove(&decode.asset_id);
        match outcome {
            Ok(()) => {
                jobs.failed.remove(&decode.asset_id);
            }
            Err(LibraryError::Canceled) => {}
            Err(error) => {
                let response = error.response(Some(decode.asset_id), None);
                jobs.failed.insert(
                    decode.asset_id,
                    Failure {
                        fingerprint: decode.recorded.clone(),
                        reason: response.kind,
                        message: response.message,
                    },
                );
            }
        }
    }
}

/// One queued decode.
struct Decode {
    asset_id: Uuid,
    container: px::Container,
    /// The asset's recorded observation when it was queued.
    recorded: ObservationFingerprint,
}

impl FrameReview {
    /// One thumbnail state per asset in request order (PIX-FR-12). A thumbnail
    /// cached for the frame's current observation and recorded digest reads
    /// Ready without reading the source, so a frame whose bytes changed under
    /// a new observation or a new recorded digest decodes again. Other frames
    /// read Pending while they decode in the background; the next request
    /// reads them Ready, or Unreadable with the failure until the frame's
    /// observation changes. Retired and Trashed frames, and unavailable copies
    /// without a cached thumbnail, read Unavailable. No measurement run starts
    /// and no record other than the thumbnail cache changes.
    ///
    /// # Errors
    /// `InvalidInput` for an asset listed twice; `NotFound` for an unknown
    /// asset; `PersistenceFailure` for an unreadable catalog.
    pub async fn thumbnails(&self, assets: &[Uuid]) -> Result<Vec<ThumbnailEntry>, LibraryError> {
        let bases = self.shared.catalog.thumbnail_bases(assets).await?;
        let mut queue = Vec::new();
        let entries =
            bases.into_iter().map(|basis| self.thumbnails.entry(basis, &mut queue)).collect();
        for decode in queue {
            let work = Arc::clone(&self.thumbnails);
            let catalog = Arc::clone(&self.shared.catalog);
            tokio::spawn(async move {
                let outcome = decode_thumbnail(&work, &catalog, &decode).await;
                work.settle(&decode, outcome);
            });
        }
        Ok(entries)
    }
}

/// Decode plane 0 through a verified contained read, render it and cache it,
/// unless the asset already holds a current thumbnail.
async fn decode_thumbnail(
    work: &Arc<ThumbnailWork>,
    catalog: &Catalog,
    decode: &Decode,
) -> Result<(), LibraryError> {
    let _permit =
        Arc::clone(&work.decodes).acquire_owned().await.map_err(|_| LibraryError::Canceled)?;
    if work.stopped.load(Ordering::Acquire) {
        return Err(LibraryError::Canceled);
    }
    // The request that queued this decode read the catalog before it claimed
    // the asset, so a decode that settled in between may already have stored
    // the current thumbnail. Re-read under the claim: a frame and digest are
    // decoded once.
    let bases = catalog.thumbnail_bases(&[decode.asset_id]).await?;
    if bases.iter().any(|basis| basis.thumbnail.is_some()) {
        return Ok(());
    }
    let container = decode.container;
    let canceled = Arc::clone(work);
    let read = catalog
        .open_contained(decode.asset_id, InventoryProbe, move |reader| {
            px::decode::decode(container, reader, &canceled.stopped).map_err(pixel_error)
        })
        .await?;
    let ContainedRead { value: image, sha256, fingerprint, .. } = read;
    let tile = blocking(move || {
        let plane = image
            .planes
            .first()
            .ok_or_else(|| LibraryError::MetadataUnreadable("the image has no plane".into()))?;
        let statistics = display::statistics(plane);
        display::render_thumbnail(plane, &statistics, &display::Stretch::Auto).map_err(pixel_error)
    })
    .await?;
    let thumbnail = StoredThumbnail {
        asset_id: decode.asset_id,
        sha256,
        fingerprint,
        stretch: applied_stretch(tile.applied),
        plane: 0,
        level: tile.level,
        width: tile.region.width,
        height: tile.region.height,
        gray: tile.gray,
        mask: tile.mask,
        decoded_at: now()?,
    };
    // A source that changed after the read stores nothing; the next request
    // queues a decode of the bytes the catalog then records.
    catalog.store_thumbnail(&thumbnail).await?;
    Ok(())
}

fn frame_thumbnail(stored: StoredThumbnail) -> FrameThumbnail {
    FrameThumbnail {
        asset_id: stored.asset_id,
        sha256: stored.sha256,
        fingerprint: stored.fingerprint,
        image: PreviewTile {
            plane: stored.plane,
            level: stored.level,
            x: 0,
            y: 0,
            width: stored.width,
            height: stored.height,
            applied_stretch: stored.stretch,
            gray: BASE64.encode(&stored.gray),
            mask: stored.mask.map(|mask| BASE64.encode(mask)),
        },
        decoded_at: stored.decoded_at,
    }
}
