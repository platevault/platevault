//! `target.search` use case for spec 035 (US1 — project-creation target search).
//!
//! As-you-type target search served PURELY from the local seed + cache index
//! (`targeting_resolver::cache::search_by_normalized`). There is NO network in
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
    TargetCatalogId, TargetSearchRequest, TargetSearchResponse, TargetSuggestion,
};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use targeting_resolver::cache::{search_by_normalized, CachedTarget, SearchHit};
use targeting_resolver::AliasKind;

// ── Error mapping ───────────────────────────────────────────────────────────

fn db_err(e: &targeting_resolver::cache::CacheError) -> ContractError {
    ContractError::new(ErrorCode::InternalDatabase, format!("{e}"), ErrorSeverity::Fatal, true)
}

// ── Enum mapping (cache → contract DTO) ─────────────────────────────────────
//
// Shared mappers live in `crate::target_dto` (US11 T143).
use crate::target_dto::{map_object_type, map_source};

/// Find the common name (a `common_name` alias) for a cached target, if any.
fn common_name(target: &CachedTarget) -> Option<String> {
    target
        .aliases
        .iter()
        .find(|a| matches!(a.kind, targeting_resolver::AliasKind::CommonName))
        .map(|a| a.alias.clone())
}

// ── Catalogue derivation (T029) ─────────────────────────────────────────────
//
// The cache has no catalogue column, so a target's catalogue membership is
// derived from its alias *designations*: the leading designation prefix maps to
// a closed `TargetCatalogId` (reusing the spec-013 catalogue vocabulary —
// `targeting::normalize` already expands these prefixes, so cached designations
// are space-separated like `M 31`, `NGC 224`, `SH 2-155`). NGC/IC both map to
// `Openngc`. Common names carry no catalogue and are ignored here.

/// Map a single designation to its catalogue, by leading prefix token.
fn designation_to_catalog(designation: &str) -> Option<TargetCatalogId> {
    let norm = targeting::normalize::normalize(designation);
    let prefix = norm.split_whitespace().next().unwrap_or("");
    match prefix {
        "m" => Some(TargetCatalogId::Messier),
        // Caldwell `C n` (normalize keeps the `c` prefix). Caldwell maps to an
        // NGC/IC object physically, but the *designation* prefix is the filter key.
        "c" | "caldwell" => Some(TargetCatalogId::Caldwell),
        "ngc" | "ic" | "openngc" => Some(TargetCatalogId::Openngc),
        "sh2" | "sharpless" => Some(TargetCatalogId::Sharpless),
        "abell" => Some(TargetCatalogId::AbellGalaxies),
        "arp" => Some(TargetCatalogId::Arp),
        "vdb" => Some(TargetCatalogId::Vdb),
        "b" | "barnard" => Some(TargetCatalogId::Barnard),
        "lbn" => Some(TargetCatalogId::Lbn),
        "ldn" => Some(TargetCatalogId::Ldn),
        "mel" | "melotte" => Some(TargetCatalogId::Melotte),
        _ => None,
    }
}

/// The set of catalogues a target belongs to, derived from its designations.
fn target_catalogs(target: &CachedTarget) -> Vec<TargetCatalogId> {
    let mut out: Vec<TargetCatalogId> = Vec::new();
    for a in &target.aliases {
        if a.kind == AliasKind::Designation {
            if let Some(cat) = designation_to_catalog(&a.alias) {
                if !out.contains(&cat) {
                    out.push(cat);
                }
            }
        }
    }
    out
}

/// Whether a target matches the (non-empty) catalogue filter: it belongs to at
/// least one of the requested catalogues.
fn matches_catalog_filter(target: &CachedTarget, filter: &[TargetCatalogId]) -> bool {
    if filter.is_empty() {
        return true;
    }
    let cats = target_catalogs(target);
    filter.iter().any(|f| cats.contains(f))
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
/// empty suggestion list. Both optional filters are applied as a post-filter and
/// AND together: `catalog_filter` against the target's catalogue membership
/// (derived from its alias designations) and `type_filter` against the object
/// type.
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

    // Both filters AND together (T029): catalogue membership is derived from the
    // target's alias designations; the type filter checks the object type.
    let catalog_filter = &req.catalog_filter;
    let type_filter = &req.type_filter;
    let suggestions: Vec<TargetSuggestion> = hits
        .into_iter()
        .filter(|hit| matches_catalog_filter(&hit.target, catalog_filter))
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
    use contracts_core::targets::{TargetObjectType, TargetSource};
    use persistence_db::Database;
    use targeting_resolver::cache::upsert_resolved;
    use targeting_resolver::{
        AliasKind, ObjectType, ResolvedAlias, ResolvedIdentity, TargetSource as CacheSource,
    };

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
    async fn search_catalog_filter_messier_narrows_to_m31() {
        let db = setup().await;
        seed(&db).await;
        // "NGC" prefix-matches both M31 (NGC 224) and NGC 7000, but only M31
        // also belongs to the Messier catalogue.
        let mut r = req("NGC");
        r.catalog_filter = vec![TargetCatalogId::Messier];
        let resp = search(db.pool(), &r).await.unwrap();
        assert_eq!(resp.suggestions.len(), 1);
        assert_eq!(resp.suggestions[0].primary_designation, "M 31");
    }

    #[tokio::test]
    async fn search_catalog_filter_openngc_matches_both() {
        let db = setup().await;
        seed(&db).await;
        let mut r = req("NGC");
        r.catalog_filter = vec![TargetCatalogId::Openngc];
        let resp = search(db.pool(), &r).await.unwrap();
        assert_eq!(resp.suggestions.len(), 2);
    }

    #[tokio::test]
    async fn search_catalog_and_type_filter_and_together() {
        let db = setup().await;
        seed(&db).await;
        // openngc ∩ galaxy → only M 31 (NGC 7000 is an emission nebula).
        let mut r = req("NGC");
        r.catalog_filter = vec![TargetCatalogId::Openngc];
        r.type_filter = vec![TargetObjectType::Galaxy];
        let resp = search(db.pool(), &r).await.unwrap();
        assert_eq!(resp.suggestions.len(), 1);
        assert_eq!(resp.suggestions[0].primary_designation, "M 31");
    }

    #[tokio::test]
    async fn search_catalog_filter_excludes_non_members() {
        let db = setup().await;
        seed(&db).await;
        // Filtering to Sharpless only → neither seeded target qualifies.
        let mut r = req("NGC");
        r.catalog_filter = vec![TargetCatalogId::Sharpless];
        let resp = search(db.pool(), &r).await.unwrap();
        assert!(resp.suggestions.is_empty());
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
