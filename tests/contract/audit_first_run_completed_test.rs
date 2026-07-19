// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Contract checks for `specs/003-first-run-source-setup/contracts/audit.first_run.completed.json`.
//!
//! The schema is pinned against the *real* producer — a serialized
//! `EventEnvelope<FirstRunCompleted>` from `audit_types` — so a field rename,
//! a `serde(rename_all)` change, or an envelope reshape fails here instead of
//! silently drifting. Issue #1016: the schema had accumulated three drifts
//! (`raw` -> `light_frames` from spec 030, `snake_case` vs the struct's
//! `camelCase`, and a `{event, version, payload}` envelope that no code ever
//! constructed) precisely because nothing compared it to the structs.

use std::{collections::BTreeSet, fs, path::PathBuf};

use audit_types::event_bus::{
    EventEnvelope, FirstRunCompleted, Source, SourceCountByKind, TOPIC_FIRST_RUN_COMPLETED,
};
use serde_json::Value;

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

/// Serialize the event exactly as `EventBus::publish` does: the payload is
/// converted to a `Value` and wrapped in an envelope, so the JSON below is
/// byte-for-byte what subscribers receive and what lands in the durable
/// `events` row's `payload` column.
fn emitted_event() -> Value {
    let envelope = EventEnvelope::new(
        TOPIC_FIRST_RUN_COMPLETED,
        Source::User,
        FirstRunCompleted {
            completed_at: "2026-05-26T14:30:00Z".to_owned(),
            source_count_by_kind: SourceCountByKind {
                light_frames: 2,
                calibration: 1,
                project: 1,
                inbox: 0,
            },
        },
    );
    serde_json::to_value(&envelope).expect("event envelope should serialize")
}

fn key_set(value: &Value, what: &str) -> BTreeSet<String> {
    value
        .as_object()
        .unwrap_or_else(|| panic!("{what} should be a JSON object, got: {value}"))
        .keys()
        .cloned()
        .collect()
}

/// Assert that a schema object node and a serialized value declare exactly the
/// same keys, then recurse into every nested object.
///
/// Exact equality (not subset) is the point: serde emits every non-`Option`
/// field unconditionally, so any declared-but-unemitted or emitted-but-
/// undeclared key is drift.
fn assert_keys_agree(schema_node: &Value, value: &Value, path: &str) {
    let declared = key_set(&schema_node["properties"], &format!("schema {path}.properties"));
    let emitted = key_set(value, &format!("emitted {path}"));

    assert_eq!(
        declared,
        emitted,
        "CONTRACT DRIFT at `{path}`: the schema's declared properties and the keys the Rust \
         structs actually serialize disagree.\n  schema declares: {declared:?}\n  code emits:      \
         {emitted:?}\n  declared but never emitted: {:?}\n  emitted but undeclared:     {:?}\n\
         Update specs/003-first-run-source-setup/contracts/audit.first_run.completed.json or the \
         structs in crates/audit-types/src/event_bus.rs so the two agree.",
        declared.difference(&emitted).collect::<Vec<_>>(),
        emitted.difference(&declared).collect::<Vec<_>>(),
    );

    let required: BTreeSet<String> = schema_node["required"]
        .as_array()
        .unwrap_or_else(|| panic!("schema {path} should define a required list"))
        .iter()
        .map(|v| v.as_str().expect("required items should be strings").to_owned())
        .collect();
    assert_eq!(
        required, emitted,
        "schema `{path}` required set must list every key the code emits (no field is optional)"
    );

    assert_eq!(
        schema_node["additionalProperties"], false,
        "schema `{path}` must set additionalProperties:false — otherwise the key agreement above \
         is documentation, not an enforced contract"
    );

    for (key, child_schema) in
        schema_node["properties"].as_object().expect("checked by key_set above")
    {
        if child_schema.get("properties").is_some() {
            assert_keys_agree(child_schema, &value[key], &format!("{path}.{key}"));
        }
    }
}

// ── schema ↔ struct agreement (the anti-drift guard, #1016) ────────────────

#[test]
fn schema_keys_agree_with_serialized_event_at_every_level() {
    assert_keys_agree(&audit_schema(), &emitted_event(), "root");
}

#[test]
fn schema_topic_const_matches_the_real_topic_constant() {
    let schema = audit_schema();
    assert_eq!(
        schema["properties"]["topic"]["const"], TOPIC_FIRST_RUN_COMPLETED,
        "schema topic const must match audit_types::event_bus::TOPIC_FIRST_RUN_COMPLETED"
    );
}

#[test]
fn schema_contract_version_const_matches_the_emitted_envelope() {
    let schema = audit_schema();
    assert_eq!(
        schema["properties"]["contractVersion"]["const"],
        emitted_event()["contractVersion"],
        "schema contractVersion const must match what EventEnvelope::new stamps"
    );
}

#[test]
fn schema_source_enum_admits_the_emitted_source() {
    let schema = audit_schema();
    let admitted: BTreeSet<&str> = schema["properties"]["source"]["enum"]
        .as_array()
        .expect("source should declare an enum")
        .iter()
        .map(|v| v.as_str().expect("enum members should be strings"))
        .collect();

    let emitted = emitted_event();
    let emitted_source = emitted["source"].as_str().expect("source should serialize as a string");
    assert!(
        admitted.contains(emitted_source),
        "schema source enum {admitted:?} does not admit the emitted value {emitted_source:?}"
    );
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
fn audit_schema_completed_at_is_a_date_time_string() {
    let schema = audit_schema();
    let field = &schema["properties"]["payload"]["properties"]["completedAt"];

    assert_eq!(field["type"], "string", "completedAt must be typed as a string");
    assert_eq!(field["format"], "date-time", "completedAt must use date-time format");
}

#[test]
fn audit_schema_emitted_at_matches_the_timestamp_wire_form() {
    // `Timestamp` is transparent over `time::OffsetDateTime`, whose default
    // serde impl is a 9-int component array rather than RFC 3339 (issue
    // #1093). The schema documents that as-is; this pins it so that fixing
    // `Timestamp` fails here and forces the schema to be updated with it,
    // rather than silently re-drifting.
    let schema = audit_schema();
    let declared = &schema["properties"]["emittedAt"];
    let emitted = emitted_event();
    let emitted_at = emitted["emittedAt"].as_array().unwrap_or_else(|| {
        panic!(
            "emittedAt is no longer an array ({}) — Timestamp's serde form changed; update \
                 the schema's emittedAt property to match (issue #1093)",
            emitted["emittedAt"]
        )
    });

    assert_eq!(declared["type"], "array", "schema must declare emittedAt as an array");
    assert_eq!(
        declared["minItems"].as_u64(),
        Some(emitted_at.len() as u64),
        "schema emittedAt length must match the {} components actually emitted",
        emitted_at.len()
    );
    assert_eq!(declared["minItems"], declared["maxItems"], "emittedAt is a fixed-length tuple");
    assert!(
        emitted_at.iter().all(serde_json::Value::is_i64),
        "every emittedAt component should be an integer, got {emitted_at:?}"
    );
}

#[test]
fn audit_schema_source_count_by_kind_fields_are_typed_as_integers() {
    let schema = audit_schema();
    let props = schema["properties"]["payload"]["properties"]["sourceCountByKind"]["properties"]
        .as_object()
        .expect("sourceCountByKind should define properties");

    assert!(!props.is_empty(), "sourceCountByKind should declare at least one field");
    for (kind, field) in props {
        assert_eq!(field["type"], "integer", "sourceCountByKind.{kind} must be typed integer");
    }
}

#[test]
fn audit_schema_light_frames_and_project_have_minimum_one() {
    // `complete_first_run` refuses to complete without at least one
    // light-frame and one project source (crates/persistence/db/src/
    // repositories/first_run.rs), so these counts can never be zero.
    let schema = audit_schema();
    let props = &schema["properties"]["payload"]["properties"]["sourceCountByKind"]["properties"];

    assert_eq!(props["lightFrames"]["minimum"], 1, "lightFrames minimum must be 1 per contract");
    assert_eq!(props["project"]["minimum"], 1, "project count minimum must be 1 per contract");
}
