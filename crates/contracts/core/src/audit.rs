// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Audit contract DTOs for the Tauri IPC surface.
//!
//! These types mirror the hand-written TypeScript `AuditEntry` in
//! `apps/desktop/src/api/types.ts`.

use serde::{Deserialize, Serialize};
use specta::Type;

// ── Enums ───────────────────────────────────────────────────────────────────

/// Outcome of an audited action.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum AuditOutcome {
    Applied,
    Ok,
    Refused,
    Failed,
    Paused,
}

/// Actor that triggered the audited action.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum AuditActor {
    User,
    System,
}

// ── Structs ─────────────────────────────────────────────────────────────────

/// A single audit log entry.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: String,
    pub timestamp: String,
    pub event_type: String,
    pub entity_type: String,
    pub entity_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_state: Option<String>,
    pub actor: AuditActor,
    pub outcome: AuditOutcome,
    /// Backend-composed English detail. Durable fallback rendering for rows
    /// without `detail_code` / usable `detail_params` (D23 upgrade).
    pub detail: String,
    /// Stable detail code (e.g. `plan.required`, `provenance.unreviewed`,
    /// `target.resolved`) identifying a frontend catalog message template.
    /// Derived at read time from the durable `audit_log_entry.payload` JSON;
    /// absent for rows written before the D23 upgrade or whose detail has no
    /// template.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail_code: Option<String>,
    /// Structured display parameters for `detail_code` (flat string map,
    /// e.g. `{ "entityType": "project", "fromState": "ready", ... }`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail_params: Option<std::collections::HashMap<String, String>>,
}

/// Paginated response for audit list queries.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AuditListResponse {
    pub entries: Vec<AuditEntry>,
    pub total: u32,
}
