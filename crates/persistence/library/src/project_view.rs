// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Apply's catalog side (spec 066 VSEL-FR-14/20/21, 069 PREP-FR-06/09/19, 071
//! STO-FR-10; D-W98 to D-W100, D-W110, D-W113, D-W114): the inputs one Apply
//! builds from, its manifest, journal, foreign files and leftovers, written in
//! the order `project_view.sql` expects.
//!
//! The inputs are the Project's desired state read together with the live
//! Library state in one snapshot: a capture added Usable and since rejected
//! in the Library leaves the build, one added Unusable and since restored
//! joins it, and an explicit choice holds either way. Each held session
//! brings its current settled calibration pins. A digest of that basis is
//! what the Apply sheet records; reserving the Apply recomputes it inside
//! the write transaction and refuses a sheet that no longer matches.

use std::collections::{BTreeMap, BTreeSet};

use platevault_model::{
    logical_quality, ApplicableQuality, ApplyJournal, ApplyOutcome, ApplyPhase, Asset,
    Availability, BasisCapture, BasisGroup, BasisSession, CaptureKey, CaptureMetadata, CopyBasis,
    EntryEvidence, EntryInput, EntryName, EntryPlacement, EntrySource, ExpectedTree, FileIdentity,
    ForeignItem, GroupKeywords, GroupName, InputKind, InputRef, LibraryError, Location,
    ManifestEntry, ManifestState, NativePath, PreviousItem, PreviousItemReason, PreviousItemReview,
    ProjectBasis, ProjectLifecycle, ProjectOperation, ProjectOperationKind, Revision, SettledPin,
    ViewManifest, ViewMode, WorkflowSettings,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::sqlite::SqliteConnection;
use sqlx::{Connection, Row};
use time::Date;
use uuid::Uuid;

use super::{
    admission, calibration, from_json, from_text, load_assets, load_location, now, parse_uuid,
    path_from_key, path_key, project_operations, revision, to_json, to_text, Catalog, Result,
};

/// Where one original is now: its location and absolute path.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourcePath {
    pub location_id: Uuid,
    pub path: NativePath,
}

/// Everything one Apply reads, in one catalog snapshot.
#[derive(Clone, Debug)]
pub struct ApplyInputs {
    pub project_id: Uuid,
    pub name: String,
    pub lifecycle: ProjectLifecycle,
    /// `projects.revision`, which every desired-state edit advances.
    pub desired_revision: Revision,
    /// The processing location; `None` until the user chooses one.
    pub parent: Option<NativePath>,
    /// The desired state with the live Library state: what the next build
    /// places.
    pub basis: ProjectBasis,
    /// SHA-256 of the basis, the Project revision, the installed generation,
    /// the Project folder and the reserved entry names.
    pub basis_digest: String,
    /// Held sessions whose calibration isn't settled, with the kinds; they
    /// are left out of `basis`.
    pub unsettled: Vec<(Uuid, Vec<InputKind>)>,
    /// One included light's effective metadata per session of `basis`.
    pub metadata: BTreeMap<Uuid, CaptureMetadata>,
    /// The current path of every copy, calibration frame and master that
    /// `basis` or the installed and previous manifests name, by asset or
    /// master id. Trashed and retired copies are left out.
    pub sources: BTreeMap<Uuid, SourcePath>,
    pub locations: BTreeMap<Uuid, Location>,
    /// Every entry name the Project reserved, fixed for life.
    pub names: BTreeMap<EntryInput, String>,
    pub installed: Option<ViewManifest>,
    pub previous: Option<ViewManifest>,
    /// Leftovers still pending review or kept.
    pub leftovers: Vec<PreviousItem>,
    pub running: Option<ProjectOperation>,
    /// The identity of the `View (building)/` the last failed Apply left.
    pub failed_building: Option<FileIdentity>,
}

/// What reserving an Apply records before any file effect.
#[derive(Clone, Debug)]
pub struct ApplyReservation<'a> {
    pub project_id: Uuid,
    pub desired_revision: Revision,
    pub basis_digest: &'a str,
    /// Names reserved now for inputs that never had one.
    pub names: &'a [EntryName],
    pub expected: &'a ExpectedTree,
    /// `View (previous)/` is gone: the manifest still read as previous
    /// retires, and kept leftovers left with it.
    pub previous_gone: bool,
}

/// The reserved Apply: its Project operation, which is also its journal's
/// key, the manifest generation it builds and the basis it recorded.
#[derive(Clone, Debug)]
pub struct ApplyReserved {
    pub operation_id: Uuid,
    pub generation: Revision,
}

impl Catalog {
    /// The inputs one Apply builds from, read in one snapshot.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project; `PersistenceFailure` for a corrupt
    /// record.
    pub async fn apply_inputs(&self, project_id: Uuid) -> Result<ApplyInputs> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let inputs = read_inputs(&mut snapshot, project_id).await?;
        snapshot.rollback().await?;
        Ok(inputs)
    }

    /// Reserve the Project for one Apply (PREP-FR-19) and record, before any
    /// file effect, its building manifest, the names newcomers take and its
    /// journal at Reserved with the folder identities it expects.
    ///
    /// # Errors
    /// `Conflict` when the Project revision or the basis moved since the
    /// sheet (VSEL-FR-21); `InvalidInput` naming a running operation, a
    /// locked Project or a pending leftover; `NotFound` for an unknown
    /// Project.
    pub async fn reserve_apply(&self, reservation: &ApplyReservation<'_>) -> Result<ApplyReserved> {
        Ok(write_txn!(self, |conn| reserve(conn, reservation).await?))
    }

    /// Record `phase` of an Apply, and optionally the identities it now
    /// expects.
    ///
    /// # Errors
    /// `NotFound` for an unknown Apply; `PersistenceFailure` for a phase that
    /// isn't forward.
    pub async fn advance_apply(
        &self,
        operation_id: Uuid,
        phase: ApplyPhase,
        expected: Option<&ExpectedTree>,
    ) -> Result<()> {
        write_txn!(self, |conn| advance(conn, operation_id, phase, expected).await?);
        Ok(())
    }

    /// Record a verified build: its entries with the identities they were
    /// written with and the files `PlateVault` didn't place in the current
    /// View with the user's ticks, at `BuildVerified`.
    ///
    /// # Errors
    /// `PersistenceFailure` for an entry the manifest refuses.
    pub async fn record_apply_build(
        &self,
        journal: &ApplyJournal,
        entries: &[ManifestEntry],
        foreign: &[ForeignItem],
    ) -> Result<()> {
        write_txn!(self, |conn| {
            insert_entries(conn, journal.project_id, journal.generation, entries).await?;
            for item in foreign {
                insert_foreign(conn, journal.operation_id, item).await?;
            }
            advance(conn, journal.operation_id, ApplyPhase::BuildVerified, None).await?;
        });
        Ok(())
    }

    /// End an Apply that never installed its View: record what it wrote, if
    /// anything, discard its manifest, settle its journal Failed or Canceled
    /// and release the Project.
    ///
    /// # Errors
    /// `InvalidInput` for an outcome that isn't Failed or Canceled;
    /// `PersistenceFailure` when the journal is past `NewInstalled`.
    pub async fn discard_apply(
        &self,
        journal: &ApplyJournal,
        outcome: ApplyOutcome,
        error: Option<&str>,
        entries: &[ManifestEntry],
    ) -> Result<()> {
        if outcome == ApplyOutcome::Applied {
            return Err(LibraryError::InvalidInput("an Apply ends Applied by settling".into()));
        }
        write_txn!(self, |conn| {
            let built: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM view_manifest_entries WHERE project_id = ?1 \
                 AND generation = ?2",
            )
            .bind(journal.project_id.to_string())
            .bind(generation_value(journal.generation)?)
            .fetch_one(&mut *conn)
            .await?;
            if built == 0 {
                insert_entries(conn, journal.project_id, journal.generation, entries).await?;
            }
            set_manifest_state(conn, journal.project_id, journal.generation, "discarded", None)
                .await?;
            settle_journal(conn, journal.operation_id, outcome, error).await?;
            project_operations::settle_operation(conn, journal.operation_id).await?;
        });
        Ok(())
    }

    /// The new View is in place: the previous installed manifest becomes
    /// previous and this one installed, at `ManifestCommitted`.
    ///
    /// # Errors
    /// `PersistenceFailure` for a manifest state the schema refuses.
    pub async fn commit_apply(&self, journal: &ApplyJournal) -> Result<()> {
        write_txn!(self, |conn| {
            let at = now()?;
            sqlx::query(
                "UPDATE view_manifests SET state = 'previous' \
                 WHERE project_id = ?1 AND state = 'installed'",
            )
            .bind(journal.project_id.to_string())
            .execute(&mut *conn)
            .await?;
            set_manifest_state(
                conn,
                journal.project_id,
                journal.generation,
                "installed",
                Some(&at),
            )
            .await?;
            advance(conn, journal.operation_id, ApplyPhase::ManifestCommitted, None).await?;
        });
        Ok(())
    }

    /// Record how each foreign file ended, at `ForeignTransferred`.
    ///
    /// # Errors
    /// `PersistenceFailure` for a state the schema refuses.
    pub async fn record_apply_foreign(
        &self,
        operation_id: Uuid,
        items: &[ForeignItem],
    ) -> Result<()> {
        write_txn!(self, |conn| {
            for item in items {
                sqlx::query(
                    "UPDATE apply_foreign_items SET state = ?3, reason = ?4 \
                     WHERE operation_id = ?1 AND seq = ?2",
                )
                .bind(operation_id.to_string())
                .bind(i64::from(item.seq))
                .bind(to_text(&item.state)?)
                .bind(item.reason.as_deref())
                .execute(&mut *conn)
                .await?;
            }
            advance(conn, operation_id, ApplyPhase::ForeignTransferred, None).await?;
        });
        Ok(())
    }

    /// Settle an installed Apply Applied: record what `View (previous)/`
    /// still holds for review, retire the previous manifest when its folder
    /// is gone, and release the Project.
    ///
    /// # Errors
    /// `PersistenceFailure` for a record the schema refuses.
    pub async fn settle_apply(
        &self,
        journal: &ApplyJournal,
        leftovers: &[PreviousItem],
        previous_gone: bool,
        error: Option<&str>,
    ) -> Result<()> {
        write_txn!(self, |conn| {
            let project = journal.project_id.to_string();
            if previous_gone {
                retire_previous(conn, journal.project_id).await?;
            }
            let at = now()?;
            for item in leftovers {
                let key = path_key(&item.path);
                sqlx::query(
                    "DELETE FROM view_previous_items WHERE project_id = ?1 AND path_key = ?2 \
                     AND review IN ('moved', 'trashed')",
                )
                .bind(&project)
                .bind(&key)
                .execute(&mut *conn)
                .await?;
                sqlx::query(
                    "INSERT INTO view_previous_items (project_id, path_key, reason, evidence, \
                     review, operation_id, recorded_at) VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?6)",
                )
                .bind(&project)
                .bind(&key)
                .bind(to_text(&item.reason)?)
                .bind(to_json(&item.evidence)?)
                .bind(journal.operation_id.to_string())
                .bind(&at)
                .execute(&mut *conn)
                .await?;
            }
            settle_journal(conn, journal.operation_id, ApplyOutcome::Applied, error).await?;
            project_operations::settle_operation(conn, journal.operation_id).await?;
        });
        Ok(())
    }

    /// Every Apply journal that hasn't settled, for startup reconciliation.
    ///
    /// # Errors
    /// `PersistenceFailure` for a corrupt record.
    pub async fn unsettled_applies(&self) -> Result<Vec<ApplyJournal>> {
        let mut conn = self.reader().await?;
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT operation_id FROM apply_operations WHERE phase <> 'settled'",
        )
        .fetch_all(&mut *conn)
        .await?;
        let mut journals = Vec::with_capacity(ids.len());
        for id in ids {
            journals.push(read_journal(&mut conn, parse_uuid(&id)?).await?);
        }
        Ok(journals)
    }

    /// One Apply's journal.
    ///
    /// # Errors
    /// `NotFound` for an unknown Apply.
    pub async fn apply_journal(&self, operation_id: Uuid) -> Result<ApplyJournal> {
        let mut conn = self.reader().await?;
        read_journal(&mut conn, operation_id).await
    }

    /// One manifest with its entries.
    ///
    /// # Errors
    /// `NotFound` for an unknown manifest.
    pub async fn view_manifest(
        &self,
        project_id: Uuid,
        generation: Revision,
    ) -> Result<ViewManifest> {
        let mut conn = self.reader().await?;
        read_manifest(&mut conn, project_id, generation).await
    }

    /// The foreign files one Apply recorded.
    ///
    /// # Errors
    /// `PersistenceFailure` for a corrupt record.
    pub async fn apply_foreign_items(&self, operation_id: Uuid) -> Result<Vec<ForeignItem>> {
        let mut conn = self.reader().await?;
        let rows = sqlx::query(
            "SELECT seq, path_key, evidence, ticked, state, reason FROM apply_foreign_items \
             WHERE operation_id = ?1 ORDER BY seq",
        )
        .bind(operation_id.to_string())
        .fetch_all(&mut *conn)
        .await?;
        rows.iter()
            .map(|row| {
                Ok(ForeignItem {
                    seq: u32::try_from(row.try_get::<i64, _>("seq")?).map_err(|_| {
                        LibraryError::PersistenceFailure("corrupt foreign item seq".into())
                    })?,
                    path: path_from_key(&row.try_get::<Vec<u8>, _>("path_key")?)?,
                    evidence: from_json(&row.try_get::<String, _>("evidence")?)?,
                    ticked: row.try_get::<i64, _>("ticked")? == 1,
                    state: from_text(&row.try_get::<String, _>("state")?)?,
                    reason: row.try_get("reason")?,
                })
            })
            .collect()
    }

    /// What `View (previous)/` holds that still waits for review or was
    /// kept, relative to the Project folder.
    ///
    /// # Errors
    /// `PersistenceFailure` for a corrupt record.
    pub async fn previous_items(&self, project_id: Uuid) -> Result<Vec<PreviousItem>> {
        let mut conn = self.reader().await?;
        read_leftovers(&mut conn, project_id).await
    }

    /// Record the user's review of one leftover (D-W110). A kept file is
    /// never asked about again; it may still be moved or trashed.
    ///
    /// # Errors
    /// `NotFound` for an unknown leftover; `InvalidInput` for a review the
    /// leftover can't take.
    pub async fn review_previous_item(
        &self,
        project_id: Uuid,
        path: &NativePath,
        review: PreviousItemReview,
    ) -> Result<()> {
        write_txn!(self, |conn| {
            let current: Option<String> = sqlx::query_scalar(
                "SELECT review FROM view_previous_items WHERE project_id = ?1 AND path_key = ?2",
            )
            .bind(project_id.to_string())
            .bind(path_key(path))
            .fetch_optional(&mut *conn)
            .await?;
            let current: PreviousItemReview =
                from_text(&current.ok_or_else(|| {
                    LibraryError::NotFound(format!("leftover {}", path.display()))
                })?)?;
            if !current.can_become(review) {
                return Err(LibraryError::InvalidInput(format!(
                    "{} was already reviewed ({current:?}); it can't become {review:?}",
                    path.display()
                )));
            }
            sqlx::query(
                "UPDATE view_previous_items SET review = ?3, reviewed_at = ?4 \
                 WHERE project_id = ?1 AND path_key = ?2",
            )
            .bind(project_id.to_string())
            .bind(path_key(path))
            .bind(to_text(&review)?)
            .bind(now()?)
            .execute(&mut *conn)
            .await?;
        });
        Ok(())
    }

    /// `View (previous)/` is gone: its manifest retires.
    ///
    /// # Errors
    /// `PersistenceFailure` for a state the schema refuses.
    pub async fn retire_previous_view(&self, project_id: Uuid) -> Result<()> {
        write_txn!(self, |conn| retire_previous(conn, project_id).await?);
        Ok(())
    }
}

// ── Inputs ───────────────────────────────────────────────────────────────────

/// The Project row's View settings.
struct ProjectRow {
    name: String,
    lifecycle: ProjectLifecycle,
    desired_revision: Revision,
    mode: ViewMode,
    keywords: GroupKeywords,
    parent: Option<NativePath>,
}

async fn read_project(conn: &mut SqliteConnection, project_id: Uuid) -> Result<ProjectRow> {
    let row = sqlx::query(
        "SELECT name, lifecycle, revision, view_mode, group_keyword, panel_keyword, \
         processing_parent FROM projects WHERE id = ?1",
    )
    .bind(project_id.to_string())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| LibraryError::NotFound(format!("project {project_id}")))?;
    let keywords = match (
        row.try_get::<Option<String>, _>("group_keyword")?,
        row.try_get::<Option<String>, _>("panel_keyword")?,
    ) {
        (Some(group), Some(panel)) => GroupKeywords::new(&group, &panel)?,
        _ => settings_keywords(conn).await?,
    };
    Ok(ProjectRow {
        name: row.try_get("name")?,
        lifecycle: from_text(&row.try_get::<String, _>("lifecycle")?)?,
        desired_revision: revision(row.try_get("revision")?)?,
        mode: from_text(&row.try_get::<String, _>("view_mode")?)?,
        keywords,
        parent: row
            .try_get::<Option<String>, _>("processing_parent")?
            .map(|parent| from_json::<NativePath>(&parent))
            .transpose()?,
    })
}

/// The basis of what the Project holds, with each session's representative
/// light metadata and the sessions whose calibration isn't settled; every
/// source it names goes into `relative`.
struct HeldBasis {
    groups: Vec<BasisGroup>,
    metadata: BTreeMap<Uuid, CaptureMetadata>,
    unsettled: Vec<(Uuid, Vec<InputKind>)>,
}

async fn held_basis(
    conn: &mut SqliteConnection,
    project_id: Uuid,
    relative: &mut Relative,
) -> Result<HeldBasis> {
    let mut held = Held::read(conn, project_id).await?;
    let mut basis =
        HeldBasis { groups: Vec::new(), metadata: BTreeMap::new(), unsettled: Vec::new() };
    for (id, name, panel, rig_id) in std::mem::take(&mut held.groups) {
        let mut sessions = Vec::new();
        for (session_id, night) in held.sessions.remove(&id).unwrap_or_default() {
            let calibration = admission::read_calibration(conn, session_id).await?;
            let Some(settled) = calibration.settled() else {
                basis.unsettled.push((session_id, calibration.unsettled_kinds()));
                continue;
            };
            let captures = held.captures.remove(&session_id).unwrap_or_default();
            let live: Vec<&Asset> = captures
                .iter()
                .filter(|capture| capture.included)
                .flat_map(|capture| &capture.copies)
                .filter_map(|copy| held.live.get(&copy.asset_id))
                .collect();
            if let Some(first) = live.first() {
                basis.metadata.insert(session_id, first.effective.clone());
            }
            for asset in captures
                .iter()
                .flat_map(|capture| &capture.copies)
                .filter_map(|copy| held.live.get(&copy.asset_id))
            {
                relative.insert(asset.id, (asset.location_id, asset.relative_path.clone()));
            }
            for pin in [&settled.dark, &settled.flat, &settled.bias] {
                pin_sources(conn, pin, relative).await?;
            }
            sessions.push(BasisSession { session_id, night, captures, calibration: settled });
        }
        basis.groups.push(BasisGroup { id, name, panel, rig_id, sessions });
    }
    Ok(basis)
}

/// Each source's absolute path, with the locations they are on.
async fn resolve_sources(
    conn: &mut SqliteConnection,
    relative: Relative,
) -> Result<(BTreeMap<Uuid, SourcePath>, BTreeMap<Uuid, Location>)> {
    let mut locations: BTreeMap<Uuid, Location> = BTreeMap::new();
    let mut sources = BTreeMap::new();
    for (id, (location_id, path)) in relative {
        let root = match locations.entry(location_id) {
            std::collections::btree_map::Entry::Occupied(known) => known.into_mut(),
            std::collections::btree_map::Entry::Vacant(free) => {
                free.insert(load_location(conn, location_id).await?)
            }
        };
        sources.insert(id, SourcePath { location_id, path: joined(&root.path, &path)? });
    }
    Ok((sources, locations))
}

/// The `View (building)/` identity the Project's last failed Apply recorded.
async fn failed_building(
    conn: &mut SqliteConnection,
    project_id: Uuid,
) -> Result<Option<FileIdentity>> {
    let expected: Option<String> = sqlx::query_scalar(
        "SELECT expected FROM apply_operations WHERE project_id = ?1 AND outcome = 'failed' \
         ORDER BY updated_at DESC, generation DESC LIMIT 1",
    )
    .bind(project_id.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    Ok(expected
        .map(|text| from_json::<ExpectedTree>(&text))
        .transpose()?
        .and_then(|expected| expected.building))
}

async fn read_inputs(conn: &mut SqliteConnection, project_id: Uuid) -> Result<ApplyInputs> {
    let project = read_project(conn, project_id).await?;
    let mut relative = Relative::new();
    let held = held_basis(conn, project_id, &mut relative).await?;
    let basis =
        ProjectBasis { mode: project.mode, keywords: project.keywords, groups: held.groups };
    basis.validate()?;
    let installed = read_manifest_in(conn, project_id, "installed").await?;
    let previous = read_manifest_in(conn, project_id, "previous").await?;
    for manifest in installed.iter().chain(&previous) {
        manifest_sources(conn, manifest, &mut relative).await?;
    }
    let (sources, locations) = resolve_sources(conn, relative).await?;
    let names = read_names(conn, project_id).await?;
    let basis_digest = digest(&Digested {
        desired_revision: project.desired_revision,
        applied_generation: installed.as_ref().map(|manifest| manifest.generation),
        name: &project.name,
        parent: project.parent.as_ref(),
        basis: &basis,
        names: names.iter().collect(),
    })?;
    Ok(ApplyInputs {
        project_id,
        name: project.name,
        lifecycle: project.lifecycle,
        desired_revision: project.desired_revision,
        parent: project.parent,
        basis,
        basis_digest,
        unsettled: held.unsettled,
        metadata: held.metadata,
        sources,
        locations,
        names,
        installed,
        previous,
        leftovers: read_leftovers(conn, project_id).await?,
        running: project_operations::active_operation(conn, project_id).await?,
        failed_building: failed_building(conn, project_id).await?,
    })
}

/// The Settings keyword names, or the defaults with no Settings row.
async fn settings_keywords(conn: &mut SqliteConnection) -> Result<GroupKeywords> {
    let settings: Option<String> =
        sqlx::query_scalar("SELECT settings FROM workflow_settings WHERE id = 1")
            .fetch_optional(&mut *conn)
            .await?;
    Ok(settings
        .map(|text| from_json::<WorkflowSettings>(&text))
        .transpose()?
        .map(|settings| settings.keywords)
        .unwrap_or_default())
}

/// What a Project holds, before calibration is read.
struct Held {
    /// (id, name, panel, rig) in position order.
    groups: Vec<(Uuid, GroupName, bool, Uuid)>,
    /// Each group's sessions with their nights.
    sessions: BTreeMap<Uuid, Vec<(Uuid, Option<Date>)>>,
    /// Each session's captures, inclusion resolved against the live Library.
    captures: BTreeMap<Uuid, Vec<BasisCapture>>,
    /// Every held copy that is neither Trashed nor retired.
    live: BTreeMap<Uuid, Asset>,
}

impl Held {
    async fn read(conn: &mut SqliteConnection, project_id: Uuid) -> Result<Self> {
        let project = project_id.to_string();
        let mut groups = Vec::new();
        for row in sqlx::query(
            "SELECT id, name, panel, rig_id FROM project_groups WHERE project_id = ?1 \
             ORDER BY position, id",
        )
        .bind(&project)
        .fetch_all(&mut *conn)
        .await?
        {
            groups.push((
                parse_uuid(&row.try_get::<String, _>("id")?)?,
                GroupName::new(&row.try_get::<String, _>("name")?)?,
                row.try_get::<i64, _>("panel")? == 1,
                parse_uuid(&row.try_get::<String, _>("rig_id")?)?,
            ));
        }
        let mut sessions: BTreeMap<Uuid, Vec<(Uuid, Option<Date>)>> = BTreeMap::new();
        for row in sqlx::query(
            "SELECT ps.session_id, ps.group_id, s.capture_key FROM project_sessions ps \
             JOIN sessions s ON s.id = ps.session_id WHERE ps.project_id = ?1 \
             ORDER BY ps.session_id",
        )
        .bind(&project)
        .fetch_all(&mut *conn)
        .await?
        {
            let key = CaptureKey(row.try_get("capture_key")?);
            sessions
                .entry(parse_uuid(&row.try_get::<String, _>("group_id")?)?)
                .or_default()
                .push((parse_uuid(&row.try_get::<String, _>("session_id")?)?, night_of(&key)));
        }
        let mut copies: BTreeMap<Uuid, Vec<CopyBasis>> = BTreeMap::new();
        for row in sqlx::query(
            "SELECT capture_key, asset_id, decision_revision, fingerprint \
             FROM project_capture_copies WHERE project_id = ?1 ORDER BY capture_key, asset_id",
        )
        .bind(&project)
        .fetch_all(&mut *conn)
        .await?
        {
            copies.entry(parse_uuid(&row.try_get::<String, _>("capture_key")?)?).or_default().push(
                CopyBasis {
                    asset_id: parse_uuid(&row.try_get::<String, _>("asset_id")?)?,
                    decision_revision: revision(row.try_get("decision_revision")?)?,
                    fingerprint: from_json(&row.try_get::<String, _>("fingerprint")?)?,
                },
            );
        }
        let ids: BTreeSet<Uuid> = copies.values().flatten().map(|copy| copy.asset_id).collect();
        let live: BTreeMap<Uuid, Asset> = load_assets(conn, &ids)
            .await?
            .into_iter()
            .filter(|asset| {
                !matches!(asset.availability, Availability::Trashed | Availability::Retired)
            })
            .map(|asset| (asset.id, asset))
            .collect();
        let mut captures: BTreeMap<Uuid, Vec<BasisCapture>> = BTreeMap::new();
        for row in sqlx::query(
            "SELECT capture_key, session_id, basis FROM project_captures WHERE project_id = ?1 \
             ORDER BY capture_key",
        )
        .bind(&project)
        .fetch_all(&mut *conn)
        .await?
        {
            let capture_key = parse_uuid(&row.try_get::<String, _>("capture_key")?)?;
            let session_id = parse_uuid(&row.try_get::<String, _>("session_id")?)?;
            let copies = copies.remove(&capture_key).unwrap_or_default();
            let assets: Vec<&Asset> =
                copies.iter().filter_map(|copy| live.get(&copy.asset_id)).collect();
            let included = included(&row.try_get::<String, _>("basis")?, &assets);
            captures.entry(session_id).or_default().push(BasisCapture {
                capture_key,
                included,
                copies,
            });
        }
        Ok(Self { groups, sessions, captures, live })
    }
}

/// Whether a held capture enters the next build: an explicit choice holds;
/// one added Usable leaves when the Library rejects it, one added Unusable
/// joins when the Library restores it; a capture with no live copy never
/// does (VSEL-FR-15, D-W109).
fn included(basis: &str, live_copies: &[&Asset]) -> bool {
    if live_copies.is_empty() {
        return false;
    }
    let usable = logical_quality(live_copies) == ApplicableQuality::Usable;
    match basis {
        "explicit" => true,
        "usable" | "unusable" => usable,
        _ => false,
    }
}

/// The calendar date of a session key's `night=YYYY-MM-DD@basis`.
fn night_of(key: &CaptureKey) -> Option<Date> {
    let night = calibration::night_of(key)?;
    let date = night.split('@').next()?;
    Date::parse(date, time::macros::format_description!("[year]-[month]-[day]")).ok()
}

/// Each source's location and its path relative to the location root, by
/// asset or master id, until the roots are joined.
type Relative = BTreeMap<Uuid, (Uuid, NativePath)>;

/// The current paths of a pin's files: raw set frames that are neither
/// Trashed nor retired, or the master's one file.
async fn pin_sources(
    conn: &mut SqliteConnection,
    pin: &SettledPin,
    sources: &mut Relative,
) -> Result<()> {
    let Some(target) = pin.target() else { return Ok(()) };
    match target.input {
        InputRef::Master { master_id, .. } => master_source(conn, master_id, sources).await,
        InputRef::RawSet { .. } => {
            let ids: BTreeSet<Uuid> =
                target.files.iter().filter_map(|file| file.asset_id).collect();
            asset_sources(conn, &ids, sources).await
        }
    }
}

async fn asset_sources(
    conn: &mut SqliteConnection,
    ids: &BTreeSet<Uuid>,
    sources: &mut Relative,
) -> Result<()> {
    let missing: BTreeSet<Uuid> =
        ids.iter().filter(|id| !sources.contains_key(id)).copied().collect();
    if missing.is_empty() {
        return Ok(());
    }
    for asset in load_assets(conn, &missing).await? {
        if !matches!(asset.availability, Availability::Trashed | Availability::Retired) {
            sources.insert(asset.id, (asset.location_id, asset.relative_path));
        }
    }
    Ok(())
}

async fn master_source(
    conn: &mut SqliteConnection,
    master_id: Uuid,
    sources: &mut Relative,
) -> Result<()> {
    if sources.contains_key(&master_id) {
        return Ok(());
    }
    let row = sqlx::query("SELECT location_id, path_key FROM adopted_masters WHERE id = ?1")
        .bind(master_id.to_string())
        .fetch_optional(&mut *conn)
        .await?;
    if let Some(row) = row {
        let location_id = parse_uuid(&row.try_get::<String, _>("location_id")?)?;
        let relative = path_from_key(&row.try_get::<Vec<u8>, _>("path_key")?)?;
        sources.insert(master_id, (location_id, relative));
    }
    Ok(())
}

async fn manifest_sources(
    conn: &mut SqliteConnection,
    manifest: &ViewManifest,
    sources: &mut Relative,
) -> Result<()> {
    let mut assets = BTreeSet::new();
    for entry in &manifest.entries {
        match entry.source {
            EntrySource::Light { asset_id, .. }
            | EntrySource::CalibrationFrame { asset_id, .. } => {
                assets.insert(asset_id);
            }
            EntrySource::Master { master_id, .. } => {
                master_source(conn, master_id, sources).await?;
            }
        }
    }
    asset_sources(conn, &assets, sources).await
}

fn joined(root: &NativePath, relative: &NativePath) -> Result<NativePath> {
    Ok(NativePath::from_path(&root.to_path_buf()?.join(relative.relative_path()?)))
}

async fn read_names(
    conn: &mut SqliteConnection,
    project_id: Uuid,
) -> Result<BTreeMap<EntryInput, String>> {
    let rows = sqlx::query(
        "SELECT input, input_id, basename FROM project_entry_names WHERE project_id = ?1",
    )
    .bind(project_id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    let mut names = BTreeMap::new();
    for row in rows {
        let id = parse_uuid(&row.try_get::<String, _>("input_id")?)?;
        let input = match row.try_get::<String, _>("input")?.as_str() {
            "capture" => EntryInput::Capture { capture_key: id },
            "calibration_frame" => EntryInput::CalibrationFrame { asset_id: id },
            "master" => EntryInput::Master { master_id: id },
            other => {
                return Err(LibraryError::PersistenceFailure(format!(
                    "corrupt entry input {other}"
                )))
            }
        };
        names.insert(input, row.try_get("basename")?);
    }
    Ok(names)
}

/// The id an entry name is reserved under and the stored input name.
fn name_key(input: EntryInput) -> (&'static str, Uuid) {
    match input {
        EntryInput::Capture { capture_key } => ("capture", capture_key),
        EntryInput::CalibrationFrame { asset_id } => ("calibration_frame", asset_id),
        EntryInput::Master { master_id } => ("master", master_id),
    }
}

async fn read_leftovers(
    conn: &mut SqliteConnection,
    project_id: Uuid,
) -> Result<Vec<PreviousItem>> {
    let rows = sqlx::query(
        "SELECT path_key, reason, evidence, review FROM view_previous_items \
         WHERE project_id = ?1 AND review IN ('pending', 'kept') ORDER BY path_key",
    )
    .bind(project_id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(PreviousItem {
                path: path_from_key(&row.try_get::<Vec<u8>, _>("path_key")?)?,
                reason: from_text::<PreviousItemReason>(&row.try_get::<String, _>("reason")?)?,
                evidence: from_json::<EntryEvidence>(&row.try_get::<String, _>("evidence")?)?,
                review: from_text(&row.try_get::<String, _>("review")?)?,
            })
        })
        .collect()
}

async fn read_manifest_in(
    conn: &mut SqliteConnection,
    project_id: Uuid,
    state: &str,
) -> Result<Option<ViewManifest>> {
    let generation: Option<i64> = sqlx::query_scalar(
        "SELECT generation FROM view_manifests WHERE project_id = ?1 AND state = ?2",
    )
    .bind(project_id.to_string())
    .bind(state)
    .fetch_optional(&mut *conn)
    .await?;
    match generation {
        Some(generation) => Ok(Some(read_manifest(conn, project_id, revision(generation)?).await?)),
        None => Ok(None),
    }
}

async fn read_manifest(
    conn: &mut SqliteConnection,
    project_id: Uuid,
    generation: Revision,
) -> Result<ViewManifest> {
    let row = sqlx::query(
        "SELECT state, operation_id, desired_revision, basis FROM view_manifests \
         WHERE project_id = ?1 AND generation = ?2",
    )
    .bind(project_id.to_string())
    .bind(generation_value(generation)?)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| LibraryError::NotFound(format!("View {generation} of project {project_id}")))?;
    let entries: Vec<String> = sqlx::query_scalar(
        "SELECT entry FROM view_manifest_entries WHERE project_id = ?1 AND generation = ?2 \
         ORDER BY seq",
    )
    .bind(project_id.to_string())
    .bind(generation_value(generation)?)
    .fetch_all(&mut *conn)
    .await?;
    Ok(ViewManifest {
        project_id,
        generation,
        state: from_text::<ManifestState>(&row.try_get::<String, _>("state")?)?,
        operation_id: parse_uuid(&row.try_get::<String, _>("operation_id")?)?,
        desired_revision: revision(row.try_get("desired_revision")?)?,
        basis: from_json(&row.try_get::<String, _>("basis")?)?,
        entries: entries.iter().map(|entry| from_json(entry)).collect::<Result<_>>()?,
    })
}

async fn read_journal(conn: &mut SqliteConnection, operation_id: Uuid) -> Result<ApplyJournal> {
    let row = sqlx::query(
        "SELECT project_id, generation, phase, settled_from, outcome, expected, error \
         FROM apply_operations WHERE operation_id = ?1",
    )
    .bind(operation_id.to_string())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| LibraryError::NotFound(format!("Apply {operation_id}")))?;
    Ok(ApplyJournal {
        operation_id,
        project_id: parse_uuid(&row.try_get::<String, _>("project_id")?)?,
        generation: revision(row.try_get("generation")?)?,
        phase: from_text(&row.try_get::<String, _>("phase")?)?,
        settled_from: row
            .try_get::<Option<String>, _>("settled_from")?
            .map(|text| from_text(&text))
            .transpose()?,
        outcome: row
            .try_get::<Option<String>, _>("outcome")?
            .map(|text| from_text(&text))
            .transpose()?,
        expected: from_json(&row.try_get::<String, _>("expected")?)?,
        error: row.try_get("error")?,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Digested<'a> {
    desired_revision: Revision,
    applied_generation: Option<Revision>,
    name: &'a str,
    parent: Option<&'a NativePath>,
    basis: &'a ProjectBasis,
    names: Vec<(&'a EntryInput, &'a String)>,
}

fn digest(value: &Digested<'_>) -> Result<String> {
    Ok(hex::encode(Sha256::digest(to_json(value)?.as_bytes())))
}

// ── Writes ───────────────────────────────────────────────────────────────────

fn generation_value(generation: Revision) -> Result<i64> {
    i64::try_from(generation)
        .map_err(|_| LibraryError::InvalidInput(format!("generation {generation} is too large")))
}

async fn reserve(
    conn: &mut SqliteConnection,
    reservation: &ApplyReservation<'_>,
) -> Result<ApplyReserved> {
    let project_id = reservation.project_id;
    let inputs = read_inputs(conn, project_id).await?;
    if inputs.desired_revision != reservation.desired_revision
        || inputs.basis_digest != reservation.basis_digest
    {
        return Err(LibraryError::Conflict {
            id: project_id,
            current: inputs.desired_revision,
            successors: Vec::new(),
        });
    }
    let operation =
        project_operations::reserve_operation(conn, project_id, ProjectOperationKind::Apply)
            .await?;
    let project = project_id.to_string();
    let at = now()?;
    if reservation.previous_gone {
        sqlx::query(
            "UPDATE view_previous_items SET review = 'moved' WHERE project_id = ?1 \
             AND review = 'kept'",
        )
        .bind(&project)
        .execute(&mut *conn)
        .await?;
        retire_previous(conn, project_id).await?;
    }
    let last: Option<i64> =
        sqlx::query_scalar("SELECT max(generation) FROM view_manifests WHERE project_id = ?1")
            .bind(&project)
            .fetch_one(&mut *conn)
            .await?;
    let generation = revision(last.unwrap_or(0))? + 1;
    sqlx::query(
        "INSERT INTO view_manifests (project_id, generation, state, operation_id, \
         desired_revision, mode, basis, created_at) VALUES (?1, ?2, 'building', ?3, ?4, ?5, ?6, ?7)",
    )
    .bind(&project)
    .bind(generation_value(generation)?)
    .bind(operation.id.to_string())
    .bind(generation_value(inputs.desired_revision)?)
    .bind(to_text(&inputs.basis.mode)?)
    .bind(to_json(&inputs.basis)?)
    .bind(&at)
    .execute(&mut *conn)
    .await?;
    for name in reservation.names {
        if inputs.names.contains_key(&name.input) {
            return Err(LibraryError::Conflict {
                id: project_id,
                current: inputs.desired_revision,
                successors: Vec::new(),
            });
        }
        let (input, id) = name_key(name.input);
        sqlx::query(
            "INSERT INTO project_entry_names (project_id, input, input_id, basename, reserved_at) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(&project)
        .bind(input)
        .bind(id.to_string())
        .bind(&name.basename)
        .bind(&at)
        .execute(&mut *conn)
        .await?;
    }
    sqlx::query(
        "INSERT INTO apply_operations (operation_id, project_id, generation, phase, expected, \
         updated_at) VALUES (?1, ?2, ?3, 'reserved', ?4, ?5)",
    )
    .bind(operation.id.to_string())
    .bind(&project)
    .bind(generation_value(generation)?)
    .bind(to_json(reservation.expected)?)
    .bind(&at)
    .execute(&mut *conn)
    .await?;
    Ok(ApplyReserved { operation_id: operation.id, generation })
}

async fn advance(
    conn: &mut SqliteConnection,
    operation_id: Uuid,
    phase: ApplyPhase,
    expected: Option<&ExpectedTree>,
) -> Result<()> {
    let expected = expected.map(to_json).transpose()?;
    let updated = sqlx::query(
        "UPDATE apply_operations SET phase = ?2, expected = coalesce(?3, expected), \
         updated_at = ?4 WHERE operation_id = ?1",
    )
    .bind(operation_id.to_string())
    .bind(to_text(&phase)?)
    .bind(expected)
    .bind(now()?)
    .execute(&mut *conn)
    .await?;
    if updated.rows_affected() == 1 {
        Ok(())
    } else {
        Err(LibraryError::NotFound(format!("Apply {operation_id}")))
    }
}

async fn settle_journal(
    conn: &mut SqliteConnection,
    operation_id: Uuid,
    outcome: ApplyOutcome,
    error: Option<&str>,
) -> Result<()> {
    sqlx::query(
        "UPDATE apply_operations SET settled_from = phase, phase = 'settled', outcome = ?2, \
         error = ?3, updated_at = ?4 WHERE operation_id = ?1 AND phase <> 'settled'",
    )
    .bind(operation_id.to_string())
    .bind(to_text(&outcome)?)
    .bind(error)
    .bind(now()?)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn set_manifest_state(
    conn: &mut SqliteConnection,
    project_id: Uuid,
    generation: Revision,
    state: &str,
    installed_at: Option<&str>,
) -> Result<()> {
    sqlx::query(
        "UPDATE view_manifests SET state = ?3, installed_at = coalesce(installed_at, ?4) \
         WHERE project_id = ?1 AND generation = ?2",
    )
    .bind(project_id.to_string())
    .bind(generation_value(generation)?)
    .bind(state)
    .bind(installed_at)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn retire_previous(conn: &mut SqliteConnection, project_id: Uuid) -> Result<()> {
    sqlx::query(
        "UPDATE view_manifests SET state = 'retired' WHERE project_id = ?1 AND state = 'previous'",
    )
    .bind(project_id.to_string())
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn insert_entries(
    conn: &mut SqliteConnection,
    project_id: Uuid,
    generation: Revision,
    entries: &[ManifestEntry],
) -> Result<()> {
    for entry in entries {
        let (input, capture_key, asset_id, master_id) = match entry.source {
            EntrySource::Light { capture_key, asset_id } => {
                ("light".to_owned(), Some(capture_key), Some(asset_id), None)
            }
            EntrySource::CalibrationFrame { kind, asset_id, .. } => {
                (to_text(&kind)?, None, Some(asset_id), None)
            }
            EntrySource::Master { kind, master_id, .. } => {
                (to_text(&kind)?, None, None, Some(master_id))
            }
        };
        let placement = match entry.placement {
            EntryPlacement::Symlink => "symlink",
            EntryPlacement::Copy => "copy",
            EntryPlacement::Clone => "clone",
        };
        sqlx::query(
            "INSERT INTO view_manifest_entries (project_id, generation, seq, path_key, input, \
             placement, capture_key, asset_id, master_id, group_id, source_sha256, entry) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        )
        .bind(project_id.to_string())
        .bind(generation_value(generation)?)
        .bind(i64::from(entry.seq))
        .bind(path_key(&entry.path))
        .bind(input)
        .bind(placement)
        .bind(capture_key.map(|id| id.to_string()))
        .bind(asset_id.map(|id| id.to_string()))
        .bind(master_id.map(|id| id.to_string()))
        .bind(entry.group_id.map(|id| id.to_string()))
        .bind(&entry.source_sha256)
        .bind(to_json(entry)?)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

async fn insert_foreign(
    conn: &mut SqliteConnection,
    operation_id: Uuid,
    item: &ForeignItem,
) -> Result<()> {
    item.validate()?;
    sqlx::query(
        "INSERT INTO apply_foreign_items (operation_id, seq, path_key, evidence, ticked, state, \
         reason) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )
    .bind(operation_id.to_string())
    .bind(i64::from(item.seq))
    .bind(path_key(&item.path))
    .bind(to_json(&item.evidence)?)
    .bind(i64::from(item.ticked))
    .bind(to_text(&item.state)?)
    .bind(item.reason.as_deref())
    .execute(&mut *conn)
    .await?;
    Ok(())
}
