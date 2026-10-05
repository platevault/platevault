// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Star detection and per-star fitting (R7, R8).

use std::sync::atomic::AtomicBool;

use crate::hfr::half_flux_radius;
use crate::measure::{
    check_canceled, Star, StarReason, StarShape, StarState, StarWarning, BOX_RADIUS_MAX_PX,
    BOX_RADIUS_MIN_PX, BOX_SIGMA_MULTIPLE, DETECT_CONNECTED_SIGMA, DETECT_MIN_CONNECTED,
    DETECT_PEAK_SIGMA, FWHM_PER_SIGMA, MAX_CANDIDATES, MAX_CENTER_SHIFT_PX, MAX_MASKED_FRACTION,
    MIN_SIGMA_PX,
};
use crate::psf::{fit, FitError, FitSample, Gaussian};
use crate::stats::{median, Background};
use crate::{Category, PixelError, Plane};

/// HWHM per sigma, `sqrt(2 ln 2)`.
const HWHM_PER_SIGMA: f64 = FWHM_PER_SIGMA / 2.0;
/// Longest HWHM walk from a peak.
const MAX_HWHM_STEPS: u32 = 64;

/// A 3×3 local maximum that passed the detection thresholds.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Candidate {
    pub x: u32,
    pub y: u32,
    /// Peak height above the frame background.
    pub height: f64,
}

/// The value used for detection: valid and saturated samples keep their
/// value; NaN, infinities and BLANK are absent.
fn detect_value(plane: &Plane, x: u32, y: u32) -> Option<f64> {
    match plane.value_at(y as usize * plane.width as usize + x as usize) {
        (value, Category::Valid | Category::Saturated) => Some(value),
        _ => None,
    }
}

fn neighbours(plane: &Plane, x: u32, y: u32) -> impl Iterator<Item = (u32, u32)> + '_ {
    (-1_i64..=1).flat_map(move |dy| {
        (-1_i64..=1).filter_map(move |dx| {
            if dx == 0 && dy == 0 {
                return None;
            }
            let nx = i64::from(x) + dx;
            let ny = i64::from(y) + dy;
            (nx >= 0 && ny >= 0 && nx < i64::from(plane.width) && ny < i64::from(plane.height))
                .then_some((nx as u32, ny as u32))
        })
    })
}

/// A plateau yields one maximum: earlier neighbours in raster order must be
/// strictly lower, later ones not higher.
fn is_local_maximum(plane: &Plane, x: u32, y: u32, value: f64) -> bool {
    neighbours(plane, x, y).all(|(nx, ny)| match detect_value(plane, nx, ny) {
        None => true,
        Some(other) if (ny, nx) < (y, x) => other < value,
        Some(other) => other <= value,
    })
}

/// Whether at least `DETECT_MIN_CONNECTED` 8-connected samples, including the
/// peak, lie at or above `threshold`.
fn has_connected_support(plane: &Plane, x: u32, y: u32, threshold: f64) -> bool {
    let mut visited = vec![(x, y)];
    let mut next = 0;
    while next < visited.len() && visited.len() < DETECT_MIN_CONNECTED {
        let (cx, cy) = visited[next];
        next += 1;
        for (nx, ny) in neighbours(plane, cx, cy) {
            if visited.len() >= DETECT_MIN_CONNECTED {
                break;
            }
            if !visited.contains(&(nx, ny))
                && detect_value(plane, nx, ny).is_some_and(|value| value >= threshold)
            {
                visited.push((nx, ny));
            }
        }
    }
    visited.len() >= DETECT_MIN_CONNECTED
}

/// Candidates brightest first (ties in raster order), at most
/// `MAX_CANDIDATES`, and whether more were found.
pub fn detect(
    plane: &Plane,
    background: Background,
    canceled: &AtomicBool,
) -> Result<(Vec<Candidate>, bool), PixelError> {
    let peak_threshold = background.median + DETECT_PEAK_SIGMA * background.noise;
    let support_threshold = background.median + DETECT_CONNECTED_SIGMA * background.noise;
    let mut candidates = Vec::new();
    for y in 0..plane.height {
        check_canceled(canceled)?;
        for x in 0..plane.width {
            let Some(value) = detect_value(plane, x, y) else {
                continue;
            };
            if value < peak_threshold || (background.noise <= 0.0 && value <= background.median) {
                continue;
            }
            if is_local_maximum(plane, x, y, value)
                && has_connected_support(plane, x, y, support_threshold)
            {
                candidates.push(Candidate { x, y, height: value - background.median });
            }
        }
    }
    candidates.sort_by(|a, b| b.height.total_cmp(&a.height).then((a.y, a.x).cmp(&(b.y, b.x))));
    let truncated = candidates.len() > MAX_CANDIDATES;
    candidates.truncate(MAX_CANDIDATES);
    Ok(candidates).map(|candidates| (candidates, truncated))
}

/// Estimated sigma from the largest half-width at half maximum over eight
/// directions, and the fit box radius: three sigma clamped to 4..=15 px.
pub fn box_radius(plane: &Plane, candidate: Candidate, background: f64) -> (f64, u32) {
    let half = background + candidate.height / 2.0;
    let directions: [(i64, i64); 8] =
        [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)];
    let mut widest: f64 = 0.0;
    for (dx, dy) in directions {
        let step_length = ((dx * dx + dy * dy) as f64).sqrt();
        let mut previous = background + candidate.height;
        let mut hwhm = None;
        for step in 1..=i64::from(MAX_HWHM_STEPS) {
            let x = i64::from(candidate.x) + dx * step;
            let y = i64::from(candidate.y) + dy * step;
            if x < 0 || y < 0 || x >= i64::from(plane.width) || y >= i64::from(plane.height) {
                hwhm = Some((step - 1) as f64 * step_length);
                break;
            }
            let Some(value) = detect_value(plane, x as u32, y as u32) else {
                continue;
            };
            if value < half {
                let fraction =
                    if previous > value { (previous - half) / (previous - value) } else { 1.0 };
                hwhm = Some(((step - 1) as f64 + fraction.clamp(0.0, 1.0)) * step_length);
                break;
            }
            previous = value;
        }
        widest = widest.max(hwhm.unwrap_or_else(|| f64::from(MAX_HWHM_STEPS) * step_length));
    }
    let sigma = (widest / HWHM_PER_SIGMA).max(MIN_SIGMA_PX);
    let radius = (BOX_SIGMA_MULTIPLE * sigma)
        .ceil()
        .clamp(f64::from(BOX_RADIUS_MIN_PX), f64::from(BOX_RADIUS_MAX_PX));
    (sigma, radius as u32)
}

/// Samples of the box clipped to the plane: valid samples for the fit and
/// counts of masked and saturated samples.
struct BoxSamples {
    valid: Vec<FitSample>,
    border: Vec<f64>,
    masked: usize,
    saturated: usize,
    total: usize,
}

fn box_samples(plane: &Plane, cx: u32, cy: u32, radius: u32) -> BoxSamples {
    let x0 = cx.saturating_sub(radius);
    let y0 = cy.saturating_sub(radius);
    let x1 = (cx + radius).min(plane.width - 1);
    let y1 = (cy + radius).min(plane.height - 1);
    let mut samples =
        BoxSamples { valid: Vec::new(), border: Vec::new(), masked: 0, saturated: 0, total: 0 };
    for y in y0..=y1 {
        for x in x0..=x1 {
            samples.total += 1;
            match plane.value_at(y as usize * plane.width as usize + x as usize) {
                (value, Category::Valid) => {
                    samples.valid.push(FitSample { x: f64::from(x), y: f64::from(y), value });
                    if x == x0 || x == x1 || y == y0 || y == y1 {
                        samples.border.push(value);
                    }
                }
                (_, Category::Saturated) => samples.saturated += 1,
                _ => samples.masked += 1,
            }
        }
    }
    samples
}

fn push_unique<T: PartialEq>(values: &mut Vec<T>, value: T) {
    if !values.contains(&value) {
        values.push(value);
    }
}

/// Measures one candidate: not fitted near an edge, failed with its reasons,
/// or fitted with shape and HFR.
#[allow(clippy::too_many_lines)]
pub fn measure_star(
    plane: &Plane,
    index: u32,
    candidate: Candidate,
    candidates: &[Candidate],
    background: Background,
) -> Star {
    let (sigma, radius) = box_radius(plane, candidate, background.median);
    let samples = box_samples(plane, candidate.x, candidate.y, radius);
    let local_background = median(&samples.border).unwrap_or(background.median);
    let peak = samples
        .valid
        .iter()
        .map(|sample| sample.value)
        .max_by(f64::total_cmp)
        .map_or(0.0, |value| value - local_background);
    let flux_around =
        |level: f64| samples.valid.iter().map(|sample| sample.value - level).sum::<f64>();
    let mut star = Star {
        index,
        x: f64::from(candidate.x),
        y: f64::from(candidate.y),
        state: StarState::Failed,
        reasons: Vec::new(),
        warnings: Vec::new(),
        peak,
        flux: flux_around(local_background),
        local_background,
        box_radius: radius,
        shape: None,
    };
    if plane.saturation.level.is_none() {
        star.warnings.push(StarWarning::SaturationUnknown);
    }
    let r = i64::from(radius);
    let blended = candidates.iter().any(|other| {
        (other.x, other.y) != (candidate.x, candidate.y)
            && (i64::from(other.x) - i64::from(candidate.x)).abs() <= r
            && (i64::from(other.y) - i64::from(candidate.y)).abs() <= r
    });
    if blended {
        star.warnings.push(StarWarning::Blended);
    }
    if candidate.x < radius
        || candidate.y < radius
        || candidate.x + radius >= plane.width
        || candidate.y + radius >= plane.height
    {
        star.state = StarState::NotFitted;
        star.reasons.push(StarReason::NearEdge);
        star.warnings.push(StarWarning::NearEdge);
        return star;
    }
    if samples.saturated > 0 {
        star.reasons.push(StarReason::Saturated);
        push_unique(&mut star.warnings, StarWarning::Saturated);
    }
    if samples.masked as f64 > MAX_MASKED_FRACTION * samples.total as f64 {
        star.reasons.push(StarReason::TooManyMaskedSamples);
    } else if samples.masked > 0 {
        star.warnings.push(StarWarning::MaskedSamplesExcluded);
    }
    if !star.reasons.is_empty() {
        return star;
    }
    let width = 1.0 / (2.0 * sigma * sigma);
    let initial = Gaussian {
        amplitude: peak.max(f64::MIN_POSITIVE),
        x: f64::from(candidate.x),
        y: f64::from(candidate.y),
        a: width,
        b: 0.0,
        c: width,
        background: local_background,
    };
    let model = match fit(&samples.valid, initial) {
        Ok(model) => model,
        Err(FitError::NoConvergence) => {
            star.reasons.push(StarReason::NoConvergence);
            return star;
        }
        Err(FitError::Degenerate) => {
            star.reasons.push(StarReason::SigmaOutOfRange);
            return star;
        }
    };
    let Some(shape) = model.shape() else {
        star.reasons.push(StarReason::SigmaOutOfRange);
        return star;
    };
    if shape.sigma_minor < MIN_SIGMA_PX || shape.sigma_major > f64::from(radius) {
        star.reasons.push(StarReason::SigmaOutOfRange);
    }
    if (model.x - f64::from(candidate.x)).hypot(model.y - f64::from(candidate.y))
        > MAX_CENTER_SHIFT_PX
    {
        star.reasons.push(StarReason::CenterMoved);
    }
    if !star.reasons.is_empty() {
        return star;
    }
    let Some(hfr) =
        half_flux_radius(&samples.valid, model.x, model.y, model.background, f64::from(radius))
    else {
        star.reasons.push(StarReason::NoConvergence);
        return star;
    };
    let fwhm_major = FWHM_PER_SIGMA * shape.sigma_major;
    let fwhm_minor = FWHM_PER_SIGMA * shape.sigma_minor;
    let ratio = shape.sigma_minor / shape.sigma_major;
    star.state = StarState::Fitted;
    star.x = model.x;
    star.y = model.y;
    star.peak = model.amplitude;
    star.local_background = model.background;
    star.flux = flux_around(model.background);
    star.shape = Some(StarShape {
        fwhm_major,
        fwhm_minor,
        fwhm: (fwhm_major * fwhm_minor).sqrt(),
        eccentricity: (1.0 - ratio * ratio).max(0.0).sqrt(),
        position_angle_deg: shape.angle_deg,
        hfr,
    });
    star
}
