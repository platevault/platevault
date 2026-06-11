//! Calibration matching use cases (spec 007).
//!
//! Entry points:
//! - `suggest` — suggest ranked calibration masters for a single session.
//! - `batch_suggest` — suggest for multiple sessions in one call.
//! - `assign` — persist a calibration master assignment with override semantics.
//!
//! # Architecture
//!
//! The matching engine lives in `calibration_core` (pure domain, no DB access).
//! This module bridges the domain engine with persistence:
//!   1. Loads session fingerprint from `acquisition_fingerprint` table.
//!   2. Loads master fingerprints from `calibration_fingerprint` table.
//!   3. Loads `MatchingRuleConfig` from settings keys.
//!   4. Delegates to the domain engine.
//!   5. Maps results to contract DTOs.
//!   6. For `assign`: writes to `calibration_assignment` and emits audit events.
//!
//! Fingerprint tables (migration 0023) are populated by the metadata extraction
//! pipeline (spec 005 ripple). Until a session has a fingerprint row, it returns
//! `observer_location_missing` status.
//!
//! Constitution V: assignments are durable records in SQLite.
//! Constitution II: confidence is always captured at assignment time.
//! Constitution III: this module NEVER calibrates images.

#![allow(
    clippy::doc_markdown,    // spec/domain terminology
    clippy::too_many_lines,  // use-case orchestration functions are inherently multi-step
    clippy::type_complexity, // DB tuple rows are intentionally typed inline
)]

use audit::bus::EventBus;
use audit::event_bus::Source;
use calibration_core::assign::{dimension_names, evaluate_assign, AssignError};
use calibration_core::ranking::MatchingRuleConfig;
use calibration_core::{
    batch_suggest as domain_batch_suggest, suggest as domain_suggest, CalibrationKind, MasterInfo,
    SessionInfo,
};
use contracts_core::calibration_match::{
    contract_to_kind, kind_to_contract, match_to_dto, AssignErrorDetails, AssignErrorDto,
    AssignedDto, BatchErrorDto, BatchSessionResultDto, CalibrationMatchAssignRequest,
    CalibrationMatchAssignResponse, CalibrationMatchBatchRequest, CalibrationMatchBatchResponse,
    CalibrationMatchSuggestRequest, CalibrationMatchSuggestResponse, SuggestErrorDto,
    SuggestStatus, ASSIGN_CONTRACT_VERSION, BATCH_CONTRACT_VERSION, SUGGEST_CONTRACT_VERSION,
};
use persistence_db::repositories::calibration_assignment::{self as assign_repo, UpsertParams};
use sqlx::SqlitePool;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use uuid::Uuid;

use calibration_core::ranking::suggest_status;

// ── Settings keys ─────────────────────────────────────────────────────────────

const KEY_DARK_TEMP: &str = "calibration.dark_temp_tolerance";
const KEY_DARK_OVERRIDE: &str = "calibration.dark.override_penalty";
const KEY_FLAT_OVERRIDE: &str = "calibration.flat.override_penalty";
const KEY_BIAS_OVERRIDE: &str = "calibration.bias.override_penalty";
const KEY_PREFILL: &str = "calibration.prefill_suggestion";

// ── Suggest (single session) ──────────────────────────────────────────────────

/// `calibration.match.suggest` — suggest ranked calibration masters for one session.
///
/// # Errors
/// Returns `Err(String)` on database error.
pub async fn suggest(
    pool: &SqlitePool,
    req: CalibrationMatchSuggestRequest,
) -> Result<CalibrationMatchSuggestResponse, String> {
    let config = load_config(pool).await;

    let session = match load_session(pool, &req.session_id).await {
        Ok(Some(s)) => s,
        Ok(None) => {
            return Ok(error_suggest_response(
                &req.request_id,
                "session.not_found",
                &format!("Session {} not found", req.session_id),
            ));
        }
        Err(e) => return Err(e),
    };

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

    match domain_suggest(&session, &masters, &types_ref, &config) {
        Err(error_code) => Ok(guard_error_suggest_response(&req.request_id, &error_code)),
        Ok(matches) => {
            let status_str = suggest_status(&matches);
            let suggest_status = match status_str {
                "match" => SuggestStatus::Match,
                "ambiguous" => SuggestStatus::Ambiguous,
                _ => SuggestStatus::NoMatch,
            };
            let dto_matches: Vec<_> = matches.iter().filter_map(match_to_dto).collect();
            Ok(CalibrationMatchSuggestResponse {
                status: "success".to_owned(),
                contract_version: SUGGEST_CONTRACT_VERSION.to_owned(),
                request_id: req.request_id,
                suggest_status: Some(suggest_status),
                matches: Some(dto_matches),
                error: None,
            })
        }
    }
}

// ── Batch suggest ─────────────────────────────────────────────────────────────

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

// ── Assign ────────────────────────────────────────────────────────────────────

/// `calibration.match.assign` — persist a calibration master assignment.
///
/// # Errors
/// Returns `Err(String)` on database error.
pub async fn assign(
    pool: &SqlitePool,
    bus: &EventBus,
    req: CalibrationMatchAssignRequest,
) -> Result<CalibrationMatchAssignResponse, String> {
    let config = load_config(pool).await;

    let session = match load_session(pool, &req.session_id).await {
        Ok(Some(s)) => s,
        Ok(None) => {
            return Ok(error_assign_response(
                &req.request_id,
                "session.not_found",
                &format!("Session {} not found", req.session_id),
                None,
            ));
        }
        Err(e) => return Err(e),
    };

    let master = match load_master_by_id(pool, &req.master_id).await {
        Ok(Some(m)) => m,
        Ok(None) => {
            return Ok(error_assign_response(
                &req.request_id,
                "master.not_found",
                &format!("Master {} not found", req.master_id),
                None,
            ));
        }
        Err(e) => return Err(e),
    };

    match evaluate_assign(&session, &master, req.r#override, &config) {
        Err(AssignError::SessionMixedState) => Ok(error_assign_response(
            &req.request_id,
            "session.mixed_state",
            "Session is mixed; split it first",
            None,
        )),
        Err(AssignError::ObserverLocationMissing) => Ok(error_assign_response(
            &req.request_id,
            "match.observer_location_missing",
            "Session is missing observer_location or exposure_start_utc",
            None,
        )),
        Err(AssignError::IncompatibleDimensions { dimensions }) => {
            let dim_names = dimension_names(&dimensions);
            Ok(error_assign_response(
                &req.request_id,
                "incompatible.dimensions",
                "Master has incompatible hard-rule dimensions; use override=true to force",
                Some(dim_names),
            ))
        }
        Ok(decision) => {
            let calibration_type = kind_to_contract(master.kind)
                .ok_or_else(|| "dark_flat type cannot be assigned in v1".to_owned())?;

            let assignment_id = Uuid::new_v4().to_string();
            let assigned_at = now_iso();
            let mismatch_names = dimension_names(&decision.mismatched_dimensions);

            assign_repo::upsert(
                pool,
                UpsertParams {
                    id: &assignment_id,
                    session_id: &req.session_id,
                    calibration_type: master.kind.as_str(),
                    master_id: &req.master_id,
                    confidence: decision.confidence,
                    was_override: decision.was_override,
                    mismatched_dimensions: &mismatch_names,
                    assigned_at: Some(&assigned_at),
                },
            )
            .await
            .map_err(|e| e.to_string())?;

            // Emit audit event (T030).
            let _ = bus
                .publish(
                    "calibration.assignment.created",
                    Source::User,
                    serde_json::json!({
                        "assignmentId": assignment_id,
                        "sessionId": req.session_id,
                        "masterId": req.master_id,
                        "calibrationType": master.kind.as_str(),
                        "confidence": decision.confidence,
                        "wasOverride": decision.was_override,
                        "mismatchedDimensions": mismatch_names,
                    }),
                )
                .await;

            Ok(CalibrationMatchAssignResponse {
                status: "success".to_owned(),
                contract_version: ASSIGN_CONTRACT_VERSION.to_owned(),
                request_id: req.request_id,
                assigned: Some(AssignedDto {
                    assignment_id,
                    session_id: req.session_id,
                    master_id: req.master_id,
                    calibration_type,
                    was_override: decision.was_override,
                    mismatched_dimensions: if decision.mismatched_dimensions.is_empty() {
                        None
                    } else {
                        Some(dimension_names(&decision.mismatched_dimensions))
                    },
                    assigned_at,
                }),
                confidence: Some(decision.confidence),
                error: None,
            })
        }
    }
}

// ── Response builders ─────────────────────────────────────────────────────────

fn error_suggest_response(
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

fn guard_error_suggest_response(
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

fn error_assign_response(
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

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_iso() -> String {
    OffsetDateTime::now_utc().format(&Rfc3339).unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

// ── DB loading helpers ────────────────────────────────────────────────────────

/// Load `SessionInfo` from the `acquisition_fingerprint` table (migration 0023).
///
/// Returns `None` when no fingerprint exists for the session.
async fn load_session(pool: &SqlitePool, session_id: &str) -> Result<Option<SessionInfo>, String> {
    // Validate session exists first (for proper "not found" error).
    let exists: Option<(String,)> =
        sqlx::query_as("SELECT id FROM acquisition_session WHERE id = ?")
            .bind(session_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;

    if exists.is_none() {
        return Ok(None);
    }

    // Try to load fingerprint.
    let row: Option<(
        String,         // id
        Option<String>, // session_type
        Option<f64>,    // gain
        Option<f64>,    // offset_val
        Option<f64>,    // exposure_s
        Option<f64>,    // temp_c
        Option<String>, // filter_name
        Option<f64>,    // rotation_deg
        Option<String>, // binning
        Option<String>, // optic_train
        Option<String>, // observing_night_date
        Option<i64>,    // has_observer_location
        Option<i64>,    // has_exposure_start_utc
    )> = sqlx::query_as(
        "
        SELECT id, session_type, gain, offset_val, exposure_s,
               temp_c, filter_name, rotation_deg, binning, optic_train,
               observing_night_date, has_observer_location, has_exposure_start_utc
        FROM acquisition_fingerprint
        WHERE id = ?
        ",
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(Some(match row {
        Some((
            id,
            session_type,
            gain,
            offset,
            exposure_s,
            temp_c,
            filter,
            rotation_deg,
            binning,
            optic_train,
            observing_night_date,
            has_observer_location,
            has_exposure_start_utc,
        )) => SessionInfo {
            id,
            session_type: session_type.unwrap_or_else(|| "light".to_owned()),
            gain,
            offset,
            exposure_s,
            temp_c,
            filter,
            rotation_deg,
            binning,
            optic_train,
            observing_night_date,
            has_observer_location: has_observer_location.unwrap_or(0) != 0,
            has_exposure_start_utc: has_exposure_start_utc.unwrap_or(0) != 0,
        },
        // No fingerprint row → session exists but has no metadata.
        // Guard A6 will reject with observer_location_missing.
        None => SessionInfo {
            id: session_id.to_owned(),
            session_type: "light".to_owned(),
            has_observer_location: false,
            has_exposure_start_utc: false,
            ..Default::default()
        },
    }))
}

/// Load `MasterInfo` rows from `calibration_fingerprint` table (migration 0023).
async fn load_masters(
    pool: &SqlitePool,
    kinds: &[CalibrationKind],
) -> Result<Vec<MasterInfo>, String> {
    let rows: Vec<(
        String,         // id
        String,         // calibration_type
        Option<f64>,    // gain
        Option<f64>,    // offset_val
        Option<f64>,    // exposure_s
        Option<f64>,    // temp_c
        Option<String>, // filter_name
        Option<f64>,    // rotation_deg
        Option<String>, // binning
        Option<String>, // optic_train
        Option<String>, // source_session_id
        Option<String>, // observing_night_date
    )> = sqlx::query_as(
        "
        SELECT id, calibration_type, gain, offset_val, exposure_s,
               temp_c, filter_name, rotation_deg, binning, optic_train,
               source_session_id, observing_night_date
        FROM calibration_fingerprint
        WHERE calibration_type IN ('dark', 'flat', 'bias')
        ",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let type_filter: Vec<&str> = kinds
        .iter()
        .filter_map(|k| match k {
            CalibrationKind::Dark => Some("dark"),
            CalibrationKind::Flat => Some("flat"),
            CalibrationKind::Bias => Some("bias"),
            CalibrationKind::DarkFlat => None,
        })
        .collect();

    Ok(rows
        .into_iter()
        .filter(|(_, ct, ..)| type_filter.is_empty() || type_filter.contains(&ct.as_str()))
        .filter_map(
            |(
                id,
                ct,
                gain,
                offset,
                exposure_s,
                temp_c,
                filter,
                rotation_deg,
                binning,
                optic_train,
                source_session_id,
                observing_night_date,
            )| {
                let kind = match ct.as_str() {
                    "dark" => CalibrationKind::Dark,
                    "flat" => CalibrationKind::Flat,
                    "bias" => CalibrationKind::Bias,
                    _ => return None,
                };
                Some(MasterInfo {
                    id,
                    kind,
                    gain,
                    offset,
                    exposure_s,
                    temp_c,
                    filter,
                    rotation_deg,
                    binning,
                    optic_train,
                    source_session_id,
                    observing_night_date,
                })
            },
        )
        .collect())
}

/// Load a single `MasterInfo` by id from `calibration_fingerprint`.
async fn load_master_by_id(
    pool: &SqlitePool,
    master_id: &str,
) -> Result<Option<MasterInfo>, String> {
    let row: Option<(
        String,
        String,
        Option<f64>,
        Option<f64>,
        Option<f64>,
        Option<f64>,
        Option<String>,
        Option<f64>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = sqlx::query_as(
        "
        SELECT id, calibration_type, gain, offset_val, exposure_s,
               temp_c, filter_name, rotation_deg, binning, optic_train,
               source_session_id, observing_night_date
        FROM calibration_fingerprint
        WHERE id = ?
        ",
    )
    .bind(master_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(row.and_then(
        |(
            id,
            ct,
            gain,
            offset,
            exposure_s,
            temp_c,
            filter,
            rotation_deg,
            binning,
            optic_train,
            source_session_id,
            observing_night_date,
        )| {
            let kind = match ct.as_str() {
                "dark" => CalibrationKind::Dark,
                "flat" => CalibrationKind::Flat,
                "bias" => CalibrationKind::Bias,
                _ => return None,
            };
            Some(MasterInfo {
                id,
                kind,
                gain,
                offset,
                exposure_s,
                temp_c,
                filter,
                rotation_deg,
                binning,
                optic_train,
                source_session_id,
                observing_night_date,
            })
        },
    ))
}

/// Load `MatchingRuleConfig` from persisted settings keys, falling back to defaults.
async fn load_config(pool: &SqlitePool) -> MatchingRuleConfig {
    let mut config = MatchingRuleConfig::default();

    if let Ok(Some(v)) = persistence_db::repositories::settings::get_raw(pool, KEY_DARK_TEMP).await
    {
        if let Some(n) = v.as_f64() {
            config.dark_temp_tolerance_c = n;
        }
    }
    if let Ok(Some(v)) =
        persistence_db::repositories::settings::get_raw(pool, KEY_DARK_OVERRIDE).await
    {
        if let Some(n) = v.as_f64() {
            config.dark_override_penalty = n;
        }
    }
    if let Ok(Some(v)) =
        persistence_db::repositories::settings::get_raw(pool, KEY_FLAT_OVERRIDE).await
    {
        if let Some(n) = v.as_f64() {
            config.flat_override_penalty = n;
        }
    }
    if let Ok(Some(v)) =
        persistence_db::repositories::settings::get_raw(pool, KEY_BIAS_OVERRIDE).await
    {
        if let Some(n) = v.as_f64() {
            config.bias_override_penalty = n;
        }
    }
    if let Ok(Some(v)) = persistence_db::repositories::settings::get_raw(pool, KEY_PREFILL).await {
        if let Some(b) = v.as_bool() {
            config.prefill_suggestion = b;
        }
    }
    config
}
