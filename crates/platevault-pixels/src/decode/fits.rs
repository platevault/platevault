// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! FITS primary-image decoding.

use std::io::Read;
use std::sync::atomic::AtomicBool;

use fits_header::Header;

use super::{check, data_len, read_exact, samples_from_bytes, type_maximum};
use crate::{
    ByteOrder, CfaEvidence, CfaSource, Container, DecodedImage, PixelError, Plane, PlaneKind,
    SampleFormat, Saturation, SaturationSource, Scaling, StructureEvidence,
};

const BLOCK: usize = 2880;
const CARD: usize = 80;
/// Header blocks read before refusing a header without END.
const MAX_HEADER_BLOCKS: usize = 4096;

fn malformed(what: impl Into<String>) -> PixelError {
    PixelError::Malformed(what.into())
}

/// Reads header blocks up to the one holding END and parses the cards.
fn read_header(reader: &mut dyn Read, canceled: &AtomicBool) -> Result<Header, PixelError> {
    let mut bytes = Vec::new();
    for _ in 0..MAX_HEADER_BLOCKS {
        check(canceled)?;
        let block = read_exact(reader, BLOCK, canceled, "FITS header")?;
        let end = block
            .chunks(CARD)
            .any(|card| card.starts_with(b"END") && card[3..8].iter().all(|byte| *byte == b' '));
        bytes.extend_from_slice(&block);
        if end {
            return Header::parse(&bytes)
                .map_err(|error| malformed(format!("FITS header: {error}")));
        }
    }
    Err(malformed("FITS header without END"))
}

fn integer(header: &Header, key: &str) -> Result<Option<i64>, PixelError> {
    header.get::<i64>(key).map_err(|error| malformed(format!("FITS {key} card: {error}")))
}

fn float(header: &Header, key: &str) -> Result<Option<f64>, PixelError> {
    header.get::<f64>(key).map_err(|error| malformed(format!("FITS {key} card: {error}")))
}

/// A string card as recorded, without trailing blanks; `None` when absent or
/// not a string.
fn text(header: &Header, key: &str) -> Option<String> {
    header.get_str(key).ok().flatten().map(|value| value.trim_end().to_owned())
}

/// Evidence integers stay as recorded: an integral real reads as its integer,
/// anything else as absent.
fn evidence_integer(header: &Header, key: &str) -> Option<i64> {
    match header.get::<i64>(key) {
        Ok(value) => value,
        Err(_) => header
            .get::<f64>(key)
            .ok()
            .flatten()
            .filter(|value| value.fract() == 0.0 && value.abs() < 9.0e15)
            .map(|value| value as i64),
    }
}

/// Names the feature of a primary HDU without an image.
fn extension_feature(reader: &mut dyn Read, canceled: &AtomicBool) -> PixelError {
    match read_header(reader, canceled) {
        Ok(extension) => {
            if extension.get::<bool>("ZIMAGE").ok().flatten() == Some(true) {
                PixelError::Unsupported("FITS tile compression (ZIMAGE binary table)".into())
            } else if text(&extension, "XTENSION").as_deref().map(str::trim) == Some("IMAGE") {
                PixelError::Unsupported("FITS image in an extension HDU".into())
            } else {
                PixelError::Unsupported("FITS file without a primary image".into())
            }
        }
        Err(PixelError::Canceled) => PixelError::Canceled,
        Err(_) => PixelError::Unsupported("FITS file without a primary image".into()),
    }
}

fn axis(header: &Header, key: &str) -> Result<u32, PixelError> {
    let value =
        integer(header, key)?.ok_or_else(|| malformed(format!("FITS {key} card missing")))?;
    if value < 1 {
        return Err(PixelError::Unsupported(format!("FITS empty image ({key} = {value})")));
    }
    u32::try_from(value).map_err(|_| malformed(format!("FITS {key} = {value} out of range")))
}

pub(super) fn decode(
    reader: &mut dyn Read,
    canceled: &AtomicBool,
) -> Result<DecodedImage, PixelError> {
    let header = read_header(reader, canceled)?;
    match header.get::<bool>("SIMPLE") {
        Ok(Some(true)) => {}
        _ => return Err(malformed("FITS SIMPLE card is not T")),
    }
    let naxis = integer(&header, "NAXIS")?.ok_or_else(|| malformed("FITS NAXIS card missing"))?;
    if naxis == 0 {
        return Err(extension_feature(reader, canceled));
    }
    if !(2..=3).contains(&naxis) {
        return Err(PixelError::Unsupported(format!("FITS NAXIS = {naxis}")));
    }
    let bitpix =
        integer(&header, "BITPIX")?.ok_or_else(|| malformed("FITS BITPIX card missing"))?;
    let format = match bitpix {
        8 => SampleFormat::U8,
        16 => SampleFormat::I16,
        32 => SampleFormat::I32,
        64 => SampleFormat::I64,
        -32 => SampleFormat::F32,
        -64 => SampleFormat::F64,
        other => return Err(malformed(format!("FITS BITPIX = {other}"))),
    };
    let width = axis(&header, "NAXIS1")?;
    let height = axis(&header, "NAXIS2")?;
    let channels = if naxis == 3 { axis(&header, "NAXIS3")? } else { 1 };
    let scaling = Scaling {
        zero: float(&header, "BZERO")?.unwrap_or(0.0),
        scale: float(&header, "BSCALE")?.unwrap_or(1.0),
    };
    if !scaling.zero.is_finite() || !scaling.scale.is_finite() || scaling.scale == 0.0 {
        return Err(malformed(format!("FITS BZERO/BSCALE = {}/{}", scaling.zero, scaling.scale)));
    }
    let blank = if format.is_float() { None } else { integer(&header, "BLANK")? };
    let saturation = match float(&header, "SATURATE")? {
        Some(level) if level.is_finite() => {
            Saturation { level: Some(level), source: SaturationSource::SaturateKeyword }
        }
        _ if format.is_float() => Saturation::UNKNOWN,
        _ => type_maximum(format, scaling),
    };
    let len = data_len(u64::from(width), u64::from(height), u64::from(channels), format, "FITS")?;
    let bytes = read_exact(reader, len, canceled, "FITS data unit")?;
    check(canceled)?;
    let plane_bytes = len / channels as usize;
    let cfa = text(&header, "BAYERPAT").map(|pattern| CfaEvidence {
        pattern: Some(pattern.trim().to_owned()),
        x_offset: evidence_integer(&header, "XBAYROFF"),
        y_offset: evidence_integer(&header, "YBAYROFF"),
        row_order: text(&header, "ROWORDER").map(|order| order.trim().to_owned()),
        source: CfaSource::BayerpatKeyword,
    });
    let planes = (0..channels)
        .map(|index| {
            let start = index as usize * plane_bytes;
            let kind = match (&cfa, channels) {
                (Some(evidence), 1) => PlaneKind::CfaMosaic(evidence.clone()),
                (_, 1) => PlaneKind::Mono,
                _ => PlaneKind::Channel { index, count: channels, color_space: None },
            };
            Plane {
                width,
                height,
                kind,
                samples: samples_from_bytes(
                    &bytes[start..start + plane_bytes],
                    format,
                    ByteOrder::Big,
                ),
                scaling,
                blank,
                saturation,
            }
        })
        .collect();
    let mut geometry = vec![u64::from(width), u64::from(height)];
    if naxis == 3 {
        geometry.push(u64::from(channels));
    }
    Ok(DecodedImage {
        container: Container::Fits,
        planes,
        evidence: StructureEvidence {
            sample_format: format,
            geometry,
            byte_order: ByteOrder::Big,
            storage: None,
            compression: None,
            color_space: None,
            bounds: None,
        },
    })
}
