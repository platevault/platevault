//! Spec 029 audit stubs exposed to the Tauri webview.
//!
//! Stub implementations returning hardcoded fixture data matching the mock
//! layer until the real persistence layer is wired.

use contracts_core::audit::{AuditActor, AuditEntry, AuditListResponse, AuditOutcome};
use contracts_core::JsonAny;

/// `audit.list` — returns paginated audit entries.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta]
pub async fn audit_list(
    filters: Option<JsonAny>,
    pagination: Option<JsonAny>,
) -> Result<AuditListResponse, String> {
    tracing::debug!("stub: audit.list filters={filters:?} pagination={pagination:?}");
    let entries = stub_audit_entries();
    let total = u32::try_from(entries.len()).unwrap_or(0);
    Ok(AuditListResponse { entries, total })
}

/// `audit.export` — export audit entries as newline-delimited JSON.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta]
pub async fn audit_export(filters: Option<JsonAny>) -> Result<String, String> {
    tracing::debug!("stub: audit.export filters={filters:?}");
    let entries = stub_audit_entries();
    let lines: Vec<String> =
        entries.iter().map(|e| serde_json::to_string(e).unwrap_or_default()).collect();
    Ok(lines.join("\n"))
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

fn stub_audit_entries() -> Vec<AuditEntry> {
    vec![
        AuditEntry {
            id: "audit-001".to_owned(),
            timestamp: "2026-05-20T22:15:00Z".to_owned(),
            event_type: "session.confirmed".to_owned(),
            entity_type: "session".to_owned(),
            entity_id: "ses-001".to_owned(),
            from_state: Some("needs_review".to_owned()),
            to_state: Some("confirmed".to_owned()),
            actor: AuditActor::User,
            outcome: AuditOutcome::Applied,
            detail: "User confirmed session".to_owned(),
        },
        AuditEntry {
            id: "audit-002".to_owned(),
            timestamp: "2026-05-20T22:10:00Z".to_owned(),
            event_type: "plan.approved".to_owned(),
            entity_type: "plan".to_owned(),
            entity_id: "plan-001".to_owned(),
            from_state: Some("ready_for_review".to_owned()),
            to_state: Some("approved".to_owned()),
            actor: AuditActor::User,
            outcome: AuditOutcome::Applied,
            detail: "Plan approved".to_owned(),
        },
        AuditEntry {
            id: "audit-003".to_owned(),
            timestamp: "2026-05-20T21:45:00Z".to_owned(),
            event_type: "plan.applied".to_owned(),
            entity_type: "plan".to_owned(),
            entity_id: "plan-001".to_owned(),
            from_state: Some("approved".to_owned()),
            to_state: Some("applied".to_owned()),
            actor: AuditActor::System,
            outcome: AuditOutcome::Applied,
            detail: "All 12 items applied".to_owned(),
        },
        AuditEntry {
            id: "audit-004".to_owned(),
            timestamp: "2026-05-19T23:30:00Z".to_owned(),
            event_type: "scan.completed".to_owned(),
            entity_type: "root".to_owned(),
            entity_id: "root-001".to_owned(),
            from_state: None,
            to_state: None,
            actor: AuditActor::System,
            outcome: AuditOutcome::Ok,
            detail: "Discovered 1,247 files in 4.2s".to_owned(),
        },
        AuditEntry {
            id: "audit-005".to_owned(),
            timestamp: "2026-05-19T23:25:00Z".to_owned(),
            event_type: "scan.started".to_owned(),
            entity_type: "root".to_owned(),
            entity_id: "root-001".to_owned(),
            from_state: None,
            to_state: None,
            actor: AuditActor::User,
            outcome: AuditOutcome::Ok,
            detail: "Manual scan triggered".to_owned(),
        },
    ]
}
