//! Contract conformance tests for spec 004 native filesystem controls.
//!
//! Verifies that Rust DTOs serialize/deserialize to match the JSON Schema
//! contracts at `specs/004-native-filesystem-controls/contracts/`.

use std::{collections::BTreeSet, fs, path::PathBuf};

use contracts_core::native::{
    DirectoryPickRequest, DirectoryPickResponse, EntityKind, FileFilter, FilePickRequest,
    FilePickResponse, RevealRequest, RevealResponse, RevealSelection,
};
use serde_json::{json, Value};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(std::path::Path::parent)
        .expect("contract test package should live under tests/contract")
        .to_path_buf()
}

fn load_schema(name: &str) -> Value {
    let path = repo_root().join(format!("specs/004-native-filesystem-controls/contracts/{name}"));
    let contents = fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!("failed to read schema at {}: {error}", path.display());
    });
    serde_json::from_str(&contents).expect("schema should be valid JSON")
}

fn schema_required_keys(schema: &Value, section: &str) -> BTreeSet<String> {
    schema["properties"][section]["required"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|v| v.as_str().map(String::from))
        .collect()
}

fn schema_property_keys(schema: &Value, section: &str) -> BTreeSet<String> {
    schema["properties"][section]["properties"]
        .as_object()
        .map(|obj| obj.keys().cloned().collect())
        .unwrap_or_default()
}

fn object_keys(value: &Value) -> BTreeSet<String> {
    value.as_object().map(|obj| obj.keys().cloned().collect()).unwrap_or_default()
}

fn schema_enum_values(schema: &Value, path: &[&str]) -> BTreeSet<String> {
    let mut current = schema;
    for segment in path {
        current = &current[*segment];
    }
    current["enum"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|v| v.as_str().map(String::from))
        .collect()
}

// ── native.directory.pick ───────────────────────────────────────────────────

#[test]
fn directory_pick_request_has_all_required_keys() {
    let schema = load_schema("native.directory.pick.json");
    let required = schema_required_keys(&schema, "request");

    let req = DirectoryPickRequest {
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        default_path: Some("/astro/raw".to_owned()),
    };
    let value = serde_json::to_value(&req).unwrap();
    let keys = object_keys(&value);

    // requestId is in the contract as "requestId" (camelCase).
    for required_key in &required {
        if required_key == "contractVersion" {
            continue; // Envelope-level field, not in DTO.
        }
        assert!(
            keys.contains(required_key),
            "DirectoryPickRequest missing required key: {required_key}"
        );
    }
}

#[test]
fn directory_pick_request_has_no_extra_keys() {
    let schema = load_schema("native.directory.pick.json");
    let allowed = schema_property_keys(&schema, "request");

    let req = DirectoryPickRequest {
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        default_path: Some("/astro/raw".to_owned()),
    };
    let value = serde_json::to_value(&req).unwrap();

    for key in object_keys(&value) {
        assert!(allowed.contains(&key), "DirectoryPickRequest has unexpected key: {key}");
    }
}

#[test]
fn directory_pick_response_cancelled_matches_contract() {
    let resp = DirectoryPickResponse { path: None, cancelled: true };
    let value = serde_json::to_value(&resp).unwrap();

    assert_eq!(value["path"], json!(null));
    assert_eq!(value["cancelled"], json!(true));
}

#[test]
fn directory_pick_response_selected_matches_contract() {
    let resp = DirectoryPickResponse { path: Some("/astro/raw".to_owned()), cancelled: false };
    let value = serde_json::to_value(&resp).unwrap();

    assert!(value["path"].is_string());
    assert_eq!(value["cancelled"], json!(false));
}

// ── native.file.pick ────────────────────────────────────────────────────────

#[test]
fn file_pick_request_has_all_required_keys() {
    let schema = load_schema("native.file.pick.json");
    let required = schema_required_keys(&schema, "request");

    let req = FilePickRequest {
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        filters: vec![FileFilter {
            name: "FITS files".to_owned(),
            extensions: vec!["fits".to_owned(), "fit".to_owned()],
        }],
        default_path: None,
    };
    let value = serde_json::to_value(&req).unwrap();
    let keys = object_keys(&value);

    for required_key in &required {
        if required_key == "contractVersion" {
            continue; // Envelope-level field.
        }
        assert!(
            keys.contains(required_key),
            "FilePickRequest missing required key: {required_key}"
        );
    }
}

#[test]
fn file_filter_shape_matches_contract() {
    let filter = FileFilter {
        name: "FITS files".to_owned(),
        extensions: vec!["fits".to_owned(), "fit".to_owned()],
    };
    let value = serde_json::to_value(&filter).unwrap();

    // Contract requires: name (string), extensions (array of strings).
    assert!(value["name"].is_string());
    assert!(value["extensions"].is_array());
    for ext in value["extensions"].as_array().unwrap() {
        assert!(ext.is_string(), "each extension should be a string");
    }
}

#[test]
fn file_pick_response_cancelled_matches_contract() {
    let resp = FilePickResponse { path: None, selected_filter: None, cancelled: true };
    let value = serde_json::to_value(&resp).unwrap();

    assert_eq!(value["path"], json!(null));
    assert_eq!(value["cancelled"], json!(true));
}

#[test]
fn file_pick_response_selected_matches_contract() {
    let resp = FilePickResponse {
        path: Some("/astro/darks/master_dark.fits".to_owned()),
        selected_filter: Some("FITS files".to_owned()),
        cancelled: false,
    };
    let value = serde_json::to_value(&resp).unwrap();

    assert!(value["path"].is_string());
    assert_eq!(value["selectedFilter"], json!("FITS files"));
    assert_eq!(value["cancelled"], json!(false));
}

// ── File pick error codes ───────────────────────────────────────────────────

#[test]
fn file_pick_error_codes_match_contract_enum() {
    let schema = load_schema("native.file.pick.json");
    let contract_codes = schema_enum_values(&schema, &["$defs", "Error", "properties", "code"]);

    // Verify all contract error codes are defined as constants.
    let rust_codes: BTreeSet<String> = [
        contracts_core::native::error_codes::PICKER_UNAVAILABLE,
        contracts_core::native::error_codes::FILTERS_INVALID,
        contracts_core::native::error_codes::OS_COMMAND_FAILED,
    ]
    .iter()
    .map(|s| (*s).to_owned())
    .collect();

    assert_eq!(
        contract_codes, rust_codes,
        "Rust error codes must match native.file.pick.json Error enum"
    );
}

// ── native.reveal ───────────────────────────────────────────────────────────

#[test]
fn reveal_request_has_all_required_keys() {
    let schema = load_schema("native.reveal.json");
    let required = schema_required_keys(&schema, "request");

    let req = RevealRequest {
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        path: "/astro/raw/M31/light_001.fits".to_owned(),
        entity_kind: Some(EntityKind::InventoryRow),
        entity_id: Some("inv-42".to_owned()),
    };
    let value = serde_json::to_value(&req).unwrap();
    let keys = object_keys(&value);

    for required_key in &required {
        if required_key == "contractVersion" {
            continue; // Envelope-level field.
        }
        assert!(keys.contains(required_key), "RevealRequest missing required key: {required_key}");
    }
}

#[test]
fn reveal_request_has_no_extra_keys() {
    let schema = load_schema("native.reveal.json");
    let allowed = schema_property_keys(&schema, "request");

    let req = RevealRequest {
        request_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_owned(),
        path: "/astro/raw".to_owned(),
        entity_kind: Some(EntityKind::Other),
        entity_id: Some("other-1".to_owned()),
    };
    let value = serde_json::to_value(&req).unwrap();

    for key in object_keys(&value) {
        assert!(allowed.contains(&key), "RevealRequest has unexpected key: {key}");
    }
}

#[test]
fn entity_kind_values_match_contract_enum() {
    let schema = load_schema("native.reveal.json");
    let contract_values =
        schema_enum_values(&schema, &["properties", "request", "properties", "entityKind"]);

    let rust_values: BTreeSet<String> = [
        EntityKind::InboxItem,
        EntityKind::InventoryRow,
        EntityKind::ProjectManifest,
        EntityKind::MasterCalibration,
        EntityKind::RegisteredSource,
        EntityKind::Other,
    ]
    .iter()
    .map(|v| serde_json::to_value(v).unwrap().as_str().unwrap().to_owned())
    .collect();

    assert_eq!(
        contract_values, rust_values,
        "Rust EntityKind variants must match native.reveal.json entityKind enum"
    );
}

#[test]
fn reveal_selection_values_match_contract_enum() {
    let schema = load_schema("native.reveal.json");

    // Find the selection enum in the success response.
    let success_response = &schema["properties"]["response"]["oneOf"][0];
    let contract_values: BTreeSet<String> = success_response["properties"]["selection"]["enum"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|v| v.as_str().map(String::from))
        .collect();

    let rust_values: BTreeSet<String> =
        [RevealSelection::Target, RevealSelection::DirectoryOnly, RevealSelection::None]
            .iter()
            .map(|v| serde_json::to_value(v).unwrap().as_str().unwrap().to_owned())
            .collect();

    assert_eq!(
        contract_values, rust_values,
        "Rust RevealSelection variants must match native.reveal.json selection enum"
    );
}

#[test]
fn reveal_response_success_matches_contract() {
    let resp = RevealResponse { revealed: true, selection: RevealSelection::Target };
    let value = serde_json::to_value(&resp).unwrap();

    assert_eq!(value["revealed"], json!(true));
    assert_eq!(value["selection"], json!("target"));
}

#[test]
fn reveal_response_directory_only_matches_contract() {
    let resp = RevealResponse { revealed: true, selection: RevealSelection::DirectoryOnly };
    let value = serde_json::to_value(&resp).unwrap();

    assert_eq!(value["selection"], json!("directory_only"));
}

#[test]
fn reveal_error_codes_match_contract_enum() {
    let schema = load_schema("native.reveal.json");
    let contract_codes = schema_enum_values(&schema, &["$defs", "Error", "properties", "code"]);

    let rust_codes: BTreeSet<String> = [
        contracts_core::native::error_codes::PATH_NOT_EXISTS,
        contracts_core::native::error_codes::OS_COMMAND_FAILED,
    ]
    .iter()
    .map(|s| (*s).to_owned())
    .collect();

    assert_eq!(
        contract_codes, rust_codes,
        "Rust error codes must match native.reveal.json Error enum"
    );
}

#[test]
fn directory_pick_error_codes_match_contract_enum() {
    let schema = load_schema("native.directory.pick.json");
    let contract_codes = schema_enum_values(&schema, &["$defs", "Error", "properties", "code"]);

    let rust_codes: BTreeSet<String> = [
        contracts_core::native::error_codes::PICKER_UNAVAILABLE,
        contracts_core::native::error_codes::OS_COMMAND_FAILED,
    ]
    .iter()
    .map(|s| (*s).to_owned())
    .collect();

    assert_eq!(
        contract_codes, rust_codes,
        "Rust error codes must match native.directory.pick.json Error enum"
    );
}
