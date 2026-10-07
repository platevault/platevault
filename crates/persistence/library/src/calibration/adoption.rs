// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Master adoption (spec 068, D05, R15, R16): a durable review that hashes the
//! source and checks the destination without writing, then a confirmed
//! operation whose phases each commit before the next file effect. A failure
//! records its last phase and error and registers nothing; opening the catalog
//! turns a Running operation Interrupted, and a retry of the same review resumes
//! only from an installed copy that still holds the recorded identity and digest.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use platevault_model::{
    AdoptedMaster, AdoptionDestination, AdoptionOperation, AdoptionPhase, AdoptionReview,
    AdoptionSource, AdoptionState, Availability, CalibrationRules, CandidateRef, Classification,
    CreatedFile, LibraryError, Location, LocationRole, MasterProvenance, NativePath,
    ObservationFingerprint, ReviewState, ReviewedSource, Revision,
};
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::contained_write::{self, Folder, InstallFailure, Temporary};
use super::{inventory, load_master};
use crate::{
    blocking, check_expected_assets, conflict, current_digest, db_revision, from_json, from_text,
    load_location, now, parse_uuid, path_from_key, path_key, require_active, require_revision,
    require_unchanged_contained, revision, scoped, to_json, to_text, Catalog, Result, SourceProbe,
    SourceRoot, MAX_PAGE,
};

impl Catalog {
    /// Durably review adopting one detected master into a Calibration location.
    ///
    /// The source is hashed off the writer lock against its expected
    /// observation; the destination folder must be a chain of real directories
    /// in an Active, online Calibration location with nothing at the target
    /// path. No file is written and no library row changes.
    ///
    /// # Errors
    /// `InvalidInput` for an invalid destination path, a RES output before 070,
    /// a source that is not a listed master candidate (a raw frame, an adopted
    /// source or a Retired copy) or a destination that is not a Calibration
    /// location; `Conflict` for a stale source; `NotFound` for a missing folder;
    /// `SourceUnavailable` for an offline location; `IdentityConflict` scoped to
    /// an existing destination entry or a source that changed.
    pub async fn review_adoption<R, P>(
        &self,
        source: &AdoptionSource,
        destination: &AdoptionDestination,
        rules: &R,
        probe: P,
    ) -> Result<AdoptionReview>
    where
        R: CalibrationRules + ?Sized,
        P: SourceProbe,
    {
        contained_write::require_supported()?;
        let relative = destination.validate()?;
        let expected = match source {
            AdoptionSource::Asset { asset_id, expected } if expected.asset_id == *asset_id => {
                expected
            }
            AdoptionSource::Asset { asset_id, .. } => {
                return Err(LibraryError::InvalidInput(format!(
                    "expected names another asset than source {asset_id}"
                )));
            }
            AdoptionSource::Result { result_id } => {
                return Err(LibraryError::InvalidInput(format!(
                    "result {result_id} is a RES output; outputs become adoptable once results \
                     discovery (070) records them"
                )));
            }
        };
        let (asset, listed, source_location, target) = {
            let mut conn = self.reader().await?;
            let mut snapshot = conn.begin().await?;
            let asset = check_expected_assets(&mut snapshot, std::slice::from_ref(expected))
                .await?
                .remove(0);
            require_unadopted(&mut snapshot, asset.id, &asset.relative_path).await?;
            let listed = inventory::list_inputs(&mut snapshot, rules).await?;
            let source_location = load_location(&mut snapshot, asset.location_id).await?;
            let target = load_location(&mut snapshot, destination.location_id).await?;
            snapshot.rollback().await?;
            (asset, listed, source_location, target)
        };
        let wanted = CandidateRef::Candidate { asset_id: asset.id };
        let Some(candidate) = listed.into_iter().find(|listed| listed.summary.input == wanted)
        else {
            return Err(scoped(
                LibraryError::InvalidInput(format!(
                    "asset {} is not a detected master candidate; only masters are adopted",
                    asset.id
                )),
                asset.relative_path.clone(),
                Some(asset.id),
            ));
        };
        let summary = candidate.summary;
        let classification = Classification { kind: summary.kind, master: summary.master };
        let origin = summary.origin.ok_or_else(|| {
            LibraryError::PersistenceFailure(format!("candidate {} lists no origin", asset.id))
        })?;
        require_destination(&target)?;
        let source_root = SourceRoot::new(source_location)?;
        let source_relative = asset.relative_path.relative_path()?;
        let target_root = SourceRoot::new(target)?;
        let reviewed = asset.fingerprint.clone();
        let asset_id = asset.id;
        let sha256 = blocking(move || {
            verify_online(&target_root, &probe)?;
            contained_write::require_vacant(&target_root, &relative)?;
            source_root.verify(&probe)?;
            let sha256 = current_digest(&source_root, &source_relative, &reviewed, &probe)
                .map_err(|error| {
                    scoped(error, source_root.source(&source_relative), Some(asset_id))
                })?;
            source_root.verify(&probe)?;
            Ok(sha256)
        })
        .await?;
        let mut fingerprint = asset.fingerprint.clone();
        fingerprint.content_sha256 = Some(sha256.clone());
        let review = AdoptionReview {
            id: Uuid::new_v4(),
            revision: 1,
            state: ReviewState::Open,
            source: ReviewedSource {
                asset_id: Some(asset.id),
                result_id: None,
                location_id: asset.location_id,
                relative_path: asset.relative_path.clone(),
                fingerprint,
                sha256,
            },
            classification,
            observed: asset.observed.clone(),
            origin,
            destination: destination.clone(),
            created_at: now()?,
        };
        write_txn!(self, |conn| {
            check_expected_assets(conn, std::slice::from_ref(expected)).await?;
            require_unadopted(conn, asset.id, &asset.relative_path).await?;
            require_destination(&load_location(conn, destination.location_id).await?)?;
            require_unregistered(conn, destination).await?;
            insert_review(conn, &review).await?;
        });
        Ok(review)
    }

    /// Confirm a review: copy, install, re-read and register the master.
    ///
    /// The Running intent commits before any file effect and every later phase
    /// commits before the next one. A file failure returns the settled `failed`
    /// operation with its last phase and error: a temporary file still holding
    /// its recorded identity is removed, an installed copy is left in place and
    /// named, and nothing is registered. A retry of a failed or interrupted
    /// review resumes from `installed` only when the destination still holds the
    /// recorded identity and the reviewed digest.
    ///
    /// # Errors
    /// `NotFound` for an unknown review; `Conflict` for a stale or adopted
    /// review or one already running; `InvalidInput`, `SourceUnavailable` or
    /// `NotFound` for a destination that stopped being an adoptable folder;
    /// `IdentityConflict` scoped to a destination entry that is not the recorded
    /// installed copy, which is never replaced; `PersistenceFailure` when a
    /// phase cannot be committed, with the operation recorded failed when the
    /// writer still allows it.
    pub async fn adopt_master<P: SourceProbe>(
        &self,
        review_id: Uuid,
        expected: Revision,
        probe: P,
    ) -> Result<AdoptionOperation> {
        contained_write::require_supported()?;
        let (review, operations, source_location, target) = {
            let mut conn = self.reader().await?;
            let mut snapshot = conn.begin().await?;
            let review = load_review(&mut snapshot, review_id).await?;
            let operations = review_operations(&mut snapshot, review_id).await?;
            let source_location = load_location(&mut snapshot, review.source.location_id).await?;
            let target = load_location(&mut snapshot, review.destination.location_id).await?;
            snapshot.rollback().await?;
            (review, operations, source_location, target)
        };
        require_open(&review, expected)?;
        if operations.iter().any(|operation| operation.state == AdoptionState::Running) {
            return Err(conflict(review.id, review.revision));
        }
        require_destination(&target)?;
        let attempt = Arc::new(Attempt {
            relative: review.destination.validate()?,
            source_relative: review.source.relative_path.relative_path()?,
            source: SourceRoot::new(source_location)?,
            target: SourceRoot::new(target)?,
            review,
            probe,
        });
        let installed = operations.iter().rev().find_map(|operation| operation.installed.clone());
        let stale = operations.last().and_then(|operation| operation.temporary.clone());
        let start = {
            let attempt = Arc::clone(&attempt);
            blocking(move || attempt.start(installed, stale)).await?
        };
        let id = Uuid::new_v4();
        write_txn!(self, |conn| start_operation(conn, &attempt.review, expected, id, &start)
            .await?);
        self.run(&attempt, id, expected, start).await
    }

    /// Durable adoption operations in start order, Interrupted ones included.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn list_adoptions(
        &self,
        state: Option<AdoptionState>,
        offset: u32,
        limit: u32,
    ) -> Result<Vec<AdoptionOperation>> {
        let limit = if limit == 0 { MAX_PAGE } else { limit.min(MAX_PAGE) };
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let rows = sqlx::query(
            "SELECT * FROM adoption_operations WHERE ?1 IS NULL OR state = ?1 \
             ORDER BY started_at, rowid LIMIT ?2 OFFSET ?3",
        )
        .bind(state.map(|state| to_text(&state)).transpose()?)
        .bind(i64::from(limit))
        .bind(i64::from(offset))
        .fetch_all(&mut *snapshot)
        .await?;
        let mut operations = Vec::with_capacity(rows.len());
        for row in &rows {
            operations.push(with_master(&mut snapshot, operation_from_row(row)?).await?);
        }
        snapshot.rollback().await?;
        Ok(operations)
    }

    async fn run<P: SourceProbe>(
        &self,
        attempt: &Arc<Attempt<P>>,
        id: Uuid,
        expected: Revision,
        start: Start,
    ) -> Result<AdoptionOperation> {
        let target = attempt.target.path.join(&attempt.relative);
        let (installed, observed) = match start {
            Start::Resume { installed, observed } => (installed, observed),
            Start::Fresh { stale } => match self.copy(attempt, id, stale).await? {
                Copied::Installed(installed) => *installed,
                Copied::Failed(operation) => return Ok(*operation),
            },
        };
        #[cfg(test)]
        match fire(&[Hook::CorruptInstalled, Hook::InterruptAfterInstalled]) {
            Some(Hook::CorruptInstalled) => corrupt(&target),
            Some(Hook::InterruptAfterInstalled) => return Err(LibraryError::Canceled),
            _ => {}
        }
        let verified = {
            let (attempt, installed, observed) =
                (Arc::clone(attempt), installed.clone(), observed.clone());
            blocking(move || attempt.verify(&installed, &observed)).await
        };
        if let Err(error) = verified {
            return self.fail(id, &error, Some(&target)).await;
        }
        self.record_phase(id, AdoptionPhase::Verified, None, None).await?;
        let review = &attempt.review;
        let mut fingerprint = observed;
        fingerprint.content_sha256 = Some(review.source.sha256.clone());
        let adopted_at = now()?;
        let master = AdoptedMaster {
            id: Uuid::new_v4(),
            revision: 1,
            kind: review.classification.kind,
            location_id: review.destination.location_id,
            relative_path: review.destination.relative_path.clone(),
            fingerprint,
            classification: review.classification.clone(),
            observed: review.observed.clone(),
            provenance: MasterProvenance {
                review_id: review.id,
                source: review.source.clone(),
                origin: review.origin.clone(),
                adopted_at,
            },
            asset_id: None,
        };
        #[cfg(test)]
        match fire(&[Hook::FullBeforeRegister, Hook::ChangeSourceBeforeRegister]) {
            Some(Hook::FullBeforeRegister) => {
                self.limit_writer_pages_for_test().await?;
            }
            Some(Hook::ChangeSourceBeforeRegister) => {
                rewrite(&attempt.source.path.join(&attempt.source_relative));
            }
            _ => {}
        }
        // D05: immediately before registration the source must still be the
        // reviewed file. A drift settles the operation failed and registers nothing.
        let registered = async {
            Ok::<_, LibraryError>(write_txn!(self, |conn| {
                match attempt.require_source_unchanged() {
                    Ok(()) => Ok(register(conn, review, expected, id, &master).await?),
                    Err(drift) => Err(drift),
                }
            }))
        }
        .await;
        match registered {
            Ok(Ok(operation)) => Ok(operation),
            Ok(Err(drift)) => self.fail(id, &drift, Some(&target)).await,
            Err(error) => {
                self.fail(id, &error, Some(&target)).await.ok();
                Err(error)
            }
        }
    }

    /// The fresh-copy phases: temporary file, verified copy and install.
    async fn copy<P: SourceProbe>(
        &self,
        attempt: &Arc<Attempt<P>>,
        id: Uuid,
        stale: Option<CreatedFile>,
    ) -> Result<Copied> {
        if let Some(stale) = stale {
            let attempt = Arc::clone(attempt);
            // An earlier attempt's leftover is removed only while it is provably
            // that file; otherwise it stays named in that attempt's record.
            blocking(move || {
                contained_write::discard_recorded(&attempt.target, &stale, &attempt.probe)
            })
            .await
            .ok();
        }
        let created = {
            let attempt = Arc::clone(attempt);
            blocking(move || {
                let folder = Folder::of(&attempt.target, &attempt.relative)?;
                let name = format!(".pv-adopt-{id}.tmp");
                let temporary = contained_write::create_temporary(
                    &folder,
                    &attempt.relative,
                    &name,
                    &attempt.probe,
                )?;
                Ok((folder, temporary))
            })
            .await
        };
        let (folder, temporary) = match created {
            Ok(created) => created,
            Err(error) => return self.fail(id, &error, None).await.map(failed),
        };
        let recorded = temporary.created.clone();
        if let Err(error) =
            self.record_phase(id, AdoptionPhase::TempCreated, Some(&recorded), None).await
        {
            discard(temporary).await;
            return Err(error);
        }
        let copied = {
            let attempt = Arc::clone(attempt);
            blocking(move || {
                let mut temporary = temporary;
                let review = &attempt.review;
                match contained_write::copy_verified(
                    &mut temporary,
                    &attempt.source,
                    &attempt.source_relative,
                    &review.source.fingerprint,
                    &review.source.sha256,
                    &attempt.probe,
                ) {
                    Ok(()) => Ok(Ok(temporary)),
                    Err(error) => Ok(Err((temporary, error))),
                }
            })
            .await?
        };
        let temporary = match copied {
            Ok(temporary) => temporary,
            Err((temporary, error)) => {
                discard(temporary).await;
                return self.fail(id, &error, None).await.map(failed);
            }
        };
        if let Err(error) = self.record_phase(id, AdoptionPhase::Copied, None, None).await {
            discard(temporary).await;
            return Err(error);
        }
        let install = {
            let attempt = Arc::clone(attempt);
            blocking(move || {
                Ok(contained_write::install(
                    temporary,
                    &attempt.target,
                    &folder,
                    &attempt.relative,
                    &attempt.probe,
                ))
            })
            .await?
        };
        let target = attempt.target.path.join(&attempt.relative);
        match install {
            Ok((installed, observed)) => {
                self.record_phase(id, AdoptionPhase::Installed, None, Some(&installed)).await?;
                Ok(Copied::Installed(Box::new((installed, observed))))
            }
            Err(InstallFailure::NotInstalled(temporary, error)) => {
                discard(*temporary).await;
                self.fail(id, &error, None).await.map(failed)
            }
            Err(InstallFailure::Installed(error)) => {
                self.fail(id, &error, Some(&target)).await.map(failed)
            }
        }
    }

    async fn record_phase(
        &self,
        id: Uuid,
        phase: AdoptionPhase,
        temporary: Option<&CreatedFile>,
        installed: Option<&CreatedFile>,
    ) -> Result<()> {
        write_txn!(self, |conn| {
            let updated = sqlx::query(
                "UPDATE adoption_operations SET phase = ?1, \
                 temporary = COALESCE(?2, temporary), installed = COALESCE(?3, installed) \
                 WHERE id = ?4 AND state = 'running'",
            )
            .bind(to_text(&phase)?)
            .bind(temporary.map(to_json).transpose()?)
            .bind(installed.map(to_json).transpose()?)
            .bind(id.to_string())
            .execute(&mut *conn)
            .await?
            .rows_affected();
            require_running(id, updated)?;
        });
        Ok(())
    }

    /// Settle the operation `failed` at its last recorded phase. An installed
    /// copy is named in the recorded error and left in place; the file the
    /// failure was scoped to, such as a drifted source, stays named in the message.
    async fn fail(
        &self,
        id: Uuid,
        error: &LibraryError,
        installed_at: Option<&Path>,
    ) -> Result<AdoptionOperation> {
        let mut response = error.response(None, None);
        if let Some(target) = installed_at {
            let copy = NativePath::from_path(target);
            let cause = match response.scope.take().filter(|scope| *scope != copy) {
                Some(scope) => format!("{} ({})", response.message, scope.display()),
                None => response.message.clone(),
            };
            response.scope = Some(copy);
            response.message = format!(
                "{cause}; the installed copy {} is left in place and not registered",
                target.display()
            );
        }
        Ok(write_txn!(self, |conn| {
            let updated = sqlx::query(
                "UPDATE adoption_operations SET state = 'failed', error = ?1, finished_at = ?2 \
                 WHERE id = ?3 AND state = 'running'",
            )
            .bind(to_json(&response)?)
            .bind(now()?)
            .bind(id.to_string())
            .execute(&mut *conn)
            .await?
            .rows_affected();
            require_running(id, updated)?;
            load_operation(conn, id).await?
        }))
    }
}

/// Everything one confirmation reads, shared with its blocking file steps.
struct Attempt<P> {
    review: AdoptionReview,
    source: SourceRoot,
    source_relative: PathBuf,
    target: SourceRoot,
    relative: PathBuf,
    probe: P,
}

/// How a confirmation starts: a fresh copy, or a resume from an installed copy
/// that still holds the recorded identity and digest.
enum Start {
    Fresh { stale: Option<CreatedFile> },
    Resume { installed: CreatedFile, observed: ObservationFingerprint },
}

enum Copied {
    Installed(Box<(CreatedFile, ObservationFingerprint)>),
    Failed(Box<AdoptionOperation>),
}

fn failed(operation: AdoptionOperation) -> Copied {
    Copied::Failed(Box::new(operation))
}

impl<P: SourceProbe> Attempt<P> {
    /// Reads only: the destination folder is proven, and an entry at the
    /// destination is resumable only as the recorded installed copy.
    fn start(&self, installed: Option<CreatedFile>, stale: Option<CreatedFile>) -> Result<Start> {
        verify_online(&self.target, &self.probe)?;
        Folder::of(&self.target, &self.relative)?;
        let target = self.target.path.join(&self.relative);
        if !contained_write::entry_exists(&target)? {
            return Ok(Start::Fresh { stale });
        }
        let Some(installed) = installed else {
            return Err(contained_write::occupied(&target));
        };
        let observed = self.probe.fingerprint(&target)?;
        if observed.identity != installed.identity {
            return Err(scoped(
                LibraryError::IdentityConflict(
                    "the destination holds another file than the recorded installed copy; \
                     nothing is replaced"
                        .into(),
                ),
                NativePath::from_path(&target),
                None,
            ));
        }
        let sha256 = contained_write::rehash_installed(
            &self.target,
            &self.relative,
            &installed,
            &observed,
            &self.probe,
        )?;
        if sha256 != self.review.source.sha256 {
            return Err(scoped(
                LibraryError::IdentityConflict(
                    "the installed copy no longer hashes to the reviewed SHA-256; it is left in \
                     place"
                        .into(),
                ),
                NativePath::from_path(&target),
                None,
            ));
        }
        Ok(Start::Resume { installed, observed })
    }

    /// The destination re-read and the source re-hash both equal the review digest.
    fn verify(&self, installed: &CreatedFile, observed: &ObservationFingerprint) -> Result<()> {
        let reviewed = &self.review.source;
        let sha256 = contained_write::rehash_installed(
            &self.target,
            &self.relative,
            installed,
            observed,
            &self.probe,
        )?;
        if sha256 != reviewed.sha256 {
            return Err(scoped(
                LibraryError::IdentityConflict(
                    "the installed copy does not hash to the reviewed SHA-256".into(),
                ),
                self.target.source(&self.relative),
                None,
            ));
        }
        self.source.verify(&self.probe)?;
        let source = current_digest(
            &self.source,
            &self.source_relative,
            &reviewed.fingerprint,
            &self.probe,
        )?;
        if source != reviewed.sha256 {
            return Err(scoped(
                LibraryError::IdentityConflict(
                    "the source no longer hashes to the reviewed SHA-256".into(),
                ),
                self.source.source(&self.source_relative),
                None,
            ));
        }
        self.source.verify(&self.probe)
    }

    /// Immediately before registration the source must still be the reviewed
    /// file: its recorded identity on the opened handle, with the reviewed size
    /// and nanosecond mtime (D05). Hashes nothing; [`Self::verify`] hashed it.
    fn require_source_unchanged(&self) -> Result<()> {
        require_unchanged_contained(
            &self.source,
            &self.source_relative,
            &self.review.source.fingerprint,
        )
    }
}

/// Remove a temporary file this attempt holds; a removal failure leaves it
/// named in the operation record.
async fn discard(temporary: Temporary) {
    blocking(move || contained_write::discard(temporary)).await.ok();
}

/// A destination must be an Active, online Calibration location.
fn require_destination(location: &Location) -> Result<()> {
    let refuse = |error: LibraryError| scoped(error, location.path.clone(), Some(location.id));
    if location.role != LocationRole::Calibration {
        return Err(refuse(LibraryError::InvalidInput(format!(
            "location {:?} is a {} location; masters are adopted into a Calibration location",
            location.name,
            to_text(&location.role)?
        ))));
    }
    require_active(location, "an adoption destination")?;
    if location.availability != Availability::Available {
        return Err(refuse(LibraryError::SourceUnavailable(format!(
            "Calibration location {:?} is {}; adopt into an online location",
            location.name,
            to_text(&location.availability)?
        ))));
    }
    Ok(())
}

/// The destination root must still be the registered, reachable folder.
fn verify_online<P: SourceProbe>(root: &SourceRoot, probe: &P) -> Result<()> {
    root.verify(probe).map_err(|error| {
        if error.response(None, None).kind == "identity_conflict" {
            return error;
        }
        scoped(
            LibraryError::SourceUnavailable(format!(
                "Calibration location {:?} is offline: {error}",
                root.location.name
            )),
            root.location.path.clone(),
            Some(root.location.id),
        )
    })
}

fn require_open(review: &AdoptionReview, expected: Revision) -> Result<()> {
    require_revision(review.id, review.revision, expected)?;
    if review.state == ReviewState::Adopted {
        return Err(conflict(review.id, review.revision));
    }
    Ok(())
}

fn require_running(id: Uuid, updated: u64) -> Result<()> {
    if updated == 1 {
        Ok(())
    } else {
        Err(LibraryError::PersistenceFailure(format!("adoption operation {id} is not running")))
    }
}

/// A source adopted once is a retained generated source, never a new candidate.
async fn require_unadopted(
    conn: &mut SqliteConnection,
    asset_id: Uuid,
    path: &NativePath,
) -> Result<()> {
    let adopted: Option<String> =
        sqlx::query_scalar("SELECT id FROM adopted_masters WHERE source_asset_id = ?1")
            .bind(asset_id.to_string())
            .fetch_optional(&mut *conn)
            .await?;
    match adopted {
        None => Ok(()),
        Some(master) => Err(scoped(
            LibraryError::InvalidInput(format!(
                "asset {asset_id} was already adopted as master {master}"
            )),
            path.clone(),
            Some(asset_id),
        )),
    }
}

/// A registered master already owns this destination path.
async fn require_unregistered(
    conn: &mut SqliteConnection,
    destination: &AdoptionDestination,
) -> Result<()> {
    let master: Option<String> = sqlx::query_scalar(
        "SELECT id FROM adopted_masters WHERE location_id = ?1 AND path_key = ?2",
    )
    .bind(destination.location_id.to_string())
    .bind(path_key(&destination.relative_path))
    .fetch_optional(&mut *conn)
    .await?;
    match master {
        None => Ok(()),
        Some(master) => Err(scoped(
            LibraryError::IdentityConflict(format!(
                "master {master} is registered at the destination; nothing is replaced"
            )),
            destination.relative_path.clone(),
            Some(destination.location_id),
        )),
    }
}

async fn insert_review(conn: &mut SqliteConnection, review: &AdoptionReview) -> Result<()> {
    sqlx::query(
        "INSERT INTO adoption_reviews (id, revision, state, source_asset_id, source, \
         classification, observed, origin, destination_location_id, destination_path_key, \
         created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
    )
    .bind(review.id.to_string())
    .bind(db_revision(review.revision)?)
    .bind(to_text(&review.state)?)
    .bind(review.source.asset_id.map(|id| id.to_string()))
    .bind(to_json(&review.source)?)
    .bind(to_json(&review.classification)?)
    .bind(to_json(&review.observed)?)
    .bind(to_json(&review.origin)?)
    .bind(review.destination.location_id.to_string())
    .bind(path_key(&review.destination.relative_path))
    .bind(&review.created_at)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn start_operation(
    conn: &mut SqliteConnection,
    review: &AdoptionReview,
    expected: Revision,
    id: Uuid,
    start: &Start,
) -> Result<()> {
    require_open(&load_review(conn, review.id).await?, expected)?;
    let running: Option<String> = sqlx::query_scalar(
        "SELECT id FROM adoption_operations WHERE review_id = ?1 AND state = 'running'",
    )
    .bind(review.id.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    if running.is_some() {
        return Err(conflict(review.id, review.revision));
    }
    let (phase, installed) = match start {
        Start::Fresh { .. } => (AdoptionPhase::Intent, None),
        Start::Resume { installed, .. } => (AdoptionPhase::Installed, Some(installed)),
    };
    sqlx::query(
        "INSERT INTO adoption_operations (id, review_id, state, phase, installed, started_at) \
         VALUES (?1, ?2, 'running', ?3, ?4, ?5)",
    )
    .bind(id.to_string())
    .bind(review.id.to_string())
    .bind(to_text(&phase)?)
    .bind(installed.map(to_json).transpose()?)
    .bind(now()?)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Register the master, mark the review adopted and complete the operation in
/// one transaction.
async fn register(
    conn: &mut SqliteConnection,
    review: &AdoptionReview,
    expected: Revision,
    id: Uuid,
    master: &AdoptedMaster,
) -> Result<AdoptionOperation> {
    require_open(&load_review(conn, review.id).await?, expected)?;
    sqlx::query(
        "INSERT INTO adopted_masters (id, revision, kind, location_id, path_key, fingerprint, \
         content_sha256, classification, observed, review_id, source_asset_id, provenance, \
         adopted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
    )
    .bind(master.id.to_string())
    .bind(db_revision(master.revision)?)
    .bind(master.kind.as_str())
    .bind(master.location_id.to_string())
    .bind(path_key(&master.relative_path))
    .bind(to_json(&master.fingerprint)?)
    .bind(&review.source.sha256)
    .bind(to_json(&master.classification)?)
    .bind(to_json(&master.observed)?)
    .bind(review.id.to_string())
    .bind(review.source.asset_id.map(|id| id.to_string()))
    .bind(to_json(&master.provenance)?)
    .bind(&master.provenance.adopted_at)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "UPDATE adoption_reviews SET state = 'adopted', revision = revision + 1 \
         WHERE id = ?1 AND state = 'open'",
    )
    .bind(review.id.to_string())
    .execute(&mut *conn)
    .await?;
    let updated = sqlx::query(
        "UPDATE adoption_operations SET state = 'completed', phase = 'registered', \
         finished_at = ?1, master_id = ?2 WHERE id = ?3 AND state = 'running'",
    )
    .bind(&master.provenance.adopted_at)
    .bind(master.id.to_string())
    .bind(id.to_string())
    .execute(&mut *conn)
    .await?
    .rows_affected();
    require_running(id, updated)?;
    load_operation(conn, id).await
}

/// Opening the catalog turns every Running adoption Interrupted.
pub async fn recover_adoptions(conn: &mut SqliteConnection) -> Result<()> {
    sqlx::query(
        "UPDATE adoption_operations SET state = 'interrupted', finished_at = ?1 \
         WHERE state = 'running'",
    )
    .bind(now()?)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn load_review(conn: &mut SqliteConnection, id: Uuid) -> Result<AdoptionReview> {
    let row = sqlx::query("SELECT * FROM adoption_reviews WHERE id = ?1")
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("adoption review {id}")))?;
    Ok(AdoptionReview {
        id: parse_uuid(&row.try_get::<String, _>("id")?)?,
        revision: revision(row.try_get("revision")?)?,
        state: from_text(&row.try_get::<String, _>("state")?)?,
        source: from_json(&row.try_get::<String, _>("source")?)?,
        classification: from_json(&row.try_get::<String, _>("classification")?)?,
        observed: from_json(&row.try_get::<String, _>("observed")?)?,
        origin: from_json(&row.try_get::<String, _>("origin")?)?,
        destination: AdoptionDestination {
            location_id: parse_uuid(&row.try_get::<String, _>("destination_location_id")?)?,
            relative_path: path_from_key(&row.try_get::<Vec<u8>, _>("destination_path_key")?)?,
        },
        created_at: row.try_get("created_at")?,
    })
}

async fn review_operations(
    conn: &mut SqliteConnection,
    review_id: Uuid,
) -> Result<Vec<AdoptionOperation>> {
    let rows = sqlx::query("SELECT * FROM adoption_operations WHERE review_id = ?1 ORDER BY rowid")
        .bind(review_id.to_string())
        .fetch_all(&mut *conn)
        .await?;
    rows.iter().map(operation_from_row).collect()
}

async fn load_operation(conn: &mut SqliteConnection, id: Uuid) -> Result<AdoptionOperation> {
    let row = sqlx::query("SELECT * FROM adoption_operations WHERE id = ?1")
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("adoption operation {id}")))?;
    with_master(conn, operation_from_row(&row)?).await
}

async fn with_master(
    conn: &mut SqliteConnection,
    mut operation: AdoptionOperation,
) -> Result<AdoptionOperation> {
    if let Some(master) = operation.master_id {
        operation.master = Some(load_master(conn, master).await?);
    }
    Ok(operation)
}

fn operation_from_row(row: &SqliteRow) -> Result<AdoptionOperation> {
    fn json<T: serde::de::DeserializeOwned>(row: &SqliteRow, column: &str) -> Result<Option<T>> {
        row.try_get::<Option<String>, _>(column)?.as_deref().map(from_json).transpose()
    }
    Ok(AdoptionOperation {
        id: parse_uuid(&row.try_get::<String, _>("id")?)?,
        review_id: parse_uuid(&row.try_get::<String, _>("review_id")?)?,
        state: from_text(&row.try_get::<String, _>("state")?)?,
        phase: from_text(&row.try_get::<String, _>("phase")?)?,
        temporary: json(row, "temporary")?,
        installed: json(row, "installed")?,
        error: json(row, "error")?,
        started_at: row.try_get("started_at")?,
        finished_at: row.try_get("finished_at")?,
        master_id: row
            .try_get::<Option<String>, _>("master_id")?
            .as_deref()
            .map(parse_uuid)
            .transpose()?,
        master: None,
    })
}

// ---------------------------------------------------------------------------
// Test hooks
// ---------------------------------------------------------------------------

/// Faults a catalog unit test injects into the next adoption on its thread.
#[cfg(test)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Hook {
    /// Overwrite the installed copy's first bytes before it is re-read.
    CorruptInstalled,
    /// Stop after `installed` committed, as if the process ended there.
    InterruptAfterInstalled,
    /// Limit the writer's pages so registration hits `SQLITE_FULL`.
    FullBeforeRegister,
    /// Rewrite the source with other bytes after the copy verified, just before
    /// registration.
    ChangeSourceBeforeRegister,
}

#[cfg(test)]
thread_local! {
    static HOOK: std::cell::Cell<Option<Hook>> = const { std::cell::Cell::new(None) };
}

#[cfg(test)]
pub fn set_hook(hook: Hook) {
    HOOK.with(|slot| slot.set(Some(hook)));
}

#[cfg(test)]
fn fire(points: &[Hook]) -> Option<Hook> {
    HOOK.with(|slot| {
        let hook = slot.get().filter(|hook| points.contains(hook));
        if hook.is_some() {
            slot.set(None);
        }
        hook
    })
}

#[cfg(test)]
fn corrupt(path: &Path) {
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new().write(true).open(path).unwrap();
    file.write_all(b"corrupted").unwrap();
    file.sync_all().unwrap();
}

#[cfg(test)]
fn rewrite(path: &Path) {
    std::fs::write(path, b"re-stacked between copy and registration").unwrap();
}

#[cfg(all(test, unix))]
mod tests {
    //! Faults only a unit test can inject: a corrupted install, an interruption
    //! after `installed` and `SQLITE_FULL` before registration. Each scenario
    //! uses real files below a temporary folder and a real no-follow probe.

    use std::collections::BTreeMap;
    use std::os::unix::fs::MetadataExt;
    use std::path::{Path, PathBuf};
    use std::time::UNIX_EPOCH;

    use platevault_model::{
        AdoptionDestination, AdoptionPhase, AdoptionSource, AdoptionState, Asset, CalibrationRules,
        CalibrationViewBasis, CalibrationViewPlan, CaptureKey, CaptureMetadata, Classification,
        Evaluation, ExpectedAsset, FileIdentity, GroupingResult, ImageFormat, InputEvidence,
        InputForm, InputKind, LibraryError, LightEvidence, Location, LocationRole, MasterBasis,
        MasterEvidence, NativePath, ObservationFingerprint, PathSensitivity, ScanBatch, ScanFile,
        ScanObservation, ScanProgress, ScanState, SessionCandidate, VolumeIdentity,
    };
    use sha2::{Digest, Sha256};
    use uuid::Uuid;

    use super::{set_hook, Hook};
    use crate::{Catalog, InputQuery, LocationRegistration, SourceProbe};

    fn volume() -> VolumeIdentity {
        VolumeIdentity {
            filesystem: "apfs".into(),
            stable_id: Some("adoption-test-volume".into()),
            file_ids_stable: true,
            case: PathSensitivity::Sensitive,
            normalization: PathSensitivity::Sensitive,
        }
    }

    fn io(path: &Path, error: &std::io::Error) -> LibraryError {
        LibraryError::from_io(path, error)
    }

    fn identity(path: &Path) -> Result<FileIdentity, LibraryError> {
        let metadata = std::fs::symlink_metadata(path).map_err(|error| io(path, &error))?;
        Ok(FileIdentity { volume: volume(), file_id: Some(metadata.ino().to_string()) })
    }

    /// A real no-follow probe of the temporary volume.
    struct Probe;

    impl SourceProbe for Probe {
        fn fingerprint(&self, path: &Path) -> Result<ObservationFingerprint, LibraryError> {
            let metadata = std::fs::symlink_metadata(path).map_err(|error| io(path, &error))?;
            if !metadata.is_file() {
                return Err(LibraryError::InvalidInput("not a regular file".into()));
            }
            let modified = metadata.modified().map_err(|error| io(path, &error))?;
            Ok(ObservationFingerprint {
                identity: identity(path)?,
                size_bytes: metadata.len(),
                modified_ns: i128::try_from(
                    modified.duration_since(UNIX_EPOCH).unwrap().as_nanos(),
                )
                .unwrap(),
                content_sha256: None,
            })
        }
        fn root_identity(&self, location: &Location) -> Result<FileIdentity, LibraryError> {
            identity(&location.path.to_path_buf()?)
        }
    }

    /// Classification only: a stack count above 1 on a flat is a master flat.
    /// Adoption never evaluates or plans, so those calls fail the test.
    struct Rules;

    impl CalibrationRules for Rules {
        fn classify(
            &self,
            effective: &CaptureMetadata,
            _relative_path: &NativePath,
        ) -> Option<Classification> {
            let flat = effective.image_type.as_deref()?.eq_ignore_ascii_case("flat");
            let count = effective.stack_count.filter(|count| *count > 1);
            flat.then(|| Classification {
                kind: InputKind::Flat,
                master: count.map(|count| MasterEvidence {
                    basis: MasterBasis::HeaderStackCount,
                    stack_count: Some(count),
                    detector: "unit".into(),
                }),
            })
        }
        fn evaluate(&self, _: InputKind, _: &LightEvidence, _: &InputEvidence) -> Evaluation {
            unreachable!("adoption evaluates no criterion")
        }
        fn plan(&self, _: &CalibrationViewBasis) -> CalibrationViewPlan {
            unreachable!("adoption plans no View")
        }
    }

    fn one_session(assets: &[Asset]) -> GroupingResult {
        let mut ids: Vec<Uuid> = assets.iter().map(|asset| asset.id).collect();
        ids.sort_unstable();
        GroupingResult {
            sessions: vec![SessionCandidate {
                key: CaptureKey("capture-v1|type=flat|night=2026-09-20@date-loc-noon".into()),
                asset_ids: ids,
                provisional: Vec::new(),
                date_basis: Some("date-loc-noon".into()),
            }],
        }
    }

    struct Lib {
        dir: tempfile::TempDir,
        catalog: Catalog,
        calibration_root: PathBuf,
        calibration: Location,
        master: Asset,
    }

    async fn location(catalog: &Catalog, root: &Path, role: LocationRole) -> Location {
        std::fs::create_dir_all(root).unwrap();
        catalog
            .register_location(&LocationRegistration {
                name: root.file_name().unwrap().to_string_lossy().into_owned(),
                path: NativePath::from_path(root),
                role,
                identity: identity(root).unwrap(),
            })
            .await
            .unwrap()
    }

    /// A Results location with one Siril master flat whose observed header
    /// carries `history` bytes, and a Calibration location with `masters/`.
    async fn library(history: usize) -> Lib {
        let dir = tempfile::tempdir().unwrap();
        let catalog = Catalog::open(&dir.path().join("catalog.sqlite")).await.unwrap();
        let results_root = dir.path().join("Processing");
        let results = location(&catalog, &results_root, LocationRole::Results).await;
        let relative = "NGC7000/output/master_flat_Ha.fit";
        let path = results_root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"SIMPLE  = T / Siril master flat, 30 frames").unwrap();
        let metadata = CaptureMetadata {
            raw: BTreeMap::from([("HISTORY".to_owned(), "x".repeat(history))]),
            image_type: Some("Flat".into()),
            filter: Some("Ha".into()),
            stack_count: Some(30),
            ..CaptureMetadata::default()
        };
        let file = ScanFile {
            relative_path: NativePath::from_path(Path::new(relative)),
            fingerprint: Probe.fingerprint(&path).unwrap(),
            format: ImageFormat::Fits,
            metadata,
        };
        let operation = catalog.begin_scan(results.id, None).await.unwrap();
        let root = Probe.root_identity(&results).unwrap();
        let progress = ScanProgress { discovered: 1, metadata_read: 1, ..ScanProgress::default() };
        let batch =
            ScanBatch { files: vec![file.clone()], issues: Vec::new(), progress: progress.clone() };
        catalog.apply_scan_batch(operation.id, &root, &batch, one_session).await.unwrap();
        let observation = ScanObservation {
            location_id: results.id,
            root_identity: root,
            files: vec![file],
            issues: Vec::new(),
            complete_scopes: vec![NativePath::UnixBytes(Vec::new())],
            incomplete_scopes: Vec::new(),
            progress,
            state: ScanState::Completed,
        };
        catalog
            .finish_scan(
                operation.id,
                &observation,
                |location| Probe.root_identity(location),
                one_session,
            )
            .await
            .unwrap();
        let calibration_root = dir.path().join("Calibration");
        let calibration = location(&catalog, &calibration_root, LocationRole::Calibration).await;
        std::fs::create_dir_all(calibration_root.join("masters")).unwrap();
        let master = catalog.location_assets(results.id).await.unwrap().remove(0);
        Lib { dir, catalog, calibration_root, calibration, master }
    }

    fn source(asset: &Asset) -> AdoptionSource {
        AdoptionSource::Asset {
            asset_id: asset.id,
            expected: ExpectedAsset {
                asset_id: asset.id,
                decision_revision: asset.decision_revision,
                fingerprint: asset.fingerprint.clone(),
            },
        }
    }

    fn into(lib: &Lib, name: &str) -> AdoptionDestination {
        AdoptionDestination {
            location_id: lib.calibration.id,
            relative_path: NativePath::from_path(&Path::new("masters").join(name)),
        }
    }

    fn sha_of(path: &Path) -> String {
        hex::encode(Sha256::digest(std::fs::read(path).unwrap()))
    }

    async fn masters(catalog: &Catalog) -> usize {
        let operations =
            catalog.list_adoptions(Some(AdoptionState::Completed), 0, 0).await.unwrap();
        operations.iter().filter(|operation| operation.master.is_some()).count()
    }

    async fn reopen(lib: Lib) -> Lib {
        let Lib { dir, catalog, calibration_root, calibration, master } = lib;
        catalog.close().await.unwrap();
        let catalog = Catalog::open(&dir.path().join("catalog.sqlite")).await.unwrap();
        Lib { dir, catalog, calibration_root, calibration, master }
    }

    #[tokio::test]
    async fn a_corrupted_install_fails_names_the_copy_and_blocks_a_retry() {
        let lib = library(16).await;
        let destination = into(&lib, "master_flat_Ha.fit");
        let review = lib
            .catalog
            .review_adoption(&source(&lib.master), &destination, &Rules, Probe)
            .await
            .unwrap();
        set_hook(Hook::CorruptInstalled);
        let operation = lib.catalog.adopt_master(review.id, review.revision, Probe).await.unwrap();

        let copy = lib.calibration_root.join("masters/master_flat_Ha.fit");
        assert_eq!(
            (operation.state, operation.phase),
            (AdoptionState::Failed, AdoptionPhase::Installed)
        );
        assert!(operation.master.is_none() && operation.master_id.is_none());
        let error = operation.error.clone().unwrap();
        assert_eq!(error.kind, "identity_conflict", "{error:?}");
        assert_eq!(error.scope, Some(NativePath::from_path(&copy)), "the installed copy is named");
        assert!(error.message.contains("left in place"), "{}", error.message);
        assert!(copy.exists(), "the installed copy is left in place");
        assert_eq!(masters(&lib.catalog).await, 0, "nothing is registered");

        let corrupted = std::fs::read(&copy).unwrap();
        let retry = lib.catalog.adopt_master(review.id, review.revision, Probe).await.unwrap_err();
        assert_eq!(retry.response(None, None).kind, "identity_conflict", "{retry}");
        assert!(retry.to_string().contains("no longer hashes"), "{retry}");
        assert_eq!(std::fs::read(&copy).unwrap(), corrupted, "the retry replaced nothing");
        assert_eq!(masters(&lib.catalog).await, 0);
    }

    #[tokio::test]
    async fn an_interrupted_adoption_resumes_by_recorded_identity_and_registers_once() {
        let lib = library(16).await;
        let source_sha =
            sha_of(&lib.dir.path().join("Processing/NGC7000/output/master_flat_Ha.fit"));
        let destination = into(&lib, "master_flat_Ha.fit");
        let review = lib
            .catalog
            .review_adoption(&source(&lib.master), &destination, &Rules, Probe)
            .await
            .unwrap();
        set_hook(Hook::InterruptAfterInstalled);
        let stopped =
            lib.catalog.adopt_master(review.id, review.revision, Probe).await.unwrap_err();
        assert!(matches!(stopped, LibraryError::Canceled), "{stopped}");

        let lib = reopen(lib).await;
        let interrupted =
            lib.catalog.list_adoptions(Some(AdoptionState::Interrupted), 0, 0).await.unwrap();
        assert_eq!(interrupted.len(), 1, "opening the catalog interrupts the running adoption");
        assert_eq!(interrupted[0].phase, AdoptionPhase::Installed);
        let installed =
            interrupted[0].installed.clone().expect("the installed identity is recorded");
        assert!(interrupted[0].finished_at.is_some());

        let operation = lib.catalog.adopt_master(review.id, review.revision, Probe).await.unwrap();
        assert_eq!(
            (operation.state, operation.phase),
            (AdoptionState::Completed, AdoptionPhase::Registered)
        );
        assert_eq!(
            operation.installed.as_ref(),
            Some(&installed),
            "resumed by the recorded identity"
        );
        assert!(operation.temporary.is_none(), "the resume copied nothing");
        let master = operation.master.unwrap();
        assert_eq!(master.fingerprint.identity, installed.identity);
        assert_eq!(master.fingerprint.content_sha256.as_deref(), Some(source_sha.as_str()));
        assert_eq!(masters(&lib.catalog).await, 1, "registered exactly once");
        assert_eq!(lib.catalog.list_adoptions(None, 0, 0).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn a_destination_replaced_after_an_interruption_is_refused() {
        let lib = library(16).await;
        let destination = into(&lib, "master_flat_Ha.fit");
        let review = lib
            .catalog
            .review_adoption(&source(&lib.master), &destination, &Rules, Probe)
            .await
            .unwrap();
        set_hook(Hook::InterruptAfterInstalled);
        lib.catalog.adopt_master(review.id, review.revision, Probe).await.unwrap_err();
        let lib = reopen(lib).await;
        let copy = lib.calibration_root.join("masters/master_flat_Ha.fit");
        let bytes = std::fs::read(&copy).unwrap();
        // The deleted copy stays open so ext4/XFS cannot hand its inode to the
        // replacement; that reuse is a documented residual not covered here.
        let _held = std::fs::File::open(&copy).unwrap();
        std::fs::remove_file(&copy).unwrap();
        std::fs::write(&copy, &bytes).unwrap();

        let error = lib.catalog.adopt_master(review.id, review.revision, Probe).await.unwrap_err();
        assert_eq!(error.response(None, None).kind, "identity_conflict", "{error}");
        assert_eq!(error.response(None, None).scope, Some(NativePath::from_path(&copy)));
        assert_eq!(std::fs::read(&copy).unwrap(), bytes, "the other file is left as it was");
        assert_eq!(masters(&lib.catalog).await, 0);
    }

    /// The observed header is large enough that the master row needs new pages.
    #[tokio::test]
    async fn sqlite_full_before_registration_records_failure_and_registers_nothing() {
        let lib = library(400_000).await;
        let destination = into(&lib, "master_flat_Ha.fit");
        let review = lib
            .catalog
            .review_adoption(&source(&lib.master), &destination, &Rules, Probe)
            .await
            .unwrap();
        set_hook(Hook::FullBeforeRegister);
        let error = lib.catalog.adopt_master(review.id, review.revision, Probe).await.unwrap_err();
        assert_eq!(error.response(None, None).kind, "persistence_failure", "{error}");

        let lib = reopen(lib).await;
        let copy = lib.calibration_root.join("masters/master_flat_Ha.fit");
        let failed = lib.catalog.list_adoptions(Some(AdoptionState::Failed), 0, 0).await.unwrap();
        assert_eq!(failed.len(), 1, "the operation reads failed after reopen");
        assert_eq!(failed[0].phase, AdoptionPhase::Verified);
        assert_eq!(failed[0].error.as_ref().unwrap().scope, Some(NativePath::from_path(&copy)));
        assert!(copy.exists(), "the installed copy is left in place");
        assert_eq!(masters(&lib.catalog).await, 0, "no master row after reopen");

        let retried = lib.catalog.adopt_master(review.id, review.revision, Probe).await.unwrap();
        assert_eq!(
            retried.state,
            AdoptionState::Completed,
            "an unlimited retry resumes and registers"
        );
        assert_eq!(masters(&lib.catalog).await, 1);
    }

    /// CAL-AC-09: source bytes that change after the copy verified but before
    /// registration block adoption. The drifted source and the verified copy are
    /// named, the copy stays unregistered and is offered nowhere, and the review
    /// never registers while the source differs from its reviewed digest.
    #[tokio::test]
    async fn source_drift_between_copy_and_registration_registers_nothing() {
        let lib = library(16).await;
        let source_path = lib.dir.path().join("Processing/NGC7000/output/master_flat_Ha.fit");
        let reviewed_sha = sha_of(&source_path);
        let destination = into(&lib, "master_flat_Ha.fit");
        let review = lib
            .catalog
            .review_adoption(&source(&lib.master), &destination, &Rules, Probe)
            .await
            .unwrap();
        set_hook(Hook::ChangeSourceBeforeRegister);
        let operation = lib.catalog.adopt_master(review.id, review.revision, Probe).await.unwrap();
        assert_eq!(
            (operation.state, operation.phase),
            (AdoptionState::Failed, AdoptionPhase::Verified),
            "{operation:?}"
        );
        assert!(operation.master.is_none());
        let copy = lib.calibration_root.join("masters/master_flat_Ha.fit");
        let error = operation.error.expect("the drift is recorded");
        assert_eq!(error.kind, "identity_conflict", "{error:?}");
        assert_eq!(error.scope, Some(NativePath::from_path(&copy)), "the copy is named");
        assert!(
            error.message.contains(&source_path.display().to_string()),
            "the drifted source is named: {}",
            error.message
        );
        assert!(error.message.contains("not registered"), "{}", error.message);
        assert_eq!(sha_of(&copy), reviewed_sha, "the verified copy stays in place");
        assert_eq!(masters(&lib.catalog).await, 0, "nothing is registered");
        let query = InputQuery { form: Some(InputForm::Master), ..InputQuery::default() };
        assert!(
            lib.catalog.calibration_inputs(&query, &Rules).await.unwrap().is_empty(),
            "no copy is offered for reuse"
        );

        let retried = lib.catalog.adopt_master(review.id, review.revision, Probe).await.unwrap();
        assert_eq!(retried.state, AdoptionState::Failed, "a new review is required: {retried:?}");
        assert_eq!(masters(&lib.catalog).await, 0);
    }
}
