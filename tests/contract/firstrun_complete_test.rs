// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

use contracts_core::first_run::FirstRunCompleteResponse;
use serde_json::json;

// ── helpers ────────────────────────────────────────────────────────────────

fn sample_response() -> FirstRunCompleteResponse {
    FirstRunCompleteResponse {
        completed_at: "2026-05-26T14:30:00Z".to_owned(),
        registered_source_count: 4,
    }
}

// ── firstrun.complete response ─────────────────────────────────────────────

#[test]
fn response_serializes_completed_at_as_camel_case() {
    let value = serde_json::to_value(sample_response()).expect("response should serialize");
    let obj = value.as_object().expect("response should be an object");

    // Contract requires "completedAt" (camelCase) — format: date-time.
    assert!(obj.contains_key("completedAt"), "response must have completedAt key");
    assert_eq!(obj["completedAt"], json!("2026-05-26T14:30:00Z"));
}

#[test]
fn completed_at_is_iso8601_string() {
    let value = serde_json::to_value(sample_response()).unwrap();

    // firstrun.complete.json: completedAt is { type: "string", format: "date-time" }
    assert!(
        value["completedAt"].is_string(),
        "completedAt must be a JSON string for date-time format"
    );
}

#[test]
fn response_has_only_contract_defined_keys() {
    let value = serde_json::to_value(sample_response()).unwrap();
    let obj = value.as_object().unwrap();

    // The DTO-level response (before envelope wrapping) should contain
    // completedAt and registeredSourceCount. Envelope keys (status,
    // contractVersion, requestId) are added by ResponseEnvelope, not the DTO.
    let allowed: std::collections::BTreeSet<&str> =
        ["completedAt", "registeredSourceCount"].into_iter().collect();

    for key in obj.keys() {
        assert!(
            allowed.contains(key.as_str()),
            "unexpected key \"{key}\" in FirstRunCompleteResponse"
        );
    }
}

#[test]
fn response_roundtrips_through_json() {
    let original = sample_response();
    let json_str = serde_json::to_string(&original).expect("should serialize to string");
    let deserialized: FirstRunCompleteResponse =
        serde_json::from_str(&json_str).expect("should deserialize from string");

    assert_eq!(original.completed_at, deserialized.completed_at);
    assert_eq!(original.registered_source_count, deserialized.registered_source_count);
}

#[test]
fn response_includes_registered_source_count() {
    let value = serde_json::to_value(sample_response()).unwrap();
    let obj = value.as_object().unwrap();

    assert!(
        obj.contains_key("registeredSourceCount"),
        "response must have registeredSourceCount key"
    );
    assert!(value["registeredSourceCount"].is_u64(), "registeredSourceCount must be an integer");
    assert_eq!(value["registeredSourceCount"], json!(4));
}
