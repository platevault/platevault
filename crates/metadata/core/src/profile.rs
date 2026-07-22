// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

use std::collections::{BTreeMap, HashSet};

use serde::Deserialize;

use crate::{
    CalculatedFocalLength, CanonicalField, CaptureProfileVersion, EvidenceConfidence,
    FieldEvidence, MetadataEvidence, MetadataValue, RawMetadata,
};

const EMBEDDED_PROFILES: &str = include_str!("../data/capture_profiles.toml");

/// Registry parse or validation failure.
#[derive(Debug, thiserror::Error)]
pub enum CaptureProfileError {
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
        let config: RegistryConfig = toml::from_str(source)?;
        validate(&config)?;
        Ok(Self {
            format_version: config.format_version,
            fallback_profile: config.fallback_profile,
            profiles: config.profiles,
        })
    }

    /// Selects a profile and extracts typed field evidence.
    #[must_use]
    pub fn extract(
        &self,
        raw: &RawMetadata,
        calculated_focal_length: Option<CalculatedFocalLength>,
    ) -> MetadataEvidence {
        let profile = self.select_profile(raw);
        let mut fields = profile
            .fields
            .iter()
            .map(|(field, mapping)| (*field, extract_field(raw, mapping)))
            .collect::<BTreeMap<_, _>>();
        fields.insert(
            CanonicalField::FocalLengthCalculated,
            calculated_focal_length_evidence(calculated_focal_length),
        );

        MetadataEvidence {
            profile: CaptureProfileVersion {
                profile_id: profile.id.clone(),
                version: profile.version,
                registry_format_version: self.format_version,
            },
            fields,
        }
    }

    fn select_profile(&self, raw: &RawMetadata) -> &ProfileConfig {
        self.profiles
            .iter()
            .filter(|profile| profile.id != self.fallback_profile && profile.matches(raw))
            .min_by(|left, right| {
                right.priority.cmp(&left.priority).then_with(|| left.id.cmp(&right.id))
            })
            .unwrap_or_else(|| {
                self.profiles
                    .iter()
                    .find(|profile| profile.id == self.fallback_profile)
                    .expect("validated fallback profile must exist")
            })
    }
}

#[derive(Clone, Debug, Deserialize)]
struct RegistryConfig {
    format_version: u32,
    fallback_profile: String,
    profiles: Vec<ProfileConfig>,
}

#[derive(Clone, Debug, Deserialize)]
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
struct FieldMapping {
    confidence: EvidenceConfidence,
    sources: Vec<SourceMapping>,
    #[serde(default)]
    aliases: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Deserialize)]
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

fn extract_field(raw: &RawMetadata, mapping: &FieldMapping) -> FieldEvidence {
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
    FieldEvidence::absent(mapping.confidence)
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

fn calculated_focal_length_evidence(calculated: Option<CalculatedFocalLength>) -> FieldEvidence {
    let Some(calculated) = calculated else {
        return FieldEvidence::absent(EvidenceConfidence::Calculated);
    };
    let normalized = (calculated.millimetres.is_finite() && calculated.millimetres > 0.0)
        .then_some(MetadataValue::Decimal(calculated.millimetres));
    FieldEvidence::from_raw(
        calculated.source,
        calculated.millimetres.to_string(),
        normalized,
        EvidenceConfidence::Calculated,
    )
}
