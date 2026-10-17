// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! A Project's lifecycle, its one active operation, Wrap up and the Closed
//! snapshot (spec 065 PRJ-FR-14/25/30, 069 PREP-FR-19, 070 RES-FR-06/07, 071
//! STO-FR-13; D-W80, D-W97, D-W111, D-W112).
//!
//! A Project is Open until its Wrap up closes it. Wrap up runs Clean up,
//! Trash, then Archive, each Finished or Skipped; Archive's Proceed is Close
//! project…, which records the Closed snapshot. The Project reads Closing
//! while its archive transfer runs, then Archived, or Closed when nothing was
//! archived. A Closed or Archived Project is locked: no edits, no Apply, and
//! Library or calibration changes never touch it; it reads its snapshot, and
//! a duplicate uses the sessions' current pins instead. One `PlateVault`
//! operation runs per Project at a time. The decision record marks two rules
//! provisional; [`ClosePolicy`] holds them in one place.

use std::collections::BTreeSet;
use std::fmt;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{GoalProgress, LibraryError, ProjectBasis, Revision};

fn invalid(message: String) -> LibraryError {
    LibraryError::InvalidInput(message)
}

/// Where a Project is in its life.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum ProjectLifecycle {
    Open,
    /// Close was confirmed and its archive transfer is running.
    Closing,
    Closed,
    Archived,
}

impl fmt::Display for ProjectLifecycle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Open => "open",
            Self::Closing => "closing",
            Self::Closed => "closed",
            Self::Archived => "archived",
        })
    }
}

impl ProjectLifecycle {
    /// Only an open Project takes edits, sessions and Apply.
    #[must_use]
    pub const fn is_open(self) -> bool {
        matches!(self, Self::Open)
    }

    /// Whether the lifecycle may move to `next` under [`ClosePolicy::CURRENT`].
    #[must_use]
    pub const fn can_become(self, next: Self) -> bool {
        ClosePolicy::CURRENT.allows(self, next)
    }

    /// # Errors
    /// `InvalidInput` naming both states when the move is not allowed.
    pub fn transition(self, next: Self) -> Result<Self, LibraryError> {
        if self.can_become(next) {
            Ok(next)
        } else {
            Err(invalid(format!("a {self} Project can't become {next}")))
        }
    }

    /// One operation runs per Project: any on an open Project, only its
    /// archive transfer while Closing, none once Closed or Archived.
    #[must_use]
    pub const fn admits_operation(self, kind: ProjectOperationKind) -> bool {
        match self {
            Self::Open => true,
            Self::Closing => matches!(kind, ProjectOperationKind::Archive),
            Self::Closed | Self::Archived => false,
        }
    }
}

/// The decision record's provisional close rules (section 2; PR #1804), as
/// the current defaults in one place for the owner to change: there is no
/// Reopen, and Wrap up opens only once no change is pending. Closing itself
/// (Open, Closing, then Closed or Archived) and the lock are settled.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosePolicy {
    /// A Closed or Archived Project may return to Open.
    pub reopen: bool,
    /// Wrap up waits until every pending change is applied or discarded.
    pub wrap_up_waits_for_pending: bool,
}

impl ClosePolicy {
    pub const CURRENT: Self = Self { reopen: false, wrap_up_waits_for_pending: true };

    /// The lifecycle moves this policy allows.
    #[must_use]
    pub const fn allows(self, from: ProjectLifecycle, to: ProjectLifecycle) -> bool {
        use ProjectLifecycle::{Archived, Closed, Closing, Open};
        match (from, to) {
            (Open, Closing | Closed) | (Closing, Closed | Archived) => true,
            (Closed | Archived, Open) => self.reopen,
            _ => false,
        }
    }

    /// Whether Wrap up opens: never while an operation runs on the Project,
    /// and, under this policy, only once no change is pending.
    #[must_use]
    pub const fn wrap_up_opens(self, pending_changes: usize, operation_running: bool) -> bool {
        !operation_running && (!self.wrap_up_waits_for_pending || pending_changes == 0)
    }
}

// ── Operations ───────────────────────────────────────────────────────────────

/// The `PlateVault` operations that act on a Project's folders.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum ProjectOperationKind {
    Apply,
    CopyToOutput,
    /// Wrap up's Clean up step.
    CleanUp,
    /// Wrap up's Trash step.
    Trash,
    /// Wrap up's Archive step, running on while the Project is Closing.
    Archive,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum ProjectOperationState {
    Active,
    Settled,
}

/// The durable record that holds a Project for one operation (PREP-FR-19):
/// reserved in a write transaction before any effect, released when it
/// settles. No writer lock is held across its file work.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ProjectOperation {
    pub id: Uuid,
    pub project_id: Uuid,
    pub kind: ProjectOperationKind,
    pub state: ProjectOperationState,
    pub reserved_at: String,
    pub settled_at: Option<String>,
}

impl ProjectOperation {
    /// # Errors
    /// `InvalidInput` unless `settled_at` is set exactly when settled.
    pub fn validate(&self) -> Result<(), LibraryError> {
        if (self.state == ProjectOperationState::Settled) == self.settled_at.is_some() {
            Ok(())
        } else {
            Err(invalid(format!("operation {}: settled exactly when it records when", self.id)))
        }
    }
}

// ── Wrap up ──────────────────────────────────────────────────────────────────

/// Wrap up's steps, in their fixed order.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum WrapUpStep {
    CleanUp,
    Trash,
    Archive,
}

impl WrapUpStep {
    pub const ORDER: [Self; 3] = [Self::CleanUp, Self::Trash, Self::Archive];

    /// The step that must be recorded first.
    #[must_use]
    pub const fn previous(self) -> Option<Self> {
        match self {
            Self::CleanUp => None,
            Self::Trash => Some(Self::CleanUp),
            Self::Archive => Some(Self::Trash),
        }
    }
}

/// Proceeding with nothing selected records a step Skipped.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum WrapUpOutcome {
    Finished,
    Skipped,
}

/// One recorded Wrap up step; the Wrap up tab of a Closed Project is the
/// read-only record of these.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct WrapUpRecord {
    pub step: WrapUpStep,
    pub outcome: WrapUpOutcome,
    /// The operation that carried the step out, if it moved anything.
    pub operation_id: Option<Uuid>,
    pub recorded_at: String,
}

impl WrapUpRecord {
    /// Each step once, and none before the step it follows.
    ///
    /// # Errors
    /// `InvalidInput` naming the step out of order or repeated.
    pub fn validate_all(records: &[Self]) -> Result<(), LibraryError> {
        let mut steps = BTreeSet::new();
        for record in records {
            if !steps.insert(record.step) {
                return Err(invalid(format!("Wrap up records {:?} twice", record.step)));
            }
        }
        if let Some(step) = steps
            .iter()
            .find(|step| step.previous().is_some_and(|previous| !steps.contains(&previous)))
        {
            return Err(invalid(format!(
                "Wrap up runs Clean up, Trash, then Archive; {step:?} came early"
            )));
        }
        Ok(())
    }

    /// Every step recorded in order: Close may proceed.
    #[must_use]
    pub fn complete(records: &[Self]) -> bool {
        Self::validate_all(records).is_ok() && records.len() == WrapUpStep::ORDER.len()
    }
}

// ── Closed snapshot ──────────────────────────────────────────────────────────

/// What a Closed Project reads for good: the basis of its last applied View,
/// or its desired basis labelled never applied, and its goals frozen with
/// their tallies. Later pins, quality marks or rig edits never change it;
/// Trashed or unavailable badges may overlay it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ClosedSnapshot {
    pub project_id: Uuid,
    pub taken_at: String,
    /// The installed manifest generation it froze; `None` when the Project
    /// was never applied.
    pub applied_generation: Option<Revision>,
    pub basis: ProjectBasis,
    pub goals: Vec<GoalProgress>,
}

impl ClosedSnapshot {
    #[must_use]
    pub const fn never_applied(&self) -> bool {
        self.applied_generation.is_none()
    }

    /// # Errors
    /// `InvalidInput` for an invalid basis.
    pub fn validate(&self) -> Result<(), LibraryError> {
        self.basis.validate()
    }
}
