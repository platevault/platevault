// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Minisign verification of update payloads.
//!
//! The rules match the release's manifest gate
//! (`scripts/assemble-updater-manifest.mjs`), so a release the gate publishes
//! is one this client installs:
//!
//! - the signature is minisign `ED` (Ed25519 over the BLAKE2b-512 digest of
//!   the payload) made with the key the app embeds;
//! - both the payload signature and the trusted-comment signature verify;
//! - the trusted comment's `version:` field, which Tauri CLI 2.12 and later
//!   write, names the version the manifest announces. A signature without the
//!   field is refused. `latest.json` is not signed, so the field is the only
//!   thing tying the announced version to the payload: without it, any older
//!   signed payload could be announced as a newer release and installed as a
//!   rollback. The releases before 0.7.0 carry no field, but this client is
//!   only ever offered releases newer than itself.
//!
//! The payload is hashed while it streams to its staging file, so a large
//! bundle never sits in memory, and a [`Staged`] payload exists only once its
//! signature has verified. [`Staged::reverify`] checks it again right before
//! an installer reads it. An installer that hands the file to a process with
//! more rights than the user's re-checks it there (astro-plan-ryj83): on Unix
//! against the size and SHA-256 of the bytes `reverify` verified; on Windows
//! the handle `reverify` opened keeps ordinary writers out until the
//! installer exits, though not code running as the user (see
//! `open_payload`).

use std::fs::{self, File};
use std::io::{self, Read as _, Seek as _, Write as _};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime};

use base64::Engine as _;
use minisign_verify::{PublicKey, Signature, StreamVerifier};
#[cfg(unix)]
use sha2::{Digest as _, Sha256};

use super::http::Source;
use super::manifest::Release;
use super::{Package, UpdateError};

const SIGNED_VERSION_FIELD: &str = "version:";
/// The staging directories' name prefix in the temp dir.
const PAYLOAD_DIR_PREFIX: &str = "platevault-update-payload-";
/// How old a leftover staging directory must be before a later run removes
/// it.
const STALE_AFTER: Duration = Duration::from_hours(24);

/// The minisign public key update signatures must verify against.
pub struct TrustedKey(PublicKey);

impl TrustedKey {
    /// Decode the key as `tauri.conf.json` stores it (`plugins.updater.pubkey`):
    /// base64 of a minisign public key file.
    pub fn from_config(base64_key_file: &str) -> Result<Self, UpdateError> {
        let text = decode_box(base64_key_file)
            .ok_or_else(|| UpdateError::Config("the update public key is not base64".to_owned()))?;
        PublicKey::decode(&text).map(Self).map_err(|error| {
            UpdateError::Config(format!("the update public key is not a minisign key: {error}"))
        })
    }
}

/// A downloaded payload whose signature verified, in a private staging
/// directory that is removed when the value is dropped unless [`Self::keep`]
/// was called.
pub struct Staged {
    dir: PathBuf,
    file: PathBuf,
    key: PublicKey,
    signature: Signature,
    keep: AtomicBool,
}

impl Staged {
    /// The verified payload file.
    #[cfg_attr(all(target_os = "linux", not(test)), allow(dead_code))]
    pub fn file(&self) -> &Path {
        &self.file
    }

    /// Open the payload and verify it against its signature again. It waits
    /// in a directory the user can write to for as long as an install on quit
    /// or a retry is pending, so every install checks it right before the
    /// installer reads it, and installers that run in this process read the
    /// returned handle rather than the path.
    pub fn reverify(&self) -> Result<Payload<'_>, UpdateError> {
        let mut file = open_payload(&self.file)?;
        let mut verifier = stream_verifier(&self.key, &self.signature)?;
        #[cfg(unix)]
        let mut digest = Sha256::new();
        #[cfg(target_os = "macos")]
        let mut size = 0_u64;
        let mut buffer = vec![0_u8; 64 * 1024];
        loop {
            let read = file.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            verifier.update(&buffer[..read]);
            #[cfg(unix)]
            digest.update(&buffer[..read]);
            #[cfg(target_os = "macos")]
            {
                size += read as u64;
            }
        }
        verifier.finalize().map_err(|_| {
            UpdateError::Signature(
                "the staged update changed after it was downloaded and verified".to_owned(),
            )
        })?;
        file.rewind()?;
        Ok(Payload {
            staged: self,
            file,
            #[cfg(unix)]
            sha256: format!("{:x}", digest.finalize()),
            #[cfg(target_os = "macos")]
            size,
        })
    }

    /// Leave the staging directory in place for an installer that reads the
    /// payload after the app has exited. A later run's
    /// [`remove_stale_payloads`] removes it: Windows does not empty `%TEMP%`
    /// unless Storage Sense or Disk Cleanup is set up to.
    #[cfg_attr(not(windows), allow(dead_code))]
    pub fn keep(&self) {
        self.keep.store(true, Ordering::SeqCst);
    }
}

impl Drop for Staged {
    fn drop(&mut self) {
        if !self.keep.load(Ordering::SeqCst) {
            // Best effort: a later run's `remove_stale_payloads` removes a
            // leftover.
            let _ = fs::remove_dir_all(&self.dir);
        }
    }
}

/// A staged payload that verified against its signature again just now,
/// open for the installer.
pub struct Payload<'a> {
    // Read by the installers that hand the path to another process: Windows
    // and macOS. The Linux packages travel on standard input.
    #[cfg_attr(all(target_os = "linux", not(test)), allow(dead_code))]
    staged: &'a Staged,
    file: File,
    /// SHA-256 of exactly the bytes [`Staged::reverify`] verified, lowercase
    /// hex, and how many there were.
    #[cfg(unix)]
    sha256: String,
    #[cfg(target_os = "macos")]
    size: u64,
}

impl Payload<'_> {
    /// The payload's path, for an installer that runs in another process.
    #[cfg_attr(all(target_os = "linux", not(test)), allow(dead_code))]
    pub fn path(&self) -> &Path {
        self.staged.file()
    }

    /// The verified file, positioned at its start, for an installer that runs
    /// in this process or hands the open file to one it starts.
    pub fn reader(&mut self) -> &mut File {
        &mut self.file
    }

    /// The SHA-256 of the bytes that verified, for a privileged step that
    /// copies the payload where only it can write and must check the copy:
    /// the file stays writable by the user, so the copy may differ.
    #[cfg(unix)]
    pub fn sha256(&self) -> &str {
        &self.sha256
    }

    /// How many bytes verified, which bounds the privileged step's copy.
    #[cfg(target_os = "macos")]
    pub const fn size(&self) -> u64 {
        self.size
    }

    /// See [`Staged::keep`].
    #[cfg(windows)]
    pub fn keep(&self) {
        self.staged.keep();
    }
}

/// Open the staged payload to verify it for an install. Windows opens it
/// sharing reads only (`FILE_SHARE_READ`), and the installer inherits a
/// duplicate of the handle (`windows::launch_installer`). While either is
/// open, the open fails for anything that already holds the file for writing
/// through a handle, and later opens for writing, deleting or renaming it fail
/// too, so the Windows Installer service, which reads the MSI after the UAC
/// prompt and after this process has exited, reads the bytes that verified.
///
/// This is a lock against ordinary opens, not a boundary against code that
/// runs as this user (astro-plan-ryj83). A writable view a process mapped
/// before this open, with its handles closed, holds no share access and can
/// still change the file; and the `msiexec` client that holds the duplicate
/// runs unelevated as this user, so such code can close or replace its
/// handle, or tamper with that process outright. Unix has the same
/// precondition; there the privileged step checks a copy of its own.
#[cfg(windows)]
fn open_payload(path: &Path) -> io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt as _;

    const FILE_SHARE_READ: u32 = 0x1;
    fs::OpenOptions::new().read(true).share_mode(FILE_SHARE_READ).open(path)
}

/// Open the staged payload to verify it for an install. Unix has no lock
/// that keeps another process of the same user from writing it, so a
/// privileged step checks its own copy against [`Payload::sha256`].
#[cfg(not(windows))]
fn open_payload(path: &Path) -> io::Result<File> {
    File::open(path)
}

/// Download `release` for `package` from `source` into a fresh staging
/// directory and verify it against `key`. Nothing is returned for a payload
/// whose signature fails, and its directory is removed.
pub async fn download_verified(
    source: &dyn Source,
    release: &Release,
    package: Package,
    key: &TrustedKey,
) -> Result<Staged, UpdateError> {
    let signature = decode_signature(&release.signature)?;
    check_signed_version(&signature, &release.version_text)?;

    let dir = tempfile::Builder::new().prefix(PAYLOAD_DIR_PREFIX).tempdir()?;
    let file = dir.path().join(package.payload_file_name());
    // From here the directory belongs to `staged`, whose drop removes it on
    // every early return below.
    let staged = Staged {
        dir: dir.keep(),
        file,
        key: key.0.clone(),
        signature,
        keep: AtomicBool::new(false),
    };
    let mut verifier = stream_verifier(&staged.key, &staged.signature)?;
    let mut out = File::create(&staged.file)?;
    source
        .download(&release.url, &mut |chunk| {
            verifier.update(chunk);
            out.write_all(chunk)
        })
        .await?;
    out.sync_all()?;
    drop(out);
    verifier.finalize().map_err(|_| {
        UpdateError::Signature(
            "the downloaded update does not match its signature (was the file changed after it was signed?)"
                .to_owned(),
        )
    })?;
    Ok(staged)
}

/// A verifier for `signature` under `key`, refusing another key and the
/// legacy unhashed format.
fn stream_verifier<'a>(
    key: &'a PublicKey,
    signature: &'a Signature,
) -> Result<StreamVerifier<'a>, UpdateError> {
    key.verify_stream(signature).map_err(|error| match error {
        minisign_verify::Error::UnexpectedKeyId => UpdateError::Signature(
            "the update was signed with a key this app does not trust".to_owned(),
        ),
        minisign_verify::Error::UnsupportedLegacyMode => {
            UpdateError::Signature("the update has a legacy minisign signature".to_owned())
        }
        other => UpdateError::Signature(format!("the update signature is unusable: {other}")),
    })
}

/// Decode a manifest `signature` value: base64 of a minisign `.sig` file.
fn decode_signature(base64_sig_file: &str) -> Result<Signature, UpdateError> {
    let text = decode_box(base64_sig_file)
        .ok_or_else(|| UpdateError::Signature("the update signature is not base64".to_owned()))?;
    Signature::decode(&text).map_err(|error| {
        UpdateError::Signature(format!("the update signature is not a minisign signature: {error}"))
    })
}

/// Require the signature's trusted comment to name the version the manifest
/// announces. A signature for another version, or one that names none, may
/// be an older signed payload served as a newer release. The trusted comment
/// is covered by the global signature, which [`download_verified`] checks.
fn check_signed_version(signature: &Signature, announced: &str) -> Result<(), UpdateError> {
    let Some(signed) = signature
        .trusted_comment()
        .split('\t')
        .find_map(|field| field.strip_prefix(SIGNED_VERSION_FIELD))
    else {
        return Err(UpdateError::Signature(
            "the update signature does not name the version it was signed for".to_owned(),
        ));
    };
    if signed.trim_start_matches('v') != announced.trim_start_matches('v') {
        return Err(UpdateError::Signature(format!(
            "the update was signed for version {signed}, but the manifest announces {announced}"
        )));
    }
    Ok(())
}

/// One base64 value holding a minisign text file, as UTF-8.
fn decode_box(base64_text: &str) -> Option<String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(base64_text.trim()).ok()?;
    String::from_utf8(bytes).ok()
}

/// Remove the staging directories earlier runs left in the temp dir: the
/// Windows installers read theirs after the app has exited, so nothing
/// removed it, and a crash leaves one on any OS. Only directories older than
/// a day go, so a payload an installer may still be reading stays.
pub fn remove_stale_payloads() {
    remove_stale_payloads_in(&std::env::temp_dir(), SystemTime::now());
}

/// [`remove_stale_payloads`] over `dir`, judging age against `now`.
pub(super) fn remove_stale_payloads_in(dir: &Path, now: SystemTime) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if !entry.file_name().to_string_lossy().starts_with(PAYLOAD_DIR_PREFIX) {
            continue;
        }
        // Not followed: a symlink with the prefix is not a directory here.
        let stale = entry
            .metadata()
            .ok()
            .filter(fs::Metadata::is_dir)
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > STALE_AFTER);
        if stale {
            if let Err(error) = fs::remove_dir_all(entry.path()) {
                tracing::debug!(path = %entry.path().display(), %error, "cannot remove a stale update payload");
            }
        }
    }
}
