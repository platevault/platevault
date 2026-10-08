// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Results (spec 070 RES-FR-01..05/08/10, CAL-FR-06, VSEL-FR-05; D-W4, D-W51,
//! D-W55, D-W56, D-W67, D-W72, D-W73): the files a run's or run group's
//! recorded Results folder holds, products attached from elsewhere, accepted
//! products reused as inputs of another run, and the once-only offer of a
//! generated calibration master.
//!
//! A discovered file is never accepted by appearing: it is Pending while still
//! being written, a recognized intermediate, or an unaccepted candidate.
//! Acceptance binds the SHA-256 the inspection recorded and requires the
//! current bytes to match it (D19). Run association (folder or User-linked) is
//! kept apart from input-frame lineage, which stays Unknown: `PlateVault`
//! records no tool lineage and never claims every planned frame was used.

use std::fmt;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    Availability, CaptureMetadata, Classification, InputKind, MasterOrigin, NativePath,
    ObservationFingerprint,
};

/// Who a Result belongs to: a run (a panel run included) or a run group,
/// whose Result is its assembled mosaic (RES-FR-08).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum ResultOwner {
    Run { view_id: Uuid },
    Group { group_id: Uuid },
}

impl fmt::Display for ResultOwner {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Run { view_id } => write!(f, "run {view_id}"),
            Self::Group { group_id } => write!(f, "run group {group_id}"),
        }
    }
}

/// What a Result is (RES-FR-02). A discovered file's kind is known only where
/// its folder or a recognizer says so; the user names it otherwise.
#[derive(Clone, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum ResultKind {
    FinalImage,
    LinearIntegration,
    ChannelProduct,
    /// A panel run's product, from its own `Panel N/` Results folder.
    MosaicPanel,
    /// A run group's Result, from `<Mosaic> Results/Assembled/`.
    AssembledMosaic,
    /// A generated calibration master; CAL offers it once (CAL-FR-06).
    CalibrationMaster {
        input: InputKind,
    },
    /// A processing intermediate a profile recognizer named.
    Intermediate {
        label: String,
    },
    /// Another reusable kind the user names explicitly.
    Other {
        label: String,
    },
}

impl fmt::Display for ResultKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::FinalImage => f.write_str("final image"),
            Self::LinearIntegration => f.write_str("linear integration"),
            Self::ChannelProduct => f.write_str("channel product"),
            Self::MosaicPanel => f.write_str("mosaic panel"),
            Self::AssembledMosaic => f.write_str("assembled mosaic"),
            Self::CalibrationMaster { input } => write!(f, "master {}", input.as_str()),
            Self::Intermediate { label } | Self::Other { label } => f.write_str(label),
        }
    }
}

/// Where a Result stands (RES-FR-01, RES-FR-04).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResultState {
    /// Still being written: modified within the settle window or changed
    /// while it was read. Never hashed, offered or accepted.
    Pending,
    /// A discovered product, inspected and not accepted.
    Candidate,
    /// A recognized processing intermediate, listed apart from candidates.
    Intermediate,
    /// A product the user attached from outside the Results folder.
    Attached,
    /// Accepted with its SHA-256; reused only while its bytes still match.
    Accepted,
}

/// How a Result is associated with its run (RES-FR-03).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResultAssociation {
    /// Written to the owner's recorded Results folder.
    ResultsFolder,
    /// Attached by the user (Attach Result).
    UserLinked,
}

/// A Result's input-frame lineage (RES-FR-03, RES-AC-03). No tool lineage
/// reader is qualified (D04), so every Result reads Unknown: neither
/// discovery, attach nor acceptance claims which planned frames were used.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResultLineage {
    #[default]
    Unknown,
}

/// Which prepared revision a discovered Result came from (RES-FR-01,
/// RES-AC-16, plan risk 9a), in evidence order: a tool header or log naming
/// the revision's prepared folder, then the revision's time window labelled
/// as inference, otherwise Unknown. A run's Result names one of its
/// preparation revisions; a run group's Result one of its Prepare all
/// revisions.
#[derive(Clone, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(tag = "basis", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum RevisionAttribution {
    /// `source` (the file's own header, or a log naming the file) names
    /// exactly one revision's prepared folder: `<Run>` or `<Run> (rev N)`,
    /// or a group folder `<Mosaic>` or `<Mosaic> (rev N)`.
    ToolEvidence { revision_id: Uuid, n: u32, source: NativePath },
    /// Inference: the file was last modified after this revision finished
    /// preparing and before the next one started.
    TimeWindow { revision_id: Uuid, n: u32 },
    /// No evidence names a revision.
    Unknown,
}

impl RevisionAttribution {
    /// The attributed revision, when any.
    #[must_use]
    pub const fn revision_id(&self) -> Option<Uuid> {
        match self {
            Self::ToolEvidence { revision_id, .. } | Self::TimeWindow { revision_id, .. } => {
                Some(*revision_id)
            }
            Self::Unknown => None,
        }
    }
}

/// What acceptance recorded: the inspected SHA-256 the bytes matched, with
/// the observation fingerprint (RES-FR-04).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultAcceptance {
    pub sha256: String,
    pub fingerprint: ObservationFingerprint,
    pub accepted_at: String,
}

/// One Result record.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultRecord {
    pub id: Uuid,
    pub owner: ResultOwner,
    pub path: NativePath,
    pub kind: Option<ResultKind>,
    pub availability: Availability,
    pub state: ResultState,
    pub association: ResultAssociation,
    pub lineage: ResultLineage,
    pub attribution: RevisionAttribution,
    /// The SHA-256 the latest inspection read; `None` while Pending and for
    /// intermediates, which are never hashed.
    pub sha256: Option<String>,
    pub fingerprint: Option<ObservationFingerprint>,
    /// Kept as history while the bytes drift (RES-AC-09).
    pub accepted: Option<ResultAcceptance>,
    /// An accepted Result whose latest inspection read other bytes: reference
    /// drift. It stays protected and is not reused until the accepted bytes
    /// return or the current bytes are accepted (RES-FR-05).
    pub drifted: bool,
    pub discovered_at: String,
    pub updated_at: String,
}

impl ResultRecord {
    /// The file name, as a refusal or blocker names the Result.
    #[must_use]
    pub fn name(&self) -> String {
        self.path
            .to_path_buf()
            .ok()
            .and_then(|path| path.file_name().map(|name| name.to_string_lossy().into_owned()))
            .unwrap_or_else(|| self.path.display())
    }
}

/// The state of the once-only Add to calibration library offer (CAL-FR-06).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MasterOfferState {
    Offered,
    /// Declined for this file and digest: the offer does not return, and the
    /// master stays listed as a candidate in Calibration.
    Dismissed,
    Adopted,
}

/// A generated calibration master Results discovery found, keyed by file and
/// digest: changed content is a new offer (CAL-FR-06, CAL-AC-12).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterOffer {
    pub id: Uuid,
    pub result_id: Uuid,
    pub path: NativePath,
    pub sha256: String,
    pub classification: Classification,
    pub observed: CaptureMetadata,
    pub origin: MasterOrigin,
    pub state: MasterOfferState,
    pub offered_at: String,
    pub decided_at: Option<String>,
}

/// The Results step of one owner (RES-FR-01/02): candidates (Pending,
/// discovered, attached and accepted ones), intermediates apart, and the
/// master offers still open for each master's current bytes.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultsListing {
    pub owner: ResultOwner,
    /// The recorded Results folder; `None` until the owner is prepared.
    pub folder: Option<NativePath>,
    pub candidates: Vec<ResultRecord>,
    pub intermediates: Vec<ResultRecord>,
    pub offers: Vec<MasterOffer>,
}

/// One product to accept, optionally naming its kind.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptResult {
    pub result_id: Uuid,
    #[serde(default)]
    pub kind: Option<ResultKind>,
}

/// A product acceptance refused, with the change or state that refused it.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptRefusal {
    pub result_id: Uuid,
    pub reason: String,
}

/// Accept Result: each product is accepted or refused on its own (RES-AC-10).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptOutcome {
    pub accepted: Vec<ResultRecord>,
    pub refused: Vec<AcceptRefusal>,
}

/// Where an accepted product comes from, as the input picker groups and
/// labels it: originating Project and owner, subject and rig (RES-FR-05).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultProvenance {
    pub project_id: Uuid,
    pub project_name: String,
    pub owner: ResultOwner,
    pub owner_name: String,
    pub subject_id: Uuid,
    pub subject_name: String,
    pub target_id: Uuid,
    pub rig_id: Uuid,
    pub rig_name: String,
}

/// An accepted Result with where it comes from.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptedResult {
    pub result: ResultRecord,
    pub origin: ResultProvenance,
}

/// What the rehash before offering read (RES-FR-05).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum InputVerification {
    /// The current bytes hash to the acceptance digest: offered.
    Verified,
    /// Reference drift: not offered until the accepted bytes return or the
    /// current bytes are accepted.
    Drifted { current_sha256: String },
    /// The file cannot be read now: not offered.
    Unavailable { availability: Availability, reason: String },
}

/// One accepted product in a run's Results input filter, after its rehash.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultInputOffer {
    pub result: ResultRecord,
    pub origin: ResultProvenance,
    pub verification: InputVerification,
}

impl ResultInputOffer {
    /// Whether the picker offers it: only verified bytes are reused.
    #[must_use]
    pub fn offered(&self) -> bool {
        self.verification == InputVerification::Verified
    }
}

/// A product input of a run: the accepted Result and the SHA-256 it had when
/// it was added. It adds no members and no integration (RES-FR-05).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductInput {
    pub view_id: Uuid,
    pub result: ResultRecord,
    pub origin: ResultProvenance,
    pub sha256: String,
    pub added_at: String,
}
