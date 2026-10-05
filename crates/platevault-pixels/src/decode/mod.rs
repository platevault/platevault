// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! FITS and XISF sample decoding (R4-R6).
//!
//! Supported: FITS primary-HDU images with BITPIX 8, 16, 32, 64, -32 or -64,
//! BZERO, BSCALE and BLANK, NAXIS 2 or 3; XISF monolithic files with one
//! `<Image>` in an attachment block, UInt8/UInt16/UInt32/Float32/Float64,
//! Planar or Normal storage, either byte order, uncompressed, zlib, lz4 or
//! lz4hc, shuffled or not. Every other recognised feature is `Unsupported`
//! naming it; truncated or inconsistent data is `Malformed`.

use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::{
    ByteOrder, Container, DecodedImage, PixelError, SampleFormat, Saturation, SaturationSource,
    Scaling, StoredSamples,
};

mod fits;
mod xisf;

/// Read granularity between cancel checks.
const CHUNK: usize = 4 << 20;

/// Decodes every plane of the single image in `reader`. Reads only what the
/// image needs; the caller hashes any remainder.
///
/// # Errors
///
/// `Unsupported` naming an unsupported feature, `Malformed` naming the
/// truncated or inconsistent structure, `Io` for read failures and
/// `Canceled` once `canceled` is set.
pub fn decode(
    container: Container,
    reader: &mut dyn Read,
    canceled: &AtomicBool,
) -> Result<DecodedImage, PixelError> {
    check(canceled)?;
    match container {
        Container::Fits => fits::decode(reader, canceled),
        Container::Xisf => xisf::decode(reader, canceled),
    }
}

fn check(canceled: &AtomicBool) -> Result<(), PixelError> {
    if canceled.load(Ordering::Acquire) {
        Err(PixelError::Canceled)
    } else {
        Ok(())
    }
}

/// Reads exactly `len` bytes in cancelable chunks.
fn read_exact(
    reader: &mut dyn Read,
    len: usize,
    canceled: &AtomicBool,
    what: &str,
) -> Result<Vec<u8>, PixelError> {
    let mut buffer = Vec::new();
    buffer.try_reserve_exact(len).map_err(|_| {
        PixelError::Malformed(format!("{what} of {len} bytes does not fit in memory"))
    })?;
    while buffer.len() < len {
        check(canceled)?;
        let start = buffer.len();
        let end = (start + CHUNK).min(len);
        buffer.resize(end, 0);
        let mut filled = start;
        while filled < end {
            match reader.read(&mut buffer[filled..end]) {
                Ok(0) => {
                    return Err(PixelError::Malformed(format!(
                        "{what} truncated after {filled} of {len} bytes"
                    )));
                }
                Ok(read) => filled += read,
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                Err(error) => return Err(error.into()),
            }
        }
    }
    Ok(buffer)
}

/// Reads and discards `len` bytes in cancelable chunks.
fn skip(
    reader: &mut dyn Read,
    len: u64,
    canceled: &AtomicBool,
    what: &str,
) -> Result<(), PixelError> {
    let mut remaining = len;
    while remaining > 0 {
        check(canceled)?;
        let step = remaining.min(CHUNK as u64);
        let copied = std::io::copy(&mut reader.take(step), &mut std::io::sink())?;
        if copied < step {
            return Err(PixelError::Malformed(format!("{what} truncated")));
        }
        remaining -= step;
    }
    Ok(())
}

/// Converts stored bytes in `order` to samples of `format`.
fn samples_from_bytes(bytes: &[u8], format: SampleFormat, order: ByteOrder) -> StoredSamples {
    macro_rules! convert {
        ($variant:ident, $ty:ty, $n:literal) => {
            StoredSamples::$variant(
                bytes
                    .as_chunks::<$n>()
                    .0
                    .iter()
                    .map(|chunk| match order {
                        ByteOrder::Big => <$ty>::from_be_bytes(*chunk),
                        ByteOrder::Little => <$ty>::from_le_bytes(*chunk),
                    })
                    .collect(),
            )
        };
    }
    match format {
        SampleFormat::U8 => StoredSamples::U8(bytes.to_vec()),
        SampleFormat::I16 => convert!(I16, i16, 2),
        SampleFormat::U16 => convert!(U16, u16, 2),
        SampleFormat::I32 => convert!(I32, i32, 4),
        SampleFormat::U32 => convert!(U32, u32, 4),
        SampleFormat::I64 => convert!(I64, i64, 8),
        SampleFormat::F32 => convert!(F32, f32, 4),
        SampleFormat::F64 => convert!(F64, f64, 8),
    }
}

/// The stored type's maximum after scaling for integer data (R6).
fn type_maximum(format: SampleFormat, scaling: Scaling) -> Saturation {
    match format.integer_maximum() {
        Some(maximum) if scaling.scale > 0.0 => Saturation {
            level: Some(scaling.apply(maximum as f64)),
            source: SaturationSource::TypeMaximum,
        },
        _ => Saturation::UNKNOWN,
    }
}

/// Bytes for `width * height * channels` samples, refusing overflow.
fn data_len(
    width: u64,
    height: u64,
    channels: u64,
    format: SampleFormat,
    what: &str,
) -> Result<usize, PixelError> {
    width
        .checked_mul(height)
        .and_then(|samples| samples.checked_mul(channels))
        .and_then(|samples| samples.checked_mul(format.bytes() as u64))
        .and_then(|bytes| usize::try_from(bytes).ok())
        .ok_or_else(|| {
            PixelError::Malformed(format!("{what} geometry {width}x{height}x{channels} overflows"))
        })
}
