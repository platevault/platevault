// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Review lists (spec 067 PIX-FR-14/16/18; D-W42, D-W78, D-W97, D-W100): a
//! Project's candidate sessions and a session's own intake list, each the
//! live logical captures with their library quality. Quality is global: a
//! mark is the frame copy's library decision, and a Project leaves frames
//! out through its own frame choices, never through a review label.

use std::cmp::Ordering;

use persistence_library::{ReviewCapture, SessionReviewBasis};
use uuid::Uuid;

use super::FrameReview;
use crate::import::{classify, naming_metadata};
use crate::library::{InventoryProbe, Library};
use crate::{
    Asset, DisplayName, LibraryError, NameTemplate, NamingFrameType, NativePath, QualityLabel,
    ReviewContext, ReviewCounts, ReviewFilter, ReviewFrame, ReviewList, ReviewMark, ReviewMarked,
    ReviewSort, ReviewSortKey, Revision, SortDirection,
};

/// A session's intake review list.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct SessionReviewList {
    pub session_id: Uuid,
    pub grouping_revision: Revision,
    pub filter: ReviewFilter,
    pub counts: ReviewCounts,
    pub frames: Vec<ReviewFrame>,
}

impl FrameReview {
    /// The context's frames `filter` admits, ordered by `sort` and named by
    /// `names`, with per-label counts over the whole context. A session's
    /// own intake list is [`Self::session_review_list`].
    ///
    /// # Errors
    /// `NotFound` for an unknown Project; `InvalidInput` for an invalid
    /// display template; `PersistenceFailure` for an unreadable catalog.
    pub async fn review_list(
        &self,
        context: ReviewContext,
        filter: ReviewFilter,
        sort: &ReviewSort,
        names: &NameTemplate,
    ) -> Result<ReviewList, LibraryError> {
        let basis = self.shared.catalog.review_basis(context).await?;
        let (counts, frames) = listed(self, basis.captures, filter, sort, names).await?;
        Ok(ReviewList { context, project_id: basis.project_id, filter, counts, frames })
    }

    /// Session intake's live logical captures, filtered and sorted by the same
    /// frame-list rules as other Review surfaces.
    ///
    /// # Errors
    /// `NotFound` for an unknown session; `InvalidInput` for a superseded
    /// session or invalid display template; `PersistenceFailure` for a catalog error.
    pub async fn session_review_list(
        &self,
        session_id: Uuid,
        filter: ReviewFilter,
        sort: &ReviewSort,
        names: &NameTemplate,
    ) -> Result<SessionReviewList, LibraryError> {
        let SessionReviewBasis { session_id, grouping_revision, captures } =
            self.shared.catalog.session_review_basis(session_id).await?;
        let (counts, frames) = listed(self, captures, filter, sort, names).await?;
        Ok(SessionReviewList { session_id, grouping_revision, filter, counts, frames })
    }

    /// Each frame's name under `names`, in request order, with its absolute
    /// path. Display only: no file and no record changes.
    ///
    /// # Errors
    /// `InvalidInput` for an asset listed twice or a trashed frame; `NotFound`
    /// for an unknown asset; `PersistenceFailure` when the catalog cannot be read.
    pub async fn display_names(
        &self,
        assets: &[Uuid],
        names: &NameTemplate,
    ) -> Result<Vec<DisplayName>, LibraryError> {
        self.shared
            .catalog
            .review_assets(assets)
            .await?
            .into_iter()
            .map(|reviewed| display_name(&reviewed.asset, reviewed.path, names))
            .collect()
    }

    /// Apply a durable library-quality mark from a Project's candidates.
    ///
    /// # Errors
    /// Source identity and persistence errors from the catalog.
    pub async fn review_mark(&self, mark: &ReviewMark) -> Result<ReviewMarked, LibraryError> {
        self.decide_library(mark).await
    }

    /// Write a library-quality mark for a frame in the session's intake Review.
    ///
    /// # Errors
    /// `NotFound` for an unknown session; `InvalidInput` when the asset is not
    /// a live frame in the session; source identity and persistence errors
    /// propagate from the catalog.
    pub async fn session_review_mark(
        &self,
        session_id: Uuid,
        mark: &ReviewMark,
    ) -> Result<ReviewMarked, LibraryError> {
        let session = self.shared.catalog.session(session_id).await?;
        if !session.assets.iter().any(|candidate| candidate.id == mark.asset.asset_id) {
            return Err(LibraryError::InvalidInput(format!(
                "asset {} is not a live frame of session {session_id}",
                mark.asset.asset_id
            )));
        }
        self.decide_library(mark).await
    }

    async fn decide_library(&self, mark: &ReviewMark) -> Result<ReviewMarked, LibraryError> {
        let asset = self
            .shared
            .catalog
            .set_quality(std::slice::from_ref(&mark.asset), mark.quality, InventoryProbe::default())
            .await?
            .pop()
            .ok_or_else(|| {
                LibraryError::PersistenceFailure("the decision was not read back".into())
            })?;
        Ok(ReviewMarked { asset })
    }
}

/// The per-label counts over every capture and the frames `filter` admits,
/// sorted.
async fn listed(
    review: &FrameReview,
    captures: Vec<ReviewCapture>,
    filter: ReviewFilter,
    sort: &ReviewSort,
    names: &NameTemplate,
) -> Result<(ReviewCounts, Vec<ReviewFrame>), LibraryError> {
    let ids: Vec<Uuid> = captures.iter().map(|capture| capture.asset.id).collect();
    let states = review.shared.frame_states(&ids).await?;
    let mut counts = ReviewCounts::default();
    let mut frames = Vec::with_capacity(ids.len());
    for (capture, state) in captures.into_iter().zip(states) {
        let label = QualityLabel::of(&capture.quality);
        counts.count(label);
        if !filter.admits(label) {
            continue;
        }
        let ReviewCapture { asset, path, session_id, quality, other_copies } = capture;
        let display = display_name(&asset, path, names)?;
        frames.push(ReviewFrame {
            asset,
            session_id,
            display,
            label,
            quality,
            other_copies,
            state,
        });
    }
    sort_frames(&mut frames, *sort);
    Ok((counts, frames))
}

fn display_name(
    asset: &Asset,
    path: NativePath,
    names: &NameTemplate,
) -> Result<DisplayName, LibraryError> {
    let (name, fallbacks) = match names {
        NameTemplate::FileName => {
            let relative = asset.relative_path.relative_path()?;
            let name = relative.file_name().map_or_else(
                || asset.relative_path.display(),
                |name| name.to_string_lossy().into_owned(),
            );
            (name, Vec::new())
        }
        NameTemplate::Tokens { template } => {
            let frame_type =
                classify(&asset.effective, &asset.relative_path).unwrap_or(NamingFrameType::Light);
            let metadata = naming_metadata(&asset.effective, frame_type);
            let resolved = Library::preview_naming(frame_type, template, Some(metadata))?;
            (resolved.relative_path, resolved.fallbacks)
        }
    };
    Ok(DisplayName { asset_id: asset.id, name, path, fallbacks })
}

/// Order by the sort key, frames without a value last in either direction,
/// then by capture start and asset id.
fn sort_frames(frames: &mut [ReviewFrame], sort: ReviewSort) {
    let direction = sort.direction;
    frames.sort_by(|a, b| {
        let primary = match sort.key {
            ReviewSortKey::Captured => Ordering::Equal,
            ReviewSortKey::Name => {
                present(Some(&a.display.name), Some(&b.display.name), direction, Ord::cmp)
            }
            ReviewSortKey::Label => present(Some(&a.label), Some(&b.label), direction, Ord::cmp),
            ReviewSortKey::Filter => present(
                a.asset.effective.filter.as_ref(),
                b.asset.effective.filter.as_ref(),
                direction,
                Ord::cmp,
            ),
            ReviewSortKey::Exposure => present(
                a.asset.effective.exposure_seconds,
                b.asset.effective.exposure_seconds,
                direction,
                f64::total_cmp,
            ),
            ReviewSortKey::Metric { metric } => {
                let value = |frame: &ReviewFrame| {
                    frame.state.values.iter().find(|value| value.metric == metric)?.value
                };
                present(value(a), value(b), direction, f64::total_cmp)
            }
        };
        let captured_direction =
            if sort.key == ReviewSortKey::Captured { direction } else { SortDirection::Asc };
        primary
            .then_with(|| {
                present(
                    a.asset.effective.date_obs.as_ref(),
                    b.asset.effective.date_obs.as_ref(),
                    captured_direction,
                    Ord::cmp,
                )
            })
            .then_with(|| a.asset.id.cmp(&b.asset.id))
    });
}

/// Present values in `direction`, then absent ones.
fn present<T>(
    a: Option<T>,
    b: Option<T>,
    direction: SortDirection,
    compare: impl Fn(&T, &T) -> Ordering,
) -> Ordering {
    match (a, b) {
        (Some(a), Some(b)) => {
            let ordering = compare(&a, &b);
            if direction == SortDirection::Desc {
                ordering.reverse()
            } else {
                ordering
            }
        }
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}
