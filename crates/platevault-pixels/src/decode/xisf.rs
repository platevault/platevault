// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! XISF monolithic-image decoding.

use std::collections::BTreeMap;
use std::io::Read;
use std::sync::atomic::AtomicBool;

use quick_xml::events::{BytesStart, Event};
use quick_xml::XmlVersion;

use super::{check, data_len, read_exact, samples_from_bytes, skip, type_maximum};
use crate::{
    ByteOrder, CfaEvidence, CfaSource, Codec, Compression, Container, DecodedImage, PixelError,
    PixelStorage, Plane, PlaneKind, SampleFormat, Saturation, SaturationSource, Scaling,
    StructureEvidence,
};

const SIGNATURE: &[u8; 8] = b"XISF0100";
/// The XML header cap xisf-header applies.
const MAX_HEADER: usize = 8 << 20;

fn malformed(what: impl Into<String>) -> PixelError {
    PixelError::Malformed(what.into())
}

fn unsupported(what: impl Into<String>) -> PixelError {
    PixelError::Unsupported(what.into())
}

/// The single `<Image>` element's attributes and its CFA child.
struct ImageElement {
    attributes: BTreeMap<String, String>,
    cfa: Option<CfaElement>,
}

/// A `<ColorFilterArray>` child; its pattern stays absent when unrecorded.
struct CfaElement {
    pattern: Option<String>,
}

fn attributes(element: &BytesStart<'_>) -> Result<BTreeMap<String, String>, PixelError> {
    let mut map = BTreeMap::new();
    for attribute in element.attributes() {
        let attribute =
            attribute.map_err(|error| malformed(format!("XISF header attribute: {error}")))?;
        let key = String::from_utf8_lossy(attribute.key.local_name().as_ref()).into_owned();
        let value = attribute
            .normalized_value(XmlVersion::Implicit1_0)
            .map_err(|error| malformed(format!("XISF header attribute {key}: {error}")))?
            .into_owned();
        map.insert(key, value);
    }
    Ok(map)
}

fn image_element(xml: &str) -> Result<ImageElement, PixelError> {
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut images = Vec::new();
    let mut inside_image = false;
    loop {
        let event =
            reader.read_event().map_err(|error| malformed(format!("XISF header XML: {error}")))?;
        match event {
            Event::Start(element) if element.local_name().as_ref() == b"Image" => {
                images.push(ImageElement { attributes: attributes(&element)?, cfa: None });
                inside_image = true;
            }
            Event::Empty(element) if element.local_name().as_ref() == b"Image" => {
                images.push(ImageElement { attributes: attributes(&element)?, cfa: None });
            }
            Event::Start(element) | Event::Empty(element)
                if inside_image && element.local_name().as_ref() == b"ColorFilterArray" =>
            {
                let pattern = attributes(&element)?.remove("pattern");
                if let Some(image) = images.last_mut() {
                    image.cfa = Some(CfaElement { pattern });
                }
            }
            Event::End(element) if element.local_name().as_ref() == b"Image" => {
                inside_image = false;
            }
            Event::Eof => break,
            _ => {}
        }
    }
    match images.len() {
        1 => Ok(images.remove(0)),
        0 => Err(unsupported("XISF file without an Image element")),
        count => Err(unsupported(format!("XISF file with {count} Image elements"))),
    }
}

fn parse_u64(text: &str, what: &str) -> Result<u64, PixelError> {
    text.trim().parse().map_err(|_| malformed(format!("XISF {what} {text:?}")))
}

fn sample_format(name: &str) -> Result<SampleFormat, PixelError> {
    match name {
        "UInt8" => Ok(SampleFormat::U8),
        "UInt16" => Ok(SampleFormat::U16),
        "UInt32" => Ok(SampleFormat::U32),
        "Float32" => Ok(SampleFormat::F32),
        "Float64" => Ok(SampleFormat::F64),
        "Complex32" | "Complex64" => Err(unsupported(format!("XISF complex samples ({name})"))),
        other => Err(unsupported(format!("XISF sample format {other}"))),
    }
}

/// `attachment:position:size`.
fn attachment(location: &str) -> Result<(u64, u64), PixelError> {
    let mut parts = location.split(':');
    match parts.next().map(str::trim) {
        Some("attachment") => {}
        Some("inline") => return Err(unsupported("XISF inline data block")),
        Some("embedded") => return Err(unsupported("XISF embedded data block")),
        Some(other) if other.starts_with("url(") || other.starts_with("path(") => {
            return Err(unsupported("XISF external data block"));
        }
        _ => return Err(malformed(format!("XISF location {location:?}"))),
    }
    let position = parse_u64(parts.next().unwrap_or_default(), "attachment position")?;
    let size = parse_u64(parts.next().unwrap_or_default(), "attachment size")?;
    Ok((position, size))
}

/// `codec[+sh]:uncompressed-size[:item-size]`.
fn compression(attribute: &str) -> Result<Compression, PixelError> {
    let mut parts = attribute.split(':');
    let codec_name = parts.next().unwrap_or_default().trim();
    let (base, shuffled) =
        codec_name.strip_suffix("+sh").map_or((codec_name, false), |base| (base, true));
    let codec = match base {
        "zlib" => Codec::Zlib,
        "lz4" => Codec::Lz4,
        "lz4hc" => Codec::Lz4Hc,
        "zstd" => return Err(unsupported("XISF zstd compression")),
        other => return Err(unsupported(format!("XISF compression codec {other}"))),
    };
    let uncompressed_size = parse_u64(parts.next().unwrap_or_default(), "uncompressed size")?;
    let shuffle_item_size = if shuffled {
        let size = parse_u64(parts.next().unwrap_or_default(), "shuffle item size")?;
        Some(
            u32::try_from(size)
                .ok()
                .filter(|size| *size > 0)
                .ok_or_else(|| malformed("XISF shuffle item size"))?,
        )
    } else {
        None
    };
    Ok(Compression { codec, uncompressed_size, shuffle_item_size })
}

/// `compressed,uncompressed:compressed,uncompressed...`.
fn subblocks(attribute: &str) -> Result<Vec<(usize, usize)>, PixelError> {
    attribute
        .split(':')
        .map(|pair| {
            let (compressed, uncompressed) = pair
                .split_once(',')
                .ok_or_else(|| malformed(format!("XISF subblocks {attribute:?}")))?;
            let compressed = usize::try_from(parse_u64(compressed, "subblock size")?)
                .map_err(|_| malformed("XISF subblock size"))?;
            let uncompressed = usize::try_from(parse_u64(uncompressed, "subblock size")?)
                .map_err(|_| malformed("XISF subblock size"))?;
            Ok((compressed, uncompressed))
        })
        .collect()
}

fn inflate(codec: Codec, data: &[u8], expected: usize) -> Result<Vec<u8>, PixelError> {
    let output = match codec {
        Codec::Zlib => {
            let mut output = Vec::new();
            output
                .try_reserve_exact(expected)
                .map_err(|_| malformed("XISF block does not fit in memory"))?;
            flate2::read::ZlibDecoder::new(data)
                .take(expected as u64 + 1)
                .read_to_end(&mut output)
                .map_err(|error| malformed(format!("XISF zlib block: {error}")))?;
            output
        }
        Codec::Lz4 | Codec::Lz4Hc => lz4_flex::block::decompress(data, expected)
            .map_err(|error| malformed(format!("XISF lz4 block: {error}")))?,
    };
    if output.len() != expected {
        return Err(malformed(format!(
            "XISF block inflated to {} bytes, {expected} recorded",
            output.len()
        )));
    }
    Ok(output)
}

/// Inverts XISF byte shuffling.
fn unshuffle(bytes: &[u8], item_size: usize) -> Vec<u8> {
    let items = bytes.len() / item_size;
    let mut out = vec![0; bytes.len()];
    for byte in 0..item_size {
        for item in 0..items {
            out[item * item_size + byte] = bytes[byte * items + item];
        }
    }
    out[items * item_size..].copy_from_slice(&bytes[items * item_size..]);
    out
}

/// Normal (pixel-interleaved) to planar byte order.
fn deinterleave(bytes: &[u8], channels: usize, item_size: usize) -> Vec<u8> {
    let pixels = bytes.len() / (channels * item_size);
    let mut out = vec![0; bytes.len()];
    for pixel in 0..pixels {
        for channel in 0..channels {
            let from = (pixel * channels + channel) * item_size;
            let to = (channel * pixels + pixel) * item_size;
            out[to..to + item_size].copy_from_slice(&bytes[from..from + item_size]);
        }
    }
    out
}

fn bounds(attribute: &str) -> Result<(f64, f64), PixelError> {
    let (low, high) =
        attribute.split_once(':').ok_or_else(|| malformed(format!("XISF bounds {attribute:?}")))?;
    let parse = |text: &str| {
        text.trim()
            .parse::<f64>()
            .ok()
            .filter(|value| value.is_finite())
            .ok_or_else(|| malformed(format!("XISF bounds {attribute:?}")))
    };
    Ok((parse(low)?, parse(high)?))
}

#[allow(clippy::too_many_lines)]
pub(super) fn decode(
    reader: &mut dyn Read,
    canceled: &AtomicBool,
) -> Result<DecodedImage, PixelError> {
    let preamble = read_exact(reader, 16, canceled, "XISF preamble")?;
    if &preamble[..8] != SIGNATURE {
        return Err(malformed("XISF signature"));
    }
    let xml_len =
        u32::from_le_bytes([preamble[8], preamble[9], preamble[10], preamble[11]]) as usize;
    if xml_len > MAX_HEADER {
        return Err(malformed(format!("XISF header of {xml_len} bytes exceeds 8 MiB")));
    }
    let xml_bytes = read_exact(reader, xml_len, canceled, "XISF header")?;
    let mut header_bytes = preamble;
    header_bytes.extend_from_slice(&xml_bytes);
    let keywords = xisf_header::Header::parse(&header_bytes)
        .map_err(|error| malformed(format!("XISF header: {error}")))?;
    let xml = std::str::from_utf8(&xml_bytes)
        .map_err(|error| malformed(format!("XISF header UTF-8: {error}")))?;
    let image = image_element(xml)?;
    let attribute = |name: &str| image.attributes.get(name).map(String::as_str);

    let geometry: Vec<u64> = attribute("geometry")
        .ok_or_else(|| malformed("XISF Image without geometry"))?
        .split(':')
        .map(|part| parse_u64(part, "geometry"))
        .collect::<Result<_, _>>()?;
    if geometry.len() != 3 {
        return Err(unsupported(format!(
            "XISF geometry with {} dimensions",
            geometry.len().saturating_sub(1)
        )));
    }
    let to_u32 = |value: u64, what: &str| {
        u32::try_from(value)
            .ok()
            .filter(|value| *value > 0)
            .ok_or_else(|| malformed(format!("XISF geometry {what} = {value}")))
    };
    let width = to_u32(geometry[0], "width")?;
    let height = to_u32(geometry[1], "height")?;
    let channels = to_u32(geometry[2], "channels")?;
    let format = sample_format(
        attribute("sampleFormat").ok_or_else(|| malformed("XISF Image without sampleFormat"))?,
    )?;
    let (position, size) =
        attachment(attribute("location").ok_or_else(|| malformed("XISF Image without location"))?)?;
    let compression = attribute("compression").map(compression).transpose()?;
    let storage = match attribute("pixelStorage").unwrap_or("Planar") {
        "Planar" => PixelStorage::Planar,
        "Normal" => PixelStorage::Normal,
        other => return Err(unsupported(format!("XISF pixel storage {other}"))),
    };
    let byte_order = match attribute("byteOrder").unwrap_or("little") {
        "little" => ByteOrder::Little,
        "big" => ByteOrder::Big,
        other => return Err(malformed(format!("XISF byte order {other:?}"))),
    };
    let color_space = attribute("colorSpace").unwrap_or("Gray").to_owned();
    let recorded_bounds = attribute("bounds").map(bounds).transpose()?;
    let subblocks = attribute("subblocks").map(subblocks).transpose()?;

    let consumed = 16 + xml_len as u64;
    if position < consumed {
        return Err(malformed("XISF attachment overlaps the header"));
    }
    skip(reader, position - consumed, canceled, "XISF file before the attachment")?;
    let size = usize::try_from(size).map_err(|_| malformed("XISF attachment size"))?;
    let block = read_exact(reader, size, canceled, "XISF attachment")?;
    check(canceled)?;
    let expected =
        data_len(u64::from(width), u64::from(height), u64::from(channels), format, "XISF")?;
    let raw = match compression {
        None => block,
        Some(compression) => {
            let uncompressed = usize::try_from(compression.uncompressed_size)
                .map_err(|_| malformed("XISF uncompressed size"))?;
            let inflated = match &subblocks {
                None => inflate(compression.codec, &block, uncompressed)?,
                Some(parts) => {
                    let mut inflated = Vec::with_capacity(uncompressed);
                    let mut offset = 0;
                    for &(compressed, plain) in parts {
                        check(canceled)?;
                        let part = block
                            .get(offset..offset + compressed)
                            .ok_or_else(|| malformed("XISF subblock beyond the attachment"))?;
                        inflated.extend(inflate(compression.codec, part, plain)?);
                        offset += compressed;
                    }
                    if inflated.len() != uncompressed {
                        return Err(malformed(
                            "XISF subblocks do not sum to the uncompressed size",
                        ));
                    }
                    inflated
                }
            };
            match compression.shuffle_item_size {
                Some(item_size) => unshuffle(&inflated, item_size as usize),
                None => inflated,
            }
        }
    };
    if raw.len() != expected {
        return Err(malformed(format!(
            "XISF image data holds {} bytes, geometry needs {expected}",
            raw.len()
        )));
    }
    check(canceled)?;
    let planar = match storage {
        PixelStorage::Normal if channels > 1 => {
            deinterleave(&raw, channels as usize, format.bytes())
        }
        _ => raw,
    };
    let scaling = Scaling::IDENTITY;
    let saturation = match keywords.get_f64("SATURATE").ok().flatten() {
        Some(level) if level.is_finite() => {
            Saturation { level: Some(level), source: SaturationSource::SaturateKeyword }
        }
        _ => match recorded_bounds {
            Some((_, high)) if format.is_float() => {
                Saturation { level: Some(high), source: SaturationSource::XisfBounds }
            }
            _ if format.is_float() => Saturation::UNKNOWN,
            _ => type_maximum(format, scaling),
        },
    };
    let plane_bytes = expected / channels as usize;
    let planes = (0..channels)
        .map(|index| {
            let start = index as usize * plane_bytes;
            let kind = match (&image.cfa, channels) {
                (Some(cfa), 1) => PlaneKind::CfaMosaic(CfaEvidence {
                    pattern: cfa.pattern.clone(),
                    x_offset: None,
                    y_offset: None,
                    row_order: None,
                    source: CfaSource::ColorFilterArray,
                }),
                (_, 1) => PlaneKind::Mono,
                _ => PlaneKind::Channel {
                    index,
                    count: channels,
                    color_space: Some(color_space.clone()),
                },
            };
            Plane {
                width,
                height,
                kind,
                samples: samples_from_bytes(
                    &planar[start..start + plane_bytes],
                    format,
                    byte_order,
                ),
                scaling,
                blank: None,
                saturation,
            }
        })
        .collect();
    Ok(DecodedImage {
        container: Container::Xisf,
        planes,
        evidence: StructureEvidence {
            sample_format: format,
            geometry,
            byte_order,
            storage: Some(storage),
            compression,
            color_space: Some(color_space),
            bounds: recorded_bounds,
        },
    })
}
