// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `calibration.match.suggest.batch` — multi-session suggest.

use calibration_core::{batch_suggest as domain_batch_suggest, CalibrationKind};
use contracts_core::calibration_match::{
    contract_to_kind, kind_to_contract, match_to_dto, BatchErrorDto, BatchSessionResultDto,
    CalibrationMatchBatchRequest, CalibrationMatchBatchResponse, BATCH_CONTRACT_VERSION,
};
use sqlx::SqlitePool;

use calibration_core::ranking::suggest_status;

use super::context::{apply_session_context, load_session_contexts};
use super::loaders::{load_config, load_masters, load_session};

/// `calibration.match.suggest.batch` — suggest for multiple sessions.
///
/// # Errors
/// Returns `Err(String)` on database error.
pub async fn batch_suggest(
    pool: &SqlitePool,
    req: CalibrationMatchBatchRequest,
) -> Result<CalibrationMatchBatchResponse, String> {
    if req.session_ids.is_empty() {
        return Ok(CalibrationMatchBatchResponse {
            status: "error".to_owned(),
            contract_version: BATCH_CONTRACT_VERSION.to_owned(),
            request_id: req.request_id,
            results: None,
            errors: Some(vec![BatchErrorDto {
                code: "contract.version_unsupported".to_owned(),
                message: "sessionIds must be non-empty".to_owned(),
                session_id: None,
            }]),
        });
    }

    let config = load_config(pool).await;
    let calibration_types: Vec<CalibrationKind> = req
        .calibration_types
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .map(|ct| contract_to_kind(*ct))
        .collect();
    let types_ref: Vec<CalibrationKind> = if calibration_types.is_empty() {
        vec![CalibrationKind::Dark, CalibrationKind::Flat, CalibrationKind::Bias]
    } else {
        calibration_types
    };

    let masters = load_masters(pool, &types_ref).await?;

    // P9: one batched session-context lookup for the whole request, keyed by
    // every requested session id — not a per-session (N+1) query inside the
    // loop below.
    let session_ctx = load_session_contexts(pool, &req.session_ids).await;

    let mut results: Vec<BatchSessionResultDto> = Vec::new();
    let mut errors: Vec<BatchErrorDto> = Vec::new();

    for session_id in &req.session_ids {
        match load_session(pool, session_id).await {
            Ok(None) => {
                errors.push(BatchErrorDto {
                    code: "session.not_found".to_owned(),
                    message: format!("Session {session_id} not found"),
                    session_id: Some(session_id.clone()),
                });
            }
            Err(e) => {
                errors.push(BatchErrorDto {
                    code: "session.not_found".to_owned(),
                    message: e,
                    session_id: Some(session_id.clone()),
                });
            }
            Ok(Some(session)) => {
                let batch_results = domain_batch_suggest(&[session], &masters, &types_ref, &config);
                for br in batch_results {
                    match br.result {
                        Err(error_code) => {
                            // Per-item guard failures go into results with their status.
                            for kind in &types_ref {
                                if let Some(ct) = kind_to_contract(*kind) {
                                    results.push(BatchSessionResultDto {
                                        session_id: session_id.clone(),
                                        calibration_type: ct,
                                        status: error_code.clone(),
                                        candidates: None,
                                    });
                                }
                            }
                        }
                        Ok(matches) => {
                            for kind in &types_ref {
                                if let Some(ct) = kind_to_contract(*kind) {
                                    let type_matches: Vec<_> = matches
                                        .iter()
                                        .filter(|m| m.calibration_type == *kind)
                                        .filter_map(match_to_dto)
                                        .map(|dto| apply_session_context(dto, &session_ctx))
                                        .collect();
                                    let kind_matches: Vec<_> = matches
                                        .iter()
                                        .filter(|m| m.calibration_type == *kind)
                                        .cloned()
                                        .collect();
                                    let status_str = if type_matches.is_empty() {
                                        "no_match"
                                    } else {
                                        suggest_status(&kind_matches)
                                    };
                                    results.push(BatchSessionResultDto {
                                        session_id: session_id.clone(),
                                        calibration_type: ct,
                                        status: status_str.to_owned(),
                                        candidates: if type_matches.is_empty() {
                                            None
                                        } else {
                                            Some(type_matches)
                                        },
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let top_status = if results.is_empty() && !errors.is_empty() {
        "error"
    } else if !errors.is_empty() {
        "partial"
    } else {
        "success"
    };

    Ok(CalibrationMatchBatchResponse {
        status: top_status.to_owned(),
        contract_version: BATCH_CONTRACT_VERSION.to_owned(),
        request_id: req.request_id,
        results: if results.is_empty() { None } else { Some(results) },
        errors: if errors.is_empty() { None } else { Some(errors) },
    })
}
