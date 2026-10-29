// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Targets list records (spec 072 PLAN-TGT-FR-01/03/08/10) on the catalog's
//! single serialized writer: ★ favourites, current associated session Targets
//! and open-Project subjects read beside them as My targets, search-result
//! actions, Sessions and Captured per channel over `live_assets`, and saved
//! presets. Favourite and preset writes change only their own table; a result
//! click atomically opens a current My targets member or adds it as a favourite.

use std::collections::{BTreeMap, BTreeSet};

use platevault_model::{
    counts_as_confirmed, validate_preset_name, AssociationState, Availability, ChannelIntegration,
    EvidenceItem, LibraryError, MyTargetMarks, PresetFilters, ProjectBadge, Revision, SavedPreset,
    TargetActivity, TargetCandidate, TargetsSearchAction,
};
use sqlx::sqlite::SqliteConnection;
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::{
    conflict, current_member_assets, db_revision, from_json, from_text, load_target, next_counter,
    now, parse_uuid, require_revision, revision, to_json, upsert_target, validate_target, Catalog,
    Result,
};

impl Catalog {
    /// Favourites, qualifying current session Targets with live members, and
    /// open-Project subjects with badges, read from one snapshot.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn my_target_marks(&self) -> Result<MyTargetMarks> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let marks = my_target_marks_in(&mut snapshot).await?;
        snapshot.rollback().await?;
        Ok(marks)
    }

    /// Add or remove the ★ favourite of a saved Target; returns the new state.
    /// Setting the state it already has changes nothing.
    ///
    /// # Errors
    /// `NotFound` for an unsaved Target.
    pub async fn set_favourite(&self, target_id: Uuid, favourite: bool) -> Result<bool> {
        write_txn!(self, |conn| {
            load_target(conn, target_id).await?;
            if favourite {
                insert_favourite(conn, target_id).await?;
            } else {
                sqlx::query("DELETE FROM target_favourites WHERE target_id = ?1")
                    .bind(target_id.to_string())
                    .execute(&mut *conn)
                    .await?;
            }
        });
        Ok(favourite)
    }

    /// Open the current record if it is already in My targets; otherwise add
    /// the canonical candidate and favourite it in one writer transaction.
    /// The membership test and add are atomic, so a concurrent membership
    /// change cannot make a stale search snapshot change the selected action.
    ///
    /// # Errors
    /// `NotFound` when the saved Target does not exist; `PersistenceFailure`
    /// when the writer transaction fails.
    pub async fn act_on_target_search_result(
        &self,
        candidate: &TargetCandidate,
        may_restore: bool,
    ) -> Result<TargetsSearchAction> {
        write_txn!(self, |conn| {
            let record = match load_target(conn, candidate.id).await {
                Ok(record) => record,
                Err(LibraryError::NotFound(_)) if may_restore => {
                    validate_target(candidate)?;
                    upsert_target(conn, candidate, 1).await?;
                    next_counter(conn, "target_generation").await?;
                    load_target(conn, candidate.id).await?
                }
                Err(error) => return Err(error),
            };
            let marks = my_target_marks_in(conn).await?;
            if marks.contains(candidate.id) {
                return Ok(TargetsSearchAction::Open { target: record });
            }
            insert_favourite(conn, candidate.id).await?;
            Ok(TargetsSearchAction::Added { target: record })
        })
    }

    /// Sessions and Captured of every Target that has a confirmed session:
    /// current sessions with a frame outside the Trash, and per channel the
    /// exposure of their light frames outside the Trash, whatever their
    /// quality. A Retired copy counts toward no total, and byte-identical
    /// copies count once.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn target_activity(&self) -> Result<BTreeMap<Uuid, TargetActivity>> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let rows = sqlx::query(
            "SELECT ta.target_id, s.id AS session_id, ta.state, ta.evidence FROM associations ta \
             JOIN sessions s ON s.id = ta.session_id AND s.superseded_by IS NULL \
             WHERE ta.kind = 'target' AND ta.target_id IS NOT NULL \
             ORDER BY ta.target_id, s.id",
        )
        .fetch_all(&mut *snapshot)
        .await?;
        let mut totals: BTreeMap<Uuid, Tally> = BTreeMap::new();
        for row in &rows {
            let state: AssociationState = from_text(&row.try_get::<String, _>("state")?)?;
            let evidence: Vec<EvidenceItem> = from_json(&row.try_get::<String, _>("evidence")?)?;
            if !counts_as_confirmed(&state, &evidence) {
                continue;
            }
            let target = parse_uuid(&row.try_get::<String, _>("target_id")?)?;
            let session = parse_uuid(&row.try_get::<String, _>("session_id")?)?;
            let assets = current_member_assets(&mut snapshot, session).await?;
            if assets.is_empty() {
                continue;
            }
            let tally = totals.entry(target).or_default();
            tally.sessions += 1;
            for asset in assets {
                if asset.availability == Availability::Retired
                    || asset.effective.is_light() != Some(true)
                {
                    continue;
                }
                let Some(seconds) = asset.effective.exposure_seconds else { continue };
                let copy = asset.fingerprint.content_sha256.unwrap_or_else(|| asset.id.to_string());
                if !tally.captures.insert(copy) {
                    continue;
                }
                let channel = tally.channels.entry(asset.effective.filter).or_insert((0.0, 0));
                channel.0 += seconds;
                channel.1 += 1;
            }
        }
        snapshot.rollback().await?;
        Ok(totals
            .into_iter()
            .map(|(target, tally)| {
                let captured = tally
                    .channels
                    .into_iter()
                    .map(|(channel, (seconds, frames))| ChannelIntegration {
                        channel,
                        seconds,
                        frames,
                    })
                    .collect();
                (target, TargetActivity { sessions: tally.sessions, captured })
            })
            .collect())
    }

    /// Saved presets by name.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn saved_presets(&self) -> Result<Vec<SavedPreset>> {
        let mut conn = self.reader().await?;
        let rows = sqlx::query(
            "SELECT id, name, filters, revision FROM targets_presets ORDER BY name_key, id",
        )
        .fetch_all(&mut *conn)
        .await?;
        rows.iter().map(preset_from_row).collect()
    }

    /// Save the current filters as a named preset at revision 1.
    ///
    /// # Errors
    /// `InvalidInput` for a blank, overlong or built-in name; `Conflict`
    /// naming the saved preset that already has the name.
    pub async fn create_preset(&self, name: &str, filters: &PresetFilters) -> Result<SavedPreset> {
        validate_preset_name(name)?;
        let id = Uuid::new_v4();
        write_txn!(self, |conn| {
            require_free_name(conn, name, None).await?;
            let at = now()?;
            sqlx::query(
                "INSERT INTO targets_presets (id, name, name_key, filters, revision, created_at, \
                 updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)",
            )
            .bind(id.to_string())
            .bind(name.trim())
            .bind(name_key(name))
            .bind(to_json(filters)?)
            .bind(at)
            .execute(&mut *conn)
            .await?;
        });
        Ok(SavedPreset { id, name: name.trim().to_owned(), filters: filters.clone(), revision: 1 })
    }

    /// Rename a saved preset at its expected revision; its filters stay.
    ///
    /// # Errors
    /// `InvalidInput` for an invalid name; `NotFound` for an unknown preset;
    /// `Conflict` for a stale revision or a name another preset has.
    pub async fn rename_preset(
        &self,
        id: Uuid,
        name: &str,
        expected: Revision,
    ) -> Result<SavedPreset> {
        validate_preset_name(name)?;
        let preset = write_txn!(self, |conn| {
            let current = load_preset(conn, id).await?;
            require_revision(id, current.revision, expected)?;
            require_free_name(conn, name, Some(id)).await?;
            sqlx::query(
                "UPDATE targets_presets SET name = ?2, name_key = ?3, revision = ?4, \
                 updated_at = ?5 WHERE id = ?1",
            )
            .bind(id.to_string())
            .bind(name.trim())
            .bind(name_key(name))
            .bind(db_revision(expected + 1)?)
            .bind(now()?)
            .execute(&mut *conn)
            .await?;
            load_preset(conn, id).await?
        });
        Ok(preset)
    }

    /// Delete a saved preset at its expected revision.
    ///
    /// # Errors
    /// `NotFound` for an unknown preset; `Conflict` for a stale revision.
    pub async fn delete_preset(&self, id: Uuid, expected: Revision) -> Result<()> {
        write_txn!(self, |conn| {
            let current = load_preset(conn, id).await?;
            require_revision(id, current.revision, expected)?;
            sqlx::query("DELETE FROM targets_presets WHERE id = ?1")
                .bind(id.to_string())
                .execute(&mut *conn)
                .await?;
        });
        Ok(())
    }
}

/// One Target's running Sessions and Captured totals.
#[derive(Default)]
struct Tally {
    sessions: u32,
    /// Logical captures already counted, by content digest.
    captures: BTreeSet<String>,
    channels: BTreeMap<Option<String>, (f64, u32)>,
}

async fn my_target_marks_in(conn: &mut SqliteConnection) -> Result<MyTargetMarks> {
    let favourites: Vec<String> =
        sqlx::query_scalar("SELECT target_id FROM target_favourites ORDER BY target_id")
            .fetch_all(&mut *conn)
            .await?;
    let session_rows = sqlx::query(
        "SELECT a.target_id, a.state, a.evidence FROM associations a \
         JOIN sessions s ON s.id = a.session_id AND s.superseded_by IS NULL \
         WHERE a.kind = 'target' AND a.target_id IS NOT NULL \
         AND EXISTS (SELECT 1 FROM live_assets la WHERE la.session_id = s.id) \
         ORDER BY a.target_id, s.id",
    )
    .fetch_all(&mut *conn)
    .await?;
    let mut sessions = BTreeSet::new();
    for row in &session_rows {
        let state: AssociationState = from_text(&row.try_get::<String, _>("state")?)?;
        let evidence: Vec<EvidenceItem> = from_json(&row.try_get::<String, _>("evidence")?)?;
        if counts_as_confirmed(&state, &evidence) {
            sessions.insert(parse_uuid(&row.try_get::<String, _>("target_id")?)?);
        }
    }
    let rows = sqlx::query(
        "SELECT s.target_id, p.id, p.name FROM project_subjects s \
         JOIN projects p ON p.id = s.project_id WHERE p.lifecycle = 'open' \
         ORDER BY s.target_id, p.name, p.id",
    )
    .fetch_all(&mut *conn)
    .await?;
    let mut marks = MyTargetMarks {
        favourites: favourites.iter().map(|id| parse_uuid(id)).collect::<Result<_>>()?,
        sessions,
        badges: BTreeMap::new(),
    };
    for row in &rows {
        let target = parse_uuid(&row.try_get::<String, _>("target_id")?)?;
        marks.badges.entry(target).or_default().push(ProjectBadge {
            project_id: parse_uuid(&row.try_get::<String, _>("id")?)?,
            name: row.try_get("name")?,
        });
    }
    Ok(marks)
}
async fn insert_favourite(conn: &mut SqliteConnection, target: Uuid) -> Result<()> {
    sqlx::query(
        "INSERT INTO target_favourites (target_id, added_at) VALUES (?1, ?2) \
         ON CONFLICT (target_id) DO NOTHING",
    )
    .bind(target.to_string())
    .bind(now()?)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// The case-folded name two presets may not share.
fn name_key(name: &str) -> String {
    name.trim().to_lowercase()
}

async fn require_free_name(
    conn: &mut SqliteConnection,
    name: &str,
    except: Option<Uuid>,
) -> Result<()> {
    let row = sqlx::query("SELECT id, revision FROM targets_presets WHERE name_key = ?1")
        .bind(name_key(name))
        .fetch_optional(&mut *conn)
        .await?;
    if let Some(row) = row {
        let holder = parse_uuid(&row.try_get::<String, _>("id")?)?;
        if Some(holder) != except {
            return Err(conflict(holder, revision(row.try_get("revision")?)?));
        }
    }
    Ok(())
}

async fn load_preset(conn: &mut SqliteConnection, id: Uuid) -> Result<SavedPreset> {
    let row = sqlx::query("SELECT id, name, filters, revision FROM targets_presets WHERE id = ?1")
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("preset {id}")))?;
    preset_from_row(&row)
}

fn preset_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<SavedPreset> {
    Ok(SavedPreset {
        id: parse_uuid(&row.try_get::<String, _>("id")?)?,
        name: row.try_get("name")?,
        filters: from_json(&row.try_get::<String, _>("filters")?)?,
        revision: revision(row.try_get("revision")?)?,
    })
}
