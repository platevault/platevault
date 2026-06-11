//! Catalog Tauri commands (spec 014, T006).
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks
//!
//! ## Commands
//!
//! - `catalog.list` — list all installed catalogs (catalog.list contract).
//! - `catalog.attribution.get` — list all attribution rows (catalog.attribution.get).
//! - `catalog.manifest.fetch` — fetch the manifest from the hosted URL.
//! - `catalog.download` — download, verify (SHA-256), and install a single catalog.
//!
//! All four commands use the `AppState` pool and the `ReqwestFetcher` for
//! production HTTP. The manifest URL is a build-time constant pointing to the
//! `astro-plan-catalogs` repository releases manifest (TBD — placeholder used
//! in v1).

use contracts_core::catalogs::{
    CatalogAttributionGetResponse, CatalogDownloadRequest, CatalogDownloadResponse,
    CatalogListResponse, CatalogManifestFetchRequest, CatalogManifestFetchResponse,
};
use serde::Deserialize;
use targeting_catalogs::download::ReqwestFetcher;
use tauri::State;

use crate::commands::lifecycle::AppState;

/// Build-time manifest URL placeholder.
///
/// In v1 the `astro-plan-catalogs` repository and its hosted manifest URL are
/// not yet published. This constant is a placeholder that will be replaced when
/// the repository goes live. The `catalog.manifest.fetch` command will return
/// `status = failed` with `manifest.fetch_failed` until the URL is set.
const CATALOG_MANIFEST_URL: &str =
    "https://github.com/sjors/astro-plan-catalogs/releases/latest/download/manifest.json";

// ── catalog.list ──────────────────────────────────────────────────────────────

/// `catalog.list` — list all installed catalogs.
///
/// Returns every catalog in the `catalog_downloaded` table, ordered by origin
/// (`downloaded` first) then by name.
///
/// # Errors
///
/// Returns `Err(String)` on database failure.
#[tauri::command]
#[specta::specta(rename = "catalog.list")]
pub async fn catalog_list(state: State<'_, AppState>) -> Result<CatalogListResponse, String> {
    tracing::debug!("catalog.list");
    app_core::catalogs::list(state.repo.pool()).await.map_err(|e| e.message)
}

// ── catalog.attribution.get ───────────────────────────────────────────────────

/// `catalog.attribution.get` — list all license attribution rows.
///
/// Returns attribution data for every installed catalog.  Separated from
/// `catalog.list` so the (potentially large) notice text payload is not paid
/// for on the metadata listing.
///
/// # Errors
///
/// Returns `Err(String)` on database failure.
#[tauri::command]
#[specta::specta(rename = "catalog.attribution.get")]
pub async fn catalog_attribution_get(
    state: State<'_, AppState>,
) -> Result<CatalogAttributionGetResponse, String> {
    tracing::debug!("catalog.attribution.get");
    app_core::catalogs::attribution_get(state.repo.pool()).await.map_err(|e| e.message)
}

// ── catalog.manifest.fetch ────────────────────────────────────────────────────

/// `catalog.manifest.fetch` — fetch the catalog manifest from the hosted URL.
///
/// Accepts an optional `etag` for conditional HTTP (HTTP 304 → `not_modified`).
/// On success, the manifest is returned in the response for the caller to pass
/// to `catalog.download` for each catalog.
///
/// # Errors
///
/// Returns `Err(String)` on unexpected internal failure. Network / verification
/// failures are encoded in the response `status = failed` field.
#[tauri::command]
#[specta::specta(rename = "catalog.manifest.fetch")]
pub async fn catalog_manifest_fetch(
    _state: State<'_, AppState>,
    etag: Option<String>,
) -> Result<CatalogManifestFetchResponse, String> {
    tracing::debug!("catalog.manifest.fetch etag={etag:?}");
    let fetcher = ReqwestFetcher::new();
    let req = CatalogManifestFetchRequest { etag };
    app_core::catalogs::manifest_fetch(&fetcher, &req, CATALOG_MANIFEST_URL)
        .await
        .map_err(|e| e.message)
}

// ── catalog.download ──────────────────────────────────────────────────────────

/// Payload shape for `catalog.download` (wraps the contract request fields).
///
/// The `manifest` field carries the `CatalogManifest` that was returned by a
/// prior `catalog.manifest.fetch` call. The frontend is responsible for
/// caching the manifest between the fetch step and the per-catalog download
/// loop (T010-dl).
#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDownloadArgs {
    pub catalog_id: String,
    pub manifest: contracts_core::catalogs::CatalogManifest,
}

/// `catalog.download` — download, verify (SHA-256), and install a single catalog.
///
/// The backend resolves the download URL and checksum from the provided
/// manifest. Bytes are verified in memory before being installed into SQLite.
/// The previously installed catalog (if any) remains active until the new one
/// is verified (FR-008).
///
/// Returns `origin.not_implemented` when `catalog_id` matches a `user` origin
/// request (A2, FR-009). In v1 all downloads are `downloaded` origin.
///
/// # Errors
///
/// Returns `Err(String)` on unexpected internal failure. Download and
/// verification failures are encoded in the response `status = failure` field.
#[tauri::command]
#[specta::specta(rename = "catalog.download")]
pub async fn catalog_download(
    state: State<'_, AppState>,
    args: CatalogDownloadArgs,
) -> Result<CatalogDownloadResponse, String> {
    tracing::debug!("catalog.download catalog_id={}", args.catalog_id);

    // Convert the contract manifest to the internal download::Manifest type.
    let internal_manifest = contract_manifest_to_internal(&args.manifest);

    let req = CatalogDownloadRequest { catalog_id: args.catalog_id };
    let fetcher = ReqwestFetcher::new();

    app_core::catalogs::download(state.repo.pool(), &fetcher, &internal_manifest, &req)
        .await
        .map_err(|e| e.message)
}

/// Convert a `contracts_core::catalogs::CatalogManifest` into the internal
/// `targeting_catalogs::download::Manifest` type.
fn contract_manifest_to_internal(
    m: &contracts_core::catalogs::CatalogManifest,
) -> targeting_catalogs::download::Manifest {
    use targeting_catalogs::download::ManifestEntry;
    use targeting_catalogs::license::LicenseShortCode;

    targeting_catalogs::download::Manifest {
        version: m.version.clone(),
        signature: m.signature.clone(),
        catalogs: m
            .catalogs
            .iter()
            .map(|e| ManifestEntry {
                catalog_id: e.catalog_id.clone(),
                version: e.version.clone(),
                url: e.url.clone(),
                checksum: e.checksum.clone(),
                license: LicenseShortCode::parse_code(&e.license)
                    .unwrap_or(LicenseShortCode::PublicDomain),
                size_bytes: e.size_bytes,
            })
            .collect(),
    }
}
