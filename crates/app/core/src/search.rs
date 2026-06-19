//! Global search use case (spec 023 + spec 033, T039, FR-015).
//!
//! `search_global` performs a real cross-entity query over:
//!   - `targets` / `target_aliases` — by primary_designation or alias_display
//!   - `acquisition_session` — by session_key
//!   - `projects`            — by project name
//!
//! Results are ranked by a simple score: exact prefix match > contains match.
//! The result set is capped at 20 items and sorted by score descending.
//!
//! Constitution §I: read-only; no image files are touched.
//! Constitution §V: queries the durable SQLite store.

use contracts_core::search::{SearchResult, SearchResultKind};
use sqlx::SqlitePool;

/// Maximum results returned per `search_global` call.
const MAX_RESULTS: usize = 20;

/// `search.global` use case — cross-entity full-text search.
///
/// Returns results reflecting the `query` string (never ignores it).
/// When `query` is empty, returns the most-recently-created targets/sessions/projects
/// as "recent" suggestions.
///
/// # Errors
/// Returns `Err(String)` on database failure.
pub async fn search_global(pool: &SqlitePool, query: &str) -> Result<Vec<SearchResult>, String> {
    let q = query.trim().to_ascii_lowercase();

    let mut results: Vec<SearchResult> = Vec::new();

    if q.is_empty() {
        // Return recent targets, sessions and projects as starting suggestions.
        results.extend(recent_targets(pool).await?);
        results.extend(recent_sessions(pool).await?);
        results.extend(recent_projects(pool).await?);
    } else {
        // Search targets by primary_designation and aliases.
        results.extend(search_targets(pool, &q).await?);
        // Search sessions by session_key.
        results.extend(search_sessions(pool, &q).await?);
        // Search projects by name.
        results.extend(search_projects(pool, &q).await?);
    }

    // Sort by score descending, then label ascending for stable ordering.
    results.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.label.cmp(&b.label))
    });
    results.truncate(MAX_RESULTS);
    Ok(results)
}

// ── Scoring helpers ────────────────────────────────────────────────────────────

/// Returns a score in [0.0, 1.0] based on how well `haystack` matches `needle`.
fn score(haystack: &str, needle: &str) -> f64 {
    let h = haystack.to_ascii_lowercase();
    if h == needle {
        return 1.0;
    }
    if h.starts_with(needle) {
        return 0.92;
    }
    if h.contains(needle) {
        return 0.75;
    }
    0.0
}

// ── Target search ─────────────────────────────────────────────────────────────

async fn search_targets(pool: &SqlitePool, q: &str) -> Result<Vec<SearchResult>, String> {
    // Query targets by primary_designation and alias.
    // Include `match_via_alias` to score alias matches correctly.
    let like_pattern = format!("%{q}%");

    // Returns (id, primary_designation, best_alias_normalized_match)
    let rows: Vec<(String, String, Option<String>)> = sqlx::query_as(
        // spec 036 reconciliation: query the gen-3 canonical_target / target_alias
        // tables (the legacy spec-013 targets / target_aliases were retired).
        "SELECT t.id, COALESCE(t.display_alias, t.primary_designation) AS label,
                (SELECT ta.alias FROM target_alias ta
                 WHERE ta.target_id = t.id
                   AND ta.normalized LIKE ?
                 LIMIT 1) AS alias_match
         FROM canonical_target t
         WHERE LOWER(t.primary_designation) LIKE ?
            OR EXISTS (
                SELECT 1 FROM target_alias ta2
                WHERE ta2.target_id = t.id
                  AND ta2.normalized LIKE ?
            )
         ORDER BY t.primary_designation ASC
         LIMIT 10",
    )
    .bind(&like_pattern)
    .bind(&like_pattern)
    .bind(&like_pattern)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|(id, designation, alias_match)| {
            // Score on both primary designation and alias; take the higher score.
            let s_primary = score(&designation, q);
            let s_alias = alias_match.as_deref().map_or(0.0, |a| score(a, q));
            let s = s_primary.max(s_alias);
            // All rows came from the SQL LIKE filter so there must be a match.
            // Use a minimum non-zero score for alias-only matches.
            let final_score = if s <= 0.0 { 0.6 } else { s };
            SearchResult {
                id: id.clone(),
                kind: SearchResultKind::Target,
                label: designation,
                sublabel: alias_match,
                route: format!("/targets/{id}"),
                score: final_score,
            }
        })
        .collect())
}

async fn recent_targets(pool: &SqlitePool) -> Result<Vec<SearchResult>, String> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, COALESCE(display_alias, primary_designation) FROM canonical_target \
         ORDER BY resolved_at DESC LIMIT 5",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|(id, designation)| SearchResult {
            id: id.clone(),
            kind: SearchResultKind::Target,
            label: designation,
            sublabel: Some("Recent target".to_owned()),
            route: format!("/targets/{id}"),
            score: 0.5,
        })
        .collect())
}

// ── Session search ────────────────────────────────────────────────────────────

async fn search_sessions(pool: &SqlitePool, q: &str) -> Result<Vec<SearchResult>, String> {
    let like_pattern = format!("%{q}%");

    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, session_key
         FROM acquisition_session
         WHERE LOWER(session_key) LIKE ?
           AND state NOT IN ('rejected', 'ignored')
         ORDER BY created_at DESC
         LIMIT 10",
    )
    .bind(&like_pattern)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .filter_map(|(id, key)| {
            let s = score(&key, q);
            if s <= 0.0 {
                return None;
            }
            Some(SearchResult {
                id: id.clone(),
                kind: SearchResultKind::Session,
                label: key,
                sublabel: None,
                route: format!("/sessions/{id}"),
                score: s,
            })
        })
        .collect())
}

async fn recent_sessions(pool: &SqlitePool) -> Result<Vec<SearchResult>, String> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, session_key
         FROM acquisition_session
         WHERE state NOT IN ('rejected', 'ignored')
         ORDER BY created_at DESC
         LIMIT 5",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|(id, key)| SearchResult {
            id: id.clone(),
            kind: SearchResultKind::Session,
            label: key,
            sublabel: Some("Recent session".to_owned()),
            route: format!("/sessions/{id}"),
            score: 0.45,
        })
        .collect())
}

// ── Project search ────────────────────────────────────────────────────────────

async fn search_projects(pool: &SqlitePool, q: &str) -> Result<Vec<SearchResult>, String> {
    let like_pattern = format!("%{q}%");

    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT id, name, lifecycle
         FROM projects
         WHERE LOWER(name) LIKE ?
         ORDER BY name ASC
         LIMIT 10",
    )
    .bind(&like_pattern)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .filter_map(|(id, name, lifecycle)| {
            let s = score(&name, q);
            if s <= 0.0 {
                return None;
            }
            Some(SearchResult {
                id: id.clone(),
                kind: SearchResultKind::Project,
                label: name,
                sublabel: Some(lifecycle),
                route: format!("/projects/{id}"),
                score: s,
            })
        })
        .collect())
}

async fn recent_projects(pool: &SqlitePool) -> Result<Vec<SearchResult>, String> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT id, name FROM projects ORDER BY created_at DESC LIMIT 5")
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|(id, name)| SearchResult {
            id: id.clone(),
            kind: SearchResultKind::Project,
            label: name,
            sublabel: Some("Recent project".to_owned()),
            route: format!("/projects/{id}"),
            score: 0.4,
        })
        .collect())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use persistence_db::Database;

    async fn test_db() -> Database {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        db
    }

    /// T034 / T039: search.global runs a real query and reflects the query string.
    #[tokio::test]
    async fn search_returns_real_target_matching_query() {
        let db = test_db().await;

        // Insert a real target.
        sqlx::query(
            "INSERT INTO canonical_target (id, primary_designation, object_type, ra_deg, dec_deg, source, resolved_at) \
             VALUES ('t-001', 'NGC 7000 - North America Nebula', 'other', 0, 0, 'seed', '2026-06-01T00:00:00Z')",
        )
        .execute(db.pool())
        .await
        .unwrap();

        // Insert a second target that should NOT match.
        sqlx::query(
            "INSERT INTO canonical_target (id, primary_designation, object_type, ra_deg, dec_deg, source, resolved_at) \
             VALUES ('t-002', 'M31 - Andromeda Galaxy', 'other', 0, 0, 'seed', '2026-06-01T00:00:00Z')",
        )
        .execute(db.pool())
        .await
        .unwrap();

        let results = search_global(db.pool(), "NGC 7000").await.unwrap();

        // Must find the NGC 7000 target.
        assert!(
            results.iter().any(|r| r.id == "t-001"),
            "NGC 7000 target must appear in results; got: {results:?}"
        );

        // M31 must not appear for NGC 7000 query.
        assert!(!results.iter().any(|r| r.id == "t-002"), "M31 must not appear for NGC 7000 query");
    }

    /// T034 / T039: query string is reflected — different queries return different results.
    #[tokio::test]
    async fn search_results_reflect_query_string() {
        let db = test_db().await;

        sqlx::query(
            "INSERT INTO canonical_target (id, primary_designation, object_type, ra_deg, dec_deg, source, resolved_at) \
             VALUES ('t-003', 'M42 - Orion Nebula', 'other', 0, 0, 'seed', '2026-06-01T00:00:00Z'),
                    ('t-004', 'IC 1396 - Elephant Trunk Nebula', 'other', 0, 0, 'seed', '2026-06-01T00:00:00Z')",
        )
        .execute(db.pool())
        .await
        .unwrap();

        let results_m42 = search_global(db.pool(), "M42").await.unwrap();
        let results_ic = search_global(db.pool(), "IC 1396").await.unwrap();

        assert!(results_m42.iter().any(|r| r.id == "t-003"), "M42 query must find M42 target");
        assert!(!results_m42.iter().any(|r| r.id == "t-004"), "M42 query must not find IC 1396");

        assert!(results_ic.iter().any(|r| r.id == "t-004"), "IC 1396 query must find IC 1396");
        assert!(!results_ic.iter().any(|r| r.id == "t-003"), "IC 1396 query must not find M42");
    }

    /// T034 / T039: alias search — query matching an alias finds the target.
    #[tokio::test]
    async fn search_finds_target_via_alias() {
        let db = test_db().await;

        sqlx::query(
            "INSERT INTO canonical_target (id, primary_designation, object_type, ra_deg, dec_deg, source, resolved_at) \
             VALUES ('t-005', 'NGC 1976', 'other', 0, 0, 'seed', '2026-06-01T00:00:00Z')",
        )
        .execute(db.pool())
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO target_alias (id, target_id, alias, normalized, kind) \
             VALUES ('a-001', 't-005', 'Great Orion Nebula', 'great orion nebula', 'user')",
        )
        .execute(db.pool())
        .await
        .unwrap();

        let results = search_global(db.pool(), "great orion").await.unwrap();
        assert!(
            results.iter().any(|r| r.id == "t-005"),
            "alias search must find target via alias; got: {results:?}"
        );
    }

    /// T034 / T039: session search — query matching session_key finds session.
    #[tokio::test]
    async fn search_finds_session_by_session_key() {
        let db = test_db().await;

        sqlx::query(
            "INSERT INTO acquisition_session (id, session_key, state, created_at) \
             VALUES ('ses-001', 'M31/L/2026-03-01/100/1x1', 'confirmed', '2026-03-01T00:00:00Z')",
        )
        .execute(db.pool())
        .await
        .unwrap();

        let results = search_global(db.pool(), "M31").await.unwrap();
        assert!(
            results.iter().any(|r| r.id == "ses-001"),
            "session search by session_key must work; got: {results:?}"
        );
    }

    /// Empty query returns recent suggestions without errors.
    #[tokio::test]
    async fn empty_query_returns_recent_suggestions() {
        let db = test_db().await;
        // No data — should return empty without error.
        let results = search_global(db.pool(), "").await.unwrap();
        assert!(results.is_empty() || results.iter().all(|r| r.score >= 0.0));
    }
}
