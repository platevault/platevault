// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Library root, path, scan, and filesystem inventory boundaries.

pub mod artifact_watcher;
pub mod capability;
pub mod drive_scope;
mod notify_bridge;
pub mod reconcile;
pub mod watcher;

pub const CRATE_NAME: &str = "fs_inventory";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn exposes_crate_name() {
        // Source of truth is Cargo.toml's package name, not a second hand-typed
        // literal in this file — catches CRATE_NAME drifting from the manifest.
        assert_eq!(CRATE_NAME, env!("CARGO_PKG_NAME"));
    }
}
