// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Issues on the rows they affect (spec 063 FR-032, 064 LIB-FR-17/22, 065
//! PRJ-FR-17, D-W92, D-W144, D-W150, D-W158) on the [`Library`] facade,
//! composed from each feature's own reads as Home is. There is no Issues
//! hub: every issue names its row and the page its action opens, and the
//! status bar counts the issues not dismissed (see [`IssueView`]).
//!
//! Sources, in the order the issues are listed:
//! - the Sessions filters' counts and the Needs calibration queue: "need a
//!   Target", "not in a Project" and "need calibration" as Library counts,
//!   and each session's drifted pins;
//! - each session's reviewed frames whose bytes changed (Changed content);
//! - each active location that is offline or missing, or unreadable or
//!   claimed by another folder;
//! - the live duplicate copies: the copies beyond one per content, and their
//!   bytes;
//! - each location's latest scan when it failed, the latest measurement run
//!   when it failed or was interrupted, and every interrupted import;
//! - each open Project's latest Apply when it failed, its `View (previous)/`
//!   files waiting for review, and its masters offered to the calibration
//!   library.
//!
//! Reading the issues forgets every dismissal whose issue ended or changed,
//! so an issue that returns counts again (D-W158): a location that goes
//! offline again, or a count that drops to none and comes back. That is the
//! read's only write, and it happens only when such a dismissal exists. An
//! issue that ends and returns unchanged between two reads stays hidden; the
//! status bar reads the issues on every library change, so the user never
//! saw it gone.

use std::collections::BTreeSet;

use uuid::Uuid;

use crate::library::Library;
use crate::storage::duplicate_candidates;
use crate::{
    ApplyOutcome, Availability, CalibrationNeed, Issue, IssueKind, IssueOwner, IssueView,
    LibraryError, Location, LocationLifecycle, MasterOfferState, PreviousItemReview, ProjectQuery,
    RunState, ScanState,
};

impl Library {
    /// Every current issue, split into those that count and those dismissed,
    /// with the status-bar counters and each page's count.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read or a stale
    /// dismissal cannot be forgotten.
    pub async fn issues(&self) -> Result<IssueView, LibraryError> {
        let catalog = self.catalog();
        let dismissed = catalog.issue_dismissals().await?;
        let issues = self.current_issues().await?;
        let current: BTreeSet<&str> =
            issues.iter().map(|issue| issue.fingerprint.as_str()).collect();
        let (kept, stale): (BTreeSet<String>, BTreeSet<String>) =
            dismissed.into_iter().partition(|fingerprint| current.contains(fingerprint.as_str()));
        catalog.forget_issue_dismissals(&stale).await?;
        Ok(IssueView::split(issues, &kept))
    }

    /// Dismiss the current issue with `fingerprint`: it stops counting until
    /// its kind, subject, count or bytes change. Nothing else changes.
    ///
    /// # Errors
    /// `NotFound` when no current issue has `fingerprint` (it ended or
    /// changed); `InvalidInput` for a Project's own waiting work, which
    /// can't be dismissed; `PersistenceFailure` when the catalog cannot be
    /// read or written.
    pub async fn dismiss_issue(&self, fingerprint: &str) -> Result<(), LibraryError> {
        let issues = self.current_issues().await?;
        let issue = issues
            .iter()
            .find(|issue| issue.fingerprint == fingerprint)
            .ok_or_else(|| LibraryError::NotFound(format!("current issue {fingerprint}")))?;
        if !issue.dismissable {
            return Err(LibraryError::InvalidInput(format!(
                "a {} issue is the Project's own waiting work and can't be dismissed",
                issue.kind
            )));
        }
        self.catalog().dismiss_issue(fingerprint).await
    }

    /// Bring back the dismissed issue with `fingerprint`.
    ///
    /// # Errors
    /// `NotFound` when no dismissal has `fingerprint`; `PersistenceFailure`
    /// when the catalog cannot be written.
    pub async fn restore_issue(&self, fingerprint: &str) -> Result<(), LibraryError> {
        self.catalog().restore_issue(fingerprint).await
    }

    /// Every current issue, dismissed or not, in source order.
    async fn current_issues(&self) -> Result<Vec<Issue>, LibraryError> {
        let locations: Vec<Location> = self
            .catalog()
            .list_locations()
            .await?
            .into_iter()
            .filter(|location| location.lifecycle == LocationLifecycle::Active)
            .collect();
        let mut issues = Vec::new();
        self.session_issues(&mut issues).await?;
        self.storage_issues(&locations, &mut issues).await?;
        self.work_issues(&locations, &mut issues).await?;
        self.project_issues(&mut issues).await?;
        Ok(issues)
    }

    async fn session_issues(&self, out: &mut Vec<Issue>) -> Result<(), LibraryError> {
        let catalog = self.catalog();
        let counts = catalog.session_filter_counts().await?;
        for (kind, count) in [
            (IssueKind::NeedsTarget, counts.needs_target),
            (IssueKind::NotInProject, counts.not_in_any_project),
            (IssueKind::NeedsCalibration, counts.needs_calibration),
        ] {
            if count > 0 {
                out.push(library_count(kind, count, None));
            }
        }
        for session in catalog.needs_calibration().await? {
            let pins = session
                .needs
                .iter()
                .filter(|need| matches!(need, CalibrationNeed::PinDrift { .. }))
                .count();
            if pins > 0 {
                out.push(on_session(IssueKind::PinDrift, session.session_id, count_of(pins)));
            }
        }
        for (session_id, frames) in catalog.sessions_with_changed_frames().await? {
            out.push(on_session(IssueKind::Drift, session_id, frames));
        }
        Ok(())
    }

    async fn storage_issues(
        &self,
        locations: &[Location],
        out: &mut Vec<Issue>,
    ) -> Result<(), LibraryError> {
        let catalog = self.catalog();
        for location in locations {
            let kind = match location.availability {
                Availability::Offline | Availability::Missing => IssueKind::LocationOffline,
                Availability::Unreadable | Availability::IdentityConflict => {
                    IssueKind::LocationDenied
                }
                Availability::Available | Availability::Retired | Availability::Trashed => {
                    continue;
                }
            };
            out.push(Issue::new(
                kind,
                IssueOwner::Location { id: location.id },
                Some(location.id),
                1,
                None,
                Some(location.name.clone()),
            ));
        }
        // Every copy beyond one per content is extra (the Duplicates review's groups).
        let candidates = duplicate_candidates(catalog.live_duplicate_copies().await?);
        let (mut extra, mut bytes) = (0_u64, 0_u64);
        for candidate in &candidates {
            let copies = count_of(candidate.copies.len().saturating_sub(1));
            extra = extra.saturating_add(copies);
            bytes = bytes.saturating_add(candidate.size_bytes.saturating_mul(copies));
        }
        if extra > 0 {
            out.push(library_count(IssueKind::Duplicates, extra, Some(bytes)));
        }
        Ok(())
    }

    async fn work_issues(
        &self,
        locations: &[Location],
        out: &mut Vec<Issue>,
    ) -> Result<(), LibraryError> {
        let catalog = self.catalog();
        for location in locations {
            let latest = catalog.list_operations(Some(location.id), 0, 1).await?;
            if let Some(scan) = latest.first().filter(|scan| scan.state == ScanState::Failed) {
                out.push(on_operation(IssueKind::WorkFailed, scan.id, Some(location.name.clone())));
            }
        }
        if let Some(run) = catalog.list_measurement_runs(0, 1).await?.first() {
            let kind = match run.state {
                RunState::Failed => Some(IssueKind::WorkFailed),
                RunState::Interrupted => Some(IssueKind::WorkInterrupted),
                RunState::Running | RunState::Completed | RunState::Canceled => None,
            };
            if let Some(kind) = kind {
                out.push(on_operation(kind, run.operation_id, None));
            }
        }
        for import in catalog.interrupted_imports().await? {
            out.push(on_operation(IssueKind::WorkInterrupted, import, None));
        }
        Ok(())
    }

    async fn project_issues(&self, out: &mut Vec<Issue>) -> Result<(), LibraryError> {
        let catalog = self.catalog();
        for project in catalog.list_projects(&ProjectQuery::default()).await? {
            let owner = IssueOwner::Project { id: project.id };
            let on_project = |kind, about, count| {
                Issue::new(kind, owner, Some(about), count, None, Some(project.name.clone()))
            };
            let apply = catalog.latest_apply_journal(project.id).await?;
            if let Some(journal) =
                apply.filter(|journal| journal.outcome == Some(ApplyOutcome::Failed))
            {
                out.push(on_project(IssueKind::WorkFailed, journal.operation_id, 1));
            }
            let leftovers = catalog.previous_items(project.id).await?;
            let pending =
                leftovers.iter().filter(|item| item.review == PreviousItemReview::Pending).count();
            if pending > 0 {
                out.push(on_project(IssueKind::PreviousReview, project.id, count_of(pending)));
            }
            let offers = catalog.processing_master_offers(project.id).await?;
            let offered =
                offers.iter().filter(|offer| offer.state == MasterOfferState::Offered).count();
            if offered > 0 {
                out.push(on_project(IssueKind::MasterOffer, project.id, count_of(offered)));
            }
        }
        Ok(())
    }
}

fn count_of(items: usize) -> u64 {
    u64::try_from(items).unwrap_or(u64::MAX)
}

fn library_count(kind: IssueKind, count: u64, bytes: Option<u64>) -> Issue {
    Issue::new(kind, IssueOwner::Library, None, count, bytes, None)
}

fn on_session(kind: IssueKind, session_id: Uuid, count: u64) -> Issue {
    Issue::new(kind, IssueOwner::Session { id: session_id }, Some(session_id), count, None, None)
}

fn on_operation(kind: IssueKind, operation_id: Uuid, name: Option<String>) -> Issue {
    let owner = IssueOwner::Operation { id: operation_id };
    Issue::new(kind, owner, Some(operation_id), 1, None, name)
}
