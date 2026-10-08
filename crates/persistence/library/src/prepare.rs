// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Application preparation records (spec 069 PREP-FR-01..11, PREP-FR-14) in
//! the clean catalog: handoff profiles, preparation revisions of a run, their
//! entries with each source's snapshot, and the Results folder every revision
//! of a run shares. Filesystem work is the caller's: a revision is recorded
//! Running before any entry is written, each entry's outcome is recorded as it
//! settles, and only a terminal state ends the revision. Every write is one
//! `BEGIN IMMEDIATE` transaction that checks its preconditions first, so a
//! refusal writes nothing.

use platevault_model::{
    CorrectedField, EntryEvidence, EntryState, InputMode, ItemReason, LibraryError, LinkKind,
    NativePath, PreparationRevision, PreparationState, PreparedEntry, PreparedEntryKind,
    PreparedInput, Profile, ProfileInput, Revision, SourceBasis, WrittenCopy,
};
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::views::{load_view, require_open};
use super::{
    db_revision, from_json, from_text, now, parse_uuid, require_revision, revision, to_json,
    to_text, Catalog, Result,
};

fn invalid(message: impl Into<String>) -> LibraryError {
    LibraryError::InvalidInput(message.into())
}

/// One entry of a new preparation revision, as review planned it. A blocked
/// one is recorded with its reason and never counts as prepared.
#[derive(Clone, Debug)]
pub struct NewPreparedEntry {
    pub member_key: Option<Uuid>,
    pub asset_id: Option<Uuid>,
    pub master_id: Option<Uuid>,
    pub input: PreparedInput,
    pub kind: PreparedEntryKind,
    pub path: NativePath,
    pub source: Option<NativePath>,
    pub size_bytes: u64,
    /// What its snapshot must match (D19); `None` only without a source.
    pub basis: Option<SourceBasis>,
    /// The reviewed header change of an isolated patched Copy or Clone.
    pub header_changes: Vec<CorrectedField>,
    pub blocked: Option<ItemReason>,
}

/// A preparation revision to record Running.
#[derive(Clone, Debug)]
pub struct NewPreparation {
    pub view_id: Uuid,
    /// The number review proposed: 1 for `<Run>/`, N for `<Run> (rev N)/`.
    pub n: u32,
    pub membership_revision: Revision,
    pub profile_id: Uuid,
    pub mode: InputMode,
    pub link: Option<LinkKind>,
    pub output: NativePath,
    pub folder: NativePath,
    pub results_folder: NativePath,
    /// `folder` and `results_folder` resolved when Prepare made them: the
    /// containment checks use these, so a symlinked parent retargeted later
    /// never moves them (PREP-FR-07). Display and Open keep the chosen form.
    pub canonical_folder: Option<NativePath>,
    pub canonical_results: Option<NativePath>,
    pub entries: Vec<NewPreparedEntry>,
}

/// One settled entry of a Running revision.
#[derive(Clone, Debug)]
pub struct EntryUpdate {
    pub state: EntryState,
    pub source_evidence: Option<EntryEvidence>,
    pub entry_identity: Option<EntryEvidence>,
    pub written: Option<WrittenCopy>,
    pub reason: Option<ItemReason>,
}

/// A preparation revision with every entry in sequence.
#[derive(Clone, Debug)]
pub struct PreparationRecord {
    pub revision: PreparationRevision,
    pub entries: Vec<PreparedEntry>,
}

/// The recorded preparation folders of every run, for the override-parent
/// check (PREP-FR-06): prepared folders and Results folders.
#[derive(Clone, Debug, Default)]
pub struct RecordedFolders {
    pub prepared: Vec<RecordedFolder>,
    pub results: Vec<RecordedFolder>,
}

/// One recorded folder: the chosen form, and the form it resolved to when
/// Prepare made it (`None` for a folder recorded without one).
#[derive(Clone, Debug)]
pub struct RecordedFolder {
    pub path: NativePath,
    pub canonical: Option<NativePath>,
}

/// A preparation revision read: its columns, then `$tail`.
macro_rules! revision_sql {
    ($tail:literal) => {
        concat!(
            "SELECT id, view_id, n, membership_revision, profile_id, mode, link, output, folder, ",
            "results_folder, state, reason, group_preparation_id, started_at, finished_at ",
            "FROM preparation_revisions ",
            $tail
        )
    };
}

/// A prepared entry read: its columns, then `$tail`.
macro_rules! entry_sql {
    ($tail:literal) => {
        concat!(
            "SELECT seq, member_key, asset_id, master_id, input, kind, path, source, size_bytes, ",
            "basis, header_changes, source_evidence, source_sha256, entry_identity, written, ",
            "state, reason, updated_at ",
            "FROM prepared_entries ",
            $tail
        )
    };
}

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

    /// Replace a profile at `expected`. Recorded preparations keep the
    /// profile id they ran with.
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

    /// Record a preparation revision Running with every planned entry
    /// pending (a blocked one with its reason), the run's Results folder on
    /// its first revision, and the profile as the run's handoff profile. The
    /// caller has already created the revision's new folder.
    ///
    /// # Errors
    /// `InvalidInput` for a run in the Trash, a Complete run, a panel run, a
    /// run with a Running revision, a number other than the next one, or a
    /// Results folder other than the run's; `Conflict` carrying the run's
    /// revision when `membership_revision` is not its latest committed one;
    /// `NotFound` for an unknown run or profile.
    pub async fn start_preparation(&self, input: &NewPreparation) -> Result<PreparationRecord> {
        if input.entries.is_empty() {
            return Err(invalid("a preparation needs at least one input"));
        }
        let id = Uuid::new_v4();
        let at = now()?;
        write_txn!(self, |conn| {
            load_profile(conn, input.profile_id).await?;
            let view = load_view(conn, input.view_id).await?;
            require_open(&view)?;
            if view.group_id.is_some() {
                return Err(invalid(format!(
                    "run {} is a panel run; it is prepared with its run group",
                    view.id
                )));
            }
            if view.revision != input.membership_revision {
                return Err(super::conflict(view.id, view.revision));
            }
            let revisions = load_view_revisions(conn, view.id).await?;
            if let Some(running) =
                revisions.iter().find(|revision| revision.state == PreparationState::Running)
            {
                return Err(invalid(format!(
                    "preparation '{}' of run {} is Running",
                    running.name(),
                    view.id
                )));
            }
            let next = revisions.iter().map(|revision| revision.n).max().unwrap_or(0) + 1;
            if input.n != next {
                return Err(invalid(format!(
                    "the review proposed preparation {} but {next} is next; review again",
                    input.n
                )));
            }
            match load_results_folder(conn, view.id).await? {
                Some(recorded) if recorded != input.results_folder => {
                    return Err(invalid(format!(
                        "run {} keeps its Results folder {}",
                        view.id,
                        recorded.display()
                    )));
                }
                Some(_) => {}
                None => {
                    sqlx::query(
                        "INSERT INTO results_folders (id, view_id, group_id, kind, path, \
                         canonical_path, created_at) VALUES (?1, ?2, NULL, 'run', ?3, ?4, ?5)",
                    )
                    .bind(Uuid::new_v4().to_string())
                    .bind(view.id.to_string())
                    .bind(to_json(&input.results_folder)?)
                    .bind(input.canonical_results.as_ref().map(to_json).transpose()?)
                    .bind(&at)
                    .execute(&mut *conn)
                    .await?;
                }
            }
            sqlx::query(
                "INSERT INTO preparation_revisions (id, view_id, n, membership_revision, \
                 profile_id, mode, link, output, folder, canonical_folder, results_folder, \
                 state, reason, group_preparation_id, started_at, finished_at) VALUES (?1, ?2, \
                 ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'running', NULL, NULL, ?12, NULL)",
            )
            .bind(id.to_string())
            .bind(view.id.to_string())
            .bind(i64::from(input.n))
            .bind(db_revision(input.membership_revision)?)
            .bind(input.profile_id.to_string())
            .bind(to_text(&input.mode)?)
            .bind(input.link.as_ref().map(to_text).transpose()?)
            .bind(to_json(&input.output)?)
            .bind(to_json(&input.folder)?)
            .bind(input.canonical_folder.as_ref().map(to_json).transpose()?)
            .bind(to_json(&input.results_folder)?)
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            for (seq, entry) in input.entries.iter().enumerate() {
                insert_entry(conn, id, seq, entry, &at).await?;
            }
            sqlx::query("UPDATE views SET profile_id = ?2, updated_at = ?3 WHERE id = ?1")
                .bind(view.id.to_string())
                .bind(input.profile_id.to_string())
                .bind(&at)
                .execute(&mut *conn)
                .await?;
            load_preparation(conn, id).await
        })
    }

    /// Record one entry of a Running revision as it settles: prepared with
    /// its snapshot and written identity, blocked with its reason, or pending
    /// with a copy's partial file.
    ///
    /// # Errors
    /// `InvalidInput` for a revision that is not Running, a prepared entry
    /// without a snapshot, or a blocked one without a reason; `NotFound` for
    /// an unknown revision or entry.
    pub async fn settle_prepared_entry(
        &self,
        id: Uuid,
        seq: u32,
        update: &EntryUpdate,
    ) -> Result<PreparedEntry> {
        let snapshot = update.source_evidence.as_ref().and_then(|e| e.sha256.clone());
        match update.state {
            EntryState::Prepared if snapshot.is_none() => {
                return Err(invalid("a prepared entry carries its source snapshot"));
            }
            EntryState::Blocked | EntryState::Drifted if update.reason.is_none() => {
                return Err(invalid("a blocked entry names its reason"));
            }
            _ => {}
        }
        let at = now()?;
        write_txn!(self, |conn| {
            let revision = load_revision(conn, id).await?;
            if revision.state != PreparationState::Running {
                return Err(invalid(format!(
                    "preparation '{}' is {}, not Running",
                    revision.name(),
                    revision.state
                )));
            }
            write_entry(conn, id, seq, update, snapshot.as_deref(), &at).await?;
            load_entry(conn, id, seq).await
        })
    }

    /// End a Running revision in its terminal state.
    ///
    /// # Errors
    /// `InvalidInput` for `Running` as the end state or a revision that is not
    /// Running; `NotFound` for an unknown revision.
    pub async fn finish_preparation(
        &self,
        id: Uuid,
        state: PreparationState,
        reason: Option<&str>,
    ) -> Result<PreparationRecord> {
        if state == PreparationState::Running {
            return Err(invalid("a preparation ends in a terminal state"));
        }
        let at = now()?;
        write_txn!(self, |conn| {
            let revision = load_revision(conn, id).await?;
            if revision.state != PreparationState::Running {
                return Err(invalid(format!(
                    "preparation '{}' is {}, not Running",
                    revision.name(),
                    revision.state
                )));
            }
            sqlx::query(
                "UPDATE preparation_revisions SET state = ?2, reason = ?3, finished_at = ?4 \
                 WHERE id = ?1",
            )
            .bind(id.to_string())
            .bind(to_text(&state)?)
            .bind(reason)
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            load_preparation(conn, id).await
        })
    }

    /// Retry: a Partial or Paused revision runs again in its own folder for
    /// its blocked and pending entries. A revised selection needs a new
    /// review and revision instead (PREP-FR-11).
    ///
    /// # Errors
    /// `InvalidInput` for another state, a run in the Trash, a Complete run,
    /// or a run whose committed membership moved past the revision's.
    pub async fn resume_preparation(&self, id: Uuid) -> Result<PreparationRecord> {
        write_txn!(self, |conn| {
            let revision = load_revision(conn, id).await?;
            if !matches!(revision.state, PreparationState::Partial | PreparationState::Paused) {
                return Err(invalid(format!(
                    "preparation '{}' is {}; only a Partial or Paused one is retried",
                    revision.name(),
                    revision.state
                )));
            }
            let view = load_view(conn, revision.view_id).await?;
            require_open(&view)?;
            if view.revision != revision.membership_revision {
                return Err(invalid(format!(
                    "run {} has membership revision {} since this preparation; a revised \
                     selection needs a new review",
                    view.id, view.revision
                )));
            }
            sqlx::query(
                "UPDATE preparation_revisions SET state = 'running', reason = NULL, \
                 finished_at = NULL WHERE id = ?1",
            )
            .bind(id.to_string())
            .execute(&mut *conn)
            .await?;
            load_preparation(conn, id).await
        })
    }

    /// Record what Open's re-verification found on a Prepared revision:
    /// `drifted` entries read Drifted with their reason, every other
    /// prepared or drifted entry reads Prepared again.
    ///
    /// # Errors
    /// `InvalidInput` for a revision that is not Prepared; `NotFound` for an
    /// unknown revision.
    pub async fn record_open_check(
        &self,
        id: Uuid,
        drifted: &[(u32, ItemReason)],
    ) -> Result<PreparationRecord> {
        let at = now()?;
        write_txn!(self, |conn| {
            let revision = load_revision(conn, id).await?;
            if revision.state != PreparationState::Prepared {
                return Err(invalid(format!(
                    "preparation '{}' is {}; only a Prepared one is opened",
                    revision.name(),
                    revision.state
                )));
            }
            sqlx::query(
                "UPDATE prepared_entries SET state = 'prepared', reason = NULL, updated_at = ?2 \
                 WHERE prep_id = ?1 AND state = 'drifted'",
            )
            .bind(id.to_string())
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            for (seq, reason) in drifted {
                sqlx::query(
                    "UPDATE prepared_entries SET state = 'drifted', reason = ?3, updated_at = ?4 \
                     WHERE prep_id = ?1 AND seq = ?2 AND state = 'prepared'",
                )
                .bind(id.to_string())
                .bind(i64::from(*seq))
                .bind(to_json(reason)?)
                .bind(&at)
                .execute(&mut *conn)
                .await?;
            }
            load_preparation(conn, id).await
        })
    }

    /// Revisions left Running by an earlier process read Paused: closing
    /// `PlateVault` never completes or prepares a run. Returns how many.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be written.
    pub async fn pause_interrupted_preparations(&self) -> Result<u64> {
        let at = now()?;
        write_txn!(self, |conn| {
            let done = sqlx::query(
                "UPDATE preparation_revisions SET state = 'paused', reason = ?1, \
                 finished_at = ?2 WHERE state = 'running'",
            )
            .bind("interrupted when PlateVault closed; Retry continues it")
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            Ok(done.rows_affected())
        })
    }

    /// A preparation revision with its entries.
    ///
    /// # Errors
    /// `NotFound` for an unknown revision.
    pub async fn preparation(&self, id: Uuid) -> Result<PreparationRecord> {
        let mut conn = self.reader().await?;
        load_preparation(&mut conn, id).await
    }

    /// Every preparation revision of a run, by number.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn view_preparations(&self, view: Uuid) -> Result<Vec<PreparationRevision>> {
        let mut conn = self.reader().await?;
        load_view_revisions(&mut conn, view).await
    }

    /// The Results folder every revision of the run shares, once recorded.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn view_results_folder(&self, view: Uuid) -> Result<Option<NativePath>> {
        let mut conn = self.reader().await?;
        load_results_folder(&mut conn, view).await
    }

    /// Every recorded prepared folder and Results folder of every run.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn recorded_preparation_folders(&self) -> Result<RecordedFolders> {
        let mut conn = self.reader().await?;
        let prepared: Vec<(String, Option<String>)> = sqlx::query_as(
            "SELECT folder, canonical_folder FROM preparation_revisions ORDER BY started_at, id",
        )
        .fetch_all(&mut *conn)
        .await?;
        let results: Vec<(String, Option<String>)> =
            sqlx::query_as("SELECT path, canonical_path FROM results_folders")
                .fetch_all(&mut *conn)
                .await?;
        let folders = |rows: &[(String, Option<String>)]| -> Result<Vec<RecordedFolder>> {
            rows.iter()
                .map(|(path, canonical)| {
                    Ok(RecordedFolder {
                        path: from_json(path)?,
                        canonical: canonical.as_deref().map(from_json).transpose()?,
                    })
                })
                .collect()
        };
        Ok(RecordedFolders { prepared: folders(&prepared)?, results: folders(&results)? })
    }

    /// The parent folder the latest preparation chose: review's default.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn last_preparation_output(&self) -> Result<Option<NativePath>> {
        let mut conn = self.reader().await?;
        let output: Option<String> = sqlx::query_scalar(
            "SELECT output FROM preparation_revisions ORDER BY started_at DESC, rowid DESC \
             LIMIT 1",
        )
        .fetch_optional(&mut *conn)
        .await?;
        output.as_deref().map(from_json).transpose()
    }

    /// Every asset a confirmed catalog correction changed (PREP-FR-03).
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn corrected_asset_ids(&self) -> Result<Vec<Uuid>> {
        let mut conn = self.reader().await?;
        let ids: Vec<String> =
            sqlx::query_scalar("SELECT DISTINCT asset_id FROM corrections ORDER BY asset_id")
                .fetch_all(&mut *conn)
                .await?;
        ids.iter().map(|id| parse_uuid(id)).collect()
    }
}

async fn insert_entry(
    conn: &mut SqliteConnection,
    id: Uuid,
    seq: usize,
    entry: &NewPreparedEntry,
    at: &str,
) -> Result<()> {
    let seq = i64::try_from(seq).map_err(|_| invalid("too many preparation entries"))?;
    let size = i64::try_from(entry.size_bytes).map_err(|_| invalid("file size out of range"))?;
    let state = if entry.blocked.is_some() { EntryState::Blocked } else { EntryState::Pending };
    sqlx::query(
        "INSERT INTO prepared_entries (prep_id, seq, member_key, asset_id, master_id, input, \
         kind, path, source, size_bytes, basis, header_changes, source_evidence, \
         source_sha256, entry_identity, written, state, reason, updated_at) VALUES (?1, ?2, ?3, \
         ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, NULL, NULL, NULL, NULL, ?13, ?14, ?15)",
    )
    .bind(id.to_string())
    .bind(seq)
    .bind(entry.member_key.map(|key| key.to_string()))
    .bind(entry.asset_id.map(|key| key.to_string()))
    .bind(entry.master_id.map(|key| key.to_string()))
    .bind(to_text(&entry.input)?)
    .bind(to_text(&entry.kind)?)
    .bind(to_json(&entry.path)?)
    .bind(entry.source.as_ref().map(to_json).transpose()?)
    .bind(size)
    .bind(entry.basis.as_ref().map(to_json).transpose()?)
    .bind((!entry.header_changes.is_empty()).then(|| to_json(&entry.header_changes)).transpose()?)
    .bind(to_text(&state)?)
    .bind(entry.blocked.as_ref().map(to_json).transpose()?)
    .bind(at)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn write_entry(
    conn: &mut SqliteConnection,
    id: Uuid,
    seq: u32,
    update: &EntryUpdate,
    snapshot: Option<&str>,
    at: &str,
) -> Result<()> {
    let done = sqlx::query(
        "UPDATE prepared_entries SET state = ?3, source_evidence = ?4, source_sha256 = ?5, \
         entry_identity = ?6, written = ?7, reason = ?8, updated_at = ?9 \
         WHERE prep_id = ?1 AND seq = ?2",
    )
    .bind(id.to_string())
    .bind(i64::from(seq))
    .bind(to_text(&update.state)?)
    .bind(update.source_evidence.as_ref().map(to_json).transpose()?)
    .bind(snapshot)
    .bind(update.entry_identity.as_ref().map(to_json).transpose()?)
    .bind(update.written.as_ref().map(to_json).transpose()?)
    .bind(update.reason.as_ref().map(to_json).transpose()?)
    .bind(at)
    .execute(&mut *conn)
    .await?;
    if done.rows_affected() == 0 {
        return Err(LibraryError::NotFound(format!("entry {seq} of preparation {id}")));
    }
    Ok(())
}

async fn load_profile(conn: &mut SqliteConnection, id: Uuid) -> Result<Profile> {
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

async fn load_preparation(conn: &mut SqliteConnection, id: Uuid) -> Result<PreparationRecord> {
    let revision = load_revision(conn, id).await?;
    let rows = sqlx::query(entry_sql!("WHERE prep_id = ?1 ORDER BY seq"))
        .bind(id.to_string())
        .fetch_all(&mut *conn)
        .await?;
    let entries = rows.iter().map(entry_row).collect::<Result<_>>()?;
    Ok(PreparationRecord { revision, entries })
}

async fn load_revision(conn: &mut SqliteConnection, id: Uuid) -> Result<PreparationRevision> {
    let row = sqlx::query(revision_sql!("WHERE id = ?1"))
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("preparation {id}")))?;
    revision_row(&row)
}

async fn load_view_revisions(
    conn: &mut SqliteConnection,
    view: Uuid,
) -> Result<Vec<PreparationRevision>> {
    let rows = sqlx::query(revision_sql!("WHERE view_id = ?1 ORDER BY n"))
        .bind(view.to_string())
        .fetch_all(&mut *conn)
        .await?;
    rows.iter().map(revision_row).collect()
}

async fn load_results_folder(
    conn: &mut SqliteConnection,
    view: Uuid,
) -> Result<Option<NativePath>> {
    let path: Option<String> =
        sqlx::query_scalar("SELECT path FROM results_folders WHERE view_id = ?1")
            .bind(view.to_string())
            .fetch_optional(&mut *conn)
            .await?;
    path.as_deref().map(from_json).transpose()
}

async fn load_entry(conn: &mut SqliteConnection, id: Uuid, seq: u32) -> Result<PreparedEntry> {
    let row = sqlx::query(entry_sql!("WHERE prep_id = ?1 AND seq = ?2"))
        .bind(id.to_string())
        .bind(i64::from(seq))
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("entry {seq} of preparation {id}")))?;
    entry_row(&row)
}

fn optional_id(row: &SqliteRow, column: &str) -> Result<Option<Uuid>> {
    let text: Option<String> = row.try_get(column)?;
    text.as_deref().map(parse_uuid).transpose()
}

fn optional_json<T: serde::de::DeserializeOwned>(
    row: &SqliteRow,
    column: &str,
) -> Result<Option<T>> {
    let text: Option<String> = row.try_get(column)?;
    text.as_deref().map(from_json).transpose()
}

fn number(value: i64) -> Result<u32> {
    u32::try_from(value).map_err(|_| {
        LibraryError::PersistenceFailure(format!("corrupt preparation number {value}"))
    })
}

fn revision_row(row: &SqliteRow) -> Result<PreparationRevision> {
    let link: Option<String> = row.try_get("link")?;
    Ok(PreparationRevision {
        id: parse_uuid(row.try_get("id")?)?,
        view_id: parse_uuid(row.try_get("view_id")?)?,
        n: number(row.try_get("n")?)?,
        membership_revision: revision(row.try_get("membership_revision")?)?,
        profile_id: parse_uuid(row.try_get("profile_id")?)?,
        mode: from_text(row.try_get("mode")?)?,
        link: link.as_deref().map(from_text).transpose()?,
        output: from_json(row.try_get("output")?)?,
        folder: from_json(row.try_get("folder")?)?,
        results_folder: from_json(row.try_get("results_folder")?)?,
        state: from_text(row.try_get("state")?)?,
        reason: row.try_get("reason")?,
        group_preparation_id: optional_id(row, "group_preparation_id")?,
        started_at: row.try_get("started_at")?,
        finished_at: row.try_get("finished_at")?,
    })
}

fn entry_row(row: &SqliteRow) -> Result<PreparedEntry> {
    let size: i64 = row.try_get("size_bytes")?;
    Ok(PreparedEntry {
        seq: number(row.try_get("seq")?)?,
        member_key: optional_id(row, "member_key")?,
        asset_id: optional_id(row, "asset_id")?,
        master_id: optional_id(row, "master_id")?,
        input: from_text(row.try_get("input")?)?,
        kind: from_text(row.try_get("kind")?)?,
        path: from_json(row.try_get("path")?)?,
        source: optional_json(row, "source")?,
        size_bytes: u64::try_from(size)
            .map_err(|_| LibraryError::PersistenceFailure(format!("corrupt size {size}")))?,
        basis: optional_json(row, "basis")?,
        header_changes: optional_json(row, "header_changes")?.unwrap_or_default(),
        source_evidence: optional_json(row, "source_evidence")?,
        source_sha256: row.try_get("source_sha256")?,
        entry_identity: optional_json(row, "entry_identity")?,
        written: optional_json(row, "written")?,
        state: from_text(row.try_get("state")?)?,
        reason: optional_json(row, "reason")?,
        updated_at: row.try_get("updated_at")?,
    })
}
