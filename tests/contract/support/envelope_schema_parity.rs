// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared schema-vs-struct parity checks for `EventEnvelope`-shaped contracts.
//!
//! Included by `#[path]` from each per-contract test binary. Extracted from the
//! first-run guard added in #1016 when #1112 needed the same checks for
//! `workflow.run_completed`.

use std::{collections::BTreeSet, fs, path::PathBuf};

use serde_json::Value;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(std::path::Path::parent)
        .expect("contract test package should live under tests/contract")
        .to_path_buf()
}

/// Load a contract schema by its repo-relative path.
pub fn load_schema(relative_path: &str) -> Value {
    let path = repo_root().join(relative_path);
    let contents = fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!("failed to read schema at {}: {error}", path.display());
    });
    serde_json::from_str(&contents).expect("contract schema should be valid JSON")
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
pub fn assert_keys_agree(schema_node: &Value, value: &Value, path: &str, schema_path: &str) {
    let declared = key_set(&schema_node["properties"], &format!("schema {path}.properties"));
    let emitted = key_set(value, &format!("emitted {path}"));

    assert_eq!(
        declared,
        emitted,
        "CONTRACT DRIFT at `{path}`: the schema's declared properties and the keys the Rust \
         structs actually serialize disagree.\n  schema declares: {declared:?}\n  code emits:      \
         {emitted:?}\n  declared but never emitted: {:?}\n  emitted but undeclared:     {:?}\n\
         Update {schema_path} or the structs in crates/audit-types/src/event_bus.rs so the two \
         agree.",
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
            assert_keys_agree(child_schema, &value[key], &format!("{path}.{key}"), schema_path);
        }
    }
}

/// Run every envelope-level check a `EventEnvelope`-shaped contract must pass:
/// recursive key parity, the `topic` and `contractVersion` consts, the `source`
/// enum, and the RFC 3339 wire form of `emittedAt`.
pub fn assert_envelope_contract(schema_path: &str, topic_const: &str, emitted: &Value) {
    let schema = load_schema(schema_path);

    assert_keys_agree(&schema, emitted, "root", schema_path);

    assert_eq!(
        schema["properties"]["topic"]["const"], topic_const,
        "schema topic const must match the topic constant in audit_types::event_bus"
    );
    assert_eq!(
        schema["properties"]["contractVersion"]["const"], emitted["contractVersion"],
        "schema contractVersion const must match what EventEnvelope::new stamps"
    );

    let admitted: BTreeSet<&str> = schema["properties"]["source"]["enum"]
        .as_array()
        .expect("source should declare an enum")
        .iter()
        .map(|v| v.as_str().expect("enum members should be strings"))
        .collect();
    let emitted_source = emitted["source"].as_str().expect("source should serialize as a string");
    assert!(
        admitted.contains(emitted_source),
        "schema source enum {admitted:?} does not admit the emitted value {emitted_source:?}"
    );

    assert_emitted_at_is_rfc3339(&schema, emitted, schema_path);
}

/// Pin `emittedAt` to RFC 3339 on both sides.
///
/// `Timestamp` serialises via `time::serde::rfc3339` (#1093, fixing the earlier
/// 9-int component array). This fails loudly if that ever regresses, on either
/// the schema side or the struct side.
fn assert_emitted_at_is_rfc3339(schema: &Value, emitted: &Value, schema_path: &str) {
    let declared = &schema["properties"]["emittedAt"];
    assert_eq!(declared["type"], "string", "{schema_path}: emittedAt must be declared a string");
    assert_eq!(
        declared["format"], "date-time",
        "{schema_path}: emittedAt must declare format date-time"
    );

    let value = emitted["emittedAt"].as_str().unwrap_or_else(|| {
        panic!(
            "emittedAt is no longer a string ({}) — Timestamp's serde form regressed away from \
             RFC 3339 (issue #1093)",
            emitted["emittedAt"]
        )
    });
    time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|error| panic!("emittedAt {value:?} does not parse as RFC 3339: {error}"));
}
