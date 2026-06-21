//! Inventory use cases (spec 006).
//!
//! - `list`: produce the `InventorySource[]` projection with optional filters.
//! - `review_session`: wrapper around `lifecycle.transition` for session
//!   review-state transitions from the Inventory surface.
//!
//! # Architecture
//!
//! `list` is a read-only projection: it joins `library_root`,
//! `acquisition_session`, `calibration_session`, and `project_sources` to
//! produce the contract DTOs without storing any new rows.
//!
//! `review_session` delegates to the spec-002 `apply_transition` use case and
//! enforces two inventory-specific guards:
//!
//! - If the session's owning `LibraryRoot` is `disabled`, review transitions
//!   are refused with `transition.refused` + `{reason: "source_disabled"}`.
//! - If the session `type == "mixed"`, the review transition is refused with
//!   `session.mixed_state` — the user must split via spec 005 first.

//!
//! Extracted from `app_core` into its own crate (spec 042 / T253 O3b). Its only
//! cross-module dependency is on the now-extracted `app_core_lifecycle` crate
//! (`lifecycle_use_case`, `transition_use_case`); nothing else in `app_core`
//! references it. `app_core` re-exports this crate at `app_core::inventory` so
//! the public surface stays byte-identical.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks

use std::collections::HashMap;

use audit::bus::EventBus;
use contracts_core::inventory::{
    InventoryFrameType, InventoryLinkedRefs, InventoryListFilters, InventoryProvenanceSummary,
    InventorySession, InventorySessionReviewRequest, InventorySessionReviewResponse,
    InventorySessionState, InventorySource, InventorySourceKind, InventorySourceState,
    LinkedProjectRef,
};
use contracts_core::lifecycle::{
    CalibrationSessionTransitionRequest, InventorySessionTransitionRequest,
    SessionState as ContractSessionState, TransitionActor, TransitionRequest, TransitionStatus,
};
use contracts_core::JsonAny;
use persistence_db::repositories::inventory::{
    get_acquisition_session_state, get_calibration_session_state, get_library_root_state,
    list_project_links_for_sessions, list_roots_with_sessions, list_sessions_for_root,
    InventoryFilters, SessionProjectionRow,
};
use sqlx::SqlitePool;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::lifecycle::lifecycle_use_case::build_edge_table;
use crate::lifecycle::transition_use_case::apply_transition;

// ── list ─────────────────────────────────────────────────────────────────────

/// Produce the inventory ledger as `InventorySource[]`, applying optional
/// filters server-side.
///
/// # Errors
/// Returns a descriptive `String` on database error.
pub async fn list(
    pool: &SqlitePool,
    filters: Option<InventoryListFilters>,
) -> Result<Vec<InventorySource>, String> {
    let db_filters = filters_to_db(filters.as_ref());

    let roots = list_roots_with_sessions(pool).await.map_err(|e| e.to_string())?;

    let mut sources: Vec<InventorySource> = Vec::new();

    for root in &roots {
        // Skip roots not matching a source_filter when set.
        if let Some(ref sf) = db_filters.source_id {
            if &root.id != sf {
                continue;
            }
        }

        let sessions =
            list_sessions_for_root(pool, &root.id, &db_filters).await.map_err(|e| e.to_string())?;

        if sessions.is_empty() {
            // Omit sources that have no visible sessions after filtering.
            continue;
        }

        // Collect session ids for batch project-link lookup.
        let session_ids: Vec<String> = sessions.iter().map(|s| s.id.clone()).collect();
        let project_links =
            list_project_links_for_sessions(pool, &session_ids).await.map_err(|e| e.to_string())?;

        // Build a map: session_id → Vec<(project_id, project_name)>
        let mut proj_map: HashMap<String, Vec<(String, String)>> = HashMap::new();
        for link in project_links {
            proj_map.entry(link.session_id).or_default().push((link.project_id, link.project_name));
        }

        let inventory_sessions: Vec<InventorySession> =
            sessions.into_iter().map(|row| project_row_to_session(row, &proj_map)).collect();

        sources.push(InventorySource {
            id: root.id.clone(),
            path: root.current_path.clone(),
            kind: map_source_kind(&root.kind),
            state: map_source_state(&root.state),
            sessions: inventory_sessions,
        });
    }

    Ok(sources)
}

// ── review_session ────────────────────────────────────────────────────────────

/// Apply a session review-state transition from the Inventory surface.
///
/// Pre-conditions checked before delegating to `lifecycle.transition`:
/// 1. Session must exist (otherwise `session.not_found`).
/// 2. Owning `LibraryRoot` must not be `disabled` (otherwise
///    `transition.refused` + `reason: "source_disabled"`).
/// 3. Session type must not be `mixed` (otherwise `session.mixed_state`).
///
/// Idempotency: same-state re-application returns `status: "noop"` (spec 002,
/// inherited from `apply_transition`).
///
/// # Errors
/// Returns an `InventorySessionReviewResponse` with `status: "error"` on
/// any precondition failure or lifecycle refusal.
pub async fn review_session(
    pool: &SqlitePool,
    repo: &(impl persistence_db::repositories::lifecycle::LifecycleRepository + Sync),
    bus: &EventBus,
    req: InventorySessionReviewRequest,
) -> InventorySessionReviewResponse {
    let request_id = req.request_id.clone();

    // 1. Resolve session kind + current state + root_id.
    let (entity_type_str, current_state, root_id_opt) =
        match resolve_session(pool, &req.session_id).await {
            Ok(Some(t)) => t,
            Ok(None) => {
                return InventorySessionReviewResponse::error(
                    request_id,
                    "session.not_found",
                    format!("session {} not found", req.session_id),
                );
            }
            Err(e) => {
                return InventorySessionReviewResponse::error(request_id, "transition.refused", e);
            }
        };

    // 2. Source-state guard: refuse transitions on `disabled` roots.
    if let Some(ref root_id) = root_id_opt {
        match get_library_root_state(pool, root_id).await {
            Ok(Some(ref s)) if s == "disabled" => {
                return InventorySessionReviewResponse::error_with_details(
                    request_id,
                    "transition.refused",
                    "source is disabled; review transitions are not allowed".to_owned(),
                    JsonAny::new(serde_json::json!({ "reason": "source_disabled" })),
                );
            }
            Ok(_) => {}
            Err(e) => {
                return InventorySessionReviewResponse::error(
                    request_id,
                    "transition.refused",
                    e.to_string(),
                );
            }
        }
    }

    // 3. Build the lifecycle.transition request.
    let actor = if req.actor == "system" { TransitionActor::System } else { TransitionActor::User };

    // Parse entity UUID.
    let Ok(entity_uuid) = Uuid::parse_str(&req.session_id) else {
        return InventorySessionReviewResponse::error(
            request_id,
            "session.not_found",
            format!("invalid session id: {}", req.session_id),
        );
    };

    // Map string states to typed contract enums.
    let current_contract = str_to_contract_state(&current_state);
    let next_contract = inventory_state_to_contract(req.next_state);

    let transition_req = if entity_type_str == "acquisition_session" {
        TransitionRequest::InventorySession(InventorySessionTransitionRequest {
            contract_version: "2.0.0".to_owned(),
            request_id: Uuid::new_v4(),
            entity_type: "inventory_session".to_owned(),
            entity_id: entity_uuid,
            current_state: current_contract,
            next_state: next_contract,
            actor,
            action_label: req.action_label.clone(),
        })
    } else {
        TransitionRequest::CalibrationSession(CalibrationSessionTransitionRequest {
            contract_version: "2.0.0".to_owned(),
            request_id: Uuid::new_v4(),
            entity_type: "calibration_session".to_owned(),
            entity_id: entity_uuid,
            current_state: current_contract,
            next_state: next_contract,
            actor,
            action_label: req.action_label.clone(),
        })
    };

    let edge_table = build_edge_table();
    let resp = apply_transition(repo, bus, transition_req, &edge_table).await;

    // Map the lifecycle.transition response to the inventory.session.review contract.
    match resp.status {
        TransitionStatus::Success => {
            let prior = parse_state(&resp.prior_state.unwrap_or_default());
            let new = parse_state(&resp.new_state.unwrap_or_default());
            let applied_at = resp
                .applied_at
                .unwrap_or_else(|| OffsetDateTime::now_utc().format(&Rfc3339).unwrap_or_default());
            InventorySessionReviewResponse::success(
                request_id,
                applied_at,
                entity_type_str,
                prior,
                new,
                resp.audit_id.map(|u| u.to_string()).unwrap_or_default(),
            )
        }
        TransitionStatus::Noop => InventorySessionReviewResponse::noop(request_id),
        TransitionStatus::Error => map_transition_error(request_id, &resp),
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Map a `TransitionResponse` with `status: Error` to an inventory review response.
fn map_transition_error(
    request_id: String,
    resp: &contracts_core::lifecycle::TransitionResponse,
) -> InventorySessionReviewResponse {
    let code_str = resp.error.as_ref().map_or_else(
        || "transition.refused".to_owned(),
        |e| {
            serde_json::to_value(e.code)
                .ok()
                .and_then(|v| v.as_str().map(ToOwned::to_owned))
                .unwrap_or_else(|| "transition.refused".to_owned())
        },
    );
    let msg =
        resp.error.as_ref().map_or_else(|| "transition refused".to_owned(), |e| e.message.clone());
    if let Some(details_json_any) = resp.error.as_ref().and_then(|e| e.details.as_ref()) {
        InventorySessionReviewResponse::error_with_details(
            request_id,
            &code_str,
            msg,
            details_json_any.clone(),
        )
    } else {
        InventorySessionReviewResponse::error(request_id, &code_str, msg)
    }
}

/// Returns `(entity_type_str, current_state, root_id_opt)` for a session id.
/// Checks `acquisition_session` first, then `calibration_session`.
async fn resolve_session(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<Option<(String, String, Option<String>)>, String> {
    if let Some((state, root_id)) =
        get_acquisition_session_state(pool, session_id).await.map_err(|e| e.to_string())?
    {
        return Ok(Some(("acquisition_session".to_owned(), state, Some(root_id))));
    }
    if let Some((state, root_id)) =
        get_calibration_session_state(pool, session_id).await.map_err(|e| e.to_string())?
    {
        return Ok(Some(("calibration_session".to_owned(), state, Some(root_id))));
    }
    Ok(None)
}

fn filters_to_db(filters: Option<&InventoryListFilters>) -> InventoryFilters {
    let Some(f) = filters else {
        return InventoryFilters::default();
    };
    InventoryFilters {
        source_id: f.source_filter.clone(),
        frame_type: f.frame_filter.map(frame_type_to_str).map(ToOwned::to_owned),
        review_state: f.review_filter.clone(),
    }
}

fn frame_type_to_str(ft: InventoryFrameType) -> &'static str {
    match ft {
        InventoryFrameType::Light => "light",
        InventoryFrameType::Dark => "dark",
        InventoryFrameType::Flat => "flat",
        InventoryFrameType::Bias => "bias",
        InventoryFrameType::Mixed => "mixed",
    }
}

fn map_source_kind(kind: &str) -> InventorySourceKind {
    match kind {
        "external" => InventorySourceKind::ExternalDisk,
        "network" => InventorySourceKind::NetworkShare,
        _ => InventorySourceKind::LocalDisk,
    }
}

fn map_source_state(state: &str) -> InventorySourceState {
    match state {
        "missing" => InventorySourceState::Missing,
        "disabled" => InventorySourceState::Disabled,
        "reconnect_required" => InventorySourceState::ReconnectRequired,
        _ => InventorySourceState::Active,
    }
}

fn map_frame_type(db_kind: &str) -> InventoryFrameType {
    match db_kind {
        "dark" => InventoryFrameType::Dark,
        "flat" => InventoryFrameType::Flat,
        "bias" => InventoryFrameType::Bias,
        "mixed" => InventoryFrameType::Mixed,
        _ => InventoryFrameType::Light,
    }
}

fn str_to_contract_state(s: &str) -> ContractSessionState {
    // Canonical strict parser; unknown values fall back to Discovered,
    // preserving prior behavior.
    s.parse().unwrap_or(ContractSessionState::Discovered)
}

fn inventory_state_to_contract(s: InventorySessionState) -> ContractSessionState {
    match s {
        InventorySessionState::Discovered => ContractSessionState::Discovered,
        InventorySessionState::Candidate => ContractSessionState::Candidate,
        InventorySessionState::NeedsReview => ContractSessionState::NeedsReview,
        InventorySessionState::Confirmed => ContractSessionState::Confirmed,
        InventorySessionState::Rejected => ContractSessionState::Rejected,
        InventorySessionState::Ignored => ContractSessionState::Ignored,
    }
}

fn map_session_state(state: &str) -> InventorySessionState {
    match state {
        "candidate" => InventorySessionState::Candidate,
        "needs_review" => InventorySessionState::NeedsReview,
        "confirmed" => InventorySessionState::Confirmed,
        "rejected" => InventorySessionState::Rejected,
        "ignored" => InventorySessionState::Ignored,
        _ => InventorySessionState::Discovered,
    }
}

fn parse_state(s: &str) -> InventorySessionState {
    map_session_state(s)
}

#[cfg(test)]
fn state_to_str(state: InventorySessionState) -> &'static str {
    match state {
        InventorySessionState::Discovered => "discovered",
        InventorySessionState::Candidate => "candidate",
        InventorySessionState::NeedsReview => "needs_review",
        InventorySessionState::Confirmed => "confirmed",
        InventorySessionState::Rejected => "rejected",
        InventorySessionState::Ignored => "ignored",
    }
}

/// Count frame_ids JSON array length (fallback to 0 on parse failure).
fn count_frames(frame_ids_json: &str) -> u32 {
    serde_json::from_str::<Vec<serde_json::Value>>(frame_ids_json)
        .map_or(0, |v| u32::try_from(v.len()).unwrap_or(0))
}

/// The session's target: the linked `target_name` when present, otherwise the
/// `target` field parsed out of the `session_key` JSON. `target_name` is
/// currently always NULL in the projection (gen-3 canonical_target is not
/// joined), so the session_key fallback is what gives every acquisition row its
/// object identity instead of a generic "Session — <date>".
fn effective_target(row: &SessionProjectionRow) -> Option<String> {
    if let Some(ref t) = row.target_name {
        return Some(t.clone());
    }
    serde_json::from_str::<serde_json::Value>(&row.session_key)
        .ok()
        .and_then(|k| k.get("target").and_then(|v| v.as_str()).map(ToOwned::to_owned))
}

/// Derive a human display name for an inventory session.
fn derive_session_name(row: &SessionProjectionRow) -> String {
    let date = &row.created_at[..10.min(row.created_at.len())];
    if row.session_kind == "calibration" {
        return format!("{} calibration — {date}", row.frame_type);
    }
    let key = serde_json::from_str::<serde_json::Value>(&row.session_key).ok();
    match effective_target(row) {
        Some(target) => {
            let filter = key
                .as_ref()
                .and_then(|k| k.get("filter").and_then(|v| v.as_str()))
                .unwrap_or("?");
            let night = key
                .as_ref()
                .and_then(|k| k.get("night").and_then(|v| v.as_str()))
                .unwrap_or(date);
            format!("{target} · {filter} — {night}")
        }
        None => format!("Session — {date}"),
    }
}

fn project_row_to_session(
    row: SessionProjectionRow,
    proj_map: &HashMap<String, Vec<(String, String)>>,
) -> InventorySession {
    let frames = count_frames(&row.frame_ids);
    let name = derive_session_name(&row);
    let target = effective_target(&row);
    let frame_type = map_frame_type(&row.frame_type);
    let state = map_session_state(&row.state);

    let linked = proj_map.get(&row.id).map(|projs| InventoryLinkedRefs {
        projects: Some(
            projs
                .iter()
                .map(|(id, name)| LinkedProjectRef { id: id.clone(), name: name.clone() })
                .collect(),
        ),
        session: None,
        calibration: None,
    });

    // Provenance summary: derive from session_key metadata where available.
    let provenance = if let Ok(key) = serde_json::from_str::<serde_json::Value>(&row.session_key) {
        let target_prov = key.get("target").and_then(|v| v.as_str()).map(ToOwned::to_owned);
        let filter_prov = key.get("filter").and_then(|v| v.as_str()).map(ToOwned::to_owned);
        if target_prov.is_some() || filter_prov.is_some() {
            Some(InventoryProvenanceSummary {
                target: target_prov,
                filter: filter_prov,
                ..Default::default()
            })
        } else {
            None
        }
    } else {
        None
    };

    // Capture date: first 10 chars of created_at (YYYY-MM-DD).
    let captured_on =
        if row.created_at.len() >= 10 { Some(row.created_at[..10].to_owned()) } else { None };

    // Filter/exposure: attempt to parse from session_key JSON.
    let (filter, exposure) =
        if let Ok(key) = serde_json::from_str::<serde_json::Value>(&row.session_key) {
            let f = key.get("filter").and_then(|v| v.as_str()).map(ToOwned::to_owned);
            // No exposure in session_key; would come from provenance in full impl.
            (f, None)
        } else {
            (None, None)
        };

    InventorySession {
        id: row.id,
        name,
        source_id: row.root_id,
        frames,
        frame_type,
        target,
        filter,
        exposure,
        state,
        camera: None,
        gain: None,
        binning: None,
        set_temp: None,
        captured_on,
        provenance,
        linked,
    }
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_source_kind_local() {
        assert!(matches!(map_source_kind("local"), InventorySourceKind::LocalDisk));
    }

    #[test]
    fn map_source_kind_external() {
        assert!(matches!(map_source_kind("external"), InventorySourceKind::ExternalDisk));
    }

    #[test]
    fn map_source_kind_network() {
        assert!(matches!(map_source_kind("network"), InventorySourceKind::NetworkShare));
    }

    #[test]
    fn map_source_kind_unknown_defaults_to_local() {
        assert!(matches!(map_source_kind("usb"), InventorySourceKind::LocalDisk));
    }

    #[test]
    fn map_source_state_variants() {
        assert!(matches!(map_source_state("active"), InventorySourceState::Active));
        assert!(matches!(map_source_state("missing"), InventorySourceState::Missing));
        assert!(matches!(map_source_state("disabled"), InventorySourceState::Disabled));
        assert!(matches!(
            map_source_state("reconnect_required"),
            InventorySourceState::ReconnectRequired
        ));
    }

    #[test]
    fn map_frame_type_variants() {
        assert!(matches!(map_frame_type("light"), InventoryFrameType::Light));
        assert!(matches!(map_frame_type("dark"), InventoryFrameType::Dark));
        assert!(matches!(map_frame_type("flat"), InventoryFrameType::Flat));
        assert!(matches!(map_frame_type("bias"), InventoryFrameType::Bias));
        assert!(matches!(map_frame_type("mixed"), InventoryFrameType::Mixed));
    }

    #[test]
    fn map_session_state_variants() {
        assert!(matches!(map_session_state("discovered"), InventorySessionState::Discovered));
        assert!(matches!(map_session_state("candidate"), InventorySessionState::Candidate));
        assert!(matches!(map_session_state("needs_review"), InventorySessionState::NeedsReview));
        assert!(matches!(map_session_state("confirmed"), InventorySessionState::Confirmed));
        assert!(matches!(map_session_state("rejected"), InventorySessionState::Rejected));
        assert!(matches!(map_session_state("ignored"), InventorySessionState::Ignored));
    }

    #[test]
    fn count_frames_parses_json_array() {
        assert_eq!(count_frames("[\"a\",\"b\",\"c\"]"), 3);
        assert_eq!(count_frames("[]"), 0);
        assert_eq!(count_frames("invalid"), 0);
    }

    #[test]
    fn state_to_str_round_trips() {
        let states = [
            InventorySessionState::Discovered,
            InventorySessionState::Candidate,
            InventorySessionState::NeedsReview,
            InventorySessionState::Confirmed,
            InventorySessionState::Rejected,
            InventorySessionState::Ignored,
        ];
        for s in states {
            let str_val = state_to_str(s);
            let parsed = parse_state(str_val);
            assert_eq!(format!("{s:?}"), format!("{parsed:?}"), "round-trip failed for {str_val}");
        }
    }

    #[test]
    fn noop_response_has_correct_status() {
        let r = InventorySessionReviewResponse::noop("req-1".to_owned());
        assert_eq!(r.status, "noop");
        assert!(r.error.is_none());
        assert!(r.audit_id.is_none());
    }

    #[test]
    fn error_response_has_correct_status() {
        let r = InventorySessionReviewResponse::error(
            "req-2".to_owned(),
            "session.not_found",
            "not found".to_owned(),
        );
        assert_eq!(r.status, "error");
        assert!(r.error.is_some());
        assert_eq!(r.error.unwrap().code, "session.not_found");
    }
}
