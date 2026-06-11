//! Repository methods for the catalog registry (spec 014, T002).
//!
//! Operates on the `catalog_downloaded` and `catalog_downloaded_attribution`
//! tables from migration 0016.

use sqlx::SqlitePool;
use time::OffsetDateTime;

use crate::{DbError, DbResult};

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

    fn opengc_row() -> CatalogRow {
        CatalogRow {
            id: "opengc".into(),
            name: "OpenNGC (NGC + IC)".into(),
            version: "2024.01".into(),
            license: "cc-by-sa-4.0".into(),
            source_url: "https://github.com/mattiaverga/OpenNGC".into(),
            last_updated: "2026-01-01T00:00:00Z".into(),
            entry_count: Some(13000),
        }
    }

    fn opengc_attribution() -> AttributionRow {
        AttributionRow {
            catalog_id: "opengc".into(),
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
        upsert_catalog(db.pool(), &opengc_row()).await.unwrap();
        insert_attribution(db.pool(), &messier_attribution()).await.unwrap();
        insert_attribution(db.pool(), &opengc_attribution()).await.unwrap();

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
    async fn opengc_attribution_stores_cc_fields() {
        let db = setup().await;
        upsert_catalog(db.pool(), &opengc_row()).await.unwrap();
        insert_attribution(db.pool(), &opengc_attribution()).await.unwrap();

        let attrs = list_attributions(db.pool(), "opengc").await.unwrap();
        assert_eq!(attrs.len(), 1);
        assert_eq!(attrs[0].author.as_deref(), Some("Mattia Verga"));
        assert_eq!(attrs[0].title.as_deref(), Some("OpenNGC"));
        assert!(attrs[0].license_uri.is_some());
    }
}
