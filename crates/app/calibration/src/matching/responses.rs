// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Error-response builders shared by `suggest`, `batch_suggest`, and `assign`.

use contracts_core::calibration_match::{
    AssignErrorDetails, AssignErrorDto, CalibrationMatchAssignResponse,
    CalibrationMatchSuggestResponse, SuggestErrorDto, SuggestStatus, ASSIGN_CONTRACT_VERSION,
    SUGGEST_CONTRACT_VERSION,
};

pub(super) fn error_suggest_response(
    request_id: &str,
    code: &str,
    message: &str,
) -> CalibrationMatchSuggestResponse {
    CalibrationMatchSuggestResponse {
        status: "error".to_owned(),
        contract_version: SUGGEST_CONTRACT_VERSION.to_owned(),
        request_id: request_id.to_owned(),
        suggest_status: None,
        matches: None,
        error: Some(SuggestErrorDto { code: code.to_owned(), message: message.to_owned() }),
    }
}

pub(super) fn guard_error_suggest_response(
    request_id: &str,
    error_code: &str,
) -> CalibrationMatchSuggestResponse {
    let suggest_status = match error_code {
        "match.observer_location_missing" => Some(SuggestStatus::ObserverLocationMissing),
        _ => None,
    };
    CalibrationMatchSuggestResponse {
        status: "error".to_owned(),
        contract_version: SUGGEST_CONTRACT_VERSION.to_owned(),
        request_id: request_id.to_owned(),
        suggest_status,
        matches: None,
        error: Some(SuggestErrorDto {
            code: error_code.to_owned(),
            message: format!("Suggestion failed: {error_code}"),
        }),
    }
}

pub(super) fn error_assign_response(
    request_id: &str,
    code: &str,
    message: &str,
    dimensions: Option<Vec<String>>,
) -> CalibrationMatchAssignResponse {
    CalibrationMatchAssignResponse {
        status: "error".to_owned(),
        contract_version: ASSIGN_CONTRACT_VERSION.to_owned(),
        request_id: request_id.to_owned(),
        assigned: None,
        confidence: None,
        error: Some(AssignErrorDto {
            code: code.to_owned(),
            message: message.to_owned(),
            details: dimensions.map(|d| AssignErrorDetails { dimensions: d }),
        }),
    }
}
