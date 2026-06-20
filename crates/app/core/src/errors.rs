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

/// Convert a `GuidedFlowError` to a `ContractError`.
impl From<crate::guided_flow::GuidedFlowError> for ContractError {
    fn from(e: crate::guided_flow::GuidedFlowError) -> Self {
        use crate::guided_flow::GuidedFlowError;
        match e {
            GuidedFlowError::UnknownStepId(id) => ContractError::new(
                ErrorCode::ValueInvalid,
                format!("unknown step id: {id}"),
                ErrorSeverity::Blocking,
                false,
            ),
            GuidedFlowError::FlowDismissed => ContractError::new(
                ErrorCode::TransitionRefused,
                "guided flow is dismissed; use restart first",
                ErrorSeverity::Blocking,
                false,
            ),
            GuidedFlowError::StateCorrupted => ContractError::new(
                ErrorCode::InternalDatabase,
                "guided flow state was corrupted and has been reset to Idle",
                ErrorSeverity::Blocking,
                false,
            ),
            GuidedFlowError::PersistenceUnavailable(msg) => {
                ContractError::new(ErrorCode::InternalDatabase, msg, ErrorSeverity::Fatal, true)
            }
        }
    }
}

/// Convert a `LogError` to a `ContractError`.
impl From<crate::log_stream::LogError> for ContractError {
    fn from(e: crate::log_stream::LogError) -> Self {
        use crate::log_stream::LogError;
        use contracts_core::log::LogExportErrorCode;
        match e {
            LogError::Export { code, message } => {
                let error_code = match code {
                    LogExportErrorCode::FormatUnsupported => ErrorCode::FormatUnsupported,
                    LogExportErrorCode::RangeInvalid => ErrorCode::RangeInvalid,
                    LogExportErrorCode::PathWriteDenied => ErrorCode::PathWriteDenied,
                    LogExportErrorCode::PathParentMissing => ErrorCode::PathParentMissing,
                };
                ContractError::new(error_code, message, ErrorSeverity::Blocking, false)
            }
            LogError::Database(db_err) => ContractError::new(
                ErrorCode::DatabaseError,
                db_err.to_string(),
                ErrorSeverity::Fatal,
                true,
            ),
            LogError::Serialise(e) => ContractError::new(
                ErrorCode::SerialiseError,
                e.to_string(),
                ErrorSeverity::Fatal,
                false,
            ),
            LogError::Io(e) => {
                ContractError::new(ErrorCode::IoError, e.to_string(), ErrorSeverity::Fatal, false)
            }
        }
    }
}

/// Convert a generic `DbError` to a `ContractError`.
///
/// - `NotFound` → `internal.database`, `Blocking`, `retryable=false`
/// - all others → `internal.database`, `Fatal`, `retryable=true`
///
/// Use this function (or a domain-specific mapping) instead of ad-hoc closures.
#[must_use]
pub fn db_to_contract(e: persistence_db::DbError) -> ContractError {
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
