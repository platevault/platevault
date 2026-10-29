// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Issues on the rows they affect (spec 063 FR-032, 064 LIB-FR-17/22, 065
//! PRJ-FR-17, D-W92, D-W144, D-W150, D-W158). There is no Issues hub: each
//! issue names the row it is on (its [`IssueOwner`]) and the page its one
//! action opens ([`IssuePage`]), and the status bar counts the issues not
//! dismissed by severity and by page.
//!
//! A dismissal hides one issue until it changes (D-W158): it records the
//! issue's [`Issue::fingerprint`], which is its kind, its subject, its count
//! and its bytes. Any change to one of them is a different fingerprint, so
//! the issue counts again. A location's offline or denied issue, and an
//! import's interrupted one, have the same fingerprint each time, so the
//! catalog forgets the dismissal in the write that ends the issue
//! ([`Issue::fingerprint_prefix`]): going offline again, or an import
//! interrupted again, brings it back. Dismissing leaves the state behind
//! the issue as it was. A Project's own waiting work (`View (previous)/` to
//! review) is never dismissable: the issue is how the user finds it.

use std::collections::BTreeSet;
use std::fmt;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::Availability;

/// What an issue is about; the client words it by kind.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum IssueKind {
    /// Sessions with no confirmed Target (a Library count).
    NeedsTarget,
    /// Confirmed sessions no Project holds (a Library count).
    NotInProject,
    /// Sessions in the Needs calibration queue (a Library count).
    NeedsCalibration,
    /// A session's pinned calibration file changed or went missing.
    PinDrift,
    /// A location that can't be read: unreadable, or another folder now at its root.
    LocationDenied,
    /// A location that is offline or whose root is missing.
    LocationOffline,
    /// A scan, measurement run or Apply that failed.
    WorkFailed,
    /// An import or measurement run left unfinished.
    WorkInterrupted,
    /// A Project's `View (previous)/` holds files the user hasn't reviewed.
    PreviousReview,
    /// A Project's `Processing/` holds generated masters offered to the calibration library.
    MasterOffer,
    /// Reviewed frames of a session whose bytes changed on disk.
    Drift,
    /// Live copies that share their content with another live copy (a Library count).
    Duplicates,
}

impl IssueKind {
    /// The wire name, as serialized.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::NeedsTarget => "needs-target",
            Self::NotInProject => "not-in-project",
            Self::NeedsCalibration => "needs-calibration",
            Self::PinDrift => "pin-drift",
            Self::LocationDenied => "location-denied",
            Self::LocationOffline => "location-offline",
            Self::WorkFailed => "work-failed",
            Self::WorkInterrupted => "work-interrupted",
            Self::PreviousReview => "previous-review",
            Self::MasterOffer => "master-offer",
            Self::Drift => "drift",
            Self::Duplicates => "duplicates",
        }
    }

    /// The status-bar counter the issue counts under (J38 S1/S2).
    #[must_use]
    pub const fn severity(self) -> IssueSeverity {
        match self {
            Self::PinDrift | Self::LocationDenied | Self::WorkFailed => IssueSeverity::Danger,
            Self::NeedsTarget
            | Self::NeedsCalibration
            | Self::LocationOffline
            | Self::WorkInterrupted
            | Self::PreviousReview
            | Self::Drift
            | Self::Duplicates => IssueSeverity::Warning,
            Self::NotInProject | Self::MasterOffer => IssueSeverity::Info,
        }
    }

    /// False for a Project's own waiting work (P-ISS1).
    #[must_use]
    pub const fn dismissable(self) -> bool {
        !matches!(self, Self::PreviousReview)
    }

    /// The issue an active location raises while its availability is
    /// `availability`: offline for an absent volume or root, denied for an
    /// unreadable one or another folder at its root, none otherwise.
    #[must_use]
    pub const fn of_location(availability: Availability) -> Option<Self> {
        match availability {
            Availability::Offline | Availability::Missing => Some(Self::LocationOffline),
            Availability::Unreadable | Availability::IdentityConflict => Some(Self::LocationDenied),
            Availability::Available | Availability::Retired | Availability::Trashed => None,
        }
    }
}

impl fmt::Display for IssueKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A status-bar counter.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum IssueSeverity {
    Danger,
    Warning,
    Info,
}

/// The row an issue is on, or the Library for a count with no row.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum IssueOwner {
    Library,
    Session {
        id: Uuid,
    },
    Project {
        id: Uuid,
    },
    Location {
        id: Uuid,
    },
    /// Work no Project ran: a scan, an import or a measurement run.
    Operation {
        id: Uuid,
    },
}

/// The page an issue's action opens, filtered to the affected rows; the
/// status bar's counter menu names these pages with their counts (D-W144).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum IssuePage {
    Sessions,
    /// Settings > Locations.
    Locations,
    Activity,
    Project {
        id: Uuid,
    },
}

/// One issue as a row, a menu and a counter show it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct Issue {
    /// The kind and subject. It stays the same while the subject does; a
    /// Duplicates issue's subject is a digest of the duplicated contents, so its
    /// id changes whenever that set changes. Key client rows on `kind` and
    /// `owner`, not on `id`, where a row must survive that change.
    pub id: String,
    /// What a dismissal records: the kind, subject, count and bytes (D-W158).
    pub fingerprint: String,
    pub kind: IssueKind,
    pub severity: IssueSeverity,
    /// How many things the issue covers: sessions, files, pins, offers or
    /// extra duplicate copies; 1 for a location or one operation.
    pub count: u64,
    /// The bytes of the extra duplicate copies; `None` for every other kind.
    pub bytes: Option<u64>,
    /// The location or Project the issue is about, for the client's wording.
    pub name: Option<String>,
    pub owner: IssueOwner,
    pub page: IssuePage,
    pub dismissable: bool,
}

impl Issue {
    /// An issue of `kind` on `owner` about the record `about`: a session,
    /// a location, a Project, the operation that failed, so that a new
    /// failure is a new subject (D-W158), or the digest of the duplicated
    /// contents, so that another duplicate is one; `None` for a Library count,
    /// whose kind is its subject. Its severity, dismissability, page, id and
    /// fingerprint follow from these; the page of work a Project ran is that
    /// Project.
    ///
    /// The fingerprint is `kind|subject|count|bytes`, the subject `library`
    /// for a Library count and `bytes` empty when `None`: equal fingerprints
    /// are the same issue unchanged.
    #[must_use]
    pub fn new(
        kind: IssueKind,
        owner: IssueOwner,
        about: Option<Uuid>,
        count: u64,
        bytes: Option<u64>,
        name: Option<String>,
    ) -> Self {
        let id = issue_id(kind, about);
        let fingerprint = format!("{id}|{count}|{}", bytes_text(bytes));
        let page = match (kind, owner) {
            (_, IssueOwner::Project { id }) => IssuePage::Project { id },
            (IssueKind::LocationDenied | IssueKind::LocationOffline, _) => IssuePage::Locations,
            (IssueKind::WorkFailed | IssueKind::WorkInterrupted, _) => IssuePage::Activity,
            _ => IssuePage::Sessions,
        };
        Self {
            id,
            fingerprint,
            kind,
            severity: kind.severity(),
            count,
            bytes,
            name,
            owner,
            page,
            dismissable: kind.dismissable(),
        }
    }

    /// The start every fingerprint of the issue of `kind` about `about`
    /// shares, whatever its count and bytes: what forgets the dismissal of
    /// that issue in SQL without knowing its count.
    #[must_use]
    pub fn fingerprint_prefix(kind: IssueKind, about: Option<Uuid>) -> String {
        format!("{}|", issue_id(kind, about))
    }
}

fn issue_id(kind: IssueKind, about: Option<Uuid>) -> String {
    match about {
        Some(record) => format!("{kind}|{record}"),
        None => format!("{kind}|library"),
    }
}

fn bytes_text(bytes: Option<u64>) -> String {
    bytes.map(|bytes| bytes.to_string()).unwrap_or_default()
}

/// The issues of one severity whose action opens one page.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct IssuePageCount {
    pub severity: IssueSeverity,
    pub page: IssuePage,
    pub count: u64,
}

/// The status-bar counters: issues not dismissed, by severity.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct IssueCounts {
    pub danger: u64,
    pub warning: u64,
    pub info: u64,
}

/// Every current issue, split into those that count and those dismissed.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct IssueView {
    /// Issues not dismissed: every counter and page count reads these.
    pub issues: Vec<Issue>,
    /// Dismissed issues, unchanged since their dismissal; each row offers Restore.
    pub dismissed: Vec<Issue>,
    pub counts: IssueCounts,
    /// Per severity, each page with how many of its issues count, in the
    /// order the issues first name it.
    pub pages: Vec<IssuePageCount>,
}

impl IssueView {
    /// Split `issues` by the fingerprints a dismissal recorded. A
    /// fingerprint hides only a dismissable issue it equals.
    #[must_use]
    pub fn split(issues: Vec<Issue>, dismissed: &BTreeSet<String>) -> Self {
        let mut view = Self::default();
        for issue in issues {
            if issue.dismissable && dismissed.contains(&issue.fingerprint) {
                view.dismissed.push(issue);
                continue;
            }
            match issue.severity {
                IssueSeverity::Danger => view.counts.danger += 1,
                IssueSeverity::Warning => view.counts.warning += 1,
                IssueSeverity::Info => view.counts.info += 1,
            }
            match view
                .pages
                .iter_mut()
                .find(|page| page.severity == issue.severity && page.page == issue.page)
            {
                Some(page) => page.count += 1,
                None => view.pages.push(IssuePageCount {
                    severity: issue.severity,
                    page: issue.page,
                    count: 1,
                }),
            }
            view.issues.push(issue);
        }
        view
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn library(kind: IssueKind, count: u64, bytes: Option<u64>) -> Issue {
        Issue::new(kind, IssueOwner::Library, None, count, bytes, None)
    }

    #[test]
    fn fingerprint_is_kind_subject_count_and_bytes() {
        let issue = library(IssueKind::Duplicates, 2, Some(104));
        assert_eq!(issue.id, "duplicates|library");
        assert_eq!(issue.fingerprint, "duplicates|library|2|104");
        let id = Uuid::nil();
        let owner = IssueOwner::Location { id };
        let offline = Issue::new(IssueKind::LocationOffline, owner, Some(id), 1, None, None);
        assert_eq!(offline.fingerprint, format!("location-offline|{id}|1|"));
        assert_eq!(offline.page, IssuePage::Locations);
        let prefix = Issue::fingerprint_prefix(IssueKind::LocationOffline, Some(id));
        assert!(offline.fingerprint.starts_with(&prefix), "{prefix}");
        let denied = Issue::fingerprint_prefix(IssueKind::LocationDenied, Some(id));
        assert!(!offline.fingerprint.starts_with(&denied));
        assert_eq!(Issue::fingerprint_prefix(IssueKind::Duplicates, None), "duplicates|library|");
    }

    #[test]
    fn any_change_is_another_fingerprint() {
        let base = library(IssueKind::Duplicates, 2, Some(104)).fingerprint;
        assert_ne!(base, library(IssueKind::Duplicates, 3, Some(104)).fingerprint);
        assert_ne!(base, library(IssueKind::Duplicates, 2, Some(105)).fingerprint);
        assert_ne!(base, library(IssueKind::NeedsTarget, 2, Some(104)).fingerprint);
        let first = Issue::new(
            IssueKind::WorkFailed,
            IssueOwner::Project { id: Uuid::nil() },
            Some(Uuid::from_u128(1)),
            1,
            None,
            None,
        );
        let second = Issue::new(
            IssueKind::WorkFailed,
            IssueOwner::Project { id: Uuid::nil() },
            Some(Uuid::from_u128(2)),
            1,
            None,
            None,
        );
        assert_ne!(first.fingerprint, second.fingerprint, "a new failure is a new subject");
        assert_eq!(first.page, IssuePage::Project { id: Uuid::nil() });
    }

    #[test]
    fn split_counts_only_issues_not_dismissed() {
        let needs = library(IssueKind::NeedsTarget, 2, None);
        let offer = library(IssueKind::NotInProject, 1, None);
        let dismissed = BTreeSet::from([offer.fingerprint.clone()]);
        let view = IssueView::split(vec![needs.clone(), offer.clone()], &dismissed);
        assert_eq!(view.issues, [needs]);
        assert_eq!(view.dismissed, [offer]);
        assert_eq!(view.counts, IssueCounts { danger: 0, warning: 1, info: 0 });
        assert_eq!(
            view.pages,
            [IssuePageCount {
                severity: IssueSeverity::Warning,
                page: IssuePage::Sessions,
                count: 1
            }]
        );
    }

    #[test]
    fn waiting_work_is_never_hidden() {
        let id = Uuid::nil();
        let previous = Issue::new(
            IssueKind::PreviousReview,
            IssueOwner::Project { id },
            Some(id),
            3,
            None,
            Some("M 31".into()),
        );
        assert!(!previous.dismissable);
        let dismissed = BTreeSet::from([previous.fingerprint.clone()]);
        let view = IssueView::split(vec![previous], &dismissed);
        assert_eq!(view.issues.len(), 1);
        assert!(view.dismissed.is_empty(), "{view:#?}");
    }
}
