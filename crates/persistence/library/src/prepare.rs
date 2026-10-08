// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Application preparation records (spec 069 PREP-FR-01..14) in the clean
//! catalog: handoff profiles, preparation revisions of a run, their entries
//! with each source's snapshot, the Results folder every revision of a run
//! shares, and a run group's Prepare all revisions with one panel run
//! revision each. Filesystem work is the caller's: a revision is recorded
//! Running before any entry is written, each entry's outcome is recorded as it
//! settles, and only a terminal state ends the revision. Every write is one
//! `BEGIN IMMEDIATE` transaction that checks its preconditions first, so a
//! refusal writes nothing.

use platevault_model::{
    CorrectedField, EntryEvidence, EntryState, GroupPreparation, InputMode, ItemReason,
    LibraryError, LinkKind, NativePath, PreparationRevision, PreparationState, PreparedEntry,
    PreparedEntryKind, PreparedInput, Profile, ProfileInput, Revision, SourceBasis, View,
    ViewGroup, WrittenCopy,
};
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::view_groups::{group_runs, load_group, panel_number, PanelRun};
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
            let row = RevisionRow::single(input);
            require_next(conn, &view, &row, &at).await?;
            insert_revision(conn, id, &row, &at).await?;
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

    /// End a Running revision in its terminal state. A panel run's revision
    /// retried after its Prepare all ended moves the group outcome with it.
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
            if let Some(group) = revision.group_preparation_id {
                if load_group_preparation_row(conn, group).await?.outcome
                    != PreparationState::Running
                {
                    write_group_outcome(conn, group, &at).await?;
                }
            }
            load_preparation(conn, id).await
        })
    }

    /// Retry: a Partial or Paused revision runs again in its own folder for
    /// its blocked and pending entries. A revised selection needs a new
    /// review and revision instead (PREP-FR-11).
    ///
    /// # Errors
    /// `InvalidInput` for another state, a run in the Trash, a Complete run,
    /// a run whose committed membership moved past the revision's, or a panel
    /// run's revision while its Prepare all is Running.
    pub async fn resume_preparation(&self, id: Uuid) -> Result<PreparationRecord> {
        write_txn!(self, |conn| {
            let revision = load_revision(conn, id).await?;
            if let Some(group) = revision.group_preparation_id {
                let group = load_group_preparation_row(conn, group).await?;
                if group.outcome == PreparationState::Running {
                    return Err(invalid(format!(
                        "Prepare all '{}' is Running; it prepares this panel run",
                        group.name()
                    )));
                }
            }
            resume_revision(conn, &revision).await?;
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

    /// Revisions left Running by an earlier process read Paused, and so does
    /// a Prepare all left Running: closing `PlateVault` never completes or
    /// prepares a run. Returns how many revisions.
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
            let groups: Vec<String> =
                sqlx::query_scalar("SELECT id FROM group_preparations WHERE outcome = 'running'")
                    .fetch_all(&mut *conn)
                    .await?;
            for group in &groups {
                write_group_outcome(conn, parse_uuid(group)?, &at).await?;
            }
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

    /// Every recorded prepared folder, group folder and Results folder of
    /// every run and run group.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn recorded_preparation_folders(&self) -> Result<RecordedFolders> {
        let mut conn = self.reader().await?;
        load_recorded_folders(&mut conn).await
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

// ---------------------------------------------------------------------------
// Run group: Prepare all (PREP-FR-07/12/13, D-W38, D-W73)
// ---------------------------------------------------------------------------

/// One panel run's revision of a new Prepare all.
#[derive(Clone, Debug)]
pub struct NewPanelPreparation {
    pub view_id: Uuid,
    /// The panel run's next preparation number.
    pub n: u32,
    pub membership_revision: Revision,
    /// `Panel N/` inside the group folder.
    pub folder: NativePath,
    /// The panel run's `<Mosaic> Results/Panel N/`.
    pub results_folder: NativePath,
    /// `folder` and `results_folder` resolved when Prepare made them, as
    /// [`NewPreparation::canonical_folder`] (PREP-FR-07).
    pub canonical_folder: Option<NativePath>,
    pub canonical_results: Option<NativePath>,
    pub entries: Vec<NewPreparedEntry>,
}

/// A Prepare all to record Running: its group folder and one revision per
/// panel run outside the Project's Trash, by panel number, each with the
/// group's shared profile and input mode.
#[derive(Clone, Debug)]
pub struct NewGroupPreparation {
    pub group_id: Uuid,
    /// The number review proposed: 1 for `<Mosaic>/`, N for `<Mosaic> (rev N)/`.
    pub n: u32,
    pub profile_id: Uuid,
    pub mode: InputMode,
    pub link: Option<LinkKind>,
    pub output: NativePath,
    pub folder: NativePath,
    /// `<Mosaic> Results/Assembled/`.
    pub assembled: NativePath,
    /// `folder` and `assembled` resolved when Prepare made them, as
    /// [`NewPreparation::canonical_folder`] (PREP-FR-07).
    pub canonical_folder: Option<NativePath>,
    pub canonical_assembled: Option<NativePath>,
    pub panels: Vec<NewPanelPreparation>,
}

/// A panel run's revision in a Prepare all.
#[derive(Clone, Debug)]
pub struct PanelPreparationRecord {
    pub number: u32,
    pub panel_id: Uuid,
    pub record: PreparationRecord,
}

/// A Prepare all with each panel run's revision, by panel number.
#[derive(Clone, Debug)]
pub struct GroupPreparationRecord {
    pub preparation: GroupPreparation,
    pub panels: Vec<PanelPreparationRecord>,
}

/// One panel run of a run group.
#[derive(Clone, Debug)]
pub struct GroupPanel {
    pub number: u32,
    pub panel_id: Uuid,
    pub view: View,
}

/// A run group as Prepare all reads it: every panel run by panel number, the
/// ones in the Project's Trash too, its Prepare all revisions by number and
/// its recorded Assembled folder.
#[derive(Clone, Debug)]
pub struct GroupPreparationBasis {
    pub group: ViewGroup,
    pub panels: Vec<GroupPanel>,
    pub preparations: Vec<GroupPreparation>,
    pub assembled: Option<NativePath>,
}

/// A group preparation read: its columns, then `$tail`.
macro_rules! group_sql {
    ($tail:literal) => {
        concat!(
            "SELECT id, group_id, n, profile_id, output, folder, outcome, started_at, finished_at ",
            "FROM group_preparations ",
            $tail
        )
    };
}

impl Catalog {
    /// The run group as Prepare all reads it, in one snapshot.
    ///
    /// # Errors
    /// `NotFound` for an unknown run group.
    pub async fn group_preparation_basis(&self, group: Uuid) -> Result<GroupPreparationBasis> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let record = load_group(&mut snapshot, group).await?;
        let panels = group_runs(&mut snapshot, group)
            .await?
            .into_iter()
            .map(|PanelRun { number, panel_id, view }| GroupPanel { number, panel_id, view })
            .collect();
        let preparations = load_group_preparations(&mut snapshot, group).await?;
        let assembled = load_assembled_folder(&mut snapshot, group).await?;
        snapshot.rollback().await?;
        Ok(GroupPreparationBasis { group: record, panels, preparations, assembled })
    }

    /// Record Prepare all Running (PREP-FR-12/13): the group revision in its
    /// new group folder and one Running revision per panel run outside the
    /// Project's Trash with every planned entry pending (a blocked one with its
    /// reason), each panel run's Results folder and the group's Assembled
    /// folder on their first preparation. The caller has already created the
    /// new folders.
    ///
    /// # Errors
    /// `InvalidInput` for a Running Prepare all, a number other than the next
    /// one, a profile or input mode other than the group's shared setup, a
    /// panel list other than every panel run outside the Trash by panel
    /// number, a Complete panel run, one with a Running revision, or a
    /// Results or Assembled folder other than the recorded one; `Conflict`
    /// carrying a panel run's revision when its membership moved on;
    /// `NotFound` for an unknown run group or profile.
    pub async fn start_group_preparation(
        &self,
        input: &NewGroupPreparation,
    ) -> Result<GroupPreparationRecord> {
        if input.panels.is_empty() {
            return Err(invalid("Prepare all needs at least one panel run"));
        }
        if input.panels.iter().any(|panel| panel.entries.is_empty()) {
            return Err(invalid("each panel run's preparation needs at least one input"));
        }
        let id = Uuid::new_v4();
        let at = now()?;
        write_txn!(self, |conn| {
            load_profile(conn, input.profile_id).await?;
            let group = load_group(conn, input.group_id).await?;
            if group.setup.profile_id != Some(input.profile_id)
                || group.setup.input_mode != Some(input.mode)
            {
                return Err(invalid(format!(
                    "run group '{}' shares another profile or input mode now; review again",
                    group.name
                )));
            }
            let preparations = load_group_preparations(conn, group.id).await?;
            if let Some(running) =
                preparations.iter().find(|done| done.outcome == PreparationState::Running)
            {
                return Err(invalid(format!(
                    "Prepare all '{}' of run group '{}' is Running",
                    running.name(),
                    group.name
                )));
            }
            let next = preparations.iter().map(|done| done.n).max().unwrap_or(0) + 1;
            if input.n != next {
                return Err(invalid(format!(
                    "the review proposed group preparation {} but {next} is next; review again",
                    input.n
                )));
            }
            let live: Vec<View> = group_runs(conn, group.id)
                .await?
                .into_iter()
                .filter(|run| run.view.trashed_at.is_none())
                .map(|run| run.view)
                .collect();
            if !live.iter().map(|view| view.id).eq(input.panels.iter().map(|panel| panel.view_id)) {
                return Err(invalid(format!(
                    "Prepare all of run group '{}' covers every panel run outside the Project's \
                     Trash; review again",
                    group.name
                )));
            }
            let rows: Vec<RevisionRow<'_>> =
                input.panels.iter().map(|panel| RevisionRow::panel(input, panel, id)).collect();
            for (view, row) in live.iter().zip(&rows) {
                require_open(view)?;
                require_next(conn, view, row, &at).await?;
            }
            match load_assembled_folder(conn, group.id).await? {
                Some(recorded) if recorded != input.assembled => {
                    return Err(invalid(format!(
                        "run group '{}' keeps its Assembled folder {}",
                        group.name,
                        recorded.display()
                    )));
                }
                Some(_) => {}
                None => {
                    let owner = Owner::Group(group.id);
                    let canonical = input.canonical_assembled.as_ref();
                    insert_results_folder(conn, owner, &input.assembled, canonical, &at).await?;
                }
            }
            sqlx::query(
                "INSERT INTO group_preparations (id, group_id, n, profile_id, output, folder, \
                 canonical_folder, outcome, started_at, finished_at) VALUES (?1, ?2, ?3, ?4, ?5, \
                 ?6, ?7, 'running', ?8, NULL)",
            )
            .bind(id.to_string())
            .bind(group.id.to_string())
            .bind(i64::from(input.n))
            .bind(input.profile_id.to_string())
            .bind(to_json(&input.output)?)
            .bind(to_json(&input.folder)?)
            .bind(input.canonical_folder.as_ref().map(to_json).transpose()?)
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            for row in &rows {
                insert_revision(conn, Uuid::new_v4(), row, &at).await?;
            }
            load_group_preparation(conn, id).await
        })
    }

    /// End a Running Prepare all: every panel run's revision still Running
    /// ends `remaining` (Canceled or Paused when the user stopped Prepare
    /// all, Failed when it ended early), and the group takes the outcome its
    /// panel runs give (PREP-FR-12).
    ///
    /// # Errors
    /// `InvalidInput` for `Running` as the end state or a Prepare all that is
    /// not Running; `NotFound` for an unknown one.
    pub async fn finish_group_preparation(
        &self,
        id: Uuid,
        remaining: PreparationState,
        reason: Option<&str>,
    ) -> Result<GroupPreparationRecord> {
        if remaining == PreparationState::Running {
            return Err(invalid("a preparation ends in a terminal state"));
        }
        let at = now()?;
        write_txn!(self, |conn| {
            let preparation = load_group_preparation_row(conn, id).await?;
            if preparation.outcome != PreparationState::Running {
                return Err(invalid(format!(
                    "Prepare all '{}' is {}, not Running",
                    preparation.name(),
                    preparation.outcome
                )));
            }
            sqlx::query(
                "UPDATE preparation_revisions SET state = ?2, reason = ?3, finished_at = ?4 \
                 WHERE group_preparation_id = ?1 AND state = 'running'",
            )
            .bind(id.to_string())
            .bind(to_text(&remaining)?)
            .bind(reason)
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            write_group_outcome(conn, id, &at).await?;
            load_group_preparation(conn, id).await
        })
    }

    /// Retry a Partial or Paused Prepare all in its own group folder: every
    /// Partial or Paused panel run's revision runs again for its blocked and
    /// pending entries; Prepared and Failed ones stay as they are.
    ///
    /// # Errors
    /// `InvalidInput` for another outcome, nothing to retry, a panel run's
    /// revision Running on its own, or a panel run that refuses Retry as
    /// [`Self::resume_preparation`] names.
    pub async fn resume_group_preparation(&self, id: Uuid) -> Result<GroupPreparationRecord> {
        write_txn!(self, |conn| {
            let preparation = load_group_preparation_row(conn, id).await?;
            if !matches!(preparation.outcome, PreparationState::Partial | PreparationState::Paused)
            {
                return Err(invalid(format!(
                    "Prepare all '{}' is {}; only a Partial or Paused one is retried",
                    preparation.name(),
                    preparation.outcome
                )));
            }
            let record = load_group_preparation(conn, id).await?;
            let revisions: Vec<&PreparationRevision> =
                record.panels.iter().map(|panel| &panel.record.revision).collect();
            if let Some(running) =
                revisions.iter().find(|revision| revision.state == PreparationState::Running)
            {
                return Err(invalid(format!(
                    "preparation '{}' of run {} is Running",
                    running.name(),
                    running.view_id
                )));
            }
            let mut resumed = 0;
            for revision in revisions.iter().filter(|revision| {
                matches!(revision.state, PreparationState::Partial | PreparationState::Paused)
            }) {
                resume_revision(conn, revision).await?;
                resumed += 1;
            }
            if resumed == 0 {
                return Err(invalid(format!(
                    "Prepare all '{}' has no Partial or Paused panel run to retry",
                    preparation.name()
                )));
            }
            sqlx::query(
                "UPDATE group_preparations SET outcome = 'running', finished_at = NULL \
                 WHERE id = ?1",
            )
            .bind(id.to_string())
            .execute(&mut *conn)
            .await?;
            load_group_preparation(conn, id).await
        })
    }

    /// A Prepare all with each panel run's revision and entries.
    ///
    /// # Errors
    /// `NotFound` for an unknown one.
    pub async fn group_preparation(&self, id: Uuid) -> Result<GroupPreparationRecord> {
        let mut conn = self.reader().await?;
        load_group_preparation(&mut conn, id).await
    }

    /// Every Prepare all of a run group, by number.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn group_preparations(&self, group: Uuid) -> Result<Vec<GroupPreparation>> {
        let mut conn = self.reader().await?;
        load_group_preparations(&mut conn, group).await
    }

    /// The run group's Assembled folder, once recorded.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn group_assembled_folder(&self, group: Uuid) -> Result<Option<NativePath>> {
        let mut conn = self.reader().await?;
        load_assembled_folder(&mut conn, group).await
    }

    /// Every Running Prepare all that holds a revision of run `view`.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn running_group_preparations(&self, view: Uuid) -> Result<Vec<GroupPreparation>> {
        let mut conn = self.reader().await?;
        let rows = sqlx::query(group_sql!(
            "WHERE outcome = 'running' AND id IN (SELECT group_preparation_id FROM \
             preparation_revisions WHERE view_id = ?1) ORDER BY started_at, id"
        ))
        .bind(view.to_string())
        .fetch_all(&mut *conn)
        .await?;
        rows.iter().map(group_preparation_row).collect()
    }
}

/// One preparation revision row to insert, of a single run or of a panel run
/// in a Prepare all.
struct RevisionRow<'a> {
    view_id: Uuid,
    n: u32,
    membership_revision: Revision,
    profile_id: Uuid,
    mode: InputMode,
    link: Option<LinkKind>,
    output: &'a NativePath,
    folder: &'a NativePath,
    results_folder: &'a NativePath,
    canonical_folder: Option<&'a NativePath>,
    canonical_results: Option<&'a NativePath>,
    group: Option<Uuid>,
    entries: &'a [NewPreparedEntry],
}

impl<'a> RevisionRow<'a> {
    fn single(input: &'a NewPreparation) -> Self {
        Self {
            view_id: input.view_id,
            n: input.n,
            membership_revision: input.membership_revision,
            profile_id: input.profile_id,
            mode: input.mode,
            link: input.link,
            output: &input.output,
            folder: &input.folder,
            results_folder: &input.results_folder,
            canonical_folder: input.canonical_folder.as_ref(),
            canonical_results: input.canonical_results.as_ref(),
            group: None,
            entries: &input.entries,
        }
    }

    fn panel(group: &'a NewGroupPreparation, panel: &'a NewPanelPreparation, id: Uuid) -> Self {
        Self {
            view_id: panel.view_id,
            n: panel.n,
            membership_revision: panel.membership_revision,
            profile_id: group.profile_id,
            mode: group.mode,
            link: group.link,
            output: &group.output,
            folder: &panel.folder,
            results_folder: &panel.results_folder,
            canonical_folder: panel.canonical_folder.as_ref(),
            canonical_results: panel.canonical_results.as_ref(),
            group: Some(id),
            entries: &panel.entries,
        }
    }
}

/// Who a Results folder belongs to: a run or panel run, or a run group's
/// assembled mosaic.
#[derive(Clone, Copy)]
enum Owner {
    Run(Uuid),
    Panel(Uuid),
    Group(Uuid),
}

/// What every new revision of `view` checks: its committed membership is the
/// row's, it has no Running revision, the row's number is its next one and
/// its Results folder is the recorded one, recorded now on its first
/// revision.
async fn require_next(
    conn: &mut SqliteConnection,
    view: &View,
    row: &RevisionRow<'_>,
    at: &str,
) -> Result<()> {
    if view.revision != row.membership_revision {
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
    if row.n != next {
        return Err(invalid(format!(
            "the review proposed preparation {} but {next} is next; review again",
            row.n
        )));
    }
    match load_results_folder(conn, view.id).await? {
        Some(recorded) if recorded != *row.results_folder => {
            Err(invalid(format!("run {} keeps its Results folder {}", view.id, recorded.display())))
        }
        Some(_) => Ok(()),
        None => {
            let owner =
                if row.group.is_some() { Owner::Panel(view.id) } else { Owner::Run(view.id) };
            insert_results_folder(conn, owner, row.results_folder, row.canonical_results, at).await
        }
    }
}

/// Record a Results folder: its chosen form, shown and opened, and the form
/// it resolved to when Prepare made it, which containment uses (PREP-FR-07).
async fn insert_results_folder(
    conn: &mut SqliteConnection,
    owner: Owner,
    path: &NativePath,
    canonical: Option<&NativePath>,
    at: &str,
) -> Result<()> {
    let (view, group, kind) = match owner {
        Owner::Run(view) => (Some(view), None, "run"),
        Owner::Panel(view) => (Some(view), None, "panel"),
        Owner::Group(group) => (None, Some(group), "assembled"),
    };
    sqlx::query(
        "INSERT INTO results_folders (id, view_id, group_id, kind, path, canonical_path, \
         created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(view.map(|id| id.to_string()))
    .bind(group.map(|id| id.to_string()))
    .bind(kind)
    .bind(to_json(path)?)
    .bind(canonical.map(to_json).transpose()?)
    .bind(at)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Insert a Running revision with every entry pending or blocked.
async fn insert_revision(
    conn: &mut SqliteConnection,
    id: Uuid,
    row: &RevisionRow<'_>,
    at: &str,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO preparation_revisions (id, view_id, n, membership_revision, profile_id, \
         mode, link, output, folder, canonical_folder, results_folder, state, reason, \
         group_preparation_id, started_at, finished_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, \
         ?9, ?10, ?11, 'running', NULL, ?12, ?13, NULL)",
    )
    .bind(id.to_string())
    .bind(row.view_id.to_string())
    .bind(i64::from(row.n))
    .bind(db_revision(row.membership_revision)?)
    .bind(row.profile_id.to_string())
    .bind(to_text(&row.mode)?)
    .bind(row.link.as_ref().map(to_text).transpose()?)
    .bind(to_json(row.output)?)
    .bind(to_json(row.folder)?)
    .bind(row.canonical_folder.map(to_json).transpose()?)
    .bind(to_json(row.results_folder)?)
    .bind(row.group.map(|group| group.to_string()))
    .bind(at)
    .execute(&mut *conn)
    .await?;
    for (seq, entry) in row.entries.iter().enumerate() {
        insert_entry(conn, id, seq, entry, at).await?;
    }
    Ok(())
}

/// Retry one Partial or Paused revision: its run is open and its committed
/// membership is still the revision's; it reads Running again.
async fn resume_revision(
    conn: &mut SqliteConnection,
    revision: &PreparationRevision,
) -> Result<()> {
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
            "run {} has membership revision {} since this preparation; a revised selection \
             needs a new review",
            view.id, view.revision
        )));
    }
    sqlx::query(
        "UPDATE preparation_revisions SET state = 'running', reason = NULL, finished_at = NULL \
         WHERE id = ?1",
    )
    .bind(revision.id.to_string())
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Record the outcome a Prepare all's panel runs give it (PREP-FR-12).
async fn write_group_outcome(conn: &mut SqliteConnection, id: Uuid, at: &str) -> Result<()> {
    let states: Vec<String> = sqlx::query_scalar(
        "SELECT state FROM preparation_revisions WHERE group_preparation_id = ?1",
    )
    .bind(id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    let states =
        states.iter().map(|state| from_text(state)).collect::<Result<Vec<PreparationState>>>()?;
    sqlx::query("UPDATE group_preparations SET outcome = ?2, finished_at = ?3 WHERE id = ?1")
        .bind(id.to_string())
        .bind(to_text(&GroupPreparation::outcome_for(states))?)
        .bind(at)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

async fn load_group_preparation_row(
    conn: &mut SqliteConnection,
    id: Uuid,
) -> Result<GroupPreparation> {
    let row = sqlx::query(group_sql!("WHERE id = ?1"))
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("group preparation {id}")))?;
    group_preparation_row(&row)
}

async fn load_group_preparations(
    conn: &mut SqliteConnection,
    group: Uuid,
) -> Result<Vec<GroupPreparation>> {
    let rows = sqlx::query(group_sql!("WHERE group_id = ?1 ORDER BY n"))
        .bind(group.to_string())
        .fetch_all(&mut *conn)
        .await?;
    rows.iter().map(group_preparation_row).collect()
}

async fn load_group_preparation(
    conn: &mut SqliteConnection,
    id: Uuid,
) -> Result<GroupPreparationRecord> {
    let preparation = load_group_preparation_row(conn, id).await?;
    let rows = sqlx::query(
        "SELECT r.id, p.id AS panel_id, p.number FROM preparation_revisions r \
         JOIN views v ON v.id = r.view_id JOIN subject_panels p ON p.id = v.panel_id \
         WHERE r.group_preparation_id = ?1 ORDER BY p.number",
    )
    .bind(id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    let mut panels = Vec::with_capacity(rows.len());
    for row in &rows {
        panels.push(PanelPreparationRecord {
            number: panel_number(row.try_get("number")?)?,
            panel_id: parse_uuid(row.try_get("panel_id")?)?,
            record: load_preparation(conn, parse_uuid(row.try_get("id")?)?).await?,
        });
    }
    Ok(GroupPreparationRecord { preparation, panels })
}

/// The run group's recorded `Assembled/` folder, once Prepare all recorded it.
pub async fn load_assembled_folder(
    conn: &mut SqliteConnection,
    group: Uuid,
) -> Result<Option<NativePath>> {
    Ok(load_recorded_assembled_folder(conn, group).await?.map(|folder| folder.path))
}

/// [`load_assembled_folder`] with the form it resolved to when Prepare all
/// made it (PREP-FR-07).
pub async fn load_recorded_assembled_folder(
    conn: &mut SqliteConnection,
    group: Uuid,
) -> Result<Option<RecordedFolder>> {
    let row: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT path, canonical_path FROM results_folders \
         WHERE group_id = ?1 AND kind = 'assembled'",
    )
    .bind(group.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    row.map(|(path, canonical)| recorded_folder(&path, canonical.as_deref())).transpose()
}

/// Each Prepare all revision's group folder of the run group, by number,
/// with the form it resolved to when Prepare all made it (PREP-FR-07).
pub async fn load_group_folders(
    conn: &mut SqliteConnection,
    group: Uuid,
) -> Result<Vec<(u32, RecordedFolder)>> {
    let rows: Vec<(i64, String, Option<String>)> = sqlx::query_as(
        "SELECT n, folder, canonical_folder FROM group_preparations WHERE group_id = ?1 \
         ORDER BY n",
    )
    .bind(group.to_string())
    .fetch_all(&mut *conn)
    .await?;
    numbered_folders(&rows)
}

fn group_preparation_row(row: &SqliteRow) -> Result<GroupPreparation> {
    Ok(GroupPreparation {
        id: parse_uuid(row.try_get("id")?)?,
        group_id: parse_uuid(row.try_get("group_id")?)?,
        n: number(row.try_get("n")?)?,
        profile_id: parse_uuid(row.try_get("profile_id")?)?,
        output: from_json(row.try_get("output")?)?,
        folder: from_json(row.try_get("folder")?)?,
        outcome: from_text(row.try_get("outcome")?)?,
        started_at: row.try_get("started_at")?,
        finished_at: row.try_get("finished_at")?,
    })
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

/// The Results folder recorded for a run or panel run, shared by its revisions.
pub async fn load_results_folder(
    conn: &mut SqliteConnection,
    view: Uuid,
) -> Result<Option<NativePath>> {
    Ok(load_recorded_results_folder(conn, view).await?.map(|folder| folder.path))
}

/// [`load_results_folder`] with the form it resolved to when Prepare made it
/// (PREP-FR-07).
pub async fn load_recorded_results_folder(
    conn: &mut SqliteConnection,
    view: Uuid,
) -> Result<Option<RecordedFolder>> {
    let row: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT path, canonical_path FROM results_folders WHERE view_id = ?1")
            .bind(view.to_string())
            .fetch_optional(&mut *conn)
            .await?;
    row.map(|(path, canonical)| recorded_folder(&path, canonical.as_deref())).transpose()
}

/// Each preparation revision's folder of a run or panel run (a panel run's is
/// its `Panel N/`), by number, with the form it resolved to when Prepare made
/// it (PREP-FR-07).
pub async fn load_revision_folders(
    conn: &mut SqliteConnection,
    view: Uuid,
) -> Result<Vec<(u32, RecordedFolder)>> {
    let rows: Vec<(i64, String, Option<String>)> = sqlx::query_as(
        "SELECT n, folder, canonical_folder FROM preparation_revisions WHERE view_id = ?1 \
         ORDER BY n",
    )
    .bind(view.to_string())
    .fetch_all(&mut *conn)
    .await?;
    numbered_folders(&rows)
}

/// One recorded folder from its stored chosen form and resolved form.
fn recorded_folder(path: &str, canonical: Option<&str>) -> Result<RecordedFolder> {
    Ok(RecordedFolder { path: from_json(path)?, canonical: canonical.map(from_json).transpose()? })
}

fn numbered_folders(rows: &[(i64, String, Option<String>)]) -> Result<Vec<(u32, RecordedFolder)>> {
    rows.iter()
        .map(|(n, path, canonical)| {
            let n = u32::try_from(*n).map_err(|_| {
                LibraryError::PersistenceFailure(format!("corrupt revision number {n}"))
            })?;
            Ok((n, recorded_folder(path, canonical.as_deref())?))
        })
        .collect()
}

/// Every recorded prepared folder (a run's revision, a panel run's `Panel N/`
/// and a run group's group folder) and every recorded Results folder, each
/// with the form it resolved to when Prepare made it, if recorded.
pub async fn load_recorded_folders(conn: &mut SqliteConnection) -> Result<RecordedFolders> {
    let prepared: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT folder, canonical_folder FROM (SELECT folder, canonical_folder, started_at, id \
         FROM preparation_revisions UNION ALL SELECT folder, canonical_folder, started_at, id \
         FROM group_preparations) ORDER BY started_at, id",
    )
    .fetch_all(&mut *conn)
    .await?;
    let results: Vec<(String, Option<String>)> =
        sqlx::query_as("SELECT path, canonical_path FROM results_folders")
            .fetch_all(&mut *conn)
            .await?;
    let folders = |rows: &[(String, Option<String>)]| -> Result<Vec<RecordedFolder>> {
        rows.iter().map(|(path, canonical)| recorded_folder(path, canonical.as_deref())).collect()
    };
    Ok(RecordedFolders { prepared: folders(&prepared)?, results: folders(&results)? })
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
