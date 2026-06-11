//! Alias management domain logic for spec 023 — Target Identity, History, and Notes.
//!
//! This module is **pure domain** — no SQLite, no Tauri, no HTTP.
//! All normalization reuses [`crate::normalize::normalize`] from spec 013 so
//! the two features share a single pipeline.
//!
//! # Invariants enforced here
//!
//! - An alias may not be the empty string after normalization (`alias.invalid`).
//! - Removing an alias that equals the current `primary_designation` (in
//!   normalized form) returns `AliasError::IsPrimary` — the caller must
//!   `primary_rename` first.
//! - Renaming the primary: the proposed new primary MUST already appear in the
//!   alias list (normalized comparison); otherwise returns
//!   `AliasError::DesignationNotInAliases`.
//! - Re-adding an alias that already belongs to the same target is a no-op
//!   success (`added = false`).

use crate::normalize::normalize;

// ── Error types ───────────────────────────────────────────────────────────────

/// Errors produced by alias domain operations.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AliasError {
    /// The alias string is empty or reduces to empty after normalization.
    InvalidAlias,
    /// The normalized alias is already attached to a *different* target.
    /// The conflicting target id is stored in `conflicting_target_id`.
    Duplicate { conflicting_target_id: String },
    /// The alias being removed is currently the `primary_designation`.
    /// The caller must call `primary_rename` first.
    IsPrimary,
    /// The alias to remove/rename is not present on this target.
    NotFound,
    /// `newPrimaryDesignation` is not in the target's alias list.
    DesignationNotInAliases,
    /// The designation is already the primary.
    DesignationAlreadyPrimary,
}

// ── AliasOp helpers ───────────────────────────────────────────────────────────

/// Result of an `add_alias` operation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AddAliasOutcome {
    /// Alias was newly created.
    Added,
    /// Alias already existed on this target — idempotent no-op.
    AlreadyPresent,
}

/// Validate and normalize an alias string.
///
/// Returns the normalized form on success, or [`AliasError::InvalidAlias`] if
/// the result would be empty.
///
/// # Errors
///
/// Returns [`AliasError::InvalidAlias`] when `alias` trims to empty.
pub fn validate_alias(alias: &str) -> Result<String, AliasError> {
    let normalized = normalize(alias);
    if normalized.is_empty() {
        return Err(AliasError::InvalidAlias);
    }
    Ok(normalized)
}

/// Guard for alias-add: check whether the normalized alias already exists.
///
/// - If `existing_target_id` is `None` the alias is free to use; returns
///   `AddAliasOutcome::Added`.
/// - If `existing_target_id == Some(our_target_id)` the alias is already on
///   this target; returns `AddAliasOutcome::AlreadyPresent` (idempotent).
/// - Otherwise the alias belongs to a different target; returns
///   `AliasError::Duplicate`.
///
/// # Errors
///
/// Returns [`AliasError::Duplicate`] when the alias belongs to a different target.
pub fn check_alias_add(
    our_target_id: &str,
    existing_target_id: Option<&str>,
) -> Result<AddAliasOutcome, AliasError> {
    match existing_target_id {
        None => Ok(AddAliasOutcome::Added),
        Some(owner) if owner == our_target_id => Ok(AddAliasOutcome::AlreadyPresent),
        Some(other) => Err(AliasError::Duplicate { conflicting_target_id: other.to_owned() }),
    }
}

/// Guard for alias-remove: check that the alias being removed is not the
/// current primary designation.
///
/// Both the `alias` and `primary` are normalized before comparison.
///
/// # Errors
///
/// Returns [`AliasError::IsPrimary`] when `alias` normalized == `primary` normalized.
pub fn check_alias_remove_not_primary(alias: &str, primary: &str) -> Result<(), AliasError> {
    let alias_norm = normalize(alias);
    let primary_norm = normalize(primary);
    if alias_norm == primary_norm {
        return Err(AliasError::IsPrimary);
    }
    Ok(())
}

/// Guard for primary rename: the new designation MUST already be in the alias
/// list AND must not equal the current primary.
///
/// `existing_aliases_normalized` is the list of normalized alias strings for
/// this target (does NOT include the primary designation itself).
///
/// Returns the normalized form of `new_primary` on success.
///
/// # Errors
///
/// Returns [`AliasError::DesignationAlreadyPrimary`] when `new_primary`
/// normalized == `current_primary` normalized.
/// Returns [`AliasError::DesignationNotInAliases`] when `new_primary` normalized
/// is not in `existing_aliases_normalized`.
pub fn check_primary_rename(
    new_primary: &str,
    current_primary: &str,
    existing_aliases_normalized: &[String],
) -> Result<String, AliasError> {
    let new_norm = normalize(new_primary);
    let cur_norm = normalize(current_primary);

    if new_norm == cur_norm {
        return Err(AliasError::DesignationAlreadyPrimary);
    }

    if !existing_aliases_normalized.iter().any(|a| a == &new_norm) {
        return Err(AliasError::DesignationNotInAliases);
    }

    Ok(new_norm)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── validate_alias ────────────────────────────────────────────────────────

    #[test]
    fn validate_alias_accepts_normal_input() {
        let n = validate_alias("Andromeda Galaxy").unwrap();
        assert_eq!(n, "andromeda galaxy");
    }

    #[test]
    fn validate_alias_expands_catalog_prefix() {
        // "M31" → normalize → "m 31"
        let n = validate_alias("M31").unwrap();
        assert_eq!(n, "m 31");
    }

    #[test]
    fn validate_alias_rejects_empty_string() {
        assert_eq!(validate_alias(""), Err(AliasError::InvalidAlias));
    }

    #[test]
    fn validate_alias_rejects_whitespace_only() {
        assert_eq!(validate_alias("   "), Err(AliasError::InvalidAlias));
    }

    #[test]
    fn validate_alias_rejects_punctuation_only() {
        // punctuation is stripped; result is empty
        assert_eq!(validate_alias("---"), Err(AliasError::InvalidAlias));
    }

    // ── check_alias_add ───────────────────────────────────────────────────────

    #[test]
    fn check_add_free_alias_returns_added() {
        assert_eq!(check_alias_add("t1", None), Ok(AddAliasOutcome::Added));
    }

    #[test]
    fn check_add_same_target_returns_already_present() {
        assert_eq!(check_alias_add("t1", Some("t1")), Ok(AddAliasOutcome::AlreadyPresent));
    }

    #[test]
    fn check_add_different_target_returns_duplicate() {
        assert_eq!(
            check_alias_add("t1", Some("t2")),
            Err(AliasError::Duplicate { conflicting_target_id: "t2".into() })
        );
    }

    // ── check_alias_remove_not_primary ────────────────────────────────────────

    #[test]
    fn check_remove_non_primary_alias_ok() {
        assert!(check_alias_remove_not_primary("Andromeda Galaxy", "M 31").is_ok());
    }

    #[test]
    fn check_remove_primary_alias_returns_is_primary() {
        // Both normalize to "m 31"
        assert_eq!(check_alias_remove_not_primary("M31", "M 31"), Err(AliasError::IsPrimary));
    }

    #[test]
    fn check_remove_primary_case_insensitive() {
        assert_eq!(check_alias_remove_not_primary("m 31", "M 31"), Err(AliasError::IsPrimary));
    }

    // ── check_primary_rename ──────────────────────────────────────────────────

    #[test]
    fn primary_rename_happy_path() {
        let aliases = vec!["andromeda galaxy".to_owned(), "ngc 224".to_owned()];
        let new_norm = check_primary_rename("Andromeda Galaxy", "M 31", &aliases).unwrap();
        assert_eq!(new_norm, "andromeda galaxy");
    }

    #[test]
    fn primary_rename_already_primary_returns_error() {
        let aliases = vec!["andromeda galaxy".to_owned()];
        assert_eq!(
            check_primary_rename("M31", "M 31", &aliases),
            Err(AliasError::DesignationAlreadyPrimary)
        );
    }

    #[test]
    fn primary_rename_not_in_aliases_returns_error() {
        let aliases = vec!["ngc 224".to_owned()];
        assert_eq!(
            check_primary_rename("Andromeda Galaxy", "M 31", &aliases),
            Err(AliasError::DesignationNotInAliases)
        );
    }

    #[test]
    fn primary_rename_empty_aliases_returns_error() {
        assert_eq!(
            check_primary_rename("Andromeda Galaxy", "M 31", &[]),
            Err(AliasError::DesignationNotInAliases)
        );
    }

    // ── "M 31" vs "M31" vs "Messier 31" normalization parity ─────────────────

    #[test]
    fn m31_variants_normalize_to_same_form() {
        assert_eq!(normalize("M31"), normalize("M 31"));
        assert_eq!(normalize("m31"), normalize("M 31"));
    }

    #[test]
    fn messier_31_normalizes_differently_than_m31() {
        // "Messier 31" → "messier 31" (no catalog-prefix expansion; "messier" not a prefix)
        // "M31" → "m 31"
        // These are intentionally different — "messier 31" is a free-text alias.
        assert_ne!(normalize("Messier 31"), normalize("M31"));
    }
}
