// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Pure calibration semantics (spec 068): classification, exact D13 criterion
//! evaluation, and each light session's matching at ingestion (CAL-FR-19 to
//! CAL-FR-22): the offers of every kind, best first.
//!
//! Nothing here reads storage, the clock or settings. The catalog receives
//! [`Rules`] as a [`CalibrationRules`] trait object and evaluates inside its
//! own snapshot, the way it receives the grouping callback.

use std::cmp::Ordering;
use std::collections::BTreeSet;
use std::sync::LazyLock;

use calibration_master_detect::{detect_master, DetectInput};
use metadata_core::{v1_normalization_table, ImageTypNormalizationTable};
use time::macros::format_description;
use time::Date;

use crate::{
    canonical_decimal, CalibrationRules, CaptureEvidence, CaptureMetadata, Classification,
    CriterionId, CriterionResult, Evaluation, EvidenceField, EvidenceId, EvidenceRow, FlatRules,
    InputEvidence, InputForm, InputKind, KindMatch, LightEvidence, MasterBasis, MasterEvidence,
    MatchCamera, MatchCaution, MatchOffer, NativePath, PinTarget, RigVersion, RotatorPresence,
    SessionInput, SessionLight, Tolerance, Verdict, WorkflowSettings,
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

    fn match_session(
        &self,
        kind: InputKind,
        light: &SessionLight,
        inputs: &[SessionInput],
        settings: &WorkflowSettings,
    ) -> KindMatch {
        match_session(kind, light, inputs, settings)
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

// ── Session matching (F4: CAL-FR-19 to CAL-FR-22, D-W102 to D-W104, D-W114) ─

/// One offered input and what it ranks by.
struct Ranked {
    /// A caution keeps it from being pinned automatically.
    blocked: bool,
    /// A raw set ranks after a master (CAL-FR-04).
    raw: bool,
    /// Days (nights for flats) between its capture and the lights.
    days: Option<u32>,
    /// The largest rotation difference, flats only.
    rotation: Option<f64>,
    offer: MatchOffer,
}

/// Every input of `kind` that passes the hard checks, best first: pinnable
/// before cautioned, masters before raw sets, then the closest capture, then
/// the smallest rotation (flats, provisional). A pinnable top input that ties
/// with the next is only suggested.
fn match_session(
    kind: InputKind,
    light: &SessionLight,
    inputs: &[SessionInput],
    settings: &WorkflowSettings,
) -> KindMatch {
    let mut ranked: Vec<Ranked> = inputs
        .iter()
        .filter(|input| input.kind == kind)
        .filter_map(|input| session_offer(kind, light, input, settings))
        .collect();
    ranked.sort_by(|left, right| {
        session_rank(left, right)
            .then_with(|| left.offer.target.input.id().cmp(&right.offer.target.input.id()))
    });
    if let [first, second, ..] = ranked.as_mut_slice() {
        if !first.blocked && session_rank(first, second) == Ordering::Equal {
            first.offer.cautions.push(MatchCaution::RankingTie);
        }
    }
    KindMatch { kind, offers: ranked.into_iter().map(|ranked| ranked.offer).collect() }
}

fn session_rank(left: &Ranked, right: &Ranked) -> Ordering {
    left.blocked
        .cmp(&right.blocked)
        .then(left.raw.cmp(&right.raw))
        .then_with(|| distance_order(left.days, right.days))
        .then_with(|| match (left.rotation, right.rotation) {
            (Some(a), Some(b)) => a.total_cmp(&b),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => Ordering::Equal,
        })
}

/// Known distances first, nearest first.
fn distance_order(left: Option<u32>, right: Option<u32>) -> Ordering {
    match (left, right) {
        (Some(a), Some(b)) => a.cmp(&b),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}

/// The hard-check rows of one input against the session, the rows that are
/// only shown, and for flats the largest rotation difference.
fn hard_checks(
    kind: InputKind,
    light: &SessionLight,
    input: &SessionInput,
    settings: &WorkflowSettings,
) -> (Vec<CriterionResult>, Vec<EvidenceRow>, Option<f64>) {
    let (lights, other) = (&light.capture, &input.capture);
    let evidence =
        InputEvidence { kind: input.kind, form: input.input.form(), capture: other.clone() };
    let mut criteria = vec![
        image_type(kind, &evidence),
        session_camera(light, input),
        pair(
            CriterionId::Dimensions,
            lights,
            other,
            EvidenceField::Width,
            EvidenceField::Height,
            "x",
        ),
        pair(
            CriterionId::Binning,
            lights,
            other,
            EvidenceField::BinningX,
            EvidenceField::BinningY,
            "x",
        ),
    ];
    let mut rotation = None;
    let mut shown_rows = Vec::new();
    if kind == InputKind::Flat {
        criteria.push(exact(CriterionId::Channel, lights, other, EvidenceField::Filter));
        criteria.push(optical_train(lights, other));
        criteria.push(rig_version(light, input));
        let (row, degrees) = flat_rotation(light, input, &settings.flats);
        criteria.push(row);
        rotation = degrees;
    } else {
        criteria.push(exact(CriterionId::Gain, lights, other, EvidenceField::Gain));
        criteria.push(exact(CriterionId::Offset, lights, other, EvidenceField::Offset));
        if kind == InputKind::Dark {
            criteria.push(exact(CriterionId::Exposure, lights, other, EvidenceField::Exposure));
        }
        criteria.push(exact(
            CriterionId::SetTemperature,
            lights,
            other,
            EvidenceField::SetTemperature,
        ));
        criteria.push(readout_mode(lights, other));
        shown_rows.push(shown(
            EvidenceId::MeasuredTemperature,
            lights,
            other,
            EvidenceField::MeasuredTemperature,
        ));
    }
    (criteria, shown_rows, rotation)
}

/// The criteria of one input against the session; `None` when a hard check
/// fails, which is never offered.
fn session_offer(
    kind: InputKind,
    light: &SessionLight,
    input: &SessionInput,
    settings: &WorkflowSettings,
) -> Option<Ranked> {
    let (criteria, mut shown_rows, rotation) = hard_checks(kind, light, input, settings);
    if criteria.iter().any(|row| row.verdict == Verdict::Incompatible) {
        return None;
    }
    let days = days_apart(light.night, input.captured);
    let window = match kind {
        InputKind::Flat => settings.flats.window_nights,
        InputKind::Dark | InputKind::Bias => settings.dark_bias.window_days,
    };
    shown_rows.push(age_row(light.night, input.captured, days, window));
    let evaluation = Evaluation::new(criteria, shown_rows);
    let mut cautions = Vec::new();
    let unknown = evaluation.blocking();
    if !unknown.is_empty() {
        cautions.push(MatchCaution::CriterionUnknown { criteria: unknown });
    }
    match days {
        Some(days) if days <= window => {}
        Some(days) => cautions.push(MatchCaution::OutsideWindow { days, window }),
        None => cautions.push(MatchCaution::AgeUnknown),
    }
    if let Some(degrees) = rotation.filter(|degrees| *degrees > settings.flats.fine_within_deg) {
        cautions.push(MatchCaution::RotationWarning { degrees: canonical_decimal(degrees) });
    }
    if !input.available {
        cautions.push(MatchCaution::Unavailable);
    }
    let target = PinTarget {
        input: input.input,
        captured: input.captured,
        files: input.files.clone(),
        evaluation,
    };
    Some(Ranked {
        blocked: !cautions.is_empty(),
        raw: input.input.form() != InputForm::Master,
        days,
        rotation,
        offer: MatchOffer { target, cautions },
    })
}

/// One light session's exposure mismatch (PRJ-FR-11): its channel, and the
/// light's and the darks' exposures, canonical text.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ExposureMismatch {
    /// The light's filter; `None` when its header records none.
    pub channel: Option<String>,
    pub light_exposures: BTreeSet<String>,
    pub dark_exposures: BTreeSet<String>,
}

/// Exposure mismatch (PRJ-FR-11): among `darks` with no incompatible
/// criterion other than exposure there is at least one, and every one of
/// them has another exposure than the session's lights. `None` otherwise.
/// It is a warning only: it assigns nothing and never blocks Apply.
#[must_use]
pub fn exposure_mismatch(
    light: &SessionLight,
    darks: &[SessionInput],
    settings: &WorkflowSettings,
) -> Option<ExposureMismatch> {
    let rows: Vec<CriterionResult> = darks
        .iter()
        .filter(|input| input.kind == InputKind::Dark)
        .filter_map(|input| {
            let (criteria, _, _) = hard_checks(InputKind::Dark, light, input, settings);
            let only_exposure = criteria.iter().all(|row| {
                row.criterion == CriterionId::Exposure || row.verdict != Verdict::Incompatible
            });
            only_exposure
                .then(|| criteria.into_iter().find(|row| row.criterion == CriterionId::Exposure))
                .flatten()
        })
        .collect();
    if rows.is_empty() || rows.iter().any(|row| row.verdict != Verdict::Incompatible) {
        return None;
    }
    Some(ExposureMismatch {
        channel: light.capture.get(EvidenceField::Filter).map(|value| value.value.clone()),
        light_exposures: rows.iter().filter_map(|row| row.light_value.clone()).collect(),
        dark_exposures: rows.iter().filter_map(|row| row.input_value.clone()).collect(),
    })
}

/// The physical camera when both sides name one; with several cameras of a
/// model and none named, unknown; otherwise the headers (R7).
fn session_camera(light: &SessionLight, input: &SessionInput) -> CriterionResult {
    let side = |camera: MatchCamera| match camera {
        MatchCamera::Known { camera_id } => Some((camera_id.to_string(), "camera".to_owned())),
        MatchCamera::Ambiguous | MatchCamera::Unlinked => None,
    };
    match (light.camera, input.camera) {
        (MatchCamera::Known { camera_id: lights }, MatchCamera::Known { camera_id: other }) => {
            let verdict = if lights == other { Verdict::Compatible } else { Verdict::Incompatible };
            let note = (verdict == Verdict::Incompatible).then(|| "another camera".to_owned());
            CriterionResult {
                note,
                ..row(CriterionId::Camera, verdict, side(light.camera), side(input.camera))
            }
        }
        (MatchCamera::Ambiguous, _) | (_, MatchCamera::Ambiguous) => {
            let header = camera(&light.capture, &input.capture);
            if header.verdict == Verdict::Incompatible {
                return header;
            }
            CriterionResult {
                verdict: Verdict::Unknown,
                note: Some("several cameras are this model: name the camera".to_owned()),
                ..header
            }
        }
        _ => camera(&light.capture, &input.capture),
    }
}

/// Flats only: the version of the lights' rig the flats were taken with,
/// the one a raw set recorded or else the one their date falls in. Any other
/// version, a remount included, is incompatible (CAL-FR-19).
fn rig_version(light: &SessionLight, input: &SessionInput) -> CriterionResult {
    type Side = Option<(String, String)>;
    let result = |verdict: Verdict, lights: Side, flats: Side, note: &str| CriterionResult {
        note: Some(note.to_owned()),
        ..row(CriterionId::RigVersion, verdict, lights, flats)
    };
    let Some(rig) = &light.rig else {
        return result(Verdict::Unknown, None, None, "the lights' rig is not confirmed");
    };
    let side = |version: &RigVersion| {
        Some((version.valid_from.to_string(), format!("rig version {}", version.id)))
    };
    let lights = rig.version.as_ref();
    let flats = match input.rig_version_id {
        Some(id) => {
            let Some(version) = rig.versions.iter().find(|version| version.id == id) else {
                let other = Some((id.to_string(), "rig version".to_owned()));
                let note = "a version of another rig";
                return result(Verdict::Incompatible, lights.and_then(side), other, note);
            };
            Some(version)
        }
        None => RigVersion::for_night(&rig.versions, input.captured),
    };
    match (lights, flats) {
        (Some(lights), Some(flats)) if lights.id == flats.id => {
            result(Verdict::Compatible, side(lights), side(flats), "the same rig version")
        }
        (Some(lights), Some(flats)) => result(
            Verdict::Incompatible,
            side(lights),
            side(flats),
            "another rig version: the rig changed between them",
        ),
        (None, None) if rig.versions.is_empty() => {
            result(Verdict::Compatible, None, None, "the rig has no recorded versions")
        }
        _ => result(Verdict::Unknown, lights.and_then(side), None, "the rig version is unknown"),
    }
}

/// Flats only: the largest ROTATANG difference over the flats' frames. Fine
/// within the fine angle, a warning up to the offered angle, never offered
/// beyond it; a missing angle reads unknown unless the rig has no rotator.
/// The angles are the caller's settings; their defaults, fine within 2° and
/// offered up to 5°, are the owner's approved starting values (decision
/// record §8, 2026-10-15/16; CAL-FR-20, CAL-AC-26).
fn flat_rotation(
    light: &SessionLight,
    input: &SessionInput,
    rules: &FlatRules,
) -> (CriterionResult, Option<f64>) {
    let rotator = light
        .rig
        .as_ref()
        .and_then(|rig| rig.version.as_ref())
        .map_or(RotatorPresence::Unknown, |version| version.rotator);
    let angles: Option<Vec<f64>> = input.rotator_deg.iter().copied().collect();
    let angles = angles.filter(|angles| !angles.is_empty());
    let lights = light.rotator_deg.map(|deg| (canonical_decimal(deg), "ROTATANG".to_owned()));
    let flats = angles.as_ref().map(|angles| {
        let mut shown: Vec<String> = angles.iter().map(|deg| canonical_decimal(*deg)).collect();
        shown.dedup();
        (shown.join(", "), "ROTATANG".to_owned())
    });
    let result = |verdict: Verdict, note: String| CriterionResult {
        note: Some(note),
        ..row(CriterionId::Rotation, verdict, lights.clone(), flats.clone())
    };
    match (light.rotator_deg, &angles) {
        (Some(lights), Some(angles)) => {
            let widest = angles.iter().map(|deg| angle_between(lights, *deg)).fold(0.0, f64::max);
            let widest = (widest * 100.0).round() / 100.0;
            let degrees = canonical_decimal(widest);
            let row = if widest <= rules.fine_within_deg {
                result(Verdict::Compatible, format!("{degrees}° apart"))
            } else if widest <= rules.offered_within_deg {
                result(Verdict::Compatible, format!("{degrees}° apart: a warning, confirm it"))
            } else {
                result(
                    Verdict::Incompatible,
                    format!(
                        "{degrees}° apart: over {}°",
                        canonical_decimal(rules.offered_within_deg)
                    ),
                )
            };
            (row, Some(widest))
        }
        _ if !rotator.needs_angle() => {
            (result(Verdict::Compatible, "the rig has no rotator".to_owned()), None)
        }
        _ => (result(Verdict::Unknown, "the rotation is unknown".to_owned()), None),
    }
}

/// The smaller angle between two rotator angles in degrees.
fn angle_between(a: f64, b: f64) -> f64 {
    let apart = (a - b).rem_euclid(360.0);
    apart.min(360.0 - apart)
}

/// Darks and bias: the readout mode, compatible when neither side records one.
fn readout_mode(light: &CaptureEvidence, input: &CaptureEvidence) -> CriterionResult {
    let result = exact(CriterionId::ReadoutMode, light, input, EvidenceField::ReadoutMode);
    if result.light_value.is_none() && result.input_value.is_none() {
        return CriterionResult {
            verdict: Verdict::Compatible,
            note: Some("neither side records a readout mode".to_owned()),
            ..result
        };
    }
    result
}

fn days_apart(light: Option<Date>, input: Option<Date>) -> Option<u32> {
    u32::try_from((light? - input?).whole_days().unsigned_abs()).ok()
}

/// Both capture dates and their distance against the window (CAL-FR-03).
fn age_row(
    light: Option<Date>,
    input: Option<Date>,
    days: Option<u32>,
    window: u32,
) -> EvidenceRow {
    let note = match days {
        Some(days) if days <= window => {
            format!("{days} days apart, inside the {window}-day window")
        }
        Some(days) => format!("{days} days apart, outside the {window}-day window"),
        None => "a capture date is unknown".to_owned(),
    };
    EvidenceRow {
        evidence: EvidenceId::NightDistance,
        light_value: light.map(|date| date.to_string()),
        input_value: input.map(|date| date.to_string()),
        note: Some(note),
    }
}
