// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Settings > Naming (spec 071 STO-IMP-FR-07): per-frame-type naming templates
//! Import and Archive lay files out with.
//!
//! The token vocabulary, per-type defaults, validator and resolver are the
//! legacy `patterns` crate's, unchanged. A template is validated when it is
//! previewed, again before it is saved and again every time a stored template
//! is resolved, so a row that bypassed the editor can never escape the
//! destination: path traversal and Windows reserved names are refused, names
//! are sanitized and lengths are capped. Only overridden types are stored.

use patterns::{
    default_pattern, resolve_pattern_str, validate_pattern_str, FrameTypeClass, MetadataBundle,
    V1_REGISTRY,
};

use crate::library::Library;
use crate::{
    LibraryError, NamingFallback, NamingFrameType, NamingMetadata, NamingResolution, NamingTemplate,
};

/// Longest template accepted, matching the resolver's relative path cap.
const MAX_TEMPLATE_CHARS: usize = 200;

impl Library {
    /// Every frame type's effective template beside its default.
    ///
    /// # Errors
    /// `PersistenceFailure` when the overrides cannot be read.
    pub async fn naming_templates(&self) -> Result<Vec<NamingTemplate>, LibraryError> {
        let overrides = self.catalog().naming_overrides().await?;
        Ok(NamingFrameType::ALL.map(|class| template_of(class, &overrides)).to_vec())
    }

    /// Validate and save a frame type's template. A template equal to the
    /// type's default removes its override instead of storing it.
    ///
    /// # Errors
    /// `InvalidInput` naming the problem for an empty, overlong or unknown-token
    /// template, path traversal, a reserved name or an unrenderable segment;
    /// nothing is stored. `PersistenceFailure` when the write cannot commit.
    pub async fn save_naming_template(
        &self,
        frame_type: NamingFrameType,
        template: &str,
    ) -> Result<NamingTemplate, LibraryError> {
        let template = template.trim();
        check_template(frame_type, template)?;
        let default_template = default_template(frame_type);
        let stored = (template != default_template).then_some(template);
        self.catalog().set_naming_override(frame_type, stored).await?;
        Ok(NamingTemplate {
            frame_type,
            template: template.to_owned(),
            default_template: default_template.to_owned(),
            overridden: stored.is_some(),
        })
    }

    /// Delete every override and return the per-type defaults.
    ///
    /// # Errors
    /// `PersistenceFailure` when the write cannot commit.
    pub async fn restore_naming_defaults(&self) -> Result<Vec<NamingTemplate>, LibraryError> {
        self.catalog().clear_naming_overrides().await?;
        Ok(NamingFrameType::ALL.map(|class| template_of(class, &[])).to_vec())
    }

    /// Live preview: validate an unsaved template and resolve it against
    /// `sample`, or the frame type's built-in sample, naming every fallback
    /// token used. Stores nothing.
    ///
    /// # Errors
    /// `InvalidInput` naming the problem, as for [`Self::save_naming_template`].
    pub fn preview_naming(
        frame_type: NamingFrameType,
        template: &str,
        sample: Option<NamingMetadata>,
    ) -> Result<NamingResolution, LibraryError> {
        let template = template.trim();
        check_template(frame_type, template)?;
        let sample = sample.unwrap_or_else(|| sample_metadata(frame_type));
        resolve_template(frame_type, template, &sample)
    }

    /// Resolve a frame's relative destination folder from its type's effective
    /// template, validating the stored template again first.
    ///
    /// # Errors
    /// `InvalidInput` when the stored template or a metadata value is refused
    /// (path traversal, reserved name, length cap, unknown token);
    /// `PersistenceFailure` when the overrides cannot be read.
    pub async fn resolve_naming(
        &self,
        frame_type: NamingFrameType,
        metadata: &NamingMetadata,
    ) -> Result<NamingResolution, LibraryError> {
        let overrides = self.catalog().naming_overrides().await?;
        let template = template_of(frame_type, &overrides).template;
        check_template(frame_type, &template)?;
        resolve_template(frame_type, &template, metadata)
    }
}

const fn class_of(frame_type: NamingFrameType) -> FrameTypeClass {
    match frame_type {
        NamingFrameType::Light => FrameTypeClass::Light,
        NamingFrameType::Flat => FrameTypeClass::Flat,
        NamingFrameType::Dark => FrameTypeClass::Dark,
        NamingFrameType::Bias => FrameTypeClass::Bias,
        NamingFrameType::MasterFlat => FrameTypeClass::MasterFlat,
        NamingFrameType::MasterDark => FrameTypeClass::MasterDark,
        NamingFrameType::MasterBias => FrameTypeClass::MasterBias,
    }
}

fn default_template(frame_type: NamingFrameType) -> &'static str {
    default_pattern(class_of(frame_type))
}

fn template_of(
    frame_type: NamingFrameType,
    overrides: &[(NamingFrameType, String)],
) -> NamingTemplate {
    let default_template = default_template(frame_type);
    let stored = overrides.iter().find(|(class, _)| *class == frame_type);
    NamingTemplate {
        frame_type,
        template: stored.map_or(default_template, |(_, template)| template).to_owned(),
        default_template: default_template.to_owned(),
        overridden: stored.is_some(),
    }
}

fn invalid(frame_type: NamingFrameType, problem: impl std::fmt::Display) -> LibraryError {
    LibraryError::InvalidInput(format!("naming template for {}: {problem}", frame_type.as_str()))
}

/// Structural checks on the template alone: non-empty, within the length cap,
/// registered tokens only, and every literal segment renderable with all
/// tokens at their fallbacks (which refuses `.`/`..` and reserved names).
fn check_template(frame_type: NamingFrameType, template: &str) -> Result<(), LibraryError> {
    if template.is_empty() {
        return Err(invalid(frame_type, "template is empty"));
    }
    let chars = template.chars().count();
    if chars > MAX_TEMPLATE_CHARS {
        return Err(invalid(
            frame_type,
            format!("template length {chars} exceeds {MAX_TEMPLATE_CHARS} characters"),
        ));
    }
    validate_pattern_str(template).map_err(|error| invalid(frame_type, error))?;
    resolve_pattern_str(template, &MetadataBundle::new())
        .map_err(|error| invalid(frame_type, error))?;
    Ok(())
}

fn resolve_template(
    frame_type: NamingFrameType,
    template: &str,
    metadata: &NamingMetadata,
) -> Result<NamingResolution, LibraryError> {
    let resolved = resolve_pattern_str(template, &bundle(metadata))
        .map_err(|error| invalid(frame_type, error))?;
    let mut fallbacks: Vec<NamingFallback> = Vec::with_capacity(resolved.missing_tokens.len());
    for token in resolved.missing_tokens {
        if fallbacks.iter().any(|used| used.token == token) {
            continue;
        }
        let value = V1_REGISTRY.get(&token).map(|definition| definition.fallback.to_owned());
        let value = value.ok_or_else(|| invalid(frame_type, format!("unknown token: {token}")))?;
        fallbacks.push(NamingFallback { token, value });
    }
    Ok(NamingResolution {
        template: template.to_owned(),
        relative_path: resolved.relative_path,
        fallbacks,
    })
}

fn bundle(metadata: &NamingMetadata) -> MetadataBundle {
    [
        ("target", &metadata.target),
        ("filter", &metadata.filter),
        ("date", &metadata.date),
        ("frame_type", &metadata.frame_type),
        ("camera", &metadata.camera),
        ("exposure", &metadata.exposure),
        ("gain", &metadata.gain),
        ("binning", &metadata.binning),
        ("set_temp", &metadata.set_temp),
    ]
    .into_iter()
    .filter_map(|(field, value)| Some((field.to_owned(), value.clone()?)))
    .collect()
}

/// Typical metadata of the frame type for a preview without a sample: lights
/// carry a Target and filter, flats a filter only, darks and bias neither.
fn sample_metadata(frame_type: NamingFrameType) -> NamingMetadata {
    let some = |value: &str| Some(value.to_owned());
    let (kind, target, filter, exposure) = match frame_type {
        NamingFrameType::Light => ("light", some("M31"), some("Ha"), "300"),
        NamingFrameType::Flat | NamingFrameType::MasterFlat => ("flat", None, some("Ha"), "2"),
        NamingFrameType::Dark | NamingFrameType::MasterDark => ("dark", None, None, "300"),
        NamingFrameType::Bias | NamingFrameType::MasterBias => ("bias", None, None, "0.001"),
    };
    NamingMetadata {
        target,
        filter,
        date: some("2026-04-12"),
        frame_type: some(kind),
        camera: some("ASI2600MM"),
        exposure: some(exposure),
        gain: some("100"),
        binning: some("1x1"),
        set_temp: some("-10"),
    }
}
