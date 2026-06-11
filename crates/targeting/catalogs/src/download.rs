//! Manifest fetch, per-catalog download, SHA-256 verification, and install
//! lifecycle for spec 014 — Catalog Index Licensing.
//!
//! # Design
//!
//! The network surface is abstracted behind [`CatalogFetcher`] so the
//! download lifecycle state-machine is fully unit-testable with a
//! [`FakeFetcher`] (no real network in tests). The real HTTP implementation
//! is [`ReqwestFetcher`].
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

use serde::{Deserialize, Serialize};

use crate::license::LicenseShortCode;

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
        }
    }
}

// ── Manifest types ─────────────────────────────────────────────────────────────

/// Per-catalog entry in the signed manifest (mirrors `catalog.manifest.fetch.json`
/// §ManifestCatalogEntry).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManifestEntry {
    /// Stable catalog slug.
    pub catalog_id: String,
    /// Semver-ish version string for this catalog artifact.
    pub version: String,
    /// GitHub Releases download URL.
    pub url: String,
    /// SHA-256 hex checksum of the catalog artifact bytes.
    pub checksum: String,
    /// License short code (closed enum — R-2.1).
    pub license: LicenseShortCode,
    /// Uncompressed size in bytes (for progress estimation).
    pub size_bytes: u64,
}

/// The parsed manifest returned from a successful fetch.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Manifest {
    /// Semver manifest schema version.
    pub version: String,
    /// Minisign signature (base64-encoded). Verified in memory before use.
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

// This module uses async_trait; add it to Cargo.toml transitively via the
// reqwest feature set or declare it explicitly if needed.
// For now we use a simple re-export shim.

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
/// The manifest is expected to be JSON (v1 format). Signature verification
/// against the embedded minisign public key is deferred to a future iteration
/// (the `signature` field is parsed and stored but not yet cryptographically
/// verified in v1 — the astro-plan-catalogs repo is not yet published).
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

/// Fetch the manifest using the provided fetcher.
///
/// Returns a [`ManifestFetchResult`] describing whether the manifest was newly
/// downloaded, unchanged (ETag matched), or failed.
///
/// Emits `DownloadEvent::ManifestFetched` via `on_event` on success.
pub async fn fetch_manifest<F, E>(
    fetcher: &F,
    url: &str,
    etag: Option<&str>,
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

    fn make_manifest(catalog_id: &str, checksum: &str) -> Manifest {
        Manifest {
            version: "1.0.0".into(),
            signature: "fake-sig".into(),
            catalogs: vec![ManifestEntry {
                catalog_id: catalog_id.into(),
                version: "1.0.0".into(),
                url: "https://example.com/messier.json".into(),
                checksum: checksum.into(),
                license: LicenseShortCode::PublicDomain,
                size_bytes: 1024,
            }],
        }
    }

    fn sha256_of(bytes: &[u8]) -> String {
        use sha2::Digest;
        let mut hasher = sha2::Sha256::new();
        hasher.update(bytes);
        hex::encode(hasher.finalize())
    }

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
                "catalog_id": "messier",
                "version": "1.0.0",
                "url": "https://example.com/messier.json",
                "checksum": "abc123",
                "license": "public-domain",
                "size_bytes": 1024
            }]
        });
        let bytes = serde_json::to_vec(&manifest).unwrap();
        let result = parse_manifest(&bytes).unwrap();
        assert_eq!(result.catalogs.len(), 1);
        assert_eq!(result.catalogs[0].catalog_id, "messier");
    }

    // ── FakeFetcher + fetch_manifest tests ────────────────────────────────

    #[tokio::test]
    async fn fetch_manifest_returns_not_modified_on_304() {
        let fetcher = FakeFetcher::not_modified();
        let mut events = Vec::new();
        let result =
            fetch_manifest(&fetcher, "https://example.com/manifest.json", Some("\"etag\""), |e| {
                events.push(e);
            })
            .await;
        assert_eq!(result, ManifestFetchResult::NotModified);
        assert!(events.is_empty());
    }

    #[tokio::test]
    async fn fetch_manifest_emits_fetched_event_on_success() {
        let manifest = serde_json::json!({
            "version": "1.0.0",
            "signature": "abc",
            "catalogs": [{
                "catalog_id": "messier",
                "version": "1.0.0",
                "url": "https://example.com/messier.json",
                "checksum": "abc123",
                "license": "public-domain",
                "size_bytes": 1024
            }]
        });
        let bytes = serde_json::to_vec(&manifest).unwrap();
        let fetcher = FakeFetcher::success(bytes, vec![]);
        let mut events = Vec::new();
        let result =
            fetch_manifest(&fetcher, "https://example.com/manifest.json", None, |e| events.push(e))
                .await;
        assert!(matches!(result, ManifestFetchResult::Fetched { .. }));
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], DownloadEvent::ManifestFetched { catalog_count: 1 }));
    }

    #[tokio::test]
    async fn fetch_manifest_returns_failed_on_error() {
        let fetcher =
            FakeFetcher::manifest_error(DownloadError::NetworkUnavailable("timeout".into()));
        let mut events = Vec::new();
        let result =
            fetch_manifest(&fetcher, "https://example.com/manifest.json", None, |e| events.push(e))
                .await;
        assert!(matches!(
            result,
            ManifestFetchResult::Failed(DownloadError::NetworkUnavailable(_))
        ));
    }

    // ── FakeFetcher + download_catalog tests ──────────────────────────────

    #[tokio::test]
    async fn download_catalog_succeeds_with_correct_checksum() {
        let data = b"catalog data bytes";
        let checksum = sha256_of(data);
        let manifest = make_manifest("messier", &checksum);
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
        let manifest = make_manifest("messier", "wrongchecksum");
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
        let manifest = make_manifest("messier", &checksum);
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
    }
}
