//! Inventory use cases (spec 006).
//!
//! - `list`: produce the `InventorySource[]` projection with optional filters.
//!
//! # Architecture
//!
//! `list` is a read-only projection: it joins `library_root`,
//! `acquisition_session`, `calibration_session`, and `project_sources` to
//! produce the contract DTOs without storing any new rows.
//!
//! Spec 041 FR-051 (T076, Phase 13): sessions are derived, already-confirmed
//! inventory. The `review_session` use case that wrapped the spec-002
//! `apply_transition` machinery (and its `inventory.session.review` review
//! affordance) was removed along with the review-state column it mutated.
//!
//! Extracted from `app_core` into its own crate (spec 042 / T253 O3b). Its only
//! cross-module dependency is on the now-extracted `app_core_lifecycle` crate
//! (`lifecycle_use_case`, `transition_use_case`); nothing else in `app_core`
//! references it. `app_core` re-exports this crate at `app_core::inventory` so
//! the public surface stays byte-identical.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks

use std::collections::HashMap;

use contracts_core::inventory::{
    InventoryFrameType, InventoryLinkedRefs, InventoryListFilters, InventoryProvenanceSummary,
    InventorySession, InventorySource, InventorySourceKind, InventorySourceState, LinkedProjectRef,
};
use persistence_db::repositories::inventory::{
    list_project_links_for_sessions, list_roots_with_sessions, list_sessions_for_root,
    InventoryFilters, SessionProjectionRow,
};
use sqlx::SqlitePool;

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

// ── Helpers ───────────────────────────────────────────────────────────────────

fn filters_to_db(filters: Option<&InventoryListFilters>) -> InventoryFilters {
    let Some(f) = filters else {
        return InventoryFilters::default();
    };
    InventoryFilters {
        source_id: f.source_filter.clone(),
        frame_type: f.frame_filter.map(frame_type_to_str).map(ToOwned::to_owned),
    }
}

fn frame_type_to_str(ft: InventoryFrameType) -> &'static str {
    match ft {
        InventoryFrameType::Light => "light",
        InventoryFrameType::Dark => "dark",
        InventoryFrameType::Flat => "flat",
        InventoryFrameType::Bias => "bias",
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
        _ => InventoryFrameType::Light,
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
            let filter =
                key.as_ref().and_then(|k| k.get("filter").and_then(|v| v.as_str())).unwrap_or("?");
            let night =
                key.as_ref().and_then(|k| k.get("night").and_then(|v| v.as_str())).unwrap_or(date);
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
        // "mixed" no longer maps to a dedicated variant (removed 2026-07-03);
        // any unknown db_kind, including a legacy "mixed", falls back to Light.
        assert!(matches!(map_frame_type("mixed"), InventoryFrameType::Light));
    }

    #[test]
    fn count_frames_parses_json_array() {
        assert_eq!(count_frames("[\"a\",\"b\",\"c\"]"), 3);
        assert_eq!(count_frames("[]"), 0);
        assert_eq!(count_frames("invalid"), 0);
    }
}
