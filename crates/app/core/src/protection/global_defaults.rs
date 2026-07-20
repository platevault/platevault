// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! US4: `set_global_protection_default`.

use audit::bus::EventBus;
use contracts_core::ContractError;
use sqlx::SqlitePool;

// ── US4: set_global_protection_default ───────────────────────────────────

/// Persist a global protection default and emit a `protection.default.changed`
/// audit event (T045, FR-018; spec 016 T-003/T-004/T-005).
///
/// `scope` MUST be `"global"` — it is the only scope the desktop settings
/// save path (`settings.update` with scope `"cleanup"`) ever writes to, and
/// the only scope `app_core::protection::load_global_protection` reads from.
/// `key` is one of:
/// - `"defaultProtection"` — protection level string
/// - `"blockPermanentDelete"` — boolean
/// - `"protectedCategories"` — JSON array of category strings
///
/// This delegates to `app_core_settings::update_setting` (re-exported as
/// `crate::settings`) rather than writing `protection_defaults` directly, so
/// there is a single implementation of the validation, no-op guard, and
/// `protection.default.changed` emission shared with the real desktop save
/// path (`settings.update` Tauri command → `crate::settings::update_setting`).
/// Kept as a thin wrapper for callers that already depend on this narrower
/// signature (e.g. this module's own tests).
///
/// # Errors
///
/// Returns `ContractError` with code `"key.unknown"` if `key` is not
/// `defaultProtection` / `blockPermanentDelete` / `protectedCategories`,
/// `"value.invalid"` on a type/enum mismatch, or on DB/audit failure.
pub async fn set_global_protection_default(
    pool: &SqlitePool,
    bus: &EventBus,
    scope: &str,
    key: &str,
    value: serde_json::Value,
) -> Result<(), ContractError> {
    debug_assert_eq!(
        scope, "global",
        "global protection defaults are only ever stored under scope=\"global\""
    );
    let req = contracts_core::settings::SettingsUpdateRequest {
        key: key.to_owned(),
        value: contracts_core::JsonAny::from(value),
    };
    crate::settings::update_setting(pool, bus, &req).await?;
    // Invalidate after commit (F0 contract): all three keys share the single
    // protection_defaults snapshot, so any of them changing must drop it.
    app_core_cache::invalidate_protection_defaults();
    Ok(())
}
