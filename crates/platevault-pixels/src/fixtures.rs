// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Seeded synthetic frames and FITS/XISF writers (test-only `fixtures`
//! feature).
//!
//! The generator renders background, Gaussian noise, elliptical Gaussian
//! stars, hot pixels, cosmic-ray streaks, saturated plateaus, clipping, CFA
//! modulation and explicit overrides (NaN, infinities) from a seed, with the
//! same samples on every run. The writers emit every supported FITS BITPIX and
//! XISF sample format, storage, byte order and codec, so decoder tests compare
//! decoded samples with the stored samples that were written.

use std::fmt::Write as _;
use std::io::Write as _;

use crate::{ByteOrder, Codec, PixelError, PixelStorage, SampleFormat, Scaling, StoredSamples};

/// FITS block length.
pub const FITS_BLOCK: usize = 2880;

/// `SplitMix64`: small, seedable and identical on every platform.
#[derive(Clone, Debug)]
pub struct SeededRng(u64);

impl SeededRng {
    #[must_use]
    pub const fn new(seed: u64) -> Self {
        Self(seed)
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform in `[0, 1)`.
    pub fn uniform(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1_u64 << 53) as f64
    }

    /// Standard normal by Box-Muller.
    pub fn gaussian(&mut self) -> f64 {
        let u1 = 1.0 - self.uniform();
        let u2 = self.uniform();
        (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos()
    }
}

/// An elliptical Gaussian star sampled at pixel centers. `angle_deg` is the
/// major axis measured from +x toward +y in storage coordinates.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SyntheticStar {
    pub x: f64,
    pub y: f64,
    /// Peak above background.
    pub amplitude: f64,
    pub sigma_major: f64,
    pub sigma_minor: f64,
    pub angle_deg: f64,
}

impl SyntheticStar {
    /// The star's contribution at pixel center (`px`, `py`).
    #[must_use]
    pub fn value_at(&self, px: f64, py: f64) -> f64 {
        let (sin, cos) = self.angle_deg.to_radians().sin_cos();
        let dx = px - self.x;
        let dy = py - self.y;
        let u = dx * cos + dy * sin;
        let v = -dx * sin + dy * cos;
        self.amplitude
            * (-0.5
                * (u * u / (self.sigma_major * self.sigma_major)
                    + v * v / (self.sigma_minor * self.sigma_minor)))
                .exp()
    }

    /// FWHM of the major and minor axes.
    #[must_use]
    pub fn fwhm(&self) -> (f64, f64) {
        (FWHM_PER_SIGMA * self.sigma_major, FWHM_PER_SIGMA * self.sigma_minor)
    }
}

/// `2 * sqrt(2 * ln 2)`.
pub const FWHM_PER_SIGMA: f64 = 2.354_820_045_030_949;

/// A cosmic-ray streak: `length` samples from (`x`, `y`) set to `value`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Streak {
    pub x: u32,
    pub y: u32,
    pub horizontal: bool,
    pub length: u32,
    pub value: f64,
}

/// A rectangle set to one value, such as a saturated plateau.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Plateau {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub value: f64,
}

/// Per-site gains of a 2×2 CFA cell, in storage order (0,0), (1,0), (0,1),
/// (1,1); RGGB puts red at (0,0).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CfaModulation {
    pub gains: [f64; 4],
}

/// A seeded synthetic frame in physical units.
#[derive(Clone, Debug, PartialEq)]
pub struct SyntheticFrame {
    pub width: u32,
    pub height: u32,
    pub seed: u64,
    pub background: f64,
    pub noise_sigma: f64,
    pub stars: Vec<SyntheticStar>,
    /// Absolute values set at (x, y).
    pub hot_pixels: Vec<(u32, u32, f64)>,
    pub streaks: Vec<Streak>,
    pub plateaus: Vec<Plateau>,
    /// Every value is clipped to this level, as a saturated sensor does.
    pub clip: Option<f64>,
    pub cfa: Option<CfaModulation>,
    /// Values set last, after clipping: NaN and the infinities.
    pub overrides: Vec<(u32, u32, f64)>,
}

impl SyntheticFrame {
    #[must_use]
    pub const fn new(
        width: u32,
        height: u32,
        seed: u64,
        background: f64,
        noise_sigma: f64,
    ) -> Self {
        Self {
            width,
            height,
            seed,
            background,
            noise_sigma,
            stars: Vec::new(),
            hot_pixels: Vec::new(),
            streaks: Vec::new(),
            plateaus: Vec::new(),
            clip: None,
            cfa: None,
            overrides: Vec::new(),
        }
    }

    const fn index(&self, x: u32, y: u32) -> usize {
        y as usize * self.width as usize + x as usize
    }

    /// Row-major physical values. The same frame renders bit-identical
    /// values every time.
    #[must_use]
    pub fn render(&self) -> Vec<f64> {
        let width = self.width as usize;
        let mut values = vec![self.background; width * self.height as usize];
        for star in &self.stars {
            let radius = (6.0 * star.sigma_major.max(star.sigma_minor)).ceil();
            let x0 = (star.x - radius).floor().max(0.0) as u32;
            let y0 = (star.y - radius).floor().max(0.0) as u32;
            let x1 = ((star.x + radius).ceil() as u32).min(self.width.saturating_sub(1));
            let y1 = ((star.y + radius).ceil() as u32).min(self.height.saturating_sub(1));
            for y in y0..=y1 {
                for x in x0..=x1 {
                    values[self.index(x, y)] += star.value_at(f64::from(x), f64::from(y));
                }
            }
        }
        let mut rng = SeededRng::new(self.seed);
        for value in &mut values {
            *value += self.noise_sigma * rng.gaussian();
        }
        if let Some(cfa) = self.cfa {
            for (index, value) in values.iter_mut().enumerate() {
                let site = (index / width % 2) * 2 + index % width % 2;
                *value *= cfa.gains[site];
            }
        }
        for &(x, y, value) in &self.hot_pixels {
            values[self.index(x, y)] = value;
        }
        for streak in &self.streaks {
            for step in 0..streak.length {
                let (x, y) = if streak.horizontal {
                    (streak.x + step, streak.y)
                } else {
                    (streak.x, streak.y + step)
                };
                if x < self.width && y < self.height {
                    values[self.index(x, y)] = streak.value;
                }
            }
        }
        for plateau in &self.plateaus {
            for y in plateau.y..(plateau.y + plateau.height).min(self.height) {
                for x in plateau.x..(plateau.x + plateau.width).min(self.width) {
                    values[self.index(x, y)] = plateau.value;
                }
            }
        }
        if let Some(clip) = self.clip {
            for value in &mut values {
                *value = value.min(clip);
            }
        }
        for &(x, y, value) in &self.overrides {
            values[self.index(x, y)] = value;
        }
        values
    }
}

/// Converts physical values to stored samples: `(value - zero) / scale`,
/// rounded and clamped to the integer range, or narrowed for floats.
/// A NaN stored as an integer becomes 0.
#[must_use]
pub fn quantize(values: &[f64], format: SampleFormat, scaling: Scaling) -> StoredSamples {
    let stored = values.iter().map(|value| (value - scaling.zero) / scaling.scale);
    macro_rules! integers {
        ($variant:ident, $ty:ty) => {
            StoredSamples::$variant(
                stored
                    .map(|value| value.round().clamp(<$ty>::MIN as f64, <$ty>::MAX as f64) as $ty)
                    .collect(),
            )
        };
    }
    match format {
        SampleFormat::U8 => integers!(U8, u8),
        SampleFormat::I16 => integers!(I16, i16),
        SampleFormat::U16 => integers!(U16, u16),
        SampleFormat::I32 => integers!(I32, i32),
        SampleFormat::U32 => integers!(U32, u32),
        SampleFormat::I64 => integers!(I64, i64),
        SampleFormat::F32 => StoredSamples::F32(stored.map(|value| value as f32).collect()),
        SampleFormat::F64 => StoredSamples::F64(stored.collect()),
    }
}

/// Writes one integer stored value, such as a FITS BLANK, at `index`.
/// Float samples are left unchanged and `false` is returned.
pub fn set_integer(samples: &mut StoredSamples, index: usize, stored: i64) -> bool {
    match samples {
        StoredSamples::U8(values) => values[index] = stored as u8,
        StoredSamples::I16(values) => values[index] = stored as i16,
        StoredSamples::U16(values) => values[index] = stored as u16,
        StoredSamples::I32(values) => values[index] = stored as i32,
        StoredSamples::U32(values) => values[index] = stored as u32,
        StoredSamples::I64(values) => values[index] = stored,
        StoredSamples::F32(_) | StoredSamples::F64(_) => return false,
    }
    true
}

fn sample_bytes(samples: &StoredSamples, order: &[usize], byte_order: ByteOrder) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(order.len() * samples.format().bytes());
    macro_rules! encode {
        ($values:expr) => {
            for &index in order {
                let value = $values[index];
                match byte_order {
                    ByteOrder::Big => bytes.extend_from_slice(&value.to_be_bytes()),
                    ByteOrder::Little => bytes.extend_from_slice(&value.to_le_bytes()),
                }
            }
        };
    }
    match samples {
        StoredSamples::U8(values) => encode!(values),
        StoredSamples::I16(values) => encode!(values),
        StoredSamples::U16(values) => encode!(values),
        StoredSamples::I32(values) => encode!(values),
        StoredSamples::U32(values) => encode!(values),
        StoredSamples::I64(values) => encode!(values),
        StoredSamples::F32(values) => encode!(values),
        StoredSamples::F64(values) => encode!(values),
    }
    bytes
}

fn check_len(
    samples: &StoredSamples,
    width: u32,
    height: u32,
    channels: u32,
) -> Result<(), PixelError> {
    let expected = width as usize * height as usize * channels as usize;
    if channels == 0 || samples.len() != expected {
        return Err(PixelError::Malformed(format!(
            "{} samples for a {width}x{height}x{channels} image",
            samples.len()
        )));
    }
    Ok(())
}

/// A FITS primary image to write. `samples` hold every channel plane after
/// plane, as NAXIS3 orders them.
#[derive(Clone, Debug)]
pub struct FitsImage<'a> {
    pub width: u32,
    pub height: u32,
    pub channels: u32,
    pub samples: &'a StoredSamples,
    pub scaling: Scaling,
    pub blank: Option<i64>,
    /// Extra cards as `(keyword, value text)`; string values carry their
    /// quotes, such as `'RGGB'`.
    pub cards: &'a [(&'a str, String)],
}

fn card(text: &str) -> [u8; 80] {
    let mut card = [b' '; 80];
    let bytes = text.as_bytes();
    let len = bytes.len().min(80);
    card[..len].copy_from_slice(&bytes[..len]);
    card
}

fn value_card(keyword: &str, value: &str) -> [u8; 80] {
    if value.starts_with('\'') {
        card(&format!("{keyword:<8}= {value}"))
    } else {
        card(&format!("{keyword:<8}= {value:>20}"))
    }
}

/// Writes a single-HDU FITS file: header blocks up to END, then the
/// big-endian data unit padded with zeros to the block length.
///
/// # Errors
///
/// `Unsupported` for unsigned 16- and 32-bit samples, which FITS stores as
/// signed values with BZERO; `Malformed` when the sample count does not match
/// the geometry.
pub fn write_fits(image: &FitsImage<'_>) -> Result<Vec<u8>, PixelError> {
    check_len(image.samples, image.width, image.height, image.channels)?;
    let bitpix = match image.samples.format() {
        SampleFormat::U8 => 8,
        SampleFormat::I16 => 16,
        SampleFormat::I32 => 32,
        SampleFormat::I64 => 64,
        SampleFormat::F32 => -32,
        SampleFormat::F64 => -64,
        format @ (SampleFormat::U16 | SampleFormat::U32) => {
            return Err(PixelError::Unsupported(format!(
                "FITS has no {format:?} BITPIX; store signed samples with BZERO"
            )))
        }
    };
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&value_card("SIMPLE", "T"));
    bytes.extend_from_slice(&value_card("BITPIX", &bitpix.to_string()));
    let naxis = if image.channels > 1 { 3 } else { 2 };
    bytes.extend_from_slice(&value_card("NAXIS", &naxis.to_string()));
    bytes.extend_from_slice(&value_card("NAXIS1", &image.width.to_string()));
    bytes.extend_from_slice(&value_card("NAXIS2", &image.height.to_string()));
    if naxis == 3 {
        bytes.extend_from_slice(&value_card("NAXIS3", &image.channels.to_string()));
    }
    if image.scaling.zero != 0.0 {
        bytes.extend_from_slice(&value_card("BZERO", &format!("{:?}", image.scaling.zero)));
    }
    if (image.scaling.scale - 1.0).abs() > 0.0 {
        bytes.extend_from_slice(&value_card("BSCALE", &format!("{:?}", image.scaling.scale)));
    }
    if let Some(blank) = image.blank {
        bytes.extend_from_slice(&value_card("BLANK", &blank.to_string()));
    }
    for (keyword, value) in image.cards {
        bytes.extend_from_slice(&value_card(keyword, value));
    }
    bytes.extend_from_slice(&card("END"));
    bytes.resize(bytes.len().div_ceil(FITS_BLOCK) * FITS_BLOCK, b' ');
    let order: Vec<usize> = (0..image.samples.len()).collect();
    bytes.extend(sample_bytes(image.samples, &order, ByteOrder::Big));
    bytes.resize(bytes.len().div_ceil(FITS_BLOCK) * FITS_BLOCK, 0);
    Ok(bytes)
}

/// An XISF monolithic image to write. `samples` hold every channel plane
/// after plane; Normal storage interleaves them on write.
#[derive(Clone, Debug)]
pub struct XisfImage<'a> {
    pub width: u32,
    pub height: u32,
    pub channels: u32,
    pub samples: &'a StoredSamples,
    pub storage: PixelStorage,
    pub byte_order: ByteOrder,
    pub codec: Option<Codec>,
    pub shuffle: bool,
    pub color_space: Option<&'a str>,
    pub bounds: Option<(f64, f64)>,
    pub cfa_pattern: Option<&'a str>,
    /// FITS keywords as `(name, value text)`.
    pub keywords: &'a [(&'a str, &'a str)],
}

impl<'a> XisfImage<'a> {
    /// A Planar, little-endian, uncompressed image.
    #[must_use]
    pub const fn new(width: u32, height: u32, channels: u32, samples: &'a StoredSamples) -> Self {
        Self {
            width,
            height,
            channels,
            samples,
            storage: PixelStorage::Planar,
            byte_order: ByteOrder::Little,
            codec: None,
            shuffle: false,
            color_space: None,
            bounds: None,
            cfa_pattern: None,
            keywords: &[],
        }
    }
}

fn xml_escape(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            other => escaped.push(other),
        }
    }
    escaped
}

/// Byte shuffling as XISF defines it: every item's first byte, then every
/// second byte, and so on; a trailing partial item is copied unchanged.
#[must_use]
pub fn shuffle(bytes: &[u8], item_size: usize) -> Vec<u8> {
    let items = bytes.len() / item_size;
    let mut out = Vec::with_capacity(bytes.len());
    for byte in 0..item_size {
        for item in 0..items {
            out.push(bytes[item * item_size + byte]);
        }
    }
    out.extend_from_slice(&bytes[items * item_size..]);
    out
}

/// Writes a monolithic XISF file with one attached image.
///
/// # Errors
///
/// `Unsupported` for signed integer samples, which XISF images do not store;
/// `Malformed` when the sample count does not match the geometry.
#[allow(clippy::too_many_lines)]
pub fn write_xisf(image: &XisfImage<'_>) -> Result<Vec<u8>, PixelError> {
    check_len(image.samples, image.width, image.height, image.channels)?;
    let format = image.samples.format();
    let format_name = match format {
        SampleFormat::U8 => "UInt8",
        SampleFormat::U16 => "UInt16",
        SampleFormat::U32 => "UInt32",
        SampleFormat::F32 => "Float32",
        SampleFormat::F64 => "Float64",
        other => {
            return Err(PixelError::Unsupported(format!("XISF image sample format {other:?}")))
        }
    };
    let plane = image.width as usize * image.height as usize;
    let order: Vec<usize> = match image.storage {
        PixelStorage::Planar => (0..image.samples.len()).collect(),
        PixelStorage::Normal => (0..plane)
            .flat_map(|pixel| {
                (0..image.channels as usize).map(move |channel| channel * plane + pixel)
            })
            .collect(),
    };
    let raw = sample_bytes(image.samples, &order, image.byte_order);
    let (block, compression) = match image.codec {
        None => (raw, None),
        Some(codec) => {
            let input = if image.shuffle { shuffle(&raw, format.bytes()) } else { raw.clone() };
            let compressed = match codec {
                Codec::Zlib => {
                    let mut encoder =
                        flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
                    encoder.write_all(&input)?;
                    encoder.finish()?
                }
                Codec::Lz4 | Codec::Lz4Hc => lz4_flex::block::compress(&input),
            };
            let name = match codec {
                Codec::Zlib => "zlib",
                Codec::Lz4 => "lz4",
                Codec::Lz4Hc => "lz4hc",
            };
            let attribute = if image.shuffle {
                format!("{name}+sh:{}:{}", raw.len(), format.bytes())
            } else {
                format!("{name}:{}", raw.len())
            };
            (compressed, Some(attribute))
        }
    };
    let color_space = image.color_space.unwrap_or(if image.channels == 1 { "Gray" } else { "RGB" });
    let mut children = String::new();
    for (name, value) in image.keywords {
        let _ = write!(
            children,
            "<FITSKeyword name=\"{}\" value=\"{}\" comment=\"\"/>",
            xml_escape(name),
            xml_escape(value)
        );
    }
    if let Some(pattern) = image.cfa_pattern {
        let _ = write!(
            children,
            "<ColorFilterArray pattern=\"{}\" width=\"2\" height=\"2\"/>",
            xml_escape(pattern)
        );
    }
    let xml_for = |position: usize| {
        let mut attributes = format!(
            "geometry=\"{}:{}:{}\" sampleFormat=\"{format_name}\" colorSpace=\"{}\" location=\"attachment:{position}:{}\"",
            image.width,
            image.height,
            image.channels,
            xml_escape(color_space),
            block.len()
        );
        attributes.push_str(match image.storage {
            PixelStorage::Planar => " pixelStorage=\"Planar\"",
            PixelStorage::Normal => " pixelStorage=\"Normal\"",
        });
        if image.byte_order == ByteOrder::Big {
            attributes.push_str(" byteOrder=\"big\"");
        }
        if let Some(compression) = &compression {
            let _ = write!(attributes, " compression=\"{compression}\"");
        }
        if let Some((low, high)) = image.bounds {
            let _ = write!(attributes, " bounds=\"{low:?}:{high:?}\"");
        }
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<xisf version=\"1.0\" xmlns=\"http://www.pixinsight.com/xisf\"><Image {attributes}>{children}</Image></xisf>"
        )
    };
    let mut position = 4096;
    let mut xml = xml_for(position);
    while 16 + xml.len() > position {
        position = (16 + xml.len()).div_ceil(4096) * 4096;
        xml = xml_for(position);
    }
    let mut bytes = Vec::with_capacity(position + block.len());
    bytes.extend_from_slice(b"XISF0100");
    bytes.extend_from_slice(&(xml.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&[0; 4]);
    bytes.extend_from_slice(xml.as_bytes());
    bytes.resize(position, 0);
    bytes.extend_from_slice(&block);
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{SampleFormat, Scaling, StoredSamples};

    fn frame(seed: u64) -> SyntheticFrame {
        SyntheticFrame {
            stars: vec![SyntheticStar {
                x: 20.3,
                y: 17.8,
                amplitude: 4000.0,
                sigma_major: 2.0,
                sigma_minor: 1.5,
                angle_deg: 30.0,
            }],
            hot_pixels: vec![(3, 4, 30000.0)],
            ..SyntheticFrame::new(48, 40, seed, 1000.0, 10.0)
        }
    }

    #[test]
    fn the_same_seed_renders_identical_samples_and_another_seed_differs() {
        let first = frame(7).render();
        let second = frame(7).render();
        assert_eq!(first.len(), 48 * 40);
        let bits = |values: &[f64]| values.iter().map(|value| value.to_bits()).collect::<Vec<_>>();
        assert_eq!(bits(&first), bits(&second));
        assert_ne!(bits(&first), bits(&frame(8).render()));
    }

    #[test]
    fn fits_writer_is_block_aligned_and_its_data_unit_holds_the_stored_samples() {
        let scaling = Scaling { zero: 32768.0, scale: 1.0 };
        let stored = quantize(&frame(7).render(), SampleFormat::I16, scaling);
        let bytes = write_fits(&FitsImage {
            width: 48,
            height: 40,
            channels: 1,
            samples: &stored,
            scaling,
            blank: None,
            cards: &[("BAYERPAT", "'RGGB'".to_owned())],
        })
        .unwrap();
        assert_eq!(bytes.len() % 2880, 0);
        let end =
            bytes.chunks(80).position(|card| card.starts_with(b"END     ")).expect("END card");
        let header = fits_header::Header::parse(&bytes[..(end + 1) * 80]).unwrap();
        assert_eq!(header.get::<i64>("BITPIX").unwrap(), Some(16));
        assert_eq!(header.get::<f64>("BZERO").unwrap(), Some(32768.0));
        assert_eq!(header.get_str("BAYERPAT").unwrap(), Some("RGGB"));
        let data_start = ((end + 1) * 80).div_ceil(2880) * 2880;
        let StoredSamples::I16(expected) = &stored else {
            panic!("quantize returned {stored:?}");
        };
        let data = &bytes[data_start..data_start + expected.len() * 2];
        let read: Vec<i16> =
            data.as_chunks::<2>().0.iter().map(|pair| i16::from_be_bytes(*pair)).collect();
        assert_eq!(&read, expected);
        assert!(bytes[data_start + expected.len() * 2..].iter().all(|byte| *byte == 0));
    }
}
