use contracts_core::first_run::{
    RegisterSourceRequest, RegisterSourceResponse, ScanDepth, SourceKind,
};
use serde_json::json;

// ── helpers ────────────────────────────────────────────────────────────────

fn sample_request() -> RegisterSourceRequest {
    RegisterSourceRequest {
        kind: SourceKind::LightFrames,
        path: "/astro/lights".to_owned(),
        kind_subtype: None,
        scan_depth: ScanDepth::Recursive,
    }
}

fn sample_request_with_subtype() -> RegisterSourceRequest {
    RegisterSourceRequest {
        kind: SourceKind::Dark,
        path: "/astro/darks".to_owned(),
        kind_subtype: Some("dark".to_owned()),
        scan_depth: ScanDepth::Single,
    }
}

fn sample_response() -> RegisterSourceResponse {
    RegisterSourceResponse {
        source_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        kind: SourceKind::LightFrames,
        path: "/astro/lights".to_owned(),
        created_at: "2026-05-26T12:00:00Z".to_owned(),
    }
}

// ── roots.register request ─────────────────────────────────────────────────

#[test]
fn request_serializes_required_fields_as_camel_case() {
    let value = serde_json::to_value(sample_request()).expect("request should serialize");
    let obj = value.as_object().expect("request should be an object");

    assert_eq!(obj["kind"], json!("light_frames"));
    assert!(obj["path"].is_string());
    assert_eq!(obj["scanDepth"], json!("recursive"));

    assert!(!obj.contains_key("kindSubtype"), "kindSubtype should be absent when None");
}

#[test]
fn request_with_kind_subtype_includes_field() {
    let value =
        serde_json::to_value(sample_request_with_subtype()).expect("request should serialize");
    let obj = value.as_object().expect("request should be an object");

    assert_eq!(obj["kindSubtype"], json!("dark"));
    assert_eq!(obj["scanDepth"], json!("single"));
}

// ── SourceKind enum ────────────────────────────────────────────────────────

#[test]
fn source_kind_variants_match_contract_enum() {
    let expected = [
        (SourceKind::LightFrames, "light_frames"),
        (SourceKind::Dark, "dark"),
        (SourceKind::Flat, "flat"),
        (SourceKind::Bias, "bias"),
        (SourceKind::Project, "project"),
        (SourceKind::Inbox, "inbox"),
    ];

    for (variant, expected_str) in expected {
        assert_eq!(
            serde_json::to_value(variant).unwrap(),
            json!(expected_str),
            "SourceKind::{variant:?} should serialize to \"{expected_str}\""
        );
    }
}

#[test]
fn source_kind_roundtrips_from_json() {
    for variant_str in ["light_frames", "dark", "flat", "bias", "project", "inbox"] {
        let deserialized: SourceKind =
            serde_json::from_value(json!(variant_str)).unwrap_or_else(|e| {
                panic!("\"{variant_str}\" should deserialize to SourceKind: {e}");
            });
        let reserialized = serde_json::to_value(deserialized).unwrap();
        assert_eq!(reserialized, json!(variant_str));
    }
}

// ── ScanDepth enum ─────────────────────────────────────────────────────────

#[test]
fn scan_depth_variants_match_contract_enum() {
    assert_eq!(serde_json::to_value(ScanDepth::Recursive).unwrap(), json!("recursive"));
    assert_eq!(serde_json::to_value(ScanDepth::Single).unwrap(), json!("single"));
}

// ── roots.register success response ────────────────────────────────────────

#[test]
fn response_serializes_required_fields_as_camel_case() {
    let value = serde_json::to_value(sample_response()).expect("response should serialize");
    let obj = value.as_object().expect("response should be an object");

    assert!(obj.contains_key("sourceId"), "response must have sourceId");
    assert!(obj.contains_key("kind"), "response must have kind");
    assert!(obj.contains_key("path"), "response must have path");
    assert!(obj.contains_key("createdAt"), "response must have createdAt");

    assert_eq!(obj["sourceId"], json!("a1b2c3d4-e5f6-7890-abcd-ef1234567890"));
    assert_eq!(obj["kind"], json!("light_frames"));
    assert_eq!(obj["path"], json!("/astro/lights"));
    assert_eq!(obj["createdAt"], json!("2026-05-26T12:00:00Z"));
}

#[test]
fn response_created_at_is_string_for_iso8601() {
    let value = serde_json::to_value(sample_response()).unwrap();

    assert!(
        value["createdAt"].is_string(),
        "createdAt must serialize as a JSON string (date-time format)"
    );
}

#[test]
fn response_has_no_extra_keys_beyond_contract() {
    let value = serde_json::to_value(sample_response()).unwrap();
    let obj = value.as_object().unwrap();

    let allowed: std::collections::BTreeSet<&str> =
        ["sourceId", "kind", "path", "createdAt"].into_iter().collect();

    for key in obj.keys() {
        assert!(
            allowed.contains(key.as_str()),
            "unexpected key \"{key}\" in RegisterSourceResponse"
        );
    }
}
