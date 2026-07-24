// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Relation proposal reads and state transitions.
//!
//! Acceptance, rejection, and supersession are atomic within one `BEGIN IMMEDIATE`
//! transaction that the caller opens before invoking these functions.
//!
//! Proposal generation is idempotent: `UNIQUE(kind, basis_digest,
//! evidence_digest, config_revision_row_id)` prevents duplicates.

use sqlx::SqliteConnection;

use persistence_core::{DbError, DbResult};

// ── Row types ─────────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
pub struct RelationProposalRow {
    pub row_id: i64,
    pub public_id: String,
    pub proposal_revision: i64,
    pub kind: String,
    pub basis_digest: String,
    pub evidence_digest: String,
    pub config_revision_row_id: i64,
    pub state: String,
    pub actor_row_id: Option<i64>,
    pub reason_code: Option<String>,
    pub superseded_by_proposal_row_id: Option<i64>,
    pub created_sequence: i64,
    pub decided_sequence: Option<i64>,
    pub created_at: String,
    pub decided_at: Option<String>,
}

#[derive(Clone, Debug)]
pub struct RelationDecisionSnapshotRow {
    pub row_id: i64,
    pub public_id: String,
    pub proposal_row_id: i64,
    pub proposal_revision: i64,
    pub decision_kind: String,
    pub accepted_revision_count: i64,
    pub retired_group_count: i64,
    pub lineage_count: i64,
    pub actor_row_id: i64,
    pub reason_code: String,
    pub created_at: String,
}

#[derive(Clone, Debug)]
pub struct RelationRejectionRow {
    pub row_id: i64,
    pub public_id: String,
    pub proposal_kind: String,
    pub basis_digest: String,
    pub evidence_digest: String,
    pub config_revision_row_id: i64,
    pub actor_row_id: i64,
    pub reason_code: String,
    pub note: Option<String>,
    pub created_at: String,
}

// ── Queries ───────────────────────────────────────────────────────────────────

pub async fn fetch_proposal_by_public_id(
    conn: &mut SqliteConnection,
    public_id: &str,
) -> DbResult<RelationProposalRow> {
    let row: Option<(
        i64,
        String,
        i64,
        String,
        String,
        String,
        i64,
        String,
        Option<i64>,
        Option<String>,
        Option<i64>,
        i64,
        Option<i64>,
        String,
        Option<String>,
    )> = sqlx::query_as(
        "SELECT row_id, public_id, proposal_revision, kind, basis_digest,
                evidence_digest, config_revision_row_id, state, actor_row_id,
                reason_code, superseded_by_proposal_row_id, created_sequence,
                decided_sequence, created_at, decided_at
         FROM relation_proposal WHERE public_id = ?",
    )
    .bind(public_id)
    .fetch_optional(&mut *conn)
    .await?;

    let (row_id, pid, rev, kind, basis, evidence, cfg, state, actor, reason, superseded, seq, decided_seq, created_at, decided_at) =
        row.ok_or_else(|| DbError::NotFound(format!("relation_proposal public_id={public_id}")))?;

    Ok(RelationProposalRow {
        row_id,
        public_id: pid,
        proposal_revision: rev,
        kind,
        basis_digest: basis,
        evidence_digest: evidence,
        config_revision_row_id: cfg,
        state,
        actor_row_id: actor,
        reason_code: reason,
        superseded_by_proposal_row_id: superseded,
        created_sequence: seq,
        decided_sequence: decided_seq,
        created_at,
        decided_at,
    })
}

/// List proposals with optional filters, newest first.
pub async fn list_proposals(
    conn: &mut SqliteConnection,
    state: Option<&str>,
    kind: Option<&str>,
    after_sequence: Option<i64>,
    after_public_id: Option<&str>,
    limit: u32,
) -> DbResult<Vec<RelationProposalRow>> {
    let rows: Vec<(
        i64,
        String,
        i64,
        String,
        String,
        String,
        i64,
        String,
        Option<i64>,
        Option<String>,
        Option<i64>,
        i64,
        Option<i64>,
        String,
        Option<String>,
    )> = sqlx::query_as(
        "SELECT row_id, public_id, proposal_revision, kind, basis_digest,
                evidence_digest, config_revision_row_id, state, actor_row_id,
                reason_code, superseded_by_proposal_row_id, created_sequence,
                decided_sequence, created_at, decided_at
         FROM relation_proposal
         WHERE (? IS NULL OR state = ?)
           AND (? IS NULL OR kind = ?)
           AND (? IS NULL OR created_at < ? OR (created_at = ? AND public_id > ?))
         ORDER BY created_at DESC, public_id ASC
         LIMIT ?",
    )
    .bind(state)
    .bind(state)
    .bind(kind)
    .bind(kind)
    .bind(after_sequence)
    .bind(after_public_id)
    .bind(after_public_id)
    .bind(after_public_id)
    .bind(limit as i64)
    .fetch_all(&mut *conn)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(row_id, pid, rev, kind, basis, evidence, cfg, state, actor, reason, superseded, seq, decided_seq, created_at, decided_at)| {
            RelationProposalRow {
                row_id,
                public_id: pid,
                proposal_revision: rev,
                kind,
                basis_digest: basis,
                evidence_digest: evidence,
                config_revision_row_id: cfg,
                state,
                actor_row_id: actor,
                reason_code: reason,
                superseded_by_proposal_row_id: superseded,
                created_sequence: seq,
                decided_sequence: decided_seq,
                created_at,
                decided_at,
            }
        })
        .collect())
}

// ── Writes ────────────────────────────────────────────────────────────────────

/// Insert a new pending proposal.
///
/// Idempotent on `UNIQUE(kind, basis_digest, evidence_digest,
/// config_revision_row_id)`. Returns the row_id regardless of whether the
/// row was inserted or already existed.
pub struct InsertProposal<'a> {
    pub public_id: &'a str,
    pub kind: &'a str,
    pub basis_digest: &'a str,
    pub evidence_digest: &'a str,
    pub config_revision_row_id: i64,
    pub created_sequence: i64,
    pub created_at: &'a str,
}

pub async fn insert_proposal(
    conn: &mut SqliteConnection,
    input: &InsertProposal<'_>,
) -> DbResult<i64> {
    sqlx::query(
        "INSERT OR IGNORE INTO relation_proposal
             (public_id, proposal_revision, kind, basis_digest, evidence_digest,
              config_revision_row_id, state, created_sequence, created_at)
         VALUES (?, 1, ?, ?, ?, ?, 'pending', ?, ?)",
    )
    .bind(input.public_id)
    .bind(input.kind)
    .bind(input.basis_digest)
    .bind(input.evidence_digest)
    .bind(input.config_revision_row_id)
    .bind(input.created_sequence)
    .bind(input.created_at)
    .execute(&mut *conn)
    .await?;

    // Record initial visibility history.
    let (row_id,): (i64,) =
        sqlx::query_as("SELECT row_id FROM relation_proposal WHERE kind = ? AND basis_digest = ? AND evidence_digest = ? AND config_revision_row_id = ?")
            .bind(input.kind)
            .bind(input.basis_digest)
            .bind(input.evidence_digest)
            .bind(input.config_revision_row_id)
            .fetch_one(&mut *conn)
            .await?;

    // Visibility history: insert only if not already present (for idempotency).
    sqlx::query(
        "INSERT OR IGNORE INTO relation_proposal_visibility_history
             (proposal_row_id, proposal_revision, state, visible_sequence)
         VALUES (?, 1, 'pending', ?)",
    )
    .bind(row_id)
    .bind(input.created_sequence)
    .execute(&mut *conn)
    .await?;

    Ok(row_id)
}

/// Accept a pending proposal with CAS on `proposal_revision`.
///
/// Increments `proposal_revision`, sets state to `accepted`, and inserts the
/// decision snapshot. Returns `DbError::CasFailed` when the CAS fails.
pub struct AcceptProposal<'a> {
    pub proposal_row_id: i64,
    pub expected_proposal_revision: i64,
    pub decision_snapshot_public_id: &'a str,
    pub accepted_revision_count: i64,
    pub retired_group_count: i64,
    pub lineage_count: i64,
    pub actor_row_id: i64,
    pub reason_code: &'a str,
    /// `audit_event.row_id` inserted in this same transaction.
    pub audit_row_id: i64,
    pub decided_sequence: i64,
    pub decided_at: &'a str,
}

/// Returns the `decision_snapshot_row_id`.
pub async fn accept_proposal(
    conn: &mut SqliteConnection,
    input: &AcceptProposal<'_>,
) -> DbResult<i64> {
    let result = sqlx::query(
        "UPDATE relation_proposal
         SET state = 'accepted',
             proposal_revision = proposal_revision + 1,
             actor_row_id = ?,
             reason_code = ?,
             decided_sequence = ?,
             decided_at = ?
         WHERE row_id = ?
           AND proposal_revision = ?
           AND state = 'pending'",
    )
    .bind(input.actor_row_id)
    .bind(input.reason_code)
    .bind(input.decided_sequence)
    .bind(input.decided_at)
    .bind(input.proposal_row_id)
    .bind(input.expected_proposal_revision)
    .execute(&mut *conn)
    .await?;

    if result.rows_affected() != 1 {
        return Err(DbError::CasFailed(format!(
            "relation_proposal accept CAS failed for row_id={} expected_revision={}",
            input.proposal_row_id, input.expected_proposal_revision
        )));
    }

    let new_revision = input.expected_proposal_revision + 1;

    // Update visibility history: retire current pending entry.
    sqlx::query(
        "UPDATE relation_proposal_visibility_history
         SET hidden_sequence = ?
         WHERE proposal_row_id = ? AND proposal_revision = ? AND hidden_sequence IS NULL",
    )
    .bind(input.decided_sequence)
    .bind(input.proposal_row_id)
    .bind(input.expected_proposal_revision)
    .execute(&mut *conn)
    .await?;

    // Insert accepted visibility entry.
    sqlx::query(
        "INSERT INTO relation_proposal_visibility_history
             (proposal_row_id, proposal_revision, state, visible_sequence)
         VALUES (?, ?, 'accepted', ?)",
    )
    .bind(input.proposal_row_id)
    .bind(new_revision)
    .bind(input.decided_sequence)
    .execute(&mut *conn)
    .await?;

    // Insert decision snapshot (audit_row_id FK is deferred, so the audit event
    // can be inserted after this).
    sqlx::query(
        "INSERT INTO relation_decision_snapshot
             (public_id, proposal_row_id, proposal_revision, decision_kind,
              accepted_revision_count, retired_group_count, lineage_count,
              actor_row_id, reason_code, audit_row_id,
              created_sequence, created_at)
         VALUES (?, ?, ?, 'accepted', ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(input.decision_snapshot_public_id)
    .bind(input.proposal_row_id)
    .bind(new_revision)
    .bind(input.accepted_revision_count)
    .bind(input.retired_group_count)
    .bind(input.lineage_count)
    .bind(input.actor_row_id)
    .bind(input.reason_code)
    .bind(input.audit_row_id)
    .bind(input.decided_sequence)
    .bind(input.decided_at)
    .execute(&mut *conn)
    .await?;

    let (snapshot_row_id,): (i64,) = sqlx::query_as(
        "SELECT row_id FROM relation_decision_snapshot WHERE proposal_row_id = ? AND proposal_revision = ?",
    )
    .bind(input.proposal_row_id)
    .bind(new_revision)
    .fetch_one(&mut *conn)
    .await?;

    Ok(snapshot_row_id)
}

/// Reject a pending proposal with CAS on `proposal_revision`.
///
/// Inserts a `relation_rejection` row for automatic-proposal suppression.
/// Returns `DbError::CasFailed` when the CAS fails.
pub struct RejectProposal<'a> {
    pub proposal_row_id: i64,
    pub expected_proposal_revision: i64,
    pub rejection_public_id: &'a str,
    pub actor_row_id: i64,
    pub reason_code: &'a str,
    pub note: Option<&'a str>,
    pub decided_sequence: i64,
    pub decided_at: &'a str,
    /// Decision snapshot.
    pub decision_snapshot_public_id: &'a str,
    pub audit_row_id: i64,
}

pub async fn reject_proposal(
    conn: &mut SqliteConnection,
    input: &RejectProposal<'_>,
) -> DbResult<i64> {
    let result = sqlx::query(
        "UPDATE relation_proposal
         SET state = 'rejected',
             proposal_revision = proposal_revision + 1,
             actor_row_id = ?,
             reason_code = ?,
             decided_sequence = ?,
             decided_at = ?
         WHERE row_id = ?
           AND proposal_revision = ?
           AND state = 'pending'",
    )
    .bind(input.actor_row_id)
    .bind(input.reason_code)
    .bind(input.decided_sequence)
    .bind(input.decided_at)
    .bind(input.proposal_row_id)
    .bind(input.expected_proposal_revision)
    .execute(&mut *conn)
    .await?;

    if result.rows_affected() != 1 {
        return Err(DbError::CasFailed(format!(
            "relation_proposal reject CAS failed for row_id={}",
            input.proposal_row_id
        )));
    }

    let new_revision = input.expected_proposal_revision + 1;

    // Retire pending visibility, add rejected.
    sqlx::query(
        "UPDATE relation_proposal_visibility_history
         SET hidden_sequence = ?
         WHERE proposal_row_id = ? AND proposal_revision = ? AND hidden_sequence IS NULL",
    )
    .bind(input.decided_sequence)
    .bind(input.proposal_row_id)
    .bind(input.expected_proposal_revision)
    .execute(&mut *conn)
    .await?;

    sqlx::query(
        "INSERT INTO relation_proposal_visibility_history
             (proposal_row_id, proposal_revision, state, visible_sequence)
         VALUES (?, ?, 'rejected', ?)",
    )
    .bind(input.proposal_row_id)
    .bind(new_revision)
    .bind(input.decided_sequence)
    .execute(&mut *conn)
    .await?;

    // Fetch the proposal for kind/basis/evidence for the rejection fingerprint.
    let (kind, basis_digest, evidence_digest, cfg_row_id): (String, String, String, i64) =
        sqlx::query_as(
            "SELECT kind, basis_digest, evidence_digest, config_revision_row_id
             FROM relation_proposal WHERE row_id = ?",
        )
        .bind(input.proposal_row_id)
        .fetch_one(&mut *conn)
        .await?;

    // Insert suppression row (OR IGNORE: idempotent on same fingerprint).
    sqlx::query(
        "INSERT OR IGNORE INTO relation_rejection
             (public_id, proposal_kind, basis_digest, evidence_digest,
              config_revision_row_id, actor_row_id, reason_code, note,
              created_sequence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(input.rejection_public_id)
    .bind(&kind)
    .bind(&basis_digest)
    .bind(&evidence_digest)
    .bind(cfg_row_id)
    .bind(input.actor_row_id)
    .bind(input.reason_code)
    .bind(input.note)
    .bind(input.decided_sequence)
    .bind(input.decided_at)
    .execute(&mut *conn)
    .await?;

    // Insert decision snapshot for rejection.
    sqlx::query(
        "INSERT INTO relation_decision_snapshot
             (public_id, proposal_row_id, proposal_revision, decision_kind,
              accepted_revision_count, retired_group_count, lineage_count,
              actor_row_id, reason_code, audit_row_id,
              created_sequence, created_at)
         VALUES (?, ?, ?, 'rejected', 0, 0, 0, ?, ?, ?, ?, ?)",
    )
    .bind(input.decision_snapshot_public_id)
    .bind(input.proposal_row_id)
    .bind(new_revision)
    .bind(input.actor_row_id)
    .bind(input.reason_code)
    .bind(input.audit_row_id)
    .bind(input.decided_sequence)
    .bind(input.decided_at)
    .execute(&mut *conn)
    .await?;

    let (snapshot_row_id,): (i64,) = sqlx::query_as(
        "SELECT row_id FROM relation_decision_snapshot WHERE proposal_row_id = ? AND proposal_revision = ?",
    )
    .bind(input.proposal_row_id)
    .bind(new_revision)
    .fetch_one(&mut *conn)
    .await?;

    Ok(snapshot_row_id)
}

/// Mark a pending proposal stale via CAS on `proposal_revision`.
///
/// The spec requires no acceptance rows to be created on stale transition.
pub async fn mark_proposal_stale(
    conn: &mut SqliteConnection,
    proposal_row_id: i64,
    expected_proposal_revision: i64,
    decided_sequence: i64,
    decided_at: &str,
) -> DbResult<()> {
    let result = sqlx::query(
        "UPDATE relation_proposal
         SET state = 'stale',
             proposal_revision = proposal_revision + 1,
             decided_sequence = ?,
             decided_at = ?
         WHERE row_id = ?
           AND proposal_revision = ?
           AND state = 'pending'",
    )
    .bind(decided_sequence)
    .bind(decided_at)
    .bind(proposal_row_id)
    .bind(expected_proposal_revision)
    .execute(&mut *conn)
    .await?;

    if result.rows_affected() != 1 {
        return Err(DbError::CasFailed(format!(
            "relation_proposal stale CAS failed for row_id={proposal_row_id}"
        )));
    }

    let new_revision = expected_proposal_revision + 1;

    sqlx::query(
        "UPDATE relation_proposal_visibility_history
         SET hidden_sequence = ?
         WHERE proposal_row_id = ? AND proposal_revision = ? AND hidden_sequence IS NULL",
    )
    .bind(decided_sequence)
    .bind(proposal_row_id)
    .bind(expected_proposal_revision)
    .execute(&mut *conn)
    .await?;

    sqlx::query(
        "INSERT INTO relation_proposal_visibility_history
             (proposal_row_id, proposal_revision, state, visible_sequence)
         VALUES (?, ?, 'stale', ?)",
    )
    .bind(proposal_row_id)
    .bind(new_revision)
    .bind(decided_sequence)
    .execute(&mut *conn)
    .await?;

    Ok(())
}

/// Supersede a pending proposal (correction flow) — sets state to `superseded`
/// and records the replacement proposal ID.
pub async fn supersede_proposal(
    conn: &mut SqliteConnection,
    proposal_row_id: i64,
    expected_proposal_revision: i64,
    replacement_proposal_row_id: i64,
    decided_sequence: i64,
    decided_at: &str,
) -> DbResult<()> {
    let result = sqlx::query(
        "UPDATE relation_proposal
         SET state = 'superseded',
             proposal_revision = proposal_revision + 1,
             superseded_by_proposal_row_id = ?,
             decided_sequence = ?,
             decided_at = ?
         WHERE row_id = ?
           AND proposal_revision = ?
           AND state = 'pending'",
    )
    .bind(replacement_proposal_row_id)
    .bind(decided_sequence)
    .bind(decided_at)
    .bind(proposal_row_id)
    .bind(expected_proposal_revision)
    .execute(&mut *conn)
    .await?;

    if result.rows_affected() != 1 {
        return Err(DbError::CasFailed(format!(
            "relation_proposal supersede CAS failed for row_id={proposal_row_id}"
        )));
    }

    let new_revision = expected_proposal_revision + 1;

    sqlx::query(
        "UPDATE relation_proposal_visibility_history
         SET hidden_sequence = ?
         WHERE proposal_row_id = ? AND proposal_revision = ? AND hidden_sequence IS NULL",
    )
    .bind(decided_sequence)
    .bind(proposal_row_id)
    .bind(expected_proposal_revision)
    .execute(&mut *conn)
    .await?;

    sqlx::query(
        "INSERT INTO relation_proposal_visibility_history
             (proposal_row_id, proposal_revision, state, visible_sequence)
         VALUES (?, ?, 'superseded', ?)",
    )
    .bind(proposal_row_id)
    .bind(new_revision)
    .bind(decided_sequence)
    .execute(&mut *conn)
    .await?;

    Ok(())
}

/// Check whether an automatic proposal would be suppressed by an existing
/// rejection row.
pub async fn is_automatic_proposal_suppressed(
    conn: &mut SqliteConnection,
    kind: &str,
    basis_digest: &str,
    evidence_digest: &str,
    config_revision_row_id: i64,
) -> DbResult<bool> {
    let (count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM relation_rejection
         WHERE proposal_kind = ?
           AND basis_digest = ?
           AND evidence_digest = ?
           AND config_revision_row_id = ?",
    )
    .bind(kind)
    .bind(basis_digest)
    .bind(evidence_digest)
    .bind(config_revision_row_id)
    .fetch_one(&mut *conn)
    .await?;

    Ok(count > 0)
}
