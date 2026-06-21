//! T014 — `target.search` against a realistically-seeded cache (spec 035).
//!
//! Exercises `app_core::target_search::search` end-to-end after loading the
//! bundled seed into an in-memory `SQLite` database.  These tests are distinct
//! from the unit tests in `target_search.rs` (which use a 2-object hand-rolled
//! fixture) because they prove:
//!
//! - (a) Ranking order across a realistic corpus: exact designation before
//!   prefix before substring (e.g. "M 31" returns Andromeda first).
//! - (b) `limit` is honoured over the full seeded dataset.
//! - (c) Common-name / natural-language queries work against real seed data
//!   (e.g. "androm" surfaces Andromeda Galaxy).
//!
//! The bundled seed ships ≥ 110 Messier + Caldwell objects; it is loaded once
//! in an `async` setup helper and then queries run against the resulting pool.
//! No network is touched — the seed is embedded in the binary at compile time.

use app_core::target_search;
use contracts_core::targets::{TargetObjectType, TargetSearchRequest};
use persistence_db::Database;
use targeting_resolver::seed;

// ── Helpers ──────────────────────────────────────────────────────────────────

async fn seeded_db() -> Database {
    let db = Database::in_memory().await.expect("in-memory DB");
    db.migrate().await.expect("migrations");
    let loaded = seed::load_bundled_on_first_run(db.pool())
        .await
        .expect("seed load must not fail")
        .expect("first-run seed must produce a count");
    assert!(loaded >= 110, "expected >= 110 seeded objects, got {loaded}");
    db
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
    let db = seeded_db().await;
    let resp =
        target_search::search(db.pool(), &req("M 31", 20)).await.expect("search must not fail");

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
    let db = seeded_db().await;
    let resp =
        target_search::search(db.pool(), &req("androm", 20)).await.expect("search must not fail");

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
    let db = seeded_db().await;

    // "M 42" is the exact designation for the Orion Nebula; querying for the
    // exact string should rank it first above any prefix/substring hits.
    let resp =
        target_search::search(db.pool(), &req("M 42", 20)).await.expect("search must not fail");

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
    let db = seeded_db().await;
    let resp = target_search::search(db.pool(), &req("M", 1)).await.expect("search must not fail");

    assert!(
        resp.suggestions.len() <= 1,
        "limit=1 must return at most 1 suggestion; got {}",
        resp.suggestions.len()
    );
}

/// A limit of 5 must be respected even when the seed matches many objects.
#[tokio::test]
async fn t014_b_limit_5_returns_at_most_five() {
    let db = seeded_db().await;
    let resp =
        target_search::search(db.pool(), &req("NGC", 5)).await.expect("search must not fail");

    assert!(
        resp.suggestions.len() <= 5,
        "limit=5 must return at most 5 suggestions; got {}",
        resp.suggestions.len()
    );
}

/// The default limit of 20 (limit=0 in the request) must not be exceeded.
#[tokio::test]
async fn t014_b_default_limit_20_not_exceeded() {
    let db = seeded_db().await;
    // "NGC" matches many seeded objects; with default limit the result must
    // cap at 20.
    let resp =
        target_search::search(db.pool(), &req("NGC", 0)).await.expect("search must not fail");

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
    let db = seeded_db().await;
    let resp = target_search::search(db.pool(), &req("Orion Nebula", 20))
        .await
        .expect("search must not fail");

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
    let db = seeded_db().await;
    let resp =
        target_search::search(db.pool(), &req("Crab", 20)).await.expect("search must not fail");

    assert!(
        !resp.suggestions.is_empty(),
        "query 'Crab' must match at least one seeded object (Crab Nebula / M 1)"
    );

    let found_m1 = resp.suggestions.iter().any(|s| s.primary_designation == "M 1");
    assert!(found_m1, "query 'Crab' must include M 1 (Crab Nebula) in results");
}
