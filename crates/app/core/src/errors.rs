//! Canonical error conversion helpers for `app_core`.
//!
//! Provides a single `db_to_contract` helper that replaces the scattered,
//! divergent `db_err` helpers found previously in `target_search.rs` and
//! `ingest_resolution.rs`.
//!
//! ## Severity contract
//!
//! | `DbError` variant  | Code                       | Severity  | Retryable |
//! |--------------------|----------------------------|-----------|-----------|
//! | `NotFound`         | `internal.database`        | Blocking  | false     |
//! | all others         | `internal.database`        | Fatal     | true      |
//!
//! The `NotFound` path was previously mapped as `Fatal`/`retryable=true` in
//! `target_search.rs` and `ingest_resolution.rs` — that was the bug.  Modules
//! that need a **domain-specific** not-found code (e.g. `view.not_found`,
//! `project.not_found`) must keep their own explicit mapping; this helper
//! is only for generic infrastructure errors.

use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};

/// Convert a `sqlx::Error` inline (command-handler shorthand).
///
/// Wraps the sqlx error as `persistence_db::DbError::Database` then delegates
/// to `db_to_contract`.  Use this in command handlers that run inline sqlx
/// queries instead of calling a repository function.
#[must_use]
pub fn sqlx_to_contract(e: sqlx::Error) -> ContractError {
    db_to_contract(persistence_db::DbError::from(e))
}

/// Convert a database-layer error (`sqlx::Error` or
/// [`persistence_db::DbError`]) to an `internal.database` `ContractError`
/// while preserving the originating error and adding which operation failed.
///
/// The error is wrapped with [`anyhow::Context::context`] so the original
/// error is retained as the source of the resulting chain, then the full chain
/// is rendered with the alternate (`{:#}`) formatter — e.g.
/// `"insert calibration_session: <original sqlx message>"`.  This replaces
/// bare `e.to_string()` sites that discarded the operational context.
///
/// The wire contract is unchanged: the `code` stays
/// [`ErrorCode::InternalDatabase`] (serialized `"internal.database"`),
/// severity stays [`ErrorSeverity::Fatal`], and `retryable` stays `true`.
/// Only the human-readable `message` gains context.
#[must_use]
pub fn db_internal_ctx<E>(e: E, context: &'static str) -> ContractError
where
    E: std::error::Error + Send + Sync + 'static,
{
    use anyhow::Context as _;
    let enriched = Err::<(), _>(e).context(context).unwrap_err();
    ContractError::new(
        ErrorCode::InternalDatabase,
        format!("{enriched:#}"),
        ErrorSeverity::Fatal,
        true,
    )
}

/// Canonical generic `DbError` → `ContractError` mapper (US11 T142).
///
/// This is the single home every `.map_err(db_err)?` site that does **not**
/// need a domain-specific not-found code now collapses onto.
///
/// - `NotFound` → `internal.database`, `Blocking`, `retryable=false`
///   (recoverable: the caller referenced a missing entity and can recover by
///   referencing an existing one — it is **not** a fatal infrastructure fault).
/// - all others → `internal.database`, `Fatal`, `retryable=true`
///
/// ## L2 divergence fix (US11 T142)
///
/// Previously `settings.rs` and `protection.rs` had blanket `db_err` closures
/// that mapped **every** `DbError`, including `NotFound`, to
/// `Fatal`/`retryable=true`. That mislabeled a recoverable missing-row outcome
/// as a fatal database fault. Routing those sites through this canonical mapper
/// restores the recoverable `Blocking`/`retryable=false` classification for
/// `NotFound`. The wire `code` string is unchanged (`"internal.database"`);
/// only `severity`/`retryable` are corrected.
///
/// Modules that need a **domain-specific** not-found code (e.g. `plan.not_found`,
/// `project.not_found`, `view.not_found`) keep their own explicit `NotFound`
/// arm and delegate only the remaining variants here.
#[must_use]
pub fn db_err(e: persistence_db::DbError) -> ContractError {
    match e {
        persistence_db::DbError::NotFound(msg) => {
            ContractError::new(ErrorCode::InternalDatabase, msg, ErrorSeverity::Blocking, false)
        }
        other => ContractError::new(
            ErrorCode::InternalDatabase,
            format!("{other}"),
            ErrorSeverity::Fatal,
            true,
        ),
    }
}

/// Back-compat alias for the US8 name. Delegates to the canonical [`db_err`].
#[must_use]
pub fn db_to_contract(e: persistence_db::DbError) -> ContractError {
    db_err(e)
}

/// Canonical `BusError` → `ContractError` mapper (US11 T142).
///
/// Every per-module `bus_err` closure was byte-identical
/// (`internal.audit`, `Fatal`, `retryable=true`); this is the single home.
/// Takes the error by value to match the `.map_err(bus_err)` call sites (the
/// per-module copies all carried the same `needless_pass_by_value` allow).
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn bus_err(e: audit::bus::BusError) -> ContractError {
    ContractError::new(ErrorCode::InternalAudit, format!("{e}"), ErrorSeverity::Fatal, true)
}

// NOTE (US11 T142): a `From<persistence_db::DbError> for ContractError` impl is
// **not** possible in `app_core` — both `DbError` and `ContractError` are
// foreign types here, so the orphan rule (E0117) forbids the impl. It could
// only live in `contracts_core`, but `contracts_core` must not depend on
// `persistence_db` (that dependency inversion is tracked separately as T254).
// The canonical [`db_err`] free function provides the same mapping for every
// `.map_err(db_err)?` site, which is the achievable form of this task.
