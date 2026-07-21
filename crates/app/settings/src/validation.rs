use super::{
    descriptors, is_catalogues_enabled_key, is_locale_key, is_tools_auto_detected_key,
    is_tools_bundle_id_key, is_tools_enabled_key, is_tools_executable_path_key,
    is_workflow_profile_attribution_window_key, is_workflow_profile_watch_extensions_key,
    ContractError, ErrorCode, ErrorSeverity, Value, SHIPPED_LOCALES,
};

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
        _ if is_locale_key(key) => {
            descriptors::check_rule(
                descriptors::ValidationRule::EnumStr {
                    allowed: &SHIPPED_LOCALES,
                    expected_msg: "must be \"en-GB\" or \"pt-BR\"",
                },
                value,
                &invalid,
            )?;
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
