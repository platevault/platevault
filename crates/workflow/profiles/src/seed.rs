//! Seeded processing-tool profiles (spec 011 T002).
//!
//! Includes PixInsight, Siril, and Planetary Suite with per-OS bundle IDs
//! (R-BundleId) and args templates (R3).
//!
//! `all()` returns a fixed-size array of owned `ToolProfile` values.
//! `validate_seeds()` is called once at app boot to assert seed integrity.

use crate::{ArgsToken, DetachStrategy, ToolProfile};

fn pixinsight_profile() -> ToolProfile {
    ToolProfile {
        id: "pixinsight",
        name: "PixInsight",
        bundle_id: Some("com.pixinsight.PixInsight"),
        args_template: vec![ArgsToken::Folder],
        supports_open_folder: true,
        detach_strategy: DetachStrategy::OpenBundleId,
    }
}

fn siril_profile() -> ToolProfile {
    ToolProfile {
        id: "siril",
        name: "Siril",
        bundle_id: Some("org.free-astro.siril"),
        args_template: vec![ArgsToken::Folder],
        supports_open_folder: true,
        detach_strategy: DetachStrategy::OpenBundleId,
    }
}

fn startools_profile() -> ToolProfile {
    ToolProfile {
        id: "startools",
        name: "StarTools",
        bundle_id: Some("com.startools.startools"),
        args_template: vec![],
        supports_open_folder: false,
        detach_strategy: DetachStrategy::OpenBundleId,
    }
}

/// Return all seeded processing-tool profiles as an owned `Vec`.
///
/// Call `validate_seeds()` at app boot to assert integrity.
#[must_use]
pub fn all() -> Vec<ToolProfile> {
    vec![pixinsight_profile(), siril_profile(), startools_profile()]
}

/// Validate all seed profiles.
///
/// # Errors
///
/// Returns the first validation error encountered, if any.
pub fn validate_seeds() -> Result<(), String> {
    for p in all() {
        p.validate()?;
    }
    Ok(())
}

/// Find a seed profile by `tool_id`, returning an owned clone.
#[must_use]
pub fn find(tool_id: &str) -> Option<ToolProfile> {
    all().into_iter().find(|p| p.id == tool_id)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_seeds_pass_validation() {
        validate_seeds().expect("all seed profiles must be valid");
    }

    #[test]
    fn seed_ids_match_c2_invariant() {
        for p in all() {
            assert!(ToolProfile::id_is_valid(p.id), "seed id '{}' violates C2", p.id);
        }
    }

    #[test]
    fn planetary_suite_has_no_folder_token() {
        let profile = find("startools").expect("startools must be seeded");
        assert!(!profile.supports_open_folder);
        assert!(
            !profile.args_template.contains(&ArgsToken::Folder),
            "startools must not have {{folder}} token"
        );
    }

    #[test]
    fn pixinsight_supports_open_folder() {
        let p = find("pixinsight").expect("pixinsight must be seeded");
        assert!(p.supports_open_folder);
        assert_eq!(p.bundle_id, Some("com.pixinsight.PixInsight"));
    }

    #[test]
    fn siril_has_correct_bundle_id() {
        let p = find("siril").expect("siril must be seeded");
        assert_eq!(p.bundle_id, Some("org.free-astro.siril"));
    }

    #[test]
    fn find_returns_none_for_unknown_id() {
        assert!(find("photoshop").is_none());
    }

    #[test]
    fn three_seeds_are_registered() {
        assert_eq!(all().len(), 3);
    }
}
