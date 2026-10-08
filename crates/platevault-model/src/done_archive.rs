// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The Done / Archive sheet of a Done Project (spec 065 PRJ-FR-14/15, root
//! FR-021; D-W43, D-W70, D-W72, D-W74): Archive, "Move N rejected frames to
//! Trash", "Move N processing intermediates to Trash", "Move N duplicate
//! copies to Trash" and, while the Project's Trash holds runs, Empty Trash.
//!
//! The sheet only offers. Computing it records no operation and moves
//! nothing; PV-STO executes an approved offer under its custody rules
//! (STO-FR-13..17), which re-verify every item before it moves and add their
//! own refusals. Every refusal the sheet lists names its reason.

use std::fmt;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{Availability, NativePath, ResultOwner, Revision, RunStage, TrashedRun};

/// A run as an offer or refusal names it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfferRun {
    pub view_id: Uuid,
    /// Its latest revision's name, else its draft's.
    pub name: String,
    pub project_id: Uuid,
    pub project_name: String,
    pub stage: RunStage,
}

/// A Project as a kept session names it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectName {
    pub id: Uuid,
    pub name: String,
}

/// One physical copy of a frame (LIB-FR-08), as the catalog last observed it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameCopy {
    pub asset_id: Uuid,
    pub location_id: Uuid,
    /// The copy's path below its location's root.
    pub relative_path: NativePath,
    pub size_bytes: u64,
    /// The recorded SHA-256; `None` until the copy is hashed.
    pub sha256: Option<String>,
    pub availability: Availability,
}

/// Why the sheet refuses an item it would otherwise offer.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum OfferRefusal {
    /// The frame is used in a prepared revision of a run that is not Complete,
    /// in any Project (PRJ-FR-15, D-W43).
    PreparedInOpenRun { run: OfferRun, preparation: u32 },
    /// The frame is a recorded input of a Result: the Result records the
    /// prepared revision that holds the frame (RES-FR-01), by tool evidence or,
    /// when `inferred`, by that revision's time window.
    ResultInput {
        result_id: Uuid,
        result_name: String,
        run: OfferRun,
        preparation: u32,
        inferred: bool,
    },
    /// The copy is the source of a prepared entry, or the Direct-source path,
    /// of a run that is not Complete, in any Project (PRJ-FR-15, D-W74).
    PreparedSource { run: OfferRun, preparation: u32, direct_source: bool },
    /// An adopted master's generated source is not proven byte-identical to
    /// its kept library copy, so it is no verified duplicate (D-W70).
    UnverifiedDuplicate { detail: String },
}

impl fmt::Display for OfferRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PreparedInOpenRun { run, preparation } => write!(
                f,
                "used in preparation {preparation} of run '{}' in Project '{}', which is not \
                 Complete",
                run.name, run.project_name
            ),
            Self::ResultInput { result_name, run, preparation, inferred, .. } => {
                let basis = if *inferred { ", inferred from its time window" } else { "" };
                write!(
                    f,
                    "a recorded input of Result '{result_name}', which records preparation \
                     {preparation} of run '{}' in Project '{}'{basis}",
                    run.name, run.project_name
                )
            }
            Self::PreparedSource { run, preparation, direct_source } => {
                let what = if *direct_source {
                    "the Direct-source path"
                } else {
                    "the source of a prepared entry"
                };
                write!(
                    f,
                    "{what} of preparation {preparation} of run '{}' in Project '{}', which is \
                     not Complete",
                    run.name, run.project_name
                )
            }
            Self::UnverifiedDuplicate { detail } => f.write_str(detail),
        }
    }
}

/// A library-Unusable candidate frame the rejected-frames offer moves, with
/// every physical copy it holds (STO-FR-15 moves every copy or none).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectedFrame {
    /// The frame's logical capture key (D16): its smallest copy asset id.
    pub frame_key: Uuid,
    pub copies: Vec<FrameCopy>,
    pub size_bytes: u64,
}

/// A library-Unusable candidate frame the offer refuses.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefusedFrame {
    pub frame_key: Uuid,
    pub copies: Vec<FrameCopy>,
    pub reasons: Vec<OfferRefusal>,
}

/// "Move N rejected frames to Trash (size)" (PRJ-FR-15, root FR-021): the
/// Project's candidate frames whose applicable library quality is Unusable.
/// Project-only rejects, changed-content and Trashed frames are never included.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectedFramesOffer {
    /// The number of frames offered.
    pub n: u64,
    /// Their copies' recorded bytes.
    pub size_bytes: u64,
    pub frames: Vec<RejectedFrame>,
    pub refused: Vec<RefusedFrame>,
}

/// The library copy an adopted master's generated source duplicates: the
/// adopted master, and its indexed asset when a scan recorded one.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeptLibraryCopy {
    pub master_id: Uuid,
    pub asset_id: Option<Uuid>,
    pub location_id: Uuid,
    pub relative_path: NativePath,
    pub sha256: String,
}

/// A file the intermediates offer moves: a recognized processing
/// intermediate, or an adopted master's generated source listed as a
/// verified duplicate of its kept library copy (D-W70).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfferedIntermediate {
    pub result_id: Uuid,
    pub owner: ResultOwner,
    pub path: NativePath,
    pub size_bytes: u64,
    /// Set for an adopted master's generated source.
    pub verified_duplicate_of: Option<KeptLibraryCopy>,
}

/// A file the intermediates offer refuses.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefusedIntermediate {
    pub result_id: Uuid,
    pub owner: ResultOwner,
    pub path: NativePath,
    pub reasons: Vec<OfferRefusal>,
}

/// "Move N processing intermediates to Trash (size)" (PRJ-FR-15, D-W70): the
/// recognized intermediates in the Results folders of the Project's runs and
/// the generated sources of their adopted masters. Accepted Results, adopted
/// masters, candidate masters, unknown files, unaccepted Result candidates
/// and prepared entries are never included.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntermediatesOffer {
    pub n: u64,
    pub size_bytes: u64,
    pub items: Vec<OfferedIntermediate>,
    pub refused: Vec<RefusedIntermediate>,
}

/// An extra copy the duplicates offer refuses.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefusedCopy {
    pub copy: FrameCopy,
    pub reasons: Vec<OfferRefusal>,
}

/// One Project frame with byte-identical extra copies: the copy it keeps and
/// names, the extra copies offered, and the extra copies refused. The frame
/// keeps its record, quality and memberships.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateFrame {
    pub frame_key: Uuid,
    pub sha256: String,
    pub kept: FrameCopy,
    pub offered: Vec<FrameCopy>,
    pub refused: Vec<RefusedCopy>,
}

/// "Move N duplicate copies to Trash (size)" (PRJ-FR-15, D-W74): the
/// byte-identical extra physical copies of the Project's candidate and
/// member frames and of the calibration frames its runs use. The kept copy
/// is the one in a Captures or Calibration location, the earliest-registered
/// such location when there are several, otherwise the copy in the
/// earliest-registered location.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicatesOffer {
    /// The number of extra copies offered.
    pub n: u64,
    pub size_bytes: u64,
    pub frames: Vec<DuplicateFrame>,
}

/// A member session Archive keeps at its path because it is a member of a
/// run in another Project not marked Done (PRJ-FR-14).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeptSession {
    pub session_id: Uuid,
    pub projects: Vec<ProjectName>,
}

/// Archive (PRJ-FR-14, STO-FR-13): the Project's member sessions, the
/// sessions in its runs outside the Trash. Being another Project's candidate
/// keeps nothing.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveOffer {
    /// The member sessions Archive would transfer.
    pub sessions: Vec<Uuid>,
    pub kept: Vec<KeptSession>,
}

/// Empty Trash for the runs in the Project's Trash (RES-FR-10, D-W72).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmptyTrashOffer {
    pub runs: Vec<TrashedRun>,
}

/// The Done / Archive sheet of a Done Project, at its Project revision.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoneArchiveSheet {
    pub project_id: Uuid,
    pub project_revision: Revision,
    pub archive: ArchiveOffer,
    pub rejected_frames: RejectedFramesOffer,
    pub intermediates: IntermediatesOffer,
    pub duplicates: DuplicatesOffer,
    /// Offered only while the Project's Trash holds runs.
    pub empty_trash: Option<EmptyTrashOffer>,
}
