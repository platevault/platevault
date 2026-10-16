// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Session calibration pins (spec 064 LIB-FR-23 to LIB-FR-25, 068 CAL-FR-19
//! to CAL-FR-23; D-W101 to D-W106, D-W113). Flats, darks and bias are matched
//! to each light session at ingestion and pinned on the session; every
//! Project looks up its sessions' calibration. Each kind is unresolved,
//! suggested (waiting for confirmation), pinned to a raw set or a dated
//! master version with its exact files and digests, or explicitly No. A
//! session is settled when every kind is pinned or No; a suggestion never
//! settles. A pin stays when its file changes or goes missing: the session
//! shows it, reads Needs calibration, and Apply refuses until it is
//! reassigned (decision record §9). CAL owns matching, confirmation and
//! reassignment; every change advances the session's calibration generation,
//! which writers compare before they write.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use time::Date;
use uuid::Uuid;

use crate::{
    require_sha256, Evaluation, InputKind, InputRef, LibraryError, ObservationFingerprint, Revision,
};

fn invalid(message: String) -> LibraryError {
    LibraryError::InvalidInput(message)
}

/// One file a pin binds, with the SHA-256 hashed for it. A raw set's frames
/// name their assets; a master's one file has none.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinnedFile {
    pub asset_id: Option<Uuid>,
    pub sha256: String,
    pub fingerprint: ObservationFingerprint,
}

/// What a pin or a suggestion names: a raw set or a master version, the
/// capture date its age counts from, its exact files, and the evaluation
/// that explains the match.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinTarget {
    pub input: InputRef,
    #[serde(default, with = "crate::iso_date::option")]
    pub captured: Option<Date>,
    pub files: Vec<PinnedFile>,
    pub evaluation: Evaluation,
}

impl PinTarget {
    /// A raw set names each of its frames once; a master is exactly one file
    /// with no asset; every digest is SHA-256.
    ///
    /// # Errors
    /// `InvalidInput` naming what is wrong.
    pub fn validate(&self) -> Result<(), LibraryError> {
        if self.files.is_empty() {
            return Err(invalid("a pin names at least one file".into()));
        }
        for file in &self.files {
            require_sha256("a pinned file's digest", &file.sha256)?;
        }
        match self.input {
            InputRef::Master { master_id, .. } => {
                if self.files.len() != 1 || self.files[0].asset_id.is_some() {
                    return Err(invalid(format!("master {master_id} is pinned as its one file")));
                }
            }
            InputRef::RawSet { session_id, .. } => {
                let mut seen = BTreeSet::new();
                for file in &self.files {
                    let Some(asset) = file.asset_id else {
                        return Err(invalid(format!("raw set {session_id} names each frame")));
                    };
                    if !seen.insert(asset) {
                        return Err(invalid(format!("raw set {session_id} names {asset} twice")));
                    }
                }
            }
        }
        Ok(())
    }
}

/// How a pin was made.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PinOrigin {
    /// Every check passed inside the window: pinned at ingestion or when
    /// calibration arrived later.
    Automatic,
    /// The user confirmed a suggestion.
    Confirmed,
    /// The user reassigned the kind.
    Reassigned,
}

/// Who set a kind to No. The No choice needs no reason.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeclineOrigin {
    User,
    /// The camera's "Don't use darks" or "Don't use bias" default.
    CameraDefault,
}

/// One kind's calibration state on a session.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum PinState {
    /// Not found, or waiting for calibration to arrive.
    Unresolved,
    /// Outside the window, warned or unknown: shown with its evidence until
    /// the user confirms it. Never settled.
    Suggested {
        target: PinTarget,
    },
    Pinned {
        target: PinTarget,
        origin: PinOrigin,
    },
    /// No darks, No flats or No bias.
    Declined {
        origin: DeclineOrigin,
    },
}

impl PinState {
    #[must_use]
    pub const fn is_settled(&self) -> bool {
        matches!(self, Self::Pinned { .. } | Self::Declined { .. })
    }

    /// The stored state name.
    #[must_use]
    pub const fn name(&self) -> &'static str {
        match self {
            Self::Unresolved => "unresolved",
            Self::Suggested { .. } => "suggested",
            Self::Pinned { .. } => "pinned",
            Self::Declined { .. } => "declined",
        }
    }

    /// The pinned or suggested target.
    #[must_use]
    pub const fn target(&self) -> Option<&PinTarget> {
        match self {
            Self::Suggested { target } | Self::Pinned { target, .. } => Some(target),
            Self::Unresolved | Self::Declined { .. } => None,
        }
    }

    /// The settled pin, `None` while unresolved or only suggested.
    #[must_use]
    pub fn settled(&self) -> Option<SettledPin> {
        match self {
            Self::Pinned { target, .. } => Some(SettledPin::Pinned { target: target.clone() }),
            Self::Declined { .. } => Some(SettledPin::Declined),
            Self::Unresolved | Self::Suggested { .. } => None,
        }
    }
}

/// A settled kind as an applied View or a Closed snapshot records it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum SettledPin {
    Pinned { target: PinTarget },
    Declined,
}

impl SettledPin {
    #[must_use]
    pub const fn target(&self) -> Option<&PinTarget> {
        match self {
            Self::Pinned { target } => Some(target),
            Self::Declined => None,
        }
    }
}

/// The three kinds of a settled session.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettledCalibration {
    pub dark: SettledPin,
    pub flat: SettledPin,
    pub bias: SettledPin,
}

impl SettledCalibration {
    #[must_use]
    pub const fn kind(&self, kind: InputKind) -> &SettledPin {
        match kind {
            InputKind::Bias => &self.bias,
            InputKind::Dark => &self.dark,
            InputKind::Flat => &self.flat,
        }
    }

    /// # Errors
    /// `InvalidInput` for an invalid pinned target.
    pub fn validate(&self, session_id: Uuid) -> Result<(), LibraryError> {
        for pin in [&self.dark, &self.flat, &self.bias] {
            if let Some(target) = pin.target() {
                validate_target(session_id, target)?;
            }
        }
        Ok(())
    }
}

fn validate_target(session_id: Uuid, target: &PinTarget) -> Result<(), LibraryError> {
    if matches!(target.input, InputRef::RawSet { session_id: own, .. } if own == session_id) {
        return Err(invalid(format!("session {session_id} never calibrates itself")));
    }
    target.validate()
}

/// One light session's calibration. `generation` 0 means no record yet:
/// every kind reads unresolved.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCalibration {
    pub session_id: Uuid,
    pub generation: Revision,
    /// Matching still has to run for this session (ingestion, a rig
    /// confirmation or calibration arriving later).
    pub matching_pending: bool,
    pub dark: PinState,
    pub flat: PinState,
    pub bias: PinState,
}

impl SessionCalibration {
    /// A session with no calibration record.
    #[must_use]
    pub const fn unresolved(session_id: Uuid) -> Self {
        Self {
            session_id,
            generation: 0,
            matching_pending: false,
            dark: PinState::Unresolved,
            flat: PinState::Unresolved,
            bias: PinState::Unresolved,
        }
    }

    #[must_use]
    pub const fn kind(&self, kind: InputKind) -> &PinState {
        match kind {
            InputKind::Bias => &self.bias,
            InputKind::Dark => &self.dark,
            InputKind::Flat => &self.flat,
        }
    }

    /// The kinds neither pinned nor No, in kind order.
    #[must_use]
    pub fn unsettled_kinds(&self) -> Vec<InputKind> {
        [InputKind::Bias, InputKind::Dark, InputKind::Flat]
            .into_iter()
            .filter(|kind| !self.kind(*kind).is_settled())
            .collect()
    }

    /// The settled calibration, `None` while any kind is not settled.
    #[must_use]
    pub fn settled(&self) -> Option<SettledCalibration> {
        Some(SettledCalibration {
            dark: self.dark.settled()?,
            flat: self.flat.settled()?,
            bias: self.bias.settled()?,
        })
    }

    /// Every pinned or suggested target is valid and none is this session.
    ///
    /// # Errors
    /// `InvalidInput` naming the target.
    pub fn validate(&self) -> Result<(), LibraryError> {
        for state in [&self.dark, &self.flat, &self.bias] {
            if let Some(target) = state.target() {
                validate_target(self.session_id, target)?;
            }
        }
        Ok(())
    }

    /// Why the session is in the Library's Needs calibration queue, in kind
    /// order: a kind neither pinned nor No, or a pinned kind whose files
    /// `health` reports changed or missing. Any session can be in the queue,
    /// Ready or not; Import never waits for it.
    #[must_use]
    pub fn needs(&self, health: impl Fn(InputKind) -> PinHealth) -> Vec<CalibrationNeed> {
        [InputKind::Bias, InputKind::Dark, InputKind::Flat]
            .into_iter()
            .filter_map(|kind| match self.kind(kind) {
                PinState::Unresolved | PinState::Suggested { .. } => {
                    Some(CalibrationNeed::Unsettled { kind })
                }
                PinState::Pinned { .. } => {
                    let health = health(kind);
                    health.blocks_apply().then_some(CalibrationNeed::PinDrift { kind, health })
                }
                PinState::Declined { .. } => None,
            })
            .collect()
    }
}

/// Whether a pin's files still hold what it recorded (D-W113). Computed on
/// read, never stored: the pin stays, the session shows the file as changed
/// or missing and reads Needs calibration, and Apply refuses until the kind
/// is reassigned or the bytes return.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PinHealth {
    Intact,
    Changed,
    Missing,
}

impl PinHealth {
    #[must_use]
    pub const fn blocks_apply(self) -> bool {
        !matches!(self, Self::Intact)
    }
}

/// One reason a session is in the Library's Needs calibration queue
/// (LIB-FR-17, LIB-FR-23; decision record §9).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(tag = "need", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum CalibrationNeed {
    /// Neither pinned nor No: "Choose its flats first".
    Unsettled { kind: InputKind },
    /// The pin stays, but its file changed or went missing.
    PinDrift { kind: InputKind, health: PinHealth },
}
