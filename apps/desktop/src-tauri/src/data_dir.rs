// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Explicit app-data-root override (`ALM_DATA_DIR`) — issue #1204.
//!
//! # Why an env var cannot do this on its own
//!
//! The E2E harness gives every concurrent app instance an isolated app-data
//! root by overriding the platform's location env vars
//! (`crates/e2e-tests/tests/common/mod.rs::InstanceEnv`): `XDG_DATA_HOME` on
//! Linux, `HOME` on macOS, `APPDATA`/`LOCALAPPDATA` on Windows.
//!
//! That works on Linux and macOS. **It does nothing on Windows.** Tauri
//! resolves both `app_data_dir()` and the config-driven webview
//! `data_directory` through the `dirs` crate, which on Windows calls
//! `SHGetKnownFolderPath(FOLDERID_RoamingAppData)` /
//! `FOLDERID_LocalAppData` (`dirs-sys-0.5.0/src/lib.rs:176`). The Known
//! Folder API reads the user's shell profile — it ignores `APPDATA` and
//! `LOCALAPPDATA` entirely. No env var can redirect it.
//!
//! So on Windows, every concurrent instance silently shared one real
//! app-data root, which collided in two places:
//!
//! 1. **The redb resolve cache** (`simbad-cache.redb`) — the second instance
//!    logs `Database already open. Cannot acquire lock` and degrades to an
//!    in-memory cache.
//! 2. **The `WebView2` user-data folder** — `create_environment` passes
//!    `data_directory` straight to `CreateCoreWebView2EnvironmentWithOptions`
//!    (`wry-0.55.1/src/webview2/mod.rs:345`), and an empty value means "the
//!    default folder next to the exe". Two instances of the same exe get the
//!    same folder, the second fails with
//!    `failed to create webview: WindowsError(0x80070057)`, and — having no
//!    window — never brings up its `WebDriver` port. That surfaced four layers
//!    downstream as `window.__ALM_E2E__ bridge never became ready`, the
//!    symptom chased since #1019.
//!
//! # The override
//!
//! [`resolve`] reads `ALM_DATA_DIR`. When set, it is used verbatim as the
//! app-data root instead of `app.path().app_data_dir()`, on every platform —
//! one mechanism rather than three platform-specific ones that are only
//! honoured on two of them.
//!
//! When unset (real users, every non-E2E build) nothing changes: callers
//! fall back to the platform resolver exactly as before.
//!
//! # The webview folder is a separate lever
//!
//! The webview's user-data folder cannot live under `ALM_DATA_DIR`, because
//! a config-declared window's `data_directory` **must be relative** —
//! `WebviewBuilder::from_config` rejects absolute paths outright and joins
//! relative ones onto `dirs::data_local_dir()/<label>`
//! (`tauri-2.11.5/src/webview/mod.rs:392-425`), which is the very Known
//! Folder we cannot redirect.
//!
//! What we *can* do is make the leaf name unique per instance, so concurrent
//! instances stop sharing one folder even though they all sit under the real
//! `LocalAppData`. [`webview_subdir`] derives that name from the override
//! path. Isolation of *identity* is what fixes the collision; isolation of
//! *location* is not available to us here.

use std::path::PathBuf;

/// Name of the app-data-root override variable. See the module docs.
pub const DATA_DIR_ENV: &str = "ALM_DATA_DIR";

/// The app-data root override, if `ALM_DATA_DIR` is set to a non-empty value.
///
/// Returns `None` when unset or empty, meaning "use the platform resolver".
#[must_use]
pub fn resolve() -> Option<PathBuf> {
    resolve_from(std::env::var_os(DATA_DIR_ENV).as_deref())
}

/// [`resolve`]'s logic, as a pure function of the raw variable.
///
/// Split out so the tests never mutate the process environment: `set_var` is
/// `unsafe` (and forbidden workspace-wide), and a global mutated from
/// multiple test threads is a race regardless.
fn resolve_from(raw: Option<&std::ffi::OsStr>) -> Option<PathBuf> {
    let raw = raw?;
    if raw.is_empty() {
        return None;
    }
    Some(PathBuf::from(raw))
}

/// A per-instance webview user-data folder name, or `None` when no override
/// is set (in which case config windows keep Tauri's default behaviour).
///
/// The name is a deterministic function of the override path, so the same
/// instance reuses the same folder across a launch → shutdown → relaunch
/// sequence — which the E2E harness's webview-storage-preserving
/// `relaunch()` depends on — while two instances with different roots never
/// collide.
#[must_use]
pub fn webview_subdir() -> Option<PathBuf> {
    resolve().as_deref().map(webview_subdir_for)
}

/// [`webview_subdir`]'s derivation, as a pure function of the root. See
/// [`resolve_from`] on why the split exists.
fn webview_subdir_for(root: &std::path::Path) -> PathBuf {
    PathBuf::from(format!("pv-{:016x}", fnv1a(root.as_os_str().as_encoded_bytes())))
}

/// FNV-1a, 64-bit. Used only to turn a path into a short, stable, filesystem-
/// safe folder name — not for anything security-sensitive. Spelled out here
/// rather than using `DefaultHasher`, whose output std explicitly reserves
/// the right to change between releases (which would silently orphan an
/// instance's webview storage across a toolchain bump).
fn fnv1a(bytes: &[u8]) -> u64 {
    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;
    bytes.iter().fold(OFFSET, |hash, &b| (hash ^ u64::from(b)).wrapping_mul(PRIME))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn os(s: &str) -> &std::ffi::OsStr {
        std::ffi::OsStr::new(s)
    }

    #[test]
    fn unset_means_use_the_platform_resolver() {
        assert_eq!(resolve_from(None), None);
    }

    /// An empty value is treated as unset rather than as "the current
    /// directory", which is what `PathBuf::from("")` would otherwise mean.
    #[test]
    fn empty_means_unset() {
        assert_eq!(resolve_from(Some(os(""))), None);
    }

    #[test]
    fn set_is_used_verbatim() {
        assert_eq!(
            resolve_from(Some(os("/tmp/pv-instance-a"))),
            Some(PathBuf::from("/tmp/pv-instance-a"))
        );
    }

    /// The property the whole fix rests on: different roots must produce
    /// different webview folders, or concurrent instances still collide.
    #[test]
    fn different_roots_get_different_webview_dirs() {
        let a = webview_subdir_for(std::path::Path::new("/tmp/pv-instance-a"));
        let b = webview_subdir_for(std::path::Path::new("/tmp/pv-instance-b"));
        assert_ne!(a, b, "two instance roots must not share a webview data directory");
    }

    /// The complementary property: one root is stable across relaunches, so
    /// `ResetScope::PreserveWebviewStorage` still preserves storage.
    #[test]
    fn same_root_is_stable_across_calls() {
        let a = webview_subdir_for(std::path::Path::new("/tmp/pv-instance-a"));
        let b = webview_subdir_for(std::path::Path::new("/tmp/pv-instance-a"));
        assert_eq!(a, b);
    }

    /// The E2E harness has to delete this exact folder to honour a
    /// storage-clearing `relaunch()`, and it cannot call this function — it
    /// deliberately does not depend on the Tauri app crate
    /// (`crates/e2e-tests/Cargo.toml`). So it reimplements the derivation,
    /// and this pinned pair is the contract between the two copies: the same
    /// literal is asserted by
    /// `crates/e2e-tests/tests/common/mod.rs::webview_subdir_matches_the_app`.
    /// If either side drifts, one of the two tests fails.
    #[test]
    fn webview_dir_derivation_is_pinned() {
        let dir = webview_subdir_for(std::path::Path::new("/tmp/pv-instance-a"));
        assert_eq!(dir, PathBuf::from("pv-b51d4cf056f3eb58"));
    }

    /// `from_config` rejects an absolute `data_directory` outright and
    /// `SafePathBuf` rejects traversal, so the derived name must be a plain
    /// relative single component or the config is silently ignored.
    #[test]
    fn webview_dir_is_a_plain_relative_component() {
        let dir = webview_subdir_for(std::path::Path::new("/tmp/pv-instance-a"));
        assert!(dir.is_relative(), "must be relative: {dir:?}");
        assert_eq!(dir.components().count(), 1, "must be a single component: {dir:?}");
        let name = dir.to_str().expect("ascii");
        assert!(
            name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'),
            "must be filesystem-safe on every platform: {name}"
        );
    }
}
