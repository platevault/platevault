//! `target.resolve` use case for spec 035 (US3 — long-tail SIMBAD resolution).
//!
//! Cache-first resolution of a complete designation / common name (or a FITS
//! `OBJECT` value) to a canonical identity:
//!
//! 1. Look the (normalized) query up in the local resolution cache + bundled
//!    seed ([`targeting::resolver::cache`]). A hit returns immediately — a
//!    cached object is never re-queried (FR-006).
//! 2. On a miss, when online resolution is enabled (`resolver_settings`,
//!    FR-015), consult the injected [`Resolver`] (the live `SimbadResolver` in
//!    production; a `FakeResolver` in tests). A successful resolve is written to
//!    the cache (`source = resolved`) and returned.
//! 3. When online is disabled, SIMBAD is unreachable/times out, or the query is
//!    unknown/ambiguous, the result is `unresolved` (retryable, pending) — the
//!    use case NEVER fabricates coordinates (FR-009).
//!
//! The [`Resolver`] is injected (as a generic `&R`) so tests run offline with a
//! `FakeResolver` and no network. The manual `override` write path is left to
//! T032 (see [`resolve`]).
//!
//! ## Constitution
//!
//! - §I No filesystem mutations: reads/writes SQLite metadata only.
//! - §III Metadata/identity only — no image processing.
//! - §V SQLite (seed + resolution cache) is the durable record.

use sqlx::SqlitePool;

use contracts_core::targets::{
    ResolvedTarget, TargetObjectType, TargetResolveSimbadRequest, TargetResolveSimbadResponse,
    TargetResolveStatus, TargetSource,
};
use contracts_core::{ContractError, ErrorSeverity};
use targeting::normalize::normalize;
use targeting::resolver::cache::{self, CachedTarget};
use targeting::resolver::{ObjectType, ResolveError, Resolver, TargetSource as CacheSource};

// ── Error mapping ───────────────────────────────────────────────────────────

fn db_err(e: &cache::CacheError) -> ContractError {
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

fn common_name(target: &CachedTarget) -> Option<String> {
    target
        .aliases
        .iter()
        .find(|a| matches!(a.kind, targeting::resolver::AliasKind::CommonName))
        .map(|a| a.alias.clone())
}

fn cached_to_resolved(target: &CachedTarget) -> ResolvedTarget {
    ResolvedTarget {
        target_id: target.id.to_string(),
        simbad_oid: target.simbad_oid,
        primary_designation: target.primary_designation.clone(),
        common_name: common_name(target),
        object_type: map_object_type(target.object_type),
        ra_deg: target.ra_deg,
        dec_deg: target.dec_deg,
        aliases: target.aliases.iter().map(|a| a.alias.clone()).collect(),
        source: map_source(target.source),
    }
}

// ── Response builders ───────────────────────────────────────────────────────

fn resolved(req: &TargetResolveSimbadRequest, target: ResolvedTarget) -> TargetResolveSimbadResponse {
    TargetResolveSimbadResponse {
        contract_version: req.contract_version.clone(),
        request_id: req.request_id.clone(),
        status: TargetResolveStatus::Resolved,
        target: Some(target),
        unresolved_reason: None,
        error: None,
    }
}

fn unresolved(req: &TargetResolveSimbadRequest, reason: &str) -> TargetResolveSimbadResponse {
    TargetResolveSimbadResponse {
        contract_version: req.contract_version.clone(),
        request_id: req.request_id.clone(),
        status: TargetResolveStatus::Unresolved,
        target: None,
        unresolved_reason: Some(reason.to_owned()),
        error: None,
    }
}

// ── Settings ────────────────────────────────────────────────────────────────

/// The subset of `resolver_settings` this use case needs.
struct OnlineSettings {
    online_enabled: bool,
    endpoint: String,
    request_timeout_secs: i64,
}

/// Read the singleton `resolver_settings` row (id = 1). The row is seeded by
/// migration 0031, so this should always return a value; missing → defaults.
async fn read_settings(pool: &SqlitePool) -> Result<OnlineSettings, ContractError> {
    let row: Option<(i64, String, i64)> = sqlx::query_as(
        "SELECT online_enabled, simbad_endpoint, request_timeout_secs
         FROM resolver_settings WHERE id = 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| ContractError::new("internal.database", e.to_string(), ErrorSeverity::Fatal, true))?;

    Ok(row.map_or(
        OnlineSettings {
            online_enabled: true,
            endpoint: targeting::resolver::simbad::DEFAULT_TAP_ENDPOINT.to_owned(),
            request_timeout_secs: 10,
        },
        |(online_enabled, endpoint, request_timeout_secs)| OnlineSettings {
            online_enabled: online_enabled != 0,
            endpoint,
            request_timeout_secs,
        },
    ))
}

// ── resolve ───────────────────────────────────────────────────────────────────

/// `target.resolve` — cache-first resolution against the injected [`Resolver`].
///
/// `resolver` is injected so tests use a `FakeResolver` (no network); production
/// passes a `SimbadResolver`. The resolver's endpoint/timeout are configured by
/// the caller from `resolver_settings`; this use case only consults the
/// `online_enabled` flag here (the live `SimbadResolver` already carries the
/// endpoint + timeout from the same settings).
///
/// `override` (manual user override) is NOT written here — that path is T032.
/// When `req.override_target` is present we currently treat the request as a
/// normal resolve (read-only); the override write/precedence-lock lands in T032.
///
/// # Errors
///
/// Returns a `ContractError` (`internal.database`) only on a local SQLite
/// failure. Resolver failures (offline / unknown / ambiguous) are encoded in
/// the response as `status = unresolved` with a reason — never an `Err`.
pub async fn resolve<R: Resolver + ?Sized>(
    pool: &SqlitePool,
    resolver: &R,
    req: &TargetResolveSimbadRequest,
) -> Result<TargetResolveSimbadResponse, ContractError> {
    let query = req.query.trim();
    if query.is_empty() {
        return Ok(unresolved(req, "unknown"));
    }

    // 1) Cache-first (FR-006): a cached/seeded object is never re-queried.
    let norm = normalize(query);
    if let Some(target) = cache::get_by_normalized(pool, &norm).await.map_err(|e| db_err(&e))? {
        return Ok(resolved(req, cached_to_resolved(&target)));
    }

    // 2) Cache miss → consult the online resolver when enabled (FR-015).
    let settings = read_settings(pool).await?;
    if !settings.online_enabled {
        return Ok(unresolved(req, "offline"));
    }
    // `endpoint`/`request_timeout_secs` are surfaced for the caller that builds
    // the live resolver; bind them so the read is not flagged as dead.
    let _ = (&settings.endpoint, settings.request_timeout_secs);

    match resolver.resolve(query).await {
        Ok(identity) => {
            // 3) Persist (source = resolved), dedup by oid, then read back the
            // canonical row (which may carry a sticky user-override identity).
            let (id, _outcome) =
                cache::upsert_resolved(pool, &identity).await.map_err(|e| db_err(&e))?;
            if let Some(target) = cache::get_by_id(pool, id).await.map_err(|e| db_err(&e))? {
                Ok(resolved(req, cached_to_resolved(&target)))
            } else {
                // Should not happen (we just wrote it); never fabricate.
                Ok(unresolved(req, "unknown"))
            }
        }
        // Unknown/garbled (NotFound) and a malformed SIMBAD response (Parse)
        // both leave the item unresolved with reason "unknown" (never fabricate).
        Err(ResolveError::NotFound(_) | ResolveError::Parse(_)) => Ok(unresolved(req, "unknown")),
        Err(ResolveError::Ambiguous { .. }) => Ok(unresolved(req, "ambiguous")),
        Err(ResolveError::Network(_) | ResolveError::Timeout(_) | ResolveError::Disabled) => {
            Ok(unresolved(req, "offline"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use persistence_db::Database;
    use targeting::resolver::cache::upsert_resolved;
    use targeting::resolver::{
        AliasKind, FakeResolver, ResolvedAlias, ResolvedIdentity, TargetSource as Src,
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
            source: Src::Resolved,
        }
    }

    fn req(query: &str) -> TargetResolveSimbadRequest {
        TargetResolveSimbadRequest {
            contract_version: "1.0".into(),
            request_id: "req-1".into(),
            query: query.into(),
            override_target: None,
        }
    }

    async fn set_online(db: &Database, enabled: bool) {
        sqlx::query("UPDATE resolver_settings SET online_enabled = ? WHERE id = 1")
            .bind(i64::from(enabled))
            .execute(db.pool())
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn cache_hit_skips_resolver() {
        let db = setup().await;
        upsert_resolved(db.pool(), &m31()).await.unwrap();
        // Resolver that would PANIC the assertion if called (returns a wrong oid).
        let resolver = FakeResolver::new().with_default_error(ResolveError::Network("nope".into()));
        let resp = resolve(db.pool(), &resolver, &req("NGC 224")).await.unwrap();
        assert_eq!(resp.status, TargetResolveStatus::Resolved);
        let t = resp.target.unwrap();
        assert_eq!(t.primary_designation, "M 31");
        assert_eq!(t.source, TargetSource::Resolved);
    }

    #[tokio::test]
    async fn cache_miss_calls_resolver_and_caches() {
        let db = setup().await;
        let resolver = FakeResolver::new().with_response("M 31", m31());

        // First call: miss → resolver → cached.
        let resp = resolve(db.pool(), &resolver, &req("M 31")).await.unwrap();
        assert_eq!(resp.status, TargetResolveStatus::Resolved);
        assert_eq!(resp.target.as_ref().unwrap().simbad_oid, Some(1_575_544));

        // It must now be in the cache (read back by oid).
        let cached = cache::get_by_simbad_oid(db.pool(), 1_575_544).await.unwrap();
        assert!(cached.is_some());

        // Second call hits the cache even if the resolver is now "offline".
        let offline = FakeResolver::new().with_default_error(ResolveError::Network("down".into()));
        let resp2 = resolve(db.pool(), &offline, &req("M 31")).await.unwrap();
        assert_eq!(resp2.status, TargetResolveStatus::Resolved);
    }

    #[tokio::test]
    async fn disabled_online_degrades_to_unresolved_on_miss() {
        let db = setup().await;
        set_online(&db, false).await;
        // Resolver would succeed, but online is disabled so it must not be called.
        let resolver = FakeResolver::new().with_response("M 31", m31());
        let resp = resolve(db.pool(), &resolver, &req("M 31")).await.unwrap();
        assert_eq!(resp.status, TargetResolveStatus::Unresolved);
        assert_eq!(resp.unresolved_reason.as_deref(), Some("offline"));
        // Nothing was fabricated / written.
        assert!(cache::get_by_simbad_oid(db.pool(), 1_575_544).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn offline_resolver_degrades_to_unresolved() {
        let db = setup().await;
        let resolver = FakeResolver::new().with_default_error(ResolveError::Timeout(10));
        let resp = resolve(db.pool(), &resolver, &req("M 31")).await.unwrap();
        assert_eq!(resp.status, TargetResolveStatus::Unresolved);
        assert_eq!(resp.unresolved_reason.as_deref(), Some("offline"));
        assert!(resp.target.is_none());
    }

    #[tokio::test]
    async fn not_found_is_unresolved_unknown() {
        let db = setup().await;
        let resolver = FakeResolver::new(); // default NotFound
        let resp = resolve(db.pool(), &resolver, &req("ZZZ Nonexistent")).await.unwrap();
        assert_eq!(resp.status, TargetResolveStatus::Unresolved);
        assert_eq!(resp.unresolved_reason.as_deref(), Some("unknown"));
    }

    #[tokio::test]
    async fn ambiguous_is_unresolved_ambiguous() {
        let db = setup().await;
        let resolver = FakeResolver::new()
            .with_error("M 31", ResolveError::Ambiguous { query: "M 31".into(), count: 2 });
        let resp = resolve(db.pool(), &resolver, &req("M 31")).await.unwrap();
        assert_eq!(resp.status, TargetResolveStatus::Unresolved);
        assert_eq!(resp.unresolved_reason.as_deref(), Some("ambiguous"));
        assert!(cache::get_by_simbad_oid(db.pool(), 1_575_544).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn empty_query_is_unresolved() {
        let db = setup().await;
        let resolver = FakeResolver::new();
        let resp = resolve(db.pool(), &resolver, &req("   ")).await.unwrap();
        assert_eq!(resp.status, TargetResolveStatus::Unresolved);
    }

    #[tokio::test]
    async fn never_fabricates_coordinates_on_unresolved() {
        let db = setup().await;
        let resolver = FakeResolver::new();
        let resp = resolve(db.pool(), &resolver, &req("Garbled OBJECT value")).await.unwrap();
        assert!(resp.target.is_none(), "no coordinates fabricated for an unresolved query");
    }

    // T023 (backend): resolver is invoked exactly once across two resolves of the
    // same query. The second call must be served from the local cache (FR-006)
    // without re-invoking the network resolver.
    #[tokio::test]
    async fn resolver_invoked_exactly_once_for_repeated_query() {
        let db = setup().await;
        let resolver = FakeResolver::new().with_response("M 31", m31());

        // First call: cache miss → resolver called, result cached.
        let resp1 = resolve(db.pool(), &resolver, &req("M 31")).await.unwrap();
        assert_eq!(resp1.status, TargetResolveStatus::Resolved);

        // Second call: cache hit → resolver must NOT be called again.
        let resp2 = resolve(db.pool(), &resolver, &req("M 31")).await.unwrap();
        assert_eq!(resp2.status, TargetResolveStatus::Resolved);

        assert_eq!(
            resolver.call_count(),
            1,
            "resolver must be invoked exactly once; second call must be served from cache (FR-006)"
        );
    }
}
