//! Contract parity tests for spec 035 SIMBAD target resolution (T009).
//!
//! Verifies that Rust DTOs in `contracts_core::targets` serialize/deserialize
//! to match the three JSON Schema contracts in
//! `specs/035-simbad-target-resolution/contracts/`:
//! - `target.search.json`
//! - `target.resolve.json`
//! - `target.resolution-settings.json`
//!
//! Parity strategy: structural field-name and enum-value checks against the
//! loaded JSON schema (same approach as `native_contracts_test.rs`), plus
//! round-trip stability assertions.

use std::{collections::BTreeSet, fs, path::PathBuf};

use contracts_core::targets::{
    ResolvedTarget, ResolverSettings, ResolverSettingsGetRequest, ResolverSettingsResponse,
    ResolverSettingsUpdateRequest, TargetCatalogId, TargetObjectType, TargetResolveError,
    TargetResolveErrorCode, TargetResolveOverride, TargetResolveSimbadRequest,
    TargetResolveSimbadResponse, TargetResolveStatus, TargetSearchRequest, TargetSearchResponse,
    TargetSource, TargetSuggestion,
};
use serde_json::{json, Value};

// ── helpers ─────────────────────────────────────────────────────────────────

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(std::path::Path::parent)
        .expect("contract test package should live under tests/contract")
        .to_path_buf()
}

fn load_schema(name: &str) -> Value {
    let path = repo_root().join(format!("specs/035-simbad-target-resolution/contracts/{name}"));
    let contents = fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!("failed to read schema at {}: {error}", path.display());
    });
    serde_json::from_str(&contents).expect("schema should be valid JSON")
}

/// Extract `$defs/<def_name>/enum` values from a schema.
fn def_enum_values(schema: &Value, def_name: &str) -> BTreeSet<String> {
    schema["$defs"][def_name]["enum"]
        .as_array()
        .unwrap_or_else(|| panic!("$defs.{def_name}.enum should be an array"))
        .iter()
        .filter_map(|v| v.as_str().map(String::from))
        .collect()
}

/// Extract `$defs/<def_name>/required` keys from a schema.
fn def_required_keys(schema: &Value, def_name: &str) -> BTreeSet<String> {
    schema["$defs"][def_name]["required"]
        .as_array()
        .unwrap_or_else(|| panic!("$defs.{def_name}.required should be an array"))
        .iter()
        .filter_map(|v| v.as_str().map(String::from))
        .collect()
}

/// Extract `$defs/<def_name>/properties` key set from a schema.
fn def_property_keys(schema: &Value, def_name: &str) -> BTreeSet<String> {
    schema["$defs"][def_name]["properties"]
        .as_object()
        .unwrap_or_else(|| panic!("$defs.{def_name}.properties should be an object"))
        .keys()
        .cloned()
        .collect()
}

/// Serialize all enum variants and collect the wire strings.
fn serialized_enum<T: serde::Serialize>(variants: &[T]) -> BTreeSet<String> {
    variants
        .iter()
        .map(|v| {
            serde_json::to_value(v)
                .expect("enum variant should serialize")
                .as_str()
                .expect("enum variant should serialize to a string")
                .to_owned()
        })
        .collect()
}

/// Return the key set of a serialized object value.
fn object_keys(value: &Value) -> BTreeSet<String> {
    value.as_object().map(|obj| obj.keys().cloned().collect()).unwrap_or_default()
}

// ── TargetObjectType ─────────────────────────────────────────────────────────

#[test]
fn object_type_enum_matches_search_contract() {
    let schema = load_schema("target.search.json");
    let contract = def_enum_values(&schema, "ObjectType");

    let rust = serialized_enum(&[
        TargetObjectType::Galaxy,
        TargetObjectType::PlanetaryNebula,
        TargetObjectType::EmissionNebula,
        TargetObjectType::ReflectionNebula,
        TargetObjectType::DarkNebula,
        TargetObjectType::OpenCluster,
        TargetObjectType::GlobularCluster,
        TargetObjectType::SupernovaRemnant,
        TargetObjectType::GalaxyCluster,
        TargetObjectType::DoubleStar,
        TargetObjectType::Asterism,
        TargetObjectType::Other,
    ]);

    assert_eq!(
        contract, rust,
        "TargetObjectType wire values must match ObjectType enum in target.search.json"
    );
}

#[test]
fn object_type_snake_case_spellings_exact() {
    assert_eq!(serde_json::to_value(TargetObjectType::Galaxy).unwrap(), json!("galaxy"));
    assert_eq!(
        serde_json::to_value(TargetObjectType::PlanetaryNebula).unwrap(),
        json!("planetary_nebula")
    );
    assert_eq!(
        serde_json::to_value(TargetObjectType::EmissionNebula).unwrap(),
        json!("emission_nebula")
    );
    assert_eq!(
        serde_json::to_value(TargetObjectType::ReflectionNebula).unwrap(),
        json!("reflection_nebula")
    );
    assert_eq!(serde_json::to_value(TargetObjectType::DarkNebula).unwrap(), json!("dark_nebula"));
    assert_eq!(serde_json::to_value(TargetObjectType::OpenCluster).unwrap(), json!("open_cluster"));
    assert_eq!(
        serde_json::to_value(TargetObjectType::GlobularCluster).unwrap(),
        json!("globular_cluster")
    );
    assert_eq!(
        serde_json::to_value(TargetObjectType::SupernovaRemnant).unwrap(),
        json!("supernova_remnant")
    );
    assert_eq!(
        serde_json::to_value(TargetObjectType::GalaxyCluster).unwrap(),
        json!("galaxy_cluster")
    );
    assert_eq!(serde_json::to_value(TargetObjectType::DoubleStar).unwrap(), json!("double_star"));
    assert_eq!(serde_json::to_value(TargetObjectType::Asterism).unwrap(), json!("asterism"));
    assert_eq!(serde_json::to_value(TargetObjectType::Other).unwrap(), json!("other"));
}

#[test]
fn object_type_roundtrips() {
    for wire in [
        "galaxy",
        "planetary_nebula",
        "emission_nebula",
        "reflection_nebula",
        "dark_nebula",
        "open_cluster",
        "globular_cluster",
        "supernova_remnant",
        "galaxy_cluster",
        "double_star",
        "asterism",
        "other",
    ] {
        let deserialized: TargetObjectType =
            serde_json::from_value(json!(wire)).unwrap_or_else(|e| {
                panic!("\"{wire}\" should deserialize to TargetObjectType: {e}");
            });
        assert_eq!(serde_json::to_value(deserialized).unwrap(), json!(wire));
    }
}

// ── TargetSource ─────────────────────────────────────────────────────────────

#[test]
fn source_enum_matches_search_contract() {
    let schema = load_schema("target.search.json");
    // `source` is an inline enum on the Suggestion.properties.source field
    let contract = schema["$defs"]["Suggestion"]["properties"]["source"]["enum"]
        .as_array()
        .expect("Suggestion.source.enum should be an array")
        .iter()
        .filter_map(|v| v.as_str().map(String::from))
        .collect::<BTreeSet<_>>();

    let rust =
        serialized_enum(&[TargetSource::Seed, TargetSource::Resolved, TargetSource::UserOverride]);

    assert_eq!(
        contract, rust,
        "TargetSource wire values must match Suggestion.source enum in target.search.json"
    );
}

#[test]
fn source_user_override_has_hyphen() {
    // The hyphen in "user-override" is the critical spelling to verify.
    assert_eq!(serde_json::to_value(TargetSource::Seed).unwrap(), json!("seed"));
    assert_eq!(serde_json::to_value(TargetSource::Resolved).unwrap(), json!("resolved"));
    assert_eq!(serde_json::to_value(TargetSource::UserOverride).unwrap(), json!("user-override"));
}

#[test]
fn source_roundtrips() {
    for wire in ["seed", "resolved", "user-override"] {
        let deserialized: TargetSource = serde_json::from_value(json!(wire)).unwrap_or_else(|e| {
            panic!("\"{wire}\" should deserialize to TargetSource: {e}");
        });
        assert_eq!(serde_json::to_value(deserialized).unwrap(), json!(wire));
    }
}

// ── TargetCatalogId ───────────────────────────────────────────────────────────

#[test]
fn catalog_id_enum_matches_search_contract() {
    let schema = load_schema("target.search.json");
    let contract = def_enum_values(&schema, "CatalogId");

    let rust = serialized_enum(&[
        TargetCatalogId::Messier,
        TargetCatalogId::Caldwell,
        TargetCatalogId::Sharpless,
        TargetCatalogId::AbellPn,
        TargetCatalogId::AbellGalaxies,
        TargetCatalogId::Arp,
        TargetCatalogId::Vdb,
        TargetCatalogId::Barnard,
        TargetCatalogId::Lbn,
        TargetCatalogId::Ldn,
        TargetCatalogId::Melotte,
        TargetCatalogId::Common,
        TargetCatalogId::Openngc,
    ]);

    assert_eq!(
        contract, rust,
        "TargetCatalogId wire values must match CatalogId enum in target.search.json"
    );
}

// ── target.search — TargetSuggestion (Suggestion) ────────────────────────────

#[test]
fn suggestion_required_fields_present() {
    let schema = load_schema("target.search.json");
    let required = def_required_keys(&schema, "Suggestion");

    let suggestion = TargetSuggestion {
        target_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        primary_designation: "M 31".to_owned(),
        common_name: None,
        object_type: TargetObjectType::Galaxy,
        matched_alias: None,
        source: TargetSource::Seed,
    };
    let value = serde_json::to_value(&suggestion).expect("suggestion should serialize");
    let keys = object_keys(&value);

    for required_key in &required {
        assert!(
            keys.contains(required_key),
            "TargetSuggestion missing required key: {required_key}"
        );
    }
}

#[test]
fn suggestion_optional_fields_absent_when_none() {
    let suggestion = TargetSuggestion {
        target_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        primary_designation: "M 31".to_owned(),
        common_name: None,
        object_type: TargetObjectType::Galaxy,
        matched_alias: None,
        source: TargetSource::Seed,
    };
    let value = serde_json::to_value(&suggestion).expect("suggestion should serialize");
    let obj = value.as_object().unwrap();

    assert!(!obj.contains_key("commonName"), "commonName should be absent when None");
    assert!(!obj.contains_key("matchedAlias"), "matchedAlias should be absent when None");
}

#[test]
fn suggestion_optional_fields_present_when_set() {
    let suggestion = TargetSuggestion {
        target_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        primary_designation: "NGC 224".to_owned(),
        common_name: Some("Andromeda Galaxy".to_owned()),
        object_type: TargetObjectType::Galaxy,
        matched_alias: Some("M31".to_owned()),
        source: TargetSource::Resolved,
    };
    let value = serde_json::to_value(&suggestion).expect("suggestion should serialize");
    let obj = value.as_object().unwrap();

    assert_eq!(obj["commonName"], json!("Andromeda Galaxy"));
    assert_eq!(obj["matchedAlias"], json!("M31"));
    assert_eq!(obj["source"], json!("resolved"));
}

#[test]
fn suggestion_no_extra_keys_beyond_contract() {
    let schema = load_schema("target.search.json");
    let allowed = def_property_keys(&schema, "Suggestion");

    let suggestion = TargetSuggestion {
        target_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        primary_designation: "M 31".to_owned(),
        common_name: Some("Andromeda Galaxy".to_owned()),
        object_type: TargetObjectType::Galaxy,
        matched_alias: Some("M31".to_owned()),
        source: TargetSource::UserOverride,
    };
    let value = serde_json::to_value(&suggestion).expect("suggestion should serialize");

    for key in object_keys(&value) {
        assert!(allowed.contains(&key), "TargetSuggestion has unexpected key: {key}");
    }
}

// ── target.search — TargetSearchRequest ──────────────────────────────────────

#[test]
fn search_request_required_fields_present() {
    let schema = load_schema("target.search.json");
    let required = def_required_keys(&schema, "Request");

    let req = TargetSearchRequest {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        query: "M31".to_owned(),
        catalog_filter: vec![],
        type_filter: vec![],
        limit: 20,
    };
    let value = serde_json::to_value(&req).expect("search request should serialize");
    let keys = object_keys(&value);

    for required_key in &required {
        assert!(
            keys.contains(required_key),
            "TargetSearchRequest missing required key: {required_key}"
        );
    }
}

#[test]
fn search_request_empty_filters_absent() {
    let req = TargetSearchRequest {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        query: "NGC 224".to_owned(),
        catalog_filter: vec![],
        type_filter: vec![],
        limit: 20,
    };
    let value = serde_json::to_value(&req).expect("search request should serialize");
    let obj = value.as_object().unwrap();

    // empty Vecs with skip_serializing_if should be absent in wire form
    assert!(!obj.contains_key("catalogFilter"), "catalogFilter should be absent when empty");
    assert!(!obj.contains_key("typeFilter"), "typeFilter should be absent when empty");
}

#[test]
fn search_request_filters_serialize_as_camel_case_arrays() {
    let req = TargetSearchRequest {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        query: "NGC".to_owned(),
        catalog_filter: vec![TargetCatalogId::Messier, TargetCatalogId::Openngc],
        type_filter: vec![TargetObjectType::Galaxy, TargetObjectType::OpenCluster],
        limit: 10,
    };
    let value = serde_json::to_value(&req).expect("search request should serialize");

    assert_eq!(value["catalogFilter"], json!(["messier", "openngc"]));
    assert_eq!(value["typeFilter"], json!(["galaxy", "open_cluster"]));
    assert_eq!(value["limit"], json!(10));
}

#[test]
fn search_request_no_extra_keys_beyond_contract() {
    let schema = load_schema("target.search.json");
    let allowed = def_property_keys(&schema, "Request");

    let req = TargetSearchRequest {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        query: "M31".to_owned(),
        catalog_filter: vec![TargetCatalogId::Messier],
        type_filter: vec![TargetObjectType::Galaxy],
        limit: 5,
    };
    let value = serde_json::to_value(&req).expect("search request should serialize");

    for key in object_keys(&value) {
        assert!(allowed.contains(&key), "TargetSearchRequest has unexpected key: {key}");
    }
}

#[test]
fn search_request_roundtrip() {
    let req = TargetSearchRequest {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        query: "Andromeda".to_owned(),
        catalog_filter: vec![TargetCatalogId::Messier],
        type_filter: vec![TargetObjectType::Galaxy],
        limit: 15,
    };
    let serialized = serde_json::to_value(&req).expect("should serialize");
    let deserialized: TargetSearchRequest =
        serde_json::from_value(serialized.clone()).expect("should deserialize");
    let reserialized = serde_json::to_value(&deserialized).expect("should reserialize");

    assert_eq!(serialized, reserialized, "TargetSearchRequest round-trip must be stable");
}

// ── target.search — TargetSearchResponse ─────────────────────────────────────

#[test]
fn search_response_required_fields_present() {
    let schema = load_schema("target.search.json");
    let required = def_required_keys(&schema, "Response");

    let resp = TargetSearchResponse {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        suggestions: vec![],
    };
    let value = serde_json::to_value(&resp).expect("search response should serialize");
    let keys = object_keys(&value);

    for required_key in &required {
        assert!(
            keys.contains(required_key),
            "TargetSearchResponse missing required key: {required_key}"
        );
    }
}

#[test]
fn search_response_no_extra_keys_beyond_contract() {
    let schema = load_schema("target.search.json");
    let allowed = def_property_keys(&schema, "Response");

    let resp = TargetSearchResponse {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        suggestions: vec![],
    };
    let value = serde_json::to_value(&resp).expect("search response should serialize");

    for key in object_keys(&value) {
        assert!(allowed.contains(&key), "TargetSearchResponse has unexpected key: {key}");
    }
}

// ── target.resolve — TargetResolveStatus ─────────────────────────────────────

#[test]
fn resolve_status_enum_matches_contract() {
    let schema = load_schema("target.resolve.json");
    let contract = def_enum_values(&schema, "ResolveStatus");

    let rust = serialized_enum(&[TargetResolveStatus::Resolved, TargetResolveStatus::Unresolved]);

    assert_eq!(
        contract, rust,
        "TargetResolveStatus wire values must match ResolveStatus enum in target.resolve.json"
    );
}

#[test]
fn resolve_status_spellings_exact() {
    assert_eq!(serde_json::to_value(TargetResolveStatus::Resolved).unwrap(), json!("resolved"));
    assert_eq!(serde_json::to_value(TargetResolveStatus::Unresolved).unwrap(), json!("unresolved"));
}

// ── target.resolve — TargetResolveErrorCode ───────────────────────────────────

#[test]
fn resolve_error_code_enum_matches_contract() {
    let schema = load_schema("target.resolve.json");
    let contract = def_enum_values(&schema, "ErrorCode");

    let rust = serialized_enum(&[
        TargetResolveErrorCode::ResolverUnreachable,
        TargetResolveErrorCode::ResolverDisabled,
        TargetResolveErrorCode::ResolverTimeout,
        TargetResolveErrorCode::ActorNotAuthorised,
    ]);

    assert_eq!(
        contract, rust,
        "TargetResolveErrorCode wire values must match ErrorCode enum in target.resolve.json"
    );
}

#[test]
fn resolve_error_code_dotted_spellings_exact() {
    assert_eq!(
        serde_json::to_value(TargetResolveErrorCode::ResolverUnreachable).unwrap(),
        json!("resolver.unreachable")
    );
    assert_eq!(
        serde_json::to_value(TargetResolveErrorCode::ResolverDisabled).unwrap(),
        json!("resolver.disabled")
    );
    assert_eq!(
        serde_json::to_value(TargetResolveErrorCode::ResolverTimeout).unwrap(),
        json!("resolver.timeout")
    );
    assert_eq!(
        serde_json::to_value(TargetResolveErrorCode::ActorNotAuthorised).unwrap(),
        json!("actor.not_authorised")
    );
}

#[test]
fn resolve_error_code_roundtrips() {
    for wire in
        ["resolver.unreachable", "resolver.disabled", "resolver.timeout", "actor.not_authorised"]
    {
        let deserialized: TargetResolveErrorCode = serde_json::from_value(json!(wire))
            .unwrap_or_else(|e| {
                panic!("\"{wire}\" should deserialize to TargetResolveErrorCode: {e}");
            });
        assert_eq!(serde_json::to_value(deserialized).unwrap(), json!(wire));
    }
}

// ── target.resolve — TargetResolveError (ErrorEnvelope) ──────────────────────

#[test]
fn resolve_error_envelope_required_fields_present() {
    let schema = load_schema("target.resolve.json");
    let required = def_required_keys(&schema, "ErrorEnvelope");

    let err = TargetResolveError {
        code: TargetResolveErrorCode::ResolverDisabled,
        message: "Online resolver is disabled.".to_owned(),
    };
    let value = serde_json::to_value(&err).expect("error envelope should serialize");
    let keys = object_keys(&value);

    for required_key in &required {
        assert!(
            keys.contains(required_key),
            "TargetResolveError missing required key: {required_key}"
        );
    }
}

#[test]
fn resolve_error_envelope_no_extra_keys() {
    let schema = load_schema("target.resolve.json");
    let allowed = def_property_keys(&schema, "ErrorEnvelope");

    let err = TargetResolveError {
        code: TargetResolveErrorCode::ResolverTimeout,
        message: "Timed out.".to_owned(),
    };
    let value = serde_json::to_value(&err).expect("error envelope should serialize");

    for key in object_keys(&value) {
        assert!(allowed.contains(&key), "TargetResolveError has unexpected key: {key}");
    }
}

// ── target.resolve — ResolvedTarget ──────────────────────────────────────────

#[test]
fn resolved_target_required_fields_present() {
    let schema = load_schema("target.resolve.json");
    let required = def_required_keys(&schema, "ResolvedTarget");

    let target = ResolvedTarget {
        target_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        simbad_oid: None,
        primary_designation: "M 31".to_owned(),
        common_name: None,
        object_type: TargetObjectType::Galaxy,
        ra_deg: 10.685,
        dec_deg: 41.269,
        aliases: vec!["NGC 224".to_owned(), "UGC 454".to_owned()],
        source: TargetSource::Resolved,
    };
    let value = serde_json::to_value(&target).expect("resolved target should serialize");
    let keys = object_keys(&value);

    for required_key in &required {
        assert!(keys.contains(required_key), "ResolvedTarget missing required key: {required_key}");
    }
}

#[test]
fn resolved_target_optional_fields_absent_when_none() {
    let target = ResolvedTarget {
        target_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        simbad_oid: None,
        primary_designation: "M 31".to_owned(),
        common_name: None,
        object_type: TargetObjectType::Galaxy,
        ra_deg: 10.685,
        dec_deg: 41.269,
        aliases: vec![],
        source: TargetSource::Seed,
    };
    let value = serde_json::to_value(&target).expect("resolved target should serialize");
    let obj = value.as_object().unwrap();

    assert!(!obj.contains_key("simbadOid"), "simbadOid should be absent when None");
    assert!(!obj.contains_key("commonName"), "commonName should be absent when None");
}

#[test]
fn resolved_target_optional_fields_present_when_set() {
    let target = ResolvedTarget {
        target_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        simbad_oid: Some(1_575_544),
        primary_designation: "M 31".to_owned(),
        common_name: Some("Andromeda Galaxy".to_owned()),
        object_type: TargetObjectType::Galaxy,
        ra_deg: 10.685,
        dec_deg: 41.269,
        aliases: vec!["NGC 224".to_owned()],
        source: TargetSource::Resolved,
    };
    let value = serde_json::to_value(&target).expect("resolved target should serialize");

    assert_eq!(value["simbadOid"], json!(1_575_544));
    assert_eq!(value["commonName"], json!("Andromeda Galaxy"));
    assert_eq!(value["raDeg"], json!(10.685));
    assert_eq!(value["decDeg"], json!(41.269));
    assert_eq!(value["source"], json!("resolved"));
}

#[test]
fn resolved_target_no_extra_keys_beyond_contract() {
    let schema = load_schema("target.resolve.json");
    let allowed = def_property_keys(&schema, "ResolvedTarget");

    let target = ResolvedTarget {
        target_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        simbad_oid: Some(1_575_544),
        primary_designation: "M 31".to_owned(),
        common_name: Some("Andromeda Galaxy".to_owned()),
        object_type: TargetObjectType::Galaxy,
        ra_deg: 10.685,
        dec_deg: 41.269,
        aliases: vec!["NGC 224".to_owned()],
        source: TargetSource::Resolved,
    };
    let value = serde_json::to_value(&target).expect("resolved target should serialize");

    for key in object_keys(&value) {
        assert!(allowed.contains(&key), "ResolvedTarget has unexpected key: {key}");
    }
}

#[test]
fn resolved_target_roundtrip() {
    let target = ResolvedTarget {
        target_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        simbad_oid: Some(1_575_544),
        primary_designation: "M 31".to_owned(),
        common_name: Some("Andromeda Galaxy".to_owned()),
        object_type: TargetObjectType::Galaxy,
        ra_deg: 10.685,
        dec_deg: 41.269,
        aliases: vec!["NGC 224".to_owned(), "UGC 454".to_owned()],
        source: TargetSource::Resolved,
    };
    let serialized = serde_json::to_value(&target).expect("should serialize");
    let deserialized: ResolvedTarget =
        serde_json::from_value(serialized.clone()).expect("should deserialize");
    let reserialized = serde_json::to_value(&deserialized).expect("should reserialize");

    assert_eq!(serialized, reserialized, "ResolvedTarget round-trip must be stable");
}

// ── target.resolve — TargetResolveSimbadRequest ───────────────────────────────

#[test]
fn resolve_request_required_fields_present() {
    let schema = load_schema("target.resolve.json");
    let required = def_required_keys(&schema, "Request");

    let req = TargetResolveSimbadRequest {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        query: "M 31".to_owned(),
        override_target: None,
    };
    let value = serde_json::to_value(&req).expect("resolve request should serialize");
    let keys = object_keys(&value);

    for required_key in &required {
        assert!(
            keys.contains(required_key),
            "TargetResolveSimbadRequest missing required key: {required_key}"
        );
    }
}

#[test]
fn resolve_request_override_absent_when_none() {
    let req = TargetResolveSimbadRequest {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        query: "M 31".to_owned(),
        override_target: None,
    };
    let value = serde_json::to_value(&req).expect("resolve request should serialize");
    let obj = value.as_object().unwrap();

    assert!(!obj.contains_key("override"), "override field should be absent when None");
}

#[test]
fn resolve_request_override_field_uses_contract_name() {
    // The contract field is literally named "override" (a Rust keyword).
    // The DTO uses `#[serde(rename = "override")]`.
    let req = TargetResolveSimbadRequest {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        query: "M 31".to_owned(),
        override_target: Some(TargetResolveOverride {
            target_id: "b2c3d4e5-f6a7-8901-bcde-f01234567890".to_owned(),
        }),
    };
    let value = serde_json::to_value(&req).expect("resolve request with override should serialize");
    let obj = value.as_object().unwrap();

    // Key must be "override", not "overrideTarget" or "override_target".
    assert!(obj.contains_key("override"), "override field must serialize with key \"override\"");
    assert!(!obj.contains_key("overrideTarget"), "overrideTarget must NOT appear (wrong key)");
    assert!(!obj.contains_key("override_target"), "override_target must NOT appear (wrong key)");

    // Inner object must have targetId.
    assert_eq!(value["override"]["targetId"], json!("b2c3d4e5-f6a7-8901-bcde-f01234567890"));
}

#[test]
fn resolve_request_no_extra_keys_beyond_contract() {
    let schema = load_schema("target.resolve.json");
    let allowed = def_property_keys(&schema, "Request");

    // With override set.
    let req = TargetResolveSimbadRequest {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        query: "M 31".to_owned(),
        override_target: Some(TargetResolveOverride {
            target_id: "b2c3d4e5-f6a7-8901-bcde-f01234567890".to_owned(),
        }),
    };
    let value = serde_json::to_value(&req).expect("resolve request should serialize");

    for key in object_keys(&value) {
        assert!(allowed.contains(&key), "TargetResolveSimbadRequest has unexpected key: {key}");
    }
}

#[test]
fn resolve_request_roundtrip() {
    let req = TargetResolveSimbadRequest {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        query: "NGC 7293".to_owned(),
        override_target: Some(TargetResolveOverride {
            target_id: "c3d4e5f6-a7b8-9012-cdef-012345678901".to_owned(),
        }),
    };
    let serialized = serde_json::to_value(&req).expect("should serialize");
    let deserialized: TargetResolveSimbadRequest =
        serde_json::from_value(serialized.clone()).expect("should deserialize");
    let reserialized = serde_json::to_value(&deserialized).expect("should reserialize");

    assert_eq!(serialized, reserialized, "TargetResolveSimbadRequest round-trip must be stable");
}

// ── target.resolve — TargetResolveSimbadResponse ─────────────────────────────

#[test]
fn resolve_response_required_fields_present() {
    let schema = load_schema("target.resolve.json");
    let required = def_required_keys(&schema, "Response");

    let resp = TargetResolveSimbadResponse {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        status: TargetResolveStatus::Resolved,
        target: Some(ResolvedTarget {
            target_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
            simbad_oid: None,
            primary_designation: "M 31".to_owned(),
            common_name: None,
            object_type: TargetObjectType::Galaxy,
            ra_deg: 10.685,
            dec_deg: 41.269,
            aliases: vec![],
            source: TargetSource::Resolved,
        }),
        unresolved_reason: None,
        error: None,
    };
    let value = serde_json::to_value(&resp).expect("resolve response should serialize");
    let keys = object_keys(&value);

    for required_key in &required {
        assert!(
            keys.contains(required_key),
            "TargetResolveSimbadResponse missing required key: {required_key}"
        );
    }
}

#[test]
fn resolve_response_unresolved_shape() {
    let resp = TargetResolveSimbadResponse {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        status: TargetResolveStatus::Unresolved,
        target: None,
        unresolved_reason: Some("unknown".to_owned()),
        error: Some(TargetResolveError {
            code: TargetResolveErrorCode::ResolverDisabled,
            message: "Resolver disabled.".to_owned(),
        }),
    };
    let value = serde_json::to_value(&resp).expect("unresolved response should serialize");

    assert_eq!(value["status"], json!("unresolved"));
    assert_eq!(value["unresolvedReason"], json!("unknown"));
    assert_eq!(value["error"]["code"], json!("resolver.disabled"));
    // target should be absent
    assert!(
        value["target"].is_null() || !value.as_object().unwrap().contains_key("target"),
        "target should be absent when None"
    );
}

#[test]
fn resolve_response_no_extra_keys_beyond_contract() {
    let schema = load_schema("target.resolve.json");
    let allowed = def_property_keys(&schema, "Response");

    let resp = TargetResolveSimbadResponse {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        status: TargetResolveStatus::Unresolved,
        target: None,
        unresolved_reason: Some("offline".to_owned()),
        error: Some(TargetResolveError {
            code: TargetResolveErrorCode::ResolverUnreachable,
            message: "Could not reach SIMBAD.".to_owned(),
        }),
    };
    let value = serde_json::to_value(&resp).expect("resolve response should serialize");

    for key in object_keys(&value) {
        assert!(allowed.contains(&key), "TargetResolveSimbadResponse has unexpected key: {key}");
    }
}

#[test]
fn resolve_response_roundtrip_resolved() {
    let resp = TargetResolveSimbadResponse {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        status: TargetResolveStatus::Resolved,
        target: Some(ResolvedTarget {
            target_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
            simbad_oid: Some(1_575_544),
            primary_designation: "M 31".to_owned(),
            common_name: Some("Andromeda Galaxy".to_owned()),
            object_type: TargetObjectType::Galaxy,
            ra_deg: 10.685,
            dec_deg: 41.269,
            aliases: vec!["NGC 224".to_owned()],
            source: TargetSource::Resolved,
        }),
        unresolved_reason: None,
        error: None,
    };
    let serialized = serde_json::to_value(&resp).expect("should serialize");
    let deserialized: TargetResolveSimbadResponse =
        serde_json::from_value(serialized.clone()).expect("should deserialize");
    let reserialized = serde_json::to_value(&deserialized).expect("should reserialize");

    assert_eq!(
        serialized, reserialized,
        "TargetResolveSimbadResponse (resolved) round-trip must be stable"
    );
}

// ── target.resolution-settings — ResolverSettings ────────────────────────────

#[test]
fn resolver_settings_required_fields_present() {
    let schema = load_schema("target.resolution-settings.json");
    let required = def_required_keys(&schema, "Settings");

    let settings = ResolverSettings {
        online_enabled: true,
        simbad_endpoint: "https://simbad.u-strasbg.fr/simbad/sim-tap/sync".to_owned(),
        debounce_ms: 300,
        request_timeout_secs: 10,
    };
    let value = serde_json::to_value(&settings).expect("resolver settings should serialize");
    let keys = object_keys(&value);

    for required_key in &required {
        assert!(
            keys.contains(required_key),
            "ResolverSettings missing required key: {required_key}"
        );
    }
}

#[test]
fn resolver_settings_field_names_camel_case() {
    let settings = ResolverSettings {
        online_enabled: false,
        simbad_endpoint: "https://simbad.u-strasbg.fr/simbad/sim-tap/sync".to_owned(),
        debounce_ms: 500,
        request_timeout_secs: 15,
    };
    let value = serde_json::to_value(&settings).expect("resolver settings should serialize");

    assert_eq!(value["onlineEnabled"], json!(false));
    assert!(value["simbadEndpoint"].is_string());
    assert_eq!(value["debounceMs"], json!(500));
    assert_eq!(value["requestTimeoutSecs"], json!(15));
}

#[test]
fn resolver_settings_no_extra_keys_beyond_contract() {
    let schema = load_schema("target.resolution-settings.json");
    let allowed = def_property_keys(&schema, "Settings");

    let settings = ResolverSettings {
        online_enabled: true,
        simbad_endpoint: "https://simbad.u-strasbg.fr/simbad/sim-tap/sync".to_owned(),
        debounce_ms: 300,
        request_timeout_secs: 10,
    };
    let value = serde_json::to_value(&settings).expect("resolver settings should serialize");

    for key in object_keys(&value) {
        assert!(allowed.contains(&key), "ResolverSettings has unexpected key: {key}");
    }
}

#[test]
fn resolver_settings_roundtrip() {
    let settings = ResolverSettings {
        online_enabled: true,
        simbad_endpoint: "https://simbad.u-strasbg.fr/simbad/sim-tap/sync".to_owned(),
        debounce_ms: 300,
        request_timeout_secs: 10,
    };
    let serialized = serde_json::to_value(&settings).expect("should serialize");
    let deserialized: ResolverSettings =
        serde_json::from_value(serialized.clone()).expect("should deserialize");
    let reserialized = serde_json::to_value(&deserialized).expect("should reserialize");

    assert_eq!(serialized, reserialized, "ResolverSettings round-trip must be stable");
}

// ── target.resolution-settings — ResolverSettingsGetRequest ──────────────────

#[test]
fn settings_get_request_required_fields_present() {
    let schema = load_schema("target.resolution-settings.json");
    let required = def_required_keys(&schema, "GetRequest");

    let req = ResolverSettingsGetRequest {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        op: "get".to_owned(),
    };
    let value = serde_json::to_value(&req).expect("settings get request should serialize");
    let keys = object_keys(&value);

    for required_key in &required {
        assert!(
            keys.contains(required_key),
            "ResolverSettingsGetRequest missing required key: {required_key}"
        );
    }
}

#[test]
fn settings_get_request_op_is_get() {
    let req = ResolverSettingsGetRequest {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        op: "get".to_owned(),
    };
    let value = serde_json::to_value(&req).expect("settings get request should serialize");

    assert_eq!(value["op"], json!("get"));
    assert_eq!(value["contractVersion"], json!("1.0"));
}

#[test]
fn settings_get_request_no_extra_keys_beyond_contract() {
    let schema = load_schema("target.resolution-settings.json");
    let allowed = def_property_keys(&schema, "GetRequest");

    let req = ResolverSettingsGetRequest {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        op: "get".to_owned(),
    };
    let value = serde_json::to_value(&req).expect("settings get request should serialize");

    for key in object_keys(&value) {
        assert!(allowed.contains(&key), "ResolverSettingsGetRequest has unexpected key: {key}");
    }
}

// ── target.resolution-settings — ResolverSettingsUpdateRequest ───────────────

#[test]
fn settings_update_request_required_fields_present() {
    let schema = load_schema("target.resolution-settings.json");
    let required = def_required_keys(&schema, "UpdateRequest");

    let req = ResolverSettingsUpdateRequest {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        op: "update".to_owned(),
        settings: ResolverSettings {
            online_enabled: false,
            simbad_endpoint: "https://simbad.u-strasbg.fr/simbad/sim-tap/sync".to_owned(),
            debounce_ms: 300,
            request_timeout_secs: 10,
        },
    };
    let value = serde_json::to_value(&req).expect("settings update request should serialize");
    let keys = object_keys(&value);

    for required_key in &required {
        assert!(
            keys.contains(required_key),
            "ResolverSettingsUpdateRequest missing required key: {required_key}"
        );
    }
}

#[test]
fn settings_update_request_op_is_update() {
    let req = ResolverSettingsUpdateRequest {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        op: "update".to_owned(),
        settings: ResolverSettings {
            online_enabled: true,
            simbad_endpoint: "https://simbad.u-strasbg.fr/simbad/sim-tap/sync".to_owned(),
            debounce_ms: 300,
            request_timeout_secs: 10,
        },
    };
    let value = serde_json::to_value(&req).expect("settings update request should serialize");

    assert_eq!(value["op"], json!("update"));
    assert!(value["settings"].is_object());
}

#[test]
fn settings_update_request_no_extra_keys_beyond_contract() {
    let schema = load_schema("target.resolution-settings.json");
    let allowed = def_property_keys(&schema, "UpdateRequest");

    let req = ResolverSettingsUpdateRequest {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        op: "update".to_owned(),
        settings: ResolverSettings {
            online_enabled: true,
            simbad_endpoint: "https://simbad.u-strasbg.fr/simbad/sim-tap/sync".to_owned(),
            debounce_ms: 300,
            request_timeout_secs: 10,
        },
    };
    let value = serde_json::to_value(&req).expect("settings update request should serialize");

    for key in object_keys(&value) {
        assert!(allowed.contains(&key), "ResolverSettingsUpdateRequest has unexpected key: {key}");
    }
}

#[test]
fn settings_update_request_roundtrip() {
    let req = ResolverSettingsUpdateRequest {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        op: "update".to_owned(),
        settings: ResolverSettings {
            online_enabled: false,
            simbad_endpoint: "https://simbad.u-strasbg.fr/simbad/sim-tap/sync".to_owned(),
            debounce_ms: 200,
            request_timeout_secs: 30,
        },
    };
    let serialized = serde_json::to_value(&req).expect("should serialize");
    let deserialized: ResolverSettingsUpdateRequest =
        serde_json::from_value(serialized.clone()).expect("should deserialize");
    let reserialized = serde_json::to_value(&deserialized).expect("should reserialize");

    assert_eq!(serialized, reserialized, "ResolverSettingsUpdateRequest round-trip must be stable");
}

// ── target.resolution-settings — ResolverSettingsResponse ────────────────────

#[test]
fn settings_response_required_fields_present() {
    let schema = load_schema("target.resolution-settings.json");
    let required = def_required_keys(&schema, "Response");

    let resp = ResolverSettingsResponse {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        settings: ResolverSettings {
            online_enabled: true,
            simbad_endpoint: "https://simbad.u-strasbg.fr/simbad/sim-tap/sync".to_owned(),
            debounce_ms: 300,
            request_timeout_secs: 10,
        },
    };
    let value = serde_json::to_value(&resp).expect("settings response should serialize");
    let keys = object_keys(&value);

    for required_key in &required {
        assert!(
            keys.contains(required_key),
            "ResolverSettingsResponse missing required key: {required_key}"
        );
    }
}

#[test]
fn settings_response_no_extra_keys_beyond_contract() {
    let schema = load_schema("target.resolution-settings.json");
    let allowed = def_property_keys(&schema, "Response");

    let resp = ResolverSettingsResponse {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        settings: ResolverSettings {
            online_enabled: true,
            simbad_endpoint: "https://simbad.u-strasbg.fr/simbad/sim-tap/sync".to_owned(),
            debounce_ms: 300,
            request_timeout_secs: 10,
        },
    };
    let value = serde_json::to_value(&resp).expect("settings response should serialize");

    for key in object_keys(&value) {
        assert!(allowed.contains(&key), "ResolverSettingsResponse has unexpected key: {key}");
    }
}

#[test]
fn settings_response_roundtrip() {
    let resp = ResolverSettingsResponse {
        contract_version: "1.0".to_owned(),
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        settings: ResolverSettings {
            online_enabled: true,
            simbad_endpoint: "https://simbad.u-strasbg.fr/simbad/sim-tap/sync".to_owned(),
            debounce_ms: 300,
            request_timeout_secs: 10,
        },
    };
    let serialized = serde_json::to_value(&resp).expect("should serialize");
    let deserialized: ResolverSettingsResponse =
        serde_json::from_value(serialized.clone()).expect("should deserialize");
    let reserialized = serde_json::to_value(&deserialized).expect("should reserialize");

    assert_eq!(serialized, reserialized, "ResolverSettingsResponse round-trip must be stable");
}
