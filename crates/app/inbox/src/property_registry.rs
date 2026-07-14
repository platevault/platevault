// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Typed property registry for the field-agnostic inbox reclassifier (spec 041
//! R-13 / FR-044).
//!
//! Each entry describes a named property that can appear in an inbox item's
//! per-file metadata, be validated by the reclassify use case, and be exposed
//! to the UI via the `inbox.property_registry` contract so the frontend can
//! render a generic, future-proof metadata editor without hard-coding field
//! names.
//!
//! The registry is built once on first call via [`property_registry`] and is
//! cheap to clone (all strings are `&'static str`-backed slices assembled into
//! an owned `Vec` only at call time).
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks

use contracts_core::inbox::{PropertyKind, PropertyRegistryEntry};

/// Return the full property registry as defined in R-13.
///
/// Entries are ordered as they appear in the R-13 table (frameType first,
/// observer* last). The UI SHOULD preserve this order for stable rendering.
#[must_use]
#[allow(clippy::too_many_lines)] // registry is a verbatim data table; splitting degrades readability
pub fn property_registry() -> Vec<PropertyRegistryEntry> {
    vec![
        // ── Classification ────────────────────────────────────────────────────
        PropertyRegistryEntry {
            key: "frameType".to_owned(),
            kind: PropertyKind::Enum,
            unit: None,
            source_headers: vec!["IMAGETYP".to_owned(), "XISF:ImageType".to_owned()],
            overridable: true,
            applies_to: vec![
                "light".to_owned(),
                "dark".to_owned(),
                "bias".to_owned(),
                "flat".to_owned(),
                "dark_flat".to_owned(),
            ],
            validation: Some("one of: light|dark|bias|flat|dark_flat".to_owned()),
        },
        // ── Target / object ───────────────────────────────────────────────────
        PropertyRegistryEntry {
            key: "target".to_owned(),
            kind: PropertyKind::String,
            unit: None,
            source_headers: vec![], // resolved by R-17 coords; OBJECT = hint only
            overridable: true,
            applies_to: vec!["light".to_owned()],
            validation: Some(
                "target_id; resolved by coordinate match or explicit user pick".to_owned(),
            ),
        },
        // ── Filter ────────────────────────────────────────────────────────────
        PropertyRegistryEntry {
            key: "filter".to_owned(),
            kind: PropertyKind::String,
            unit: None,
            source_headers: vec!["FILTER".to_owned()],
            overridable: true,
            applies_to: vec!["light".to_owned(), "flat".to_owned()],
            validation: None,
        },
        // ── Exposure ──────────────────────────────────────────────────────────
        PropertyRegistryEntry {
            key: "exposureS".to_owned(),
            kind: PropertyKind::Number,
            unit: Some("s".to_owned()),
            source_headers: vec!["EXPTIME".to_owned(), "EXPOSURE".to_owned()],
            overridable: true,
            applies_to: vec!["light".to_owned(), "dark".to_owned(), "flat".to_owned()],
            validation: Some("positive finite number".to_owned()),
        },
        // ── Gain ──────────────────────────────────────────────────────────────
        PropertyRegistryEntry {
            key: "gain".to_owned(),
            kind: PropertyKind::NumberOrString,
            unit: None,
            source_headers: vec!["GAIN".to_owned()],
            overridable: true,
            applies_to: vec![
                "light".to_owned(),
                "dark".to_owned(),
                "bias".to_owned(),
                "flat".to_owned(),
                "dark_flat".to_owned(),
            ],
            validation: None,
        },
        // ── Offset / black level ──────────────────────────────────────────────
        PropertyRegistryEntry {
            key: "offset".to_owned(),
            kind: PropertyKind::Integer,
            unit: Some("ADU".to_owned()),
            source_headers: vec!["OFFSET".to_owned(), "BLKLEVEL".to_owned()],
            overridable: true,
            applies_to: vec![
                "light".to_owned(),
                "dark".to_owned(),
                "bias".to_owned(),
                "flat".to_owned(),
                "dark_flat".to_owned(),
            ],
            validation: Some("non-negative integer".to_owned()),
        },
        // ── Sensor temperature ────────────────────────────────────────────────
        PropertyRegistryEntry {
            key: "temperatureC".to_owned(),
            kind: PropertyKind::Number,
            unit: Some("\u{00b0}C".to_owned()), // °C
            source_headers: vec![
                "SET-TEMP".to_owned(),
                "CCD-TEMP".to_owned(),
                "DET-TEMP".to_owned(),
            ],
            overridable: true,
            applies_to: vec!["dark".to_owned(), "bias".to_owned()],
            validation: None,
        },
        // ── Binning ───────────────────────────────────────────────────────────
        PropertyRegistryEntry {
            key: "binning".to_owned(),
            kind: PropertyKind::String,
            unit: None,
            source_headers: vec!["XBINNING".to_owned(), "YBINNING".to_owned()],
            overridable: true,
            applies_to: vec![
                "light".to_owned(),
                "dark".to_owned(),
                "bias".to_owned(),
                "flat".to_owned(),
                "dark_flat".to_owned(),
            ],
            validation: Some("NxN format e.g. 1x1 or 2x2".to_owned()),
        },
        // ── Camera / instrument ───────────────────────────────────────────────
        PropertyRegistryEntry {
            key: "camera".to_owned(),
            kind: PropertyKind::String,
            unit: None,
            source_headers: vec!["INSTRUME".to_owned()],
            overridable: true,
            applies_to: vec![
                "light".to_owned(),
                "dark".to_owned(),
                "bias".to_owned(),
                "flat".to_owned(),
                "dark_flat".to_owned(),
            ],
            validation: None,
        },
        // ── Telescope ─────────────────────────────────────────────────────────
        PropertyRegistryEntry {
            key: "telescope".to_owned(),
            kind: PropertyKind::String,
            unit: None,
            source_headers: vec!["TELESCOP".to_owned()],
            overridable: true,
            applies_to: vec!["light".to_owned(), "flat".to_owned()],
            validation: None,
        },
        // ── Optic train (derived) ─────────────────────────────────────────────
        PropertyRegistryEntry {
            key: "opticTrain".to_owned(),
            kind: PropertyKind::String,
            unit: None,
            // Derived: TELESCOP+INSTRUME(+DWARF CAMERA keyword) or capture keyword
            // or equipment-profile override.
            source_headers: vec!["TELESCOP".to_owned(), "INSTRUME".to_owned(), "CAMERA".to_owned()],
            overridable: true,
            applies_to: vec!["flat".to_owned()],
            validation: None,
        },
        // ── Rotator angle (mechanical, flat-match key) ────────────────────────
        PropertyRegistryEntry {
            key: "rotatorAngleDeg".to_owned(),
            kind: PropertyKind::Number,
            unit: Some("deg".to_owned()),
            source_headers: vec!["ROTATANG".to_owned(), "ROTATOR".to_owned()],
            overridable: true,
            applies_to: vec!["flat".to_owned(), "light".to_owned()],
            validation: None,
        },
        // ── Rotator name (informational device id) ────────────────────────────
        PropertyRegistryEntry {
            key: "rotatorName".to_owned(),
            kind: PropertyKind::String,
            unit: None,
            source_headers: vec!["ROTNAME".to_owned()],
            overridable: false, // informational only
            applies_to: vec![
                "light".to_owned(),
                "dark".to_owned(),
                "bias".to_owned(),
                "flat".to_owned(),
                "dark_flat".to_owned(),
            ],
            validation: None,
        },
        // ── Sky rotation (informational, NOT a flat key — R-18) ───────────────
        PropertyRegistryEntry {
            key: "skyRotationDeg".to_owned(),
            kind: PropertyKind::Number,
            unit: Some("deg".to_owned()),
            source_headers: vec!["OBJCTROT".to_owned()],
            overridable: false, // informational only, NOT a flat match key
            applies_to: vec!["light".to_owned()],
            validation: None,
        },
        // ── Pointing coordinates ──────────────────────────────────────────────
        PropertyRegistryEntry {
            key: "raDeg".to_owned(),
            kind: PropertyKind::Number,
            unit: Some("deg".to_owned()),
            source_headers: vec!["RA".to_owned(), "OBJCTRA".to_owned()],
            overridable: true,
            applies_to: vec!["light".to_owned()],
            validation: Some("0 to 360".to_owned()),
        },
        PropertyRegistryEntry {
            key: "decDeg".to_owned(),
            kind: PropertyKind::Number,
            unit: Some("deg".to_owned()),
            source_headers: vec!["DEC".to_owned(), "OBJCTDEC".to_owned()],
            overridable: true,
            applies_to: vec!["light".to_owned()],
            validation: Some("-90 to 90".to_owned()),
        },
        // ── Readout mode ──────────────────────────────────────────────────────
        PropertyRegistryEntry {
            key: "readoutMode".to_owned(),
            kind: PropertyKind::String,
            unit: None,
            source_headers: vec!["READOUTM".to_owned()],
            overridable: true,
            applies_to: vec![
                "light".to_owned(),
                "dark".to_owned(),
                "bias".to_owned(),
                "flat".to_owned(),
                "dark_flat".to_owned(),
            ],
            // Optional; often deterministic from gain+offset so not always
            // present and not always needed as an override.
            validation: None,
        },
        // ── Focal length ──────────────────────────────────────────────────────
        PropertyRegistryEntry {
            key: "focalLengthMm".to_owned(),
            kind: PropertyKind::Number,
            unit: Some("mm".to_owned()),
            source_headers: vec![
                "FOCALLEN".to_owned(),
                "XISF:Instrument:Telescope:FocalLength".to_owned(),
            ],
            overridable: true,
            applies_to: vec!["light".to_owned(), "flat".to_owned()],
            validation: Some("positive number".to_owned()),
        },
        // ── Observer position ─────────────────────────────────────────────────
        PropertyRegistryEntry {
            key: "observerLat".to_owned(),
            kind: PropertyKind::Number,
            unit: Some("deg".to_owned()),
            source_headers: vec!["SITELAT".to_owned(), "OBSGEO-B".to_owned(), "LAT-OBS".to_owned()],
            overridable: false, // future grouping only, not needed for night-binning
            applies_to: vec!["light".to_owned()],
            validation: Some("-90 to 90".to_owned()),
        },
        PropertyRegistryEntry {
            key: "observerLong".to_owned(),
            kind: PropertyKind::Number,
            unit: Some("deg".to_owned()),
            source_headers: vec![
                "SITELONG".to_owned(),
                "OBSGEO-L".to_owned(),
                "LONG-OBS".to_owned(),
            ],
            overridable: false,
            applies_to: vec!["light".to_owned()],
            validation: Some("-180 to 180".to_owned()),
        },
        PropertyRegistryEntry {
            key: "observerElev".to_owned(),
            kind: PropertyKind::Number,
            unit: Some("m".to_owned()),
            source_headers: vec![
                "SITEELEV".to_owned(),
                "OBSGEO-H".to_owned(),
                "ALT-OBS".to_owned(),
            ],
            overridable: false,
            applies_to: vec!["light".to_owned()],
            validation: None,
        },
        // ── Night / time grouping ─────────────────────────────────────────────
        PropertyRegistryEntry {
            key: "observingNight".to_owned(),
            kind: PropertyKind::Date,
            unit: None,
            // DATE-LOC (local civil date) preferred; fallback: UTC+longitude
            source_headers: vec!["DATE-LOC".to_owned(), "DATE-OBS".to_owned()],
            overridable: false, // derived from obsTimeUtc + site longitude
            applies_to: vec![
                "light".to_owned(),
                "dark".to_owned(),
                "bias".to_owned(),
                "flat".to_owned(),
                "dark_flat".to_owned(),
            ],
            validation: None,
        },
        PropertyRegistryEntry {
            key: "obsTimeUtc".to_owned(),
            kind: PropertyKind::Datetime,
            unit: None,
            // MJD-AVG preferred; fallback chain as per R-13
            source_headers: vec![
                "MJD-AVG".to_owned(),
                "MJD-OBS".to_owned(),
                "DATE-AVG".to_owned(),
                "DATE-OBS".to_owned(),
            ],
            overridable: false, // ordering / dark-run span; not user-editable
            applies_to: vec![
                "light".to_owned(),
                "dark".to_owned(),
                "bias".to_owned(),
                "flat".to_owned(),
                "dark_flat".to_owned(),
            ],
            validation: None,
        },
        PropertyRegistryEntry {
            key: "dateEnd".to_owned(),
            kind: PropertyKind::Datetime,
            unit: None,
            source_headers: vec!["DATE-END".to_owned()],
            overridable: false, // dark-run span heuristic; informational
            applies_to: vec![
                "light".to_owned(),
                "dark".to_owned(),
                "bias".to_owned(),
                "flat".to_owned(),
                "dark_flat".to_owned(),
            ],
            validation: None,
        },
    ]
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_is_non_empty() {
        let reg = property_registry();
        assert!(!reg.is_empty(), "registry must have at least one entry");
    }

    #[test]
    fn all_keys_are_unique() {
        let reg = property_registry();
        let mut seen = std::collections::HashSet::new();
        for entry in &reg {
            assert!(seen.insert(entry.key.clone()), "duplicate key in registry: {}", entry.key);
        }
    }

    #[test]
    fn required_r13_keys_present() {
        let reg = property_registry();
        let keys: std::collections::HashSet<&str> = reg.iter().map(|e| e.key.as_str()).collect();

        for required in &[
            "frameType",
            "target",
            "filter",
            "exposureS",
            "gain",
            "offset",
            "temperatureC",
            "binning",
            "camera",
            "telescope",
            "opticTrain",
            "rotatorAngleDeg",
            "rotatorName",
            "skyRotationDeg",
            "raDeg",
            "decDeg",
            "readoutMode",
            "focalLengthMm",
            "observerLat",
            "observerLong",
            "observerElev",
            "observingNight",
            "obsTimeUtc",
            "dateEnd",
        ] {
            assert!(keys.contains(required), "missing required registry key: {required}");
        }
    }

    #[test]
    fn frame_type_applies_to_all_frame_types() {
        let reg = property_registry();
        let entry = reg.iter().find(|e| e.key == "frameType").unwrap();
        assert!(entry.applies_to.contains(&"light".to_owned()), "frameType must apply to light");
        assert!(entry.applies_to.contains(&"dark".to_owned()), "frameType must apply to dark");
        assert!(entry.applies_to.contains(&"bias".to_owned()), "frameType must apply to bias");
        assert!(entry.applies_to.contains(&"flat".to_owned()), "frameType must apply to flat");
    }

    #[test]
    fn sky_rotation_is_not_overridable() {
        // R-18: skyRotationDeg is informational only and NOT a flat key.
        let reg = property_registry();
        let entry = reg.iter().find(|e| e.key == "skyRotationDeg").unwrap();
        assert!(!entry.overridable, "skyRotationDeg must not be overridable (R-18)");
    }

    #[test]
    fn target_applies_only_to_light() {
        let reg = property_registry();
        let entry = reg.iter().find(|e| e.key == "target").unwrap();
        assert_eq!(entry.applies_to, vec!["light".to_owned()]);
    }
}
