// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Identity dimensions a group key can be built from.

/// The identity dimensions a group key can be built from (R-9). Each is
/// individually toggleable per frame type (FR-035).
///
/// The declaration order here is the **canonical serialization order**: the key
/// renders enabled dimensions in this fixed order regardless of config field
/// order, so the same metadata + recipe always yields the same key (FR-042).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Dimension {
    /// Camera (`INSTRUME`).
    Camera,
    /// Optical train composite (`TELESCOP` + `INSTRUME` + `FOCALLEN`) — FR-039.
    OpticTrain,
    /// `FILTER`.
    Filter,
    /// Exposure seconds, bucketed to canonical seconds (FR-036).
    Exposure,
    /// `GAIN`.
    Gain,
    /// `OFFSET`.
    Offset,
    /// Set-temperature, bucketed (FR-037). Default source `SET-TEMP`.
    SetTemp,
    /// Binning (`XBINNING`x`YBINNING`).
    Binning,
    /// Pointing (RA/Dec) within `pointing_tolerance_deg` (FR-038).
    Pointing,
    /// Mechanical rotator angle (`ROTATANG`) within tolerance (FR-040, R-18).
    Rotation,
    /// Readout mode (`READOUTM`) — optional, default OFF.
    Readout,
    /// Observing-night (`DATE-LOC` → `DATE-OBS`).
    ObservingNight,
}

impl Dimension {
    /// Fixed canonical order index (lower renders first in the key).
    #[must_use]
    pub(super) const fn order(self) -> u8 {
        match self {
            Self::Camera => 0,
            Self::OpticTrain => 1,
            Self::Filter => 2,
            Self::Exposure => 3,
            Self::Gain => 4,
            Self::Offset => 5,
            Self::SetTemp => 6,
            Self::Binning => 7,
            Self::Pointing => 8,
            Self::Rotation => 9,
            Self::Readout => 10,
            Self::ObservingNight => 11,
        }
    }

    /// Short stable key name used in the canonical serialization.
    #[must_use]
    pub(super) const fn key_name(self) -> &'static str {
        match self {
            Self::Camera => "camera",
            Self::OpticTrain => "optic_train",
            Self::Filter => "filter",
            Self::Exposure => "exposure",
            Self::Gain => "gain",
            Self::Offset => "offset",
            Self::SetTemp => "set_temp",
            Self::Binning => "binning",
            Self::Pointing => "pointing",
            Self::Rotation => "rotation",
            Self::Readout => "readout",
            Self::ObservingNight => "night",
        }
    }
}
