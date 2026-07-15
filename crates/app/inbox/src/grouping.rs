// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Pure grouping engine for single-type inbox sub-items (spec 041 T064).
//!
//! Implements the deterministic **group-key recipe** from research R-9 and the
//! rotation/pointing/temperature/time semantics from R-18. Given a file's
//! effective metadata plus a per-frame-type [`GroupingConfig`], it produces a
//! canonical [`GroupKey`] (stable across rescans — FR-042) and a human
//! [`GroupLabel`].
//!
//! This module is a **pure function over metadata** — no DB, no I/O. The
//! persistence/classify integration (materializing sub-items) is a separate
//! task (T066) and does NOT live here.
//!
//! # Recipe summary (R-9, FR-035…FR-040)
//!
//! | type  | default identity dimensions (beyond `frame_type`)                                                                            |
//! |-------|------------------------------------------------------------------------------------------------------------------------------|
//! | light | optic-train(`TELESCOP`+`INSTRUME`+`FOCALLEN`), filter, exposure*, gain, offset, binning, pointing(RA/Dec)†, rotation†, night |
//! | dark  | camera(`INSTRUME`), exposure*, gain, offset, set-temp‡, binning, readout∘                                                     |
//! | bias  | camera, gain, offset, binning, readout∘, night                                                                               |
//! | flat  | camera, optic-train, filter (required), gain, offset, binning, rotation†, readout∘, night                                    |
//!
//! `*` exposure bucketed to canonical seconds. `‡` set-temp bucketed to the
//! configured tolerance. `†` pointing & rotation grouped *within* a tolerance.
//! `∘` readout-mode optional, OFF by default. Lights deliberately do **not**
//! group by temperature (R-9). Rotation uses `ROTATANG` (mechanical), never
//! `OBJCTROT` (R-18).
#![allow(clippy::doc_markdown)] // spec/FITS terminology not appropriate for backticks

use std::fmt::Write as _;

use metadata_core::FrameType;

// ── Input view ──────────────────────────────────────────────────────────────────

/// Effective per-file metadata consumed by the grouping engine.
///
/// This is a thin, owned view over the inbox metadata model (built from
/// `RawFileMetadata` / `inbox_file_metadata` with overrides already applied by
/// the caller). It is deliberately decoupled from DB row types so the engine
/// stays pure and trivially unit-testable.
///
/// All fields are `Option` because any header keyword may be absent; a missing
/// *enabled* dimension renders the [`SENTINEL_MISSING`] marker in the key.
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

// ── Dimensions ──────────────────────────────────────────────────────────────────

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
    const fn order(self) -> u8 {
        match self {
            Dimension::Camera => 0,
            Dimension::OpticTrain => 1,
            Dimension::Filter => 2,
            Dimension::Exposure => 3,
            Dimension::Gain => 4,
            Dimension::Offset => 5,
            Dimension::SetTemp => 6,
            Dimension::Binning => 7,
            Dimension::Pointing => 8,
            Dimension::Rotation => 9,
            Dimension::Readout => 10,
            Dimension::ObservingNight => 11,
        }
    }

    /// Short stable key name used in the canonical serialization.
    #[must_use]
    const fn key_name(self) -> &'static str {
        match self {
            Dimension::Camera => "camera",
            Dimension::OpticTrain => "optic_train",
            Dimension::Filter => "filter",
            Dimension::Exposure => "exposure",
            Dimension::Gain => "gain",
            Dimension::Offset => "offset",
            Dimension::SetTemp => "set_temp",
            Dimension::Binning => "binning",
            Dimension::Pointing => "pointing",
            Dimension::Rotation => "rotation",
            Dimension::Readout => "readout",
            Dimension::ObservingNight => "night",
        }
    }
}

// ── Config ──────────────────────────────────────────────────────────────────────

/// Sentinel rendered for an enabled dimension that has no value (R-11).
pub const SENTINEL_MISSING: &str = "∅";

/// Per-frame-type grouping configuration: which identity dimensions are enabled
/// plus the bucket sizes / tolerances for continuous dimensions.
///
/// Built-in defaults come from the R-9 recipe table ([`GroupingConfig::default_for`]).
/// Every dimension is individually toggleable (FR-035) and every continuous
/// bucket size is configurable (FR-036).
#[derive(Clone, Debug, PartialEq)]
pub struct GroupingConfig {
    /// The frame type this config applies to.
    pub frame_type: FrameType,
    /// Enabled dimensions, in canonical order. Disabled dims are simply absent.
    dimensions: Vec<Dimension>,

    /// Exposure bucket size in seconds (continuous → canonical seconds). Values
    /// are rounded to the nearest multiple of this. `0` ⇒ no bucketing.
    pub exposure_bucket_s: f64,
    /// Set-temperature bucket size in °C (FR-037, default 2 °C).
    pub set_temp_tolerance_c: f64,
    /// Source for the temperature dimension (R-9 / FR-037).
    pub temp_source: TempSource,
    /// `CCD-TEMP`-vs-`SET-TEMP` deviation threshold for the quality warning
    /// (FR-037, default 2 °C). Exceeding it warns but does NOT split.
    pub temp_deviation_warn_c: f64,
    /// Pointing tolerance in degrees (FR-038); RA/Dec snapped to this grid.
    pub pointing_tolerance_deg: f64,
    /// Light rotation tolerance in degrees (FR-040); ROTATANG snapped to this
    /// grid for *grouping* (the flat↔light applicability check is separate).
    pub rotation_tolerance_deg: f64,
    /// When `ROTATANG` is absent on a flat, whether rotation is required
    /// (FR-040, default OFF — missing rotation does not exclude).
    pub flat_rotation_required: bool,
}

/// Which header drives the temperature grouping dimension (R-9 / FR-037).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TempSource {
    /// `SET-TEMP` (the setpoint governs the group — default).
    SetTemp,
    /// `CCD-TEMP` (toggle).
    CcdTemp,
}

impl GroupingConfig {
    /// Built-in default recipe for a frame type, exactly per the R-9 table.
    ///
    /// - **light**: optic-train + filter + exposure + gain + offset + binning +
    ///   pointing + rotation + observing-night. **No temperature** (R-9).
    /// - **dark**: camera + exposure + gain + offset + set-temp + binning;
    ///   readout optional (OFF); night OFF (darks span nights).
    /// - **bias**: camera + gain + offset + binning + night; readout optional;
    ///   exposure excluded (≈0).
    /// - **flat**: camera + optic-train + filter + gain + offset + binning +
    ///   rotation + night; readout optional; exposure excluded; filter required.
    /// - **dark_flat**: treated like a dark (set-temp + exposure key), no optics.
    #[must_use]
    pub fn default_for(frame_type: FrameType) -> Self {
        use Dimension::{
            Binning, Camera, Exposure, Filter, Gain, ObservingNight, Offset, OpticTrain, Pointing,
            Rotation, SetTemp,
        };
        let dimensions = match frame_type {
            FrameType::Light => vec![
                OpticTrain,
                Filter,
                Exposure,
                Gain,
                Offset,
                Binning,
                Pointing,
                Rotation,
                ObservingNight,
            ],
            FrameType::Dark | FrameType::DarkFlat => {
                vec![Camera, Exposure, Gain, Offset, SetTemp, Binning]
            }
            FrameType::Bias => vec![Camera, Gain, Offset, Binning, ObservingNight],
            FrameType::Flat => {
                vec![Camera, OpticTrain, Filter, Gain, Offset, Binning, Rotation, ObservingNight]
            }
        };
        Self {
            frame_type,
            dimensions: sorted_unique(dimensions),
            exposure_bucket_s: 1.0,
            set_temp_tolerance_c: 2.0,
            temp_source: TempSource::SetTemp,
            temp_deviation_warn_c: 2.0,
            pointing_tolerance_deg: 0.5,
            rotation_tolerance_deg: 1.0,
            flat_rotation_required: false,
        }
    }

    /// Whether a dimension is currently enabled.
    #[must_use]
    pub fn has(&self, dim: Dimension) -> bool {
        self.dimensions.contains(&dim)
    }

    /// Enable a dimension (idempotent; keeps canonical order). FR-035 toggle.
    pub fn enable(&mut self, dim: Dimension) {
        if !self.dimensions.contains(&dim) {
            self.dimensions.push(dim);
            self.dimensions = sorted_unique(std::mem::take(&mut self.dimensions));
        }
    }

    /// Disable a dimension (idempotent). FR-035 toggle.
    pub fn disable(&mut self, dim: Dimension) {
        self.dimensions.retain(|d| *d != dim);
    }

    /// The enabled dimensions in canonical order (read-only).
    #[must_use]
    pub fn dimensions(&self) -> &[Dimension] {
        &self.dimensions
    }
}

/// Sort dimensions by canonical order and drop duplicates.
fn sorted_unique(mut dims: Vec<Dimension>) -> Vec<Dimension> {
    dims.sort_by_key(|d| d.order());
    dims.dedup();
    dims
}

// ── Output ──────────────────────────────────────────────────────────────────────

/// A deterministic, canonical group key (R-11). Equal keys ⇒ same sub-item.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct GroupKey(pub String);

impl GroupKey {
    /// The canonical string.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for GroupKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// A non-blocking, surfaced metadata-quality warning (R-9 / R-18). Warnings
/// never split a group — they annotate it.
#[derive(Clone, Debug, PartialEq)]
pub enum GroupWarning {
    /// `CCD-TEMP` deviates from `SET-TEMP` beyond the configured threshold
    /// (FR-037). The setpoint still governs the group.
    TempDeviation {
        /// Deviation magnitude in °C.
        deviation_c: f64,
        /// Configured threshold in °C.
        threshold_c: f64,
    },
    /// A flat lacks `ROTATANG` while rotation matching is enabled, and
    /// `flat_rotation_required` is OFF (FR-040, R-18). Matched without rotation.
    RotationUnavailable,
}

/// The full result of grouping one file.
#[derive(Clone, Debug, PartialEq)]
pub struct GroupResult {
    /// Deterministic canonical key (R-11, FR-042).
    pub key: GroupKey,
    /// Human label `"(root) · <type> · <discriminating dims>"` (R-12).
    pub label: GroupLabel,
    /// Non-blocking metadata-quality warnings.
    pub warnings: Vec<GroupWarning>,
}

/// A human-readable group label (R-12).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GroupLabel(pub String);

impl std::fmt::Display for GroupLabel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

// ── Engine ──────────────────────────────────────────────────────────────────────

/// Compute the deterministic group key + label + warnings for one file.
///
/// The key is a canonical serialization of `frame_type` followed by each
/// **enabled** dimension's normalized/bucketed value, rendered in the fixed
/// [`Dimension::order`] order. A missing value for an enabled dimension renders
/// [`SENTINEL_MISSING`]. Identical `(metadata, config)` always yields an
/// identical key (FR-042) — there is no clock, hashing of floats, or map
/// iteration involved.
///
/// `config.frame_type` is ignored in favour of `meta.frame_type` for the type
/// token (the caller is expected to pass the matching config, but the key
/// always reflects the file's authoritative type).
#[must_use]
pub fn group_file(meta: &FrameMetadata, config: &GroupingConfig) -> GroupResult {
    let ft = meta.frame_type;

    // The key always opens with the authoritative type token.
    let mut key = format!("type={}", ft.as_str());
    // Label discriminators: only the dims that carry a present, meaningful value.
    let mut label_parts: Vec<String> = Vec::new();
    let mut warnings: Vec<GroupWarning> = Vec::new();

    for &dim in config.dimensions() {
        let value = render_dimension(dim, meta, config, &mut warnings);
        // Canonical key: every enabled dim contributes, sentinel when missing.
        let key_value = value.as_deref().unwrap_or(SENTINEL_MISSING);
        let _ = write!(key, "·{}={}", dim.key_name(), key_value);

        // Label: only present values become discriminators (sentinels are noise).
        if let Some(v) = value {
            if let Some(pretty) = label_value(dim, &v) {
                label_parts.push(pretty);
            }
        }
    }

    let mut label = format!("(root) · {}", ft.as_str());
    for part in &label_parts {
        let _ = write!(label, " · {part}");
    }

    GroupResult { key: GroupKey(key), label: GroupLabel(label), warnings }
}

/// Render one dimension to its canonical, normalized/bucketed string value.
/// Returns `None` when the underlying metadata is absent (→ sentinel in the
/// key). May push warnings (temperature deviation, missing rotation).
fn render_dimension(
    dim: Dimension,
    meta: &FrameMetadata,
    config: &GroupingConfig,
    warnings: &mut Vec<GroupWarning>,
) -> Option<String> {
    match dim {
        Dimension::Camera => normalize_text(meta.instrume.as_deref()),
        Dimension::OpticTrain => optic_train(meta),
        Dimension::Filter => normalize_text(meta.filter.as_deref()),
        Dimension::Exposure => {
            meta.exposure_s.map(|e| format_num(bucket(e, config.exposure_bucket_s)))
        }
        Dimension::Gain => normalize_text(meta.gain.as_deref()),
        Dimension::Offset => meta.offset.map(|o| o.to_string()),
        Dimension::SetTemp => temperature(meta, config, warnings),
        Dimension::Binning => binning(meta),
        Dimension::Pointing => pointing(meta, config.pointing_tolerance_deg),
        Dimension::Rotation => rotation(meta, config, warnings),
        Dimension::Readout => normalize_text(meta.readout_mode.as_deref()),
        Dimension::ObservingNight => observing_night(meta),
    }
}

/// Optic-train composite = `telescop|instrume|focallen` (FR-039). Built only
/// from present parts; entirely absent ⇒ `None` (sentinel). Each part is
/// normalized; focal length is bucketed to whole mm so float noise doesn't fork
/// the group.
fn optic_train(meta: &FrameMetadata) -> Option<String> {
    let tel = normalize_text(meta.telescop.as_deref());
    let inst = normalize_text(meta.instrume.as_deref());
    let fl = meta.focal_length_mm.map(|f| format_num(f.round()));
    if tel.is_none() && inst.is_none() && fl.is_none() {
        return None;
    }
    Some(format!(
        "{}|{}|{}",
        tel.as_deref().unwrap_or(SENTINEL_MISSING),
        inst.as_deref().unwrap_or(SENTINEL_MISSING),
        fl.as_deref().unwrap_or(SENTINEL_MISSING),
    ))
}

/// Temperature dimension (R-9 / FR-037). Bucketed `SET-TEMP` (or `CCD-TEMP`
/// per the toggle). When both temps are present and deviate beyond the warn
/// threshold, push a [`GroupWarning::TempDeviation`] but keep the setpoint
/// governing the group (no split).
fn temperature(
    meta: &FrameMetadata,
    config: &GroupingConfig,
    warnings: &mut Vec<GroupWarning>,
) -> Option<String> {
    // Deviation warning is independent of which source governs the group.
    if let (Some(set), Some(ccd)) = (meta.set_temp_c, meta.ccd_temp_c) {
        let deviation = (ccd - set).abs();
        if deviation > config.temp_deviation_warn_c {
            warnings.push(GroupWarning::TempDeviation {
                deviation_c: deviation,
                threshold_c: config.temp_deviation_warn_c,
            });
        }
    }

    let source = match config.temp_source {
        TempSource::SetTemp => meta.set_temp_c,
        TempSource::CcdTemp => meta.ccd_temp_c,
    };
    source.map(|t| format_num(bucket(t, config.set_temp_tolerance_c)))
}

/// Pointing dimension (FR-038). RA/Dec snapped to the tolerance grid so frames
/// within `pointing_tolerance_deg` share a bucket. Both must be present.
fn pointing(meta: &FrameMetadata, tolerance_deg: f64) -> Option<String> {
    let (ra, dec) = (meta.ra_deg?, meta.dec_deg?);
    let ra_b = format_num(bucket(ra, tolerance_deg));
    let dec_b = format_num(bucket(dec, tolerance_deg));
    Some(format!("{ra_b},{dec_b}"))
}

/// Rotation dimension for grouping (FR-040, R-18). Uses the mechanical
/// `ROTATANG`, NEVER `OBJCTROT`. Snapped to the rotation tolerance grid. When
/// absent on a flat with rotation enabled and `flat_rotation_required` OFF,
/// pushes [`GroupWarning::RotationUnavailable`] and returns `None` (sentinel).
fn rotation(
    meta: &FrameMetadata,
    config: &GroupingConfig,
    warnings: &mut Vec<GroupWarning>,
) -> Option<String> {
    if let Some(angle) = meta.rotator_angle_deg {
        return Some(format_num(bucket(angle, config.rotation_tolerance_deg)));
    }
    // Absent ROTATANG: on a flat (rotation enabled, not required) this is the
    // "matched without rotation" warn path (R-18); otherwise a plain sentinel.
    if meta.frame_type == FrameType::Flat && !config.flat_rotation_required {
        warnings.push(GroupWarning::RotationUnavailable);
    }
    None
}

/// Binning dimension, normalized to `"NxN"`. Requires both factors.
fn binning(meta: &FrameMetadata) -> Option<String> {
    match (meta.binning_x, meta.binning_y) {
        (Some(x), Some(y)) => Some(format!("{x}x{y}")),
        _ => None,
    }
}

/// Observing-night = local calendar date under a noon boundary (R-18). Source
/// priority `DATE-LOC → DATE-OBS`. We take the local date directly: NINA writes
/// `DATE-LOC` already in local civil time, so the calendar date *is* the
/// observing night for evening sessions. (A future enhancement may shift the
/// pre-noon hours back a day; the current rule keys on the rendered date so it
/// is deterministic.)
fn observing_night(meta: &FrameMetadata) -> Option<String> {
    let raw = meta
        .date_loc
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .or(meta.date_obs.as_deref())
        .filter(|s| !s.trim().is_empty())?;
    // Take the date portion before any 'T' (ISO-8601) or space separator.
    let date = raw.trim().split(['T', ' ']).next().unwrap_or(raw).trim();
    if date.is_empty() {
        None
    } else {
        Some(date.to_owned())
    }
}

// ── Value helpers ────────────────────────────────────────────────────────────────

/// Normalize free text (camera/filter/telescope/gain/readout): trim, collapse
/// internal whitespace, and case-fold so trivial header variations don't fork a
/// group. Empty ⇒ `None`.
fn normalize_text(value: Option<&str>) -> Option<String> {
    let v = value?.trim();
    if v.is_empty() {
        return None;
    }
    let collapsed: String = v.split_whitespace().collect::<Vec<_>>().join(" ");
    Some(collapsed.to_ascii_lowercase())
}

/// Snap a continuous value to the nearest multiple of `size` (FR-036). A
/// non-positive `size` disables bucketing (returns the value unchanged). The
/// result is canonicalized through [`format_num`] by the caller.
#[must_use]
fn bucket(value: f64, size: f64) -> f64 {
    if size <= 0.0 || !size.is_finite() {
        return value;
    }
    (value / size).round() * size
}

/// Canonical numeric formatting: integers render without a decimal point;
/// fractional values render with up to 6 significant decimals, trailing zeros
/// trimmed. `-0.0` normalizes to `0`. This makes the key stable regardless of
/// the float's binary representation (FR-042).
#[must_use]
fn format_num(value: f64) -> String {
    // Normalize negative zero.
    let v = if value == 0.0 { 0.0 } else { value };
    if v.fract() == 0.0 && v.abs() < 1e15 {
        // Whole number — render as an integer with no decimal point.
        #[allow(clippy::cast_possible_truncation)]
        return (v as i64).to_string();
    }
    // Fractional — fixed 6-dp then trim trailing zeros (deterministic).
    let mut s = format!("{v:.6}");
    while s.ends_with('0') {
        s.pop();
    }
    if s.ends_with('.') {
        s.pop();
    }
    s
}

/// Render a dimension's canonical value into a friendly label fragment, or
/// `None` to omit it from the label entirely (e.g. optic-train, which is too
/// verbose for the discriminator line).
fn label_value(dim: Dimension, value: &str) -> Option<String> {
    match dim {
        // Optic-train is part of identity but too verbose for the label line.
        Dimension::OpticTrain => None,
        // Dimensions whose raw normalized value reads cleanly on its own.
        Dimension::Camera
        | Dimension::Filter
        | Dimension::Binning
        | Dimension::Readout
        | Dimension::ObservingNight => Some(value.to_owned()),
        Dimension::Exposure => Some(format!("{value}s")),
        Dimension::Gain => Some(format!("gain {value}")),
        Dimension::Offset => Some(format!("offset {value}")),
        Dimension::SetTemp => Some(format!("{value}°C")),
        Dimension::Pointing => Some(format!("@{value}")),
        Dimension::Rotation => Some(format!("rot {value}°")),
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a light-frame metadata with sensible real-ish defaults.
    fn light_meta() -> FrameMetadata {
        FrameMetadata {
            frame_type: FrameType::Light,
            filter: Some("Ha".to_owned()),
            exposure_s: Some(300.0),
            gain: Some("100".to_owned()),
            offset: Some(20),
            binning_x: Some(1),
            binning_y: Some(1),
            ra_deg: Some(272.6820),
            dec_deg: Some(-15.0197),
            rotator_angle_deg: Some(12.43),
            telescop: Some("Celestron C925".to_owned()),
            instrume: Some("ASI2600MM".to_owned()),
            focal_length_mm: Some(525.0),
            date_loc: Some("2025-10-17T19:23:39".to_owned()),
            date_obs: Some("2025-10-17T15:23:39".to_owned()),
            ..Default::default()
        }
    }

    fn dark_meta() -> FrameMetadata {
        FrameMetadata {
            frame_type: FrameType::Dark,
            exposure_s: Some(300.0),
            gain: Some("100".to_owned()),
            offset: Some(20),
            set_temp_c: Some(-10.0),
            ccd_temp_c: Some(-10.1),
            binning_x: Some(1),
            binning_y: Some(1),
            instrume: Some("ASI2600MM".to_owned()),
            ..Default::default()
        }
    }

    fn flat_meta() -> FrameMetadata {
        FrameMetadata {
            frame_type: FrameType::Flat,
            filter: Some("Ha".to_owned()),
            gain: Some("100".to_owned()),
            offset: Some(20),
            binning_x: Some(1),
            binning_y: Some(1),
            rotator_angle_deg: Some(12.43),
            telescop: Some("Celestron C925".to_owned()),
            instrume: Some("ASI2600MM".to_owned()),
            focal_length_mm: Some(525.0),
            date_loc: Some("2025-10-17T19:23:39".to_owned()),
            ..Default::default()
        }
    }

    fn bias_meta() -> FrameMetadata {
        FrameMetadata {
            frame_type: FrameType::Bias,
            gain: Some("100".to_owned()),
            offset: Some(20),
            binning_x: Some(1),
            binning_y: Some(1),
            instrume: Some("ASI2600MM".to_owned()),
            date_loc: Some("2025-10-17T19:23:39".to_owned()),
            ..Default::default()
        }
    }

    // ── Determinism (FR-042) ──────────────────────────────────────────────────

    #[test]
    fn identical_input_yields_identical_key() {
        let cfg = GroupingConfig::default_for(FrameType::Light);
        let a = group_file(&light_meta(), &cfg);
        let b = group_file(&light_meta(), &cfg);
        assert_eq!(a.key, b.key, "same metadata + recipe ⇒ same key (rescan stability)");
        assert_eq!(a.label, b.label);
    }

    #[test]
    fn key_dimension_order_is_canonical_not_config_order() {
        // Two configs with the SAME enabled dims added in different orders must
        // produce byte-identical keys.
        let mut a = GroupingConfig::default_for(FrameType::Dark);
        // Rebuild dark recipe by disabling everything then enabling in reverse.
        for d in [
            Dimension::Camera,
            Dimension::Exposure,
            Dimension::Gain,
            Dimension::Offset,
            Dimension::SetTemp,
            Dimension::Binning,
        ] {
            a.disable(d);
        }
        for d in [
            Dimension::Binning,
            Dimension::SetTemp,
            Dimension::Offset,
            Dimension::Gain,
            Dimension::Exposure,
            Dimension::Camera,
        ] {
            a.enable(d);
        }
        let b = GroupingConfig::default_for(FrameType::Dark);
        assert_eq!(group_file(&dark_meta(), &a).key, group_file(&dark_meta(), &b).key);
    }

    // ── Per-type recipe coverage (R-9, FR-035) ────────────────────────────────

    #[test]
    fn light_recipe_has_no_temperature_dimension() {
        let cfg = GroupingConfig::default_for(FrameType::Light);
        assert!(!cfg.has(Dimension::SetTemp), "lights MUST NOT group by temperature (R-9)");
        assert!(cfg.has(Dimension::Pointing));
        assert!(cfg.has(Dimension::Rotation));
        assert!(cfg.has(Dimension::OpticTrain));
        assert!(cfg.has(Dimension::ObservingNight));
        // The key must not contain a temperature token.
        let key = group_file(&light_meta(), &cfg).key.0;
        assert!(!key.contains("set_temp="), "no set_temp token in a light key: {key}");
    }

    #[test]
    fn light_key_contains_expected_tokens_in_order() {
        let cfg = GroupingConfig::default_for(FrameType::Light);
        let key = group_file(&light_meta(), &cfg).key.0;
        // Spot-check canonical ordering: optic_train before filter before
        // exposure before pointing before rotation before night.
        let idx = |needle: &str| key.find(needle).unwrap_or_else(|| panic!("{needle} in {key}"));
        assert!(idx("type=light") < idx("optic_train="));
        assert!(idx("optic_train=") < idx("filter="));
        assert!(idx("filter=") < idx("exposure="));
        assert!(idx("exposure=") < idx("pointing="));
        assert!(idx("pointing=") < idx("rotation="));
        assert!(idx("rotation=") < idx("night="));
    }

    #[test]
    fn dark_recipe_excludes_optics_and_pointing() {
        let cfg = GroupingConfig::default_for(FrameType::Dark);
        assert!(cfg.has(Dimension::SetTemp), "darks group by set-temp (R-9)");
        assert!(!cfg.has(Dimension::OpticTrain), "darks have no optics");
        assert!(!cfg.has(Dimension::Pointing));
        assert!(!cfg.has(Dimension::Filter));
        assert!(!cfg.has(Dimension::ObservingNight), "darks night OFF by default (span nights)");
    }

    #[test]
    fn bias_recipe_excludes_exposure_and_optics() {
        let cfg = GroupingConfig::default_for(FrameType::Bias);
        assert!(!cfg.has(Dimension::Exposure), "bias exposure ≈0, not a key (R-9)");
        assert!(!cfg.has(Dimension::OpticTrain));
        assert!(!cfg.has(Dimension::SetTemp));
        assert!(cfg.has(Dimension::ObservingNight));
        assert!(cfg.has(Dimension::Gain));
        assert!(cfg.has(Dimension::Offset));
    }

    #[test]
    fn flat_recipe_requires_filter_excludes_exposure() {
        let cfg = GroupingConfig::default_for(FrameType::Flat);
        assert!(cfg.has(Dimension::Filter), "flat filter required (R-9)");
        assert!(!cfg.has(Dimension::Exposure), "flat exposure excluded (FlatWizard varies it)");
        assert!(cfg.has(Dimension::OpticTrain));
        assert!(cfg.has(Dimension::Rotation));
        assert!(!cfg.has(Dimension::SetTemp), "flats don't group by temperature");
    }

    // ── Bucketing edge cases (FR-036) ─────────────────────────────────────────

    #[test]
    fn exposure_buckets_to_canonical_seconds() {
        let cfg = GroupingConfig::default_for(FrameType::Dark);
        let mut m = dark_meta();
        m.exposure_s = Some(299.6);
        let k1 = group_file(&m, &cfg).key.0;
        m.exposure_s = Some(300.4);
        let k2 = group_file(&m, &cfg).key.0;
        assert_eq!(k1, k2, "299.6 and 300.4 both round to 300s ⇒ same group");
        assert!(k1.contains("exposure=300"), "rounded to integer seconds: {k1}");
    }

    #[test]
    fn exposure_across_bucket_boundary_splits() {
        let cfg = GroupingConfig::default_for(FrameType::Dark);
        let mut m = dark_meta();
        m.exposure_s = Some(300.0);
        let k1 = group_file(&m, &cfg).key.0;
        m.exposure_s = Some(180.0);
        let k2 = group_file(&m, &cfg).key.0;
        assert_ne!(k1, k2, "300s and 180s are different groups");
    }

    #[test]
    fn configurable_exposure_bucket_size() {
        let mut cfg = GroupingConfig::default_for(FrameType::Dark);
        cfg.exposure_bucket_s = 60.0; // coarse 1-minute buckets
        let mut m = dark_meta();
        m.exposure_s = Some(290.0);
        let k1 = group_file(&m, &cfg).key.0;
        m.exposure_s = Some(305.0);
        let k2 = group_file(&m, &cfg).key.0;
        // 290 → 300, 305 → 300 with 60s buckets.
        assert_eq!(k1, k2, "both snap to the 300s bucket under a 60s grid");
        assert!(k1.contains("exposure=300"));
    }

    #[test]
    fn set_temp_tolerance_groups_within_band() {
        let cfg = GroupingConfig::default_for(FrameType::Dark); // 2°C default
        let mut m = dark_meta();
        m.set_temp_c = Some(-9.4);
        let k1 = group_file(&m, &cfg).key.0;
        m.set_temp_c = Some(-10.6);
        let k2 = group_file(&m, &cfg).key.0;
        // With 2°C buckets, -9.4 → -10 (round(-4.7)*2=-10) and -10.6 → -10.
        assert_eq!(k1, k2, "-9.4 and -10.6 both fall in the -10°C bucket");
    }

    #[test]
    fn set_temp_across_band_splits() {
        let cfg = GroupingConfig::default_for(FrameType::Dark);
        let mut m = dark_meta();
        m.set_temp_c = Some(-10.0);
        let k1 = group_file(&m, &cfg).key.0;
        m.set_temp_c = Some(-20.0);
        let k2 = group_file(&m, &cfg).key.0;
        assert_ne!(k1, k2, "-10°C and -20°C are different cooling setpoints");
    }

    // ── Temperature policy (FR-037) ───────────────────────────────────────────

    #[test]
    fn temp_deviation_warns_but_does_not_split() {
        let cfg = GroupingConfig::default_for(FrameType::Dark); // warn threshold 2°C
        let mut close = dark_meta();
        close.set_temp_c = Some(-10.0);
        close.ccd_temp_c = Some(-10.1); // within 2°C
        let close_res = group_file(&close, &cfg);
        assert!(close_res.warnings.is_empty(), "0.1°C deviation: no warning");

        let mut far = dark_meta();
        far.set_temp_c = Some(-10.0);
        far.ccd_temp_c = Some(-5.0); // 5°C deviation
        let far_res = group_file(&far, &cfg);
        assert!(
            matches!(far_res.warnings.first(), Some(GroupWarning::TempDeviation { .. })),
            "5°C deviation surfaces a quality warning"
        );
        // But the GROUP KEY is identical — setpoint governs, no split.
        assert_eq!(
            close_res.key, far_res.key,
            "deviation warns but does not split (setpoint governs the group)"
        );
    }

    #[test]
    fn ccd_temp_toggle_changes_temp_source() {
        let mut cfg = GroupingConfig::default_for(FrameType::Dark);
        cfg.temp_source = TempSource::CcdTemp;
        let mut m = dark_meta();
        m.set_temp_c = Some(-10.0);
        m.ccd_temp_c = Some(-8.0);
        let key = group_file(&m, &cfg).key.0;
        // Under CCD source, -8.0 buckets to -8 (round(-4)*2), not -10.
        assert!(key.contains("set_temp=-8"), "CCD-TEMP toggle uses ccd value: {key}");
    }

    #[test]
    fn lights_never_group_by_temperature_even_when_present() {
        let cfg = GroupingConfig::default_for(FrameType::Light);
        let mut warm = light_meta();
        warm.set_temp_c = Some(-5.0);
        warm.ccd_temp_c = Some(-5.0);
        let mut cold = light_meta();
        cold.set_temp_c = Some(-20.0);
        cold.ccd_temp_c = Some(-20.0);
        assert_eq!(
            group_file(&warm, &cfg).key,
            group_file(&cold, &cfg).key,
            "lights ignore temperature entirely (R-9)"
        );
    }

    // ── Pointing tolerance (FR-038) ───────────────────────────────────────────

    #[test]
    fn pointing_within_tolerance_groups_together() {
        let cfg = GroupingConfig::default_for(FrameType::Light); // 0.5° default
        let mut a = light_meta();
        a.ra_deg = Some(272.60);
        a.dec_deg = Some(-15.00);
        let mut b = light_meta();
        b.ra_deg = Some(272.70); // within 0.5° → same bucket
        b.dec_deg = Some(-15.10);
        assert_eq!(
            group_file(&a, &cfg).key,
            group_file(&b, &cfg).key,
            "dither/centering within 0.5° stays one group"
        );
    }

    #[test]
    fn pointing_across_tolerance_splits() {
        let cfg = GroupingConfig::default_for(FrameType::Light);
        let mut a = light_meta();
        a.ra_deg = Some(272.0);
        a.dec_deg = Some(-15.0);
        let mut b = light_meta();
        b.ra_deg = Some(280.0); // far away
        b.dec_deg = Some(-15.0);
        assert_ne!(
            group_file(&a, &cfg).key,
            group_file(&b, &cfg).key,
            "different sky positions are different groups"
        );
    }

    #[test]
    fn pointing_uses_decimal_radec() {
        // Sanity: the engine reads ra_deg/dec_deg (decimal) directly; the
        // sexagesimal→decimal conversion is the caller's job (metadata_core).
        let cfg = GroupingConfig::default_for(FrameType::Light);
        let key = group_file(&light_meta(), &cfg).key.0;
        assert!(key.contains("pointing="), "pointing token present: {key}");
    }

    // ── Rotation = ROTATANG, not OBJCTROT (R-18, FR-040) ──────────────────────

    #[test]
    fn rotation_uses_rotatang_not_objctrot() {
        // FrameMetadata only carries rotator_angle_deg (ROTATANG); there is NO
        // sky_rotation_deg/OBJCTROT field on the grouping input by design, so it
        // CANNOT leak into the key. Verify the key reflects the mechanical angle.
        let cfg = GroupingConfig::default_for(FrameType::Light);
        let mut m = light_meta();
        m.rotator_angle_deg = Some(45.0);
        let key = group_file(&m, &cfg).key.0;
        assert!(key.contains("rotation=45"), "rotation token uses ROTATANG: {key}");
    }

    #[test]
    fn rotation_within_tolerance_groups() {
        let cfg = GroupingConfig::default_for(FrameType::Light); // 1° default
        let mut a = light_meta();
        a.rotator_angle_deg = Some(12.1);
        let mut b = light_meta();
        b.rotator_angle_deg = Some(12.4); // both round to the 12° bucket
        assert_eq!(group_file(&a, &cfg).key, group_file(&b, &cfg).key);
    }

    #[test]
    fn flat_missing_rotation_warns_when_not_required() {
        let cfg = GroupingConfig::default_for(FrameType::Flat); // rotation enabled, not required
        let mut m = flat_meta();
        m.rotator_angle_deg = None;
        let res = group_file(&m, &cfg);
        assert!(
            res.warnings.contains(&GroupWarning::RotationUnavailable),
            "missing ROTATANG on a flat warns (matched without rotation)"
        );
        assert!(res.key.0.contains(&format!("rotation={SENTINEL_MISSING}")), "{}", res.key.0);
    }

    #[test]
    fn flat_missing_rotation_no_warning_when_required() {
        let mut cfg = GroupingConfig::default_for(FrameType::Flat);
        cfg.flat_rotation_required = true;
        let mut m = flat_meta();
        m.rotator_angle_deg = None;
        let res = group_file(&m, &cfg);
        // When required, absence is a hard sentinel (excluded), not a warn path.
        assert!(!res.warnings.contains(&GroupWarning::RotationUnavailable));
    }

    // ── Optic-train composite (FR-039) ────────────────────────────────────────

    #[test]
    fn optic_train_is_composite_of_telescop_instrume_focallen() {
        let cfg = GroupingConfig::default_for(FrameType::Light);
        let base = light_meta();
        let mut reducer = light_meta();
        reducer.focal_length_mm = Some(672.0); // different focal length (no reducer)
        assert_ne!(
            group_file(&base, &cfg).key,
            group_file(&reducer, &cfg).key,
            "FOCALLEN difference splits the optical train (captures reducers — FR-039)"
        );
    }

    #[test]
    fn optic_train_focal_length_bucketed_to_whole_mm() {
        let cfg = GroupingConfig::default_for(FrameType::Light);
        let mut a = light_meta();
        a.focal_length_mm = Some(525.2);
        let mut b = light_meta();
        b.focal_length_mm = Some(524.8);
        assert_eq!(
            group_file(&a, &cfg).key,
            group_file(&b, &cfg).key,
            "525.2 and 524.8 both round to 525mm"
        );
    }

    // ── Missing-dimension sentinels (R-11) ────────────────────────────────────

    #[test]
    fn missing_enabled_dimension_renders_sentinel() {
        let cfg = GroupingConfig::default_for(FrameType::Light);
        let mut m = light_meta();
        m.filter = None;
        let key = group_file(&m, &cfg).key.0;
        assert!(
            key.contains(&format!("filter={SENTINEL_MISSING}")),
            "missing filter renders explicit sentinel: {key}"
        );
    }

    #[test]
    fn missing_pointing_components_render_sentinel() {
        let cfg = GroupingConfig::default_for(FrameType::Light);
        let mut m = light_meta();
        m.ra_deg = None; // dec present but ra missing → whole pointing absent
        let key = group_file(&m, &cfg).key.0;
        assert!(key.contains(&format!("pointing={SENTINEL_MISSING}")), "{key}");
    }

    #[test]
    fn empty_string_text_is_treated_as_missing() {
        let cfg = GroupingConfig::default_for(FrameType::Light);
        let mut m = light_meta();
        m.filter = Some("   ".to_owned()); // whitespace only
        let key = group_file(&m, &cfg).key.0;
        assert!(key.contains(&format!("filter={SENTINEL_MISSING}")), "{key}");
    }

    // ── Normalization ─────────────────────────────────────────────────────────

    #[test]
    fn text_normalization_is_case_and_whitespace_insensitive() {
        let cfg = GroupingConfig::default_for(FrameType::Light);
        let mut a = light_meta();
        a.filter = Some("Ha".to_owned());
        let mut b = light_meta();
        b.filter = Some("  ha ".to_owned());
        assert_eq!(
            group_file(&a, &cfg).key,
            group_file(&b, &cfg).key,
            "'Ha' and '  ha ' normalize to the same filter token"
        );
    }

    #[test]
    fn binning_normalizes_to_nxn() {
        let cfg = GroupingConfig::default_for(FrameType::Dark);
        let mut m = dark_meta();
        m.binning_x = Some(2);
        m.binning_y = Some(2);
        let key = group_file(&m, &cfg).key.0;
        assert!(key.contains("binning=2x2"), "{key}");
    }

    // ── Observing night (R-18) ────────────────────────────────────────────────

    #[test]
    fn observing_night_prefers_date_loc_date_portion() {
        let cfg = GroupingConfig::default_for(FrameType::Light);
        let key = group_file(&light_meta(), &cfg).key.0;
        assert!(key.contains("night=2025-10-17"), "uses DATE-LOC calendar date: {key}");
    }

    #[test]
    fn observing_night_falls_back_to_date_obs() {
        let cfg = GroupingConfig::default_for(FrameType::Bias);
        let mut m = bias_meta();
        m.date_loc = None;
        m.date_obs = Some("2025-10-17T15:23:39".to_owned());
        let key = group_file(&m, &cfg).key.0;
        assert!(key.contains("night=2025-10-17"), "DATE-OBS fallback: {key}");
    }

    // ── Toggle behaviour (FR-035) ─────────────────────────────────────────────

    #[test]
    fn disabling_a_dimension_removes_its_token() {
        let mut cfg = GroupingConfig::default_for(FrameType::Light);
        assert!(group_file(&light_meta(), &cfg).key.0.contains("offset="));
        cfg.disable(Dimension::Offset);
        assert!(!cfg.has(Dimension::Offset));
        assert!(!group_file(&light_meta(), &cfg).key.0.contains("offset="));
    }

    #[test]
    fn enabling_readout_adds_its_token() {
        let mut cfg = GroupingConfig::default_for(FrameType::Dark);
        assert!(!cfg.has(Dimension::Readout), "readout OFF by default");
        cfg.enable(Dimension::Readout);
        let mut m = dark_meta();
        m.readout_mode = Some("Low Noise".to_owned());
        let key = group_file(&m, &cfg).key.0;
        assert!(key.contains("readout=low noise"), "{key}");
    }

    // ── Label (R-12) ──────────────────────────────────────────────────────────

    #[test]
    fn label_has_root_type_and_discriminators() {
        let cfg = GroupingConfig::default_for(FrameType::Dark);
        let label = group_file(&dark_meta(), &cfg).label.0;
        assert!(label.starts_with("(root) · dark"), "{label}");
        assert!(label.contains("300s"), "exposure discriminator: {label}");
        assert!(label.contains("-10°C"), "set-temp discriminator: {label}");
        assert!(label.contains("1x1"), "binning discriminator: {label}");
    }

    #[test]
    fn label_omits_missing_dimensions() {
        let cfg = GroupingConfig::default_for(FrameType::Light);
        let mut m = light_meta();
        m.filter = None;
        let label = group_file(&m, &cfg).label.0;
        // No bare sentinel filter fragment in the human label.
        assert!(!label.contains(SENTINEL_MISSING), "label hides sentinels: {label}");
    }

    // ── Format helper unit coverage ───────────────────────────────────────────

    #[test]
    fn format_num_renders_integers_without_decimal() {
        assert_eq!(format_num(300.0), "300");
        assert_eq!(format_num(-10.0), "-10");
        assert_eq!(format_num(0.0), "0");
        assert_eq!(format_num(-0.0), "0", "negative zero normalizes");
    }

    #[test]
    fn format_num_trims_trailing_zeros() {
        assert_eq!(format_num(1.5), "1.5");
        assert_eq!(format_num(272.6820), "272.682");
    }

    #[test]
    fn bucket_disabled_when_size_non_positive() {
        assert!((bucket(123.456, 0.0) - 123.456).abs() < 1e-9);
        assert!((bucket(123.456, -1.0) - 123.456).abs() < 1e-9);
    }
}
