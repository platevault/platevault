// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Grouping engine input view.

use metadata_core::FrameType;

/// Effective per-file metadata consumed by the grouping engine.
///
/// This is a thin, owned view over the inbox metadata model (built from
/// `RawFileMetadata` / `inbox_file_metadata` with overrides already applied by
/// the caller). It is deliberately decoupled from DB row types so the engine
/// stays pure and trivially unit-testable.
///
/// All fields are `Option` because any header keyword may be absent; a missing
/// *enabled* dimension renders the [`crate::grouping::SENTINEL_MISSING`]
/// marker in the key.
///
/// `Default` is provided manually (the upstream [`FrameType`] enum has no
/// `Default`); it defaults to [`FrameType::Light`] purely for ergonomic test /
/// builder construction — callers always set the authoritative type.
#[derive(Clone, Debug, PartialEq)]
pub struct FrameMetadata {
    /// Authoritative frame type (override ?? extracted). Drives recipe choice.
    pub frame_type: FrameType,
    /// `FILTER`.
    pub filter: Option<String>,
    /// Exposure seconds (`EXPTIME`/`EXPOSURE`).
    pub exposure_s: Option<f64>,
    /// `GAIN` (kept as a string — some cameras report scaled/non-integer gain).
    pub gain: Option<String>,
    /// Camera read-out offset / pedestal (`OFFSET`).
    pub offset: Option<i64>,
    /// Binning factor X (`XBINNING`).
    pub binning_x: Option<i32>,
    /// Binning factor Y (`YBINNING`).
    pub binning_y: Option<i32>,
    /// Sensor set/target temperature (`SET-TEMP`). Default dark-temp source.
    pub set_temp_c: Option<f64>,
    /// Sensor actual temperature (`CCD-TEMP` → `DET-TEMP`). Deviation source.
    pub ccd_temp_c: Option<f64>,
    /// Right ascension in decimal degrees (`RA` ← `OBJCTRA`).
    pub ra_deg: Option<f64>,
    /// Declination in decimal degrees (`DEC` ← `OBJCTDEC`).
    pub dec_deg: Option<f64>,
    /// Mechanical rotator angle (`ROTATANG`). NOT `OBJCTROT` (R-18).
    pub rotator_angle_deg: Option<f64>,
    /// Sensor readout mode (`READOUTM`). Optional grouping dim.
    pub readout_mode: Option<String>,
    /// Telescope identifier (`TELESCOP`). Optic-train input.
    pub telescop: Option<String>,
    /// Camera/instrument identifier (`INSTRUME`). Camera dim + optic-train input.
    pub instrume: Option<String>,
    /// Focal length in millimetres (`FOCALLEN`). Optic-train input (captures
    /// focal reducers implicitly — R-9/FR-039).
    pub focal_length_mm: Option<f64>,
    /// Local civil time of observation (`DATE-LOC`). Observing-night source.
    pub date_loc: Option<String>,
    /// UTC observation start (`DATE-OBS`). Observing-night fallback.
    pub date_obs: Option<String>,
}

impl Default for FrameMetadata {
    fn default() -> Self {
        Self {
            frame_type: FrameType::Light,
            filter: None,
            exposure_s: None,
            gain: None,
            offset: None,
            binning_x: None,
            binning_y: None,
            set_temp_c: None,
            ccd_temp_c: None,
            ra_deg: None,
            dec_deg: None,
            rotator_angle_deg: None,
            readout_mode: None,
            telescop: None,
            instrume: None,
            focal_length_mm: None,
            date_loc: None,
            date_obs: None,
        }
    }
}
