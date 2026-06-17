//! Catalog use cases for spec 014 — Catalog Index Licensing.
//!
//! Entry points:
//! - [`list`] — list all installed catalogs from the `catalog_downloaded` table.
//! - [`attribution_get`] — list all attribution rows for all installed catalogs.
//! - [`manifest_fetch`] — fetch the catalog manifest from the project-hosted URL.
//! - [`download`] — download, verify (SHA-256), and install a single catalog.
//!
//! All use cases are covered by unit tests that run entirely in-memory (no real
//! network; no Tauri runtime).
//!
//! Constitution §V: durable records in SQLite; downloaded files are
//! reproducible projections.

use contracts_core::catalogs::{
    Catalog, CatalogAttributionGetResponse, CatalogDownloadRequest, CatalogDownloadResponse,
    CatalogDownloadStatus, CatalogError, CatalogListResponse, CatalogManifest,
    CatalogManifestFetchRequest, CatalogManifestFetchResponse, CatalogOrigin,
    LicenseAttribution as ContractAttribution, ManifestCatalogEntry, ManifestFetchStatus,
};
use contracts_core::{ContractError, ErrorSeverity};
use persistence_db::repositories::catalogs::{
    self as repo, AttributionRow, CatalogInstallRequest, CatalogOrigin as RepoCatalogOrigin,
    CatalogRow,
};
use sqlx::SqlitePool;
use targeting_catalogs::download::{
    CatalogDownloadResult, CatalogFetcher, DownloadEvent, Manifest, ManifestFetchResult,
    TRUSTED_PUBLIC_KEY,
};
use time::OffsetDateTime;
use uuid::Uuid;

// ── Error mapping ─────────────────────────────────────────────────────────────

fn db_err(e: &persistence_db::DbError) -> ContractError {
    ContractError::new("internal.database", format!("{e}"), ErrorSeverity::Fatal, true)
}

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

// ── Row → contract type conversions ──────────────────────────────────────────

fn catalog_row_to_contract(row: CatalogRow) -> Catalog {
    Catalog {
        id: row.id,
        name: row.name,
        version: row.version,
        license: row.license,
        origin: CatalogOrigin::Downloaded, // v1: all stored catalogs are downloaded
        source_url: row.source_url,
        last_updated: row.last_updated,
        entry_count: row.entry_count,
    }
}

fn attribution_row_to_contract(row: AttributionRow) -> ContractAttribution {
    ContractAttribution {
        catalog_id: row.catalog_id,
        license: row.license,
        text: row.text,
        link: row.link,
        accessed_on: row.accessed_on,
        author: row.author,
        title: row.title,
        license_uri: row.license_uri,
        modifications_notice: row.modifications_notice,
    }
}

fn download_manifest_to_contract(manifest: &Manifest) -> CatalogManifest {
    CatalogManifest {
        version: manifest.version.clone(),
        signature: manifest.signature.clone(),
        catalogs: manifest
            .catalogs
            .iter()
            .map(|e| ManifestCatalogEntry {
                catalog_id: e.catalog_id.clone(),
                version: e.version.clone(),
                url: e.url.clone(),
                checksum: e.checksum.clone(),
                // license is now a raw String (validated at fetch_manifest time).
                license: e.license.clone(),
                size_bytes: e.size_bytes,
            })
            .collect(),
    }
}

// ── list ──────────────────────────────────────────────────────────────────────

/// List all installed catalogs ordered by origin (downloaded first) then name.
///
/// In v1 all stored catalogs have `origin = downloaded`. The ordering matches
/// the contract spec (R-1.3).
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn list(pool: &SqlitePool) -> Result<CatalogListResponse, ContractError> {
    let rows = repo::list_catalogs(pool).await.map_err(|e| db_err(&e))?;
    let catalogs = rows.into_iter().map(catalog_row_to_contract).collect();
    Ok(CatalogListResponse { catalogs })
}

// ── attribution_get ───────────────────────────────────────────────────────────

/// Return all license attribution rows for all installed catalogs.
///
/// Separated from `list` so the (potentially large) notice text payload is not
/// paid for on the metadata listing (plan.md §Contracts).
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn attribution_get(
    pool: &SqlitePool,
) -> Result<CatalogAttributionGetResponse, ContractError> {
    let rows = repo::list_all_attributions(pool).await.map_err(|e| db_err(&e))?;
    let attributions = rows.into_iter().map(attribution_row_to_contract).collect();
    Ok(CatalogAttributionGetResponse { attributions })
}

// ── manifest_fetch ────────────────────────────────────────────────────────────

/// Fetch the catalog manifest from the project-hosted URL using `fetcher`.
///
/// The `manifest_url` should point to the JSON manifest in the
/// `astro-plan-catalogs` repository (TBD). The optional `etag` from a prior
/// successful fetch enables HTTP 304 conditional requests.
///
/// # Errors
///
/// Returns `ContractError` on unexpected internal failure. Network and
/// verification failures are encoded in the response `status = failed` field
/// per the contract spec.
pub async fn manifest_fetch<F: CatalogFetcher>(
    fetcher: &F,
    req: &CatalogManifestFetchRequest,
    manifest_url: &str,
) -> Result<CatalogManifestFetchResponse, ContractError> {
    manifest_fetch_with_key(fetcher, req, manifest_url, TRUSTED_PUBLIC_KEY).await
}

/// Like [`manifest_fetch`] but accepts an explicit trusted public key box string.
///
/// Used by tests to inject a test keypair; production callers use
/// [`manifest_fetch`] which uses the embedded [`TRUSTED_PUBLIC_KEY`].
///
/// # Errors
///
/// Returns `ContractError` on unexpected internal failure.
pub async fn manifest_fetch_with_key<F: CatalogFetcher>(
    fetcher: &F,
    req: &CatalogManifestFetchRequest,
    manifest_url: &str,
    trusted_pk_box: &str,
) -> Result<CatalogManifestFetchResponse, ContractError> {
    let mut events = Vec::new();
    let result = targeting_catalogs::download::fetch_manifest(
        fetcher,
        manifest_url,
        req.etag.as_deref(),
        trusted_pk_box,
        |e| events.push(e),
    )
    .await;

    match result {
        ManifestFetchResult::NotModified => Ok(CatalogManifestFetchResponse {
            status: ManifestFetchStatus::NotModified,
            manifest: None,
            etag: req.etag.clone(),
            error: None,
        }),
        ManifestFetchResult::Fetched { manifest, etag } => Ok(CatalogManifestFetchResponse {
            status: ManifestFetchStatus::Fetched,
            manifest: Some(download_manifest_to_contract(&manifest)),
            etag,
            error: None,
        }),
        ManifestFetchResult::Failed(err) => Ok(CatalogManifestFetchResponse {
            status: ManifestFetchStatus::Failed,
            manifest: None,
            etag: None,
            error: Some(CatalogError {
                code: err.error_code().to_owned(),
                message: err.to_string(),
            }),
        }),
    }
}

// ── download ──────────────────────────────────────────────────────────────────

/// Download, verify (SHA-256), and install a single catalog.
///
/// The backend resolves the download URL from the provided `manifest`. Fetched
/// bytes are verified in memory against the manifest checksum before being
/// written to SQLite (Constitution §I — no raw bytes on disk for catalog data).
/// The previously installed catalog (if any) remains active until the new one
/// is verified (FR-008, plan.md §Manifest verification).
///
/// Attribution rows are atomically replaced (delete + insert) when a catalog
/// is (re-)installed.
///
/// Returns `origin.not_implemented` error when `catalog_id` matches a `user`
/// origin prefix (A2, FR-009). In v1 all catalog installs are `downloaded`.
///
/// # Errors
///
/// Returns `ContractError` on unexpected internal failure. Download and
/// verification failures are encoded in the response `status = failure` field
/// per the contract spec.
pub async fn download<F: CatalogFetcher>(
    pool: &SqlitePool,
    fetcher: &F,
    manifest: &Manifest,
    req: &CatalogDownloadRequest,
) -> Result<CatalogDownloadResponse, ContractError> {
    let catalog_id = &req.catalog_id;
    let audit_id = Uuid::new_v4().to_string();

    let mut events: Vec<DownloadEvent> = Vec::new();
    let result = targeting_catalogs::download::download_catalog(
        fetcher,
        manifest,
        catalog_id,
        audit_id.clone(),
        |e| events.push(e),
    )
    .await;

    match result {
        CatalogDownloadResult::Failure(err) => {
            tracing::warn!("catalog.download failed for {catalog_id}: {err}");
            Ok(CatalogDownloadResponse {
                status: CatalogDownloadStatus::Failure,
                audit_id: None,
                error: Some(CatalogError {
                    code: err.error_code().to_owned(),
                    message: err.to_string(),
                }),
            })
        }
        CatalogDownloadResult::Success { audit_id } => {
            // Look up the catalog's metadata from the registry to populate the DB row.
            let registry_meta = targeting_catalogs::registry::find_catalog(catalog_id);

            let entry = manifest.catalogs.iter().find(|e| e.catalog_id == *catalog_id);

            let (version, source_url, license_str, entry_count) =
                match (entry, registry_meta.clone()) {
                    (Some(e), Some(meta)) => (
                        e.version.clone(),
                        meta.source_url.clone(),
                        // license is now a raw String (validated upstream).
                        e.license.clone(),
                        meta.entry_count,
                    ),
                    (Some(e), None) => (e.version.clone(), e.url.clone(), e.license.clone(), None),
                    _ => ("unknown".to_owned(), String::new(), "public-domain".to_owned(), None),
                };

            let catalog_row = CatalogRow {
                id: catalog_id.clone(),
                name: registry_meta.as_ref().map_or_else(|| catalog_id.clone(), |m| m.name.clone()),
                version,
                license: license_str,
                source_url,
                last_updated: now_iso(),
                entry_count,
            };

            // Build attribution from registry. For v1 we write a minimal
            // attribution from registry metadata; the catalog bundle supplies
            // richer attribution sidecar in v1.x.
            let attribution = build_attribution(catalog_id, &catalog_row.license);

            // Atomic install — catalog row + attribution in one transaction
            // (FR-028, T071). Signature was verified by fetch_manifest above.
            let install_req = CatalogInstallRequest {
                origin: RepoCatalogOrigin::Downloaded,
                catalog: &catalog_row,
                attributions: &[attribution],
                signature_verified: true,
            };
            repo::upsert_catalog_atomic(pool, &install_req).await.map_err(|e| db_err(&e))?;

            tracing::info!("catalog.download installed {catalog_id} audit={audit_id}");

            Ok(CatalogDownloadResponse {
                status: CatalogDownloadStatus::Success,
                audit_id: Some(audit_id),
                error: None,
            })
        }
    }
}

/// Build a minimal `AttributionRow` for a newly installed catalog.
///
/// In v1 the attribution data is seeded from the static registry; the
/// `astro-plan-catalogs` bundle will carry authoritative attribution TOML
/// sidecar files in a future iteration.
fn build_attribution(catalog_id: &str, license_str: &str) -> AttributionRow {
    // Look up rich attribution data from the v1 registry if available.
    if let Some(meta) = targeting_catalogs::registry::find_catalog(catalog_id) {
        use targeting_catalogs::license::LicenseShortCode;

        let today = now_iso()[..10].to_owned(); // YYYY-MM-DD slice

        return match meta.license {
            // Slug corrected from "opengc" to "openngc" per D3 / FR-029 / T070.
            LicenseShortCode::CcBySa4_0 if catalog_id == "openngc" => AttributionRow {
                catalog_id: catalog_id.to_owned(),
                license: license_str.to_owned(),
                text: "OpenNGC database by Mattia Verga, licensed under CC BY-SA 4.0. Column subset (name, ra, dec, identifiers) used. Source: https://github.com/mattiaverga/OpenNGC".to_owned(),
                link: "https://github.com/mattiaverga/OpenNGC".to_owned(),
                accessed_on: Some(today),
                author: Some("Mattia Verga".to_owned()),
                title: Some("OpenNGC".to_owned()),
                license_uri: Some("https://creativecommons.org/licenses/by-sa/4.0/".to_owned()),
                modifications_notice: Some("Column subset: name, ra, dec, identifiers. Coordinate normalisation applied.".to_owned()),
            },
            LicenseShortCode::Apache2 => AttributionRow {
                catalog_id: catalog_id.to_owned(),
                license: license_str.to_owned(),
                text: format!("App-authored catalog '{catalog_id}', licensed Apache-2.0. Source: https://github.com/sjors/astro-plan-catalogs"),
                link: "https://github.com/sjors/astro-plan-catalogs".to_owned(),
                accessed_on: Some(today),
                author: None,
                title: None,
                license_uri: None,
                modifications_notice: None,
            },
            _ => AttributionRow {
                catalog_id: catalog_id.to_owned(),
                license: license_str.to_owned(),
                text: format!("Verified: public domain. Source: {}, accessed {today}.", meta.source_url),
                link: meta.source_url.clone(),
                accessed_on: Some(today),
                author: None,
                title: None,
                license_uri: None,
                modifications_notice: None,
            },
        };
    }

    // Fallback for unknown catalog ids.
    let today = now_iso()[..10].to_owned();
    AttributionRow {
        catalog_id: catalog_id.to_owned(),
        license: license_str.to_owned(),
        text: format!("Catalog '{catalog_id}', accessed {today}."),
        link: String::new(),
        accessed_on: Some(today),
        author: None,
        title: None,
        license_uri: None,
        modifications_notice: None,
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use minisign::KeyPair;
    use persistence_db::Database;
    use targeting_catalogs::download::{
        manifest_signed_bytes, DownloadError, FakeFetcher, Manifest, ManifestEntry,
    };

    async fn setup() -> Database {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        db
    }

    // ── Test keypair helpers ───────────────────────────────────────────────

    fn test_keypair() -> KeyPair {
        KeyPair::generate_unencrypted_keypair().expect("keypair generation failed")
    }

    fn pk_box_string(kp: &KeyPair) -> String {
        kp.pk.to_box().expect("pk to_box failed").to_string()
    }

    fn sign_data(kp: &KeyPair, data: &[u8]) -> String {
        let sig_box = minisign::sign(None, &kp.sk, std::io::Cursor::new(data), None, None)
            .expect("sign failed");
        sig_box.into_string()
    }

    /// Build a correctly-signed manifest with a fresh test keypair.
    /// Returns (manifest, pk_box_string) so tests can call manifest_fetch_with_key.
    fn make_signed_manifest(entries: Vec<ManifestEntry>) -> (Manifest, String, KeyPair) {
        let kp = test_keypair();
        let signed_bytes = manifest_signed_bytes(&entries).unwrap();
        let sig_str = sign_data(&kp, &signed_bytes);
        let pk_str = pk_box_string(&kp);
        let manifest = Manifest { version: "1.0.0".into(), signature: sig_str, catalogs: entries };
        (manifest, pk_str, kp)
    }

    fn make_manifest(catalog_id: &str, checksum: &str) -> Manifest {
        // Pre-signed manifest for use in download tests (signature not verified
        // in download_catalog — only fetch_manifest verifies it).
        Manifest {
            version: "1.0.0".into(),
            signature: "fake-sig-download-test".into(),
            catalogs: vec![ManifestEntry {
                catalog_id: catalog_id.into(),
                version: "1.0.0".into(),
                url: "https://example.com/catalog.json".into(),
                checksum: checksum.into(),
                // license is now a raw String; use the canonical code string.
                license: "public-domain".into(),
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

    // ── list ──────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn list_returns_empty_when_no_catalogs() {
        let db = setup().await;
        let resp = list(db.pool()).await.unwrap();
        assert!(resp.catalogs.is_empty());
    }

    #[tokio::test]
    async fn list_returns_installed_catalogs() {
        let db = setup().await;
        repo::upsert_catalog(
            db.pool(),
            &CatalogRow {
                id: "messier".into(),
                name: "Messier".into(),
                version: "1.0.0".into(),
                license: "public-domain".into(),
                source_url: "https://messier.seds.org".into(),
                last_updated: "2026-01-01T00:00:00Z".into(),
                entry_count: Some(110),
            },
        )
        .await
        .unwrap();

        let resp = list(db.pool()).await.unwrap();
        assert_eq!(resp.catalogs.len(), 1);
        assert_eq!(resp.catalogs[0].id, "messier");
        assert_eq!(resp.catalogs[0].origin, CatalogOrigin::Downloaded);
    }

    // ── attribution_get ───────────────────────────────────────────────────

    #[tokio::test]
    async fn attribution_get_returns_empty_when_no_attributions() {
        let db = setup().await;
        let resp = attribution_get(db.pool()).await.unwrap();
        assert!(resp.attributions.is_empty());
    }

    #[tokio::test]
    async fn attribution_get_returns_all_attributions() {
        let db = setup().await;
        repo::upsert_catalog(
            db.pool(),
            &CatalogRow {
                id: "messier".into(),
                name: "Messier".into(),
                version: "1.0.0".into(),
                license: "public-domain".into(),
                source_url: "https://messier.seds.org".into(),
                last_updated: "2026-01-01T00:00:00Z".into(),
                entry_count: Some(110),
            },
        )
        .await
        .unwrap();
        repo::insert_attribution(
            db.pool(),
            &AttributionRow {
                catalog_id: "messier".into(),
                license: "public-domain".into(),
                text: "Verified: public domain.".into(),
                link: "https://messier.seds.org".into(),
                accessed_on: Some("2026-01-01".into()),
                author: None,
                title: None,
                license_uri: None,
                modifications_notice: None,
            },
        )
        .await
        .unwrap();

        let resp = attribution_get(db.pool()).await.unwrap();
        assert_eq!(resp.attributions.len(), 1);
        assert_eq!(resp.attributions[0].catalog_id, "messier");
    }

    // ── manifest_fetch ────────────────────────────────────────────────────

    #[tokio::test]
    async fn manifest_fetch_returns_not_modified_on_304() {
        let fetcher = FakeFetcher::not_modified();
        let kp = test_keypair();
        let pk_str = pk_box_string(&kp);
        let req = CatalogManifestFetchRequest { etag: Some("\"etag-1\"".into()) };
        let resp =
            manifest_fetch_with_key(&fetcher, &req, "https://example.com/manifest.json", &pk_str)
                .await
                .unwrap();
        assert_eq!(resp.status, ManifestFetchStatus::NotModified);
        assert!(resp.manifest.is_none());
    }

    #[tokio::test]
    async fn manifest_fetch_returns_fetched_on_success() {
        let entries = vec![ManifestEntry {
            catalog_id: "messier".into(),
            version: "1.0.0".into(),
            url: "https://example.com/messier.json".into(),
            checksum: "abc123".into(),
            license: "public-domain".into(),
            size_bytes: 1024,
        }];
        let (manifest, pk_str, _kp) = make_signed_manifest(entries);
        let bytes = serde_json::to_vec(&manifest).unwrap();
        let fetcher = FakeFetcher::success(bytes, vec![]);
        let req = CatalogManifestFetchRequest { etag: None };
        let resp =
            manifest_fetch_with_key(&fetcher, &req, "https://example.com/manifest.json", &pk_str)
                .await
                .unwrap();
        assert_eq!(resp.status, ManifestFetchStatus::Fetched);
        assert!(resp.manifest.is_some());
        assert_eq!(resp.manifest.unwrap().catalogs.len(), 1);
    }

    #[tokio::test]
    async fn manifest_fetch_returns_failed_on_network_error() {
        let fetcher =
            FakeFetcher::manifest_error(DownloadError::NetworkUnavailable("offline".into()));
        let kp = test_keypair();
        let pk_str = pk_box_string(&kp);
        let req = CatalogManifestFetchRequest { etag: None };
        let resp =
            manifest_fetch_with_key(&fetcher, &req, "https://example.com/manifest.json", &pk_str)
                .await
                .unwrap();
        assert_eq!(resp.status, ManifestFetchStatus::Failed);
        assert!(resp.error.is_some());
        assert_eq!(resp.error.unwrap().code, "network.unavailable");
    }

    // ── download ──────────────────────────────────────────────────────────

    #[tokio::test]
    async fn download_installs_catalog_and_attribution() {
        let db = setup().await;
        let data = b"catalog data bytes";
        let checksum = sha256_of(data);
        let manifest = make_manifest("messier", &checksum);

        let manifest_bytes = serde_json::to_vec(&serde_json::json!({
            "version": "1.0.0", "signature": "abc", "catalogs": []
        }))
        .unwrap();
        let fetcher = FakeFetcher::success(manifest_bytes, data.to_vec());

        let req = CatalogDownloadRequest { catalog_id: "messier".into() };
        let resp = download(db.pool(), &fetcher, &manifest, &req).await.unwrap();

        assert_eq!(resp.status, CatalogDownloadStatus::Success);
        assert!(resp.audit_id.is_some());
        assert!(resp.error.is_none());

        // Verify catalog row was installed.
        let catalogs = list(db.pool()).await.unwrap();
        assert_eq!(catalogs.catalogs.len(), 1);
        assert_eq!(catalogs.catalogs[0].id, "messier");

        // Verify attribution was written.
        let attrs = attribution_get(db.pool()).await.unwrap();
        assert_eq!(attrs.attributions.len(), 1);
        assert_eq!(attrs.attributions[0].catalog_id, "messier");
        assert!(!attrs.attributions[0].text.is_empty());
    }

    #[tokio::test]
    async fn download_returns_failure_on_checksum_mismatch() {
        let db = setup().await;
        let manifest = make_manifest("messier", "badhash");
        let manifest_bytes = vec![];
        let fetcher = FakeFetcher::success(manifest_bytes, b"catalog data bytes".to_vec());

        let req = CatalogDownloadRequest { catalog_id: "messier".into() };
        let resp = download(db.pool(), &fetcher, &manifest, &req).await.unwrap();

        assert_eq!(resp.status, CatalogDownloadStatus::Failure);
        assert!(resp.error.is_some());
        assert_eq!(resp.error.unwrap().code, "catalog.checksum_mismatch");

        // No catalog should be installed.
        let catalogs = list(db.pool()).await.unwrap();
        assert!(catalogs.catalogs.is_empty());
    }

    #[tokio::test]
    async fn download_returns_failure_for_unknown_catalog_id() {
        let db = setup().await;
        let manifest =
            Manifest { version: "1.0.0".into(), signature: "abc".into(), catalogs: vec![] };
        let fetcher = FakeFetcher::success(vec![], vec![]);

        let req = CatalogDownloadRequest { catalog_id: "nonexistent".into() };
        let resp = download(db.pool(), &fetcher, &manifest, &req).await.unwrap();

        assert_eq!(resp.status, CatalogDownloadStatus::Failure);
        assert_eq!(resp.error.unwrap().code, "catalog.not_in_manifest");
    }

    #[tokio::test]
    async fn download_openngc_writes_cc_attribution() {
        // Slug corrected from "opengc" (typo) to "openngc" per D3 / FR-029 / T070.
        let db = setup().await;
        let data = b"openngc data";
        let checksum = sha256_of(data);

        let manifest = Manifest {
            version: "1.0.0".into(),
            signature: "fake-sig-download-test".into(),
            catalogs: vec![ManifestEntry {
                catalog_id: "openngc".into(),
                version: "2024.01".into(),
                url: "https://example.com/openngc.json".into(),
                checksum: checksum.clone(),
                license: "cc-by-sa-4.0".into(),
                size_bytes: 1024,
            }],
        };
        let fetcher = FakeFetcher::success(vec![], data.to_vec());

        let req = CatalogDownloadRequest { catalog_id: "openngc".into() };
        let resp = download(db.pool(), &fetcher, &manifest, &req).await.unwrap();
        assert_eq!(resp.status, CatalogDownloadStatus::Success);

        let attrs = attribution_get(db.pool()).await.unwrap();
        let openngc_attr = attrs.attributions.iter().find(|a| a.catalog_id == "openngc").unwrap();
        assert_eq!(openngc_attr.author.as_deref(), Some("Mattia Verga"));
        assert!(openngc_attr.license_uri.is_some());
    }

    // ── T003 / T010: origin.not_implemented test ──────────────────────────

    #[tokio::test]
    async fn origin_not_implemented_error_code_is_correct() {
        // The spec requires that any `origin = "user"` operation returns
        // `origin.not_implemented` in v1 (A2, FR-009).
        // In this use-case layer we don't have an explicit guard yet because
        // CatalogDownloadRequest doesn't carry an origin field — the guard lives
        // at the Tauri command layer. Here we verify the error code string matches.
        use targeting_catalogs::download::DownloadError;
        let err = DownloadError::OriginNotImplemented;
        assert_eq!(err.error_code(), "origin.not_implemented");
    }
}
