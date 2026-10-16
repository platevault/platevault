// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! A Project's `Output/` and the once-only master offer from `Processing/`
//! (spec 070 RES-FR-01/02/06 to RES-FR-08/11; D-W93, D-W98).
//!
//! Every file in `Output/` is a Result: tools never write there, so nothing
//! needs accepting and a tool rerun never overwrites one. `PlateVault` watches
//! the whole folder and records what it observes; Copy to Output lists a file
//! only after its copy is re-read against the source's SHA-256. A file
//! belongs to a mosaic panel only by being under `Output/Panels/<group>/`.
//! No Result records which inputs produced it. OUTPUT owns the watcher and
//! Copy to Output; CAL owns the master offer.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    relative_parts, require_sha256, Classification, InputKind, LibraryError, NativePath,
    ObservationFingerprint,
};

fn invalid(message: String) -> LibraryError {
    LibraryError::InvalidInput(message)
}

/// The folder under `Output/` that holds each panel's result.
pub const OUTPUT_PANELS: &str = "Panels";

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

/// What a Result is; the user picks it from a dropdown when it isn't known.
#[derive(Clone, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum OutputKind {
    FinalImage,
    LinearIntegration,
    ChannelProduct,
    CalibrationMaster { input: InputKind },
    Other { label: String },
}

/// Where an observed file stands.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputState {
    /// "Still being written": its size or time is still changing.
    Settling,
    Settled,
    /// Its folder couldn't be read: unknown, never removed.
    Unreadable,
}

/// How a file came to be in `Output/`.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputOrigin {
    /// Saved there by the user or a tool, and found by the watcher.
    Observed,
    /// Copy to Output, verified against the source's digest.
    Copied,
}

/// One file of a Project's `Output/`, relative to that folder.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputObservation {
    pub path: NativePath,
    pub kind: Option<OutputKind>,
    pub channel: Option<String>,
    /// The panel group whose `Output/Panels/` folder holds the file.
    pub panel_group_id: Option<Uuid>,
    pub state: OutputState,
    pub size_bytes: u64,
    pub fingerprint: Option<ObservationFingerprint>,
    /// The digest Copy to Output verified; the watcher never hashes.
    pub sha256: Option<String>,
    pub origin: OutputOrigin,
}

impl OutputObservation {
    /// A path inside `Output/`; a panel only under `Output/Panels/<group>/`;
    /// a copy with its verified digest; a channel that is not blank.
    ///
    /// # Errors
    /// `InvalidInput` naming the file.
    pub fn validate(&self) -> Result<(), LibraryError> {
        let parts = relative_parts("an Output path", &self.path)?;
        let shown = self.path.display();
        if self.panel_group_id.is_some()
            && (parts.len() < 3 || parts.first().map(String::as_str) != Some(OUTPUT_PANELS))
        {
            return Err(invalid(format!("{shown} is not in a panel's Output/Panels/ folder")));
        }
        if self.origin == OutputOrigin::Copied && self.sha256.is_none() {
            return Err(invalid(format!("{shown}: Copy to Output records the verified digest")));
        }
        if let Some(sha256) = &self.sha256 {
            require_sha256("an Output digest", sha256)?;
        }
        if self.channel.as_deref().is_some_and(|channel| channel.trim().is_empty()) {
            return Err(invalid(format!("{shown}: the channel is blank")));
        }
        Ok(())
    }
}

/// CAL's once-only offer of a generated master found in `Processing/`
/// (RES-FR-11, CAL-FR-06): one per Project and digest, with its own
/// Processing path, never a Result.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingMasterOffer {
    pub id: Uuid,
    pub project_id: Uuid,
    /// Relative to the Project's `Processing/`.
    pub path: NativePath,
    pub sha256: String,
    pub classification: Classification,
    pub state: MasterOfferState,
    pub offered_at: String,
    pub decided_at: Option<String>,
}

impl ProcessingMasterOffer {
    /// # Errors
    /// `InvalidInput` for a path outside `Processing/`, a file that is not a
    /// master, a malformed digest, or a decision time that disagrees with the
    /// state.
    pub fn validate(&self) -> Result<(), LibraryError> {
        relative_parts("a Processing path", &self.path)?;
        require_sha256("an offered master's digest", &self.sha256)?;
        if self.classification.master.is_none() {
            return Err(invalid(format!("{} is not a master", self.path.display())));
        }
        if (self.state == MasterOfferState::Offered) != self.decided_at.is_none() {
            return Err(invalid(format!("offer {}: decided exactly once answered", self.id)));
        }
        Ok(())
    }
}
