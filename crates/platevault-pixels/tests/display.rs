// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Memory-only display tiles, regions and sample readout (R15, PIX-FR-03,
//! PIX-FR-04, PIX-AC-02, PIX-AC-08, PIX-AC-09).
#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::float_cmp
)]

use platevault_pixels::display::{
    comparison_regions, render_tile, sample_region, statistics, Region, Stretch, StretchKind,
};
use platevault_pixels::fixtures::{quantize, CfaModulation, SyntheticFrame, SyntheticStar};
use platevault_pixels::{
    Category, CfaEvidence, CfaSource, PixelError, Plane, PlaneKind, SampleFormat, Saturation,
    SaturationSource, Scaling, StoredSamples, StoredValue,
};
use sha2::{Digest, Sha256};

fn digest(samples: &StoredSamples) -> String {
    hex::encode(Sha256::digest(format!("{samples:?}").as_bytes()))
}

fn plane(width: u32, height: u32, samples: StoredSamples, kind: PlaneKind) -> Plane {
    Plane {
        width,
        height,
        kind,
        samples,
        scaling: Scaling::IDENTITY,
        blank: None,
        saturation: Saturation { level: Some(65535.0), source: SaturationSource::TypeMaximum },
    }
}

fn star_frame() -> Plane {
    let frame = SyntheticFrame {
        stars: vec![
            SyntheticStar {
                x: 60.2,
                y: 70.5,
                amplitude: 20000.0,
                sigma_major: 2.5,
                sigma_minor: 2.0,
                angle_deg: 10.0,
            },
            SyntheticStar {
                x: 180.0,
                y: 150.0,
                amplitude: 3000.0,
                sigma_major: 2.0,
                sigma_minor: 2.0,
                angle_deg: 0.0,
            },
        ],
        ..SyntheticFrame::new(256, 256, 5, 1000.0, 10.0)
    };
    plane(
        256,
        256,
        quantize(&frame.render(), SampleFormat::U16, Scaling::IDENTITY),
        PlaneKind::Mono,
    )
}

fn full(plane: &Plane) -> Region {
    Region { x: 0, y: 0, width: plane.width, height: plane.height }
}

#[test]
fn linear_strong_mtf_and_auto_tiles_differ_and_leave_samples_unchanged() {
    let plane = star_frame();
    let before = digest(&plane.samples);
    let copy = plane.clone();
    let stats = statistics(&plane);
    assert_eq!(stats.valid, 256 * 256);
    let linear = render_tile(
        &plane,
        &stats,
        full(&plane),
        0,
        &Stretch::Linear { black: 950.0, white: 1200.0 },
    )
    .unwrap();
    let strong = render_tile(
        &plane,
        &stats,
        full(&plane),
        0,
        &Stretch::Mtf { shadows: 0.0, midtones: 0.01, highlights: 1.0 },
    )
    .unwrap();
    let auto = render_tile(&plane, &stats, full(&plane), 0, &Stretch::Auto).unwrap();
    assert_ne!(linear.gray, strong.gray);
    assert_ne!(linear.gray, auto.gray);
    assert_ne!(strong.gray, auto.gray);
    assert_eq!(linear.applied.kind, StretchKind::Linear);
    assert_eq!((linear.applied.black, linear.applied.white), (950.0, 1200.0));
    assert_eq!(strong.applied.kind, StretchKind::Mtf);
    assert_eq!(auto.applied.kind, StretchKind::Auto);
    assert!(auto.applied.midtones > 0.0 && auto.applied.midtones < 1.0);
    assert!(auto.applied.shadows >= 0.0 && auto.applied.shadows < auto.applied.highlights);
    assert_eq!(render_tile(&plane, &stats, full(&plane), 0, &Stretch::Auto).unwrap(), auto);
    let mut background: Vec<u8> = auto.gray;
    background.sort_unstable();
    let median = background[background.len() / 2];
    assert!(
        (50..=80).contains(&median),
        "auto maps the background near a quarter of full scale: {median}"
    );
    assert!(linear.mask.is_none());
    assert_eq!(digest(&plane.samples), before);
    assert_eq!(plane, copy);
}

#[test]
fn coarser_levels_average_valid_samples_and_all_masked_blocks_read_masked() {
    let mut values: Vec<f32> = (0..64).map(|index| index as f32).collect();
    values[0] = f32::NAN; // block (0, 0) keeps 1, 8 and 9
    for index in [6, 7, 14, 15] {
        values[index] = f32::NAN; // block (3, 0) is all NaN
    }
    for index in [48, 49, 56, 57] {
        values[index] = f32::INFINITY; // block (0, 3) is all +Inf
    }
    let plane = plane(8, 8, StoredSamples::F32(values), PlaneKind::Mono);
    let stats = statistics(&plane);
    let linear = Stretch::Linear { black: 0.0, white: 255.0 };
    let tile = render_tile(&plane, &stats, Region { x: 0, y: 0, width: 4, height: 4 }, 1, &linear)
        .unwrap();
    assert_eq!((tile.region.width, tile.region.height, tile.level), (4, 4, 1));
    assert_eq!(tile.gray[0], ((1.0 + 8.0 + 9.0) / 3.0_f64).round() as u8);
    assert_eq!(tile.gray[1], ((2.0 + 3.0 + 10.0 + 11.0) / 4.0_f64).round() as u8);
    assert_eq!(tile.gray[3], 0);
    assert_eq!(tile.gray[12], 0);
    let mask = tile.mask.as_ref().expect("masked blocks have codes");
    assert_eq!(mask[3], Category::Nan.code());
    assert_eq!(mask[12], Category::PosInf.code());
    assert_eq!(mask[0], 0);
    assert_eq!(mask.iter().filter(|code| **code != 0).count(), 2);

    let coarse =
        render_tile(&plane, &stats, Region { x: 0, y: 0, width: 1, height: 1 }, 3, &linear)
            .unwrap();
    let valid: Vec<f64> = (0..64)
        .filter(|index| ![0, 6, 7, 14, 15, 48, 49, 56, 57].contains(index))
        .map(f64::from)
        .collect();
    assert_eq!(coarse.gray[0], (valid.iter().sum::<f64>() / valid.len() as f64).round() as u8);

    let odd = plane_7x7();
    let tile = render_tile(
        &odd,
        &statistics(&odd),
        Region { x: 0, y: 0, width: 4, height: 4 },
        1,
        &linear,
    )
    .unwrap();
    assert_eq!(tile.gray[3], 9.5_f64.round() as u8, "a partial edge block averages what it covers");
    assert_eq!(tile.gray[15], 48);
    assert!(matches!(
        render_tile(
            &odd,
            &statistics(&odd),
            Region { x: 4, y: 0, width: 1, height: 1 },
            1,
            &linear
        ),
        Err(PixelError::InvalidRegion(_))
    ));
}

fn plane_7x7() -> Plane {
    plane(7, 7, StoredSamples::F32((0..49).map(|index| index as f32).collect()), PlaneKind::Mono)
}

#[test]
fn comparison_regions_sit_at_the_centre_and_corners_and_clamp_to_small_frames() {
    let regions = comparison_regions(100, 80, 32);
    assert_eq!(
        regions,
        [
            Region { x: 34, y: 24, width: 32, height: 32 },
            Region { x: 0, y: 0, width: 32, height: 32 },
            Region { x: 68, y: 0, width: 32, height: 32 },
            Region { x: 0, y: 48, width: 32, height: 32 },
            Region { x: 68, y: 48, width: 32, height: 32 },
        ]
    );
    let small = comparison_regions(20, 10, 32);
    assert!(small.iter().all(|region| *region == Region { x: 0, y: 0, width: 20, height: 10 }));
}

#[test]
fn sample_readout_is_bounded_and_returns_masked_samples_as_stored() {
    let values = vec![f32::NAN, f32::INFINITY, f32::NEG_INFINITY, 7.5];
    let defects = plane(2, 2, StoredSamples::F32(values), PlaneKind::Mono);
    let samples = sample_region(&defects, Region { x: 0, y: 0, width: 2, height: 2 }).unwrap();
    assert_eq!(samples.len(), 4);
    assert!(matches!(samples[0].stored, StoredValue::Float(value) if value.is_nan()));
    assert_eq!(samples[0].category, Category::Nan);
    assert_eq!(samples[1].stored, StoredValue::Float(f64::INFINITY));
    assert_eq!(samples[1].category, Category::PosInf);
    assert_eq!(samples[2].value, f64::NEG_INFINITY);
    assert_eq!(samples[2].category, Category::NegInf);
    assert_eq!(samples[3].value, 7.5);
    let large = plane_7x7();
    assert!(matches!(
        sample_region(&large, Region { x: 0, y: 0, width: 65, height: 1 }),
        Err(PixelError::InvalidRegion(_))
    ));
    assert!(matches!(
        sample_region(&large, Region { x: 0, y: 0, width: 1, height: 65 }),
        Err(PixelError::InvalidRegion(_))
    ));
    assert!(matches!(
        sample_region(&large, Region { x: 5, y: 0, width: 3, height: 1 }),
        Err(PixelError::InvalidRegion(_))
    ));
    let wide = plane(64, 64, StoredSamples::U8(vec![3; 64 * 64]), PlaneKind::Mono);
    assert_eq!(
        sample_region(&wide, Region { x: 0, y: 0, width: 64, height: 64 }).unwrap().len(),
        64 * 64
    );
}

#[test]
fn cfa_mosaic_tiles_keep_the_checkerboard_sample_for_sample() {
    let frame = SyntheticFrame {
        cfa: Some(CfaModulation { gains: [1.0, 0.6, 0.6, 0.3] }),
        ..SyntheticFrame::new(32, 32, 7, 2000.0, 5.0)
    };
    let mosaic = plane(
        32,
        32,
        quantize(&frame.render(), SampleFormat::U16, Scaling::IDENTITY),
        PlaneKind::CfaMosaic(CfaEvidence {
            pattern: Some("RGGB".into()),
            x_offset: None,
            y_offset: None,
            row_order: None,
            source: CfaSource::BayerpatKeyword,
        }),
    );
    let stats = statistics(&mosaic);
    let tile = render_tile(
        &mosaic,
        &stats,
        full(&mosaic),
        0,
        &Stretch::Linear { black: 500.0, white: 2100.0 },
    )
    .unwrap();
    assert_eq!(tile.gray.len(), 32 * 32);
    let StoredSamples::U16(stored) = &mosaic.samples else { panic!("u16 mosaic") };
    let mut pairs: Vec<(u16, u8)> = stored.iter().copied().zip(tile.gray.iter().copied()).collect();
    pairs.sort_unstable();
    assert!(
        pairs.windows(2).all(|pair| pair[0].1 <= pair[1].1),
        "gray is monotonic in the stored value"
    );
    for y in (0..32).step_by(2) {
        for x in (0..32).step_by(2) {
            let red = tile.gray[y * 32 + x];
            let blue = tile.gray[(y + 1) * 32 + x + 1];
            assert!(red > blue, "the RGGB checkerboard survives at ({x}, {y})");
        }
    }
}
