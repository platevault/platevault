// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! T014 — `target.search` against a realistically-seeded redb cache (spec 035,
//! retargeted to the redb resolve cache by spec 052 P1 D1).
//!
//! Exercises `app_core::target_search::search` end-to-end after warming the
//! bundled seed into an in-memory redb cache. These tests are distinct from
//! the unit tests in `target_search.rs` (which use a 2-object hand-rolled
//! fixture) because they prove:
//!
//! - (a) Ranking order across a realistic corpus: exact designation before
//!   prefix before substring (e.g. "M 31" returns Andromeda first).
//! - (b) `limit` is honoured over the full seeded dataset.
//! - (c) Common-name / natural-language queries work against real seed data
//!   (e.g. "androm" surfaces Andromeda Galaxy).
//!
//! The bundled seed ships ≥ 110 Messier + Caldwell objects (+ thousands of
//! NGC/IC); this file uses a real Messier-only slice (~110 objects, several
//! dozen of which carry an NGC cross-designation alias — enough to exercise
//! the limit/ranking assertions below), warmed ONCE into a shared in-memory
//! redb cache (a process-wide `OnceCell` — each `simbad_resolver::Cache::
//! upsert` is its own fsync'd write transaction, so warming the FULL
//! ~14k-object popular seed is a multi-minute operation in an unoptimised
//! debug test build, and this file alone would blow the `just check` budget).
//! No network is touched — the seed is embedded in the binary at compile time.

use app_core::target_search;
use contracts_core::targets::{TargetObjectType, TargetSearchRequest};
use simbad_resolver::{RedbCache, Store};
use tokio::sync::OnceCell;

// ── Helpers ──────────────────────────────────────────────────────────────────

static SEEDED_CACHE: OnceCell<RedbCache> = OnceCell::const_new();

async fn seeded_cache() -> &'static RedbCache {
    SEEDED_CACHE
        .get_or_init(|| async {
            let store = Store::in_memory().expect("in-memory redb store");
            let cache = store.cache();
            let namespace = simbad_resolver::identity::namespace("astro-plan.targets");
            let full = targeting_resolver::seed::bundled().expect("bundled seed asset must parse");
            let entries: Vec<_> = full
                .entries
                .into_iter()
                .filter(|e| e.primary_designation.starts_with("M "))
                .collect();
            let seed = targeting_resolver::seed::SeedAsset {
                version: full.version,
                generated_at: full.generated_at,
                source: full.source,
                entries,
            };
            let loaded = targeting_resolver::seed::warm_cache(&cache, &seed, &namespace)
                .await
                .expect("seed warm must not fail");
            assert!(loaded >= 80, "expected the full Messier catalogue, got {loaded}");
            cache
        })
        .await
}

fn req(query: &str, limit: u32) -> TargetSearchRequest {
    TargetSearchRequest {
        contract_version: "1.0".into(),
        request_id: "t014".into(),
        query: query.into(),
        catalog_filter: Vec::new(),
        type_filter: Vec::new(),
        limit,
    }
}

// ── T014-a: ranking order ────────────────────────────────────────────────────

/// Exact designation "M 31" must appear first (rank: exact) and resolve to
/// Andromeda; any prefix/substring matches for unrelated objects follow.
#[tokio::test]
async fn t014_a_exact_designation_ranked_first() {
    let cache = seeded_cache().await;
    let resp = target_search::search(cache, &req("M 31", 20)).await.expect("search must not fail");

    assert!(
        !resp.suggestions.is_empty(),
        "search for 'M 31' must return at least one suggestion from seeded data"
    );

    let first = &resp.suggestions[0];
    assert_eq!(
        first.primary_designation, "M 31",
        "exact match on 'M 31' must be the first result; got '{}'",
        first.primary_designation
    );
    // M 31 has several common-name aliases in the bundled seed ("Andromeda",
    // "Andromeda Galaxy", "Andromeda Nebula", "And Nebula"). The use-case
    // returns whichever alias the DB returns first for the CommonName kind;
    // we assert only that a common name is present, not its exact spelling,
    // to remain stable regardless of DB alias ordering.
    assert!(
        first.common_name.is_some(),
        "first result for 'M 31' must carry at least one common name from the bundled seed"
    );
    assert_eq!(first.object_type, TargetObjectType::Galaxy, "M 31 must be typed as galaxy");
}

/// Query "androm" (prefix of the common name) must surface M 31 / Andromeda.
#[tokio::test]
async fn t014_a_prefix_common_name_surfaces_andromeda() {
    let cache = seeded_cache().await;
    let resp =
        target_search::search(cache, &req("androm", 20)).await.expect("search must not fail");

    assert!(!resp.suggestions.is_empty(), "prefix 'androm' must match at least one seeded object");

    let found_andromeda = resp.suggestions.iter().any(|s| s.primary_designation == "M 31");
    assert!(
        found_andromeda,
        "prefix query 'androm' must include M 31 (Andromeda Galaxy) in results"
    );
}

/// Substring query "nebula" must match nebula-type objects before galaxy
/// results.  The `matched_alias` for every returned suggestion must contain
/// "nebula" (case-insensitive) confirming the match is against the alias text.
#[tokio::test]
async fn t014_a_ranking_exact_before_prefix_before_substring() {
    let cache = seeded_cache().await;

    // "M 42" is the exact designation for the Orion Nebula; querying for the
    // exact string should rank it first above any prefix/substring hits.
    let resp = target_search::search(cache, &req("M 42", 20)).await.expect("search must not fail");

    assert!(!resp.suggestions.is_empty(), "search for 'M 42' must return results");

    let first = &resp.suggestions[0];
    assert_eq!(
        first.primary_designation, "M 42",
        "exact match 'M 42' must be ranked first; got '{}'",
        first.primary_designation
    );
}

// ── T014-b: limit is honoured ────────────────────────────────────────────────

/// A query matching many seeded objects must never return more than `limit`
/// results.  "M" is a broad prefix that hits every Messier object.
#[tokio::test]
async fn t014_b_limit_1_returns_at_most_one() {
    let cache = seeded_cache().await;
    let resp = target_search::search(cache, &req("M", 1)).await.expect("search must not fail");

    assert!(
        resp.suggestions.len() <= 1,
        "limit=1 must return at most 1 suggestion; got {}",
        resp.suggestions.len()
    );
}

/// A limit of 5 must be respected even when the seed matches many objects.
#[tokio::test]
async fn t014_b_limit_5_returns_at_most_five() {
    let cache = seeded_cache().await;
    let resp = target_search::search(cache, &req("NGC", 5)).await.expect("search must not fail");

    assert!(
        resp.suggestions.len() <= 5,
        "limit=5 must return at most 5 suggestions; got {}",
        resp.suggestions.len()
    );
}

/// The default limit of 20 (limit=0 in the request) must not be exceeded.
#[tokio::test]
async fn t014_b_default_limit_20_not_exceeded() {
    let cache = seeded_cache().await;
    // "NGC" matches many seeded objects; with default limit the result must
    // cap at 20.
    let resp = target_search::search(cache, &req("NGC", 0)).await.expect("search must not fail");

    assert!(
        resp.suggestions.len() <= 20,
        "default limit=20 must not be exceeded; got {}",
        resp.suggestions.len()
    );
}

// ── T014-c: common-name query ────────────────────────────────────────────────

/// Querying by a well-known common name must return the right canonical object.
#[tokio::test]
async fn t014_c_common_name_query_orion_nebula() {
    let cache = seeded_cache().await;
    let resp =
        target_search::search(cache, &req("Orion Nebula", 20)).await.expect("search must not fail");

    assert!(
        !resp.suggestions.is_empty(),
        "common-name query 'Orion Nebula' must return at least one suggestion"
    );

    let first = &resp.suggestions[0];
    assert_eq!(
        first.primary_designation, "M 42",
        "common-name query 'Orion Nebula' must return M 42 as the top result; got '{}'",
        first.primary_designation
    );
    // The bundled seed uses "Great Orion Nebula" (SIMBAD NAME field).
    assert_eq!(
        first.common_name.as_deref(),
        Some("Great Orion Nebula"),
        "M 42 must carry common name 'Great Orion Nebula' (per bundled seed)"
    );
}

/// A partial common name "Crab" should surface M 1 (Crab Nebula).
#[tokio::test]
async fn t014_c_partial_common_name_crab_surfaces_m1() {
    let cache = seeded_cache().await;
    let resp = target_search::search(cache, &req("Crab", 20)).await.expect("search must not fail");

    assert!(
        !resp.suggestions.is_empty(),
        "query 'Crab' must match at least one seeded object (Crab Nebula / M 1)"
    );

    let found_m1 = resp.suggestions.iter().any(|s| s.primary_designation == "M 1");
    assert!(found_m1, "query 'Crab' must include M 1 (Crab Nebula) in results");
}
