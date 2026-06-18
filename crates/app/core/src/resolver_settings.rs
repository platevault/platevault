//! Resolver settings get/update use case for spec 035 (US5, FR-015).
//!
//! Reads and writes the singleton `resolver_settings` row (id = 1, seeded by
//! migration 0031): `online_enabled`, `simbad_endpoint`, `debounce_ms`,
//! `request_timeout_secs`. Serves the `target.resolution.settings` /
//! `target.resolution.settings.update` contracts.
//!
//! ## Constitution
//!
//! - §I No filesystem mutations: SQLite metadata only.
//! - §V SQLite is the durable record for resolver configuration.

use sqlx::SqlitePool;

use contracts_core::targets::{
    ResolverSettings, ResolverSettingsGetRequest, ResolverSettingsResponse,
    ResolverSettingsUpdateRequest,
};
use contracts_core::{ContractError, ErrorSeverity};

fn db_err(e: impl std::fmt::Display) -> ContractError {
    ContractError::new("internal.database", e.to_string(), ErrorSeverity::Fatal, true)
}

/// In-code defaults, mirroring the migration 0031 column defaults. Used when the
/// singleton row is somehow absent (it is seeded, so this is a safety net).
fn defaults() -> ResolverSettings {
    ResolverSettings {
        online_enabled: true,
        simbad_endpoint: targeting::resolver::simbad::DEFAULT_TAP_ENDPOINT.to_owned(),
        debounce_ms: 300,
        request_timeout_secs: 10,
    }
}

/// Validate a resolver endpoint URL (FIX-5a).
///
/// Accepts `https://…`; accepts `http://…` ONLY when the host is loopback
/// (`localhost`, `127.0.0.1`, `[::1]`). Anything else is a Blocking
/// `ContractError` so an insecure or malformed endpoint never reaches the
/// network layer. (No `url` crate in the workspace, so this is a focused manual
/// check sufficient for the scheme/host policy.)
#[allow(clippy::result_large_err)] // ContractError is the project-wide error DTO
fn validate_endpoint(endpoint: &str) -> Result<(), ContractError> {
    fn reject(msg: &str) -> ContractError {
        ContractError::new("resolver.endpoint_invalid", msg, ErrorSeverity::Blocking, false)
    }

    if let Some(rest) = endpoint.strip_prefix("https://") {
        if rest.is_empty() {
            return Err(reject("simbad_endpoint is missing a host"));
        }
        return Ok(());
    }
    if let Some(rest) = endpoint.strip_prefix("http://") {
        // Host is everything up to the first '/', ':', or end.
        let host = rest.split(['/', ':']).next().unwrap_or("");
        let is_loopback = host == "localhost" || host == "127.0.0.1" || host == "[::1]";
        if is_loopback {
            return Ok(());
        }
        return Err(reject("simbad_endpoint over http is only allowed for localhost; use https"));
    }
    Err(reject("simbad_endpoint must be an https URL (http allowed only for localhost)"))
}

/// Read the singleton `resolver_settings` row.
async fn read_row(pool: &SqlitePool) -> Result<ResolverSettings, ContractError> {
    let row: Option<(i64, String, i64, i64)> = sqlx::query_as(
        "SELECT online_enabled, simbad_endpoint, debounce_ms, request_timeout_secs
         FROM resolver_settings WHERE id = 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(db_err)?;

    Ok(row.map_or_else(
        defaults,
        |(online_enabled, simbad_endpoint, debounce_ms, request_timeout_secs)| ResolverSettings {
            online_enabled: online_enabled != 0,
            simbad_endpoint,
            debounce_ms: u32::try_from(debounce_ms.max(0)).unwrap_or(300),
            request_timeout_secs: u32::try_from(request_timeout_secs.max(0)).unwrap_or(10),
        },
    ))
}

/// `target.resolution.settings` (get) — return the current resolver settings.
///
/// # Errors
///
/// Returns [`ContractError`] (`internal.database`) on query failure.
pub async fn get(
    pool: &SqlitePool,
    req: &ResolverSettingsGetRequest,
) -> Result<ResolverSettingsResponse, ContractError> {
    let settings = read_row(pool).await?;
    Ok(ResolverSettingsResponse {
        contract_version: req.contract_version.clone(),
        request_id: req.request_id.clone(),
        settings,
    })
}

/// `target.resolution.settings.update` — persist new resolver settings and echo
/// the stored values back.
///
/// The singleton row is upserted (id = 1). `debounce_ms` / `request_timeout_secs`
/// are clamped to at least 1 to keep the live resolver well-formed.
///
/// # Errors
///
/// Returns [`ContractError`] (`internal.database`) on query failure.
pub async fn update(
    pool: &SqlitePool,
    req: &ResolverSettingsUpdateRequest,
) -> Result<ResolverSettingsResponse, ContractError> {
    let s = &req.settings;

    // FIX-5a: validate the endpoint is an HTTPS URL (HTTP allowed only for
    // localhost) before persisting, so a bad/insecure endpoint is rejected up
    // front rather than failing opaquely at resolve time.
    validate_endpoint(&s.simbad_endpoint)?;

    let debounce_ms = i64::from(s.debounce_ms.max(1));
    let timeout_secs = i64::from(s.request_timeout_secs.max(1));

    sqlx::query(
        "INSERT INTO resolver_settings
            (id, online_enabled, simbad_endpoint, debounce_ms, request_timeout_secs)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            online_enabled       = excluded.online_enabled,
            simbad_endpoint      = excluded.simbad_endpoint,
            debounce_ms          = excluded.debounce_ms,
            request_timeout_secs = excluded.request_timeout_secs",
    )
    .bind(i64::from(s.online_enabled))
    .bind(&s.simbad_endpoint)
    .bind(debounce_ms)
    .bind(timeout_secs)
    .execute(pool)
    .await
    .map_err(db_err)?;

    // Read back so the response reflects exactly what was stored (clamps applied).
    let settings = read_row(pool).await?;
    Ok(ResolverSettingsResponse {
        contract_version: req.contract_version.clone(),
        request_id: req.request_id.clone(),
        settings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use persistence_db::Database;

    async fn setup() -> Database {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        db
    }

    fn get_req() -> ResolverSettingsGetRequest {
        ResolverSettingsGetRequest {
            contract_version: "1.0".into(),
            request_id: "req-1".into(),
            op: "get".into(),
        }
    }

    #[tokio::test]
    async fn get_returns_seeded_defaults() {
        let db = setup().await;
        let resp = get(db.pool(), &get_req()).await.unwrap();
        assert!(resp.settings.online_enabled);
        assert_eq!(resp.settings.debounce_ms, 300);
        assert_eq!(resp.settings.request_timeout_secs, 10);
        assert!(resp.settings.simbad_endpoint.contains("sim-tap"));
        assert_eq!(resp.request_id, "req-1");
    }

    #[tokio::test]
    async fn update_persists_and_round_trips() {
        let db = setup().await;
        let upd = ResolverSettingsUpdateRequest {
            contract_version: "1.0".into(),
            request_id: "req-2".into(),
            op: "update".into(),
            settings: ResolverSettings {
                online_enabled: false,
                simbad_endpoint: "https://example.test/tap".into(),
                debounce_ms: 500,
                request_timeout_secs: 20,
            },
        };
        let resp = update(db.pool(), &upd).await.unwrap();
        assert!(!resp.settings.online_enabled);
        assert_eq!(resp.settings.simbad_endpoint, "https://example.test/tap");
        assert_eq!(resp.settings.debounce_ms, 500);

        // A subsequent get reflects the update.
        let got = get(db.pool(), &get_req()).await.unwrap();
        assert!(!got.settings.online_enabled);
        assert_eq!(got.settings.request_timeout_secs, 20);
    }

    #[tokio::test]
    async fn update_clamps_zero_timeout_and_debounce() {
        let db = setup().await;
        let upd = ResolverSettingsUpdateRequest {
            contract_version: "1.0".into(),
            request_id: "req-3".into(),
            op: "update".into(),
            settings: ResolverSettings {
                online_enabled: true,
                simbad_endpoint: "https://example.test/tap".into(),
                debounce_ms: 0,
                request_timeout_secs: 0,
            },
        };
        let resp = update(db.pool(), &upd).await.unwrap();
        assert_eq!(resp.settings.debounce_ms, 1);
        assert_eq!(resp.settings.request_timeout_secs, 1);
    }

    // ── FIX-5a: endpoint URL validation ────────────────────────────────────────

    fn upd_with_endpoint(endpoint: &str) -> ResolverSettingsUpdateRequest {
        ResolverSettingsUpdateRequest {
            contract_version: "1.0".into(),
            request_id: "req-ep".into(),
            op: "update".into(),
            settings: ResolverSettings {
                online_enabled: true,
                simbad_endpoint: endpoint.into(),
                debounce_ms: 300,
                request_timeout_secs: 10,
            },
        }
    }

    #[tokio::test]
    async fn update_accepts_https_and_localhost_http() {
        let db = setup().await;
        assert!(update(db.pool(), &upd_with_endpoint("https://simbad.cds.unistra.fr/x")).await.is_ok());
        assert!(update(db.pool(), &upd_with_endpoint("http://localhost:8080/tap")).await.is_ok());
        assert!(update(db.pool(), &upd_with_endpoint("http://127.0.0.1/tap")).await.is_ok());
    }

    #[tokio::test]
    async fn update_rejects_insecure_or_malformed_endpoint() {
        let db = setup().await;
        for bad in ["http://evil.example/tap", "ftp://x/y", "not-a-url", "https://"] {
            let err = update(db.pool(), &upd_with_endpoint(bad)).await;
            assert!(err.is_err(), "endpoint '{bad}' must be rejected");
            assert_eq!(err.unwrap_err().code, "resolver.endpoint_invalid");
        }
    }

    #[test]
    fn validate_endpoint_unit() {
        assert!(validate_endpoint("https://a.b/c").is_ok());
        assert!(validate_endpoint("http://localhost/x").is_ok());
        assert!(validate_endpoint("http://example.com/x").is_err());
        assert!(validate_endpoint("https://").is_err());
    }
}
