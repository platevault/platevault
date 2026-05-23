//! Rust DTOs mirroring `specs/002-data-lifecycle-state-model/contracts/provenance.read.json`.
//!
//! Contract version: 2.0.0.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const CONTRACT_VERSION: &str = "2.0.0";

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AssetType {
    FileRecord,
    AcquisitionSession,
    CalibrationSession,
    Project,
    PreparedSource,
    ProcessingArtifact,
    FilesystemPlan,
    DataSource,
    /// target: alias and primaryDesignation provenance tracking (R-3.2).
    Target,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProvenanceOrigin {
    Observed,
    Inferred,
    Reviewed,
    Generated,
    Planned,
    Applied,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProvenanceHistoryEntry {
    pub origin: ProvenanceOrigin,
    pub value: serde_json::Value,
    pub captured_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replaced_by: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProvenanceField {
    pub field_path: String,
    pub current: serde_json::Value,
    pub origin: ProvenanceOrigin,
    pub captured_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    pub history: Vec<ProvenanceHistoryEntry>,
    #[serde(default)]
    pub history_truncated: bool,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProvenanceErrorCode {
    AssetNotFound,
    ActorNotAuthorised,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProvenanceError {
    pub code: ProvenanceErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProvenanceReadRequest {
    pub contract_version: String,
    pub request_id: Uuid,
    pub asset_id: Uuid,
    pub asset_type: AssetType,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub field_paths: Vec<String>,
}

impl ProvenanceReadRequest {
    #[must_use]
    pub fn new(request_id: Uuid, asset_id: Uuid, asset_type: AssetType) -> Self {
        Self {
            contract_version: CONTRACT_VERSION.to_owned(),
            request_id,
            asset_id,
            asset_type,
            field_paths: Vec::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProvenanceResponseStatus {
    Success,
    Error,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProvenanceReadResponse {
    pub status: ProvenanceResponseStatus,
    pub contract_version: String,
    pub request_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_type: Option<AssetType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provenance: Option<Vec<ProvenanceField>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ProvenanceError>,
}

impl ProvenanceReadResponse {
    #[must_use]
    pub fn success(
        request_id: Uuid,
        asset_id: Uuid,
        asset_type: AssetType,
        provenance: Vec<ProvenanceField>,
    ) -> Self {
        Self {
            status: ProvenanceResponseStatus::Success,
            contract_version: CONTRACT_VERSION.to_owned(),
            request_id,
            asset_id: Some(asset_id),
            asset_type: Some(asset_type),
            provenance: Some(provenance),
            error: None,
        }
    }

    #[must_use]
    pub fn error(request_id: Uuid, error: ProvenanceError) -> Self {
        Self {
            status: ProvenanceResponseStatus::Error,
            contract_version: CONTRACT_VERSION.to_owned(),
            request_id,
            asset_id: None,
            asset_type: None,
            provenance: None,
            error: Some(error),
        }
    }
}
