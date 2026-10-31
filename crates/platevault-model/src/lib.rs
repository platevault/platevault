// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

use std::borrow::Cow;
use std::collections::BTreeMap;
use std::fmt;
use std::path::{Component, Path, PathBuf};
use std::sync::LazyLock;

use metadata_core::{
    v1_normalization_table, FrameType, ImageTypNormalizationTable, RawFileMetadata,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Gives a type with a hand-written `Serialize` the IPC type of the value it
/// writes, for the `wire` derives (a derive would describe its fields instead).
#[cfg(feature = "wire")]
macro_rules! wire_as {
    ($ty:ty => $wire:ty) => {
        impl specta::Type for $ty {
            fn definition(types: &mut specta::Types) -> specta::datatype::DataType {
                <$wire as specta::Type>::definition(types)
            }
        }
        impl schemars::JsonSchema for $ty {
            fn inline_schema() -> bool {
                <$wire as schemars::JsonSchema>::inline_schema()
            }
            fn schema_name() -> std::borrow::Cow<'static, str> {
                <$wire as schemars::JsonSchema>::schema_name()
            }
            fn json_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
                <$wire as schemars::JsonSchema>::json_schema(generator)
            }
        }
    };
}

pub mod naming;
pub use naming::*;
pub mod rig;
pub use rig::*;
mod planning;
pub use planning::*;
mod calibration;
pub use calibration::*;
mod project;
pub use project::*;
mod frame_review;
pub use frame_review::*;
pub mod storage;
pub use storage::*;
mod catalogue;
pub use catalogue::*;
mod volume;
pub use volume::*;
pub mod import;
pub use import::*;
mod session_filters;
pub use session_filters::*;
mod targets_list;
pub use targets_list::*;
mod prepare;
pub use prepare::*;
mod issues;
pub use issues::*;
mod preferences;
pub use preferences::*;
mod home;
pub use home::*;

// The F4 Project model (D-W93 to D-W116): canonical types and invariants the
// persistence schema and every F4 unit share.
mod workflow_settings;
pub use workflow_settings::*;
mod rig_version;
pub use rig_version::*;
mod session_calibration;
pub use session_calibration::*;
mod session_matching;
pub use session_matching::*;
mod session_intake;
pub use session_intake::*;
mod session_framing;
pub use session_framing::*;
mod project_inputs;
pub use project_inputs::*;
mod project_view;
pub use project_view::*;
mod project_lifecycle;
pub use project_lifecycle::*;
mod project_output;
pub use project_output::*;
mod project_apply;
pub use project_apply::*;
mod project_wrap_up;
pub use project_wrap_up::*;

time::serde::format_description!(pub(crate) iso_date, Date, "[year]-[month]-[day]");

/// Comparison key of user text such as a FILTER value, a group name or a
/// camera alias: trimmed, NFC and lowercase.
pub(crate) fn comparison_key(value: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    value.trim().nfc().collect::<String>().to_lowercase()
}

/// Refuse a `field` that is not a SHA-256 digest in lowercase hex.
pub(crate) fn require_sha256(field: &str, value: &str) -> Result<(), LibraryError> {
    let hex =
        value.len() == 64 && value.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'));
    if hex {
        Ok(())
    } else {
        Err(LibraryError::InvalidInput(format!("{field} is not a lowercase SHA-256 digest")))
    }
}

/// The parts of a path relative to a folder `PlateVault` owns, refusing an
/// empty path, an absolute one and parent traversal.
pub(crate) fn relative_parts(field: &str, path: &NativePath) -> Result<Vec<String>, LibraryError> {
    let relative = path.relative_path()?;
    let parts: Vec<String> = relative
        .components()
        .filter_map(|part| match part {
            Component::Normal(name) => Some(name.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();
    if parts.is_empty() {
        return Err(LibraryError::InvalidInput(format!("{field} is empty")));
    }
    Ok(parts)
}

/// A logical capture's key and copies (D16): at least one copy, each once in
/// asset id order, the key the smallest.
pub(crate) fn validate_copies(key: Uuid, copies: &[CopyBasis]) -> Result<(), LibraryError> {
    let invalid = |message: String| Err(LibraryError::InvalidInput(message));
    let Some(first) = copies.first() else {
        return invalid(format!("capture {key} names no copy"));
    };
    if first.asset_id != key {
        return invalid(format!("capture {key} is keyed by its smallest copy"));
    }
    if copies.windows(2).any(|pair| pair[0].asset_id >= pair[1].asset_id) {
        return invalid(format!("capture {key} lists its copies once, in order"));
    }
    Ok(())
}

pub type Revision = u64;

/// A library failure. `Display` is an English diagnostic for logs and tests;
/// it never crosses IPC. The client gets [`ErrorResponse`], whose
/// [`LibraryErrorCode`] the desktop catalogues word.
#[derive(Debug, thiserror::Error)]
pub enum LibraryError {
    #[error("invalid input: {0}")]
    InvalidInput(String),
    /// An `InvalidInput` refusal of one value whose field the validator
    /// names: `field` crosses IPC, `message` is the English diagnostic.
    #[error("invalid input: {message}")]
    InvalidField { field: FieldPath, message: String },
    #[error("not found: {0}")]
    NotFound(String),
    #[error("revision conflict for {id}; current revision {current}")]
    Conflict { id: Uuid, current: Revision, successors: Vec<Uuid> },
    /// A selected window `key` is not among the windows recomputed at `site`;
    /// `current` is its Target's revision. The wire code is `conflict`.
    #[error(
        "window {key} at site {site} is not among the recomputed windows; Target {} is at \
         revision {current}",
        .key.target_id()
    )]
    WindowConflict { key: WindowKey, site: String, current: Revision },
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
    /// Symlinks can't be made where the View goes: on Windows, Developer
    /// Mode (the unprivileged symlink right) is off. Apply in Symlinks mode
    /// refuses and offers Copies for this Project; no other link kind is
    /// tried (PREP-FR-15, PREP-AC-08).
    #[error("symlinks unavailable: {0}")]
    SymlinksUnavailable(String),
    /// The processing location's filesystem holds no links (FAT, exFAT,
    /// some network shares): Apply in Symlinks mode refuses and only Copies
    /// is offered there (PREP-AC-03). The response's scope names the folder.
    #[error("links unsupported: {0}")]
    LinksUnsupported(String),
    /// The profile the Project's View opens in isn't evidenced to leave its
    /// inputs unchanged (unknown or write-prone input behaviour): Apply in
    /// Symlinks mode refuses, naming the input-write risk, and Copies is
    /// offered without switching the mode (PREP-FR-02, PREP-AC-11; D-W81).
    /// The response's identity names the profile.
    #[error("input-write risk: {0}")]
    InputWriteRisk(String),
    #[error("operation canceled")]
    Canceled,
    /// A recorded correction can't reach the application: no isolated
    /// patched copy can carry `field` (PREP-FR-03, D-W123). Apply refuses
    /// before it builds, naming the held session as `identity` and the
    /// original as `path`; recording a value no FITS card can hold is
    /// refused too, naming the frame as `identity`. The wire code is
    /// `correction_format_unpatchable` for an input neither FITS nor XISF,
    /// else `correction_unpatchable`; the response names the identity, the
    /// path, the field and the refusal.
    #[error("{identity}: the corrected {field} can't be delivered: {}", .refusal.describe())]
    CorrectionUndeliverable {
        identity: Uuid,
        path: Option<NativePath>,
        field: String,
        refusal: PatchRefusal,
    },
    /// A session an open Project holds isn't Ready: Apply waits until it is
    /// Ready again (FR-034, VSEL-FR-12; D-W100, D-W140). The response's
    /// identity names the session.
    #[error("session not ready: {0}")]
    SessionNotReady(String),
    /// `error` concerning the record `identity`, the native path `scope`, or
    /// both; the innermost context that names one wins.
    #[error("{error}")]
    Context { error: Box<Self>, scope: Option<NativePath>, identity: Option<Uuid> },
}

/// The stable machine code of a [`LibraryError`]: what the client switches on
/// and the key of its user-facing message. The desktop catalogues
/// (`apps/desktop/messages/<locale>.json`) word each code as
/// `err_library_<code>`, as they word a `contracts_core` `ErrorCode` as
/// `err_<code>`. The wire strings are the kinds the catalog also records for
/// run issues, so they don't change.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum LibraryErrorCode {
    InvalidInput,
    NotFound,
    Conflict,
    IdentityConflict,
    AccessDenied,
    SourceUnavailable,
    UnsupportedFormat,
    MetadataUnreadable,
    ProviderUnavailable,
    PersistenceFailure,
    NoByteProof,
    SymlinksUnavailable,
    LinksUnsupported,
    Canceled,
    /// A recorded correction no patched copy can carry: a value FITS can't
    /// hold, or a header that can't take it.
    CorrectionUnpatchable,
    /// A recorded correction on an input neither FITS nor XISF.
    CorrectionFormatUnpatchable,
    /// A session the Project holds isn't Ready, so Apply waits.
    SessionNotReady,
    /// The Project's profile isn't evidenced read-only, so Symlinks is
    /// refused and Copies offered.
    InputWriteRisk,
}

impl LibraryErrorCode {
    /// The wire string serde writes.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidInput => "invalid_input",
            Self::NotFound => "not_found",
            Self::Conflict => "conflict",
            Self::IdentityConflict => "identity_conflict",
            Self::AccessDenied => "access_denied",
            Self::SourceUnavailable => "source_unavailable",
            Self::UnsupportedFormat => "unsupported_format",
            Self::MetadataUnreadable => "metadata_unreadable",
            Self::ProviderUnavailable => "provider_unavailable",
            Self::PersistenceFailure => "persistence_failure",
            Self::NoByteProof => "no_byte_proof",
            Self::SymlinksUnavailable => "symlinks_unavailable",
            Self::LinksUnsupported => "links_unsupported",
            Self::Canceled => "canceled",
            Self::CorrectionUnpatchable => "correction_unpatchable",
            Self::CorrectionFormatUnpatchable => "correction_format_unpatchable",
            Self::SessionNotReady => "session_not_ready",
            Self::InputWriteRisk => "input_write_risk",
        }
    }

    /// What the client offers for a failure with this code.
    #[must_use]
    pub const fn retry(self) -> RetryAction {
        match self {
            Self::NotFound
            | Self::AccessDenied
            | Self::SourceUnavailable
            | Self::ProviderUnavailable
            | Self::PersistenceFailure => RetryAction::Retry,
            Self::InvalidInput
            | Self::Conflict
            | Self::IdentityConflict
            | Self::MetadataUnreadable
            | Self::NoByteProof
            | Self::SymlinksUnavailable
            | Self::LinksUnsupported
            | Self::CorrectionUnpatchable
            | Self::CorrectionFormatUnpatchable
            | Self::SessionNotReady
            | Self::InputWriteRisk => RetryAction::Review,
            Self::UnsupportedFormat | Self::Canceled => RetryAction::None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum RetryAction {
    Retry,
    Review,
    None,
}

/// The IPC form of a [`LibraryError`]: its stable code plus the structured
/// params the client words it with. No English text crosses IPC; the client
/// shows the catalogue message for `code`.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ErrorResponse {
    pub code: LibraryErrorCode,
    /// The record the failure concerns.
    pub identity: Option<Uuid>,
    /// The native path the failure concerns.
    pub scope: Option<NativePath>,
    pub retry: RetryAction,
    /// A `conflict`'s current revision.
    pub current_revision: Option<Revision>,
    /// The records that superseded a `conflict`'s record.
    pub successors: Vec<Uuid>,
    /// The selected window a `conflict` found missing from the windows
    /// recomputed at its site; the key names the Target and the site. Boxed,
    /// like `correction`, so the response stays below the workspace's
    /// `large-error-threshold`.
    pub window: Option<Box<WindowKey>>,
    /// The corrected field a `correction_*` refusal names and why no
    /// isolated patched copy can carry it; boxed so the response stays
    /// below the workspace's `large-error-threshold`.
    pub correction: Option<Box<UndeliverableCorrection>>,
    /// The input field an `invalid_input` refusal names, when its validator
    /// knows which one failed; the client shows the refusal on that field.
    pub field: Option<FieldPath>,
}

/// The stable machine path of the input field a refusal names: the wire
/// (camelCase) names from the validated value down to the field, joined by
/// `.`, such as `minAltitudeDeg` or `moonAvoidance.Ha.distanceDeg`. Never
/// English text; the client maps it onto the form field holding the value.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct FieldPath(Box<str>);

impl FieldPath {
    /// The path of the field named `name` on the validated value.
    #[must_use]
    pub fn new(name: &str) -> Self {
        Self(name.into())
    }

    /// This path below `parent`, the field of the enclosing value that holds
    /// the value this path is relative to.
    #[must_use]
    pub fn within(self, parent: &str) -> Self {
        Self(format!("{parent}.{}", self.0).into())
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for FieldPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A corrected capture field no isolated patched copy can carry, and why.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct UndeliverableCorrection {
    pub field: String,
    pub refusal: PatchRefusal,
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
        Self::Context {
            error: Box::new(error),
            scope: Some(NativePath::from_path(path)),
            identity: None,
        }
    }

    /// An `InvalidInput` refusal of the field at `field`, its path on the
    /// validated value (see [`FieldPath`]), `message` the English diagnostic.
    #[must_use]
    pub fn invalid_field(field: &str, message: impl Into<String>) -> Self {
        Self::InvalidField { field: FieldPath::new(field), message: message.into() }
    }

    /// This refusal of a value as the refusal of the field `parent` of the
    /// enclosing value that holds it, so an outer validator names the field
    /// from its own value down: a named field moves below `parent`, and a
    /// refusal of the whole value names `parent`. Any other failure is
    /// unchanged.
    #[must_use]
    pub fn within_field(self, parent: &str) -> Self {
        match self {
            Self::InvalidField { field, message } => {
                Self::InvalidField { field: field.within(parent), message }
            }
            Self::InvalidInput(message) => Self::invalid_field(parent, message),
            Self::Context { error, scope, identity } => {
                Self::Context { error: Box::new(error.within_field(parent)), scope, identity }
            }
            error => error,
        }
    }

    /// The input field this failure names; a [`Self::Context`] has its
    /// inner error's.
    #[must_use]
    pub fn field(&self) -> Option<&FieldPath> {
        match self {
            Self::InvalidField { field, .. } => Some(field),
            Self::Context { error, .. } => error.field(),
            _ => None,
        }
    }

    /// This failure naming `identity` as the record it concerns, unless it
    /// names one already: a conflict names its own record and a context keeps
    /// its identity. A request over many records uses it to say which failed.
    #[must_use]
    pub fn concerning(self, identity: Uuid) -> Self {
        match self {
            Self::Context { error, scope, identity: None } => {
                Self::Context { error, scope, identity: Some(identity) }
            }
            error @ (Self::Context { .. }
            | Self::Conflict { .. }
            | Self::WindowConflict { .. }
            | Self::CorrectionUndeliverable { .. }) => error,
            error => {
                Self::Context { error: Box::new(error), scope: None, identity: Some(identity) }
            }
        }
    }

    /// The stable code the client words this failure by; a [`Self::Context`]
    /// has its inner error's.
    #[must_use]
    pub fn code(&self) -> LibraryErrorCode {
        match self {
            Self::InvalidInput(_) | Self::InvalidField { .. } => LibraryErrorCode::InvalidInput,
            Self::NotFound(_) => LibraryErrorCode::NotFound,
            Self::Conflict { .. } | Self::WindowConflict { .. } => LibraryErrorCode::Conflict,
            Self::IdentityConflict(_) => LibraryErrorCode::IdentityConflict,
            Self::AccessDenied(_) => LibraryErrorCode::AccessDenied,
            Self::SourceUnavailable(_) => LibraryErrorCode::SourceUnavailable,
            Self::UnsupportedFormat(_) => LibraryErrorCode::UnsupportedFormat,
            Self::MetadataUnreadable(_) => LibraryErrorCode::MetadataUnreadable,
            Self::ProviderUnavailable(_) => LibraryErrorCode::ProviderUnavailable,
            Self::PersistenceFailure(_) => LibraryErrorCode::PersistenceFailure,
            Self::NoByteProof(_) => LibraryErrorCode::NoByteProof,
            Self::SymlinksUnavailable(_) => LibraryErrorCode::SymlinksUnavailable,
            Self::LinksUnsupported(_) => LibraryErrorCode::LinksUnsupported,
            Self::Canceled => LibraryErrorCode::Canceled,
            Self::SessionNotReady(_) => LibraryErrorCode::SessionNotReady,
            Self::InputWriteRisk(_) => LibraryErrorCode::InputWriteRisk,
            Self::CorrectionUndeliverable { refusal: PatchRefusal::UnsupportedFormat, .. } => {
                LibraryErrorCode::CorrectionFormatUnpatchable
            }
            Self::CorrectionUndeliverable { .. } => LibraryErrorCode::CorrectionUnpatchable,
            Self::Context { error, .. } => error.code(),
        }
    }

    /// Attach affected identity/scope to the stable IPC failure shape.
    #[must_use]
    pub fn response(&self, identity: Option<Uuid>, scope: Option<NativePath>) -> ErrorResponse {
        if let Self::Context { error, scope: stored_scope, identity: stored_identity } = self {
            return error.response(stored_identity.or(identity), stored_scope.clone().or(scope));
        }
        let code = self.code();
        let mut response = ErrorResponse {
            code,
            identity,
            scope,
            retry: code.retry(),
            current_revision: None,
            successors: Vec::new(),
            window: None,
            correction: None,
            field: None,
        };
        match self {
            Self::Conflict { id, current, successors } => {
                response.identity = Some(*id);
                response.current_revision = Some(*current);
                response.successors.clone_from(successors);
            }
            Self::WindowConflict { key, current, .. } => {
                response.identity = Some(key.target_id());
                response.current_revision = Some(*current);
                response.window = Some(Box::new(*key));
            }
            Self::CorrectionUndeliverable { identity, path, field, refusal } => {
                response.identity = Some(*identity);
                if path.is_some() {
                    response.scope.clone_from(path);
                }
                response.correction = Some(Box::new(UndeliverableCorrection {
                    field: field.clone(),
                    refusal: *refusal,
                }));
            }
            Self::InvalidField { field, .. } => response.field = Some(field.clone()),
            _ => {}
        }
        response
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

/// The record [`NativePath`]'s `Serialize` writes: the native payload plus its
/// display text. Deserialize never reads `display`.
#[cfg(feature = "wire")]
#[derive(specta::Type, schemars::JsonSchema)]
#[serde(rename = "NativePath", tag = "encoding", rename_all = "kebab-case")]
#[allow(dead_code, reason = "only the IPC type derives read it")]
enum NativePathWire {
    UnixBytes { payload: Vec<u8>, display: String },
    WindowsUtf16 { payload: Vec<u16>, display: String },
}

#[cfg(feature = "wire")]
wire_as!(NativePath => NativePathWire);

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
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct VolumeIdentity {
    pub filesystem: String,
    pub stable_id: Option<String>,
    pub file_ids_stable: bool,
    pub case: PathSensitivity,
    pub normalization: PathSensitivity,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
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

/// A path as a volume tells names apart: two paths are the same file name on
/// that volume exactly when their identities are equal. The native payload is
/// folded only where the volume's recorded capabilities are both known: Unicode
/// NFC where it is normalization-insensitive, lowercase where it is
/// case-insensitive. Otherwise, and for a payload that is not valid text, the
/// identity is the native payload itself.
#[derive(Clone, Debug, Eq, PartialEq, Hash)]
pub struct PathIdentity(PathIdentityKey);

#[derive(Clone, Debug, Eq, PartialEq, Hash)]
enum PathIdentityKey {
    Native(NativePath),
    Folded(String),
}

impl NativePath {
    /// This path's identity on `volume`; see [`PathIdentity`].
    #[must_use]
    pub fn identity_on(&self, volume: &VolumeIdentity) -> PathIdentity {
        if volume.case == PathSensitivity::Unknown
            || volume.normalization == PathSensitivity::Unknown
        {
            return PathIdentity(PathIdentityKey::Native(self.clone()));
        }
        let text = match self {
            Self::UnixBytes(bytes) => std::str::from_utf8(bytes).ok().map(str::to_owned),
            Self::WindowsUtf16(units) => String::from_utf16(units).ok(),
        };
        let Some(mut text) = text else {
            return PathIdentity(PathIdentityKey::Native(self.clone()));
        };
        if volume.normalization == PathSensitivity::Insensitive {
            use unicode_normalization::UnicodeNormalization;
            text = text.nfc().collect();
        }
        if volume.case == PathSensitivity::Insensitive {
            text = text.to_lowercase();
        }
        PathIdentity(PathIdentityKey::Folded(text))
    }

    /// Compare paths only using recorded filesystem capabilities.
    #[must_use]
    pub fn same_on(&self, other: &Self, volume: &VolumeIdentity) -> bool {
        self.identity_on(volume) == other.identity_on(volume)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct FileIdentity {
    pub volume: VolumeIdentity,
    pub file_id: Option<String>,
}

/// Separates a Unix file ID's inode number from the kernel file handle.
const FILE_HANDLE_SEPARATOR: char = ':';

impl FileIdentity {
    /// The file ID of a Unix entry with inode number `inode` and, where its
    /// filesystem encodes one, the kernel file handle `handle` as text
    /// without a `:`.
    ///
    /// A Unix file ID is the entry's decimal inode number, followed on Linux
    /// by `:` and the kernel file handle `name_to_handle_at(2)` encodes for
    /// it. The handle carries the inode's generation, which ext4, xfs and
    /// btrfs change whenever they reuse an inode number, so an entry made
    /// under a just-freed number (ext4 hands it to the next entry created) is
    /// told apart from the one recorded. Where no handle is read (a
    /// filesystem that encodes none, cifs for one, or a read the kernel
    /// refuses) the ID is the inode number alone: it matches only another ID
    /// without a handle ([`file_ids_match`]), and two such IDs can't tell a
    /// reused number apart. A Windows file ID is the 64-bit file index as 16
    /// hex digits.
    #[must_use]
    pub fn unix_file_id(inode: u64, handle: Option<&str>) -> String {
        match handle {
            Some(handle) => format!("{inode}{FILE_HANDLE_SEPARATOR}{handle}"),
            None => inode.to_string(),
        }
    }

    /// The inode number a Unix file ID names; `None` for any other ID.
    #[must_use]
    pub fn unix_inode(file_id: &str) -> Option<u64> {
        file_id.split_once(FILE_HANDLE_SEPARATOR).map_or(file_id, |(inode, _)| inode).parse().ok()
    }

    /// Whether this observed identity is the `recorded` entry: the same
    /// volume and, where the recorded volume's file IDs are stable, file IDs
    /// that match ([`file_ids_match`]).
    #[must_use]
    pub fn is_recorded(&self, recorded: &Self) -> bool {
        self.volume == recorded.volume
            && (!recorded.volume.file_ids_stable
                || file_ids_match(self.file_id.as_deref(), recorded.file_id.as_deref()))
    }
}

/// Whether two file IDs name the same entry: both absent, or both present
/// and equal. For a Unix ID that is the same inode number and the same
/// kernel file handle part, both absent or both present and equal
/// ([`FileIdentity::unix_file_id`]). An ID with a handle never matches one
/// without: on Linux a handle read the kernel refuses (`EPERM`, `EOVERFLOW`)
/// gives the inode number alone, which can't prove the recorded inode's
/// generation, so the pair is an identity conflict.
#[must_use]
pub fn file_ids_match(left: Option<&str>, right: Option<&str>) -> bool {
    left == right
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ObservationFingerprint {
    pub identity: FileIdentity,
    pub size_bytes: u64,
    #[cfg_attr(feature = "wire", specta(type = String), schemars(with = "String"))]
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
                || file_ids_match(
                    self.identity.file_id.as_deref(),
                    other.identity.file_id.as_deref(),
                ))
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
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum LocationRole {
    Captures,
    Calibration,
    Results,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum Availability {
    Available,
    Offline,
    Missing,
    Unreadable,
    IdentityConflict,
    /// A copy of a retired location: history only. It is never offered as an
    /// input, counted as available or included in any integration total.
    Retired,
    /// A frame moved to the OS Trash (LIB-FR-18): its record, identity, digest,
    /// last-observed metadata and quality history are kept, and every query and
    /// total excludes it. The catalog's `live_assets` view leaves these rows out.
    Trashed,
}
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum Quality {
    #[default]
    Unreviewed,
    Usable,
    Unusable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
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
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum ImageFormat {
    Fits,
    Xisf,
    Unsupported,
}

/// Whether a location still takes part in the library. A Retired location left
/// through a reviewed Retire location; it is never reselected, rescanned or
/// remapped, and its root no longer blocks registering an overlapping folder.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum LocationLifecycle {
    Active,
    Retired,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct Location {
    pub id: Uuid,
    pub name: String,
    pub path: NativePath,
    pub role: LocationRole,
    pub identity: FileIdentity,
    pub decision_revision: Revision,
    /// Last-observed access state; a retired location keeps the one it had.
    pub availability: Availability,
    pub last_observed_at: Option<String>,
    pub lifecycle: LocationLifecycle,
    /// The kind of volume the root is on, as observed when it was registered
    /// or last remapped (LIB-FR-01).
    pub volume_kind: VolumeKind,
}

/// Serialization adapter over the canonical `metadata_core` extractor contract.
/// Raw values survive separately; non-finite/invalid scalars remain unknown.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
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
    /// Integration count: `STACKCNT`, else `NCOMBINE`. Absent stays `None`, never 0.
    #[serde(default)]
    pub stack_count: Option<u32>,
    /// The user's framing label ([`FRAMING_LABEL_FIELD`]): lights of one night
    /// and key with the same label are one framing whatever their pointing
    /// (D-W107). No header holds it; only a correction sets it, when the user
    /// merges or splits sessions.
    #[serde(default)]
    pub framing_label: Option<String>,
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
            stack_count: raw.stack_count,
            framing_label: None,
        }
    }
}

/// The frame type capture evidence records in its effective IMAGETYP: the one
/// classification that capture grouping keys sessions by and integration totals
/// count light frames by.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ImageTypeEvidence<'a> {
    /// No IMAGETYP was recorded.
    Absent,
    /// IMAGETYP is blank.
    Blank,
    /// A frame type of the shared IMAGETYP normalization table.
    Known(FrameType),
    /// Trimmed NFC text that names no recognised frame type.
    Unclassified(Cow<'a, str>),
}

impl CaptureMetadata {
    /// Classify the effective IMAGETYP: trimmed NFC text looked up in the shared
    /// normalization table.
    #[must_use]
    pub fn image_type_evidence(&self) -> ImageTypeEvidence<'_> {
        static TABLE: LazyLock<ImageTypNormalizationTable> = LazyLock::new(v1_normalization_table);
        let Some(value) = self.image_type.as_deref() else {
            return ImageTypeEvidence::Absent;
        };
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return ImageTypeEvidence::Blank;
        }
        let text = if unicode_normalization::is_nfc(trimmed) {
            Cow::Borrowed(trimmed)
        } else {
            use unicode_normalization::UnicodeNormalization;
            Cow::Owned(trimmed.nfc().collect())
        };
        match TABLE.normalize(&text) {
            Some(frame) => ImageTypeEvidence::Known(frame),
            None => ImageTypeEvidence::Unclassified(text),
        }
    }

    /// Whether this is a light frame, by [`Self::image_type_evidence`]. `None`
    /// when IMAGETYP is absent, blank or names no recognised frame type: such a
    /// frame is unknown evidence, neither light nor calibration.
    #[must_use]
    pub fn is_light(&self) -> Option<bool> {
        match self.image_type_evidence() {
            ImageTypeEvidence::Known(frame) => Some(frame == FrameType::Light),
            ImageTypeEvidence::Absent
            | ImageTypeEvidence::Blank
            | ImageTypeEvidence::Unclassified(_) => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
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
    /// When this asset's current bytes were last hashed against its record: at
    /// review, inspection, a readable rescan or a verified remap (D19).
    #[serde(default)]
    pub last_verified_at: Option<String>,
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
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ExpectedAsset {
    pub asset_id: Uuid,
    pub decision_revision: Revision,
    pub fingerprint: ObservationFingerprint,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ExpectedSession {
    pub session_id: Uuid,
    pub grouping_revision: Revision,
    pub decision_revision: Revision,
}
#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct CaptureKey(pub String);
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCandidate {
    pub key: CaptureKey,
    pub asset_ids: Vec<Uuid>,
    pub provisional: Vec<String>,
    pub date_basis: Option<String>,
    /// The framing intake split the session by; `None` for frames without
    /// pointing and for frames that are not lights (D-W107).
    #[serde(default)]
    pub framing: Option<SessionFraming>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupingResult {
    pub sessions: Vec<SessionCandidate>,
}
/// A current session a regroup passes to the grouping beside the assets:
/// its members whose capture evidence did not change, and the framing it
/// records. The grouping keeps those members in it and compares other
/// frames with its anchor by its own split limits (D-W107), so a regroup
/// re-splits no session with limits other than its own.
#[derive(Clone, Debug)]
pub struct StandingSession {
    pub key: CaptureKey,
    pub asset_ids: Vec<Uuid>,
    pub framing: Option<SessionFraming>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct Session {
    pub id: Uuid,
    pub key: CaptureKey,
    pub grouping_revision: Revision,
    pub decision_revision: Revision,
    pub asset_ids: Vec<Uuid>,
    pub provisional: Vec<String>,
    pub date_basis: Option<String>,
    /// The framing the session was split by at intake; `None` without pointing.
    #[serde(default)]
    pub framing: Option<SessionFraming>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct SessionLineage {
    pub correction_id: Uuid,
    pub predecessors: Vec<Uuid>,
    pub successors: Vec<Uuid>,
    pub moved_assets: Vec<Uuid>,
    pub grouping_revision: Revision,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum AssociationState {
    Unresolved,
    Suggested,
    NeedsReview,
    Confirmed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum AssociationKind {
    Target,
    Equipment,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum Provenance {
    Seed { dataset: String },
    User,
    Provider { name: String, id: Option<String> },
    Observed { fields: Vec<String> },
    Inferred { rule: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum EvidenceItem {
    Alias { normalized: String, agrees: bool },
    Coordinates { ra_deg: f64, dec_deg: f64, qualified: bool },
    Footprint { overlap: f64, qualified: bool },
    Header { field: String, value: String },
    Unknown { field: String },
    Conflict { field: String, values: Vec<String> },
}

/// Whether an association in `state` with `evidence` counts as confirmed for
/// Needs a Target, Not in any Project, Ready and coverage (LIB-FR-05,
/// LIB-FR-17, LIB-FR-20, D-W124): confirmed by the user, or associated by
/// agreeing evidence, a Suggested row with an agreeing `OBJECT` alias and
/// qualified pointing geometry and no conflict. The admission trigger
/// `project_sessions_admit_ready` restates this rule in SQL.
#[must_use]
pub fn counts_as_confirmed(state: &AssociationState, evidence: &[EvidenceItem]) -> bool {
    match state {
        AssociationState::Confirmed => true,
        AssociationState::Suggested => {
            let alias = evidence
                .iter()
                .any(|item| matches!(item, EvidenceItem::Alias { agrees: true, .. }));
            let geometry = evidence.iter().any(|item| {
                matches!(
                    item,
                    EvidenceItem::Coordinates { qualified: true, .. }
                        | EvidenceItem::Footprint { qualified: true, .. }
                )
            });
            let conflicting =
                evidence.iter().any(|item| matches!(item, EvidenceItem::Conflict { .. }));
            alias && geometry && !conflicting
        }
        AssociationState::Unresolved | AssociationState::NeedsReview => false,
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
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
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct CorrectionInput {
    pub asset_id: Uuid,
    pub field: String,
    #[cfg_attr(feature = "wire", specta(type = JsonValueWire))]
    pub value: serde_json::Value,
}

/// Any JSON value as a named type: the bindings reference it rather than
/// inline `serde_json::Value`'s self-referential shape, which specta refuses.
#[cfg(feature = "wire")]
#[derive(specta::Type, schemars::JsonSchema)]
#[serde(rename = "JsonValue", untagged)]
#[allow(dead_code, reason = "only the IPC type derives read it")]
enum JsonValueWire {
    Null(()),
    Bool(bool),
    Number(f64),
    String(String),
    // The derives expand into nested items, where `Self` doesn't resolve.
    #[allow(clippy::use_self)]
    Array(Vec<JsonValueWire>),
    #[allow(clippy::use_self)]
    Object(BTreeMap<String, JsonValueWire>),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum ScanState {
    Running,
    Completed,
    Partial,
    Failed,
    Canceled,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
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
    /// Decided frames, and copies carrying a decided copy's digest, this scan
    /// set out to rehash (D19). A scan resuming an interrupted rehash counts
    /// only the remaining files (LIB-FR-19).
    #[serde(default)]
    pub rehash_total: u64,
    /// Of those, the rehashes this scan completed so far.
    #[serde(default)]
    pub rehashed: u64,
    /// Rehashes an interrupted earlier scan completed that this scan keeps
    /// instead of hashing those files again (LIB-FR-19).
    #[serde(default)]
    pub rehash_kept: u64,
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
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
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
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
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
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct TargetAlias {
    pub text: String,
    pub normalized: String,
    pub kind: String,
    pub provenance: Provenance,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct TargetCandidate {
    pub id: Uuid,
    pub designation: String,
    pub aliases: Vec<TargetAlias>,
    pub common_name: Option<String>,
    pub object_type: String,
    pub coordinates: Option<SkyCoordinates>,
    pub provenance: Provenance,
    pub provider_id: Option<String>,
    /// Catalogued angular size; `None` when no catalogue records one.
    #[serde(default)]
    pub angular_size: Option<AngularSize>,
    /// Bundled-catalogue entries this object is listed under.
    #[serde(default)]
    pub catalogues: Vec<CatalogueMembership>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct SkyCoordinates {
    pub ra_deg: f64,
    pub dec_deg: f64,
    pub frame: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct TargetRecord {
    pub candidate: TargetCandidate,
    pub decision_revision: Revision,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct TargetCone {
    pub ra_deg: f64,
    pub dec_deg: f64,
    pub radius_deg: f64,
}
impl TargetCone {
    /// Validate a finite spherical cone in degrees.
    ///
    /// # Errors
    /// `InvalidInput` naming the field for a coordinate outside its physical
    /// range or a non-finite value.
    pub fn validate(&self) -> Result<(), LibraryError> {
        let refuse = |field| Err(LibraryError::invalid_field(field, "invalid sky cone in degrees"));
        if !self.ra_deg.is_finite() || !(0.0..360.0).contains(&self.ra_deg) {
            return refuse("raDeg");
        }
        if !self.dec_deg.is_finite() || !(-90.0..=90.0).contains(&self.dec_deg) {
            return refuse("decDeg");
        }
        if !self.radius_deg.is_finite() || !(0.0..=180.0).contains(&self.radius_deg) {
            return refuse("radiusDeg");
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct Equipment {
    pub id: Uuid,
    pub name: String,
    pub camera: Option<String>,
    pub telescope: Option<String>,
    pub focal_length_mm: Option<f64>,
    pub pixel_size_um: Option<f64>,
    pub sensor_width_px: Option<u32>,
    pub sensor_height_px: Option<u32>,
    /// Mono or OSC, from the camera; `None` while unknown.
    pub color_kind: Option<ColorKind>,
    pub decision_revision: Revision,
    pub state: AssociationState,
    pub provenance: Provenance,
}
/// Coverage is split by session, location and availability, not just session.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
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
    /// Oldest last completed verification behind this contribution's usable
    /// exposure (D19); `None` when no applicable decision counts.
    #[serde(default)]
    pub last_verified_at: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct TargetCoverage {
    pub target_id: Uuid,
    pub covered_location_ids: Vec<Uuid>,
    pub provisional: bool,
    /// Oldest last completed verification behind the applicable-usable exposure
    /// (D19): totals count each decision as of that verification and reading them
    /// starts no rehash. `None` when no applicable decision counts.
    #[serde(default)]
    pub last_verified_at: Option<String>,
    pub contributions: Vec<CoverageContribution>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct DigestEvidence {
    pub sha256: String,
    pub fingerprint: ObservationFingerprint,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct RemapItem {
    pub asset_id: Uuid,
    pub original_digest: DigestEvidence,
    pub candidate_path: NativePath,
    pub candidate_fingerprint: ObservationFingerprint,
    pub candidate_sha256: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct RemapReview {
    pub id: Uuid,
    pub location_id: Uuid,
    pub expected_revision: Revision,
    pub proposed_root: NativePath,
    pub proposed_identity: FileIdentity,
    /// The kind of volume the proposed root was observed on, which applying
    /// the review records for the location.
    pub proposed_volume_kind: VolumeKind,
    pub items: Vec<RemapItem>,
    pub blocked: Vec<RemapBlock>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct RemapBlock {
    pub asset_id: Option<Uuid>,
    pub reason: RemapBlockReason,
    pub message: String,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum RemapBlockReason {
    NoByteProof,
    Mismatch,
    Collision,
    Drift,
    IdentityConflict,
}

/// Kind of a record outside the library that holds library asset ids.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum ReferenceKind {
    /// A Project holding copies of the captures it holds (PRJ).
    Project,
    /// An adopted master's provenance record, or a session's calibration pins
    /// (CAL).
    Calibration,
}

/// One record of another feature naming the library assets it holds. The
/// library reads these to review Retire location and never writes them.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct AssetReference {
    pub kind: ReferenceKind,
    pub id: Uuid,
    pub name: String,
    /// The record's own revision: a Project's or a master's revision, or a
    /// session's calibration generation.
    pub revision: Revision,
    /// The referenced assets among those asked about.
    pub asset_ids: Vec<Uuid>,
}

/// A recorded copy of a location under a Retire location review.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct RetireAsset {
    pub asset_id: Uuid,
    pub relative_path: NativePath,
}

/// A current session holding copies of a location under a Retire location review.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct RetireSession {
    pub session_id: Uuid,
    pub grouping_revision: Revision,
    /// The location's copies among the session's members.
    pub asset_ids: Vec<Uuid>,
}

/// The Project holding a session whose pinned calibration file is at a location
/// being reviewed for retirement.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct RetirePinProject {
    pub project_id: Uuid,
    pub name: String,
    pub lifecycle: ProjectLifecycle,
}

/// A current blocker to retiring a location.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "reason", rename_all = "snake_case", rename_all_fields = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum RetireBlock {
    /// A pinned calibration file is held at the location.
    PinnedCalibration {
        session_id: Uuid,
        /// Internal capture-grouping key, not a display label.
        /// The UI must resolve and render the session's display label.
        capture_key: String,
        kinds: Vec<InputKind>,
        projects: Vec<RetirePinProject>,
    },
}

/// Durable review of Retire location (LIB-FR-15): the location, its root and
/// availability, and every asset, session, View, Project and Result referencing
/// its copies. Calibration pins add a blocker before confirmation, which
/// rechecks them. Retiring deletes, moves or modifies no file.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct RetireReview {
    pub id: Uuid,
    pub location_id: Uuid,
    pub location_name: String,
    pub root: NativePath,
    pub availability: Availability,
    pub expected_revision: Revision,
    pub assets: Vec<RetireAsset>,
    pub sessions: Vec<RetireSession>,
    pub references: Vec<AssetReference>,
    /// Projects holding its copies or holding a session whose pin holds a file.
    pub projects: Vec<RetirePinProject>,
    /// Pinned calibration sessions as one blocked-state entry each.
    pub blocked: Vec<RetireBlock>,
    /// Reference kinds whose records were read; a kind not listed was not checked.
    pub consulted: Vec<ReferenceKind>,
    /// What retiring does and does not change, for the reviewer.
    pub statement: String,
}
