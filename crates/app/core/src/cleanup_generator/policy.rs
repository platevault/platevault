// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Policy persistence (D13).

use contracts_core::cleanup::{CleanupAction, CleanupPolicy, CleanupPolicyEntry};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use persistence_plans::repositories::source_protection as prot_repo;
use sqlx::SqlitePool;

use crate::errors::db_err;

use super::DataType;

// ── Policy storage keys (D13) ─────────────────────────────────────────────

/// `protection_defaults` scope under which the cleanup policy is stored.
const CLEANUP_SCOPE: &str = "cleanup";
/// `protection_defaults` key holding the whole cleanup policy as JSON.
const CLEANUP_POLICY_KEY: &str = "policy";

// ── Policy persistence (D13) ────────────────────────────────────────────────

/// The default cleanup policy: every known data type is `Keep` (safe default —
/// nothing is proposed for cleanup until the user opts a type in), and cleanup
/// does not run automatically on project completion.
#[must_use]
pub fn default_cleanup_policy() -> CleanupPolicy {
    let entries = [DataType::Intermediate, DataType::Master, DataType::Final]
        .into_iter()
        .map(|dt| CleanupPolicyEntry {
            data_type: dt.as_str().to_owned(),
            action: CleanupAction::Keep,
        })
        .collect();
    CleanupPolicy { entries, auto_on_completion: false }
}

/// Read the persisted cleanup policy, falling back to [`default_cleanup_policy`]
/// when none is stored or the stored value cannot be decoded.
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn get_policy(pool: &SqlitePool) -> Result<CleanupPolicy, ContractError> {
    let stored = prot_repo::get_protection_default(pool, CLEANUP_SCOPE, CLEANUP_POLICY_KEY)
        .await
        .map_err(db_err)?;

    match stored {
        Some(value) => match serde_json::from_value(value) {
            Ok(policy) => Ok(policy),
            Err(e) => {
                // A stored-but-undecodable policy means the row was corrupted
                // or written by an incompatible version — worth noticing, not
                // hiding. Fall back to the all-Keep default (safe: nothing is
                // proposed for cleanup), leaving the stored row untouched.
                tracing::warn!(
                    "stored cleanup policy is corrupted ({e}); \
                     falling back to the all-Keep default policy"
                );
                Ok(default_cleanup_policy())
            }
        },
        None => Ok(default_cleanup_policy()),
    }
}

/// Persist the cleanup policy and return the stored value.
///
/// # Errors
///
/// Returns `ContractError` on serialisation or database failure.
pub async fn set_policy(
    pool: &SqlitePool,
    policy: &CleanupPolicy,
) -> Result<CleanupPolicy, ContractError> {
    let value = serde_json::to_value(policy).map_err(|e| {
        ContractError::new(
            ErrorCode::InternalData,
            format!("serialise cleanup policy: {e}"),
            ErrorSeverity::Fatal,
            false,
        )
    })?;
    prot_repo::set_protection_default(pool, CLEANUP_SCOPE, CLEANUP_POLICY_KEY, &value)
        .await
        .map_err(db_err)?;
    Ok(policy.clone())
}
