// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Explicit app-data-root override (`PV_DATA_DIR`) — issue #1204.
//!
//! # Why the platform env vars are not enough
//!
//! The E2E harness gives every concurrent app instance an isolated app-data
//! root by overriding the platform's location env vars
//! (`crates/e2e-tests/tests/common/mod.rs::InstanceEnv`): `XDG_DATA_HOME` on
//! Linux, `HOME` on macOS, `APPDATA`/`LOCALAPPDATA` on Windows.
//!
//! That works on Linux and macOS. **It does nothing on Windows.** Tauri
//! resolves `app_data_dir()` through the `dirs` crate, which on Windows calls
//! `SHGetKnownFolderPath(FOLDERID_RoamingAppData)`
//! (`dirs-sys-0.5.0/src/lib.rs:176`). The Known Folder API reads the user's
//! shell profile — it ignores `APPDATA` and `LOCALAPPDATA` entirely, so no
//! amount of env-var setting redirects it.
//!
//! Concurrent Windows instances therefore all shared one real app-data root
//! and fought over `simbad-cache.redb`: the loser logs
//! `Database already open. Cannot acquire lock` and silently degrades to an
//! in-memory resolve cache.
//!
//! # The override
//!
//! [`resolve`] reads `PV_DATA_DIR`. When set, it is used verbatim as the
//! app-data root instead of `app.path().app_data_dir()`, on every platform —
//! one mechanism the app itself honours, rather than three platform-specific
//! ones that only two platforms actually obey.
//!
//! When unset (real users, every non-E2E build) nothing changes: callers
//! fall back to the platform resolver exactly as before.
//!
//! # The webview folder is NOT covered here
//!
//! The other half of #1204 — concurrent instances sharing one `WebView2`
//! user-data folder, so the loser cannot create its webview at all
//! (`WindowsError(0x80070057)`) and never brings up its `WebDriver` port —
//! is deliberately *not* solved by this module.
//!
//! `WebView2` has its own documented loader override, `WEBVIEW2_USER_DATA_FOLDER`,
//! which **replaces** the `userDataFolder` argument the app passes to
//! `CreateCoreWebView2EnvironmentWithOptions`. Microsoft documents it as the
//! intended lever for exactly this (testing/deployment overrides), so the
//! harness sets it per instance and the app needs no webview code at all.
//!
//! An earlier attempt did try to solve it here, by pointing each
//! config-declared window at a per-instance `data_directory`. Recorded so it
//! is not retried: that route cannot isolate by *location*. A config window's
//! `data_directory` must be relative — `WebviewBuilder::from_config` rejects
//! absolute paths and joins relative ones onto `dirs::data_local_dir()`
//! (`tauri-2.11.5/src/webview/mod.rs:392-425`), the very Known Folder that
//! started this. Only `WebviewWindowBuilder::data_directory` takes an absolute
//! path, and config-declared windows are built by Tauri during `.build()`,
//! where there is no builder to reach.

use std::path::PathBuf;

/// Name of the app-data-root override variable. See the module docs.
pub const DATA_DIR_ENV: &str = "PV_DATA_DIR";

/// The app-data root override, if `PV_DATA_DIR` is set to a non-empty value.
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
}
