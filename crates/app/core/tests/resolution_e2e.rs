//! E2E integration test for the spec-035 resolution flow.
//!
//! Exercises the full chain across components that are unit-tested in isolation,
//! using a single in-memory `SQLite` database and the `FakeResolver` test double
//! (no network touches).
//!
//! Steps covered:
//!   1. Seed load  — `seed::load_bundled_on_first_run` populates the cache.
//!   2. Local search (US1) — `target_search::search` finds a seeded object.
//!   3. Long-tail resolve miss → cache (US3) — `target_resolve::resolve` calls
//!      the `FakeResolver` for an unseeded object, caches the result, and a
//!      second resolve with an offline resolver still returns it.
//!   4. Ingest grouping (US4) — `ingest_resolution::associate_or_enqueue` +
//!      `resolve_pending` group two alias-variant OBJECT strings to the same
//!      canonical `target_id`.
//!   5. Override wins (FR-014) — `resolve` with an `override_target` binding
//!      returns `source = user-override`; a subsequent normal resolve of the
//!      same query returns the override even when the `FakeResolver` would answer
//!      differently.

use app_core::{ingest_resolution, target_resolve, target_search};
use contracts_core::targets::TargetSearchRequest;
use contracts_core::targets::{
    TargetResolveOverride, TargetResolveSimbadRequest, TargetResolveStatus, TargetSource,
};
use persistence_db::Database;
use targeting_resolver::seed;
use targeting_resolver::{
    AliasKind, FakeResolver, ObjectType, ResolveError, ResolvedAlias, ResolvedIdentity,
    TargetSource as CacheSrc,
};
use uuid::Uuid;

// ── Shared helpers ────────────────────────────────────────────────────────────

async fn seeded_db() -> Database {
    let db = Database::in_memory().await.expect("in-memory DB");
    db.migrate().await.expect("migrations");
    let loaded = seed::load_bundled_on_first_run(db.pool())
        .await
        .expect("seed load must not fail")
        .expect("first-run seed must produce a count");
    assert!(loaded >= 110, "expected >= 110 seeded objects from bundled seed, got {loaded}");
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

// ── Step 1: seed load ─────────────────────────────────────────────────────────

/// The bundled seed must load into the cache on first run and be idempotent on
/// subsequent runs (second call returns `None`, meaning "already seeded").
#[tokio::test]
async fn step1_seed_load_populates_cache() {
    let db = Database::in_memory().await.expect("in-memory DB");
    db.migrate().await.expect("migrations");

    let first = seed::load_bundled_on_first_run(db.pool())
        .await
        .expect("seed must not error")
        .expect("first run must return a count");
    assert!(first >= 110, "seed must load >= 110 objects; got {first}");

    // Second call: already seeded → returns None (idempotent).
    let second =
        seed::load_bundled_on_first_run(db.pool()).await.expect("second call must not error");
    assert!(second.is_none(), "second call must be a no-op (already seeded)");
}

// ── Step 2: local search against seeded data (US1) ───────────────────────────

/// After the seed is loaded, `target_search::search` must return the Andromeda
/// Galaxy for the query "M 31" without any network call.
#[tokio::test]
async fn step2_search_finds_seeded_object() {
    let db = seeded_db().await;

    let resp =
        target_search::search(db.pool(), &search_req("M 31")).await.expect("search must succeed");

    assert!(!resp.suggestions.is_empty(), "search for 'M 31' must return at least one result");
    assert_eq!(
        resp.suggestions[0].primary_designation, "M 31",
        "exact match 'M 31' must be ranked first; got '{}'",
        resp.suggestions[0].primary_designation
    );
    // M 31 is a galaxy in the bundled seed.
    assert_eq!(
        resp.suggestions[0].object_type,
        contracts_core::targets::TargetObjectType::Galaxy,
        "M 31 must be typed as galaxy"
    );
}

// ── Step 3: long-tail miss → resolve → cache (US3) ───────────────────────────

/// A query for an object absent from the seed must be forwarded to the
/// `FakeResolver`, stored in the cache, and then served from cache on a second
/// call even when the resolver is offline.
#[tokio::test]
async fn step3_long_tail_resolve_caches_result() {
    let db = seeded_db().await;

    // FakeResolver knows "B 33" (Horsehead Nebula); the bundled seed does not
    // include Barnard dark nebulae, so this is a genuine cache miss.
    let online_resolver = FakeResolver::new().with_response("B 33", horsehead());

    // First call: cache miss → resolver → result cached.
    let resp1 =
        target_resolve::resolve(db.pool(), &online_resolver, &resolve_req("B 33")).await.unwrap();
    assert_eq!(resp1.status, TargetResolveStatus::Resolved, "first resolve must succeed");
    let t1 = resp1.target.as_ref().expect("resolved response must carry a target");
    assert_eq!(t1.primary_designation, "B 33");
    assert_eq!(
        t1.source,
        TargetSource::Resolved,
        "first resolve source must be 'resolved' (from SIMBAD)"
    );
    assert_eq!(
        online_resolver.call_count(),
        1,
        "resolver must be called exactly once (cache miss)"
    );

    // Second call with an offline resolver: cache hit must be served.
    let offline_resolver =
        FakeResolver::new().with_default_error(ResolveError::Network("no network".into()));
    let resp2 =
        target_resolve::resolve(db.pool(), &offline_resolver, &resolve_req("B 33")).await.unwrap();
    assert_eq!(
        resp2.status,
        TargetResolveStatus::Resolved,
        "second resolve must be served from cache even when offline"
    );
    // Offline resolver must never have been called.
    assert_eq!(offline_resolver.call_count(), 0, "cache hit must not call the resolver");
}

// ── Step 4: ingest grouping (US4) ─────────────────────────────────────────────

/// Two FITS frames whose OBJECT values are alias variants of the same canonical
/// object must end up associated with the same `target_id`.
///
/// Flow:
///  (a) "M 31" hits the seed cache → inline resolve.
///  (b) "NGC 224" also hits the cache (same object, different alias) → inline.
///  (c) `"AndromedaGalaxy"` is not in the cache → enqueued; `resolve_pending`
///      with a `FakeResolver` (returning M 31) then resolves it to the same id.
#[tokio::test]
async fn step4_alias_variants_group_to_same_target() {
    let db = seeded_db().await;

    // Frames with catalog-designation aliases — both seeded, resolve inline.
    let img_m31 = make_image(&db, "m31_frame.fits").await;
    let img_ngc224 = make_image(&db, "ngc224_frame.fits").await;

    let out_m31 =
        ingest_resolution::associate_or_enqueue(db.pool(), None, &img_m31, "M 31").await.unwrap();
    let out_ngc224 =
        ingest_resolution::associate_or_enqueue(db.pool(), None, &img_ngc224, "NGC 224")
            .await
            .unwrap();

    // Both must resolve inline (seed hit).
    assert!(
        matches!(out_m31, app_core::ingest_resolution::AssociateOutcome::ResolvedInline(_)),
        "M 31 seed hit must resolve inline; got {out_m31:?}"
    );
    assert!(
        matches!(out_ngc224, app_core::ingest_resolution::AssociateOutcome::ResolvedInline(_)),
        "NGC 224 seed hit must resolve inline; got {out_ngc224:?}"
    );

    let tid_m31 = target_id_of(&db, &img_m31).await.expect("M 31 image must have a target_id");
    let tid_ngc224 =
        target_id_of(&db, &img_ngc224).await.expect("NGC 224 image must have a target_id");
    assert_eq!(tid_m31, tid_ngc224, "M 31 and NGC 224 must map to the same canonical target_id");

    // Frame with a FITS OBJECT value that is NOT in the cache → enqueued.
    // We use "ANDROMEDA GALAXY" (all-caps, which normalises to the same key as
    // "Andromeda Galaxy") so the FakeResolver returns M 31 for it.
    let img_pending = make_image(&db, "andromeda_raw.fits").await;
    // Retrieve the M 31 identity from the cache to use in FakeResolver.
    // The common-name alias "Andromeda Galaxy" is in the bundled seed but we
    // test the queue path, so use a slightly different spelling that won't hit
    // the seed alias table.
    let out_pending = ingest_resolution::associate_or_enqueue(
        db.pool(),
        None,
        &img_pending,
        "Messier 31", // not a registered alias in the seed
    )
    .await
    .unwrap();
    assert_eq!(
        out_pending,
        app_core::ingest_resolution::AssociateOutcome::Enqueued,
        "unknown alias must be enqueued for background resolution"
    );

    // Build a FakeResolver that returns M 31 for the "Messier 31" query.
    // Use the same simbad_oid as the seed row so upsert dedupes correctly.
    // We don't know the seed's internal oid; query it from the DB instead.
    let (seed_oid,): (Option<i64>,) = sqlx::query_as(
        "SELECT ct.simbad_oid
         FROM canonical_target ct
         JOIN target_alias ta ON ta.target_id = ct.id
         WHERE ta.normalized = 'm 31'
         LIMIT 1",
    )
    .fetch_one(db.pool())
    .await
    .expect("M 31 must be in canonical_target after seed load");

    let m31_via_queue = ResolvedIdentity {
        simbad_oid: seed_oid,
        primary_designation: "M 31".to_owned(),
        common_name: Some("Andromeda Galaxy".to_owned()),
        object_type: ObjectType::Galaxy,
        ra_deg: 10.684_708,
        dec_deg: 41.268_75,
        aliases: vec![
            ResolvedAlias::new("M 31", AliasKind::Designation),
            ResolvedAlias::new("NGC 224", AliasKind::Designation),
            ResolvedAlias::new("Messier 31", AliasKind::Designation),
            ResolvedAlias::new("Andromeda Galaxy", AliasKind::CommonName),
        ],
        source: CacheSrc::Resolved,
    };
    let queue_resolver = FakeResolver::new().with_response("Messier 31", m31_via_queue);

    let summary = ingest_resolution::resolve_pending(
        db.pool(),
        &queue_resolver,
        None,
        true, // online_enabled
        10,
    )
    .await
    .unwrap();

    assert_eq!(summary.resolved, 1, "one pending row must be resolved by the queue drain");
    assert_eq!(summary.unresolved, 0, "no rows must remain unresolved");

    let tid_pending =
        target_id_of(&db, &img_pending).await.expect("pending image must now have a target_id");
    assert_eq!(
        tid_m31, tid_pending,
        "alias-via-queue must group to the same canonical target_id as the seed hit"
    );
}

// ── Step 5: user override wins (FR-014) ───────────────────────────────────────

/// A manual override binding a query to a chosen target must:
///  (a) return `source = user-override` immediately, and
///  (b) remain sticky — a subsequent normal resolve with a `FakeResolver` that
///      would return a different answer must still return the override.
#[tokio::test]
async fn step5_override_wins_and_is_sticky() {
    let db = seeded_db().await;

    // We need a canonical target id to override to. Use M 101 from the seed.
    let (m101_id, m101_desig): (String, String) = sqlx::query_as(
        "SELECT ct.id, ct.primary_designation
         FROM canonical_target ct
         JOIN target_alias ta ON ta.target_id = ct.id
         WHERE ta.normalized = 'm 101'
         LIMIT 1",
    )
    .fetch_one(db.pool())
    .await
    .expect("M 101 must be in canonical_target after seed load");

    // (a) Apply the override: bind "MyGalaxy" → M 101.
    let noop_resolver = FakeResolver::new(); // would NotFound for anything
    let resp_ov =
        target_resolve::resolve(db.pool(), &noop_resolver, &override_req("MyGalaxy", &m101_id))
            .await
            .unwrap();

    assert_eq!(resp_ov.status, TargetResolveStatus::Resolved, "override must resolve");
    let t_ov = resp_ov.target.as_ref().expect("override response must carry a target");
    assert_eq!(t_ov.source, TargetSource::UserOverride, "override source must be 'user-override'");
    assert_eq!(
        t_ov.primary_designation, m101_desig,
        "override must return the chosen target (M 101)"
    );

    // (b) Sticky: a normal resolve of "MyGalaxy" — even if FakeResolver would
    // return M 31 — must still return the user-override (M 101).
    let wrong_resolver = FakeResolver::new().with_response(
        "MyGalaxy",
        ResolvedIdentity {
            simbad_oid: Some(1_575_544),
            primary_designation: "M 31".to_owned(),
            common_name: Some("Andromeda Galaxy".to_owned()),
            object_type: ObjectType::Galaxy,
            ra_deg: 10.684_708,
            dec_deg: 41.268_75,
            aliases: vec![ResolvedAlias::new("M 31", AliasKind::Designation)],
            source: CacheSrc::Resolved,
        },
    );
    let resp_sticky = target_resolve::resolve(db.pool(), &wrong_resolver, &resolve_req("MyGalaxy"))
        .await
        .unwrap();

    assert_eq!(resp_sticky.status, TargetResolveStatus::Resolved, "sticky override must resolve");
    let t_sticky = resp_sticky.target.as_ref().expect("sticky response must carry a target");
    assert_eq!(
        t_sticky.source,
        TargetSource::UserOverride,
        "user-override must survive a subsequent normal resolve (FR-014)"
    );
    assert_eq!(
        t_sticky.primary_designation, m101_desig,
        "sticky override must still point to M 101, not the FakeResolver answer"
    );
    // The wrong resolver should never have been called (cache / override wins).
    assert_eq!(
        wrong_resolver.call_count(),
        0,
        "resolver must not be called when the cache/override already has the answer"
    );
}
