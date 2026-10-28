// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The catalog side of issues on rows (063 FR-032, D-W92, D-W158): the
//! fingerprints of dismissed issues (`issues.sql`), and the two issue
//! sources no other read gives in one snapshot: each session's changed
//! frames and the interrupted imports. Core derives the issues themselves
//! from these and the features' own reads.

use std::collections::BTreeSet;

use platevault_model::LibraryError;
use sqlx::sqlite::SqliteConnection;
use sqlx::Connection;
use uuid::Uuid;

use super::{admission, listed_sessions, now, parse_uuid, Catalog, Members, Result};

/// The longest fingerprint a dismissal records; a real one is far shorter.
const MAX_FINGERPRINT: usize = 512;

fn require_fingerprint(fingerprint: &str) -> Result<()> {
    if fingerprint.is_empty() || fingerprint.len() > MAX_FINGERPRINT {
        return Err(LibraryError::InvalidInput("an issue fingerprint is 1 to 512 bytes".into()));
    }
    Ok(())
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
    /// `NotFound` when no dismissal has that fingerprint; `PersistenceFailure`
    /// when the catalog cannot be written.
    pub async fn restore_issue(&self, fingerprint: &str) -> Result<()> {
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

    /// Forget the dismissals of `fingerprints`, which no current issue has:
    /// the issue they hid ended or changed, so it counts when it returns.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be written.
    pub async fn forget_issue_dismissals(&self, fingerprints: &BTreeSet<String>) -> Result<()> {
        if fingerprints.is_empty() {
            return Ok(());
        }
        write_txn!(self, |conn| {
            for fingerprint in fingerprints {
                sqlx::query("DELETE FROM issue_dismissals WHERE fingerprint = ?1")
                    .bind(fingerprint)
                    .execute(&mut *conn)
                    .await?;
            }
        });
        Ok(())
    }

    /// Each current session with reviewed frames whose bytes changed on disk
    /// (Changed content), with how many, in Sessions order from one snapshot.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn sessions_with_changed_frames(&self) -> Result<Vec<(Uuid, u64)>> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let listed = listed_sessions(&mut snapshot, false, None, Members::Live).await?;
        let mut changed = Vec::new();
        for id in listed {
            let intake = admission::read_intake(&mut snapshot, id).await?;
            if intake.changed_frames > 0 {
                changed.push((id, intake.changed_frames));
            }
        }
        snapshot.rollback().await?;
        Ok(changed)
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
