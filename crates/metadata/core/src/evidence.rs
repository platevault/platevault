// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Canonical fields emitted by capture-software profiles.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CanonicalField {
    Camera,
    Telescope,
    Filter,
    Gain,
    Offset,
    BinningX,
    BinningY,
    ReadoutMode,
    RasterWidth,
    RasterHeight,
    Crop,
    FocalLengthReported,
    FocalLengthCalculated,
    PixelSize,
    PhysicalRotator,
    SkyOrientation,
}

/// State of one normalized metadata value.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceState {
    Known,
    Absent,
    Invalid,
    Contradictory,
}

/// Quality of the evidence supporting a normalized value.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceConfidence {
    Confirmed,
    Reported,
    Calculated,
}

/// Typed scalar value produced by a profile mapping.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetadataValue {
    Text(String),
    Integer(i64),
    Unsigned(u64),
    Decimal(f64),
}

/// Field-level value, state, and raw provenance.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldEvidence {
    pub state: EvidenceState,
    pub source_field: Option<String>,
    pub raw_value: Option<String>,
    pub normalized_value: Option<MetadataValue>,
    pub confidence: EvidenceConfidence,
}

impl FieldEvidence {
    pub(crate) fn absent(confidence: EvidenceConfidence) -> Self {
        Self {
            state: EvidenceState::Absent,
            source_field: None,
            raw_value: None,
            normalized_value: None,
            confidence,
        }
    }

    pub(crate) fn from_raw(
        source_field: String,
        raw_value: String,
        normalized_value: Option<MetadataValue>,
        confidence: EvidenceConfidence,
    ) -> Self {
        Self {
            state: if normalized_value.is_some() {
                EvidenceState::Known
            } else {
                EvidenceState::Invalid
            },
            source_field: Some(source_field),
            raw_value: Some(raw_value),
            normalized_value,
            confidence,
        }
    }
}

/// Exact capture-profile version used for normalization.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureProfileVersion {
    pub profile_id: String,
    pub version: u32,
    pub registry_format_version: u32,
}

/// Normalized field evidence extracted from one raw metadata source.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataEvidence {
    pub profile: CaptureProfileVersion,
    pub fields: BTreeMap<CanonicalField, FieldEvidence>,
}

impl MetadataEvidence {
    /// Returns the evidence for a canonical field mapped by the selected profile.
    #[must_use]
    pub fn field(&self, field: CanonicalField) -> Option<&FieldEvidence> {
        self.fields.get(&field)
    }
}

/// Independently calculated focal length supplied by a geometry interpreter.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalculatedFocalLength {
    pub millimetres: f64,
    pub source: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct RawMetadataEntry {
    source_field: String,
    raw_value: String,
}

/// Raw FITS keywords or XISF properties keyed without case sensitivity.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawMetadata {
    values: BTreeMap<String, RawMetadataEntry>,
}

impl RawMetadata {
    /// Builds raw metadata from `(source field, raw value)` pairs.
    #[must_use]
    pub fn from_pairs<I, K, V>(pairs: I) -> Self
    where
        I: IntoIterator<Item = (K, V)>,
        K: Into<String>,
        V: Into<String>,
    {
        let mut metadata = Self::default();
        for (field, value) in pairs {
            metadata.insert(field, value);
        }
        metadata
    }

    /// Inserts or replaces one raw field using ASCII case-insensitive identity.
    pub fn insert(&mut self, field: impl Into<String>, value: impl Into<String>) {
        let source_field = field.into();
        self.values.insert(
            source_field.to_ascii_uppercase(),
            RawMetadataEntry { source_field, raw_value: value.into() },
        );
    }

    pub(crate) fn get(&self, field: &str) -> Option<(&str, &str)> {
        self.values
            .get(&field.to_ascii_uppercase())
            .map(|entry| (entry.source_field.as_str(), entry.raw_value.as_str()))
    }
}
