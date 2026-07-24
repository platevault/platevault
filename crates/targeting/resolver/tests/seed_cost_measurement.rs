// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Phase-1 measurement for bead astro-plan-v84u: isolate the seed-warm cost
//! against a file-backed redb store (production configuration) to determine
//! what share of the cold-boot penalty the 13k-row bundled seed actually owns.
//!
//! NOT a pass/fail test: its only purpose is to emit timing numbers on stderr
//! (`eprintln!`). Run with `cargo test -p targeting_resolver --test
//! seed_cost_measurement -- --nocapture` to see the output.

use std::time::Instant;

use simbad_resolver::Store;
use targeting_resolver::seed;

/// Time the full bundled seed warm against a file-backed redb store —
/// production configuration. This is the number the bead's decision gate
/// evaluates: if this accounts for <50% of the cold-boot delta (observed
/// 100-130s cold vs ~25s warm on Windows CI), the fix priority shifts.
#[tokio::test]
async fn measure_full_seed_warm_file_backed() {
    let dir = tempfile::tempdir().expect("tempdir");
    let redb_path = dir.path().join("measure-seed.redb");

    // Open a file-backed store (production config: Eventual durability).
    let resolve_cache = targeting_resolver::simbad::ResolveCache::open(&redb_path)
        .expect("failed to open file-backed resolve cache");
    let cache = resolve_cache.cache();
    let namespace = simbad_resolver::identity::namespace("astro-plan.targets");

    // Parse the bundled seed (this cost is part of the warm path).
    let t_parse_start = Instant::now();
    let full_seed = seed::bundled().expect("bundled seed asset must parse");
    let t_parse = t_parse_start.elapsed();
    let entry_count = full_seed.entries.len();

    // Warm the full seed (the hot path we are measuring).
    let t_warm_start = Instant::now();
    let loaded = seed::warm_cache(&cache, &full_seed, &namespace).await.expect("seed warm failed");
    let t_warm = t_warm_start.elapsed();

    // Flush (the one fsync that persists Eventual chunks in production).
    let t_flush_start = Instant::now();
    resolve_cache.flush().await.expect("flush failed");
    let t_flush = t_flush_start.elapsed();

    let total = t_parse + t_warm + t_flush;

    eprintln!("=== SEED COST MEASUREMENT (file-backed redb, full {entry_count} entries) ===");
    eprintln!("  JSON parse:  {:>8.1?}", t_parse);
    eprintln!("  warm_cache:  {:>8.1?}", t_warm);
    eprintln!("  flush:       {:>8.1?}", t_flush);
    eprintln!("  TOTAL:       {:>8.1?}", total);
    eprintln!("  loaded rows: {loaded}");
    eprintln!("===");

    // Sanity: all entries should have been loaded.
    assert!(loaded >= entry_count, "expected all entries loaded, got {loaded} < {entry_count}");
}

/// Time a Messier-only subset (~87 entries) for comparison — the "small
/// catalog" baseline showing per-entry overhead at low scale.
#[tokio::test]
async fn measure_messier_subset_warm_file_backed() {
    let dir = tempfile::tempdir().expect("tempdir");
    let redb_path = dir.path().join("measure-messier.redb");

    let resolve_cache = targeting_resolver::simbad::ResolveCache::open(&redb_path)
        .expect("failed to open file-backed resolve cache");
    let cache = resolve_cache.cache();
    let namespace = simbad_resolver::identity::namespace("astro-plan.targets");

    let full_seed = seed::bundled().expect("bundled seed asset must parse");
    let messier: Vec<_> =
        full_seed.entries.into_iter().filter(|e| e.primary_designation.starts_with("M ")).collect();
    let messier_seed = seed::SeedAsset {
        version: full_seed.version,
        generated_at: full_seed.generated_at,
        source: full_seed.source,
        entries: messier,
    };
    let entry_count = messier_seed.entries.len();

    let t_warm_start = Instant::now();
    let loaded =
        seed::warm_cache(&cache, &messier_seed, &namespace).await.expect("seed warm failed");
    let t_warm = t_warm_start.elapsed();

    let t_flush_start = Instant::now();
    resolve_cache.flush().await.expect("flush failed");
    let t_flush = t_flush_start.elapsed();

    eprintln!("=== MESSIER SUBSET ({entry_count} entries, file-backed) ===");
    eprintln!("  warm_cache:  {:>8.1?}", t_warm);
    eprintln!("  flush:       {:>8.1?}", t_flush);
    eprintln!("  TOTAL:       {:>8.1?}", t_warm + t_flush);
    eprintln!("  loaded rows: {loaded}");
    eprintln!("===");
}

/// Measure warm_bundled_on_first_run end-to-end (includes JSON parse,
/// sentinel check, warm, sentinel write) — the exact function the app boot
/// calls.
#[tokio::test]
async fn measure_warm_bundled_on_first_run_file_backed() {
    let dir = tempfile::tempdir().expect("tempdir");
    let redb_path = dir.path().join("measure-first-run.redb");

    let resolve_cache = targeting_resolver::simbad::ResolveCache::open(&redb_path)
        .expect("failed to open file-backed resolve cache");
    let cache = resolve_cache.cache();
    let namespace = simbad_resolver::identity::namespace("astro-plan.targets");

    let t0 = Instant::now();
    let result = seed::warm_bundled_on_first_run(&cache, &namespace)
        .await
        .expect("warm_bundled_on_first_run failed");
    let t_warm = t0.elapsed();

    let t_flush_start = Instant::now();
    resolve_cache.flush().await.expect("flush failed");
    let t_flush = t_flush_start.elapsed();

    let total = t_warm + t_flush;

    eprintln!("=== warm_bundled_on_first_run (file-backed, first run) ===");
    eprintln!("  warm (incl parse+sentinel): {:>8.1?}", t_warm);
    eprintln!("  flush:                      {:>8.1?}", t_flush);
    eprintln!("  TOTAL:                      {:>8.1?}", total);
    eprintln!("  loaded: {:?}", result);
    eprintln!("===");

    // Second call should be a no-op (sentinel matches).
    let t_noop_start = Instant::now();
    let noop = seed::warm_bundled_on_first_run(&cache, &namespace)
        .await
        .expect("warm_bundled_on_first_run noop failed");
    let t_noop = t_noop_start.elapsed();
    eprintln!("  warm (noop, sentinel match): {:>8.1?}", t_noop);
    assert!(noop.is_none(), "second call should be a noop");
}

/// Measure in-memory store warm for comparison (removes fsync cost from
/// the picture entirely).
#[tokio::test]
async fn measure_full_seed_warm_in_memory() {
    let store = Store::in_memory().expect("in-memory redb store");
    let cache = store.cache();
    let namespace = simbad_resolver::identity::namespace("astro-plan.targets");

    let t_parse_start = Instant::now();
    let full_seed = seed::bundled().expect("bundled seed asset must parse");
    let t_parse = t_parse_start.elapsed();
    let entry_count = full_seed.entries.len();

    let t_warm_start = Instant::now();
    let loaded = seed::warm_cache(&cache, &full_seed, &namespace).await.expect("seed warm failed");
    let t_warm = t_warm_start.elapsed();

    eprintln!("=== SEED WARM IN-MEMORY ({entry_count} entries) ===");
    eprintln!("  JSON parse:  {:>8.1?}", t_parse);
    eprintln!("  warm_cache:  {:>8.1?}", t_warm);
    eprintln!("  TOTAL:       {:>8.1?}", t_parse + t_warm);
    eprintln!("  loaded rows: {loaded}");
    eprintln!("===");
}
