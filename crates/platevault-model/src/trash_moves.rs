// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The three OS Trash moves of a Done Project's Done / Archive sheet (spec 071
//! STO-FR-14/15/16, STO-AC-18/19/21/23; spec 065 PRJ-AC-17; spec 064
//! LIB-AC-19; D-W43, D-W70, D-W74).
//!
//! Each move is its own approval of the items its offer listed at the
//! sheet's Project revision. Execution re-checks every offer refusal and
//! adds the custody refusals; every copy is re-verified immediately before it
//! moves (D19) and goes to the OS Trash only, with no permanent delete.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{ItemReason, NativePath, OfferRefusal, Revision, StorageOperationState};

/// Which offer of the sheet a move executes.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrashOffer {
    RejectedFrames,
    Intermediates,
    DuplicateCopies,
}

/// A rejected frame as the user approved it: every physical copy the offer
/// listed, all of which move or none.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovedFrame {
    pub frame_key: Uuid,
    pub copies: Vec<Uuid>,
}

/// Approval of "Move N rejected frames to Trash (size)".
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectedFramesApproval {
    /// The Project revision of the sheet the user approved.
    pub project_revision: Revision,
    pub frames: Vec<ApprovedFrame>,
}

/// Approval of "Move N processing intermediates to Trash (size)": the result
/// ids the offer listed, an adopted master's generated source included.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntermediatesApproval {
    pub project_revision: Revision,
    pub items: Vec<Uuid>,
}

/// An extra copy as the user approved it, with the kept copy it relies on.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovedCopy {
    pub asset_id: Uuid,
    pub kept_asset_id: Uuid,
}

/// Approval of "Move N duplicate copies to Trash (size)".
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicatesApproval {
    pub project_revision: Revision,
    pub copies: Vec<ApprovedCopy>,
}

/// Why an approved item stays in place.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum MoveRefusal {
    /// The offer refuses it now (PRJ-FR-15), re-checked at execution.
    Offer { refusal: OfferRefusal },
    /// The offer no longer lists it as approved: a stale review.
    Stale { detail: String },
    /// A custody check refuses this copy (STO-FR-15) immediately before it
    /// would move: drift, an Offline or unreadable location, a location with
    /// no OS Trash or whose OS removal deletes immediately, or a kept copy
    /// that cannot be re-verified.
    Custody { path: NativePath, reason: ItemReason },
    /// Another copy of the frame was refused, so none of its copies moves.
    FrameIncomplete { refused: NativePath },
    /// The copy is not in a registered Captures location; a rejected frame
    /// moves only from Captures (STO-FR-15).
    OutsideCaptures { path: NativePath, location: String },
    /// No SHA-256 is recorded for the copy, so it cannot be re-verified
    /// before it moves; inspect it first.
    NoRecordedDigest { path: NativePath },
}

/// An approved item that went to the OS Trash: a frame with every copy, an
/// intermediate, or one extra copy.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovedItem {
    /// The frame key, result id or copy asset id the approval named.
    pub id: Uuid,
    pub paths: Vec<NativePath>,
    pub size_bytes: u64,
}

/// An approved item left in place, with every reason.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefusedMove {
    pub id: Uuid,
    pub paths: Vec<NativePath>,
    pub reasons: Vec<MoveRefusal>,
}

/// An approved item whose outcome an interruption or an OS refusal left
/// unproven; `moved` names the copies that did reach the OS Trash.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UncertainMove {
    pub id: Uuid,
    pub paths: Vec<NativePath>,
    pub moved: Vec<NativePath>,
    pub reasons: Vec<ItemReason>,
}

/// The exact summary of one approved move.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashMoveSummary {
    pub project_id: Uuid,
    pub offer: TrashOffer,
    /// The storage journal operation; `None` when every item was refused
    /// before anything could move.
    pub operation_id: Option<Uuid>,
    pub state: StorageOperationState,
    /// This call resumed an earlier, interrupted move of the same offer and
    /// applied no new approval.
    pub resumed: bool,
    pub moved: Vec<MovedItem>,
    pub refused: Vec<RefusedMove>,
    pub uncertain: Vec<UncertainMove>,
    pub moved_bytes: u64,
}
