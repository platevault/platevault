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
    #[serde(flatten)]
    release: ReleaseManifest,
    #[serde(default)]
    candidates: Vec<ReleaseManifest>,
}

#[derive(Deserialize)]
struct ReleaseManifest {
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
    bytes: &[u8],
    current: &Version,
    platform: &Platform,
    include_candidates: bool,
) -> Result<Option<Release>, UpdateError> {
    let manifest: Manifest = serde_json::from_slice(bytes).map_err(|error| {
        UpdateError::Manifest(format!("the update manifest is malformed: {error}"))
    })?;
    let stable_version =
        Version::parse(manifest.release.version.trim_start_matches('v')).map_err(|error| {
            UpdateError::Manifest(format!(
                "the update manifest version {} is not semver: {error}",
                manifest.release.version
            ))
        })?;
    let mut selected = if stable_version > *current {
        Some((&manifest.release, stable_version.clone()))
    } else {
        None
    };

    if include_candidates {
        for candidate in &manifest.candidates {
            let version =
                Version::parse(candidate.version.trim_start_matches('v')).map_err(|error| {
                    UpdateError::Manifest(format!(
                        "the candidate version {} is not semver: {error}",
                        candidate.version
                    ))
                })?;
            let prerelease = version.pre.as_str();
            if !prerelease.strip_prefix("rc.").is_some_and(|number| {
                !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit())
            }) || !version.build.as_str().is_empty()
            {
                return Err(UpdateError::Manifest(format!(
                    "the candidate version {} is not an X.Y.Z-rc.N version",
                    candidate.version
                )));
            }
            // Release publishing normally keeps candidates ahead of the
            // stable release. Ignore stale carry-over entries here.
            if version > *current
                && selected.as_ref().is_none_or(|(_, selected_version)| version > *selected_version)
            {
                selected = Some((candidate, version));
            }
        }
    }

    let Some((manifest, _)) = selected else {
        return Ok(None);
    };
    let keys = platform.manifest_keys();
    let Some(entry) = keys.iter().find_map(|key| manifest.platforms.get(key)) else {
        return Err(UpdateError::Manifest(format!(
            "the update manifest has no entry for {}",
            keys.join(" or ")
        )));
    };
    let url = Url::parse(&entry.url).map_err(|error| {
        UpdateError::Manifest(format!("the update URL {} is not a URL: {error}", entry.url))
    })?;
    if url.scheme() != "https" {
        return Err(UpdateError::Manifest(format!(
            "the update URL {} is not an HTTPS URL",
            entry.url
        )));
    }
    Ok(Some(Release {
        version_text: manifest.version.clone(),
        notes: manifest.notes.clone().filter(|notes| !notes.trim().is_empty()),
        url,
        signature: entry.signature.clone(),
    }))
}
