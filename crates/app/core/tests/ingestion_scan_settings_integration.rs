// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Layer-1 integration tests for issue #878 — the persisted `followSymlinks`
//! ingestion setting must change what `inbox.scan.folder` discovers.
//!
//! These assert scan *output*, not that a settings row round-trips: the
//! failure this guards against is a durable setting that no pipeline reads.

mod support;

use std::fs;

use app_core::inbox::scan::scan_root;
use app_core::inbox_scan::resolve_scan_options;
use app_core::settings::ingestion::{default_ingestion_settings, update_ingestion_settings};
use contracts_core::ingestion::UpdateIngestionSettings;

/// Persist `follow_symlinks` with every other field left at its default.
async fn set_follow_symlinks(pool: &sqlx::SqlitePool, follow: bool) {
    let d = default_ingestion_settings();
    update_ingestion_settings(
        pool,
        UpdateIngestionSettings {
            watcher_enabled: d.watcher_enabled,
            scan_on_startup: d.scan_on_startup,
            follow_symlinks: follow,
            follow_junctions: d.follow_junctions,
            hashing_mode: d.hashing_mode,
            metadata_extraction: d.metadata_extraction,
            exposure_grouping_tolerance_s: d.exposure_grouping_tolerance_s,
            temperature_grouping_tolerance_c: d.temperature_grouping_tolerance_c,
            default_filter: d.default_filter,
        },
    )
    .await
    .expect("update_ingestion_settings");
}

/// Build a scan root whose only content sits behind a symlinked subdirectory,
/// so discovery of that content is decided purely by traversal options.
#[cfg(unix)]
fn scan_root_behind_symlink(tmp: &std::path::Path) -> std::path::PathBuf {
    use std::os::unix::fs::symlink;

    let real_target = tmp.join("real_target");
    fs::create_dir_all(&real_target).unwrap();
    fs::write(real_target.join("light.fits"), b"light").unwrap();

    let root = tmp.join("scan_root");
    fs::create_dir_all(&root).unwrap();
    symlink(&real_target, root.join("linked")).unwrap();
    root
}

/// The scan must not traverse a symlink while the persisted setting is off.
#[cfg(unix)]
#[tokio::test]
async fn scan_skips_symlinked_dir_when_setting_disabled() {
    let (db, _repo, _bus) = support::setup().await;
    let tmp = tempfile::tempdir().unwrap();
    let root = scan_root_behind_symlink(tmp.path());

    set_follow_symlinks(db.pool(), false).await;
    let opts = resolve_scan_options(db.pool()).await.expect("resolve");
    let items = scan_root(&root, &opts).unwrap().items;

    assert!(items.is_empty(), "content behind a symlink must stay hidden when disabled");
}

/// Enabling the persisted setting must change discovery for the same tree —
/// this is the assertion that fails when nothing reads the setting.
#[cfg(unix)]
#[tokio::test]
async fn scan_traverses_symlinked_dir_when_setting_enabled() {
    let (db, _repo, _bus) = support::setup().await;
    let tmp = tempfile::tempdir().unwrap();
    let root = scan_root_behind_symlink(tmp.path());

    set_follow_symlinks(db.pool(), true).await;
    let opts = resolve_scan_options(db.pool()).await.expect("resolve");
    let items = scan_root(&root, &opts).unwrap().items;

    assert_eq!(items.len(), 1, "enabling the setting must expose the symlinked folder");
}
