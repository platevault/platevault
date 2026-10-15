// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The `latest.json` manifest the release pipeline publishes
//! (`scripts/assemble-updater-manifest.mjs`), read the way
//! `tauri-plugin-updater` reads it so one file serves old and new clients.

use std::collections::HashMap;

use reqwest::Url;
use semver::Version;
use serde::Deserialize;

use super::{Platform, UpdateError};

#[derive(Deserialize)]
struct Manifest {
    version: String,
    #[serde(default)]
    notes: Option<String>,
    platforms: HashMap<String, Entry>,
}

#[derive(Deserialize)]
struct Entry {
    url: String,
    signature: String,
}

/// A release newer than the running app, with this platform's payload.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Release {
    /// The version as the manifest spells it, which the signature's trusted
    /// comment must match.
    pub version_text: String,
    pub notes: Option<String>,
    pub url: Url,
    /// Base64 of the payload's minisign `.sig` file.
    pub signature: String,
}

/// The release `manifest` announces for `platform`, or `None` when it is not
/// newer than `current`.
///
/// The payload is the `{os}-{arch}-{package}` entry, falling back to the bare
/// `{os}-{arch}` entry, the same lookup order as `tauri-plugin-updater`.
pub fn newer_release(
    manifest: &[u8],
    current: &Version,
    platform: &Platform,
) -> Result<Option<Release>, UpdateError> {
    let mut manifest: Manifest = serde_json::from_slice(manifest).map_err(|error| {
        UpdateError::Manifest(format!("the update manifest is malformed: {error}"))
    })?;
    let version = Version::parse(manifest.version.trim_start_matches('v')).map_err(|error| {
        UpdateError::Manifest(format!(
            "the update manifest version {} is not semver: {error}",
            manifest.version
        ))
    })?;
    if version <= *current {
        return Ok(None);
    }
    let keys = platform.manifest_keys();
    let Some(entry) = keys.iter().find_map(|key| manifest.platforms.remove(key)) else {
        return Err(UpdateError::Manifest(format!(
            "the update manifest has no entry for {}",
            keys.join(" or ")
        )));
    };
    let url = Url::parse(&entry.url).map_err(|error| {
        UpdateError::Manifest(format!("the update URL {} is not a URL: {error}", entry.url))
    })?;
    Ok(Some(Release {
        version_text: manifest.version,
        notes: manifest.notes.filter(|notes| !notes.trim().is_empty()),
        url,
        signature: entry.signature,
    }))
}
