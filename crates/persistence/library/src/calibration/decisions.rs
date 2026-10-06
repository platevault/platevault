// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calibration plans and decisions (spec 068, R11 to R14): required kinds,
//! accept and exception bound to freshly hashed inputs, withdrawal, and the
//! PREP handoff read. Every write names the latest committed View revision and
//! the current plan revision, and moves the plan revision by exactly one.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::PathBuf;

use platevault_model::{
    exception_reason, required_kinds, Availability, CalibrationDecision, CalibrationHandoff,
    CalibrationInputFile, CalibrationPlan, CalibrationRules, CalibrationViewPlan, CandidateRef,
    DecisionItem, ExpectedAsset, InputKind, InputRef, LibraryError, Location, NativePath,
    ObservationFingerprint, Resolution, Revision, Verdict,
};
use serde::Serialize;
use sqlx::sqlite::SqliteConnection;
use sqlx::Connection;
use uuid::Uuid;

use super::{load_master, load_plan, view_basis, Listed};
use crate::views::{committed_header, load_view};
use crate::{
    blocking, check_expected_assets, conflict, current_digest, db_revision, load_assets,
    load_location, now, require_revision, scoped, to_json, to_text, Catalog, Result, SourceProbe,
    SourceRoot,
};

impl Catalog {
    /// The PREP read: accepted and excepted assignments with their hashed
    /// inputs, and every unresolved requirement with its reason. It hashes
    /// nothing; PREP re-verifies each input before its own effect.
    ///
    /// # Errors
    /// `NotFound` for an unknown View or revision.
    pub async fn calibration_handoff<R: CalibrationRules + ?Sized>(
        &self,
        view: Uuid,
        revision: Revision,
        rules: &R,
    ) -> Result<CalibrationHandoff> {
        Ok(self.calibration_view_plan(view, revision, rules).await?.handoff())
    }

    /// Record the kinds a View requires; an empty set is allowed and recorded.
    ///
    /// # Errors
    /// `InvalidInput` for a kind named twice; `NotFound` for an unknown View or
    /// revision; `Conflict` for a View revision that is not the latest committed
    /// one or a stale plan revision.
    pub async fn set_required_kinds(
        &self,
        view: Uuid,
        revision: Revision,
        expected: Revision,
        kinds: &[InputKind],
    ) -> Result<CalibrationPlan> {
        let kinds = required_kinds(kinds)?;
        Ok(write_txn!(self, |conn| {
            let plan = require_writable(conn, view, revision, expected).await?;
            let updated_at = now()?;
            write_plan(conn, view, plan.revision + 1, &kinds, &updated_at).await?;
            CalibrationPlan {
                view_id: view,
                revision: plan.revision + 1,
                required_kinds: kinds,
                updated_at: Some(updated_at),
            }
        }))
    }

    /// Accept all-compatible inputs for requirements of the latest committed
    /// revision. Every input file is hashed off the writer lock first; the
    /// write binds each digest and `last_verified_at` and records the basis and
    /// the criteria snapshot. All or nothing.
    ///
    /// # Errors
    /// `InvalidInput` for an item that names no requirement, an input that is
    /// not a listed reusable candidate (a detected master included) or one with
    /// any non-compatible criterion, naming those criteria; `Conflict` for stale
    /// revisions or inputs; `IdentityConflict`, `SourceUnavailable`,
    /// `AccessDenied` or `NotFound` naming each drifted, offline or unreadable
    /// file.
    pub async fn accept_calibration<R, P>(
        &self,
        view: Uuid,
        revision: Revision,
        expected: Revision,
        items: &[DecisionItem],
        rules: &R,
        probe: P,
    ) -> Result<CalibrationViewPlan>
    where
        R: CalibrationRules + ?Sized,
        P: SourceProbe,
    {
        self.decide(view, revision, expected, items, None, rules, probe).await
    }

    /// Record a reasoned exception scoped to this View, light Session, kind and
    /// input. It snapshots the input's criteria and edits no input evidence.
    ///
    /// # Errors
    /// `InvalidInput` for a blank reason or an all-compatible input (accept it
    /// instead); otherwise as [`Self::accept_calibration`].
    pub async fn record_calibration_exception<R, P>(
        &self,
        view: Uuid,
        revision: Revision,
        expected: Revision,
        item: &DecisionItem,
        reason: &str,
        rules: &R,
        probe: P,
    ) -> Result<CalibrationViewPlan>
    where
        R: CalibrationRules + ?Sized,
        P: SourceProbe,
    {
        let reason = exception_reason(reason)?;
        self.decide(
            view,
            revision,
            expected,
            std::slice::from_ref(item),
            Some(reason),
            rules,
            probe,
        )
        .await
    }

    /// End effective decisions by appending `withdrawn` rows; earlier rows stay.
    ///
    /// # Errors
    /// `InvalidInput` for an empty or repeated batch or a requirement without an
    /// effective decision; `Conflict` and `NotFound` as for every write.
    pub async fn withdraw_calibration<R: CalibrationRules + ?Sized>(
        &self,
        view: Uuid,
        revision: Revision,
        expected: Revision,
        items: &[(Uuid, InputKind)],
        rules: &R,
    ) -> Result<CalibrationViewPlan> {
        if items.is_empty() {
            return Err(LibraryError::InvalidInput("items is empty".into()));
        }
        let mut seen = BTreeSet::new();
        if let Some((session, kind)) = items.iter().find(|item| !seen.insert(**item)) {
            return Err(LibraryError::InvalidInput(format!(
                "items name {} for light Session {session} twice",
                kind.as_str()
            )));
        }
        Ok(write_txn!(self, |conn| {
            let plan = require_writable(conn, view, revision, expected).await?;
            let (basis, _) = view_basis(conn, view, revision, rules).await?;
            let decided_at = now()?;
            let next = plan.revision + 1;
            for &(session, kind) in items {
                let effective = basis
                    .decisions
                    .iter()
                    .find(|decision| {
                        decision.light_session_id == session
                            && decision.kind == kind
                            && decision.resolution != Resolution::Withdrawn
                    })
                    .ok_or_else(|| {
                        LibraryError::InvalidInput(format!(
                            "light Session {session} has no {} decision to withdraw",
                            kind.as_str()
                        ))
                    })?;
                let (grouping_revision, light_asset_ids) = basis
                    .lights
                    .iter()
                    .find(|light| light.evidence.session_id == session)
                    .map_or_else(
                        || (effective.grouping_revision, effective.light_asset_ids.clone()),
                        |light| (light.evidence.grouping_revision, light.included_assets.clone()),
                    );
                insert_decision(
                    conn,
                    &CalibrationDecision {
                        id: Uuid::new_v4(),
                        view_id: view,
                        view_revision: revision,
                        light_session_id: session,
                        grouping_revision,
                        light_asset_ids,
                        kind,
                        resolution: Resolution::Withdrawn,
                        input: None,
                        inputs: Vec::new(),
                        criteria: Vec::new(),
                        reason: None,
                        plan_revision: next,
                        decided_at: decided_at.clone(),
                    },
                )
                .await?;
            }
            write_plan(conn, view, next, &plan.required_kinds, &decided_at).await?;
            let (basis, _) = view_basis(conn, view, revision, rules).await?;
            rules.plan(&basis)
        }))
    }

    /// Accept (`reason` absent) or except (`reason` present) a batch of items.
    #[allow(clippy::too_many_arguments)]
    async fn decide<R, P>(
        &self,
        view: Uuid,
        revision: Revision,
        expected: Revision,
        items: &[DecisionItem],
        reason: Option<String>,
        rules: &R,
        probe: P,
    ) -> Result<CalibrationViewPlan>
    where
        R: CalibrationRules + ?Sized,
        P: SourceProbe,
    {
        DecisionItem::validate(items)?;
        let exception = reason.is_some();
        let prepared = {
            let mut conn = self.reader().await?;
            let mut snapshot = conn.begin().await?;
            require_writable(&mut snapshot, view, revision, expected).await?;
            let (basis, listed) = view_basis(&mut snapshot, view, revision, rules).await?;
            let current = rules.plan(&basis);
            let mut prepared = Prepared::default();
            for item in items {
                chosen(&current, item, exception)?;
                prepared.add(&mut snapshot, item, &listed).await?;
            }
            snapshot.rollback().await?;
            prepared
        };
        let Prepared { files, per_item, blocked } = prepared;
        let hashed = blocking(move || hash_inputs(files, blocked, &probe)).await?;
        Ok(write_txn!(self, |conn| {
            let plan = require_writable(conn, view, revision, expected).await?;
            let (basis, _) = view_basis(conn, view, revision, rules).await?;
            let current = rules.plan(&basis);
            let decided_at = now()?;
            let next = plan.revision + 1;
            let bound = bind_digests(conn, &hashed, &decided_at).await?;
            for (item, keys) in items.iter().zip(&per_item) {
                let candidate = chosen(&current, item, exception)?;
                let light = basis
                    .lights
                    .iter()
                    .find(|light| light.evidence.session_id == item.light_session_id)
                    .ok_or_else(|| {
                        LibraryError::PersistenceFailure(format!(
                            "requirement without light Session {}",
                            item.light_session_id
                        ))
                    })?;
                let mut digests = BTreeSet::new();
                let inputs = keys
                    .iter()
                    .filter_map(|key| bound.get(key))
                    .filter(|file| {
                        digests.insert(file.fingerprint.content_sha256.clone().unwrap_or_default())
                    })
                    .cloned()
                    .collect();
                insert_decision(
                    conn,
                    &CalibrationDecision {
                        id: Uuid::new_v4(),
                        view_id: view,
                        view_revision: revision,
                        light_session_id: item.light_session_id,
                        grouping_revision: light.evidence.grouping_revision,
                        light_asset_ids: light.included_assets.clone(),
                        kind: item.kind,
                        resolution: if exception {
                            Resolution::Exception
                        } else {
                            Resolution::Accepted
                        },
                        input: Some(item.input),
                        inputs,
                        criteria: candidate.evaluation.criteria.clone(),
                        reason: reason.clone(),
                        plan_revision: next,
                        decided_at: decided_at.clone(),
                    },
                )
                .await?;
            }
            write_plan(conn, view, next, &plan.required_kinds, &decided_at).await?;
            let (basis, _) = view_basis(conn, view, revision, rules).await?;
            rules.plan(&basis)
        }))
    }
}

/// Writes name the latest committed revision of an existing View and the
/// current plan revision. A Complete View is refused once RES (070) records
/// completion; until then the catalog has no completion record.
async fn require_writable(
    conn: &mut SqliteConnection,
    view: Uuid,
    revision: Revision,
    expected: Revision,
) -> Result<CalibrationPlan> {
    let current = load_view(conn, view).await?;
    committed_header(conn, view, revision).await?;
    if current.revision != revision {
        return Err(conflict(view, current.revision));
    }
    let plan = load_plan(conn, view).await?;
    require_revision(view, plan.revision, expected)?;
    Ok(plan)
}

fn label<T: Serialize>(value: &T) -> String {
    to_text(value).unwrap_or_default()
}

/// The listed candidate an item names, with the verdict its resolution needs.
fn chosen<'a>(
    plan: &'a CalibrationViewPlan,
    item: &DecisionItem,
    exception: bool,
) -> Result<&'a platevault_model::CandidateEvaluation> {
    let kind = item.kind.as_str();
    let session = item.light_session_id;
    let requirement = plan
        .requirements
        .iter()
        .find(|requirement| {
            requirement.light_session_id == session && requirement.kind == item.kind
        })
        .ok_or_else(|| {
            LibraryError::InvalidInput(format!(
                "light Session {session} has no {kind} requirement at View revision {}",
                plan.view_revision
            ))
        })?;
    let wanted = CandidateRef::from(item.input);
    let input = format!("{} {}", label(&item.input.form()), item.input.id());
    let Some(candidate) = requirement.candidates.iter().find(|c| c.candidate == wanted) else {
        if let Some(current) =
            requirement.candidates.iter().find(|c| c.candidate.id() == item.input.id())
        {
            let current = current.candidate.input().map_or(0, |input| input.revision());
            return Err(conflict(item.input.id(), current));
        }
        return Err(LibraryError::InvalidInput(format!(
            "{input} is not a listed {kind} candidate for light Session {session}; a detected \
             master is adopted before it is accepted"
        )));
    };
    let waived: Vec<String> = candidate
        .evaluation
        .criteria
        .iter()
        .filter(|row| row.verdict != Verdict::Compatible)
        .map(|row| format!("{} {}", label(&row.criterion), label(&row.verdict)))
        .collect();
    match (exception, waived.is_empty()) {
        (false, false) => Err(LibraryError::InvalidInput(format!(
            "{input} is not compatible with light Session {session} for {kind}: {}; record an \
             exception or choose another input",
            waived.join(", ")
        ))),
        (true, true) => Err(LibraryError::InvalidInput(format!(
            "every criterion of {input} is compatible with light Session {session} for {kind}; \
             accept it instead of recording an exception"
        ))),
        _ => Ok(candidate),
    }
}

/// One file an input binds, as recorded before hashing.
struct FileWork {
    asset_id: Option<Uuid>,
    master_id: Option<Uuid>,
    root: SourceRoot,
    relative: PathBuf,
    native: NativePath,
    fingerprint: ObservationFingerprint,
    expected: Option<ExpectedAsset>,
}

/// The files of a batch: each distinct file once, the files of each item, and
/// the members that have no readable copy.
#[derive(Default)]
struct Prepared {
    files: BTreeMap<Uuid, FileWork>,
    per_item: Vec<Vec<Uuid>>,
    blocked: Vec<LibraryError>,
}

impl Prepared {
    async fn add(
        &mut self,
        conn: &mut SqliteConnection,
        item: &DecisionItem,
        listed: &[Listed],
    ) -> Result<()> {
        let mut keys = Vec::new();
        match item.input {
            InputRef::RawSet { session_id, .. } => {
                let wanted = CandidateRef::from(item.input);
                let input = listed
                    .iter()
                    .find(|listed| listed.summary.input == wanted)
                    .ok_or_else(|| {
                        LibraryError::InvalidInput(format!(
                            "raw set {session_id} is not a listed calibration input"
                        ))
                    })?;
                let mut chosen = BTreeSet::new();
                for member in &input.members {
                    let available = member
                        .copies
                        .iter()
                        .find(|copy| copy.availability == Availability::Available);
                    match (available, member.copies.first()) {
                        (Some(copy), _) => {
                            chosen.insert(copy.asset_id);
                        }
                        (None, Some(copy)) => self.blocked.push(scoped(
                            LibraryError::SourceUnavailable(format!(
                                "no copy of member {} of raw set {session_id} is available: {}",
                                member.member_key,
                                label(&copy.availability)
                            )),
                            copy.relative_path.clone(),
                            Some(copy.asset_id),
                        )),
                        (None, None) => {}
                    }
                }
                let mut locations: HashMap<Uuid, Location> = HashMap::new();
                for asset in load_assets(conn, &chosen).await? {
                    keys.push(asset.id);
                    if self.files.contains_key(&asset.id) {
                        continue;
                    }
                    let location = if let Some(location) = locations.get(&asset.location_id) {
                        location.clone()
                    } else {
                        let location = load_location(conn, asset.location_id).await?;
                        locations.insert(location.id, location.clone());
                        location
                    };
                    self.files.insert(
                        asset.id,
                        FileWork {
                            asset_id: Some(asset.id),
                            master_id: None,
                            root: SourceRoot::new(location)?,
                            relative: asset.relative_path.relative_path()?,
                            native: asset.relative_path.clone(),
                            fingerprint: asset.fingerprint.clone(),
                            expected: Some(ExpectedAsset {
                                asset_id: asset.id,
                                decision_revision: asset.decision_revision,
                                fingerprint: asset.fingerprint.clone(),
                            }),
                        },
                    );
                }
            }
            InputRef::Master { master_id, .. } => {
                let master = load_master(conn, master_id).await?;
                let location = load_location(conn, master.location_id).await?;
                keys.push(master.id);
                if location.availability != Availability::Available {
                    self.blocked.push(scoped(
                        LibraryError::SourceUnavailable(format!(
                            "master {master_id} lies in location {:?}, which is {}",
                            location.name,
                            label(&location.availability)
                        )),
                        master.relative_path.clone(),
                        Some(master.id),
                    ));
                } else if let std::collections::btree_map::Entry::Vacant(entry) =
                    self.files.entry(master.id)
                {
                    entry.insert(FileWork {
                        asset_id: None,
                        master_id: Some(master.id),
                        root: SourceRoot::new(location)?,
                        relative: master.relative_path.relative_path()?,
                        native: master.relative_path.clone(),
                        fingerprint: master.fingerprint.clone(),
                        expected: None,
                    });
                }
            }
        }
        self.per_item.push(keys);
        Ok(())
    }
}

/// A file whose current bytes hashed against its recorded observation.
struct Hashed {
    file: FileWork,
    sha256: String,
}

/// Hash every distinct file; any blocked file blocks the whole batch, and the
/// refusal names each one.
fn hash_inputs<P: SourceProbe>(
    files: BTreeMap<Uuid, FileWork>,
    mut blocked: Vec<LibraryError>,
    probe: &P,
) -> Result<BTreeMap<Uuid, Hashed>> {
    let mut hashed = BTreeMap::new();
    for (key, file) in files {
        let digest = file
            .root
            .verify(probe)
            .and_then(|()| current_digest(&file.root, &file.relative, &file.fingerprint, probe))
            .and_then(|sha256| file.root.verify(probe).map(|()| sha256));
        match digest {
            Ok(sha256) => {
                hashed.insert(key, Hashed { file, sha256 });
            }
            Err(error) => blocked.push(scoped(error, file.root.source(&file.relative), Some(key))),
        }
    }
    match blocked.len() {
        0 => Ok(hashed),
        1 => Err(blocked.remove(0)),
        count => Err(combined(count, &blocked)),
    }
}

/// One refusal naming every blocked file, of the first one's kind and scope.
fn combined(count: usize, blocked: &[LibraryError]) -> LibraryError {
    let responses: Vec<_> = blocked.iter().map(|error| error.response(None, None)).collect();
    let named: Vec<String> = responses
        .iter()
        .map(|response| match &response.scope {
            Some(scope) => format!("{}: {}", scope.display(), response.message),
            None => response.message.clone(),
        })
        .collect();
    let message = format!("{count} input files are blocked: {}", named.join("; "));
    let error = match responses[0].kind.as_str() {
        "identity_conflict" => LibraryError::IdentityConflict(message),
        "access_denied" => LibraryError::AccessDenied(message),
        "not_found" => LibraryError::NotFound(message),
        "invalid_input" => LibraryError::InvalidInput(message),
        _ => LibraryError::SourceUnavailable(message),
    };
    match responses[0].scope.clone() {
        Some(scope) => scoped(error, scope, responses[0].identity),
        None => error,
    }
}

/// Re-check every hashed file inside the write and bind each raw-set digest
/// and `last_verified_at` as `verify_digest` does.
async fn bind_digests(
    conn: &mut SqliteConnection,
    hashed: &BTreeMap<Uuid, Hashed>,
    verified_at: &str,
) -> Result<BTreeMap<Uuid, CalibrationInputFile>> {
    let mut bound = BTreeMap::new();
    for (key, Hashed { file, sha256 }) in hashed {
        let mut fingerprint = if let Some(expected) = &file.expected {
            let asset =
                check_expected_assets(conn, std::slice::from_ref(expected)).await?.remove(0);
            let mut fingerprint = asset.fingerprint;
            fingerprint.content_sha256 = Some(sha256.clone());
            sqlx::query("UPDATE assets SET fingerprint = ?1, last_verified_at = ?2 WHERE id = ?3")
                .bind(to_json(&fingerprint)?)
                .bind(verified_at)
                .bind(key.to_string())
                .execute(&mut *conn)
                .await?;
            fingerprint
        } else {
            let master = load_master(conn, *key).await?;
            if !master.fingerprint.equivalent(&file.fingerprint) {
                return Err(conflict(master.id, master.revision));
            }
            master.fingerprint
        };
        fingerprint.content_sha256 = Some(sha256.clone());
        bound.insert(
            *key,
            CalibrationInputFile {
                asset_id: file.asset_id,
                master_id: file.master_id,
                location_id: file.root.location.id,
                relative_path: file.native.clone(),
                fingerprint,
            },
        );
    }
    Ok(bound)
}

async fn write_plan(
    conn: &mut SqliteConnection,
    view: Uuid,
    revision: Revision,
    kinds: &[InputKind],
    updated_at: &str,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO calibration_plans (view_id, revision, required_kinds, updated_at) \
         VALUES (?1, ?2, ?3, ?4) ON CONFLICT (view_id) DO UPDATE SET \
         revision = excluded.revision, required_kinds = excluded.required_kinds, \
         updated_at = excluded.updated_at",
    )
    .bind(view.to_string())
    .bind(db_revision(revision)?)
    .bind(to_json(kinds)?)
    .bind(updated_at)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn insert_decision(
    conn: &mut SqliteConnection,
    decision: &CalibrationDecision,
) -> Result<()> {
    let (session, master) = match decision.input {
        Some(InputRef::RawSet { session_id, .. }) => (Some(session_id.to_string()), None),
        Some(InputRef::Master { master_id, .. }) => (None, Some(master_id.to_string())),
        None => (None, None),
    };
    sqlx::query(
        "INSERT INTO calibration_decisions (id, view_id, view_revision, light_session_id, \
         grouping_revision, light_asset_ids, kind, resolution, input, input_session_id, \
         input_master_id, inputs, criteria, reason, plan_revision, decided_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
    )
    .bind(decision.id.to_string())
    .bind(decision.view_id.to_string())
    .bind(db_revision(decision.view_revision)?)
    .bind(decision.light_session_id.to_string())
    .bind(db_revision(decision.grouping_revision)?)
    .bind(to_json(&decision.light_asset_ids)?)
    .bind(decision.kind.as_str())
    .bind(to_text(&decision.resolution)?)
    .bind(decision.input.as_ref().map(to_json).transpose()?)
    .bind(session)
    .bind(master)
    .bind(to_json(&decision.inputs)?)
    .bind(to_json(&decision.criteria)?)
    .bind(decision.reason.as_deref())
    .bind(db_revision(decision.plan_revision)?)
    .bind(&decision.decided_at)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    //! `SQLITE_FULL` on accept: a disposable `max_page_count` catalog. The
    //! optical-train headers are long, so the criteria snapshot needs new pages.

    use platevault_model::{
        CriteriaInput, DecisionItem, InputKind, LocationRole, NewView, RequirementState,
        ViewOriginInput,
    };

    use crate::test_support::*;
    use crate::{Catalog, SessionQuery};

    #[tokio::test]
    async fn sqlite_full_on_accept_persists_nothing_and_an_unlimited_retry_succeeds() {
        let fx = Fixture::new();
        let catalog = Catalog::open(&fx.db).await.unwrap();
        let captures = catalog.register_location(&fx.registration()).await.unwrap();
        let train = |mut metadata: platevault_model::CaptureMetadata| {
            metadata.telescope = Some(format!("RedCat {}", "5".repeat(300_000)));
            metadata
        };
        let light = || train(calibration_frame("LIGHT", Some("Ha"), 300.0, "2026-09-18"));
        scan_frames(
            &catalog,
            &captures,
            vec![
                frame(&fx.root, "lights/Ha_001.fits", light()),
                frame(&fx.root, "lights/Ha_002.fits", light()),
            ],
        )
        .await;
        let (calibration, root) =
            location_at(&catalog, &fx, "Astro-T7/Calibration", LocationRole::Calibration).await;
        let flat = || train(calibration_frame("FLAT", Some("Ha"), 2.0, "2026-09-18"));
        scan_frames(
            &catalog,
            &calibration,
            vec![
                frame(&root, "flats/Flat_Ha_001.fits", flat()),
                frame(&root, "flats/Flat_Ha_002.fits", flat()),
            ],
        )
        .await;
        let sessions = catalog.list_sessions(&SessionQuery::default()).await.unwrap();
        let lights = sessions
            .iter()
            .find(|s| s.session.key.0.contains("type=light"))
            .map(|s| expected_session(&s.session))
            .unwrap();
        let record = catalog
            .create_view(&NewView {
                origin: ViewOriginInput::Sessions { sessions: vec![lights] },
                name: Some("NGC7000".into()),
                criteria: CriteriaInput::default(),
                framing_revision: None,
                suggestions: Vec::new(),
            })
            .await
            .unwrap();
        let view = record.view.id;
        catalog.save_view(view, 0, 1).await.unwrap();
        // Scanning churned pages onto the freelist; drop them so the accept
        // must grow the file.
        catalog.close().await.unwrap();
        let mut raw = raw(&fx.db).await;
        sqlx::raw_sql("VACUUM").execute(&mut raw).await.unwrap();
        sqlx::Connection::close(raw).await.unwrap();
        let catalog = Catalog::open(&fx.db).await.unwrap();
        let rules = TestRules::default();
        let plan = catalog.calibration_view_plan(view, 1, &rules).await.unwrap();
        let flat = plan.requirements.iter().find(|r| r.kind == InputKind::Flat).unwrap();
        assert_eq!(flat.state, RequirementState::Suggested);
        let item = DecisionItem {
            light_session_id: flat.light_session_id,
            kind: InputKind::Flat,
            input: flat.preselected.unwrap().input().unwrap(),
        };
        let assets_before = dump_tables(&fx.db, &["assets"]).await;

        catalog.limit_writer_pages_for_test().await.unwrap();
        let error =
            catalog.accept_calibration(view, 1, 0, &[item], &rules, DiskProbe).await.unwrap_err();
        assert_eq!(error.response(None, None).kind, "persistence_failure", "{error}");
        assert!(error.to_string().contains("full"), "{error}");
        catalog.close().await.unwrap();

        let reopened = Catalog::open(&fx.db).await.unwrap();
        let rows = dump_tables(&fx.db, &["calibration_plans", "calibration_decisions"]).await;
        assert!(rows.values().all(Vec::is_empty), "no plan or decision row: {rows:?}");
        assert_eq!(dump_tables(&fx.db, &["assets"]).await, assets_before, "no digest bound");
        let accepted =
            reopened.accept_calibration(view, 1, 0, &[item], &rules, DiskProbe).await.unwrap();
        assert_eq!(accepted.plan_revision, 1, "an unlimited retry succeeds");
        let flat = accepted.requirements.iter().find(|r| r.kind == InputKind::Flat).unwrap();
        assert_eq!(flat.state, RequirementState::Accepted);
    }
}
