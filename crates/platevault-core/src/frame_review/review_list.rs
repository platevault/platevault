// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Review lists (spec 067 PIX-FR-14, PIX-FR-16, PIX-FR-17, PIX-FR-18, D-W41,
//! D-W42, D-W43, D-W54). Review frames opens on a run's Review step, on a run
//! group's Review all or on a Project's candidate sessions; each lists the
//! context's live logical captures with two-level labels, filtered and
//! sorted, and every Trashed frame is left out of the list and its counts.
//! Review all spans every panel run with a Panel column and a Panel filter.
//! Names render through the naming resolver and rename nothing. A mark
//! routes through the run's Review step transaction while the run is open,
//! and otherwise writes the library or Project-only decision alone; a Review
//! all mark routes as its frame's panel run's Review step would. Listing
//! reads no source and starts no measurement.

use std::cmp::Ordering;

use persistence_library::ReviewCapture;
use uuid::Uuid;

use super::FrameReview;
use crate::import::{classify, naming_metadata};
use crate::library::{InventoryProbe, Library};
use crate::{
    Asset, DisplayName, LibraryError, NameTemplate, NamingFrameType, NativePath, QualityLabel,
    ReviewContext, ReviewCounts, ReviewDecision, ReviewFilter, ReviewFrame, ReviewList, ReviewMark,
    ReviewMarked, ReviewSort, ReviewSortKey, Revision, RunCompletion, SortDirection,
};

impl FrameReview {
    /// The context's frames `filter` and the Panel filter `panel` admit,
    /// ordered by `sort` and named by `names`, with per-label counts over the
    /// frames the Panel filter admits. A run lists its open draft's members,
    /// else its latest committed revision's; a run group lists each panel
    /// run's frames that way, each with its panel; a Project lists its
    /// candidate sessions' frames. Labels read the capture's library quality
    /// first and then the listed Project's rejection. Trashed frames are
    /// never listed or counted. Starts no measurement and writes nothing.
    ///
    /// # Errors
    /// `NotFound` for an unknown run, run group or Project; `InvalidInput`
    /// for a run in the Project's Trash, a Panel filter naming no listed
    /// panel run's panel, or a display template the naming resolver refuses;
    /// `PersistenceFailure`.
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

    /// Each frame's name under `names`, in request order, with its absolute
    /// path. The file name is the default; a token template resolves each
    /// frame's metadata with the naming resolver's fallbacks. Display only:
    /// no file and no record changes.
    ///
    /// # Errors
    /// `InvalidInput` for an asset listed twice, a Trashed frame or a
    /// template the naming resolver refuses; `NotFound` for an unknown asset.
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

    /// Apply one P, X, U, Reject for this Project only or Clear Project
    /// reject. In an open run the run's Review step writes the decision and
    /// moves the frame's draft member in one transaction (D-W54), against
    /// `expected_draft` (0 starts a draft). Otherwise the library decision
    /// (`library_set_quality`) or the Project-only decision of the context's
    /// Project (`project_set_rejection`) is written alone, and a Complete
    /// run's fixed membership stays. In a run group's Review all the mark
    /// routes through the panel run whose membership holds the frame, against
    /// that run's draft revision, so only that frame's decision and that panel
    /// run's member change (PIX-FR-17).
    ///
    /// # Errors
    /// As the route's write: `Conflict` for a stale draft, asset or Project
    /// decision; `InvalidInput` for a run in the Trash, a frame that is no
    /// member, a Review all frame no single panel run holds, or a Retired or
    /// Trashed copy; `NotFound` for an unknown run, run group, Project or
    /// asset; source access errors and `IdentityConflict` when a P or X mark
    /// hashes the source.
    pub async fn review_mark(
        &self,
        context: ReviewContext,
        expected_draft: Revision,
        mark: &ReviewMark,
    ) -> Result<ReviewMarked, LibraryError> {
        let catalog = &self.shared.catalog;
        let view_id = match context {
            ReviewContext::Run { view_id } => view_id,
            ReviewContext::ViewGroup { group_id } => {
                let asset = match mark {
                    ReviewMark::Library { asset, .. } => asset.asset_id,
                    ReviewMark::Project { mark } => mark.asset_id,
                };
                catalog.review_group_run(group_id, asset).await?
            }
            ReviewContext::ProjectCandidates { project_id } => {
                return self.decide(project_id, mark).await;
            }
        };
        let record = catalog.view(view_id).await?;
        // A run in the Trash takes the Review step route, which refuses it.
        if record.view.completion == RunCompletion::Open || record.view.trashed_at.is_some() {
            let outcome =
                catalog.view_review_mark(view_id, expected_draft, mark, InventoryProbe).await?;
            return Ok(ReviewMarked {
                decision: outcome.decision,
                member: Some(outcome.member),
                draft_revision: outcome.record.draft.map(|draft| draft.draft_revision),
            });
        }
        self.decide(record.view.project_id, mark).await
    }

    /// Write the mark's library decision, or its Project-only decision in
    /// `project`, alone.
    async fn decide(&self, project: Uuid, mark: &ReviewMark) -> Result<ReviewMarked, LibraryError> {
        let catalog = &self.shared.catalog;
        let missing = || LibraryError::PersistenceFailure("the decision was not read back".into());
        let decision = match mark {
            ReviewMark::Library { asset, quality } => {
                let decided = catalog
                    .set_quality(std::slice::from_ref(asset), *quality, InventoryProbe)
                    .await?
                    .pop()
                    .ok_or_else(missing)?;
                ReviewDecision::Library { asset: Box::new(decided) }
            }
            ReviewMark::Project { mark } => {
                let rejection = catalog
                    .set_project_rejection(project, std::slice::from_ref(mark))
                    .await?
                    .pop()
                    .ok_or_else(missing)?;
                ReviewDecision::Project { rejection }
            }
        };
        Ok(ReviewMarked { decision, member: None, draft_revision: None })
    }
}

/// The frame's displayed name under `names`.
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
