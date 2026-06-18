//! Rust-side contract DTO boundary.

pub mod audit;
pub mod calibration;
pub mod calibration_match;
pub mod calibration_tolerances;
pub mod cleanup;
pub mod dev;
pub mod enums;
pub mod equipment;
pub mod first_run;
pub mod guided;
pub mod inbox;
pub mod ingestion;
pub mod inventory;
pub mod json_any;
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
pub mod status;
pub mod target_lookup;
pub mod targets;
pub mod tools;

pub use json_any::JsonAny;

// Re-export shared enums for convenience.
pub use enums::{Density, ViewMode};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CRATE_NAME: &str = "contracts_core";
pub const CONTRACT_VERSION: &str = "1.0.0";

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RequestId(pub String);

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct OperationId(pub String);

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
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

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResponseStatus {
    Ok,
    Error,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
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

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationStatus {
    Queued,
    Running,
    Cancelling,
    Cancelled,
    Completed,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationEvent {
    pub contract_version: String,
    pub operation_id: OperationId,
    pub event_type: OperationEventType,
    pub sequence: u64,
    pub payload: Value,
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
            payload,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractError {
    pub code: String,
    pub message: String,
    pub severity: ErrorSeverity,
    pub retryable: bool,
    #[serde(default)]
    pub details: Value,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub field_errors: Vec<FieldError>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recovery_actions: Vec<RecoveryAction>,
}

impl ContractError {
    #[must_use]
    pub fn new(
        code: impl Into<String>,
        message: impl Into<String>,
        severity: ErrorSeverity,
        retryable: bool,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            severity,
            retryable,
            details: Value::Object(serde_json::Map::new()),
            field_errors: Vec::new(),
            recovery_actions: Vec::new(),
        }
    }

    #[must_use]
    pub fn with_details(mut self, details: Value) -> Self {
        self.details = details;
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

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorSeverity {
    Info,
    Warning,
    Blocking,
    Fatal,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldError {
    pub field: String,
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
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
            "filesystem.destination_exists",
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
}
