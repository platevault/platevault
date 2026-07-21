use super::{descriptors, EntityId};

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
pub(super) const GLOBAL_PROTECTION_DEFAULT_SCOPE: &str = "global";
pub(super) const GLOBAL_PROTECTION_DEFAULT_KEYS: [&str; 3] =
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
// UI-state keys (`rememberFollowLogs`) that FR-134 exempts from durable
// audit entirely, and durable-data keys whose
// writes are debounced/frequent (`pattern`) but still get a single durable
// row at the committed value, before→after (FR-130). This is the same
// named-exception-list shape as `GLOBAL_PROTECTION_DEFAULT_KEYS` above, kept
// separate from the descriptor table rather than adding a new field to every
// one of its literals for a single-member set.
pub(super) const NOISY_AUDITED_KEYS: [&str; 1] = ["pattern"];

/// Whether a `noisy` key still gets a durable audit row at its committed
/// value (`pattern`), vs. being fully exempt as UI state (FR-134).
#[must_use]
pub(super) fn is_noisy_audited_key(key: &str) -> bool {
    NOISY_AUDITED_KEYS.contains(&key)
}

// ── Audit entity identity (spec 030 FR-133, T122) ───────────────────────────

/// Deterministic UUIDv5 `entity_id` for a settings key.
///
/// Settings keys have no natural UUID identity; deriving one from the key
/// name (stable across every write) lets `audit_log_entry` reads correlate
/// the full history of one key under a single `entity_id`, the same way a
/// real entity's rows are correlated by its persisted id.
pub(super) fn settings_entity_id(key: &str) -> EntityId {
    static NAMESPACE: std::sync::OnceLock<uuid::Uuid> = std::sync::OnceLock::new();
    let ns = NAMESPACE.get_or_init(|| {
        uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_DNS, b"astro-plan.audit.settings")
    });
    EntityId::from_uuid(uuid::Uuid::new_v5(ns, key.as_bytes()))
}

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
        || is_locale_key(key)
}

/// `enabled` (#645, scope `"catalogues"`): default-enabled Planner catalogue
/// ids. Not in the descriptor table on purpose — there is no dedicated
/// `SettingsState` field for it (`SettingsState` lives in `domain_core`,
/// outside this crate). Same treatment as the `tools.*`/`workflow_profile.*`
/// structured-path keys: read/write through the DB row + `default_value_for_key`
/// only, never through the in-memory `SettingsState` bag returned by
/// `get_settings` (unused by the Planner/Settings pane for this key).
pub(super) fn is_catalogues_enabled_key(key: &str) -> bool {
    key == "enabled"
}

// ── Locale (spec 061 T001, research D8) ─────────────────────────────────────

/// Shipped BCP-47 application-language tags. The sole source of truth for
/// what `locale` accepts on write and what an unrecognised stored value
/// falls back to on read (data-model.md "Validation").
pub const SHIPPED_LOCALES: [&str; 2] = ["en-GB", "pt-BR"];

/// `locale`: the application-language preference (`general` scope). Not in
/// the descriptor table — same reasoning as `is_catalogues_enabled_key`
/// above: no dedicated `SettingsState` field, so read/write goes through the
/// DB row + `default_value_for_key` only. Registering this (and wiring it
/// into `is_valid_key`) is the fix for research D8: an unregistered key
/// makes `settings.update` silently drop the write while still returning
/// `Ok` to the caller.
pub(super) fn is_locale_key(key: &str) -> bool {
    key == "locale"
}

/// Return the names of every stable v1 settings key, in declaration order.
///
/// Exposed so callers that must enumerate the whole settings surface (the
/// `settings.get` catch-all scope) derive it from the descriptor table instead
/// of maintaining a parallel list that silently drifts when a descriptor is
/// added (#641).
#[must_use]
pub fn stable_keys() -> Vec<&'static str> {
    descriptors::all_keys().collect()
}

/// Return the names of all stable settings keys that can be overridden per source root.
///
/// Used by the `settings.overridable-keys` command (spec 018 T025) to provide the
/// frontend with the authoritative list so it need not hardcode key names.
#[must_use]
pub fn overridable_keys() -> Vec<String> {
    descriptors::DESCRIPTORS.iter().filter(|d| d.overridable).map(|d| d.key.to_owned()).collect()
}

pub(super) fn is_tools_bundle_id_key(key: &str) -> bool {
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

pub(super) fn is_tools_key_with_suffix(key: &str, suffix: &str) -> bool {
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

pub(super) fn is_tools_executable_path_key(key: &str) -> bool {
    // ^tools\.[a-z0-9_]+\.executable_path$
    is_tools_key_with_suffix(key, ".executable_path")
}

pub(super) fn is_tools_enabled_key(key: &str) -> bool {
    // ^tools\.[a-z0-9_]+\.enabled$
    is_tools_key_with_suffix(key, ".enabled")
}

pub(super) fn is_tools_auto_detected_key(key: &str) -> bool {
    // ^tools\.[a-z0-9_]+\.auto_detected$
    is_tools_key_with_suffix(key, ".auto_detected")
}

pub(super) fn is_workflow_profile_watch_extensions_key(key: &str) -> bool {
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

pub(super) fn is_workflow_profile_attribution_window_key(key: &str) -> bool {
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
