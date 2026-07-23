// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

use std::collections::{BTreeMap, HashSet};

use serde::Deserialize;

use crate::{
    CalculatedFocalLength, CanonicalField, CaptureProfileVersion, EvidenceConfidence,
    EvidenceError, FieldEvidence, MetadataEvidence, MetadataValue, RawMetadata,
};

const EMBEDDED_PROFILES: &str = include_str!("../data/capture_profiles.toml");

/// Maximum UTF-8 size accepted for a capture-profile registry.
pub const MAX_CAPTURE_PROFILE_TOML_BYTES: usize = 256 * 1024;

/// Registry parse or validation failure.
#[derive(Debug, thiserror::Error)]
pub enum CaptureProfileError {
    #[error("capture-profile TOML is {actual} UTF-8 bytes; maximum is {maximum}")]
    SourceTooLarge { actual: usize, maximum: usize },
    #[error("invalid capture-profile TOML: {0}")]
    Toml(#[from] toml::de::Error),
    #[error("invalid capture-profile registry: {0}")]
    Registry(String),
}

/// Versioned capture-software profiles loaded from TOML.
#[derive(Clone, Debug)]
pub struct CaptureProfileRegistry {
    format_version: u32,
    fallback_profile: String,
    profiles: Vec<ProfileConfig>,
}

impl CaptureProfileRegistry {
    /// Loads the profiles shipped with this crate.
    ///
    /// # Errors
    /// Returns [`CaptureProfileError`] when the embedded registry cannot be
    /// parsed or violates a registry invariant.
    pub fn embedded() -> Result<Self, CaptureProfileError> {
        Self::from_toml(EMBEDDED_PROFILES)
    }

    /// Loads and validates a capture-profile registry.
    ///
    /// # Errors
    /// Returns [`CaptureProfileError`] when `source` is not valid registry TOML
    /// or violates a registry invariant.
    pub fn from_toml(source: &str) -> Result<Self, CaptureProfileError> {
        if source.len() > MAX_CAPTURE_PROFILE_TOML_BYTES {
            return Err(CaptureProfileError::SourceTooLarge {
                actual: source.len(),
                maximum: MAX_CAPTURE_PROFILE_TOML_BYTES,
            });
        }
        let config: RegistryConfig = toml::from_str(source)?;
        validate(&config)?;
        Ok(Self {
            format_version: config.format_version,
            fallback_profile: config.fallback_profile,
            profiles: config.profiles,
        })
    }

    /// Selects a profile and extracts bounded typed field evidence.
    ///
    /// # Errors
    /// Returns [`EvidenceError`] when raw, normalized, or aggregate evidence
    /// exceeds its contract bound or an internal registry invariant is absent.
    pub fn extract(
        &self,
        raw: &RawMetadata,
        calculated_focal_length: Option<CalculatedFocalLength>,
    ) -> Result<MetadataEvidence, EvidenceError> {
        let profile = self.select_profile(raw)?;
        let mut fields = profile
            .fields
            .iter()
            .map(|(field, mapping)| (*field, extract_field(raw, mapping)))
            .map(|(field, evidence)| evidence.map(|evidence| (field, evidence)))
            .collect::<Result<BTreeMap<_, _>, _>>()?;
        fields.insert(
            CanonicalField::FocalLengthCalculated,
            calculated_focal_length_evidence(calculated_focal_length)?,
        );

        MetadataEvidence::try_new(
            CaptureProfileVersion::try_new(
                profile.id.clone(),
                profile.version,
                self.format_version,
            )?,
            fields,
        )
    }

    fn select_profile(&self, raw: &RawMetadata) -> Result<&ProfileConfig, EvidenceError> {
        let selected = self
            .profiles
            .iter()
            .filter(|profile| profile.id != self.fallback_profile && profile.matches(raw))
            .min_by(|left, right| {
                right.priority.cmp(&left.priority).then_with(|| left.id.cmp(&right.id))
            });
        selected
            .or_else(|| self.profiles.iter().find(|profile| profile.id == self.fallback_profile))
            .ok_or(EvidenceError::MissingFallbackProfile)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RegistryConfig {
    format_version: u32,
    fallback_profile: String,
    profiles: Vec<ProfileConfig>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ProfileConfig {
    id: String,
    version: u32,
    #[serde(default)]
    priority: i32,
    #[serde(default)]
    match_any: Vec<ProfileMatcher>,
    #[serde(default)]
    fields: BTreeMap<CanonicalField, FieldMapping>,
}

impl ProfileConfig {
    fn matches(&self, raw: &RawMetadata) -> bool {
        self.match_any.iter().any(|matcher| matcher.matches(raw))
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ProfileMatcher {
    field: String,
    equals: Option<String>,
    contains: Option<String>,
}

impl ProfileMatcher {
    fn matches(&self, raw: &RawMetadata) -> bool {
        let Some((_, raw_value)) = raw.get(&self.field) else {
            return false;
        };
        if let Some(expected) = &self.equals {
            raw_value.trim().eq_ignore_ascii_case(expected.trim())
        } else if let Some(fragment) = &self.contains {
            raw_value.to_ascii_lowercase().contains(&fragment.to_ascii_lowercase())
        } else {
            false
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct FieldMapping {
    confidence: EvidenceConfidence,
    sources: Vec<SourceMapping>,
    #[serde(default)]
    aliases: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceMapping {
    field: String,
    parser: ValueParser,
    scale: Option<f64>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ValueParser {
    Text,
    Integer,
    PositiveInteger,
    Decimal,
    PositiveDecimal,
}

fn validate(config: &RegistryConfig) -> Result<(), CaptureProfileError> {
    if config.format_version != 1 {
        return Err(CaptureProfileError::Registry(format!(
            "unsupported format_version {}",
            config.format_version
        )));
    }
    if config.profiles.is_empty() {
        return Err(CaptureProfileError::Registry("profiles must not be empty".to_owned()));
    }

    let mut profile_ids = HashSet::new();
    let mut fallback_count = 0;
    for profile in &config.profiles {
        if profile.id.trim().is_empty() {
            return Err(CaptureProfileError::Registry("profile id must not be empty".to_owned()));
        }
        if profile.version == 0 {
            return Err(CaptureProfileError::Registry(format!(
                "profile {} has a zero version",
                profile.id
            )));
        }
        if !profile_ids.insert(profile.id.as_str()) {
            return Err(CaptureProfileError::Registry(format!(
                "duplicate profile id {}",
                profile.id
            )));
        }
        if profile.id == config.fallback_profile {
            fallback_count += 1;
        }
        for matcher in &profile.match_any {
            if matcher.field.trim().is_empty()
                || usize::from(matcher.equals.is_some()) + usize::from(matcher.contains.is_some())
                    != 1
            {
                return Err(CaptureProfileError::Registry(format!(
                    "profile {} has an invalid matcher",
                    profile.id
                )));
            }
        }
        for (field, mapping) in &profile.fields {
            if *field == CanonicalField::FocalLengthCalculated {
                return Err(CaptureProfileError::Registry(format!(
                    "profile {} maps calculated focal length from raw metadata",
                    profile.id
                )));
            }
            if mapping.sources.is_empty() {
                return Err(CaptureProfileError::Registry(format!(
                    "profile {} field {field:?} has no sources",
                    profile.id
                )));
            }
            for source in &mapping.sources {
                if source.field.trim().is_empty()
                    || source.scale.is_some_and(|scale| !scale.is_finite() || scale <= 0.0)
                {
                    return Err(CaptureProfileError::Registry(format!(
                        "profile {} field {field:?} has an invalid source",
                        profile.id
                    )));
                }
            }
        }
    }

    if fallback_count != 1 {
        return Err(CaptureProfileError::Registry(format!(
            "fallback profile {} must exist exactly once",
            config.fallback_profile
        )));
    }
    Ok(())
}

fn extract_field(
    raw: &RawMetadata,
    mapping: &FieldMapping,
) -> Result<FieldEvidence, EvidenceError> {
    for source in &mapping.sources {
        let Some((source_field, raw_value)) = raw.get(&source.field) else {
            continue;
        };
        let normalized = parse_value(raw_value, source, &mapping.aliases);
        return FieldEvidence::from_raw(
            source_field.to_owned(),
            raw_value.to_owned(),
            normalized,
            mapping.confidence,
        );
    }
    Ok(FieldEvidence::absent(mapping.confidence))
}

fn parse_value(
    raw_value: &str,
    source: &SourceMapping,
    aliases: &BTreeMap<String, String>,
) -> Option<MetadataValue> {
    let value = crate::strip_fits_quotes(raw_value)?;
    match source.parser {
        ValueParser::Text => {
            let normalized = aliases
                .iter()
                .find_map(|(alias, replacement)| {
                    value.eq_ignore_ascii_case(alias).then_some(replacement.as_str())
                })
                .unwrap_or(value);
            Some(MetadataValue::Text(normalized.to_owned()))
        }
        ValueParser::Integer => value.parse().ok().map(MetadataValue::Integer),
        ValueParser::PositiveInteger => {
            value.parse::<u64>().ok().filter(|parsed| *parsed > 0).map(MetadataValue::Unsigned)
        }
        ValueParser::Decimal => parse_decimal(value, source.scale, false),
        ValueParser::PositiveDecimal => parse_decimal(value, source.scale, true),
    }
}

fn parse_decimal(raw_value: &str, scale: Option<f64>, positive: bool) -> Option<MetadataValue> {
    let value = raw_value.parse::<f64>().ok()? * scale.unwrap_or(1.0);
    (value.is_finite() && (!positive || value > 0.0)).then_some(MetadataValue::Decimal(value))
}

fn calculated_focal_length_evidence(
    calculated: Option<CalculatedFocalLength>,
) -> Result<FieldEvidence, EvidenceError> {
    let Some(calculated) = calculated else {
        return Ok(FieldEvidence::absent(EvidenceConfidence::Calculated));
    };
    let millimetres = calculated.millimetres();
    let normalized = (millimetres.is_finite() && millimetres > 0.0)
        .then_some(MetadataValue::Decimal(millimetres));
    FieldEvidence::from_raw(
        calculated.source().to_owned(),
        millimetres.to_string(),
        normalized,
        EvidenceConfidence::Calculated,
    )
}
