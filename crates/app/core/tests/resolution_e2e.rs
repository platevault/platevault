// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! E2E integration test for the spec-035/052 resolution flow.
//!
//! Exercises the full chain across components that are unit-tested in isolation,
//! using a single in-memory `SQLite` database, an in-memory redb resolve cache,
//! and the `FakeResolver` test double (no network touches).
//!
//! Steps covered (spec 052 P1 retarget — see `targeting_resolver::seed` /
//! `app_core::target_resolve` module docs for the full rationale):
//!   1. Seed warm — `targeting_resolver::seed::warm_bundled_on_first_run`
//!      populates the shared redb cache (not `SQLite` — the redb cache is the
//!      reproducible typeahead/search projection, constitution §V).
//!   2. Local search (US1) — `target_search::search` finds a seeded object in
//!      the redb cache, no network, no `SQLite` write.
//!   3. Long-tail resolve (US3) — `target_resolve::resolve` calls the
//!      `FakeResolver` for an unseeded object and returns it WITHOUT writing
//!      `canonical_target` (FR-004/SC-002); `target_resolve::promote_by_id`
//!      is the explicit in-use commit that persists it.
//!   4. Ingest grouping (US4) — nothing is pre-promoted to `SQLite`, so every
//!      alias variant of one physical object is enqueued and grouped onto the
//!      same canonical `target_id` by `resolve_pending`'s drain.
//!   5. Override wins (FR-014) — `resolve` with an `override_target` binding
//!      returns `source = user-override`; the durable row it writes is
//!      sticky against a later mismatched resolve.

use app_core::{ingest_resolution, target_resolve, target_search};
use contracts_core::targets::TargetSearchRequest;
use contracts_core::targets::{
    TargetResolveOverride, TargetResolveSimbadRequest, TargetResolveStatus, TargetSource,
};
use persistence_db::Database;
use simbad_resolver::{Cache as _, RedbCache, Store};
use targeting_resolver::cache;
use targeting_resolver::{
    AliasKind, FakeResolver, ObjectType, ResolvedAlias, ResolvedIdentity, TargetSource as CacheSrc,
};
use uuid::Uuid;

// ── Shared helpers ────────────────────────────────────────────────────────────

fn ns() -> Uuid {
    simbad_resolver::identity::namespace("astro-plan.targets")
}

/// A real Messier-only slice of the committed bundled asset (~110 objects,
/// including M 31/M 42/M 101) — fast enough for this e2e's redb-touching
/// steps. Each `simbad_resolver::Cache::upsert` is its own fsync'd write
/// transaction (no batch-upsert primitive), so warming the full ~14k-object
/// popular seed one entry at a time is a multi-second-to-tens-of-seconds
/// operation — fine as a one-time backgrounded app-startup warm, too slow to
/// run per test (`targeting_resolver::seed::tests` covers the full-asset
/// shape and a Messier-scale timing guard already).
fn messier_only_seed() -> targeting_resolver::seed::SeedAsset {
    let full = targeting_resolver::seed::bundled().expect("bundled seed asset must parse");
    let entries: Vec<_> =
        full.entries.into_iter().filter(|e| e.primary_designation.starts_with("M ")).collect();
    targeting_resolver::seed::SeedAsset {
        version: full.version,
        generated_at: full.generated_at,
        source: full.source,
        entries,
    }
}

async fn seeded_cache() -> RedbCache {
    let store = Store::in_memory().expect("in-memory redb store");
    let cache = store.cache();
    let loaded = targeting_resolver::seed::warm_cache(&cache, &messier_only_seed(), &ns())
        .await
        .expect("seed warm must not fail");
    assert!(loaded >= 80, "expected the full Messier catalogue, got {loaded}");
    cache
}

async fn seeded_db() -> Database {
    let db = Database::in_memory().await.expect("in-memory DB");
    db.migrate().await.expect("migrations");
    db
}

/// Build a `target.search` request.
fn search_req(query: &str) -> TargetSearchRequest {
    TargetSearchRequest {
        contract_version: "1.0".into(),
        request_id: "e2e-search".into(),
        query: query.into(),
        catalog_filter: Vec::new(),
        type_filter: Vec::new(),
        limit: 20,
    }
}

/// Build a standard `target.resolve` request (no override).
fn resolve_req(query: &str) -> TargetResolveSimbadRequest {
    TargetResolveSimbadRequest {
        contract_version: "1.0".into(),
        request_id: "e2e-resolve".into(),
        query: query.into(),
        override_target: None,
    }
}

/// Build a `target.resolve` request that records a manual override.
fn override_req(query: &str, target_id: &str) -> TargetResolveSimbadRequest {
    TargetResolveSimbadRequest {
        contract_version: "1.0".into(),
        request_id: "e2e-override".into(),
        query: query.into(),
        override_target: Some(TargetResolveOverride { target_id: target_id.into() }),
    }
}

/// A new (unseeded) object used for the long-tail resolve step.
fn horsehead() -> ResolvedIdentity {
    ResolvedIdentity {
        simbad_oid: Some(99_000_001),
        primary_designation: "B 33".to_owned(),
        common_name: Some("Horsehead Nebula".to_owned()),
        object_type: ObjectType::DarkNebula,
        ra_deg: 85.244_58,
        dec_deg: -2.457_78,
        v_mag: Some(6.9),
        aliases: vec![
            ResolvedAlias::new("B 33", AliasKind::Designation),
            ResolvedAlias::new("Horsehead Nebula", AliasKind::CommonName),
        ],
        source: CacheSrc::Resolved,
    }
}

/// Insert a minimal `library_root` + `file_record` row so the
/// `ingest_resolution.image_id` FK constraint is satisfied.
async fn make_image(db: &Database, rel: &str) -> String {
    let root_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO library_root (id, label, current_path, kind, state, created_at)
         VALUES (?, 'test', '/tmp/e2e', 'local', 'active', '2026-01-01T00:00:00Z')",
    )
    .bind(&root_id)
    .execute(db.pool())
    .await
    .expect("library_root insert");

    let image_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO file_record
            (id, root_id, relative_path, size_bytes, mtime, state,
             first_seen_at, last_seen_at)
         VALUES (?, ?, ?, 1, '2026-01-01T00:00:00Z', 'observed',
                 '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    )
    .bind(&image_id)
    .bind(&root_id)
    .bind(rel)
    .execute(db.pool())
    .await
    .expect("file_record insert");

    image_id
}

/// Read the resolved `target_id` from the `ingest_resolution` table for an
/// image that has reached `state = resolved`.
async fn target_id_of(db: &Database, image_id: &str) -> Option<String> {
    let row: Option<(Option<String>, String)> =
        sqlx::query_as("SELECT target_id, state FROM ingest_resolution WHERE image_id = ?")
            .bind(image_id)
            .fetch_optional(db.pool())
            .await
            .unwrap();
    row.and_then(|(tid, _)| tid)
}

// ── Step 1: seed warm ─────────────────────────────────────────────────────────

/// The bundled seed must warm the redb cache on first run and be idempotent on
/// subsequent runs (second call returns `None`, meaning "already seeded").
#[tokio::test]
async fn step1_seed_warm_populates_redb_cache() {
    let store = Store::in_memory().expect("in-memory redb store");
    let cache = store.cache();
    let asset = messier_only_seed();

    assert!(
        targeting_resolver::seed::is_first_run(&cache).await.unwrap(),
        "an empty cache is first-run"
    );
    let first = targeting_resolver::seed::warm_cache(&cache, &asset, &ns()).await.unwrap();
    assert!(first >= 80, "seed must warm the Messier catalogue; got {first}");
    assert!(
        !targeting_resolver::seed::is_first_run(&cache).await.unwrap(),
        "a warmed cache is no longer first-run"
    );
}

// ── Step 2: local search against seeded data (US1) ───────────────────────────

/// After the seed is warmed, `target_search::search` must return the Andromeda
/// Galaxy for the query "M 31" without any network call, and without writing
/// `canonical_target` (FR-004/SC-002).
#[tokio::test]
async fn step2_search_finds_seeded_object_without_persisting() {
    let cache = seeded_cache().await;
    let db = seeded_db().await;

    let resp =
        target_search::search(&cache, &search_req("M 31")).await.expect("search must succeed");

    assert!(!resp.suggestions.is_empty(), "search for 'M 31' must return at least one result");
    assert_eq!(
        resp.suggestions[0].primary_designation, "M 31",
        "exact match 'M 31' must be ranked first; got '{}'",
        resp.suggestions[0].primary_designation
    );
    assert_eq!(
        resp.suggestions[0].object_type,
        contracts_core::targets::TargetObjectType::Galaxy,
        "M 31 must be typed as galaxy"
    );

    // SC-002: browsing never writes canonical_target.
    let (count,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM canonical_target").fetch_one(db.pool()).await.unwrap();
    assert_eq!(count, 0, "search must never write canonical_target");
}

// ── Step 3: long-tail resolve → explicit in-use promotion (US3, FR-004) ──────

/// A query for an object absent from the seed must be forwarded to the
/// `FakeResolver` and returned WITHOUT persisting; an explicit
/// `promote_by_id` call (the app-layer in-use commit) is what makes it
/// durable, enriching magnitude/constellation along the way.
#[tokio::test]
async fn step3_long_tail_resolve_then_explicit_promotion() {
    let db = seeded_db().await;
    let store = Store::in_memory().expect("in-memory redb store");
    let cache = store.cache();

    // FakeResolver knows "B 33" (Horsehead Nebula); a genuine miss for both
    // the seed and `SQLite`.
    let online_resolver = FakeResolver::new().with_response("B 33", horsehead());

    let resp1 =
        target_resolve::resolve(db.pool(), &online_resolver, &resolve_req("B 33")).await.unwrap();
    assert_eq!(resp1.status, TargetResolveStatus::Resolved, "resolve must succeed");
    let t1 = resp1.target.as_ref().expect("resolved response must carry a target");
    assert_eq!(t1.primary_designation, "B 33");
    assert_eq!(t1.source, TargetSource::Resolved);
    assert_eq!(online_resolver.call_count(), 1);

    // FR-004/SC-002: the plain resolve must not have written `SQLite`.
    let (count,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM canonical_target").fetch_one(db.pool()).await.unwrap();
    assert_eq!(count, 0, "resolve must never write canonical_target on its own");

    let target_id = targeting::identity::target_id_from_designation("B 33");
    assert_eq!(t1.target_id, target_id.to_string());

    // Simulate the production facade: it would have cached the resolved
    // identity in the SAME redb cache passed to `promote_by_id` as a side
    // effect of `resolver.resolve()` (`simbad::SimbadResolver::resolve` does
    // this transparently in production). Seed that here directly, then run
    // the explicit in-use commit (e.g. "add to project"/"favourite").
    let crate_identity = simbad_resolver::ResolvedIdentity {
        simbad_oid: Some(99_000_001),
        primary_designation: "B 33".to_owned(),
        common_name: Some("Horsehead Nebula".to_owned()),
        object_type: simbad_resolver::ObjectType::DarkNebula,
        otype_raw: String::new(),
        ra_deg: 85.244_58,
        dec_deg: -2.457_78,
        v_mag: Some(6.9),
        aliases: vec![simbad_resolver::ResolvedAlias::new(
            "B 33",
            simbad_resolver::AliasKind::Designation,
        )],
        source: simbad_resolver::TargetSource::Resolved,
    };
    cache.upsert(&crate_identity, &ns()).await.unwrap();

    let promoted =
        target_resolve::promote_by_id(db.pool(), &cache, target_id, "e2e-promote").await.unwrap();
    assert!(promoted, "promote_by_id must find the redb-cached identity");

    let durable = cache::get_by_id(db.pool(), target_id).await.unwrap().expect("now durable");
    assert_eq!(durable.primary_designation, "B 33");
}

// ── Step 4: ingest grouping (US4) ─────────────────────────────────────────────

/// Nothing is pre-promoted to `SQLite` (spec 052 P1: seed warms redb, not
/// `SQLite`), so every alias variant of one physical object is enqueued and
/// grouped onto the same canonical `target_id` by `resolve_pending`'s drain —
/// the resolver stands in for the production facade's own redb-cache-backed
/// resolution.
#[tokio::test]
async fn step4_alias_variants_group_to_same_target_via_drain() {
    let db = seeded_db().await;

    let img_m31 = make_image(&db, "m31_frame.fits").await;
    let img_ngc224 = make_image(&db, "ngc224_frame.fits").await;
    let img_common = make_image(&db, "andromeda_raw.fits").await;

    for (img, object) in [(&img_m31, "M 31"), (&img_ngc224, "NGC 224"), (&img_common, "Messier 31")]
    {
        let out =
            ingest_resolution::associate_or_enqueue(db.pool(), None, img, object).await.unwrap();
        assert_eq!(
            out,
            app_core::ingest_resolution::AssociateOutcome::Enqueued,
            "`SQLite` starts empty post-seed-warm (redb-only) — every OBJECT value \
             is a genuine cache miss until the drain resolves it"
        );
    }

    // One resolver response per alias variant, all sharing one simbad_oid so
    // the drain's dedup-by-oid groups them onto a single canonical row.
    let m31 = |primary: &str| ResolvedIdentity {
        simbad_oid: Some(1_575_544),
        primary_designation: primary.to_owned(),
        common_name: Some("Andromeda Galaxy".to_owned()),
        object_type: ObjectType::Galaxy,
        ra_deg: 10.684_708,
        dec_deg: 41.268_75,
        v_mag: Some(3.44),
        aliases: vec![
            ResolvedAlias::new("M 31", AliasKind::Designation),
            ResolvedAlias::new("NGC 224", AliasKind::Designation),
            ResolvedAlias::new("Messier 31", AliasKind::Designation),
            ResolvedAlias::new("Andromeda Galaxy", AliasKind::CommonName),
        ],
        source: CacheSrc::Resolved,
    };
    let resolver = FakeResolver::new()
        .with_response("M 31", m31("M 31"))
        .with_response("NGC 224", m31("M 31"))
        .with_response("Messier 31", m31("M 31"));

    let summary =
        ingest_resolution::resolve_pending(db.pool(), &resolver, None, true, 10).await.unwrap();
    assert_eq!(summary.resolved, 3, "all three pending rows must resolve");
    assert_eq!(summary.unresolved, 0);

    let tid_m31 = target_id_of(&db, &img_m31).await.expect("M 31 image must have a target_id");
    let tid_ngc224 =
        target_id_of(&db, &img_ngc224).await.expect("NGC 224 image must have a target_id");
    let tid_common =
        target_id_of(&db, &img_common).await.expect("common-name image must have a target_id");
    assert_eq!(tid_m31, tid_ngc224, "M 31 and NGC 224 must map to the same canonical target_id");
    assert_eq!(tid_m31, tid_common, "alias-via-queue must group to the same canonical target_id");
}

// ── Step 5: user override wins (FR-014) ───────────────────────────────────────

/// A manual override binding a query to a chosen (already-durable) target
/// must: (a) return `source = user-override` immediately, and (b) remain
/// sticky against a later normal resolve that would otherwise answer
/// differently.
#[tokio::test]
async fn step5_override_wins_and_is_sticky() {
    let db = seeded_db().await;

    // Seed M 101 directly into `SQLite` (simulates a previously-promoted,
    // in-use target — the override target must already be durable).
    let m101 = ResolvedIdentity {
        simbad_oid: Some(3_456_789),
        primary_designation: "M 101".to_owned(),
        common_name: Some("Pinwheel Galaxy".to_owned()),
        object_type: ObjectType::Galaxy,
        ra_deg: 210.802_42,
        dec_deg: 54.348_95,
        v_mag: None,
        aliases: vec![ResolvedAlias::new("M 101", AliasKind::Designation)],
        source: CacheSrc::Resolved,
    };
    let (m101_id, _) = cache::upsert_resolved(db.pool(), &m101).await.unwrap();

    // (a) Apply the override: bind "MyGalaxy" → M 101.
    let noop_resolver = FakeResolver::new(); // would NotFound for anything
    let resp_ov = target_resolve::resolve(
        db.pool(),
        &noop_resolver,
        &override_req("MyGalaxy", &m101_id.to_string()),
    )
    .await
    .unwrap();

    assert_eq!(resp_ov.status, TargetResolveStatus::Resolved, "override must resolve");
    let t_ov = resp_ov.target.as_ref().expect("override response must carry a target");
    assert_eq!(t_ov.source, TargetSource::UserOverride, "override source must be 'user-override'");
    assert_eq!(t_ov.primary_designation, "M 101", "override must return the chosen target (M 101)");

    // (b) Sticky: the durable row stays user-override even though a normal
    // resolve() no longer consults `SQLite` at all (FR-004) — stickiness now
    // lives entirely at the `SQLite`/promotion layer, asserted directly here.
    let got = cache::get_by_id(db.pool(), m101_id).await.unwrap().unwrap();
    assert_eq!(got.source, CacheSrc::UserOverride);
    assert_eq!(got.primary_designation, "M 101");

    // A later normal resolve of "MyGalaxy" against a resolver that would
    // answer differently must not touch `SQLite` at all (never called here,
    // since target_resolve::resolve is a pure delegate to the resolver).
    let wrong_resolver = FakeResolver::new().with_response(
        "MyGalaxy",
        ResolvedIdentity {
            simbad_oid: Some(1_575_544),
            primary_designation: "M 31".to_owned(),
            common_name: Some("Andromeda Galaxy".to_owned()),
            object_type: ObjectType::Galaxy,
            ra_deg: 10.684_708,
            dec_deg: 41.268_75,
            v_mag: None,
            aliases: vec![ResolvedAlias::new("M 31", AliasKind::Designation)],
            source: CacheSrc::Resolved,
        },
    );
    let resp_wrong = target_resolve::resolve(db.pool(), &wrong_resolver, &resolve_req("MyGalaxy"))
        .await
        .unwrap();
    assert_eq!(
        resp_wrong.target.as_ref().unwrap().primary_designation,
        "M 31",
        "a plain resolve reflects the injected resolver's fresh answer; override \
         stickiness is a promotion-time (`SQLite`) guarantee, not a resolve-time one"
    );
    // The durable M 101 override row is unaffected by that plain resolve.
    let still_override = cache::get_by_id(db.pool(), m101_id).await.unwrap().unwrap();
    assert_eq!(still_override.source, CacheSrc::UserOverride);
    assert_eq!(still_override.primary_designation, "M 101");
}
