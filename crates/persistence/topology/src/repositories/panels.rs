// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only
#![allow(
    clippy::missing_errors_doc,
    clippy::type_complexity,
    clippy::too_many_lines,
    clippy::similar_names
)]

//! Panel group heads, revisions, memberships, and lineage queries.
//!
//! All writes use `BEGIN IMMEDIATE` with CAS on `head_generation`.
//! Reads may use a shared pool connection at the caller's watermark.

use sqlx::SqliteConnection;

use persistence_core::{DbError, DbResult};

// ── Row types ─────────────────────────────────────────────────────────────────

/// Stable panel-group row returned from `panel_group`.
#[derive(Clone, Debug)]
pub struct PanelGroupRow {
    pub row_id: i64,
    pub public_id: String,
    /// Present for same-target groups; absent for cross-target groups.
    pub canonical_target_row_id: Option<i64>,
    pub cross_target_association_row_id: Option<i64>,
    pub status: String,
    pub head_revision_row_id: Option<i64>,
    pub head_generation: i64,
    pub created_at: String,
    pub retired_at: Option<String>,
}

/// Immutable revision row returned from `panel_group_revision`.
#[derive(Clone, Debug)]
pub struct PanelGroupRevisionRow {
    pub row_id: i64,
    pub public_id: String,
    pub panel_group_row_id: i64,
    pub revision_number: i64,
    pub parent_revision_row_id: Option<i64>,
    pub representative_session_row_id: i64,
    pub proposal_row_id: Option<i64>,
    pub config_revision_row_id: i64,
    pub actor_row_id: i64,
    pub reason_code: String,
    pub created_sequence: i64,
    pub created_at: String,
}

/// Member session row from `panel_revision_session`.
#[derive(Clone, Debug)]
pub struct PanelRevisionMemberRow {
    pub session_row_id: i64,
    pub session_public_id: String,
    pub ordinal: i64,
}

/// Lineage edge returned from `panel_group_lineage`.
#[derive(Clone, Debug)]
pub struct PanelLineageRow {
    pub predecessor_group_row_id: i64,
    pub successor_group_row_id: i64,
    pub kind: String,
    pub proposal_row_id: i64,
    pub ordinal: i64,
    pub created_at: String,
}

// ── Queries ───────────────────────────────────────────────────────────────────

/// Fetch the accepted head revision of a panel group by its integer row id.
///
/// Returns `DbError::NotFound` when the group row or its head revision are
/// absent.
pub async fn fetch_panel_group_head(
    conn: &mut SqliteConnection,
    group_row_id: i64,
) -> DbResult<(PanelGroupRow, PanelGroupRevisionRow)> {
    let group: Option<(
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
        "SELECT row_id, public_id, canonical_target_row_id, cross_target_association_row_id,
                status, head_revision_row_id, head_generation, created_at, retired_at
         FROM panel_group WHERE row_id = ?",
    )
    .bind(group_row_id)
    .fetch_optional(&mut *conn)
    .await?;

    let (
        row_id,
        public_id,
        ct_row_id,
        cta_row_id,
        status,
        head_rev_id,
        head_gen,
        created_at,
        retired_at,
    ) = group.ok_or_else(|| DbError::NotFound(format!("panel_group row_id={group_row_id}")))?;

    let head_rev_row_id = head_rev_id.ok_or_else(|| {
        DbError::NotFound(format!("panel_group row_id={group_row_id} has no head"))
    })?;

    let group_row = PanelGroupRow {
        row_id,
        public_id,
        canonical_target_row_id: ct_row_id,
        cross_target_association_row_id: cta_row_id,
        status,
        head_revision_row_id: Some(head_rev_row_id),
        head_generation: head_gen,
        created_at,
        retired_at,
    };

    let rev = fetch_panel_revision_by_row_id(conn, head_rev_row_id).await?;
    Ok((group_row, rev))
}

/// Fetch a panel group row by its public UUID string.
pub async fn fetch_panel_group_by_public_id(
    conn: &mut SqliteConnection,
    public_id: &str,
) -> DbResult<PanelGroupRow> {
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
        "SELECT row_id, public_id, canonical_target_row_id, cross_target_association_row_id,
                status, head_revision_row_id, head_generation, created_at, retired_at
         FROM panel_group WHERE public_id = ?",
    )
    .bind(public_id)
    .fetch_optional(&mut *conn)
    .await?;

    let (row_id, pid, ct_row_id, cta_row_id, status, head_rev_id, head_gen, created_at, retired_at) =
        row.ok_or_else(|| DbError::NotFound(format!("panel_group public_id={public_id}")))?;

    Ok(PanelGroupRow {
        row_id,
        public_id: pid,
        canonical_target_row_id: ct_row_id,
        cross_target_association_row_id: cta_row_id,
        status,
        head_revision_row_id: head_rev_id,
        head_generation: head_gen,
        created_at,
        retired_at,
    })
}

/// Fetch a single revision row by its integer row id.
pub async fn fetch_panel_revision_by_row_id(
    conn: &mut SqliteConnection,
    revision_row_id: i64,
) -> DbResult<PanelGroupRevisionRow> {
    let row: Option<(
        i64,
        String,
        i64,
        i64,
        Option<i64>,
        i64,
        Option<i64>,
        i64,
        i64,
        String,
        i64,
        String,
    )> = sqlx::query_as(
        "SELECT row_id, public_id, panel_group_row_id, revision_number,
                parent_revision_row_id, representative_session_row_id, proposal_row_id,
                config_revision_row_id, actor_row_id, reason_code, created_sequence, created_at
         FROM panel_group_revision WHERE row_id = ?",
    )
    .bind(revision_row_id)
    .fetch_optional(&mut *conn)
    .await?;

    let (
        row_id,
        public_id,
        pg_row_id,
        rev_num,
        parent_id,
        rep_sess_id,
        prop_id,
        cfg_id,
        actor_id,
        reason,
        seq,
        created_at,
    ) = row.ok_or_else(|| {
        DbError::NotFound(format!("panel_group_revision row_id={revision_row_id}"))
    })?;

    Ok(PanelGroupRevisionRow {
        row_id,
        public_id,
        panel_group_row_id: pg_row_id,
        revision_number: rev_num,
        parent_revision_row_id: parent_id,
        representative_session_row_id: rep_sess_id,
        proposal_row_id: prop_id,
        config_revision_row_id: cfg_id,
        actor_row_id: actor_id,
        reason_code: reason,
        created_sequence: seq,
        created_at,
    })
}

/// Fetch a single revision row by its public UUID.
pub async fn fetch_panel_revision_by_public_id(
    conn: &mut SqliteConnection,
    public_id: &str,
) -> DbResult<PanelGroupRevisionRow> {
    let row: Option<(
        i64,
        String,
        i64,
        i64,
        Option<i64>,
        i64,
        Option<i64>,
        i64,
        i64,
        String,
        i64,
        String,
    )> = sqlx::query_as(
        "SELECT row_id, public_id, panel_group_row_id, revision_number,
                parent_revision_row_id, representative_session_row_id, proposal_row_id,
                config_revision_row_id, actor_row_id, reason_code, created_sequence, created_at
         FROM panel_group_revision WHERE public_id = ?",
    )
    .bind(public_id)
    .fetch_optional(&mut *conn)
    .await?;

    let (
        row_id,
        pid,
        pg_row_id,
        rev_num,
        parent_id,
        rep_sess_id,
        prop_id,
        cfg_id,
        actor_id,
        reason,
        seq,
        created_at,
    ) = row
        .ok_or_else(|| DbError::NotFound(format!("panel_group_revision public_id={public_id}")))?;

    Ok(PanelGroupRevisionRow {
        row_id,
        public_id: pid,
        panel_group_row_id: pg_row_id,
        revision_number: rev_num,
        parent_revision_row_id: parent_id,
        representative_session_row_id: rep_sess_id,
        proposal_row_id: prop_id,
        config_revision_row_id: cfg_id,
        actor_row_id: actor_id,
        reason_code: reason,
        created_sequence: seq,
        created_at,
    })
}

/// List all revision rows for a panel group, newest first (by revision_number DESC).
///
/// Returns up to `limit` rows after the optional `after_revision_number` cursor.
pub async fn list_panel_revision_history(
    conn: &mut SqliteConnection,
    panel_group_row_id: i64,
    after_revision_number: Option<i64>,
    limit: u32,
) -> DbResult<Vec<PanelGroupRevisionRow>> {
    let rows: Vec<(
        i64,
        String,
        i64,
        i64,
        Option<i64>,
        i64,
        Option<i64>,
        i64,
        i64,
        String,
        i64,
        String,
    )> = sqlx::query_as(
        "SELECT row_id, public_id, panel_group_row_id, revision_number,
                parent_revision_row_id, representative_session_row_id, proposal_row_id,
                config_revision_row_id, actor_row_id, reason_code, created_sequence, created_at
         FROM panel_group_revision
         WHERE panel_group_row_id = ?
           AND (? IS NULL OR revision_number < ?)
         ORDER BY revision_number DESC, public_id ASC
         LIMIT ?",
    )
    .bind(panel_group_row_id)
    .bind(after_revision_number)
    .bind(after_revision_number)
    .bind(i64::from(limit))
    .fetch_all(&mut *conn)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(
                row_id,
                public_id,
                pg_row_id,
                rev_num,
                parent_id,
                rep_sess_id,
                prop_id,
                cfg_id,
                actor_id,
                reason,
                seq,
                created_at,
            )| {
                PanelGroupRevisionRow {
                    row_id,
                    public_id,
                    panel_group_row_id: pg_row_id,
                    revision_number: rev_num,
                    parent_revision_row_id: parent_id,
                    representative_session_row_id: rep_sess_id,
                    proposal_row_id: prop_id,
                    config_revision_row_id: cfg_id,
                    actor_row_id: actor_id,
                    reason_code: reason,
                    created_sequence: seq,
                    created_at,
                }
            },
        )
        .collect())
}

/// List session members of a revision in ordinal order.
///
/// `after_ordinal` is the exclusive cursor for the next page.
pub async fn list_panel_revision_members(
    conn: &mut SqliteConnection,
    panel_revision_row_id: i64,
    after_ordinal: Option<i64>,
    limit: u32,
) -> DbResult<Vec<PanelRevisionMemberRow>> {
    let rows: Vec<(i64, String, i64)> = sqlx::query_as(
        "SELECT prs.session_row_id, s.public_id, prs.ordinal
         FROM panel_revision_session prs
         JOIN session s ON s.row_id = prs.session_row_id
         WHERE prs.panel_revision_row_id = ?
           AND (? IS NULL OR prs.ordinal > ?)
         ORDER BY prs.ordinal ASC, s.public_id ASC
         LIMIT ?",
    )
    .bind(panel_revision_row_id)
    .bind(after_ordinal)
    .bind(after_ordinal)
    .bind(i64::from(limit))
    .fetch_all(&mut *conn)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(session_row_id, session_public_id, ordinal)| PanelRevisionMemberRow {
            session_row_id,
            session_public_id,
            ordinal,
        })
        .collect())
}

/// List lineage predecessors of a panel group (groups that led to this one).
pub async fn list_panel_lineage_predecessors(
    conn: &mut SqliteConnection,
    successor_group_row_id: i64,
    limit: u32,
) -> DbResult<Vec<PanelLineageRow>> {
    let rows: Vec<(i64, i64, String, i64, i64, String)> = sqlx::query_as(
        "SELECT predecessor_group_row_id, successor_group_row_id, kind,
                proposal_row_id, ordinal, created_at
         FROM panel_group_lineage
         WHERE successor_group_row_id = ?
         ORDER BY created_at DESC, proposal_row_id ASC, ordinal ASC,
                  predecessor_group_row_id ASC
         LIMIT ?",
    )
    .bind(successor_group_row_id)
    .bind(i64::from(limit))
    .fetch_all(&mut *conn)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(pred, succ, kind, prop, ord, created_at)| PanelLineageRow {
            predecessor_group_row_id: pred,
            successor_group_row_id: succ,
            kind,
            proposal_row_id: prop,
            ordinal: ord,
            created_at,
        })
        .collect())
}

/// List lineage successors of a panel group.
pub async fn list_panel_lineage_successors(
    conn: &mut SqliteConnection,
    predecessor_group_row_id: i64,
    limit: u32,
) -> DbResult<Vec<PanelLineageRow>> {
    let rows: Vec<(i64, i64, String, i64, i64, String)> = sqlx::query_as(
        "SELECT predecessor_group_row_id, successor_group_row_id, kind,
                proposal_row_id, ordinal, created_at
         FROM panel_group_lineage
         WHERE predecessor_group_row_id = ?
         ORDER BY created_at DESC, proposal_row_id ASC, ordinal ASC,
                  successor_group_row_id ASC
         LIMIT ?",
    )
    .bind(predecessor_group_row_id)
    .bind(i64::from(limit))
    .fetch_all(&mut *conn)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(pred, succ, kind, prop, ord, created_at)| PanelLineageRow {
            predecessor_group_row_id: pred,
            successor_group_row_id: succ,
            kind,
            proposal_row_id: prop,
            ordinal: ord,
            created_at,
        })
        .collect())
}

// ── Writes ────────────────────────────────────────────────────────────────────

/// Data required to insert a singleton panel group and its initial revision in
/// one deferred-FK transaction. The caller must supply pre-generated public IDs
/// as UUIDv7 strings.
///
/// Called from the session materialization commit path (Phase 1) after session
/// and frame rows are already inserted in the same `BEGIN IMMEDIATE` transaction.
pub struct InsertSingletonPanel<'a> {
    /// New group public UUID (UUIDv7).
    pub group_public_id: &'a str,
    /// New revision public UUID (UUIDv7).
    pub revision_public_id: &'a str,
    /// Already-inserted `session.row_id` for the light session.
    pub session_row_id: i64,
    /// `canonical_target_row_id` from the session row.
    pub canonical_target_row_id: i64,
    /// `spec062_config_revision.row_id` used by the materialization operation.
    pub config_revision_row_id: i64,
    /// `spec062_actor.row_id` for the system actor.
    pub actor_row_id: i64,
    /// `repository_change.sequence` for this commit.
    pub created_sequence: i64,
    pub created_at: &'a str,
}

/// Insert a singleton panel group + initial revision atomically.
///
/// The caller must be operating inside `BEGIN IMMEDIATE`. Deferred FKs allow
/// the group and its first revision to be inserted together with the head
/// pointing at the revision row not yet fully visible.
///
/// Returns `(group_row_id, revision_row_id)`.
pub async fn insert_singleton_panel_group(
    conn: &mut SqliteConnection,
    input: &InsertSingletonPanel<'_>,
) -> DbResult<(i64, i64)> {
    // Insert the stable group row with a NULL head (deferred FK allows this).
    sqlx::query(
        "INSERT INTO panel_group
             (public_id, canonical_target_row_id, cross_target_association_row_id,
              status, head_revision_row_id, head_generation,
              created_sequence, created_at)
         VALUES (?, ?, NULL, 'active', NULL, 0, ?, ?)",
    )
    .bind(input.group_public_id)
    .bind(input.canonical_target_row_id)
    .bind(input.created_sequence)
    .bind(input.created_at)
    .execute(&mut *conn)
    .await?;

    let (group_row_id,): (i64,) =
        sqlx::query_as("SELECT row_id FROM panel_group WHERE public_id = ?")
            .bind(input.group_public_id)
            .fetch_one(&mut *conn)
            .await?;

    // Insert the initial revision.
    sqlx::query(
        "INSERT INTO panel_group_revision
             (public_id, panel_group_row_id, revision_number, parent_revision_row_id,
              representative_session_row_id, representative_session_kind,
              proposal_row_id, config_revision_row_id, actor_row_id,
              reason_code, created_sequence, created_at)
         VALUES (?, ?, 1, NULL, ?, 'light', NULL, ?, ?, 'singleton_created', ?, ?)",
    )
    .bind(input.revision_public_id)
    .bind(group_row_id)
    .bind(input.session_row_id)
    .bind(input.config_revision_row_id)
    .bind(input.actor_row_id)
    .bind(input.created_sequence)
    .bind(input.created_at)
    .execute(&mut *conn)
    .await?;

    let (revision_row_id,): (i64,) =
        sqlx::query_as("SELECT row_id FROM panel_group_revision WHERE public_id = ?")
            .bind(input.revision_public_id)
            .fetch_one(&mut *conn)
            .await?;

    // Insert the singleton session member.
    sqlx::query(
        "INSERT INTO panel_revision_session
             (panel_revision_row_id, session_row_id, session_kind, ordinal)
         VALUES (?, ?, 'light', 0)",
    )
    .bind(revision_row_id)
    .bind(input.session_row_id)
    .execute(&mut *conn)
    .await?;

    // Point the group head at the new revision (CAS: generation was 0, no row
    // existed yet so we UPDATE directly — generation stays 0 for first insert).
    sqlx::query(
        "UPDATE panel_group SET head_revision_row_id = ?
         WHERE row_id = ? AND head_revision_row_id IS NULL",
    )
    .bind(revision_row_id)
    .bind(group_row_id)
    .execute(&mut *conn)
    .await?;

    // Record initial head history.
    sqlx::query(
        "INSERT INTO panel_group_head_history
             (panel_group_row_id, generation, head_revision_row_id, accepted_sequence)
         VALUES (?, 0, ?, ?)",
    )
    .bind(group_row_id)
    .bind(revision_row_id)
    .bind(input.created_sequence)
    .execute(&mut *conn)
    .await?;

    Ok((group_row_id, revision_row_id))
}

/// Parameters for appending a successor revision to an existing panel group.
///
/// Called from proposal acceptance (Phase 2). The caller must be inside
/// `BEGIN IMMEDIATE` and have already verified that `expected_head_generation`
/// matches the live row.
pub struct AppendPanelRevision<'a> {
    /// New revision public UUID (UUIDv7).
    pub revision_public_id: &'a str,
    pub panel_group_row_id: i64,
    /// Parent revision for linear history.
    pub parent_revision_row_id: i64,
    /// Current revision number; new row gets `current + 1`.
    pub current_revision_number: i64,
    /// Session members for this revision (row_id, ordinal).
    pub members: &'a [(i64, i64)],
    pub representative_session_row_id: i64,
    pub proposal_row_id: i64,
    pub config_revision_row_id: i64,
    pub actor_row_id: i64,
    pub reason_code: &'a str,
    pub created_sequence: i64,
    pub created_at: &'a str,
    /// CAS guard: current `head_generation` from the pre-read.
    pub expected_head_generation: i64,
}

/// Append an immutable successor revision and advance the group head via CAS.
///
/// Returns `DbError::CasFailed` when the CAS update finds `changes() = 0`
/// (another writer advanced the head between the pre-read and commit).
/// Returns the new `revision_row_id`.
pub async fn append_panel_revision(
    conn: &mut SqliteConnection,
    input: &AppendPanelRevision<'_>,
) -> DbResult<i64> {
    let new_revision_number = input.current_revision_number + 1;

    sqlx::query(
        "INSERT INTO panel_group_revision
             (public_id, panel_group_row_id, revision_number, parent_revision_row_id,
              representative_session_row_id, representative_session_kind,
              proposal_row_id, config_revision_row_id, actor_row_id,
              reason_code, created_sequence, created_at)
         VALUES (?, ?, ?, ?, ?, 'light', ?, ?, ?, ?, ?, ?)",
    )
    .bind(input.revision_public_id)
    .bind(input.panel_group_row_id)
    .bind(new_revision_number)
    .bind(input.parent_revision_row_id)
    .bind(input.representative_session_row_id)
    .bind(input.proposal_row_id)
    .bind(input.config_revision_row_id)
    .bind(input.actor_row_id)
    .bind(input.reason_code)
    .bind(input.created_sequence)
    .bind(input.created_at)
    .execute(&mut *conn)
    .await?;

    let (revision_row_id,): (i64,) =
        sqlx::query_as("SELECT row_id FROM panel_group_revision WHERE public_id = ?")
            .bind(input.revision_public_id)
            .fetch_one(&mut *conn)
            .await?;

    // Insert members.
    for (session_row_id, ordinal) in input.members {
        sqlx::query(
            "INSERT INTO panel_revision_session
                 (panel_revision_row_id, session_row_id, session_kind, ordinal)
             VALUES (?, ?, 'light', ?)",
        )
        .bind(revision_row_id)
        .bind(session_row_id)
        .bind(ordinal)
        .execute(&mut *conn)
        .await?;
    }

    // CAS head update.
    let result = sqlx::query(
        "UPDATE panel_group
         SET head_revision_row_id = ?,
             head_generation = head_generation + 1
         WHERE row_id = ?
           AND head_generation = ?
           AND status = 'active'",
    )
    .bind(revision_row_id)
    .bind(input.panel_group_row_id)
    .bind(input.expected_head_generation)
    .execute(&mut *conn)
    .await?;

    if result.rows_affected() != 1 {
        return Err(DbError::CasFailed(format!(
            "panel_group row_id={} head CAS failed (expected generation {})",
            input.panel_group_row_id, input.expected_head_generation
        )));
    }

    // Record head history.
    sqlx::query(
        "INSERT INTO panel_group_head_history
             (panel_group_row_id, generation, head_revision_row_id, accepted_sequence)
         VALUES (?, ?, ?, ?)",
    )
    .bind(input.panel_group_row_id)
    .bind(input.expected_head_generation + 1)
    .bind(revision_row_id)
    .bind(input.created_sequence)
    .execute(&mut *conn)
    .await?;

    Ok(revision_row_id)
}

/// Retire a panel group and insert a lineage edge in the same transaction.
///
/// Both the retirement update and the lineage insert must succeed together.
/// Returns `DbError::CasFailed` if the group CAS fails.
pub struct RetirePanelGroup<'a> {
    pub group_row_id: i64,
    pub successor_group_row_id: i64,
    pub lineage_kind: &'a str,
    pub proposal_row_id: i64,
    pub lineage_ordinal: i64,
    pub created_sequence: i64,
    pub created_at: &'a str,
    /// CAS guard on the group being retired.
    pub expected_head_generation: i64,
}

pub async fn retire_panel_group(
    conn: &mut SqliteConnection,
    input: &RetirePanelGroup<'_>,
) -> DbResult<()> {
    // Retire the group.
    let result = sqlx::query(
        "UPDATE panel_group
         SET status = 'retired', retired_at = ?
         WHERE row_id = ?
           AND head_generation = ?
           AND status = 'active'",
    )
    .bind(input.created_at)
    .bind(input.group_row_id)
    .bind(input.expected_head_generation)
    .execute(&mut *conn)
    .await?;

    if result.rows_affected() != 1 {
        return Err(DbError::CasFailed(format!(
            "panel_group retire CAS failed for row_id={}",
            input.group_row_id
        )));
    }

    // Insert lineage edge.
    sqlx::query(
        "INSERT INTO panel_group_lineage
             (predecessor_group_row_id, successor_group_row_id, kind,
              proposal_row_id, ordinal, created_sequence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(input.group_row_id)
    .bind(input.successor_group_row_id)
    .bind(input.lineage_kind)
    .bind(input.proposal_row_id)
    .bind(input.lineage_ordinal)
    .bind(input.created_sequence)
    .bind(input.created_at)
    .execute(&mut *conn)
    .await?;

    Ok(())
}

/// Detect a proposed lineage cycle using a recursive CTE.
///
/// Returns `true` when inserting `(predecessor_id → successor_id)` would
/// create a cycle, meaning `predecessor_id` is reachable from `successor_id`
/// through existing lineage edges.
///
/// Uses `UNION` so visited nodes deduplicate correctly (boolean reachability).
pub async fn lineage_cycle_exists(
    conn: &mut SqliteConnection,
    proposed_predecessor_row_id: i64,
    proposed_successor_row_id: i64,
) -> DbResult<bool> {
    // If the proposed predecessor is reachable as a successor from the proposed
    // successor, inserting the edge would create a cycle.
    let (count,): (i64,) = sqlx::query_as(
        "WITH RECURSIVE reachable(group_row_id) AS (
             SELECT ? -- start from the proposed successor
             UNION
             SELECT pl.successor_group_row_id
             FROM panel_group_lineage pl
             JOIN reachable r ON pl.predecessor_group_row_id = r.group_row_id
         )
         SELECT COUNT(*) FROM reachable WHERE group_row_id = ?",
    )
    .bind(proposed_successor_row_id)
    .bind(proposed_predecessor_row_id)
    .fetch_one(&mut *conn)
    .await?;

    Ok(count > 0)
}

/// List panel groups by target scope with cursor pagination.
///
/// Returns groups ordered by `created_at DESC, public_id ASC`. Supply both
/// `after_created_at` and `after_public_id` from the last row of the previous
/// page to advance the cursor; either both `Some` or both `None`.
pub async fn list_panel_groups_by_target(
    conn: &mut SqliteConnection,
    canonical_target_row_id: Option<i64>,
    active_only: bool,
    after_created_at: Option<&str>,
    after_public_id: Option<&str>,
    limit: u32,
) -> DbResult<Vec<PanelGroupRow>> {
    // The index idx_panel_head_watermark covers (accepted_sequence DESC,
    // panel_group_row_id) on panel_group_head_history.
    let rows: Vec<(
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
        "SELECT g.row_id, g.public_id, g.canonical_target_row_id,
                g.cross_target_association_row_id, g.status,
                g.head_revision_row_id, g.head_generation,
                g.created_at, g.retired_at
         FROM panel_group g
         WHERE (? IS NULL OR g.canonical_target_row_id = ?)
           AND (? = 0 OR g.status = 'active')
           AND (? IS NULL OR g.created_at < ? OR (g.created_at = ? AND g.public_id > ?))
         ORDER BY g.created_at DESC, g.public_id ASC
         LIMIT ?",
    )
    .bind(canonical_target_row_id)
    .bind(canonical_target_row_id)
    .bind(i64::from(active_only))
    .bind(after_created_at)
    .bind(after_created_at)
    .bind(after_created_at)
    .bind(after_public_id)
    .bind(i64::from(limit))
    .fetch_all(&mut *conn)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(
                row_id,
                public_id,
                ct_row_id,
                cta_row_id,
                status,
                head_rev_id,
                head_gen,
                created_at,
                retired_at,
            )| {
                PanelGroupRow {
                    row_id,
                    public_id,
                    canonical_target_row_id: ct_row_id,
                    cross_target_association_row_id: cta_row_id,
                    status,
                    head_revision_row_id: head_rev_id,
                    head_generation: head_gen,
                    created_at,
                    retired_at,
                }
            },
        )
        .collect())
}

/// Find the active panel group that currently contains a given session
/// (through any current accepted head revision).
///
/// Returns `None` when the session is superseded or belongs to no active head.
pub async fn find_active_panel_group_for_session(
    conn: &mut SqliteConnection,
    session_row_id: i64,
) -> DbResult<Option<(i64, String, i64, String)>> {
    // panel_revision_session → panel_group_revision → panel_group where status=active
    // Uses idx_panel_revision_session_lookup.
    let row: Option<(i64, String, i64, String)> = sqlx::query_as(
        "SELECT g.row_id, g.public_id, g.head_revision_row_id, rev.public_id
         FROM panel_revision_session prs
         JOIN panel_group_revision rev ON rev.row_id = prs.panel_revision_row_id
         JOIN panel_group g ON g.row_id = rev.panel_group_row_id
                            AND g.head_revision_row_id = rev.row_id
                            AND g.status = 'active'
         WHERE prs.session_row_id = ?",
    )
    .bind(session_row_id)
    .fetch_optional(&mut *conn)
    .await?;

    Ok(row)
}
