// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

use std::collections::BTreeMap;

use serde::{de::Error as _, Deserialize, Deserializer, Serialize};

/// Maximum UTF-8 size of one raw or normalized evidence value.
pub const MAX_EVIDENCE_VALUE_BYTES: usize = 16 * 1024;

/// Maximum canonical UTF-8 value payload of one metadata-evidence revision.
pub const MAX_EVIDENCE_PAYLOAD_BYTES: usize = 256 * 1024;

const MAX_EVIDENCE_FIELDS: usize = 256;

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

/// Evidence construction or input-bound failure.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum EvidenceError {
    #[error("{context} is {actual} UTF-8 bytes; maximum is {maximum}")]
    ValueTooLarge { context: &'static str, actual: usize, maximum: usize },
    #[error("metadata evidence has {actual} fields; maximum is {maximum}")]
    TooManyFields { actual: usize, maximum: usize },
    #[error("metadata evidence payload is {actual} UTF-8 bytes; maximum is {maximum}")]
    PayloadTooLarge { actual: usize, maximum: usize },
    #[error("invalid field evidence tuple: {0}")]
    InvalidFieldEvidence(&'static str),
    #[error("metadata decimal must be finite")]
    NonFiniteDecimal,
    #[error("capture profile identity is invalid: {0}")]
    InvalidProfile(&'static str),
    #[error("raw metadata field must not be empty")]
    EmptyRawField,
    #[error("raw metadata contains a case-insensitive key collision for {0}")]
    RawKeyCollision(String),
    #[error("raw metadata key does not match its source field")]
    RawKeyMismatch,
    #[error("capture-profile registry has no fallback profile")]
    MissingFallbackProfile,
}

/// Typed scalar value produced by a profile mapping.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MetadataValue {
    Text(String),
    Integer(i64),
    Unsigned(u64),
    Decimal(f64),
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum MetadataValueWire {
    Text(String),
    Integer(i64),
    Unsigned(u64),
    Decimal(f64),
}

impl MetadataValue {
    fn validate(&self) -> Result<(), EvidenceError> {
        match self {
            Self::Text(value) => validate_value_size("normalized evidence value", value),
            Self::Decimal(value) if !value.is_finite() => Err(EvidenceError::NonFiniteDecimal),
            Self::Integer(_) | Self::Unsigned(_) | Self::Decimal(_) => Ok(()),
        }
    }

    fn canonical_payload_bytes(&self) -> usize {
        match self {
            Self::Text(value) => value.len(),
            Self::Integer(value) => value.to_string().len(),
            Self::Unsigned(value) => value.to_string().len(),
            Self::Decimal(value) => value.to_string().len(),
        }
    }
}

impl TryFrom<MetadataValueWire> for MetadataValue {
    type Error = EvidenceError;

    fn try_from(value: MetadataValueWire) -> Result<Self, Self::Error> {
        let value = match value {
            MetadataValueWire::Text(value) => Self::Text(value),
            MetadataValueWire::Integer(value) => Self::Integer(value),
            MetadataValueWire::Unsigned(value) => Self::Unsigned(value),
            MetadataValueWire::Decimal(value) => Self::Decimal(value),
        };
        value.validate()?;
        Ok(value)
    }
}

impl<'de> Deserialize<'de> for MetadataValue {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        MetadataValueWire::deserialize(deserializer)?.try_into().map_err(D::Error::custom)
    }
}

/// Field-level value, state, and raw provenance.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldEvidence {
    state: EvidenceState,
    source_field: Option<String>,
    raw_value: Option<String>,
    normalized_value: Option<MetadataValue>,
    confidence: EvidenceConfidence,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FieldEvidenceWire {
    state: EvidenceState,
    source_field: Option<String>,
    raw_value: Option<String>,
    normalized_value: Option<MetadataValue>,
    confidence: EvidenceConfidence,
}

impl FieldEvidence {
    /// Builds a field-evidence value after validating its state/value tuple.
    ///
    /// # Errors
    /// Returns [`EvidenceError`] for inconsistent state/value combinations,
    /// non-finite decimals, or values exceeding the evidence-size limit.
    pub fn try_new(
        state: EvidenceState,
        source_field: Option<String>,
        raw_value: Option<String>,
        normalized_value: Option<MetadataValue>,
        confidence: EvidenceConfidence,
    ) -> Result<Self, EvidenceError> {
        match state {
            EvidenceState::Known
                if source_field.is_none() || raw_value.is_none() || normalized_value.is_none() =>
            {
                return Err(EvidenceError::InvalidFieldEvidence(
                    "known evidence requires source, raw, and normalized values",
                ));
            }
            EvidenceState::Absent
                if source_field.is_some() || raw_value.is_some() || normalized_value.is_some() =>
            {
                return Err(EvidenceError::InvalidFieldEvidence(
                    "absent evidence cannot contain source, raw, or normalized values",
                ));
            }
            EvidenceState::Invalid | EvidenceState::Contradictory
                if source_field.is_none() || raw_value.is_none() || normalized_value.is_some() =>
            {
                return Err(EvidenceError::InvalidFieldEvidence(
                    "invalid or contradictory evidence requires source and raw values only",
                ));
            }
            _ => {}
        }

        if source_field.as_ref().is_some_and(|field| field.trim().is_empty()) {
            return Err(EvidenceError::EmptyRawField);
        }
        if let Some(source_field) = &source_field {
            validate_value_size("evidence source field", source_field)?;
        }
        if let Some(raw_value) = &raw_value {
            validate_value_size("raw evidence value", raw_value)?;
        }
        if let Some(normalized_value) = &normalized_value {
            normalized_value.validate()?;
        }

        Ok(Self { state, source_field, raw_value, normalized_value, confidence })
    }

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
    ) -> Result<Self, EvidenceError> {
        Self::try_new(
            if normalized_value.is_some() { EvidenceState::Known } else { EvidenceState::Invalid },
            Some(source_field),
            Some(raw_value),
            normalized_value,
            confidence,
        )
    }

    /// Returns this field's evidence state.
    #[must_use]
    pub const fn state(&self) -> EvidenceState {
        self.state
    }

    /// Returns the original source-field spelling, when present.
    #[must_use]
    pub fn source_field(&self) -> Option<&str> {
        self.source_field.as_deref()
    }

    /// Returns the unmodified source value, when present.
    #[must_use]
    pub fn raw_value(&self) -> Option<&str> {
        self.raw_value.as_deref()
    }

    /// Returns the normalized value, when present.
    #[must_use]
    pub const fn normalized_value(&self) -> Option<&MetadataValue> {
        self.normalized_value.as_ref()
    }

    /// Returns the confidence assigned by the selected profile.
    #[must_use]
    pub const fn confidence(&self) -> EvidenceConfidence {
        self.confidence
    }

    fn canonical_payload_bytes(&self) -> usize {
        self.raw_value.as_ref().map_or(0, String::len)
            + self.normalized_value.as_ref().map_or(0, MetadataValue::canonical_payload_bytes)
    }
}

impl TryFrom<FieldEvidenceWire> for FieldEvidence {
    type Error = EvidenceError;

    fn try_from(value: FieldEvidenceWire) -> Result<Self, Self::Error> {
        Self::try_new(
            value.state,
            value.source_field,
            value.raw_value,
            value.normalized_value,
            value.confidence,
        )
    }
}

impl<'de> Deserialize<'de> for FieldEvidence {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        FieldEvidenceWire::deserialize(deserializer)?.try_into().map_err(D::Error::custom)
    }
}

/// Exact capture-profile version used for normalization.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureProfileVersion {
    profile_id: String,
    version: u32,
    registry_format_version: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CaptureProfileVersionWire {
    profile_id: String,
    version: u32,
    registry_format_version: u32,
}

impl CaptureProfileVersion {
    /// Builds a validated capture-profile identity.
    ///
    /// # Errors
    /// Returns [`EvidenceError`] when the profile ID is empty or too large, or
    /// either version is zero.
    pub fn try_new(
        profile_id: String,
        version: u32,
        registry_format_version: u32,
    ) -> Result<Self, EvidenceError> {
        if profile_id.trim().is_empty() {
            return Err(EvidenceError::InvalidProfile("profile ID must not be empty"));
        }
        validate_value_size("capture profile ID", &profile_id)?;
        if version == 0 || registry_format_version == 0 {
            return Err(EvidenceError::InvalidProfile("profile versions must be positive"));
        }
        Ok(Self { profile_id, version, registry_format_version })
    }

    /// Returns the stable capture-profile identifier.
    #[must_use]
    pub fn profile_id(&self) -> &str {
        &self.profile_id
    }

    /// Returns the selected profile's version.
    #[must_use]
    pub const fn version(&self) -> u32 {
        self.version
    }

    /// Returns the registry format version.
    #[must_use]
    pub const fn registry_format_version(&self) -> u32 {
        self.registry_format_version
    }
}

impl TryFrom<CaptureProfileVersionWire> for CaptureProfileVersion {
    type Error = EvidenceError;

    fn try_from(value: CaptureProfileVersionWire) -> Result<Self, Self::Error> {
        Self::try_new(value.profile_id, value.version, value.registry_format_version)
    }
}

impl<'de> Deserialize<'de> for CaptureProfileVersion {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        CaptureProfileVersionWire::deserialize(deserializer)?.try_into().map_err(D::Error::custom)
    }
}

/// Normalized field evidence extracted from one raw metadata source.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataEvidence {
    profile: CaptureProfileVersion,
    fields: BTreeMap<CanonicalField, FieldEvidence>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MetadataEvidenceWire {
    profile: CaptureProfileVersion,
    fields: BTreeMap<CanonicalField, FieldEvidence>,
}

impl MetadataEvidence {
    /// Builds a bounded metadata-evidence revision.
    ///
    /// The aggregate payload is the canonical UTF-8 representation of each
    /// raw and normalized value. Source-field and profile identifiers are
    /// bounded individually and are not evidence values.
    ///
    /// # Errors
    /// Returns [`EvidenceError`] when the field count or aggregate evidence
    /// value payload exceeds its contract bound.
    pub fn try_new(
        profile: CaptureProfileVersion,
        fields: BTreeMap<CanonicalField, FieldEvidence>,
    ) -> Result<Self, EvidenceError> {
        if fields.len() > MAX_EVIDENCE_FIELDS {
            return Err(EvidenceError::TooManyFields {
                actual: fields.len(),
                maximum: MAX_EVIDENCE_FIELDS,
            });
        }
        let payload_bytes = fields.values().try_fold(0usize, |size, field| {
            size.checked_add(field.canonical_payload_bytes()).ok_or(
                EvidenceError::PayloadTooLarge {
                    actual: usize::MAX,
                    maximum: MAX_EVIDENCE_PAYLOAD_BYTES,
                },
            )
        })?;
        if payload_bytes > MAX_EVIDENCE_PAYLOAD_BYTES {
            return Err(EvidenceError::PayloadTooLarge {
                actual: payload_bytes,
                maximum: MAX_EVIDENCE_PAYLOAD_BYTES,
            });
        }
        Ok(Self { profile, fields })
    }

    /// Returns the exact selected capture-profile version.
    #[must_use]
    pub const fn profile(&self) -> &CaptureProfileVersion {
        &self.profile
    }

    /// Returns the evidence for a canonical field mapped by the selected profile.
    #[must_use]
    pub fn field(&self, field: CanonicalField) -> Option<&FieldEvidence> {
        self.fields.get(&field)
    }

    /// Returns all canonical field evidence in stable field order.
    #[must_use]
    pub const fn fields(&self) -> &BTreeMap<CanonicalField, FieldEvidence> {
        &self.fields
    }
}

impl TryFrom<MetadataEvidenceWire> for MetadataEvidence {
    type Error = EvidenceError;

    fn try_from(value: MetadataEvidenceWire) -> Result<Self, Self::Error> {
        Self::try_new(value.profile, value.fields)
    }
}

impl<'de> Deserialize<'de> for MetadataEvidence {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        MetadataEvidenceWire::deserialize(deserializer)?.try_into().map_err(D::Error::custom)
    }
}

/// Independently calculated focal length supplied by a geometry interpreter.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalculatedFocalLength {
    millimetres: f64,
    source: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CalculatedFocalLengthWire {
    millimetres: f64,
    source: String,
}

impl CalculatedFocalLength {
    /// Builds calculated focal-length evidence with bounded provenance.
    ///
    /// Non-finite or non-positive focal lengths remain representable so the
    /// profile can preserve them as explicit invalid evidence.
    ///
    /// # Errors
    /// Returns [`EvidenceError`] when `source` is empty or exceeds the value
    /// size limit.
    pub fn try_new(millimetres: f64, source: String) -> Result<Self, EvidenceError> {
        if source.trim().is_empty() {
            return Err(EvidenceError::EmptyRawField);
        }
        validate_value_size("calculated focal-length source", &source)?;
        Ok(Self { millimetres, source })
    }

    /// Returns the calculated focal length in millimetres.
    #[must_use]
    pub const fn millimetres(&self) -> f64 {
        self.millimetres
    }

    /// Returns the calculation provenance identifier.
    #[must_use]
    pub fn source(&self) -> &str {
        &self.source
    }
}

impl TryFrom<CalculatedFocalLengthWire> for CalculatedFocalLength {
    type Error = EvidenceError;

    fn try_from(value: CalculatedFocalLengthWire) -> Result<Self, Self::Error> {
        Self::try_new(value.millimetres, value.source)
    }
}

impl<'de> Deserialize<'de> for CalculatedFocalLength {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        CalculatedFocalLengthWire::deserialize(deserializer)?.try_into().map_err(D::Error::custom)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
struct RawMetadataEntry {
    source_field: String,
    raw_value: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawMetadataEntryWire {
    source_field: String,
    raw_value: String,
}

/// Raw FITS keywords or XISF properties keyed without ASCII case sensitivity.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct RawMetadata {
    values: BTreeMap<String, RawMetadataEntry>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawMetadataWire {
    values: BTreeMap<String, RawMetadataEntryWire>,
}

impl RawMetadata {
    /// Builds raw metadata from `(source field, raw value)` pairs.
    ///
    /// # Errors
    /// Returns [`EvidenceError`] for empty or oversized fields/values and for
    /// fields that collide after ASCII case folding.
    pub fn from_pairs<I, K, V>(pairs: I) -> Result<Self, EvidenceError>
    where
        I: IntoIterator<Item = (K, V)>,
        K: Into<String>,
        V: Into<String>,
    {
        let mut metadata = Self::default();
        for (field, value) in pairs {
            metadata.insert(field, value)?;
        }
        Ok(metadata)
    }

    /// Inserts one raw field using ASCII case-insensitive identity.
    ///
    /// # Errors
    /// Returns [`EvidenceError`] for empty or oversized fields/values or when
    /// the canonical key is already present.
    pub fn insert(
        &mut self,
        field: impl Into<String>,
        value: impl Into<String>,
    ) -> Result<(), EvidenceError> {
        self.insert_entry(field.into(), value.into())
    }

    pub(crate) fn get(&self, field: &str) -> Option<(&str, &str)> {
        self.values
            .get(&canonical_raw_key(field))
            .map(|entry| (entry.source_field.as_str(), entry.raw_value.as_str()))
    }

    fn insert_entry(
        &mut self,
        source_field: String,
        raw_value: String,
    ) -> Result<(), EvidenceError> {
        if source_field.trim().is_empty() {
            return Err(EvidenceError::EmptyRawField);
        }
        validate_value_size("raw metadata source field", &source_field)?;
        validate_value_size("raw metadata value", &raw_value)?;
        let canonical_key = canonical_raw_key(&source_field);
        if self.values.contains_key(&canonical_key) {
            return Err(EvidenceError::RawKeyCollision(canonical_key));
        }
        self.values.insert(canonical_key, RawMetadataEntry { source_field, raw_value });
        Ok(())
    }
}

impl TryFrom<RawMetadataWire> for RawMetadata {
    type Error = EvidenceError;

    fn try_from(value: RawMetadataWire) -> Result<Self, Self::Error> {
        let mut metadata = Self::default();
        for (key, entry) in value.values {
            if canonical_raw_key(&key) != canonical_raw_key(&entry.source_field) {
                return Err(EvidenceError::RawKeyMismatch);
            }
            metadata.insert_entry(entry.source_field, entry.raw_value)?;
        }
        Ok(metadata)
    }
}

impl<'de> Deserialize<'de> for RawMetadata {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawMetadataWire::deserialize(deserializer)?.try_into().map_err(D::Error::custom)
    }
}

fn canonical_raw_key(field: &str) -> String {
    field.to_ascii_uppercase()
}

fn validate_value_size(context: &'static str, value: &str) -> Result<(), EvidenceError> {
    if value.len() > MAX_EVIDENCE_VALUE_BYTES {
        return Err(EvidenceError::ValueTooLarge {
            context,
            actual: value.len(),
            maximum: MAX_EVIDENCE_VALUE_BYTES,
        });
    }
    Ok(())
}
