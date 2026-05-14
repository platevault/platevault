use std::{collections::BTreeSet, fs, path::PathBuf};

use contracts_core::{
    ContractError, ErrorSeverity, OperationEvent, OperationEventType, OperationHandle, OperationId,
    OperationName, OperationStatus, RequestEnvelope, RequestId, ResponseEnvelope, ResponseStatus,
};
use serde_json::{json, Value};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(std::path::Path::parent)
        .expect("contract test package should live under tests/contract")
        .to_path_buf()
}

fn envelope_schema() -> Value {
    let path = repo_root().join("packages/contracts/schemas/envelope.schema.json");
    let contents = fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!("failed to read envelope schema at {}: {error}", path.display());
    });

    serde_json::from_str(&contents).expect("envelope schema should be valid JSON")
}

fn generated_typescript() -> String {
    let path = repo_root().join("packages/contracts/src/generated/envelope.d.ts");
    fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!(
            "failed to read generated TypeScript declarations at {}: {error}; run pnpm --filter @astro-plan/contracts build",
            path.display()
        );
    })
}

fn enum_values(schema: &Value, definition_name: &str) -> BTreeSet<String> {
    schema["$defs"][definition_name]["enum"]
        .as_array()
        .unwrap_or_else(|| panic!("{definition_name} should define enum values"))
        .iter()
        .map(|value| {
            value
                .as_str()
                .unwrap_or_else(|| panic!("{definition_name} enum values should be strings"))
                .to_owned()
        })
        .collect()
}

fn serialized_values<T: serde::Serialize>(values: &[T]) -> BTreeSet<String> {
    values
        .iter()
        .map(|value| {
            serde_json::to_value(value)
                .expect("contract enum should serialize")
                .as_str()
                .expect("contract enum should serialize to a string")
                .to_owned()
        })
        .collect()
}

fn assert_object_matches_definition(schema: &Value, definition_name: &str, value: &Value) {
    let object = value
        .as_object()
        .unwrap_or_else(|| panic!("{definition_name} sample should serialize as object"));
    let definition = &schema["$defs"][definition_name];
    let properties = definition["properties"]
        .as_object()
        .unwrap_or_else(|| panic!("{definition_name} should define properties"));
    let required = definition["required"]
        .as_array()
        .unwrap_or_else(|| panic!("{definition_name} should define required keys"));

    for required_key in required {
        let required_key = required_key
            .as_str()
            .unwrap_or_else(|| panic!("{definition_name} required keys should be strings"));
        assert!(
            object.contains_key(required_key),
            "{definition_name} sample is missing required key {required_key}"
        );
    }

    for actual_key in object.keys() {
        assert!(
            properties.contains_key(actual_key),
            "{definition_name} sample has key {actual_key} absent from JSON Schema properties"
        );
    }
}

#[test]
fn rust_enum_serialization_matches_json_schema_enums() {
    let schema = envelope_schema();

    assert_eq!(
        enum_values(&schema, "ErrorSeverity"),
        serialized_values(&[
            ErrorSeverity::Info,
            ErrorSeverity::Warning,
            ErrorSeverity::Blocking,
            ErrorSeverity::Fatal,
        ])
    );
    assert_eq!(
        enum_values(&schema, "OperationStatus"),
        serialized_values(&[
            OperationStatus::Queued,
            OperationStatus::Running,
            OperationStatus::Cancelling,
            OperationStatus::Cancelled,
            OperationStatus::Completed,
            OperationStatus::Failed,
        ])
    );
    assert_eq!(
        enum_values(&schema, "OperationEventType"),
        serialized_values(&[
            OperationEventType::Progress,
            OperationEventType::DiscoveredItemBatch,
            OperationEventType::ExtractedMetadataBatch,
            OperationEventType::FailedFileBatch,
            OperationEventType::CandidateBatch,
            OperationEventType::ObservedArtifactBatch,
            OperationEventType::ItemStarted,
            OperationEventType::ItemApplied,
            OperationEventType::ItemFailed,
            OperationEventType::Warning,
            OperationEventType::Completed,
            OperationEventType::Failed,
            OperationEventType::Custom,
        ])
    );
    assert_eq!(
        BTreeSet::from(["ok".to_owned(), "error".to_owned()]),
        serialized_values(&[ResponseStatus::Ok, ResponseStatus::Error])
    );
}

#[test]
fn rust_envelope_shapes_match_json_schema_properties() {
    let schema = envelope_schema();

    let request = serde_json::to_value(RequestEnvelope::new(
        OperationName("library.scan.start".to_owned()),
        RequestId("req-1".to_owned()),
        json!({ "rootIds": ["root-1"] }),
    ))
    .expect("request envelope should serialize");
    assert_object_matches_definition(&schema, "RequestEnvelope", &request);

    let ok_response =
        serde_json::to_value(ResponseEnvelope::ok(RequestId("req-1".to_owned()), json!({})))
            .expect("ok response envelope should serialize");
    assert_object_matches_definition(&schema, "OkResponseEnvelope", &ok_response);

    let error_response: ResponseEnvelope<Value> = ResponseEnvelope::error(
        RequestId("req-1".to_owned()),
        ContractError::new(
            "filesystem.destination_exists",
            "Destination already exists.",
            ErrorSeverity::Blocking,
            false,
        ),
    );
    let error_response =
        serde_json::to_value(error_response).expect("error response envelope should serialize");
    assert_object_matches_definition(&schema, "ErrorResponseEnvelope", &error_response);

    let handle = serde_json::to_value(OperationHandle::new(
        OperationId("op-1".to_owned()),
        OperationName("library.scan.start".to_owned()),
        OperationStatus::Running,
    ))
    .expect("operation handle should serialize");
    assert_object_matches_definition(&schema, "OperationHandle", &handle);

    let event = serde_json::to_value(OperationEvent::new(
        OperationId("op-1".to_owned()),
        OperationEventType::Progress,
        1,
        json!({ "current": 1, "total": 10 }),
    ))
    .expect("operation event should serialize");
    assert_object_matches_definition(&schema, "OperationEvent", &event);
}

#[test]
fn generated_typescript_exposes_schema_contract_names() {
    let declarations = generated_typescript();

    for expected in [
        "export interface RequestEnvelope",
        "export interface OkResponseEnvelope",
        "export interface ErrorResponseEnvelope",
        "export interface OperationHandle",
        "export interface OperationEvent",
        "export interface ContractError",
        "export type ErrorSeverity = \"info\" | \"warning\" | \"blocking\" | \"fatal\";",
        "export type OperationStatus = \"queued\" | \"running\" | \"cancelling\" | \"cancelled\" | \"completed\" | \"failed\";",
    ] {
        assert!(
            declarations.contains(expected),
            "generated TypeScript declaration missing expected fragment: {expected}"
        );
    }
}
