//! Catalog contract DTOs for spec 014 — Catalog Index Licensing.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks
//!
//! These types map to the four JSON-Schema contracts in
//! `specs/014-catalog-index-licensing/contracts/`:
//!
//! - `catalog.list.json`            → [`CatalogListResponse`]
//! - `catalog.attribution.get.json` → [`CatalogAttributionGetResponse`]
//! - `catalog.manifest.fetch.json`  → [`CatalogManifestFetchResponse`]
//! - `catalog.download.json`        → [`CatalogDownloadResponse`]

use serde::{Deserialize, Serialize};
use specta::Type;

// ── Shared types ──────────────────────────────────────────────────────────────

/// Stable catalog slug identifier (e.g. `"messier"`, `"ngc"`, `"opengc"`).
pub type CatalogId = String;

/// Closed enum of catalog origins (R-1.3).
///
/// - `downloaded`: all v1 catalogs, installed from the project-hosted manifest.
/// - `built_in`: reserved for forward-compat; unused in v1.
/// - `user`: reserved for v1.x; backend rejects with `origin.not_implemented`.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum CatalogOrigin {
    BuiltIn,
    Downloaded,
    User,
}

/// Registered catalog index visible to the app (data-model.md §Catalog).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    /// Stable slug identifier.
    pub id: CatalogId,
    /// Human-readable display name.
    pub name: String,
    /// Bundle version string.
    pub version: String,
    /// License short code (closed enum string, e.g. `"public-domain"`).
    pub license: String,
    /// Origin of this catalog record.
    pub origin: CatalogOrigin,
    /// Upstream source URL.
    pub source_url: String,
    /// RFC 3339 UTC timestamp of the last bundle update.
    pub last_updated: String,
    /// Number of entries in this catalog index (optional).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry_count: Option<i64>,
}

/// Per-catalog license attribution record (data-model.md §LicenseAttribution).
///
/// For `cc-by-4.0` and `cc-by-sa-4.0` licenses, `author`, `title`, and
/// `license_uri` are required (R-2.2).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LicenseAttribution {
    /// FK to `Catalog.id`.
    pub catalog_id: CatalogId,
    /// License short code.
    pub license: String,
    /// Full required notice text, verbatim.
    pub text: String,
    /// Stable source link referenced by the notice.
    pub link: String,
    /// Date the source was accessed (ISO 8601). Optional.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accessed_on: Option<String>,
    /// Author / rights-holder. Required for CC-BY and CC-BY-SA (R-2.2).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    /// Work title. Required for CC-BY and CC-BY-SA (R-2.2).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Canonical license URI. Required for CC-BY and CC-BY-SA (R-2.2).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license_uri: Option<String>,
    /// Nature of any project-made modifications (optional).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modifications_notice: Option<String>,
}

/// Per-catalog entry in the signed manifest.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ManifestCatalogEntry {
    /// Stable catalog slug.
    pub catalog_id: CatalogId,
    /// Semver-ish version string.
    pub version: String,
    /// GitHub Releases download URL.
    pub url: String,
    /// SHA-256 hex checksum.
    pub checksum: String,
    /// License short code.
    pub license: String,
    /// Uncompressed size in bytes (for progress estimation).
    pub size_bytes: u64,
}

/// The signed manifest returned on a successful `catalog.manifest.fetch`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CatalogManifest {
    /// Manifest schema version.
    pub version: String,
    /// Minisign signature (base64-encoded).
    pub signature: String,
    /// Catalog entries.
    pub catalogs: Vec<ManifestCatalogEntry>,
}

// ── catalog.list ─────────────────────────────────────────────────────────────

/// Request for `catalog.list`.
///
/// Empty in v1 — returns all registered catalogs.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CatalogListRequest {}

/// Response for `catalog.list`.
///
/// Catalogs are ordered by origin (`downloaded` first) then by name.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CatalogListResponse {
    /// All registered catalogs.
    pub catalogs: Vec<Catalog>,
}

// ── catalog.attribution.get ───────────────────────────────────────────────────

/// Request for `catalog.attribution.get`.
///
/// Empty in v1 — returns attributions for all registered catalogs.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CatalogAttributionGetRequest {}

/// Response for `catalog.attribution.get`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CatalogAttributionGetResponse {
    /// Per-catalog attribution rows. One catalog may produce multiple rows.
    pub attributions: Vec<LicenseAttribution>,
}

// ── catalog.manifest.fetch ────────────────────────────────────────────────────

/// Request for `catalog.manifest.fetch` (R-1.4).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CatalogManifestFetchRequest {
    /// Optional ETag from a prior successful fetch (enables HTTP 304
    /// conditional requests).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
}

/// Status of a `catalog.manifest.fetch` response.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum ManifestFetchStatus {
    /// New manifest downloaded and verified.
    Fetched,
    /// ETag matched; local manifest is current (HTTP 304).
    NotModified,
    /// Network or verification failure.
    Failed,
}

/// Response for `catalog.manifest.fetch`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CatalogManifestFetchResponse {
    pub status: ManifestFetchStatus,
    /// Present when `status = fetched`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest: Option<CatalogManifest>,
    /// ETag for the next conditional request.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
    /// Present when `status = failed`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<CatalogError>,
}

// ── catalog.download ──────────────────────────────────────────────────────────

/// Request for `catalog.download` (R-1.4).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDownloadRequest {
    /// Stable catalog slug matching a `catalog_id` in the cached manifest.
    pub catalog_id: CatalogId,
}

/// Status of a `catalog.download` response.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum CatalogDownloadStatus {
    /// Catalog fetched, signature verified, installed into SQLite.
    Success,
    /// Failure; previously installed catalog (if any) remains active.
    Failure,
}

/// Response for `catalog.download`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDownloadResponse {
    pub status: CatalogDownloadStatus,
    /// Audit event id on successful install.  Present when `status = success`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audit_id: Option<String>,
    /// Present when `status = failure`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<CatalogError>,
}

// ── Shared error type ─────────────────────────────────────────────────────────

/// Error envelope for catalog operations.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CatalogError {
    /// Contract error code (closed enum from the contract schemas).
    pub code: String,
    /// Human-readable message.
    pub message: String,
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_origin_serialises_as_snake_case() {
        assert_eq!(
            serde_json::to_value(CatalogOrigin::Downloaded).unwrap(),
            serde_json::json!("downloaded")
        );
        assert_eq!(
            serde_json::to_value(CatalogOrigin::BuiltIn).unwrap(),
            serde_json::json!("built_in")
        );
        assert_eq!(serde_json::to_value(CatalogOrigin::User).unwrap(), serde_json::json!("user"));
    }

    #[test]
    fn manifest_fetch_status_serialises() {
        assert_eq!(
            serde_json::to_value(ManifestFetchStatus::NotModified).unwrap(),
            serde_json::json!("not_modified")
        );
    }

    #[test]
    fn catalog_download_status_serialises() {
        assert_eq!(
            serde_json::to_value(CatalogDownloadStatus::Success).unwrap(),
            serde_json::json!("success")
        );
        assert_eq!(
            serde_json::to_value(CatalogDownloadStatus::Failure).unwrap(),
            serde_json::json!("failure")
        );
    }

    #[test]
    fn catalog_list_response_roundtrip() {
        let resp = CatalogListResponse {
            catalogs: vec![Catalog {
                id: "messier".into(),
                name: "Messier".into(),
                version: "1.0.0".into(),
                license: "public-domain".into(),
                origin: CatalogOrigin::Downloaded,
                source_url: "https://messier.seds.org".into(),
                last_updated: "2026-01-01T00:00:00Z".into(),
                entry_count: Some(110),
            }],
        };
        let json = serde_json::to_value(&resp).unwrap();
        let de: CatalogListResponse = serde_json::from_value(json).unwrap();
        assert_eq!(de.catalogs[0].id, "messier");
        assert_eq!(de.catalogs[0].origin, CatalogOrigin::Downloaded);
    }

    #[test]
    fn license_attribution_skips_none_fields() {
        let attr = LicenseAttribution {
            catalog_id: "messier".into(),
            license: "public-domain".into(),
            text: "Verified: public domain.".into(),
            link: "https://messier.seds.org".into(),
            accessed_on: None,
            author: None,
            title: None,
            license_uri: None,
            modifications_notice: None,
        };
        let json = serde_json::to_value(&attr).unwrap();
        // Optional None fields should not appear in serialised JSON.
        assert!(json.get("author").is_none());
        assert!(json.get("title").is_none());
        assert!(json.get("licenseUri").is_none());
    }
}
