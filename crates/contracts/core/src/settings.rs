//! Settings contract DTOs for the Tauri IPC surface (spec 018, T004).
//!
//! `SettingsState` is the full v1 bag of settings, one field per key from
//! data-model.md.
//!
//! `SettingsUpdateRequest` / `SettingsUpdateResponse` map to
//! `contracts/settings.update.json`.
//!
//! `SettingsGetResponse` maps to `contracts/settings.get.json`.
//!
//! `SourceOverride` / `SetSourceOverrideRequest` / `SetSourceOverrideResponse`
//! map to `contracts/settings.source-override.set.json`.
//!
//! `RestoreDefaultsRequest` / `RestoreDefaultsResponse` map to
//! `contracts/settings.restore-defaults.json`.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::JsonAny;

// ── Re-exported stored settings types (spec 042 T254) ─────────────────────
//
// `PatternPart`, `ImageTypMapping`, `SettingsState`, and `SourceOverride` are
// the durable on-disk settings shapes. They now live in `domain_core` so the
// persistence layer no longer depends on this transport crate. Re-exported
// here verbatim — identical serde + specta derives — so the generated
// TypeScript bindings and every `contracts_core::settings::*` consumer are
// byte-identical.
pub use domain_core::settings::{ImageTypMapping, PatternPart, SettingsState, SourceOverride};
// ── settings.get response ────────────────────────────────────────────────

/// Response DTO for `settings.get` (contracts/settings.get.json).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SettingsGetResponse {
    pub settings: SettingsState,
}

// ── settings.update request/response ────────────────────────────────────

/// Request DTO for `settings.update` (contracts/settings.update.json).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SettingsUpdateRequest {
    pub key: String,
    pub value: JsonAny,
}

/// Status returned by `settings.update`.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SettingsUpdateStatus {
    /// Value changed and was persisted.
    Success,
    /// Incoming value was deep-equal to the stored value; no write, no audit.
    Noop,
}

/// Response DTO for `settings.update`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SettingsUpdateResponse {
    pub status: SettingsUpdateStatus,
    pub key: String,
    pub prior_value: JsonAny,
    pub new_value: JsonAny,
    /// Audit event id; absent for noisy keys and when `status = noop`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audit_id: Option<String>,
}

// ── settings.source-override.set request/response ────────────────────────

/// Request DTO for `settings.source-override.set`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SetSourceOverrideRequest {
    pub source_id: String,
    pub key: String,
    pub value: JsonAny,
}

/// Response DTO for `settings.source-override.set`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SetSourceOverrideResponse {
    pub source_id: String,
    pub key: String,
}

// ── settings.restore-defaults request/response ───────────────────────────

/// Status returned by `settings.restore-defaults`.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum RestoreDefaultsStatus {
    /// At least one key was restored to its default.
    Success,
    /// All requested keys were already at their defaults; nothing written.
    Noop,
}

/// Request DTO for `settings.restore-defaults`.
///
/// Pass an empty `keys` slice to restore every v1 key.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RestoreDefaultsRequest {
    /// Specific keys to restore. Empty = restore all.
    pub keys: Vec<String>,
}

/// Response DTO for `settings.restore-defaults`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RestoreDefaultsResponse {
    pub status: RestoreDefaultsStatus,
    /// Keys actually written (restored from non-default value).
    pub restored: Vec<String>,
    /// Keys already at default (skipped; no write, no audit).
    pub already_at_default: Vec<String>,
}

// ── Legacy shim ───────────────────────────────────────────────────────────

/// Scoped settings data — legacy shim kept for the existing stub command
/// surface. New code should use `SettingsGetResponse`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SettingsData {
    pub scope: String,
    pub values: crate::JsonAny,
}
