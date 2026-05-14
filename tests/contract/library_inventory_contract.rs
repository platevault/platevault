use std::{fs, path::PathBuf};

use contracts_core::{
    OperationEvent, OperationEventType, OperationHandle, OperationId, OperationName,
    OperationStatus, RequestEnvelope, RequestId, ResponseEnvelope, CONTRACT_VERSION,
};
use serde_json::{json, Value};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(std::path::Path::parent)
        .expect("contract test package should live under tests/contract")
        .to_path_buf()
}

fn operation_catalog() -> String {
    let path = repo_root().join("specs/001-astro-library-manager/contracts/operation-catalog.md");
    fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!("failed to read operation catalog at {}: {error}", path.display());
    })
}

#[test]
fn operation_catalog_documents_us1_inventory_operations() {
    let catalog = operation_catalog();

    for operation in ["library.root.register", "library.scan.start", "library.inventory.query"] {
        assert!(
            catalog.contains(&format!("`{operation}`")),
            "operation catalog should document {operation}"
        );
    }
}

#[test]
fn library_root_register_request_is_metadata_only() {
    let envelope = RequestEnvelope::new(
        OperationName("library.root.register".to_owned()),
        RequestId("req-root-register-1".to_owned()),
        json!({
            "displayName": "Astrophotography",
            "absolutePath": "D:\\Astrophotography",
            "platform": "windows",
            "rootKind": "external_disk",
            "scanSettings": {
                "followLinks": false,
                "hashMode": "lazy",
                "includePatterns": ["**/*"],
                "excludePatterns": ["**/.DS_Store"],
                "protectedPatterns": ["Published/**", "Masters/**"],
                "metadataExtractMode": "headers_only"
            }
        }),
    );

    let serialized = serde_json::to_value(envelope).expect("request should serialize");

    assert_eq!(serialized["contractVersion"], CONTRACT_VERSION);
    assert_eq!(serialized["operation"], "library.root.register");
    assert_eq!(serialized["payload"]["scanSettings"]["followLinks"], false);
    assert_eq!(serialized["payload"]["scanSettings"]["hashMode"], "lazy");
    assert!(
        serialized["payload"].get("moveFiles").is_none(),
        "root registration must not request filesystem mutation"
    );
}

#[test]
fn library_scan_start_contract_returns_operation_handle_and_scan_events() {
    let request = RequestEnvelope::new(
        OperationName("library.scan.start".to_owned()),
        RequestId("req-scan-1".to_owned()),
        json!({
            "rootIds": ["root-astro"],
            "scanSettingsOverride": {
                "followLinks": false,
                "hashMode": "lazy"
            },
            "scope": {
                "include": ["Raw/**", "Masters/**", "Process/**"],
                "exclude": ["Tools/**"]
            }
        }),
    );
    let response = ResponseEnvelope::ok(
        request.request_id.clone(),
        OperationHandle::new(
            OperationId("op-scan-1".to_owned()),
            OperationName("library.scan.start".to_owned()),
            OperationStatus::Queued,
        ),
    );
    let discovered_batch = OperationEvent::new(
        OperationId("op-scan-1".to_owned()),
        OperationEventType::DiscoveredItemBatch,
        1,
        json!({
            "rootId": "root-astro",
            "items": [
                {
                    "relativePath": "Raw/2026-01-12_M42/Lights/M42_L_001.fit",
                    "itemType": "file",
                    "fileKind": "fits",
                    "classification": {
                        "category": "raw_light",
                        "confidence": {
                            "level": "medium",
                            "score": 0.72
                        },
                        "reviewState": "unreviewed"
                    }
                },
                {
                    "relativePath": "Raw/linked-masters",
                    "itemType": "symlink",
                    "linkTraversal": "not_followed"
                }
            ]
        }),
    );

    let request_json = serde_json::to_value(request).expect("request should serialize");
    let response_json = serde_json::to_value(response).expect("response should serialize");
    let event_json = serde_json::to_value(discovered_batch).expect("event should serialize");

    assert_eq!(request_json["operation"], "library.scan.start");
    assert_eq!(request_json["payload"]["scanSettingsOverride"]["followLinks"], false);
    assert_eq!(response_json["status"], "ok");
    assert_eq!(response_json["payload"]["operation"], "library.scan.start");
    assert_eq!(response_json["payload"]["status"], "queued");
    assert_eq!(event_json["eventType"], "discovered_item_batch");
    assert_eq!(event_json["payload"]["items"][1]["linkTraversal"], "not_followed");
}

#[test]
fn library_inventory_query_contract_supports_reviewable_pages() {
    let request = RequestEnvelope::new(
        OperationName("library.inventory.query".to_owned()),
        RequestId("req-inventory-1".to_owned()),
        json!({
            "rootIds": ["root-astro"],
            "filters": {
                "classificationLevels": ["unknown", "low", "medium"],
                "reviewStates": ["unreviewed", "corrected"],
                "itemTypes": ["file", "directory", "symlink"]
            },
            "sort": [{ "field": "relativePath", "direction": "asc" }],
            "pagination": { "cursor": null, "limit": 50 }
        }),
    );
    let response: ResponseEnvelope<Value> = ResponseEnvelope::ok(
        request.request_id.clone(),
        json!({
            "items": [
                {
                    "fileRecordId": "file-unknown-1",
                    "rootId": "root-astro",
                    "relativePath": "Unknown Drop/maybe_stack.fit",
                    "classification": {
                        "category": "unknown",
                        "confidence": { "level": "unknown", "score": 0.0 },
                        "reviewState": "unreviewed"
                    }
                }
            ],
            "pageInfo": {
                "nextCursor": null,
                "returned": 1
            },
            "summary": {
                "unknownCount": 1,
                "lowConfidenceCount": 0,
                "projectLikeCount": 0
            }
        }),
    );

    let request_json = serde_json::to_value(request).expect("request should serialize");
    let response_json = serde_json::to_value(response).expect("response should serialize");

    assert_eq!(request_json["operation"], "library.inventory.query");
    assert_eq!(response_json["status"], "ok");
    assert_eq!(response_json["payload"]["items"][0]["classification"]["category"], "unknown");
    assert_eq!(response_json["payload"]["summary"]["unknownCount"], 1);
}
