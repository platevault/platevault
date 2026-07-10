//! Rust-side contract DTO boundary.

pub mod archive;
pub mod audit;
pub mod calibration;
pub mod calibration_match;
pub mod calibration_tolerances;
pub mod cleanup;
pub mod dev;
pub mod enums;
pub mod error_code;
pub mod guided;
pub mod inbox;
pub mod ingestion;
pub mod inventory;
pub mod inventory_frame;
pub mod lifecycle;
pub mod log;
pub mod manifests;
pub mod native;
pub mod patterns;
pub mod plan_apply;
pub mod plans;
pub mod preferences;
pub mod prepared_views;
pub mod projects;
pub mod projects_v2;
pub mod protection;
pub mod provenance;
pub mod review;
pub mod roots;
pub mod search;
pub mod sessions;
pub mod settings;
pub mod source_view_generate;
pub mod source_view_verify;
pub mod status;
pub mod targets;
pub mod tools;

// ── Re-exported domain-owned stored types (spec 042 T254) ─────────────────
//
// `equipment`, `first_run`, and the settings stored types now live in
// `domain_core` so the persistence layer can depend on them without importing
// this transport crate (fixes the `persistence/db → contracts/core` layering
// inversion). They are re-exported here verbatim so the IPC command surface,
// the generated TypeScript bindings, and every existing
// `contracts_core::{equipment,first_run}::*` import are byte-identical.
pub use domain_core::equipment;
pub use domain_core::first_run;

pub use domain_core::JsonAny;

// Re-export shared enums for convenience.
pub use enums::{Density, ViewMode};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CRATE_NAME: &str = "contracts_core";
pub const CONTRACT_VERSION: &str = "1.0.0";

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RequestId(pub String);

#[derive(
    Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, specta::Type,
)]
#[serde(transparent)]
pub struct OperationId(pub String);

#[derive(
    Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, specta::Type,
)]
#[serde(transparent)]
pub struct OperationName(pub String);

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestEnvelope<T> {
    pub contract_version: String,
    pub operation: OperationName,
    pub request_id: RequestId,
    pub payload: T,
}

impl<T> RequestEnvelope<T> {
    #[must_use]
    pub fn new(operation: OperationName, request_id: RequestId, payload: T) -> Self {
        Self { contract_version: CONTRACT_VERSION.to_owned(), operation, request_id, payload }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseEnvelope<T> {
    pub contract_version: String,
    pub request_id: RequestId,
    pub status: ResponseStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ContractError>,
}

impl<T> ResponseEnvelope<T> {
    #[must_use]
    pub fn ok(request_id: RequestId, payload: T) -> Self {
        Self {
            contract_version: CONTRACT_VERSION.to_owned(),
            request_id,
            status: ResponseStatus::Ok,
            payload: Some(payload),
            error: None,
        }
    }

    #[must_use]
    pub fn error(request_id: RequestId, error: ContractError) -> Self {
        Self {
            contract_version: CONTRACT_VERSION.to_owned(),
            request_id,
            status: ResponseStatus::Error,
            payload: None,
            error: Some(error),
        }
    }
}

#[derive(
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum ResponseStatus {
    Ok,
    Error,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OperationHandle {
    pub operation_id: OperationId,
    pub operation: OperationName,
    pub status: OperationStatus,
}

impl OperationHandle {
    #[must_use]
    pub const fn new(
        operation_id: OperationId,
        operation: OperationName,
        status: OperationStatus,
    ) -> Self {
        Self { operation_id, operation, status }
    }
}

#[derive(
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    specta::Type,
    schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum OperationStatus {
    Queued,
    Running,
    Cancelling,
    Cancelled,
    Completed,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OperationEvent {
    pub contract_version: String,
    pub operation_id: OperationId,
    pub event_type: OperationEventType,
    pub sequence: u64,
    // `JsonAny` is wire-equivalent to `serde_json::Value` (serde-transparent)
    // but exports as the opaque TS `unknown`, avoiding specta's infinite
    // recursive-inline expansion of raw `Value` (spec 042 US16, T240).
    pub payload: JsonAny,
}

impl OperationEvent {
    #[must_use]
    pub fn new(
        operation_id: OperationId,
        event_type: OperationEventType,
        sequence: u64,
        payload: Value,
    ) -> Self {
        Self {
            contract_version: CONTRACT_VERSION.to_owned(),
            operation_id,
            event_type,
            sequence,
            payload: JsonAny::from(payload),
        }
    }
}

#[derive(
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    specta::Type,
    schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum OperationEventType {
    Progress,
    DiscoveredItemBatch,
    ExtractedMetadataBatch,
    FailedFileBatch,
    CandidateBatch,
    ObservedArtifactBatch,
    ItemStarted,
    ItemApplied,
    ItemFailed,
    Warning,
    Completed,
    Failed,
    Custom,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ContractError {
    pub code: error_code::ErrorCode,
    pub message: String,
    pub severity: ErrorSeverity,
    pub retryable: bool,
    #[serde(default)]
    pub details: JsonAny,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub field_errors: Vec<FieldError>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recovery_actions: Vec<RecoveryAction>,
}

impl ContractError {
    #[must_use]
    pub fn new(
        code: error_code::ErrorCode,
        message: impl Into<String>,
        severity: ErrorSeverity,
        retryable: bool,
    ) -> Self {
        Self {
            code,
            message: message.into(),
            severity,
            retryable,
            details: JsonAny::from(Value::Object(serde_json::Map::new())),
            field_errors: Vec::new(),
            recovery_actions: Vec::new(),
        }
    }

    /// Wrap a legacy plain-string error as an `InternalError` blocking error.
    #[must_use]
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(error_code::ErrorCode::InternalError, message, ErrorSeverity::Blocking, false)
    }

    #[must_use]
    pub fn with_details(mut self, details: Value) -> Self {
        self.details = JsonAny::from(details);
        self
    }

    #[must_use]
    pub fn with_field_error(mut self, field_error: FieldError) -> Self {
        self.field_errors.push(field_error);
        self
    }

    #[must_use]
    pub fn with_recovery_action(mut self, recovery_action: RecoveryAction) -> Self {
        self.recovery_actions.push(recovery_action);
        self
    }
}

#[derive(
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    specta::Type,
    schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum ErrorSeverity {
    Info,
    Warning,
    Blocking,
    Fatal,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FieldError {
    pub field: String,
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryAction {
    pub code: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        ContractError, ErrorSeverity, OperationEvent, OperationEventType, OperationId,
        OperationName, RequestEnvelope, RequestId, ResponseEnvelope, ResponseStatus, CRATE_NAME,
    };

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "contracts_core");
    }

    #[test]
    fn serializes_request_envelope_with_contract_fields() {
        let envelope = RequestEnvelope::new(
            OperationName("library.scan.start".to_owned()),
            RequestId("req-1".to_owned()),
            json!({ "rootIds": ["root-1"] }),
        );

        assert_eq!(
            serde_json::to_value(envelope).unwrap(),
            json!({
                "contractVersion": "1.0.0",
                "operation": "library.scan.start",
                "requestId": "req-1",
                "payload": { "rootIds": ["root-1"] }
            })
        );
    }

    #[test]
    fn serializes_success_response_without_error() {
        let envelope = ResponseEnvelope::ok(RequestId("req-1".to_owned()), json!({ "ok": true }));
        let value = serde_json::to_value(envelope).unwrap();

        assert_eq!(value["status"], "ok");
        assert_eq!(value["payload"], json!({ "ok": true }));
        assert!(value.get("error").is_none());
    }

    #[test]
    fn serializes_error_response_without_payload() {
        let error = ContractError::new(
            crate::error_code::ErrorCode::FilesystemDestinationExists,
            "Destination already exists.",
            ErrorSeverity::Blocking,
            false,
        );
        let envelope: ResponseEnvelope<serde_json::Value> =
            ResponseEnvelope::error(RequestId("req-1".to_owned()), error);
        let value = serde_json::to_value(envelope).unwrap();

        assert_eq!(value["status"], "error");
        assert_eq!(value["error"]["severity"], "blocking");
        assert!(value.get("payload").is_none());
    }

    #[test]
    fn serializes_operation_event() {
        let event = OperationEvent::new(
            OperationId("op-1".to_owned()),
            OperationEventType::Progress,
            42,
            json!({ "status": "running" }),
        );
        let value = serde_json::to_value(event).unwrap();

        assert_eq!(value["contractVersion"], "1.0.0");
        assert_eq!(value["eventType"], "progress");
        assert_eq!(value["sequence"], 42);
    }

    #[test]
    fn response_status_serializes_as_contract_value() {
        assert_eq!(serde_json::to_value(ResponseStatus::Ok).unwrap(), json!("ok"));
    }

    // ── T116: JSON-Schema snapshot agreement tests ────────────────────────────
    //
    // These tests re-generate the JSON Schema from Rust types using schemars
    // and compare the output byte-for-byte against the committed
    // `*.generated.json` snapshots in `specs/<NNN>/contracts/`.
    //
    // They fail when a Rust type change alters the generated schema without a
    // corresponding snapshot update.  To update: run
    //   cargo run -p contracts_core --bin generate-contracts
    // review the diff, then commit both the type change and the snapshot.
    //
    // Note: as of spec 042 T116a, schemars 1.x emits JSON-Schema
    // draft-2020-12 — the same dialect as the canonical contracts — so the
    // generated snapshots and the hand-maintained `*.json` now share a
    // dialect.  The `.generated.json` snapshots are the Rust-derived
    // projection; the FR-005/SC-004 specta↔schemars agreement test lives in
    // `tests/contract/`.
    mod schema_agreement {
        use schemars::{schema_for, JsonSchema};
        use std::path::PathBuf;

        fn workspace_root() -> PathBuf {
            // CARGO_MANIFEST_DIR = crates/contracts/core
            let manifest = std::env!("CARGO_MANIFEST_DIR");
            PathBuf::from(manifest)
                .ancestors()
                .nth(3)
                .expect("workspace root 3 levels up")
                .to_path_buf()
        }

        fn assert_schema_matches<T: JsonSchema>(spec_dir: &str, name: &str) {
            let schema = schema_for!(T);
            let generated = serde_json::to_string_pretty(&schema)
                .unwrap_or_else(|e| panic!("failed to serialise schema for {name}: {e}"));
            let generated = format!("{generated}\n");

            let path = workspace_root().join("specs").join(spec_dir).join("contracts").join(name);

            let committed = std::fs::read_to_string(&path).unwrap_or_else(|e| {
                panic!(
                    "Could not read committed snapshot {}: {e}\n\
                     Run `cargo run -p contracts_core --bin generate-contracts` to create it.",
                    path.display()
                )
            });

            // Compare parsed JSON values, not raw strings: schemars emits `$defs`
            // in a key order that can differ between isolated (`-p`) and workspace
            // compilation contexts. `serde_json::Value` equality compares objects
            // as maps (order-insensitive), so this still catches real schema drift
            // (added/removed/changed keys or values) without failing on cosmetic
            // definition-ordering differences.
            let committed_json: serde_json::Value = serde_json::from_str(&committed)
                .unwrap_or_else(|e| panic!("committed snapshot {name} is not valid JSON: {e}"));
            let generated_json: serde_json::Value = serde_json::from_str(&generated)
                .unwrap_or_else(|e| panic!("generated schema for {name} is not valid JSON: {e}"));

            assert_eq!(
                committed_json, generated_json,
                "Schema snapshot drift detected for {name}.\n\
                 Run `cargo run -p contracts_core --bin generate-contracts` to regenerate,\n\
                 then review the diff and commit the updated snapshot alongside the type change."
            );
        }

        #[test]
        fn lifecycle_transition_request_schema_no_drift() {
            assert_schema_matches::<crate::lifecycle::TransitionRequest>(
                "002-data-lifecycle-state-model",
                "lifecycle.transition.generated.json",
            );
        }

        #[test]
        fn provenance_read_request_schema_no_drift() {
            assert_schema_matches::<crate::provenance::ProvenanceReadRequest>(
                "002-data-lifecycle-state-model",
                "provenance.read.generated.json",
            );
        }
    }
}
