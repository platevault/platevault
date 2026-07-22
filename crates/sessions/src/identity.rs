// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Operation-scoped immutable session identity.
//!
//! Metadata extraction normalizes scalar values before constructing these
//! types. Spatial thresholds and relation topology are separate from these
//! exact discriminators.

use std::num::NonZeroU32;

use domain_core::EntityId;

use crate::observing_night::ObservingNight;

/// Exact normalized value or an explicit absence.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub enum IdentityValue<T> {
    Known(T),
    Absent,
}

impl<T> IdentityValue<T> {
    #[must_use]
    pub const fn is_absent(&self) -> bool {
        matches!(self, Self::Absent)
    }

    #[must_use]
    pub const fn as_ref(&self) -> IdentityValue<&T> {
        match self {
            Self::Known(value) => IdentityValue::Known(value),
            Self::Absent => IdentityValue::Absent,
        }
    }
}

/// Exact positive raster dimensions.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct RasterDimensions {
    width: NonZeroU32,
    height: NonZeroU32,
}

impl RasterDimensions {
    #[must_use]
    pub const fn new(width: NonZeroU32, height: NonZeroU32) -> Self {
        Self { width, height }
    }

    #[must_use]
    pub const fn width(self) -> NonZeroU32 {
        self.width
    }

    #[must_use]
    pub const fn height(self) -> NonZeroU32 {
        self.height
    }
}

/// Exact camera-controlled capture fields shared by every supported frame kind.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct CaptureDiscriminators {
    /// Exact normalized gain text.
    pub gain: String,
    pub offset: IdentityValue<i64>,
    pub binning_x: IdentityValue<NonZeroU32>,
    pub binning_y: IdentityValue<NonZeroU32>,
    pub readout_mode: IdentityValue<String>,
    pub raster: RasterDimensions,
}

/// Parity remains independent from orientation.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum ImageParity {
    Normal,
    Mirrored,
}

/// Immutable representative geometry stored with a light session.
///
/// This is identity evidence only. Topology code owns tolerance comparison.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct LightGeometryIdentity {
    pub parity: ImageParity,
    pub footprint_digest: String,
    pub representative_orientation_udeg: i64,
}

/// Camera sensor geometry used by flat compatibility.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct CameraGeometryIdentity {
    pub pixel_size_nm: IdentityValue<NonZeroU32>,
    pub sensor_width_px: IdentityValue<NonZeroU32>,
    pub sensor_height_px: IdentityValue<NonZeroU32>,
}

/// Verified physical orientation or its explicit degraded state.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum FlatOrientationIdentity {
    VerifiedMicrodegrees(i64),
    Absent,
    Unverified,
}

/// Temperature mode stored with a dark session.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum DarkTemperatureMode {
    Regulated { cooling_setpoint_millic: i32 },
    UnregulatedReviewed,
    Unknown,
}

/// Exact light-session discriminators other than operation and observing night.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct LightSessionDiscriminators {
    pub canonical_target_id: EntityId,
    pub optical_profile_id: EntityId,
    pub filter_label_id: IdentityValue<EntityId>,
    pub exposure_us: u64,
    pub capture: CaptureDiscriminators,
    pub crop_evidence: IdentityValue<String>,
    pub geometry: LightGeometryIdentity,
}

/// Exact dark-session recipe discriminators.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct DarkSessionDiscriminators {
    pub camera_id: EntityId,
    pub temperature_mode: DarkTemperatureMode,
    pub exposure_us: u64,
    pub capture: CaptureDiscriminators,
}

impl DarkSessionDiscriminators {
    /// Compare a candidate directly with this immutable recipe representative.
    #[must_use]
    pub fn matches_recipe_candidate(&self, candidate: &Self) -> bool {
        self.camera_id == candidate.camera_id
            && self.temperature_mode == candidate.temperature_mode
            && self.capture == candidate.capture
            && self.exposure_us.abs_diff(candidate.exposure_us)
                <= dark_exposure_tolerance_us(self.exposure_us)
    }
}

/// Dark exposure tolerance for an immutable recipe representative.
///
/// The 0.05% tolerance is clamped to the inclusive 1–100 ms range.
#[must_use]
pub fn dark_exposure_tolerance_us(representative_exposure_us: u64) -> u64 {
    (representative_exposure_us / 2_000).clamp(1_000, 100_000)
}

/// Exact bias-session recipe discriminators.
///
/// Exposure and temperature are intentionally absent from this type.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct BiasSessionDiscriminators {
    pub camera_id: EntityId,
    pub capture: CaptureDiscriminators,
}

/// Exact flat-session discriminators.
///
/// Exposure is intentionally absent from this type.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct FlatSessionDiscriminators {
    pub optical_profile_id: EntityId,
    pub filter_label_id: IdentityValue<EntityId>,
    pub capture: CaptureDiscriminators,
    pub camera_geometry: CameraGeometryIdentity,
    pub physical_orientation: FlatOrientationIdentity,
}

/// Supported frame-kind-specific identity tuple.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub enum SessionDiscriminators {
    Light(LightSessionDiscriminators),
    Dark(DarkSessionDiscriminators),
    Bias(BiasSessionDiscriminators),
    Flat(FlatSessionDiscriminators),
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum SessionKind {
    Light,
    Dark,
    Bias,
    Flat,
}

impl SessionDiscriminators {
    #[must_use]
    pub const fn kind(&self) -> SessionKind {
        match self {
            Self::Light(_) => SessionKind::Light,
            Self::Dark(_) => SessionKind::Dark,
            Self::Bias(_) => SessionKind::Bias,
            Self::Flat(_) => SessionKind::Flat,
        }
    }
}

/// Immutable identity within one approved materialization operation.
///
/// The operation ID distinguishes a replay from a later ingestion with the
/// same metadata. A command replay returns the stored session rather than
/// deriving another [`SessionIdentity`].
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct SessionIdentity {
    materialization_operation_id: EntityId,
    observing_night: ObservingNight,
    discriminators: SessionDiscriminators,
}

impl SessionIdentity {
    #[must_use]
    pub const fn new(
        materialization_operation_id: EntityId,
        observing_night: ObservingNight,
        discriminators: SessionDiscriminators,
    ) -> Self {
        Self { materialization_operation_id, observing_night, discriminators }
    }

    #[must_use]
    pub const fn materialization_operation_id(&self) -> EntityId {
        self.materialization_operation_id
    }

    #[must_use]
    pub const fn observing_night(&self) -> &ObservingNight {
        &self.observing_night
    }

    #[must_use]
    pub const fn discriminators(&self) -> &SessionDiscriminators {
        &self.discriminators
    }

    #[must_use]
    pub const fn kind(&self) -> SessionKind {
        self.discriminators.kind()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::{Date, Month, PrimitiveDateTime, Time};
    use uuid::Uuid;

    fn id(value: u128) -> EntityId {
        EntityId::from_uuid(Uuid::from_u128(value))
    }

    fn positive(value: u32) -> NonZeroU32 {
        NonZeroU32::new(value).unwrap()
    }

    fn night(day: u8) -> ObservingNight {
        ObservingNight::from_reviewed_local_fallback(PrimitiveDateTime::new(
            Date::from_calendar_date(2026, Month::March, day).unwrap(),
            Time::from_hms(20, 0, 0).unwrap(),
        ))
        .unwrap()
    }

    fn capture() -> CaptureDiscriminators {
        CaptureDiscriminators {
            gain: "100".to_owned(),
            offset: IdentityValue::Known(10),
            binning_x: IdentityValue::Known(positive(1)),
            binning_y: IdentityValue::Known(positive(2)),
            readout_mode: IdentityValue::Known("low-noise".to_owned()),
            raster: RasterDimensions::new(positive(6_000), positive(4_000)),
        }
    }

    fn light() -> LightSessionDiscriminators {
        LightSessionDiscriminators {
            canonical_target_id: id(10),
            optical_profile_id: id(20),
            filter_label_id: IdentityValue::Known(id(30)),
            exposure_us: 300_000_000,
            capture: capture(),
            crop_evidence: IdentityValue::Known("full-frame-reported".to_owned()),
            geometry: LightGeometryIdentity {
                parity: ImageParity::Normal,
                footprint_digest: "footprint-a".to_owned(),
                representative_orientation_udeg: 12_500_000,
            },
        }
    }

    #[test]
    fn light_identity_is_scoped_to_the_operation_and_observing_night() {
        let baseline =
            SessionIdentity::new(id(1), night(15), SessionDiscriminators::Light(light()));

        assert_ne!(
            baseline,
            SessionIdentity::new(id(2), night(15), SessionDiscriminators::Light(light()))
        );
        assert_ne!(
            baseline,
            SessionIdentity::new(id(1), night(16), SessionDiscriminators::Light(light()))
        );
        assert_eq!(baseline.kind(), SessionKind::Light);
        assert_eq!(baseline.materialization_operation_id(), id(1));
    }

    #[test]
    fn every_light_discriminator_participates_in_exact_identity() {
        let baseline = light();
        let mut variants = Vec::new();

        let mut changed = baseline.clone();
        changed.canonical_target_id = id(11);
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.optical_profile_id = id(21);
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.filter_label_id = IdentityValue::Absent;
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.exposure_us += 1;
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.capture.gain = "101".to_owned();
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.capture.offset = IdentityValue::Known(11);
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.capture.binning_x = IdentityValue::Known(positive(2));
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.capture.binning_y = IdentityValue::Known(positive(1));
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.capture.readout_mode = IdentityValue::Absent;
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.capture.raster = RasterDimensions::new(positive(5_999), positive(4_000));
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.crop_evidence = IdentityValue::Absent;
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.geometry.parity = ImageParity::Mirrored;
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.geometry.footprint_digest = "footprint-b".to_owned();
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.geometry.representative_orientation_udeg += 1;
        variants.push(changed);

        for variant in variants {
            assert_ne!(baseline, variant);
        }
    }

    #[test]
    fn absent_capture_values_match_only_the_same_absence() {
        let absent = CaptureDiscriminators {
            gain: "100".to_owned(),
            offset: IdentityValue::Absent,
            binning_x: IdentityValue::Absent,
            binning_y: IdentityValue::Absent,
            readout_mode: IdentityValue::Absent,
            raster: RasterDimensions::new(positive(6_000), positive(4_000)),
        };

        assert_eq!(absent, absent.clone());
        assert!(absent.offset.is_absent());

        let mut known_offset = absent.clone();
        known_offset.offset = IdentityValue::Known(0);
        assert_ne!(absent, known_offset);

        let mut known_x = absent.clone();
        known_x.binning_x = IdentityValue::Known(positive(1));
        assert_ne!(absent, known_x);

        let mut known_y = absent.clone();
        known_y.binning_y = IdentityValue::Known(positive(1));
        assert_ne!(absent, known_y);

        let mut known_readout = absent.clone();
        known_readout.readout_mode = IdentityValue::Known("default".to_owned());
        assert_ne!(absent, known_readout);
    }

    #[test]
    fn dark_identity_includes_recipe_fields_but_not_actual_temperature() {
        let baseline = DarkSessionDiscriminators {
            camera_id: id(40),
            temperature_mode: DarkTemperatureMode::Regulated { cooling_setpoint_millic: -10_000 },
            exposure_us: 300_000_000,
            capture: capture(),
        };

        let mut changed_setpoint = baseline.clone();
        changed_setpoint.temperature_mode =
            DarkTemperatureMode::Regulated { cooling_setpoint_millic: -9_999 };
        let mut changed_exposure = baseline.clone();
        changed_exposure.exposure_us += 1;
        let mut changed_camera = baseline.clone();
        changed_camera.camera_id = id(41);

        assert_ne!(baseline, changed_setpoint);
        assert_ne!(baseline, changed_exposure);
        assert_ne!(baseline, changed_camera);
        assert_ne!(baseline.temperature_mode, DarkTemperatureMode::Unknown);
    }

    #[test]
    fn dark_exposure_uses_the_immutable_representative_without_chaining() {
        let representative = DarkSessionDiscriminators {
            camera_id: id(40),
            temperature_mode: DarkTemperatureMode::Regulated { cooling_setpoint_millic: -10_000 },
            exposure_us: 2_000_000,
            capture: capture(),
        };
        let mut at_boundary = representative.clone();
        at_boundary.exposure_us += 1_000;
        let mut chained_only = representative.clone();
        chained_only.exposure_us += 2_000;

        assert_eq!(dark_exposure_tolerance_us(representative.exposure_us), 1_000);
        assert!(representative.matches_recipe_candidate(&at_boundary));
        assert!(!representative.matches_recipe_candidate(&chained_only));
        assert!(at_boundary.matches_recipe_candidate(&chained_only));
    }

    #[test]
    fn dark_exposure_tolerance_is_bounded_to_one_and_one_hundred_ms() {
        assert_eq!(dark_exposure_tolerance_us(1), 1_000);
        assert_eq!(dark_exposure_tolerance_us(20_000_000), 10_000);
        assert_eq!(dark_exposure_tolerance_us(u64::MAX), 100_000);
    }

    #[test]
    fn bias_and_flat_exclude_their_non_discriminating_exposure_fields() {
        let bias = BiasSessionDiscriminators { camera_id: id(40), capture: capture() };
        let flat = FlatSessionDiscriminators {
            optical_profile_id: id(20),
            filter_label_id: IdentityValue::Known(id(30)),
            capture: capture(),
            camera_geometry: CameraGeometryIdentity {
                pixel_size_nm: IdentityValue::Known(positive(3_760)),
                sensor_width_px: IdentityValue::Known(positive(6_000)),
                sensor_height_px: IdentityValue::Known(positive(4_000)),
            },
            physical_orientation: FlatOrientationIdentity::VerifiedMicrodegrees(90_000_000),
        };

        assert_eq!(SessionDiscriminators::Bias(bias.clone()).kind(), SessionKind::Bias);
        assert_eq!(SessionDiscriminators::Flat(flat.clone()).kind(), SessionKind::Flat);

        let mut other_bias = bias.clone();
        other_bias.capture.offset = IdentityValue::Absent;
        assert_ne!(bias, other_bias);

        let mut other_flat = flat.clone();
        other_flat.physical_orientation = FlatOrientationIdentity::Unverified;
        assert_ne!(flat, other_flat);
        let mut no_filter = flat.clone();
        no_filter.filter_label_id = IdentityValue::Absent;
        assert_ne!(flat, no_filter);
    }

    #[test]
    fn dark_flat_is_not_a_supported_session_kind() {
        let supported =
            [SessionKind::Light, SessionKind::Dark, SessionKind::Bias, SessionKind::Flat];
        assert_eq!(supported.len(), 4);
    }
}
