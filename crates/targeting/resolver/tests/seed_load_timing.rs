//! Sanity timing: warming the redb resolve cache from the bundled seed must
//! not regress to something absurd (spec 052 P1 D2/D4 retargeted this from a
//! single-transaction `SQLite` load to per-identity `simbad_resolver::Cache`
//! upserts — see the module doc in `targeting_resolver::seed`).
//!
//! Each [`simbad_resolver::Cache::upsert`] call is its own fsync'd redb write
//! transaction (the crate has no batch-upsert primitive today), so the FULL
//! ~14k-object popular seed legitimately takes on the order of tens of
//! seconds — that is why production warms it in a background task at app
//! startup rather than blocking the UI (`apps/desktop/src-tauri/src/lib.rs`).
//! This test times a real Messier-only slice (~110 objects, matching
//! `targeting_resolver::seed`'s own test fixture) as a fast, still-real-data
//! regression guard against a *worse* per-entry cost (e.g. an accidental
//! read-then-write-then-read round trip per upsert).

use std::time::Instant;

use simbad_resolver::Store;
use targeting_resolver::seed;

#[tokio::test]
async fn messier_seed_warm_is_reasonably_fast() {
    let store = Store::in_memory().expect("in-memory redb store");
    let cache = store.cache();
    let namespace = simbad_resolver::identity::namespace("astro-plan.targets");

    let full = seed::bundled().expect("bundled seed asset must parse");
    let messier: Vec<_> =
        full.entries.iter().filter(|e| e.primary_designation.starts_with("M ")).cloned().collect();
    assert!(messier.len() >= 80, "expected the full Messier catalogue, got {}", messier.len());
    let asset = targeting_resolver::seed::SeedAsset {
        version: full.version,
        generated_at: full.generated_at,
        source: full.source,
        entries: messier,
    };

    let t0 = Instant::now();
    let loaded = seed::warm_cache(&cache, &asset, &namespace).await.expect("seed warm");
    let elapsed = t0.elapsed();

    assert!(loaded >= 80, "expected the full Messier catalogue warmed, got {loaded}");
    // Generous ceiling for ~110 per-entry redb write transactions.
    assert!(
        elapsed.as_secs() < 10,
        "Messier-slice redb warm took {elapsed:?}, expected well under 10s"
    );
    eprintln!("warmed {loaded} seed objects in {elapsed:?}");
}
