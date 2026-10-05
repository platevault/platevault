// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Qualification of method `platevault.stars` version 1 on generated planes
//! (R7-R11, PIX-FR-05, PIX-FR-06, PIX-FR-09, PIX-AC-03, PIX-AC-08, PIX-AC-09).
//!
//! Signal-to-noise is the star's peak above background over the noise sigma.
#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::cast_lossless,
    clippy::too_many_lines
)]

use std::sync::atomic::AtomicBool;

use platevault_pixels::fixtures::{
    quantize, Plateau, Streak, SyntheticFrame, SyntheticStar, FWHM_PER_SIGMA,
};
use platevault_pixels::measure::{
    cutouts, measure, FrameMeasurement, Measurement, PlaneUnits, Star, StarMetrics, StarReason,
    StarState, StarWarning, METHOD, PARAMETERS,
};
use platevault_pixels::{
    ByteOrder, CfaEvidence, CfaSource, Container, DecodedImage, PixelError, Plane, PlaneKind,
    SampleFormat, Saturation, SaturationSource, Scaling, StructureEvidence,
};

const U16_SATURATION: Saturation =
    Saturation { level: Some(65535.0), source: SaturationSource::TypeMaximum };

fn plane(frame: &SyntheticFrame, format: SampleFormat, saturation: Saturation) -> Plane {
    Plane {
        width: frame.width,
        height: frame.height,
        kind: PlaneKind::Mono,
        samples: quantize(&frame.render(), format, Scaling::IDENTITY),
        scaling: Scaling::IDENTITY,
        blank: None,
        saturation,
    }
}

fn image(planes: Vec<Plane>) -> DecodedImage {
    let first = &planes[0];
    DecodedImage {
        container: Container::Fits,
        evidence: StructureEvidence {
            sample_format: first.samples.format(),
            geometry: vec![u64::from(first.width), u64::from(first.height)],
            byte_order: ByteOrder::Big,
            storage: None,
            compression: None,
            color_space: None,
            bounds: None,
        },
        planes,
    }
}

fn measured(image: &DecodedImage) -> FrameMeasurement {
    match measure(image, &AtomicBool::new(false)).unwrap() {
        Measurement::Measured(measurement) => measurement,
        other @ Measurement::Failed { .. } => panic!("expected a measurement, got {other:?}"),
    }
}

fn star_metrics(
    measurement: &FrameMeasurement,
) -> (u64, u64, Option<f64>, Option<f64>, Option<f64>) {
    match measurement.star_metrics {
        StarMetrics::Measured {
            star_count,
            fitted_star_count,
            fwhm_median,
            eccentricity_median,
            hfr_median,
        } => (star_count, fitted_star_count, fwhm_median, eccentricity_median, hfr_median),
        StarMetrics::Unavailable { reason } => panic!("star metrics unavailable: {reason}"),
    }
}

/// The nearest detected star within `radius` pixels of (x, y).
fn nearest(stars: &[Star], x: f64, y: f64, radius: f64) -> Option<&Star> {
    stars
        .iter()
        .filter(|star| (star.x - x).hypot(star.y - y) <= radius)
        .min_by(|a, b| (a.x - x).hypot(a.y - y).total_cmp(&(b.x - x).hypot(b.y - y)))
}

/// Isolated stars on a grid, `spacing` pixels apart, with seeded sub-pixel
/// offsets.
fn grid_stars(
    count: usize,
    spacing: f64,
    star: impl Fn(usize) -> (f64, f64, f64, f64),
) -> Vec<SyntheticStar> {
    let per_row = (512.0 / spacing) as usize;
    (0..count)
        .map(|index| {
            let (amplitude, sigma_major, sigma_minor, angle_deg) = star(index);
            let column = (index % per_row) as f64;
            let row = (index / per_row) as f64;
            let jitter = ((index * 7919) % 100) as f64 / 100.0;
            SyntheticStar {
                x: spacing / 2.0 + column * spacing + jitter - 0.5,
                y: spacing / 2.0 + row * spacing + 0.37 - jitter * 0.6,
                amplitude,
                sigma_major,
                sigma_minor,
                angle_deg,
            }
        })
        .collect()
}

#[test]
fn background_and_noise_of_a_flat_uint16_frame_are_within_tolerance() {
    let frame = SyntheticFrame::new(512, 512, 11, 1000.0, 10.0);
    let measurement = measured(&image(vec![plane(&frame, SampleFormat::U16, U16_SATURATION)]));
    let background = measurement.background_median.unwrap();
    let noise = measurement.background_noise.unwrap();
    assert!((background - 1000.0).abs() <= 0.5 * 10.0, "background {background}");
    assert!((noise - 10.0).abs() <= 0.05 * 10.0, "noise {noise}");
    assert_eq!(measurement.units, PlaneUnits::Dn);
    assert_eq!(measurement.masks.total(), 0);
}

#[test]
fn detection_is_complete_above_snr_20_and_rejects_hot_pixels_and_cosmic_rays() {
    let snr = |index: usize| 20.0 * 25.0_f64.powf(index as f64 / 49.0);
    let stars = grid_stars(50, 64.0, |index| {
        (
            snr(index) * 10.0,
            1.5 + (index % 5) as f64 * 0.25,
            1.4 + (index % 5) as f64 * 0.2,
            17.0 * index as f64,
        )
    });
    let frame =
        SyntheticFrame { stars: stars.clone(), ..SyntheticFrame::new(512, 512, 21, 1000.0, 10.0) };
    let measurement = measured(&image(vec![plane(&frame, SampleFormat::U16, U16_SATURATION)]));
    let found = stars
        .iter()
        .filter(|truth| nearest(&measurement.stars, truth.x, truth.y, 1.5).is_some())
        .count();
    assert!(found * 100 >= 95 * stars.len(), "completeness {found}/{}", stars.len());
    assert!(!measurement.truncated);

    let hot_pixels = (0..20).map(|index| (13 + index * 23, 31 + index * 21, 30000.0)).collect();
    let streaks = (0..5)
        .map(|index| Streak {
            x: 50 + index * 90,
            y: 400 - index * 70,
            horizontal: index % 2 == 0,
            length: 2,
            value: 20000.0,
        })
        .collect();
    let noise_only =
        SyntheticFrame { hot_pixels, streaks, ..SyntheticFrame::new(512, 512, 22, 1000.0, 10.0) };
    let measurement = measured(&image(vec![plane(&noise_only, SampleFormat::U16, U16_SATURATION)]));
    let (star_count, fitted, fwhm, eccentricity, hfr) = star_metrics(&measurement);
    assert_eq!((star_count, fitted), (0, 0));
    assert!(fwhm.is_none() && eccentricity.is_none() && hfr.is_none());
    assert!(measurement.stars.is_empty());
}

fn angle_difference(a: f64, b: f64) -> f64 {
    let difference = (a - b).rem_euclid(180.0);
    difference.min(180.0 - difference)
}

/// Stars of 5.9 to 8.2 px FWHM (typical seeing) at peak SNR 50 to 100. Angle
/// precision is noise-limited near e = 0.5, where a 2 px sigma star at SNR 80
/// already scatters by about 1.5 degrees.
#[test]
fn elliptical_gaussian_fits_recover_centroid_fwhm_eccentricity_and_angle() {
    let stars = grid_stars(36, 80.0, |index| {
        let sigma_major = 2.5 + (index % 3) as f64 * 0.5;
        let ratio = 0.6 + (index % 4) as f64 * 0.07;
        (
            500.0 + 100.0 * (index % 6) as f64,
            sigma_major,
            sigma_major * ratio,
            (index * 29 % 180) as f64,
        )
    });
    let frame =
        SyntheticFrame { stars: stars.clone(), ..SyntheticFrame::new(512, 512, 31, 1000.0, 10.0) };
    let measurement = measured(&image(vec![plane(&frame, SampleFormat::U16, U16_SATURATION)]));
    let mut failures = Vec::new();
    for truth in &stars {
        let star = nearest(&measurement.stars, truth.x, truth.y, 1.5).expect("star detected");
        assert_eq!(star.state, StarState::Fitted, "{truth:?}: {star:?}");
        assert!(star.reasons.is_empty());
        let shape = star.shape.expect("fitted shape");
        let centroid = (star.x - truth.x).hypot(star.y - truth.y);
        let (major, minor) = truth.fwhm();
        let fwhm = (major * minor).sqrt();
        let eccentricity = (1.0 - (truth.sigma_minor / truth.sigma_major).powi(2)).sqrt();
        let angle = angle_difference(shape.position_angle_deg, truth.angle_deg);
        let snr = truth.amplitude / 10.0;
        if centroid > 0.1
            || (shape.fwhm - fwhm).abs() > 0.03 * fwhm
            || (shape.eccentricity - eccentricity).abs() > 0.03
            || (eccentricity >= 0.5 && angle > 3.0)
        {
            failures.push(format!(
                "snr {snr} e {eccentricity:.3}: centroid {centroid:.3}, fwhm {:.3} vs {fwhm:.3}, e {:.3}, angle off {angle:.2}",
                shape.fwhm, shape.eccentricity
            ));
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
    let (star_count, fitted, fwhm, eccentricity, hfr) = star_metrics(&measurement);
    assert_eq!(star_count, stars.len() as u64);
    assert_eq!(fitted, stars.len() as u64);
    assert!(fwhm.is_some() && eccentricity.is_some() && hfr.is_some());
}

#[test]
fn half_flux_radius_matches_the_analytic_value_in_the_fit_box() {
    let stars = grid_stars(16, 120.0, |index| (600.0 + 50.0 * index as f64, 2.0, 2.0, 0.0));
    let frame =
        SyntheticFrame { stars: stars.clone(), ..SyntheticFrame::new(512, 512, 41, 1000.0, 10.0) };
    let measurement = measured(&image(vec![plane(&frame, SampleFormat::U16, U16_SATURATION)]));
    for truth in &stars {
        let star = nearest(&measurement.stars, truth.x, truth.y, 1.5).expect("star detected");
        let shape = star.shape.expect("fitted shape");
        let radius = f64::from(star.box_radius);
        let sigma = truth.sigma_major;
        let enclosed = 1.0 - (-radius * radius / (2.0 * sigma * sigma)).exp();
        let analytic = sigma * (-2.0 * (1.0 - enclosed / 2.0).ln()).sqrt();
        assert!(
            (shape.hfr - analytic).abs() <= 0.05 * analytic,
            "hfr {} vs {analytic} (box {radius})",
            shape.hfr
        );
        assert!(
            (shape.hfr - FWHM_PER_SIGMA * sigma / 2.0).abs() > 1e-9,
            "HFR is measured, not FWHM / 2"
        );
    }
}

#[test]
fn trailed_stars_read_high_eccentricity() {
    let stars = grid_stars(9, 160.0, |index| (800.0, 3.75, 1.5, 20.0 * index as f64));
    let frame =
        SyntheticFrame { stars: stars.clone(), ..SyntheticFrame::new(512, 512, 51, 1000.0, 10.0) };
    let measurement = measured(&image(vec![plane(&frame, SampleFormat::U16, U16_SATURATION)]));
    for truth in &stars {
        let star = nearest(&measurement.stars, truth.x, truth.y, 1.5).expect("star detected");
        let shape = star.shape.unwrap_or_else(|| panic!("trailed star not fitted: {star:?}"));
        assert!(shape.eccentricity >= 0.9, "eccentricity {}", shape.eccentricity);
    }
}

#[test]
fn a_clipped_star_fails_with_saturated_and_frames_without_fits_have_null_medians() {
    let stars = vec![
        SyntheticStar {
            x: 100.2,
            y: 100.7,
            amplitude: 90000.0,
            sigma_major: 2.2,
            sigma_minor: 2.0,
            angle_deg: 0.0,
        },
        SyntheticStar {
            x: 300.4,
            y: 300.1,
            amplitude: 3000.0,
            sigma_major: 2.0,
            sigma_minor: 1.7,
            angle_deg: 60.0,
        },
    ];
    let frame = SyntheticFrame {
        stars,
        clip: Some(65535.0),
        ..SyntheticFrame::new(400, 400, 61, 1000.0, 10.0)
    };
    let measurement = measured(&image(vec![plane(&frame, SampleFormat::U16, U16_SATURATION)]));
    let clipped = nearest(&measurement.stars, 100.2, 100.7, 2.0).expect("clipped star detected");
    assert_eq!(clipped.state, StarState::Failed);
    assert!(clipped.reasons.contains(&StarReason::Saturated));
    assert!(clipped.warnings.contains(&StarWarning::Saturated));
    assert!(clipped.shape.is_none());
    assert!(clipped.peak < 65535.0 - 1000.0, "peak uses valid samples only: {}", clipped.peak);
    let fitted = nearest(&measurement.stars, 300.4, 300.1, 1.5).expect("well-exposed star");
    assert_eq!(fitted.state, StarState::Fitted);
    let (star_count, fitted_count, fwhm, _, hfr) = star_metrics(&measurement);
    assert_eq!((star_count, fitted_count), (2, 1));
    assert_eq!(fwhm, fitted.shape.map(|shape| shape.fwhm));
    assert_eq!(hfr, fitted.shape.map(|shape| shape.hfr));
    assert_eq!(measurement.masks.saturated, measurement.masks.total());
    assert!(measurement.masks.saturated > 0);

    let only_clipped = SyntheticFrame {
        stars: vec![SyntheticStar {
            x: 100.2,
            y: 100.7,
            amplitude: 90000.0,
            sigma_major: 2.2,
            sigma_minor: 2.0,
            angle_deg: 0.0,
        }],
        clip: Some(65535.0),
        ..SyntheticFrame::new(200, 200, 62, 1000.0, 10.0)
    };
    let measurement =
        measured(&image(vec![plane(&only_clipped, SampleFormat::U16, U16_SATURATION)]));
    let (star_count, fitted_count, fwhm, eccentricity, hfr) = star_metrics(&measurement);
    assert_eq!((star_count, fitted_count), (1, 0));
    assert_eq!((fwhm, eccentricity, hfr), (None, None, None));
    assert_eq!(measurement.no_fitted_reason(), Some("no_fitted_stars"));
}

#[test]
fn masked_samples_are_counted_excluded_and_never_reported() {
    let star = |x, y| SyntheticStar {
        x,
        y,
        amplitude: 0.05,
        sigma_major: 2.0,
        sigma_minor: 1.8,
        angle_deg: 0.0,
    };
    let mut overrides =
        vec![(5, 5, f64::NAN), (6, 5, f64::NAN), (7, 5, f64::INFINITY), (8, 5, f64::NEG_INFINITY)];
    // Two masked samples inside the clean star's box: excluded with a warning.
    overrides.extend([(101, 99, f64::NAN), (99, 102, f64::INFINITY)]);
    // A star buried in NaN: more than 10 percent of its box is masked.
    for y in 192..206 {
        for x in 192..206 {
            if (x + y) % 3 == 0 {
                overrides.push((x, y, f64::NAN));
            }
        }
    }
    let frame = SyntheticFrame {
        stars: vec![star(100.0, 100.0), star(199.0, 199.0)],
        plateaus: vec![Plateau { x: 250, y: 40, width: 6, height: 6, value: 0.9 }],
        overrides,
        ..SyntheticFrame::new(300, 300, 71, 0.1, 0.001)
    };
    let saturation = Saturation { level: Some(0.8), source: SaturationSource::SaturateKeyword };
    let plane = plane(&frame, SampleFormat::F32, saturation);
    let counts = plane.mask_counts();
    let measurement = measured(&image(vec![plane]));
    assert_eq!(measurement.masks, counts);
    assert_eq!(measurement.masks.pos_inf, 2);
    assert_eq!(measurement.masks.neg_inf, 1);
    assert_eq!(measurement.masks.saturated, 36);
    assert!(measurement.masks.nan > 20);
    assert_eq!(measurement.units, PlaneUnits::DataUnit);
    let background = measurement.background_median.unwrap();
    assert!((background - 0.1).abs() < 0.0005, "background {background}");
    let clean = nearest(&measurement.stars, 100.0, 100.0, 1.5).expect("clean star");
    assert_eq!(clean.state, StarState::Fitted);
    assert!(clean.warnings.contains(&StarWarning::MaskedSamplesExcluded));
    let buried = nearest(&measurement.stars, 199.0, 199.0, 2.0).expect("buried star");
    assert_eq!(buried.state, StarState::Failed);
    assert!(buried.reasons.contains(&StarReason::TooManyMaskedSamples));
    let mut reported = vec![background, measurement.background_noise.unwrap()];
    for star in &measurement.stars {
        reported.extend([star.x, star.y, star.peak, star.flux, star.local_background]);
        if let Some(shape) = star.shape {
            reported.extend([
                shape.fwhm,
                shape.fwhm_major,
                shape.fwhm_minor,
                shape.eccentricity,
                shape.position_angle_deg,
                shape.hfr,
            ]);
        }
    }
    let (_, _, fwhm, eccentricity, hfr) = star_metrics(&measurement);
    reported.extend([fwhm, eccentricity, hfr].into_iter().flatten());
    for value in reported {
        assert!(value.is_finite(), "non-finite output {value}");
        assert!((value - 0.9_f32 as f64).abs() > 1e-9, "plateau value reported");
    }
}

#[test]
fn cfa_mosaics_report_background_only_and_multichannel_images_fail() {
    let frame = SyntheticFrame {
        stars: vec![SyntheticStar {
            x: 60.0,
            y: 60.0,
            amplitude: 4000.0,
            sigma_major: 2.0,
            sigma_minor: 2.0,
            angle_deg: 0.0,
        }],
        cfa: Some(platevault_pixels::fixtures::CfaModulation { gains: [1.0, 0.6, 0.6, 0.3] }),
        ..SyntheticFrame::new(128, 128, 81, 1000.0, 10.0)
    };
    let mut mosaic = plane(&frame, SampleFormat::U16, U16_SATURATION);
    mosaic.kind = PlaneKind::CfaMosaic(CfaEvidence {
        pattern: Some("RGGB".into()),
        x_offset: Some(0),
        y_offset: Some(0),
        row_order: None,
        source: CfaSource::BayerpatKeyword,
    });
    let measurement = measured(&image(vec![mosaic]));
    assert!(measurement.background_median.is_some() && measurement.background_noise.is_some());
    assert!(matches!(
        measurement.star_metrics,
        StarMetrics::Unavailable { reason: "cfa_star_metrics_unqualified" }
    ));
    assert!(measurement.stars.is_empty());
    assert_eq!(measurement.plane, 0);

    let channels: Vec<Plane> = (0..3)
        .map(|index| {
            let mut channel = plane(
                &SyntheticFrame::new(32, 32, 90 + index, 1000.0, 10.0),
                SampleFormat::U16,
                U16_SATURATION,
            );
            channel.kind = PlaneKind::Channel {
                index: index as u32,
                count: 3,
                color_space: Some("RGB".into()),
            };
            channel
        })
        .collect();
    match measure(&image(channels), &AtomicBool::new(false)).unwrap() {
        Measurement::Failed { reason, .. } => assert_eq!(reason, "multichannel_unqualified"),
        other @ Measurement::Measured(_) => panic!("expected failure, got {other:?}"),
    }
}

#[test]
fn measurement_is_deterministic_cancelable_and_its_method_is_recorded() {
    let stars =
        grid_stars(20, 100.0, |index| (400.0 + 30.0 * index as f64, 2.2, 1.6, 11.0 * index as f64));
    let frame = SyntheticFrame { stars, ..SyntheticFrame::new(512, 512, 91, 1000.0, 10.0) };
    let image = image(vec![plane(&frame, SampleFormat::U16, U16_SATURATION)]);
    let first = measure(&image, &AtomicBool::new(false)).unwrap();
    let second = measure(&image, &AtomicBool::new(false)).unwrap();
    assert_eq!(format!("{first:?}"), format!("{second:?}"));
    assert_eq!(first, second);
    assert!(matches!(measure(&image, &AtomicBool::new(true)), Err(PixelError::Canceled)));
    assert_eq!((METHOD.name, METHOD.version), ("platevault.stars", 1));
    let names: Vec<&str> = PARAMETERS.iter().map(|(name, _)| *name).collect();
    for expected in [
        "clip_sigma",
        "clip_max_passes",
        "mad_to_sigma",
        "detect_peak_sigma",
        "detect_connected_sigma",
        "detect_min_connected",
        "max_candidates",
        "box_sigma_multiple",
        "box_radius_min_px",
        "box_radius_max_px",
        "max_masked_fraction",
        "max_fit_iterations",
        "min_sigma_px",
        "max_center_shift_px",
        "fwhm_per_sigma",
    ] {
        assert!(names.contains(&expected), "{expected} missing from {names:?}");
    }
}

#[test]
fn cutouts_return_observed_fitted_and_residual_for_fitted_stars_only() {
    let stars = vec![
        SyntheticStar {
            x: 50.3,
            y: 49.6,
            amplitude: 3000.0,
            sigma_major: 2.0,
            sigma_minor: 1.6,
            angle_deg: 30.0,
        },
        SyntheticStar {
            x: 150.0,
            y: 150.0,
            amplitude: 90000.0,
            sigma_major: 2.0,
            sigma_minor: 2.0,
            angle_deg: 0.0,
        },
    ];
    let frame = SyntheticFrame {
        stars,
        clip: Some(65535.0),
        ..SyntheticFrame::new(200, 200, 101, 1000.0, 10.0)
    };
    let plane = plane(&frame, SampleFormat::U16, U16_SATURATION);
    let measurement = measured(&image(vec![plane.clone()]));
    let fitted = nearest(&measurement.stars, 50.3, 49.6, 1.5).unwrap();
    let cut = cutouts(&plane, fitted);
    let side = 2 * fitted.box_radius + 1;
    assert_eq!((cut.width, cut.height), (side, side));
    assert_eq!(cut.observed.len(), (side * side) as usize);
    let model = cut.fitted.as_ref().expect("fitted array");
    let residual = cut.residual.as_ref().expect("residual array");
    for ((observed, fitted), residual) in cut.observed.iter().zip(model).zip(residual) {
        assert!((observed - fitted - residual).abs() < 1e-9);
    }
    let rms =
        (residual.iter().map(|value| value * value).sum::<f64>() / residual.len() as f64).sqrt();
    assert!(rms < 15.0, "residual rms {rms}");
    let failed = nearest(&measurement.stars, 150.0, 150.0, 2.0).unwrap();
    assert_eq!(failed.state, StarState::Failed);
    let cut = cutouts(&plane, failed);
    assert!(cut.fitted.is_none() && cut.residual.is_none());
    assert!(!cut.observed.is_empty());
}
