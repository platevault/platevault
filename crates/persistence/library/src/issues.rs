// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The catalog side of issues on rows (063 FR-032, D-W92, D-W158): the
//! fingerprints of dismissed issues (`issues.sql`), and the issue sources no
//! other read gives in one snapshot: the session-side sources and the
//! interrupted imports. Core derives the issues themselves from these and
//! the features' own reads.
//!
//! Reading writes nothing. A dismissal stays until Restore, or until the
//! catalog writes the end of the issue it hides where that issue would
//! otherwise return with the same fingerprint: a location's offline or
//! denied issue ([`end_availability_issue`]) and an import's interrupted
//! issue ([`forget_dismissal`] on Retry). A new failure is a new operation,
//! so its fingerprint differs. A count that drops to none and returns
//! unchanged is the same issue, and stays hidden; its dismissal row stays
//! too, one per Dismiss the user chose.

use std::collections::BTreeSet;

use platevault_model::{
    Availability, Issue, IssueKind, LibraryError, SessionFilterCounts, SessionNeeds,
};
use sqlx::sqlite::SqliteConnection;
use sqlx::Connection;
use uuid::Uuid;

use super::{
    admission, calibration, from_text, listed_sessions, now, parse_uuid, session_filters, Catalog,
    Members, Result,
};

/// The longest fingerprint a dismissal records; a real one is far shorter.
const MAX_FINGERPRINT: usize = 512;

fn require_fingerprint(fingerprint: &str) -> Result<()> {
    if fingerprint.is_empty() || fingerprint.len() > MAX_FINGERPRINT {
        return Err(LibraryError::InvalidInput("an issue fingerprint is 1 to 512 bytes".into()));
    }
    Ok(())
}

/// The session-side issue sources over the default Sessions scope, from
/// one walk of one catalog snapshot.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct SessionIssueSources {
    /// The Sessions filters' counts; `needs_calibration` is the length of
    /// `calibration`.
    pub counts: SessionFilterCounts,
    /// The Needs calibration queue, in Sessions order.
    pub calibration: Vec<SessionNeeds>,
    /// Each session with reviewed frames whose bytes changed on disk
    /// (Changed content), with how many, in Sessions order.
    pub changed_frames: Vec<(Uuid, u64)>,
}

impl Catalog {
    /// The fingerprints of the dismissed issues.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn issue_dismissals(&self) -> Result<BTreeSet<String>> {
        let mut conn = self.reader().await?;
        let rows: Vec<String> = sqlx::query_scalar("SELECT fingerprint FROM issue_dismissals")
            .fetch_all(&mut *conn)
            .await?;
        Ok(rows.into_iter().collect())
    }

    /// Record that the issue with `fingerprint` is dismissed. Dismissing it
    /// again keeps the first record.
    ///
    /// # Errors
    /// `InvalidInput` for an empty or oversized fingerprint;
    /// `PersistenceFailure` when the catalog cannot be written.
    pub async fn dismiss_issue(&self, fingerprint: &str) -> Result<()> {
        require_fingerprint(fingerprint)?;
        write_txn!(self, |conn| {
            sqlx::query(
                "INSERT INTO issue_dismissals (fingerprint, dismissed_at) VALUES (?1, ?2) \
                 ON CONFLICT (fingerprint) DO NOTHING",
            )
            .bind(fingerprint)
            .bind(now()?)
            .execute(&mut *conn)
            .await?;
        });
        Ok(())
    }

    /// Bring back the dismissed issue with `fingerprint`.
    ///
    /// # Errors
    /// `InvalidInput` for an empty or oversized fingerprint; `NotFound` when
    /// no dismissal has that fingerprint; `PersistenceFailure` when the
    /// catalog cannot be written.
    pub async fn restore_issue(&self, fingerprint: &str) -> Result<()> {
        require_fingerprint(fingerprint)?;
        let deleted = write_txn!(self, |conn| {
            sqlx::query("DELETE FROM issue_dismissals WHERE fingerprint = ?1")
                .bind(fingerprint)
                .execute(&mut *conn)
                .await?
                .rows_affected()
        });
        if deleted == 0 {
            return Err(LibraryError::NotFound(format!("dismissed issue {fingerprint}")));
        }
        Ok(())
    }

    /// The Sessions filters' counts, the Needs calibration queue and each
    /// session's changed frames, walking the default Sessions scope once.
    /// Read-only.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn session_issue_sources(&self) -> Result<SessionIssueSources> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let listed = listed_sessions(&mut snapshot, false, None, Members::Live).await?;
        let (mut calibration, mut changed_frames) = (Vec::new(), Vec::new());
        for &session_id in &listed {
            let needs = calibration::session_needs(&mut snapshot, session_id).await?;
            if !needs.is_empty() {
                calibration.push(SessionNeeds { session_id, needs });
            }
            let intake = admission::read_intake(&mut snapshot, session_id).await?;
            if intake.changed_frames > 0 {
                changed_frames.push((session_id, intake.changed_frames));
            }
        }
        let needs_calibration = u64::try_from(calibration.len()).unwrap_or(u64::MAX);
        let counts =
            session_filters::filter_counts(&mut snapshot, &listed, needs_calibration).await?;
        snapshot.rollback().await?;
        Ok(SessionIssueSources { counts, calibration, changed_frames })
    }

    /// The imports left Interrupted, which wait for Retry.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn interrupted_imports(&self) -> Result<Vec<Uuid>> {
        let mut conn = self.reader().await?;
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM import_operations WHERE state = 'interrupted' ORDER BY id",
        )
        .fetch_all(&mut *conn)
        .await?;
        ids.iter().map(|id| parse_uuid(id)).collect()
    }
}

/// Forget the dismissal of location `id`'s availability issue when writing
/// `next` ends that issue, in the caller's transaction and before the write.
///
/// A location's offline (or denied) issue has the same fingerprint every
/// time, so a dismissal left behind would hide the next episode. Ending the
/// episode where the availability is written, rather than when a read
/// notices the issue gone, makes going offline again always bring the issue
/// back (D-W158), whether or not anything read the issues in between, and
/// keeps reading free of writes. Offline and Missing are the same issue,
/// so moving between them ends nothing. The alternative, an episode number
/// in the subject, would add a column every availability write must bump
/// for a fact this transaction already has.
pub async fn end_availability_issue(
    conn: &mut SqliteConnection,
    id: Uuid,
    next: Availability,
) -> Result<()> {
    let current: Option<String> =
        sqlx::query_scalar("SELECT availability FROM locations WHERE id = ?1")
            .bind(id.to_string())
            .fetch_optional(&mut *conn)
            .await?;
    let Some(current) = current else {
        return Ok(());
    };
    let Some(ended) = IssueKind::of_location(from_text(&current)?) else {
        return Ok(());
    };
    if IssueKind::of_location(next) == Some(ended) {
        return Ok(());
    }
    forget_dismissal(conn, ended, id).await
}

/// Forget the dismissal of the issue of `kind` about `about`, whatever its
/// count and bytes, in the caller's transaction: the write that ends an
/// issue whose next episode would have the same fingerprint. An import's
/// Retry ends its interrupted issue this way, so interrupting it again
/// brings the issue back.
pub async fn forget_dismissal(
    conn: &mut SqliteConnection,
    kind: IssueKind,
    about: Uuid,
) -> Result<()> {
    sqlx::query("DELETE FROM issue_dismissals WHERE substr(fingerprint, 1, length(?1)) = ?1")
        .bind(Issue::fingerprint_prefix(kind, Some(about)))
        .execute(&mut *conn)
        .await?;
    Ok(())
}
