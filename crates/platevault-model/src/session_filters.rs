// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The Sessions filters' counts and the Add to Project addition (LIB-FR-17,
//! PRJ-FR-19, D-W59). Both derive from current associations, Project subjects
//! and rigs, and run memberships, and assign nothing to a run.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{ExpectedSession, Project, Revision};

/// The lengths of the "Needs a Target" and "Not in any Project" lists, which
/// Home's top line reports as "N sessions need a Target · M not in any Project".
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFilterCounts {
    pub needs_target: u64,
    pub not_in_any_project: u64,
}

/// The session's rig that Add to Project adds because the Project lacks it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddedRig {
    pub id: Uuid,
    pub name: String,
}

/// What Add to Project adds to one Project for one session: its confirmed
/// Target as a subject unless it is one, and its confirmed rig when the
/// Project lacks it, named by a visible note before saving (D-W59).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAddition {
    pub project_id: Uuid,
    /// The Project revision the addition was computed against; the write
    /// commits only on it.
    pub project_revision: Revision,
    /// The session as the addition read it; the write commits only on it.
    pub session: ExpectedSession,
    /// The session's confirmed Target.
    pub target_id: Uuid,
    /// The Target is not yet one of the Project's subjects.
    pub adds_subject: bool,
    pub added_rig: Option<AddedRig>,
    /// Names the added rig; absent when no rig is added.
    pub note: Option<String>,
}

impl ProjectAddition {
    #[must_use]
    pub fn new(
        project_id: Uuid,
        project_revision: Revision,
        session: ExpectedSession,
        target_id: Uuid,
        adds_subject: bool,
        added_rig: Option<AddedRig>,
    ) -> Self {
        let note = added_rig
            .as_ref()
            .map(|rig| format!("Also adds the rig {} to this Project.", rig.name));
        Self { project_id, project_revision, session, target_id, adds_subject, added_rig, note }
    }

    /// Nothing to write: the Target is a subject and the rig is on the Project
    /// or unconfirmed.
    #[must_use]
    pub const fn is_empty(&self) -> bool {
        !self.adds_subject && self.added_rig.is_none()
    }
}

/// The committed Project and the addition the write applied.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAdded {
    pub project: Project,
    pub addition: ProjectAddition,
}
