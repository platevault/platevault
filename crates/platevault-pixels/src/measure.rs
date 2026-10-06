// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Method `platevault.stars` version 1 (R7-R11).
//!
//! One mono plane, single-threaded and deterministic: clipped background and
//! noise, 3×3 local-maximum detection, an elliptical Gaussian fit per star
//! and a measured half-flux radius. A CFA mosaic records background, noise
//! and masks only; a multi-channel image is refused. Every constant is listed
//! in [`PARAMETERS`]; any change increments the version.

use std::sync::atomic::{AtomicBool, Ordering};

use crate::psf::{Gaussian, Shape};
use crate::stars::{detect, measure_star};
use crate::stats::{clipped_background, median, valid_values};
use crate::{Category, DecodedImage, MaskCounts, PixelError, Plane, PlaneKind};

/// A measurement method and version.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Method {
    pub name: &'static str,
    pub version: u32,
}

pub const METHOD: Method = Method { name: "platevault.stars", version: 1 };

pub const CLIP_SIGMA: f64 = 3.0;
pub const CLIP_MAX_PASSES: usize = 10;
pub const MAD_TO_SIGMA: f64 = 1.4826;
pub const DETECT_PEAK_SIGMA: f64 = 5.0;
pub const DETECT_CONNECTED_SIGMA: f64 = 3.0;
pub const DETECT_MIN_CONNECTED: usize = 5;
pub const MAX_CANDIDATES: usize = 2000;
pub const BOX_SIGMA_MULTIPLE: f64 = 3.0;
pub const BOX_RADIUS_MIN_PX: u32 = 4;
pub const BOX_RADIUS_MAX_PX: u32 = 15;
/// Longest half-width walk from a peak, in steps.
pub const MAX_HWHM_STEPS: u32 = 64;
pub const MAX_MASKED_FRACTION: f64 = 0.10;
pub const MAX_FIT_ITERATIONS: usize = 50;
/// Levenberg-Marquardt damping at the start of a fit.
pub const INITIAL_DAMPING: f64 = 1e-3;
/// Damping divides by this after an accepted step and multiplies by it after
/// a rejected one.
pub const DAMPING_STEP: f64 = 10.0;
pub const MIN_DAMPING: f64 = 1e-12;
/// A fit whose damping passes this cannot reduce chi-square further.
pub const MAX_DAMPING: f64 = 1e12;
/// Floor of the normal-matrix diagonal the damping scales.
pub const MIN_CURVATURE: f64 = 1e-12;
/// Smallest pivot the step solver accepts.
pub const MIN_PIVOT: f64 = 1e-300;
/// A fit converges when an accepted step changes chi-square by less than
/// this, relative.
pub const CONVERGED_RELATIVE_CHANGE: f64 = 1e-10;
pub const MIN_SIGMA_PX: f64 = 0.3;
pub const MAX_CENTER_SHIFT_PX: f64 = 1.5;
/// `2 sqrt(2 ln 2)`.
pub const FWHM_PER_SIGMA: f64 = 2.354_820_045_030_949;

/// Every constant of the method, by name.
pub const PARAMETERS: &[(&str, f64)] = &[
    ("clip_sigma", CLIP_SIGMA),
    ("clip_max_passes", CLIP_MAX_PASSES as f64),
    ("mad_to_sigma", MAD_TO_SIGMA),
    ("detect_peak_sigma", DETECT_PEAK_SIGMA),
    ("detect_connected_sigma", DETECT_CONNECTED_SIGMA),
    ("detect_min_connected", DETECT_MIN_CONNECTED as f64),
    ("max_candidates", MAX_CANDIDATES as f64),
    ("box_sigma_multiple", BOX_SIGMA_MULTIPLE),
    ("box_radius_min_px", BOX_RADIUS_MIN_PX as f64),
    ("box_radius_max_px", BOX_RADIUS_MAX_PX as f64),
    ("max_hwhm_steps", MAX_HWHM_STEPS as f64),
    ("max_masked_fraction", MAX_MASKED_FRACTION),
    ("max_fit_iterations", MAX_FIT_ITERATIONS as f64),
    ("initial_damping", INITIAL_DAMPING),
    ("damping_step", DAMPING_STEP),
    ("min_damping", MIN_DAMPING),
    ("max_damping", MAX_DAMPING),
    ("min_curvature", MIN_CURVATURE),
    ("min_pivot", MIN_PIVOT),
    ("converged_relative_change", CONVERGED_RELATIVE_CHANGE),
    ("min_sigma_px", MIN_SIGMA_PX),
    ("max_center_shift_px", MAX_CENTER_SHIFT_PX),
    ("fwhm_per_sigma", FWHM_PER_SIGMA),
];

pub const REASON_NO_FITTED_STARS: &str = "no_fitted_stars";
pub const REASON_CFA_UNQUALIFIED: &str = "cfa_star_metrics_unqualified";
pub const REASON_MULTICHANNEL_UNQUALIFIED: &str = "multichannel_unqualified";
pub const REASON_NO_VALID_SAMPLES: &str = "no_valid_samples";

pub(crate) fn check_canceled(canceled: &AtomicBool) -> Result<(), PixelError> {
    if canceled.load(Ordering::Acquire) {
        Err(PixelError::Canceled)
    } else {
        Ok(())
    }
}

/// Bytes of the f64 copy of one plane's samples that measuring an image of
/// this geometry makes; an image of several planes is refused before any
/// copy.
#[must_use]
pub const fn scratch_bytes(width: u32, height: u32, planes: u32) -> u64 {
    if planes == 1 {
        width as u64 * height as u64 * size_of::<f64>() as u64
    } else {
        0
    }
}

/// Units of plane values.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PlaneUnits {
    /// Integer data.
    Dn,
    /// Float data with recorded bounds [0, 1].
    Normalized,
    DataUnit,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum StarState {
    Fitted,
    Failed,
    NotFitted,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum StarReason {
    Saturated,
    TooManyMaskedSamples,
    NoConvergence,
    SigmaOutOfRange,
    CenterMoved,
    NearEdge,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum StarWarning {
    Saturated,
    MaskedSamplesExcluded,
    NearEdge,
    Blended,
    SaturationUnknown,
}

/// A fitted elliptical Gaussian's shape and measured HFR, in pixels and
/// degrees.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StarShape {
    pub fwhm_major: f64,
    pub fwhm_minor: f64,
    /// Geometric mean of the major and minor FWHM.
    pub fwhm: f64,
    pub eccentricity: f64,
    /// Major axis from +x toward +y in storage coordinates, `[0, 180)`.
    pub position_angle_deg: f64,
    pub hfr: f64,
}

/// One detected star in 0-based storage pixels. For a fitted star `peak` and
/// `local_background` are the fitted amplitude and constant; otherwise they
/// come from valid box samples only.
#[derive(Clone, Debug, PartialEq)]
pub struct Star {
    pub index: u32,
    pub x: f64,
    pub y: f64,
    pub state: StarState,
    pub reasons: Vec<StarReason>,
    pub warnings: Vec<StarWarning>,
    pub peak: f64,
    pub flux: f64,
    pub local_background: f64,
    pub box_radius: u32,
    pub shape: Option<StarShape>,
}

/// Frame star metrics, or why there are none.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum StarMetrics {
    Measured {
        star_count: u64,
        fitted_star_count: u64,
        fwhm_median: Option<f64>,
        eccentricity_median: Option<f64>,
        hfr_median: Option<f64>,
    },
    Unavailable {
        reason: &'static str,
    },
}

/// The measurement of one plane.
#[derive(Clone, Debug, PartialEq)]
pub struct FrameMeasurement {
    /// Index of the measured plane.
    pub plane: u32,
    pub units: PlaneUnits,
    pub background_median: Option<f64>,
    pub background_noise: Option<f64>,
    pub masks: MaskCounts,
    pub star_metrics: StarMetrics,
    pub stars: Vec<Star>,
    /// More than `MAX_CANDIDATES` candidates were found.
    pub truncated: bool,
}

impl FrameMeasurement {
    /// Why the star medians are null although stars were measured.
    #[must_use]
    pub const fn no_fitted_reason(&self) -> Option<&'static str> {
        match self.star_metrics {
            StarMetrics::Measured { fitted_star_count: 0, .. } => Some(REASON_NO_FITTED_STARS),
            _ => None,
        }
    }

    /// Why background and noise are null.
    #[must_use]
    pub const fn background_reason(&self) -> Option<&'static str> {
        if self.background_median.is_none() {
            Some(REASON_NO_VALID_SAMPLES)
        } else {
            None
        }
    }
}

/// The outcome of the method on one image.
#[derive(Clone, Debug, PartialEq)]
pub enum Measurement {
    Measured(FrameMeasurement),
    /// The method's reason for the whole frame.
    Failed {
        reason: &'static str,
        message: String,
    },
}

fn units(image: &DecodedImage) -> PlaneUnits {
    if !image.evidence.sample_format.is_float() {
        PlaneUnits::Dn
    } else if image.evidence.bounds == Some((0.0, 1.0)) {
        PlaneUnits::Normalized
    } else {
        PlaneUnits::DataUnit
    }
}

/// Measures `image` with method version 1. Checks `canceled` between stages
/// and returns no partial result.
///
/// # Errors
///
/// `Canceled` once `canceled` is set.
pub fn measure(image: &DecodedImage, canceled: &AtomicBool) -> Result<Measurement, PixelError> {
    check_canceled(canceled)?;
    let [plane] = image.planes.as_slice() else {
        return Ok(Measurement::Failed {
            reason: REASON_MULTICHANNEL_UNQUALIFIED,
            message: format!("{} channels; no metric is qualified per channel", image.planes.len()),
        });
    };
    let masks = plane.mask_counts();
    check_canceled(canceled)?;
    let background = clipped_background(valid_values(plane));
    check_canceled(canceled)?;
    let mut measurement = FrameMeasurement {
        plane: 0,
        units: units(image),
        background_median: background.map(|background| background.median),
        background_noise: background.map(|background| background.noise),
        masks,
        star_metrics: StarMetrics::Unavailable { reason: REASON_NO_VALID_SAMPLES },
        stars: Vec::new(),
        truncated: false,
    };
    match (&plane.kind, background) {
        (PlaneKind::CfaMosaic(_), _) => {
            measurement.star_metrics = StarMetrics::Unavailable { reason: REASON_CFA_UNQUALIFIED };
        }
        (PlaneKind::Channel { .. }, _) => {
            measurement.star_metrics =
                StarMetrics::Unavailable { reason: REASON_MULTICHANNEL_UNQUALIFIED };
        }
        (PlaneKind::Mono, None) => {}
        (PlaneKind::Mono, Some(background)) => {
            let (candidates, truncated) = detect(plane, background, canceled)?;
            let mut stars = Vec::with_capacity(candidates.len());
            for (index, candidate) in candidates.iter().enumerate() {
                if index % 64 == 0 {
                    check_canceled(canceled)?;
                }
                stars.push(measure_star(plane, index as u32, *candidate, &candidates, background));
            }
            let shapes: Vec<StarShape> = stars.iter().filter_map(|star| star.shape).collect();
            let medians = |value: fn(&StarShape) -> f64| {
                median(&shapes.iter().map(value).collect::<Vec<_>>())
            };
            measurement.star_metrics = StarMetrics::Measured {
                star_count: stars.len() as u64,
                fitted_star_count: shapes.len() as u64,
                fwhm_median: medians(|shape| shape.fwhm),
                eccentricity_median: medians(|shape| shape.eccentricity),
                hfr_median: medians(|shape| shape.hfr),
            };
            measurement.stars = stars;
            measurement.truncated = truncated;
        }
    }
    check_canceled(canceled)?;
    Ok(Measurement::Measured(measurement))
}

/// Observed, fitted and residual arrays of a star's box, row-major. Masked
/// samples keep their value in `observed` and have a NaN residual.
#[derive(Clone, Debug, PartialEq)]
pub struct Cutouts {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub observed: Vec<f64>,
    pub fitted: Option<Vec<f64>>,
    pub residual: Option<Vec<f64>>,
}

/// The cutouts of `star` on `plane`: observed only for a star without a fit.
#[must_use]
pub fn cutouts(plane: &Plane, star: &Star) -> Cutouts {
    let radius = i64::from(star.box_radius);
    let clamp = |center: f64, size: u32| {
        let center = center.round() as i64;
        let low = (center - radius).clamp(0, i64::from(size) - 1) as u32;
        let high = (center + radius).clamp(0, i64::from(size) - 1) as u32;
        (low, high)
    };
    let (x0, x1) = clamp(star.x, plane.width);
    let (y0, y1) = clamp(star.y, plane.height);
    let model = star.shape.map(|shape| {
        Gaussian::from_shape(
            star.peak,
            star.x,
            star.y,
            Shape {
                sigma_major: shape.fwhm_major / FWHM_PER_SIGMA,
                sigma_minor: shape.fwhm_minor / FWHM_PER_SIGMA,
                angle_deg: shape.position_angle_deg,
            },
            star.local_background,
        )
    });
    let mut observed = Vec::new();
    let mut fitted = Vec::new();
    let mut residual = Vec::new();
    for y in y0..=y1 {
        for x in x0..=x1 {
            let (value, category) = plane.value_at(y as usize * plane.width as usize + x as usize);
            observed.push(value);
            if let Some(model) = &model {
                let expected = model.evaluate(f64::from(x), f64::from(y));
                fitted.push(expected);
                residual.push(if category == Category::Valid {
                    value - expected
                } else {
                    f64::NAN
                });
            }
        }
    }
    Cutouts {
        x: x0,
        y: y0,
        width: x1 - x0 + 1,
        height: y1 - y0 + 1,
        observed,
        fitted: model.map(|_| fitted),
        residual: model.map(|_| residual),
    }
}
