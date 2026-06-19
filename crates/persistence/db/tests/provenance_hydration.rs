//! Integration tests for `ProvenancedValue` hydration.
//!
//! Covers:
//!   * Priority resolution: reviewed > inferred > observed > generated > planned > applied.
//!   * History pagination: inline retention bounded at 10 newest entries; the
//!     `history_truncated` flag is set when more entries exist in the archive.

use audit::bus::EventBus;
use domain_core::ids::EntityId;
use domain_core::lifecycle::data_asset::EntityType;
use domain_core::lifecycle::provenance::ProvenanceTag;
use persistence_db::repositories::lifecycle::{LifecycleRepository, SqliteLifecycleRepository};
use persistence_db::repositories::provenance::{load_provenance, INLINE_HISTORY_LIMIT};
use persistence_db::Database;
use uuid::Uuid;

async fn setup() -> (Database, SqliteLifecycleRepository) {
    let db = Database::in_memory().await.expect("in-memory connect");
    db.migrate().await.expect("migrations");
    let repo =
        SqliteLifecycleRepository::new(db.pool().clone(), EventBus::new(db.pool().clone(), 16));
    (db, repo)
}

async fn insert_target(pool: &sqlx::SqlitePool, id: &str) {
    sqlx::query(
        "INSERT INTO target (id, primary_designation, created_at) \
         VALUES (?, ?, '2026-05-01T00:00:00Z')",
    )
    .bind(id)
    .bind(format!("DES-{id}"))
    .execute(pool)
    .await
    .unwrap();
}

/// Insert a project into the canonical `projects` table (spec-008 / migration 0018).
async fn insert_project(pool: &sqlx::SqlitePool, id: &str, _target_id: &str) {
    sqlx::query(
        "INSERT INTO projects \
         (id, name, tool, lifecycle, path, created_at, updated_at) \
         VALUES (?, 'P', 'PixInsight', 'ready', 'projects/P', '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z')",
    )
    .bind(id)
    .execute(pool)
    .await
    .unwrap();
}

#[allow(clippy::too_many_arguments)]
async fn insert_prov_row(
    pool: &sqlx::SqlitePool,
    asset_type: &str,
    asset_id: &str,
    field_path: &str,
    origin: &str,
    value_json: &str,
    captured_at: &str,
    replaced_by: Option<&str>,
) {
    sqlx::query(
        "INSERT INTO provenance_history_archive \
         (id, asset_type, asset_id, field_path, origin, value, captured_at, source_id, replaced_by, archived_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(asset_type)
    .bind(asset_id)
    .bind(field_path)
    .bind(origin)
    .bind(value_json)
    .bind(captured_at)
    .bind(replaced_by)
    .bind(captured_at)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn priority_resolution_reviewed_wins_over_inferred_and_observed() {
    let (db, _repo) = setup().await;
    let pool = db.pool();

    let asset_id = Uuid::new_v4().to_string();
    let entity_id = EntityId::from_uuid(Uuid::parse_str(&asset_id).unwrap());

    // Three entries for the same field, written in observed/inferred/reviewed
    // order. None of them are explicitly superseded.
    insert_prov_row(
        pool,
        "project",
        &asset_id,
        "target.coords",
        "observed",
        "\"obs\"",
        "2026-05-01T00:00:00Z",
        None,
    )
    .await;
    insert_prov_row(
        pool,
        "project",
        &asset_id,
        "target.coords",
        "inferred",
        "\"inf\"",
        "2026-05-02T00:00:00Z",
        None,
    )
    .await;
    insert_prov_row(
        pool,
        "project",
        &asset_id,
        "target.coords",
        "reviewed",
        "\"rev\"",
        "2026-05-03T00:00:00Z",
        None,
    )
    .await;

    let (map, truncated) = load_provenance(pool, entity_id, "project").await.unwrap();
    assert!(!truncated);
    let pv = map.get("target.coords").expect("field present");
    assert_eq!(pv.origin, ProvenanceTag::Reviewed);
    assert_eq!(pv.current, serde_json::json!("rev"));
    // history is newest-first
    assert_eq!(pv.history.len(), 3);
    assert_eq!(pv.history[0].origin, ProvenanceTag::Reviewed);
    assert_eq!(pv.history[2].origin, ProvenanceTag::Observed);
    assert!(!pv.history_truncated);
}

#[tokio::test]
async fn priority_resolution_skips_superseded_entries() {
    let (db, _repo) = setup().await;
    let pool = db.pool();

    let asset_id = Uuid::new_v4().to_string();
    let entity_id = EntityId::from_uuid(Uuid::parse_str(&asset_id).unwrap());

    // A reviewed entry that has been explicitly superseded should NOT be
    // selected as current — even though it would otherwise win on priority.
    insert_prov_row(
        pool,
        "project",
        &asset_id,
        "target.coords",
        "reviewed",
        "\"stale-rev\"",
        "2026-05-01T00:00:00Z",
        Some("some-pointer"),
    )
    .await;
    insert_prov_row(
        pool,
        "project",
        &asset_id,
        "target.coords",
        "inferred",
        "\"live-inf\"",
        "2026-05-02T00:00:00Z",
        None,
    )
    .await;

    let (map, _) = load_provenance(pool, entity_id, "project").await.unwrap();
    let pv = map.get("target.coords").unwrap();
    assert_eq!(pv.origin, ProvenanceTag::Inferred);
    assert_eq!(pv.current, serde_json::json!("live-inf"));
}

#[tokio::test]
async fn history_pagination_caps_inline_at_ten_and_sets_truncated_flag() {
    let (db, _repo) = setup().await;
    let pool = db.pool();

    let asset_id = Uuid::new_v4().to_string();
    let entity_id = EntityId::from_uuid(Uuid::parse_str(&asset_id).unwrap());

    // 15 observed entries on the same field.
    for i in 0..15 {
        let day = i + 1; // 1..=15
        insert_prov_row(
            pool,
            "project",
            &asset_id,
            "observer_location",
            "observed",
            &format!("{{\"day\":{day}}}"),
            &format!("2026-05-{day:02}T00:00:00Z"),
            None,
        )
        .await;
    }

    let (map, any_truncated) = load_provenance(pool, entity_id, "project").await.unwrap();
    assert!(any_truncated);
    let pv = map.get("observer_location").unwrap();
    assert_eq!(pv.history.len(), INLINE_HISTORY_LIMIT);
    assert!(pv.history_truncated);
    // newest-first: the first inline entry should be day 15.
    assert_eq!(pv.history[0].value, serde_json::json!({"day": 15}));
    assert_eq!(pv.history[INLINE_HISTORY_LIMIT - 1].value, serde_json::json!({"day": 6}));
}

#[tokio::test]
async fn load_provenance_for_unknown_asset_returns_empty_map() {
    let (db, _repo) = setup().await;
    let pool = db.pool();
    let entity_id = EntityId::from_uuid(Uuid::new_v4());
    let (map, truncated) = load_provenance(pool, entity_id, "project").await.unwrap();
    assert!(map.is_empty());
    assert!(!truncated);
}

#[tokio::test]
async fn load_asset_detail_includes_hydrated_provenance() {
    let (db, repo) = setup().await;
    let pool = db.pool();

    let target = Uuid::new_v4().to_string();
    let proj = Uuid::new_v4().to_string();
    insert_target(pool, &target).await;
    insert_project(pool, &proj, &target).await;
    insert_prov_row(
        pool,
        "project",
        &proj,
        "name",
        "reviewed",
        "\"Reviewed Name\"",
        "2026-05-10T00:00:00Z",
        None,
    )
    .await;

    let entity_id = EntityId::from_uuid(Uuid::parse_str(&proj).unwrap());
    let detail = repo.load_asset_detail(entity_id, EntityType::Project).await.unwrap();
    assert_eq!(detail.current_state, "ready");
    let pv = detail.provenance.get("name").expect("provenance present");
    assert_eq!(pv.origin, ProvenanceTag::Reviewed);
    assert_eq!(pv.current, serde_json::json!("Reviewed Name"));
    assert!(!detail.history_truncated);
}

#[tokio::test]
async fn field_origins_returns_winning_tag_per_field() {
    let (db, repo) = setup().await;
    let pool = db.pool();

    let target = Uuid::new_v4().to_string();
    let proj = Uuid::new_v4().to_string();
    insert_target(pool, &target).await;
    insert_project(pool, &proj, &target).await;

    // `name` has only an observed entry; `target.coords` has observed +
    // reviewed (reviewed must win per priority).
    insert_prov_row(
        pool,
        "project",
        &proj,
        "name",
        "observed",
        "\"raw\"",
        "2026-05-10T00:00:00Z",
        None,
    )
    .await;
    insert_prov_row(
        pool,
        "project",
        &proj,
        "target.coords",
        "observed",
        "\"obs\"",
        "2026-05-10T00:00:00Z",
        None,
    )
    .await;
    insert_prov_row(
        pool,
        "project",
        &proj,
        "target.coords",
        "reviewed",
        "\"rev\"",
        "2026-05-11T00:00:00Z",
        None,
    )
    .await;

    let entity_id = EntityId::from_uuid(Uuid::parse_str(&proj).unwrap());
    let origins = repo.field_origins(entity_id, EntityType::Project).await.unwrap();
    assert_eq!(origins.get("name"), Some(&ProvenanceTag::Observed));
    assert_eq!(origins.get("target.coords"), Some(&ProvenanceTag::Reviewed));
}

#[tokio::test]
async fn field_origins_empty_for_unknown_asset() {
    let (_db, repo) = setup().await;
    let entity_id = EntityId::from_uuid(Uuid::new_v4());
    let origins = repo.field_origins(entity_id, EntityType::Project).await.unwrap();
    assert!(origins.is_empty());
}
