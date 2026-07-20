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

#[path = "support/envelope_schema_parity.rs"]
mod envelope_schema_parity;

use audit_types::event_bus::{
    EventEnvelope, FirstRunCompleted, Source, SourceCountByKind, TOPIC_FIRST_RUN_COMPLETED,
};
use envelope_schema_parity::{assert_envelope_contract, load_schema};
use serde_json::Value;

const SCHEMA_PATH: &str =
    "specs/003-first-run-source-setup/contracts/audit.first_run.completed.json";

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

// ── schema ↔ struct agreement (the anti-drift guard, #1016 / #1093) ────────

#[test]
fn schema_agrees_with_the_serialized_envelope() {
    assert_envelope_contract(SCHEMA_PATH, TOPIC_FIRST_RUN_COMPLETED, &emitted_event());
}

// ── schema structure checks ────────────────────────────────────────────────

#[test]
fn audit_schema_is_valid_json_and_has_expected_title() {
    let schema = load_schema(SCHEMA_PATH);
    assert_eq!(
        schema["title"], "audit.first_run.completed",
        "schema title should match event name"
    );
}

#[test]
fn audit_schema_completed_at_is_a_date_time_string() {
    let schema = load_schema(SCHEMA_PATH);
    let field = &schema["properties"]["payload"]["properties"]["completedAt"];

    assert_eq!(field["type"], "string", "completedAt must be typed as a string");
    assert_eq!(field["format"], "date-time", "completedAt must use date-time format");
}

#[test]
fn audit_schema_source_count_by_kind_fields_are_typed_as_integers() {
    let schema = load_schema(SCHEMA_PATH);
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
    let schema = load_schema(SCHEMA_PATH);
    let props = &schema["properties"]["payload"]["properties"]["sourceCountByKind"]["properties"];

    assert_eq!(props["lightFrames"]["minimum"], 1, "lightFrames minimum must be 1 per contract");
    assert_eq!(props["project"]["minimum"], 1, "project count minimum must be 1 per contract");
}
