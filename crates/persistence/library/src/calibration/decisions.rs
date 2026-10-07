// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calibration decisions of a processing run (spec 068 as amended by D-W5,
//! D-W37 and D-W55; R11 to R14): the required kinds and the policy, the
//! automatic match with its adopted-master drift check, the user's accept
//! (a replacement included), exception, exclusion and withdrawal, the plan,
//! readiness and PREP reads, and the Project evidence.
//!
//! Decisions are keyed by light group and kind. Every write names the latest
//! committed membership revision of a run outside the Trash that is not
//! Complete and the current plan revision, and moves the plan revision by
//! exactly one. Input files are hashed off the writer lock before a decision
//! binds them, and the write re-checks each one; reads hash nothing.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::Arc;

use platevault_model::{
    exception_reason, required_kinds, Availability, BlockedRequirement, CalibrationAssignment,
    CalibrationDecision, CalibrationHandoff, CalibrationInputFile, CalibrationPlan,
    CalibrationPolicy, CalibrationReadiness, CalibrationRules, CalibrationViewBasis,
    CalibrationViewPlan, CandidateEvaluation, CandidateRef, DecisionItem, ErrorResponse,
    ExpectedAsset, InputKind, InputRef, LibraryError, LightGroupKey, Location, MemberState,
    NativePath, ObservationFingerprint, ProjectCalibrationEvidence, ProjectWarning, Requirement,
    RequirementKey, Resolution, Revision, RunCompletion, SubjectChannelEvidence, UnresolvedReason,
    Verdict, View,
};
use serde::Serialize;
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::inventory::{self, Listed};
use super::{light_basis, load_master};
use crate::review_lists::live_assets;
use crate::views::{committed_header, load_members, load_view};
use crate::{
    blocking, check_expected_assets, conflict, current_digest, db_revision, from_json, from_text,
    load_assets, load_location, now, parse_uuid, projects, require_revision, revision, scoped,
    to_json, to_text, Catalog, Result, SourceProbe, SourceRoot,
};

impl Catalog {
    /// The requirement table of committed run revision `revision`: one row
    /// per light group and required kind with its state, its candidates of
    /// the run's camera in R10 order with their criteria, the single top input
    /// and the effective decision with its applicability. An older revision
    /// reads too. Hashes nothing.
    ///
    /// # Errors
    /// `NotFound` for an unknown run or revision.
    pub async fn calibration_view_plan<R: CalibrationRules + ?Sized>(
        &self,
        view: Uuid,
        revision: Revision,
        rules: &R,
    ) -> Result<CalibrationViewPlan> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let run = load_view(&mut snapshot, view).await?;
        let (basis, _) = view_basis(&mut snapshot, &run, revision, rules).await?;
        snapshot.rollback().await?;
        Ok(rules.plan(&basis))
    }

    /// The Calibrate step's readiness line of committed revision `revision`.
    ///
    /// # Errors
    /// As [`Self::calibration_view_plan`].
    pub async fn calibration_readiness<R: CalibrationRules + ?Sized>(
        &self,
        view: Uuid,
        revision: Revision,
        rules: &R,
    ) -> Result<CalibrationReadiness> {
        Ok(self.calibration_view_plan(view, revision, rules).await?.readiness())
    }

    /// The PREP read: automatic, accepted and excepted assignments with their
    /// hashed inputs, exclusions, and every unresolved requirement with its
    /// reason. It hashes nothing; PREP re-verifies each input before its own
    /// effect.
    ///
    /// # Errors
    /// As [`Self::calibration_view_plan`].
    pub async fn calibration_handoff<R: CalibrationRules + ?Sized>(
        &self,
        view: Uuid,
        revision: Revision,
        rules: &R,
    ) -> Result<CalibrationHandoff> {
        Ok(self.calibration_view_plan(view, revision, rules).await?.handoff())
    }

    /// Record the kinds a run requires; an empty set is allowed and recorded.
    ///
    /// # Errors
    /// `InvalidInput` for a kind named twice or a run in the Trash or
    /// Complete; `NotFound` for an unknown run or revision; `Conflict` for a
    /// revision that is not the latest committed one or a stale plan revision.
    pub async fn set_required_kinds(
        &self,
        view: Uuid,
        revision: Revision,
        expected: Revision,
        kinds: &[InputKind],
    ) -> Result<CalibrationPlan> {
        let kinds = required_kinds(kinds)?;
        Ok(write_txn!(self, |conn| {
            let (_, plan) = require_writable(conn, view, revision, expected).await?;
            let updated_at = now()?;
            write_plan(conn, view, plan.revision + 1, &kinds, &updated_at).await?;
            CalibrationPlan {
                revision: plan.revision + 1,
                required_kinds: kinds,
                updated_at: Some(updated_at),
                ..plan
            }
        }))
    }

    /// Turn the run's automatic assignment on or off (D-W55). Turning it off
    /// keeps every recorded decision; matching then only suggests.
    ///
    /// # Errors
    /// `InvalidInput` for a run in the Trash or Complete; `NotFound` for an
    /// unknown run; `Conflict` for a stale plan revision.
    pub async fn set_calibration_policy(
        &self,
        view: Uuid,
        expected: Revision,
        policy: CalibrationPolicy,
    ) -> Result<CalibrationPlan> {
        Ok(write_txn!(self, |conn| {
            let run = load_view(conn, view).await?;
            require_open_run(&run)?;
            let plan = load_plan(conn, &run).await?;
            require_revision(view, plan.revision, expected)?;
            let updated_at = now()?;
            sqlx::query("UPDATE views SET calibration_policy = ?1, updated_at = ?2 WHERE id = ?3")
                .bind(to_text(&policy)?)
                .bind(&updated_at)
                .bind(view.to_string())
                .execute(&mut *conn)
                .await?;
            write_plan(conn, view, plan.revision + 1, &plan.required_kinds, &updated_at).await?;
            CalibrationPlan {
                revision: plan.revision + 1,
                policy,
                updated_at: Some(updated_at),
                ..plan
            }
        }))
    }

    /// The automatic match of committed revision `revision` (CAL-FR-02): each
    /// requirement whose single fully compatible top input the planner names
    /// for automatic assignment is recorded `automatic`, binding the identity
    /// and SHA-256 of every file it reads. Requirements a decision still holds
    /// are never touched, so a user's choice survives, and on a new membership
    /// revision only the changed light groups are matched again.
    ///
    /// Adopted masters are hashed against their adoption digest first: one
    /// that differs reads drifted and is never assigned (CAL-AC-10); one that
    /// matches again clears its drift and is assigned with no new adoption.
    /// Nothing to assign writes nothing.
    ///
    /// # Errors
    /// As [`Self::set_required_kinds`]; a top input that cannot be read is no
    /// error but a blocked requirement of the outcome.
    // One read, hash and write pass per loop turn; splitting it would spread
    // the snapshot, the off-lock hashing and the re-checked write apart.
    #[allow(clippy::cognitive_complexity)]
    pub async fn assign_calibration<R, P>(
        &self,
        view: Uuid,
        revision: Revision,
        expected: Revision,
        rules: &R,
        probe: P,
    ) -> Result<CalibrationAssignment>
    where
        R: CalibrationRules + ?Sized,
        P: SourceProbe,
    {
        let probe = Arc::new(probe);
        let mut expected = expected;
        let mut hashed: BTreeMap<InputRef, Outcome> = BTreeMap::new();
        let mut assigned = Vec::new();
        loop {
            let (plan, work) = {
                let mut conn = self.reader().await?;
                let mut snapshot = conn.begin().await?;
                let (run, _) = require_writable(&mut snapshot, view, revision, expected).await?;
                let (basis, listed) = view_basis(&mut snapshot, &run, revision, rules).await?;
                let plan = rules.plan(&basis);
                let mut work = Work::default();
                for input in wanted_inputs(&plan) {
                    if !hashed.contains_key(&input) {
                        work.add(&mut snapshot, input, &listed).await?;
                    }
                }
                snapshot.rollback().await?;
                (plan, work)
            };
            let assignable = plan.requirements.iter().any(|requirement| {
                requirement
                    .automatic
                    .is_some_and(|input| matches!(hashed.get(&input), Some(Outcome::Read(_))))
            });
            if work.inputs.is_empty() && !assignable {
                let blocked = blocked_requirements(&plan, &hashed);
                let drifted = hashed
                    .iter()
                    .filter(|(_, outcome)| matches!(outcome, Outcome::Drifted(_)))
                    .map(|(input, _)| input.id())
                    .collect();
                return Ok(CalibrationAssignment { plan, assigned, drifted, blocked });
            }
            let fresh = {
                let probe = Arc::clone(&probe);
                blocking(move || Ok(work.hash(&*probe))).await?
            };
            let mut observed = Vec::new();
            for (input, result) in fresh {
                let outcome = Outcome::of(input, result);
                if let InputRef::Master { master_id, .. } = input {
                    match &outcome {
                        Outcome::Read(_) => observed.push((master_id, None)),
                        Outcome::Drifted(detail) => {
                            observed.push((master_id, Some(detail.clone())));
                        }
                        Outcome::Blocked(_) => {}
                    }
                }
                hashed.insert(input, outcome);
            }
            let (next, round) = write_txn!(self, |conn| {
                let (run, plan) = require_writable(conn, view, revision, expected).await?;
                let decided_at = now()?;
                let mut changed = false;
                for (master, drift) in &observed {
                    changed |= record_drift(conn, *master, drift.as_deref(), &decided_at).await?;
                }
                let (basis, _) = view_basis(conn, &run, revision, rules).await?;
                let current = rules.plan(&basis);
                let next = plan.revision + 1;
                let mut round = Vec::new();
                for requirement in &current.requirements {
                    let Some(input) = requirement.automatic else { continue };
                    let Some(Outcome::Read(files)) = hashed.get(&input) else { continue };
                    let candidate = candidate_of(requirement, input)?;
                    let inputs = bind_digests(conn, files, &decided_at).await?;
                    insert_decision(
                        conn,
                        &decision(
                            &run,
                            revision,
                            requirement,
                            Resolution::Automatic,
                            Some(input),
                            inputs,
                            candidate,
                            None,
                            next,
                            &decided_at,
                        ),
                    )
                    .await?;
                    round.push(requirement.key());
                }
                if changed || !round.is_empty() {
                    write_plan(conn, view, next, &plan.required_kinds, &decided_at).await?;
                    (next, round)
                } else {
                    (plan.revision, round)
                }
            });
            expected = next;
            assigned.extend(round);
        }
    }

    /// The user's choice of an input per requirement in Review matches: a
    /// suggestion accepted, or an automatic assignment replaced (CAL-FR-05).
    /// Any listed reusable candidate of the run's camera can be chosen; one
    /// with an unknown or incompatible criterion reads needs review until an
    /// exception is recorded (CAL-AC-02). Every input file is hashed off the
    /// writer lock first; the write binds each digest and records the basis
    /// and the criteria snapshot. All or nothing.
    ///
    /// # Errors
    /// `InvalidInput` for an item that names no requirement or an input that
    /// is not a listed reusable candidate (a detected master included);
    /// `Conflict` for stale revisions or inputs; `IdentityConflict` (a drifted
    /// adopted master included), `SourceUnavailable`, `AccessDenied` or
    /// `NotFound` naming each blocked file.
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

    /// Record a reasoned exception scoped to this run, light group, kind and
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

    /// Exclude requirements without an input (CAL-FR-05): PREP prepares those
    /// light groups without that kind. The optional reason is kept.
    ///
    /// # Errors
    /// `InvalidInput` for an empty or repeated batch, a blank reason or a
    /// requirement the revision does not have; `Conflict` and `NotFound` as
    /// for every write.
    pub async fn exclude_calibration<R: CalibrationRules + ?Sized>(
        &self,
        view: Uuid,
        revision: Revision,
        expected: Revision,
        items: &[RequirementKey],
        reason: Option<&str>,
        rules: &R,
    ) -> Result<CalibrationViewPlan> {
        RequirementKey::validate(items)?;
        let reason = reason.map(exception_reason).transpose()?;
        self.append(view, revision, expected, items, Resolution::Excluded, reason, rules).await
    }

    /// End effective decisions by appending `withdrawn` rows; earlier rows
    /// stay. A withdrawn requirement reads its suggestion again and is not
    /// matched automatically until its light group changes.
    ///
    /// # Errors
    /// `InvalidInput` for an empty or repeated batch or a requirement without
    /// an effective decision; `Conflict` and `NotFound` as for every write.
    pub async fn withdraw_calibration<R: CalibrationRules + ?Sized>(
        &self,
        view: Uuid,
        revision: Revision,
        expected: Revision,
        items: &[RequirementKey],
        rules: &R,
    ) -> Result<CalibrationViewPlan> {
        RequirementKey::validate(items)?;
        self.append(view, revision, expected, items, Resolution::Withdrawn, None, rules).await
    }

    /// Calibration-matching evidence of a Project's candidate sessions per
    /// subject and channel (CAL-FR-12): the kinds some light group has no
    /// fully compatible input for and an exposure mismatch. Each rig's
    /// candidates are matched as that rig's run would be. It assigns nothing,
    /// writes nothing and hashes nothing.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project.
    pub async fn project_calibration_evidence<R: CalibrationRules + ?Sized>(
        &self,
        project: Uuid,
        rules: &R,
    ) -> Result<ProjectCalibrationEvidence> {
        let (order, by_rig) = self.project_rig_requirements(project, rules).await?;
        let mut rows: Vec<SubjectChannelEvidence> = Vec::new();
        for RigRequirements { subject_id, rig_id, requirements } in by_rig {
            for requirement in requirements {
                let channel = requirement.light_group.channel.clone();
                let index = rows
                    .iter()
                    .position(|row| row.subject_id == subject_id && row.channel == channel)
                    .unwrap_or_else(|| {
                        rows.push(SubjectChannelEvidence {
                            subject_id,
                            channel,
                            rig_ids: Vec::new(),
                            light_session_ids: Vec::new(),
                            missing: Vec::new(),
                            exposure_mismatch: false,
                            light_exposures: Vec::new(),
                            dark_exposures: Vec::new(),
                        });
                        rows.len() - 1
                    });
                merge_evidence(&mut rows[index], rig_id, &requirement);
            }
        }
        rows.sort_by(|a, b| {
            subject_position(&order, a.subject_id)
                .cmp(&subject_position(&order, b.subject_id))
                .then_with(|| a.channel.cmp(&b.channel))
        });
        Ok(ProjectCalibrationEvidence { project_id: project, rows })
    }

    /// The exposure-mismatch warnings of a Project's candidate sessions, one
    /// per subject, rig and channel with a mismatching dark requirement
    /// (PRJ-FR-11, [`Requirement::exposure_mismatch`]). Each rig's candidates
    /// are matched as that rig's run would be, so one rig's darks never hide
    /// or raise another rig's warning. By subject order, then channel with
    /// `None` last, then rig. Assigns, writes and hashes nothing.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project.
    pub async fn project_exposure_warnings<R: CalibrationRules + ?Sized>(
        &self,
        project: Uuid,
        rules: &R,
    ) -> Result<Vec<ProjectWarning>> {
        let (order, by_rig) = self.project_rig_requirements(project, rules).await?;
        let mut warnings = Vec::new();
        for RigRequirements { subject_id, rig_id, requirements } in by_rig {
            let mut channels: BTreeMap<Option<String>, (BTreeSet<String>, BTreeSet<String>)> =
                BTreeMap::new();
            for requirement in requirements.iter().filter(|r| r.exposure_mismatch()) {
                let (light, dark) = requirement.mismatched_exposures();
                let entry = channels.entry(requirement.light_group.channel.clone()).or_default();
                entry.0.extend(light);
                entry.1.extend(dark);
            }
            warnings.extend(channels.into_iter().map(|(channel, (light, dark))| {
                ProjectWarning::ExposureMismatch {
                    subject_id,
                    rig_id,
                    channel,
                    light_exposures: ascending(light),
                    dark_exposures: ascending(dark),
                }
            }));
        }
        let key = |warning: &ProjectWarning| match warning {
            ProjectWarning::ExposureMismatch { subject_id, channel, .. } => {
                (subject_position(&order, *subject_id), channel.is_none(), channel.clone())
            }
        };
        warnings.sort_by_key(key);
        Ok(warnings)
    }

    /// The calibration requirements of each subject's candidate lights per
    /// Project rig, matched as that rig's run would be, with the subjects in
    /// candidate order. One snapshot; nothing is assigned or hashed.
    async fn project_rig_requirements<R: CalibrationRules + ?Sized>(
        &self,
        project: Uuid,
        rules: &R,
    ) -> Result<(Vec<Uuid>, Vec<RigRequirements>)> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        projects::require_project(&mut snapshot, project).await?;
        let found = projects::candidates(&mut snapshot, project).await?;
        let listed = inventory::list_inputs(&mut snapshot, rules).await?;
        let candidates: Vec<_> = listed.iter().map(Listed::candidate).collect();
        let mut by_rig: Vec<((Uuid, Uuid), Vec<platevault_model::LightBasis>)> = Vec::new();
        for candidate in &found {
            let assets: BTreeSet<Uuid> = candidate.asset_ids.iter().copied().collect();
            let Some(mut light) = light_basis(&mut snapshot, candidate.session_id, &assets).await?
            else {
                continue;
            };
            light.evidence.capture.confirmed_equipment = Some(candidate.rig_id);
            let key = (candidate.subject_id, candidate.rig_id);
            match by_rig.iter_mut().find(|(k, _)| *k == key) {
                Some((_, lights)) => lights.push(light),
                None => by_rig.push((key, vec![light])),
            }
        }
        snapshot.rollback().await?;

        let requirements = by_rig
            .into_iter()
            .map(|((subject_id, rig_id), lights)| {
                let basis = CalibrationViewBasis {
                    view_id: Uuid::nil(),
                    view_revision: 0,
                    plan: CalibrationPlan {
                        policy: CalibrationPolicy::Manual,
                        ..CalibrationPlan::unplanned(Uuid::nil())
                    },
                    lights,
                    candidates: candidates.clone(),
                    decisions: Vec::new(),
                };
                RigRequirements {
                    subject_id,
                    rig_id,
                    requirements: rules.plan(&basis).requirements,
                }
            })
            .collect();
        let order = found.iter().map(|candidate| candidate.subject_id).collect();
        Ok((order, requirements))
    }

    /// Accept (`reason` absent) or except (`reason` present) a batch of items.
    #[allow(clippy::too_many_arguments, clippy::cognitive_complexity)]
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
        let work = {
            let mut conn = self.reader().await?;
            let mut snapshot = conn.begin().await?;
            let (run, _) = require_writable(&mut snapshot, view, revision, expected).await?;
            let (basis, listed) = view_basis(&mut snapshot, &run, revision, rules).await?;
            let current = rules.plan(&basis);
            let mut work = Work::default();
            for item in items {
                chosen(&current, item, exception)?;
                work.add(&mut snapshot, item.input, &listed).await?;
            }
            snapshot.rollback().await?;
            work
        };
        let mut read = BTreeMap::new();
        let mut blocked = Vec::new();
        for (input, result) in blocking(move || Ok(work.hash(&probe))).await? {
            match result {
                Ok(files) => {
                    read.insert(input, files);
                }
                Err(errors) => blocked.extend(errors),
            }
        }
        match blocked.len() {
            0 => {}
            1 => return Err(blocked.remove(0)),
            count => return Err(combined(count, &blocked)),
        }
        Ok(write_txn!(self, |conn| {
            let (run, plan) = require_writable(conn, view, revision, expected).await?;
            let (basis, _) = view_basis(conn, &run, revision, rules).await?;
            let current = rules.plan(&basis);
            let decided_at = now()?;
            let next = plan.revision + 1;
            for item in items {
                let (requirement, candidate) = chosen(&current, item, exception)?;
                let files = read.get(&item.input).map_or(&[][..], Vec::as_slice);
                let inputs = bind_digests(conn, files, &decided_at).await?;
                if let InputRef::Master { master_id, .. } = item.input {
                    record_drift(conn, master_id, None, &decided_at).await?;
                }
                let resolution =
                    if exception { Resolution::Exception } else { Resolution::Accepted };
                insert_decision(
                    conn,
                    &decision(
                        &run,
                        revision,
                        requirement,
                        resolution,
                        Some(item.input),
                        inputs,
                        candidate,
                        reason.clone(),
                        next,
                        &decided_at,
                    ),
                )
                .await?;
            }
            write_plan(conn, view, next, &plan.required_kinds, &decided_at).await?;
            let (basis, _) = view_basis(conn, &run, revision, rules).await?;
            rules.plan(&basis)
        }))
    }

    /// Append an input-free `excluded` or `withdrawn` row per requirement.
    #[allow(clippy::too_many_arguments)]
    async fn append<R: CalibrationRules + ?Sized>(
        &self,
        view: Uuid,
        revision: Revision,
        expected: Revision,
        items: &[RequirementKey],
        resolution: Resolution,
        reason: Option<String>,
        rules: &R,
    ) -> Result<CalibrationViewPlan> {
        Ok(write_txn!(self, |conn| {
            let (run, plan) = require_writable(conn, view, revision, expected).await?;
            let (basis, _) = view_basis(conn, &run, revision, rules).await?;
            let current = rules.plan(&basis);
            let decided_at = now()?;
            let next = plan.revision + 1;
            for item in items {
                let requirement = requirement_of(&current, &item.light_group, item.kind)?;
                if resolution == Resolution::Withdrawn && requirement.effective.is_none() {
                    return Err(LibraryError::InvalidInput(format!(
                        "the {} requirement of light group {} has no decision to withdraw",
                        item.kind.as_str(),
                        group_label(&item.light_group)
                    )));
                }
                let row = CalibrationDecision {
                    id: Uuid::new_v4(),
                    view_id: run.id,
                    view_revision: revision,
                    light_group: requirement.light_group.clone(),
                    light_session_ids: requirement.light_session_ids.iter().copied().collect(),
                    light_asset_ids: requirement.light_asset_ids.clone(),
                    kind: item.kind,
                    resolution,
                    input: None,
                    inputs: Vec::new(),
                    criteria: Vec::new(),
                    reason: reason.clone(),
                    plan_revision: next,
                    decided_at: decided_at.clone(),
                };
                insert_decision(conn, &row).await?;
            }
            write_plan(conn, view, next, &plan.required_kinds, &decided_at).await?;
            let (basis, _) = view_basis(conn, &run, revision, rules).await?;
            rules.plan(&basis)
        }))
    }
}

/// The calibration requirements of one subject's candidate lights on one
/// Project rig.
struct RigRequirements {
    subject_id: Uuid,
    rig_id: Uuid,
    requirements: Vec<Requirement>,
}

/// Where `subject` stands in the Project's candidate order.
fn subject_position(order: &[Uuid], subject: Uuid) -> Option<usize> {
    order.iter().position(|id| *id == subject)
}

/// Canonical decimal seconds in ascending value.
fn ascending(values: BTreeSet<String>) -> Vec<String> {
    let mut values: Vec<String> = values.into_iter().collect();
    values.sort_by(|left, right| match (left.parse::<f64>(), right.parse::<f64>()) {
        (Ok(left), Ok(right)) => left.total_cmp(&right),
        _ => left.cmp(right),
    });
    values
}

/// Fold one rig's requirement into its subject and channel row.
fn merge_evidence(row: &mut SubjectChannelEvidence, rig: Uuid, requirement: &Requirement) {
    if !row.rig_ids.contains(&rig) {
        row.rig_ids.push(rig);
    }
    for session in &requirement.light_session_ids {
        if !row.light_session_ids.contains(session) {
            row.light_session_ids.push(*session);
        }
    }
    if requirement.missing_input() && !row.missing.contains(&requirement.kind) {
        row.missing.push(requirement.kind);
        row.missing.sort();
    }
    if requirement.exposure_mismatch() {
        row.exposure_mismatch = true;
        let (light, dark) = requirement.mismatched_exposures();
        let merge = |into: &mut Vec<String>, values: BTreeSet<String>| {
            into.extend(values);
            into.sort();
            into.dedup();
        };
        merge(&mut row.light_exposures, light);
        merge(&mut row.dark_exposures, dark);
    }
}

/// The inputs an automatic match reads: every input the planner names for
/// automatic assignment, and every fully compatible available master of a
/// requirement that reads drifted, so restored bytes are seen again.
fn wanted_inputs(plan: &CalibrationViewPlan) -> BTreeSet<InputRef> {
    let mut inputs: BTreeSet<InputRef> =
        plan.requirements.iter().filter_map(|requirement| requirement.automatic).collect();
    for requirement in &plan.requirements {
        if requirement.reason != Some(UnresolvedReason::MasterDrifted) {
            continue;
        }
        inputs.extend(
            requirement
                .candidates
                .iter()
                .filter(|c| {
                    c.state.drifted
                        && c.evaluation.verdict == Verdict::Compatible
                        && c.state.available()
                })
                .filter_map(|c| c.candidate.input()),
        );
    }
    inputs
}

/// Requirements named for automatic assignment whose input could not be read.
fn blocked_requirements(
    plan: &CalibrationViewPlan,
    hashed: &BTreeMap<InputRef, Outcome>,
) -> Vec<BlockedRequirement> {
    plan.requirements
        .iter()
        .filter_map(|requirement| match hashed.get(&requirement.automatic?) {
            Some(Outcome::Blocked(error)) => {
                Some(BlockedRequirement { requirement: requirement.key(), error: error.clone() })
            }
            _ => None,
        })
        .collect()
}

/// Writes name the latest committed revision of a run outside the Trash that
/// is not Complete, and the current plan revision.
async fn require_writable(
    conn: &mut SqliteConnection,
    view: Uuid,
    revision: Revision,
    expected: Revision,
) -> Result<(View, CalibrationPlan)> {
    let run = load_view(conn, view).await?;
    require_open_run(&run)?;
    committed_header(conn, view, revision).await?;
    if run.revision != revision {
        return Err(conflict(view, run.revision));
    }
    let plan = load_plan(conn, &run).await?;
    require_revision(view, plan.revision, expected)?;
    Ok((run, plan))
}

/// A run whose calibration may change: outside the Trash and not Complete.
fn require_open_run(run: &View) -> Result<()> {
    if run.trashed_at.is_some() {
        return Err(LibraryError::InvalidInput(format!(
            "run {} is in the Project's Trash; restore it before changing its calibration",
            run.id
        )));
    }
    if run.completion == RunCompletion::Complete {
        return Err(LibraryError::InvalidInput(format!(
            "run {} is Complete; reopen it before changing its calibration",
            run.id
        )));
    }
    Ok(())
}

/// The evidence the planner reads for committed revision `revision` of
/// `run`, with the listed inputs it was built from. Each light carries the
/// run's rig as its Confirmed Equipment (D-W37) and only its member copies
/// outside the Trash (LIB-FR-18).
pub async fn view_basis<R: CalibrationRules + ?Sized>(
    conn: &mut SqliteConnection,
    run: &View,
    revision: Revision,
    rules: &R,
) -> Result<(CalibrationViewBasis, Vec<Listed>)> {
    let (row, _) = committed_header(conn, run.id, revision).await?;
    let mut included: BTreeMap<Uuid, BTreeSet<Uuid>> = BTreeMap::new();
    for member in load_members(conn, row).await? {
        if member.state == MemberState::Included {
            included
                .entry(member.session_id)
                .or_default()
                .extend(member.copies.iter().map(|copy| copy.asset_id));
        }
    }
    let copies: BTreeSet<Uuid> = included.values().flatten().copied().collect();
    let live: BTreeSet<Uuid> =
        live_assets(conn, &copies).await?.into_iter().map(|asset| asset.id).collect();
    for assets in included.values_mut() {
        assets.retain(|asset| live.contains(asset));
    }
    let mut lights = Vec::with_capacity(included.len());
    for (session, assets) in &included {
        if let Some(mut light) = light_basis(conn, *session, assets).await? {
            light.evidence.capture.confirmed_equipment = Some(run.rig_id);
            lights.push(light);
        }
    }
    let listed = inventory::list_inputs(conn, rules).await?;
    let decisions = latest_decisions(conn, run.id).await?;
    let drifted = drifted_masters(conn).await?;
    let mut candidates: Vec<_> = listed.iter().map(Listed::candidate).collect();
    candidates.extend(inventory::unlisted_inputs(conn, &decisions, &listed, rules).await?);
    for candidate in &mut candidates {
        if let CandidateRef::Master { master_id, .. } = candidate.candidate {
            candidate.state.drifted = drifted.contains(&master_id);
        }
    }
    let basis = CalibrationViewBasis {
        view_id: run.id,
        view_revision: revision,
        plan: load_plan(conn, run).await?,
        lights,
        candidates,
        decisions,
    };
    Ok((basis, listed))
}

/// The run's calibration plan with its policy; revision 0 with dark and flat
/// without a row.
pub async fn load_plan(conn: &mut SqliteConnection, run: &View) -> Result<CalibrationPlan> {
    let row = sqlx::query(
        "SELECT revision, required_kinds, updated_at FROM calibration_plans WHERE view_id = ?1",
    )
    .bind(run.id.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    let plan = match row {
        None => CalibrationPlan::unplanned(run.id),
        Some(row) => CalibrationPlan {
            view_id: run.id,
            revision: revision(row.try_get("revision")?)?,
            required_kinds: from_json(&row.try_get::<String, _>("required_kinds")?)?,
            policy: run.calibration_policy,
            updated_at: row.try_get("updated_at")?,
        },
    };
    Ok(CalibrationPlan { policy: run.calibration_policy, ..plan })
}

/// The latest decision per light group and kind of `view`, any revision.
pub async fn latest_decisions(
    conn: &mut SqliteConnection,
    view: Uuid,
) -> Result<Vec<CalibrationDecision>> {
    let rows = sqlx::query(
        "SELECT * FROM calibration_decisions d WHERE d.view_id = ?1 AND d.rowid = \
         (SELECT MAX(rowid) FROM calibration_decisions WHERE view_id = d.view_id \
         AND light_group = d.light_group AND kind = d.kind) \
         ORDER BY d.light_group, d.kind",
    )
    .bind(view.to_string())
    .fetch_all(&mut *conn)
    .await?;
    rows.iter().map(decision_from_row).collect()
}

fn decision_from_row(row: &SqliteRow) -> Result<CalibrationDecision> {
    let input: Option<String> = row.try_get("input")?;
    Ok(CalibrationDecision {
        id: parse_uuid(&row.try_get::<String, _>("id")?)?,
        view_id: parse_uuid(&row.try_get::<String, _>("view_id")?)?,
        view_revision: revision(row.try_get("view_revision")?)?,
        light_group: from_json(&row.try_get::<String, _>("light_group")?)?,
        light_session_ids: from_json(&row.try_get::<String, _>("light_session_ids")?)?,
        light_asset_ids: from_json(&row.try_get::<String, _>("light_asset_ids")?)?,
        kind: from_text(&row.try_get::<String, _>("kind")?)?,
        resolution: from_text(&row.try_get::<String, _>("resolution")?)?,
        input: input.as_deref().map(from_json::<InputRef>).transpose()?,
        inputs: from_json(&row.try_get::<String, _>("inputs")?)?,
        criteria: from_json(&row.try_get::<String, _>("criteria")?)?,
        reason: row.try_get("reason")?,
        plan_revision: revision(row.try_get("plan_revision")?)?,
        decided_at: row.try_get("decided_at")?,
    })
}

/// Adopted masters whose library copy last read drifted at assignment.
async fn drifted_masters(conn: &mut SqliteConnection) -> Result<BTreeSet<Uuid>> {
    let ids: Vec<String> = sqlx::query_scalar("SELECT master_id FROM calibration_master_drift")
        .fetch_all(&mut *conn)
        .await?;
    ids.iter().map(|id| parse_uuid(id)).collect()
}

/// Record (`detail` present) or clear a master's drift; `true` when it changed.
async fn record_drift(
    conn: &mut SqliteConnection,
    master: Uuid,
    detail: Option<&str>,
    observed_at: &str,
) -> Result<bool> {
    let known: Option<String> =
        sqlx::query_scalar("SELECT detail FROM calibration_master_drift WHERE master_id = ?1")
            .bind(master.to_string())
            .fetch_optional(&mut *conn)
            .await?;
    match (detail, known) {
        (None, None) | (Some(_), Some(_)) => Ok(false),
        (None, Some(_)) => {
            sqlx::query("DELETE FROM calibration_master_drift WHERE master_id = ?1")
                .bind(master.to_string())
                .execute(&mut *conn)
                .await?;
            Ok(true)
        }
        (Some(detail), None) => {
            sqlx::query(
                "INSERT INTO calibration_master_drift (master_id, detail, observed_at) \
                 VALUES (?1, ?2, ?3)",
            )
            .bind(master.to_string())
            .bind(detail)
            .bind(observed_at)
            .execute(&mut *conn)
            .await?;
            Ok(true)
        }
    }
}

fn label<T: Serialize>(value: &T) -> String {
    to_text(value).unwrap_or_default()
}

fn group_label(group: &LightGroupKey) -> String {
    format!(
        "{} {} s",
        group.channel.as_deref().unwrap_or("(no filter)"),
        group.exposure.as_deref().unwrap_or("?")
    )
}

fn requirement_of<'a>(
    plan: &'a CalibrationViewPlan,
    group: &LightGroupKey,
    kind: InputKind,
) -> Result<&'a Requirement> {
    plan.requirements
        .iter()
        .find(|requirement| requirement.light_group == *group && requirement.kind == kind)
        .ok_or_else(|| {
            LibraryError::InvalidInput(format!(
                "light group {} has no {} requirement at run revision {}",
                group_label(group),
                kind.as_str(),
                plan.view_revision
            ))
        })
}

/// The listed reusable candidate an item names, with the verdict its
/// resolution needs: an exception needs a criterion that is not compatible.
fn chosen<'a>(
    plan: &'a CalibrationViewPlan,
    item: &DecisionItem,
    exception: bool,
) -> Result<(&'a Requirement, &'a CandidateEvaluation)> {
    let requirement = requirement_of(plan, &item.light_group, item.kind)?;
    let kind = item.kind.as_str();
    let input = format!("{} {}", label(&item.input.form()), item.input.id());
    let wanted = CandidateRef::from(item.input);
    let Some(candidate) = requirement.candidates.iter().find(|c| c.candidate == wanted) else {
        if let Some(current) =
            requirement.candidates.iter().find(|c| c.candidate.id() == item.input.id())
        {
            let current = current.candidate.input().map_or(0, |input| input.revision());
            return Err(conflict(item.input.id(), current));
        }
        return Err(LibraryError::InvalidInput(format!(
            "{input} is not a listed {kind} candidate of light group {}; a detected master is \
             adopted before it is chosen, and another camera's inputs are never candidates",
            group_label(&item.light_group)
        )));
    };
    if exception && candidate.evaluation.verdict == Verdict::Compatible {
        return Err(LibraryError::InvalidInput(format!(
            "every criterion of {input} is compatible with light group {} for {kind}; accept it \
             instead of recording an exception",
            group_label(&item.light_group)
        )));
    }
    Ok((requirement, candidate))
}

fn candidate_of(requirement: &Requirement, input: InputRef) -> Result<&CandidateEvaluation> {
    let wanted = CandidateRef::from(input);
    requirement.candidates.iter().find(|c| c.candidate == wanted).ok_or_else(|| {
        LibraryError::PersistenceFailure(format!(
            "the automatic input {} is not a candidate of its requirement",
            input.id()
        ))
    })
}

#[allow(clippy::too_many_arguments)]
fn decision(
    run: &View,
    revision: Revision,
    requirement: &Requirement,
    resolution: Resolution,
    input: Option<InputRef>,
    inputs: Vec<CalibrationInputFile>,
    candidate: &CandidateEvaluation,
    reason: Option<String>,
    plan_revision: Revision,
    decided_at: &str,
) -> CalibrationDecision {
    CalibrationDecision {
        id: Uuid::new_v4(),
        view_id: run.id,
        view_revision: revision,
        light_group: requirement.light_group.clone(),
        light_session_ids: requirement.light_session_ids.iter().copied().collect(),
        light_asset_ids: requirement.light_asset_ids.clone(),
        kind: requirement.kind,
        resolution,
        input,
        inputs,
        criteria: candidate.evaluation.criteria.clone(),
        reason,
        plan_revision,
        decided_at: decided_at.to_owned(),
    }
}

/// One file an input binds, as recorded before hashing.
#[derive(Clone)]
struct FileWork {
    asset_id: Option<Uuid>,
    master_id: Option<Uuid>,
    root: SourceRoot,
    relative: PathBuf,
    native: NativePath,
    fingerprint: ObservationFingerprint,
    expected: Option<ExpectedAsset>,
}

/// A file whose current bytes hashed against its recorded observation.
#[derive(Clone)]
struct Hashed {
    key: Uuid,
    file: FileWork,
    sha256: String,
}

/// One input's files and the members that have no readable copy.
#[derive(Default)]
struct InputWork {
    keys: Vec<Uuid>,
    blocked: Vec<LibraryError>,
}

/// The files of a batch of inputs, each distinct file once.
#[derive(Default)]
struct Work {
    files: BTreeMap<Uuid, FileWork>,
    inputs: BTreeMap<InputRef, InputWork>,
}

/// How reading an input settled for the automatic match.
enum Outcome {
    Read(Vec<Hashed>),
    /// An adopted master whose bytes differ from its adoption record.
    Drifted(String),
    Blocked(ErrorResponse),
}

impl Outcome {
    fn of(input: InputRef, result: std::result::Result<Vec<Hashed>, Vec<LibraryError>>) -> Self {
        match result {
            Ok(files) => Self::Read(files),
            Err(mut errors) => {
                let error = if errors.len() == 1 {
                    errors.remove(0)
                } else {
                    combined(errors.len(), &errors)
                };
                let response = error.response(None, None);
                if input.form() == platevault_model::InputForm::Master
                    && response.kind == "identity_conflict"
                {
                    Self::Drifted(error.to_string())
                } else {
                    Self::Blocked(response)
                }
            }
        }
    }
}

impl Work {
    async fn add(
        &mut self,
        conn: &mut SqliteConnection,
        input: InputRef,
        listed: &[Listed],
    ) -> Result<()> {
        let mut work = InputWork::default();
        match input {
            InputRef::RawSet { session_id, .. } => {
                let wanted = CandidateRef::from(input);
                let raw = listed.iter().find(|listed| listed.summary.input == wanted).ok_or_else(
                    || {
                        LibraryError::InvalidInput(format!(
                            "raw set {session_id} is not a listed calibration input"
                        ))
                    },
                )?;
                let mut chosen = BTreeSet::new();
                for member in &raw.members {
                    let available = member
                        .copies
                        .iter()
                        .find(|copy| copy.availability == Availability::Available);
                    match (available, member.copies.first()) {
                        (Some(copy), _) => {
                            chosen.insert(copy.asset_id);
                        }
                        (None, Some(copy)) => work.blocked.push(scoped(
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
                    work.keys.push(asset.id);
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
                work.keys.push(master.id);
                if location.availability != Availability::Available {
                    work.blocked.push(scoped(
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
        self.inputs.insert(input, work);
        Ok(())
    }

    /// Hash every distinct file once and settle each input: its hashed files,
    /// or every refusal among them. An adopted master is hashed against its
    /// adoption digest, so different bytes refuse as an identity conflict.
    fn hash<P: SourceProbe>(
        self,
        probe: &P,
    ) -> BTreeMap<InputRef, std::result::Result<Vec<Hashed>, Vec<LibraryError>>> {
        let mut read: BTreeMap<Uuid, Result<Hashed>> = BTreeMap::new();
        for (key, file) in self.files {
            let digest = file
                .root
                .verify(probe)
                .and_then(|()| current_digest(&file.root, &file.relative, &file.fingerprint, probe))
                .and_then(|sha256| file.root.verify(probe).map(|()| sha256));
            let result = match digest {
                Ok(sha256) => Ok(Hashed { key, file, sha256 }),
                Err(error) => Err(scoped(error, file.root.source(&file.relative), Some(key))),
            };
            read.insert(key, result);
        }
        self.inputs
            .into_iter()
            .map(|(input, work)| {
                let mut blocked = work.blocked;
                let mut files = Vec::with_capacity(work.keys.len());
                for key in work.keys {
                    match read.get(&key) {
                        Some(Ok(hashed)) => files.push(hashed.clone()),
                        Some(Err(_)) => {
                            if let Some(Err(error)) = read.remove(&key) {
                                blocked.push(error);
                            }
                        }
                        None => {}
                    }
                }
                (input, if blocked.is_empty() { Ok(files) } else { Err(blocked) })
            })
            .collect()
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
/// and `last_verified_at` as `verify_digest` does; files of equal content are
/// bound once.
async fn bind_digests(
    conn: &mut SqliteConnection,
    hashed: &[Hashed],
    verified_at: &str,
) -> Result<Vec<CalibrationInputFile>> {
    let mut bound = Vec::with_capacity(hashed.len());
    let mut digests = BTreeSet::new();
    for Hashed { key, file, sha256 } in hashed {
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
        if digests.insert(sha256.clone()) {
            bound.push(CalibrationInputFile {
                asset_id: file.asset_id,
                master_id: file.master_id,
                location_id: file.root.location.id,
                relative_path: file.native.clone(),
                fingerprint,
            });
        }
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
        "INSERT INTO calibration_decisions (id, view_id, view_revision, light_group, \
         light_session_ids, light_asset_ids, kind, resolution, input, input_session_id, \
         input_master_id, inputs, criteria, reason, plan_revision, decided_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
    )
    .bind(decision.id.to_string())
    .bind(decision.view_id.to_string())
    .bind(db_revision(decision.view_revision)?)
    .bind(to_json(&decision.light_group)?)
    .bind(to_json(&decision.light_session_ids)?)
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
