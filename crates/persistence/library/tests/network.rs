// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Network volumes and resumable hashing (LIB-FR-01, LIB-FR-19, LIB-AC-20).
//!
//! A location on a share the OS mounted is flagged as a network volume. An
//! unmount mid-rehash reads Offline and keeps completed hashes; the next scan
//! resumes with the remaining files and never hashes the completed ones again.

mod support;

use std::collections::BTreeMap;
use std::path::Path;

use persistence_library::{Catalog, LocationRegistration, SourceProbe};
use platevault_model::{
    ApplicableQuality, Asset, Availability, Location, LocationRole, NativePath, Quality, ScanBatch,
    ScanIssue, ScanObservation, ScanProgress, ScanState, VolumeKind,
};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, Row};
use support::*;
use uuid::Uuid;

const FRAMES: [&str; 4] = ["Ha_001.fits", "Ha_002.fits", "Ha_003.fits", "Ha_004.fits"];

fn network_registration(fx: &Fixture) -> LocationRegistration {
    LocationRegistration {
        name: "NAS/Captures".into(),
        volume_kind: VolumeKind::Network,
        ..fx.registration()
    }
}

/// `volume_kind` as each `locations` row stores it.
async fn stored_kinds(db: &Path) -> BTreeMap<Uuid, String> {
    let options = SqliteConnectOptions::new().filename(db).read_only(true);
    let mut conn = sqlx::SqliteConnection::connect_with(&options).await.unwrap();
    let rows =
        sqlx::query("SELECT id, volume_kind FROM locations").fetch_all(&mut conn).await.unwrap();
    let kinds = rows
        .iter()
        .map(|row| {
            let id: String = row.get("id");
            (id.parse().unwrap(), row.get("volume_kind"))
        })
        .collect();
    conn.close().await.unwrap();
    kinds
}

/// Availability exactly as each asset row stores it, before any location state
/// is applied: Missing there would win over an Offline location.
async fn stored_availability(db: &Path) -> Vec<String> {
    let options = SqliteConnectOptions::new().filename(db).read_only(true);
    let mut conn = sqlx::SqliteConnection::connect_with(&options).await.unwrap();
    let stored = sqlx::query_scalar("SELECT availability FROM assets ORDER BY path_key")
        .fetch_all(&mut conn)
        .await
        .unwrap();
    conn.close().await.unwrap();
    stored
}

async fn frames(catalog: &Catalog, location: &Location) -> Vec<Asset> {
    let assets = catalog.location_assets(location.id).await.unwrap();
    FRAMES.iter().map(|name| by_name(&assets, name).clone()).collect()
}

/// Replace a file's bytes in place with equal length and its original mtime,
/// so only a content hash can tell.
fn rewrite_same_stat(fx: &Fixture, name: &str, bytes: &[u8]) {
    let path = fx.root.join(name);
    let before = file_fingerprint(&path).unwrap();
    assert_eq!(before.size_bytes, bytes.len() as u64);
    let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
    let file = std::fs::OpenOptions::new().write(true).truncate(true).open(&path).unwrap();
    std::io::Write::write_all(&mut &file, bytes).unwrap();
    file.set_modified(modified).unwrap();
    drop(file);
    assert!(before.equivalent(&file_fingerprint(&path).unwrap()), "stats cannot detect it");
}

/// Where a share is mounted: unmounting it takes the location root away.
fn mount_point(fx: &Fixture) -> std::path::PathBuf {
    fx.root.parent().unwrap().to_path_buf()
}

fn unmount(fx: &Fixture) {
    let mount = mount_point(fx);
    std::fs::rename(&mount, mount.with_extension("unmounted")).unwrap();
}

fn remount(fx: &Fixture) {
    let mount = mount_point(fx);
    std::fs::rename(mount.with_extension("unmounted"), &mount).unwrap();
}

struct AfterUnmount {
    catalog: Catalog,
    location: Location,
    /// The four Usable frames as their review left them.
    reviewed: Vec<Asset>,
    /// The same frames once the share went away mid-rehash.
    interrupted: Vec<Asset>,
}

/// Four frames indexed on a network location and reviewed Usable.
async fn reviewed_on_network(fx: &Fixture) -> (Catalog, Location, Vec<Asset>) {
    for (index, name) in FRAMES.iter().enumerate() {
        fx.write(name, format!("frame {index} bytes").as_bytes());
    }
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&network_registration(fx)).await.unwrap();
    scan(&catalog, fx, &location, &FRAMES).await;
    for asset in frames(&catalog, &location).await {
        catalog.set_quality(&[expected(&asset)], Quality::Usable, DiskProbe).await.unwrap();
    }
    let reviewed = frames(&catalog, &location).await;
    assert!(reviewed
        .iter()
        .all(|asset| !asset.verification_pending && asset.last_verified_at.is_some()));
    (catalog, location, reviewed)
}

/// Rescan the reviewed frames: the first batch rehashes two of them before the
/// share is unmounted, and the walk ends Failed with the location root lost.
async fn rehash_interrupted_by_unmount(fx: &Fixture) -> AfterUnmount {
    let (catalog, location, reviewed) = reviewed_on_network(fx).await;

    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let root = DiskProbe.root_identity(&location).unwrap();
    let first = ScanBatch {
        files: vec![fx.scan_file(FRAMES[0]), fx.scan_file(FRAMES[1])],
        issues: Vec::new(),
        progress: ScanProgress { discovered: 2, metadata_read: 2, ..ScanProgress::default() },
    };
    let applied = catalog.apply_scan_batch(operation.id, &root, &first, group).await.unwrap();
    // Hashing shows progress: two of the four decided frames are rehashed.
    assert_eq!(
        (applied.progress.rehash_total, applied.progress.rehashed, applied.progress.rehash_kept),
        (4, 2, 0),
        "{:?}",
        applied.progress
    );
    assert_eq!(applied.progress.discovered, 2, "the walk's own counts are kept");

    unmount(fx);
    let lost = ScanObservation {
        location_id: location.id,
        root_identity: root,
        files: first.files.clone(),
        issues: vec![ScanIssue {
            relative_path: root_scope(),
            reason: "location root became unavailable during the scan".into(),
            availability: Availability::Offline,
        }],
        complete_scopes: Vec::new(),
        incomplete_scopes: vec![root_scope()],
        progress: first.progress.clone(),
        state: ScanState::Failed,
    };
    let refused = catalog
        .finish_scan(operation.id, &lost, |location| DiskProbe.root_identity(location), group)
        .await
        .unwrap_err();
    assert!(matches!(kind(&refused).as_str(), "not_found" | "source_unavailable"), "{refused}");
    let status = catalog.scan_status(operation.id).await.unwrap();
    assert_eq!(status.state, ScanState::Failed);
    assert_eq!((status.progress.rehash_total, status.progress.rehashed), (4, 2));
    let interrupted = frames(&catalog, &location).await;
    AfterUnmount { catalog, location, reviewed, interrupted }
}

#[tokio::test]
async fn network_location_flagged_in_row() {
    let fx = Fixture::new();
    let internal = fx.temp.path().join("Internal").join("Calibration");
    std::fs::create_dir_all(&internal).unwrap();
    let catalog = Catalog::open(&fx.db).await.unwrap();

    let nas = catalog.register_location(&network_registration(&fx)).await.unwrap();
    let local = catalog
        .register_location(&LocationRegistration {
            name: "Internal/Calibration".into(),
            path: NativePath::from_path(&internal),
            role: LocationRole::Calibration,
            identity: folder_identity(&internal).unwrap(),
            volume_kind: VolumeKind::Local,
        })
        .await
        .unwrap();
    assert_eq!(nas.volume_kind, VolumeKind::Network);
    assert_eq!(local.volume_kind, VolumeKind::Local);

    // Every row read names its volume kind, and so does the wire shape.
    let listed: BTreeMap<Uuid, VolumeKind> = catalog
        .list_locations()
        .await
        .unwrap()
        .into_iter()
        .map(|location| (location.id, location.volume_kind))
        .collect();
    assert_eq!(
        listed,
        BTreeMap::from([(nas.id, VolumeKind::Network), (local.id, VolumeKind::Local)])
    );
    assert_eq!(serde_json::to_value(&nas).unwrap()["volumeKind"], "network");
    catalog.close().await.unwrap();

    assert_eq!(
        stored_kinds(&fx.db).await,
        BTreeMap::from([(nas.id, "network".to_owned()), (local.id, "local".to_owned())])
    );
    let reopened = Catalog::open(&fx.db).await.unwrap();
    assert_eq!(reopened.location(nas.id).await.unwrap().volume_kind, VolumeKind::Network);
    reopened.close().await.unwrap();
}

#[tokio::test]
async fn unmount_mid_hash_reads_offline_never_missing() {
    let fx = Fixture::new();
    let AfterUnmount { catalog, location, reviewed, interrupted } =
        rehash_interrupted_by_unmount(&fx).await;

    let current = catalog.location(location.id).await.unwrap();
    assert_eq!(current.availability, Availability::Offline);
    assert_eq!(current.volume_kind, VolumeKind::Network);
    assert!(
        interrupted.iter().all(|asset| asset.availability == Availability::Offline),
        "{:?}",
        interrupted.iter().map(|asset| asset.availability).collect::<Vec<_>>()
    );
    // Offline frames keep their last-observed quality; the two whose rehash
    // finished keep that completed hash and verification.
    for (before, after) in reviewed.iter().zip(&interrupted).take(2) {
        assert!(!after.verification_pending, "{after:?}");
        assert_ne!(after.last_verified_at, before.last_verified_at, "rehashed before the unmount");
        assert_eq!(after.fingerprint.content_sha256, before.fingerprint.content_sha256);
        assert_eq!(after.quality, Quality::Usable);
    }
    for (before, after) in reviewed.iter().zip(&interrupted).skip(2) {
        assert!(after.verification_pending, "{after:?}");
        assert_eq!(after.last_verified_at, before.last_verified_at, "never reached");
        assert_eq!(after.quality, Quality::Usable);
    }
    catalog.close().await.unwrap();
    let stored = stored_availability(&fx.db).await;
    assert!(stored.iter().all(|state| state != "missing"), "{stored:?}");
}

#[tokio::test]
async fn remount_resumes_without_rehashing_completed() {
    let fx = Fixture::new();
    let AfterUnmount { catalog, location, interrupted, .. } =
        rehash_interrupted_by_unmount(&fx).await;
    remount(&fx);
    // Only a rehash could see these new bytes behind unchanged stats.
    rewrite_same_stat(&fx, FRAMES[0], b"frame X bytes");

    let resumed = scan(&catalog, &fx, &location, &FRAMES).await;
    assert_eq!(resumed.state, ScanState::Completed, "{:?}", resumed.issues);
    assert_eq!(
        (resumed.progress.rehash_total, resumed.progress.rehashed, resumed.progress.rehash_kept),
        (2, 2, 2),
        "only the remaining files were hashed: {:?}",
        resumed.progress
    );
    assert_eq!(catalog.location(location.id).await.unwrap().availability, Availability::Available);
    let after = frames(&catalog, &location).await;
    assert!(after
        .iter()
        .all(|asset| !asset.verification_pending && asset.quality == Quality::Usable));
    assert!(after.iter().all(|asset| asset.availability == Availability::Available));
    for (before, now) in interrupted.iter().zip(&after).take(2) {
        assert_eq!(now.last_verified_at, before.last_verified_at, "kept, not rehashed");
        assert_eq!(now.fingerprint.content_sha256, before.fingerprint.content_sha256);
    }
    assert_eq!(after[0].applicable_quality(), ApplicableQuality::Usable, "its bytes were not read");
    for (before, now) in interrupted.iter().zip(&after).skip(2) {
        assert_ne!(now.last_verified_at, before.last_verified_at, "the remaining files rehashed");
        assert_eq!(now.applicable_quality(), ApplicableQuality::Usable);
    }

    // The run finished, so the next rescan rechecks every decided frame (D19)
    // and finds the bytes that changed behind unchanged stats.
    let rescan = scan(&catalog, &fx, &location, &FRAMES).await;
    assert_eq!(
        (rescan.progress.rehash_total, rescan.progress.rehashed, rescan.progress.rehash_kept),
        (4, 4, 0),
        "{:?}",
        rescan.progress
    );
    assert_eq!(
        catalog.asset(after[0].id).await.unwrap().applicable_quality(),
        ApplicableQuality::ChangedContent { previous: Quality::Usable }
    );
    catalog.close().await.unwrap();
}

#[tokio::test]
async fn no_smb_or_url_registration_accepted() {
    let fx = Fixture::new();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let addresses = [
        "smb://nas.local/Astro/Captures",
        "//nas.local/Astro/Captures",
        "afp://nas.local/Astro",
        "nfs://nas.local/export/astro",
        "https://nas.local/dav/Astro",
    ];
    for address in addresses {
        let path = NativePath::UnixBytes(address.as_bytes().to_vec());
        let registration = LocationRegistration { path, ..network_registration(&fx) };
        let refused = catalog.register_location(&registration).await.unwrap_err();
        assert_eq!(kind(&refused), "invalid_input", "{address}: {refused}");
        assert!(refused.to_string().contains("mounts no share"), "{address}: {refused}");
    }
    assert!(catalog.list_locations().await.unwrap().is_empty(), "nothing was registered");

    // A registered location cannot be pointed at an address either.
    let nas = catalog.register_location(&network_registration(&fx)).await.unwrap();
    for address in addresses {
        let path = NativePath::UnixBytes(address.as_bytes().to_vec());
        let reselect = catalog
            .reselect_location(nas.id, nas.decision_revision, &path, &nas.identity)
            .await
            .unwrap_err();
        assert_eq!(kind(&reselect), "invalid_input", "{address}: {reselect}");
        let remap = catalog
            .review_remap(nas.id, nas.decision_revision, &path, &nas.identity, DiskProbe)
            .await
            .unwrap_err();
        assert_eq!(kind(&remap), "invalid_input", "{address}: {remap}");
    }
    let unchanged = catalog.location(nas.id).await.unwrap();
    assert_eq!((unchanged.path, unchanged.decision_revision), (nas.path, nas.decision_revision));
    catalog.close().await.unwrap();
}
