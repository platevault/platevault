// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Order statistics and clipped background estimation (R7).

use crate::measure::{CLIP_MAX_PASSES, CLIP_SIGMA, MAD_TO_SIGMA};
use crate::{Category, Plane};

/// The median of `values`, reordering them. Even counts average the two
/// middle values.
pub fn median_in_place(values: &mut [f64]) -> Option<f64> {
    median_by_key(values, |value| value)
}

/// The median of `key(value)` over `values`, reordering them.
fn median_by_key(values: &mut [f64], key: impl Fn(f64) -> f64) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let odd = values.len() % 2 == 1;
    let middle = values.len() / 2;
    let (lower, upper, _) =
        values.select_nth_unstable_by(middle, |a, b| key(*a).total_cmp(&key(*b)));
    let upper = key(*upper);
    if odd {
        return Some(upper);
    }
    let below = lower.iter().map(|value| key(*value)).max_by(f64::total_cmp).unwrap_or(upper);
    Some(below + (upper - below) / 2.0)
}

/// The median absolute deviation from `center`, reordering `values`.
pub fn mad_in_place(values: &mut [f64], center: f64) -> Option<f64> {
    median_by_key(values, |value| (value - center).abs())
}

/// The median of a copy of `values`.
pub fn median(values: &[f64]) -> Option<f64> {
    median_in_place(&mut values.to_vec())
}

/// Clipped background of valid samples: `median` and `noise` (1.4826 MAD).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Background {
    pub median: f64,
    pub noise: f64,
}

/// Every valid sample value (masked and saturated samples excluded).
pub fn valid_values(plane: &Plane) -> Vec<f64> {
    (0..plane.len())
        .filter_map(|index| match plane.value_at(index) {
            (value, Category::Valid) => Some(value),
            _ => None,
        })
        .collect()
}

/// Iterative 3-sigma clipping until the set is stable or after 10 passes,
/// then the median and 1.4826 MAD of the clipped set.
pub fn clipped_background(mut values: Vec<f64>) -> Option<Background> {
    for _ in 0..CLIP_MAX_PASSES {
        let center = median_in_place(&mut values)?;
        let sigma = MAD_TO_SIGMA * mad_in_place(&mut values, center)?;
        let before = values.len();
        values.retain(|value| (value - center).abs() <= CLIP_SIGMA * sigma);
        if values.len() == before || values.is_empty() {
            break;
        }
    }
    let median = median_in_place(&mut values)?;
    let noise = MAD_TO_SIGMA * mad_in_place(&mut values, median)?;
    Some(Background { median, noise })
}
