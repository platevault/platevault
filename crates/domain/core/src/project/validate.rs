// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project name and tool validation (spec 008 F-2).

/// Maximum length for a project name (per data-model.md invariants).
///
/// Parity: duplicated in
/// `apps/desktop/src/features/projects/schemas.ts` `MAX_NAME_LEN` (no
/// generated tauri-specta binding exposes this constant today). A vitest in
/// `schemas.test.ts` pins the TS value so drift is caught on either side.
pub const MAX_NAME_LEN: usize = 120;

/// Validate a project name.
///
/// # Errors
///
/// Returns `"name.empty"` when the trimmed name is empty.
/// Returns `"name.too_long"` when the trimmed name exceeds 120 characters.
pub fn validate_name(name: &str) -> Result<(), &'static str> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("name.empty");
    }
    if trimmed.len() > MAX_NAME_LEN {
        return Err("name.too_long");
    }
    Ok(())
}

/// The set of valid processing tool values (per data-model.md §ProcessingTool).
pub const VALID_TOOLS: &[&str] = &["PixInsight", "Siril", "Planetary Suite"];

/// Validate a processing tool string.
///
/// # Errors
///
/// Returns `"tool.unknown"` when the value is not in the canonical list.
pub fn validate_tool(tool: &str) -> Result<(), &'static str> {
    if VALID_TOOLS.contains(&tool) {
        Ok(())
    } else {
        Err("tool.unknown")
    }
}

use crate::lifecycle::ProjectState;

/// Returns true when the tool field is locked for the given lifecycle string.
/// Delegates to [`ProjectState::is_tool_locked`]; unknown strings return false.
#[must_use]
pub fn is_tool_locked(lifecycle: &str) -> bool {
    ProjectState::parse_str(lifecycle).is_some_and(ProjectState::is_tool_locked)
}

/// Returns true when any edit is refused for the given lifecycle string.
/// Delegates to [`ProjectState::is_read_only`]; unknown strings return false.
#[must_use]
pub fn is_read_only(lifecycle: &str) -> bool {
    ProjectState::parse_str(lifecycle).is_some_and(ProjectState::is_read_only)
}

/// Returns true when source removal is refused for the given lifecycle string.
/// Delegates to [`ProjectState::is_source_remove_locked`]; unknown strings return false.
#[must_use]
pub fn is_source_remove_locked(lifecycle: &str) -> bool {
    ProjectState::parse_str(lifecycle).is_some_and(ProjectState::is_source_remove_locked)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_name_is_rejected() {
        assert_eq!(validate_name(""), Err("name.empty"));
        assert_eq!(validate_name("  "), Err("name.empty"));
    }

    #[test]
    fn too_long_name_is_rejected() {
        let long = "x".repeat(121);
        assert_eq!(validate_name(&long), Err("name.too_long"));
    }

    #[test]
    fn valid_name_passes() {
        assert!(validate_name("NGC 7000 NB").is_ok());
    }

    #[test]
    fn valid_tools_pass() {
        for tool in VALID_TOOLS {
            assert!(validate_tool(tool).is_ok());
        }
    }

    #[test]
    fn unknown_tool_rejected() {
        assert_eq!(validate_tool("Photoshop"), Err("tool.unknown"));
    }

    #[test]
    fn tool_locked_for_prepared_and_processing() {
        assert!(is_tool_locked("prepared"));
        assert!(is_tool_locked("processing"));
        assert!(is_tool_locked("completed"));
        assert!(is_tool_locked("blocked"));
        assert!(!is_tool_locked("setup_incomplete"));
        assert!(!is_tool_locked("ready"));
    }

    #[test]
    fn source_remove_locked_for_prepared_completed_archived() {
        assert!(is_source_remove_locked("prepared"));
        assert!(is_source_remove_locked("processing"));
        assert!(is_source_remove_locked("completed"));
        assert!(is_source_remove_locked("archived"));
        assert!(!is_source_remove_locked("setup_incomplete"));
        assert!(!is_source_remove_locked("ready"));
        assert!(!is_source_remove_locked("blocked"));
    }
}
