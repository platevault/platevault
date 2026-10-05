// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Frame review wire types (spec 067, PIX contract version 1).
//!
//! Every value names its units and source. A JSON number is always finite: a
//! non-finite sample is the string `NaN`, `Infinity` or `-Infinity` through
//! [`sample_number`], and an unknown value is `null` with a reason.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use uuid::Uuid;

use crate::{
    Asset, Availability, ImageFormat, LibraryError, NativePath, ObservationFingerprint, Revision,
};

/// Largest preview tile side.
pub const MAX_TILE_SIDE: u32 = 1024;
/// Largest preview level; level k averages 2^k blocks.
pub const MAX_TILE_LEVEL: u8 = 8;
/// Largest sample readout side.
pub const MAX_SAMPLE_SIDE: u32 = 64;
/// Smallest comparison region side.
pub const MIN_COMPARE_SIZE: u32 = 16;

fn invalid(message: String) -> LibraryError {
    LibraryError::InvalidInput(message)
}

/// Serde helper for an `f64` that may be non-finite: finite values are JSON
/// numbers, NaN and the infinities are the strings `NaN`, `Infinity` and
/// `-Infinity`.
pub mod sample_number {
    use std::fmt;

    use serde::{de, Deserializer, Serializer};

    /// # Errors
    ///
    /// Forwards the serializer's error.
    pub fn serialize<S: Serializer>(value: &f64, serializer: S) -> Result<S::Ok, S::Error> {
        if value.is_nan() {
            serializer.serialize_str("NaN")
        } else if value.is_infinite() {
            serializer.serialize_str(if value.is_sign_positive() {
                "Infinity"
            } else {
                "-Infinity"
            })
        } else {
            serializer.serialize_f64(*value)
        }
    }

    /// # Errors
    ///
    /// Refuses any string other than the three non-finite names.
    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<f64, D::Error> {
        deserializer.deserialize_any(SampleVisitor)
    }

    struct SampleVisitor;

    impl de::Visitor<'_> for SampleVisitor {
        type Value = f64;

        fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str("a finite number or \"NaN\", \"Infinity\" or \"-Infinity\"")
        }

        fn visit_f64<E: de::Error>(self, value: f64) -> Result<f64, E> {
            Ok(value)
        }

        #[allow(clippy::cast_precision_loss)]
        fn visit_i64<E: de::Error>(self, value: i64) -> Result<f64, E> {
            Ok(value as f64)
        }

        #[allow(clippy::cast_precision_loss)]
        fn visit_u64<E: de::Error>(self, value: u64) -> Result<f64, E> {
            Ok(value as f64)
        }

        fn visit_str<E: de::Error>(self, value: &str) -> Result<f64, E> {
            match value {
                "NaN" => Ok(f64::NAN),
                "Infinity" => Ok(f64::INFINITY),
                "-Infinity" => Ok(f64::NEG_INFINITY),
                other => Err(E::invalid_value(de::Unexpected::Str(other), &self)),
            }
        }
    }
}

/// An `f64` carried in [`sample_number`] form.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct SampleNumber(#[serde(with = "sample_number")] pub f64);

/// A stored sample: integers stay JSON integers, floats use [`sample_number`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum StoredNumber {
    Integer(i64),
    Float(f64),
}

impl Serialize for StoredNumber {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Integer(value) => serializer.serialize_i64(*value),
            Self::Float(value) => sample_number::serialize(value, serializer),
        }
    }
}

impl<'de> Deserialize<'de> for StoredNumber {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Wire {
            Integer(i64),
            Float(SampleNumber),
        }
        Ok(match Wire::deserialize(deserializer)? {
            Wire::Integer(value) => Self::Integer(value),
            Wire::Float(SampleNumber(value)) => Self::Float(value),
        })
    }
}

/// Unavailable-value and failure reasons used on the wire.
pub mod reasons {
    pub const NO_FITTED_STARS: &str = "no_fitted_stars";
    pub const CFA_STAR_METRICS_UNQUALIFIED: &str = "cfa_star_metrics_unqualified";
    pub const MULTICHANNEL_UNQUALIFIED: &str = "multichannel_unqualified";
    pub const UNSUPPORTED_FORMAT: &str = "unsupported_format";
    pub const MALFORMED_DATA: &str = "malformed_data";
    pub const RETIRED: &str = "retired";
    pub const MISSING_UNITS: &str = "missing_units";
    pub const NO_DECLARED_UNITS: &str = "no_declared_units";
    pub const CIRCULAR_PSF: &str = "circular_psf";
    pub const NOT_SUPPORTED: &str = "not_supported";
    pub const UNKNOWN_COLUMN: &str = "unknown_column";
    pub const DECISION_NOT_IMPORTED: &str = "decision_not_imported";
    pub const DUPLICATE_ASSET_MATCH: &str = "duplicate_asset_match";
    pub const DEFAULT_SUBFRAME_SCALE: &str = "default_subframe_scale";
    pub const UNPARSED_VALUE: &str = "unparsed_value";
    pub const EMPTY_VALUE: &str = "empty_value";
}

/// A measurement method and its version.
#[derive(Clone, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
pub struct MeasurementMethod {
    pub name: String,
    pub version: u32,
}

impl MeasurementMethod {
    #[must_use]
    pub fn new(name: impl Into<String>, version: u32) -> Self {
        Self { name: name.into(), version }
    }
}

/// Where CFA evidence was recorded.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CfaSource {
    BayerpatKeyword,
    ColorFilterArray,
}

/// CFA evidence as recorded; absent values are `null`.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CfaEvidence {
    pub pattern: Option<String>,
    pub x_offset: Option<i64>,
    pub y_offset: Option<i64>,
    pub row_order: Option<String>,
    pub source: CfaSource,
}

/// The plane a value was measured on or a preview shows.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PlaneBasis {
    Mono,
    CfaMosaic(CfaEvidence),
    #[serde(rename_all = "camelCase")]
    Channel {
        index: u32,
        count: u32,
        color_space: Option<String>,
    },
}

/// Where a saturation level came from.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SaturationSource {
    SaturateKeyword,
    XisfBounds,
    TypeMaximum,
    Unknown,
}

/// A saturation level in plane units with its source, `null` when unknown.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct SaturationBasis {
    pub level: Option<f64>,
    pub source: SaturationSource,
}

/// The stored sample type.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SampleFormat {
    Uint8,
    Int16,
    Uint16,
    Int32,
    Uint32,
    Int64,
    Float32,
    Float64,
}

/// `value = zero + scale * stored`.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Scaling {
    pub zero: f64,
    pub scale: f64,
}

/// Masked samples per category.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaskCounts {
    pub nan: u64,
    pub pos_inf: u64,
    pub neg_inf: u64,
    pub blank: u64,
    pub saturated: u64,
}

impl MaskCounts {
    #[must_use]
    pub const fn total(&self) -> u64 {
        self.nan + self.pos_inf + self.neg_inf + self.blank + self.saturated
    }
}

/// What a decode recorded about the measured plane.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedBasis {
    /// The measured plane; for a multi-channel refusal, the first channel.
    pub plane: PlaneBasis,
    pub plane_count: u32,
    pub sample_format: SampleFormat,
    pub scaling: Scaling,
    pub blank: Option<i64>,
    pub width: u32,
    pub height: u32,
    pub saturation: SaturationBasis,
}

/// What a measurement was computed from: the observed fingerprint with
/// `contentSha256` set to the SHA-256 of the measured bytes, the container
/// and, when the data decoded, the plane basis.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputBasis {
    pub fingerprint: ObservationFingerprint,
    pub container: ImageFormat,
    pub decoded: Option<DecodedBasis>,
}

impl InputBasis {
    /// The SHA-256 of the measured bytes.
    #[must_use]
    pub fn sha256(&self) -> Option<&str> {
        self.fingerprint.content_sha256.as_deref()
    }
}

/// A built-in frame metric.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetricId {
    StarCount,
    FittedStarCount,
    FwhmMedian,
    EccentricityMedian,
    HfrMedian,
    BackgroundMedian,
    BackgroundNoise,
}

impl MetricId {
    /// Display labels keep FWHM and HFR distinct; no metric is relabelled.
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::StarCount => "Stars",
            Self::FittedStarCount => "Fitted stars",
            Self::FwhmMedian => "FWHM (Gaussian fit)",
            Self::EccentricityMedian => "Eccentricity",
            Self::HfrMedian => "HFR (half-flux radius)",
            Self::BackgroundMedian => "Background median",
            Self::BackgroundNoise => "Background noise",
        }
    }
}

/// Units as declared; values are never converted.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Units {
    Count,
    Px,
    Dimensionless,
    Deg,
    Dn,
    Normalized,
    DataUnit,
    Arcsec,
    #[serde(rename = "e-")]
    Electrons,
}

/// Whether a metric carries a value.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetricState {
    Measured,
    Unavailable,
}

/// The import format of an external measurement file.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportFormat {
    SubframeSelectorCsv,
}

/// Who computed a value.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ValueSource {
    BuiltIn {
        method: String,
        version: u32,
    },
    #[serde(rename_all = "camelCase")]
    Imported {
        format: ImportFormat,
        module_version: Option<String>,
        psf_type: Option<String>,
    },
}

/// One built-in frame metric with its units and source.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MetricValue {
    pub metric: MetricId,
    pub label: String,
    pub value: Option<f64>,
    pub units: Units,
    pub state: MetricState,
    pub reason: Option<String>,
    pub source: ValueSource,
}

impl MetricValue {
    fn built_in(method: &MeasurementMethod) -> ValueSource {
        ValueSource::BuiltIn { method: method.name.clone(), version: method.version }
    }

    /// A measured value. A non-finite value is recorded unavailable instead.
    #[must_use]
    pub fn measured(
        metric: MetricId,
        units: Units,
        value: f64,
        method: &MeasurementMethod,
    ) -> Self {
        if !value.is_finite() {
            return Self::unavailable(metric, units, "non_finite_result", method);
        }
        Self {
            metric,
            label: metric.label().to_owned(),
            value: Some(value),
            units,
            state: MetricState::Measured,
            reason: None,
            source: Self::built_in(method),
        }
    }

    #[must_use]
    pub fn unavailable(
        metric: MetricId,
        units: Units,
        reason: &str,
        method: &MeasurementMethod,
    ) -> Self {
        Self {
            metric,
            label: metric.label().to_owned(),
            value: None,
            units,
            state: MetricState::Unavailable,
            reason: Some(reason.to_owned()),
            source: Self::built_in(method),
        }
    }
}

/// The fit state of a detected star.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StarState {
    Fitted,
    Failed,
    NotFitted,
}

/// Why a star has no fitted shape (R8).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StarReason {
    Saturated,
    TooManyMaskedSamples,
    NoConvergence,
    SigmaOutOfRange,
    CenterMoved,
    NearEdge,
}

/// Fit warnings (R8).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StarWarning {
    Saturated,
    MaskedSamplesExcluded,
    NearEdge,
    Blended,
    SaturationUnknown,
}

/// The fitted PSF model.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StarModel {
    EllipticalGaussian,
}

/// One detected star in 0-based storage pixels. A failed or unfitted star
/// has no width or radius value. For a fitted star `peak` and
/// `localBackground` are the fitted amplitude and constant, so the model is
/// reproducible from the record.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StarRecord {
    pub index: u32,
    pub x: f64,
    pub y: f64,
    pub state: StarState,
    pub reasons: Vec<StarReason>,
    pub warnings: Vec<StarWarning>,
    pub peak: f64,
    pub flux: f64,
    pub local_background: f64,
    /// Half side of the fit box in pixels.
    pub box_radius: u32,
    pub model: Option<StarModel>,
    pub fwhm_major_px: Option<f64>,
    pub fwhm_minor_px: Option<f64>,
    pub fwhm_px: Option<f64>,
    pub eccentricity: Option<f64>,
    pub position_angle_deg: Option<f64>,
    pub hfr_px: Option<f64>,
}

/// The outcome of measuring one frame.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum MeasurementOutcome {
    Measured {
        metrics: Vec<MetricValue>,
        stars: Vec<StarRecord>,
        masks: MaskCounts,
        /// Only the brightest candidates were kept.
        truncated: bool,
    },
    /// The method's reason for the whole frame.
    Failed { reason: String, message: String },
}

/// A cached measurement of one asset.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeasurementRecord {
    pub id: Uuid,
    pub asset_id: Uuid,
    pub run_id: Uuid,
    pub method: MeasurementMethod,
    pub dequeue_sequence: u64,
    pub basis: InputBasis,
    #[serde(flatten)]
    pub outcome: MeasurementOutcome,
    pub measured_at: String,
}

/// Derived frame state; never stored.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrameStateKind {
    Cached,
    Pending,
    Failed,
    Unavailable,
    NotMeasured,
}

/// Whether a cached value was verified against the current file.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Verification {
    Current,
    LastObserved,
}

/// The basis summary shown with a frame state.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FrameBasis {
    pub fingerprint: ObservationFingerprint,
    pub plane: Option<PlaneBasis>,
    pub saturation: Option<SaturationBasis>,
}

/// One frame's measurement state with built-in and imported values.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameState {
    pub asset_id: Uuid,
    pub state: FrameStateKind,
    pub reason: Option<String>,
    pub availability: Availability,
    pub measurement_id: Option<Uuid>,
    pub measured_at: Option<String>,
    pub verification: Option<Verification>,
    pub basis: Option<FrameBasis>,
    pub values: Vec<MetricValue>,
    pub imported: Vec<ImportedValue>,
}

/// A measurement run's state.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    Running,
    Completed,
    Canceled,
    Interrupted,
    Failed,
}

/// A source that could not be measured: offline, unreadable, retired or
/// changed while being read.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunIssue {
    pub asset_id: Uuid,
    /// The `ErrorResponse` kind.
    pub kind: String,
    pub message: String,
}

/// Run counters.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCounters {
    pub requested: u64,
    pub already_cached: u64,
    pub measured: u64,
    pub failed: u64,
    pub unavailable: u64,
    pub remaining: u64,
}

/// A durable measurement run.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeasurementRun {
    pub operation_id: Uuid,
    pub revision: Revision,
    pub state: RunState,
    pub method: MeasurementMethod,
    pub counters: RunCounters,
    pub issues: Vec<RunIssue>,
    pub started_at: String,
    pub finished_at: Option<String>,
}

/// The `pix_measurement_progress` event payload. Events can be lost; status
/// and frame-state reads are the durable truth.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeasurementProgress {
    pub operation_id: Uuid,
    pub revision: Revision,
    pub state: RunState,
    pub counters: RunCounters,
    pub asset_id: Option<Uuid>,
    pub frame_state: Option<FrameState>,
}

/// A display stretch in plane units (linear) or normalized units (MTF).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Stretch {
    Linear { black: f64, white: f64 },
    Mtf { shadows: f64, midtones: f64, highlights: f64 },
    Auto,
}

impl Stretch {
    /// # Errors
    ///
    /// `InvalidInput` naming the field for non-finite points, `black >=
    /// white`, `shadows >= highlights`, points outside `[0, 1]` or midtones
    /// outside `(0, 1)`.
    pub fn validate(&self) -> Result<(), LibraryError> {
        match *self {
            Self::Linear { black, white } => {
                if !black.is_finite() {
                    return Err(invalid("stretch black must be finite".into()));
                }
                if !white.is_finite() {
                    return Err(invalid("stretch white must be finite".into()));
                }
                if black >= white {
                    return Err(invalid("stretch black must be below white".into()));
                }
            }
            Self::Mtf { shadows, midtones, highlights } => {
                if !(midtones > 0.0 && midtones < 1.0) {
                    return Err(invalid(
                        "stretch midtones must lie strictly between 0 and 1".into(),
                    ));
                }
                if !(0.0..=1.0).contains(&shadows) {
                    return Err(invalid("stretch shadows must lie in [0, 1]".into()));
                }
                if !(0.0..=1.0).contains(&highlights) {
                    return Err(invalid("stretch highlights must lie in [0, 1]".into()));
                }
                if shadows >= highlights {
                    return Err(invalid("stretch shadows must be below highlights".into()));
                }
            }
            Self::Auto => {}
        }
        Ok(())
    }
}

/// Which stretch was requested.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StretchKind {
    Linear,
    Mtf,
    Auto,
}

/// The mapping a tile applied: `x = clamp((v - black) / (white - black))`
/// in plane units, then the midtones transfer of `(x - shadows) /
/// (highlights - shadows)`, clamped to `[0, 1]`, scaled to 0..255.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct AppliedStretch {
    pub kind: StretchKind,
    pub black: f64,
    pub white: f64,
    pub shadows: f64,
    pub midtones: f64,
    pub highlights: f64,
}

fn check_side(field: &str, value: u32, min: u32, max: u32) -> Result<(), LibraryError> {
    if value < min || value > max {
        return Err(invalid(format!("{field} must lie in [{min}, {max}], got {value}")));
    }
    Ok(())
}

/// A display tile request in level coordinates.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TileRequest {
    pub asset_id: Uuid,
    pub sha256: String,
    pub plane: u32,
    pub level: u8,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub stretch: Stretch,
}

impl TileRequest {
    /// # Errors
    ///
    /// `InvalidInput` naming `width`, `height`, `level` or the stretch field.
    pub fn validate(&self) -> Result<(), LibraryError> {
        check_side("width", self.width, 1, MAX_TILE_SIDE)?;
        check_side("height", self.height, 1, MAX_TILE_SIDE)?;
        if self.level > MAX_TILE_LEVEL {
            return Err(invalid(format!(
                "level must lie in [0, {MAX_TILE_LEVEL}], got {}",
                self.level
            )));
        }
        self.stretch.validate()
    }
}

/// The five comparison regions request.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionsRequest {
    pub asset_id: Uuid,
    pub sha256: String,
    pub plane: u32,
    pub size: u32,
    pub stretch: Stretch,
}

impl RegionsRequest {
    /// # Errors
    ///
    /// `InvalidInput` naming `size` or the stretch field.
    pub fn validate(&self) -> Result<(), LibraryError> {
        check_side("size", self.size, MIN_COMPARE_SIZE, MAX_TILE_SIDE)?;
        self.stretch.validate()
    }
}

/// A sample readout request at full resolution.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleRequest {
    pub asset_id: Uuid,
    pub sha256: String,
    pub plane: u32,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl SampleRequest {
    /// # Errors
    ///
    /// `InvalidInput` naming `width` or `height` outside 1 to 64.
    pub fn validate(&self) -> Result<(), LibraryError> {
        check_side("width", self.width, 1, MAX_SAMPLE_SIDE)?;
        check_side("height", self.height, 1, MAX_SAMPLE_SIDE)
    }
}

/// A star cutout request bound to the record's measured bytes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CutoutRequest {
    pub asset_id: Uuid,
    pub measurement_id: Uuid,
    pub star: u32,
    pub sha256: String,
}

/// A rendered display tile: base64 8-bit gray values and, when any sample is
/// masked, base64 category codes (0 valid, 1 NaN, 2 +Inf, 3 -Inf, 4 BLANK,
/// 5 saturated). Memory-only; never stored.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewTile {
    pub plane: u32,
    pub level: u8,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub applied_stretch: AppliedStretch,
    pub gray: String,
    pub mask: Option<String>,
}

/// Valid-sample statistics of one plane in plane units.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaneSummary {
    pub valid: u64,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub median: Option<f64>,
    pub mad: Option<f64>,
}

/// One previewable plane.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanePreview {
    pub index: u32,
    pub basis: PlaneBasis,
    pub masks: MaskCounts,
    pub statistics: PlaneSummary,
}

/// A frame opened for preview after a verified contained read.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FramePreview {
    pub asset_id: Uuid,
    /// The SHA-256 of the decoded bytes; tile requests name it.
    pub sha256: String,
    pub fingerprint: ObservationFingerprint,
    pub container: ImageFormat,
    pub width: u32,
    pub height: u32,
    pub sample_format: SampleFormat,
    pub scaling: Scaling,
    pub blank: Option<i64>,
    pub saturation: SaturationBasis,
    pub planes: Vec<PlanePreview>,
    /// Whether the decoded digest equals the valid record's basis.
    pub matches_record: bool,
}

/// A sample's validity category.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SampleCategory {
    Valid,
    Nan,
    PosInf,
    NegInf,
    Blank,
    Saturated,
}

/// One sample as stored, scaled and categorised; never replaced.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct SampleValue {
    pub x: u32,
    pub y: u32,
    pub stored: StoredNumber,
    #[serde(with = "sample_number")]
    pub value: f64,
    pub category: SampleCategory,
}

/// Observed, fitted and residual arrays of one star's fit box, row-major.
/// A failed star returns only the observed array.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StarCutouts {
    pub asset_id: Uuid,
    pub measurement_id: Uuid,
    pub star: u32,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub observed: Vec<SampleNumber>,
    pub fitted: Option<Vec<f64>>,
    pub residual: Option<Vec<SampleNumber>>,
}

/// The stars of a frame's valid record, or its state when none exists.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameStars {
    pub asset_id: Uuid,
    pub state: FrameState,
    pub measurement_id: Option<Uuid>,
    pub stars: Vec<StarRecord>,
}

/// Disclosure of one frame: identity, header evidence, the built-in record
/// and every imported value.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameDetail {
    pub asset: Asset,
    pub state: FrameState,
    pub record: Option<MeasurementRecord>,
    pub imported: Vec<ImportedValue>,
}

/// A `SubframeSelector` table layout.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportLayout {
    /// `PixInsight` 1.9.x, 30 columns.
    Columns30,
    /// Module 1.8.9, 28 columns.
    Columns28,
    /// Module 1.8.8-12, 23 columns.
    Columns23,
}

/// One preamble row as recorded.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PreambleEntry {
    pub key: String,
    pub value: String,
}

/// How an import column is treated.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ColumnClass {
    Mapped,
    Unavailable,
    Identity,
    Excluded,
}

/// One CSV column with its class, units and the preamble rows the units
/// came from.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportColumn {
    pub header: String,
    pub position: u32,
    pub class: ColumnClass,
    pub units: Option<Units>,
    pub units_basis: Vec<PreambleEntry>,
    pub reason: Option<String>,
    pub warnings: Vec<String>,
}

/// A row's match state.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RowMatch {
    MatchedPath,
    MatchedName,
    Ambiguous,
    Unmatched,
    Unparsed,
    Resolved,
}

/// One cell of a mapped column: the raw text and the parsed number, or a
/// parse reason.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ImportCell {
    pub position: u32,
    pub raw: String,
    pub value: Option<f64>,
    pub reason: Option<String>,
}

/// The asset evidence an attached row was reviewed against.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImportBasis {
    pub fingerprint: ObservationFingerprint,
    /// `null` when the asset was offline and no digest was recorded.
    pub sha256: Option<String>,
}

/// One CSV data row.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRow {
    /// 1-based line in the CSV file.
    pub line: u64,
    /// The CSV Index column, `null` for an unparsed row.
    pub index: Option<u64>,
    pub file: String,
    #[serde(rename = "match")]
    pub match_state: RowMatch,
    pub reason: Option<String>,
    pub candidates: Vec<Uuid>,
    pub asset_id: Option<Uuid>,
    pub basis: Option<ImportBasis>,
    pub values: Vec<ImportCell>,
}

/// A review's lifecycle.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportReviewState {
    Reviewed,
    Confirmed,
}

/// The CSV file as read.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSource {
    pub path: NativePath,
    pub size_bytes: u64,
    pub sha256: String,
}

/// A durable import proposal, or the confirmed import.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReview {
    pub review_id: Uuid,
    pub revision: Revision,
    pub state: ImportReviewState,
    pub format: ImportFormat,
    pub source: ImportSource,
    pub module_version: Option<String>,
    pub psf_type: Option<String>,
    pub preamble: Vec<PreambleEntry>,
    pub layout: ExportLayout,
    pub scope: Vec<Uuid>,
    pub columns: Vec<ImportColumn>,
    pub rows: Vec<ImportRow>,
    pub reviewed_at: String,
    pub confirmed_at: Option<String>,
}

/// Resolves an ambiguous row to one of its listed candidates.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowResolution {
    pub index: u64,
    pub asset_id: Uuid,
}

/// The result of one confirmation commit.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmedImport {
    pub review: ImportReview,
    pub attached: Vec<ImportRow>,
    pub unattached: Vec<ImportRow>,
    pub values: Vec<ImportedValue>,
}

/// Imported values are never verified.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportVerification {
    Unverified,
}

/// Whether an imported value's asset still matches its import basis.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Drift {
    Matches,
    Differs,
    Unknown,
}

/// One confirmed imported value, kept apart from built-in values.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedValue {
    pub import_id: Uuid,
    pub asset_id: Uuid,
    pub column: String,
    pub position: u32,
    pub label: String,
    pub value: Option<f64>,
    pub raw: String,
    pub reason: Option<String>,
    pub units: Option<Units>,
    pub units_basis: Vec<PreambleEntry>,
    pub warnings: Vec<String>,
    pub source: ValueSource,
    #[serde(rename = "match")]
    pub match_state: RowMatch,
    pub verification: ImportVerification,
    pub drift: Drift,
    pub imported_at: String,
}

/// A non-Retired scope asset offered to row matching.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCandidate {
    pub asset_id: Uuid,
    /// The absolute native path.
    pub path: NativePath,
    /// The absolute path as Unicode text, `None` when not representable.
    pub path_text: Option<String>,
    /// The final path component as Unicode text.
    pub basename: Option<String>,
    pub fingerprint: ObservationFingerprint,
    /// A SHA-256 already recorded for this fingerprint.
    pub sha256: Option<String>,
}
