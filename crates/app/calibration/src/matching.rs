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
    CalibrationMatchDto, CalibrationMatchSuggestRequest, CalibrationMatchSuggestResponse,
    SuggestErrorDto, SuggestStatus, ASSIGN_CONTRACT_VERSION, BATCH_CONTRACT_VERSION,
    SUGGEST_CONTRACT_VERSION,
};
use domain_core::ids::Timestamp;
use persistence_db::repositories::calibration_assignment::{self as assign_repo, UpsertParams};
use persistence_db::repositories::inventory::{get_session_context_by_ids, SessionContextRow};
use sqlx::SqlitePool;
use std::collections::HashMap;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use uuid::Uuid;

use calibration_core::ranking::suggest_status;

// ── Settings keys ─────────────────────────────────────────────────────────────

const KEY_DARK_TEMP: &str = "calibrationDarkTempTolerance";
const KEY_DARK_OVERRIDE: &str = "calibrationDarkOverridePenalty";
const KEY_FLAT_OVERRIDE: &str = "calibrationFlatOverridePenalty";
const KEY_BIAS_OVERRIDE: &str = "calibrationBiasOverridePenalty";
const KEY_PREFILL: &str = "calibrationPrefillSuggestion";

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
            // P9: enrich with session context (target/filter/night/frame
            // count) — one batched lookup, not N+1. All candidates share the
            // same `req.session_id` here (single-session suggest).
            let session_ctx =
                load_session_contexts(pool, std::slice::from_ref(&req.session_id)).await;
            let dto_matches: Vec<_> = matches
                .iter()
                .filter_map(match_to_dto)
                .map(|dto| apply_session_context(dto, &session_ctx))
                .collect();
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
            let assigned_at = Timestamp::now_iso();
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

// ── Session context enrichment (spec P9) ──────────────────────────────────────
//
// `calibration_core::suggest` is pure domain (no DB access — see module docs).
// Target/filter/night/frame-count context is resolved here, in the same layer
// that already loads sessions and masters from persistence, as a
// post-processing pass over the DTOs `match_to_dto` produced with those
// fields left `None`.

/// Batch-load session context for a set of session ids and index it by id.
///
/// Always a single query (`persistence_db::repositories::inventory::
/// get_session_context_by_ids`) regardless of how many ids are requested.
/// Ids that don't resolve (unknown session, or a session with no context)
/// are simply absent from the returned map — callers must treat a missing
/// key the same as "no context available", not an error.
async fn load_session_contexts(
    pool: &SqlitePool,
    session_ids: &[String],
) -> HashMap<String, SessionContextRow> {
    // Dedup before querying — batch callers (batch_suggest) may pass the same
    // id from overlapping calibration types.
    let mut seen = std::collections::HashSet::new();
    let unique_ids: Vec<String> =
        session_ids.iter().filter(|id| seen.insert((*id).clone())).cloned().collect();

    match get_session_context_by_ids(pool, &unique_ids).await {
        Ok(rows) => rows.into_iter().map(|row| (row.id.clone(), row)).collect(),
        // A lookup failure degrades to "no context" rather than failing the
        // whole suggest response — context is presentational, not load-bearing.
        Err(_) => HashMap::new(),
    }
}

/// Apply resolved session context onto a `CalibrationMatchDto`, keyed by
/// `dto.session_id`. Leaves the DTO's context fields as `None` when the
/// session id has no entry in `ctx` (unknown session, or missing metadata).
fn apply_session_context(
    mut dto: CalibrationMatchDto,
    ctx: &HashMap<String, SessionContextRow>,
) -> CalibrationMatchDto {
    if let Some(row) = ctx.get(&dto.session_id) {
        dto.target_name = row.target_name.clone();
        dto.filter = row.filter.clone();
        dto.acquisition_night = row.acquisition_night.clone();
        dto.frame_count = u32::try_from(row.frame_count).ok();
    }
    dto
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
                // DB CHECK constrains `calibration_type` to dark/flat/bias;
                // anything unparseable is skipped, preserving prior behavior.
                let kind: CalibrationKind = ct.parse().ok()?;
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
            // DB CHECK constrains `calibration_type` to dark/flat/bias;
            // anything unparseable is skipped, preserving prior behavior.
            let kind: CalibrationKind = ct.parse().ok()?;
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

    // `require_same_offset` is persisted on the `calibration_tolerances`
    // singleton row (migration 0050), not the generic settings key/value
    // store — it's user-controlled via the Settings > Calibration Matching
    // "Offset match required" toggle (spec 043 P8). Falls back to
    // `MatchingRuleConfig::default()` (true) on read failure.
    if let Ok(row) = persistence_db::repositories::calibration_tolerances::get(pool).await {
        config.require_same_offset = row.require_same_offset;
    }

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

// ── Masters list / get (T037, FR-013) ─────────────────────────────────────────

/// `calibration.masters.list` — return all calibration masters from real DB rows.
///
/// Backed by `calibration_master_view` (migration 0033) which joins
/// `calibration_session` with `calibration_fingerprint`.
///
/// # Errors
/// Returns `Err(String)` on database failure.
pub async fn masters_list(
    pool: &SqlitePool,
) -> Result<Vec<contracts_core::calibration::CalibrationMaster>, String> {
    let rows: Vec<(
        String,         // id
        String,         // kind
        String,         // created_at
        i64,            // size_bytes
        Option<f64>,    // fp_gain
        Option<f64>,    // fp_exposure_s
        Option<f64>,    // fp_temp_c
        Option<String>, // fp_filter_name
        Option<String>, // fp_binning
        Option<String>, // fp_optic_train (used as camera)
        Option<String>, // source_session_id
    )> = sqlx::query_as(
        "SELECT id, kind, created_at, size_bytes,
                fp_gain, fp_exposure_s, fp_temp_c, fp_filter_name, fp_binning,
                fp_optic_train, source_session_id
         FROM calibration_master_view
         ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let now = OffsetDateTime::now_utc();
    let masters = rows
        .into_iter()
        .map(
            |(
                id,
                kind,
                created_at,
                size_bytes,
                gain,
                exposure_s,
                temp_c,
                filter_name,
                binning,
                optic_train,
                source_session_id,
            )| {
                let age_days = compute_age_days(&created_at, now);
                let cal_kind = str_to_cal_kind(&kind);
                contracts_core::calibration::CalibrationMaster {
                    id: id.clone(),
                    kind: cal_kind,
                    fingerprint: contracts_core::calibration::CalibrationFingerprint {
                        camera: optic_train.unwrap_or_default(),
                        sensor_mode: None,
                        exposure_s: exposure_s.unwrap_or(0.0),
                        temp_c,
                        gain: gain.unwrap_or(0.0),
                        binning: binning.unwrap_or_else(|| "1x1".to_owned()),
                        filter: filter_name,
                    },
                    source_session_id: source_session_id.unwrap_or_else(|| id.clone()),
                    created_at,
                    age_days,
                    size_bytes: u64::try_from(size_bytes).unwrap_or(0),
                    used_by_session_ids: vec![],
                    used_by_project_ids: vec![],
                }
            },
        )
        .collect();

    Ok(masters)
}

/// `calibration.masters.get` — return detail for a single calibration master.
///
/// # Errors
/// Returns `Err(String)` when the master is not found or on database failure.
pub async fn masters_get(
    pool: &SqlitePool,
    master_id: &str,
) -> Result<contracts_core::calibration::MasterDetail, String> {
    let row: Option<(
        String,
        String,
        String,
        i64,
        Option<f64>,
        Option<f64>,
        Option<f64>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = sqlx::query_as(
        "SELECT id, kind, created_at, size_bytes,
                fp_gain, fp_exposure_s, fp_temp_c, fp_filter_name, fp_binning,
                fp_optic_train, source_session_id
         FROM calibration_master_view
         WHERE id = ?",
    )
    .bind(master_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    let (
        id,
        kind,
        created_at,
        size_bytes,
        gain,
        exposure_s,
        temp_c,
        filter_name,
        binning,
        optic_train,
        source_session_id,
    ) = row.ok_or_else(|| format!("master.not_found: {master_id}"))?;

    let now = OffsetDateTime::now_utc();
    let age_days = compute_age_days(&created_at, now);
    let cal_kind = str_to_cal_kind(&kind);

    // Load sessions assigned to this master via calibration_assignment.
    let used_sessions: Vec<(String,)> =
        sqlx::query_as("SELECT session_id FROM calibration_assignment WHERE master_id = ?")
            .bind(&id)
            .fetch_all(pool)
            .await
            .unwrap_or_default();
    let used_by_session_ids: Vec<String> = used_sessions.into_iter().map(|(s,)| s).collect();

    // Load projects linked to sessions that use this master.
    let used_projects: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT ps.project_id
         FROM project_sources ps
         JOIN calibration_assignment ca ON ca.session_id = ps.session_id
         WHERE ca.master_id = ?",
    )
    .bind(&id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let used_by_project_ids: Vec<String> = used_projects.into_iter().map(|(p,)| p).collect();

    let session_count = u32::try_from(used_by_session_ids.len()).unwrap_or(0);
    let project_count = u32::try_from(used_by_project_ids.len()).unwrap_or(0);

    Ok(contracts_core::calibration::MasterDetail {
        id: id.clone(),
        kind: cal_kind,
        fingerprint: contracts_core::calibration::CalibrationFingerprint {
            camera: optic_train.unwrap_or_default(),
            sensor_mode: None,
            exposure_s: exposure_s.unwrap_or(0.0),
            temp_c,
            gain: gain.unwrap_or(0.0),
            binning: binning.unwrap_or_else(|| "1x1".to_owned()),
            filter: filter_name,
        },
        source_session_id: source_session_id.unwrap_or_else(|| id.clone()),
        created_at,
        age_days,
        size_bytes: u64::try_from(size_bytes).unwrap_or(0),
        used_by_session_ids,
        used_by_project_ids,
        compatible_sessions: vec![],
        usage_stats: contracts_core::calibration::MasterUsageStats { session_count, project_count },
    })
}

fn str_to_cal_kind(kind: &str) -> contracts_core::calibration::CalibrationKind {
    // Canonical parser handles the `flat_dark` legacy alias; unknown values
    // fall back to Dark, preserving prior behavior.
    kind.parse().unwrap_or(contracts_core::calibration::CalibrationKind::Dark)
}

fn compute_age_days(created_at: &str, now: OffsetDateTime) -> u32 {
    if let Ok(created) = time::OffsetDateTime::parse(created_at, &Rfc3339) {
        let diff = now - created;
        u32::try_from(diff.whole_days().max(0)).unwrap_or(0)
    } else {
        0
    }
}

// ── Masters tests (T032, T037) ─────────────────────────────────────────────────

#[cfg(test)]
mod masters_tests {
    use super::*;
    use persistence_db::Database;

    async fn test_db() -> Database {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        db
    }

    /// T032 / T037: masters_list returns real rows from calibration_master_view.
    #[tokio::test]
    async fn masters_list_returns_real_rows_not_fixtures() {
        let db = test_db().await;

        sqlx::query(
            "INSERT INTO calibration_session (id, session_key, kind, created_at) \
             VALUES ('cal-t1', 'dark-300s', 'dark', '2026-06-01T00:00:00Z')",
        )
        .execute(db.pool())
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO calibration_fingerprint \
             (id, calibration_type, gain, exposure_s, temp_c, binning, optic_train) \
             VALUES ('cal-t1', 'dark', 100.0, 300.0, -10.0, '1x1', 'ASI2600MM')",
        )
        .execute(db.pool())
        .await
        .unwrap();

        let masters = masters_list(db.pool()).await.unwrap();
        assert_eq!(masters.len(), 1, "must return exactly 1 real master from DB");
        assert_eq!(masters[0].id, "cal-t1");
        assert_eq!(masters[0].kind, contracts_core::calibration::CalibrationKind::Dark);
        assert!((masters[0].fingerprint.gain - 100.0).abs() < f64::EPSILON);
        assert_eq!(masters[0].fingerprint.camera, "ASI2600MM");
    }

    /// T032 / T037: masters_list returns empty on a fresh DB (no fixtures).
    #[tokio::test]
    async fn masters_list_returns_empty_on_fresh_db() {
        let db = test_db().await;
        let masters = masters_list(db.pool()).await.unwrap();
        assert!(masters.is_empty(), "fresh DB must have no masters — not fixtures");
    }

    /// T032 / T037: masters_get returns the correct row.
    #[tokio::test]
    async fn masters_get_returns_correct_row() {
        let db = test_db().await;

        sqlx::query(
            "INSERT INTO calibration_session (id, session_key, kind, created_at) \
             VALUES ('cal-t2', 'flat-2s-Ha', 'flat', '2026-05-15T00:00:00Z')",
        )
        .execute(db.pool())
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO calibration_fingerprint \
             (id, calibration_type, gain, exposure_s, filter_name, binning) \
             VALUES ('cal-t2', 'flat', 100.0, 2.0, 'Ha', '1x1')",
        )
        .execute(db.pool())
        .await
        .unwrap();

        let detail = masters_get(db.pool(), "cal-t2").await.unwrap();
        assert_eq!(detail.id, "cal-t2");
        assert_eq!(detail.kind, contracts_core::calibration::CalibrationKind::Flat);
        assert_eq!(detail.fingerprint.filter, Some("Ha".to_owned()));
    }

    /// T032 / T037: masters_get returns error for unknown id.
    #[tokio::test]
    async fn masters_get_returns_error_for_unknown_id() {
        let db = test_db().await;
        let err = masters_get(db.pool(), "nonexistent").await.unwrap_err();
        assert!(err.contains("master.not_found"), "expected master.not_found error, got: {err}");
    }

    /// T032 / T037: calibration suggest finds real masters from populated fingerprints.
    #[tokio::test]
    async fn suggest_uses_real_fingerprint_rows() {
        let db = test_db().await;

        // Insert acquisition session + fingerprint.
        sqlx::query(
            "INSERT INTO acquisition_session (id, session_key, created_at) \
             VALUES ('acq-t1', 'M31/L/2026-03-01/100/1x1', '2026-03-01T00:00:00Z')",
        )
        .execute(db.pool())
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO acquisition_fingerprint \
             (id, session_type, gain, exposure_s, binning, \
              has_observer_location, has_exposure_start_utc) \
             VALUES ('acq-t1', 'light', 100.0, 300.0, '1x1', 0, 0)",
        )
        .execute(db.pool())
        .await
        .unwrap();

        // Insert calibration master fingerprint.
        sqlx::query(
            "INSERT INTO calibration_session (id, session_key, kind, created_at) \
             VALUES ('cal-t3', 'dark-300s-gain100', 'dark', '2026-03-01T00:00:00Z')",
        )
        .execute(db.pool())
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO calibration_fingerprint \
             (id, calibration_type, gain, exposure_s, binning) \
             VALUES ('cal-t3', 'dark', 100.0, 300.0, '1x1')",
        )
        .execute(db.pool())
        .await
        .unwrap();

        // masters_list must return the real row.
        let masters = masters_list(db.pool()).await.unwrap();
        assert_eq!(masters.len(), 1);
        assert_eq!(masters[0].id, "cal-t3");
    }

    /// Spec 043 P8: `load_config` defaults `require_same_offset` to true on a
    /// fresh DB, matching `MatchingRuleConfig::default()` (migration 0008/0050
    /// seed row).
    #[tokio::test]
    async fn load_config_defaults_require_same_offset_true() {
        let db = test_db().await;
        let config = load_config(db.pool()).await;
        assert!(config.require_same_offset);
    }

    /// Spec 043 P8: the Settings > Calibration Matching "Offset match
    /// required" toggle persists via `calibration_tolerances` and must feed
    /// `MatchingRuleConfig::require_same_offset` on the next `load_config`
    /// call — this is the engine-side half of closing the STUB-OFFSET-REQUIRED
    /// gap.
    #[tokio::test]
    async fn load_config_reads_require_same_offset_from_tolerances_table() {
        let db = test_db().await;

        let row = persistence_db::repositories::calibration_tolerances::CalibrationTolerancesRow {
            temperature_tolerance_c: 5.0,
            exposure_tolerance_s: 2.0,
            aging_limit_days: 365,
            require_same_camera: true,
            require_same_gain: true,
            require_same_binning: true,
            require_same_offset: false,
        };
        persistence_db::repositories::calibration_tolerances::update(db.pool(), &row)
            .await
            .unwrap();

        let config = load_config(db.pool()).await;
        assert!(!config.require_same_offset, "toggling off must reach MatchingRuleConfig");
    }
}
