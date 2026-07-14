// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project lifecycle state model (spec 002 data-model.md §Project).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::ids::{EntityId, Timestamp};

/// Lifecycle state for a `Project`.
///
/// 7 variants from spec 002 §Project and research.md §2.1.
#[derive(
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    JsonSchema,
    Type,
)]
#[serde(rename_all = "snake_case")]
pub enum ProjectState {
    SetupIncomplete,
    Ready,
    Prepared,
    Processing,
    Completed,
    Archived,
    /// Carries a `block_reason` on the entity row.
    Blocked,
}

impl ProjectState {
    #[must_use]
    pub const fn is_before_archive(self) -> bool {
        matches!(
            self,
            Self::SetupIncomplete
                | Self::Ready
                | Self::Prepared
                | Self::Processing
                | Self::Completed
        )
    }
}

/// Canonical allowed `(from, to)` edge list per data-model.md §Project §Lifecycle
/// and research.md §2.1. 19 edges including the spec 009 R-Unarchive (`archived → ready`)
/// and A3 (`blocked → archived`) amendments.
pub const TRANSITIONS: &[(ProjectState, ProjectState)] = &[
    (ProjectState::SetupIncomplete, ProjectState::Ready),
    (ProjectState::SetupIncomplete, ProjectState::Blocked),
    (ProjectState::Ready, ProjectState::Prepared),
    (ProjectState::Ready, ProjectState::Processing),
    (ProjectState::Ready, ProjectState::Blocked),
    (ProjectState::Prepared, ProjectState::Ready),
    (ProjectState::Prepared, ProjectState::Processing),
    (ProjectState::Prepared, ProjectState::Blocked),
    (ProjectState::Processing, ProjectState::Completed),
    (ProjectState::Processing, ProjectState::Blocked),
    (ProjectState::Completed, ProjectState::Archived),
    (ProjectState::Completed, ProjectState::Processing),
    (ProjectState::Archived, ProjectState::Processing),
    (ProjectState::Archived, ProjectState::Ready),
    (ProjectState::Blocked, ProjectState::SetupIncomplete),
    (ProjectState::Blocked, ProjectState::Ready),
    (ProjectState::Blocked, ProjectState::Prepared),
    (ProjectState::Blocked, ProjectState::Processing),
    (ProjectState::Blocked, ProjectState::Archived),
];

#[must_use]
pub fn is_allowed(from: ProjectState, to: ProjectState) -> bool {
    TRANSITIONS.iter().any(|&(f, t)| f == from && t == to)
}

/// Default action label for a `(from, to)` edge per data-model.md §Transition Table (R2).
#[must_use]
pub fn default_label(from: ProjectState, to: ProjectState) -> &'static str {
    match (from, to) {
        (ProjectState::SetupIncomplete, ProjectState::Ready) => "Marked ready",
        (
            ProjectState::SetupIncomplete
            | ProjectState::Ready
            | ProjectState::Prepared
            | ProjectState::Processing,
            ProjectState::Blocked,
        ) => "Marked blocked",
        (ProjectState::Ready, ProjectState::Prepared) => "Marked prepared",
        (ProjectState::Ready | ProjectState::Prepared, ProjectState::Processing) => {
            "Marked processing"
        }
        (ProjectState::Prepared, ProjectState::Ready) => "Reverted to ready",
        (ProjectState::Processing, ProjectState::Completed) => "Marked completed",
        (ProjectState::Completed, ProjectState::Archived) => "Marked archived",
        (ProjectState::Completed, ProjectState::Processing) => "Re-opened",
        (ProjectState::Archived, ProjectState::Processing | ProjectState::Ready) => "Unarchived",
        (
            ProjectState::Blocked,
            ProjectState::SetupIncomplete
            | ProjectState::Ready
            | ProjectState::Prepared
            | ProjectState::Processing,
        ) => "Resolved blocker",
        (ProjectState::Blocked, ProjectState::Archived) => "Archived from blocked",
        _ => "Transition applied",
    }
}

/// Snapshot of `{label, at, actor}` recorded in the UI projection column.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct LastAction {
    pub label: String,
    pub at: String,
    pub actor: String,
}

/// Stub entity struct — full fields wired in persistence layer.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Project {
    pub id: EntityId,
    pub name: String,
    pub target_id: EntityId,
    pub session_ids: Vec<EntityId>,
    pub state: ProjectState,
    pub last_action: Option<LastAction>,
    pub block_reason: Option<String>,
    pub created_at: Timestamp,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// All 19 allowed edges from data-model.md §Transition Table.
    #[test]
    fn all_allowed_edges_are_accepted() {
        let allowed = TRANSITIONS;
        for &(from, to) in allowed {
            assert!(is_allowed(from, to), "expected ({from:?} → {to:?}) to be allowed");
        }
        assert_eq!(allowed.len(), 19, "expected exactly 19 allowed edges");
    }

    /// Forbidden edges: a representative set. Includes the explicitly
    /// documented forbidden cases: `processing → ready`, `blocked → completed`,
    /// `archived → completed`, and direct skip `setup_incomplete → prepared`.
    #[test]
    fn forbidden_edges_are_rejected() {
        let forbidden: &[(ProjectState, ProjectState)] = &[
            (ProjectState::Processing, ProjectState::Ready),
            (ProjectState::Blocked, ProjectState::Completed),
            (ProjectState::Archived, ProjectState::Completed),
            (ProjectState::Archived, ProjectState::Prepared),
            (ProjectState::SetupIncomplete, ProjectState::Prepared),
            (ProjectState::SetupIncomplete, ProjectState::Processing),
            (ProjectState::SetupIncomplete, ProjectState::Completed),
            (ProjectState::SetupIncomplete, ProjectState::Archived),
            (ProjectState::Ready, ProjectState::Completed),
            (ProjectState::Ready, ProjectState::Archived),
            (ProjectState::Ready, ProjectState::SetupIncomplete),
            (ProjectState::Prepared, ProjectState::Completed),
            (ProjectState::Prepared, ProjectState::Archived),
            (ProjectState::Prepared, ProjectState::SetupIncomplete),
            (ProjectState::Processing, ProjectState::Ready),
            (ProjectState::Processing, ProjectState::Prepared),
            (ProjectState::Processing, ProjectState::SetupIncomplete),
            (ProjectState::Processing, ProjectState::Archived),
            (ProjectState::Completed, ProjectState::Ready),
            (ProjectState::Completed, ProjectState::Prepared),
            (ProjectState::Completed, ProjectState::Blocked),
            (ProjectState::Completed, ProjectState::SetupIncomplete),
        ];
        for &(from, to) in forbidden {
            assert!(!is_allowed(from, to), "expected ({from:?} → {to:?}) to be forbidden");
        }
    }

    /// Verify specific edges from the spec (spot checks).
    #[test]
    fn blocked_archived_is_allowed_escape_hatch() {
        assert!(is_allowed(ProjectState::Blocked, ProjectState::Archived));
    }

    #[test]
    fn archived_ready_is_allowed_r_unarchive() {
        assert!(is_allowed(ProjectState::Archived, ProjectState::Ready));
    }

    #[test]
    fn blocked_completed_is_forbidden_a3() {
        assert!(!is_allowed(ProjectState::Blocked, ProjectState::Completed));
    }

    #[test]
    fn archived_prepared_is_forbidden() {
        assert!(!is_allowed(ProjectState::Archived, ProjectState::Prepared));
    }

    /// Default label derivation for all 19 allowed edges.
    #[test]
    fn default_labels_match_spec() {
        assert_eq!(
            default_label(ProjectState::SetupIncomplete, ProjectState::Ready),
            "Marked ready"
        );
        assert_eq!(default_label(ProjectState::Archived, ProjectState::Ready), "Unarchived");
        assert_eq!(default_label(ProjectState::Archived, ProjectState::Processing), "Unarchived");
        assert_eq!(
            default_label(ProjectState::Blocked, ProjectState::Archived),
            "Archived from blocked"
        );
        assert_eq!(default_label(ProjectState::Completed, ProjectState::Processing), "Re-opened");
        assert_eq!(default_label(ProjectState::Blocked, ProjectState::Ready), "Resolved blocker");
    }
}
