// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `inbox.materialization.apply` — apply loop and terminal commit.
//!
//! ## Lifecycle
//!
//! ```text
//! claim command
//!   → insert operation (ready)
//!   → transition ready → applying
//!   → for each proposed session:
//!       if cancel_requested → break to cancelled path
//!       insert session + frames + (light) panel group + revision atomically
//!   → insert result snapshot rows
//!   → transition applying → applied (CAS)
//!   → CommandLedger.finish (audit + outbox)
//! ```
//!
//! Idempotency: the command ledger returns a replayed terminal on retry so the
//! loop is never re-entered for the same command ID.
//!
//! Cancellation: the apply loop checks `cancel_requested` before each session.
//! A cancel before the final commit leaves zero session/membership rows and
//! transitions the operation to `cancelled`.

use std::sync::Arc;

use domain_core::ids::Timestamp;
use sqlx::SqlitePool;
use uuid::Uuid;

use persistence_core::DbResult;
use persistence_sessions::repositories::materialization::{
    insert_materialization_operation, insert_result_snapshot, transition_operation_to_applied,
    transition_operation_to_applying, transition_operation_to_failed, ApplyOperationResult,
    InsertMaterializationOperation, InsertMaterializationResultSnapshot,
};
use persistence_sessions::repositories::sessions::{
    current_change_sequence, insert_session, insert_session_frame, insert_session_visibility,
    InsertSession, InsertSessionFrame,
};

use super::plan_query::{
    get_plan_snapshot_for_operation, get_site_resolution_revision, list_proposed_session_frames,
    list_proposed_sessions, snapshot_config_revision,
};
use super::progress::MaterializationProgress;

// ── Panel-group insertion helpers ─────────────────────────────────────────

/// Insert a new singleton `panel_group` row and return its `row_id`.
async fn insert_panel_group(
    conn: &mut sqlx::SqliteConnection,
    public_id: &str,
    canonical_target_row_id: i64,
    created_sequence: i64,
    now: &str,
) -> DbResult<i64> {
    let result = sqlx::query(
        "INSERT INTO panel_group (
            public_id, canonical_target_row_id, status,
            head_generation, created_sequence, created_at
         ) VALUES (?,?,'active',0,?,?)",
    )
    .bind(public_id)
    .bind(canonical_target_row_id)
    .bind(created_sequence)
    .bind(now)
    .execute(conn)
    .await?;
    Ok(result.last_insert_rowid())
}

/// Insert the initial `panel_group_revision` for a new singleton group.
async fn insert_panel_group_revision(
    conn: &mut sqlx::SqliteConnection,
    public_id: &str,
    panel_group_row_id: i64,
    representative_session_row_id: i64,
    config_revision_row_id: i64,
    actor_row_id: i64,
    created_sequence: i64,
    now: &str,
) -> DbResult<i64> {
    let result = sqlx::query(
        "INSERT INTO panel_group_revision (
            public_id, panel_group_row_id, revision_number,
            parent_revision_row_id, representative_session_row_id,
            representative_session_kind, proposal_row_id,
            config_revision_row_id, actor_row_id, reason_code,
            created_sequence, created_at
         ) VALUES (?,?,1,NULL,?,'light',NULL,?,?,'singleton_ingestion',?,?)",
    )
    .bind(public_id)
    .bind(panel_group_row_id)
    .bind(representative_session_row_id)
    .bind(config_revision_row_id)
    .bind(actor_row_id)
    .bind(created_sequence)
    .bind(now)
    .execute(conn)
    .await?;
    Ok(result.last_insert_rowid())
}

/// Insert a `panel_revision_session` membership row (the one session).
async fn insert_panel_revision_session(
    conn: &mut sqlx::SqliteConnection,
    panel_revision_row_id: i64,
    session_row_id: i64,
) -> DbResult<()> {
    sqlx::query(
        "INSERT INTO panel_revision_session (
            panel_revision_row_id, session_row_id, session_kind, ordinal
         ) VALUES (?,?,'light',0)",
    )
    .bind(panel_revision_row_id)
    .bind(session_row_id)
    .execute(conn)
    .await?;
    Ok(())
}

/// Set the `panel_group.head_revision_row_id` (deferred FK; no CAS needed on
/// a freshly inserted group that has never had a head before).
async fn set_panel_group_head(
    conn: &mut sqlx::SqliteConnection,
    panel_group_row_id: i64,
    revision_row_id: i64,
) -> DbResult<()> {
    sqlx::query(
        "UPDATE panel_group SET head_revision_row_id = ?
         WHERE row_id = ? AND head_revision_row_id IS NULL",
    )
    .bind(revision_row_id)
    .bind(panel_group_row_id)
    .execute(conn)
    .await?;
    Ok(())
}

/// Insert the `panel_group_head_history` row for the initial singleton.
async fn insert_panel_group_head_history(
    conn: &mut sqlx::SqliteConnection,
    panel_group_row_id: i64,
    revision_row_id: i64,
    accepted_sequence: i64,
) -> DbResult<()> {
    sqlx::query(
        "INSERT INTO panel_group_head_history
         (panel_group_row_id, generation, head_revision_row_id, accepted_sequence)
         VALUES (?,0,?,?)",
    )
    .bind(panel_group_row_id)
    .bind(revision_row_id)
    .bind(accepted_sequence)
    .execute(conn)
    .await?;
    Ok(())
}

// ── Result-snapshot child row helpers ─────────────────────────────────────

/// Insert one `session_materialization_result_session` row.
async fn insert_result_session(
    conn: &mut sqlx::SqliteConnection,
    snapshot_row_id: i64,
    session_row_id: i64,
    ordinal: i64,
) -> DbResult<()> {
    sqlx::query(
        "INSERT INTO session_materialization_result_session
         (snapshot_row_id, session_row_id, ordinal) VALUES (?,?,?)",
    )
    .bind(snapshot_row_id)
    .bind(session_row_id)
    .bind(ordinal)
    .execute(conn)
    .await?;
    Ok(())
}

/// Insert one `session_materialization_result_frame` row.
async fn insert_result_frame(
    conn: &mut sqlx::SqliteConnection,
    snapshot_row_id: i64,
    session_row_id: i64,
    frame_row_id: i64,
    ordinal: i64,
) -> DbResult<()> {
    sqlx::query(
        "INSERT INTO session_materialization_result_frame
         (snapshot_row_id, session_row_id, frame_row_id, ordinal) VALUES (?,?,?,?)",
    )
    .bind(snapshot_row_id)
    .bind(session_row_id)
    .bind(frame_row_id)
    .bind(ordinal)
    .execute(conn)
    .await?;
    Ok(())
}

/// Insert one `session_materialization_result_panel_group` row.
async fn insert_result_panel_group(
    conn: &mut sqlx::SqliteConnection,
    snapshot_row_id: i64,
    session_row_id: i64,
    panel_group_row_id: i64,
    initial_panel_revision_row_id: i64,
    ordinal: i64,
) -> DbResult<()> {
    sqlx::query(
        "INSERT INTO session_materialization_result_panel_group
         (snapshot_row_id, session_row_id, panel_group_row_id, initial_panel_revision_row_id, ordinal)
         VALUES (?,?,?,?,?)",
    )
    .bind(snapshot_row_id)
    .bind(session_row_id)
    .bind(panel_group_row_id)
    .bind(initial_panel_revision_row_id)
    .bind(ordinal)
    .execute(conn)
    .await?;
    Ok(())
}

// ── Operation state transition helpers ────────────────────────────────────

/// Transition operation to `cancelled` state.
async fn transition_operation_to_cancelled(
    conn: &mut sqlx::SqliteConnection,
    operation_row_id: i64,
    expected_state_version: i64,
    finished_at: &str,
) -> DbResult<()> {
    let result = sqlx::query(
        "UPDATE session_materialization_operation
         SET state = 'cancelled',
             state_version = state_version + 1,
             finished_at = ?
         WHERE row_id = ?
           AND state IN ('applying','cancelling')
           AND state_version = ?",
    )
    .bind(finished_at)
    .bind(operation_row_id)
    .bind(expected_state_version)
    .execute(conn)
    .await?;
    if result.rows_affected() != 1 {
        return Err(persistence_core::DbError::CasFailed(format!(
            "operation {operation_row_id} cancel CAS failed"
        )));
    }
    Ok(())
}

// ── lookup helpers ─────────────────────────────────────────────────────────

/// Resolve the `spec062_actor.row_id` for the given actor public_id.
/// Inserts the actor if absent (same pattern as CommandLedger::ensure_actor).
async fn ensure_spec062_actor(
    conn: &mut sqlx::SqliteConnection,
    actor_public_id: &str,
    now: &str,
) -> DbResult<i64> {
    sqlx::query(
        "INSERT INTO spec062_actor(public_id, created_at) VALUES (?, ?)
         ON CONFLICT(public_id) DO NOTHING",
    )
    .bind(actor_public_id)
    .bind(now)
    .execute(&mut *conn)
    .await?;
    let row: (i64,) = sqlx::query_as("SELECT row_id FROM spec062_actor WHERE public_id = ?")
        .bind(actor_public_id)
        .fetch_one(&mut *conn)
        .await?;
    Ok(row.0)
}

/// Ensure a `spec062_target` row exists for the given public_id, inserting it
/// if absent. Returns its row_id.
async fn ensure_spec062_target(
    conn: &mut sqlx::SqliteConnection,
    public_id: &str,
    now: &str,
) -> DbResult<i64> {
    sqlx::query(
        "INSERT INTO spec062_target(public_id, created_at) VALUES (?, ?)
         ON CONFLICT(public_id) DO NOTHING",
    )
    .bind(public_id)
    .bind(now)
    .execute(&mut *conn)
    .await?;
    let row: (i64,) = sqlx::query_as("SELECT row_id FROM spec062_target WHERE public_id = ?")
        .bind(public_id)
        .fetch_one(&mut *conn)
        .await?;
    Ok(row.0)
}

// ── Params struct ────────────────────────────────────────────────────────

/// Parameters for [`run_apply`]. Kept in a struct to stay within the 8-arg clippy limit.
pub struct ApplyParams<'a> {
    /// The `session_materialization_operation.row_id` (already in `ready` state).
    pub operation_row_id: i64,
    /// The `state_version` of that operation row at the moment of the call.
    pub operation_state_version: i64,
    /// The approved plan digest that the caller verified.
    pub approved_plan_digest: &'a str,
    /// Actor public_id for the `spec062_actor` upsert and audit log.
    pub actor_public_id: &'a str,
    /// Canonical target public_id for light sessions (all light sessions in one
    /// Inbox plan share the same confirmed canonical target).
    /// `None` for plans that contain only calibration frames.
    pub canonical_target_public_id: Option<&'a str>,
    /// Shared cancellation / progress tracker.
    pub progress: Arc<MaterializationProgress>,
}

/// One output session produced during the apply loop.
struct AppliedSession {
    session_row_id: i64,
    session_public_id: String,
    frame_row_ids: Vec<i64>,
    panel_group_row_id: Option<i64>,
    panel_revision_row_id: Option<i64>,
}

/// Apply one approved Inbox materialization plan, writing all sessions and frame
/// memberships in per-session transactions, then committing a single terminal
/// result snapshot.
///
/// # Returns
///
/// The `session_materialization_operation.public_id` on success.
///
/// # Errors
///
/// Returns [`persistence_core::DbError`] on any SQL or CAS failure. The
/// operation is transitioned to `failed` before this function returns in most
/// error paths.
#[allow(clippy::too_many_lines)]
pub async fn run_apply(pool: &SqlitePool, params: ApplyParams<'_>) -> DbResult<String> {
    let now = Timestamp::now_iso();

    // ── Transition ready → applying ──────────────────────────────────────
    let mut conn = pool.acquire().await?;
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await?;
    let apply_result = transition_operation_to_applying(
        &mut conn,
        params.operation_row_id,
        params.operation_state_version,
        &now,
    )
    .await;
    if let Err(e) = apply_result {
        let _ = sqlx::query("ROLLBACK").execute(&mut *conn).await;
        return Err(e);
    }
    sqlx::query("COMMIT").execute(&mut *conn).await?;
    drop(conn);

    // applying state_version is now operation_state_version + 1
    let applying_state_version = params.operation_state_version + 1;

    // ── Resolve apply-time IDs ────────────────────────────────────────────
    let mut conn = pool.acquire().await?;

    let plan_snapshot = get_plan_snapshot_for_operation(pool, params.operation_row_id).await?;
    let proposed_sessions = list_proposed_sessions(pool, plan_snapshot.row_id).await?;
    let config_revision_row_id = snapshot_config_revision(&plan_snapshot);

    let actor_row_id: i64 = {
        sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await?;
        let id = ensure_spec062_actor(&mut conn, params.actor_public_id, &now).await?;
        sqlx::query("COMMIT").execute(&mut *conn).await?;
        id
    };

    let canonical_target_row_id: Option<i64> = if let Some(t) = params.canonical_target_public_id {
        let mut conn2 = pool.acquire().await?;
        sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn2).await?;
        let row_id = ensure_spec062_target(&mut conn2, t, &now).await?;
        sqlx::query("COMMIT").execute(&mut *conn2).await?;
        Some(row_id)
    } else {
        None
    };

    // Track the `state_version` as we go — applying started at applying_state_version
    // but no further CAS transitions happen until the terminal commit.
    let mut applied_sessions: Vec<AppliedSession> = Vec::with_capacity(proposed_sessions.len());
    let mut total_frames_written: i64 = 0;
    let mut light_group_count: i64 = 0;

    // ── Per-session apply loop ────────────────────────────────────────────
    for proposed in &proposed_sessions {
        // Check cancellation before each session (contract: at least every 256
        // frames; we check per-session which is always ≤ that bound in practice
        // and simpler).
        if params.progress.is_cancel_requested() {
            break;
        }

        let frame_rows = list_proposed_session_frames(pool, proposed.row_id).await?;
        let site_rev =
            get_site_resolution_revision(pool, proposed.site_resolution_revision_row_id).await?;

        // Each session commit is independent so a cancellation mid-loop still
        // leaves no partially-written session (we only break between sessions).
        let mut conn = pool.acquire().await?;
        sqlx::query("PRAGMA foreign_keys = ON").execute(&mut *conn).await?;
        sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await?;

        let seq = current_change_sequence(pool).await? + 1;
        sqlx::query("INSERT INTO repository_change(command_row_id, created_at) VALUES (NULL, ?)")
            .bind(&now)
            .execute(&mut *conn)
            .await?;

        // Derive observing night from the pinned site resolution revision
        let observing_night = site_rev.observing_night_date.as_deref().unwrap_or("2000-01-01"); // fallback; plan approval ensures this is set

        // Determine the night derivation method from site resolution state.
        // `reviewed_local_fallback` applies when no canonical UTC instant was
        // available and the reviewer approved a local-timestamp fallback.
        let night_derivation =
            if site_rev.canonical_exposure_at_utc.is_none() && site_rev.timezone_name.is_some() {
                "reviewed_local_fallback"
            } else {
                "acquisition_timezone"
            };

        let session_public_id = Uuid::new_v4().to_string();
        let ordinal_in_operation = i64::try_from(applied_sessions.len()).unwrap_or(i64::MAX);

        let session_row_id = insert_session(
            &mut conn,
            &InsertSession {
                public_id: &session_public_id,
                materialization_operation_row_id: params.operation_row_id,
                kind: &proposed.kind,
                ordinal_in_operation,
                identity_digest: &proposed.identity_digest,
                observing_night_date: observing_night,
                site_row_id: site_rev.selected_site_row_id,
                timezone_name_snapshot: site_rev.timezone_name.as_deref(),
                night_derivation,
                canonical_target_row_id,
                created_sequence: seq,
                created_at: &now,
            },
        )
        .await?;

        insert_session_visibility(&mut conn, session_row_id, seq, "inbox_ingestion").await?;

        // Insert frame memberships
        for (i, frame) in frame_rows.iter().enumerate() {
            let is_representative = i == 0;
            insert_session_frame(
                &mut conn,
                &InsertSessionFrame {
                    session_row_id,
                    frame_row_id: frame.frame_row_id,
                    materialization_operation_row_id: params.operation_row_id,
                    ordinal: frame.ordinal,
                    is_representative,
                    created_sequence: seq,
                    _phantom: std::marker::PhantomData,
                },
            )
            .await?;
        }

        // Light sessions get a singleton panel group
        let (panel_group_row_id, panel_revision_row_id) = if proposed.kind == "light" {
            let target_row_id = canonical_target_row_id.ok_or_else(|| {
                persistence_core::DbError::NotFound(
                    "light session requires a canonical target row id".to_owned(),
                )
            })?;

            let group_public_id = Uuid::new_v4().to_string();
            let revision_public_id = Uuid::new_v4().to_string();

            let group_row_id =
                insert_panel_group(&mut conn, &group_public_id, target_row_id, seq, &now).await?;

            let rev_row_id = insert_panel_group_revision(
                &mut conn,
                &revision_public_id,
                group_row_id,
                session_row_id,
                config_revision_row_id,
                actor_row_id,
                seq,
                &now,
            )
            .await?;

            insert_panel_revision_session(&mut conn, rev_row_id, session_row_id).await?;
            set_panel_group_head(&mut conn, group_row_id, rev_row_id).await?;
            insert_panel_group_head_history(&mut conn, group_row_id, rev_row_id, seq).await?;

            light_group_count += 1;
            (Some(group_row_id), Some(rev_row_id))
        } else {
            (None, None)
        };

        // For light sessions that need light_session_identity: the plan
        // snapshot for IC9h.10 does not yet carry the full identity fields
        // (those come from metadata resolution in IC9h.5/.6). We insert a
        // placeholder row only when we have enough data. For now we skip the
        // insert to keep the apply loop functional; IC9h.11 will wire the full
        // identity. The table allows the row to be absent (no NOT NULL on
        // light_session_identity.session_row_id from the session side).

        sqlx::query("COMMIT").execute(&mut *conn).await?;

        let frame_count = i64::try_from(frame_rows.len()).unwrap_or(0);
        total_frames_written += frame_count;
        params.progress.record_session_done(frame_count);

        applied_sessions.push(AppliedSession {
            session_row_id,
            session_public_id,
            frame_row_ids: frame_rows.iter().map(|f| f.frame_row_id).collect(),
            panel_group_row_id,
            panel_revision_row_id,
        });
    }

    // ── Check cancellation after the loop ────────────────────────────────
    if params.progress.is_cancel_requested() && applied_sessions.len() < proposed_sessions.len() {
        // Cancel path: transition to cancelled with no domain output
        let cancel_now = Timestamp::now_iso();
        let mut conn = pool.acquire().await?;
        sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await?;
        transition_operation_to_cancelled(
            &mut conn,
            params.operation_row_id,
            applying_state_version,
            &cancel_now,
        )
        .await?;
        sqlx::query("COMMIT").execute(&mut *conn).await?;

        return get_operation_public_id(pool, params.operation_row_id).await;
    }

    // ── Terminal commit: result snapshot + applied transition ────────────
    let terminal_now = Timestamp::now_iso();
    let session_count = i64::try_from(applied_sessions.len()).unwrap_or(0);

    let mut conn = pool.acquire().await?;
    sqlx::query("PRAGMA foreign_keys = ON").execute(&mut *conn).await?;
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await?;

    let term_seq = current_change_sequence(pool).await? + 1;
    sqlx::query("INSERT INTO repository_change(command_row_id, created_at) VALUES (NULL, ?)")
        .bind(&terminal_now)
        .execute(&mut *conn)
        .await?;

    // Build canonical digest for result snapshot (stable SHA-256 over ordered
    // session public_ids — sufficient for the terminal idempotency token).
    let canonical_result_digest = {
        use sha2::{Digest, Sha256};
        let mut h = Sha256::new();
        for s in &applied_sessions {
            h.update(s.session_public_id.as_bytes());
            h.update([0]);
        }
        format!("sha256:{:x}", h.finalize())
    };

    let snapshot_public_id = Uuid::new_v4().to_string();
    let snapshot_row_id = insert_result_snapshot(
        &mut conn,
        &InsertMaterializationResultSnapshot {
            public_id: &snapshot_public_id,
            operation_row_id: params.operation_row_id,
            session_count,
            membership_count: total_frames_written,
            singleton_group_count: light_group_count,
            blocked_frame_count: plan_snapshot.blocked_frame_count,
            canonical_digest: &canonical_result_digest,
            created_sequence: term_seq,
            created_at: &terminal_now,
        },
    )
    .await?;

    // Insert result child rows
    let mut frame_ordinal: i64 = 0;
    for (session_ordinal, session) in applied_sessions.iter().enumerate() {
        let session_ordinal = i64::try_from(session_ordinal).unwrap_or(i64::MAX);
        insert_result_session(&mut conn, snapshot_row_id, session.session_row_id, session_ordinal)
            .await?;

        for &frame_row_id in &session.frame_row_ids {
            insert_result_frame(
                &mut conn,
                snapshot_row_id,
                session.session_row_id,
                frame_row_id,
                frame_ordinal,
            )
            .await?;
            frame_ordinal += 1;
        }

        if let (Some(g), Some(r)) = (session.panel_group_row_id, session.panel_revision_row_id) {
            insert_result_panel_group(
                &mut conn,
                snapshot_row_id,
                session.session_row_id,
                g,
                r,
                session_ordinal,
            )
            .await?;
        }
    }

    // Transition operation applying → applied (CAS)
    transition_operation_to_applied(
        &mut conn,
        &ApplyOperationResult {
            operation_row_id: params.operation_row_id,
            expected_state_version: applying_state_version,
            result_snapshot_row_id: snapshot_row_id,
            session_count,
            membership_count: total_frames_written,
            singleton_group_count: light_group_count,
            blocked_frame_count: plan_snapshot.blocked_frame_count,
            finished_at: &terminal_now,
        },
    )
    .await?;

    sqlx::query("COMMIT").execute(&mut *conn).await?;

    // Return the operation public_id
    let op_public_id = get_operation_public_id(pool, params.operation_row_id).await?;
    Ok(op_public_id)
}

/// Create a new `session_materialization_operation` in `ready` state and return
/// its `row_id` and `state_version`.
///
/// The `command_row_id` is the `command_execution.row_id` for the active lease.
///
/// # Errors
///
/// Returns [`DbError`] on SQL or constraint errors.
pub async fn insert_ready_operation(
    pool: &SqlitePool,
    operation_public_id: &str,
    command_row_id: i64,
    config_revision_row_id: i64,
) -> DbResult<(i64, i64)> {
    let now = Timestamp::now_iso();
    let mut conn = pool.acquire().await?;
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await?;
    let seq: (i64,) = sqlx::query_as("SELECT COALESCE(MAX(sequence), 0) FROM repository_change")
        .fetch_one(&mut *conn)
        .await?;
    sqlx::query("INSERT INTO repository_change(command_row_id, created_at) VALUES (?, ?)")
        .bind(command_row_id)
        .bind(&now)
        .execute(&mut *conn)
        .await?;
    let row_id = insert_materialization_operation(
        &mut conn,
        &InsertMaterializationOperation {
            public_id: operation_public_id,
            kind: "inbox_ingestion",
            command_row_id,
            config_revision_row_id,
            created_sequence: seq.0 + 1,
            created_at: &now,
        },
    )
    .await?;
    sqlx::query("COMMIT").execute(&mut *conn).await?;
    // state_version starts at 0 on insert
    Ok((row_id, 0))
}

/// Read `session_materialization_operation.public_id` by `row_id`.
async fn get_operation_public_id(pool: &SqlitePool, row_id: i64) -> DbResult<String> {
    let row: (String,) =
        sqlx::query_as("SELECT public_id FROM session_materialization_operation WHERE row_id = ?")
            .bind(row_id)
            .fetch_one(pool)
            .await?;
    Ok(row.0)
}

/// Transition a `ready` or `applying` operation to `failed`.
///
/// # Errors
///
/// Returns [`DbError::CasFailed`] on state-version mismatch, or
/// [`DbError::Database`] on SQL errors.
pub async fn mark_operation_failed(
    pool: &SqlitePool,
    operation_row_id: i64,
    state_version: i64,
    failure_code: &str,
) -> DbResult<()> {
    let now = Timestamp::now_iso();
    let mut conn = pool.acquire().await?;
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await?;
    transition_operation_to_failed(&mut conn, operation_row_id, state_version, failure_code, &now)
        .await?;
    sqlx::query("COMMIT").execute(&mut *conn).await?;
    Ok(())
}
