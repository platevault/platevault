//! Resolution cache: read/write, dedupe by SIMBAD oid, source precedence.
//!
//! The local SQLite cache is the durable record (constitution §V). Entries are
//! deduplicated by `simbad_oid` when non-null (spec 035 FR-007); a
//! `user-override` row takes precedence over `resolved`/`seed` and a later
//! SIMBAD resolution MUST NOT overwrite it (FR-014).
//!
//! These functions take a borrowed [`sqlx::SqlitePool`] rather than owning a
//! connection, matching the spec-013 loader ([`crate::load`]) and the
//! `persistence_db` repositories. SQL uses the runtime `sqlx::query` /
//! `sqlx::query_as` API (no compile-time-checked macros), consistent with those
//! siblings. Identities are written to `canonical_target` / `target_alias`
//! (migration 0031).
//!
//! Typeahead prefix/substring search over `target_alias.normalized` is NOT
//! implemented here — that is T010 (US1).

use domain_core::ids::Timestamp;
use sqlx::{SqliteConnection, SqlitePool};
use uuid::Uuid;

use crate::{AliasKind, ObjectType, ResolvedAlias, ResolvedIdentity, TargetSource};
use targeting::identity::target_id_from_designation;

// ── Error ───────────────────────────────────────────────────────────────────────

/// Error type for resolution-cache reads/writes.
#[derive(Debug, thiserror::Error)]
pub enum CacheError {
    /// Underlying SQLite query failure.
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    /// A stored `canonical_target.id` was not a valid UUID.
    #[error("failed to parse target uuid '{0}': {1}")]
    InvalidUuid(String, uuid::Error),
    /// A stored `canonical_target.source` was outside the closed enum.
    #[error("unknown source value in cache: '{0}'")]
    InvalidSource(String),
}

/// Convenience result alias for cache operations.
pub type CacheResult<T> = Result<T, CacheError>;

/// Raw row tuple for a `canonical_target` SELECT (9 columns).
///
/// Order: id, simbad_oid, primary_designation, display_alias,
///        object_type, ra_deg, dec_deg, source, resolved_at.
type CanonicalTargetRow =
    (String, Option<i64>, String, Option<String>, String, f64, f64, String, String);

// ── Read model ────────────────────────────────────────────────────────────────

/// A cached canonical target plus its aliases, as read back from the cache.
///
/// Mirrors [`ResolvedIdentity`] but additionally carries the persisted
/// [`CachedTarget::id`], [`CachedTarget::resolved_at`], and the optional
/// user-set [`CachedTarget::display_alias`] (FR-012 — user-owned, never
/// overwritten by re-resolution).
#[derive(Clone, Debug, PartialEq)]
pub struct CachedTarget {
    /// The persisted `canonical_target.id` (UUIDv5).
    pub id: Uuid,
    /// SIMBAD physical-object id (dedup key) when resolved online.
    pub simbad_oid: Option<i64>,
    /// Canonical display designation.
    pub primary_designation: String,
    /// User-set presentation label; `None` when not set.
    pub display_alias: Option<String>,
    /// Closed object-type enum.
    pub object_type: ObjectType,
    /// ICRS J2000 right ascension in decimal degrees.
    pub ra_deg: f64,
    /// ICRS J2000 declination in decimal degrees.
    pub dec_deg: f64,
    /// Provenance of the stored identity.
    pub source: TargetSource,
    /// RFC 3339 timestamp of the last seed/resolve/override.
    pub resolved_at: String,
    /// All aliases (designations + common names + user-added) for this target.
    pub aliases: Vec<ResolvedAlias>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// The deterministic id a brand-new row would get for `designation`.
#[must_use]
fn derived_id(designation: &str) -> Uuid {
    target_id_from_designation(designation)
}

// ── Reads ───────────────────────────────────────────────────────────────────

/// Load the aliases for a target id, ordered by alias.
async fn load_aliases(pool: &SqlitePool, target_id: &str) -> CacheResult<Vec<ResolvedAlias>> {
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT alias, normalized, kind
         FROM target_alias
         WHERE target_id = ?
         ORDER BY alias ASC",
    )
    .bind(target_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(alias, normalized, kind)| ResolvedAlias {
            alias,
            normalized,
            kind: AliasKind::from_wire(&kind),
        })
        .collect())
}

/// Assemble a [`CachedTarget`] from a `canonical_target` row tuple.
///
/// The tuple is 9 columns: id, simbad_oid, primary_designation, display_alias,
/// object_type, ra_deg, dec_deg, source, resolved_at.
async fn assemble(pool: &SqlitePool, row: CanonicalTargetRow) -> CacheResult<CachedTarget> {
    let (
        id_str,
        simbad_oid,
        primary_designation,
        display_alias,
        object_type,
        ra_deg,
        dec_deg,
        source,
        resolved_at,
    ) = row;
    let id = Uuid::parse_str(&id_str).map_err(|e| CacheError::InvalidUuid(id_str.clone(), e))?;
    let source = TargetSource::from_wire(&source)
        .ok_or_else(|| CacheError::InvalidSource(source.clone()))?;
    let aliases = load_aliases(pool, &id_str).await?;
    Ok(CachedTarget {
        id,
        simbad_oid,
        primary_designation,
        display_alias,
        object_type: ObjectType::from_wire(&object_type),
        ra_deg,
        dec_deg,
        source,
        resolved_at,
        aliases,
    })
}

/// Read a cached target by its persisted id.
///
/// # Errors
///
/// Returns [`CacheError::Database`] on query failure, or [`CacheError::InvalidUuid`] /
/// [`CacheError::InvalidSource`] on a corrupt stored value.
pub async fn get_by_id(pool: &SqlitePool, id: Uuid) -> CacheResult<Option<CachedTarget>> {
    let row: Option<CanonicalTargetRow> = sqlx::query_as(
            "SELECT id, simbad_oid, primary_designation, display_alias, object_type, ra_deg, dec_deg, source, resolved_at
             FROM canonical_target WHERE id = ?",
        )
        .bind(id.to_string())
        .fetch_optional(pool)
        .await?;
    match row {
        None => Ok(None),
        Some(r) => Ok(Some(assemble(pool, r).await?)),
    }
}

/// Read a cached target by its SIMBAD physical-object id (the dedup key).
///
/// # Errors
///
/// Returns [`CacheError::Database`] on query failure, or a parse error on a
/// corrupt stored value.
pub async fn get_by_simbad_oid(
    pool: &SqlitePool,
    simbad_oid: i64,
) -> CacheResult<Option<CachedTarget>> {
    let row: Option<CanonicalTargetRow> = sqlx::query_as(
            "SELECT id, simbad_oid, primary_designation, display_alias, object_type, ra_deg, dec_deg, source, resolved_at
             FROM canonical_target WHERE simbad_oid = ?",
        )
        .bind(simbad_oid)
        .fetch_optional(pool)
        .await?;
    match row {
        None => Ok(None),
        Some(r) => Ok(Some(assemble(pool, r).await?)),
    }
}

/// Read a cached target by a normalized alias (the typeahead match surface).
///
/// `normalized` must already be normalized via [`targeting::normalize::normalize`].
/// This is an exact-alias lookup, NOT a prefix/substring search (that is T010).
///
/// # Errors
///
/// Returns [`CacheError::Database`] on query failure, or a parse error on a
/// corrupt stored value.
pub async fn get_by_normalized(
    pool: &SqlitePool,
    normalized: &str,
) -> CacheResult<Option<CachedTarget>> {
    let target_id: Option<(String,)> =
        sqlx::query_as("SELECT target_id FROM target_alias WHERE normalized = ? LIMIT 1")
            .bind(normalized)
            .fetch_optional(pool)
            .await?;
    match target_id {
        None => Ok(None),
        Some((tid,)) => {
            let uuid =
                Uuid::parse_str(&tid).map_err(|e| CacheError::InvalidUuid(tid.clone(), e))?;
            get_by_id(pool, uuid).await
        }
    }
}

// ── Typeahead search (T010, US1) ────────────────────────────────────────────

/// A single typeahead search hit: the matched canonical target plus the alias
/// that matched and its rank bucket. Ranked best-first by [`search_by_normalized`].
#[derive(Clone, Debug, PartialEq)]
pub struct SearchHit {
    /// The matched canonical target (with all its aliases loaded).
    pub target: CachedTarget,
    /// The display form of the alias that matched the query.
    pub matched_alias: String,
    /// Rank bucket: `0` = exact normalized, `1` = prefix, `2` = substring.
    pub rank: u8,
}

const RANK_EXACT: u8 = 0;
const RANK_PREFIX: u8 = 1;
const RANK_SUBSTRING: u8 = 2;

/// The best matching alias seen so far for one target during search dedup.
struct Best {
    alias: String,
    normalized_len: usize,
    rank: u8,
}

impl Best {
    /// A lower rank wins; ties break on the shorter matched alias.
    fn is_better_than(&self, other: &Self) -> bool {
        (self.rank, self.normalized_len) < (other.rank, other.normalized_len)
    }
}

/// Typeahead search over `target_alias.normalized` (the indexed column),
/// returning distinct canonical targets ranked best-first.
///
/// The incoming `query` is normalized via [`targeting::normalize::normalize`] so it
/// matches the stored `normalized` values. Matching is:
/// - exact normalized (`normalized = q`) → rank 0,
/// - prefix (`normalized LIKE 'q%'`) → rank 1,
/// - substring (`normalized LIKE '%q%'`) → rank 2.
///
/// Results are de-duplicated so one canonical target appears once even if
/// several of its aliases match (its best-ranked alias wins; ties break on the
/// shortest matched alias then designation). The list is capped at `limit`.
///
/// An empty/blank query returns an empty list. This is the local seed+cache
/// surface only — no network (constitution / FR-005).
///
/// # Errors
///
/// Returns [`CacheError::Database`] on query failure, or a parse error on a
/// corrupt stored value.
pub async fn search_by_normalized(
    pool: &SqlitePool,
    query: &str,
    limit: usize,
) -> CacheResult<Vec<SearchHit>> {
    let q = targeting::normalize::normalize(query);
    if q.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }

    // Substring match covers prefix and exact; rank/dedup is decided in Rust.
    // Escape LIKE metacharacters in the user query so they match literally.
    let escaped = q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    let pattern = format!("%{escaped}%");

    // Fetch candidate (target_id, alias, normalized) rows. We over-fetch a
    // bounded multiple of `limit` so dedup across aliases still fills the page;
    // ordering by normalized length favours tighter matches before the cap.
    let fetch_cap = i64::try_from((limit.saturating_mul(8)).clamp(limit, 2000)).unwrap_or(2000);
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT target_id, alias, normalized
         FROM target_alias
         WHERE normalized LIKE ? ESCAPE '\\'
         ORDER BY LENGTH(normalized) ASC, normalized ASC
         LIMIT ?",
    )
    .bind(&pattern)
    .bind(fetch_cap)
    .fetch_all(pool)
    .await?;

    // Pick the best (lowest rank, then shortest alias) hit per target_id.
    let mut best_by_target: std::collections::HashMap<String, Best> =
        std::collections::HashMap::new();
    for (target_id, alias, normalized) in rows {
        let rank = if normalized == q {
            RANK_EXACT
        } else if normalized.starts_with(&q) {
            RANK_PREFIX
        } else {
            RANK_SUBSTRING
        };
        let candidate = Best { alias, normalized_len: normalized.len(), rank };
        match best_by_target.entry(target_id) {
            std::collections::hash_map::Entry::Occupied(mut e) => {
                if candidate.is_better_than(e.get()) {
                    e.insert(candidate);
                }
            }
            std::collections::hash_map::Entry::Vacant(e) => {
                e.insert(candidate);
            }
        }
    }

    // Sort target ids by (rank, alias length, alias) for a stable best-first order.
    let mut ranked: Vec<(String, Best)> = best_by_target.into_iter().collect();
    ranked.sort_by(|(_, a), (_, b)| {
        (a.rank, a.normalized_len, a.alias.as_str()).cmp(&(
            b.rank,
            b.normalized_len,
            b.alias.as_str(),
        ))
    });
    ranked.truncate(limit);

    // Hydrate each winning target (load its full row + aliases).
    let mut hits = Vec::with_capacity(ranked.len());
    for (target_id, best) in ranked {
        let uuid = Uuid::parse_str(&target_id)
            .map_err(|e| CacheError::InvalidUuid(target_id.clone(), e))?;
        if let Some(target) = get_by_id(pool, uuid).await? {
            hits.push(SearchHit { target, matched_alias: best.alias, rank: best.rank });
        }
    }
    Ok(hits)
}

// ── Writes ──────────────────────────────────────────────────────────────────

/// Outcome of an [`upsert_resolved`] call.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UpsertOutcome {
    /// A new canonical_target row was inserted.
    Inserted,
    /// An existing row was updated (matched by oid or derived id).
    Updated,
    /// The write was skipped because an existing `user-override` row takes
    /// precedence (FR-014).
    SkippedUserOverride,
}

/// The result of resolving the target row to upsert against.
struct ExistingRow {
    id: String,
    source: TargetSource,
}

/// Find the row this identity should upsert into.
///
/// Dedup precedence (FR-007): if `simbad_oid` is non-null and a row with that
/// oid exists, that row is the canonical one (keep its id so alias / ingest
/// FKs stay valid). Otherwise fall back to the designation-derived id.
async fn find_existing(
    conn: &mut SqliteConnection,
    identity: &ResolvedIdentity,
    derived: &str,
) -> CacheResult<Option<ExistingRow>> {
    if let Some(oid) = identity.simbad_oid {
        let row: Option<(String, String)> =
            sqlx::query_as("SELECT id, source FROM canonical_target WHERE simbad_oid = ?")
                .bind(oid)
                .fetch_optional(&mut *conn)
                .await?;
        if let Some((id, source)) = row {
            let source = TargetSource::from_wire(&source)
                .ok_or_else(|| CacheError::InvalidSource(source.clone()))?;
            return Ok(Some(ExistingRow { id, source }));
        }
    }
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT id, source FROM canonical_target WHERE id = ?")
            .bind(derived)
            .fetch_optional(&mut *conn)
            .await?;
    match row {
        None => Ok(None),
        Some((id, source)) => {
            let source = TargetSource::from_wire(&source)
                .ok_or_else(|| CacheError::InvalidSource(source.clone()))?;
            Ok(Some(ExistingRow { id, source }))
        }
    }
}

/// Replace all alias rows for `target_id` with `aliases`.
///
/// Aliases are rewritten wholesale (delete + insert) so a re-resolution that
/// adds/removes aliases stays consistent. `INSERT OR IGNORE` tolerates the
/// `(target_id, normalized)` uniqueness constraint when SIMBAD returns the same
/// normalized form twice.
async fn write_aliases(
    conn: &mut SqliteConnection,
    target_id: &str,
    aliases: &[ResolvedAlias],
) -> CacheResult<()> {
    sqlx::query("DELETE FROM target_alias WHERE target_id = ?")
        .bind(target_id)
        .execute(&mut *conn)
        .await?;
    for a in aliases {
        let alias_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT OR IGNORE INTO target_alias (id, target_id, alias, normalized, kind)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&alias_id)
        .bind(target_id)
        .bind(&a.alias)
        .bind(&a.normalized)
        .bind(a.kind.as_wire())
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// Upsert a resolved identity (and its aliases) into the cache.
///
/// Dedup + precedence (FR-007 / FR-014):
/// - The target row is matched by `simbad_oid` when non-null, else by the
///   designation-derived UUIDv5 id. Aliases of one physical object therefore
///   collapse onto one row.
/// - An existing `user-override` row is sticky: an incoming `resolved`/`seed`
///   write is skipped ([`UpsertOutcome::SkippedUserOverride`]) and never
///   overwrites the override. An incoming `user-override` always wins.
/// - Otherwise an equal-or-higher-precedence source overwrites (re-resolving
///   refreshes a `resolved` row; see [`TargetSource::may_overwrite`]).
///
/// Returns the persisted target id and the [`UpsertOutcome`].
///
/// This is the per-call entry point: it acquires a connection from `pool` and
/// delegates to [`upsert_resolved_conn`]. To batch many upserts in a single
/// transaction (e.g. the seed loader), open a transaction and call
/// [`upsert_resolved_conn`] directly with `&mut *tx`.
///
/// # Errors
///
/// Returns [`CacheError::Database`] on query failure, or a parse error when an
/// existing row holds a corrupt value.
pub async fn upsert_resolved(
    pool: &SqlitePool,
    identity: &ResolvedIdentity,
) -> CacheResult<(Uuid, UpsertOutcome)> {
    let mut conn = pool.acquire().await?;
    upsert_resolved_conn(&mut conn, identity).await
}

/// Upsert a resolved identity (and its aliases) onto an existing connection or
/// transaction (`&mut *tx`).
///
/// Dedup + precedence semantics are identical to [`upsert_resolved`]; this
/// variant lets a caller batch many upserts inside one transaction so the whole
/// batch commits with a single fsync (the seed loader uses this).
///
/// # Errors
///
/// Returns [`CacheError::Database`] on query failure, or a parse error when an
/// existing row holds a corrupt value.
pub async fn upsert_resolved_conn(
    conn: &mut SqliteConnection,
    identity: &ResolvedIdentity,
) -> CacheResult<(Uuid, UpsertOutcome)> {
    let derived = derived_id(&identity.primary_designation).to_string();
    let existing = find_existing(&mut *conn, identity, &derived).await?;
    let resolved_at = Timestamp::now_iso();

    match existing {
        Some(row) if !identity.source.may_overwrite(row.source) => {
            // Existing row wins (a user-override is sticky vs resolved/seed).
            let id =
                Uuid::parse_str(&row.id).map_err(|e| CacheError::InvalidUuid(row.id.clone(), e))?;
            Ok((id, UpsertOutcome::SkippedUserOverride))
        }
        Some(row) => {
            // Update in place, keeping the existing id (preserve FK targets).
            // display_alias is NOT included — it is user-owned and must never
            // be overwritten by a re-resolution or seed load (FR-012).
            sqlx::query(
                "UPDATE canonical_target SET
                     simbad_oid          = ?,
                     primary_designation = ?,
                     object_type         = ?,
                     ra_deg              = ?,
                     dec_deg             = ?,
                     source              = ?,
                     resolved_at         = ?
                 WHERE id = ?",
            )
            .bind(identity.simbad_oid)
            .bind(&identity.primary_designation)
            .bind(identity.object_type.as_wire())
            .bind(identity.ra_deg)
            .bind(identity.dec_deg)
            .bind(identity.source.as_wire())
            .bind(&resolved_at)
            .bind(&row.id)
            .execute(&mut *conn)
            .await?;
            write_aliases(&mut *conn, &row.id, &identity.aliases).await?;
            let id =
                Uuid::parse_str(&row.id).map_err(|e| CacheError::InvalidUuid(row.id.clone(), e))?;
            Ok((id, UpsertOutcome::Updated))
        }
        None => {
            sqlx::query(
                "INSERT INTO canonical_target
                     (id, simbad_oid, primary_designation, object_type, ra_deg, dec_deg, source, resolved_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&derived)
            .bind(identity.simbad_oid)
            .bind(&identity.primary_designation)
            .bind(identity.object_type.as_wire())
            .bind(identity.ra_deg)
            .bind(identity.dec_deg)
            .bind(identity.source.as_wire())
            .bind(&resolved_at)
            .execute(&mut *conn)
            .await?;
            write_aliases(&mut *conn, &derived, &identity.aliases).await?;
            let id = Uuid::parse_str(&derived)
                .map_err(|e| CacheError::InvalidUuid(derived.clone(), e))?;
            Ok((id, UpsertOutcome::Inserted))
        }
    }
}

// ── Gen-3 management operations (spec 036) ──────────────────────────────────

/// A minimal list-row for the `target.list` surface.
#[derive(Clone, Debug, PartialEq)]
pub struct TargetListRow {
    pub id: Uuid,
    pub primary_designation: String,
    /// User-set label; `None` when not set. `effectiveLabel = display_alias ?? primary_designation`.
    pub display_alias: Option<String>,
    pub object_type: String,
}

/// List all canonical targets ordered by `primary_designation` (gen-3).
///
/// # Errors
///
/// Returns [`CacheError::Database`] on query failure, or [`CacheError::InvalidUuid`]
/// on a corrupt stored id.
pub async fn list_all(pool: &SqlitePool) -> CacheResult<Vec<TargetListRow>> {
    let rows: Vec<(String, String, Option<String>, String)> = sqlx::query_as(
        "SELECT id, primary_designation, display_alias, object_type
         FROM canonical_target
         ORDER BY primary_designation ASC",
    )
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|(id_str, primary_designation, display_alias, object_type)| {
            let id =
                Uuid::parse_str(&id_str).map_err(|e| CacheError::InvalidUuid(id_str.clone(), e))?;
            Ok(TargetListRow { id, primary_designation, display_alias, object_type })
        })
        .collect()
}

/// Insert a user-added alias for `target_id`.
///
/// The alias is stored with `kind = 'user'`. The `normalized` form is computed
/// here via [`targeting::normalize::normalize`]. Rejects a duplicate via the
/// `UNIQUE(target_id, normalized)` constraint — returns `false` when the alias
/// already exists (idempotent), `true` when newly inserted.
///
/// # Errors
///
/// Returns [`CacheError::Database`] for any failure other than the uniqueness
/// constraint.
pub async fn insert_user_alias(
    pool: &SqlitePool,
    target_id: Uuid,
    alias: &str,
) -> CacheResult<Option<(String, String)>> {
    let normalized = targeting::normalize::normalize(alias);
    if normalized.is_empty() {
        return Ok(None);
    }
    let alias_id = Uuid::new_v4().to_string();
    let target_id_str = target_id.to_string();
    let result = sqlx::query(
        "INSERT OR IGNORE INTO target_alias (id, target_id, alias, normalized, kind)
         VALUES (?, ?, ?, ?, 'user')",
    )
    .bind(&alias_id)
    .bind(&target_id_str)
    .bind(alias)
    .bind(&normalized)
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        // Alias already exists — return the existing id.
        let existing: Option<(String,)> =
            sqlx::query_as("SELECT id FROM target_alias WHERE target_id = ? AND normalized = ?")
                .bind(&target_id_str)
                .bind(&normalized)
                .fetch_optional(pool)
                .await?;
        Ok(existing.map(|(id,)| (id, alias.to_owned())))
    } else {
        Ok(Some((alias_id, alias.to_owned())))
    }
}

/// Delete a user alias by its id, but only if its `kind = 'user'`.
///
/// Returns `true` if a row was deleted, `false` if not found or not a user
/// alias (SIMBAD designations/common names are not removable).
///
/// # Errors
///
/// Returns [`CacheError::Database`] on query failure.
pub async fn delete_user_alias(pool: &SqlitePool, alias_id: &str) -> CacheResult<bool> {
    let result = sqlx::query("DELETE FROM target_alias WHERE id = ? AND kind = 'user'")
        .bind(alias_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// Set the `display_alias` column for a target (FR-012).
///
/// Blank/empty input is stored as NULL (treated as a clear). Returns `true` if
/// the target exists and was updated.
///
/// # Errors
///
/// Returns [`CacheError::Database`] on query failure.
pub async fn set_display_alias(
    pool: &SqlitePool,
    target_id: Uuid,
    display_alias: &str,
) -> CacheResult<bool> {
    let value: Option<&str> =
        if display_alias.trim().is_empty() { None } else { Some(display_alias) };
    let result = sqlx::query("UPDATE canonical_target SET display_alias = ? WHERE id = ?")
        .bind(value)
        .bind(target_id.to_string())
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// Clear the `display_alias` column for a target (sets to NULL).
///
/// Returns `true` if the target exists and was updated.
///
/// # Errors
///
/// Returns [`CacheError::Database`] on query failure.
pub async fn clear_display_alias(pool: &SqlitePool, target_id: Uuid) -> CacheResult<bool> {
    let result = sqlx::query("UPDATE canonical_target SET display_alias = NULL WHERE id = ?")
        .bind(target_id.to_string())
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ::persistence_db::Database;

    async fn setup() -> Database {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        db
    }

    fn m31(source: TargetSource) -> ResolvedIdentity {
        ResolvedIdentity {
            simbad_oid: Some(1_575_544),
            primary_designation: "M 31".to_owned(),
            common_name: Some("Andromeda Galaxy".to_owned()),
            object_type: ObjectType::Galaxy,
            ra_deg: 10.684_708,
            dec_deg: 41.268_75,
            aliases: vec![
                ResolvedAlias::new("M 31", AliasKind::Designation),
                ResolvedAlias::new("NGC 224", AliasKind::Designation),
                ResolvedAlias::new("Andromeda Galaxy", AliasKind::CommonName),
            ],
            source,
        }
    }

    #[tokio::test]
    async fn insert_then_read_by_oid() {
        let db = setup().await;
        let (id, outcome) = upsert_resolved(db.pool(), &m31(TargetSource::Resolved)).await.unwrap();
        assert_eq!(outcome, UpsertOutcome::Inserted);

        let got = get_by_simbad_oid(db.pool(), 1_575_544).await.unwrap().unwrap();
        assert_eq!(got.id, id);
        assert_eq!(got.primary_designation, "M 31");
        assert_eq!(got.object_type, ObjectType::Galaxy);
        assert_eq!(got.source, TargetSource::Resolved);
        assert_eq!(got.aliases.len(), 3);
    }

    #[tokio::test]
    async fn read_by_normalized_alias() {
        let db = setup().await;
        upsert_resolved(db.pool(), &m31(TargetSource::Resolved)).await.unwrap();

        let norm = targeting::normalize::normalize("NGC 224");
        let got = get_by_normalized(db.pool(), &norm).await.unwrap().unwrap();
        assert_eq!(got.primary_designation, "M 31");

        let common = targeting::normalize::normalize("Andromeda Galaxy");
        let got2 = get_by_normalized(db.pool(), &common).await.unwrap().unwrap();
        assert_eq!(got2.id, got.id);
    }

    #[tokio::test]
    async fn dedup_by_oid_updates_single_row() {
        let db = setup().await;
        // First resolve.
        let (id1, _) = upsert_resolved(db.pool(), &m31(TargetSource::Resolved)).await.unwrap();
        // Re-resolve the SAME oid but under a different primary designation
        // (e.g. NGC view); must reuse the existing row, not create a second.
        let mut alt = m31(TargetSource::Resolved);
        alt.primary_designation = "NGC 224".to_owned();
        let (id2, outcome) = upsert_resolved(db.pool(), &alt).await.unwrap();
        assert_eq!(outcome, UpsertOutcome::Updated);
        assert_eq!(id1, id2, "dedup by oid must keep the same row id");

        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM canonical_target")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(count, 1);

        let got = get_by_id(db.pool(), id1).await.unwrap().unwrap();
        assert_eq!(got.primary_designation, "NGC 224");
    }

    #[tokio::test]
    async fn user_override_is_sticky_against_resolved() {
        let db = setup().await;
        // User override first.
        let (id, _) = upsert_resolved(db.pool(), &m31(TargetSource::UserOverride)).await.unwrap();
        // A later SIMBAD resolution must NOT overwrite it (FR-014).
        let mut later = m31(TargetSource::Resolved);
        later.primary_designation = "WRONG".to_owned();
        let (id2, outcome) = upsert_resolved(db.pool(), &later).await.unwrap();
        assert_eq!(outcome, UpsertOutcome::SkippedUserOverride);
        assert_eq!(id, id2);

        let got = get_by_id(db.pool(), id).await.unwrap().unwrap();
        assert_eq!(got.primary_designation, "M 31");
        assert_eq!(got.source, TargetSource::UserOverride);
    }

    #[tokio::test]
    async fn user_override_overwrites_resolved() {
        let db = setup().await;
        upsert_resolved(db.pool(), &m31(TargetSource::Resolved)).await.unwrap();
        let mut override_id = m31(TargetSource::UserOverride);
        override_id.primary_designation = "Andromeda".to_owned();
        let (_, outcome) = upsert_resolved(db.pool(), &override_id).await.unwrap();
        assert_eq!(outcome, UpsertOutcome::Updated);

        let got = get_by_simbad_oid(db.pool(), 1_575_544).await.unwrap().unwrap();
        assert_eq!(got.source, TargetSource::UserOverride);
        assert_eq!(got.primary_designation, "Andromeda");
    }

    #[tokio::test]
    async fn resolved_refreshes_existing_resolved_row() {
        let db = setup().await;
        upsert_resolved(db.pool(), &m31(TargetSource::Resolved)).await.unwrap();
        let mut refreshed = m31(TargetSource::Resolved);
        refreshed.dec_deg = 41.0;
        let (_, outcome) = upsert_resolved(db.pool(), &refreshed).await.unwrap();
        assert_eq!(outcome, UpsertOutcome::Updated);
        let got = get_by_simbad_oid(db.pool(), 1_575_544).await.unwrap().unwrap();
        assert!((got.dec_deg - 41.0).abs() < f64::EPSILON);
    }

    #[tokio::test]
    async fn null_oid_dedups_by_derived_id() {
        let db = setup().await;
        let mut seed = m31(TargetSource::Seed);
        seed.simbad_oid = None;
        let (id1, o1) = upsert_resolved(db.pool(), &seed).await.unwrap();
        assert_eq!(o1, UpsertOutcome::Inserted);
        // Same designation, still no oid → same derived id, updated not inserted.
        let (id2, o2) = upsert_resolved(db.pool(), &seed).await.unwrap();
        assert_eq!(id1, id2);
        assert_eq!(o2, UpsertOutcome::Updated);
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM canonical_target")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn get_missing_returns_none() {
        let db = setup().await;
        assert!(get_by_simbad_oid(db.pool(), 999).await.unwrap().is_none());
        assert!(get_by_normalized(db.pool(), "nothing").await.unwrap().is_none());
        assert!(get_by_id(db.pool(), Uuid::new_v4()).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn aliases_rewritten_on_update() {
        let db = setup().await;
        upsert_resolved(db.pool(), &m31(TargetSource::Resolved)).await.unwrap();
        let mut fewer = m31(TargetSource::Resolved);
        fewer.aliases = vec![ResolvedAlias::new("M 31", AliasKind::Designation)];
        let (id, _) = upsert_resolved(db.pool(), &fewer).await.unwrap();
        let got = get_by_id(db.pool(), id).await.unwrap().unwrap();
        assert_eq!(got.aliases.len(), 1);
    }

    // ── T010: typeahead search ─────────────────────────────────────────────────

    fn m101() -> ResolvedIdentity {
        ResolvedIdentity {
            simbad_oid: Some(3_456_789),
            primary_designation: "M 101".to_owned(),
            common_name: Some("Pinwheel Galaxy".to_owned()),
            object_type: ObjectType::Galaxy,
            ra_deg: 210.802_42,
            dec_deg: 54.348_95,
            aliases: vec![
                ResolvedAlias::new("M 101", AliasKind::Designation),
                ResolvedAlias::new("NGC 5457", AliasKind::Designation),
                ResolvedAlias::new("Pinwheel Galaxy", AliasKind::CommonName),
            ],
            source: TargetSource::Seed,
        }
    }

    async fn seeded(db: &Database) {
        upsert_resolved(db.pool(), &m31(TargetSource::Resolved)).await.unwrap();
        upsert_resolved(db.pool(), &m101()).await.unwrap();
    }

    #[tokio::test]
    async fn search_blank_query_is_empty() {
        let db = setup().await;
        seeded(&db).await;
        assert!(search_by_normalized(db.pool(), "   ", 20).await.unwrap().is_empty());
        assert!(search_by_normalized(db.pool(), "M31", 0).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn search_exact_then_prefix_then_substring_ranking() {
        let db = setup().await;
        // "NGC 5457" (exact for M101), "NGC 224" (M31). Query "ngc 5457" is
        // exact for one alias and substring for none of M31.
        seeded(&db).await;
        let hits = search_by_normalized(db.pool(), "NGC 5457", 20).await.unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].rank, RANK_EXACT);
        assert_eq!(hits[0].target.primary_designation, "M 101");
        assert_eq!(hits[0].matched_alias, "NGC 5457");
    }

    #[tokio::test]
    async fn search_prefix_matches_both_ngc() {
        let db = setup().await;
        seeded(&db).await;
        // "ngc" is a prefix of "NGC 224" and "NGC 5457" → both targets, rank 1.
        let hits = search_by_normalized(db.pool(), "NGC", 20).await.unwrap();
        assert_eq!(hits.len(), 2);
        assert!(hits.iter().all(|h| h.rank == RANK_PREFIX));
    }

    #[tokio::test]
    async fn search_substring_matches_common_name() {
        let db = setup().await;
        seeded(&db).await;
        // "galaxy" appears inside both common names as a substring (rank 2).
        let hits = search_by_normalized(db.pool(), "galaxy", 20).await.unwrap();
        assert_eq!(hits.len(), 2);
        assert!(hits.iter().all(|h| h.rank == RANK_SUBSTRING));
    }

    #[tokio::test]
    async fn search_dedupes_one_hit_per_target() {
        let db = setup().await;
        // A target whose two aliases BOTH match the query must appear once.
        // "Andromeda" and "Andromeda Galaxy" both contain "andromeda".
        let mut t = m31(TargetSource::Resolved);
        t.aliases = vec![
            ResolvedAlias::new("Andromeda", AliasKind::CommonName),
            ResolvedAlias::new("Andromeda Galaxy", AliasKind::CommonName),
        ];
        upsert_resolved(db.pool(), &t).await.unwrap();

        let hits = search_by_normalized(db.pool(), "andromeda", 20).await.unwrap();
        assert_eq!(hits.len(), 1, "one canonical target despite two matching aliases");
        // The best (exact) alias wins as matched_alias.
        assert_eq!(hits[0].rank, RANK_EXACT);
        assert_eq!(hits[0].matched_alias, "Andromeda");
    }

    #[tokio::test]
    async fn search_respects_limit() {
        let db = setup().await;
        seeded(&db).await;
        let hits = search_by_normalized(db.pool(), "galaxy", 1).await.unwrap();
        assert_eq!(hits.len(), 1);
    }

    #[tokio::test]
    async fn search_like_wildcards_are_literal() {
        let db = setup().await;
        seeded(&db).await;
        // "%" must not act as a wildcard — no alias literally contains it.
        let hits = search_by_normalized(db.pool(), "%", 20).await.unwrap();
        assert!(hits.is_empty());
    }
}
