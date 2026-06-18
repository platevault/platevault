//! Manifest fetch, per-catalog download, SHA-256 verification, minisign
//! signature verification, and install lifecycle for spec 014 — Catalog Index
//! Licensing.
//!
//! # Design
//!
//! The network surface is abstracted behind [`CatalogFetcher`] so the
//! download lifecycle state-machine is fully unit-testable with a
//! [`FakeFetcher`] (no real network in tests). The real HTTP implementation
//! is [`ReqwestFetcher`].
//!
//! # Signature verification (FR-026, D5, T068)
//!
//! Every manifest is verified against the embedded trusted public key using
//! minisign before any catalog data is accepted. The signature covers the
//! canonical JSON bytes of the `catalogs` array. Tampered or invalid
//! signatures hard-fail with [`DownloadError::ManifestSignatureInvalid`].
//!
//! The SHA-256 checksum on each catalog artifact is a complementary check.
//!
//! # Event topics (R-3.1)
//!
//! The download module emits the following string topics via the caller-owned
//! progress callback:
//! - `"catalog.manifest.fetched"` — manifest downloaded and verified.
//! - `"catalog.download.started"` — download of a single catalog started.
//! - `"catalog.download.progress"` — byte-level progress update.
//! - `"catalog.download.completed"` — catalog verified and installed.
//! - `"catalog.download.failed"` — download or verification failure.

use std::io::Cursor;

use serde::{Deserialize, Serialize};

use crate::license::LicenseShortCode;

// ── Trusted public key (FR-026, D5) ──────────────────────────────────────────

/// Embedded trusted minisign public key for the astro-plan-catalogs repo.
///
/// This key is embedded at compile time. The catalog repo is not yet published
/// externally (real downloads remain blocked), but the verification path is
/// fully operational and tested with fixtures using the test keypair in the
/// test suite.
///
/// Format: minisign public key box string (two lines: untrusted comment +
/// base64-encoded public key).
///
/// Replace with the real key once the catalogs repo is published. The constant
/// below is a placeholder that will NOT verify any real signature — replace it
/// with the output of `minisign -G` before distributing catalogs.
pub const TRUSTED_PUBLIC_KEY: &str = "\
untrusted comment: astro-plan catalog signing key (placeholder — replace before shipping)\
\nRWQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

// ── Error ─────────────────────────────────────────────────────────────────────

/// Errors produced by the catalog download lifecycle.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum DownloadError {
    #[error("manifest fetch failed: {0}")]
    ManifestFetchFailed(String),
    #[error("manifest signature invalid: {0}")]
    ManifestSignatureInvalid(String),
    #[error("no manifest cached — call manifest_fetch first")]
    ManifestNotFetched,
    #[error("catalog '{0}' not found in manifest")]
    CatalogNotInManifest(String),
    #[error("catalog fetch failed: {0}")]
    CatalogFetchFailed(String),
    #[error("catalog checksum mismatch (expected {expected}, got {actual})")]
    ChecksumMismatch { expected: String, actual: String },
    #[error("catalog install failed: {0}")]
    InstallFailed(String),
    #[error("network unavailable: {0}")]
    NetworkUnavailable(String),
    #[error("origin 'user' is not implemented in v1 (A2)")]
    OriginNotImplemented,
    #[error("unknown license code '{0}' — not in the recognised closed set")]
    UnknownLicenseCode(String),
    #[error("unknown catalog slug '{0}' — not in the v1 closed enum")]
    UnknownCatalogSlug(String),
}

/// Error code strings matching the `catalog.download.json` contract.
impl DownloadError {
    #[must_use]
    pub fn error_code(&self) -> &'static str {
        match self {
            Self::ManifestFetchFailed(_) => "manifest.fetch_failed",
            Self::ManifestSignatureInvalid(_) => "manifest.signature_invalid",
            Self::ManifestNotFetched => "manifest.not_fetched",
            Self::CatalogNotInManifest(_) => "catalog.not_in_manifest",
            Self::CatalogFetchFailed(_) => "catalog.fetch_failed",
            Self::ChecksumMismatch { .. } => "catalog.checksum_mismatch",
            Self::InstallFailed(_) => "catalog.install_failed",
            Self::NetworkUnavailable(_) => "network.unavailable",
            Self::OriginNotImplemented => "origin.not_implemented",
            Self::UnknownLicenseCode(_) => "manifest.unknown_license_code",
            Self::UnknownCatalogSlug(_) => "manifest.unknown_catalog_slug",
        }
    }
}

// ── Manifest types ─────────────────────────────────────────────────────────────

/// Per-catalog entry in the signed manifest (mirrors `catalog.manifest.fetch.json`
/// §ManifestCatalogEntry).
///
/// The `license` field is a raw string here so that unknown codes can be
/// hard-failed at parse time rather than silently falling back (FR-027, T069).
/// Use [`ManifestEntry::parse_license`] to obtain a validated
/// [`LicenseShortCode`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    /// Stable catalog slug.
    pub catalog_id: String,
    /// Semver-ish version string for this catalog artifact.
    pub version: String,
    /// GitHub Releases download URL.
    pub url: String,
    /// SHA-256 hex checksum of the catalog artifact bytes.
    pub checksum: String,
    /// License short code (raw string from JSON — validated via parse_license).
    pub license: String,
    /// Uncompressed size in bytes (for progress estimation).
    pub size_bytes: u64,
}

/// The v1 closed catalog slug set (spec 013 `CatalogId` / D3). Single source of
/// truth shared by manifest slug validation and the entry-file reader.
pub const KNOWN_CATALOG_SLUGS: [&str; 13] = [
    "messier",
    "caldwell",
    "sharpless",
    "abell_pn",
    "abell_galaxies",
    "arp",
    "vdb",
    "barnard",
    "lbn",
    "ldn",
    "melotte",
    "common",
    "openngc",
];

/// Returns `true` when `slug` is in the v1 closed catalog set.
#[must_use]
pub fn is_known_catalog_slug(slug: &str) -> bool {
    KNOWN_CATALOG_SLUGS.contains(&slug)
}

impl ManifestEntry {
    /// Validate and parse the raw `license` string to a [`LicenseShortCode`].
    ///
    /// Hard-fails with [`DownloadError::UnknownLicenseCode`] for unrecognised
    /// codes (FR-027, T069). No silent fallback to `PublicDomain`.
    ///
    /// # Errors
    ///
    /// Returns `DownloadError::UnknownLicenseCode` for any code not in the
    /// recognised closed set.
    pub fn parse_license(&self) -> Result<LicenseShortCode, DownloadError> {
        LicenseShortCode::parse_code(&self.license)
            .ok_or_else(|| DownloadError::UnknownLicenseCode(self.license.clone()))
    }

    /// Validate the `catalog_id` slug against the spec 013 closed enum.
    ///
    /// Hard-fails with [`DownloadError::UnknownCatalogSlug`] for unknown slugs
    /// (FR-029, D3, T070). No silent `Unknown` skip.
    ///
    /// # Errors
    ///
    /// Returns `DownloadError::UnknownCatalogSlug` when the slug is not in the
    /// v1 closed set.
    pub fn validate_slug(&self) -> Result<(), DownloadError> {
        // We deliberately avoid a dep on the targeting crate here; the closed
        // v1 set from catalog.rs `CatalogId` is mirrored in `KNOWN_CATALOG_SLUGS`.
        if is_known_catalog_slug(&self.catalog_id) {
            Ok(())
        } else {
            Err(DownloadError::UnknownCatalogSlug(self.catalog_id.clone()))
        }
    }
}

/// The parsed manifest returned from a successful fetch.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    /// Semver manifest schema version.
    pub version: String,
    /// Minisign signature box string. Verified against the embedded trusted
    /// public key before any catalog data is accepted (FR-026).
    /// The signature covers the canonical JSON bytes of the `catalogs` array.
    pub signature: String,
    /// Ordered list of catalog entries.
    pub catalogs: Vec<ManifestEntry>,
}

/// Result of a `manifest_fetch` call.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ManifestFetchResult {
    /// New manifest downloaded and verified. Carries the parsed manifest and
    /// the server-returned ETag.
    Fetched { manifest: Manifest, etag: Option<String> },
    /// ETag matched — local manifest is current (HTTP 304).
    NotModified,
    /// Network or verification failure.
    Failed(DownloadError),
}

/// Result of a `catalog_download` call.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CatalogDownloadResult {
    /// Catalog fetched, checksum verified, installed. Carries the audit id.
    Success { audit_id: String },
    /// Failure. The previously installed catalog (if any) remains active.
    Failure(DownloadError),
}

// ── Progress events (R-3.1) ───────────────────────────────────────────────────

/// Events emitted during the download lifecycle (R-3.1).
///
/// Callers subscribe to these via the progress callback passed to
/// [`download_catalog`].
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "topic", rename_all = "snake_case")]
pub enum DownloadEvent {
    /// Manifest downloaded and verified.
    #[serde(rename = "catalog.manifest.fetched")]
    ManifestFetched { catalog_count: usize },
    /// Download of a single catalog started.
    #[serde(rename = "catalog.download.started")]
    Started { catalog_id: String },
    /// Byte-level download progress.
    #[serde(rename = "catalog.download.progress")]
    Progress { catalog_id: String, bytes_received: u64, bytes_total: u64 },
    /// Catalog verified and installed.
    #[serde(rename = "catalog.download.completed")]
    Completed { catalog_id: String, audit_id: String },
    /// Download or verification failure.
    #[serde(rename = "catalog.download.failed")]
    Failed { catalog_id: String, error_code: String, message: String },
}

// ── CatalogFetcher trait ───────────────────────────────────────────────────────

/// Abstract network/IO surface for the catalog download lifecycle.
///
/// This trait is the key seam that keeps the lifecycle state-machine
/// unit-testable without real network access. Tests use [`FakeFetcher`];
/// production code uses [`ReqwestFetcher`].
#[async_trait::async_trait]
pub trait CatalogFetcher: Send + Sync {
    /// Fetch the manifest from the given URL.
    ///
    /// If `etag` is `Some`, sends an `If-None-Match` header. Returns the raw
    /// manifest bytes and the server ETag (if present) on success, or
    /// `(None, None)` on 304 Not Modified.
    ///
    /// # Errors
    ///
    /// Returns [`DownloadError`] on network or HTTP failure.
    async fn fetch_manifest(
        &self,
        url: &str,
        etag: Option<&str>,
    ) -> Result<Option<(Vec<u8>, Option<String>)>, DownloadError>;

    /// Download the catalog artifact bytes from the given URL.
    ///
    /// `progress` is called with `(bytes_received, bytes_total)` during
    /// download. `bytes_total` may be 0 if the server does not advertise
    /// Content-Length.
    ///
    /// # Errors
    ///
    /// Returns [`DownloadError`] on network or HTTP failure.
    async fn fetch_catalog(
        &self,
        url: &str,
        progress: &mut (dyn FnMut(u64, u64) + Send),
    ) -> Result<Vec<u8>, DownloadError>;
}

// ── ReqwestFetcher ────────────────────────────────────────────────────────────

/// Real HTTP implementation using `reqwest`.
///
/// Used by the production download path. Network is NOT called in tests.
pub struct ReqwestFetcher {
    client: reqwest::Client,
}

impl ReqwestFetcher {
    /// Create a new fetcher with a default `reqwest::Client`.
    #[must_use]
    pub fn new() -> Self {
        Self { client: reqwest::Client::new() }
    }
}

impl Default for ReqwestFetcher {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl CatalogFetcher for ReqwestFetcher {
    async fn fetch_manifest(
        &self,
        url: &str,
        etag: Option<&str>,
    ) -> Result<Option<(Vec<u8>, Option<String>)>, DownloadError> {
        let mut req = self.client.get(url);
        if let Some(tag) = etag {
            req = req.header("If-None-Match", tag);
        }
        let resp =
            req.send().await.map_err(|e| DownloadError::NetworkUnavailable(e.to_string()))?;

        if resp.status() == reqwest::StatusCode::NOT_MODIFIED {
            return Ok(None);
        }
        if !resp.status().is_success() {
            return Err(DownloadError::ManifestFetchFailed(format!("HTTP {}", resp.status())));
        }

        let etag_val = resp.headers().get("etag").and_then(|v| v.to_str().ok()).map(str::to_owned);

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| DownloadError::ManifestFetchFailed(e.to_string()))?
            .to_vec();

        Ok(Some((bytes, etag_val)))
    }

    async fn fetch_catalog(
        &self,
        url: &str,
        progress: &mut (dyn FnMut(u64, u64) + Send),
    ) -> Result<Vec<u8>, DownloadError> {
        let resp = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| DownloadError::NetworkUnavailable(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(DownloadError::CatalogFetchFailed(format!("HTTP {}", resp.status())));
        }

        let content_length = resp.content_length().unwrap_or(0);
        // Accumulate bytes (reqwest doesn't stream easily without tokio streams;
        // for large catalogs a streaming approach is preferred but out of scope for v1).
        let body =
            resp.bytes().await.map_err(|e| DownloadError::CatalogFetchFailed(e.to_string()))?;
        let bytes = body.to_vec();
        progress(bytes.len() as u64, content_length);
        Ok(bytes)
    }
}

// ── SHA-256 checksum verification ─────────────────────────────────────────────

/// Verify that `bytes` matches the expected SHA-256 `hex_checksum`.
///
/// Returns `Ok(())` when they match, or a [`DownloadError::ChecksumMismatch`]
/// on mismatch.
///
/// # Errors
///
/// Returns `DownloadError::ChecksumMismatch` when the computed digest does not
/// match the expected hex string.
pub fn verify_sha256(bytes: &[u8], hex_checksum: &str) -> Result<(), DownloadError> {
    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();
    hasher.update(bytes);
    let actual = hex::encode(hasher.finalize());
    if actual != hex_checksum {
        return Err(DownloadError::ChecksumMismatch { expected: hex_checksum.to_owned(), actual });
    }
    Ok(())
}

// ── Minisign signature verification (FR-026, D5, T068) ───────────────────────

/// Verify that `data_bytes` was signed with the minisign key whose public key
/// box string is `trusted_pk_box`.
///
/// `signature_box_str` is the full minisign signature box (the `.minisig` file
/// contents). `data_bytes` is the canonical data that was signed — for
/// manifests this is the JSON bytes of the `catalogs` array.
///
/// # Errors
///
/// Returns [`DownloadError::ManifestSignatureInvalid`] when:
/// - The public key box or signature box cannot be parsed.
/// - The signature is cryptographically invalid (tampered data or wrong key).
pub fn verify_minisign_signature(
    trusted_pk_box: &str,
    signature_box_str: &str,
    data_bytes: &[u8],
) -> Result<(), DownloadError> {
    use minisign::PublicKeyBox;

    let pk_box = PublicKeyBox::from_string(trusted_pk_box).map_err(|e| {
        DownloadError::ManifestSignatureInvalid(format!("public key parse error: {e}"))
    })?;
    let pk = minisign::PublicKey::from_box(pk_box).map_err(|e| {
        DownloadError::ManifestSignatureInvalid(format!("public key decode error: {e}"))
    })?;

    let sig_box = minisign::SignatureBox::from_string(signature_box_str).map_err(|e| {
        DownloadError::ManifestSignatureInvalid(format!("signature box parse error: {e}"))
    })?;

    let reader = Cursor::new(data_bytes);
    minisign::verify(&pk, &sig_box, reader, true, false, false).map_err(|e| {
        DownloadError::ManifestSignatureInvalid(format!("signature verification failed: {e}"))
    })
}

/// Derive the canonical signed bytes for a manifest's signature.
///
/// The signature covers the JSON serialization of the `catalogs` array.  Using
/// a sub-document (rather than the whole manifest JSON) avoids the circularity
/// of signing a document that contains its own signature field.
///
/// # Errors
///
/// Returns [`DownloadError::ManifestFetchFailed`] on JSON serialization failure
/// (should be infallible in practice).
pub fn manifest_signed_bytes(catalogs: &[ManifestEntry]) -> Result<Vec<u8>, DownloadError> {
    serde_json::to_vec(catalogs).map_err(|e| {
        DownloadError::ManifestFetchFailed(format!("catalog serialization error: {e}"))
    })
}

// ── FakeFetcher (test double) ──────────────────────────────────────────────────

/// In-memory test double for [`CatalogFetcher`].
///
/// Produces pre-set manifest bytes and catalog bytes without any network access.
/// Unit tests construct this with known byte blobs and verify the lifecycle
/// without touching the network.
#[derive(Clone)]
pub struct FakeFetcher {
    /// Manifest response: `Some((bytes, etag))` → 200, `None` → 304.
    pub manifest_response: Option<(Vec<u8>, Option<String>)>,
    /// Catalog response per catalog_id.  `Ok(bytes)` → success, `Err` → failure.
    pub catalog_response: Result<Vec<u8>, DownloadError>,
    /// Whether `fetch_manifest` should return an error.
    pub manifest_error: Option<DownloadError>,
}

impl FakeFetcher {
    /// Construct a fetcher that returns a successful manifest and catalog.
    #[must_use]
    pub fn success(manifest_bytes: Vec<u8>, catalog_bytes: Vec<u8>) -> Self {
        Self {
            manifest_response: Some((manifest_bytes, Some("\"etag-abc\"".to_owned()))),
            catalog_response: Ok(catalog_bytes),
            manifest_error: None,
        }
    }

    /// Construct a fetcher that returns 304 Not Modified.
    #[must_use]
    pub fn not_modified() -> Self {
        Self { manifest_response: None, catalog_response: Ok(vec![]), manifest_error: None }
    }

    /// Construct a fetcher that fails on manifest fetch.
    #[must_use]
    pub fn manifest_error(err: DownloadError) -> Self {
        Self { manifest_response: None, catalog_response: Ok(vec![]), manifest_error: Some(err) }
    }

    /// Construct a fetcher that fails on catalog download.
    #[must_use]
    pub fn catalog_error(manifest_bytes: Vec<u8>, err: DownloadError) -> Self {
        Self {
            manifest_response: Some((manifest_bytes, None)),
            catalog_response: Err(err),
            manifest_error: None,
        }
    }
}

#[async_trait::async_trait]
impl CatalogFetcher for FakeFetcher {
    async fn fetch_manifest(
        &self,
        _url: &str,
        _etag: Option<&str>,
    ) -> Result<Option<(Vec<u8>, Option<String>)>, DownloadError> {
        if let Some(ref err) = self.manifest_error {
            return Err(err.clone());
        }
        Ok(self.manifest_response.clone())
    }

    async fn fetch_catalog(
        &self,
        _url: &str,
        _progress: &mut (dyn FnMut(u64, u64) + Send),
    ) -> Result<Vec<u8>, DownloadError> {
        self.catalog_response.clone()
    }
}

// ── Manifest parsing ──────────────────────────────────────────────────────────

/// Parse raw manifest bytes into a [`Manifest`].
///
/// The manifest is expected to be JSON (v1 format). After parsing, the
/// signature in the `signature` field is NOT verified here — verification
/// requires the trusted public key and is done in [`fetch_manifest`] after
/// parsing. Callers that bypass `fetch_manifest` MUST call
/// [`verify_minisign_signature`] themselves.
///
/// # Errors
///
/// Returns [`DownloadError::ManifestFetchFailed`] when the bytes cannot be
/// parsed as a valid manifest.
pub fn parse_manifest(bytes: &[u8]) -> Result<Manifest, DownloadError> {
    serde_json::from_slice(bytes)
        .map_err(|e| DownloadError::ManifestFetchFailed(format!("manifest parse error: {e}")))
}

// ── High-level fetch + download functions ──────────────────────────────────────

/// Fetch the manifest using the provided fetcher, verify its minisign
/// signature, and validate all entry license codes and catalog slugs.
///
/// Returns a [`ManifestFetchResult`] describing whether the manifest was newly
/// downloaded, unchanged (ETag matched), or failed.
///
/// Verification steps (all must pass before accepting):
/// 1. JSON parse.
/// 2. Minisign signature verification against `trusted_pk_box` (FR-026).
/// 3. All entry license codes in the recognised closed set (FR-027).
/// 4. All catalog slugs in the v1 closed enum (FR-029).
///
/// Emits `DownloadEvent::ManifestFetched` via `on_event` on success.
pub async fn fetch_manifest<F, E>(
    fetcher: &F,
    url: &str,
    etag: Option<&str>,
    trusted_pk_box: &str,
    mut on_event: E,
) -> ManifestFetchResult
where
    F: CatalogFetcher,
    E: FnMut(DownloadEvent),
{
    match fetcher.fetch_manifest(url, etag).await {
        Err(e) => ManifestFetchResult::Failed(e),
        Ok(None) => ManifestFetchResult::NotModified,
        Ok(Some((bytes, server_etag))) => match parse_manifest(&bytes) {
            Err(e) => ManifestFetchResult::Failed(e),
            Ok(manifest) => {
                // Step 1: verify minisign signature (FR-026, T068).
                let signed_data = match manifest_signed_bytes(&manifest.catalogs) {
                    Ok(b) => b,
                    Err(e) => return ManifestFetchResult::Failed(e),
                };
                if let Err(e) =
                    verify_minisign_signature(trusted_pk_box, &manifest.signature, &signed_data)
                {
                    return ManifestFetchResult::Failed(e);
                }

                // Step 2: validate license codes — hard-fail unknown (FR-027, T069).
                for entry in &manifest.catalogs {
                    if let Err(e) = entry.parse_license() {
                        return ManifestFetchResult::Failed(e);
                    }
                }

                // Step 3: validate catalog slugs — hard-fail unknown (FR-029, T070).
                for entry in &manifest.catalogs {
                    if let Err(e) = entry.validate_slug() {
                        return ManifestFetchResult::Failed(e);
                    }
                }

                on_event(DownloadEvent::ManifestFetched { catalog_count: manifest.catalogs.len() });
                ManifestFetchResult::Fetched { manifest, etag: server_etag }
            }
        },
    }
}

/// Download and verify a single catalog using the provided fetcher.
///
/// 1. Looks up the `catalog_id` in the provided `manifest`.
/// 2. Emits `DownloadEvent::Started`.
/// 3. Downloads catalog bytes, emitting `DownloadEvent::Progress`.
/// 4. Verifies SHA-256 checksum.
/// 5. On success, emits `DownloadEvent::Completed` and returns
///    `CatalogDownloadResult::Success`.
/// 6. On failure, emits `DownloadEvent::Failed` and returns
///    `CatalogDownloadResult::Failure`.
pub async fn download_catalog<F, E>(
    fetcher: &F,
    manifest: &Manifest,
    catalog_id: &str,
    audit_id: String,
    mut on_event: E,
) -> CatalogDownloadResult
where
    F: CatalogFetcher,
    E: FnMut(DownloadEvent) + Send,
{
    // Find the catalog in the manifest.
    // The None branch emits an event + returns early; let...else can't model that cleanly.
    #[allow(clippy::manual_let_else, clippy::single_match_else)]
    let entry = match manifest.catalogs.iter().find(|e| e.catalog_id == catalog_id) {
        Some(e) => e,
        None => {
            let err = DownloadError::CatalogNotInManifest(catalog_id.to_owned());
            on_event(DownloadEvent::Failed {
                catalog_id: catalog_id.to_owned(),
                error_code: err.error_code().to_owned(),
                message: err.to_string(),
            });
            return CatalogDownloadResult::Failure(err);
        }
    };

    on_event(DownloadEvent::Started { catalog_id: catalog_id.to_owned() });

    let expected_size = entry.size_bytes;
    let catalog_id_owned = catalog_id.to_owned();
    let url = entry.url.clone();
    let checksum = entry.checksum.clone();

    // Download bytes.
    let bytes = {
        let catalog_id_for_progress = catalog_id_owned.clone();
        // We need a reference to on_event but it is FnMut — capture via a local.
        let mut progress_emitter = |recv: u64, total: u64| {
            on_event(DownloadEvent::Progress {
                catalog_id: catalog_id_for_progress.clone(),
                bytes_received: recv,
                bytes_total: total,
            });
        };
        match fetcher.fetch_catalog(&url, &mut progress_emitter).await {
            Ok(b) => b,
            Err(e) => {
                on_event(DownloadEvent::Failed {
                    catalog_id: catalog_id_owned,
                    error_code: e.error_code().to_owned(),
                    message: e.to_string(),
                });
                return CatalogDownloadResult::Failure(e);
            }
        }
    };

    // Verify checksum.
    if let Err(e) = verify_sha256(&bytes, &checksum) {
        on_event(DownloadEvent::Failed {
            catalog_id: catalog_id_owned,
            error_code: e.error_code().to_owned(),
            message: e.to_string(),
        });
        return CatalogDownloadResult::Failure(e);
    }

    let _ = expected_size; // used for progress; bytes verified by checksum.

    on_event(DownloadEvent::Completed { catalog_id: catalog_id_owned, audit_id: audit_id.clone() });

    CatalogDownloadResult::Success { audit_id }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use minisign::KeyPair;

    // ── Test keypair helpers ───────────────────────────────────────────────

    /// Generate a fresh unencrypted keypair for test use.
    fn test_keypair() -> KeyPair {
        KeyPair::generate_unencrypted_keypair().expect("keypair generation failed")
    }

    /// Produce the public key box string for a test keypair.
    fn pk_box_string(kp: &KeyPair) -> String {
        kp.pk.to_box().expect("pk to_box failed").to_string()
    }

    /// Sign `data` with the secret key from `kp` and return the signature box
    /// string.
    fn sign_data(kp: &KeyPair, data: &[u8]) -> String {
        let sig_box = minisign::sign(None, &kp.sk, std::io::Cursor::new(data), None, None)
            .expect("sign failed");
        sig_box.into_string()
    }

    fn make_entry(catalog_id: &str, checksum: &str, license: &str) -> ManifestEntry {
        ManifestEntry {
            catalog_id: catalog_id.into(),
            version: "1.0.0".into(),
            url: "https://example.com/catalog.json".into(),
            checksum: checksum.into(),
            license: license.into(),
            size_bytes: 1024,
        }
    }

    fn sha256_of(bytes: &[u8]) -> String {
        use sha2::Digest;
        let mut hasher = sha2::Sha256::new();
        hasher.update(bytes);
        hex::encode(hasher.finalize())
    }

    // ── T064: minisign signature verification ─────────────────────────────

    /// T064-a: valid minisign signature is accepted (FR-026, D5).
    #[test]
    fn valid_minisign_signature_is_accepted() {
        let kp = test_keypair();
        let pk_str = pk_box_string(&kp);
        let data = b"catalog data bytes to sign";
        let sig_str = sign_data(&kp, data);
        assert!(
            verify_minisign_signature(&pk_str, &sig_str, data).is_ok(),
            "valid signature must be accepted"
        );
    }

    /// T064-b: tampered data is rejected with ManifestSignatureInvalid (FR-026).
    #[test]
    fn tampered_data_rejected_with_signature_invalid() {
        let kp = test_keypair();
        let pk_str = pk_box_string(&kp);
        let original_data = b"catalog data bytes to sign";
        let sig_str = sign_data(&kp, original_data);

        // Tamper: flip one byte.
        let tampered = b"catalog data bytes to sign!";
        let result = verify_minisign_signature(&pk_str, &sig_str, tampered);
        assert!(
            matches!(result, Err(DownloadError::ManifestSignatureInvalid(_))),
            "tampered data must be rejected: {result:?}"
        );
    }

    /// T064-c: invalid signature string is rejected (FR-026).
    #[test]
    fn invalid_signature_string_rejected() {
        let kp = test_keypair();
        let pk_str = pk_box_string(&kp);
        let data = b"some data";
        let result = verify_minisign_signature(&pk_str, "not-a-valid-sig-box", data);
        assert!(
            matches!(result, Err(DownloadError::ManifestSignatureInvalid(_))),
            "invalid sig box string must be rejected: {result:?}"
        );
    }

    /// T064-d: wrong key is rejected (FR-026).
    #[test]
    fn signature_from_different_key_rejected() {
        let kp1 = test_keypair();
        let kp2 = test_keypair();
        let pk_str = pk_box_string(&kp2); // pk from kp2
        let data = b"data signed by kp1";
        let sig_str = sign_data(&kp1, data); // signed by kp1
        let result = verify_minisign_signature(&pk_str, &sig_str, data);
        assert!(
            matches!(result, Err(DownloadError::ManifestSignatureInvalid(_))),
            "signature from wrong key must be rejected: {result:?}"
        );
    }

    // ── T065: unknown license code hard-fails (FR-027) ────────────────────

    /// T065-a: unknown license code hard-fails (no PublicDomain downgrade).
    #[test]
    fn unknown_license_code_hard_fails() {
        let entry = make_entry("messier", "abc", "gpl-3.0");
        let result = entry.parse_license();
        assert!(
            matches!(result, Err(DownloadError::UnknownLicenseCode(ref s)) if s == "gpl-3.0"),
            "unknown license must hard-fail: {result:?}"
        );
    }

    /// T065-b: empty license code hard-fails.
    #[test]
    fn empty_license_code_hard_fails() {
        let entry = make_entry("messier", "abc", "");
        let result = entry.parse_license();
        assert!(
            matches!(result, Err(DownloadError::UnknownLicenseCode(_))),
            "empty license must hard-fail: {result:?}"
        );
    }

    /// T065-c: all recognised license codes succeed.
    #[test]
    fn recognised_license_codes_succeed() {
        for code in [
            "public-domain",
            "apache-2.0",
            "mit",
            "cc0-1.0",
            "cc-by-4.0",
            "cc-by-sa-4.0",
            "hyperleda",
            "esa-free",
        ] {
            let entry = make_entry("messier", "abc", code);
            assert!(entry.parse_license().is_ok(), "license '{code}' must be recognised");
        }
    }

    // ── T066: catalog slug validation (FR-029, D3) ────────────────────────

    /// T066-a: unknown slug is rejected (no silent Unknown skip).
    #[test]
    fn unknown_slug_rejected() {
        let entry = make_entry("opengc", "abc", "cc-by-sa-4.0"); // typo slug
        let result = entry.validate_slug();
        assert!(
            matches!(result, Err(DownloadError::UnknownCatalogSlug(ref s)) if s == "opengc"),
            "unknown slug must be rejected: {result:?}"
        );
    }

    /// T066-b: canonical slugs resolve without error.
    #[test]
    fn canonical_slugs_resolve() {
        for slug in ["common", "openngc", "abell_pn", "messier", "caldwell"] {
            let entry = make_entry(slug, "abc", "public-domain");
            assert!(
                entry.validate_slug().is_ok(),
                "canonical slug '{slug}' must resolve: {:?}",
                entry.validate_slug()
            );
        }
    }

    /// T066-c: corrected slug openngc resolves; old typo opengc does not.
    #[test]
    fn openngc_resolves_opengc_does_not() {
        let good = make_entry("openngc", "abc", "cc-by-sa-4.0");
        assert!(good.validate_slug().is_ok(), "openngc must resolve");

        let bad = make_entry("opengc", "abc", "cc-by-sa-4.0");
        assert!(
            matches!(bad.validate_slug(), Err(DownloadError::UnknownCatalogSlug(_))),
            "opengc (typo) must be rejected"
        );
    }

    // ── T067: atomic upsert — tested in persistence crate (catalogs.rs tests) ──
    // The atomicity property (interrupted upsert leaves no partial row) is
    // verified by the persistence-layer test
    // `upsert_catalog_and_attribution_is_atomic` in
    // `crates/persistence/db/src/repositories/catalogs.rs`.

    // ── Checksum tests ────────────────────────────────────────────────────

    #[test]
    fn verify_sha256_passes_correct_checksum() {
        let data = b"hello catalog";
        let hex = sha256_of(data);
        assert!(verify_sha256(data, &hex).is_ok());
    }

    #[test]
    fn verify_sha256_fails_on_mismatch() {
        let data = b"hello catalog";
        let result = verify_sha256(data, "deadbeef");
        assert!(matches!(result, Err(DownloadError::ChecksumMismatch { .. })));
    }

    // ── Manifest parsing tests ────────────────────────────────────────────

    #[test]
    fn parse_manifest_rejects_invalid_json() {
        let result = parse_manifest(b"not json");
        assert!(matches!(result, Err(DownloadError::ManifestFetchFailed(_))));
    }

    #[test]
    fn parse_manifest_accepts_valid_json() {
        let manifest = serde_json::json!({
            "version": "1.0.0",
            "signature": "abc",
            "catalogs": [{
                "catalogId": "messier",
                "version": "1.0.0",
                "url": "https://example.com/messier.json",
                "checksum": "abc123",
                "license": "public-domain",
                "sizeBytes": 1024
            }]
        });
        let bytes = serde_json::to_vec(&manifest).unwrap();
        let result = parse_manifest(&bytes).unwrap();
        assert_eq!(result.catalogs.len(), 1);
        assert_eq!(result.catalogs[0].catalog_id, "messier");
    }

    // ── fetch_manifest with real signature verification ───────────────────

    /// Build a correctly signed manifest JSON for use in fetch_manifest tests.
    fn build_signed_manifest_bytes(kp: &KeyPair, entries: Vec<ManifestEntry>) -> (Vec<u8>, String) {
        let signed_bytes = manifest_signed_bytes(&entries).unwrap();
        let sig_str = sign_data(kp, &signed_bytes);
        let manifest =
            Manifest { version: "1.0.0".into(), signature: sig_str.clone(), catalogs: entries };
        (serde_json::to_vec(&manifest).unwrap(), sig_str)
    }

    #[tokio::test]
    async fn fetch_manifest_returns_not_modified_on_304() {
        let fetcher = FakeFetcher::not_modified();
        let kp = test_keypair();
        let pk_str = pk_box_string(&kp);
        let mut events = Vec::new();
        let result = fetch_manifest(
            &fetcher,
            "https://example.com/manifest.json",
            Some("\"etag\""),
            &pk_str,
            |e| {
                events.push(e);
            },
        )
        .await;
        assert_eq!(result, ManifestFetchResult::NotModified);
        assert!(events.is_empty());
    }

    #[tokio::test]
    async fn fetch_manifest_verifies_valid_signature_and_emits_fetched_event() {
        let kp = test_keypair();
        let pk_str = pk_box_string(&kp);
        let entries = vec![make_entry("messier", "abc123", "public-domain")];
        let (manifest_bytes, _) = build_signed_manifest_bytes(&kp, entries);

        let fetcher = FakeFetcher::success(manifest_bytes, vec![]);
        let mut events = Vec::new();
        let result =
            fetch_manifest(&fetcher, "https://example.com/manifest.json", None, &pk_str, |e| {
                events.push(e);
            })
            .await;
        assert!(
            matches!(result, ManifestFetchResult::Fetched { .. }),
            "expected Fetched: {result:?}"
        );
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], DownloadEvent::ManifestFetched { catalog_count: 1 }));
    }

    #[tokio::test]
    async fn fetch_manifest_rejects_tampered_manifest() {
        let kp = test_keypair();
        let pk_str = pk_box_string(&kp);
        let entries = vec![make_entry("messier", "abc123", "public-domain")];
        let (mut manifest_bytes, _) = build_signed_manifest_bytes(&kp, entries);

        // Tamper: modify a byte in the manifest JSON.
        let last = manifest_bytes.last_mut().unwrap();
        *last = if *last == b'}' { b'X' } else { b'}' };

        let fetcher = FakeFetcher::success(manifest_bytes, vec![]);
        let mut events = Vec::new();
        let result =
            fetch_manifest(&fetcher, "https://example.com/manifest.json", None, &pk_str, |e| {
                events.push(e);
            })
            .await;
        // Either parse failure or signature failure — both are ManifestFetchFailed
        // or ManifestSignatureInvalid; key point is it must NOT be Fetched.
        assert!(
            !matches!(result, ManifestFetchResult::Fetched { .. }),
            "tampered manifest must not be accepted: {result:?}"
        );
    }

    #[tokio::test]
    async fn fetch_manifest_rejects_wrong_trusted_key() {
        let kp1 = test_keypair();
        let kp2 = test_keypair();
        let pk_str = pk_box_string(&kp2); // trust kp2's key
        let entries = vec![make_entry("messier", "abc123", "public-domain")];
        let (manifest_bytes, _) = build_signed_manifest_bytes(&kp1, entries); // signed by kp1

        let fetcher = FakeFetcher::success(manifest_bytes, vec![]);
        let mut events = Vec::new();
        let result =
            fetch_manifest(&fetcher, "https://example.com/manifest.json", None, &pk_str, |e| {
                events.push(e);
            })
            .await;
        assert!(
            matches!(
                result,
                ManifestFetchResult::Failed(DownloadError::ManifestSignatureInvalid(_))
            ),
            "wrong key must be rejected: {result:?}"
        );
    }

    #[tokio::test]
    async fn fetch_manifest_rejects_unknown_license_code() {
        let kp = test_keypair();
        let pk_str = pk_box_string(&kp);
        let entries = vec![make_entry("messier", "abc123", "gpl-3.0")];
        let (manifest_bytes, _) = build_signed_manifest_bytes(&kp, entries);

        let fetcher = FakeFetcher::success(manifest_bytes, vec![]);
        let mut events = Vec::new();
        let result =
            fetch_manifest(&fetcher, "https://example.com/manifest.json", None, &pk_str, |e| {
                events.push(e);
            })
            .await;
        assert!(
            matches!(result, ManifestFetchResult::Failed(DownloadError::UnknownLicenseCode(_))),
            "unknown license must hard-fail: {result:?}"
        );
    }

    #[tokio::test]
    async fn fetch_manifest_rejects_unknown_catalog_slug() {
        let kp = test_keypair();
        let pk_str = pk_box_string(&kp);
        let entries = vec![make_entry("opengc", "abc123", "cc-by-sa-4.0")]; // typo slug
        let (manifest_bytes, _) = build_signed_manifest_bytes(&kp, entries);

        let fetcher = FakeFetcher::success(manifest_bytes, vec![]);
        let mut events = Vec::new();
        let result =
            fetch_manifest(&fetcher, "https://example.com/manifest.json", None, &pk_str, |e| {
                events.push(e);
            })
            .await;
        assert!(
            matches!(result, ManifestFetchResult::Failed(DownloadError::UnknownCatalogSlug(_))),
            "unknown slug must hard-fail: {result:?}"
        );
    }

    #[tokio::test]
    async fn fetch_manifest_returns_failed_on_error() {
        let kp = test_keypair();
        let pk_str = pk_box_string(&kp);
        let fetcher =
            FakeFetcher::manifest_error(DownloadError::NetworkUnavailable("timeout".into()));
        let mut events = Vec::new();
        let result =
            fetch_manifest(&fetcher, "https://example.com/manifest.json", None, &pk_str, |e| {
                events.push(e);
            })
            .await;
        assert!(matches!(
            result,
            ManifestFetchResult::Failed(DownloadError::NetworkUnavailable(_))
        ));
    }

    // ── FakeFetcher + download_catalog tests ──────────────────────────────

    fn make_manifest_for_download(catalog_id: &str, checksum: &str) -> Manifest {
        Manifest {
            version: "1.0.0".into(),
            signature: "fake-sig-download-test".into(),
            catalogs: vec![make_entry(catalog_id, checksum, "public-domain")],
        }
    }

    #[tokio::test]
    async fn download_catalog_succeeds_with_correct_checksum() {
        let data = b"catalog data bytes";
        let checksum = sha256_of(data);
        let manifest = make_manifest_for_download("messier", &checksum);
        let manifest_bytes = serde_json::to_vec(&serde_json::json!({
            "version": "1.0.0", "signature": "abc", "catalogs": []
        }))
        .unwrap();
        let fetcher = FakeFetcher::success(manifest_bytes, data.to_vec());

        let mut events = Vec::new();
        let result = download_catalog(&fetcher, &manifest, "messier", "audit-123".into(), |e| {
            events.push(e);
        })
        .await;

        assert!(
            matches!(result, CatalogDownloadResult::Success { audit_id } if audit_id == "audit-123")
        );
        // Expect: Started, Progress, Completed
        assert!(events.iter().any(
            |e| matches!(e, DownloadEvent::Started { catalog_id } if catalog_id == "messier")
        ));
        assert!(events.iter().any(
            |e| matches!(e, DownloadEvent::Completed { catalog_id, .. } if catalog_id == "messier")
        ));
    }

    #[tokio::test]
    async fn download_catalog_fails_on_checksum_mismatch() {
        let manifest = make_manifest_for_download("messier", "wrongchecksum");
        let manifest_bytes = serde_json::to_vec(&serde_json::json!({
            "version": "1.0.0", "signature": "abc", "catalogs": []
        }))
        .unwrap();
        let fetcher = FakeFetcher::success(manifest_bytes, b"catalog data bytes".to_vec());

        let mut events = Vec::new();
        let result = download_catalog(&fetcher, &manifest, "messier", "audit-456".into(), |e| {
            events.push(e);
        })
        .await;

        assert!(matches!(
            result,
            CatalogDownloadResult::Failure(DownloadError::ChecksumMismatch { .. })
        ));
        assert!(events.iter().any(|e| matches!(e, DownloadEvent::Failed { .. })));
    }

    #[tokio::test]
    async fn download_catalog_fails_when_catalog_not_in_manifest() {
        let manifest =
            Manifest { version: "1.0.0".into(), signature: "abc".into(), catalogs: vec![] };
        let fetcher = FakeFetcher::success(vec![], vec![]);
        let mut events = Vec::new();
        let result =
            download_catalog(&fetcher, &manifest, "nonexistent", "audit-789".into(), |e| {
                events.push(e);
            })
            .await;

        assert!(matches!(
            result,
            CatalogDownloadResult::Failure(DownloadError::CatalogNotInManifest(_))
        ));
    }

    #[tokio::test]
    async fn download_catalog_emits_failed_on_fetch_error() {
        let data = b"catalog data bytes";
        let checksum = sha256_of(data);
        let manifest = make_manifest_for_download("messier", &checksum);
        let manifest_bytes = vec![];
        let fetcher = FakeFetcher::catalog_error(
            manifest_bytes,
            DownloadError::NetworkUnavailable("no network".into()),
        );

        let mut events = Vec::new();
        let result = download_catalog(&fetcher, &manifest, "messier", "audit-000".into(), |e| {
            events.push(e);
        })
        .await;

        assert!(matches!(
            result,
            CatalogDownloadResult::Failure(DownloadError::NetworkUnavailable(_))
        ));
        assert!(events.iter().any(|e| matches!(e, DownloadEvent::Failed { .. })));
    }

    // ── Error code tests ──────────────────────────────────────────────────

    #[test]
    fn error_codes_match_contract() {
        assert_eq!(
            DownloadError::ManifestFetchFailed("x".into()).error_code(),
            "manifest.fetch_failed"
        );
        assert_eq!(
            DownloadError::ManifestSignatureInvalid("x".into()).error_code(),
            "manifest.signature_invalid"
        );
        assert_eq!(DownloadError::ManifestNotFetched.error_code(), "manifest.not_fetched");
        assert_eq!(
            DownloadError::CatalogNotInManifest("x".into()).error_code(),
            "catalog.not_in_manifest"
        );
        assert_eq!(
            DownloadError::CatalogFetchFailed("x".into()).error_code(),
            "catalog.fetch_failed"
        );
        assert_eq!(
            DownloadError::ChecksumMismatch { expected: "a".into(), actual: "b".into() }
                .error_code(),
            "catalog.checksum_mismatch"
        );
        assert_eq!(DownloadError::InstallFailed("x".into()).error_code(), "catalog.install_failed");
        assert_eq!(
            DownloadError::NetworkUnavailable("x".into()).error_code(),
            "network.unavailable"
        );
        assert_eq!(DownloadError::OriginNotImplemented.error_code(), "origin.not_implemented");
        assert_eq!(
            DownloadError::UnknownLicenseCode("gpl-3.0".into()).error_code(),
            "manifest.unknown_license_code"
        );
        assert_eq!(
            DownloadError::UnknownCatalogSlug("opengc".into()).error_code(),
            "manifest.unknown_catalog_slug"
        );
    }

    // ── manifest_signed_bytes ─────────────────────────────────────────────

    #[test]
    fn manifest_signed_bytes_is_deterministic() {
        let entries = vec![make_entry("messier", "abc", "public-domain")];
        let b1 = manifest_signed_bytes(&entries).unwrap();
        let b2 = manifest_signed_bytes(&entries).unwrap();
        assert_eq!(b1, b2);
        assert!(!b1.is_empty());
    }
}
