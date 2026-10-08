// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Pure calibration semantics (spec 068): classification, exact D13 criterion
//! evaluation, candidate order, preselection and R13 applicability.
//!
//! Nothing here reads storage, the clock or settings. The catalog receives
//! [`Rules`] as a [`CalibrationRules`] trait object and evaluates inside its
//! own snapshot, the way it receives the grouping callback.

use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::sync::LazyLock;

use calibration_master_detect::{detect_master, DetectInput};
use metadata_core::{v1_normalization_table, ImageTypNormalizationTable};
use time::macros::format_description;
use time::Date;

use crate::{
    light_groups, CalibrationDecision, CalibrationPolicy, CalibrationRules, CalibrationViewBasis,
    CalibrationViewPlan, CandidateEvaluation, CandidateRef, CaptureEvidence, CaptureMetadata,
    Classification, CriterionId, CriterionResult, EffectiveDecision, Evaluation, EvidenceField,
    EvidenceId, EvidenceRow, InputCandidate, InputEvidence, InputForm, InputKind, LightEvidence,
    LightGroup, MasterBasis, MasterEvidence, NativePath, Requirement, RequirementState, Resolution,
    Tolerance, UnresolvedReason, Verdict,
};

/// The calibration rules the product uses.
#[derive(Clone, Copy, Debug, Default)]
pub struct Rules;

impl CalibrationRules for Rules {
    fn classify(
        &self,
        effective: &CaptureMetadata,
        relative_path: &NativePath,
    ) -> Option<Classification> {
        classify(effective, relative_path)
    }

    fn evaluate(
        &self,
        kind: InputKind,
        light: &LightEvidence,
        input: &InputEvidence,
    ) -> Evaluation {
        evaluate(kind, light, input)
    }

    fn plan(&self, basis: &CalibrationViewBasis) -> CalibrationViewPlan {
        plan(basis)
    }
}

// ── Classification (R2, R3, R4) ──────────────────────────────────────────────

static TABLE: LazyLock<ImageTypNormalizationTable> = LazyLock::new(v1_normalization_table);

/// A present `STACKCNT`/`NCOMBINE` decides alone; without one an IMAGETYP
/// `master` token is header evidence and the name alone is labelled inference.
fn classify(effective: &CaptureMetadata, relative_path: &NativePath) -> Option<Classification> {
    let image_type = effective.image_type.as_deref().map(str::trim).filter(|t| !t.is_empty());
    let relative = relative_path.display();
    let file_name = relative.rsplit(['/', '\\']).next().unwrap_or_default();
    let count = effective.stack_count;
    let basis = match count {
        Some(count) => (count > 1).then_some(MasterBasis::HeaderStackCount),
        None if image_type.is_some_and(has_master_token) => Some(MasterBasis::HeaderImagetyp),
        None if calibration_master_detect::path_looks_like_master(file_name, &relative) => {
            Some(MasterBasis::NameOnly)
        }
        None => None,
    };
    let Some(basis) = basis else {
        let kind = InputKind::from_frame_type(TABLE.normalize(image_type?)?)?;
        return Some(Classification { kind, master: None });
    };
    let detection = detect_master(&DetectInput {
        imagetyp: image_type,
        stack_count: count,
        file_name,
        rel_path: &relative,
    })?;
    let kind = InputKind::from_frame_type(detection.frame_type)?;
    Some(Classification {
        kind,
        master: Some(MasterEvidence {
            basis,
            stack_count: count,
            detector: detection.detector.to_owned(),
        }),
    })
}

/// Whole-token `master`, its plural, or `master` joined to a frame word.
fn has_master_token(image_type: &str) -> bool {
    image_type.to_ascii_lowercase().split(|c: char| !c.is_ascii_alphanumeric()).any(|token| {
        let Some(rest) = token.strip_prefix("master") else { return false };
        let rest = rest.strip_suffix('s').unwrap_or(rest);
        matches!(rest, "" | "dark" | "bias" | "offset" | "flat" | "light" | "darkflat")
    })
}

// ── Criteria (D13, R6 to R9) ─────────────────────────────────────────────────

fn evaluate(kind: InputKind, light: &LightEvidence, input: &InputEvidence) -> Evaluation {
    let (light, other) = (&light.capture, &input.capture);
    let mut criteria = vec![
        image_type(kind, input),
        camera(light, other),
        pair(
            CriterionId::Dimensions,
            light,
            other,
            EvidenceField::Width,
            EvidenceField::Height,
            "x",
        ),
        pair(
            CriterionId::Binning,
            light,
            other,
            EvidenceField::BinningX,
            EvidenceField::BinningY,
            "x",
        ),
        exact(CriterionId::Gain, light, other, EvidenceField::Gain),
        exact(CriterionId::Offset, light, other, EvidenceField::Offset),
    ];
    match kind {
        InputKind::Dark => {
            criteria.push(exact(CriterionId::Exposure, light, other, EvidenceField::Exposure));
            criteria.push(exact(
                CriterionId::SetTemperature,
                light,
                other,
                EvidenceField::SetTemperature,
            ));
        }
        InputKind::Flat => {
            criteria.push(exact(CriterionId::Channel, light, other, EvidenceField::Filter));
            criteria.push(optical_train(light, other));
        }
        InputKind::Bias => {}
    }
    let evidence = vec![
        shown(EvidenceId::MeasuredTemperature, light, other, EvidenceField::MeasuredTemperature),
        shown(EvidenceId::ReadoutMode, light, other, EvidenceField::ReadoutMode),
        night_row(light, other),
    ];
    Evaluation::new(criteria, evidence)
}

fn row(
    criterion: CriterionId,
    verdict: Verdict,
    light: Option<(String, String)>,
    input: Option<(String, String)>,
) -> CriterionResult {
    let (light_value, light_source) = light.unzip();
    let (input_value, input_source) = input.unzip();
    CriterionResult {
        criterion,
        verdict,
        light_value,
        input_value,
        light_source,
        input_source,
        tolerance: Tolerance::None,
        note: None,
    }
}

fn sourced(evidence: &CaptureEvidence, field: EvidenceField) -> Option<(String, String)> {
    evidence.get(field).map(|value| (value.value.clone(), value.source.clone()))
}

/// Equal canonical text on both sides; a missing side is unknown, never compatible.
fn verdict_of(light: Option<&str>, input: Option<&str>) -> Verdict {
    match (light, input) {
        (Some(light), Some(input)) if light == input => Verdict::Compatible,
        (Some(_), Some(_)) => Verdict::Incompatible,
        _ => Verdict::Unknown,
    }
}

fn exact(
    criterion: CriterionId,
    light: &CaptureEvidence,
    input: &CaptureEvidence,
    field: EvidenceField,
) -> CriterionResult {
    let (light, input) = (sourced(light, field), sourced(input, field));
    let verdict = verdict_of(
        light.as_ref().map(|(value, _)| value.as_str()),
        input.as_ref().map(|(value, _)| value.as_str()),
    );
    row(criterion, verdict, light, input)
}

/// Two fields compared together, shown as `first<separator>second`.
fn pair(
    criterion: CriterionId,
    light: &CaptureEvidence,
    input: &CaptureEvidence,
    first: EvidenceField,
    second: EvidenceField,
    separator: &str,
) -> CriterionResult {
    let side = |evidence: &CaptureEvidence| {
        let (a, b) = (sourced(evidence, first)?, sourced(evidence, second)?);
        Some((format!("{}{separator}{}", a.0, b.0), format!("{}, {}", a.1, b.1)))
    };
    let (light, input) = (side(light), side(input));
    let verdict = verdict_of(
        light.as_ref().map(|(value, _)| value.as_str()),
        input.as_ref().map(|(value, _)| value.as_str()),
    );
    row(criterion, verdict, light, input)
}

fn image_type(kind: InputKind, input: &InputEvidence) -> CriterionResult {
    let verdict = if input.kind == kind { Verdict::Compatible } else { Verdict::Incompatible };
    let source = input.capture.get(EvidenceField::ImageType).map_or_else(
        || "classification".to_owned(),
        |value| format!("{} {:?}", value.source, value.value),
    );
    row(
        CriterionId::ImageType,
        verdict,
        Some((kind.as_str().to_owned(), "requirement".to_owned())),
        Some((input.kind.as_str().to_owned(), source)),
    )
}

/// INSTRUME on both sides; CAMERAID compared when both record it (R7).
fn camera(light: &CaptureEvidence, input: &CaptureEvidence) -> CriterionResult {
    let side = |evidence: &CaptureEvidence| {
        let (model, model_source) = sourced(evidence, EvidenceField::Camera)?;
        Some(match sourced(evidence, EvidenceField::CameraId) {
            Some((id, id_source)) => {
                (format!("{model} / {id}"), format!("{model_source}, {id_source}"))
            }
            None => (model, model_source),
        })
    };
    let model = verdict_of(
        light.get(EvidenceField::Camera).map(|v| v.value.as_str()),
        input.get(EvidenceField::Camera).map(|v| v.value.as_str()),
    );
    let (light_id, input_id) = (
        light.get(EvidenceField::CameraId).map(|v| v.value.as_str()),
        input.get(EvidenceField::CameraId).map(|v| v.value.as_str()),
    );
    let (verdict, note) = match (model, light_id, input_id) {
        (Verdict::Compatible, None, None) => {
            (Verdict::Compatible, Some("camera model only: neither side records CAMERAID".into()))
        }
        (Verdict::Compatible, Some(_), None) | (Verdict::Compatible, None, Some(_)) => {
            (Verdict::Unknown, Some("CAMERAID is recorded on one side only".into()))
        }
        (Verdict::Compatible, light_id, input_id) => (verdict_of(light_id, input_id), None),
        (other, ..) => (other, None),
    };
    CriterionResult { note, ..row(CriterionId::Camera, verdict, side(light), side(input)) }
}

/// The same Confirmed Equipment ID; a different one is another optical train
/// and reads incompatible (CAL-AC-14). Otherwise a fully known (TELESCOP,
/// FOCALLEN) pair on both sides compared exactly (R8).
fn optical_train(light: &CaptureEvidence, input: &CaptureEvidence) -> CriterionResult {
    if let (Some(light_equipment), Some(input_equipment)) =
        (light.confirmed_equipment, input.confirmed_equipment)
    {
        let side = |id: uuid::Uuid| Some((id.to_string(), format!("Confirmed Equipment {id}")));
        let verdict = if light_equipment == input_equipment {
            Verdict::Compatible
        } else {
            Verdict::Incompatible
        };
        let train =
            row(CriterionId::OpticalTrain, verdict, side(light_equipment), side(input_equipment));
        let note = (verdict == Verdict::Incompatible).then(|| "another optical train".to_owned());
        return CriterionResult { note, ..train };
    }
    let header = pair(
        CriterionId::OpticalTrain,
        light,
        input,
        EvidenceField::Telescope,
        EvidenceField::FocalLength,
        " @ ",
    );
    let note = (header.verdict == Verdict::Unknown).then(|| {
        "neither a shared Confirmed Equipment association nor TELESCOP and FOCALLEN on both sides"
            .to_owned()
    });
    CriterionResult { note, ..header }
}

fn shown(
    evidence: EvidenceId,
    light: &CaptureEvidence,
    input: &CaptureEvidence,
    field: EvidenceField,
) -> EvidenceRow {
    EvidenceRow {
        evidence,
        light_value: light.get(field).map(|v| v.value.clone()),
        input_value: input.get(field).map(|v| v.value.clone()),
        note: None,
    }
}

/// The calendar date of a Session key night (`YYYY-MM-DD@basis`).
fn night_of(evidence: &CaptureEvidence) -> Option<Date> {
    let text = &evidence.get(EvidenceField::Night)?.value;
    let date = text.split('@').next()?;
    Date::parse(date, format_description!("[year]-[month]-[day]")).ok()
}

fn night_distance(light: &CaptureEvidence, input: &CaptureEvidence) -> Option<u32> {
    let days = (night_of(light)? - night_of(input)?).whole_days().unsigned_abs();
    u32::try_from(days).ok()
}

fn night_row(light: &CaptureEvidence, input: &CaptureEvidence) -> EvidenceRow {
    let note = match night_distance(light, input) {
        Some(days) => format!("{days} days apart"),
        None => "night distance unknown".to_owned(),
    };
    EvidenceRow {
        note: Some(note),
        ..shown(EvidenceId::NightDistance, light, input, EvidenceField::Night)
    }
}

// ── Plan (R10 to R13, D-W5, D-W37) ───────────────────────────────────────────

fn plan(basis: &CalibrationViewBasis) -> CalibrationViewPlan {
    let mut requirements = Vec::new();
    for group in light_groups(&basis.lights) {
        for &kind in &basis.plan.required_kinds {
            requirements.push(requirement(basis, &group, kind));
        }
    }
    CalibrationViewPlan {
        view_id: basis.view_id,
        view_revision: basis.view_revision,
        plan_revision: basis.plan.revision,
        policy: basis.plan.policy,
        required_kinds: basis.plan.required_kinds.clone(),
        requirements,
    }
}

/// Distinct values of one side across the group's sessions, joined.
fn merged(values: &mut Vec<String>, value: Option<&String>) {
    if let Some(value) = value {
        if !values.contains(value) {
            values.push(value.clone());
        }
    }
}

/// Every criterion of `input` across the group's sessions: a row reads its
/// worst verdict, so it is compatible only when it is for every session.
fn group_evaluation(kind: InputKind, group: &LightGroup<'_>, input: &InputEvidence) -> Evaluation {
    let evaluations: Vec<Evaluation> =
        group.lights.iter().map(|light| evaluate(kind, &light.evidence, input)).collect();
    let Some((first, rest)) = evaluations.split_first() else {
        return Evaluation::new(Vec::new(), Vec::new());
    };
    let mut criteria = first.criteria.clone();
    for row in &mut criteria {
        let mut values = Vec::new();
        merged(&mut values, row.light_value.as_ref());
        for other in
            rest.iter().flat_map(|e| e.criteria.iter()).filter(|o| o.criterion == row.criterion)
        {
            if verdict_rank(other.verdict) > verdict_rank(row.verdict) {
                row.verdict = other.verdict;
                row.note.clone_from(&other.note);
            }
            merged(&mut values, other.light_value.as_ref());
        }
        if values.len() > 1 {
            row.light_value = Some(values.join(", "));
        }
    }
    Evaluation::new(criteria, first.evidence.clone())
}

/// The largest night distance to any session of the group; unknown when any is.
fn group_night_distance(group: &LightGroup<'_>, input: &CaptureEvidence) -> Option<u32> {
    group
        .lights
        .iter()
        .map(|light| night_distance(&light.evidence.capture, input))
        .try_fold(0, |widest, days| days.map(|days| widest.max(days)))
}

fn candidate_evaluation(
    kind: InputKind,
    group: &LightGroup<'_>,
    candidate: &InputCandidate,
) -> CandidateEvaluation {
    let mut evaluation = group_evaluation(kind, group, &candidate.evidence);
    let state = &candidate.state;
    let note = match (state.superseded, state.drifted) {
        (true, _) => Some("superseded".to_owned()),
        (false, true) => Some("drifted from its adoption digest".to_owned()),
        (false, false) => None,
    };
    evaluation.evidence.push(EvidenceRow {
        evidence: EvidenceId::Availability,
        light_value: None,
        input_value: Some(format!(
            "{} of {} available ({:?})",
            state.available_members, state.members, state.availability
        )),
        note,
    });
    evaluation.evidence.push(EvidenceRow {
        evidence: EvidenceId::Quality,
        light_value: None,
        input_value: Some(format!("{} Library-Unusable excluded", state.excluded_members)),
        note: None,
    });
    CandidateEvaluation {
        candidate: candidate.candidate,
        kind,
        night_distance_days: group_night_distance(group, &candidate.evidence.capture),
        evaluation,
        state: candidate.state.clone(),
        preselected: false,
        master: candidate.master.clone(),
        origin: candidate.origin.clone(),
    }
}

const fn verdict_rank(verdict: Verdict) -> u8 {
    match verdict {
        Verdict::Compatible => 0,
        Verdict::Unknown => 1,
        Verdict::Incompatible => 2,
    }
}

fn form_rank(candidate: &CandidateEvaluation) -> u8 {
    u8::from(candidate.candidate.form() != InputForm::Master)
}

fn distance_order(left: Option<u32>, right: Option<u32>) -> Ordering {
    match (left, right) {
        (Some(a), Some(b)) => a.cmp(&b),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}

/// R10: compatible first, then absolute night distance with unknown nights
/// last, then adopted masters before raw sets; ascending ID only orders the
/// list and never breaks a ranking tie.
fn r10_order(left: &CandidateEvaluation, right: &CandidateEvaluation) -> Ordering {
    rank_order(left, right).then_with(|| left.candidate.id().cmp(&right.candidate.id()))
}

fn rank_order(left: &CandidateEvaluation, right: &CandidateEvaluation) -> Ordering {
    verdict_rank(left.evaluation.verdict)
        .cmp(&verdict_rank(right.evaluation.verdict))
        .then_with(|| distance_order(left.night_distance_days, right.night_distance_days))
        .then_with(|| form_rank(left).cmp(&form_rank(right)))
}

/// Fully compatible, readable now and not drifted: what may be assigned.
fn eligible(candidate: &CandidateEvaluation) -> bool {
    candidate.evaluation.verdict == Verdict::Compatible
        && candidate.state.available()
        && !candidate.state.drifted
}

fn camera_incompatible(candidate: &CandidateEvaluation) -> bool {
    candidate
        .evaluation
        .criteria
        .iter()
        .any(|row| row.criterion == CriterionId::Camera && row.verdict == Verdict::Incompatible)
}

fn requirement(
    basis: &CalibrationViewBasis,
    group: &LightGroup<'_>,
    kind: InputKind,
) -> Requirement {
    let mut requirement = Requirement {
        light_group: group.key.clone(),
        light_session_ids: group.session_ids(),
        light_asset_ids: group.asset_ids(),
        kind,
        state: RequirementState::NeedsReview,
        reason: None,
        preselected: None,
        automatic: None,
        candidates: Vec::new(),
        unadopted: Vec::new(),
        effective: None,
    };
    if !group.key.light_type_known {
        requirement.reason = Some(UnresolvedReason::LightTypeUnknown);
        return requirement;
    }
    for candidate in basis.candidates.iter().filter(|c| c.evidence.kind == kind) {
        let evaluated = candidate_evaluation(kind, group, candidate);
        // A run uses one rig: another camera's inputs are never candidates (CAL-FR-10).
        if camera_incompatible(&evaluated) {
            continue;
        }
        if candidate.candidate.input().is_some() {
            requirement.candidates.push(evaluated);
        } else {
            requirement.unadopted.push(evaluated);
        }
    }
    requirement.candidates.sort_by(r10_order);
    requirement.unadopted.sort_by(r10_order);
    let assignable: Vec<usize> = (0..requirement.candidates.len())
        .filter(|&i| eligible(&requirement.candidates[i]))
        .collect();
    let tie = match assignable.as_slice() {
        [first, second, ..] => {
            rank_order(&requirement.candidates[*first], &requirement.candidates[*second])
                == Ordering::Equal
        }
        _ => false,
    };
    if let (false, Some(&top)) = (tie, assignable.first()) {
        requirement.candidates[top].preselected = true;
        requirement.preselected = Some(requirement.candidates[top].candidate);
    }
    let automatic = basis.plan.policy == CalibrationPolicy::Automatic;

    let decision = basis.decisions.iter().find(|d| d.light_group == group.key && d.kind == kind);
    match decision {
        Some(decision) if decision.resolution != Resolution::Withdrawn => {
            let blocked = applicability(basis, group, kind, decision, &requirement);
            requirement.effective = Some(EffectiveDecision {
                decision: decision.clone(),
                decided_at_revision: decision.view_revision,
                applicable: blocked.is_none(),
            });
            match blocked {
                None => resolved(&mut requirement, decision),
                Some(reason) => {
                    requirement.reason = Some(reason);
                    // Only a changed light group is matched again; a decision
                    // that still holds its members is never overridden.
                    if reason == UnresolvedReason::LightMembershipChanged && automatic {
                        requirement.automatic = requirement.preselected.and_then(|c| c.input());
                    }
                }
            }
            requirement
        }
        Some(withdrawn) if withdrawn.light_asset_ids == requirement.light_asset_ids => {
            open(requirement, tie, false)
        }
        _ => open(requirement, tie, automatic),
    }
}

/// The state an applicable decision gives. A user's choice with a criterion
/// that is not compatible still needs review until an exception (CAL-AC-02).
fn resolved(requirement: &mut Requirement, decision: &CalibrationDecision) {
    requirement.state = match decision.resolution {
        Resolution::Automatic => RequirementState::Automatic,
        Resolution::Exception => RequirementState::Excepted,
        Resolution::Excluded => RequirementState::Excluded,
        Resolution::Accepted | Resolution::Withdrawn => {
            let verdicts = decision.criteria.iter().map(|row| row.verdict);
            if verdicts.clone().any(|verdict| verdict == Verdict::Incompatible) {
                requirement.reason = Some(UnresolvedReason::CriterionIncompatible);
                RequirementState::NeedsReview
            } else if verdicts.clone().all(|verdict| verdict == Verdict::Compatible) {
                RequirementState::Accepted
            } else {
                requirement.reason = Some(UnresolvedReason::CriterionUnknown);
                RequirementState::NeedsReview
            }
        }
    };
}

/// A requirement no decision holds: the single top input is a suggestion,
/// named for automatic assignment while `automatic`; anything else needs
/// review with what blocks it.
fn open(mut requirement: Requirement, tie: bool, automatic: bool) -> Requirement {
    if let Some(top) = requirement.preselected {
        requirement.state = RequirementState::Suggested;
        if automatic {
            requirement.automatic = top.input();
        }
        return requirement;
    }
    let has = |test: &dyn Fn(&CandidateEvaluation) -> bool| requirement.candidates.iter().any(test);
    let compatible = |c: &CandidateEvaluation| c.evaluation.verdict == Verdict::Compatible;
    requirement.reason = Some(if tie {
        UnresolvedReason::RankingTie
    } else if requirement.candidates.is_empty() {
        UnresolvedReason::NoCandidate
    } else if has(&|c| compatible(c) && c.state.available() && c.state.drifted) {
        UnresolvedReason::MasterDrifted
    } else if has(&compatible) {
        UnresolvedReason::InputUnavailable
    } else if has(&|c| c.evaluation.verdict == Verdict::Unknown) {
        UnresolvedReason::CriterionUnknown
    } else {
        UnresolvedReason::CriterionIncompatible
    });
    requirement
}

/// R13: a decision applies while the light group's included assets are
/// unchanged, and its input is current, not drifted, available, and its
/// verdicts equal the snapshot. An exclusion needs only the members.
fn applicability(
    basis: &CalibrationViewBasis,
    group: &LightGroup<'_>,
    kind: InputKind,
    decision: &CalibrationDecision,
    requirement: &Requirement,
) -> Option<UnresolvedReason> {
    if decision.light_asset_ids != requirement.light_asset_ids {
        return Some(UnresolvedReason::LightMembershipChanged);
    }
    let input = decision.input.map(CandidateRef::from)?;
    let Some(candidate) = basis.candidates.iter().find(|c| c.candidate == input) else {
        return Some(UnresolvedReason::InputUnavailable);
    };
    if candidate.state.superseded {
        return Some(UnresolvedReason::InputEvidenceChanged);
    }
    if candidate.state.drifted {
        return Some(UnresolvedReason::MasterDrifted);
    }
    let verdicts = |rows: &[CriterionResult]| -> BTreeMap<CriterionId, Verdict> {
        rows.iter().map(|row| (row.criterion, row.verdict)).collect()
    };
    let current = group_evaluation(kind, group, &candidate.evidence);
    if verdicts(&current.criteria) != verdicts(&decision.criteria) {
        return Some(UnresolvedReason::InputEvidenceChanged);
    }
    if !candidate.state.available() {
        return Some(UnresolvedReason::InputUnavailable);
    }
    None
}
