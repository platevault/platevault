// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Settings use cases (spec 018, T006/T013/T018/T019/T023/T024/T027).
//!
//! Entry points:
//! - `get_settings` — load all settings, hydrating defaults for missing rows,
//!   repairing invalid stored values (T018, T019).
//! - `update_setting` — write a single key with no-op guard and audit emit (T013).
//! - `restore_defaults` — restore one, several, or all keys to their in-code
//!   defaults (T027).
//! - `set_source_override` — set a per-source override for an overridable key (T023).
//! - `resolve_setting` — resolution order: per-source → global → default (T024).
//!
//! Extracted from `app_core` into its own crate (spec 042 / T253 O3b). Its only
//! cross-module dependency was on the now-extracted `app_core_errors` leaf.
//! `app_core` re-exports this crate at `app_core::settings` so the public
//! surface stays byte-identical.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks

use audit::bus::EventBus;
use audit::event_bus::{
    ProtectionDefaultChanged, SettingsChanged, SettingsRepair, SettingsSnapshot, Source,
    TOPIC_PROTECTION_DEFAULT_CHANGED, TOPIC_SETTINGS_CHANGED, TOPIC_SETTINGS_REPAIR,
    TOPIC_SETTINGS_SNAPSHOT,
};
use audit::{AuditLogEntry, Outcome, Severity};
use contracts_core::settings::{
    RestoreDefaultsRequest, RestoreDefaultsResponse, RestoreDefaultsStatus,
    SetSourceOverrideRequest, SetSourceOverrideResponse, SettingsGetResponse, SettingsState,
    SettingsUpdateRequest, SettingsUpdateResponse, SettingsUpdateStatus,
};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use domain_core::ids::EntityId;
use domain_core::lifecycle::data_asset::EntityType;
use persistence_db::repositories::settings as repo;
use persistence_db::repositories::source_protection as protection_repo;
use serde_json::Value;
use sqlx::SqlitePool;

// ── Global protection-default keys (spec 016 T-003/T-004/T-005) ─────────────
//
// `defaultProtection`, `blockPermanentDelete`, and `protectedCategories` are
// stable v1 settings keys (see `descriptors::DESCRIPTORS`) but their durable
// storage is the dedicated `protection_defaults` table (migration 0035)
// scoped to `"global"`, NOT the generic `settings` table `repo` (aliased
// above) writes to. `app_core::protection::load_global_protection` — the
// function the protection resolver and `plan.protection.check` actually
// read from — prefers `protection_defaults` unconditionally (it is always
// seeded by migration 0035), so writes that only reach the generic
// `settings` table are invisible to the resolver. Routing these three keys'
// global read/write through `protection_repo` here keeps `settings.get`,
// `settings.update`, and `settings.restore-defaults` in sync with the value
// the resolver actually uses, and lets their audit trail use the dedicated
// `protection.default.changed` topic instead of (or in addition to) the
// generic `settings.changed` topic — including for `protectedCategories`,
// which is marked `noisy` for the generic no-op-audit policy but is an
// explicit exception per plan.md E-016-3.
const GLOBAL_PROTECTION_DEFAULT_SCOPE: &str = "global";
const GLOBAL_PROTECTION_DEFAULT_KEYS: [&str; 3] =
    ["defaultProtection", "blockPermanentDelete", "protectedCategories"];

/// Whether `key` is one of the three global protection-default keys backed by
/// the `protection_defaults` table rather than the generic `settings` table.
#[must_use]
pub fn is_global_protection_default_key(key: &str) -> bool {
    GLOBAL_PROTECTION_DEFAULT_KEYS.contains(&key)
}

// ── Durable-data noisy keys (spec 030 FR-130, Q15/#647, T122) ───────────────
//
// `descriptors::DESCRIPTORS[].noisy` conflates two different concerns:
// UI-state keys (`rememberFollowLogs`, `plansListDefaultAgeCutoffDays`) that
// FR-134 exempts from durable audit entirely, and durable-data keys whose
// writes are debounced/frequent (`pattern`) but still get a single durable
// row at the committed value, before→after (FR-130). This is the same
// named-exception-list shape as `GLOBAL_PROTECTION_DEFAULT_KEYS` above, kept
// separate from the descriptor table rather than adding a 36th field to every
// one of its 35 literals for a single-member set.
const NOISY_AUDITED_KEYS: [&str; 1] = ["pattern"];

/// Whether a `noisy` key still gets a durable audit row at its committed
/// value (`pattern`), vs. being fully exempt as UI state (FR-134).
#[must_use]
fn is_noisy_audited_key(key: &str) -> bool {
    NOISY_AUDITED_KEYS.contains(&key)
}

// ── Audit entity identity (spec 030 FR-133, T122) ───────────────────────────

/// Deterministic UUIDv5 `entity_id` for a settings key.
///
/// Settings keys have no natural UUID identity; deriving one from the key
/// name (stable across every write) lets `audit_log_entry` reads correlate
/// the full history of one key under a single `entity_id`, the same way a
/// real entity's rows are correlated by its persisted id.
fn settings_entity_id(key: &str) -> EntityId {
    static NAMESPACE: std::sync::OnceLock<uuid::Uuid> = std::sync::OnceLock::new();
    let ns = NAMESPACE.get_or_init(|| {
        uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_DNS, b"astro-plan.audit.settings")
    });
    EntityId::from_uuid(uuid::Uuid::new_v5(ns, key.as_bytes()))
}

// ── Settings descriptor table (US11 T144) ────────────────────────────────
//
// The stable key registry + per-key rules now live in one place:
// `descriptors::DESCRIPTORS`. The key set, noisy/overridable membership,
// value validation, `SettingsState` hydration (`apply_value_to_state`), and
// in-code defaults (`default_value_for_key`) are all derived from that single
// table.
mod descriptors;

// ── Ingestion settings (spec 030, package P12) ────────────────────────────
//
// Stored as a single JSON document via the low-level key/value store below
// (`repo::get_raw`/`set_raw`), not through the descriptor table — see the
// module doc comment in `ingestion.rs` for the rationale.
pub mod ingestion;

// ── Settings schema migration harness (spec 018 US5, T030 / T031) ────────────
pub mod migrate;

// ── Per-root reconcile/detection configuration (spec 048 T005) ──────────────
pub mod root_config;

// ── In-memory settings-bag snapshot cache (F0 foundation) ────────────────────
//
// Defines the cache handle + `pub invalidate_settings_bag`/`store_settings_bag`
// only. Wiring `get_settings` to read through the cache and calling
// `invalidate_settings_bag` from `update_setting`/`restore_defaults`/
// `set_source_override` is downstream (W-SETTINGS) work.
pub mod caches;

// ── Error mapping ──────────────────────────────────────────────────────────
//
// Canonical mappers live in `app_core_errors` (US11 T142). `db_err` now routes
// `DbError::NotFound` to the recoverable `Blocking`/`retryable=false`
// classification instead of the previous blanket `Fatal` (L2 divergence fix).
use app_core_errors::{bus_err, db_err};

// ── Key validation ──────────────────────────────────────────────────────────

/// Return `true` if `key` is a valid v1 settings key (stable or structured-path).
#[must_use]
pub fn is_valid_key(key: &str) -> bool {
    if descriptors::descriptor_for(key).is_some() {
        return true;
    }
    // Structured-path keys.
    is_tools_bundle_id_key(key)
        || is_tools_executable_path_key(key)
        || is_tools_enabled_key(key)
        || is_tools_auto_detected_key(key)
        || is_workflow_profile_watch_extensions_key(key)
        || is_workflow_profile_attribution_window_key(key)
        || is_catalogues_enabled_key(key)
}

/// `enabled` (#645, scope `"catalogues"`): default-enabled Planner catalogue
/// ids. Not in the descriptor table on purpose — there is no dedicated
/// `SettingsState` field for it (`SettingsState` lives in `domain_core`,
/// outside this crate). Same treatment as the `tools.*`/`workflow_profile.*`
/// structured-path keys: read/write through the DB row + `default_value_for_key`
/// only, never through the in-memory `SettingsState` bag returned by
/// `get_settings` (unused by the Planner/Settings pane for this key).
fn is_catalogues_enabled_key(key: &str) -> bool {
    key == "enabled"
}

/// Return the names of all stable settings keys that can be overridden per source root.
///
/// Used by the `settings.overridable-keys` command (spec 018 T025) to provide the
/// frontend with the authoritative list so it need not hardcode key names.
#[must_use]
pub fn overridable_keys() -> Vec<String> {
    descriptors::DESCRIPTORS.iter().filter(|d| d.overridable).map(|d| d.key.to_owned()).collect()
}

fn is_tools_bundle_id_key(key: &str) -> bool {
    // ^tools\.[a-z0-9_]+\.bundle_id$
    if let Some(rest) = key.strip_prefix("tools.") {
        if let Some(tool_id) = rest.strip_suffix(".bundle_id") {
            return !tool_id.is_empty()
                && tool_id
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
        }
    }
    false
}

fn is_tools_key_with_suffix(key: &str, suffix: &str) -> bool {
    if let Some(rest) = key.strip_prefix("tools.") {
        if let Some(tool_id) = rest.strip_suffix(suffix) {
            return !tool_id.is_empty()
                && tool_id
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
        }
    }
    false
}

fn is_tools_executable_path_key(key: &str) -> bool {
    // ^tools\.[a-z0-9_]+\.executable_path$
    is_tools_key_with_suffix(key, ".executable_path")
}

fn is_tools_enabled_key(key: &str) -> bool {
    // ^tools\.[a-z0-9_]+\.enabled$
    is_tools_key_with_suffix(key, ".enabled")
}

fn is_tools_auto_detected_key(key: &str) -> bool {
    // ^tools\.[a-z0-9_]+\.auto_detected$
    is_tools_key_with_suffix(key, ".auto_detected")
}

fn is_workflow_profile_watch_extensions_key(key: &str) -> bool {
    // ^workflow_profile\.[a-z0-9_]+\.watch_extensions$
    if let Some(rest) = key.strip_prefix("workflow_profile.") {
        if let Some(profile_id) = rest.strip_suffix(".watch_extensions") {
            return !profile_id.is_empty()
                && profile_id
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
        }
    }
    false
}

fn is_workflow_profile_attribution_window_key(key: &str) -> bool {
    // ^workflow_profile\.[a-z0-9_]+\.launch_attribution_window_hours$
    if let Some(rest) = key.strip_prefix("workflow_profile.") {
        if let Some(profile_id) = rest.strip_suffix(".launch_attribution_window_hours") {
            return !profile_id.is_empty()
                && profile_id
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
        }
    }
    false
}

// ── Value validation ──────────────────────────────────────────────────────

/// Validate a proposed value for the given key.
///
/// Returns `Err(ContractError)` with code `"value.invalid"` when validation fails.
///
/// # Errors
///
/// Returns `ContractError` when the value is not valid for the key.
#[allow(clippy::result_large_err, clippy::collapsible_match, clippy::too_many_lines)]
pub fn validate_value(key: &str, value: &Value) -> Result<(), ContractError> {
    let invalid = |msg: &str| {
        ContractError::new(
            ErrorCode::ValueInvalid,
            format!("key {key}: {msg}"),
            ErrorSeverity::Warning,
            false,
        )
    };

    // Stable keys: validate via the single descriptor table (US11 T144). The
    // rules and rendered messages are byte-identical to the prior hand-written
    // per-key arms.
    if let Some(descriptor) = descriptors::descriptor_for(key) {
        return descriptors::check_rule(descriptor.validation, value, &invalid);
    }

    // Structured-path keys (tools.*, workflow_profile.*) — relax validation to
    // basic presence. These are not in the descriptor table.
    match key {
        _ if is_tools_bundle_id_key(key) => {
            if !value.is_null() && !value.is_string() {
                return Err(invalid("must be a string or null"));
            }
            // Validate that the tool_id references a known seeded ToolProfile.
            // Extract tool_id from "tools.<tool_id>.bundle_id".
            if let Some(tool_id) =
                key.strip_prefix("tools.").and_then(|r| r.strip_suffix(".bundle_id"))
            {
                if workflow_profiles::seed::find(tool_id).is_none() {
                    return Err(ContractError::new(
                        ErrorCode::KeyUnknown,
                        format!("unknown tool id: {tool_id}"),
                        ErrorSeverity::Warning,
                        false,
                    ));
                }
            }
        }
        _ if is_tools_executable_path_key(key) => {
            if !value.is_null() && !value.is_string() {
                return Err(invalid("must be a string or null"));
            }
        }
        _ if is_tools_enabled_key(key) => {
            if !value.is_boolean() {
                return Err(invalid("must be a boolean"));
            }
        }
        _ if is_tools_auto_detected_key(key) => {
            if !value.is_boolean() {
                return Err(invalid("must be a boolean"));
            }
        }
        _ if is_workflow_profile_watch_extensions_key(key) => {
            if !value.is_array() {
                return Err(invalid("must be an array"));
            }
        }
        _ if is_workflow_profile_attribution_window_key(key) => {
            if value.as_f64().is_none() {
                return Err(invalid("must be a number"));
            }
        }
        _ if is_catalogues_enabled_key(key) => {
            descriptors::check_rule(descriptors::ValidationRule::CatalogueIds, value, &invalid)?;
        }
        _ => {
            // No additional validation for other keys.
        }
    }
    Ok(())
}

// ── Deep structural equality ───────────────────────────────────────────────

/// Deep structural equality for settings values (A4, R4.1).
///
/// For arrays and objects, compares element-wise and field-wise.
/// For primitives, uses strict equality.
#[must_use]
pub fn settings_value_eq(a: &Value, b: &Value) -> bool {
    a == b
}

// ── ISO timestamp helper ──────────────────────────────────────────────────
// Canonical helper lives in `domain_core::ids::Timestamp` (US11 T140).
use domain_core::ids::Timestamp;

// ── get_settings ──────────────────────────────────────────────────────────

/// Load all settings with defaults hydrated for missing rows (T018).
///
/// Invalid stored values are deleted and reset to default, with a
/// `settings.repair` audit event emitted (T019).
///
/// # Errors
///
/// Returns `ContractError` on database or audit failure.
pub async fn get_settings(
    pool: &SqlitePool,
    bus: &EventBus,
) -> Result<SettingsGetResponse, ContractError> {
    // Read-through: on hit, skip the DB entirely (F0 in-memory caching layer).
    if let Some(cached) = caches::settings_bag().load() {
        return Ok(SettingsGetResponse { settings: (*cached).clone() });
    }

    let all_raw = repo::get_all_raw(pool).await.map_err(db_err)?;
    let mut settings = SettingsState::default();

    for (key, value) in all_raw {
        // Validate stored value.
        if let Err(_validation_err) = validate_value(&key, &value) {
            // Repair: delete the bad row and emit a warn audit event.
            repo::delete_key(pool, &key).await.map_err(db_err)?;

            let default_value = default_value_for_key(&key);
            let at = Timestamp::now_iso();
            bus.publish(
                TOPIC_SETTINGS_REPAIR,
                Source::System,
                SettingsRepair {
                    key: key.clone(),
                    invalid_value: value.clone(),
                    default_value: default_value.clone(),
                    at,
                },
            )
            .await
            .map_err(bus_err)?;

            // Use the default — do not apply the invalid stored value.
            continue;
        }

        // Apply the validated value.
        apply_value_to_state(&key, value, &mut settings);
    }

    caches::store_settings_bag(std::sync::Arc::new(settings.clone()));
    Ok(SettingsGetResponse { settings })
}

/// Apply a raw JSON value to the correct field of `SettingsState`.
///
/// Unknown keys (structured-path keys like tools.*) are stored in the DB but
/// not mapped to static SettingsState fields.
fn apply_value_to_state(key: &str, value: Value, state: &mut SettingsState) {
    if let Some(descriptor) = descriptors::descriptor_for(key) {
        (descriptor.apply)(value, state);
    }
    // Else: structured-path keys are not mapped to static SettingsState
    // fields. Use resolve_setting(key, source_id) to read them individually.
}

/// Return the in-code default value for a given key as `serde_json::Value`.
fn default_value_for_key(key: &str) -> Value {
    if let Some(descriptor) = descriptors::descriptor_for(key) {
        return (descriptor.default)(SettingsState::default());
    }
    // Structured-path: tools.<id>.bundle_id resolves the seed default
    // when no user override is stored (spec 018 T042).
    if is_tools_bundle_id_key(key) {
        if let Some(tool_id) = key.strip_prefix("tools.").and_then(|r| r.strip_suffix(".bundle_id"))
        {
            if let Some(profile) = workflow_profiles::seed::find(tool_id) {
                return match profile.bundle_id {
                    // Known bundle ID from seed (may be wrong on non-macOS; callers
                    // should prefer the per-OS auto-detected value when available).
                    Some(id) => Value::String(id.to_owned()),
                    None => Value::Null,
                };
            }
        }
        return Value::Null;
    }
    if is_catalogues_enabled_key(key) {
        return serde_json::json!(["M", "NGC", "IC", "Sh2"]);
    }
    Value::Null
}

// ── update_setting ────────────────────────────────────────────────────────

/// Write a single settings key (T013).
///
/// Behaviour:
/// - Returns `"key.unknown"` for keys that are not valid v1 keys.
/// - Returns `"value.invalid"` when schema validation fails.
/// - Returns `status = "noop"` when the incoming value is deep-equal to the
///   currently stored (or default) value (A4, R4.1).
/// - For non-noisy keys: upserts the row and emits a `settings.changed` audit
///   event.
/// - For noisy keys: upserts the row without emitting a per-change audit event
///   (snapshot is emitted separately by T020).
///
/// # Errors
///
/// Returns `ContractError` with code `"key.unknown"` or `"value.invalid"`, or
/// an internal error on database/audit failure.
pub async fn update_setting(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &SettingsUpdateRequest,
) -> Result<SettingsUpdateResponse, ContractError> {
    let key = &req.key;
    let is_protection_default = is_global_protection_default_key(key);

    // 1. Validate key.
    if !is_valid_key(key) {
        write_settings_refusal(bus, is_protection_default, key, "key.unknown").await?;
        return Err(ContractError::new(
            ErrorCode::KeyUnknown,
            format!("unknown settings key: {key}"),
            ErrorSeverity::Warning,
            false,
        ));
    }

    // 2. Validate value.
    let new_value = &req.value.0;
    if let Err(e) = validate_value(key, new_value) {
        write_settings_refusal(bus, is_protection_default, key, "value.invalid").await?;
        return Err(e);
    }

    // 3. Load current stored value (or default). Global protection-default
    // keys read/write the dedicated `protection_defaults` table (T-005).
    let prior_raw = if is_protection_default {
        protection_repo::get_protection_default(pool, GLOBAL_PROTECTION_DEFAULT_SCOPE, key)
            .await
            .map_err(db_err)?
    } else {
        repo::get_raw(pool, key).await.map_err(db_err)?
    };
    let prior_value = prior_raw.clone().unwrap_or_else(|| default_value_for_key(key));

    // 4. No-op guard.
    if settings_value_eq(&prior_value, new_value) {
        return Ok(SettingsUpdateResponse {
            status: SettingsUpdateStatus::Noop,
            key: key.clone(),
            prior_value: contracts_core::JsonAny::from(prior_value),
            new_value: contracts_core::JsonAny::from(new_value.clone()),
            audit_id: None,
        });
    }

    // 5. Persist.
    if is_protection_default {
        protection_repo::set_protection_default(
            pool,
            GLOBAL_PROTECTION_DEFAULT_SCOPE,
            key,
            new_value,
        )
        .await
        .map_err(db_err)?;
    } else {
        repo::set_raw(pool, key, new_value).await.map_err(db_err)?;
    }

    // Cache invalidation fan-out (F0 in-memory caching layer): fires only
    // after the write above has committed, never before. `protection_defaults`
    // was relocated to the `app_core_cache` leaf (crates/app/cache/src/lib.rs:337-343)
    // precisely so this crate can invalidate it without depending on `app_core`
    // (which itself depends on `app_core_settings`).
    caches::invalidate_settings_bag();
    app_core_calibration::caches::invalidate_calibration_config();
    if is_protection_default {
        app_core_cache::invalidate_protection_defaults();
    }

    // 6. Emit durable audit row + live event (FR-130/FR-131, T122). Global
    // protection-default keys ALWAYS audit under `EntityType::Protection` via
    // `protection.default.changed` (T-004), overriding the noisy-key
    // no-audit policy — `protectedCategories` is `noisy` for the generic
    // `settings.changed` topic but is a named exception here (spec 016
    // plan.md E-016-3: "MUST emit `protection.default.changed` whenever it is
    // updated"). Non-protection noisy keys audit only when in
    // `NOISY_AUDITED_KEYS` (durable-data, e.g. `pattern`); the rest
    // (`rememberFollowLogs`, `plansListDefaultAgeCutoffDays`) are UI state and
    // stay fully exempt (FR-134).
    let is_noisy = descriptors::is_noisy(key.as_str());
    let audit_id = if !is_protection_default && is_noisy && !is_noisy_audited_key(key.as_str()) {
        None
    } else {
        let action = if is_protection_default {
            "settings.protection_default.update"
        } else {
            "settings.update"
        };
        let id = write_settings_applied_audit(
            bus,
            is_protection_default,
            action,
            key,
            &prior_value,
            new_value,
        )
        .await?;
        Some(id.as_uuid().to_string())
    };

    Ok(SettingsUpdateResponse {
        status: SettingsUpdateStatus::Success,
        key: key.clone(),
        prior_value: contracts_core::JsonAny::from(prior_value),
        new_value: contracts_core::JsonAny::from(new_value.clone()),
        audit_id,
    })
}

/// Write a durable `Outcome::Applied` audit row + live event for an accepted
/// settings write (T122). Shared by `update_setting`'s success path and
/// `restore_defaults`'s per-key loop — both pick `EntityType`/topic/payload
/// the same way based on `is_protection_default` (protection-default keys
/// audit under `EntityType::Protection` via `protection.default.changed`,
/// spec 016 T-004; everything else audits under `EntityType::Settings` via
/// `settings.changed`).
async fn write_settings_applied_audit(
    bus: &EventBus,
    is_protection_default: bool,
    action: &str,
    key: &str,
    prior_value: &Value,
    new_value: &Value,
) -> Result<domain_core::ids::AuditId, ContractError> {
    let entity_type =
        if is_protection_default { EntityType::Protection } else { EntityType::Settings };
    let entry = AuditLogEntry::new(
        entity_type,
        settings_entity_id(key),
        action,
        "user",
        Outcome::Applied,
        Severity::Workflow,
        EntityId::new(),
    )
    .with_payload(serde_json::json!({"key": key, "before": prior_value, "after": new_value}));
    let at = Timestamp::now_iso();

    if is_protection_default {
        bus.write_audit(
            entry,
            TOPIC_PROTECTION_DEFAULT_CHANGED,
            Source::User,
            ProtectionDefaultChanged {
                scope: GLOBAL_PROTECTION_DEFAULT_SCOPE.to_owned(),
                key: key.to_owned(),
                old: Some(prior_value.clone()),
                new: new_value.clone(),
                changed_at: at,
            },
        )
        .await
        .map_err(bus_err)
    } else {
        bus.write_audit(
            entry,
            TOPIC_SETTINGS_CHANGED,
            Source::User,
            SettingsChanged {
                key: key.to_owned(),
                prior_value: prior_value.clone(),
                new_value: new_value.clone(),
                at,
            },
        )
        .await
        .map_err(bus_err)
    }
}

/// Write a durable `Outcome::Refused` audit row for a rejected `settings.update`
/// attempt (FR-130/FR-134, T127) before returning the validation error to the
/// caller. No before/after pair — validation is rejected before any read.
/// `is_protection_default` picks the same `EntityType` the applied path would
/// have used, so a refused global-protection-default write (e.g. `T123`'s
/// "protection refused" coverage) is tagged `EntityType::Protection`, not
/// `EntityType::Settings`.
async fn write_settings_refusal(
    bus: &EventBus,
    is_protection_default: bool,
    key: &str,
    reason_code: &str,
) -> Result<(), ContractError> {
    let entity_type =
        if is_protection_default { EntityType::Protection } else { EntityType::Settings };
    let entry = AuditLogEntry::new(
        entity_type,
        settings_entity_id(key),
        "settings.update",
        "user",
        Outcome::Refused,
        Severity::Workflow,
        EntityId::new(),
    )
    .with_reason_code(reason_code.to_owned())
    .with_payload(serde_json::json!({"key": key}));
    bus.write_audit(
        entry,
        TOPIC_SETTINGS_CHANGED,
        Source::User,
        serde_json::json!({
            "key": key,
            "outcome": "refused",
            "reasonCode": reason_code,
        }),
    )
    .await
    .map_err(bus_err)?;
    Ok(())
}

// ── restore_defaults ──────────────────────────────────────────────────────

/// Restore one or more settings keys to their in-code defaults (T027).
///
/// - Empty `keys` slice restores all v1 keys.
/// - Keys already at default are collected in `already_at_default` and skipped
///   (no write, no audit — R-3.1).
/// - When all keys are already at default, returns `status = "noop"`.
/// - For each key actually restored, one audit event is emitted.
///
/// # Errors
///
/// Returns `ContractError` with code `"key.unknown"` if any key is not a valid
/// v1 key (structured-path keys accepted). Returns internal errors on DB/audit
/// failure.
pub async fn restore_defaults(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &RestoreDefaultsRequest,
) -> Result<RestoreDefaultsResponse, ContractError> {
    let keys_to_restore: Vec<String> = if req.keys.is_empty() {
        descriptors::all_keys().map(str::to_owned).collect()
    } else {
        // Validate all requested keys first.
        for key in &req.keys {
            if !is_valid_key(key) {
                return Err(ContractError::new(
                    ErrorCode::KeyUnknown,
                    format!("unknown settings key: {key}"),
                    ErrorSeverity::Warning,
                    false,
                ));
            }
        }
        req.keys.clone()
    };

    let mut restored = Vec::new();
    let mut already_at_default = Vec::new();
    let mut restored_protection_default = false;

    for key in &keys_to_restore {
        let default_val = default_value_for_key(key);
        let is_protection_default = is_global_protection_default_key(key);
        let current_raw = if is_protection_default {
            protection_repo::get_protection_default(pool, GLOBAL_PROTECTION_DEFAULT_SCOPE, key)
                .await
                .map_err(db_err)?
        } else {
            repo::get_raw(pool, key).await.map_err(db_err)?
        };
        let current_val = current_raw.unwrap_or_else(|| default_val.clone());

        if settings_value_eq(&current_val, &default_val) {
            already_at_default.push(key.clone());
            continue;
        }

        // Write the default value.
        if is_protection_default {
            protection_repo::set_protection_default(
                pool,
                GLOBAL_PROTECTION_DEFAULT_SCOPE,
                key,
                &default_val,
            )
            .await
            .map_err(db_err)?;
        } else {
            repo::set_raw(pool, key, &default_val).await.map_err(db_err)?;
        }

        // Write durable audit row + live event (even for noisy keys — restore
        // is an explicit action, FR-130).
        write_settings_applied_audit(
            bus,
            is_protection_default,
            "settings.restore_defaults",
            key,
            &current_val,
            &default_val,
        )
        .await?;

        restored.push(key.clone());
        if is_protection_default {
            restored_protection_default = true;
        }
    }

    // Cache invalidation fan-out: one shot after the loop (not per-key) since
    // both snapshots are single-slot whole-bag caches.
    if !restored.is_empty() {
        caches::invalidate_settings_bag();
        app_core_calibration::caches::invalidate_calibration_config();
        if restored_protection_default {
            app_core_cache::invalidate_protection_defaults();
        }
    }

    let status = if restored.is_empty() {
        RestoreDefaultsStatus::Noop
    } else {
        RestoreDefaultsStatus::Success
    };

    Ok(RestoreDefaultsResponse { status, restored, already_at_default })
}

// ── set_source_override ───────────────────────────────────────────────────

/// Set a per-source override for an overridable settings key (T023).
///
/// Validates that `key` is overridable per `descriptors::DESCRIPTORS`
/// (currently just `defaultProtection` — issue #623 removed `followSymlinks`/
/// `hashOnScan` from this list, since they duplicated the canonical
/// `IngestionSettings` document and the per-source override never worked for
/// either). Validates the value type. The `source_id` existence check is
/// best-effort: since the sources repository is in a different crate slice,
/// callers may perform that check before calling this function.
///
/// # Errors
///
/// Returns `ContractError` with code `"key.unoverridable"` for non-overridable
/// keys. Returns `"value.invalid"` for type-invalid values.
pub async fn set_source_override(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &SetSourceOverrideRequest,
) -> Result<SetSourceOverrideResponse, ContractError> {
    let key = &req.key;
    // FR-130/T122 FIX (review round 1 #1): a per-source override is a durable
    // settings mutation regardless of whether a live caller exists today —
    // entity_id keys on (source_id, key) so a source's override history for
    // one key correlates under a single audit entity, distinct from the
    // global-key entity `update_setting` uses.
    let entity_seed = format!("{}:{key}", req.source_id);

    if !descriptors::is_overridable(key.as_str()) {
        write_settings_override_refusal(bus, &entity_seed, key, "key.unoverridable").await?;
        return Err(ContractError::new(
            ErrorCode::KeyUnoverridable,
            format!("key {key} cannot be overridden per source"),
            ErrorSeverity::Warning,
            false,
        ));
    }

    let value = &req.value.0;
    if let Err(e) = validate_value(key, value) {
        write_settings_override_refusal(bus, &entity_seed, key, "value.invalid").await?;
        return Err(e);
    }

    repo::set_source_override(pool, &req.source_id, key, value).await.map_err(db_err)?;

    // `get_settings`'s bag is global-only (no source_id), so a per-source
    // override never actually changes it; invalidating anyway is a cheap,
    // safe no-op that keeps this write site consistent with the other two.
    // Unlike `update_setting`/`restore_defaults`, no calibration/protection
    // global key is ever written on this path, so no further fan-out applies.
    caches::invalidate_settings_bag();

    let entry = AuditLogEntry::new(
        EntityType::Settings,
        settings_entity_id(&entity_seed),
        "settings.source_override.set",
        "user",
        Outcome::Applied,
        Severity::Workflow,
        EntityId::new(),
    )
    .with_payload(serde_json::json!({"sourceId": req.source_id, "key": key, "after": value}));
    bus.write_audit(
        entry,
        TOPIC_SETTINGS_CHANGED,
        Source::User,
        serde_json::json!({"sourceId": req.source_id, "key": key}),
    )
    .await
    .map_err(bus_err)?;

    Ok(SetSourceOverrideResponse { source_id: req.source_id.clone(), key: key.clone() })
}

/// Write a durable `Outcome::Refused` row for a rejected `set_source_override`
/// attempt (FR-130, review round 1 #1).
async fn write_settings_override_refusal(
    bus: &EventBus,
    entity_seed: &str,
    key: &str,
    reason_code: &str,
) -> Result<(), ContractError> {
    let entry = AuditLogEntry::new(
        EntityType::Settings,
        settings_entity_id(entity_seed),
        "settings.source_override.set",
        "user",
        Outcome::Refused,
        Severity::Workflow,
        EntityId::new(),
    )
    .with_reason_code(reason_code.to_owned())
    .with_payload(serde_json::json!({"key": key}));
    bus.write_audit(
        entry,
        TOPIC_SETTINGS_CHANGED,
        Source::User,
        serde_json::json!({"key": key, "outcome": "refused", "reasonCode": reason_code}),
    )
    .await
    .map_err(bus_err)?;
    Ok(())
}

// ── resolve_setting ───────────────────────────────────────────────────────

/// Resolve the effective value for a settings key, honouring per-source
/// override → global setting → in-code default (T024, data-model.md §Resolution).
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn resolve_setting(
    pool: &SqlitePool,
    key: &str,
    source_id: Option<&str>,
) -> Result<Value, ContractError> {
    // 1. Per-source override (only for overridable keys).
    if let Some(sid) = source_id {
        if descriptors::is_overridable(key) {
            if let Some(v) =
                persistence_db::repositories::settings::get_source_override_raw(pool, sid, key)
                    .await
                    .map_err(db_err)?
            {
                return Ok(v);
            }
        }
    }

    // 2. Global setting. Global protection-default keys are resolved from the
    // dedicated `protection_defaults` table (spec 016 T-005) so this read path
    // never disagrees with `app_core::protection::load_global_protection`.
    if is_global_protection_default_key(key) {
        if let Some(v) =
            protection_repo::get_protection_default(pool, GLOBAL_PROTECTION_DEFAULT_SCOPE, key)
                .await
                .map_err(db_err)?
        {
            return Ok(v);
        }
    } else if let Some(v) = repo::get_raw(pool, key).await.map_err(db_err)? {
        return Ok(v);
    }

    // 3. In-code default.
    Ok(default_value_for_key(key))
}

// ── emit_snapshot ──────────────────────────────────────────────────────────

/// Emit a `settings.snapshot` audit event (T020).
///
/// Called at session start and after the 5-minute inactivity debounce
/// (the debounce timer is owned by the caller/command layer).
///
/// Issue #668: a periodic snapshot whose noisy-key values are byte-identical
/// to the last one PUBLISHED is a no-op heartbeat — it is skipped rather than
/// published, mirroring `target.resolve_batch.completed`'s suppression on
/// `considered == 0` (both stop a periodic internal event from flooding the
/// activity log when there is nothing new to report). The first snapshot in a
/// process (no prior published value) always publishes.
///
/// # Errors
///
/// Returns `ContractError` on database or audit failure.
pub async fn emit_snapshot(
    pool: &SqlitePool,
    bus: &EventBus,
    trigger: &str,
) -> Result<(), ContractError> {
    // Collect current values of noisy keys.
    let mut noisy_values = serde_json::Map::new();
    for key in descriptors::noisy_keys() {
        let val = repo::get_raw(pool, key)
            .await
            .map_err(db_err)?
            .unwrap_or_else(|| default_value_for_key(key));
        noisy_values.insert(key.to_owned(), val);
    }
    let noisy_keys = Value::Object(noisy_values);

    // Skip the publish when nothing changed since the last one we actually
    // published (#668).
    if caches::last_snapshot_values().load().as_deref() == Some(&noisy_keys) {
        return Ok(());
    }

    let at = Timestamp::now_iso();
    bus.publish(
        TOPIC_SETTINGS_SNAPSHOT,
        Source::System,
        SettingsSnapshot { trigger: trigger.to_owned(), noisy_keys: noisy_keys.clone(), at },
    )
    .await
    .map_err(bus_err)?;
    caches::store_last_snapshot_values(std::sync::Arc::new(noisy_keys));

    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use audit::EventBus;
    use persistence_db::Database;
    use proptest::prelude::*;
    use rstest::rstest;
    use serde_json::json;

    /// US11 T144 guard: every key in the descriptor table is a valid key, has a
    /// non-null in-code default (except the nullable `currentLibraryId`), and
    /// is recognised by `is_valid_key`. Locks the descriptor registry against
    /// drift from `default_value_for_key` / `SettingsState`.
    #[test]
    fn descriptor_keys_match_state_defaults() {
        // Keys whose in-code default is legitimately null (nullable by design).
        const NULLABLE_KEYS: &[&str] =
            &["currentLibraryId", "observingDefaultSiteId", "observingActiveSiteId"];
        for key in descriptors::all_keys() {
            assert!(is_valid_key(key), "descriptor key {key} not accepted by is_valid_key");
            let default = default_value_for_key(key);
            if NULLABLE_KEYS.contains(&key) {
                assert!(default.is_null(), "{key} default should be null");
            } else {
                assert!(!default.is_null(), "descriptor key {key} has no in-code default");
            }
        }
    }

    /// n5_settingstable guard: every descriptor's `apply` and `default`
    /// accessors agree — applying a key's in-code default onto a fresh
    /// `SettingsState` and re-serialising it must reproduce that same default
    /// value at the key's wire name. Catches a mismatched/misspelled field in
    /// either accessor (they're independently hand-written closures).
    #[test]
    fn descriptor_apply_and_default_round_trip() {
        for key in descriptors::all_keys() {
            let default_value = default_value_for_key(key);
            let mut state = SettingsState::default();
            apply_value_to_state(key, default_value.clone(), &mut state);

            let serialized = serde_json::to_value(&state).expect("state serializes");
            let obj = serialized.as_object().expect("state is a JSON object");
            // Missing key means skip_serializing_if hid a None field (e.g.
            // currentLibraryId) — that's equivalent to an explicit null.
            let round_tripped = obj.get(key).cloned().unwrap_or(Value::Null);

            assert_eq!(
                round_tripped, default_value,
                "{key}: apply(default_value_for_key) must round-trip through SettingsState"
            );
        }
    }

    /// Canonical key naming guard (tinyspec: settings-key-canonicalization).
    ///
    /// Every stable key in the descriptor registry must equal the serde-camelCase
    /// wire name of its corresponding `SettingsState` field. We derive the wire
    /// names by serialising a fully-populated `SettingsState` (with the optional
    /// `currentLibraryId` set to a sentinel so it is not skip-serialised) and
    /// collecting the top-level field names — serde `rename_all = "camelCase"`
    /// produces exactly the canonical camelCase wire names.
    ///
    /// This test will fail if:
    /// - A descriptor key uses the old dotted/snake style instead of camelCase.
    /// - A new `SettingsState` field is added without a matching descriptor entry.
    /// - A descriptor entry exists for a key not present in `SettingsState`.
    #[test]
    fn descriptor_keys_are_canonical_camel_case_wire_names() {
        use std::collections::BTreeSet;

        // Populate the optional field so `skip_serializing_if = "Option::is_none"`
        // doesn't hide `currentLibraryId` from the serialised output.
        let state = SettingsState {
            current_library_id: Some("__probe__".to_owned()),
            ..SettingsState::default()
        };

        // Derive wire field names from the actual serde serialisation — ground truth.
        let state_json = serde_json::to_value(&state).expect("SettingsState serialises");
        let wire_fields: BTreeSet<String> = state_json
            .as_object()
            .expect("SettingsState is a JSON object")
            .keys()
            .cloned()
            .collect();

        let descriptor_keys: BTreeSet<String> =
            descriptors::all_keys().map(str::to_owned).collect();

        // Every descriptor key must appear as a wire field name.
        for key in &descriptor_keys {
            assert!(
                wire_fields.contains(key),
                "descriptor key '{key}' is not a camelCase wire field name of SettingsState; \
                 known wire fields: {wire_fields:?}"
            );
        }

        // Every wire field name must have a descriptor entry.
        for field in &wire_fields {
            assert!(
                descriptor_keys.contains(field),
                "SettingsState wire field '{field}' has no descriptor entry; \
                 add it to DESCRIPTORS in descriptors.rs"
            );
        }
    }

    async fn setup() -> (Database, EventBus) {
        // SETTINGS_BAG is a process-global single-slot cache (F0); each test
        // gets its own in-memory DB, so a stale cross-test snapshot would
        // silently serve another test's data. Mirrors the same caveat/fix in
        // `app_core_cache`'s `protection_defaults_*` test (crates/app/cache/src/lib.rs).
        caches::invalidate_settings_bag();
        // Same hazard for the #668 last-published-snapshot cache: without
        // this, a `emit_snapshot`-must-publish assertion here could
        // false-negative if a sibling test already stored an
        // identical-looking noisy-keys bag (fresh in-memory DBs share the
        // same in-code defaults).
        caches::invalidate_last_snapshot_values();
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        let bus = EventBus::with_pool(db.pool().clone());
        (db, bus)
    }

    // ── T007: settings.get contract test ───────────────────────────────

    #[tokio::test]
    async fn get_settings_returns_defaults_when_empty() {
        let (db, bus) = setup().await;
        let resp = get_settings(db.pool(), &bus).await.unwrap();
        let defaults = SettingsState::default();
        assert_eq!(resp.settings.log_level, defaults.log_level);
        assert_eq!(resp.settings.follow_symlinks, defaults.follow_symlinks);
        assert_eq!(resp.settings.hash_on_scan, defaults.hash_on_scan);
        assert_eq!(resp.settings.protected_categories, defaults.protected_categories);
        assert!(!resp.settings.dev_mode);
    }

    // ── T008: settings.update contract tests ───────────────────────────

    #[tokio::test]
    async fn update_setting_happy_path_non_noisy() {
        let (db, bus) = setup().await;
        let req = SettingsUpdateRequest {
            key: "logLevel".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!("debug")),
        };
        let resp = update_setting(db.pool(), &bus, &req).await.unwrap();
        assert_eq!(resp.status, SettingsUpdateStatus::Success);
        assert_eq!(resp.key, "logLevel");
        // Non-noisy key should have an audit_id.
        assert!(resp.audit_id.is_some());
    }

    /// FR-131/SC-009 (T122): the returned `audit_id` must resolve to a real
    /// durable `audit_log_entry` row, not just a bus-only event id.
    #[tokio::test]
    async fn update_setting_audit_id_resolves_to_durable_row() {
        let (db, bus) = setup().await;
        let req = SettingsUpdateRequest {
            key: "logLevel".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!("debug")),
        };
        let resp = update_setting(db.pool(), &bus, &req).await.unwrap();
        let audit_id = resp.audit_id.expect("non-noisy key must return an audit_id");

        let row: (String, String) =
            sqlx::query_as("SELECT entity_type, outcome FROM audit_log_entry WHERE audit_id = ?")
                .bind(&audit_id)
                .fetch_one(db.pool())
                .await
                .expect("audit_id must resolve to a durable audit_log_entry row");
        assert_eq!(row.0, "settings");
        assert_eq!(row.1, "applied");
    }

    /// FR-130 (T122): `pattern` is `noisy` (debounced) but is a durable-data
    /// key — it must still audit at its committed value, unlike a UI-state
    /// noisy key (see `update_setting_noisy_key_no_audit_id`).
    #[tokio::test]
    async fn update_setting_noisy_audited_key_pattern_gets_audit_id() {
        let (db, bus) = setup().await;
        let req = SettingsUpdateRequest {
            key: "pattern".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!([{
                "type": "literal", "value": "changed"
            }])),
        };
        let resp = update_setting(db.pool(), &bus, &req).await.unwrap();
        assert_eq!(resp.status, SettingsUpdateStatus::Success);
        assert!(resp.audit_id.is_some(), "durable-data noisy key `pattern` must still be audited");
    }

    /// T127: a refused `settings.update` (unknown key) writes a durable
    /// `Outcome::Refused` row with a reason_code, per FR-130/FR-134.
    #[tokio::test]
    async fn update_setting_refused_unknown_key_writes_durable_row() {
        let (db, bus) = setup().await;
        let req = SettingsUpdateRequest {
            key: "notARealKey".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!("whatever")),
        };
        let err = update_setting(db.pool(), &bus, &req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::KeyUnknown);

        let row: (String, Option<String>) = sqlx::query_as(
            "SELECT outcome, reason_code FROM audit_log_entry WHERE entity_type = 'settings' AND outcome = 'refused'",
        )
        .fetch_one(db.pool())
        .await
        .expect("refused settings.update must write a durable audit row");
        assert_eq!(row.0, "refused");
        assert_eq!(row.1.as_deref(), Some("key.unknown"));
    }

    /// Theme durability round trip (theme-settings-db): `settings.update`
    /// persists the choice to the real settings table, and `resolve_setting`
    /// — the same lookup `settings_get` uses — reads it back, proving the DB
    /// (not localStorage) is the durable source of truth.
    #[tokio::test]
    async fn theme_persists_and_resolves_via_settings_db() {
        let (db, bus) = setup().await;
        assert_eq!(
            resolve_setting(db.pool(), "theme", None).await.unwrap(),
            serde_json::json!("system"),
            "default theme should be \"system\" before any write"
        );

        let req = SettingsUpdateRequest {
            key: "theme".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!("espresso-dark")),
        };
        let resp = update_setting(db.pool(), &bus, &req).await.unwrap();
        assert_eq!(resp.status, SettingsUpdateStatus::Success);

        assert_eq!(
            resolve_setting(db.pool(), "theme", None).await.unwrap(),
            serde_json::json!("espresso-dark")
        );
    }

    #[tokio::test]
    async fn update_setting_noop_when_value_unchanged() {
        let (db, bus) = setup().await;
        // logLevel default is "info".
        let req = SettingsUpdateRequest {
            key: "logLevel".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!("info")),
        };
        let resp = update_setting(db.pool(), &bus, &req).await.unwrap();
        assert_eq!(resp.status, SettingsUpdateStatus::Noop);
        assert!(resp.audit_id.is_none());
    }

    #[tokio::test]
    async fn update_setting_rejects_unknown_key() {
        let (db, bus) = setup().await;
        let req = SettingsUpdateRequest {
            key: "notARealKey".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!("whatever")),
        };
        let err = update_setting(db.pool(), &bus, &req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::KeyUnknown);
    }

    #[tokio::test]
    async fn update_setting_rejects_invalid_value() {
        let (db, bus) = setup().await;
        let req = SettingsUpdateRequest {
            key: "logLevel".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!("trace")), // not a valid level
        };
        let err = update_setting(db.pool(), &bus, &req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::ValueInvalid);
    }

    #[tokio::test]
    async fn update_setting_noisy_key_no_audit_id() {
        let (db, bus) = setup().await;
        // "rememberFollowLogs" default is false; change to true.
        let req = SettingsUpdateRequest {
            key: "rememberFollowLogs".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!(true)),
        };
        let resp = update_setting(db.pool(), &bus, &req).await.unwrap();
        assert_eq!(resp.status, SettingsUpdateStatus::Success);
        // Noisy key: no per-change audit id.
        assert!(resp.audit_id.is_none());
    }

    #[tokio::test]
    async fn update_setting_pattern_noop_structural_equality() {
        let (db, bus) = setup().await;
        // Get the default pattern and send it back — must be noop (A4, R4.1).
        let defaults = SettingsState::default();
        let pattern_value = serde_json::to_value(&defaults.pattern).unwrap();
        let req = SettingsUpdateRequest {
            key: "pattern".to_owned(),
            value: contracts_core::JsonAny::from(pattern_value),
        };
        let resp = update_setting(db.pool(), &bus, &req).await.unwrap();
        assert_eq!(resp.status, SettingsUpdateStatus::Noop);
    }

    #[tokio::test]
    async fn update_setting_protected_categories_noop_structural_equality() {
        let (db, bus) = setup().await;
        // Default is ["lights", "masters", "finals"] — same value must be noop (R-Set-1).
        let defaults = SettingsState::default();
        let value = serde_json::to_value(&defaults.protected_categories).unwrap();
        let req = SettingsUpdateRequest {
            key: "protectedCategories".to_owned(),
            value: contracts_core::JsonAny::from(value),
        };
        let resp = update_setting(db.pool(), &bus, &req).await.unwrap();
        assert_eq!(resp.status, SettingsUpdateStatus::Noop);
    }

    // ── T016: invalid stored value resets to default ───────────────────

    #[tokio::test]
    async fn get_settings_repairs_invalid_stored_value() {
        let (db, bus) = setup().await;
        // Inject an invalid value directly.
        repo::set_raw(db.pool(), "logLevel", &serde_json::json!("trace")).await.unwrap();
        let resp = get_settings(db.pool(), &bus).await.unwrap();
        // Should have been repaired to the default.
        assert_eq!(resp.settings.log_level, "info");
        // The bad row should have been deleted.
        let raw = repo::get_raw(db.pool(), "logLevel").await.unwrap();
        assert!(raw.is_none());
    }

    // ── T021/T022: source override tests ──────────────────────────────

    #[tokio::test]
    async fn set_source_override_happy_path() {
        let (db, bus) = setup().await;
        let req = SetSourceOverrideRequest {
            source_id: "src-abc".to_owned(),
            key: "defaultProtection".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!("unprotected")),
        };
        let resp = set_source_override(db.pool(), &bus, &req).await.unwrap();
        assert_eq!(resp.source_id, "src-abc");
        assert_eq!(resp.key, "defaultProtection");
    }

    /// Review round 1 #1: `set_source_override`'s durable audit id resolves
    /// to a real `audit_log_entry` row (FR-130/FR-131).
    #[tokio::test]
    async fn set_source_override_writes_durable_applied_audit_row() {
        let (db, bus) = setup().await;
        let req = SetSourceOverrideRequest {
            source_id: "src-abc".to_owned(),
            key: "defaultProtection".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!("unprotected")),
        };
        set_source_override(db.pool(), &bus, &req).await.unwrap();

        let row: (String, String) = sqlx::query_as(
            "SELECT entity_type, outcome FROM audit_log_entry WHERE trigger = 'settings.source_override.set'",
        )
        .fetch_one(db.pool())
        .await
        .expect("set_source_override must write a durable audit row");
        assert_eq!(row.0, "settings");
        assert_eq!(row.1, "applied");
    }

    #[tokio::test]
    async fn set_source_override_rejects_unoverridable_key() {
        let (db, bus) = setup().await;
        let req = SetSourceOverrideRequest {
            source_id: "src-abc".to_owned(),
            key: "logLevel".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!("debug")),
        };
        let err = set_source_override(db.pool(), &bus, &req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::KeyUnoverridable);

        let row: (String, Option<String>) = sqlx::query_as(
            "SELECT outcome, reason_code FROM audit_log_entry WHERE trigger = 'settings.source_override.set' AND outcome = 'refused'",
        )
        .fetch_one(db.pool())
        .await
        .expect("refused set_source_override must write a durable audit row");
        assert_eq!(row.0, "refused");
        assert_eq!(row.1.as_deref(), Some("key.unoverridable"));
    }

    /// Issue #623: `followSymlinks`/`hashOnScan` duplicated the canonical
    /// `IngestionSettings` document and could never succeed as a per-source
    /// override (`hashOnScan` needs a string, the UI only ever offered a
    /// boolean — #646) — removed from the overridable set entirely.
    #[rstest]
    #[case("followSymlinks")]
    #[case("hashOnScan")]
    #[tokio::test]
    async fn set_source_override_rejects_retired_scan_behavior_keys(#[case] key: &str) {
        let (db, bus) = setup().await;
        let req = SetSourceOverrideRequest {
            source_id: "src-abc".to_owned(),
            key: key.to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!(true)),
        };
        let err = set_source_override(db.pool(), &bus, &req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::KeyUnoverridable);
    }

    // ── T022: resolution order ─────────────────────────────────────────

    #[tokio::test]
    async fn resolve_setting_prefers_source_override() {
        let (db, bus) = setup().await;

        // Set global to "protected".
        let req = SettingsUpdateRequest {
            key: "defaultProtection".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!("protected")),
        };
        update_setting(db.pool(), &bus, &req).await.unwrap();

        // Set source override to "unprotected".
        let ov_req = SetSourceOverrideRequest {
            source_id: "src-1".to_owned(),
            key: "defaultProtection".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!("unprotected")),
        };
        set_source_override(db.pool(), &bus, &ov_req).await.unwrap();

        let resolved =
            resolve_setting(db.pool(), "defaultProtection", Some("src-1")).await.unwrap();
        assert_eq!(resolved, serde_json::json!("unprotected"));
    }

    #[tokio::test]
    async fn resolve_setting_falls_back_to_global() {
        let (db, bus) = setup().await;
        let req = SettingsUpdateRequest {
            key: "defaultProtection".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!("unprotected")),
        };
        update_setting(db.pool(), &bus, &req).await.unwrap();

        // No override for "src-2".
        let resolved =
            resolve_setting(db.pool(), "defaultProtection", Some("src-2")).await.unwrap();
        assert_eq!(resolved, serde_json::json!("unprotected"));
    }

    #[tokio::test]
    async fn resolve_setting_falls_back_to_default() {
        let (db, _bus) = setup().await;
        let resolved = resolve_setting(db.pool(), "hashOnScan", None).await.unwrap();
        assert_eq!(resolved, serde_json::json!("lazy")); // default
    }

    /// #645: the `catalogues` scope's `enabled` key is a known, persistable
    /// key (previously silently skipped as unknown), and the persisted value
    /// survives a fresh `resolve_setting` read (the reload path).
    #[tokio::test]
    async fn update_setting_enabled_catalogues_persists_across_reload() {
        let (db, bus) = setup().await;

        // Default (nothing stored yet) is the in-code default subset.
        let default = resolve_setting(db.pool(), "enabled", None).await.unwrap();
        assert_eq!(default, serde_json::json!(["M", "NGC", "IC", "Sh2"]));

        let req = SettingsUpdateRequest {
            key: "enabled".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!([
                "M", "NGC", "IC", "Sh2", "LBN"
            ])),
        };
        let resp = update_setting(db.pool(), &bus, &req).await.unwrap();
        assert_eq!(resp.status, SettingsUpdateStatus::Success);

        // Simulates "leave the pane and return": a fresh resolve reads the
        // persisted row, not the in-code default.
        let reloaded = resolve_setting(db.pool(), "enabled", None).await.unwrap();
        assert_eq!(reloaded, serde_json::json!(["M", "NGC", "IC", "Sh2", "LBN"]));
    }

    /// #645: an unknown catalogue id is rejected as `value.invalid`, not
    /// silently accepted.
    #[tokio::test]
    async fn update_setting_enabled_catalogues_rejects_unknown_id() {
        let (db, bus) = setup().await;
        let req = SettingsUpdateRequest {
            key: "enabled".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!(["NotACatalogue"])),
        };
        let err = update_setting(db.pool(), &bus, &req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::ValueInvalid);
    }

    // ── T026: restore_defaults contract tests ──────────────────────────

    #[tokio::test]
    async fn restore_defaults_restores_changed_keys() {
        let (db, bus) = setup().await;

        // Change logLevel.
        let req = SettingsUpdateRequest {
            key: "logLevel".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!("debug")),
        };
        update_setting(db.pool(), &bus, &req).await.unwrap();

        // Restore logLevel.
        let restore_req = RestoreDefaultsRequest { keys: vec!["logLevel".to_owned()] };
        let resp = restore_defaults(db.pool(), &bus, &restore_req).await.unwrap();
        assert_eq!(resp.status, RestoreDefaultsStatus::Success);
        assert!(resp.restored.contains(&"logLevel".to_owned()));
        assert!(resp.already_at_default.is_empty());

        // Verify it's back to default.
        let restored_val = repo::get_raw(db.pool(), "logLevel").await.unwrap();
        assert_eq!(restored_val, Some(serde_json::json!("info")));
    }

    #[tokio::test]
    async fn restore_defaults_noop_when_already_at_default() {
        let (db, bus) = setup().await;
        let restore_req = RestoreDefaultsRequest { keys: vec!["logLevel".to_owned()] };
        let resp = restore_defaults(db.pool(), &bus, &restore_req).await.unwrap();
        assert_eq!(resp.status, RestoreDefaultsStatus::Noop);
        assert!(resp.restored.is_empty());
        assert!(resp.already_at_default.contains(&"logLevel".to_owned()));
    }

    #[tokio::test]
    async fn restore_defaults_rejects_unknown_key() {
        let (db, bus) = setup().await;
        let restore_req = RestoreDefaultsRequest { keys: vec!["notAKey".to_owned()] };
        let err = restore_defaults(db.pool(), &bus, &restore_req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::KeyUnknown);
    }

    // ── Key validation unit tests ──────────────────────────────────────

    /// Table-driven `is_valid_key` cases. `expected` is whether the key should
    /// be accepted as a valid v1 (stable or structured-path) settings key.
    #[rstest]
    // Valid: stable + structured-path keys.
    #[case("logLevel", true)]
    #[case("pattern", true)]
    #[case("calibrationDarkOverridePenalty", true)]
    #[case("calibrationFlatOverridePenalty", true)]
    #[case("calibrationBiasOverridePenalty", true)]
    #[case("theme", true)]
    #[case("framingPointingFractionOfFov", true)]
    #[case("framingPointingFallbackDeg", true)]
    #[case("framingRotationToleranceDeg", true)]
    #[case("framingMosaicEnvelopeFractionOfFov", true)]
    #[case("tools.pixinsight.bundle_id", true)]
    #[case("tools.pixinsight.executable_path", true)]
    #[case("tools.siril.enabled", true)]
    #[case("tools.startools.auto_detected", true)]
    #[case("workflow_profile.my_profile.watch_extensions", true)]
    #[case("workflow_profile.my_profile.launch_attribution_window_hours", true)]
    // Invalid: unknown + malformed structured-path keys.
    #[case("notARealKey", false)]
    #[case("tools.UPPERCASE.bundle_id", false)] // tool id must be lowercase
    #[case("tools..bundle_id", false)] // empty tool id
    #[case("calibration.dark.override_penalty", false)] // old dotted key — no longer valid
    #[case("calibration.video.override_penalty", false)] // video not a valid frame type
    fn is_valid_key_cases(#[case] key: &str, #[case] expected: bool) {
        assert_eq!(is_valid_key(key), expected);
    }

    // ── Value validation unit tests ─────────────────────────────────────
    //
    // These exercise `validate_value` directly. Previously this logic was only
    // covered indirectly through the async DB update tests (e.g. logLevel
    // "trace" rejected). Table-driven cases make the per-key contract explicit.

    /// Cases that must PASS validation for the given key.
    #[rstest]
    #[case("hashOnScan", serde_json::json!("lazy"))]
    #[case("hashOnScan", serde_json::json!("eager"))]
    #[case("hashOnScan", serde_json::json!("off"))]
    #[case("darkMatchTolerance", serde_json::json!("strict"))]
    #[case("darkMatchTolerance", serde_json::json!("loose"))]
    #[case("darkMatchTolerance", serde_json::json!("any"))]
    #[case("flatMatching", serde_json::json!("filter-rot"))]
    #[case("flatMatching", serde_json::json!("filter"))]
    #[case("flatMatching", serde_json::json!("manual"))]
    #[case("logLevel", serde_json::json!("error"))]
    #[case("logLevel", serde_json::json!("warn"))]
    #[case("logLevel", serde_json::json!("info"))]
    #[case("defaultProtection", serde_json::json!("protected"))]
    #[case("defaultProtection", serde_json::json!("unprotected"))]
    #[case("calibrationDarkTempTolerance", serde_json::json!(0.0))]
    #[case("calibrationDarkTempTolerance", serde_json::json!(5.5))]
    #[case("calibrationAgingThresholdDays", serde_json::json!(1))]
    #[case("calibrationAgingThresholdDays", serde_json::json!(3650))]
    #[case("calibrationDarkOverridePenalty", serde_json::json!(0.0))]
    #[case("calibrationFlatOverridePenalty", serde_json::json!(1.0))]
    #[case("calibrationBiasOverridePenalty", serde_json::json!(0.5))]
    #[case("autoApplyPattern", serde_json::json!(true))]
    #[case("calibrationPrefillSuggestion", serde_json::json!(false))]
    #[case("currentLibraryId", serde_json::json!(null))]
    #[case("currentLibraryId", serde_json::json!("lib-1"))]
    #[case("plansListDefaultAgeCutoffDays", serde_json::json!(30))]
    #[case("pattern", serde_json::json!([]))]
    #[case("protectedCategories", serde_json::json!(["lights"]))]
    #[case("tools.pixinsight.bundle_id", serde_json::json!("com.x"))]
    #[case("tools.siril.enabled", serde_json::json!(true))]
    #[case("workflow_profile.p.watch_extensions", serde_json::json!([".fits"]))]
    #[case("workflow_profile.p.launch_attribution_window_hours", serde_json::json!(2))]
    #[case("observingSites", serde_json::json!([]))]
    #[case("observingSites", serde_json::json!([{
        "id": "s1", "name": "Home", "latitudeDeg": 52.1, "longitudeDeg": 5.3,
        "elevationM": 12.0, "timezone": "Europe/Amsterdam",
        "twilight": "astronomical", "minHorizonAltDeg": 0.0
    }]))]
    #[case("observingSites", serde_json::json!([{
        "id": "s2", "name": "Dark", "latitudeDeg": -30.0, "longitudeDeg": -70.0,
        "elevationM": null, "timezone": "America/Santiago",
        "twilight": "nautical", "minHorizonAltDeg": 15.0
    }]))]
    #[case("observingDefaultSiteId", serde_json::json!(null))]
    #[case("observingDefaultSiteId", serde_json::json!("s1"))]
    #[case("observingActiveSiteId", serde_json::json!("s1"))]
    #[case("usableAltitudeDeg", serde_json::json!(30))]
    #[case("usableAltitudeDeg", serde_json::json!(0))]
    #[case("usableAltitudeDeg", serde_json::json!(90))]
    #[case("cleanupTypeOverrides", serde_json::json!({}))] // empty map: all defaults apply
    #[case("cleanupTypeOverrides", serde_json::json!({"1": "Keep", "20": "Delete"}))]
    #[case("theme", serde_json::json!("warm-clay"))]
    #[case("theme", serde_json::json!("warm-slate"))]
    #[case("theme", serde_json::json!("observatory-dark"))]
    #[case("theme", serde_json::json!("espresso-dark"))]
    #[case("theme", serde_json::json!("system"))]
    #[case("framingPointingFractionOfFov", serde_json::json!(0.10))]
    #[case("framingPointingFractionOfFov", serde_json::json!(0.01))]
    #[case("framingPointingFractionOfFov", serde_json::json!(2.0))]
    #[case("framingPointingFallbackDeg", serde_json::json!(0.2))]
    #[case("framingRotationToleranceDeg", serde_json::json!(3.0))]
    #[case("framingMosaicEnvelopeFractionOfFov", serde_json::json!(1.0))]
    fn validate_value_accepts(#[case] key: &str, #[case] value: Value) {
        assert!(validate_value(key, &value).is_ok(), "expected {key}={value} to be accepted");
    }

    /// Cases that must FAIL validation with `ErrorCode::ValueInvalid`.
    #[rstest]
    #[case("hashOnScan", serde_json::json!("nope"))] // not an allowed variant
    #[case("hashOnScan", serde_json::json!(5))] // not a string
    #[case("darkMatchTolerance", serde_json::json!("fuzzy"))]
    #[case("flatMatching", serde_json::json!("auto"))]
    #[case("defaultProtection", serde_json::json!("locked"))]
    // Retired third level (issue #506's 2-level collapse) — no longer valid.
    #[case("defaultProtection", serde_json::json!("normal"))]
    #[case("calibrationDarkTempTolerance", serde_json::json!(-1.0))] // must be >= 0
    #[case("calibrationDarkTempTolerance", serde_json::json!("x"))] // not a number
    #[case("calibrationAgingThresholdDays", serde_json::json!(0))] // below [1,3650]
    #[case("calibrationAgingThresholdDays", serde_json::json!(3651))] // above range
    #[case("calibrationDarkOverridePenalty", serde_json::json!(-0.1))] // below [0,1]
    #[case("calibrationFlatOverridePenalty", serde_json::json!(1.1))] // above [0,1]
    #[case("autoApplyPattern", serde_json::json!("true"))] // string, not boolean
    #[case("currentLibraryId", serde_json::json!(5))] // not string/null
    #[case("plansListDefaultAgeCutoffDays", serde_json::json!("x"))] // not a number
    #[case("pattern", serde_json::json!("notarray"))]
    #[case("protectedCategories", serde_json::json!({}))] // object, not array
    #[case("tools.siril.enabled", serde_json::json!("yes"))] // not a boolean
    #[case("workflow_profile.p.watch_extensions", serde_json::json!("x"))] // not an array
    #[case("observingSites", serde_json::json!("nope"))] // not an array
    #[case("observingSites", serde_json::json!([{"id": "s1"}]))] // missing required fields
    #[case("observingSites", serde_json::json!([{
        "id": "s1", "name": "A", "latitudeDeg": 91.0, "longitudeDeg": 0.0,
        "timezone": "UTC", "twilight": "astronomical", "minHorizonAltDeg": 0.0
    }]))] // latitude out of range
    #[case("observingSites", serde_json::json!([{
        "id": "s1", "name": "A", "latitudeDeg": 0.0, "longitudeDeg": 0.0,
        "timezone": "UTC", "twilight": "civil", "minHorizonAltDeg": 0.0
    }]))] // invalid twilight
    #[case("observingSites", serde_json::json!([
        {"id": "dup", "name": "A", "latitudeDeg": 0.0, "longitudeDeg": 0.0,
         "timezone": "UTC", "twilight": "astronomical", "minHorizonAltDeg": 0.0},
        {"id": "dup", "name": "B", "latitudeDeg": 1.0, "longitudeDeg": 1.0,
         "timezone": "UTC", "twilight": "astronomical", "minHorizonAltDeg": 0.0}
    ]))] // duplicate ids
    #[case("observingDefaultSiteId", serde_json::json!(5))] // not string/null
    #[case("usableAltitudeDeg", serde_json::json!(-1))] // below [0,90]
    #[case("usableAltitudeDeg", serde_json::json!(91))] // above [0,90]
    #[case("usableAltitudeDeg", serde_json::json!("x"))] // not a number
    #[case("cleanupTypeOverrides", serde_json::json!("nope"))] // not an object
    #[case("cleanupTypeOverrides", serde_json::json!({"0": "Keep"}))] // unknown id (below range)
    #[case("cleanupTypeOverrides", serde_json::json!({"21": "Keep"}))] // unknown id (above range)
    #[case("cleanupTypeOverrides", serde_json::json!({"abc": "Keep"}))] // non-numeric id
    #[case("cleanupTypeOverrides", serde_json::json!({"1": "Trash"}))] // not an allowed action
    #[case("cleanupTypeOverrides", serde_json::json!({"1": 5}))] // action not a string
    #[case("theme", serde_json::json!("neon"))] // not an allowed variant
    #[case("theme", serde_json::json!(5))] // not a string
    #[case("framingPointingFractionOfFov", serde_json::json!(0.0))] // below [0.01, 2.0]
    #[case("framingPointingFractionOfFov", serde_json::json!(2.1))] // above range
    #[case("framingPointingFractionOfFov", serde_json::json!("x"))] // not a number
    #[case("framingPointingFallbackDeg", serde_json::json!(0.0))] // below [0.01, 10.0]
    #[case("framingRotationToleranceDeg", serde_json::json!(0.0))] // below [0.1, 45.0]
    #[case("framingMosaicEnvelopeFractionOfFov", serde_json::json!(0.0))] // below [0.1, 5.0]
    fn validate_value_rejects(#[case] key: &str, #[case] value: Value) {
        let err = validate_value(key, &value).expect_err("expected rejection");
        assert_eq!(err.code, ErrorCode::ValueInvalid, "key {key} value {value}");
    }

    /// A fully-populated valid `plannerMoonAvoidance` value (all seven bands).
    fn valid_planner_moon_avoidance() -> Value {
        default_value_for_key("plannerMoonAvoidance")
    }

    /// spec 047 T005: `plannerMoonAvoidance` structured-object validation.
    #[test]
    fn planner_moon_avoidance_accepts_full_valid_bands() {
        assert!(validate_value("plannerMoonAvoidance", &valid_planner_moon_avoidance()).is_ok());
    }

    #[test]
    fn planner_moon_avoidance_default_is_the_shipped_table() {
        let v = valid_planner_moon_avoidance();
        let obj = v.as_object().expect("object");
        assert_eq!(obj.len(), 7);
        assert_eq!(obj["L"]["distanceDeg"], serde_json::json!(120.0));
        assert_eq!(obj["Ha"]["widthDays"], serde_json::json!(7.0));
        assert_eq!(obj["OIII"]["distanceDeg"], serde_json::json!(110.0));
    }

    #[rstest]
    #[case(serde_json::json!("nope"))] // not an object
    #[case(serde_json::json!({"L": {"distanceDeg": 120.0, "widthDays": 14.0}}))] // missing bands
    #[case(serde_json::json!({"X": {"distanceDeg": 1.0, "widthDays": 1.0}}))] // unknown band
    fn planner_moon_avoidance_rejects_shape(#[case] value: Value) {
        let err = validate_value("plannerMoonAvoidance", &value).expect_err("expected rejection");
        assert_eq!(err.code, ErrorCode::ValueInvalid);
    }

    #[test]
    fn planner_moon_avoidance_rejects_out_of_range() {
        let mut v = valid_planner_moon_avoidance();
        v["L"]["distanceDeg"] = serde_json::json!(181.0); // > 180
        assert!(validate_value("plannerMoonAvoidance", &v).is_err());

        let mut v2 = valid_planner_moon_avoidance();
        v2["Ha"]["widthDays"] = serde_json::json!(0.1); // < 0.5
        assert!(validate_value("plannerMoonAvoidance", &v2).is_err());
    }

    #[test]
    fn planner_moon_avoidance_rejects_extra_property() {
        let mut v = valid_planner_moon_avoidance();
        v["L"]["bogus"] = serde_json::json!(1);
        assert!(validate_value("plannerMoonAvoidance", &v).is_err());
    }

    /// Unknown / unconstrained keys impose no additional value validation.
    #[rstest]
    #[case("someUnknownKey", serde_json::json!("anything"))]
    #[case("anotherUnknown", serde_json::json!(42))]
    fn validate_value_passes_unconstrained_keys(#[case] key: &str, #[case] value: Value) {
        assert!(validate_value(key, &value).is_ok());
    }

    // ── spec 044 T008: observing.* settings round-trip + invariants ──────

    /// A fully-populated valid site value.
    fn sample_site(id: &str, lat: f64) -> Value {
        serde_json::json!({
            "id": id, "name": format!("Site {id}"), "latitudeDeg": lat,
            "longitudeDeg": 5.3, "elevationM": 12.0, "timezone": "Europe/Amsterdam",
            "twilight": "astronomical", "minHorizonAltDeg": 0.0
        })
    }

    #[tokio::test]
    async fn observing_sites_round_trip_through_db() {
        let (db, bus) = setup().await;

        // Defaults: empty sites, null pointers, threshold 30.
        assert_eq!(resolve_setting(db.pool(), "observingSites", None).await.unwrap(), json!([]));
        assert!(resolve_setting(db.pool(), "observingActiveSiteId", None).await.unwrap().is_null());
        assert_eq!(
            resolve_setting(db.pool(), "usableAltitudeDeg", None).await.unwrap(),
            json!(30.0)
        );

        // Persist two sites + active pointer + a custom threshold.
        let sites = json!([sample_site("s1", 52.1), sample_site("s2", -30.0)]);
        for (key, value) in [
            ("observingSites", sites.clone()),
            ("observingDefaultSiteId", json!("s1")),
            ("observingActiveSiteId", json!("s2")),
            ("usableAltitudeDeg", json!(40.0)),
        ] {
            update_setting(
                db.pool(),
                &bus,
                &SettingsUpdateRequest { key: key.to_owned(), value: value.into() },
            )
            .await
            .expect("update ok");
        }

        // Read back — the whole ObserverSite[] survives the round-trip.
        assert_eq!(resolve_setting(db.pool(), "observingSites", None).await.unwrap(), sites);
        assert_eq!(
            resolve_setting(db.pool(), "observingActiveSiteId", None).await.unwrap(),
            json!("s2")
        );
        assert_eq!(
            resolve_setting(db.pool(), "usableAltitudeDeg", None).await.unwrap(),
            json!(40.0)
        );

        // Full-state hydration maps the keys onto SettingsState fields.
        let resp = get_settings(db.pool(), &bus).await.unwrap();
        assert_eq!(resp.settings.observing_sites.len(), 2);
        assert_eq!(resp.settings.observing_active_site_id.as_deref(), Some("s2"));
        assert!((resp.settings.usable_altitude_deg - 40.0).abs() < f64::EPSILON);
    }

    #[tokio::test]
    async fn observing_settings_reject_invalid_values() {
        let (db, bus) = setup().await;
        // Out-of-range threshold is rejected as value.invalid.
        let err = update_setting(
            db.pool(),
            &bus,
            &SettingsUpdateRequest {
                key: "usableAltitudeDeg".to_owned(),
                value: json!(120).into(),
            },
        )
        .await
        .expect_err("out-of-range threshold rejected");
        assert_eq!(err.code, ErrorCode::ValueInvalid);
    }

    // ── Framing clustering tunables (spec 008 Q27 F-Framing-11, R11a) ──────

    #[tokio::test]
    async fn framing_tolerances_round_trip_through_db() {
        let (db, bus) = setup().await;

        // R11a shipped defaults.
        assert_eq!(
            resolve_setting(db.pool(), "framingPointingFractionOfFov", None).await.unwrap(),
            json!(0.10)
        );
        assert_eq!(
            resolve_setting(db.pool(), "framingPointingFallbackDeg", None).await.unwrap(),
            json!(0.2)
        );
        assert_eq!(
            resolve_setting(db.pool(), "framingRotationToleranceDeg", None).await.unwrap(),
            json!(3.0)
        );
        assert_eq!(
            resolve_setting(db.pool(), "framingMosaicEnvelopeFractionOfFov", None).await.unwrap(),
            json!(1.0)
        );

        for (key, value) in [
            ("framingPointingFractionOfFov", json!(0.25)),
            ("framingPointingFallbackDeg", json!(0.5)),
            ("framingRotationToleranceDeg", json!(5.0)),
            ("framingMosaicEnvelopeFractionOfFov", json!(1.5)),
        ] {
            update_setting(
                db.pool(),
                &bus,
                &SettingsUpdateRequest { key: key.to_owned(), value: value.into() },
            )
            .await
            .expect("update ok");
        }

        let resp = get_settings(db.pool(), &bus).await.unwrap();
        assert!((resp.settings.framing_pointing_fraction_of_fov - 0.25).abs() < f64::EPSILON);
        assert!((resp.settings.framing_pointing_fallback_deg - 0.5).abs() < f64::EPSILON);
        assert!((resp.settings.framing_rotation_tolerance_deg - 5.0).abs() < f64::EPSILON);
        assert!((resp.settings.framing_mosaic_envelope_fraction_of_fov - 1.5).abs() < f64::EPSILON);
    }

    #[tokio::test]
    async fn framing_tolerances_reject_out_of_range_values() {
        let (db, bus) = setup().await;
        let err = update_setting(
            db.pool(),
            &bus,
            &SettingsUpdateRequest {
                key: "framingRotationToleranceDeg".to_owned(),
                value: json!(90).into(),
            },
        )
        .await
        .expect_err("out-of-range rotation tolerance rejected");
        assert_eq!(err.code, ErrorCode::ValueInvalid);
    }

    // ── T056: aging_threshold_days persists + consumer reads it (FR-023) ──

    #[tokio::test]
    async fn aging_threshold_days_persists_and_is_readable() {
        let (db, bus) = setup().await;

        // Default should be 90.
        let defaults = SettingsState::default();
        assert!(
            (defaults.calibration_aging_threshold_days - 90.0).abs() < f64::EPSILON,
            "default aging threshold must be 90 days"
        );

        // Persist a custom value.
        let req = SettingsUpdateRequest {
            key: "calibrationAgingThresholdDays".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!(180)),
        };
        let resp = update_setting(db.pool(), &bus, &req).await.unwrap();
        assert_eq!(resp.status, SettingsUpdateStatus::Success);

        // Read it back via get_settings — consumer path.
        let get_resp = get_settings(db.pool(), &bus).await.unwrap();
        assert!(
            (get_resp.settings.calibration_aging_threshold_days - 180.0).abs() < f64::EPSILON,
            "calibrationAgingThresholdDays must round-trip: got {}",
            get_resp.settings.calibration_aging_threshold_days
        );
    }

    #[tokio::test]
    async fn aging_threshold_days_rejects_bogus_scope_key() {
        // The old dotted key 'calibration.aging_threshold_days' is no longer valid;
        // the canonical key is 'calibrationAgingThresholdDays'.
        let (db, bus) = setup().await;
        let req = SettingsUpdateRequest {
            key: "calibration.aging_threshold_days".to_owned(), // old dotted key name
            value: contracts_core::JsonAny::from(serde_json::json!(90)),
        };
        let err = update_setting(db.pool(), &bus, &req).await.unwrap_err();
        assert_eq!(
            err.code,
            ErrorCode::KeyUnknown,
            "old dotted key 'calibration.aging_threshold_days' must be rejected"
        );
    }

    // ── Spec 041 FR-026b: patterns_by_type round-trip + validation ─────

    #[tokio::test]
    async fn update_patterns_by_type_round_trips_via_get() {
        let (db, bus) = setup().await;
        let req = SettingsUpdateRequest {
            key: "patternsByType".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!({"dark": "custom/{gain}/"})),
        };
        let resp = update_setting(db.pool(), &bus, &req).await.unwrap();
        assert_eq!(resp.status, SettingsUpdateStatus::Success);

        let get_resp = get_settings(db.pool(), &bus).await.unwrap();
        assert_eq!(
            get_resp.settings.patterns_by_type.get("dark").map(String::as_str),
            Some("custom/{gain}/")
        );
    }

    #[tokio::test]
    async fn update_patterns_by_type_accepts_empty_object() {
        let (db, bus) = setup().await;
        // {} is the default; sending it back is a no-op, but it must validate.
        let req = SettingsUpdateRequest {
            key: "patternsByType".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!({})),
        };
        let resp = update_setting(db.pool(), &bus, &req).await.unwrap();
        assert_eq!(resp.status, SettingsUpdateStatus::Noop);
    }

    #[tokio::test]
    async fn update_patterns_by_type_rejects_invalid_pattern() {
        let (db, bus) = setup().await;
        let req = SettingsUpdateRequest {
            key: "patternsByType".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!({"dark": "{telescope}/"})),
        };
        let err = update_setting(db.pool(), &bus, &req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::ValueInvalid);
    }

    #[tokio::test]
    async fn update_patterns_by_type_rejects_bad_class_name() {
        let (db, bus) = setup().await;
        let req = SettingsUpdateRequest {
            key: "patternsByType".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!({"nope": "x/"})),
        };
        let err = update_setting(db.pool(), &bus, &req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::ValueInvalid);
    }

    #[tokio::test]
    async fn update_patterns_by_type_rejects_non_object() {
        let (db, bus) = setup().await;
        let req = SettingsUpdateRequest {
            key: "patternsByType".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!(["dark"])),
        };
        let err = update_setting(db.pool(), &bus, &req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::ValueInvalid);
    }

    // ── T057: emit_snapshot fires (FR-024) ────────────────────────────

    #[tokio::test]
    async fn emit_snapshot_fires_and_publishes_event() {
        let (db, bus) = setup().await;
        let mut rx = bus.subscribe();

        // Call emit_snapshot — must not error.
        emit_snapshot(db.pool(), &bus, "test_trigger").await.unwrap();

        // There must be at least one event published on the bus.
        // Use try_recv to avoid blocking — the publish is synchronous inside the call.
        let msg = rx.try_recv();
        assert!(msg.is_ok(), "emit_snapshot must publish a settings.snapshot event on the bus");
    }

    /// Issue #668: a periodic no-op snapshot (nothing changed since the last
    /// PUBLISHED one) must not flood the activity log — mirrors
    /// `resolve_pending`'s `considered == 0` suppression for the target
    /// resolve-batch heartbeat.
    #[tokio::test]
    async fn emit_snapshot_suppresses_unchanged_repeat() {
        let (db, bus) = setup().await;

        emit_snapshot(db.pool(), &bus, "first").await.unwrap();
        let mut rx = bus.subscribe();

        // Second call, nothing changed — must be a no-op (no publish).
        emit_snapshot(db.pool(), &bus, "second").await.unwrap();
        assert!(
            rx.try_recv().is_err(),
            "an unchanged repeat snapshot must not publish a second settings.snapshot event"
        );
    }

    /// Issue #668: once a noisy key actually changes, the next snapshot must
    /// still publish (suppression is value-sensitive, not a blanket mute).
    #[tokio::test]
    async fn emit_snapshot_publishes_again_after_a_real_change() {
        let (db, bus) = setup().await;

        emit_snapshot(db.pool(), &bus, "first").await.unwrap();

        // `pattern` is a noisy key (descriptors::DESCRIPTORS) — change it.
        let req = SettingsUpdateRequest {
            key: "pattern".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!(["*.fits"])),
        };
        update_setting(db.pool(), &bus, &req).await.unwrap();

        let mut rx = bus.subscribe();
        emit_snapshot(db.pool(), &bus, "second").await.unwrap();
        assert!(
            rx.try_recv().is_ok(),
            "a snapshot after a real noisy-key change must still publish"
        );
    }

    /// Table-driven structural-equality cases. `expected_eq` is whether the two
    /// values are considered deep-equal (array order is significant).
    #[rstest]
    #[case(serde_json::json!("info"), serde_json::json!("info"), true)]
    #[case(serde_json::json!("info"), serde_json::json!("debug"), false)]
    #[case(
        serde_json::json!(["lights", "masters"]),
        serde_json::json!(["lights", "masters"]),
        true
    )]
    // Order matters: same elements in different order are not equal.
    #[case(
        serde_json::json!(["lights", "masters"]),
        serde_json::json!(["masters", "lights"]),
        false
    )]
    fn settings_value_eq_cases(#[case] a: Value, #[case] b: Value, #[case] expected_eq: bool) {
        assert_eq!(settings_value_eq(&a, &b), expected_eq);
    }

    // ── T042: tools bundle_id seed default ─────────────────────────────────

    /// Resolving `tools.<id>.bundle_id` with no stored override returns the
    /// seed profile's bundle ID for known tools (spec 018 T042).
    #[test]
    fn bundle_id_default_resolves_from_seed_for_pixinsight() {
        let val = default_value_for_key("tools.pixinsight.bundle_id");
        assert_eq!(
            val.as_str(),
            Some("com.pixinsight.PixInsight"),
            "pixinsight seed bundle_id must be the default"
        );
    }

    #[test]
    fn bundle_id_default_resolves_from_seed_for_siril() {
        let val = default_value_for_key("tools.siril.bundle_id");
        assert_eq!(
            val.as_str(),
            Some("org.free-astro.siril"),
            "siril seed bundle_id must be the default"
        );
    }

    #[test]
    fn bundle_id_default_is_null_for_unknown_tool() {
        let val = default_value_for_key("tools.photoshop.bundle_id");
        assert!(val.is_null(), "unknown tool must return null bundle_id default");
    }

    #[test]
    fn overridable_keys_includes_expected_keys() {
        let keys = overridable_keys();
        // Issue #623: followSymlinks/hashOnScan retired from the overridable
        // set — they duplicated the canonical IngestionSettings document and
        // the override could never succeed for either.
        assert!(
            !keys.contains(&"hashOnScan".to_owned()),
            "hashOnScan must no longer be overridable"
        );
        assert!(
            !keys.contains(&"followSymlinks".to_owned()),
            "followSymlinks must no longer be overridable"
        );
        // defaultProtection is the sole overridable key per the descriptor table.
        assert!(
            keys.contains(&"defaultProtection".to_owned()),
            "defaultProtection must be overridable"
        );
    }

    // ── T046: absorbed-key coverage ───────────────────────────────────────

    /// (T046-a) `tools.<id>.bundle_id` update round-trip: persists and reads back.
    ///
    /// validate_value happy path is already covered by `validate_value_accepts`
    /// (`tools.pixinsight.bundle_id` with `"com.x"`). This test adds the missing
    /// async write+read round-trip via `update_setting` + `resolve_setting`.
    #[tokio::test]
    async fn tools_bundle_id_update_round_trips() {
        let (db, bus) = setup().await;

        let req = SettingsUpdateRequest {
            key: "tools.pixinsight.bundle_id".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!("com.example.App")),
        };
        let resp = update_setting(db.pool(), &bus, &req).await.unwrap();
        assert_eq!(resp.status, SettingsUpdateStatus::Success);

        // Read back via resolve_setting (no source override).
        let resolved =
            resolve_setting(db.pool(), "tools.pixinsight.bundle_id", None).await.unwrap();
        assert_eq!(resolved, serde_json::json!("com.example.App"));
    }

    /// (T046-b) `devMode` is rejected in release builds (no `dev-tools` feature).
    ///
    /// The `ValidationRule::DevMode` arm in `descriptors::check_rule` returns
    /// `ErrorCode::ValueInvalid` when compiled without the `dev-tools` feature.
    #[cfg(not(feature = "dev-tools"))]
    #[test]
    fn dev_mode_rejected_in_release_build() {
        let err = validate_value("devMode", &serde_json::json!(true))
            .expect_err("devMode must be rejected in release builds");
        assert_eq!(
            err.code,
            ErrorCode::ValueInvalid,
            "devMode release rejection must use ValueInvalid error code"
        );
    }

    /// (T046-c) `calibrationDarkTempTolerance` >= 0 range: positive value is accepted.
    ///
    /// The -1.0 rejection is already in `validate_value_rejects`. This adds the
    /// explicit positive `2.0` acceptance case as T046 requires both sides.
    #[test]
    fn calibration_dark_temp_tolerance_accepts_positive() {
        assert!(
            validate_value("calibrationDarkTempTolerance", &serde_json::json!(2.0)).is_ok(),
            "calibrationDarkTempTolerance must accept 2.0 (>= 0)"
        );
    }

    /// (T046-d) `imagetypNormalizationUserMappings` deep-equal noop.
    ///
    /// Seed a non-default value, then send a structurally-identical array back.
    /// `settings_value_eq` must detect equality and return `status == "noop"`.
    /// No audit event should be emitted (the existing noop guard covers this).
    #[tokio::test]
    async fn imagetyp_mappings_deep_equal_noop() {
        let (db, bus) = setup().await;

        // A non-default mapping (default is the empty vec []).
        let mapping = serde_json::json!([
            { "imagetypString": "BIAS FRAME", "frameType": "bias" }
        ]);

        // First update: must succeed (not noop — differs from empty default).
        let req = SettingsUpdateRequest {
            key: "imagetypNormalizationUserMappings".to_owned(),
            value: contracts_core::JsonAny::from(mapping.clone()),
        };
        let resp = update_setting(db.pool(), &bus, &req).await.unwrap();
        assert_eq!(resp.status, SettingsUpdateStatus::Success, "initial write must succeed");

        // Second update: structurally identical array — must be noop.
        let req2 = SettingsUpdateRequest {
            key: "imagetypNormalizationUserMappings".to_owned(),
            value: contracts_core::JsonAny::from(mapping.clone()),
        };
        let resp2 = update_setting(db.pool(), &bus, &req2).await.unwrap();
        assert_eq!(
            resp2.status,
            SettingsUpdateStatus::Noop,
            "structurally-identical imagetypNormalizationUserMappings must be noop"
        );
        assert!(resp2.audit_id.is_none(), "noop must not emit audit event");
    }

    /// (spec 051 US3, T022) `cleanupTypeOverrides`: a real change publishes
    /// exactly one `SettingsChanged` bus event and produces an audit record;
    /// re-saving the identical map afterwards is a noop that publishes zero
    /// further events and no additional audit record (SC-003).
    #[tokio::test]
    async fn cleanup_type_overrides_emits_one_event_then_noop() {
        let (db, bus) = setup().await;
        let mut rx = bus.subscribe();

        let overrides = serde_json::json!({"1": "Archive", "20": "Delete"});

        // First write: a real change from the empty-map default — must emit
        // exactly one event and produce an audit record.
        let req = SettingsUpdateRequest {
            key: "cleanupTypeOverrides".to_owned(),
            value: contracts_core::JsonAny::from(overrides.clone()),
        };
        let resp = update_setting(db.pool(), &bus, &req).await.unwrap();
        assert_eq!(resp.status, SettingsUpdateStatus::Success, "initial write must succeed");
        assert!(resp.audit_id.is_some(), "real change must emit an audit event");

        assert!(
            rx.try_recv().is_ok(),
            "real change must publish exactly one SettingsChanged event"
        );
        assert!(
            rx.try_recv().is_err(),
            "real change must publish exactly one SettingsChanged event, not more"
        );

        // Second write: structurally identical map — must be a noop, with no
        // further audit record and no further bus event.
        let req2 = SettingsUpdateRequest {
            key: "cleanupTypeOverrides".to_owned(),
            value: contracts_core::JsonAny::from(overrides),
        };
        let resp2 = update_setting(db.pool(), &bus, &req2).await.unwrap();
        assert_eq!(
            resp2.status,
            SettingsUpdateStatus::Noop,
            "structurally-identical cleanupTypeOverrides must be noop"
        );
        assert!(resp2.audit_id.is_none(), "noop must not emit audit event");
        assert!(rx.try_recv().is_err(), "noop re-save must publish zero events");
    }

    // ── Property tests ─────────────────────────────────────────────────────
    //
    // Invariants over arbitrary input. Proptest uses a deterministic default
    // RNG seed unless `PROPTEST_RNG_SEED` is set, so failures reproduce.

    proptest! {
        // is_valid_key never panics on arbitrary input.
        #[test]
        fn is_valid_key_never_panics(s in ".*") {
            let _ = is_valid_key(&s);
        }

        // validate_value never panics for arbitrary keys paired with a few
        // representative value shapes.
        #[test]
        fn validate_value_never_panics(s in ".*") {
            for v in [
                serde_json::json!(null),
                serde_json::json!(true),
                serde_json::json!(0),
                serde_json::json!("x"),
                serde_json::json!([]),
                serde_json::json!({}),
            ] {
                let _ = validate_value(&s, &v);
            }
        }

        // settings_value_eq is reflexive: any value equals itself.
        #[test]
        fn settings_value_eq_is_reflexive(s in ".*") {
            let v = serde_json::json!(s);
            prop_assert!(settings_value_eq(&v, &v));
        }

        // settings_value_eq is symmetric for arbitrary string pairs.
        #[test]
        fn settings_value_eq_is_symmetric(a in ".*", b in ".*") {
            let va = serde_json::json!(a);
            let vb = serde_json::json!(b);
            prop_assert_eq!(settings_value_eq(&va, &vb), settings_value_eq(&vb, &va));
        }

        // hashOnScan accepts exactly its three allowed variants and rejects all
        // other strings — round-trips the enum contract over arbitrary input.
        #[test]
        fn hash_on_scan_accepts_only_allowed(s in ".*") {
            let allowed = ["lazy", "eager", "off"].contains(&s.as_str());
            let v = serde_json::json!(s);
            prop_assert_eq!(validate_value("hashOnScan", &v).is_ok(), allowed);
        }

        // calibrationAgingThresholdDays bounds: a value validates iff it lies in [1, 3650].
        #[test]
        fn aging_threshold_bounds(n in -10_000i64..10_000i64) {
            #[allow(clippy::cast_precision_loss)]
            let in_range = (1..=3650).contains(&n);
            let v = serde_json::json!(n);
            prop_assert_eq!(
                validate_value("calibrationAgingThresholdDays", &v).is_ok(),
                in_range
            );
        }
    }
}
