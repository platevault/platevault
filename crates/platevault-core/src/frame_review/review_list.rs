// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Review lists for session-intake frame review (spec 067 PIX-FR-14/16/18;
//! D-W78, D-W97, D-W100). A session list contains its live logical captures,
//! with library quality and no run/project-only membership decisions.

use std::cmp::Ordering;

use persistence_library::{ReviewCapture, SessionReviewBasis};
use uuid::Uuid;

use super::FrameReview;
use crate::import::{classify, naming_metadata};
use crate::library::{InventoryProbe, Library};
use crate::{
    Asset, DisplayName, LibraryError, NameTemplate, NamingFrameType, NativePath, QualityLabel,
    ReviewContext, ReviewCounts, ReviewDecision, ReviewFilter, ReviewFrame, ReviewList, ReviewMark,
    ReviewMarked, ReviewSort, ReviewSortKey, Revision, SortDirection,
};

/// A session-intake review list; unlike run-era lists it has no draft membership.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionReviewList {
    pub session_id: Uuid,
    pub grouping_revision: Revision,
    pub filter: ReviewFilter,
    pub counts: ReviewCounts,
    pub frames: Vec<ReviewFrame>,
}

impl FrameReview {
    /// The context's frames `filter` and the Panel filter `panel` admit,
    /// ordered by `sort` and named by `names`, with per-label counts over the
    /// admitted frames. This remains a legacy view-context read; session intake
    /// uses [`Self::session_review_list`].
    ///
    /// # Errors
    /// `NotFound` for an unknown run, run group or Project; `InvalidInput` for
    /// a trashed run, a panel filter naming no listed panel or invalid asset;
    /// `PersistenceFailure` for an unreadable catalog.
    pub async fn review_list(
        &self,
        context: ReviewContext,
        filter: ReviewFilter,
        panel: Option<Uuid>,
        sort: &ReviewSort,
        names: &NameTemplate,
    ) -> Result<ReviewList, LibraryError> {
        let mut basis = self.shared.catalog.review_basis(context).await?;
        if let Some(panel) = panel {
            if !basis.panels.iter().any(|run| run.panel_id == panel) {
                return Err(LibraryError::InvalidInput(format!(
                    "panel {panel} has no panel run in this review"
                )));
            }
            basis.captures.retain(|capture| capture.panel.is_some_and(|p| p.panel_id == panel));
        }
        let ids: Vec<Uuid> = basis.captures.iter().map(|capture| capture.asset.id).collect();
        let states = self.shared.frame_states(&ids).await?;
        let mut counts = ReviewCounts::default();
        let mut frames = Vec::with_capacity(ids.len());
        for (capture, state) in basis.captures.into_iter().zip(states) {
            let label = QualityLabel::of(&capture.quality, capture.project_rejected);
            counts.count(label);
            if !filter.admits(label) {
                continue;
            }
            let ReviewCapture {
                asset,
                path,
                session_id,
                quality,
                project,
                other_copies,
                member,
                panel: frame_panel,
                ..
            } = capture;
            let display = display_name(&asset, path, names)?;
            frames.push(ReviewFrame {
                asset,
                session_id,
                display,
                label,
                quality,
                project,
                other_copies,
                member,
                panel: frame_panel,
                state,
            });
        }
        sort_frames(&mut frames, *sort);
        Ok(ReviewList {
            context,
            project_id: basis.project_id,
            run: basis.run,
            panels: basis.panels,
            filter,
            panel_filter: panel,
            counts,
            frames,
        })
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
        let basis = self.shared.catalog.session_review_basis(session_id).await?;
        session_list(self, basis, filter, sort, names).await
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

    /// Apply a durable library-quality mark. Session review is per intake and
    /// never writes the obsolete run-era review draft or Project-only reject.
    ///
    /// # Errors
    /// `InvalidInput` for a trashed run or Project-only mark, `NotFound` for an
    /// unknown run or group, and source/persistence errors from the catalog.
    pub async fn review_mark(
        &self,
        context: ReviewContext,
        mark: &ReviewMark,
    ) -> Result<ReviewMarked, LibraryError> {
        match context {
            ReviewContext::Run { view_id } => {
                let view = self.shared.catalog.view(view_id).await?;
                if view.view.trashed_at.is_some() {
                    return Err(LibraryError::InvalidInput(format!(
                        "run {view_id} is in the Project's Trash and has no Review step"
                    )));
                }
            }
            ReviewContext::ViewGroup { group_id } => {
                let asset = library_mark_asset(mark)?;
                self.shared.catalog.review_group_run(group_id, asset).await?;
            }
            ReviewContext::ProjectCandidates { .. } => {}
        }
        self.decide_library(mark).await
    }

    /// Write a library-quality mark for a frame in the session's intake Review.
    /// This durable source decision never edits run-era membership drafts.
    ///
    /// # Errors
    /// `NotFound` for an unknown session; `InvalidInput` when the mark is not a
    /// library-quality mark or the asset is not a live frame in the session;
    /// source identity and persistence errors propagate from the catalog.
    pub async fn session_review_mark(
        &self,
        session_id: Uuid,
        mark: &ReviewMark,
    ) -> Result<ReviewMarked, LibraryError> {
        let ReviewMark::Library { asset, quality } = mark else {
            return Err(LibraryError::InvalidInput(
                "session review marks library quality only".into(),
            ));
        };
        let session = self.shared.catalog.session(session_id).await?;
        if !session.assets.iter().any(|candidate| candidate.id == asset.asset_id) {
            return Err(LibraryError::InvalidInput(format!(
                "asset {} is not a live frame of session {session_id}",
                asset.asset_id
            )));
        }
        let decided = self
            .shared
            .catalog
            .set_quality(std::slice::from_ref(asset), *quality, InventoryProbe::default())
            .await?
            .pop()
            .ok_or_else(|| {
                LibraryError::PersistenceFailure(
                    "the session review decision was not read back".into(),
                )
            })?;
        Ok(ReviewMarked {
            decision: ReviewDecision::Library { asset: Box::new(decided) },
            member: None,
            draft_revision: None,
        })
    }

    async fn decide_library(&self, mark: &ReviewMark) -> Result<ReviewMarked, LibraryError> {
        let ReviewMark::Library { asset, quality } = mark else {
            return Err(LibraryError::InvalidInput(
                "frame review writes library quality only".into(),
            ));
        };
        let decided = self
            .shared
            .catalog
            .set_quality(std::slice::from_ref(asset), *quality, InventoryProbe::default())
            .await?
            .pop()
            .ok_or_else(|| {
                LibraryError::PersistenceFailure("the decision was not read back".into())
            })?;
        Ok(ReviewMarked {
            decision: ReviewDecision::Library { asset: Box::new(decided) },
            member: None,
            draft_revision: None,
        })
    }
}

fn library_mark_asset(mark: &ReviewMark) -> Result<Uuid, LibraryError> {
    match mark {
        ReviewMark::Library { asset, .. } => Ok(asset.asset_id),
        ReviewMark::Project { .. } => {
            Err(LibraryError::InvalidInput("frame review marks library quality only".into()))
        }
    }
}
pub(super) async fn session_list(
    review: &FrameReview,
    basis: SessionReviewBasis,
    filter: ReviewFilter,
    sort: &ReviewSort,
    names: &NameTemplate,
) -> Result<SessionReviewList, LibraryError> {
    let ids: Vec<Uuid> = basis.captures.iter().map(|capture| capture.asset.id).collect();
    let states = review.shared.frame_states(&ids).await?;
    let mut counts = ReviewCounts::default();
    let mut frames = Vec::with_capacity(ids.len());
    for (capture, state) in basis.captures.into_iter().zip(states) {
        let label = QualityLabel::of(&capture.quality, false);
        counts.count(label);
        if !filter.admits(label) {
            continue;
        }
        let display = display_name(&capture.asset, capture.path, names)?;
        frames.push(ReviewFrame {
            asset: capture.asset,
            session_id: basis.session_id,
            display,
            label,
            quality: capture.quality,
            project: crate::ProjectDecision::default(),
            other_copies: capture.other_copies,
            member: None,
            panel: None,
            state,
        });
    }
    sort_frames(&mut frames, *sort);
    Ok(SessionReviewList {
        session_id: basis.session_id,
        grouping_revision: basis.grouping_revision,
        filter,
        counts,
        frames,
    })
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
            ReviewSortKey::Panel => present(
                a.panel.map(|panel| panel.number),
                b.panel.map(|panel| panel.number),
                direction,
                Ord::cmp,
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
