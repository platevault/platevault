// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Run lifecycle (spec 070 RES-FR-06/07/10, PRJ-FR-20, amended D-W72): Mark
//! Complete, Reopen, Move run to Trash, Restore, the Project's Trash list and
//! the Empty Trash review. Mark Complete is blocked only by a Running
//! app-owned operation affecting the run; Move run to Trash is also blocked
//! while one of the run's accepted Results is an input to another run, and
//! every refusal names each blocker. Moving a run to the Trash or restoring it
//! moves no file; Empty Trash, executed by PV-STO, is the only step that
//! removes a run.

use std::fmt;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{NativePath, Revision, ViewListing};

/// The app-owned operation a run is waiting on.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunOperationKind {
    /// A preparation revision being written (PREP-FR-08).
    Preparation,
    /// A PV-STO storage mutation: Clean up, a move to the OS Trash or a
    /// transfer of the run's files.
    StorageMutation,
}

impl fmt::Display for RunOperationKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Preparation => "preparation",
            Self::StorageMutation => "storage mutation",
        })
    }
}

/// Why a lifecycle action on a run is refused (RES-FR-07, RES-FR-10).
#[derive(Clone, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum LifecycleBlocker {
    /// An app-owned operation affecting the run is Running. It blocks Mark
    /// Complete and Move run to Trash.
    RunningOperation { operation_id: Uuid, operation: RunOperationKind, name: String },
    /// One of the run's accepted Results is an input to another run. It
    /// blocks Move run to Trash only.
    ResultInput { result_id: Uuid, result_name: String, view_id: Uuid, view_name: String },
}

impl LifecycleBlocker {
    /// Whether it blocks Mark Complete: only a Running app-owned operation
    /// does (RES-FR-07). Every blocker blocks Move run to Trash.
    #[must_use]
    pub const fn blocks_complete(&self) -> bool {
        matches!(self, Self::RunningOperation { .. })
    }
}

impl fmt::Display for LifecycleBlocker {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RunningOperation { operation_id, operation, name } => {
                write!(f, "{operation} '{name}' ({operation_id}) is Running")
            }
            Self::ResultInput { result_id, result_name, view_id, view_name } => write!(
                f,
                "its Result '{result_name}' ({result_id}) is an input to run '{view_name}' \
                 ({view_id})"
            ),
        }
    }
}

/// A run in its Project's Trash (PRJ-FR-20), listed with its stage and
/// completion. It offers Restore and Empty Trash, and no step.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashedRun {
    pub run: ViewListing,
    pub trashed_at: String,
}

/// The folder a preparation revision of a run wrote (PREP-FR-06).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedFolder {
    pub preparation_revision: Revision,
    pub path: NativePath,
}

/// The recorded folders of one run: every prepared folder and its Results
/// folder (PREP-FR-07).
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunFolderSet {
    pub prepared: Vec<PreparedFolder>,
    pub results: Vec<NativePath>,
}

/// What Empty Trash removes for one run: the run record, each prepared
/// folder, which goes to the OS Trash, and its Results folder, which goes to
/// the OS Trash only when the user ticks it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmptyTrashRun {
    pub run: TrashedRun,
    pub prepared_folders: Vec<PreparedFolder>,
    pub results_folders: Vec<NativePath>,
}

/// The Empty Trash review of a Project (RES-FR-10): one run or every run in
/// its Trash. Read-only; PV-STO executes it (STO-FR-17).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmptyTrashReview {
    pub project_id: Uuid,
    pub runs: Vec<EmptyTrashRun>,
    pub statement: String,
}
