// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Bundled-seed loader: warms the persistent redb resolve cache at first run
//! (spec 035 T016/R3; retargeted to redb by spec 052 P1 D2/D4/T012).
//!
//! Loads the bundled seed index (popular catalogue objects: the Messier
//! catalogue, the Caldwell objects, and a slice of NGC/IC) into the shared
//! [`crate::simbad::ResolveCache`] with `source = seed`. Seed rows are
//! superseded by `resolved`/`user-override` entries per the source-precedence
//! rules the crate's own [`simbad_resolver::Cache::upsert`] enforces, so this
//! load is safe to re-run.
//!
//! The redb cache is a **reproducible projection** (constitution §V) — it is
//! never the durable record. `canonical_target` in SQLite stays durable and is
//! written ONLY at an in-use commit ([`crate::cache::upsert_resolved`]); this
//! module also lazily copies any EXISTING durable rows into the cache
//! ([`warm_from_canonical_target`]) so targets adopted by a prior app version
//! (or a different machine sharing the SQLite file) still participate in
//! typeahead/search.
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
//!       "v_mag": 3.44,
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
//! `v_mag` is optional (`#[serde(default)]`) since not every SIMBAD object
//! carries `allfluxes.V` photometry (galaxies and pure nebulae are frequently
//! `None`; see `bundled_asset_has_v_mag_coverage` for the measured
//! per-object-type split). The committed asset was regenerated after the
//! seed-builder V-magnitude fix (spec 052 P1 T003, #684) landed — see #696.
//!
//! The asset is built once, offline, by the `seed-builder` tool; see
//! `crates/tools/seed-builder`.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;

use simbad_resolver::{Cache, CacheError};

use crate::{AliasKind, ObjectType, TargetSource};

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
    /// Johnson V-band apparent magnitude, when the seed-builder pull found V
    /// photometry (spec 052 P1 T003). `#[serde(default)]` so entries written by
    /// the pre-052 seed-builder still parse (as `None`).
    #[serde(default)]
    pub v_mag: Option<f64>,
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
    /// A query against the durable `canonical_target` table failed (used only
    /// by [`warm_from_canonical_target`]'s lazy backfill).
    #[error(transparent)]
    Sqlite(#[from] crate::cache::CacheError),
}

impl SeedEntry {
    /// Convert a seed entry into a crate [`simbad_resolver::ResolvedIdentity`]
    /// with `source = seed`, ready for [`simbad_resolver::Cache::upsert`].
    fn to_crate_identity(&self) -> simbad_resolver::ResolvedIdentity {
        let aliases: Vec<simbad_resolver::ResolvedAlias> = self
            .aliases
            .iter()
            .map(|a| {
                simbad_resolver::ResolvedAlias::new(a.alias.clone(), to_crate_alias_kind(a.kind))
            })
            .collect();
        simbad_resolver::ResolvedIdentity {
            simbad_oid: self.simbad_oid,
            primary_designation: self.primary_designation.clone(),
            common_name: self.common_name.clone(),
            object_type: to_crate_object_type(self.object_type),
            otype_raw: String::new(),
            ra_deg: self.ra_deg,
            dec_deg: self.dec_deg,
            v_mag: self.v_mag,
            aliases,
            source: simbad_resolver::TargetSource::Seed,
        }
    }
}

fn to_crate_alias_kind(k: AliasKind) -> simbad_resolver::AliasKind {
    match k {
        AliasKind::Designation => simbad_resolver::AliasKind::Designation,
        AliasKind::CommonName => simbad_resolver::AliasKind::CommonName,
        AliasKind::User => simbad_resolver::AliasKind::User,
    }
}

fn to_crate_object_type(o: ObjectType) -> simbad_resolver::ObjectType {
    simbad_resolver::ObjectType::from_wire(o.as_wire())
}

fn to_crate_source(s: TargetSource) -> simbad_resolver::TargetSource {
    match s {
        TargetSource::Seed => simbad_resolver::TargetSource::Seed,
        TargetSource::Resolved => simbad_resolver::TargetSource::Resolved,
        TargetSource::UserOverride => simbad_resolver::TargetSource::UserOverride,
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
    // spec 042 (T250): this crate moved one level deeper (crates/targeting →
    // crates/targeting/resolver), so the repo-root `assets/seed/seed.json` is
    // now three `..` hops up instead of two.
    const RAW: &[u8] =
        include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../assets/seed/seed.json"));
    SeedAsset::from_json(RAW)
}

/// Whether the redb cache is empty (first run — spec 052 P1 D2/T012).
///
/// An empty cache means neither the bundled seed nor any durable
/// `canonical_target` row has been warmed into it yet. The warm itself is
/// idempotent (upsert dedups), so this is an optimization, not a correctness
/// requirement.
///
/// # Errors
///
/// Returns [`SeedError::Cache`] on a cache backend failure.
pub async fn is_first_run(cache: &dyn Cache) -> Result<bool, SeedError> {
    Ok(cache.list().await?.is_empty())
}

/// Warm the redb cache from a seed asset, writing rows with `source = seed`.
///
/// Entries are upserted in one call to [`simbad_resolver::Cache::upsert_batch`]
/// (a single backend write transaction for the whole batch, rather than one
/// per entry — spec 052 P4/#695), so the warm is idempotent: re-running it
/// dedups by `simbad_oid` (or the designation-derived id) and never overwrites
/// a sticky `user-override` row. Returns the number of entries that resulted
/// in a new or refreshed cache row.
///
/// `namespace` MUST be the same id-namespace the production facade uses
/// ([`crate::simbad`]'s `"astro-plan.targets"` seed) so warmed ids match the
/// ids a later in-use promotion writes to SQLite.
///
/// This unconditionally warms `seed`; call [`is_first_run`] first if you only
/// want to seed an empty cache.
///
/// # Errors
///
/// Returns [`SeedError::Cache`] if a cache write fails.
pub async fn warm_cache(
    cache: &dyn Cache,
    seed: &SeedAsset,
    namespace: &Uuid,
) -> Result<usize, SeedError> {
    let identities: Vec<simbad_resolver::ResolvedIdentity> =
        seed.entries.iter().map(SeedEntry::to_crate_identity).collect();
    let results = cache.upsert_batch(&identities, namespace).await?;
    let loaded = results
        .iter()
        .filter(|(_, outcome)| {
            !matches!(outcome, simbad_resolver::UpsertOutcome::SkippedUserOverride)
        })
        .count();
    Ok(loaded)
}

/// Warm the redb cache from the bundled seed **only when the cache is empty**.
///
/// Convenience wrapper combining [`is_first_run`] + [`bundled`] +
/// [`warm_cache`]. Returns `Some(count)` of warmed entries when a first-run
/// warm happened, or `None` when the cache was already populated (no-op).
///
/// # Errors
///
/// Returns [`SeedError`] on a malformed embedded asset or a cache failure.
pub async fn warm_bundled_on_first_run(
    cache: &dyn Cache,
    namespace: &Uuid,
) -> Result<Option<usize>, SeedError> {
    if !is_first_run(cache).await? {
        return Ok(None);
    }
    let seed = bundled()?;
    let loaded = warm_cache(cache, &seed, namespace).await?;
    Ok(Some(loaded))
}

/// Lazily copy every durable `canonical_target` row into the redb cache
/// (spec 052 P1 T012 — "warm ... lazily from existing canonical_target
/// rows"), so targets already adopted (in a prior app version, or a shared
/// SQLite file) participate in typeahead/search without waiting for a
/// re-resolve. A no-op when SQLite holds no rows. Idempotent (upsert dedups);
/// safe to call on every startup.
///
/// # Errors
///
/// Returns [`SeedError::Sqlite`] on a SQLite read failure, or
/// [`SeedError::Cache`] on a cache write failure.
pub async fn warm_from_canonical_target(
    cache: &dyn Cache,
    pool: &SqlitePool,
    namespace: &Uuid,
) -> Result<usize, SeedError> {
    let rows = crate::cache::list_all(pool).await?;
    let mut identities = Vec::with_capacity(rows.len());
    for row in rows {
        let Some(durable) = crate::cache::get_by_id(pool, row.id).await? else { continue };
        identities.push(simbad_resolver::ResolvedIdentity {
            simbad_oid: durable.simbad_oid,
            primary_designation: durable.primary_designation,
            common_name: durable
                .aliases
                .iter()
                .find(|a| a.kind == AliasKind::CommonName)
                .map(|a| a.alias.clone()),
            object_type: to_crate_object_type(durable.object_type),
            otype_raw: String::new(),
            ra_deg: durable.ra_deg,
            dec_deg: durable.dec_deg,
            v_mag: row.magnitude,
            aliases: durable
                .aliases
                .into_iter()
                .map(|a| simbad_resolver::ResolvedAlias::new(a.alias, to_crate_alias_kind(a.kind)))
                .collect(),
            source: to_crate_source(durable.source),
        });
    }
    let results = cache.upsert_batch(&identities, namespace).await?;
    let warmed = results
        .iter()
        .filter(|(_, outcome)| {
            !matches!(outcome, simbad_resolver::UpsertOutcome::SkippedUserOverride)
        })
        .count();
    Ok(warmed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use simbad_resolver::Store;

    fn ns() -> Uuid {
        simbad_resolver::identity::namespace("astro-plan.targets")
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
                    v_mag: Some(3.44),
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
                    v_mag: None,
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
        assert_eq!(back.entries[0].v_mag, Some(3.44));
    }

    #[test]
    fn json_parses_without_v_mag_field_pre_052_asset() {
        // Pre-052 committed assets have no `v_mag` key at all.
        let json = r#"{"version":1,"entries":[{"primary_designation":"M 1",
            "object_type":"planetary_nebula","ra_deg":1.0,"dec_deg":2.0,"aliases":[]}]}"#;
        let asset = SeedAsset::from_json(json.as_bytes()).unwrap();
        assert_eq!(asset.entries[0].v_mag, None);
    }

    #[tokio::test]
    async fn first_run_then_not() {
        let store = Store::in_memory().unwrap();
        let cache = store.cache();
        assert!(is_first_run(&cache).await.unwrap());
        warm_cache(&cache, &fixture(), &ns()).await.unwrap();
        assert!(!is_first_run(&cache).await.unwrap());
    }

    #[tokio::test]
    async fn warm_populates_cache_and_offline_lookup_works() {
        let store = Store::in_memory().unwrap();
        let cache = store.cache();
        let loaded = warm_cache(&cache, &fixture(), &ns()).await.unwrap();
        assert_eq!(loaded, 2);

        // Offline lookup by a non-primary alias resolves to the canonical row.
        let norm = targeting::normalize::normalize("NGC 224");
        let got = cache.get_by_normalized(&norm).await.unwrap().unwrap();
        assert_eq!(got.primary_designation, "M 31");
        assert_eq!(got.source, simbad_resolver::TargetSource::Seed);
        assert_eq!(got.v_mag, Some(3.44));

        // Common-name lookup also works.
        let norm = targeting::normalize::normalize("Orion Nebula");
        let got = cache.get_by_normalized(&norm).await.unwrap().unwrap();
        assert_eq!(got.primary_designation, "M 42");
    }

    #[tokio::test]
    async fn warm_is_idempotent() {
        let store = Store::in_memory().unwrap();
        let cache = store.cache();
        warm_cache(&cache, &fixture(), &ns()).await.unwrap();
        warm_cache(&cache, &fixture(), &ns()).await.unwrap();
        assert_eq!(cache.list().await.unwrap().len(), 2, "re-warming must not duplicate rows");
    }

    #[tokio::test]
    async fn first_run_warm_is_noop_when_populated() {
        let store = Store::in_memory().unwrap();
        let cache = store.cache();
        warm_cache(&cache, &fixture(), &ns()).await.unwrap();
        assert!(!is_first_run(&cache).await.unwrap());
    }

    #[tokio::test]
    async fn seed_does_not_overwrite_user_override() {
        let store = Store::in_memory().unwrap();
        let cache = store.cache();
        // Simulate a user override for M 31's oid.
        let override_identity = simbad_resolver::ResolvedIdentity {
            simbad_oid: Some(1_575_544),
            primary_designation: "My Andromeda".to_owned(),
            common_name: None,
            object_type: simbad_resolver::ObjectType::Galaxy,
            otype_raw: String::new(),
            ra_deg: 10.684_708,
            dec_deg: 41.268_75,
            v_mag: None,
            aliases: vec![simbad_resolver::ResolvedAlias::new(
                "My Andromeda",
                simbad_resolver::AliasKind::Designation,
            )],
            source: simbad_resolver::TargetSource::UserOverride,
        };
        cache.upsert(&override_identity, &ns()).await.unwrap();

        // Seeding must not clobber the override.
        warm_cache(&cache, &fixture(), &ns()).await.unwrap();
        let got = cache.get_by_simbad_oid(1_575_544).await.unwrap().unwrap();
        assert_eq!(got.primary_designation, "My Andromeda");
        assert_eq!(got.source, simbad_resolver::TargetSource::UserOverride);
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

    /// Regression guard for #696: the committed asset shipped for a long
    /// while with zero `v_mag` coverage (generated before the seed-builder
    /// `f.V` / `allfluxes` join fix, spec 052 P1 T003, landed in #684). A
    /// live re-run measured ~26% coverage (galaxies ~14%; double
    /// stars/clusters/planetary nebulae 55-92%; pure emission/dark/reflection
    /// nebulae mostly 0% — SIMBAD's `allfluxes.V` is sparse for those object
    /// types). The 20% floor sits safely under that measured value so it
    /// only trips on a genuine stale (all-null) regen, not routine SIMBAD
    /// drift between rebuilds.
    #[test]
    #[allow(clippy::cast_precision_loss)] // counts are ~13k, far below f64's exact-integer range
    fn bundled_asset_has_v_mag_coverage() {
        let asset = bundled().expect("bundled seed asset must parse");
        let with_v_mag = asset.entries.iter().filter(|e| e.v_mag.is_some()).count();
        let coverage = with_v_mag as f64 / asset.entries.len() as f64;
        assert!(
            coverage > 0.20,
            "bundled seed v_mag coverage regressed to {:.1}% ({with_v_mag}/{}) — asset looks stale, rerun seed-builder",
            coverage * 100.0,
            asset.entries.len()
        );

        let m31 = asset
            .entries
            .iter()
            .find(|e| e.primary_designation == "M 31")
            .expect("seed must include M 31");
        let v_mag = m31.v_mag.expect("M 31 must carry a v_mag");
        assert!((3.0..4.0).contains(&v_mag), "M 31 v_mag should be ~3.4, got {v_mag}");
    }

    /// A real Messier-only slice of the committed bundled asset (~110 objects,
    /// including M 31/M 42) — fast enough for redb-touching tests. [`warm_cache`]
    /// now goes through [`simbad_resolver::Cache::upsert_batch`] (one fsync'd
    /// write transaction for the whole batch, since `simbad-resolver` 0.3.0 —
    /// spec 052 P4/#695) instead of one transaction per entry, but the
    /// per-entry dedup-by-`simbad_oid` lookup the crate's backend does inside
    /// that transaction is still an O(n) scan per entry (O(n²) for the whole
    /// batch), so warming the FULL ~14k-object popular seed is still far too
    /// slow for `cargo test`/`nextest` (measured: low hundreds of ms at
    /// n=500, growing to minutes by n=4000) — a Messier-only slice keeps this
    /// suite fast regardless of the transaction-count change.
    /// [`bundled_asset_loads_and_covers_messier_and_caldwell`] separately
    /// proves the full committed asset's shape (pure JSON parse, no redb).
    fn messier_only_seed() -> SeedAsset {
        let full = bundled().expect("bundled seed asset must parse");
        let entries: Vec<SeedEntry> =
            full.entries.into_iter().filter(|e| e.primary_designation.starts_with("M ")).collect();
        SeedAsset {
            version: full.version,
            generated_at: full.generated_at,
            source: full.source,
            entries,
        }
    }

    #[tokio::test]
    async fn bundled_seed_warms_cache() {
        let store = Store::in_memory().unwrap();
        let cache = store.cache();
        let seed = messier_only_seed();
        let loaded = warm_cache(&cache, &seed, &ns()).await.unwrap();
        assert!(loaded >= 80, "expected the full Messier catalogue, got {loaded}");

        // Offline typeahead for a seeded Messier object works with no network.
        let norm = targeting::normalize::normalize("M 31");
        let got = cache.get_by_normalized(&norm).await.unwrap();
        assert!(got.is_some(), "M 31 must be resolvable from the seeded cache");

        // Re-warming is a no-op (idempotent upsert).
        assert!(!cache.list().await.unwrap().is_empty());
        let reloaded = warm_cache(&cache, &seed, &ns()).await.unwrap();
        assert!(reloaded >= 80, "re-warm dedups by oid/id, not by row count delta");
    }

    /// SC-001: repeat search of a cached object issues zero network calls, and
    /// resolves fast, entirely from the local redb cache (no SQLite, no TAP).
    #[tokio::test]
    async fn sc001_offline_seed_typeahead_under_100ms() {
        let store = Store::in_memory().unwrap();
        let cache = store.cache();

        let loaded =
            warm_cache(&cache, &messier_only_seed(), &ns()).await.expect("seed warm must not fail");
        assert!(
            loaded >= 80,
            "seed must warm the Messier catalogue for this test to be meaningful"
        );

        let t0 = std::time::Instant::now();
        let results_m42 = cache.search("m 42", 20).await.expect("search must not fail");
        let elapsed_m42 = t0.elapsed();

        assert!(
            !results_m42.is_empty(),
            "offline search for 'm 42' must return results from seeded cache"
        );
        assert_eq!(
            results_m42[0].target.primary_designation, "M 42",
            "top result for 'm 42' must be M 42 (Orion Nebula)"
        );
        assert!(
            elapsed_m42 < std::time::Duration::from_millis(100),
            "SC-001 violated: offline typeahead for 'm 42' took {elapsed_m42:?}, must be < 100 ms",
        );
    }

    /// Lazy backfill (T012): an existing durable `canonical_target` row (e.g.
    /// from a prior app version) is copied into a freshly-opened redb cache.
    #[tokio::test]
    async fn warm_from_canonical_target_backfills_durable_rows() {
        let db = persistence_db::Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        let identity = crate::ResolvedIdentity {
            simbad_oid: Some(1_575_544),
            primary_designation: "M 31".to_owned(),
            common_name: Some("Andromeda Galaxy".to_owned()),
            object_type: ObjectType::Galaxy,
            ra_deg: 10.684_708,
            dec_deg: 41.268_75,
            v_mag: Some(3.44),
            aliases: vec![crate::ResolvedAlias::new("M 31", AliasKind::Designation)],
            source: TargetSource::Resolved,
        };
        crate::cache::upsert_resolved(db.pool(), &identity).await.unwrap();

        let store = Store::in_memory().unwrap();
        let cache = store.cache();
        assert!(is_first_run(&cache).await.unwrap());

        let warmed = warm_from_canonical_target(&cache, db.pool(), &ns()).await.unwrap();
        assert_eq!(warmed, 1);

        let norm = targeting::normalize::normalize("M 31");
        let got = cache.get_by_normalized(&norm).await.unwrap().unwrap();
        assert_eq!(got.primary_designation, "M 31");
        assert_eq!(got.v_mag, Some(3.44));
    }
}
