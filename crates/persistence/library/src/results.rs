// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Results records (spec 070 RES-FR-01..05/08/10, VSEL-FR-05; D-W4, D-W51,
//! D-W56, D-W67, D-W72, D-W73) in the clean catalog: the files each owner's
//! recorded Results folder holds, attached products, acceptance bound to the
//! inspected digest, and accepted products used as inputs of another run.
//!
//! Filesystem work is the caller's: a rescan walks only the recorded Results
//! folder and hands its observations to [`Catalog::record_results_scan`];
//! attach, accept and input picks arrive hashed. Every write is one `BEGIN
//! IMMEDIATE` transaction that re-checks what the hash relied on, so a
//! refusal writes nothing. A Result belongs to the owner whose folder it was
//! written to, or the owner the user attached it to; no header, file name or
//! tool claim moves it, and nothing here records input-frame lineage.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};

use platevault_model::{
    AcceptOutcome, AcceptRefusal, AcceptedResult, Availability, CaptureMetadata, Classification,
    LibraryError, LifecycleBlocker, NativePath, NewView, ObservationFingerprint, ProductInput,
    ProfileKind, ResultAcceptance, ResultAssociation, ResultKind, ResultLineage, ResultOwner,
    ResultProvenance, ResultRecord, ResultState, ResultsListing, RevisionAttribution, View,
    ViewRecord,
};
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::calibration::{offer_master, open_offers};
use super::prepare::{load_assembled_folder, load_recorded_folders, load_results_folder};
use super::views::{insert_view, load_record, load_view, require_live, require_open};
use super::{from_json, from_text, now, parse_uuid, to_json, to_text, Catalog, Result};

fn invalid(message: impl Into<String>) -> LibraryError {
    LibraryError::InvalidInput(message.into())
}

fn corrupt(what: &str) -> LibraryError {
    LibraryError::PersistenceFailure(format!("corrupt result record: {what}"))
}

/// A Result row's columns, then `$tail`.
macro_rules! result_sql {
    ($tail:literal) => {
        concat!(
            "SELECT r.id, r.view_id, r.group_id, r.path, r.kind, r.availability, r.state, ",
            "r.association, r.attribution, r.sha256, r.fingerprint, r.accepted_sha256, ",
            "r.accepted_fingerprint, r.accepted_at, r.discovered_at, r.updated_at ",
            "FROM result_candidates r ",
            $tail
        )
    };
}

/// A Result row with where it comes from (`o_` columns), from `$from` (which
/// names `result_candidates r`), then `$tail`. A run's name is its latest
/// revision's, else its draft's; a group Result's owner is the group.
macro_rules! provenance_sql {
    ($select:literal, $from:literal, $tail:literal) => {
        concat!(
            "SELECT r.id, r.view_id, r.group_id, r.path, r.kind, r.availability, r.state, ",
            "r.association, r.attribution, r.sha256, r.fingerprint, r.accepted_sha256, ",
            "r.accepted_fingerprint, r.accepted_at, r.discovered_at, r.updated_at, ",
            $select,
            "p.id AS o_project_id, p.name AS o_project_name, ",
            "s.id AS o_subject_id, coalesce(s.name, t.designation) AS o_subject_name, ",
            "t.id AS o_target_id, e.id AS o_rig_id, e.name AS o_rig_name, ",
            "coalesce(c.name, d.name, g.name) AS o_owner_name ",
            $from,
            "LEFT JOIN views v ON v.id = r.view_id ",
            "LEFT JOIN view_groups g ON g.id = r.group_id ",
            "JOIN projects p ON p.id = coalesce(v.project_id, g.project_id) ",
            "JOIN project_subjects s ON s.id = coalesce(v.subject_id, g.subject_id) ",
            "JOIN targets t ON t.id = s.target_id ",
            "JOIN equipment e ON e.id = coalesce(v.rig_id, g.rig_id) ",
            "LEFT JOIN view_revisions c ON c.view_id = v.id AND c.revision = v.revision ",
            "LEFT JOIN view_revisions d ON d.view_id = v.id AND d.state = 'draft' ",
            $tail
        )
    };
}

// ---------------------------------------------------------------------------
// Inputs of the catalog writes
// ---------------------------------------------------------------------------

/// What a rescan of one owner reads first, from one catalog snapshot.
#[derive(Clone, Debug)]
pub struct ResultsBasis {
    pub owner: ResultOwner,
    /// The recorded Results folder; `None` until the owner is prepared.
    pub folder: Option<NativePath>,
    /// The handoff profile whose recognizer applies; `None` before a run
    /// chose one.
    pub profile: Option<ProfileKind>,
    /// The owner is a panel run: its products are Mosaic panel products.
    pub panel_run: bool,
    pub records: Vec<ResultRecord>,
}

/// What one file read now.
#[derive(Clone, Debug)]
pub enum Observation {
    /// Readable; `sha256` is `None` when it was not hashed.
    Present { fingerprint: ObservationFingerprint, sha256: Option<String> },
    /// The file cannot be read now.
    Unavailable(Availability),
}

/// A generated master discovery found, with the evidence CAL offers it on.
#[derive(Clone, Debug)]
pub struct DetectedMaster {
    pub classification: Classification,
    pub observed: CaptureMetadata,
}

/// One file a rescan found below the Results folder: Pending, an
/// intermediate (never hashed) or a hashed candidate.
#[derive(Clone, Debug)]
pub struct ScannedResult {
    pub path: NativePath,
    pub state: ResultState,
    pub kind: Option<ResultKind>,
    pub fingerprint: ObservationFingerprint,
    pub sha256: Option<String>,
    pub attribution: RevisionAttribution,
    pub master: Option<DetectedMaster>,
}

/// One rescan of an owner's recorded Results folder.
#[derive(Clone, Debug)]
pub struct ResultsScan {
    pub owner: ResultOwner,
    pub folder: NativePath,
    /// How the folder itself read: Available when it was walked. Otherwise no
    /// record below it is removed and each reads this availability.
    pub folder_availability: Availability,
    pub files: Vec<ScannedResult>,
    /// Entries below the folder that could not be read; their records read
    /// Unreadable instead of Missing.
    pub unreadable: Vec<NativePath>,
    /// The owner's User-linked records, read at their own paths.
    pub linked: Vec<(Uuid, Observation)>,
}

/// A product to attach, hashed now (RES-FR-02).
#[derive(Clone, Debug)]
pub struct NewAttachment {
    pub owner: ResultOwner,
    pub path: NativePath,
    pub kind: ResultKind,
    pub fingerprint: ObservationFingerprint,
    pub sha256: String,
}

/// A product whose current bytes matched its inspected digest just now.
#[derive(Clone, Debug)]
pub struct VerifiedAcceptance {
    pub result_id: Uuid,
    pub sha256: String,
    pub fingerprint: ObservationFingerprint,
    pub kind: Option<ResultKind>,
}

/// An accepted product whose current bytes hashed to its acceptance digest
/// just now (RES-FR-05).
#[derive(Clone, Debug)]
pub struct VerifiedProduct {
    pub result_id: Uuid,
    pub sha256: String,
}

/// The shape of an owner, which decides the kinds its Results may take.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Shape {
    Run,
    PanelRun,
    Group,
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

impl Catalog {
    /// What a rescan of `owner` reads before walking: its recorded Results
    /// folder, its profile and its records. Read-only.
    ///
    /// # Errors
    /// `NotFound` for an unknown run or run group.
    pub async fn results_basis(&self, owner: ResultOwner) -> Result<ResultsBasis> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let shape = owner_shape(&mut snapshot, owner).await?.0;
        let folder = load_folder(&mut snapshot, owner).await?;
        let profile: Option<String> = match owner {
            ResultOwner::Run { view_id } => sqlx::query_scalar(
                "SELECT p.kind FROM views v JOIN profiles p ON p.id = v.profile_id \
                 WHERE v.id = ?1",
            )
            .bind(view_id.to_string()),
            ResultOwner::Group { group_id } => sqlx::query_scalar(
                "SELECT p.kind FROM view_groups g JOIN profiles p ON p.id = g.profile_id \
                 WHERE g.id = ?1",
            )
            .bind(group_id.to_string()),
        }
        .fetch_optional(&mut *snapshot)
        .await?;
        let records = owner_records(&mut snapshot, owner).await?;
        snapshot.rollback().await?;
        Ok(ResultsBasis {
            owner,
            folder,
            profile: profile.as_deref().map(from_text).transpose()?,
            panel_run: shape == Shape::PanelRun,
            records,
        })
    }

    /// Record one rescan of the owner's Results folder (RES-FR-01). A new
    /// file is recorded in its scanned state; an unaccepted record takes the
    /// new observation, kind and attribution; an accepted one only its
    /// current bytes, so drift shows and its acceptance stays as history. A
    /// record whose file is gone reads Missing, except a Pending one no master
    /// offer or product input names, which is forgotten. A generated master
    /// is offered once per file and digest (CAL-FR-06).
    ///
    /// # Errors
    /// `InvalidInput` for a run in the Project's Trash or a folder that is no
    /// longer the owner's recorded Results folder; `NotFound` for an unknown
    /// owner.
    pub async fn record_results_scan(&self, scan: &ResultsScan) -> Result<ResultsListing> {
        let at = now()?;
        let unreadable =
            scan.unreadable.iter().map(NativePath::to_path_buf).collect::<Result<Vec<_>>>()?;
        write_txn!(self, |conn| {
            owner_shape(conn, scan.owner).await?;
            if load_folder(conn, scan.owner).await?.as_ref() != Some(&scan.folder) {
                return Err(invalid(format!(
                    "{} no longer records {} as its Results folder; rescan",
                    scan.owner,
                    scan.folder.display()
                )));
            }
            let records: HashMap<NativePath, ResultRecord> = owner_records(conn, scan.owner)
                .await?
                .into_iter()
                .map(|record| (record.path.clone(), record))
                .collect();
            let mut seen = BTreeSet::new();
            for file in &scan.files {
                seen.insert(file.path.clone());
                record_scanned(conn, scan.owner, records.get(&file.path), file, &at).await?;
            }
            for record in records.values() {
                if record.association != ResultAssociation::UserLinked
                    && !seen.contains(&record.path)
                {
                    settle_unseen(conn, scan, &unreadable, record, &at).await?;
                }
            }
            for (id, observation) in &scan.linked {
                if records.values().any(|record| record.id == *id) {
                    observe(conn, *id, observation, &at).await?;
                }
            }
            listing(conn, scan.owner).await
        })
    }

    /// The Results step of `owner` as last scanned: candidates (Pending,
    /// discovered, attached and accepted), intermediates apart, and the open
    /// master offers. Read-only.
    ///
    /// # Errors
    /// `NotFound` for an unknown owner.
    pub async fn results_listing(&self, owner: ResultOwner) -> Result<ResultsListing> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        owner_shape(&mut snapshot, owner).await?;
        let listing = listing(&mut snapshot, owner).await?;
        snapshot.rollback().await?;
        Ok(listing)
    }

    /// # Errors
    /// `NotFound` for an unknown Result.
    pub async fn result(&self, id: Uuid) -> Result<ResultRecord> {
        let mut conn = self.reader().await?;
        load_result(&mut conn, id).await
    }

    /// Record what reading Results at their own paths found: the current
    /// bytes of an accepted or attached product, or why it cannot be read.
    /// Acceptance and state never change here.
    ///
    /// # Errors
    /// `NotFound` for an unknown Result.
    pub async fn record_result_observations(
        &self,
        observations: &[(Uuid, Observation)],
    ) -> Result<()> {
        if observations.is_empty() {
            return Ok(());
        }
        let at = now()?;
        write_txn!(self, |conn| {
            for (id, observation) in observations {
                load_result(conn, *id).await?;
                observe(conn, *id, observation, &at).await?;
            }
        });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Attach and accept
// ---------------------------------------------------------------------------

impl Catalog {
    /// Attach a product from outside every Results and prepared folder to a
    /// run or run group (RES-FR-02/03): it is listed beside the discovered
    /// candidates, labelled attached, with a User-linked run association, no
    /// prepared revision and Unknown lineage.
    ///
    /// # Errors
    /// `InvalidInput` for a run in the Project's Trash, a file inside a
    /// recorded Results or prepared folder, a file already recorded as a
    /// Result, or a kind the owner cannot take; `NotFound` for an unknown
    /// owner.
    pub async fn attach_result(&self, attachment: &NewAttachment) -> Result<ResultRecord> {
        let at = now()?;
        let path = attachment.path.to_path_buf()?;
        write_txn!(self, |conn| {
            let (shape, _) = owner_shape(conn, attachment.owner).await?;
            require_kind(&attachment.kind, shape, None)?;
            if let Some(folder) = containing_folder(conn, &path).await? {
                return Err(invalid(format!(
                    "{} lies in the recorded folder {}; Results there are discovered, not \
                     attached",
                    path.display(),
                    folder.display()
                )));
            }
            if path_recorded(conn, &attachment.path).await? {
                return Err(invalid(format!("{} is already recorded as a Result", path.display())));
            }
            let id = Uuid::new_v4();
            let (view_id, group_id) = owner_columns(attachment.owner);
            sqlx::query(
                "INSERT INTO result_candidates (id, view_id, group_id, path, kind, availability, \
                 state, association, prepared_revision_id, attribution, sha256, fingerprint, \
                 discovered_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 'available', \
                 'attached', 'user_linked', NULL, ?6, ?7, ?8, ?9, ?9)",
            )
            .bind(id.to_string())
            .bind(view_id)
            .bind(group_id)
            .bind(to_json(&attachment.path)?)
            .bind(to_json(&attachment.kind)?)
            .bind(to_json(&RevisionAttribution::Unknown)?)
            .bind(&attachment.sha256)
            .bind(to_json(&attachment.fingerprint)?)
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            load_result(conn, id).await
        })
    }

    /// Accept products whose current bytes matched their inspected digest
    /// just now (RES-FR-04): each records that SHA-256 with its observation
    /// fingerprint and its kind, keeps its association and Unknown lineage,
    /// and is refused on its own when it was inspected again meanwhile, is
    /// Pending or an intermediate, or has no kind. Acceptance changes no run's
    /// status, membership or revision.
    ///
    /// # Errors
    /// `NotFound` for an unknown Result.
    pub async fn accept_results(&self, items: &[VerifiedAcceptance]) -> Result<AcceptOutcome> {
        let at = now()?;
        write_txn!(self, |conn| {
            let mut outcome = AcceptOutcome::default();
            for item in items {
                let record = load_result(conn, item.result_id).await?;
                let kind = match acceptable(conn, &record, item).await? {
                    Ok(kind) => kind,
                    Err(reason) => {
                        outcome.refused.push(AcceptRefusal { result_id: record.id, reason });
                        continue;
                    }
                };
                let unchanged = record.accepted.as_ref().is_some_and(|accepted| {
                    accepted.sha256 == item.sha256 && record.kind.as_ref() == Some(&kind)
                });
                if !unchanged {
                    sqlx::query(
                        "UPDATE result_candidates SET state = 'accepted', kind = ?2, \
                         availability = 'available', sha256 = ?3, fingerprint = ?4, \
                         accepted_sha256 = ?3, accepted_fingerprint = ?4, accepted_at = ?5, \
                         updated_at = ?5 WHERE id = ?1",
                    )
                    .bind(record.id.to_string())
                    .bind(to_json(&kind)?)
                    .bind(&item.sha256)
                    .bind(to_json(&item.fingerprint)?)
                    .bind(&at)
                    .execute(&mut *conn)
                    .await?;
                }
                outcome.accepted.push(load_result(conn, record.id).await?);
            }
            Ok(outcome)
        })
    }
}

// ---------------------------------------------------------------------------
// Results as inputs
// ---------------------------------------------------------------------------

impl Catalog {
    /// Accepted Results of runs and run groups outside the Project's Trash,
    /// from any Project and any rig, by originating Project, owner and path,
    /// optionally of one Project or one Target. Read-only; nothing is hashed.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn accepted_results(
        &self,
        project: Option<Uuid>,
        target: Option<Uuid>,
    ) -> Result<Vec<AcceptedResult>> {
        let mut conn = self.reader().await?;
        let rows = sqlx::query(provenance_sql!(
            "",
            "FROM result_candidates r ",
            "WHERE r.state = 'accepted' AND v.trashed_at IS NULL \
             AND (?1 IS NULL OR p.id = ?1) AND (?2 IS NULL OR t.id = ?2) \
             ORDER BY p.name, p.id, o_owner_name, r.view_id, r.group_id, r.path"
        ))
        .bind(project.map(|id| id.to_string()))
        .bind(target.map(|id| id.to_string()))
        .fetch_all(&mut *conn)
        .await?;
        rows.iter()
            .map(|row| {
                Ok(AcceptedResult { result: record_row(row)?, origin: provenance_row(row)? })
            })
            .collect()
    }

    /// Create a run (as [`Self::create_view`]) whose Results input filter
    /// picked `products` (RES-FR-05, VSEL-FR-05): each is recorded as a
    /// product input with the digest it hashed to, adding no member and no
    /// integration. Its draft selects no raw session, so saving it adds no raw
    /// session integration (RES-AC-04). Products of runs on another rig are
    /// inputs too.
    ///
    /// # Errors
    /// As [`Self::create_view`], and as [`Self::add_view_product_inputs`] for
    /// each product.
    pub async fn create_view_with_products(
        &self,
        input: &NewView,
        products: &[VerifiedProduct],
    ) -> Result<ViewRecord> {
        input.validate()?;
        require_products(products)?;
        let at = now()?;
        write_txn!(self, |conn| {
            let (view, _) = insert_view(conn, input).await?;
            insert_inputs(conn, &view, products, &at).await?;
            load_record(conn, view.id).await
        })
    }

    /// Add accepted products to an open run's inputs (Add accepted results).
    ///
    /// # Errors
    /// `InvalidInput` for a Complete run or one in the Project's Trash, no or
    /// repeated products, a Result that is not accepted, the run's own
    /// Result, one already an input, one of a run in the Project's Trash, or
    /// one whose acceptance digest is not the digest verified; `NotFound` for
    /// an unknown run or Result.
    pub async fn add_view_product_inputs(
        &self,
        view: Uuid,
        products: &[VerifiedProduct],
    ) -> Result<Vec<ProductInput>> {
        require_products(products)?;
        let at = now()?;
        write_txn!(self, |conn| {
            let view = load_view(conn, view).await?;
            require_open(&view)?;
            insert_inputs(conn, &view, products, &at).await?;
            product_inputs(conn, view.id).await
        })
    }

    /// The product inputs of a run with their originating runs, apart from
    /// its raw sessions. Read-only.
    ///
    /// # Errors
    /// `NotFound` for an unknown run.
    pub async fn view_product_inputs(&self, view: Uuid) -> Result<Vec<ProductInput>> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        load_view(&mut snapshot, view).await?;
        let inputs = product_inputs(&mut snapshot, view).await?;
        snapshot.rollback().await?;
        Ok(inputs)
    }

    /// The runs using one of `view`'s Results as an input, each naming the
    /// Result (RES-FR-10): they refuse Move run to Trash. Read-only.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn result_input_blockers(&self, view: Uuid) -> Result<Vec<LifecycleBlocker>> {
        let mut conn = self.reader().await?;
        input_blockers(&mut conn, view).await
    }
}

/// The runs using one of `view`'s Results as an input, each naming the
/// Result (RES-FR-10).
async fn input_blockers(conn: &mut SqliteConnection, view: Uuid) -> Result<Vec<LifecycleBlocker>> {
    let rows = sqlx::query(
        "SELECT r.id, r.path, i.view_id AS input_view, \
         coalesce(c.name, d.name) AS input_name FROM view_product_inputs i \
         JOIN result_candidates r ON r.id = i.result_id \
         JOIN views v ON v.id = i.view_id \
         LEFT JOIN view_revisions c ON c.view_id = v.id AND c.revision = v.revision \
         LEFT JOIN view_revisions d ON d.view_id = v.id AND d.state = 'draft' \
         WHERE r.view_id = ?1 AND i.view_id <> ?1 ORDER BY input_name, i.view_id, r.path",
    )
    .bind(view.to_string())
    .fetch_all(&mut *conn)
    .await?;
    rows.iter()
        .map(|row| {
            let path: NativePath = from_json(&row.try_get::<String, _>("path")?)?;
            Ok(LifecycleBlocker::ResultInput {
                result_id: parse_uuid(&row.try_get::<String, _>("id")?)?,
                result_name: file_name(&path),
                view_id: parse_uuid(&row.try_get::<String, _>("input_view")?)?,
                view_name: row.try_get::<Option<String>, _>("input_name")?.unwrap_or_default(),
            })
        })
        .collect()
}

/// Remove what Results recorded on never-saved run `view`, which leaves with
/// its draft: its product inputs, its own Results (attached ones, as it has
/// no Results folder before its first preparation) and their master offers.
/// The products its inputs name stay as they are. Refused while another run
/// uses one of its Results as an input, naming each (RES-FR-10).
pub async fn remove_unsaved_run_results(conn: &mut SqliteConnection, view: Uuid) -> Result<()> {
    let blockers = input_blockers(conn, view).await?;
    if !blockers.is_empty() {
        let named: Vec<String> = blockers.iter().map(ToString::to_string).collect();
        return Err(invalid(format!("run {view} cannot be discarded while {}", named.join("; "))));
    }
    for statement in [
        "DELETE FROM view_product_inputs WHERE view_id = ?1",
        "DELETE FROM master_offers WHERE view_id = ?1 \
         OR result_id IN (SELECT id FROM result_candidates WHERE view_id = ?1)",
        "DELETE FROM result_candidates WHERE view_id = ?1",
    ] {
        sqlx::query(statement).bind(view.to_string()).execute(&mut *conn).await?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// The owner's shape, refusing a run in the Project's Trash, with the run.
async fn owner_shape(
    conn: &mut SqliteConnection,
    owner: ResultOwner,
) -> Result<(Shape, Option<View>)> {
    match owner {
        ResultOwner::Run { view_id } => {
            let view = load_view(conn, view_id).await?;
            require_live(&view)?;
            let shape = if view.group_id.is_some() { Shape::PanelRun } else { Shape::Run };
            Ok((shape, Some(view)))
        }
        ResultOwner::Group { group_id } => {
            let found: Option<String> =
                sqlx::query_scalar("SELECT id FROM view_groups WHERE id = ?1")
                    .bind(group_id.to_string())
                    .fetch_optional(&mut *conn)
                    .await?;
            found.ok_or_else(|| LibraryError::NotFound(format!("run group {group_id}")))?;
            Ok((Shape::Group, None))
        }
    }
}

fn owner_columns(owner: ResultOwner) -> (Option<String>, Option<String>) {
    match owner {
        ResultOwner::Run { view_id } => (Some(view_id.to_string()), None),
        ResultOwner::Group { group_id } => (None, Some(group_id.to_string())),
    }
}

/// The owner's recorded Results folder: a run's or panel run's own, a run
/// group's `Assembled/`.
async fn load_folder(
    conn: &mut SqliteConnection,
    owner: ResultOwner,
) -> Result<Option<NativePath>> {
    match owner {
        ResultOwner::Run { view_id } => load_results_folder(conn, view_id).await,
        ResultOwner::Group { group_id } => load_assembled_folder(conn, group_id).await,
    }
}

async fn owner_records(
    conn: &mut SqliteConnection,
    owner: ResultOwner,
) -> Result<Vec<ResultRecord>> {
    let rows = match owner {
        ResultOwner::Run { view_id } => {
            sqlx::query(result_sql!("WHERE r.view_id = ?1 ORDER BY r.path, r.id"))
                .bind(view_id.to_string())
        }
        ResultOwner::Group { group_id } => {
            sqlx::query(result_sql!("WHERE r.group_id = ?1 ORDER BY r.path, r.id"))
                .bind(group_id.to_string())
        }
    }
    .fetch_all(&mut *conn)
    .await?;
    rows.iter().map(record_row).collect()
}

async fn listing(conn: &mut SqliteConnection, owner: ResultOwner) -> Result<ResultsListing> {
    let folder = load_folder(conn, owner).await?;
    let (intermediates, candidates): (Vec<_>, Vec<_>) = owner_records(conn, owner)
        .await?
        .into_iter()
        .partition(|record| record.state == ResultState::Intermediate);
    let offers = match owner {
        ResultOwner::Run { view_id } => open_offers(conn, view_id).await?,
        ResultOwner::Group { .. } => Vec::new(),
    };
    Ok(ResultsListing { owner, folder, candidates, intermediates, offers })
}

/// One file the rescan found: a recorded one takes the observation, a new
/// one is recorded, and a generated master of a run is offered once. A file
/// another owner attached, or one this owner attached, is left as it is.
async fn record_scanned(
    conn: &mut SqliteConnection,
    owner: ResultOwner,
    recorded: Option<&ResultRecord>,
    file: &ScannedResult,
    at: &str,
) -> Result<()> {
    let id = match recorded {
        Some(record) if record.association == ResultAssociation::UserLinked => return Ok(()),
        Some(record) => {
            update_scanned(conn, record, file, at).await?;
            record.id
        }
        None if path_recorded(conn, &file.path).await? => return Ok(()),
        None => insert_scanned(conn, owner, file, at).await?,
    };
    if let (Some(master), Some(sha256), ResultOwner::Run { view_id }) =
        (&file.master, &file.sha256, owner)
    {
        offer_master(conn, id, view_id, &file.path, sha256, master, at).await?;
    }
    Ok(())
}

/// A record whose file the rescan did not find: Unreadable below an entry
/// that could not be read, the folder's availability when the folder itself
/// could not be walked, else Missing. A Pending one that is gone is
/// forgotten unless a master offer or a product input names it: that one
/// reads Missing, so a dismissed offer stays dismissed for its file and
/// digest.
async fn settle_unseen(
    conn: &mut SqliteConnection,
    scan: &ResultsScan,
    unreadable: &[PathBuf],
    record: &ResultRecord,
    at: &str,
) -> Result<()> {
    let path = record.path.to_path_buf()?;
    let availability = if scan.folder_availability != Availability::Available {
        scan.folder_availability
    } else if unreadable.iter().any(|entry| path.starts_with(entry)) {
        Availability::Unreadable
    } else {
        Availability::Missing
    };
    if availability == Availability::Missing
        && record.state == ResultState::Pending
        && !referenced(conn, record.id).await?
    {
        sqlx::query("DELETE FROM result_candidates WHERE id = ?1")
            .bind(record.id.to_string())
            .execute(&mut *conn)
            .await?;
        return Ok(());
    }
    set_availability(conn, record.id, availability, at).await
}

/// Whether a master offer or a product input names Result `id`.
async fn referenced(conn: &mut SqliteConnection, id: Uuid) -> Result<bool> {
    let found: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM master_offers WHERE result_id = ?1 \
         UNION ALL SELECT 1 FROM view_product_inputs WHERE result_id = ?1 LIMIT 1",
    )
    .bind(id.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    Ok(found.is_some())
}

pub async fn load_result(conn: &mut SqliteConnection, id: Uuid) -> Result<ResultRecord> {
    let row = sqlx::query(result_sql!("WHERE r.id = ?1"))
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("result {id}")))?;
    record_row(&row)
}

async fn path_recorded(conn: &mut SqliteConnection, path: &NativePath) -> Result<bool> {
    let found: Option<String> =
        sqlx::query_scalar("SELECT id FROM result_candidates WHERE path = ?1")
            .bind(to_json(path)?)
            .fetch_optional(&mut *conn)
            .await?;
    Ok(found.is_some())
}

/// The recorded Results or prepared folder holding `path`, if any: a run's
/// revision, a panel run's `Panel N/`, a run group's group folder, or any
/// Results folder, as chosen or as it resolved when Prepare made it.
async fn containing_folder(conn: &mut SqliteConnection, path: &Path) -> Result<Option<PathBuf>> {
    let recorded = load_recorded_folders(conn).await?;
    for folder in recorded.results.iter().chain(&recorded.prepared) {
        let chosen = folder.path.to_path_buf()?;
        let canonical = folder.canonical.as_ref().map(NativePath::to_path_buf).transpose()?;
        if path.starts_with(&chosen) || canonical.is_some_and(|place| path.starts_with(place)) {
            return Ok(Some(chosen));
        }
    }
    Ok(None)
}

/// The revision columns of a discovered file's attribution: a run's
/// preparation revision, or a run group's Prepare all revision.
fn revision_columns(
    owner: ResultOwner,
    attribution: &RevisionAttribution,
) -> (Option<String>, Option<String>) {
    let id = attribution.revision_id().map(|id| id.to_string());
    match owner {
        ResultOwner::Run { .. } => (id, None),
        ResultOwner::Group { .. } => (None, id),
    }
}

async fn insert_scanned(
    conn: &mut SqliteConnection,
    owner: ResultOwner,
    file: &ScannedResult,
    at: &str,
) -> Result<Uuid> {
    let id = Uuid::new_v4();
    let (view_id, group_id) = owner_columns(owner);
    let (prepared, group_prepared) = revision_columns(owner, &file.attribution);
    sqlx::query(
        "INSERT INTO result_candidates (id, view_id, group_id, path, kind, availability, state, \
         association, prepared_revision_id, group_preparation_id, attribution, sha256, \
         fingerprint, discovered_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 'available', ?6, \
         'results_folder', ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
    )
    .bind(id.to_string())
    .bind(view_id)
    .bind(group_id)
    .bind(to_json(&file.path)?)
    .bind(file.kind.as_ref().map(to_json).transpose()?)
    .bind(to_text(&file.state)?)
    .bind(prepared)
    .bind(group_prepared)
    .bind(to_json(&file.attribution)?)
    .bind(file.sha256.as_deref())
    .bind(to_json(&file.fingerprint)?)
    .bind(at)
    .execute(&mut *conn)
    .await?;
    Ok(id)
}

/// A rescan of a recorded file: an accepted one takes only its current
/// bytes; any other its new state, kind, inspection and attribution.
async fn update_scanned(
    conn: &mut SqliteConnection,
    record: &ResultRecord,
    file: &ScannedResult,
    at: &str,
) -> Result<()> {
    if record.state == ResultState::Accepted {
        sqlx::query(
            "UPDATE result_candidates SET availability = 'available', sha256 = ?2, \
             fingerprint = ?3, updated_at = ?4 WHERE id = ?1",
        )
        .bind(record.id.to_string())
        .bind(file.sha256.as_deref())
        .bind(to_json(&file.fingerprint)?)
        .bind(at)
        .execute(&mut *conn)
        .await?;
        return Ok(());
    }
    let (prepared, group_prepared) = revision_columns(record.owner, &file.attribution);
    sqlx::query(
        "UPDATE result_candidates SET availability = 'available', state = ?2, kind = ?3, \
         prepared_revision_id = ?4, group_preparation_id = ?5, attribution = ?6, sha256 = ?7, \
         fingerprint = ?8, updated_at = ?9 WHERE id = ?1",
    )
    .bind(record.id.to_string())
    .bind(to_text(&file.state)?)
    .bind(file.kind.as_ref().map(to_json).transpose()?)
    .bind(prepared)
    .bind(group_prepared)
    .bind(to_json(&file.attribution)?)
    .bind(file.sha256.as_deref())
    .bind(to_json(&file.fingerprint)?)
    .bind(at)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn set_availability(
    conn: &mut SqliteConnection,
    id: Uuid,
    availability: Availability,
    at: &str,
) -> Result<()> {
    sqlx::query("UPDATE result_candidates SET availability = ?2, updated_at = ?3 WHERE id = ?1")
        .bind(id.to_string())
        .bind(to_text(&availability)?)
        .bind(at)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// A product read at its own path: its current bytes, never its state.
async fn observe(
    conn: &mut SqliteConnection,
    id: Uuid,
    observation: &Observation,
    at: &str,
) -> Result<()> {
    match observation {
        Observation::Present { fingerprint, sha256 } => {
            sqlx::query(
                "UPDATE result_candidates SET availability = 'available', fingerprint = ?2, \
                 sha256 = coalesce(?3, sha256), updated_at = ?4 \
                 WHERE id = ?1 AND state NOT IN ('pending', 'intermediate')",
            )
            .bind(id.to_string())
            .bind(to_json(fingerprint)?)
            .bind(sha256.as_deref())
            .bind(at)
            .execute(&mut *conn)
            .await?;
        }
        Observation::Unavailable(availability) => {
            set_availability(conn, id, *availability, at).await?;
        }
    }
    Ok(())
}

/// The kind `kind` may be on an owner of `shape` (RES-FR-02/08): a group
/// Result is an Assembled mosaic; a Mosaic panel is a panel run's; a
/// calibration master is only what discovery detected; an intermediate is
/// never a product.
fn require_kind(kind: &ResultKind, shape: Shape, discovered: Option<&ResultKind>) -> Result<()> {
    let refusal = match (kind, shape) {
        (ResultKind::Intermediate { .. }, _) => Some("an intermediate is not a reusable product"),
        (ResultKind::CalibrationMaster { .. }, _) if discovered != Some(kind) => {
            Some("a calibration master is detected, never named; adopt masters in Calibration")
        }
        (ResultKind::AssembledMosaic, _) | (_, Shape::Group)
            if (shape == Shape::Group) != matches!(kind, ResultKind::AssembledMosaic) =>
        {
            Some("a run group's Result is its Assembled mosaic, and only a run group has one")
        }
        (ResultKind::MosaicPanel, Shape::Run) => Some("only a panel run has Mosaic panel Results"),
        (ResultKind::Other { label }, _) if label.trim().is_empty() => {
            Some("another reusable kind needs a name")
        }
        _ => None,
    };
    refusal.map_or(Ok(()), |reason| Err(invalid(reason)))
}

/// Whether `record` can be accepted on `item`, with the kind it takes; the
/// refusal names why not.
async fn acceptable(
    conn: &mut SqliteConnection,
    record: &ResultRecord,
    item: &VerifiedAcceptance,
) -> Result<Result<ResultKind, String>> {
    let shape = match owner_shape(conn, record.owner).await {
        Ok((shape, _)) => shape,
        Err(LibraryError::InvalidInput(reason)) => return Ok(Err(reason)),
        Err(error) => return Err(error),
    };
    let name = record.name();
    match record.state {
        ResultState::Pending => {
            return Ok(Err(format!("'{name}' is still being written; rescan once it settles")));
        }
        ResultState::Intermediate => {
            return Ok(Err(format!("'{name}' is a processing intermediate, not a product")));
        }
        ResultState::Candidate | ResultState::Attached | ResultState::Accepted => {}
    }
    if record.sha256.as_deref() != Some(item.sha256.as_str()) {
        return Ok(Err(format!(
            "'{name}' was inspected again while it was being accepted; accept it again"
        )));
    }
    let Some(kind) = item.kind.clone().or_else(|| record.kind.clone()) else {
        return Ok(Err(format!("choose what '{name}' is before accepting it")));
    };
    let discovered = record.kind.as_ref().filter(|_| record.state != ResultState::Attached);
    Ok(require_kind(&kind, shape, discovered).map(|()| kind).map_err(|error| error.to_string()))
}

fn require_products(products: &[VerifiedProduct]) -> Result<()> {
    if products.is_empty() {
        return Err(invalid("pick at least one accepted Result"));
    }
    let ids: BTreeSet<Uuid> = products.iter().map(|product| product.result_id).collect();
    if ids.len() != products.len() {
        return Err(invalid("a Result is picked once"));
    }
    Ok(())
}

/// Record `products` as inputs of `view`, each still accepted with the
/// digest it was verified against, owned by another run outside the
/// Project's Trash (or a run group), and not yet an input.
async fn insert_inputs(
    conn: &mut SqliteConnection,
    view: &View,
    products: &[VerifiedProduct],
    at: &str,
) -> Result<()> {
    for product in products {
        let record = load_result(conn, product.result_id).await?;
        let name = record.name();
        let Some(accepted) = record.accepted.as_ref() else {
            return Err(invalid(format!("Result '{name}' is not accepted")));
        };
        if record.owner == (ResultOwner::Run { view_id: view.id }) {
            return Err(invalid(format!("Result '{name}' is this run's own")));
        }
        if let ResultOwner::Run { view_id } = record.owner {
            if load_view(conn, view_id).await?.trashed_at.is_some() {
                return Err(invalid(format!(
                    "Result '{name}' belongs to a run in the Project's Trash"
                )));
            }
        }
        if accepted.sha256 != product.sha256 {
            return Err(invalid(format!(
                "Result '{name}' no longer matches the digest it was verified against; open the \
                 picker again"
            )));
        }
        let added = sqlx::query(
            "INSERT INTO view_product_inputs (view_id, result_id, sha256, added_at) \
             VALUES (?1, ?2, ?3, ?4) ON CONFLICT (view_id, result_id) DO NOTHING",
        )
        .bind(view.id.to_string())
        .bind(record.id.to_string())
        .bind(&product.sha256)
        .bind(at)
        .execute(&mut *conn)
        .await?
        .rows_affected();
        if added == 0 {
            return Err(invalid(format!("Result '{name}' is already an input of this run")));
        }
    }
    Ok(())
}

async fn product_inputs(conn: &mut SqliteConnection, view: Uuid) -> Result<Vec<ProductInput>> {
    let rows = sqlx::query(provenance_sql!(
        "i.view_id AS i_view_id, i.sha256 AS i_sha256, i.added_at AS i_added_at, ",
        "FROM view_product_inputs i JOIN result_candidates r ON r.id = i.result_id ",
        "WHERE i.view_id = ?1 ORDER BY p.name, p.id, o_owner_name, r.path"
    ))
    .bind(view.to_string())
    .fetch_all(&mut *conn)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(ProductInput {
                view_id: parse_uuid(&row.try_get::<String, _>("i_view_id")?)?,
                result: record_row(row)?,
                origin: provenance_row(row)?,
                sha256: row.try_get("i_sha256")?,
                added_at: row.try_get("i_added_at")?,
            })
        })
        .collect()
}

fn file_name(path: &NativePath) -> String {
    path.to_path_buf()
        .ok()
        .and_then(|path| path.file_name().map(|name| name.to_string_lossy().into_owned()))
        .unwrap_or_else(|| path.display())
}

fn owner_of(row: &SqliteRow) -> Result<ResultOwner> {
    let view_id: Option<String> = row.try_get("view_id")?;
    let group_id: Option<String> = row.try_get("group_id")?;
    match (view_id, group_id) {
        (Some(view_id), None) => Ok(ResultOwner::Run { view_id: parse_uuid(&view_id)? }),
        (None, Some(group_id)) => Ok(ResultOwner::Group { group_id: parse_uuid(&group_id)? }),
        _ => Err(corrupt("owner")),
    }
}

fn record_row(row: &SqliteRow) -> Result<ResultRecord> {
    let owner = owner_of(row)?;
    let state: ResultState = from_text(&row.try_get::<String, _>("state")?)?;
    let sha256: Option<String> = row.try_get("sha256")?;
    let accepted = match row.try_get::<Option<String>, _>("accepted_sha256")? {
        Some(sha256) => Some(ResultAcceptance {
            sha256,
            fingerprint: from_json(
                &row.try_get::<Option<String>, _>("accepted_fingerprint")?
                    .ok_or_else(|| corrupt("acceptance fingerprint"))?,
            )?,
            accepted_at: row
                .try_get::<Option<String>, _>("accepted_at")?
                .ok_or_else(|| corrupt("acceptance time"))?,
        }),
        None => None,
    };
    let drifted = match (&sha256, &accepted) {
        (Some(current), Some(accepted)) => *current != accepted.sha256,
        _ => false,
    };
    Ok(ResultRecord {
        id: parse_uuid(&row.try_get::<String, _>("id")?)?,
        owner,
        path: from_json(&row.try_get::<String, _>("path")?)?,
        kind: row.try_get::<Option<String>, _>("kind")?.as_deref().map(from_json).transpose()?,
        availability: from_text(&row.try_get::<String, _>("availability")?)?,
        state,
        association: from_text(&row.try_get::<String, _>("association")?)?,
        lineage: ResultLineage::Unknown,
        attribution: from_json(&row.try_get::<String, _>("attribution")?)?,
        sha256,
        fingerprint: row
            .try_get::<Option<String>, _>("fingerprint")?
            .as_deref()
            .map(from_json)
            .transpose()?,
        accepted,
        drifted,
        discovered_at: row.try_get("discovered_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn provenance_row(row: &SqliteRow) -> Result<ResultProvenance> {
    let id = |column: &str| -> Result<Uuid> { parse_uuid(&row.try_get::<String, _>(column)?) };
    Ok(ResultProvenance {
        project_id: id("o_project_id")?,
        project_name: row.try_get("o_project_name")?,
        owner: owner_of(row)?,
        owner_name: row.try_get::<Option<String>, _>("o_owner_name")?.unwrap_or_default(),
        subject_id: id("o_subject_id")?,
        subject_name: row.try_get("o_subject_name")?,
        target_id: id("o_target_id")?,
        rig_id: id("o_rig_id")?,
        rig_name: row.try_get("o_rig_name")?,
    })
}
