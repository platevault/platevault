// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Cross-target association queries and creation.
//!
//! An association is created exactly once, atomically with its first accepted
//! `manual_relation` proposal. It stores at least two canonical target members.
//! Automatic proposals and previews cannot create associations.

use sqlx::SqliteConnection;

use persistence_core::{DbError, DbResult};

#[derive(Clone, Debug)]
pub struct CrossTargetAssociationRow {
    pub row_id: i64,
    pub public_id: String,
    pub purpose: String,
    pub accepted_proposal_row_id: i64,
    pub actor_row_id: i64,
    pub created_sequence: i64,
    pub created_at: String,
}

pub async fn fetch_association_by_public_id(
    conn: &mut SqliteConnection,
    public_id: &str,
) -> DbResult<CrossTargetAssociationRow> {
    let row: Option<(i64, String, String, i64, i64, i64, String)> = sqlx::query_as(
        "SELECT row_id, public_id, purpose, accepted_proposal_row_id,
                actor_row_id, created_sequence, created_at
         FROM cross_target_association WHERE public_id = ?",
    )
    .bind(public_id)
    .fetch_optional(&mut *conn)
    .await?;

    let (row_id, pid, purpose, proposal_id, actor_id, seq, created_at) = row.ok_or_else(|| {
        DbError::NotFound(format!("cross_target_association public_id={public_id}"))
    })?;

    Ok(CrossTargetAssociationRow {
        row_id,
        public_id: pid,
        purpose,
        accepted_proposal_row_id: proposal_id,
        actor_row_id: actor_id,
        created_sequence: seq,
        created_at,
    })
}

/// List canonical target row IDs in ordinal order for an association.
pub async fn list_association_targets(
    conn: &mut SqliteConnection,
    association_row_id: i64,
) -> DbResult<Vec<(i64, i64 /* ordinal */)>> {
    let rows: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT canonical_target_row_id, ordinal
         FROM cross_target_association_target
         WHERE association_row_id = ?
         ORDER BY ordinal ASC",
    )
    .bind(association_row_id)
    .fetch_all(&mut *conn)
    .await?;

    Ok(rows)
}

/// Create a cross-target association with at least two targets.
///
/// Must be called inside `BEGIN IMMEDIATE` as part of a `manual_relation`
/// proposal acceptance. The accepted proposal row must already exist in this
/// transaction.
pub struct InsertCrossTargetAssociation<'a> {
    pub public_id: &'a str,
    pub purpose: &'a str,
    pub accepted_proposal_row_id: i64,
    pub actor_row_id: i64,
    /// At least two `(canonical_target_row_id, ordinal)` pairs.
    pub targets: &'a [(i64, i64)],
    pub created_sequence: i64,
    pub created_at: &'a str,
}

/// Returns the new `association_row_id`.
pub async fn insert_cross_target_association(
    conn: &mut SqliteConnection,
    input: &InsertCrossTargetAssociation<'_>,
) -> DbResult<i64> {
    debug_assert!(
        input.targets.len() >= 2,
        "cross_target_association requires at least two targets"
    );

    sqlx::query(
        "INSERT INTO cross_target_association
             (public_id, purpose, accepted_proposal_row_id, actor_row_id,
              created_sequence, created_at)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(input.public_id)
    .bind(input.purpose)
    .bind(input.accepted_proposal_row_id)
    .bind(input.actor_row_id)
    .bind(input.created_sequence)
    .bind(input.created_at)
    .execute(&mut *conn)
    .await?;

    let (row_id,): (i64,) =
        sqlx::query_as("SELECT row_id FROM cross_target_association WHERE public_id = ?")
            .bind(input.public_id)
            .fetch_one(&mut *conn)
            .await?;

    for (canonical_target_row_id, ordinal) in input.targets {
        sqlx::query(
            "INSERT INTO cross_target_association_target
                 (association_row_id, canonical_target_row_id, ordinal)
             VALUES (?, ?, ?)",
        )
        .bind(row_id)
        .bind(canonical_target_row_id)
        .bind(ordinal)
        .execute(&mut *conn)
        .await?;
    }

    Ok(row_id)
}
