// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Half-flux radius (R7): measured from samples, never derived from FWHM.

use crate::psf::FitSample;

/// The radius at which the background-subtracted flux inside `radius` of
/// (`cx`, `cy`) reaches half its total, linearly interpolated over
/// sample-center distances. A sample covers distances on both sides of its
/// center, so the enclosed flux at a sample's distance counts half of that
/// sample. `None` when the enclosed flux is not positive.
pub fn half_flux_radius(
    samples: &[FitSample],
    cx: f64,
    cy: f64,
    background: f64,
    radius: f64,
) -> Option<f64> {
    let mut rings: Vec<(f64, f64)> = samples
        .iter()
        .map(|sample| ((sample.x - cx).hypot(sample.y - cy), sample.value - background))
        .filter(|(distance, _)| *distance <= radius)
        .collect();
    rings.sort_by(|a, b| a.0.total_cmp(&b.0));
    let total: f64 = rings.iter().map(|(_, flux)| flux).sum();
    if !(total > 0.0 && total.is_finite()) {
        return None;
    }
    let half = total / 2.0;
    let mut enclosed = 0.0;
    let mut previous = (0.0, 0.0);
    for (distance, flux) in rings {
        let point = (distance, enclosed + flux / 2.0);
        if point.1 >= half {
            let rise = point.1 - previous.1;
            let fraction = if rise > 0.0 { (half - previous.1) / rise } else { 1.0 };
            return Some(previous.0 + fraction * (point.0 - previous.0));
        }
        enclosed += flux;
        previous = point;
    }
    Some(previous.0)
}
