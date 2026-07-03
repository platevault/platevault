//! `audit.list` / `audit.export` — Tauri commands exposed to the webview.
//!
//! These were spec-029 stubs (hardcoded fixture, filters/pagination ignored).
//! They now read the durable `audit_log_entry` table (migration
//! `0002_lifecycle.sql`) via `persistence_db::repositories::audit`, which is
//! written by lifecycle transitions (`repositories::lifecycle`), target
//! resolution (`targets::target_resolve`), and system-driven project
//! transitions (`projects::project_health`).
//!
//! `AuditFilterDto` / `AuditPaginationDto` are the first typed shapes for
//! `audit.list`'s `filters?`/`pagination?` args (previously untyped `JsonAny`
//! — spec 029's `contracts/commands.md` left the shape unspecified). They are
//! defined locally, mirroring `commands::lifecycle::LedgerFilterDto`, so the
//! IPC boundary does not leak the persistence-internal `AuditLogFilter` type.

use app_core::errors::db_err;
use contracts_core::audit::{AuditActor, AuditEntry, AuditListResponse, AuditOutcome};
use contracts_core::ContractError;
use persistence_db::repositories::audit::{
    count_audit_entries, list_audit_entries, AuditLogFilter, AuditLogRow,
};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::State;

use crate::commands::lifecycle::AppState;

/// Filter args for `audit.list` / `audit.export`.
///
/// `entity_type` + `entity_id` are the key fields a future per-entity history
/// view (e.g. an archive-detail audit trail) would reuse — kept as plain
/// equality filters rather than something bespoke to the settings screen.
#[derive(Clone, Debug, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AuditFilterDto {
    #[serde(default)]
    pub entity_type: Option<String>,
    #[serde(default)]
    pub entity_id: Option<String>,
    #[serde(default)]
    pub outcome: Option<AuditOutcome>,
    #[serde(default)]
    pub severity: Option<audit::Severity>,
    /// Case-insensitive substring match against event/entity/actor text.
    #[serde(default)]
    pub search: Option<String>,
    /// RFC 3339 lower bound on the entry timestamp (inclusive).
    #[serde(default)]
    pub from: Option<String>,
    /// RFC 3339 upper bound on the entry timestamp (exclusive).
    #[serde(default)]
    pub to: Option<String>,
}

/// Pagination args for `audit.list`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AuditPaginationDto {
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
}

fn outcome_to_db_str(outcome: AuditOutcome) -> &'static str {
    match outcome {
        AuditOutcome::Applied => "applied",
        AuditOutcome::Ok => "ok",
        AuditOutcome::Refused => "refused",
        AuditOutcome::Failed => "failed",
        AuditOutcome::Paused => "paused",
    }
}

fn severity_to_db_str(severity: audit::Severity) -> &'static str {
    match severity {
        audit::Severity::Workflow => "workflow",
        audit::Severity::Diagnostic => "diagnostic",
    }
}

/// Parse the `outcome` column (constrained by the `audit_log_entry` CHECK
/// clause to `applied` | `refused` | `failed`) into the wider contract enum.
/// Falls back to `Applied` for any unrecognised value rather than failing the
/// whole list — a single malformed row must not break the audit view.
fn parse_outcome(s: &str) -> AuditOutcome {
    match s {
        "refused" => AuditOutcome::Refused,
        "failed" => AuditOutcome::Failed,
        "ok" => AuditOutcome::Ok,
        "paused" => AuditOutcome::Paused,
        _ => AuditOutcome::Applied,
    }
}

fn parse_actor(s: &str) -> AuditActor {
    match s {
        "system" => AuditActor::System,
        _ => AuditActor::User,
    }
}

/// Derive a human-readable `detail` string. `audit_log_entry` has no `detail`
/// column — only a nullable JSON `payload` (present for refusals and target
/// resolution rows; `NULL` for successful transitions). Prefer a refusal
/// message when present, otherwise fall back to the `trigger` text itself
/// (the closest analogue to a human-readable summary the row carries).
fn derive_detail(trigger: &str, payload: Option<&str>) -> String {
    if let Some(raw) = payload {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) {
            if let Some(msg) =
                value.get("refusal").and_then(|r| r.get("message")).and_then(|m| m.as_str())
            {
                return msg.to_owned();
            }
            if let Some(query) = value.get("query").and_then(|q| q.as_str()) {
                return format!("{trigger} ({query})");
            }
        }
    }
    trigger.to_owned()
}

fn row_to_entry(row: AuditLogRow) -> AuditEntry {
    let detail = derive_detail(&row.trigger, row.payload.as_deref());
    AuditEntry {
        id: row.audit_id,
        timestamp: row.at,
        event_type: row.trigger,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        from_state: row.from_state,
        to_state: row.to_state,
        actor: parse_actor(&row.actor),
        outcome: parse_outcome(&row.outcome),
        detail,
    }
}

fn build_filter(
    filters: Option<AuditFilterDto>,
    pagination: Option<AuditPaginationDto>,
) -> AuditLogFilter {
    let f = filters.unwrap_or_default();
    let p = pagination.unwrap_or_default();
    AuditLogFilter {
        entity_type: f.entity_type,
        entity_id: f.entity_id,
        outcome: f.outcome.map(outcome_to_db_str).map(str::to_owned),
        severity: f.severity.map(severity_to_db_str).map(str::to_owned),
        from: f.from,
        to: f.to,
        search: f.search,
        limit: p.limit,
        offset: p.offset,
    }
}

/// `audit.list` — returns paginated audit entries read from `audit_log_entry`.
///
/// # Errors
/// Returns `Err(ContractError)` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn audit_list(
    state: State<'_, AppState>,
    filters: Option<AuditFilterDto>,
    pagination: Option<AuditPaginationDto>,
) -> Result<AuditListResponse, ContractError> {
    let pool = state.repo.pool();
    let filter = build_filter(filters, pagination);

    let rows = list_audit_entries(pool, &filter).await.map_err(db_err)?;
    let total = count_audit_entries(pool, &filter).await.map_err(db_err)?;

    let entries = rows.into_iter().map(row_to_entry).collect();
    Ok(AuditListResponse { entries, total })
}

/// `audit.export` — export the filtered audit entries as newline-delimited
/// JSON (one `AuditEntry` per line, matching `audit.list`'s entry shape).
/// Ignores pagination — export is always the full filtered set.
///
/// # Errors
/// Returns `Err(ContractError)` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn audit_export(
    state: State<'_, AppState>,
    filters: Option<AuditFilterDto>,
) -> Result<String, ContractError> {
    let pool = state.repo.pool();
    let filter = build_filter(filters, None);

    let rows = list_audit_entries(pool, &filter).await.map_err(db_err)?;
    let lines: Vec<String> = rows
        .into_iter()
        .map(row_to_entry)
        .map(|e| serde_json::to_string(&e).unwrap_or_default())
        .collect();
    Ok(lines.join("\n"))
}
