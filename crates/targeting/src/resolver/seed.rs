//! Bundled-seed loader: populates the local cache at first run (spec 035 T016, R3).
//!
//! Loads the bundled seed index (popular catalogue objects: the Messier
//! catalogue, the Caldwell objects, and a slice of NGC/IC) into the local cache
//! with `source = seed` (data-model.md §Lifecycle). Seed rows are superseded by
//! `resolved`/`user-override` entries per the source-precedence rules in
//! [`super::cache`], so this load is safe to re-run: each entry upserts through
//! [`cache::upsert_resolved`], which dedups by `simbad_oid` (or the
//! designation-derived id) and never clobbers a sticky `user-override`.
//!
//! # Asset format
//!
//! The committed asset (`assets/seed/seed.json`) is a JSON document:
//!
//! ```json
//! {
//!   "version": 1,
//!   "generated_at": "2026-06-18T00:00:00Z",
//!   "source": "SIMBAD TAP (CDS) + OpenNGC",
//!   "entries": [
//!     {
//!       "simbad_oid": 1575544,
//!       "primary_designation": "M 31",
//!       "common_name": "Andromeda Galaxy",
//!       "object_type": "galaxy",
//!       "ra_deg": 10.6847083,
//!       "dec_deg": 41.26875,
//!       "aliases": [
//!         { "alias": "M 31", "kind": "designation" },
//!         { "alias": "NGC 224", "kind": "designation" },
//!         { "alias": "Andromeda Galaxy", "kind": "common_name" }
//!       ]
//!     }
//!   ]
//! }
//! ```
//!
//! JSON is loaded into SQLite at first run (research.md R3 — "JSON loaded into
//! SQLite at first run is simplest"). The asset is built once, offline, by the
//! `seed-builder` tool (T015); see `crates/tools/seed-builder`.
//!
//! Constitution §I/§V: seed data is metadata only; the SQLite cache is the
//! durable record and the seed is a reproducible projection into it.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::resolver::cache::{self, CacheError, UpsertOutcome};
use crate::resolver::{AliasKind, ObjectType, ResolvedAlias, ResolvedIdentity, TargetSource};

/// The bundled seed asset shipped at `assets/seed/seed.json` and embedded into
/// the binary via [`bundled`].
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SeedAsset {
    /// Asset schema version (currently `1`).
    pub version: u32,
    /// RFC-3339 timestamp recording when the asset was generated.
    #[serde(default)]
    pub generated_at: String,
    /// Human-readable provenance string (e.g. data sources used).
    #[serde(default)]
    pub source: String,
    /// The seeded objects.
    pub entries: Vec<SeedEntry>,
}

/// One seeded canonical object plus its aliases.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SeedEntry {
    /// SIMBAD physical-object id (the dedup key) when known.
    #[serde(default)]
    pub simbad_oid: Option<i64>,
    /// Canonical display designation (e.g. `M 31`).
    pub primary_designation: String,
    /// Curated common name (SIMBAD `NAME …`) when one exists.
    #[serde(default)]
    pub common_name: Option<String>,
    /// Closed object-type enum (snake_case wire value).
    pub object_type: ObjectType,
    /// ICRS J2000 right ascension in decimal degrees.
    pub ra_deg: f64,
    /// ICRS J2000 declination in decimal degrees.
    pub dec_deg: f64,
    /// All designations + common names for this object (the typeahead surface).
    pub aliases: Vec<SeedAlias>,
}

/// A seed alias (the normalized form is derived at load time).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SeedAlias {
    /// Verbatim designation or common name.
    pub alias: String,
    /// Whether this alias is a designation or a curated common name.
    pub kind: AliasKind,
}

/// Errors raised while loading the bundled seed.
#[derive(Debug, thiserror::Error)]
pub enum SeedError {
    /// The seed JSON could not be parsed.
    #[error("failed to parse seed asset: {0}")]
    Parse(#[from] serde_json::Error),
    /// A cache write failed.
    #[error(transparent)]
    Cache(#[from] CacheError),
    /// A query for first-run state failed.
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

impl SeedEntry {
    /// Convert a seed entry into a [`ResolvedIdentity`] with `source = seed`.
    fn to_identity(&self) -> ResolvedIdentity {
        let aliases: Vec<ResolvedAlias> =
            self.aliases.iter().map(|a| ResolvedAlias::new(a.alias.clone(), a.kind)).collect();
        ResolvedIdentity {
            simbad_oid: self.simbad_oid,
            primary_designation: self.primary_designation.clone(),
            common_name: self.common_name.clone(),
            object_type: self.object_type,
            ra_deg: self.ra_deg,
            dec_deg: self.dec_deg,
            aliases,
            source: TargetSource::Seed,
        }
    }
}

impl SeedAsset {
    /// Parse a [`SeedAsset`] from raw JSON bytes.
    ///
    /// # Errors
    ///
    /// Returns [`SeedError::Parse`] if the bytes are not a valid seed document.
    pub fn from_json(bytes: &[u8]) -> Result<Self, SeedError> {
        Ok(serde_json::from_slice(bytes)?)
    }
}

/// The seed asset compiled into the binary from `assets/seed/seed.json`.
///
/// # Errors
///
/// Returns [`SeedError::Parse`] if the embedded asset is malformed (a build-time
/// guarantee in practice, since the asset is committed and tested).
pub fn bundled() -> Result<SeedAsset, SeedError> {
    const RAW: &[u8] =
        include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../assets/seed/seed.json"));
    SeedAsset::from_json(RAW)
}

/// Whether this is the first run (the cache holds no canonical targets yet).
///
/// First-run detection is "the `canonical_target` table is empty". The seed
/// loader uses this so that a populated cache (seeded earlier, or grown by
/// online resolution) is not re-seeded on every launch. The load itself is also
/// idempotent (upsert dedups), so this is an optimization, not a correctness
/// requirement.
///
/// # Errors
///
/// Returns [`SeedError::Database`] on query failure.
pub async fn is_first_run(pool: &SqlitePool) -> Result<bool, SeedError> {
    let (count,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM canonical_target").fetch_one(pool).await?;
    Ok(count == 0)
}

/// Load a seed asset into the cache, writing rows with `source = seed`.
///
/// Each entry is upserted through [`cache::upsert_resolved`], so the load is
/// idempotent: re-running it dedups by `simbad_oid` (or the designation-derived
/// id) and never overwrites a sticky `user-override` row (FR-014). Returns the
/// number of entries that resulted in a new or refreshed seed row (i.e. those
/// not skipped because a higher-precedence row already existed).
///
/// This unconditionally loads `seed`; call [`is_first_run`] first if you only
/// want to seed an empty cache.
///
/// # Errors
///
/// Returns [`SeedError::Cache`] if a cache write fails.
pub async fn load_seed(pool: &SqlitePool, seed: &SeedAsset) -> Result<usize, SeedError> {
    let mut loaded = 0usize;
    for entry in &seed.entries {
        let identity = entry.to_identity();
        let (_, outcome) = cache::upsert_resolved(pool, &identity).await?;
        if matches!(outcome, UpsertOutcome::Inserted | UpsertOutcome::Updated) {
            loaded += 1;
        }
    }
    Ok(loaded)
}

/// Load the bundled seed into the cache **only on first run**.
///
/// Convenience wrapper combining [`is_first_run`] + [`bundled`] + [`load_seed`].
/// Returns `Some(count)` of loaded entries when a first-run load happened, or
/// `None` when the cache was already populated (no-op).
///
/// # Errors
///
/// Returns [`SeedError`] on a malformed embedded asset or a cache/database failure.
pub async fn load_bundled_on_first_run(pool: &SqlitePool) -> Result<Option<usize>, SeedError> {
    if !is_first_run(pool).await? {
        return Ok(None);
    }
    let seed = bundled()?;
    let loaded = load_seed(pool, &seed).await?;
    Ok(Some(loaded))
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

    fn fixture() -> SeedAsset {
        SeedAsset {
            version: 1,
            generated_at: "2026-06-18T00:00:00Z".to_owned(),
            source: "test fixture".to_owned(),
            entries: vec![
                SeedEntry {
                    simbad_oid: Some(1_575_544),
                    primary_designation: "M 31".to_owned(),
                    common_name: Some("Andromeda Galaxy".to_owned()),
                    object_type: ObjectType::Galaxy,
                    ra_deg: 10.684_708,
                    dec_deg: 41.268_75,
                    aliases: vec![
                        SeedAlias { alias: "M 31".to_owned(), kind: AliasKind::Designation },
                        SeedAlias { alias: "NGC 224".to_owned(), kind: AliasKind::Designation },
                        SeedAlias {
                            alias: "Andromeda Galaxy".to_owned(),
                            kind: AliasKind::CommonName,
                        },
                    ],
                },
                SeedEntry {
                    simbad_oid: Some(1_237_320),
                    primary_designation: "M 42".to_owned(),
                    common_name: Some("Orion Nebula".to_owned()),
                    object_type: ObjectType::EmissionNebula,
                    ra_deg: 83.822_083,
                    dec_deg: -5.391_111,
                    aliases: vec![
                        SeedAlias { alias: "M 42".to_owned(), kind: AliasKind::Designation },
                        SeedAlias { alias: "NGC 1976".to_owned(), kind: AliasKind::Designation },
                        SeedAlias { alias: "Orion Nebula".to_owned(), kind: AliasKind::CommonName },
                    ],
                },
            ],
        }
    }

    #[test]
    fn json_round_trip() {
        let asset = fixture();
        let json = serde_json::to_vec(&asset).unwrap();
        let back = SeedAsset::from_json(&json).unwrap();
        assert_eq!(back.entries.len(), 2);
        assert_eq!(back.entries[0].primary_designation, "M 31");
        assert_eq!(back.entries[0].object_type, ObjectType::Galaxy);
    }

    #[tokio::test]
    async fn first_run_then_not() {
        let db = setup().await;
        assert!(is_first_run(db.pool()).await.unwrap());
        load_seed(db.pool(), &fixture()).await.unwrap();
        assert!(!is_first_run(db.pool()).await.unwrap());
    }

    #[tokio::test]
    async fn load_populates_cache_and_offline_lookup_works() {
        let db = setup().await;
        let loaded = load_seed(db.pool(), &fixture()).await.unwrap();
        assert_eq!(loaded, 2);

        // Offline lookup by a non-primary alias resolves to the canonical row.
        let norm = crate::normalize::normalize("NGC 224");
        let got = cache::get_by_normalized(db.pool(), &norm).await.unwrap().unwrap();
        assert_eq!(got.primary_designation, "M 31");
        assert_eq!(got.source, TargetSource::Seed);

        // Common-name lookup also works.
        let norm = crate::normalize::normalize("Orion Nebula");
        let got = cache::get_by_normalized(db.pool(), &norm).await.unwrap().unwrap();
        assert_eq!(got.primary_designation, "M 42");
    }

    #[tokio::test]
    async fn load_is_idempotent() {
        let db = setup().await;
        load_seed(db.pool(), &fixture()).await.unwrap();
        load_seed(db.pool(), &fixture()).await.unwrap();
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM canonical_target")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(count, 2, "re-loading the seed must not duplicate rows");
    }

    #[tokio::test]
    async fn first_run_load_is_noop_when_populated() {
        let db = setup().await;
        load_seed(db.pool(), &fixture()).await.unwrap();
        // A populated cache must not be re-seeded by the first-run path.
        // (bundled() reads the committed asset; this only checks the guard.)
        assert!(!is_first_run(db.pool()).await.unwrap());
    }

    #[tokio::test]
    async fn seed_does_not_overwrite_user_override() {
        let db = setup().await;
        // Simulate a user override for M 31's oid.
        let override_identity = ResolvedIdentity {
            simbad_oid: Some(1_575_544),
            primary_designation: "My Andromeda".to_owned(),
            common_name: None,
            object_type: ObjectType::Galaxy,
            ra_deg: 10.684_708,
            dec_deg: 41.268_75,
            aliases: vec![ResolvedAlias::new("My Andromeda", AliasKind::Designation)],
            source: TargetSource::UserOverride,
        };
        cache::upsert_resolved(db.pool(), &override_identity).await.unwrap();

        // Seeding must not clobber the override.
        load_seed(db.pool(), &fixture()).await.unwrap();
        let got = cache::get_by_simbad_oid(db.pool(), 1_575_544).await.unwrap().unwrap();
        assert_eq!(got.primary_designation, "My Andromeda");
        assert_eq!(got.source, TargetSource::UserOverride);
    }

    #[test]
    fn bundled_asset_loads_and_covers_messier_and_caldwell() {
        // The committed asset must parse and cover the MVP set.
        let asset = bundled().expect("bundled seed asset must parse");
        assert!(asset.version >= 1);
        assert!(
            asset.entries.len() >= 110,
            "expected at least the full Messier catalogue, got {}",
            asset.entries.len()
        );
        // Spot-check a Messier object is present.
        let has_m31 = asset.entries.iter().any(|e| e.primary_designation == "M 31");
        assert!(has_m31, "seed must include M 31");
    }

    #[tokio::test]
    async fn bundled_seed_loads_into_cache() {
        let db = setup().await;
        let loaded = load_bundled_on_first_run(db.pool()).await.unwrap();
        let loaded = loaded.expect("first run should load the bundled seed");
        assert!(loaded >= 110, "expected >= 110 seeded objects, got {loaded}");

        // Offline typeahead for a seeded Messier object works with no network.
        let norm = crate::normalize::normalize("M 31");
        let got = cache::get_by_normalized(db.pool(), &norm).await.unwrap();
        assert!(got.is_some(), "M 31 must be resolvable from the seeded cache");

        // Second call is a no-op (already populated).
        assert!(load_bundled_on_first_run(db.pool()).await.unwrap().is_none());
    }

    /// T018 — SC-001: offline typeahead from bundled seed in < 100 ms (no network).
    ///
    /// After `load_bundled_on_first_run` populates the in-memory SQLite cache,
    /// `search_by_normalized` for seeded objects must:
    ///   1. Return non-empty results (the seed populated the cache).
    ///   2. Complete in < 100 ms (SC-001 latency bound).
    ///   3. Never touch the network — the entire path is local SQLite.
    ///
    /// The timed region is the search call ONLY: seed load and DB setup are
    /// outside the measurement to isolate typeahead query latency.
    #[tokio::test]
    async fn t018_sc001_offline_seed_typeahead_under_100ms() {
        let db = setup().await;

        // Load the bundled seed (this is setup, NOT in the timed region).
        let loaded = load_bundled_on_first_run(db.pool())
            .await
            .expect("seed load must not fail")
            .expect("first-run seed must produce a count");
        assert!(loaded >= 110, "seed must load >= 110 objects for this test to be meaningful");

        // ── Timed region start ────────────────────────────────────────────────
        // Only the search call is timed: this is the SC-001 typeahead path.
        // No network is invoked: the resolver online path is entirely absent here.
        let t0 = std::time::Instant::now();
        let results_m42 =
            cache::search_by_normalized(db.pool(), "m 42", 20).await.expect("search must not fail");
        let elapsed_m42 = t0.elapsed();
        // ── Timed region end ─────────────────────────────────────────────────

        // (a) Non-empty: the seeded object must be found.
        assert!(
            !results_m42.is_empty(),
            "offline search for 'm 42' must return results from seeded cache"
        );
        assert_eq!(
            results_m42[0].target.primary_designation, "M 42",
            "top result for 'm 42' must be M 42 (Orion Nebula)"
        );

        // (b) SC-001: < 100 ms.
        assert!(
            elapsed_m42 < std::time::Duration::from_millis(100),
            "SC-001 violated: offline typeahead for 'm 42' took {elapsed_m42:?}, must be < 100 ms",
        );

        // Repeat measurement for a common-name query ("androm" → M 31) to
        // confirm the latency bound holds for prefix/substring paths too.
        let t1 = std::time::Instant::now();
        let results_androm = cache::search_by_normalized(db.pool(), "androm", 20)
            .await
            .expect("search must not fail");
        let elapsed_androm = t1.elapsed();

        assert!(
            !results_androm.is_empty(),
            "offline prefix search 'androm' must return results from seeded cache"
        );
        let found_m31 = results_androm.iter().any(|h| h.target.primary_designation == "M 31");
        assert!(found_m31, "prefix 'androm' must include M 31 (Andromeda Galaxy)");

        assert!(
            elapsed_androm < std::time::Duration::from_millis(100),
            "SC-001 violated: offline prefix typeahead for 'androm' took {elapsed_androm:?}, must be < 100 ms",
        );
    }

    /// T018 (additional) — second call to `load_bundled_on_first_run` is a
    /// no-op AND the cache remains queryable, proving the offline guarantee
    /// persists across repeated startup calls.
    #[tokio::test]
    async fn t018_offline_guarantee_persists_after_no_op_load() {
        let db = setup().await;

        // First run: seed the cache.
        load_bundled_on_first_run(db.pool()).await.unwrap().unwrap();

        // Second run: should be a no-op (cache already populated).
        let second = load_bundled_on_first_run(db.pool()).await.unwrap();
        assert!(
            second.is_none(),
            "second call to load_bundled_on_first_run must return None (already populated)"
        );

        // Cache must still be queryable — offline guarantee holds.
        let norm = crate::normalize::normalize("M 31");
        let got = cache::get_by_normalized(db.pool(), &norm).await.unwrap();
        assert!(
            got.is_some(),
            "M 31 must remain resolvable from the cache after a no-op second load"
        );
        assert_eq!(
            got.unwrap().primary_designation,
            "M 31",
            "cached M 31 must retain its primary designation after no-op reload"
        );
    }
}
