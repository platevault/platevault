//! Single-source settings descriptor table (US11 T144).
//!
//! Before this module, the stable (non-structured-path) settings keys and their
//! rules were spread across four parallel sites in `settings/mod.rs`:
//!
//! - `ALL_V1_KEYS` / `NOISY_KEYS` / `OVERRIDABLE_KEYS` constant lists,
//! - the `validate_value` per-key `match`,
//! - the `default_value_for_key` per-key `match`,
//! - the `apply_value_to_state` per-key `match` (hydration into `SettingsState`).
//!
//! This table is the **single registry** of the stable key set together with
//! each key's audit/override flags and validation rule. The constant lists are
//! now derived from it, and `validate_value` dispatches on
//! [`Descriptor::validation`] for stable keys. Behavior — including the exact
//! `value.invalid` error strings — is byte-identical to the prior hand-written
//! matches; this is pure consolidation.
//!
//! Default values and `SettingsState` field hydration remain in `mod.rs`
//! because they bind to concrete struct fields rather than to data-expressible
//! rules; the descriptor table is nonetheless the authoritative key registry
//! they are checked against by the `descriptor_keys_match_state_defaults` test.

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
    /// `devMode`: rejected entirely unless the `dev-tools` feature is enabled.
    DevMode,
}

/// A stable settings key plus its audit/override flags and validation rule.
pub(crate) struct Descriptor {
    pub key: &'static str,
    pub noisy: bool,
    pub overridable: bool,
    pub validation: ValidationRule,
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
    },
    Descriptor {
        key: "autoApplyPattern",
        noisy: false,
        overridable: false,
        validation: ValidationRule::Bool,
    },
    Descriptor {
        key: "alwaysPreviewBeforePlan",
        noisy: false,
        overridable: false,
        validation: ValidationRule::Bool,
    },
    Descriptor {
        key: "followSymlinks",
        noisy: false,
        overridable: true,
        validation: ValidationRule::Bool,
    },
    Descriptor {
        key: "hashOnScan",
        noisy: false,
        overridable: true,
        validation: ValidationRule::EnumStr {
            allowed: &["lazy", "eager", "off"],
            expected_msg: "must be \"lazy\", \"eager\", or \"off\"",
        },
    },
    Descriptor {
        key: "darkMatchTolerance",
        noisy: false,
        overridable: false,
        validation: ValidationRule::EnumStr {
            allowed: &["strict", "loose", "any"],
            expected_msg: "must be \"strict\", \"loose\", or \"any\"",
        },
    },
    Descriptor {
        key: "flatMatching",
        noisy: false,
        overridable: false,
        validation: ValidationRule::EnumStr {
            allowed: &["filter-rot", "filter", "manual"],
            expected_msg: "must be \"filter-rot\", \"filter\", or \"manual\"",
        },
    },
    Descriptor {
        key: "suggestCalibration",
        noisy: false,
        overridable: false,
        validation: ValidationRule::Bool,
    },
    Descriptor {
        key: "logLevel",
        noisy: false,
        overridable: false,
        validation: ValidationRule::EnumStr {
            allowed: &["error", "warn", "info", "debug"],
            expected_msg: "must be \"error\", \"warn\", \"info\", or \"debug\"",
        },
    },
    Descriptor {
        key: "rememberFollowLogs",
        noisy: true,
        overridable: false,
        validation: ValidationRule::Bool,
    },
    Descriptor {
        key: "defaultProtection",
        noisy: false,
        overridable: true,
        validation: ValidationRule::EnumStr {
            allowed: &["protected", "normal", "unprotected"],
            expected_msg: "must be \"protected\", \"normal\", or \"unprotected\"",
        },
    },
    Descriptor {
        key: "blockPermanentDelete",
        noisy: false,
        overridable: false,
        validation: ValidationRule::Bool,
    },
    Descriptor {
        key: "protectedCategories",
        noisy: true,
        overridable: false,
        validation: ValidationRule::Array,
    },
    Descriptor {
        key: "currentLibraryId",
        noisy: false,
        overridable: false,
        validation: ValidationRule::NullableString,
    },
    Descriptor {
        key: "devMode",
        noisy: false,
        overridable: false,
        validation: ValidationRule::DevMode,
    },
    Descriptor {
        key: "plansListDefaultAgeCutoffDays",
        noisy: true,
        overridable: false,
        validation: ValidationRule::Number,
    },
    Descriptor {
        key: "calibrationDarkTempTolerance",
        noisy: false,
        overridable: false,
        validation: ValidationRule::NumberMinZero,
    },
    Descriptor {
        key: "calibrationPrefillSuggestion",
        noisy: false,
        overridable: false,
        validation: ValidationRule::Bool,
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
    },
    Descriptor {
        key: "imagetypNormalizationUserMappings",
        noisy: false,
        overridable: false,
        validation: ValidationRule::Array,
    },
    Descriptor {
        key: "patternsByType",
        noisy: false,
        overridable: false,
        validation: ValidationRule::PatternsByType,
    },
    // ── Tool watch / attribution (spec 018 T043) ─────────────────────────
    Descriptor {
        key: "toolWatchExtensions",
        noisy: false,
        overridable: false,
        validation: ValidationRule::Array,
    },
    Descriptor {
        key: "toolAttributionWindowHours",
        noisy: false,
        overridable: false,
        validation: ValidationRule::NumberMinZero,
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
    }
    Ok(())
}
