use std::{fs, path::PathBuf};

use serde_json::{json, Value};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(std::path::Path::parent)
        .expect("contract test package should live under tests/contract")
        .to_path_buf()
}

fn audit_schema() -> Value {
    let path = repo_root()
        .join("specs/003-first-run-source-setup/contracts/audit.first_run.completed.json");
    let contents = fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!("failed to read audit schema at {}: {error}", path.display());
    });
    serde_json::from_str(&contents).expect("audit schema should be valid JSON")
}

/// Build an audit event payload that conforms to the
/// `audit.first_run.completed` contract shape.
///
/// There is no dedicated Rust struct for this event — the audit system uses
/// the generic `AuditLogEntry` with a free-form `serde_json::Value` payload.
/// This test verifies the expected payload structure matches the contract.
fn sample_event() -> Value {
    json!({
        "event": "first_run.completed",
        "version": "1",
        "payload": {
            "completed_at": "2026-05-26T14:30:00Z",
            "source_count_by_kind": {
                "raw": 2,
                "calibration": 1,
                "project": 1,
                "inbox": 0
            }
        }
    })
}

// ── schema structure checks ────────────────────────────────────────────────

#[test]
fn audit_schema_is_valid_json_and_has_expected_title() {
    let schema = audit_schema();
    assert_eq!(
        schema["title"], "audit.first_run.completed",
        "schema title should match event name"
    );
}

#[test]
fn audit_schema_requires_event_version_payload() {
    let schema = audit_schema();
    let required =
        schema["required"].as_array().expect("schema should define required top-level keys");

    let required_strs: Vec<&str> =
        required.iter().map(|v| v.as_str().expect("required items should be strings")).collect();

    assert!(required_strs.contains(&"event"), "schema must require 'event'");
    assert!(required_strs.contains(&"version"), "schema must require 'version'");
    assert!(required_strs.contains(&"payload"), "schema must require 'payload'");
}

// ── event conformance ──────────────────────────────────────────────────────

#[test]
fn event_has_correct_event_name() {
    let event = sample_event();
    assert_eq!(event["event"], json!("first_run.completed"));
}

#[test]
fn event_has_version_string() {
    let event = sample_event();
    assert_eq!(event["version"], json!("1"));
}

#[test]
fn payload_has_completed_at_string() {
    let event = sample_event();
    let payload = &event["payload"];

    assert!(
        payload["completed_at"].is_string(),
        "completed_at must be a JSON string (date-time format)"
    );
}

#[test]
fn payload_has_source_count_by_kind_with_required_keys() {
    let event = sample_event();
    let counts = &event["payload"]["source_count_by_kind"];
    let obj = counts.as_object().expect("source_count_by_kind should be an object");

    // Schema requires "raw" and "project"; "calibration" and "inbox" are
    // optional in the schema but present in a typical event.
    assert!(obj.contains_key("raw"), "must have raw count");
    assert!(obj.contains_key("project"), "must have project count");
}

#[test]
fn payload_source_counts_are_integers() {
    let event = sample_event();
    let counts = &event["payload"]["source_count_by_kind"];

    for kind in ["raw", "calibration", "project", "inbox"] {
        assert!(counts[kind].is_u64(), "source_count_by_kind.{kind} must be an integer");
    }
}

#[test]
fn payload_raw_and_project_counts_are_at_least_one() {
    // The contract specifies minimum: 1 for raw and project.
    let event = sample_event();
    let counts = &event["payload"]["source_count_by_kind"];

    assert!(counts["raw"].as_u64().unwrap() >= 1, "raw count must be >= 1 per contract");
    assert!(counts["project"].as_u64().unwrap() >= 1, "project count must be >= 1 per contract");
}

#[test]
fn event_top_level_keys_match_schema_properties() {
    let schema = audit_schema();
    let event = sample_event();

    let schema_props = schema["properties"].as_object().expect("schema should define properties");
    let event_obj = event.as_object().expect("event should be an object");

    // Every key in the event must be a declared schema property.
    for key in event_obj.keys() {
        assert!(
            schema_props.contains_key(key),
            "event key \"{key}\" is absent from audit schema properties"
        );
    }
}

#[test]
fn payload_keys_match_schema_payload_properties() {
    let schema = audit_schema();
    let event = sample_event();

    let payload_props = schema["properties"]["payload"]["properties"]
        .as_object()
        .expect("schema payload should define properties");
    let payload_obj = event["payload"].as_object().expect("event payload should be an object");

    for key in payload_obj.keys() {
        assert!(
            payload_props.contains_key(key),
            "payload key \"{key}\" is absent from audit schema payload properties"
        );
    }

    // Verify the schema's required payload keys are present.
    let required = schema["properties"]["payload"]["required"]
        .as_array()
        .expect("schema payload should define required keys");

    for req_key in required {
        let req_key = req_key.as_str().unwrap();
        assert!(
            payload_obj.contains_key(req_key),
            "required payload key \"{req_key}\" is missing from event"
        );
    }
}
