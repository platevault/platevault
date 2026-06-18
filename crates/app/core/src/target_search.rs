//! `target.search` use case for spec 035 (US1 — project-creation target search).
//!
//! As-you-type target search served PURELY from the local seed + cache index
//! (`targeting::resolver::cache::search_by_normalized`). There is NO network in
//! this path (FR-005): long-tail / SIMBAD enrichment is a separate
//! `target.resolve` call. Results are ranked best-first (exact → prefix →
//! substring) and de-duplicated to one canonical target per hit.
//!
//! ## Constitution
//!
//! - §I No filesystem mutations: this use case only reads SQLite metadata.
//! - §III Metadata/identity only — no image processing.
//! - §V SQLite (seed + resolution cache) is the durable record queried here.

use sqlx::SqlitePool;

use contracts_core::targets::{
    TargetObjectType, TargetSearchRequest, TargetSearchResponse, TargetSource, TargetSuggestion,
};
use contracts_core::{ContractError, ErrorSeverity};
use targeting::resolver::cache::{search_by_normalized, CachedTarget, SearchHit};
use targeting::resolver::{ObjectType, TargetSource as CacheSource};

// ── Error mapping ───────────────────────────────────────────────────────────

fn db_err(e: &targeting::resolver::cache::CacheError) -> ContractError {
    ContractError::new("internal.database", format!("{e}"), ErrorSeverity::Fatal, true)
}

// ── Enum mapping (cache → contract DTO) ─────────────────────────────────────

fn map_object_type(o: ObjectType) -> TargetObjectType {
    match o {
        ObjectType::Galaxy => TargetObjectType::Galaxy,
        ObjectType::PlanetaryNebula => TargetObjectType::PlanetaryNebula,
        ObjectType::EmissionNebula => TargetObjectType::EmissionNebula,
        ObjectType::ReflectionNebula => TargetObjectType::ReflectionNebula,
        ObjectType::DarkNebula => TargetObjectType::DarkNebula,
        ObjectType::OpenCluster => TargetObjectType::OpenCluster,
        ObjectType::GlobularCluster => TargetObjectType::GlobularCluster,
        ObjectType::SupernovaRemnant => TargetObjectType::SupernovaRemnant,
        ObjectType::GalaxyCluster => TargetObjectType::GalaxyCluster,
        ObjectType::DoubleStar => TargetObjectType::DoubleStar,
        ObjectType::Asterism => TargetObjectType::Asterism,
        ObjectType::Other => TargetObjectType::Other,
    }
}

fn map_source(s: CacheSource) -> TargetSource {
    match s {
        CacheSource::Seed => TargetSource::Seed,
        CacheSource::Resolved => TargetSource::Resolved,
        CacheSource::UserOverride => TargetSource::UserOverride,
    }
}

/// Find the common name (a `common_name` alias) for a cached target, if any.
fn common_name(target: &CachedTarget) -> Option<String> {
    target
        .aliases
        .iter()
        .find(|a| matches!(a.kind, targeting::resolver::AliasKind::CommonName))
        .map(|a| a.alias.clone())
}

fn hit_to_suggestion(hit: SearchHit) -> TargetSuggestion {
    let object_type = map_object_type(hit.target.object_type);
    let source = map_source(hit.target.source);
    TargetSuggestion {
        target_id: hit.target.id.to_string(),
        primary_designation: hit.target.primary_designation.clone(),
        common_name: common_name(&hit.target),
        object_type,
        matched_alias: Some(hit.matched_alias),
        source,
    }
}

// ── search ──────────────────────────────────────────────────────────────────

/// `target.search` — ranked typeahead suggestions from local seed + cache.
///
/// Respects `limit` (default 20, see the request DTO). A blank query yields an
/// empty suggestion list. The optional `type_filter` is applied as a simple
/// post-filter on the object type; the `catalog_filter` is NOT yet applied
/// (full catalogue filtering is T029).
///
/// # Errors
///
/// Returns a `ContractError` (`internal.database`) when the local cache query
/// fails. There is no network in this path, so there is no resolver error here.
pub async fn search(
    pool: &SqlitePool,
    req: &TargetSearchRequest,
) -> Result<TargetSearchResponse, ContractError> {
    let limit = if req.limit == 0 { 20 } else { req.limit as usize };

    let hits = search_by_normalized(pool, &req.query, limit).await.map_err(|e| db_err(&e))?;

    // TODO(T029): apply `req.catalog_filter` (needs catalogue membership in the
    // cache schema). For now only the trivial type filter is applied.
    let type_filter = &req.type_filter;
    let suggestions: Vec<TargetSuggestion> = hits
        .into_iter()
        .map(hit_to_suggestion)
        .filter(|s| type_filter.is_empty() || type_filter.contains(&s.object_type))
        .collect();

    Ok(TargetSearchResponse {
        contract_version: req.contract_version.clone(),
        request_id: req.request_id.clone(),
        suggestions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use persistence_db::Database;
    use targeting::resolver::cache::upsert_resolved;
    use targeting::resolver::{AliasKind, ResolvedAlias, ResolvedIdentity};

    async fn setup() -> Database {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        db
    }

    fn m31() -> ResolvedIdentity {
        ResolvedIdentity {
            simbad_oid: Some(1_575_544),
            primary_designation: "M 31".to_owned(),
            common_name: Some("Andromeda Galaxy".to_owned()),
            object_type: ObjectType::Galaxy,
            ra_deg: 10.684_708,
            dec_deg: 41.268_75,
            aliases: vec![
                ResolvedAlias::new("M 31", AliasKind::Designation),
                ResolvedAlias::new("NGC 224", AliasKind::Designation),
                ResolvedAlias::new("Andromeda Galaxy", AliasKind::CommonName),
            ],
            source: CacheSource::Seed,
        }
    }

    fn ngc7000() -> ResolvedIdentity {
        ResolvedIdentity {
            simbad_oid: Some(2_222_222),
            primary_designation: "NGC 7000".to_owned(),
            common_name: Some("North America Nebula".to_owned()),
            object_type: ObjectType::EmissionNebula,
            ra_deg: 314.75,
            dec_deg: 44.366,
            aliases: vec![
                ResolvedAlias::new("NGC 7000", AliasKind::Designation),
                ResolvedAlias::new("North America Nebula", AliasKind::CommonName),
            ],
            source: CacheSource::Resolved,
        }
    }

    async fn seed(db: &Database) {
        upsert_resolved(db.pool(), &m31()).await.unwrap();
        upsert_resolved(db.pool(), &ngc7000()).await.unwrap();
    }

    fn req(query: &str) -> TargetSearchRequest {
        TargetSearchRequest {
            contract_version: "1.0".into(),
            request_id: "req-1".into(),
            query: query.into(),
            catalog_filter: Vec::new(),
            type_filter: Vec::new(),
            limit: 20,
        }
    }

    #[tokio::test]
    async fn search_maps_cached_target_to_suggestion() {
        let db = setup().await;
        seed(&db).await;
        let resp = search(db.pool(), &req("M 31")).await.unwrap();
        assert_eq!(resp.suggestions.len(), 1);
        let s = &resp.suggestions[0];
        assert_eq!(s.primary_designation, "M 31");
        assert_eq!(s.common_name.as_deref(), Some("Andromeda Galaxy"));
        assert_eq!(s.object_type, TargetObjectType::Galaxy);
        assert_eq!(s.source, TargetSource::Seed);
        assert_eq!(s.matched_alias.as_deref(), Some("M 31"));
        // target_id round-trips through the cache's UUIDv5.
        assert!(!s.target_id.is_empty());
    }

    #[tokio::test]
    async fn search_prefix_returns_ranked_local_matches() {
        let db = setup().await;
        seed(&db).await;
        let resp = search(db.pool(), &req("NGC")).await.unwrap();
        // "NGC 224" (M31) and "NGC 7000" both prefix-match.
        assert_eq!(resp.suggestions.len(), 2);
    }

    #[tokio::test]
    async fn search_respects_limit() {
        let db = setup().await;
        seed(&db).await;
        let mut r = req("nebula");
        r.limit = 1;
        let resp = search(db.pool(), &r).await.unwrap();
        assert!(resp.suggestions.len() <= 1);
    }

    #[tokio::test]
    async fn search_zero_limit_defaults_to_20() {
        let db = setup().await;
        seed(&db).await;
        let mut r = req("NGC");
        r.limit = 0;
        let resp = search(db.pool(), &r).await.unwrap();
        assert_eq!(resp.suggestions.len(), 2);
    }

    #[tokio::test]
    async fn search_type_filter_narrows_results() {
        let db = setup().await;
        seed(&db).await;
        let mut r = req("NGC");
        r.type_filter = vec![TargetObjectType::EmissionNebula];
        let resp = search(db.pool(), &r).await.unwrap();
        assert_eq!(resp.suggestions.len(), 1);
        assert_eq!(resp.suggestions[0].primary_designation, "NGC 7000");
    }

    #[tokio::test]
    async fn search_blank_query_is_empty() {
        let db = setup().await;
        seed(&db).await;
        let resp = search(db.pool(), &req("   ")).await.unwrap();
        assert!(resp.suggestions.is_empty());
    }

    #[tokio::test]
    async fn search_echoes_request_envelope() {
        let db = setup().await;
        seed(&db).await;
        let resp = search(db.pool(), &req("M 31")).await.unwrap();
        assert_eq!(resp.contract_version, "1.0");
        assert_eq!(resp.request_id, "req-1");
    }
}
