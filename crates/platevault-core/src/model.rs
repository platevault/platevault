// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};

use metadata_core::RawFileMetadata;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub type Revision = u64;

#[derive(Debug, thiserror::Error)]
pub enum LibraryError {
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("revision conflict for {id}; current revision {current}")]
    Conflict { id: Uuid, current: Revision, successors: Vec<Uuid> },
    #[error("filesystem identity conflict: {0}")]
    IdentityConflict(String),
    #[error("source unavailable: {0}")]
    SourceUnavailable(String),
    #[error("unsupported format: {0}")]
    UnsupportedFormat(String),
    #[error("metadata unreadable: {0}")]
    MetadataUnreadable(String),
    #[error("provider unavailable: {0}")]
    ProviderUnavailable(String),
    #[error("persistence failure: {0}")]
    PersistenceFailure(String),
    #[error("no verified byte proof: {0}")]
    NoByteProof(String),
    #[error("operation canceled")]
    Canceled,
}

impl From<sqlx::Error> for LibraryError {
    fn from(error: sqlx::Error) -> Self {
        Self::PersistenceFailure(error.to_string())
    }
}
impl From<serde_json::Error> for LibraryError {
    fn from(error: serde_json::Error) -> Self {
        Self::InvalidInput(error.to_string())
    }
}
impl From<std::io::Error> for LibraryError {
    fn from(error: std::io::Error) -> Self {
        Self::SourceUnavailable(error.to_string())
    }
}

/// Native payload is authoritative; display text is never used for identity.
#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Deserialize)]
#[serde(tag = "encoding", content = "payload", rename_all = "kebab-case")]
pub enum NativePath {
    UnixBytes(Vec<u8>),
    WindowsUtf16(Vec<u16>),
}

impl Serialize for NativePath {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut record = serializer.serialize_struct("NativePath", 3)?;
        match self {
            Self::UnixBytes(bytes) => {
                record.serialize_field("encoding", "unix-bytes")?;
                record.serialize_field("payload", bytes)?;
            }
            Self::WindowsUtf16(units) => {
                record.serialize_field("encoding", "windows-utf16")?;
                record.serialize_field("payload", units)?;
            }
        }
        record.serialize_field("display", &self.display())?;
        record.end()
    }
}

impl NativePath {
    #[must_use]
    pub fn from_path(path: &Path) -> Self {
        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStrExt;
            Self::UnixBytes(path.as_os_str().as_bytes().to_vec())
        }
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStrExt;
            Self::WindowsUtf16(path.as_os_str().encode_wide().collect())
        }
    }
    /// Reconstruct a path without losing native encoding.
    ///
    /// # Errors
    /// Refuses NUL bytes and payloads from another operating system.
    pub fn to_path_buf(&self) -> Result<PathBuf, LibraryError> {
        match self {
            #[cfg(unix)]
            Self::UnixBytes(bytes) => {
                use std::os::unix::ffi::OsStringExt;
                if bytes.contains(&0) {
                    return Err(LibraryError::InvalidInput("NUL in path".into()));
                }
                Ok(std::ffi::OsString::from_vec(bytes.clone()).into())
            }
            #[cfg(windows)]
            Self::WindowsUtf16(units) => {
                use std::os::windows::ffi::OsStringExt;
                if units.contains(&0) {
                    return Err(LibraryError::InvalidInput("NUL in path".into()));
                }
                Ok(std::ffi::OsString::from_wide(units).into())
            }
            _ => Err(LibraryError::InvalidInput("path encoding belongs to another OS".into())),
        }
    }
    /// Validate a location-relative path.
    ///
    /// # Errors
    /// Refuses absolute paths, parent traversal and invalid native payloads.
    pub fn relative_path(&self) -> Result<PathBuf, LibraryError> {
        let path = self.to_path_buf()?;
        if path.components().any(|part| {
            matches!(part, Component::Prefix(_) | Component::RootDir | Component::ParentDir)
        }) {
            return Err(LibraryError::InvalidInput("relative path escapes its location".into()));
        }
        Ok(path)
    }
    #[must_use]
    pub fn display(&self) -> String {
        match self {
            Self::UnixBytes(bytes) => String::from_utf8_lossy(bytes).into_owned(),
            Self::WindowsUtf16(units) => String::from_utf16_lossy(units),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeIdentity {
    pub filesystem: String,
    pub stable_id: String,
    pub file_ids_stable: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileIdentity {
    pub volume: VolumeIdentity,
    pub file_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservationFingerprint {
    pub identity: FileIdentity,
    pub size_bytes: u64,
    pub modified_ns: i128,
}

impl ObservationFingerprint {
    /// Mount-unstable file IDs must not invalidate retained decisions.
    #[must_use]
    pub fn equivalent(&self, other: &Self) -> bool {
        self.identity.volume == other.identity.volume
            && self.size_bytes == other.size_bytes
            && self.modified_ns == other.modified_ns
            && (!self.identity.volume.file_ids_stable
                || self.identity.file_id == other.identity.file_id)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocationRole {
    Captures,
    Calibration,
    Results,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Availability {
    Available,
    Offline,
    Missing,
    Unreadable,
    IdentityConflict,
}
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Quality {
    #[default]
    Unreviewed,
    Usable,
    Unusable,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImageFormat {
    Fits,
    Xisf,
    Unsupported,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub id: Uuid,
    pub name: String,
    pub path: NativePath,
    pub role: LocationRole,
    pub identity: FileIdentity,
    pub decision_revision: Revision,
    pub availability: Availability,
    pub last_observed_at: Option<String>,
}

/// Serialization adapter over the canonical `metadata_core` extractor contract.
/// Raw values survive separately; non-finite/invalid scalars remain unknown.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureMetadata {
    pub raw: BTreeMap<String, String>,
    pub image_type: Option<String>,
    pub filter: Option<String>,
    pub object: Option<String>,
    pub camera: Option<String>,
    pub camera_id: Option<String>,
    pub telescope: Option<String>,
    pub exposure_seconds: Option<f64>,
    pub gain: Option<f64>,
    pub offset: Option<i64>,
    pub binning_x: Option<u32>,
    pub binning_y: Option<u32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub readout_mode: Option<String>,
    pub set_temperature_c: Option<f64>,
    pub measured_temperature_c: Option<f64>,
    pub date_obs: Option<String>,
    pub date_local: Option<String>,
    pub site_longitude_deg: Option<f64>,
    pub site_latitude_deg: Option<f64>,
    pub ra_deg: Option<f64>,
    pub dec_deg: Option<f64>,
    pub wcs_ra_deg: Option<f64>,
    pub wcs_dec_deg: Option<f64>,
    pub sky_rotation_deg: Option<f64>,
    pub mechanical_rotation_deg: Option<f64>,
    pub focal_length_mm: Option<f64>,
    pub pixel_size_um: Option<f64>,
}

fn finite(value: Option<f64>) -> Option<f64> {
    value.filter(|v| v.is_finite()).map(|v| if v == 0.0 { 0.0 } else { v })
}
fn decimal(value: Option<&str>) -> Option<f64> {
    finite(value?.trim().parse().ok())
}
fn integer(value: Option<&str>) -> Option<u32> {
    value?.trim().parse().ok()
}

impl From<&RawFileMetadata> for CaptureMetadata {
    fn from(raw: &RawFileMetadata) -> Self {
        let mut evidence = BTreeMap::new();
        for (key, value) in [
            ("IMAGETYP", &raw.image_typ),
            ("FILTER", &raw.filter),
            ("OBJECT", &raw.object),
            ("EXPTIME", &raw.exposure),
            ("GAIN", &raw.gain),
            ("XBINNING", &raw.x_binning),
            ("YBINNING", &raw.y_binning),
            ("NAXIS1", &raw.naxis1),
            ("NAXIS2", &raw.naxis2),
            ("INSTRUME", &raw.instrume),
            ("CAMERAID", &raw.cameraid),
            ("TELESCOP", &raw.telescop),
            ("DATE-OBS", &raw.date_obs),
            ("DATE-LOC", &raw.date_loc),
            ("READOUTM", &raw.readout_mode),
        ] {
            if let Some(value) = value {
                evidence.insert(key.into(), value.clone());
            }
        }
        Self {
            raw: evidence,
            image_type: raw.image_typ.clone(),
            filter: raw.filter.clone(),
            object: raw.object.clone(),
            camera: raw.instrume.clone(),
            camera_id: raw.cameraid.clone(),
            telescope: raw.telescop.clone(),
            exposure_seconds: decimal(raw.exposure.as_deref()).filter(|v| *v >= 0.0),
            gain: decimal(raw.gain.as_deref()),
            offset: raw.offset,
            binning_x: integer(raw.x_binning.as_deref()),
            binning_y: integer(raw.y_binning.as_deref()),
            width: integer(raw.naxis1.as_deref()),
            height: integer(raw.naxis2.as_deref()),
            readout_mode: raw.readout_mode.clone(),
            set_temperature_c: finite(raw.set_temp_c),
            measured_temperature_c: finite(raw.ccd_temp_c),
            date_obs: raw.date_obs.clone(),
            date_local: raw.date_loc.clone(),
            site_longitude_deg: finite(raw.observer_long),
            site_latitude_deg: finite(raw.observer_lat),
            ra_deg: finite(raw.ra_deg),
            dec_deg: finite(raw.dec_deg),
            wcs_ra_deg: finite(raw.wcs_ra_deg),
            wcs_dec_deg: finite(raw.wcs_dec_deg),
            sky_rotation_deg: finite(raw.wcs_rotation_deg.or(raw.sky_rotation_deg)),
            mechanical_rotation_deg: finite(raw.rotator_angle_deg),
            focal_length_mm: finite(raw.focal_length_mm),
            pixel_size_um: finite(raw.pixel_size_um),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: Uuid,
    pub location_id: Uuid,
    pub relative_path: NativePath,
    pub fingerprint: ObservationFingerprint,
    pub observation_revision: Revision,
    pub decision_revision: Revision,
    pub format: ImageFormat,
    pub availability: Availability,
    pub observed: CaptureMetadata,
    pub effective: CaptureMetadata,
    pub quality: Quality,
    pub quality_basis: Option<ObservationFingerprint>,
    pub last_observed_at: String,
}

impl Asset {
    #[must_use]
    pub fn applicable_quality(&self) -> Quality {
        if self.quality == Quality::Unreviewed
            || self.quality_basis.as_ref().is_some_and(|basis| basis.equivalent(&self.fingerprint))
        {
            self.quality
        } else {
            Quality::Unreviewed
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpectedAsset {
    pub asset_id: Uuid,
    pub decision_revision: Revision,
    pub fingerprint: ObservationFingerprint,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpectedSession {
    pub session_id: Uuid,
    pub grouping_revision: Revision,
    pub decision_revision: Revision,
}
#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
pub struct CaptureKey(pub String);
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCandidate {
    pub key: CaptureKey,
    pub asset_ids: Vec<Uuid>,
    pub provisional: Vec<String>,
    pub date_basis: Option<String>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupingResult {
    pub sessions: Vec<SessionCandidate>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: Uuid,
    pub key: CaptureKey,
    pub grouping_revision: Revision,
    pub decision_revision: Revision,
    pub asset_ids: Vec<Uuid>,
    pub provisional: Vec<String>,
    pub date_basis: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLineage {
    pub correction_id: Uuid,
    pub predecessors: Vec<Uuid>,
    pub successors: Vec<Uuid>,
    pub moved_assets: Vec<Uuid>,
    pub grouping_revision: Revision,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssociationState {
    Unresolved,
    Suggested,
    NeedsReview,
    Confirmed,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Association {
    pub session_id: Uuid,
    pub target_id: Option<Uuid>,
    pub equipment_id: Option<Uuid>,
    pub state: AssociationState,
    pub evidence: Vec<String>,
    pub provenance: String,
    pub decision_revision: Revision,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrectionInput {
    pub asset_id: Uuid,
    pub field: String,
    pub value: serde_json::Value,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScanState {
    Running,
    Completed,
    Partial,
    Failed,
    Canceled,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub discovered: u64,
    pub metadata_read: u64,
    pub unsupported: u64,
    pub unreadable: u64,
    pub complete_directories: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanFile {
    pub relative_path: NativePath,
    pub fingerprint: ObservationFingerprint,
    pub format: ImageFormat,
    pub metadata: CaptureMetadata,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanIssue {
    pub relative_path: NativePath,
    pub reason: String,
    pub availability: Availability,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanBatch {
    pub files: Vec<ScanFile>,
    pub issues: Vec<ScanIssue>,
    pub progress: ScanProgress,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanObservation {
    pub location_id: Uuid,
    pub root_identity: FileIdentity,
    pub files: Vec<ScanFile>,
    pub issues: Vec<ScanIssue>,
    pub complete_scopes: Vec<NativePath>,
    pub incomplete_scopes: Vec<NativePath>,
    pub progress: ScanProgress,
    pub state: ScanState,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanOperation {
    pub id: Uuid,
    pub location_id: Uuid,
    pub state: ScanState,
    pub progress: ScanProgress,
    pub issues: Vec<ScanIssue>,
    pub started_at: String,
    pub finished_at: Option<String>,
}
#[derive(Clone, Debug)]
pub struct ScanOptions {
    pub batch_size: usize,
    pub relative_scope: Option<NativePath>,
}
impl Default for ScanOptions {
    fn default() -> Self {
        Self { batch_size: 64, relative_scope: None }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetAlias {
    pub text: String,
    pub normalized: String,
    pub kind: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetCandidate {
    pub id: Uuid,
    pub designation: String,
    pub aliases: Vec<TargetAlias>,
    pub common_name: Option<String>,
    pub object_type: String,
    pub ra_deg: f64,
    pub dec_deg: f64,
    pub provenance: String,
    pub provider_id: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetRecord {
    pub candidate: TargetCandidate,
    pub decision_revision: Revision,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetCone {
    pub ra_deg: f64,
    pub dec_deg: f64,
    pub radius_deg: f64,
}
impl TargetCone {
    /// Validate a finite spherical cone in degrees.
    ///
    /// # Errors
    /// Refuses coordinates outside their physical ranges or non-finite values.
    pub fn validate(&self) -> Result<(), LibraryError> {
        if !self.ra_deg.is_finite()
            || !(0.0..360.0).contains(&self.ra_deg)
            || !self.dec_deg.is_finite()
            || !(-90.0..=90.0).contains(&self.dec_deg)
            || !self.radius_deg.is_finite()
            || !(0.0..=180.0).contains(&self.radius_deg)
        {
            return Err(LibraryError::InvalidInput("invalid sky cone in degrees".into()));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Equipment {
    pub id: Uuid,
    pub name: String,
    pub camera: Option<String>,
    pub telescope: Option<String>,
    pub focal_length_mm: Option<f64>,
    pub pixel_size_um: Option<f64>,
    pub decision_revision: Revision,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverageContribution {
    pub session_id: Uuid,
    pub location_id: Uuid,
    pub date_basis: Option<String>,
    pub channel: Option<String>,
    pub captured_seconds: f64,
    pub usable_seconds: f64,
    pub unreviewed_seconds: f64,
    pub unknown_exposure_count: u64,
    pub drifted_decisions: u64,
    pub availability: Availability,
    pub last_observed_at: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetCoverage {
    pub target_id: Uuid,
    pub covered_location_ids: Vec<Uuid>,
    pub provisional: bool,
    pub contributions: Vec<CoverageContribution>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DigestEvidence {
    pub sha256: String,
    pub fingerprint: ObservationFingerprint,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemapItem {
    pub asset_id: Uuid,
    pub original_digest: DigestEvidence,
    pub candidate_path: NativePath,
    pub candidate_fingerprint: ObservationFingerprint,
    pub candidate_sha256: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemapReview {
    pub id: Uuid,
    pub location_id: Uuid,
    pub expected_revision: Revision,
    pub proposed_root: NativePath,
    pub proposed_identity: FileIdentity,
    pub items: Vec<RemapItem>,
    pub blocked: Vec<String>,
}
