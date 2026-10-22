// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Handoff profiles (spec 069 PREP-FR-01/02) in the clean catalog: the
//! application a Project's View opens in, with its launch arguments and
//! capability evidence. A Project names its profile (`projects.profile_id`).
//! Every write is one `BEGIN IMMEDIATE` transaction.

use platevault_model::{LibraryError, Profile, ProfileInput, Revision};
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::{from_json, from_text, now, parse_uuid, require_revision, revision, to_json, to_text};
use super::{Catalog, Result};

impl Catalog {
    /// Record a handoff profile (PREP-FR-01/02).
    ///
    /// # Errors
    /// `InvalidInput` for input [`ProfileInput::validate`] refuses.
    pub async fn create_profile(&self, input: &ProfileInput) -> Result<Profile> {
        input.validate()?;
        let id = Uuid::new_v4();
        let at = now()?;
        write_txn!(self, |conn| {
            sqlx::query(
                "INSERT INTO profiles (id, name, kind, executable, args, capability_evidence, \
                 revision, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)",
            )
            .bind(id.to_string())
            .bind(input.name.trim())
            .bind(to_text(&input.kind)?)
            .bind(input.executable.as_ref().map(to_json).transpose()?)
            .bind(to_json(&input.args)?)
            .bind(to_json(&input.capability_evidence)?)
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            load_profile(conn, id).await
        })
    }

    /// Replace a profile at `expected`. A Project keeps naming the profile by
    /// id, so it opens with the updated one.
    ///
    /// # Errors
    /// `InvalidInput` as [`Self::create_profile`]; `Conflict` for a stale
    /// revision; `NotFound` for an unknown profile.
    pub async fn update_profile(
        &self,
        id: Uuid,
        expected: Revision,
        input: &ProfileInput,
    ) -> Result<Profile> {
        input.validate()?;
        let at = now()?;
        write_txn!(self, |conn| {
            let current = load_profile(conn, id).await?;
            require_revision(id, current.revision, expected)?;
            sqlx::query(
                "UPDATE profiles SET name = ?2, kind = ?3, executable = ?4, args = ?5, \
                 capability_evidence = ?6, revision = revision + 1, updated_at = ?7 WHERE id = ?1",
            )
            .bind(id.to_string())
            .bind(input.name.trim())
            .bind(to_text(&input.kind)?)
            .bind(input.executable.as_ref().map(to_json).transpose()?)
            .bind(to_json(&input.args)?)
            .bind(to_json(&input.capability_evidence)?)
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            load_profile(conn, id).await
        })
    }

    /// # Errors
    /// `NotFound` for an unknown profile.
    pub async fn profile(&self, id: Uuid) -> Result<Profile> {
        let mut conn = self.reader().await?;
        load_profile(&mut conn, id).await
    }

    /// Every profile by name.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn profiles(&self) -> Result<Vec<Profile>> {
        let mut conn = self.reader().await?;
        let rows =
            sqlx::query("SELECT * FROM profiles ORDER BY name, id").fetch_all(&mut *conn).await?;
        rows.iter().map(profile_row).collect()
    }
}

/// Profile `id` in the caller's snapshot.
///
/// # Errors
/// `NotFound` for an unknown profile.
pub async fn load_profile(conn: &mut SqliteConnection, id: Uuid) -> Result<Profile> {
    let row = sqlx::query("SELECT * FROM profiles WHERE id = ?1")
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("profile {id}")))?;
    profile_row(&row)
}

fn profile_row(row: &SqliteRow) -> Result<Profile> {
    let executable: Option<String> = row.try_get("executable")?;
    Ok(Profile {
        id: parse_uuid(row.try_get("id")?)?,
        name: row.try_get("name")?,
        kind: from_text(row.try_get("kind")?)?,
        executable: executable.as_deref().map(from_json).transpose()?,
        args: from_json(row.try_get("args")?)?,
        capability_evidence: from_json(row.try_get("capability_evidence")?)?,
        revision: revision(row.try_get("revision")?)?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}
