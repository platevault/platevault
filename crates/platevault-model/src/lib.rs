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
    #[error("access denied: {0}")]
    AccessDenied(String),
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
    #[error("{error}")]
    Context { error: Box<Self>, scope: NativePath, identity: Option<Uuid> },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RetryAction {
    Retry,
    Review,
    None,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorResponse {
    pub kind: String,
    pub identity: Option<Uuid>,
    pub scope: Option<NativePath>,
    pub retry: RetryAction,
    pub message: String,
    pub current_revision: Option<Revision>,
    pub successors: Vec<Uuid>,
}

impl LibraryError {
    /// Convert filesystem failure while retaining its affected path.
    #[must_use]
    pub fn from_io(path: &Path, error: &std::io::Error) -> Self {
        let message = error.to_string();
        let error = match error.kind() {
            std::io::ErrorKind::PermissionDenied => Self::AccessDenied(message),
            std::io::ErrorKind::NotFound => Self::NotFound(message),
            _ => Self::SourceUnavailable(message),
        };
        Self::Context { error: Box::new(error), scope: NativePath::from_path(path), identity: None }
    }

    /// Attach affected identity/scope to the stable IPC failure shape.
    #[must_use]
    pub fn response(&self, identity: Option<Uuid>, scope: Option<NativePath>) -> ErrorResponse {
        if let Self::Context { error, scope: stored_scope, identity: stored_identity } = self {
            return error.response(stored_identity.or(identity), Some(stored_scope.clone()));
        }
        let (kind, retry) = match self {
            Self::InvalidInput(_) => ("invalid_input", RetryAction::Review),
            Self::NotFound(_) => ("not_found", RetryAction::Retry),
            Self::Conflict { .. } => ("conflict", RetryAction::Review),
            Self::IdentityConflict(_) => ("identity_conflict", RetryAction::Review),
            Self::AccessDenied(_) => ("access_denied", RetryAction::Retry),
            Self::SourceUnavailable(_) => ("source_unavailable", RetryAction::Retry),
            Self::UnsupportedFormat(_) => ("unsupported_format", RetryAction::None),
            Self::MetadataUnreadable(_) => ("metadata_unreadable", RetryAction::Review),
            Self::ProviderUnavailable(_) => ("provider_unavailable", RetryAction::Retry),
            Self::PersistenceFailure(_) => ("persistence_failure", RetryAction::Retry),
            Self::NoByteProof(_) => ("no_byte_proof", RetryAction::Review),
            Self::Canceled => ("canceled", RetryAction::None),
            Self::Context { .. } => unreachable!("context handled before variant mapping"),
        };
        let (identity, current_revision, successors) = match self {
            Self::Conflict { id, current, successors } => {
                (Some(*id), Some(*current), successors.clone())
            }
            _ => (identity, None, Vec::new()),
        };
        ErrorResponse {
            kind: kind.into(),
            identity,
            scope,
            retry,
            message: self.to_string(),
            current_revision,
            successors,
        }
    }
}

impl From<sqlx::Error> for LibraryError {
    fn from(error: sqlx::Error) -> Self {
        if matches!(error, sqlx::Error::RowNotFound) {
            Self::NotFound("catalog record".into())
        } else {
            Self::PersistenceFailure(error.to_string())
        }
    }
}
impl From<serde_json::Error> for LibraryError {
    fn from(error: serde_json::Error) -> Self {
        Self::InvalidInput(error.to_string())
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
    pub stable_id: Option<String>,
    pub file_ids_stable: bool,
    pub case: PathSensitivity,
    pub normalization: PathSensitivity,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PathSensitivity {
    Sensitive,
    Insensitive,
    Unknown,
}

impl VolumeIdentity {
    /// Validate remount-stable identity before making absence claims.
    ///
    /// # Errors
    /// Refuses absent/empty stable identity and filesystem type.
    pub fn validate(&self) -> Result<(), LibraryError> {
        if self.filesystem.is_empty() || self.stable_id.as_deref().is_none_or(str::is_empty) {
            return Err(LibraryError::IdentityConflict("volume identity is unqualified".into()));
        }
        Ok(())
    }
}

impl NativePath {
    /// Compare paths only using recorded filesystem capabilities.
    #[must_use]
    pub fn same_on(&self, other: &Self, volume: &VolumeIdentity) -> bool {
        if volume.case == PathSensitivity::Unknown
            || volume.normalization == PathSensitivity::Unknown
        {
            return self == other;
        }
        let text = |path: &Self| match path {
            Self::UnixBytes(bytes) => std::str::from_utf8(bytes).ok().map(str::to_owned),
            Self::WindowsUtf16(units) => String::from_utf16(units).ok(),
        };
        let (Some(mut left), Some(mut right)) = (text(self), text(other)) else {
            return self == other;
        };
        if volume.normalization == PathSensitivity::Insensitive {
            use unicode_normalization::UnicodeNormalization;
            left = left.nfc().collect();
            right = right.nfc().collect();
        }
        if volume.case == PathSensitivity::Insensitive {
            left = left.to_lowercase();
            right = right.to_lowercase();
        }
        left == right
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileIdentity {
    pub volume: VolumeIdentity,
    pub file_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservationFingerprint {
    pub identity: FileIdentity,
    pub size_bytes: u64,
    #[serde(with = "decimal_i128")]
    pub modified_ns: i128,
    #[serde(default)]
    pub content_sha256: Option<String>,
}

impl ObservationFingerprint {
    /// Mount-unstable file IDs must not invalidate retained decisions.
    #[must_use]
    pub fn equivalent(&self, other: &Self) -> bool {
        self.identity.volume == other.identity.volume
            && self.size_bytes == other.size_bytes
            && self.modified_ns == other.modified_ns
            && self.content_sha256 == other.content_sha256
            && (!self.identity.volume.file_ids_stable
                || self.identity.file_id == other.identity.file_id)
    }
}

impl PartialEq for ObservationFingerprint {
    fn eq(&self, other: &Self) -> bool {
        self.equivalent(other)
    }
}
impl Eq for ObservationFingerprint {}

mod decimal_i128 {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(value: &i128, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(value)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<i128, D::Error> {
        let value = String::deserialize(deserializer)?;
        value.parse().map_err(serde::de::Error::custom)
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
pub enum ApplicableQuality {
    Unreviewed,
    Usable,
    Unusable,
    ChangedContent {
        previous: Quality,
    },
    /// A decided asset whose rehash in a readable scan has not finished.
    VerificationPending {
        previous: Quality,
    },
    /// Copies of one logical capture carry conflicting explicit decisions; the
    /// capture counts as neither Usable nor Unreviewed (D16).
    Conflicting,
    /// Copies of one logical capture (duplicate candidates or aliased copies)
    /// whose SHA-256 differ. The capture counts once in captured integration,
    /// neither Usable nor Unreviewed, and neither copy substitutes for the other.
    ConflictingCopies,
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
        if let Some(geometry) = &raw.native_geometry_raw {
            evidence.insert("XISF:geometry".into(), geometry.clone());
        }
        let (width, height) = match raw.native_geometry {
            Some(metadata_core::NativeGeometry::Planar { width, height, .. }) => {
                (Some(width), Some(height))
            }
            Some(
                metadata_core::NativeGeometry::Unsupported
                | metadata_core::NativeGeometry::Malformed,
            ) => (None, None),
            None => (integer(raw.naxis1.as_deref()), integer(raw.naxis2.as_deref())),
        };
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
            width,
            height,
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
    /// The latest readable scan has not finished rehashing this decided asset.
    #[serde(default)]
    pub verification_pending: bool,
    pub last_observed_at: String,
}

impl Asset {
    #[must_use]
    pub fn applicable_quality(&self) -> ApplicableQuality {
        if self.quality != Quality::Unreviewed
            && !self.quality_basis.as_ref().is_some_and(|basis| {
                basis.content_sha256.is_some() && basis.equivalent(&self.fingerprint)
            })
        {
            return ApplicableQuality::ChangedContent { previous: self.quality };
        }
        if self.quality != Quality::Unreviewed && self.verification_pending {
            return ApplicableQuality::VerificationPending { previous: self.quality };
        }
        match self.quality {
            Quality::Unreviewed => ApplicableQuality::Unreviewed,
            Quality::Usable => ApplicableQuality::Usable,
            Quality::Unusable => ApplicableQuality::Unusable,
        }
    }
}

/// Applicable quality of one logical capture from all of its physical copies
/// (D16). An applicable decision on any copy applies to the capture. Explicit
/// decisions that are applicable, or still pending their rehash, and disagree make
/// it `Conflicting`. A decision whose bytes changed never speaks for these bytes,
/// and a decision speaks for the shared digest only after every copy carrying it
/// finished its rehash: until then the capture is verification pending.
#[must_use]
pub fn logical_quality(copies: &[&Asset]) -> ApplicableQuality {
    let qualities: Vec<ApplicableQuality> =
        copies.iter().map(|copy| copy.applicable_quality()).collect();
    let explicit = |wanted: Quality| {
        qualities.iter().any(|quality| match quality {
            ApplicableQuality::Usable => wanted == Quality::Usable,
            ApplicableQuality::Unusable => wanted == Quality::Unusable,
            ApplicableQuality::VerificationPending { previous } => *previous == wanted,
            _ => false,
        })
    };
    if explicit(Quality::Usable) && explicit(Quality::Unusable) {
        return ApplicableQuality::Conflicting;
    }
    let unproven = copies.iter().any(|copy| copy.verification_pending);
    for (decided, previous) in [
        (ApplicableQuality::Usable, Quality::Usable),
        (ApplicableQuality::Unusable, Quality::Unusable),
    ] {
        if qualities.contains(&decided) {
            return if unproven {
                ApplicableQuality::VerificationPending { previous }
            } else {
                decided
            };
        }
    }
    let pending =
        qualities.iter().find(|q| matches!(q, ApplicableQuality::VerificationPending { .. }));
    let changed = qualities.iter().find(|q| matches!(q, ApplicableQuality::ChangedContent { .. }));
    pending.or(changed).copied().unwrap_or(ApplicableQuality::Unreviewed)
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

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssociationKind {
    Target,
    Equipment,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum Provenance {
    Seed { dataset: String },
    User,
    Provider { name: String, id: Option<String> },
    Observed { fields: Vec<String> },
    Inferred { rule: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EvidenceItem {
    Alias { normalized: String, agrees: bool },
    Coordinates { ra_deg: f64, dec_deg: f64, qualified: bool },
    Footprint { overlap: f64, qualified: bool },
    Header { field: String, value: String },
    Unknown { field: String },
    Conflict { field: String, values: Vec<String> },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Association {
    pub session_id: Uuid,
    pub kind: AssociationKind,
    pub subject_id: Option<Uuid>,
    pub state: AssociationState,
    pub evidence: Vec<EvidenceItem>,
    pub provenance: Provenance,
    pub observation_basis: BTreeMap<Uuid, ObservationFingerprint>,
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
    /// Unhashed cross-location duplicate candidates this scan set out to hash.
    #[serde(default)]
    pub duplicate_candidates: u64,
    /// Duplicate candidates whose digest this scan bound so far.
    #[serde(default)]
    pub duplicates_verified: u64,
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
    #[serde(default)]
    pub revision: Revision,
    pub location_id: Uuid,
    pub state: ScanState,
    pub progress: ScanProgress,
    pub issues: Vec<ScanIssue>,
    pub complete_scopes: Vec<NativePath>,
    pub incomplete_scopes: Vec<NativePath>,
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
    pub provenance: Provenance,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetCandidate {
    pub id: Uuid,
    pub designation: String,
    pub aliases: Vec<TargetAlias>,
    pub common_name: Option<String>,
    pub object_type: String,
    pub coordinates: Option<SkyCoordinates>,
    pub provenance: Provenance,
    pub provider_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkyCoordinates {
    pub ra_deg: f64,
    pub dec_deg: f64,
    pub frame: String,
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
    pub state: AssociationState,
    pub provenance: Provenance,
}
/// Coverage is split by session, location and availability, not just session.
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
    /// Decided frames outside applicable totals until their rehash finishes.
    pub verification_pending: u64,
    /// Unhashed frames matching a copy in another location by size, capture key
    /// and start time; totals stay provisional until they are hashed.
    pub duplicate_candidates: u64,
    /// Logical captures whose copies carry conflicting explicit decisions.
    pub conflicting_decisions: u64,
    /// Logical captures whose copies' SHA-256 differ (conflicting copies).
    pub conflicting_copies: u64,
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
    pub blocked: Vec<RemapBlock>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemapBlock {
    pub asset_id: Option<Uuid>,
    pub reason: RemapBlockReason,
    pub message: String,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RemapBlockReason {
    NoByteProof,
    Mismatch,
    Collision,
    Drift,
    IdentityConflict,
}
