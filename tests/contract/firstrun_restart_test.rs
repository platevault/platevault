use contracts_core::first_run::{
    FirstRunRestartResponse, OrganizationState, RegisterSourceResponse, SourceKind,
};
use serde_json::json;

// ── helpers ────────────────────────────────────────────────────────────────

fn response_with_prefilled() -> FirstRunRestartResponse {
    FirstRunRestartResponse {
        restarted_at: "2026-05-26T15:00:00Z".to_owned(),
        prefilled_sources: vec![
            RegisterSourceResponse {
                source_id: "id-raw-1".to_owned(),
                kind: SourceKind::LightFrames,
                path: "/astro/raw".to_owned(),
                created_at: "2026-05-20T10:00:00Z".to_owned(),
                organization_state: OrganizationState::Organized,
            },
            RegisterSourceResponse {
                source_id: "id-project-1".to_owned(),
                kind: SourceKind::Project,
                path: "/astro/projects".to_owned(),
                created_at: "2026-05-20T10:05:00Z".to_owned(),
                organization_state: OrganizationState::Organized,
            },
            RegisterSourceResponse {
                source_id: "id-inbox-1".to_owned(),
                kind: SourceKind::Inbox,
                path: "/astro/inbox".to_owned(),
                created_at: "2026-05-21T08:00:00Z".to_owned(),
                organization_state: OrganizationState::Unorganized,
            },
        ],
    }
}

fn response_with_empty_prefilled() -> FirstRunRestartResponse {
    FirstRunRestartResponse {
        restarted_at: "2026-05-26T15:00:00Z".to_owned(),
        prefilled_sources: vec![],
    }
}

// ── firstrun.restart response with prefilled sources ───────────────────────

#[test]
fn response_serializes_prefilled_sources_as_camel_case() {
    let value = serde_json::to_value(response_with_prefilled()).expect("response should serialize");
    let obj = value.as_object().expect("response should be an object");

    // Contract response has "prefilled_sources" in snake_case in the JSON
    // schema, but the Rust DTO uses #[serde(rename_all = "camelCase")], so
    // it becomes "prefilledSources".
    assert!(obj.contains_key("restartedAt"), "response must have restartedAt key");
    assert!(obj.contains_key("prefilledSources"), "response must have prefilledSources key");

    let sources = obj["prefilledSources"].as_array().expect("prefilledSources should be an array");
    assert_eq!(sources.len(), 3);
}

#[test]
fn prefilled_source_items_have_contract_keys() {
    let value = serde_json::to_value(response_with_prefilled()).unwrap();
    let sources = value["prefilledSources"].as_array().unwrap();

    for source in sources {
        let obj = source.as_object().expect("each source should be an object");

        // Required keys from firstrun.restart.json response items:
        // source_id, kind, path (all camelCase in Rust DTO).
        assert!(obj.contains_key("sourceId"), "source must have sourceId");
        assert!(obj.contains_key("kind"), "source must have kind");
        assert!(obj.contains_key("path"), "source must have path");
        assert!(obj.contains_key("createdAt"), "source must have createdAt");
    }
}

#[test]
fn prefilled_sources_preserve_order_and_values() {
    let value = serde_json::to_value(response_with_prefilled()).unwrap();
    let sources = value["prefilledSources"].as_array().unwrap();

    assert_eq!(sources[0]["sourceId"], json!("id-raw-1"));
    assert_eq!(sources[0]["kind"], json!("light_frames"));
    assert_eq!(sources[0]["path"], json!("/astro/raw"));

    assert_eq!(sources[1]["sourceId"], json!("id-project-1"));
    assert_eq!(sources[1]["kind"], json!("project"));

    assert_eq!(sources[2]["sourceId"], json!("id-inbox-1"));
    assert_eq!(sources[2]["kind"], json!("inbox"));
}

// ── empty prefilled sources ────────────────────────────────────────────────

#[test]
fn empty_prefilled_sources_serializes_as_empty_array() {
    let value =
        serde_json::to_value(response_with_empty_prefilled()).expect("response should serialize");
    let sources =
        value["prefilledSources"].as_array().expect("prefilledSources should be an array");

    assert!(sources.is_empty(), "prefilledSources should be empty");
}

#[test]
fn response_has_only_contract_defined_keys() {
    let value = serde_json::to_value(response_with_prefilled()).unwrap();
    let obj = value.as_object().unwrap();

    // DTO-level keys (envelope adds status, contractVersion, requestId).
    let allowed: std::collections::BTreeSet<&str> =
        ["restartedAt", "prefilledSources"].into_iter().collect();

    for key in obj.keys() {
        assert!(
            allowed.contains(key.as_str()),
            "unexpected key \"{key}\" in FirstRunRestartResponse"
        );
    }
}

#[test]
fn response_roundtrips_through_json() {
    let original = response_with_prefilled();
    let json_str = serde_json::to_string(&original).expect("should serialize to string");
    let deserialized: FirstRunRestartResponse =
        serde_json::from_str(&json_str).expect("should deserialize from string");

    assert_eq!(original.restarted_at, deserialized.restarted_at);
    assert_eq!(original.prefilled_sources.len(), deserialized.prefilled_sources.len());
    assert_eq!(
        original.prefilled_sources[0].source_id,
        deserialized.prefilled_sources[0].source_id
    );
}

#[test]
fn response_restarted_at_is_iso8601_string() {
    let value = serde_json::to_value(response_with_prefilled()).unwrap();
    assert!(
        value["restartedAt"].is_string(),
        "restartedAt must be a JSON string for date-time format"
    );
    assert_eq!(value["restartedAt"], json!("2026-05-26T15:00:00Z"));
}
