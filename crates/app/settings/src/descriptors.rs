//! Single-source settings descriptor table (US11 T144).
//!
//! Before this module, the stable (non-structured-path) settings keys and their
//! rules were spread across parallel sites in `lib.rs`:
//!
//! - `ALL_V1_KEYS` / `NOISY_KEYS` / `OVERRIDABLE_KEYS` constant lists,
//! - the `validate_value` per-key `match`,
//! - the `default_value_for_key` per-key `match`,
//! - the `apply_value_to_state` per-key `match` (hydration into `SettingsState`).
//!
//! This table is the **single registry** of the stable key set together with
//! each key's audit/override flags, validation rule, and `SettingsState`
//! hydration/default accessors. The constant lists are derived from it,
//! `validate_value` dispatches on [`Descriptor::validation`], and
//! `apply_value_to_state`/`default_value_for_key` in `lib.rs` dispatch on
//! [`Descriptor::apply`]/[`Descriptor::default`] for stable keys. Behavior —
//! including the exact `value.invalid` error strings — is byte-identical to
//! the prior hand-written matches; this is pure consolidation. Adding a
//! settings key now means one table entry here, not edits at three sites.

use contracts_core::settings::SettingsState;
use contracts_core::ContractError;
use serde_json::Value;

/// Validation rule for a stable settings key.
///
/// Each variant reproduces one of the value-shape checks that previously lived
/// as a bespoke arm in `validate_value`. The rendered error messages are
/// byte-identical to the originals.
#[derive(Clone, Copy)]
pub(crate) enum ValidationRule {
    /// String value restricted to a fixed set. `expected_msg` is the exact
    /// trailing text of the original error (e.g. `"\"lazy\", \"eager\", or \"off\""`).
    EnumStr { allowed: &'static [&'static str], expected_msg: &'static str },
    /// Must be a boolean (`"must be a boolean"`).
    Bool,
    /// Must be a number (`"must be a number"`).
    Number,
    /// Must be a number `>= 0` (`"must be a number"` then `"must be >= 0"`).
    NumberMinZero,
    /// Must be a number in an inclusive range, rendered as `"must be in [lo, hi]"`.
    /// `kind` selects the original "must be a number" vs combined message form.
    NumberRangeInclusive { lo: f64, hi: f64, msg: &'static str, want_msg: &'static str },
    /// Must be a string or null (`"must be a string or null"`).
    NullableString,
    /// Must be an array (`"must be an array"`).
    Array,
    /// Per-frame-type destination patterns: JSON object mapping `FrameTypeClass`
    /// names to pattern strings (spec 041 FR-026b).
    PatternsByType,
    /// Observing sites (spec 044 `observingSites`): JSON array of site objects,
    /// each with required `id`/`name`/`latitudeDeg`/`longitudeDeg`/`timezone`/
    /// `twilight`/`minHorizonAltDeg` in range, plus optional `elevationM`; site
    /// ids must be unique.
    ObserverSites,
    /// Per-band Moon-avoidance parameters (spec 047 `plannerMoonAvoidance`):
    /// JSON object with exactly the seven fixed band keys, each
    /// `{ distanceDeg ∈ [0,180], widthDays ∈ [0.5,30] }`.
    MoonAvoidanceBands,
    /// `devMode`: rejected entirely unless the `dev-tools` feature is enabled.
    DevMode,
    /// Per-data-type cleanup action overrides (spec 051 `cleanupTypeOverrides`,
    /// data-model.md §E2): JSON object mapping a known stable data-type id
    /// (stringified `1`-`20`, the frontend `CLEANUP_TYPES` fixture ids) to
    /// exactly one of `"Keep"`, `"Archive"`, or `"Delete"`.
    CleanupTypeOverrides,
}

/// A stable settings key plus its audit/override flags, validation rule, and
/// `SettingsState` hydration/default accessors.
pub(crate) struct Descriptor {
    pub key: &'static str,
    pub noisy: bool,
    pub overridable: bool,
    pub validation: ValidationRule,
    /// Hydrate an already-validated JSON value into this key's `SettingsState` field.
    /// No-ops on shape mismatch, matching the historical `if let Some/Ok(v) = ...`
    /// per-key arms (repair/validation already reject bad shapes before this runs).
    pub apply: fn(Value, &mut SettingsState),
    /// This key's in-code default, read off a fresh `SettingsState::default()`.
    pub default: fn(SettingsState) -> Value,
}

/// The authoritative table of every stable (non-structured-path) v1 settings key.
///
/// Order matches the historical `ALL_V1_KEYS` array so any order-sensitive
/// consumer (e.g. `restore_defaults` over all keys) is unchanged.
pub(crate) const DESCRIPTORS: &[Descriptor] = &[
    Descriptor {
        key: "pattern",
        noisy: true,
        overridable: false,
        validation: ValidationRule::Array,
        apply: |v, s| {
            if let Ok(v) = serde_json::from_value(v) {
                s.pattern = v;
            }
        },
        default: |s| serde_json::to_value(s.pattern).unwrap_or(Value::Null),
    },
    Descriptor {
        key: "autoApplyPattern",
        noisy: false,
        overridable: false,
        validation: ValidationRule::Bool,
        apply: |v, s| {
            if let Some(b) = v.as_bool() {
                s.auto_apply_pattern = b;
            }
        },
        default: |s| Value::Bool(s.auto_apply_pattern),
    },
    Descriptor {
        key: "alwaysPreviewBeforePlan",
        noisy: false,
        overridable: false,
        validation: ValidationRule::Bool,
        apply: |v, s| {
            if let Some(b) = v.as_bool() {
                s.always_preview_before_plan = b;
            }
        },
        default: |s| Value::Bool(s.always_preview_before_plan),
    },
    Descriptor {
        key: "followSymlinks",
        noisy: false,
        overridable: true,
        validation: ValidationRule::Bool,
        apply: |v, s| {
            if let Some(b) = v.as_bool() {
                s.follow_symlinks = b;
            }
        },
        default: |s| Value::Bool(s.follow_symlinks),
    },
    Descriptor {
        key: "hashOnScan",
        noisy: false,
        overridable: true,
        validation: ValidationRule::EnumStr {
            allowed: &["lazy", "eager", "off"],
            expected_msg: "must be \"lazy\", \"eager\", or \"off\"",
        },
        apply: |v, s| {
            if let Some(x) = v.as_str() {
                x.clone_into(&mut s.hash_on_scan);
            }
        },
        default: |s| Value::String(s.hash_on_scan),
    },
    Descriptor {
        key: "darkMatchTolerance",
        noisy: false,
        overridable: false,
        validation: ValidationRule::EnumStr {
            allowed: &["strict", "loose", "any"],
            expected_msg: "must be \"strict\", \"loose\", or \"any\"",
        },
        apply: |v, s| {
            if let Some(x) = v.as_str() {
                x.clone_into(&mut s.dark_match_tolerance);
            }
        },
        default: |s| Value::String(s.dark_match_tolerance),
    },
    Descriptor {
        key: "flatMatching",
        noisy: false,
        overridable: false,
        validation: ValidationRule::EnumStr {
            allowed: &["filter-rot", "filter", "manual"],
            expected_msg: "must be \"filter-rot\", \"filter\", or \"manual\"",
        },
        apply: |v, s| {
            if let Some(x) = v.as_str() {
                x.clone_into(&mut s.flat_matching);
            }
        },
        default: |s| Value::String(s.flat_matching),
    },
    Descriptor {
        key: "suggestCalibration",
        noisy: false,
        overridable: false,
        validation: ValidationRule::Bool,
        apply: |v, s| {
            if let Some(b) = v.as_bool() {
                s.suggest_calibration = b;
            }
        },
        default: |s| Value::Bool(s.suggest_calibration),
    },
    Descriptor {
        key: "logLevel",
        noisy: false,
        overridable: false,
        validation: ValidationRule::EnumStr {
            allowed: &["error", "warn", "info", "debug"],
            expected_msg: "must be \"error\", \"warn\", \"info\", or \"debug\"",
        },
        apply: |v, s| {
            if let Some(x) = v.as_str() {
                x.clone_into(&mut s.log_level);
            }
        },
        default: |s| Value::String(s.log_level),
    },
    Descriptor {
        key: "rememberFollowLogs",
        noisy: true,
        overridable: false,
        validation: ValidationRule::Bool,
        apply: |v, s| {
            if let Some(b) = v.as_bool() {
                s.remember_follow_logs = b;
            }
        },
        default: |s| Value::Bool(s.remember_follow_logs),
    },
    Descriptor {
        key: "defaultProtection",
        noisy: false,
        overridable: true,
        validation: ValidationRule::EnumStr {
            allowed: &["protected", "normal", "unprotected"],
            expected_msg: "must be \"protected\", \"normal\", or \"unprotected\"",
        },
        apply: |v, s| {
            if let Some(x) = v.as_str() {
                x.clone_into(&mut s.default_protection);
            }
        },
        default: |s| Value::String(s.default_protection),
    },
    Descriptor {
        key: "blockPermanentDelete",
        noisy: false,
        overridable: false,
        validation: ValidationRule::Bool,
        apply: |v, s| {
            if let Some(b) = v.as_bool() {
                s.block_permanent_delete = b;
            }
        },
        default: |s| Value::Bool(s.block_permanent_delete),
    },
    Descriptor {
        key: "protectedCategories",
        noisy: true,
        overridable: false,
        validation: ValidationRule::Array,
        apply: |v, s| {
            if let Ok(v) = serde_json::from_value(v) {
                s.protected_categories = v;
            }
        },
        default: |s| serde_json::to_value(s.protected_categories).unwrap_or(Value::Null),
    },
    Descriptor {
        key: "currentLibraryId",
        noisy: false,
        overridable: false,
        validation: ValidationRule::NullableString,
        apply: |v, s| {
            s.current_library_id = v.as_str().map(str::to_owned);
        },
        default: |s| s.current_library_id.map_or(Value::Null, Value::String),
    },
    Descriptor {
        key: "devMode",
        noisy: false,
        overridable: false,
        validation: ValidationRule::DevMode,
        apply: |v, s| {
            if let Some(b) = v.as_bool() {
                s.dev_mode = b;
            }
        },
        default: |s| Value::Bool(s.dev_mode),
    },
    Descriptor {
        key: "plansListDefaultAgeCutoffDays",
        noisy: true,
        overridable: false,
        validation: ValidationRule::Number,
        apply: |v, s| {
            if let Some(n) = v.as_f64() {
                s.plans_list_default_age_cutoff_days = n;
            }
        },
        default: |s| serde_json::json!(s.plans_list_default_age_cutoff_days),
    },
    Descriptor {
        key: "calibrationDarkTempTolerance",
        noisy: false,
        overridable: false,
        validation: ValidationRule::NumberMinZero,
        apply: |v, s| {
            if let Some(n) = v.as_f64() {
                s.calibration_dark_temp_tolerance = n;
            }
        },
        default: |s| serde_json::json!(s.calibration_dark_temp_tolerance),
    },
    Descriptor {
        key: "calibrationPrefillSuggestion",
        noisy: false,
        overridable: false,
        validation: ValidationRule::Bool,
        apply: |v, s| {
            if let Some(b) = v.as_bool() {
                s.calibration_prefill_suggestion = b;
            }
        },
        default: |s| Value::Bool(s.calibration_prefill_suggestion),
    },
    Descriptor {
        key: "calibrationDarkOverridePenalty",
        noisy: false,
        overridable: false,
        validation: ValidationRule::NumberRangeInclusive {
            lo: 0.0,
            hi: 1.0,
            msg: "must be a number [0,1]",
            want_msg: "must be in [0, 1]",
        },
        apply: |v, s| {
            if let Some(n) = v.as_f64() {
                s.calibration_dark_override_penalty = n;
            }
        },
        default: |s| serde_json::json!(s.calibration_dark_override_penalty),
    },
    Descriptor {
        key: "calibrationFlatOverridePenalty",
        noisy: false,
        overridable: false,
        validation: ValidationRule::NumberRangeInclusive {
            lo: 0.0,
            hi: 1.0,
            msg: "must be a number [0,1]",
            want_msg: "must be in [0, 1]",
        },
        apply: |v, s| {
            if let Some(n) = v.as_f64() {
                s.calibration_flat_override_penalty = n;
            }
        },
        default: |s| serde_json::json!(s.calibration_flat_override_penalty),
    },
    Descriptor {
        key: "calibrationBiasOverridePenalty",
        noisy: false,
        overridable: false,
        validation: ValidationRule::NumberRangeInclusive {
            lo: 0.0,
            hi: 1.0,
            msg: "must be a number [0,1]",
            want_msg: "must be in [0, 1]",
        },
        apply: |v, s| {
            if let Some(n) = v.as_f64() {
                s.calibration_bias_override_penalty = n;
            }
        },
        default: |s| serde_json::json!(s.calibration_bias_override_penalty),
    },
    Descriptor {
        key: "calibrationAgingThresholdDays",
        noisy: false,
        overridable: false,
        validation: ValidationRule::NumberRangeInclusive {
            lo: 1.0,
            hi: 3650.0,
            msg: "must be a number",
            want_msg: "must be in [1, 3650]",
        },
        apply: |v, s| {
            if let Some(n) = v.as_f64() {
                s.calibration_aging_threshold_days = n;
            }
        },
        default: |s| serde_json::json!(s.calibration_aging_threshold_days),
    },
    Descriptor {
        key: "imagetypNormalizationUserMappings",
        noisy: false,
        overridable: false,
        validation: ValidationRule::Array,
        apply: |v, s| {
            if let Ok(v) = serde_json::from_value(v) {
                s.imagetyp_normalization_user_mappings = v;
            }
        },
        default: |s| {
            serde_json::to_value(s.imagetyp_normalization_user_mappings).unwrap_or(Value::Null)
        },
    },
    Descriptor {
        key: "patternsByType",
        noisy: false,
        overridable: false,
        validation: ValidationRule::PatternsByType,
        apply: |v, s| {
            if let Ok(v) = serde_json::from_value(v) {
                s.patterns_by_type = v;
            }
        },
        // Read-side falls back to per-frame-type built-in defaults, so the
        // stored default is an empty object (no explicit overrides) — which is
        // exactly what `SettingsState::default().patterns_by_type` serializes to.
        default: |s| serde_json::to_value(s.patterns_by_type).unwrap_or(Value::Null),
    },
    // ── Tool watch / attribution (spec 018 T043) ─────────────────────────
    Descriptor {
        key: "toolWatchExtensions",
        noisy: false,
        overridable: false,
        validation: ValidationRule::Array,
        apply: |v, s| {
            if let Ok(v) = serde_json::from_value(v) {
                s.tool_watch_extensions = v;
            }
        },
        default: |s| serde_json::to_value(s.tool_watch_extensions).unwrap_or(Value::Null),
    },
    Descriptor {
        key: "toolAttributionWindowHours",
        noisy: false,
        overridable: false,
        validation: ValidationRule::NumberMinZero,
        apply: |v, s| {
            if let Some(n) = v.as_f64() {
                s.tool_attribution_window_hours = n;
            }
        },
        default: |s| serde_json::json!(s.tool_attribution_window_hours),
    },
    // ── Observing sites (spec 044 Track B) ───────────────────────────────
    Descriptor {
        key: "observingSites",
        noisy: false,
        overridable: false,
        validation: ValidationRule::ObserverSites,
        apply: |v, s| {
            if let Ok(v) = serde_json::from_value(v) {
                s.observing_sites = v;
            }
        },
        default: |s| serde_json::to_value(s.observing_sites).unwrap_or(Value::Null),
    },
    Descriptor {
        key: "observingDefaultSiteId",
        noisy: false,
        overridable: false,
        validation: ValidationRule::NullableString,
        apply: |v, s| {
            s.observing_default_site_id = v.as_str().map(str::to_owned);
        },
        // Nullable-by-design (no default site until the user/wizard creates one).
        default: |s| s.observing_default_site_id.map_or(Value::Null, Value::String),
    },
    Descriptor {
        key: "observingActiveSiteId",
        noisy: false,
        overridable: false,
        validation: ValidationRule::NullableString,
        apply: |v, s| {
            s.observing_active_site_id = v.as_str().map(str::to_owned);
        },
        default: |s| s.observing_active_site_id.map_or(Value::Null, Value::String),
    },
    Descriptor {
        key: "usableAltitudeDeg",
        noisy: false,
        overridable: false,
        validation: ValidationRule::NumberRangeInclusive {
            lo: 0.0,
            hi: 90.0,
            msg: "must be a number",
            want_msg: "must be in [0, 90]",
        },
        apply: |v, s| {
            if let Some(n) = v.as_f64() {
                s.usable_altitude_deg = n;
            }
        },
        default: |s| serde_json::json!(s.usable_altitude_deg),
    },
    // ── Target planner (spec 047 FR-010) ─────────────────────────────────
    Descriptor {
        key: "plannerMoonAvoidance",
        noisy: false,
        overridable: false,
        validation: ValidationRule::MoonAvoidanceBands,
        apply: |v, s| {
            if let Ok(v) = serde_json::from_value(v) {
                s.planner_moon_avoidance = v;
            }
        },
        default: |s| serde_json::to_value(s.planner_moon_avoidance).unwrap_or(Value::Null),
    },
    // ── Source Views (spec 049) ──────────────────────────────────────────
    Descriptor {
        key: "sourceViewLinkKindIntraDrive",
        noisy: false,
        overridable: false,
        validation: ValidationRule::EnumStr {
            allowed: &["hardlink", "symlink", "junction"],
            expected_msg: "must be \"hardlink\", \"symlink\", or \"junction\"",
        },
        apply: |v, s| {
            if let Some(x) = v.as_str() {
                x.clone_into(&mut s.source_view_link_kind_intra_drive);
            }
        },
        default: |s| Value::String(s.source_view_link_kind_intra_drive),
    },
    Descriptor {
        key: "sourceViewLinkKindCrossDrive",
        noisy: false,
        overridable: false,
        validation: ValidationRule::EnumStr {
            allowed: &["symlink", "junction"],
            expected_msg: "must be \"symlink\" or \"junction\"",
        },
        apply: |v, s| {
            if let Some(x) = v.as_str() {
                x.clone_into(&mut s.source_view_link_kind_cross_drive);
            }
        },
        default: |s| Value::String(s.source_view_link_kind_cross_drive),
    },
    // ── Cleanup overrides (spec 051 US3) ─────────────────────────────────
    // Not overridable (no per-source override) and not noisy (every real
    // change is audited via the normal update_setting no-op-guard + audit
    // path) — same shape as `patternsByType` above, the closest existing
    // object-map validation precedent (data-model.md §E2).
    Descriptor {
        key: "cleanupTypeOverrides",
        noisy: false,
        overridable: false,
        validation: ValidationRule::CleanupTypeOverrides,
        apply: |v, s| {
            if let Ok(v) = serde_json::from_value(v) {
                s.cleanup_type_overrides = v;
            }
        },
        default: |s| serde_json::to_value(s.cleanup_type_overrides).unwrap_or(Value::Null),
    },
    // ── Appearance (theme durability) ────────────────────────────────────
    // Not overridable (a single global UI preference, no per-source
    // concept) and not noisy (a real, low-frequency change worth its own
    // audit entry, same treatment as e.g. `defaultProtection`).
    Descriptor {
        key: "theme",
        noisy: false,
        overridable: false,
        validation: ValidationRule::EnumStr {
            allowed: &["warm-clay", "warm-slate", "observatory-dark", "espresso-dark", "system"],
            expected_msg: "must be \"warm-clay\", \"warm-slate\", \"observatory-dark\", \"espresso-dark\", or \"system\"",
        },
        apply: |v, s| {
            if let Some(x) = v.as_str() {
                x.clone_into(&mut s.theme);
            }
        },
        default: |s| Value::String(s.theme),
    },
];

/// Look up the descriptor for a stable key, if any.
#[must_use]
pub(crate) fn descriptor_for(key: &str) -> Option<&'static Descriptor> {
    DESCRIPTORS.iter().find(|d| d.key == key)
}

/// All stable v1 key names, in declaration order (the historical
/// `ALL_V1_KEYS` order).
pub(crate) fn all_keys() -> impl Iterator<Item = &'static str> {
    DESCRIPTORS.iter().map(|d| d.key)
}

/// All noisy stable key names, in declaration order (historical `NOISY_KEYS`).
pub(crate) fn noisy_keys() -> impl Iterator<Item = &'static str> {
    DESCRIPTORS.iter().filter(|d| d.noisy).map(|d| d.key)
}

/// Return `true` if `key` is a stable key whose changes are audited as a snapshot.
#[must_use]
pub(crate) fn is_noisy(key: &str) -> bool {
    descriptor_for(key).is_some_and(|d| d.noisy)
}

/// Return `true` if `key` is a stable key that can be overridden per source root.
#[must_use]
pub(crate) fn is_overridable(key: &str) -> bool {
    descriptor_for(key).is_some_and(|d| d.overridable)
}

/// Apply a descriptor's [`ValidationRule`] to a proposed value.
///
/// `invalid` is the same closure `validate_value` uses so the rendered
/// `value.invalid` message (including the `key {key}: ` prefix) is identical.
///
/// Returns `Ok(())` if the rule passes. The devMode `dev-tools` cfg gate
/// reproduces the original `validate_value` arm byte-for-byte.
#[allow(clippy::too_many_lines)]
pub(crate) fn check_rule(
    rule: ValidationRule,
    value: &Value,
    invalid: &impl Fn(&str) -> ContractError,
) -> Result<(), ContractError> {
    match rule {
        ValidationRule::EnumStr { allowed, expected_msg } => {
            let s = value.as_str().ok_or_else(|| invalid("must be a string"))?;
            if !allowed.contains(&s) {
                return Err(invalid(expected_msg));
            }
        }
        ValidationRule::Bool => {
            if !value.is_boolean() {
                return Err(invalid("must be a boolean"));
            }
        }
        ValidationRule::Number => {
            if value.as_f64().is_none() {
                return Err(invalid("must be a number"));
            }
        }
        ValidationRule::NumberMinZero => {
            let n = value.as_f64().ok_or_else(|| invalid("must be a number"))?;
            if n < 0.0 {
                return Err(invalid("must be >= 0"));
            }
        }
        ValidationRule::NumberRangeInclusive { lo, hi, msg, want_msg } => {
            let n = value.as_f64().ok_or_else(|| invalid(msg))?;
            if !(lo..=hi).contains(&n) {
                return Err(invalid(want_msg));
            }
        }
        ValidationRule::NullableString => {
            if !value.is_null() && !value.is_string() {
                return Err(invalid("must be a string or null"));
            }
        }
        ValidationRule::Array => {
            if !value.is_array() {
                return Err(invalid("must be an array"));
            }
        }
        ValidationRule::PatternsByType => {
            let obj = value.as_object().ok_or_else(|| invalid("must be an object"))?;
            for (class_name, pattern_value) in obj {
                if patterns::FrameTypeClass::from_str_name(class_name).is_none() {
                    return Err(invalid(&format!("unknown frame-type class: {class_name}")));
                }
                let pattern = pattern_value.as_str().ok_or_else(|| {
                    invalid(&format!("pattern for {class_name} must be a string"))
                })?;
                if let Err(e) = patterns::validate_pattern_str(pattern) {
                    return Err(invalid(&format!("invalid pattern for {class_name}: {e}")));
                }
            }
        }
        ValidationRule::ObserverSites => check_observer_sites(value, invalid)?,
        ValidationRule::MoonAvoidanceBands => {
            const BANDS: [&str; 7] = ["L", "R", "G", "B", "Ha", "SII", "OIII"];
            let obj = value.as_object().ok_or_else(|| invalid("must be an object"))?;
            // Reject unknown/extra keys.
            for key in obj.keys() {
                if !BANDS.contains(&key.as_str()) {
                    return Err(invalid(&format!("unknown band key: {key}")));
                }
            }
            // Require exactly the seven bands, each with valid ranges.
            for band in BANDS {
                let entry =
                    obj.get(band).ok_or_else(|| invalid(&format!("missing band: {band}")))?;
                let band_obj = entry
                    .as_object()
                    .ok_or_else(|| invalid(&format!("{band} must be an object")))?;
                for extra in band_obj.keys() {
                    if extra != "distanceDeg" && extra != "widthDays" {
                        return Err(invalid(&format!("{band}.{extra} is not allowed")));
                    }
                }
                let distance = band_obj
                    .get("distanceDeg")
                    .and_then(serde_json::Value::as_f64)
                    .ok_or_else(|| invalid(&format!("{band}.distanceDeg must be a number")))?;
                if !(0.0..=180.0).contains(&distance) {
                    return Err(invalid(&format!("{band}.distanceDeg must be in [0, 180]")));
                }
                let width = band_obj
                    .get("widthDays")
                    .and_then(serde_json::Value::as_f64)
                    .ok_or_else(|| invalid(&format!("{band}.widthDays must be a number")))?;
                if !(0.5..=30.0).contains(&width) {
                    return Err(invalid(&format!("{band}.widthDays must be in [0.5, 30]")));
                }
            }
        }
        ValidationRule::DevMode => {
            // In release builds (without dev-tools feature), devMode is always false.
            #[cfg(not(feature = "dev-tools"))]
            return Err(ContractError::new(
                contracts_core::error_code::ErrorCode::ValueInvalid,
                "devMode cannot be set in release builds".to_owned(),
                contracts_core::ErrorSeverity::Warning,
                false,
            ));
        }
        ValidationRule::CleanupTypeOverrides => check_cleanup_type_overrides(value, invalid)?,
    }
    Ok(())
}

/// Validate the `cleanupTypeOverrides` object (spec 051 `cleanupTypeOverrides`,
/// data-model.md §E2): every key must be one of the known stable data-type ids
/// (stringified `1`-`20`, the frontend `CLEANUP_TYPES` fixture ids), every
/// value must be exactly `"Keep"`, `"Archive"`, or `"Delete"`. An empty map is
/// valid (all built-in defaults apply).
fn check_cleanup_type_overrides(
    value: &Value,
    invalid: &impl Fn(&str) -> ContractError,
) -> Result<(), ContractError> {
    /// Known stable data-type ids (`apps/desktop/src/data/fixtures/settings.ts`
    /// `CLEANUP_TYPES`, ids `1`-`20`). Kept as a range rather than duplicating
    /// the fixture's per-id labels here — the taxonomy itself is not part of
    /// this entity (FR-009).
    const KNOWN_DATA_TYPE_IDS: std::ops::RangeInclusive<u32> = 1..=20;
    const ALLOWED_ACTIONS: [&str; 3] = ["Keep", "Archive", "Delete"];

    let obj = value.as_object().ok_or_else(|| invalid("must be an object"))?;
    for (id_str, action_value) in obj {
        let id: u32 = id_str
            .parse()
            .ok()
            .filter(|id| KNOWN_DATA_TYPE_IDS.contains(id))
            .ok_or_else(|| invalid(&format!("unknown data-type id: {id_str}")))?;
        let _ = id;
        let action = action_value
            .as_str()
            .ok_or_else(|| invalid(&format!("action for {id_str} must be a string")))?;
        if !ALLOWED_ACTIONS.contains(&action) {
            return Err(invalid(&format!(
                "action for {id_str} must be \"Keep\", \"Archive\", or \"Delete\""
            )));
        }
    }
    Ok(())
}

/// Validate the `observingSites` array (spec 044 Track B). Each entry must carry
/// the required site fields in range, ids must be unique, and `elevationM` (when
/// present) must be a number or null.
fn check_observer_sites(
    value: &Value,
    invalid: &impl Fn(&str) -> ContractError,
) -> Result<(), ContractError> {
    let arr = value.as_array().ok_or_else(|| invalid("must be an array"))?;
    let mut ids = std::collections::HashSet::new();
    for (i, site) in arr.iter().enumerate() {
        let obj =
            site.as_object().ok_or_else(|| invalid(&format!("site {i} must be an object")))?;
        let str_field = |name: &str| -> Result<String, ContractError> {
            let s = obj
                .get(name)
                .and_then(Value::as_str)
                .ok_or_else(|| invalid(&format!("site {i}: {name} must be a string")))?;
            if s.is_empty() {
                return Err(invalid(&format!("site {i}: {name} must be non-empty")));
            }
            Ok(s.to_owned())
        };
        let num_field = |name: &str| -> Result<f64, ContractError> {
            obj.get(name)
                .and_then(Value::as_f64)
                .ok_or_else(|| invalid(&format!("site {i}: {name} must be a number")))
        };
        let id = str_field("id")?;
        if !ids.insert(id.clone()) {
            return Err(invalid(&format!("duplicate site id: {id}")));
        }
        str_field("name")?;
        let lat = num_field("latitudeDeg")?;
        if !(-90.0..=90.0).contains(&lat) {
            return Err(invalid(&format!("site {i}: latitudeDeg must be in [-90, 90]")));
        }
        let lon = num_field("longitudeDeg")?;
        if !(-180.0..=180.0).contains(&lon) {
            return Err(invalid(&format!("site {i}: longitudeDeg must be in [-180, 180]")));
        }
        str_field("timezone")?;
        let twilight = str_field("twilight")?;
        if twilight != "astronomical" && twilight != "nautical" {
            return Err(invalid(&format!(
                "site {i}: twilight must be \"astronomical\" or \"nautical\""
            )));
        }
        let horizon = num_field("minHorizonAltDeg")?;
        if !(0.0..=90.0).contains(&horizon) {
            return Err(invalid(&format!("site {i}: minHorizonAltDeg must be in [0, 90]")));
        }
        // elevationM is optional; when present it must be a number or null.
        if let Some(elev) = obj.get("elevationM") {
            if !elev.is_null() && elev.as_f64().is_none() {
                return Err(invalid(&format!("site {i}: elevationM must be a number or null")));
            }
        }
    }
    Ok(())
}
