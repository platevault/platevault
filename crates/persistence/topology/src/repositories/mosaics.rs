// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only
#![allow(clippy::missing_errors_doc, clippy::type_complexity, clippy::too_many_lines)]

//! Mosaic heads, revisions, panel pins, edge evidence, lineage, and object
//! evidence queries.
//!
//! Current (non-stale) edges are those with no row in `mosaic_edge_invalidation`.
//! Historical revision queries return their pinned edges even after invalidation.

use sqlx::SqliteConnection;

use persistence_core::{DbError, DbResult};

// ── Row types ─────────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
pub struct MosaicRow {
    pub row_id: i64,
    pub public_id: String,
    pub canonical_target_row_id: Option<i64>,
    pub cross_target_association_row_id: Option<i64>,
    pub status: String,
    pub head_revision_row_id: Option<i64>,
    pub head_generation: i64,
    pub created_at: String,
    pub retired_at: Option<String>,
}

#[derive(Clone, Debug)]
pub struct MosaicRevisionRow {
    pub row_id: i64,
    pub public_id: String,
    pub mosaic_row_id: i64,
    pub revision_number: i64,
    pub parent_revision_row_id: Option<i64>,
    pub proposal_row_id: i64,
    pub config_revision_row_id: i64,
    pub actor_row_id: i64,
    pub reason_code: String,
    pub created_sequence: i64,
    pub created_at: String,
}

#[derive(Clone, Debug)]
pub struct MosaicRevisionPanelRow {
    pub panel_revision_row_id: i64,
    pub panel_group_row_id: i64,
    pub panel_revision_public_id: String,
    pub ordinal: i64,
}

#[derive(Clone, Debug)]
pub struct MosaicEdgeEvidenceRow {
    pub row_id: i64,
    pub public_id: String,
    pub left_panel_revision_row_id: i64,
    pub right_panel_revision_row_id: i64,
    pub overlap_ppm: i64,
    pub centre_separation_udeg: i64,
    pub residual_orientation_udeg: i64,
    pub parity_match: bool,
    pub evidence_digest: String,
    pub config_revision_row_id: i64,
    pub created_sequence: i64,
    pub created_at: String,
    /// `true` when at least one `mosaic_edge_invalidation` row exists.
    pub stale: bool,
    pub invalidation_reason_code: Option<String>,
    pub applied_plan_revision_row_id: Option<i64>,
}

#[derive(Clone, Debug)]
pub struct MosaicLineageRow {
    pub predecessor_mosaic_row_id: i64,
    pub successor_mosaic_row_id: i64,
    pub kind: String,
    pub proposal_row_id: i64,
    pub ordinal: i64,
    pub created_at: String,
}

// ── Queries ───────────────────────────────────────────────────────────────────

pub async fn fetch_mosaic_by_public_id(
    conn: &mut SqliteConnection,
    public_id: &str,
) -> DbResult<MosaicRow> {
    let row: Option<(
        i64,
        String,
        Option<i64>,
        Option<i64>,
        String,
        Option<i64>,
        i64,
        String,
        Option<String>,
    )> = sqlx::query_as(
        "SELECT row_id, public_id, canonical_target_row_id,
                    cross_target_association_row_id, status,
                    head_revision_row_id, head_generation, created_at, retired_at
             FROM mosaic WHERE public_id = ?",
    )
    .bind(public_id)
    .fetch_optional(&mut *conn)
    .await?;

    let (row_id, pid, ct, cta, status, head, gen, created_at, retired_at) =
        row.ok_or_else(|| DbError::NotFound(format!("mosaic public_id={public_id}")))?;

    Ok(MosaicRow {
        row_id,
        public_id: pid,
        canonical_target_row_id: ct,
        cross_target_association_row_id: cta,
        status,
        head_revision_row_id: head,
        head_generation: gen,
        created_at,
        retired_at,
    })
}

pub async fn fetch_mosaic_revision_by_public_id(
    conn: &mut SqliteConnection,
    public_id: &str,
) -> DbResult<MosaicRevisionRow> {
    fetch_mosaic_revision_impl(conn, None, Some(public_id)).await
}

pub async fn fetch_mosaic_revision_by_row_id(
    conn: &mut SqliteConnection,
    row_id: i64,
) -> DbResult<MosaicRevisionRow> {
    fetch_mosaic_revision_impl(conn, Some(row_id), None).await
}

async fn fetch_mosaic_revision_impl(
    conn: &mut SqliteConnection,
    row_id: Option<i64>,
    public_id: Option<&str>,
) -> DbResult<MosaicRevisionRow> {
    let row: Option<(i64, String, i64, i64, Option<i64>, i64, i64, i64, String, i64, String)> =
        sqlx::query_as(
            "SELECT row_id, public_id, mosaic_row_id, revision_number,
                    parent_revision_row_id, proposal_row_id, config_revision_row_id,
                    actor_row_id, reason_code, created_sequence, created_at
             FROM mosaic_revision
             WHERE (? IS NULL OR row_id = ?)
               AND (? IS NULL OR public_id = ?)",
        )
        .bind(row_id)
        .bind(row_id)
        .bind(public_id)
        .bind(public_id)
        .fetch_optional(&mut *conn)
        .await?;

    let (rid, pid, mosaic_rid, rev_num, parent, prop, cfg, actor, reason, seq, created_at) = row
        .ok_or_else(|| {
            DbError::NotFound(format!("mosaic_revision row_id={row_id:?} public_id={public_id:?}"))
        })?;

    Ok(MosaicRevisionRow {
        row_id: rid,
        public_id: pid,
        mosaic_row_id: mosaic_rid,
        revision_number: rev_num,
        parent_revision_row_id: parent,
        proposal_row_id: prop,
        config_revision_row_id: cfg,
        actor_row_id: actor,
        reason_code: reason,
        created_sequence: seq,
        created_at,
    })
}

/// List panels pinned in a mosaic revision in ordinal order.
pub async fn list_mosaic_revision_panels(
    conn: &mut SqliteConnection,
    mosaic_revision_row_id: i64,
    after_ordinal: Option<i64>,
    limit: u32,
) -> DbResult<Vec<MosaicRevisionPanelRow>> {
    let rows: Vec<(i64, i64, String, i64)> = sqlx::query_as(
        "SELECT mrp.panel_revision_row_id, mrp.panel_group_row_id,
                pgr.public_id, mrp.ordinal
         FROM mosaic_revision_panel mrp
         JOIN panel_group_revision pgr ON pgr.row_id = mrp.panel_revision_row_id
         WHERE mrp.mosaic_revision_row_id = ?
           AND (? IS NULL OR mrp.ordinal > ?)
         ORDER BY mrp.ordinal ASC, pgr.public_id ASC
         LIMIT ?",
    )
    .bind(mosaic_revision_row_id)
    .bind(after_ordinal)
    .bind(after_ordinal)
    .bind(i64::from(limit))
    .fetch_all(&mut *conn)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(pr_id, pg_id, pr_pub, ord)| MosaicRevisionPanelRow {
            panel_revision_row_id: pr_id,
            panel_group_row_id: pg_id,
            panel_revision_public_id: pr_pub,
            ordinal: ord,
        })
        .collect())
}

/// List edge evidence for a mosaic revision.
///
/// Returns edges with their staleness state: stale when any
/// `mosaic_edge_invalidation` row exists for the edge.
pub async fn list_mosaic_revision_edges(
    conn: &mut SqliteConnection,
    mosaic_revision_row_id: i64,
    after_ordinal: Option<i64>,
    limit: u32,
) -> DbResult<Vec<(MosaicEdgeEvidenceRow, i64 /* ordinal */)>> {
    let rows: Vec<(
        i64,
        String,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        String,
        i64,
        i64,
        String,
        i64,
        Option<String>,
        Option<i64>,
    )> = sqlx::query_as(
        "SELECT mee.row_id, mee.public_id,
                mee.left_panel_revision_row_id, mee.right_panel_revision_row_id,
                mee.overlap_ppm, mee.centre_separation_udeg, mee.residual_orientation_udeg,
                mee.parity_match, mee.evidence_digest, mee.config_revision_row_id,
                mee.created_sequence, mee.created_at,
                mre.ordinal,
                inv.reason_code,
                inv.applied_plan_revision_row_id
         FROM mosaic_revision_edge mre
         JOIN mosaic_edge_evidence mee ON mee.row_id = mre.edge_evidence_row_id
         LEFT JOIN (
             SELECT edge_evidence_row_id,
                    reason_code,
                    applied_plan_revision_row_id
             FROM mosaic_edge_invalidation
             GROUP BY edge_evidence_row_id
             HAVING row_id = MAX(row_id)
         ) inv ON inv.edge_evidence_row_id = mee.row_id
         WHERE mre.mosaic_revision_row_id = ?
           AND (? IS NULL OR mre.ordinal > ?)
         ORDER BY mre.ordinal ASC, mee.public_id ASC
         LIMIT ?",
    )
    .bind(mosaic_revision_row_id)
    .bind(after_ordinal)
    .bind(after_ordinal)
    .bind(i64::from(limit))
    .fetch_all(&mut *conn)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(
                row_id,
                public_id,
                left_pr,
                right_pr,
                overlap,
                sep,
                residual,
                parity,
                digest,
                cfg,
                seq,
                created_at,
                ordinal,
                inv_reason,
                inv_plan,
            )| {
                let stale = inv_reason.is_some();
                (
                    MosaicEdgeEvidenceRow {
                        row_id,
                        public_id,
                        left_panel_revision_row_id: left_pr,
                        right_panel_revision_row_id: right_pr,
                        overlap_ppm: overlap,
                        centre_separation_udeg: sep,
                        residual_orientation_udeg: residual,
                        parity_match: parity != 0,
                        evidence_digest: digest,
                        config_revision_row_id: cfg,
                        created_sequence: seq,
                        created_at,
                        stale,
                        invalidation_reason_code: inv_reason,
                        applied_plan_revision_row_id: inv_plan,
                    },
                    ordinal,
                )
            },
        )
        .collect())
}

/// List mosaic revision history for a mosaic, newest revision first.
pub async fn list_mosaic_revision_history(
    conn: &mut SqliteConnection,
    mosaic_row_id: i64,
    after_revision_number: Option<i64>,
    limit: u32,
) -> DbResult<Vec<MosaicRevisionRow>> {
    let rows: Vec<(i64, String, i64, i64, Option<i64>, i64, i64, i64, String, i64, String)> =
        sqlx::query_as(
            "SELECT row_id, public_id, mosaic_row_id, revision_number,
                    parent_revision_row_id, proposal_row_id, config_revision_row_id,
                    actor_row_id, reason_code, created_sequence, created_at
             FROM mosaic_revision
             WHERE mosaic_row_id = ?
               AND (? IS NULL OR revision_number < ?)
             ORDER BY revision_number DESC, public_id ASC
             LIMIT ?",
        )
        .bind(mosaic_row_id)
        .bind(after_revision_number)
        .bind(after_revision_number)
        .bind(i64::from(limit))
        .fetch_all(&mut *conn)
        .await?;

    Ok(rows
        .into_iter()
        .map(|(rid, pid, m_rid, rev_num, parent, prop, cfg, actor, reason, seq, created_at)| {
            MosaicRevisionRow {
                row_id: rid,
                public_id: pid,
                mosaic_row_id: m_rid,
                revision_number: rev_num,
                parent_revision_row_id: parent,
                proposal_row_id: prop,
                config_revision_row_id: cfg,
                actor_row_id: actor,
                reason_code: reason,
                created_sequence: seq,
                created_at,
            }
        })
        .collect())
}

pub async fn list_mosaic_lineage_predecessors(
    conn: &mut SqliteConnection,
    successor_mosaic_row_id: i64,
    limit: u32,
) -> DbResult<Vec<MosaicLineageRow>> {
    // Uses idx_mosaic_lineage_successor.
    let rows: Vec<(i64, i64, String, i64, i64, String)> = sqlx::query_as(
        "SELECT predecessor_mosaic_row_id, successor_mosaic_row_id,
                kind, proposal_row_id, ordinal, created_at
         FROM mosaic_lineage
         WHERE successor_mosaic_row_id = ?
         ORDER BY created_at DESC, proposal_row_id ASC, ordinal ASC,
                  predecessor_mosaic_row_id ASC
         LIMIT ?",
    )
    .bind(successor_mosaic_row_id)
    .bind(i64::from(limit))
    .fetch_all(&mut *conn)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(pred, succ, kind, prop, ord, created_at)| MosaicLineageRow {
            predecessor_mosaic_row_id: pred,
            successor_mosaic_row_id: succ,
            kind,
            proposal_row_id: prop,
            ordinal: ord,
            created_at,
        })
        .collect())
}

pub async fn list_mosaic_lineage_successors(
    conn: &mut SqliteConnection,
    predecessor_mosaic_row_id: i64,
    limit: u32,
) -> DbResult<Vec<MosaicLineageRow>> {
    let rows: Vec<(i64, i64, String, i64, i64, String)> = sqlx::query_as(
        "SELECT predecessor_mosaic_row_id, successor_mosaic_row_id,
                kind, proposal_row_id, ordinal, created_at
         FROM mosaic_lineage
         WHERE predecessor_mosaic_row_id = ?
         ORDER BY created_at DESC, proposal_row_id ASC, ordinal ASC,
                  successor_mosaic_row_id ASC
         LIMIT ?",
    )
    .bind(predecessor_mosaic_row_id)
    .bind(i64::from(limit))
    .fetch_all(&mut *conn)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(pred, succ, kind, prop, ord, created_at)| MosaicLineageRow {
            predecessor_mosaic_row_id: pred,
            successor_mosaic_row_id: succ,
            kind,
            proposal_row_id: prop,
            ordinal: ord,
            created_at,
        })
        .collect())
}

// ── Writes ────────────────────────────────────────────────────────────────────

/// Parameters for creating a mosaic and its first revision atomically.
pub struct InsertMosaicRevision<'a> {
    pub mosaic_public_id: &'a str,
    pub revision_public_id: &'a str,
    pub canonical_target_row_id: Option<i64>,
    pub cross_target_association_row_id: Option<i64>,
    pub proposal_row_id: i64,
    pub config_revision_row_id: i64,
    pub actor_row_id: i64,
    pub reason_code: &'a str,
    /// Panel revision pins: (panel_revision_row_id, panel_group_row_id, ordinal).
    pub panels: &'a [(i64, i64, i64)],
    /// Edge evidence row ids to include in this revision.
    pub edge_evidence_row_ids: &'a [(i64, i64 /* ordinal */)],
    pub created_sequence: i64,
    pub created_at: &'a str,
}

/// Create a mosaic and its first revision, or append a successor revision to
/// an existing mosaic.
///
/// When `existing_mosaic_row_id` is `None` a new mosaic is created. When it
/// is `Some` a successor revision is inserted and the head is advanced via CAS.
/// Returns `(mosaic_row_id, revision_row_id)`.
pub async fn upsert_mosaic_revision(
    conn: &mut SqliteConnection,
    input: &InsertMosaicRevision<'_>,
    existing_mosaic_row_id: Option<i64>,
    expected_head_generation: Option<i64>,
    current_revision_number: Option<i64>,
    parent_revision_row_id: Option<i64>,
) -> DbResult<(i64, i64)> {
    let mosaic_row_id = if let Some(existing_id) = existing_mosaic_row_id {
        existing_id
    } else {
        // Create new mosaic.
        sqlx::query(
            "INSERT INTO mosaic
                 (public_id, canonical_target_row_id, cross_target_association_row_id,
                  status, head_revision_row_id, head_generation, created_sequence, created_at)
             VALUES (?, ?, ?, 'active', NULL, 0, ?, ?)",
        )
        .bind(input.mosaic_public_id)
        .bind(input.canonical_target_row_id)
        .bind(input.cross_target_association_row_id)
        .bind(input.created_sequence)
        .bind(input.created_at)
        .execute(&mut *conn)
        .await?;

        let (id,): (i64,) = sqlx::query_as("SELECT row_id FROM mosaic WHERE public_id = ?")
            .bind(input.mosaic_public_id)
            .fetch_one(&mut *conn)
            .await?;
        id
    };

    let new_rev_num = current_revision_number.map_or(1, |n| n + 1);

    sqlx::query(
        "INSERT INTO mosaic_revision
             (public_id, mosaic_row_id, revision_number, parent_revision_row_id,
              proposal_row_id, config_revision_row_id, actor_row_id,
              reason_code, created_sequence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(input.revision_public_id)
    .bind(mosaic_row_id)
    .bind(new_rev_num)
    .bind(parent_revision_row_id)
    .bind(input.proposal_row_id)
    .bind(input.config_revision_row_id)
    .bind(input.actor_row_id)
    .bind(input.reason_code)
    .bind(input.created_sequence)
    .bind(input.created_at)
    .execute(&mut *conn)
    .await?;

    let (revision_row_id,): (i64,) =
        sqlx::query_as("SELECT row_id FROM mosaic_revision WHERE public_id = ?")
            .bind(input.revision_public_id)
            .fetch_one(&mut *conn)
            .await?;

    // Pin panels.
    for (panel_rev_row_id, panel_group_row_id, ordinal) in input.panels {
        sqlx::query(
            "INSERT INTO mosaic_revision_panel
                 (mosaic_revision_row_id, panel_revision_row_id, panel_group_row_id, ordinal)
             VALUES (?, ?, ?, ?)",
        )
        .bind(revision_row_id)
        .bind(panel_rev_row_id)
        .bind(panel_group_row_id)
        .bind(ordinal)
        .execute(&mut *conn)
        .await?;
    }

    // Pin edges.
    for (edge_row_id, ordinal) in input.edge_evidence_row_ids {
        sqlx::query(
            "INSERT INTO mosaic_revision_edge
                 (mosaic_revision_row_id, edge_evidence_row_id, ordinal)
             VALUES (?, ?, ?)",
        )
        .bind(revision_row_id)
        .bind(edge_row_id)
        .bind(ordinal)
        .execute(&mut *conn)
        .await?;
    }

    // Advance head via CAS.
    let gen_guard = expected_head_generation.unwrap_or(0);
    let result = if existing_mosaic_row_id.is_none() {
        // First revision: head was NULL; no CAS needed on generation since the
        // mosaic was just created.
        sqlx::query(
            "UPDATE mosaic SET head_revision_row_id = ?
             WHERE row_id = ? AND head_revision_row_id IS NULL",
        )
        .bind(revision_row_id)
        .bind(mosaic_row_id)
        .execute(&mut *conn)
        .await?
    } else {
        sqlx::query(
            "UPDATE mosaic
             SET head_revision_row_id = ?,
                 head_generation = head_generation + 1
             WHERE row_id = ? AND head_generation = ? AND status = 'active'",
        )
        .bind(revision_row_id)
        .bind(mosaic_row_id)
        .bind(gen_guard)
        .execute(&mut *conn)
        .await?
    };

    if result.rows_affected() != 1 {
        return Err(DbError::CasFailed(format!("mosaic row_id={mosaic_row_id} head CAS failed")));
    }

    // Record head history.
    let new_gen = if existing_mosaic_row_id.is_none() { 0i64 } else { gen_guard + 1 };
    sqlx::query(
        "INSERT INTO mosaic_head_history
             (mosaic_row_id, generation, head_revision_row_id, accepted_sequence)
         VALUES (?, ?, ?, ?)",
    )
    .bind(mosaic_row_id)
    .bind(new_gen)
    .bind(revision_row_id)
    .bind(input.created_sequence)
    .execute(&mut *conn)
    .await?;

    Ok((mosaic_row_id, revision_row_id))
}

/// Insert a mosaic edge evidence row.
///
/// Caller ensures left < right (the schema enforces this with a CHECK).
pub struct InsertEdgeEvidence<'a> {
    pub public_id: &'a str,
    pub left_panel_revision_row_id: i64,
    pub right_panel_revision_row_id: i64,
    pub overlap_ppm: i64,
    pub centre_separation_udeg: i64,
    pub residual_orientation_udeg: i64,
    pub parity_match: bool,
    pub evidence_digest: &'a str,
    pub config_revision_row_id: i64,
    pub created_sequence: i64,
    pub created_at: &'a str,
}

pub async fn insert_edge_evidence(
    conn: &mut SqliteConnection,
    input: &InsertEdgeEvidence<'_>,
) -> DbResult<i64> {
    sqlx::query(
        "INSERT INTO mosaic_edge_evidence
             (public_id, left_panel_revision_row_id, right_panel_revision_row_id,
              overlap_ppm, centre_separation_udeg, residual_orientation_udeg,
              parity_match, evidence_digest, config_revision_row_id,
              created_sequence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(input.public_id)
    .bind(input.left_panel_revision_row_id)
    .bind(input.right_panel_revision_row_id)
    .bind(input.overlap_ppm)
    .bind(input.centre_separation_udeg)
    .bind(input.residual_orientation_udeg)
    .bind(i64::from(input.parity_match))
    .bind(input.evidence_digest)
    .bind(input.config_revision_row_id)
    .bind(input.created_sequence)
    .bind(input.created_at)
    .execute(&mut *conn)
    .await?;

    let (row_id,): (i64,) =
        sqlx::query_as("SELECT row_id FROM mosaic_edge_evidence WHERE public_id = ?")
            .bind(input.public_id)
            .fetch_one(&mut *conn)
            .await?;

    Ok(row_id)
}

/// Invalidate an edge evidence row as a side-effect of applying a
/// reclassification plan.
pub async fn invalidate_edge_evidence(
    conn: &mut SqliteConnection,
    edge_evidence_row_id: i64,
    applied_plan_revision_row_id: i64,
    reason_code: &str,
    created_sequence: i64,
    created_at: &str,
) -> DbResult<()> {
    sqlx::query(
        "INSERT INTO mosaic_edge_invalidation
             (edge_evidence_row_id, applied_plan_revision_row_id,
              reason_code, created_sequence, created_at)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(edge_evidence_row_id)
    .bind(applied_plan_revision_row_id)
    .bind(reason_code)
    .bind(created_sequence)
    .bind(created_at)
    .execute(&mut *conn)
    .await?;

    Ok(())
}

/// Retire a mosaic and insert a lineage edge atomically.
pub struct RetireMosaic<'a> {
    pub mosaic_row_id: i64,
    pub successor_mosaic_row_id: i64,
    pub lineage_kind: &'a str,
    pub proposal_row_id: i64,
    pub lineage_ordinal: i64,
    pub created_sequence: i64,
    pub created_at: &'a str,
    pub expected_head_generation: i64,
}

pub async fn retire_mosaic(conn: &mut SqliteConnection, input: &RetireMosaic<'_>) -> DbResult<()> {
    let result = sqlx::query(
        "UPDATE mosaic
         SET status = 'retired', retired_at = ?
         WHERE row_id = ? AND head_generation = ? AND status = 'active'",
    )
    .bind(input.created_at)
    .bind(input.mosaic_row_id)
    .bind(input.expected_head_generation)
    .execute(&mut *conn)
    .await?;

    if result.rows_affected() != 1 {
        return Err(DbError::CasFailed(format!(
            "mosaic retire CAS failed for row_id={}",
            input.mosaic_row_id
        )));
    }

    sqlx::query(
        "INSERT INTO mosaic_lineage
             (predecessor_mosaic_row_id, successor_mosaic_row_id, kind,
              proposal_row_id, ordinal, created_sequence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(input.mosaic_row_id)
    .bind(input.successor_mosaic_row_id)
    .bind(input.lineage_kind)
    .bind(input.proposal_row_id)
    .bind(input.lineage_ordinal)
    .bind(input.created_sequence)
    .bind(input.created_at)
    .execute(&mut *conn)
    .await?;

    Ok(())
}

/// Detect a mosaic lineage cycle (same semantics as panel lineage cycle check).
pub async fn mosaic_lineage_cycle_exists(
    conn: &mut SqliteConnection,
    proposed_predecessor_row_id: i64,
    proposed_successor_row_id: i64,
) -> DbResult<bool> {
    let (count,): (i64,) = sqlx::query_as(
        "WITH RECURSIVE reachable(mosaic_row_id) AS (
             SELECT ?
             UNION
             SELECT ml.successor_mosaic_row_id
             FROM mosaic_lineage ml
             JOIN reachable r ON ml.predecessor_mosaic_row_id = r.mosaic_row_id
         )
         SELECT COUNT(*) FROM reachable WHERE mosaic_row_id = ?",
    )
    .bind(proposed_successor_row_id)
    .bind(proposed_predecessor_row_id)
    .fetch_one(&mut *conn)
    .await?;

    Ok(count > 0)
}

/// Determine whether a new edge between `left_panel_revision_row_id` and
/// `right_panel_revision_row_id` would bridge two separate accepted mosaic
/// components.
///
/// A bridge exists when both endpoints are already members of distinct active
/// mosaic heads. Returns the mosaic public IDs of the bridged components when
/// a bridge exists.
pub async fn find_bridged_mosaic_components(
    conn: &mut SqliteConnection,
    left_panel_revision_row_id: i64,
    right_panel_revision_row_id: i64,
) -> DbResult<Vec<String>> {
    // Find active mosaics that contain each endpoint's panel group.
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT m.public_id
         FROM mosaic_revision_panel mrp
         JOIN mosaic_revision mr ON mr.row_id = mrp.mosaic_revision_row_id
         JOIN mosaic m ON m.row_id = mr.mosaic_row_id
                      AND m.head_revision_row_id = mr.row_id
                      AND m.status = 'active'
         WHERE mrp.panel_revision_row_id IN (?, ?)",
    )
    .bind(left_panel_revision_row_id)
    .bind(right_panel_revision_row_id)
    .fetch_all(&mut *conn)
    .await?;

    // Only a bridge if both endpoints appear in at least two distinct mosaics.
    if rows.len() < 2 {
        return Ok(vec![]);
    }

    Ok(rows.into_iter().map(|(id,)| id).collect())
}

/// Validate that all panel members of a mosaic revision are connected through
/// accepted non-stale edges using a bounded CTE.
///
/// Returns `true` when connectivity holds. The ceiling is
/// `node_count + 1`; exceeding it returns false (open graph or ceiling hit).
pub async fn validate_mosaic_connectivity(
    conn: &mut SqliteConnection,
    mosaic_revision_row_id: i64,
) -> DbResult<bool> {
    // Count panels and get seed.
    let (panel_count, seed_row_id): (i64, Option<i64>) = sqlx::query_as(
        "SELECT COUNT(*), MIN(panel_revision_row_id)
         FROM mosaic_revision_panel
         WHERE mosaic_revision_row_id = ?",
    )
    .bind(mosaic_revision_row_id)
    .fetch_one(&mut *conn)
    .await?;

    if panel_count == 0 {
        return Ok(true);
    }

    let Some(seed) = seed_row_id else { return Ok(false) };

    let ceiling = panel_count + 1;

    // BFS reachability using UNION (deduplication) over non-stale edges in this
    // mosaic revision.
    let (reachable_count,): (i64,) = sqlx::query_as(
        "WITH RECURSIVE reachable(pr_id) AS (
             SELECT ?
             UNION
             SELECT CASE
                 WHEN mee.left_panel_revision_row_id = r.pr_id THEN mee.right_panel_revision_row_id
                 ELSE mee.left_panel_revision_row_id
             END
             FROM reachable r
             JOIN mosaic_revision_edge mre2 ON 1=1
             JOIN mosaic_edge_evidence mee ON mee.row_id = mre2.edge_evidence_row_id
                 AND (mee.left_panel_revision_row_id = r.pr_id
                      OR mee.right_panel_revision_row_id = r.pr_id)
             WHERE mre2.mosaic_revision_row_id = ?
               AND NOT EXISTS (
                   SELECT 1 FROM mosaic_edge_invalidation
                   WHERE edge_evidence_row_id = mee.row_id
               )
             LIMIT ?
         )
         SELECT COUNT(*) FROM reachable",
    )
    .bind(seed)
    .bind(mosaic_revision_row_id)
    .bind(ceiling)
    .fetch_one(&mut *conn)
    .await?;

    // All panels reachable iff count equals panel_count (ceiling not exceeded).
    Ok(reachable_count == panel_count)
}
