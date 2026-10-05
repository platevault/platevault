// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Memory-only display: plane statistics, stretched tiles, comparison
//! regions and sample readout (R15).
//!
//! A [`DisplayTile`] holds 8-bit gray values and mask codes. It has no
//! conversion to a [`Plane`], so a stretched tile cannot reach measurement:
//!
//! ```compile_fail
//! use std::sync::atomic::AtomicBool;
//! use platevault_pixels::display::DisplayTile;
//!
//! fn measure_a_tile(tile: &DisplayTile) {
//!     let _ = platevault_pixels::measure::measure(tile, &AtomicBool::new(false));
//! }
//! ```

use crate::measure::MAD_TO_SIGMA;
use crate::stats::{mad_in_place, median_in_place, valid_values};
use crate::{Category, PixelError, Plane, Sample};

/// Largest tile side.
pub const MAX_TILE_SIDE: u32 = 1024;
/// Largest level; level k averages 2^k blocks.
pub const MAX_LEVEL: u8 = 8;
/// Largest sample readout side.
pub const MAX_SAMPLE_SIDE: u32 = 64;
/// Auto stretch: shadows clip at the median plus this many sigma (MAD based).
pub const AUTO_SHADOWS_SIGMA: f64 = -2.8;
/// Auto stretch: the median maps to this fraction of full scale.
pub const AUTO_TARGET_BACKGROUND: f64 = 0.25;

/// A requested display stretch: linear in plane units, or a midtones
/// transfer in normalized units over the plane's valid range.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Stretch {
    Linear { black: f64, white: f64 },
    Mtf { shadows: f64, midtones: f64, highlights: f64 },
    Auto,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StretchKind {
    Linear,
    Mtf,
    Auto,
}

/// The mapping a tile applied: `x = clamp((v - black) / (white - black))`,
/// then the midtones transfer of `clamp((x - shadows) / (highlights -
/// shadows))`, scaled to 0..=255.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AppliedStretch {
    pub kind: StretchKind,
    pub black: f64,
    pub white: f64,
    pub shadows: f64,
    pub midtones: f64,
    pub highlights: f64,
}

/// Valid-sample statistics in plane units; `None` without valid samples.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PlaneStatistics {
    pub valid: u64,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub median: Option<f64>,
    /// Median absolute deviation from the median.
    pub mad: Option<f64>,
}

/// A rectangle in the coordinates of some level.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Region {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// A rendered tile: row-major gray values and, when any block is fully
/// masked, its mask codes (`Category::code`).
#[derive(Clone, Debug, PartialEq)]
pub struct DisplayTile {
    pub level: u8,
    /// The rendered region in level coordinates, clamped to the level grid.
    pub region: Region,
    pub applied: AppliedStretch,
    pub gray: Vec<u8>,
    pub mask: Option<Vec<u8>>,
}

/// Statistics of the plane's valid samples.
#[must_use]
pub fn statistics(plane: &Plane) -> PlaneStatistics {
    let mut values = valid_values(plane);
    let min = values.iter().copied().min_by(f64::total_cmp);
    let max = values.iter().copied().max_by(f64::total_cmp);
    let median = median_in_place(&mut values);
    let mad = median.and_then(|median| mad_in_place(&mut values, median));
    PlaneStatistics { valid: values.len() as u64, min, max, median, mad }
}

/// The midtones transfer function `((m - 1) x) / ((2m - 1) x - m)`.
fn mtf(midtones: f64, x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    if x >= 1.0 {
        return 1.0;
    }
    ((midtones - 1.0) * x) / ((2.0 * midtones - 1.0) * x - midtones)
}

fn range(stats: &PlaneStatistics) -> (f64, f64) {
    match (stats.min, stats.max) {
        (Some(min), Some(max)) if max > min => (min, max),
        (Some(min), _) => (min, min + 1.0),
        _ => (0.0, 1.0),
    }
}

/// Resolves a stretch against the plane statistics.
#[must_use]
pub fn apply(stretch: &Stretch, stats: &PlaneStatistics) -> AppliedStretch {
    match *stretch {
        Stretch::Linear { black, white } => AppliedStretch {
            kind: StretchKind::Linear,
            black,
            white,
            shadows: 0.0,
            midtones: 0.5,
            highlights: 1.0,
        },
        Stretch::Mtf { shadows, midtones, highlights } => {
            let (black, white) = range(stats);
            AppliedStretch { kind: StretchKind::Mtf, black, white, shadows, midtones, highlights }
        }
        Stretch::Auto => {
            let (black, white) = range(stats);
            let span = white - black;
            let (shadows, midtones) = match (stats.median, stats.mad) {
                (Some(median), Some(mad)) => {
                    let median = ((median - black) / span).clamp(0.0, 1.0);
                    let sigma = MAD_TO_SIGMA * mad / span;
                    let shadows =
                        (median + AUTO_SHADOWS_SIGMA * sigma).clamp(0.0, 1.0 - f64::EPSILON);
                    let x0 = (median - shadows) / (1.0 - shadows);
                    let midtones = if x0 > 0.0 && x0 < 1.0 {
                        mtf(AUTO_TARGET_BACKGROUND, x0).clamp(f64::EPSILON, 1.0 - f64::EPSILON)
                    } else {
                        0.5
                    };
                    (shadows, midtones)
                }
                _ => (0.0, 0.5),
            };
            AppliedStretch {
                kind: StretchKind::Auto,
                black,
                white,
                shadows,
                midtones,
                highlights: 1.0,
            }
        }
    }
}

fn gray(value: f64, applied: &AppliedStretch) -> u8 {
    let span = applied.white - applied.black;
    // Linear multiplies before dividing so exact plane values land on exact
    // gray levels.
    let level = if applied.kind == StretchKind::Linear {
        ((value - applied.black) * 255.0 / span).round()
    } else {
        let x = ((value - applied.black) / span).clamp(0.0, 1.0);
        let x = ((x - applied.shadows) / (applied.highlights - applied.shadows)).clamp(0.0, 1.0);
        (mtf(applied.midtones, x) * 255.0).round()
    };
    level.clamp(0.0, 255.0) as u8
}

/// Renders `region` (level coordinates) of `plane` at `level`. Each output
/// sample averages the valid samples of its 2^level block; a block without
/// valid samples renders gray 0 with its most frequent mask code.
///
/// # Errors
///
/// `InvalidRegion` for a level above 8, a side above 1024 or a region
/// outside the level grid.
pub fn render_tile(
    plane: &Plane,
    stats: &PlaneStatistics,
    region: Region,
    level: u8,
    stretch: &Stretch,
) -> Result<DisplayTile, PixelError> {
    if level > MAX_LEVEL
        || region.width == 0
        || region.height == 0
        || region.width > MAX_TILE_SIDE
        || region.height > MAX_TILE_SIDE
    {
        return Err(PixelError::InvalidRegion(format!("tile {region:?} at level {level}")));
    }
    let block = 1_u32 << level;
    let grid_width = plane.width.div_ceil(block);
    let grid_height = plane.height.div_ceil(block);
    if region.x >= grid_width || region.y >= grid_height {
        return Err(PixelError::InvalidRegion(format!(
            "tile {region:?} outside the {grid_width}x{grid_height} grid of level {level}"
        )));
    }
    let region = Region {
        width: region.width.min(grid_width - region.x),
        height: region.height.min(grid_height - region.y),
        ..region
    };
    let applied = apply(stretch, stats);
    let mut gray_values = Vec::with_capacity(region.width as usize * region.height as usize);
    let mut mask = Vec::with_capacity(gray_values.capacity());
    for ty in region.y..region.y + region.height {
        for tx in region.x..region.x + region.width {
            let mut sum = 0.0;
            let mut count = 0_u64;
            let mut masked = [0_u64; 6];
            for y in ty * block..((ty + 1) * block).min(plane.height) {
                for x in tx * block..((tx + 1) * block).min(plane.width) {
                    match plane.value_at(y as usize * plane.width as usize + x as usize) {
                        (value, Category::Valid) => {
                            sum += value;
                            count += 1;
                        }
                        (_, category) => masked[usize::from(category.code())] += 1,
                    }
                }
            }
            if count > 0 {
                gray_values.push(gray(sum / count as f64, &applied));
                mask.push(0);
            } else {
                let code = (1..masked.len())
                    .max_by(|a, b| masked[*a].cmp(&masked[*b]).then(b.cmp(a)))
                    .unwrap_or(1);
                gray_values.push(0);
                mask.push(code as u8);
            }
        }
    }
    Ok(DisplayTile {
        level,
        region,
        applied,
        gray: gray_values,
        mask: mask.iter().any(|code| *code != 0).then_some(mask),
    })
}

/// Five full-resolution regions of side `size`, clamped to the frame: the
/// center, top-left, top-right, bottom-left and bottom-right.
#[must_use]
pub fn comparison_regions(width: u32, height: u32, size: u32) -> [Region; 5] {
    let w = size.min(width);
    let h = size.min(height);
    let region = |x, y| Region { x, y, width: w, height: h };
    [
        region((width - w) / 2, (height - h) / 2),
        region(0, 0),
        region(width - w, 0),
        region(0, height - h),
        region(width - w, height - h),
    ]
}

/// Up to 64×64 samples at full resolution, row-major, as stored.
///
/// # Errors
///
/// `InvalidRegion` for an empty region, a side above 64 or a region outside
/// the plane.
pub fn sample_region(plane: &Plane, region: Region) -> Result<Vec<Sample>, PixelError> {
    let inside = u64::from(region.x) + u64::from(region.width) <= u64::from(plane.width)
        && u64::from(region.y) + u64::from(region.height) <= u64::from(plane.height);
    if region.width == 0
        || region.height == 0
        || region.width > MAX_SAMPLE_SIDE
        || region.height > MAX_SAMPLE_SIDE
        || !inside
    {
        return Err(PixelError::InvalidRegion(format!(
            "sample region {region:?} on a {}x{} plane",
            plane.width, plane.height
        )));
    }
    Ok((region.y..region.y + region.height)
        .flat_map(|y| (region.x..region.x + region.width).map(move |x| (x, y)))
        .map(|(x, y)| plane.sample(x, y))
        .collect())
}
