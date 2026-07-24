// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `read_provenance` use case (spec 002, T021a).
//!
//! Loads provenance entries for an asset from the persistence layer and
//! translates them into the `provenance.read` contract shape
//! (`ProvenanceReadResponse`).
//!
//! AssetType (contract DTO) is mapped to a stored `entity_type` string via
//! [`asset_type_entity_str`]. Any AssetType the persistence layer does not
//! track yet (e.g. `Target` — see spec 023 R-3.2) returns an `asset_not_found`
//! contract error rather than a panic.

use contracts_core::provenance::{
    AssetType, ProvenanceError, ProvenanceErrorCode, ProvenanceField, ProvenanceHistoryEntry,
    ProvenanceOrigin, ProvenanceReadRequest, ProvenanceReadResponse,
};
use domain_core::ids::EntityId;
use domain_core::lifecycle::provenance::ProvenanceTag;
use persistence_lifecycle::repositories::provenance::load_provenance;

/// Map a contract `AssetType` to the `entity_type` string stored on
/// `provenance_history_archive` rows.
///
/// Returns `None` when the AssetType has no persistence mapping yet.
#[must_use]
pub const fn asset_type_entity_str(t: AssetType) -> Option<&'static str> {
    match t {
        AssetType::FileRecord => Some("file_record"),
        AssetType::AcquisitionSession => Some("acquisition_session"),
        AssetType::CalibrationSession => Some("calibration_session"),
        AssetType::Project => Some("project"),
        AssetType::PreparedSource => Some("prepared_source"),
        AssetType::ProcessingArtifact => Some("processing_artifact"),
        AssetType::FilesystemPlan => Some("filesystem_plan"),
        AssetType::DataSource => Some("data_source"),
        AssetType::Target => None,
    }
}

#[must_use]
pub const fn provenance_tag_to_origin(t: ProvenanceTag) -> ProvenanceOrigin {
    match t {
        ProvenanceTag::Observed => ProvenanceOrigin::Observed,
        ProvenanceTag::Inferred => ProvenanceOrigin::Inferred,
        ProvenanceTag::Reviewed => ProvenanceOrigin::Reviewed,
        ProvenanceTag::Generated => ProvenanceOrigin::Generated,
        ProvenanceTag::Planned => ProvenanceOrigin::Planned,
        ProvenanceTag::Applied => ProvenanceOrigin::Applied,
    }
}

/// Read provenance for an asset.
///
/// Returns a contract-shaped response. Errors are encoded as
/// `ProvenanceReadResponse::error(...)` rather than as a Rust `Result`
/// because the contract surface is the boundary callers care about.
pub async fn read_provenance(
    pool: &sqlx::SqlitePool,
    req: ProvenanceReadRequest,
) -> ProvenanceReadResponse {
    let Some(entity_type_str) = asset_type_entity_str(req.asset_type) else {
        return ProvenanceReadResponse::error(
            req.request_id,
            ProvenanceError {
                code: ProvenanceErrorCode::AssetNotFound,
                message: format!("asset type {:?} has no persistence mapping", req.asset_type),
                details: None,
            },
        );
    };

    let entity_id = EntityId::from_uuid(req.asset_id);

    let (grouped, _any_truncated) = match load_provenance(pool, entity_id, entity_type_str).await {
        Ok(v) => v,
        Err(err) => {
            return ProvenanceReadResponse::error(
                req.request_id,
                ProvenanceError {
                    code: ProvenanceErrorCode::AssetNotFound,
                    message: err.to_string(),
                    details: None,
                },
            );
        }
    };

    // Filter by requested field_paths when the caller specified any.
    let mut fields: Vec<ProvenanceField> = grouped
        .into_iter()
        .filter(|(field_path, _)| {
            req.field_paths.is_empty() || req.field_paths.iter().any(|p| p == field_path)
        })
        .map(|(field_path, prov)| {
            let history: Vec<ProvenanceHistoryEntry> = prov
                .history
                .iter()
                .map(|entry| ProvenanceHistoryEntry {
                    origin: provenance_tag_to_origin(entry.origin),
                    value: contracts_core::JsonAny(entry.value.clone()),
                    captured_at: entry
                        .captured_at
                        .as_offset_date_time()
                        .format(&time::format_description::well_known::Rfc3339)
                        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned()),
                    source_id: entry.source_id.map(|id| id.to_string()),
                    replaced_by: entry.replaced_by.clone(),
                })
                .collect();

            // Newest entry's captured_at = `current.captured_at`. History is
            // already newest-first per persistence layer ordering.
            let captured_at = history.first().map(|h| h.captured_at.clone()).unwrap_or_default();
            let source_id = history.first().and_then(|h| h.source_id.clone());

            ProvenanceField {
                field_path,
                current: contracts_core::JsonAny(prov.current),
                origin: provenance_tag_to_origin(prov.origin),
                captured_at,
                source_id,
                history,
                history_truncated: prov.history_truncated,
            }
        })
        .collect();

    fields.sort_by(|a, b| a.field_path.cmp(&b.field_path));

    ProvenanceReadResponse::success(req.request_id, req.asset_id, req.asset_type, fields)
}
