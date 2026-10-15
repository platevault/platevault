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
//! - a `version:` field in the trusted comment, which Tauri CLI 2.12 and later
//!   write, names the version the manifest announces. A signature without the
//!   field is accepted, as `tauri-plugin-updater` accepted it.
//!
//! The payload is hashed while it streams to its staging file, so a large
//! bundle never sits in memory, and a [`Staged`] payload exists only once its
//! signature has verified.

use std::fs::File;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use base64::Engine as _;
use minisign_verify::{PublicKey, Signature};

use super::http::Source;
use super::manifest::Release;
use super::{Package, UpdateError};

const SIGNED_VERSION_FIELD: &str = "version:";

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
    keep: AtomicBool,
}

impl Staged {
    /// The verified payload file.
    pub fn file(&self) -> &Path {
        &self.file
    }

    /// Leave the staging directory in place for an installer that reads the
    /// payload after the app has exited. The OS temp cleanup removes it.
    #[cfg_attr(not(windows), allow(dead_code))]
    pub fn keep(&self) {
        self.keep.store(true, Ordering::SeqCst);
    }
}

impl Drop for Staged {
    fn drop(&mut self) {
        if !self.keep.load(Ordering::SeqCst) {
            // Best effort: a leftover directory sits in the OS temp dir.
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }
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
    let mut verifier = key.0.verify_stream(&signature).map_err(|error| match error {
        minisign_verify::Error::UnexpectedKeyId => UpdateError::Signature(
            "the update was signed with a key this app does not trust".to_owned(),
        ),
        minisign_verify::Error::UnsupportedLegacyMode => {
            UpdateError::Signature("the update has a legacy minisign signature".to_owned())
        }
        other => UpdateError::Signature(format!("the update signature is unusable: {other}")),
    })?;

    let dir = tempfile::Builder::new().prefix("platevault-update-").tempdir()?;
    let file = dir.path().join(package.payload_file_name());
    // From here the directory belongs to `staged`, whose drop removes it on
    // every early return below.
    let staged = Staged { dir: dir.keep(), file, keep: AtomicBool::new(false) };
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

/// Decode a manifest `signature` value: base64 of a minisign `.sig` file.
fn decode_signature(base64_sig_file: &str) -> Result<Signature, UpdateError> {
    let text = decode_box(base64_sig_file)
        .ok_or_else(|| UpdateError::Signature("the update signature is not base64".to_owned()))?;
    Signature::decode(&text).map_err(|error| {
        UpdateError::Signature(format!("the update signature is not a minisign signature: {error}"))
    })
}

/// Reject a signature whose trusted comment names a version other than the
/// one the manifest announces: that is an older signed payload served as a
/// newer release. The trusted comment is covered by the global signature,
/// which [`download_verified`] checks.
fn check_signed_version(signature: &Signature, announced: &str) -> Result<(), UpdateError> {
    let signed = signature
        .trusted_comment()
        .split('\t')
        .find_map(|field| field.strip_prefix(SIGNED_VERSION_FIELD));
    match signed {
        Some(signed) if signed.trim_start_matches('v') != announced.trim_start_matches('v') => {
            Err(UpdateError::Signature(format!(
                "the update was signed for version {signed}, but the manifest announces {announced}"
            )))
        }
        _ => Ok(()),
    }
}

/// One base64 value holding a minisign text file, as UTF-8.
fn decode_box(base64_text: &str) -> Option<String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(base64_text.trim()).ok()?;
    String::from_utf8(bytes).ok()
}
