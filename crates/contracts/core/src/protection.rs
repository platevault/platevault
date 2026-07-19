// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Contract DTOs for spec 016 source protection (US2–US4).
//!
//! Covers three operations:
//! - `source.protection.get`  — resolve effective protection for a source.
//! - `source.protection.set`  — set or replace a per-source protection override.
//! - `plan.protection.check`  — return protection-affected plan items for review gating.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

// ── Shared enum ───────────────────────────────────────────────────────────

/// Protection level enum (spec 016 data-model.md; simplified to 2 levels per
/// issue #506 — the third "inherit-global via an explicit `normal` row" tier
/// added confusion without adding capability, since absence of an override
/// row already means inherit-global. Existing `normal` rows are remapped to
/// `unprotected` by migration 0070, non-destructively).
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "snake_case")]
pub enum ProtectionLevel {
    Protected,
    Unprotected,
}

impl ProtectionLevel {
    /// Convert from the string values stored in the DB / settings.
    #[must_use]
    pub fn parse_level(s: &str) -> Self {
        match s {
            "protected" => Self::Protected,
            _ => Self::Unprotected,
        }
    }

    /// Serialize to the canonical lowercase string representation.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Protected => "protected",
            Self::Unprotected => "unprotected",
        }
    }
}

// ── source.protection.get ─────────────────────────────────────────────────

/// Request DTO for `source.protection.get`.
///
/// If `source_id` is `None`, the response contains global defaults.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SourceProtectionGetRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
}

/// Response DTO for `source.protection.get`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SourceProtectionGetResponse {
    /// Echo of the resolved source id, absent when returning global defaults.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    /// Effective protection level (override wins; category elevates only when no override).
    pub level: ProtectionLevel,
    /// Effective `block_permanent_delete` flag (per-source override or global fallback).
    pub block_permanent_delete: bool,
    /// Effective protected categories for this source.
    pub categories: Vec<String>,
    /// True when no per-source override row exists and global defaults were used.
    pub inherits_default: bool,
}

// ── source.protection.set ─────────────────────────────────────────────────

/// Request DTO for `source.protection.set`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SourceProtectionSetRequest {
    pub source_id: String,
    pub level: ProtectionLevel,
    /// Per-source override for `block_permanent_delete`.
    /// `None` = inherit global; `Some(true/false)` = explicit override.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_permanent_delete: Option<bool>,
    /// Per-source category override.
    /// `None` = inherit global protected categories.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub categories: Option<Vec<String>>,
}

/// Response DTO for `source.protection.set`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SourceProtectionSetResponse {
    pub source_id: String,
    pub prior_level: ProtectionLevel,
    pub new_level: ProtectionLevel,
    /// Prior per-source `block_permanent_delete` override; `None` = was inheriting global.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prior_block_permanent_delete: Option<bool>,
    /// New per-source `block_permanent_delete` override; `None` = now inheriting global.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_block_permanent_delete: Option<bool>,
    /// Prior per-source categories; absent when there was no prior override.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prior_categories: Option<Vec<String>>,
    /// New per-source categories; absent when inheriting global.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_categories: Option<Vec<String>>,
    /// Audit event id emitted by this call.
    pub audit_id: String,
}

// ── plan.protection.check ─────────────────────────────────────────────────

/// Request DTO for `plan.protection.check`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanProtectionCheckRequest {
    pub plan_id: String,
}

/// A single plan item that requires user acknowledgement (spec 016 data-model
/// §`ProtectedPlanItem`, FR-008: only items requiring acknowledgement are
/// included; normal/unprotected items appear only in `non_blocking_summary`).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProtectedPlanItem {
    pub item_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    pub level: ProtectionLevel,
    /// Categories that triggered protection elevation, if any.
    pub matched_categories: Vec<String>,
    pub original_action: String,
    /// Set when `block_permanent_delete` rewrote the action (e.g. `delete` → `archive`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rewritten_action: Option<String>,
    pub requires_acknowledgement: bool,
    pub reason: String,
}

/// Summary of items that do NOT require acknowledgement (R-CheckScope, FR-008).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NonBlockingSummary {
    pub normal_count: i64,
    pub unprotected_count: i64,
}

/// Response DTO for `plan.protection.check`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanProtectionCheckResponse {
    pub plan_id: String,
    pub has_protected_items: bool,
    /// Items that require explicit user acknowledgement before the plan may execute.
    pub protected_items: Vec<ProtectedPlanItem>,
    /// Counts of items that do NOT require acknowledgement.
    pub non_blocking_summary: NonBlockingSummary,
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protection_level_round_trips() {
        for s in &["protected", "unprotected"] {
            let level = ProtectionLevel::parse_level(s);
            assert_eq!(level.as_str(), *s);
        }
    }

    #[test]
    fn protection_level_unknown_defaults_to_unprotected() {
        assert_eq!(ProtectionLevel::parse_level("other"), ProtectionLevel::Unprotected);
    }

    #[test]
    fn protection_level_legacy_normal_maps_to_unprotected() {
        // Migration 0070 remaps stored 'normal' rows to 'unprotected'; the
        // parser must agree for any value that slips through unmigrated.
        assert_eq!(ProtectionLevel::parse_level("normal"), ProtectionLevel::Unprotected);
    }

    #[test]
    fn source_protection_get_response_serializes() {
        let resp = SourceProtectionGetResponse {
            source_id: Some("abc".to_owned()),
            level: ProtectionLevel::Protected,
            block_permanent_delete: true,
            categories: vec!["lights".to_owned()],
            inherits_default: false,
        };
        let v = serde_json::to_value(&resp).unwrap();
        assert_eq!(v["level"], "protected");
        assert_eq!(v["blockPermanentDelete"], true);
        assert_eq!(v["inheritsDefault"], false);
    }
}
