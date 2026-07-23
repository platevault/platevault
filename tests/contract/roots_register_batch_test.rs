// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

use contracts_core::first_run::{
    BatchItem, BatchStatus, ItemStatus, OrganizationState, RegisterSourceBatchRequest,
    RegisterSourceBatchResponse, RegisterSourceRequest, ScanDepth, SourceKind,
};
use contracts_core::JsonAny;
use serde_json::json;

// ── helpers ────────────────────────────────────────────────────────────────

fn sample_batch_request() -> RegisterSourceBatchRequest {
    RegisterSourceBatchRequest {
        sources: vec![
            RegisterSourceRequest {
                kind: SourceKind::LightFrames,
                path: "/astro/raw".to_owned(),
                kind_subtype: None,
                scan_depth: ScanDepth::Recursive,
                organization_state: OrganizationState::Organized,
            },
            RegisterSourceRequest {
                kind: SourceKind::Project,
                path: "/astro/projects".to_owned(),
                kind_subtype: None,
                scan_depth: ScanDepth::Recursive,
                organization_state: OrganizationState::Organized,
            },
            RegisterSourceRequest {
                kind: SourceKind::Calibration,
                path: "/astro/cals".to_owned(),
                kind_subtype: Some("calibration".to_owned()),
                scan_depth: ScanDepth::Single,
                organization_state: OrganizationState::Organized,
            },
        ],
    }
}

fn success_response() -> RegisterSourceBatchResponse {
    RegisterSourceBatchResponse {
        status: BatchStatus::Success,
        items: vec![
            BatchItem {
                index: 0,
                status: ItemStatus::Success,
                source_id: Some("id-raw".to_owned()),
                error: None,
                error_detail: None,
            },
            BatchItem {
                index: 1,
                status: ItemStatus::Success,
                source_id: Some("id-project".to_owned()),
                error: None,
                error_detail: None,
            },
        ],
    }
}

fn partial_failure_response() -> RegisterSourceBatchResponse {
    RegisterSourceBatchResponse {
        status: BatchStatus::Partial,
        items: vec![
            BatchItem {
                index: 0,
                status: ItemStatus::Success,
                source_id: Some("id-raw".to_owned()),
                error: None,
                error_detail: None,
            },
            BatchItem {
                index: 1,
                status: ItemStatus::Failure,
                source_id: None,
                error: Some("path.not_exists".to_owned()),
                error_detail: None,
            },
            BatchItem {
                index: 2,
                status: ItemStatus::Failure,
                source_id: None,
                error: Some("path.already_registered.different_kind".to_owned()),
                error_detail: Some(JsonAny::new(json!({ "conflicting_kind": "inbox" }))),
            },
        ],
    }
}

// ── batch request ──────────────────────────────────────────────────────────

#[test]
fn batch_request_serializes_sources_array() {
    let value =
        serde_json::to_value(sample_batch_request()).expect("batch request should serialize");
    let obj = value.as_object().expect("batch request should be an object");

    // Contract requires a top-level "sources" array.
    let sources = obj["sources"].as_array().expect("sources should be an array");
    assert_eq!(sources.len(), 3);
}

#[test]
fn batch_request_items_have_correct_camel_case_keys() {
    let value = serde_json::to_value(sample_batch_request()).unwrap();
    let first = &value["sources"][0];

    // The Rust DTO uses camelCase; verify key names.
    assert!(first.get("kind").is_some(), "item must have kind");
    assert!(first.get("path").is_some(), "item must have path");
    assert!(first.get("scanDepth").is_some(), "item must have scanDepth");
}

#[test]
fn batch_request_preserves_source_order() {
    let value = serde_json::to_value(sample_batch_request()).unwrap();
    let sources = value["sources"].as_array().unwrap();

    assert_eq!(sources[0]["kind"], json!("light_frames"));
    assert_eq!(sources[1]["kind"], json!("project"));
    assert_eq!(sources[2]["kind"], json!("calibration"));
}

// ── batch status enum ──────────────────────────────────────────────────────

#[test]
fn batch_status_variants_match_contract() {
    // roots.register.batch.json: enum ["success", "partial", "failure"]
    assert_eq!(serde_json::to_value(BatchStatus::Success).unwrap(), json!("success"));
    assert_eq!(serde_json::to_value(BatchStatus::Partial).unwrap(), json!("partial"));
    assert_eq!(serde_json::to_value(BatchStatus::Failure).unwrap(), json!("failure"));
}

// ── item status enum ───────────────────────────────────────────────────────

#[test]
fn item_status_variants_match_contract() {
    // roots.register.batch.json: enum ["success", "failure"]
    assert_eq!(serde_json::to_value(ItemStatus::Success).unwrap(), json!("success"));
    assert_eq!(serde_json::to_value(ItemStatus::Failure).unwrap(), json!("failure"));
}

// ── success response ───────────────────────────────────────────────────────

#[test]
fn success_response_serializes_with_status_and_items() {
    let value =
        serde_json::to_value(success_response()).expect("success response should serialize");
    let obj = value.as_object().expect("response should be an object");

    assert_eq!(obj["status"], json!("success"));

    let items = obj["items"].as_array().expect("items should be an array");
    assert_eq!(items.len(), 2);

    // Each successful item must have sourceId (camelCase).
    for item in items {
        assert_eq!(item["status"], json!("success"));
        assert!(item.get("sourceId").is_some(), "successful item must have sourceId");
    }
}

#[test]
fn success_item_omits_error_fields() {
    let value = serde_json::to_value(success_response()).unwrap();
    let first_item = &value["items"][0];

    // skip_serializing_if: error and errorDetail absent when None.
    assert!(first_item.get("error").is_none(), "successful item should not have error");
    assert!(first_item.get("errorDetail").is_none(), "successful item should not have errorDetail");
}

// ── partial failure response ───────────────────────────────────────────────

#[test]
fn partial_response_has_mixed_item_statuses() {
    let value = serde_json::to_value(partial_failure_response())
        .expect("partial response should serialize");

    assert_eq!(value["status"], json!("partial"));

    let items = value["items"].as_array().unwrap();
    assert_eq!(items.len(), 3);

    // Item 0: success
    assert_eq!(items[0]["status"], json!("success"));
    assert!(items[0].get("sourceId").is_some());

    // Item 1: failure with error code
    assert_eq!(items[1]["status"], json!("failure"));
    assert_eq!(items[1]["error"], json!("path.not_exists"));
    assert!(items[1].get("sourceId").is_none(), "failed item should not have sourceId");

    // Item 2: failure with error and detail
    assert_eq!(items[2]["status"], json!("failure"));
    assert_eq!(items[2]["error"], json!("path.already_registered.different_kind"));
}

#[test]
fn batch_item_with_error_detail_serializes_transparently() {
    let value = serde_json::to_value(partial_failure_response()).unwrap();
    let detail = &value["items"][2]["errorDetail"];

    // JsonAny is #[serde(transparent)], so the inner value surfaces directly.
    assert_eq!(
        detail["conflicting_kind"],
        json!("inbox"),
        "errorDetail should contain the structured detail object"
    );
}

#[test]
fn batch_item_index_is_integer() {
    let value = serde_json::to_value(partial_failure_response()).unwrap();
    let items = value["items"].as_array().unwrap();

    for (expected_index, item) in items.iter().enumerate() {
        assert_eq!(
            item["index"].as_u64().expect("index should be an integer"),
            expected_index as u64,
        );
    }
}
