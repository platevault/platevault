// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Contract checks for
//! `specs/012-processing-artifact-observation/contracts/workflow.run_completed.json`.
//!
//! Issue #1112: the schema set `additionalProperties: false` but omitted
//! `emittedAt`, so a real `EventEnvelope<WorkflowRunCompleted>` validated as
//! invalid against its own contract. Nothing validates events at runtime, so
//! only a schema-vs-struct guard can catch that class of drift.

#[path = "support/envelope_schema_parity.rs"]
mod envelope_schema_parity;

use audit_types::event_bus::{
    EventEnvelope, Source, WorkflowRunCompleted, TOPIC_WORKFLOW_RUN_COMPLETED,
};
use envelope_schema_parity::{assert_envelope_contract, load_schema};
use serde_json::Value;

const SCHEMA_PATH: &str =
    "specs/012-processing-artifact-observation/contracts/workflow.run_completed.json";

fn emitted_event() -> Value {
    let envelope = EventEnvelope::new(
        TOPIC_WORKFLOW_RUN_COMPLETED,
        Source::System,
        WorkflowRunCompleted {
            project_id: "6f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d".to_owned(),
            tool_id: "pixinsight".to_owned(),
            tool_launch_id: "7a2c3d4e-5f60-4b7c-9d0e-1f2a3b4c5d6e".to_owned(),
            completed_at: "2026-05-26T14:30:00Z".to_owned(),
            artifact_ids: vec!["8b3d4e5f-6071-4c8d-ae1f-2a3b4c5d6e7f".to_owned()],
        },
    );
    serde_json::to_value(&envelope).expect("event envelope should serialize")
}

#[test]
fn schema_agrees_with_the_serialized_envelope() {
    assert_envelope_contract(SCHEMA_PATH, TOPIC_WORKFLOW_RUN_COMPLETED, &emitted_event());
}

#[test]
fn schema_completed_at_is_a_date_time_string() {
    let schema = load_schema(SCHEMA_PATH);
    let field = &schema["properties"]["payload"]["properties"]["completedAt"];

    assert_eq!(field["type"], "string", "payload.completedAt must be typed as a string");
    assert_eq!(field["format"], "date-time", "payload.completedAt must use date-time format");
}
