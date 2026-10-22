// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Durable Finish/reopen review decisions for session intake (spec 064 LIB-FR-20,
//! 067 PIX-FR-18; D-W78, D-W97, D-W100).
//!
//! Finish records the grouping revision it covered. The intake reader continues to
//! derive readiness from that row plus every live logical capture's applicable
//! quality; a later regroup therefore makes an older row stale without a migration.

use platevault_model::{ApplicableQuality, LibraryError, Revision};
use sqlx::sqlite::SqliteConnection;
use sqlx::Row;
use sqlx::{Acquire, Connection};
use uuid::Uuid;

use super::review_lists::{absolute, reviewed_copy, ReviewCapture, Roots};
use super::{
    db_revision, now, parse_uuid, revision, scoped_members, CaptureView, Catalog, Members, Result,
};

/// A session's current grouping revision and live logical captures for Review.
#[derive(Clone, Debug)]
pub struct SessionReviewBasis {
    pub session_id: Uuid,
    pub grouping_revision: Revision,
    pub captures: Vec<ReviewCapture>,
}

impl Catalog {
    /// Read the current session's live logical captures and grouping revision.
    ///
    /// # Errors
    /// `NotFound` for an unknown session; `InvalidInput` for a superseded one;
    /// `PersistenceFailure` for corrupt or unavailable catalog state.
    pub async fn session_review_basis(&self, session_id: Uuid) -> Result<SessionReviewBasis> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let mut row = super::load_session_row(&mut snapshot, session_id).await?;
        if row.superseded_by.is_some() {
            return Err(LibraryError::InvalidInput(format!("session {session_id} is superseded")));
        }
        let grouping_revision = row.session.grouping_revision;
        let assets = scoped_members(&mut snapshot, &mut row, Members::Live).await?;
        let view = CaptureView::read(&mut snapshot, &[session_id], &assets).await?;
        let mut captures = Vec::new();
        let mut roots = Roots::new();
        for (key, present) in view.group(&assets) {
            let asset = reviewed_copy(&view.copies_of(&key)).ok_or_else(|| {
                LibraryError::PersistenceFailure(format!("live capture {key} has no copies"))
            })?;
            captures.push(ReviewCapture {
                path: absolute(&mut snapshot, &mut roots, asset).await?,
                session_id,
                quality: view.quality(&key),
                other_copies: present
                    .iter()
                    .map(|copy| copy.id)
                    .filter(|id| *id != asset.id)
                    .collect(),
                asset: asset.clone(),
            });
        }
        snapshot.rollback().await?;
        Ok(SessionReviewBasis { session_id, grouping_revision, captures })
    }

    /// Finish the Review step at the session's current grouping revision.
    ///
    /// A stale expected grouping revision, a superseded session or any live
    /// logical capture whose applicable quality is Unreviewed refuses the write.
    ///
    /// # Errors
    /// `NotFound` for an unknown session; `Conflict` for stale grouping revision;
    /// `InvalidInput` while the session is superseded or any live capture is
    /// Unreviewed; `PersistenceFailure` for a corrupt record.
    pub async fn finish_session_review(
        &self,
        session_id: Uuid,
        expected_grouping_revision: Revision,
    ) -> Result<Revision> {
        write_txn!(self, |conn| finish(conn, session_id, expected_grouping_revision).await)
    }

    /// Reopen Review for a current Ready session. Deleting the session review
    /// row is the only write; Project changes remain an INPUT diff concern.
    ///
    /// # Errors
    /// `NotFound` for an unknown session; `InvalidInput` unless it is current
    /// and Ready; `PersistenceFailure` for a corrupt record.
    pub async fn reopen_session_review(&self, session_id: Uuid) -> Result<()> {
        write_txn!(self, |conn| reopen(conn, session_id).await)
    }
}

/// Finish review inside the caller's transaction.
pub async fn finish(
    conn: &mut SqliteConnection,
    session_id: Uuid,
    expected_grouping_revision: Revision,
) -> Result<Revision> {
    let row = sqlx::query("SELECT grouping_revision, superseded_by FROM sessions WHERE id = ?1")
        .bind(session_id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("session {session_id}")))?;
    let grouping_revision = revision(row.try_get("grouping_revision")?)?;
    let superseded_by: Option<String> = row.try_get("superseded_by")?;
    if let Some(superseded_by) = superseded_by {
        return Err(LibraryError::InvalidInput(format!(
            "session {session_id} was superseded by {}",
            parse_uuid(&superseded_by)?
        )));
    }

    require_grouping_revision(session_id, grouping_revision, expected_grouping_revision)?;
    let mut session = super::load_session_row(conn, session_id).await?;
    let assets = scoped_members(conn, &mut session, Members::Live).await?;
    let view = CaptureView::read(conn, &[session_id], &assets).await?;
    let unreviewed = view
        .members(&assets)
        .iter()
        .filter(|member| member.applicable_quality == ApplicableQuality::Unreviewed)
        .count();
    if unreviewed > 0 {
        return Err(LibraryError::InvalidInput(format!(
            "session {session_id} has {unreviewed} live logical capture{} still Unreviewed",
            if unreviewed == 1 { "" } else { "s" }
        )));
    }
    sqlx::query(
        "INSERT INTO session_reviews (session_id, grouping_revision, finished_at) \
         VALUES (?1, ?2, ?3) ON CONFLICT(session_id) DO UPDATE SET \
         grouping_revision = excluded.grouping_revision, finished_at = excluded.finished_at",
    )
    .bind(session_id.to_string())
    .bind(db_revision(grouping_revision)?)
    .bind(now()?)
    .execute(&mut *conn)
    .await?;
    Ok(grouping_revision)
}

/// Reopen review inside the caller's transaction.
pub async fn reopen(conn: &mut SqliteConnection, session_id: Uuid) -> Result<()> {
    let row = sqlx::query("SELECT grouping_revision, superseded_by FROM sessions WHERE id = ?1")
        .bind(session_id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("session {session_id}")))?;
    if row.try_get::<Option<String>, _>("superseded_by")?.is_some() {
        return Err(LibraryError::InvalidInput(format!("session {session_id} is superseded")));
    }

    let intake = super::admission::read_admission(conn, session_id).await?.intake;
    if intake.superseded || intake.readiness() != platevault_model::SessionReadiness::Ready {
        return Err(LibraryError::InvalidInput(format!(
            "session {session_id} is not Ready and cannot reopen review"
        )));
    }
    sqlx::query("DELETE FROM session_reviews WHERE session_id = ?1")
        .bind(session_id.to_string())
        .execute(&mut *conn)
        .await?;
    Ok(())
}

fn require_grouping_revision(
    session_id: Uuid,
    current: Revision,
    expected: Revision,
) -> Result<()> {
    if current == expected {
        Ok(())
    } else {
        Err(LibraryError::Conflict { id: session_id, current, successors: Vec::new() })
    }
}
