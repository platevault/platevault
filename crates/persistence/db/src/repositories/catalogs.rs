//! Repository methods for the catalog registry (spec 014, T002; spec 033 US7).
//!
//! Operates on the `catalog_downloaded` and `catalog_downloaded_attribution`
//! tables from migration 0016, extended by migration 0038.
//!
//! # FR-028 — Atomic install (T071)
//!
//! [`upsert_catalog_atomic`] is the correct entry point for installing or
//! updating a catalog together with its attribution data. It wraps the upsert,
//! attribution delete, and attribution insert in a single SQLite transaction so
//! a partial failure leaves the previous state intact.
//!
//! # FR-026 — Signature status (T071)
//!
//! The `signature_status` column (migration 0038) is updated by
//! [`upsert_catalog_atomic`] based on whether the caller verified the signature
//! before calling.
//!
//! # Origin guard (T071 — `origin.not_implemented`)
//!
//! [`CatalogInstallRequest`] carries an `origin` field. Callers that pass
//! `origin = CatalogOrigin::User` receive [`DbError::OriginNotImplemented`]
//! immediately (A2: user-added catalogs deferred to v1.x).

use sqlx::SqlitePool;
use time::OffsetDateTime;

use crate::{DbError, DbResult};

// ── Origin guard ──────────────────────────────────────────────────────────────

/// Origin of a catalog install request.
///
/// `User` is deferred to v1.x (A2). Passing `User` to any install function
/// returns [`DbError::OriginNotImplemented`] (FR-009 of spec 014 / T071).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CatalogOrigin {
    Downloaded,
    BuiltIn,
    User,
}

/// Install request for a catalog + attribution pair.
///
/// `origin` must be `CatalogOrigin::Downloaded` in v1; passing `User` returns
/// `OriginNotImplemented` (T071).
pub struct CatalogInstallRequest<'a> {
    pub origin: CatalogOrigin,
    pub catalog: &'a CatalogRow,
    pub attributions: &'a [AttributionRow],
    /// Whether the manifest signature was verified before this install.
    /// Set to `true` only after a successful [`verify_minisign_signature`] call.
    pub signature_verified: bool,
}

// ── Row types ─────────────────────────────────────────────────────────────────

/// Stored row from `catalog_downloaded`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CatalogRow {
    pub id: String,
    pub name: String,
    pub version: String,
    pub license: String,
    pub source_url: String,
    pub last_updated: String,
    pub entry_count: Option<i64>,
}

/// Stored row from `catalog_downloaded_attribution`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AttributionRow {
    pub catalog_id: String,
    pub license: String,
    pub text: String,
    pub link: String,
    pub accessed_on: Option<String>,
    pub author: Option<String>,
    pub title: Option<String>,
    pub license_uri: Option<String>,
    pub modifications_notice: Option<String>,
}

/// Raw tuple returned by sqlx for `catalog_downloaded_attribution` rows.
type AttributionTuple = (
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

// ── catalog_downloaded ────────────────────────────────────────────────────────

/// List all downloaded catalogs ordered by name.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn list_catalogs(pool: &SqlitePool) -> DbResult<Vec<CatalogRow>> {
    let rows: Vec<(String, String, String, String, String, String, Option<i64>)> = sqlx::query_as(
        "SELECT id, name, version, license, source_url, last_updated, entry_count
             FROM catalog_downloaded
             ORDER BY name ASC",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(id, name, version, license, source_url, last_updated, entry_count)| CatalogRow {
            id,
            name,
            version,
            license,
            source_url,
            last_updated,
            entry_count,
        })
        .collect())
}

/// Get a single catalog row by id.
///
/// # Errors
///
/// Returns [`DbError::NotFound`] when no row exists for `id`.
/// Returns [`DbError::Database`] on query failure.
pub async fn get_catalog(pool: &SqlitePool, id: &str) -> DbResult<CatalogRow> {
    let row: Option<(String, String, String, String, String, String, Option<i64>)> =
        sqlx::query_as(
            "SELECT id, name, version, license, source_url, last_updated, entry_count
             FROM catalog_downloaded
             WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?;

    match row {
        None => Err(DbError::NotFound(format!("catalog '{id}'"))),
        Some((id, name, version, license, source_url, last_updated, entry_count)) => {
            Ok(CatalogRow { id, name, version, license, source_url, last_updated, entry_count })
        }
    }
}

/// Upsert a catalog row (insert or update on conflict by id).
///
/// Sets `last_updated` to `now_iso()` when not provided.
///
/// This is a single-row operation. For atomic catalog+attribution installs,
/// use [`upsert_catalog_atomic`] instead (FR-028, T071).
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn upsert_catalog(pool: &SqlitePool, row: &CatalogRow) -> DbResult<()> {
    let last_updated =
        if row.last_updated.is_empty() { now_iso() } else { row.last_updated.clone() };

    sqlx::query(
        "INSERT INTO catalog_downloaded (id, name, version, license, source_url, last_updated, entry_count)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
             name         = excluded.name,
             version      = excluded.version,
             license      = excluded.license,
             source_url   = excluded.source_url,
             last_updated = excluded.last_updated,
             entry_count  = excluded.entry_count",
    )
    .bind(&row.id)
    .bind(&row.name)
    .bind(&row.version)
    .bind(&row.license)
    .bind(&row.source_url)
    .bind(&last_updated)
    .bind(row.entry_count)
    .execute(pool)
    .await?;

    Ok(())
}

/// Atomically install (or reinstall) a catalog and its attribution rows
/// in a single SQLite transaction (FR-028, T071).
///
/// Execution order within the transaction:
/// 1. Check `request.origin` — return [`DbError::OriginNotImplemented`] for
///    `CatalogOrigin::User` (A2 / T071 origin guard).
/// 2. Upsert the catalog row with the correct `signature_status`.
/// 3. Delete existing attribution rows for this catalog.
/// 4. Insert the new attribution rows.
///
/// If any step fails the transaction is rolled back, leaving the previous
/// catalog and attribution state intact (Constitution §II).
///
/// # Errors
///
/// - [`DbError::OriginNotImplemented`] — `request.origin == User`.
/// - [`DbError::Database`] — any SQL failure (transaction rolled back).
pub async fn upsert_catalog_atomic(
    pool: &SqlitePool,
    request: &CatalogInstallRequest<'_>,
) -> DbResult<()> {
    // Origin guard (T071 — `origin.not_implemented` reachable).
    if request.origin == CatalogOrigin::User {
        return Err(DbError::OriginNotImplemented);
    }

    let row = request.catalog;
    let last_updated =
        if row.last_updated.is_empty() { now_iso() } else { row.last_updated.clone() };
    let sig_status = if request.signature_verified { "verified" } else { "unverified" };

    let mut tx = pool.begin().await?;

    // Step 1: upsert catalog row with signature_status.
    sqlx::query(
        "INSERT INTO catalog_downloaded
             (id, name, version, license, source_url, last_updated, entry_count, signature_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
             name             = excluded.name,
             version          = excluded.version,
             license          = excluded.license,
             source_url       = excluded.source_url,
             last_updated     = excluded.last_updated,
             entry_count      = excluded.entry_count,
             signature_status = excluded.signature_status",
    )
    .bind(&row.id)
    .bind(&row.name)
    .bind(&row.version)
    .bind(&row.license)
    .bind(&row.source_url)
    .bind(&last_updated)
    .bind(row.entry_count)
    .bind(sig_status)
    .execute(&mut *tx)
    .await?;

    // Step 2: delete existing attributions (idempotent).
    sqlx::query("DELETE FROM catalog_downloaded_attribution WHERE catalog_id = ?")
        .bind(&row.id)
        .execute(&mut *tx)
        .await?;

    // Step 3: insert new attributions.
    for attr in request.attributions {
        sqlx::query(
            "INSERT INTO catalog_downloaded_attribution
                 (catalog_id, license, text, link, accessed_on, author, title,
                  license_uri, modifications_notice)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&attr.catalog_id)
        .bind(&attr.license)
        .bind(&attr.text)
        .bind(&attr.link)
        .bind(&attr.accessed_on)
        .bind(&attr.author)
        .bind(&attr.title)
        .bind(&attr.license_uri)
        .bind(&attr.modifications_notice)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

/// Delete a catalog row and its attributions (CASCADE).
///
/// Idempotent — no error if the row does not exist.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn delete_catalog(pool: &SqlitePool, id: &str) -> DbResult<()> {
    sqlx::query("DELETE FROM catalog_downloaded WHERE id = ?").bind(id).execute(pool).await?;
    Ok(())
}

// ── catalog_downloaded_attribution ────────────────────────────────────────────

/// List all attribution rows for a given catalog id.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn list_attributions(
    pool: &SqlitePool,
    catalog_id: &str,
) -> DbResult<Vec<AttributionRow>> {
    let rows: Vec<AttributionTuple> = sqlx::query_as(
        "SELECT catalog_id, license, text, link, accessed_on,
                author, title, license_uri, modifications_notice
         FROM catalog_downloaded_attribution
         WHERE catalog_id = ?
         ORDER BY id ASC",
    )
    .bind(catalog_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(
                catalog_id,
                license,
                text,
                link,
                accessed_on,
                author,
                title,
                license_uri,
                modifications_notice,
            )| {
                AttributionRow {
                    catalog_id,
                    license,
                    text,
                    link,
                    accessed_on,
                    author,
                    title,
                    license_uri,
                    modifications_notice,
                }
            },
        )
        .collect())
}

/// List all attribution rows across all catalogs.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn list_all_attributions(pool: &SqlitePool) -> DbResult<Vec<AttributionRow>> {
    let rows: Vec<AttributionTuple> = sqlx::query_as(
        "SELECT catalog_id, license, text, link, accessed_on,
                author, title, license_uri, modifications_notice
         FROM catalog_downloaded_attribution
         ORDER BY catalog_id ASC, id ASC",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(
                catalog_id,
                license,
                text,
                link,
                accessed_on,
                author,
                title,
                license_uri,
                modifications_notice,
            )| {
                AttributionRow {
                    catalog_id,
                    license,
                    text,
                    link,
                    accessed_on,
                    author,
                    title,
                    license_uri,
                    modifications_notice,
                }
            },
        )
        .collect())
}

/// Insert an attribution row.
///
/// Call this after `upsert_catalog` (or inside a transaction that also
/// upserts the catalog). Does not deduplicate — callers that do atomic
/// install should delete existing attribution rows first.
///
/// For atomic install prefer [`upsert_catalog_atomic`].
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn insert_attribution(pool: &SqlitePool, row: &AttributionRow) -> DbResult<()> {
    sqlx::query(
        "INSERT INTO catalog_downloaded_attribution
             (catalog_id, license, text, link, accessed_on, author, title, license_uri, modifications_notice)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&row.catalog_id)
    .bind(&row.license)
    .bind(&row.text)
    .bind(&row.link)
    .bind(&row.accessed_on)
    .bind(&row.author)
    .bind(&row.title)
    .bind(&row.license_uri)
    .bind(&row.modifications_notice)
    .execute(pool)
    .await?;

    Ok(())
}

/// Delete all attribution rows for a catalog id (used before re-inserting
/// updated attribution data during an atomic install).
///
/// Idempotent — no error if no rows exist for `catalog_id`.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn delete_attributions(pool: &SqlitePool, catalog_id: &str) -> DbResult<()> {
    sqlx::query("DELETE FROM catalog_downloaded_attribution WHERE catalog_id = ?")
        .bind(catalog_id)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Database;

    async fn setup() -> Database {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        db
    }

    fn messier_row() -> CatalogRow {
        CatalogRow {
            id: "messier".into(),
            name: "Messier".into(),
            version: "1.0.0".into(),
            license: "public-domain".into(),
            source_url: "https://messier.seds.org".into(),
            last_updated: "2026-01-01T00:00:00Z".into(),
            entry_count: Some(110),
        }
    }

    fn messier_attribution() -> AttributionRow {
        AttributionRow {
            catalog_id: "messier".into(),
            license: "public-domain".into(),
            text: "Verified: public domain. Source: https://messier.seds.org, accessed 2026-01-01."
                .into(),
            link: "https://messier.seds.org".into(),
            accessed_on: Some("2026-01-01".into()),
            author: None,
            title: None,
            license_uri: None,
            modifications_notice: None,
        }
    }

    // Slug corrected from "opengc" (typo) to "openngc" per D3 / T070.
    fn openngc_row() -> CatalogRow {
        CatalogRow {
            id: "openngc".into(),
            name: "OpenNGC (NGC + IC)".into(),
            version: "2024.01".into(),
            license: "cc-by-sa-4.0".into(),
            source_url: "https://github.com/mattiaverga/OpenNGC".into(),
            last_updated: "2026-01-01T00:00:00Z".into(),
            entry_count: Some(13000),
        }
    }

    fn openngc_attribution() -> AttributionRow {
        AttributionRow {
            catalog_id: "openngc".into(),
            license: "cc-by-sa-4.0".into(),
            text: "OpenNGC by Mattia Verga, CC BY-SA 4.0".into(),
            link: "https://github.com/mattiaverga/OpenNGC".into(),
            accessed_on: Some("2026-01-01".into()),
            author: Some("Mattia Verga".into()),
            title: Some("OpenNGC".into()),
            license_uri: Some("https://creativecommons.org/licenses/by-sa/4.0/".into()),
            modifications_notice: Some("Column subset".into()),
        }
    }

    // ── Existing repository tests ─────────────────────────────────────────

    #[tokio::test]
    async fn list_catalogs_returns_empty_initially() {
        let db = setup().await;
        let rows = list_catalogs(db.pool()).await.unwrap();
        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn upsert_and_list_catalog() {
        let db = setup().await;
        upsert_catalog(db.pool(), &messier_row()).await.unwrap();
        let rows = list_catalogs(db.pool()).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "messier");
        assert_eq!(rows[0].entry_count, Some(110));
    }

    #[tokio::test]
    async fn upsert_catalog_updates_on_conflict() {
        let db = setup().await;
        upsert_catalog(db.pool(), &messier_row()).await.unwrap();

        let updated = CatalogRow { version: "1.1.0".into(), ..messier_row() };
        upsert_catalog(db.pool(), &updated).await.unwrap();

        let rows = list_catalogs(db.pool()).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].version, "1.1.0");
    }

    #[tokio::test]
    async fn get_catalog_returns_not_found_for_unknown_id() {
        let db = setup().await;
        let result = get_catalog(db.pool(), "unknown").await;
        assert!(matches!(result, Err(DbError::NotFound(_))));
    }

    #[tokio::test]
    async fn get_catalog_returns_row_by_id() {
        let db = setup().await;
        upsert_catalog(db.pool(), &messier_row()).await.unwrap();
        let row = get_catalog(db.pool(), "messier").await.unwrap();
        assert_eq!(row.id, "messier");
    }

    #[tokio::test]
    async fn delete_catalog_removes_row() {
        let db = setup().await;
        upsert_catalog(db.pool(), &messier_row()).await.unwrap();
        delete_catalog(db.pool(), "messier").await.unwrap();
        let rows = list_catalogs(db.pool()).await.unwrap();
        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn insert_and_list_attribution() {
        let db = setup().await;
        upsert_catalog(db.pool(), &messier_row()).await.unwrap();
        insert_attribution(db.pool(), &messier_attribution()).await.unwrap();

        let attrs = list_attributions(db.pool(), "messier").await.unwrap();
        assert_eq!(attrs.len(), 1);
        assert_eq!(attrs[0].catalog_id, "messier");
        assert!(!attrs[0].text.is_empty());
    }

    #[tokio::test]
    async fn insert_and_list_all_attributions() {
        let db = setup().await;
        upsert_catalog(db.pool(), &messier_row()).await.unwrap();
        upsert_catalog(db.pool(), &openngc_row()).await.unwrap();
        insert_attribution(db.pool(), &messier_attribution()).await.unwrap();
        insert_attribution(db.pool(), &openngc_attribution()).await.unwrap();

        let attrs = list_all_attributions(db.pool()).await.unwrap();
        assert_eq!(attrs.len(), 2);
    }

    #[tokio::test]
    async fn delete_attributions_removes_rows() {
        let db = setup().await;
        upsert_catalog(db.pool(), &messier_row()).await.unwrap();
        insert_attribution(db.pool(), &messier_attribution()).await.unwrap();
        delete_attributions(db.pool(), "messier").await.unwrap();
        let attrs = list_attributions(db.pool(), "messier").await.unwrap();
        assert!(attrs.is_empty());
    }

    #[tokio::test]
    async fn delete_catalog_cascades_to_attributions() {
        let db = setup().await;
        upsert_catalog(db.pool(), &messier_row()).await.unwrap();
        insert_attribution(db.pool(), &messier_attribution()).await.unwrap();

        delete_catalog(db.pool(), "messier").await.unwrap();

        let attrs = list_attributions(db.pool(), "messier").await.unwrap();
        assert!(attrs.is_empty());
    }

    #[tokio::test]
    async fn openngc_attribution_stores_cc_fields() {
        let db = setup().await;
        upsert_catalog(db.pool(), &openngc_row()).await.unwrap();
        insert_attribution(db.pool(), &openngc_attribution()).await.unwrap();

        let attrs = list_attributions(db.pool(), "openngc").await.unwrap();
        assert_eq!(attrs.len(), 1);
        assert_eq!(attrs[0].author.as_deref(), Some("Mattia Verga"));
        assert_eq!(attrs[0].title.as_deref(), Some("OpenNGC"));
        assert!(attrs[0].license_uri.is_some());
    }

    // ── T067: atomic upsert leaves no partial state (FR-028) ─────────────

    /// T067: a successful atomic install writes both catalog and attribution.
    #[tokio::test]
    async fn upsert_catalog_atomic_writes_catalog_and_attribution() {
        let db = setup().await;
        let req = CatalogInstallRequest {
            origin: CatalogOrigin::Downloaded,
            catalog: &messier_row(),
            attributions: &[messier_attribution()],
            signature_verified: true,
        };
        upsert_catalog_atomic(db.pool(), &req).await.unwrap();

        let rows = list_catalogs(db.pool()).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "messier");

        let attrs = list_attributions(db.pool(), "messier").await.unwrap();
        assert_eq!(attrs.len(), 1);
    }

    /// T067: re-installing replaces the attribution (no duplication).
    #[tokio::test]
    async fn upsert_catalog_atomic_replaces_attribution_on_reinstall() {
        let db = setup().await;
        let req = CatalogInstallRequest {
            origin: CatalogOrigin::Downloaded,
            catalog: &messier_row(),
            attributions: &[messier_attribution()],
            signature_verified: true,
        };
        upsert_catalog_atomic(db.pool(), &req).await.unwrap();
        // Re-install — attribution must not be duplicated.
        upsert_catalog_atomic(db.pool(), &req).await.unwrap();

        let attrs = list_attributions(db.pool(), "messier").await.unwrap();
        assert_eq!(attrs.len(), 1, "re-install must not duplicate attribution rows");
    }

    /// T067: FK violation on attribution (missing catalog) rolls back.
    /// This test verifies that an attribution insert failure does not leave a
    /// partial catalog row — the whole transaction is atomic.
    #[tokio::test]
    async fn upsert_catalog_atomic_bad_attribution_rolls_back() {
        let db = setup().await;
        // Attribution with a catalog_id that doesn't match the installed catalog
        // — the FK constraint on catalog_downloaded_attribution will fire only
        // if the catalog row is absent. We use a deliberately broken attribution
        // (empty text) instead, which triggers the license trigger if the license
        // is also wrong. Use an unknown license to trigger the DB-level guard.
        let bad_attr = AttributionRow {
            catalog_id: "messier".into(),
            license: "gpl-3.0".into(), // unknown license — trigger fires
            text: "some text".into(),
            link: "https://example.com".into(),
            accessed_on: None,
            author: None,
            title: None,
            license_uri: None,
            modifications_notice: None,
        };
        let req = CatalogInstallRequest {
            origin: CatalogOrigin::Downloaded,
            catalog: &messier_row(),
            attributions: &[bad_attr],
            signature_verified: false,
        };
        let result = upsert_catalog_atomic(db.pool(), &req).await;
        assert!(result.is_err(), "invalid attribution must fail");

        // The catalog row must NOT have been committed (transaction rolled back).
        let rows = list_catalogs(db.pool()).await.unwrap();
        assert!(rows.is_empty(), "transaction rollback must leave catalog table empty");
    }

    // ── T071: origin guard (origin.not_implemented reachable) ────────────

    /// T071: user origin is rejected with OriginNotImplemented (A2).
    #[tokio::test]
    async fn upsert_catalog_atomic_rejects_user_origin() {
        let db = setup().await;
        let req = CatalogInstallRequest {
            origin: CatalogOrigin::User,
            catalog: &messier_row(),
            attributions: &[messier_attribution()],
            signature_verified: false,
        };
        let result = upsert_catalog_atomic(db.pool(), &req).await;
        assert!(
            matches!(result, Err(DbError::OriginNotImplemented)),
            "User origin must return OriginNotImplemented: {result:?}"
        );
    }

    // ── Signature status column (migration 0038, FR-026) ─────────────────

    /// Atomic install with signature_verified=true writes 'verified' status.
    #[tokio::test]
    async fn signature_status_is_verified_after_verified_install() {
        let db = setup().await;
        let req = CatalogInstallRequest {
            origin: CatalogOrigin::Downloaded,
            catalog: &messier_row(),
            attributions: &[messier_attribution()],
            signature_verified: true,
        };
        upsert_catalog_atomic(db.pool(), &req).await.unwrap();

        let row: (String,) =
            sqlx::query_as("SELECT signature_status FROM catalog_downloaded WHERE id = 'messier'")
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(row.0, "verified");
    }

    /// Atomic install with signature_verified=false writes 'unverified' status.
    #[tokio::test]
    async fn signature_status_is_unverified_after_unverified_install() {
        let db = setup().await;
        let req = CatalogInstallRequest {
            origin: CatalogOrigin::Downloaded,
            catalog: &messier_row(),
            attributions: &[messier_attribution()],
            signature_verified: false,
        };
        upsert_catalog_atomic(db.pool(), &req).await.unwrap();

        let row: (String,) =
            sqlx::query_as("SELECT signature_status FROM catalog_downloaded WHERE id = 'messier'")
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(row.0, "unverified");
    }
}
