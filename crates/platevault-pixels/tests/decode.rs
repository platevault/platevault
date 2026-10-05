// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Decoding generated FITS and XISF files back to their stored samples
//! (R4-R6, PIX-FR-09, PIX-AC-08, PIX-AC-09).
#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cognitive_complexity,
    clippy::too_many_lines,
    clippy::needless_pass_by_value
)]

use std::io::{Cursor, Read};
use std::sync::atomic::AtomicBool;

use platevault_pixels::decode::decode;
use platevault_pixels::fixtures::{
    quantize, set_integer, write_fits, write_xisf, CfaModulation, FitsImage, SyntheticFrame,
    SyntheticStar, XisfImage,
};
use platevault_pixels::{
    ByteOrder, Category, CfaEvidence, CfaSource, Codec, Container, DecodedImage, PixelError,
    PixelStorage, PlaneKind, SampleFormat, SaturationSource, Scaling, StoredSamples,
};
use sha2::{Digest, Sha256};

fn decode_bytes(container: Container, bytes: &[u8]) -> Result<DecodedImage, PixelError> {
    decode(container, &mut Cursor::new(bytes), &AtomicBool::new(false))
}

fn frame(width: u32, height: u32, seed: u64, background: f64, noise: f64) -> SyntheticFrame {
    SyntheticFrame {
        stars: vec![SyntheticStar {
            x: f64::from(width) / 2.0 + 0.3,
            y: f64::from(height) / 2.0 - 0.2,
            amplitude: background * 3.0,
            sigma_major: 2.0,
            sigma_minor: 1.6,
            angle_deg: 40.0,
        }],
        ..SyntheticFrame::new(width, height, seed, background, noise)
    }
}

fn fits(
    stored: &StoredSamples,
    width: u32,
    height: u32,
    channels: u32,
    scaling: Scaling,
) -> Vec<u8> {
    fits_with(stored, width, height, channels, scaling, None, &[])
}

fn fits_with(
    stored: &StoredSamples,
    width: u32,
    height: u32,
    channels: u32,
    scaling: Scaling,
    blank: Option<i64>,
    cards: &[(&str, String)],
) -> Vec<u8> {
    write_fits(&FitsImage { width, height, channels, samples: stored, scaling, blank, cards })
        .unwrap()
}

fn split(stored: &StoredSamples, planes: usize) -> Vec<StoredSamples> {
    let len = stored.len() / planes;
    macro_rules! chunks {
        ($variant:ident, $values:expr) => {
            $values.chunks(len).map(|chunk| StoredSamples::$variant(chunk.to_vec())).collect()
        };
    }
    match stored {
        StoredSamples::U8(values) => chunks!(U8, values),
        StoredSamples::I16(values) => chunks!(I16, values),
        StoredSamples::U16(values) => chunks!(U16, values),
        StoredSamples::I32(values) => chunks!(I32, values),
        StoredSamples::U32(values) => chunks!(U32, values),
        StoredSamples::I64(values) => chunks!(I64, values),
        StoredSamples::F32(values) => chunks!(F32, values),
        StoredSamples::F64(values) => chunks!(F64, values),
    }
}

#[test]
fn fits_every_bitpix_decodes_to_the_written_samples_and_scaling() {
    let cases = [
        (SampleFormat::U8, Scaling::IDENTITY, 100.0, 5.0),
        (SampleFormat::I16, Scaling { zero: 32768.0, scale: 1.0 }, 1000.0, 10.0),
        (SampleFormat::I32, Scaling { zero: 0.0, scale: 0.5 }, 1000.0, 10.0),
        (SampleFormat::I64, Scaling { zero: -5.0, scale: 1.0 }, 1000.0, 10.0),
        (SampleFormat::F32, Scaling::IDENTITY, 0.1, 0.001),
        (SampleFormat::F64, Scaling { zero: 10.0, scale: 2.0 }, 1000.0, 10.0),
    ];
    for (format, scaling, background, noise) in cases {
        let stored = quantize(&frame(40, 30, 3, background, noise).render(), format, scaling);
        let decoded = decode_bytes(Container::Fits, &fits(&stored, 40, 30, 1, scaling)).unwrap();
        assert_eq!(decoded.container, Container::Fits);
        assert_eq!(decoded.planes.len(), 1, "{format:?}");
        let plane = &decoded.planes[0];
        assert_eq!((plane.width, plane.height), (40, 30));
        assert_eq!(plane.kind, PlaneKind::Mono);
        assert_eq!(plane.samples, stored, "{format:?}");
        assert_eq!(plane.scaling, scaling, "{format:?}");
        assert_eq!(decoded.evidence.sample_format, format);
        assert_eq!(decoded.evidence.geometry, vec![40, 30]);
        assert_eq!(decoded.evidence.byte_order, ByteOrder::Big);
        let expected_source = if format.is_float() {
            SaturationSource::Unknown
        } else {
            SaturationSource::TypeMaximum
        };
        assert_eq!(plane.saturation.source, expected_source, "{format:?}");
    }
    let stored =
        quantize(&frame(8, 8, 1, 100.0, 1.0).render(), SampleFormat::I16, Scaling::IDENTITY);
    let decoded = decode_bytes(
        Container::Fits,
        &fits(&stored, 8, 8, 1, Scaling { zero: 32768.0, scale: 1.0 }),
    )
    .unwrap();
    assert_eq!(decoded.planes[0].saturation.level, Some(65535.0));
}

#[test]
fn fits_naxis3_yields_one_channel_plane_per_channel() {
    let mut values = Vec::new();
    for seed in 0..3 {
        values.extend(frame(16, 12, seed, 500.0 + 100.0 * seed as f64, 5.0).render());
    }
    let stored = quantize(&values, SampleFormat::F32, Scaling::IDENTITY);
    let decoded =
        decode_bytes(Container::Fits, &fits(&stored, 16, 12, 3, Scaling::IDENTITY)).unwrap();
    assert_eq!(decoded.planes.len(), 3);
    assert_eq!(decoded.evidence.geometry, vec![16, 12, 3]);
    for (index, (plane, expected)) in decoded.planes.iter().zip(split(&stored, 3)).enumerate() {
        assert_eq!(
            plane.kind,
            PlaneKind::Channel { index: index as u32, count: 3, color_space: None }
        );
        assert_eq!(plane.samples, expected);
    }
}

#[test]
fn xisf_formats_storages_byte_orders_and_codecs_decode_to_the_uncompressed_samples() {
    let mut values = Vec::new();
    for seed in 0..3 {
        values.extend(frame(20, 10, seed, 120.0, 4.0).render());
    }
    for format in [
        SampleFormat::U8,
        SampleFormat::U16,
        SampleFormat::U32,
        SampleFormat::F32,
        SampleFormat::F64,
    ] {
        let stored = quantize(&values, format, Scaling::IDENTITY);
        let baseline = decode_bytes(
            Container::Xisf,
            &write_xisf(&XisfImage::new(20, 10, 3, &stored)).unwrap(),
        )
        .unwrap();
        assert_eq!(baseline.container, Container::Xisf);
        let planes: Vec<StoredSamples> =
            baseline.planes.iter().map(|plane| plane.samples.clone()).collect();
        assert_eq!(planes, split(&stored, 3), "{format:?}");
        for storage in [PixelStorage::Planar, PixelStorage::Normal] {
            for byte_order in [ByteOrder::Little, ByteOrder::Big] {
                for codec in [None, Some(Codec::Zlib), Some(Codec::Lz4), Some(Codec::Lz4Hc)] {
                    for shuffle in [false, true] {
                        if codec.is_none() && shuffle {
                            continue;
                        }
                        let image = XisfImage {
                            storage,
                            byte_order,
                            codec,
                            shuffle,
                            ..XisfImage::new(20, 10, 3, &stored)
                        };
                        let label =
                            format!("{format:?} {storage:?} {byte_order:?} {codec:?} {shuffle}");
                        let decoded = decode_bytes(Container::Xisf, &write_xisf(&image).unwrap())
                            .unwrap_or_else(|error| panic!("{label}: {error}"));
                        assert_eq!(decoded.planes, baseline.planes, "{label}");
                        assert_eq!(decoded.evidence.storage, Some(storage), "{label}");
                        assert_eq!(decoded.evidence.byte_order, byte_order, "{label}");
                        let compression = decoded.evidence.compression;
                        assert_eq!(
                            compression.map(|compression| compression.codec),
                            codec,
                            "{label}"
                        );
                        assert_eq!(
                            compression.and_then(|compression| compression.shuffle_item_size),
                            shuffle.then_some(format.bytes() as u32),
                            "{label}"
                        );
                    }
                }
            }
        }
    }
}

fn cfa_frame() -> Vec<f64> {
    SyntheticFrame {
        cfa: Some(CfaModulation { gains: [1.0, 0.6, 0.6, 0.3] }),
        ..frame(24, 16, 9, 2000.0, 8.0)
    }
    .render()
}

#[test]
fn cfa_mosaics_keep_their_recorded_evidence_and_stored_samples() {
    let scaling = Scaling { zero: 32768.0, scale: 1.0 };
    let stored = quantize(&cfa_frame(), SampleFormat::I16, scaling);
    let cards = [
        ("BAYERPAT", "'RGGB'".to_owned()),
        ("XBAYROFF", "1".to_owned()),
        ("YBAYROFF", "0".to_owned()),
        ("ROWORDER", "'TOP-DOWN'".to_owned()),
    ];
    let decoded =
        decode_bytes(Container::Fits, &fits_with(&stored, 24, 16, 1, scaling, None, &cards))
            .unwrap();
    assert_eq!(decoded.planes.len(), 1);
    assert_eq!(
        decoded.planes[0].kind,
        PlaneKind::CfaMosaic(CfaEvidence {
            pattern: Some("RGGB".into()),
            x_offset: Some(1),
            y_offset: Some(0),
            row_order: Some("TOP-DOWN".into()),
            source: CfaSource::BayerpatKeyword,
        })
    );
    assert_eq!(decoded.planes[0].samples, stored);

    let stored = quantize(&cfa_frame(), SampleFormat::U16, Scaling::IDENTITY);
    let image = XisfImage { cfa_pattern: Some("RGGB"), ..XisfImage::new(24, 16, 1, &stored) };
    let decoded = decode_bytes(Container::Xisf, &write_xisf(&image).unwrap()).unwrap();
    assert_eq!(decoded.planes.len(), 1);
    assert_eq!(
        decoded.planes[0].kind,
        PlaneKind::CfaMosaic(CfaEvidence {
            pattern: Some("RGGB".into()),
            x_offset: None,
            y_offset: None,
            row_order: None,
            source: CfaSource::ColorFilterArray,
        })
    );
    assert_eq!(decoded.planes[0].samples, stored);
}

fn bits(samples: &StoredSamples) -> Vec<u64> {
    match samples {
        StoredSamples::F32(values) => {
            values.iter().map(|value| u64::from(value.to_bits())).collect()
        }
        StoredSamples::F64(values) => values.iter().map(|value| value.to_bits()).collect(),
        other => panic!("float samples expected, got {:?}", other.format()),
    }
}

#[test]
fn non_finite_blank_and_saturation_follow_the_recorded_evidence() {
    let defects = SyntheticFrame {
        overrides: vec![(1, 1, f64::NAN), (2, 1, f64::INFINITY), (3, 1, f64::NEG_INFINITY)],
        ..frame(16, 16, 4, 0.2, 0.01)
    };
    for format in [SampleFormat::F32, SampleFormat::F64] {
        let stored = quantize(&defects.render(), format, Scaling::IDENTITY);
        let decoded =
            decode_bytes(Container::Fits, &fits(&stored, 16, 16, 1, Scaling::IDENTITY)).unwrap();
        let plane = &decoded.planes[0];
        assert_eq!(bits(&plane.samples), bits(&stored));
        assert_eq!(plane.sample(1, 1).category, Category::Nan);
        assert_eq!(plane.sample(2, 1).category, Category::PosInf);
        assert_eq!(plane.sample(3, 1).category, Category::NegInf);
        assert_eq!(plane.saturation.source, SaturationSource::Unknown);
        let image = XisfImage { bounds: Some((0.0, 1.0)), ..XisfImage::new(16, 16, 1, &stored) };
        let decoded = decode_bytes(Container::Xisf, &write_xisf(&image).unwrap()).unwrap();
        let plane = &decoded.planes[0];
        assert_eq!(bits(&plane.samples), bits(&stored));
        assert_eq!(plane.saturation.source, SaturationSource::XisfBounds);
        assert_eq!(plane.saturation.level, Some(1.0));
        assert_eq!(decoded.evidence.bounds, Some((0.0, 1.0)));
        let counts = plane.mask_counts();
        assert_eq!((counts.nan, counts.pos_inf, counts.neg_inf), (1, 1, 1));
    }

    let stored = quantize(&defects.render(), SampleFormat::F32, Scaling::IDENTITY);
    let cards = [("SATURATE", "0.25".to_owned())];
    let decoded = decode_bytes(
        Container::Fits,
        &fits_with(&stored, 16, 16, 1, Scaling::IDENTITY, None, &cards),
    )
    .unwrap();
    assert_eq!(decoded.planes[0].saturation.source, SaturationSource::SaturateKeyword);
    assert_eq!(decoded.planes[0].saturation.level, Some(0.25));

    let scaling = Scaling { zero: 32768.0, scale: 1.0 };
    let mut stored = quantize(&frame(16, 16, 5, 1000.0, 10.0).render(), SampleFormat::I16, scaling);
    for index in [0, 17, 200] {
        assert!(set_integer(&mut stored, index, -32768));
    }
    let decoded =
        decode_bytes(Container::Fits, &fits_with(&stored, 16, 16, 1, scaling, Some(-32768), &[]))
            .unwrap();
    let plane = &decoded.planes[0];
    assert_eq!(plane.blank, Some(-32768));
    assert_eq!(plane.sample(1, 1).category, Category::Blank);
    assert_eq!(plane.mask_counts().blank, 3);
    assert_eq!(plane.samples, stored);

    let stored =
        quantize(&frame(16, 16, 5, 1000.0, 10.0).render(), SampleFormat::U16, Scaling::IDENTITY);
    let decoded =
        decode_bytes(Container::Xisf, &write_xisf(&XisfImage::new(16, 16, 1, &stored)).unwrap())
            .unwrap();
    assert_eq!(decoded.planes[0].saturation.source, SaturationSource::TypeMaximum);
    assert_eq!(decoded.planes[0].saturation.level, Some(65535.0));
    let image =
        XisfImage { keywords: &[("SATURATE", "60000")], ..XisfImage::new(16, 16, 1, &stored) };
    let decoded = decode_bytes(Container::Xisf, &write_xisf(&image).unwrap()).unwrap();
    assert_eq!(decoded.planes[0].saturation.source, SaturationSource::SaturateKeyword);
    assert_eq!(decoded.planes[0].saturation.level, Some(60000.0));

    let stored = quantize(&defects.render(), SampleFormat::F64, Scaling::IDENTITY);
    let decoded =
        decode_bytes(Container::Xisf, &write_xisf(&XisfImage::new(16, 16, 1, &stored)).unwrap())
            .unwrap();
    assert_eq!(decoded.planes[0].saturation.source, SaturationSource::Unknown);
    assert_eq!(decoded.planes[0].saturation.level, None);
}

fn header(cards: &[&str]) -> Vec<u8> {
    let mut bytes = Vec::new();
    for card in cards.iter().chain(std::iter::once(&"END")) {
        let mut line = card.as_bytes().to_vec();
        line.resize(80, b' ');
        bytes.extend(line);
    }
    bytes.resize(bytes.len().div_ceil(2880) * 2880, b' ');
    bytes
}

fn raw_xisf(image: &str, data: &[u8]) -> Vec<u8> {
    let xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><xisf version=\"1.0\" xmlns=\"http://www.pixinsight.com/xisf\">{image}</xisf>"
    );
    let mut bytes = b"XISF0100".to_vec();
    bytes.extend((xml.len() as u32).to_le_bytes());
    bytes.extend([0; 4]);
    bytes.extend(xml.as_bytes());
    bytes.resize(4096, 0);
    bytes.extend(data);
    bytes
}

fn unsupported(result: Result<DecodedImage, PixelError>, feature: &str) {
    match result {
        Err(PixelError::Unsupported(named)) => {
            assert!(named.contains(feature), "{named:?} should name {feature:?}");
        }
        other => panic!("expected Unsupported naming {feature:?}, got {other:?}"),
    }
}

fn malformed(result: Result<DecodedImage, PixelError>) {
    assert!(matches!(result, Err(PixelError::Malformed(_))), "expected Malformed, got {result:?}");
}

#[test]
fn unsupported_features_are_named_and_truncation_and_cancel_are_refused() {
    let primary = header(&[
        "SIMPLE  =                    T",
        "BITPIX  =                    8",
        "NAXIS   =                    0",
        "EXTEND  =                    T",
    ]);
    let mut tiled = primary.clone();
    tiled.extend(header(&[
        "XTENSION= 'BINTABLE'",
        "BITPIX  =                    8",
        "NAXIS   =                    2",
        "NAXIS1  =                    8",
        "NAXIS2  =                    1",
        "PCOUNT  =                    0",
        "GCOUNT  =                    1",
        "TFIELDS =                    1",
        "ZIMAGE  =                    T",
    ]));
    unsupported(decode_bytes(Container::Fits, &tiled), "tile compression");
    let mut extension = primary;
    extension.extend(header(&[
        "XTENSION= 'IMAGE   '",
        "BITPIX  =                   16",
        "NAXIS   =                    2",
        "NAXIS1  =                    4",
        "NAXIS2  =                    4",
    ]));
    extension.resize(extension.len() + 2880, 0);
    unsupported(decode_bytes(Container::Fits, &extension), "extension");

    let geometry = "geometry=\"2:2:1\" sampleFormat=\"UInt16\"";
    let data = [0_u8; 8];
    unsupported(
        decode_bytes(
            Container::Xisf,
            &raw_xisf(
                &format!(
                    "<Image {geometry} location=\"attachment:4096:8\" compression=\"zstd:8\"/>"
                ),
                &data,
            ),
        ),
        "zstd",
    );
    unsupported(
        decode_bytes(
            Container::Xisf,
            &raw_xisf(
                &format!("<Image {geometry} location=\"inline:base64\">AAAAAAAAAAA=</Image>"),
                &[],
            ),
        ),
        "inline",
    );
    unsupported(
        decode_bytes(
            Container::Xisf,
            &raw_xisf(
                &format!("<Image {geometry} location=\"embedded\"><Data>AAAA</Data></Image>"),
                &[],
            ),
        ),
        "embedded",
    );
    unsupported(
        decode_bytes(
            Container::Xisf,
            &raw_xisf("<Image geometry=\"2:2:1\" sampleFormat=\"Complex32\" location=\"attachment:4096:32\"/>", &[0; 32]),
        ),
        "complex",
    );
    unsupported(
        decode_bytes(
            Container::Xisf,
            &raw_xisf(
                &format!("<Image {geometry} location=\"attachment:4096:8\"/><Image {geometry} location=\"attachment:4096:8\"/>"),
                &data,
            ),
        ),
        "Image elements",
    );

    let stored =
        quantize(&frame(32, 32, 1, 1000.0, 10.0).render(), SampleFormat::I16, Scaling::IDENTITY);
    let complete = fits(&stored, 32, 32, 1, Scaling::IDENTITY);
    malformed(decode_bytes(Container::Fits, &complete[..2880 + 1000]));
    let complete = write_xisf(&XisfImage {
        codec: Some(Codec::Zlib),
        ..XisfImage::new(
            32,
            32,
            1,
            &quantize(
                &frame(32, 32, 1, 1000.0, 10.0).render(),
                SampleFormat::U16,
                Scaling::IDENTITY,
            ),
        )
    })
    .unwrap();
    malformed(decode_bytes(Container::Xisf, &complete[..complete.len() - 10]));
    malformed(decode_bytes(
        Container::Xisf,
        &raw_xisf(&format!("<Image {geometry} location=\"attachment:4096:8\"/>"), &data[..4]),
    ));

    let canceled = AtomicBool::new(true);
    let fits_bytes = fits(&stored, 32, 32, 1, Scaling::IDENTITY);
    assert!(matches!(
        decode(Container::Fits, &mut Cursor::new(&fits_bytes), &canceled),
        Err(PixelError::Canceled)
    ));
    assert!(matches!(
        decode(Container::Xisf, &mut Cursor::new(&complete), &canceled),
        Err(PixelError::Canceled)
    ));
}

fn sha256_file(path: &std::path::Path) -> String {
    let mut bytes = Vec::new();
    std::fs::File::open(path).unwrap().read_to_end(&mut bytes).unwrap();
    hex::encode(Sha256::digest(&bytes))
}

#[test]
fn decoding_leaves_each_source_file_byte_identical() {
    let dir = tempfile::tempdir().unwrap();
    let scaling = Scaling { zero: 32768.0, scale: 1.0 };
    let fits_samples =
        quantize(&frame(32, 24, 2, 1000.0, 10.0).render(), SampleFormat::I16, scaling);
    let xisf_samples =
        quantize(&frame(32, 24, 2, 1000.0, 10.0).render(), SampleFormat::U16, Scaling::IDENTITY);
    let files = [
        (Container::Fits, "light.fits", fits(&fits_samples, 32, 24, 1, scaling)),
        (
            Container::Xisf,
            "light.xisf",
            write_xisf(&XisfImage {
                codec: Some(Codec::Lz4),
                shuffle: true,
                ..XisfImage::new(32, 24, 1, &xisf_samples)
            })
            .unwrap(),
        ),
    ];
    for (container, name, bytes) in files {
        let path = dir.path().join(name);
        std::fs::write(&path, &bytes).unwrap();
        let before = sha256_file(&path);
        let mut file = std::fs::File::open(&path).unwrap();
        let decoded = decode(container, &mut file, &AtomicBool::new(false)).unwrap();
        assert_eq!(decoded.planes.len(), 1);
        assert_eq!(sha256_file(&path), before, "{name}");
        assert_eq!(std::fs::read(&path).unwrap(), bytes, "{name}");
    }
}
