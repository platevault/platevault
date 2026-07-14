// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Sanity timing: warming the redb resolve cache from the bundled seed must
//! not regress to something absurd (spec 052 P1 D2/D4 retargeted this from a
//! single-transaction `SQLite` load to `simbad_resolver::Cache` upserts — see
//! the module doc in `targeting_resolver::seed`).
//!
//! `targeting_resolver::seed::warm_cache` goes through
//! [`simbad_resolver::Cache::upsert_batch`] (one redb write transaction for
//! the whole batch, since `simbad-resolver` 0.3.0 — spec 052 P4/#695) rather
//! than one transaction per entry. Measured on this Messier-only slice (87
//! objects, debug build): ~147ms per-entry-transaction vs. ~96ms batched —
//! a real but modest win, since at this scale the backend's per-entry
//! dedup-by-`simbad_oid` lookup (an O(n) table scan, no index) still
//! dominates over the saved fsyncs. That same O(n) lookup makes the FULL
//! ~14k-object popular seed an O(n²) operation regardless of batching (this
//! is why production warms it in a background task rather than blocking the
//! UI — `apps/desktop/src-tauri/src/lib.rs` — and why this test only times a
//! small real-data slice, not the full seed). This test times a real
//! Messier-only slice (~110 objects, matching `targeting_resolver::seed`'s
//! own test fixture) as a fast, still-real-data regression guard against a
//! *worse* per-entry cost (e.g. an accidental read-then-write-then-read round
//! trip per upsert).

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
