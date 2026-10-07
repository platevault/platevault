// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Frame review wire and request-validation contracts (spec 067).

use platevault_core::{
    Drift, ImportFormat, ImportVerification, ImportedValue, LibraryError, MeasurementMethod,
    MetricId, MetricValue, PreambleEntry, RegionsRequest, RowMatch, SampleNumber, SampleRequest,
    Stretch, TileRequest, Units, ValueSource,
};
use uuid::Uuid;

fn refused_naming(result: Result<(), LibraryError>, field: &str) {
    match result {
        Err(LibraryError::InvalidInput(message)) => {
            assert!(message.contains(field), "{message:?} should name {field:?}");
        }
        other => panic!("expected InvalidInput naming {field:?}, got {other:?}"),
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct WireSample {
    #[serde(with = "platevault_core::sample_number")]
    value: f64,
}

#[test]
fn sample_number_writes_non_finite_values_as_strings_and_round_trips_each() {
    let cases = [
        (f64::NAN, serde_json::json!("NaN")),
        (f64::INFINITY, serde_json::json!("Infinity")),
        (f64::NEG_INFINITY, serde_json::json!("-Infinity")),
        (1.5, serde_json::json!(1.5)),
        (-0.25, serde_json::json!(-0.25)),
        (65535.0, serde_json::json!(65535.0)),
    ];
    for (value, wire) in cases {
        let written = serde_json::to_value(WireSample { value }).unwrap();
        assert_eq!(written["value"], wire, "{value}");
        let back: WireSample = serde_json::from_value(written).unwrap();
        if value.is_nan() {
            assert!(back.value.is_nan());
        } else {
            assert_eq!(back.value.to_bits(), value.to_bits());
        }
    }
    let integer: WireSample = serde_json::from_value(serde_json::json!({"value": 7})).unwrap();
    assert_eq!(integer.value.to_bits(), 7.0_f64.to_bits());
    assert!(serde_json::from_value::<WireSample>(serde_json::json!({"value": "nan"})).is_err());
    let numbers = serde_json::to_value([SampleNumber(f64::NAN), SampleNumber(2.0)]).unwrap();
    assert_eq!(numbers, serde_json::json!(["NaN", 2.0]));
}

#[test]
fn stretch_validation_refuses_inverted_non_finite_and_out_of_range_points() {
    let linear = |black, white| Stretch::Linear { black, white }.validate();
    refused_naming(linear(10.0, 10.0), "black");
    refused_naming(linear(20.0, 10.0), "black");
    refused_naming(linear(f64::NAN, 10.0), "black");
    refused_naming(linear(0.0, f64::INFINITY), "white");
    let mtf =
        |shadows, midtones, highlights| Stretch::Mtf { shadows, midtones, highlights }.validate();
    refused_naming(mtf(0.0, 0.0, 1.0), "midtones");
    refused_naming(mtf(0.0, 1.0, 1.0), "midtones");
    refused_naming(mtf(0.0, f64::NAN, 1.0), "midtones");
    refused_naming(mtf(0.5, 0.5, 0.5), "shadows");
    refused_naming(mtf(0.6, 0.5, 0.4), "shadows");
    refused_naming(mtf(-0.1, 0.5, 1.0), "shadows");
    refused_naming(mtf(0.0, 0.5, 1.1), "highlights");
    assert!(linear(0.0, 65535.0).is_ok());
    assert!(mtf(0.0, 0.25, 1.0).is_ok());
    assert!(Stretch::Auto.validate().is_ok());
    let parsed: Stretch = serde_json::from_value(serde_json::json!({
        "kind": "mtf", "shadows": 0.0, "midtones": 0.25, "highlights": 1.0
    }))
    .unwrap();
    assert_eq!(parsed, Stretch::Mtf { shadows: 0.0, midtones: 0.25, highlights: 1.0 });
    assert_eq!(serde_json::to_value(Stretch::Auto).unwrap(), serde_json::json!({"kind": "auto"}));
}

fn tile(width: u32, height: u32, level: u8, stretch: Stretch) -> TileRequest {
    TileRequest {
        asset_id: Uuid::nil(),
        sha256: "ab".repeat(32),
        plane: 0,
        level,
        x: 0,
        y: 0,
        width,
        height,
        stretch,
    }
}

#[test]
fn tile_and_sample_requests_refuse_sizes_and_levels_outside_their_bounds() {
    refused_naming(tile(0, 16, 0, Stretch::Auto).validate(), "width");
    refused_naming(tile(1025, 16, 0, Stretch::Auto).validate(), "width");
    refused_naming(tile(16, 0, 0, Stretch::Auto).validate(), "height");
    refused_naming(tile(16, 1025, 0, Stretch::Auto).validate(), "height");
    refused_naming(tile(16, 16, 9, Stretch::Auto).validate(), "level");
    refused_naming(tile(16, 16, 0, Stretch::Linear { black: 1.0, white: 0.0 }).validate(), "black");
    assert!(tile(1024, 1024, 8, Stretch::Auto).validate().is_ok());
    assert!(tile(1, 1, 0, Stretch::Auto).validate().is_ok());
    let sample = |width, height| SampleRequest {
        asset_id: Uuid::nil(),
        sha256: "ab".repeat(32),
        plane: 0,
        x: 0,
        y: 0,
        width,
        height,
    };
    refused_naming(sample(65, 1).validate(), "width");
    refused_naming(sample(1, 0).validate(), "height");
    assert!(sample(64, 64).validate().is_ok());
    let regions = |size| RegionsRequest {
        asset_id: Uuid::nil(),
        sha256: "ab".repeat(32),
        plane: 0,
        size,
        stretch: Stretch::Auto,
    };
    refused_naming(regions(15).validate(), "size");
    refused_naming(regions(1025).validate(), "size");
    assert!(regions(16).validate().is_ok());
}

#[test]
fn imported_values_serialize_as_unverified_imports_beside_built_in_values() {
    let value = ImportedValue {
        import_id: Uuid::from_u128(1),
        asset_id: Uuid::from_u128(2),
        column: "FWHM".into(),
        position: 4,
        label: "FWHM (SubframeSelector)".into(),
        value: Some(2.5),
        raw: "2.500".into(),
        reason: None,
        units: Some(Units::Arcsec),
        units_basis: vec![PreambleEntry { key: "Scale Unit".into(), value: "arcsec".into() }],
        warnings: vec![],
        source: ValueSource::Imported {
            format: ImportFormat::SubframeSelectorCsv,
            module_version: Some("1.9.3".into()),
            psf_type: Some("Moffat4".into()),
        },
        match_state: RowMatch::MatchedPath,
        verification: ImportVerification::Unverified,
        drift: Drift::Matches,
        imported_at: "2026-10-05T00:00:00Z".into(),
    };
    let wire = serde_json::to_value(&value).unwrap();
    assert_eq!(wire["source"]["kind"], "imported");
    assert_eq!(wire["source"]["format"], "subframe_selector_csv");
    assert_eq!(wire["source"]["moduleVersion"], "1.9.3");
    assert_eq!(wire["source"]["psfType"], "Moffat4");
    assert_eq!(wire["verification"], "unverified");
    assert_eq!(wire["match"], "matched_path");
    assert_eq!(wire["drift"], "matches");
    assert_eq!(wire["units"], "arcsec");
    assert_eq!(wire["unitsBasis"][0]["key"], "Scale Unit");
    let back: ImportedValue = serde_json::from_value(wire).unwrap();
    assert_eq!(back, value);
    let built_in = MetricValue::unavailable(
        MetricId::FwhmMedian,
        Units::Px,
        "no_fitted_stars",
        &MeasurementMethod::new("platevault.stars", 1),
    );
    let wire = serde_json::to_value(&built_in).unwrap();
    assert_eq!(
        wire["source"],
        serde_json::json!({"kind": "built_in", "method": "platevault.stars", "version": 1})
    );
    assert_eq!(wire["label"], "FWHM (Gaussian fit)");
    assert_eq!(wire["value"], serde_json::Value::Null);
    assert_eq!(wire["state"], "unavailable");
    assert_eq!(MetricId::HfrMedian.label(), "HFR (half-flux radius)");
    assert_eq!(serde_json::to_value(Units::Electrons).unwrap(), "e-");
}
