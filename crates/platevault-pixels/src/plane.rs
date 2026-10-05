// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Stored samples, scaling, invalid-sample categories and plane kinds (R4-R6).
//!
//! A plane keeps every sample in its stored type. The physical value is
//! `zero + scale * stored`, as FITS BZERO/BSCALE define it. Coordinates are
//! 0-based storage indices: `x` is the column and `y` the stored row.

use std::fmt;

/// The container a frame was decoded from.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Container {
    Fits,
    Xisf,
}

/// The stored sample type of a data unit or attachment.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SampleFormat {
    U8,
    I16,
    U16,
    I32,
    U32,
    I64,
    F32,
    F64,
}

impl SampleFormat {
    #[must_use]
    pub const fn bytes(self) -> usize {
        match self {
            Self::U8 => 1,
            Self::I16 | Self::U16 => 2,
            Self::I32 | Self::U32 | Self::F32 => 4,
            Self::I64 | Self::F64 => 8,
        }
    }

    #[must_use]
    pub const fn is_float(self) -> bool {
        matches!(self, Self::F32 | Self::F64)
    }

    /// The largest stored value of an integer type, `None` for floats.
    #[must_use]
    pub const fn integer_maximum(self) -> Option<i64> {
        match self {
            Self::U8 => Some(u8::MAX as i64),
            Self::I16 => Some(i16::MAX as i64),
            Self::U16 => Some(u16::MAX as i64),
            Self::I32 => Some(i32::MAX as i64),
            Self::U32 => Some(u32::MAX as i64),
            Self::I64 => Some(i64::MAX),
            Self::F32 | Self::F64 => None,
        }
    }
}

/// Samples exactly as stored, in storage order.
#[derive(Clone, Debug, PartialEq)]
pub enum StoredSamples {
    U8(Vec<u8>),
    I16(Vec<i16>),
    U16(Vec<u16>),
    I32(Vec<i32>),
    U32(Vec<u32>),
    I64(Vec<i64>),
    F32(Vec<f32>),
    F64(Vec<f64>),
}

impl StoredSamples {
    #[must_use]
    pub fn len(&self) -> usize {
        match self {
            Self::U8(values) => values.len(),
            Self::I16(values) => values.len(),
            Self::U16(values) => values.len(),
            Self::I32(values) => values.len(),
            Self::U32(values) => values.len(),
            Self::I64(values) => values.len(),
            Self::F32(values) => values.len(),
            Self::F64(values) => values.len(),
        }
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    #[must_use]
    pub const fn format(&self) -> SampleFormat {
        match self {
            Self::U8(_) => SampleFormat::U8,
            Self::I16(_) => SampleFormat::I16,
            Self::U16(_) => SampleFormat::U16,
            Self::I32(_) => SampleFormat::I32,
            Self::U32(_) => SampleFormat::U32,
            Self::I64(_) => SampleFormat::I64,
            Self::F32(_) => SampleFormat::F32,
            Self::F64(_) => SampleFormat::F64,
        }
    }

    /// The stored value at `index`.
    ///
    /// # Panics
    ///
    /// Panics when `index` is out of bounds, like slice indexing.
    #[must_use]
    pub fn stored(&self, index: usize) -> StoredValue {
        match self {
            Self::U8(values) => StoredValue::Int(i64::from(values[index])),
            Self::I16(values) => StoredValue::Int(i64::from(values[index])),
            Self::U16(values) => StoredValue::Int(i64::from(values[index])),
            Self::I32(values) => StoredValue::Int(i64::from(values[index])),
            Self::U32(values) => StoredValue::Int(i64::from(values[index])),
            Self::I64(values) => StoredValue::Int(values[index]),
            Self::F32(values) => StoredValue::Float(f64::from(values[index])),
            Self::F64(values) => StoredValue::Float(values[index]),
        }
    }
}

/// A stored sample value: integers stay integers, floats keep NaN and the
/// infinities.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum StoredValue {
    Int(i64),
    Float(f64),
}

impl StoredValue {
    #[must_use]
    pub fn as_f64(self) -> f64 {
        match self {
            Self::Int(value) => value as f64,
            Self::Float(value) => value,
        }
    }
}

/// Linear scaling from stored to physical value: `zero + scale * stored`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Scaling {
    pub zero: f64,
    pub scale: f64,
}

impl Scaling {
    pub const IDENTITY: Self = Self { zero: 0.0, scale: 1.0 };

    #[must_use]
    pub fn apply(self, stored: f64) -> f64 {
        self.zero + self.scale * stored
    }
}

impl Default for Scaling {
    fn default() -> Self {
        Self::IDENTITY
    }
}

/// Where a saturation level came from (R6).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SaturationSource {
    SaturateKeyword,
    XisfBounds,
    TypeMaximum,
    Unknown,
}

/// The saturation level in physical (scaled) units, or unknown.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Saturation {
    pub level: Option<f64>,
    pub source: SaturationSource,
}

impl Saturation {
    pub const UNKNOWN: Self = Self { level: None, source: SaturationSource::Unknown };
}

/// Where CFA evidence was recorded.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CfaSource {
    /// The FITS BAYERPAT keyword.
    BayerpatKeyword,
    /// The XISF `ColorFilterArray` element.
    ColorFilterArray,
}

/// CFA evidence as recorded; absent values stay `None`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CfaEvidence {
    pub pattern: Option<String>,
    pub x_offset: Option<i64>,
    pub y_offset: Option<i64>,
    pub row_order: Option<String>,
    pub source: CfaSource,
}

/// What a plane holds. A CFA mosaic is shown as stored and never debayered.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PlaneKind {
    Mono,
    CfaMosaic(CfaEvidence),
    Channel { index: u32, count: u32, color_space: Option<String> },
}

/// The validity category of one sample (R6). Masked samples are never
/// replaced; statistics and fits read `Valid` samples only.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum Category {
    Valid,
    Nan,
    PosInf,
    NegInf,
    Blank,
    Saturated,
}

impl Category {
    /// The display mask code: 0 for a valid sample, 1 to 5 for the masked
    /// categories in declaration order.
    #[must_use]
    pub const fn code(self) -> u8 {
        match self {
            Self::Valid => 0,
            Self::Nan => 1,
            Self::PosInf => 2,
            Self::NegInf => 3,
            Self::Blank => 4,
            Self::Saturated => 5,
        }
    }
}

/// Counts of masked samples per category.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct MaskCounts {
    pub nan: u64,
    pub pos_inf: u64,
    pub neg_inf: u64,
    pub blank: u64,
    pub saturated: u64,
}

impl MaskCounts {
    pub fn add(&mut self, category: Category) {
        match category {
            Category::Valid => {}
            Category::Nan => self.nan += 1,
            Category::PosInf => self.pos_inf += 1,
            Category::NegInf => self.neg_inf += 1,
            Category::Blank => self.blank += 1,
            Category::Saturated => self.saturated += 1,
        }
    }

    #[must_use]
    pub const fn total(&self) -> u64 {
        self.nan + self.pos_inf + self.neg_inf + self.blank + self.saturated
    }
}

/// One sample read back: the stored value, the scaled value and its category.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sample {
    pub stored: StoredValue,
    pub value: f64,
    pub category: Category,
}

/// One image plane in storage order (row-major, `y` the stored row).
#[derive(Clone, Debug, PartialEq)]
pub struct Plane {
    pub width: u32,
    pub height: u32,
    pub kind: PlaneKind,
    pub samples: StoredSamples,
    pub scaling: Scaling,
    /// The integer FITS BLANK value, compared with the stored value.
    pub blank: Option<i64>,
    pub saturation: Saturation,
}

impl Plane {
    /// The number of samples, `width * height`.
    #[must_use]
    pub fn len(&self) -> usize {
        self.samples.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.samples.is_empty()
    }

    /// The sample at storage coordinates (`x` column, `y` stored row).
    ///
    /// # Panics
    ///
    /// Panics when the coordinates are outside the plane.
    #[must_use]
    pub fn sample(&self, x: u32, y: u32) -> Sample {
        assert!(x < self.width && y < self.height, "sample ({x}, {y}) outside the plane");
        self.sample_at(y as usize * self.width as usize + x as usize)
    }

    /// The sample at a row-major storage index.
    ///
    /// # Panics
    ///
    /// Panics when `index` is out of bounds.
    #[must_use]
    pub fn sample_at(&self, index: usize) -> Sample {
        let stored = self.samples.stored(index);
        let (value, category) = self.classify(stored);
        Sample { stored, value, category }
    }

    /// The scaled value and category at a row-major storage index.
    ///
    /// # Panics
    ///
    /// Panics when `index` is out of bounds.
    #[must_use]
    pub fn value_at(&self, index: usize) -> (f64, Category) {
        self.classify(self.samples.stored(index))
    }

    fn classify(&self, stored: StoredValue) -> (f64, Category) {
        let value = self.scaling.apply(stored.as_f64());
        let category = match stored {
            StoredValue::Float(raw) if raw.is_nan() => Category::Nan,
            StoredValue::Float(raw) if raw == f64::INFINITY => Category::PosInf,
            StoredValue::Float(raw) if raw == f64::NEG_INFINITY => Category::NegInf,
            StoredValue::Int(raw) if self.blank == Some(raw) => Category::Blank,
            _ if value.is_nan() => Category::Nan,
            _ if value == f64::INFINITY => Category::PosInf,
            _ if value == f64::NEG_INFINITY => Category::NegInf,
            _ if self.saturation.level.is_some_and(|level| value >= level) => Category::Saturated,
            _ => Category::Valid,
        };
        (value, category)
    }

    /// Counts of every masked category over the whole plane.
    #[must_use]
    pub fn mask_counts(&self) -> MaskCounts {
        let mut counts = MaskCounts::default();
        for index in 0..self.len() {
            counts.add(self.value_at(index).1);
        }
        counts
    }
}

/// XISF pixel storage order.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PixelStorage {
    Planar,
    Normal,
}

/// Byte order of stored samples.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ByteOrder {
    Little,
    Big,
}

/// An XISF block codec.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Codec {
    Zlib,
    Lz4,
    Lz4Hc,
}

/// Compression evidence of an XISF attachment.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Compression {
    pub codec: Codec,
    pub uncompressed_size: u64,
    /// The byte-shuffling item size, when shuffled.
    pub shuffle_item_size: Option<u32>,
}

/// How the decoded data was stored, as recorded in the file.
#[derive(Clone, Debug, PartialEq)]
pub struct StructureEvidence {
    pub sample_format: SampleFormat,
    /// `NAXISn` for FITS, the `geometry` attribute for XISF.
    pub geometry: Vec<u64>,
    pub byte_order: ByteOrder,
    pub storage: Option<PixelStorage>,
    pub compression: Option<Compression>,
    pub color_space: Option<String>,
    /// The XISF `bounds` attribute, when recorded.
    pub bounds: Option<(f64, f64)>,
}

/// A decoded frame: every plane of its single image.
#[derive(Clone, Debug, PartialEq)]
pub struct DecodedImage {
    pub container: Container,
    pub planes: Vec<Plane>,
    pub evidence: StructureEvidence,
}

/// Why decoding, measuring or rendering stopped.
#[derive(Debug)]
pub enum PixelError {
    /// A recognised but unsupported feature, named.
    Unsupported(String),
    /// Truncated or inconsistent data, naming the structure.
    Malformed(String),
    Io(std::io::Error),
    Canceled,
}

impl fmt::Display for PixelError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unsupported(feature) => write!(formatter, "unsupported: {feature}"),
            Self::Malformed(structure) => write!(formatter, "malformed: {structure}"),
            Self::Io(error) => write!(formatter, "read failed: {error}"),
            Self::Canceled => formatter.write_str("canceled"),
        }
    }
}

impl std::error::Error for PixelError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            _ => None,
        }
    }
}

impl From<std::io::Error> for PixelError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plane(
        samples: StoredSamples,
        scaling: Scaling,
        blank: Option<i64>,
        level: Option<f64>,
    ) -> Plane {
        let width = samples.len() as u32;
        Plane {
            width,
            height: 1,
            kind: PlaneKind::Mono,
            samples,
            scaling,
            blank,
            saturation: Saturation {
                level,
                source: if level.is_some() {
                    SaturationSource::TypeMaximum
                } else {
                    SaturationSource::Unknown
                },
            },
        }
    }

    fn row(plane: &Plane) -> Vec<Sample> {
        (0..plane.width).map(|x| plane.sample(x, 0)).collect()
    }

    #[test]
    fn int16_with_bzero_32768_reads_the_full_unsigned_range() {
        let plane = plane(
            StoredSamples::I16(vec![i16::MIN, -1, 0, i16::MAX]),
            Scaling { zero: 32768.0, scale: 1.0 },
            None,
            None,
        );
        let samples = row(&plane);
        let values: Vec<f64> = samples.iter().map(|sample| sample.value).collect();
        assert_eq!(values, vec![0.0, 32767.0, 32768.0, 65535.0]);
        let stored: Vec<StoredValue> = samples.iter().map(|sample| sample.stored).collect();
        assert_eq!(
            stored,
            vec![
                StoredValue::Int(-32768),
                StoredValue::Int(-1),
                StoredValue::Int(0),
                StoredValue::Int(32767)
            ]
        );
        assert!(samples.iter().all(|sample| sample.category == Category::Valid));
    }

    #[test]
    fn every_stored_variant_reports_its_stored_scaled_value_and_category() {
        let scaling = Scaling { zero: 10.0, scale: 2.0 };
        let cases = [
            (StoredSamples::U8(vec![0, 255]), [0.0, 255.0]),
            (StoredSamples::I16(vec![-7, 300]), [-7.0, 300.0]),
            (StoredSamples::U16(vec![1, 65535]), [1.0, 65535.0]),
            (StoredSamples::I32(vec![-100_000, 7]), [-100_000.0, 7.0]),
            (StoredSamples::U32(vec![3, 4_000_000_000]), [3.0, 4_000_000_000.0]),
            (StoredSamples::I64(vec![-5, 1 << 40]), [-5.0, (1_i64 << 40) as f64]),
            (StoredSamples::F32(vec![0.25, -1.5]), [0.25, -1.5]),
            (StoredSamples::F64(vec![0.125, 1e300]), [0.125, 1e300]),
        ];
        for (samples, stored) in cases {
            let format = samples.format();
            let plane = plane(samples, scaling, None, None);
            for (x, expected) in stored.iter().enumerate() {
                let sample = plane.sample(x as u32, 0);
                assert_eq!(sample.stored.as_f64().to_bits(), expected.to_bits(), "{format:?}");
                assert_eq!(sample.value.to_bits(), (10.0 + 2.0 * expected).to_bits(), "{format:?}");
                assert_eq!(sample.category, Category::Valid, "{format:?}");
                let integer = !format.is_float();
                assert_eq!(matches!(sample.stored, StoredValue::Int(_)), integer, "{format:?}");
            }
        }
    }

    #[test]
    fn non_finite_floats_read_their_categories_with_stored_bits_unchanged() {
        let f32_values = vec![f32::NAN, f32::INFINITY, f32::NEG_INFINITY, 1.0];
        let f64_values = vec![f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 1.0];
        let f32_bits: Vec<u32> = f32_values.iter().map(|value| value.to_bits()).collect();
        let f64_bits: Vec<u64> = f64_values.iter().map(|value| value.to_bits()).collect();
        let expected = [Category::Nan, Category::PosInf, Category::NegInf, Category::Valid];
        for samples in [StoredSamples::F32(f32_values), StoredSamples::F64(f64_values)] {
            let plane = plane(samples, Scaling::IDENTITY, None, Some(10.0));
            let read = row(&plane);
            let categories: Vec<Category> = read.iter().map(|sample| sample.category).collect();
            assert_eq!(categories, expected);
            assert!(read[0].stored.as_f64().is_nan() && read[0].value.is_nan());
            assert_eq!(read[1].stored, StoredValue::Float(f64::INFINITY));
            assert_eq!(read[2].stored, StoredValue::Float(f64::NEG_INFINITY));
            let _ = plane.mask_counts();
            match &plane.samples {
                StoredSamples::F32(values) => {
                    let bits: Vec<u32> = values.iter().map(|value| value.to_bits()).collect();
                    assert_eq!(bits, f32_bits);
                }
                StoredSamples::F64(values) => {
                    let bits: Vec<u64> = values.iter().map(|value| value.to_bits()).collect();
                    assert_eq!(bits, f64_bits);
                }
                other => panic!("unexpected {other:?}"),
            }
        }
    }

    #[test]
    fn blank_wins_over_saturation_and_the_level_is_inclusive() {
        let plane = plane(
            StoredSamples::I16(vec![-5, 100, 199, 200, 300]),
            Scaling::IDENTITY,
            Some(-5),
            Some(200.0),
        );
        let categories: Vec<Category> = row(&plane).iter().map(|sample| sample.category).collect();
        assert_eq!(
            categories,
            vec![
                Category::Blank,
                Category::Valid,
                Category::Valid,
                Category::Saturated,
                Category::Saturated
            ]
        );
        let blank_high = super::tests::plane(
            StoredSamples::I32(vec![500]),
            Scaling::IDENTITY,
            Some(500),
            Some(100.0),
        );
        assert_eq!(blank_high.sample(0, 0).category, Category::Blank);
        assert_eq!(blank_high.sample(0, 0).stored, StoredValue::Int(500));
    }

    #[test]
    fn mask_counts_count_each_category_exactly() {
        let mut values = vec![f32::NAN; 3];
        values.extend([f32::INFINITY; 2]);
        values.push(f32::NEG_INFINITY);
        values.extend([65535.0_f32; 4]);
        values.extend([12.0_f32; 5]);
        let float = plane(StoredSamples::F32(values), Scaling::IDENTITY, None, Some(65535.0));
        assert_eq!(
            float.mask_counts(),
            MaskCounts { nan: 3, pos_inf: 2, neg_inf: 1, blank: 0, saturated: 4 }
        );
        let integer = plane(
            StoredSamples::I16(vec![-32768, -32768, 0, 32767]),
            Scaling { zero: 32768.0, scale: 1.0 },
            Some(-32768),
            Some(65535.0),
        );
        let counts = integer.mask_counts();
        assert_eq!((counts.blank, counts.saturated, counts.total()), (2, 1, 3));
    }
}
