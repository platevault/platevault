// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Contract checks for `specs/003-first-run-source-setup/contracts/audit.first_run.completed.json`.
//!
//! Scope limitation: `tests/contract` does not depend on `audit_types`,
//! which owns the real `FirstRunCompleted` / `SourceCountByKind` structs and
//! `TOPIC_FIRST_RUN_COMPLETED` (crates/audit-types/src/event_bus.rs). Without
//! that dev-dependency this file cannot serialize the actual payload and
//! diff it against the schema below — the previous version of this file
//! worked around that gap by hand-authoring a fixture JSON blob and then
//! asserting the fixture matched itself, which is tautological and was
//! flagged by the C2-audit-firstrun test-validity audit. These tests
//! instead assert directly on the schema document's own declared structure
//! (types, required sets, minimums, `additionalProperties`) — the one real
//! artifact reachable without adding a crate dependency.
//!
//! KNOWN DRIFT (flagged, intentionally not "fixed" here — reconciling it
//! needs either a schema edit or a production change, both out of scope for
//! a test-only fix): the schema below still requires
//! `source_count_by_kind.raw`, but the real struct was renamed
//! `raw` -> `light_frames` in spec 030 (2026-05-26/27, see git history of
//! crates/audit-types/src/event_bus.rs) and the schema was never updated.
//! The schema's top-level `{event, version, payload}` envelope also does
//! not match anything production ever emits: the durable `events` row is
//! `{topic, source, emitted_at, payload}` (`EventRow` in
//! crates/persistence/db/src/repositories/events.rs) and the live broadcast
//! envelope is `EventEnvelope { contract_version, topic, source,
//! emitted_at, payload }` (crates/audit/src/event_bus.rs). Adding
//! `audit_types` as a dev-dependency to tests/contract/Cargo.toml would let
//! a future revision of this file assert on the real serialized output and
//! catch that drift directly.

use std::{fs, path::PathBuf};

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

#[test]
fn audit_schema_event_and_version_are_const_literals() {
    // `event`/`version` are declared as `const`, not free-form strings — a
    // producer must emit exactly these literals, not merely a string.
    let schema = audit_schema();
    assert_eq!(schema["properties"]["event"]["const"], "first_run.completed");
    assert_eq!(schema["properties"]["version"]["const"], "1");
}

#[test]
fn audit_schema_payload_requires_completed_at_and_source_count_by_kind() {
    let schema = audit_schema();
    let required = schema["properties"]["payload"]["required"]
        .as_array()
        .expect("schema payload should define required keys");
    let required_strs: Vec<&str> =
        required.iter().map(|v| v.as_str().expect("required items should be strings")).collect();

    assert!(required_strs.contains(&"completed_at"), "payload must require completed_at");
    assert!(
        required_strs.contains(&"source_count_by_kind"),
        "payload must require source_count_by_kind"
    );
}

#[test]
fn audit_schema_completed_at_is_a_date_time_string() {
    let schema = audit_schema();
    let field = &schema["properties"]["payload"]["properties"]["completed_at"];

    assert_eq!(field["type"], "string", "completed_at must be typed as a string");
    assert_eq!(field["format"], "date-time", "completed_at must use date-time format");
}

#[test]
fn audit_schema_source_count_by_kind_requires_raw_and_project() {
    let schema = audit_schema();
    let required = schema["properties"]["payload"]["properties"]["source_count_by_kind"]
        ["required"]
        .as_array()
        .expect("source_count_by_kind should define required keys");
    let required_strs: Vec<&str> =
        required.iter().map(|v| v.as_str().expect("required items should be strings")).collect();

    assert!(required_strs.contains(&"raw"), "source_count_by_kind must require raw");
    assert!(required_strs.contains(&"project"), "source_count_by_kind must require project");
}

#[test]
fn audit_schema_source_count_by_kind_fields_are_typed_as_integers() {
    let schema = audit_schema();
    let props = schema["properties"]["payload"]["properties"]["source_count_by_kind"]
        ["properties"]
        .as_object()
        .expect("source_count_by_kind should define properties");

    assert!(!props.is_empty(), "source_count_by_kind should declare at least one field");
    for (kind, field) in props {
        assert_eq!(field["type"], "integer", "source_count_by_kind.{kind} must be typed integer");
    }
}

#[test]
fn audit_schema_raw_and_project_have_minimum_one() {
    let schema = audit_schema();
    let props = &schema["properties"]["payload"]["properties"]["source_count_by_kind"]
        ["properties"];

    assert_eq!(props["raw"]["minimum"], 1, "raw count minimum must be 1 per contract");
    assert_eq!(props["project"]["minimum"], 1, "project count minimum must be 1 per contract");
}

#[test]
fn audit_schema_payload_and_source_count_by_kind_reject_additional_properties() {
    // `additionalProperties: false` is what turns "the payload has these
    // keys" into an enforced contract rather than aspirational documentation.
    let schema = audit_schema();

    assert_eq!(
        schema["properties"]["payload"]["additionalProperties"], false,
        "payload must reject keys outside the declared contract"
    );
    assert_eq!(
        schema["properties"]["payload"]["properties"]["source_count_by_kind"]
            ["additionalProperties"],
        false,
        "source_count_by_kind must reject keys outside the declared contract"
    );
}
