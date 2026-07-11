//! `target.resolve` use case for spec 035 (US3 — long-tail SIMBAD resolution).
//!
//! Cache-first resolution of a complete designation / common name (or a FITS
//! `OBJECT` value) to a canonical identity:
//!
//! 1. Look the (normalized) query up in the local resolution cache + bundled
//!    seed ([`targeting_resolver::cache`]). A hit returns immediately — a
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
    ResolvedTarget, TargetResolveSimbadRequest, TargetResolveSimbadResponse, TargetResolveStatus,
};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};

use app_core_errors::db_internal_ctx;
use targeting::normalize::normalize;
use targeting_resolver::cache::{self, CachedTarget};
use targeting_resolver::{
    AliasKind, ResolveError, ResolvedAlias, ResolvedIdentity, Resolver, TargetSource as CacheSource,
};
use uuid::Uuid;

// ── Durable audit record (T039, constitution §V) ──────────────────────────────

/// Write a durable `audit_log_entry` row for a resolution outcome.
///
/// `actor` must be `user` or `system`; `trigger` is the resolution kind
/// (`target.resolved` / `target.user_override`). The entity is the resolved
/// `canonical_target`. The query that triggered the resolution is captured in
/// the JSON payload. Best-effort: an audit-write failure does not fail the
/// resolution (it is logged), so resolution remains non-blocking.
async fn write_audit(
    pool: &SqlitePool,
    target_id: &str,
    trigger: &str,
    actor: &str,
    request_id: &str,
    query: &str,
) {
    let audit_id = Uuid::new_v4().to_string();
    let at = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned());
    let payload = serde_json::json!({ "query": query }).to_string();

    let result = persistence_db::repositories::q_targets_mgmt::insert_resolution_audit(
        pool, &audit_id, target_id, trigger, actor, request_id, &at, &payload,
    )
    .await;

    if let Err(e) = result {
        tracing::warn!("failed to write resolution audit record: {e}");
    }
}

// ── Error mapping ───────────────────────────────────────────────────────────

fn db_err(e: &cache::CacheError) -> ContractError {
    ContractError::new(ErrorCode::InternalDatabase, format!("{e}"), ErrorSeverity::Fatal, true)
}

// ── Enum mapping (cache → contract DTO) ─────────────────────────────────────
//
// Shared mappers live in `crate::target_dto` (US11 T143).
use crate::target_dto::{common_name, map_object_type, map_source};

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

fn resolved(
    req: &TargetResolveSimbadRequest,
    target: ResolvedTarget,
) -> TargetResolveSimbadResponse {
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
    let row = persistence_db::repositories::q_targets_mgmt::get_resolver_settings_online(pool)
        .await
        .map_err(|e| db_internal_ctx(e, "read resolver_settings"))?;

    Ok(row.map_or(
        OnlineSettings {
            online_enabled: true,
            endpoint: targeting_resolver::simbad::DEFAULT_TAP_ENDPOINT.to_owned(),
            request_timeout_secs: 10,
        },
        |r| OnlineSettings {
            online_enabled: r.online_enabled != 0,
            endpoint: r.simbad_endpoint,
            request_timeout_secs: r.request_timeout_secs,
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
/// When `req.override_target` is present (manual override, FR-014/T032), the
/// `query` is bound to the chosen canonical target and persisted with
/// `source = user-override`; the cache precedence lock keeps it sticky against
/// later SIMBAD resolutions.
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

    // 0) Manual override (FR-014, T032): bind `query` to the chosen canonical
    // target and persist as source = user-override. The cache precedence lock
    // (T008) makes this sticky: a later SIMBAD resolve will NOT overwrite it.
    if let Some(ov) = &req.override_target {
        return apply_override(pool, req, query, &ov.target_id).await;
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
                // T039: durable audit record for the resolved outcome.
                write_audit(
                    pool,
                    &id.to_string(),
                    "target.resolved",
                    "system",
                    &req.request_id,
                    query,
                )
                .await;
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

// ── Manual override write (T032, FR-014) ────────────────────────────────────────

/// Bind `query` to the canonical target `target_id` and persist as
/// `source = user-override`.
///
/// The existing canonical row is loaded and re-written with
/// `source = UserOverride`, with `query` added as a designation alias so a later
/// `target.resolve` of the same query is a cache hit returning the override. The
/// cache precedence lock ([`cache::upsert_resolved`]) guarantees a subsequent
/// SIMBAD `resolved` write cannot overwrite it (FR-014).
async fn apply_override(
    pool: &SqlitePool,
    req: &TargetResolveSimbadRequest,
    query: &str,
    target_id: &str,
) -> Result<TargetResolveSimbadResponse, ContractError> {
    let id = Uuid::parse_str(target_id).map_err(|e| {
        ContractError::new(
            ErrorCode::TargetInvalidId,
            format!("override target_id '{target_id}' is not a valid UUID: {e}"),
            ErrorSeverity::Blocking,
            false,
        )
    })?;

    let Some(existing) = cache::get_by_id(pool, id).await.map_err(|e| db_err(&e))? else {
        // The override target must already exist in the cache; never fabricate.
        return Ok(unresolved(req, "unknown"));
    };

    // Carry over the existing identity, flip source to user-override, and ensure
    // the user's query is bound as an alias so it resolves to this target later.
    let mut aliases: Vec<ResolvedAlias> = existing.aliases.clone();
    let query_norm = normalize(query);
    if !aliases.iter().any(|a| a.normalized == query_norm) {
        aliases.push(ResolvedAlias::new(query, AliasKind::Designation));
    }

    let identity = ResolvedIdentity {
        simbad_oid: existing.simbad_oid,
        primary_designation: existing.primary_designation.clone(),
        common_name: existing
            .aliases
            .iter()
            .find(|a| a.kind == AliasKind::CommonName)
            .map(|a| a.alias.clone()),
        object_type: existing.object_type,
        ra_deg: existing.ra_deg,
        dec_deg: existing.dec_deg,
        aliases,
        source: CacheSource::UserOverride,
    };

    let (written_id, _outcome) =
        cache::upsert_resolved(pool, &identity).await.map_err(|e| db_err(&e))?;
    if let Some(target) = cache::get_by_id(pool, written_id).await.map_err(|e| db_err(&e))? {
        // T039: durable audit record for the manual user-override (actor = user).
        write_audit(
            pool,
            &written_id.to_string(),
            "target.user_override",
            "user",
            &req.request_id,
            query,
        )
        .await;
        Ok(resolved(req, cached_to_resolved(&target)))
    } else {
        Ok(unresolved(req, "unknown"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use contracts_core::targets::TargetSource;
    use persistence_db::Database;
    use targeting_resolver::cache::upsert_resolved;
    use targeting_resolver::{
        AliasKind, FakeResolver, ObjectType, ResolvedAlias, ResolvedIdentity, TargetSource as Src,
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

    // ── T032: manual override write path (FR-014) ──────────────────────────────

    fn m101() -> ResolvedIdentity {
        ResolvedIdentity {
            simbad_oid: Some(3_456_789),
            primary_designation: "M 101".to_owned(),
            common_name: Some("Pinwheel Galaxy".to_owned()),
            object_type: ObjectType::Galaxy,
            ra_deg: 210.802_42,
            dec_deg: 54.348_95,
            aliases: vec![
                ResolvedAlias::new("M 101", AliasKind::Designation),
                ResolvedAlias::new("NGC 5457", AliasKind::Designation),
            ],
            source: CacheSource::Resolved,
        }
    }

    fn override_req(query: &str, target_id: &str) -> TargetResolveSimbadRequest {
        TargetResolveSimbadRequest {
            contract_version: "1.0".into(),
            request_id: "req-ov".into(),
            query: query.into(),
            override_target: Some(contracts_core::targets::TargetResolveOverride {
                target_id: target_id.into(),
            }),
        }
    }

    #[tokio::test]
    async fn override_binds_query_to_target_as_user_override() {
        let db = setup().await;
        // Seed the override target (M 101) in the cache.
        let (m101_id, _) = upsert_resolved(db.pool(), &m101()).await.unwrap();

        // User overrides the ambiguous OBJECT "Pinwheel" → M 101.
        let resolver = FakeResolver::new(); // would NotFound
        let resp = resolve(db.pool(), &resolver, &override_req("Pinwheel", &m101_id.to_string()))
            .await
            .unwrap();
        assert_eq!(resp.status, TargetResolveStatus::Resolved);
        let t = resp.target.unwrap();
        assert_eq!(t.source, TargetSource::UserOverride);
        assert_eq!(t.primary_designation, "M 101");
    }

    #[tokio::test]
    async fn override_is_sticky_against_later_simbad_resolve() {
        let db = setup().await;
        let (m101_id, _) = upsert_resolved(db.pool(), &m101()).await.unwrap();

        // 1) Override "MyObj" → M 101.
        let none = FakeResolver::new();
        resolve(db.pool(), &none, &override_req("MyObj", &m101_id.to_string())).await.unwrap();

        // 2) A later normal resolve of "MyObj" — even though the FakeResolver
        // would return M 31 — must return the sticky user-override (M 101).
        let wrong = FakeResolver::new().with_response("MyObj", m31());
        let resp = resolve(db.pool(), &wrong, &req("MyObj")).await.unwrap();
        assert_eq!(resp.status, TargetResolveStatus::Resolved);
        let t = resp.target.unwrap();
        assert_eq!(t.source, TargetSource::UserOverride);
        assert_eq!(t.primary_designation, "M 101", "override must win over SIMBAD (FR-014)");
    }

    #[tokio::test]
    async fn override_unknown_target_is_unresolved() {
        let db = setup().await;
        let resolver = FakeResolver::new();
        let missing = Uuid::new_v4().to_string();
        let resp = resolve(db.pool(), &resolver, &override_req("X", &missing)).await.unwrap();
        assert_eq!(resp.status, TargetResolveStatus::Unresolved);
    }

    #[tokio::test]
    async fn override_invalid_uuid_errors() {
        let db = setup().await;
        let resolver = FakeResolver::new();
        let err = resolve(db.pool(), &resolver, &override_req("X", "not-a-uuid")).await;
        assert!(err.is_err());
    }

    // ── T039: durable audit records ────────────────────────────────────────────

    async fn audit_rows(db: &Database, trigger: &str) -> i64 {
        let (n,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM audit_log_entry WHERE trigger = ?")
            .bind(trigger)
            .fetch_one(db.pool())
            .await
            .unwrap();
        n
    }

    #[tokio::test]
    async fn resolve_writes_one_audit_record() {
        let db = setup().await;
        let resolver = FakeResolver::new().with_response("M 31", m31());
        let resp = resolve(db.pool(), &resolver, &req("M 31")).await.unwrap();
        assert_eq!(resp.status, TargetResolveStatus::Resolved);

        assert_eq!(audit_rows(&db, "target.resolved").await, 1, "one resolved audit record");
        // A cache hit on the next call must NOT write a second resolved record.
        let _ = resolve(db.pool(), &resolver, &req("M 31")).await.unwrap();
        assert_eq!(audit_rows(&db, "target.resolved").await, 1, "cache hit writes no audit record");
    }

    #[tokio::test]
    async fn override_writes_one_user_override_audit_record() {
        let db = setup().await;
        let (id, _) = upsert_resolved(db.pool(), &m31()).await.unwrap();
        let resolver = FakeResolver::new();
        let resp =
            resolve(db.pool(), &resolver, &override_req("MyObj", &id.to_string())).await.unwrap();
        assert_eq!(resp.status, TargetResolveStatus::Resolved);

        assert_eq!(
            audit_rows(&db, "target.user_override").await,
            1,
            "one user-override audit record (actor = user)"
        );
        let (actor,): (String,) = sqlx::query_as(
            "SELECT actor FROM audit_log_entry WHERE trigger = 'target.user_override'",
        )
        .fetch_one(db.pool())
        .await
        .unwrap();
        assert_eq!(actor, "user");
    }
}
