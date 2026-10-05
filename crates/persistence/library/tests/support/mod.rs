// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared file-backed catalog fixture: real files under a temporary root, a real
//! no-follow probe of their metadata and a simple behavioral grouping.
#![allow(dead_code)]

use std::collections::BTreeMap;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use persistence_library::{Catalog, LocationRegistration, SourceProbe};
use platevault_model::{
    Asset, CaptureKey, CaptureMetadata, ExpectedAsset, ExpectedSession, FileIdentity,
    GroupingResult, ImageFormat, LibraryError, Location, LocationRole, NativePath,
    ObservationFingerprint, PathSensitivity, Provenance, ScanBatch, ScanFile, ScanIssue,
    ScanObservation, ScanOperation, ScanProgress, ScanState, Session, SessionCandidate,
    TargetAlias, TargetCandidate, VolumeIdentity,
};
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub fn volume() -> VolumeIdentity {
    VolumeIdentity {
        filesystem: "apfs".into(),
        stable_id: Some("0F1E2D3C-test-volume".into()),
        file_ids_stable: true,
        case: PathSensitivity::Sensitive,
        normalization: PathSensitivity::Sensitive,
    }
}

pub fn io_error(path: &Path, error: &std::io::Error) -> LibraryError {
    LibraryError::from_io(path, error)
}

pub fn file_fingerprint(path: &Path) -> Result<ObservationFingerprint, LibraryError> {
    let metadata = std::fs::symlink_metadata(path).map_err(|error| io_error(path, &error))?;
    if !metadata.file_type().is_file() {
        return Err(LibraryError::InvalidInput("not a regular file".into()));
    }
    let modified = metadata.modified().map_err(|error| io_error(path, &error))?;
    let modified_ns =
        i128::try_from(modified.duration_since(UNIX_EPOCH).unwrap().as_nanos()).unwrap();
    Ok(ObservationFingerprint {
        identity: FileIdentity { volume: volume(), file_id: Some(metadata.ino().to_string()) },
        size_bytes: metadata.len(),
        modified_ns,
        content_sha256: None,
    })
}

pub fn folder_identity(path: &Path) -> Result<FileIdentity, LibraryError> {
    let metadata = std::fs::symlink_metadata(path).map_err(|error| io_error(path, &error))?;
    if !metadata.is_dir() {
        return Err(LibraryError::IdentityConflict("root is not a folder".into()));
    }
    Ok(FileIdentity { volume: volume(), file_id: Some(metadata.ino().to_string()) })
}

/// Real no-follow probe of the fixture volume.
#[derive(Clone)]
pub struct DiskProbe;

impl SourceProbe for DiskProbe {
    fn fingerprint(&self, path: &Path) -> Result<ObservationFingerprint, LibraryError> {
        file_fingerprint(path)
    }
    fn root_identity(&self, location: &Location) -> Result<FileIdentity, LibraryError> {
        folder_identity(&location.path.to_path_buf()?)
    }
}

/// Simple behavioral grouping: frame type, filter, exposure and camera.
pub fn group(assets: &[Asset]) -> GroupingResult {
    let mut sessions: BTreeMap<String, Vec<Uuid>> = BTreeMap::new();
    for asset in assets {
        let m = &asset.effective;
        let key =
            format!("{:?}|{:?}|{:?}|{:?}", m.image_type, m.filter, m.exposure_seconds, m.camera);
        sessions.entry(key).or_default().push(asset.id);
    }
    GroupingResult {
        sessions: sessions
            .into_iter()
            .map(|(key, mut asset_ids)| {
                asset_ids.sort_unstable();
                SessionCandidate {
                    key: CaptureKey(key),
                    asset_ids,
                    provisional: Vec::new(),
                    date_basis: Some("2026-09-12".into()),
                }
            })
            .collect(),
    }
}

pub fn metadata_for(relative: &str) -> CaptureMetadata {
    let filter = if relative.contains("OIII") { "OIII" } else { "Ha" };
    CaptureMetadata {
        image_type: Some(if relative.contains("Dark") { "DARK" } else { "LIGHT" }.into()),
        filter: Some(filter.into()),
        exposure_seconds: Some(300.0),
        camera: Some("ASI2600MM".into()),
        date_local: Some("2026-09-12T23:00:00".into()),
        ..CaptureMetadata::default()
    }
}

pub fn sha_of(path: &Path) -> String {
    hex::encode(Sha256::digest(std::fs::read(path).unwrap()))
}

/// Names, sizes and SHA-256 of every file below `root`.
pub fn tree(root: &Path) -> BTreeMap<PathBuf, (u64, String)> {
    let mut files = BTreeMap::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                pending.push(path);
            } else {
                let size = std::fs::metadata(&path).unwrap().len();
                files.insert(path.strip_prefix(root).unwrap().to_path_buf(), (size, sha_of(&path)));
            }
        }
    }
    files
}

pub struct Fixture {
    pub temp: tempfile::TempDir,
    pub db: PathBuf,
    pub root: PathBuf,
}

impl Fixture {
    pub fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("Astro-T7").join("Captures");
        std::fs::create_dir_all(&root).unwrap();
        Self { db: temp.path().join("catalog.sqlite"), root, temp }
    }
    pub fn write(&self, relative: &str, bytes: &[u8]) {
        let path = self.root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }
    pub fn registration(&self) -> LocationRegistration {
        LocationRegistration {
            name: "Astro-T7/Captures".into(),
            path: NativePath::from_path(&self.root),
            role: LocationRole::Captures,
            identity: folder_identity(&self.root).unwrap(),
        }
    }
    pub fn scan_file(&self, relative: &str) -> ScanFile {
        ScanFile {
            relative_path: NativePath::from_path(Path::new(relative)),
            fingerprint: file_fingerprint(&self.root.join(relative)).unwrap(),
            format: ImageFormat::Fits,
            metadata: metadata_for(relative),
        }
    }
}

pub fn root_scope() -> NativePath {
    NativePath::UnixBytes(Vec::new())
}

pub fn kind(error: &LibraryError) -> String {
    error.response(None, None).kind
}

pub fn expected(asset: &Asset) -> ExpectedAsset {
    ExpectedAsset {
        asset_id: asset.id,
        decision_revision: asset.decision_revision,
        fingerprint: asset.fingerprint.clone(),
    }
}

pub fn expected_session(session: &Session) -> ExpectedSession {
    ExpectedSession {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        decision_revision: session.decision_revision,
    }
}

pub fn target(designation: &str, alias: &str) -> TargetCandidate {
    TargetCandidate {
        id: Uuid::new_v4(),
        designation: designation.into(),
        aliases: vec![TargetAlias {
            text: designation.into(),
            normalized: alias.into(),
            kind: "designation".into(),
            provenance: Provenance::User,
        }],
        common_name: None,
        object_type: "nebula".into(),
        coordinates: Some(platevault_model::SkyCoordinates {
            ra_deg: 314.75,
            dec_deg: 44.33,
            frame: "ICRS".into(),
        }),
        provenance: Provenance::User,
        provider_id: None,
    }
}

pub async fn scan_with(
    catalog: &Catalog,
    fx: &Fixture,
    location: &Location,
    files: &[&str],
    issues: Vec<ScanIssue>,
    state: ScanState,
) -> ScanOperation {
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let files: Vec<ScanFile> = files.iter().map(|relative| fx.scan_file(relative)).collect();
    let root = DiskProbe.root_identity(location).unwrap();
    let progress = ScanProgress {
        discovered: files.len() as u64,
        metadata_read: files.len() as u64,
        ..ScanProgress::default()
    };
    let batch =
        ScanBatch { files: files.clone(), issues: issues.clone(), progress: progress.clone() };
    catalog.apply_scan_batch(operation.id, &root, &batch, group).await.unwrap();
    let terminal = matches!(state, ScanState::Completed | ScanState::Partial);
    let observation = ScanObservation {
        location_id: location.id,
        root_identity: root,
        incomplete_scopes: issues.iter().map(|issue| issue.relative_path.clone()).collect(),
        files,
        issues,
        complete_scopes: if terminal { vec![root_scope()] } else { Vec::new() },
        progress,
        state,
    };
    catalog
        .finish_scan(
            operation.id,
            &observation,
            |location| DiskProbe.root_identity(location),
            group,
        )
        .await
        .unwrap()
}

pub async fn scan(
    catalog: &Catalog,
    fx: &Fixture,
    location: &Location,
    files: &[&str],
) -> ScanOperation {
    scan_with(catalog, fx, location, files, Vec::new(), ScanState::Completed).await
}

pub fn by_name<'a>(assets: &'a [Asset], name: &str) -> &'a Asset {
    assets.iter().find(|asset| asset.relative_path.display().ends_with(name)).unwrap()
}
