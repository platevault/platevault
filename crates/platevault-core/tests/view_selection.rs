//! Pure candidate filtering, sorting, paging, preselection, summaries and
//! refresh differences over constructed bases (spec 066, VSEL-FR-03/05/06/08/
//! 12/15, VSEL-AC-01/03/04/06/14). No catalog and no file takes part.

use std::collections::BTreeMap;

use platevault_core::view_selection::{
    evaluate_candidates, matching_sessions, page_candidates, preselect, refresh_items, summarize,
    CandidateEvaluation,
};
use platevault_core::{
    ApplicableQuality, AssessedMembers, Association, AssociationKind, AssociationState,
    Availability, CandidateBasis, CandidateCapture, CandidateFilters, CandidatePage,
    CandidateQuery, CandidateSession, CandidateSort, CandidateSortKey, CaptureCopy, CaptureKey,
    ChoiceBasis, CopyState, Equipment, ExclusionCount, ExclusionReason, ExpectedAsset,
    FileIdentity, FrameEvidence, FramingElement, FramingPanel, FramingSnapshot, FramingSource,
    FramingTarget, MemberBasis, MemberCopy, MemberReason, MemberState, Membership, MembershipBasis,
    Microseconds, NativePath, ObservationFingerprint, PathSensitivity, Provenance, QualityState,
    RefreshItemKind, SelectionReason, Session, SessionChoice, SessionChoiceState, SessionSummary,
    SkyCoordinates, SortDirection, SuggestionState, UnresolvedAction, UnresolvedSource,
    ViewCriteria, ViewMember, VolumeIdentity,
};
use uuid::Uuid;

const RA: f64 = 314.75;
const DEC: f64 = 44.5;
const REDCAT: u128 = 0xE1;
const OTHER_CAMERA: u128 = 0xE2;
const NGC7000: u128 = 0x7000;
const ASTRO: u128 = 0xA1;
const COLD: u128 = 0xC1;
/// arcsec per pixel of 3.76 µm behind 250 mm.
const SCALE: f64 = 3.76 / 1000.0 / 250.0 * 206_264.806_247_096_36;

fn id(value: u128) -> Uuid {
    Uuid::from_u128(value)
}

fn asset(session: u128, n: usize) -> Uuid {
    id(session << 32 | u128::try_from(n).unwrap())
}

fn fingerprint(asset_id: Uuid) -> ObservationFingerprint {
    ObservationFingerprint {
        identity: FileIdentity {
            volume: VolumeIdentity {
                filesystem: "apfs".into(),
                stable_id: Some("volume".into()),
                file_ids_stable: true,
                case: PathSensitivity::Sensitive,
                normalization: PathSensitivity::Sensitive,
            },
            file_id: Some(asset_id.to_string()),
        },
        size_bytes: 2880,
        modified_ns: 1,
        content_sha256: None,
    }
}

/// One session's header evidence: every capture shares it.
#[derive(Clone)]
struct Spec {
    night: &'static str,
    channel: Option<&'static str>,
    exposure: Option<f64>,
    camera: &'static str,
    gain: f64,
    offset: i64,
    binning: u32,
    temperature: f64,
    object: Option<&'static str>,
    pointing: Option<(f64, f64)>,
    rotation: Option<f64>,
    light: Option<bool>,
    location: u128,
    availability: Availability,
    equipment: Option<(u128, AssociationState)>,
    target: Option<u128>,
    qualities: Vec<ApplicableQuality>,
}

impl Spec {
    /// A `RedCat` Ha session at 300 s with full geometry on NGC 7000.
    fn base(night: &'static str) -> Self {
        Self {
            night,
            channel: Some("Ha"),
            exposure: Some(300.0),
            camera: "ASI2600MM",
            gain: 100.0,
            offset: 50,
            binning: 1,
            temperature: -10.0,
            object: Some("NGC 7000"),
            pointing: Some((RA, DEC)),
            rotation: Some(0.0),
            light: Some(true),
            location: ASTRO,
            availability: Availability::Available,
            equipment: Some((REDCAT, AssociationState::Confirmed)),
            target: None,
            qualities: vec![ApplicableQuality::Unreviewed; 3],
        }
    }
}

fn frame(asset_id: Uuid, spec: &Spec, n: usize) -> FrameEvidence {
    FrameEvidence {
        asset_id,
        light: spec.light,
        object: spec.object.map(str::to_owned),
        filter: spec.channel.map(str::to_owned),
        exposure_seconds: spec.exposure,
        camera: Some(spec.camera.into()),
        telescope: Some("RedCat 51".into()),
        gain: Some(spec.gain),
        offset: Some(spec.offset),
        binning_x: Some(spec.binning),
        binning_y: Some(spec.binning),
        width: Some(6248),
        height: Some(4176),
        set_temperature_c: Some(spec.temperature),
        date_obs: Some(format!("{}T21:{n:02}:00", spec.night)),
        date_local: None,
        ra_deg: spec.pointing.map(|(ra, _)| ra),
        dec_deg: spec.pointing.map(|(_, dec)| dec),
        wcs_ra_deg: None,
        wcs_dec_deg: None,
        sky_rotation_deg: spec.rotation,
        focal_length_mm: Some(250.0),
        pixel_size_um: Some(3.76),
    }
}

fn association(
    session: Uuid,
    kind: AssociationKind,
    subject: u128,
    state: AssociationState,
) -> Association {
    Association {
        session_id: session,
        kind,
        subject_id: Some(id(subject)),
        state,
        evidence: Vec::new(),
        provenance: Provenance::User,
        observation_basis: BTreeMap::new(),
        decision_revision: 1,
    }
}

fn summary(session: u128, spec: &Spec, assets: &[Uuid], successors: Vec<Uuid>) -> SessionSummary {
    let count = u64::try_from(assets.len()).unwrap();
    SessionSummary {
        session: Session {
            id: id(session),
            key: CaptureKey(format!(
                "light|filter={}|night={}@date-loc-noon|",
                spec.channel.unwrap_or("?"),
                spec.night
            )),
            grouping_revision: 1,
            decision_revision: 1,
            asset_ids: assets.to_vec(),
            provisional: Vec::new(),
            date_basis: Some("date-loc-noon".into()),
        },
        location_ids: vec![id(spec.location)],
        asset_count: count,
        capture_count: count,
        availability: spec.availability,
        last_observed_at: Some("2026-10-01T00:00:00Z".into()),
        provisional: false,
        successors,
    }
}

/// A candidate session holding `assets`, one capture each, with `spec.qualities`.
fn holding(session: u128, spec: &Spec, assets: &[Uuid]) -> CandidateSession {
    assert_eq!(assets.len(), spec.qualities.len());
    let session_id = id(session);
    let captures: Vec<CandidateCapture> = assets
        .iter()
        .zip(&spec.qualities)
        .enumerate()
        .map(|(n, (asset_id, quality))| CandidateCapture {
            member_key: *asset_id,
            copies: vec![CaptureCopy {
                asset_id: *asset_id,
                location_id: id(spec.location),
                availability: spec.availability,
                decision_revision: 1,
                fingerprint: fingerprint(*asset_id),
            }],
            quality: *quality,
            frame: frame(*asset_id, spec, n),
        })
        .collect();
    let mut associations = Vec::new();
    if let Some((equipment, state)) = &spec.equipment {
        associations.push(association(
            session_id,
            AssociationKind::Equipment,
            *equipment,
            state.clone(),
        ));
    }
    if let Some(target) = spec.target {
        associations.push(association(
            session_id,
            AssociationKind::Target,
            target,
            AssociationState::Confirmed,
        ));
    }
    CandidateSession {
        summary: summary(session, spec, assets, Vec::new()),
        captures,
        associations,
        assessed: AssessedMembers {
            observations: assets.iter().map(|a| (*a, fingerprint(*a))).collect(),
            decisions: assets.iter().map(|a| (*a, 1)).collect(),
            observation_revisions: assets.iter().map(|a| (*a, 1)).collect(),
        },
    }
}

fn candidate(session: u128, spec: &Spec) -> CandidateSession {
    let assets: Vec<Uuid> = (0..spec.qualities.len()).map(|n| asset(session, n)).collect();
    holding(session, spec, &assets)
}

fn equipment(equipment_id: u128, camera: &str) -> Equipment {
    Equipment {
        id: id(equipment_id),
        name: format!("RedCat 51 / {camera}"),
        camera: Some(camera.into()),
        telescope: Some("RedCat 51".into()),
        focal_length_mm: Some(250.0),
        pixel_size_um: Some(3.76),
        decision_revision: 1,
        state: AssociationState::Confirmed,
        provenance: Provenance::User,
    }
}

fn basis(sessions: Vec<CandidateSession>) -> CandidateBasis {
    CandidateBasis {
        sessions,
        equipment: vec![equipment(REDCAT, "ASI2600MM"), equipment(OTHER_CAMERA, "ASI533MC")],
    }
}

fn target() -> FramingTarget {
    FramingTarget {
        target_id: id(NGC7000),
        revision: 1,
        designation: "NGC 7000".into(),
        coordinates: Some(SkyCoordinates { ra_deg: RA, dec_deg: DEC, frame: "icrs".into() }),
    }
}

fn criteria(source: FramingSource, equipment: &[u128]) -> ViewCriteria {
    let framing = match source {
        FramingSource::None => FramingSnapshot::none(),
        FramingSource::Project | FramingSource::Target => FramingSnapshot {
            source,
            project_revision: (source == FramingSource::Project).then_some(1),
            targets: vec![target()],
            panels: Vec::new(),
        },
    };
    ViewCriteria {
        framing,
        equipment_ids: equipment.iter().map(|equipment| id(*equipment)).collect(),
        min_footprint_coverage: 0.5,
        suggestion_radius_deg: 2.0,
    }
}

fn session_ids(evaluations: &[CandidateEvaluation<'_>]) -> Vec<u128> {
    evaluations.iter().map(|evaluation| evaluation.session.summary.session.id.as_u128()).collect()
}

fn rows(page: &CandidatePage) -> Vec<u128> {
    page.rows.iter().map(|row| row.session.session.id.as_u128()).collect()
}

fn query(filters: CandidateFilters) -> CandidateQuery {
    CandidateQuery {
        membership: Membership::Draft,
        filters,
        sort: None,
        selected_only: false,
        offset: 0,
        limit: 1000,
    }
}

fn choice(session: u128, state: SessionChoiceState, reason: SelectionReason) -> SessionChoice {
    SessionChoice { session_id: id(session), grouping_revision: 1, state, reason, evidence: None }
}

#[test]
fn preselection_takes_footprint_matches_on_confirmed_project_equipment_only() {
    let mut cygnus = Spec::base("2026-09-26");
    cygnus.object = Some("Cygnus field");
    let mut suggested = Spec::base("2026-09-27");
    suggested.equipment = Some((REDCAT, AssociationState::Suggested));
    let mut other = Spec::base("2026-09-29");
    other.camera = "ASI533MC";
    other.equipment = Some((OTHER_CAMERA, AssociationState::Confirmed));
    let mut pointing_only = Spec::base("2026-09-18");
    pointing_only.rotation = None;
    let mut unknown = Spec::base("2026-09-24");
    unknown.pointing = None;
    unknown.object = None;
    let mut distant = Spec::base("2026-09-25");
    distant.pointing = Some((RA, DEC - 30.0));
    let mut unlabelled = Spec::base("2026-09-30");
    unlabelled.object = None;
    let basis = basis(vec![
        candidate(0x1, &Spec::base("2026-09-28")),
        candidate(0x2, &cygnus),
        candidate(0x3, &suggested),
        candidate(0x4, &other),
        candidate(0x5, &pointing_only),
        candidate(0x6, &unknown),
        candidate(0x7, &distant),
        candidate(0x8, &unlabelled),
    ]);
    let project = criteria(FramingSource::Project, &[REDCAT]);
    let evaluations = evaluate_candidates(&basis, &project);
    assert_eq!(session_ids(&evaluations), [1, 2, 3, 4, 5, 6, 7, 8]);
    let states: Vec<SuggestionState> = evaluations.iter().map(|e| e.suggestion).collect();
    assert_eq!(
        states,
        [
            SuggestionState::Preselectable,
            SuggestionState::Preselectable,
            SuggestionState::Suggested,
            SuggestionState::Suggested,
            SuggestionState::PointingOnly,
            SuggestionState::None,
            SuggestionState::None,
            SuggestionState::Preselectable,
        ]
    );

    let chosen = preselect(&evaluations, &project);
    let chosen_ids: Vec<u128> = chosen.iter().map(|c| c.session_id.as_u128()).collect();
    assert_eq!(chosen_ids, [1, 2, 8], "a different or missing OBJECT never vetoes a match");
    for choice in &chosen {
        assert_eq!(choice.state, SessionChoiceState::Selected);
        assert_eq!(choice.reason, SelectionReason::GeometrySuggestion);
        assert_eq!(choice.grouping_revision, 1);
        let evidence = choice.evidence.as_ref().expect("the evidence that qualified it");
        assert_eq!(
            evidence.matched.map(|matched| matched.element),
            Some(FramingElement::Target { target_id: id(NGC7000) })
        );
    }

    // The same sessions and equipment under a Target or no framing preselect nothing.
    for source in [FramingSource::Target, FramingSource::None] {
        let standalone = criteria(source, &[REDCAT]);
        let evaluations = evaluate_candidates(&basis, &standalone);
        assert!(preselect(&evaluations, &standalone).is_empty(), "{source:?}");
        assert!(
            evaluations.iter().all(|e| e.suggestion != SuggestionState::Preselectable),
            "{source:?}"
        );
    }
}

/// Five sessions differing per filter dimension (sessions 1 and 5 are Ha).
fn filter_set() -> CandidateBasis {
    let mut first = Spec::base("2026-09-18");
    first.target = Some(NGC7000);
    let mut missing_object = Spec::base("2026-09-24");
    missing_object.channel = Some("OIII");
    missing_object.object = None;
    missing_object.qualities = vec![ApplicableQuality::Unreviewed, ApplicableQuality::Usable];
    let mut short = Spec::base("2026-09-26");
    short.channel = Some("OIII");
    short.exposure = Some(180.0);
    short.object = Some("Cygnus field");
    short.qualities = vec![ApplicableQuality::Unreviewed; 2];
    let mut offline = Spec::base("2026-09-12");
    offline.channel = Some("OIII");
    offline.camera = "ASI533MC";
    offline.gain = 200.0;
    offline.offset = 10;
    offline.binning = 2;
    offline.temperature = -5.0;
    offline.equipment = Some((OTHER_CAMERA, AssociationState::Confirmed));
    offline.location = COLD;
    offline.availability = Availability::Offline;
    offline.qualities = vec![ApplicableQuality::Unreviewed];
    basis(vec![
        candidate(0x1, &first),
        candidate(0x2, &missing_object),
        candidate(0x3, &short),
        candidate(0x4, &offline),
        candidate(0x5, &Spec::base("2026-09-28")),
    ])
}

fn matched(evaluations: &[CandidateEvaluation<'_>], filters: &CandidateFilters) -> Vec<u128> {
    let page = page_candidates(evaluations, &query(filters.clone()), &[]);
    let listed = rows(&page);
    assert_eq!(page.match_count, u64::try_from(listed.len()).unwrap());
    let matching: Vec<u128> = matching_sessions(evaluations, filters)
        .iter()
        .map(|session| session.session_id.as_u128())
        .collect();
    assert_eq!(listed, matching, "select matching takes exactly the listed matches");
    listed
}

#[test]
fn each_filter_narrows_rows_and_counts_every_match() {
    let basis = filter_set();
    let evaluations = evaluate_candidates(&basis, &criteria(FramingSource::Project, &[REDCAT]));
    let none = CandidateFilters::default();
    assert_eq!(matched(&evaluations, &none), [1, 2, 3, 4, 5]);
    let cases: Vec<(&str, CandidateFilters, Vec<u128>)> = vec![
        (
            "dateFrom",
            CandidateFilters { date_from: Some("2026-09-20".into()), ..none.clone() },
            vec![2, 3, 5],
        ),
        (
            "dateTo",
            CandidateFilters { date_to: Some("2026-09-18".into()), ..none.clone() },
            vec![1, 4],
        ),
        ("night", CandidateFilters { night: Some("2026-09-24".into()), ..none.clone() }, vec![2]),
        ("channels", CandidateFilters { channels: vec!["Ha".into()], ..none.clone() }, vec![1, 5]),
        (
            "exposureMin",
            CandidateFilters { exposure_min: Some(200.0), ..none.clone() },
            vec![1, 2, 4, 5],
        ),
        ("exposureMax", CandidateFilters { exposure_max: Some(200.0), ..none.clone() }, vec![3]),
        (
            "equipmentIds",
            CandidateFilters { equipment_ids: vec![id(OTHER_CAMERA)], ..none.clone() },
            vec![4],
        ),
        (
            "qualityStates",
            CandidateFilters { quality_states: vec![QualityState::Usable], ..none.clone() },
            vec![2],
        ),
        ("locationIds", CandidateFilters { location_ids: vec![id(COLD)], ..none.clone() }, vec![4]),
        (
            "availability",
            CandidateFilters { availability: vec![Availability::Offline], ..none.clone() },
            vec![4],
        ),
        (
            "objectText",
            CandidateFilters { object_text: Some("cygnus".into()), ..none.clone() },
            vec![3],
        ),
        ("missingObject", CandidateFilters { missing_object: true, ..none.clone() }, vec![2]),
        ("targetIds", CandidateFilters { target_ids: vec![id(NGC7000)], ..none.clone() }, vec![1]),
        ("cameras", CandidateFilters { cameras: vec!["ASI533MC".into()], ..none.clone() }, vec![4]),
        ("gainMin", CandidateFilters { gain_min: Some(150.0), ..none.clone() }, vec![4]),
        ("gainMax", CandidateFilters { gain_max: Some(150.0), ..none.clone() }, vec![1, 2, 3, 5]),
        ("offsetMin", CandidateFilters { offset_min: Some(20), ..none.clone() }, vec![1, 2, 3, 5]),
        ("offsetMax", CandidateFilters { offset_max: Some(20), ..none.clone() }, vec![4]),
        ("binning", CandidateFilters { binning: vec![2], ..none.clone() }, vec![4]),
        (
            "setTemperatureMin",
            CandidateFilters { set_temperature_min: Some(-8.0), ..none.clone() },
            vec![4],
        ),
        (
            "setTemperatureMax",
            CandidateFilters { set_temperature_max: Some(-8.0), ..none.clone() },
            vec![1, 2, 3, 5],
        ),
        (
            "channels and cameras",
            CandidateFilters {
                channels: vec!["OIII".into()],
                cameras: vec!["ASI2600MM".into()],
                ..none
            },
            vec![2, 3],
        ),
    ];
    for (name, filters, expected) in cases {
        assert_eq!(matched(&evaluations, &filters), expected, "{name}");
    }
}

#[test]
fn filters_change_the_listed_rows_never_the_selection() {
    let basis = filter_set();
    let evaluations = evaluate_candidates(&basis, &criteria(FramingSource::Project, &[REDCAT]));
    let selection: Vec<SessionChoice> = [1, 5, 2, 3, 4]
        .into_iter()
        .map(|session| choice(session, SessionChoiceState::Selected, SelectionReason::Manual))
        .collect();
    let ha = CandidateFilters { channels: vec!["Ha".into()], ..CandidateFilters::default() };
    let page = page_candidates(&evaluations, &query(ha.clone()), &selection);
    assert_eq!(rows(&page), [1, 5]);
    assert_eq!(page.match_count, 2);
    assert_eq!(page.selected_count, 5);
    assert_eq!(page.selected_outside_filters, 3);
    assert!(page.rows.iter().all(|row| row
        .selection
        .as_ref()
        .is_some_and(|choice| choice.reason == SelectionReason::Manual)));

    let shown = page_candidates(
        &evaluations,
        &CandidateQuery { selected_only: true, ..query(ha) },
        &selection,
    );
    assert_eq!(rows(&shown), [1, 2, 3, 4, 5], "Show selected lists all five whatever the filters");
    assert_eq!(shown.selected_count, 5);
    assert_eq!(shown.selected_outside_filters, 3);

    // An explicit session exclusion is not a selection.
    let mut declined = selection;
    declined[4].state = SessionChoiceState::Excluded;
    let page = page_candidates(&evaluations, &query(CandidateFilters::default()), &declined);
    assert_eq!(page.selected_count, 4);
    assert_eq!(page.selected_outside_filters, 0);
    assert_eq!(
        page.rows[3].selection.as_ref().map(|choice| choice.state),
        Some(SessionChoiceState::Excluded)
    );
}

fn sorted(
    evaluations: &[CandidateEvaluation<'_>],
    key: CandidateSortKey,
    direction: SortDirection,
) -> CandidatePage {
    let sort = Some(CandidateSort { key, direction });
    page_candidates(
        evaluations,
        &CandidateQuery { sort, ..query(CandidateFilters::default()) },
        &[],
    )
}

#[test]
fn sorting_by_each_key_breaks_ties_by_session_id() {
    let basis = filter_set();
    let evaluations = evaluate_candidates(&basis, &criteria(FramingSource::Project, &[REDCAT]));
    let orders = [
        (CandidateSortKey::Date, [4, 1, 2, 3, 5], [5, 3, 2, 1, 4]),
        (CandidateSortKey::Night, [4, 1, 2, 3, 5], [5, 3, 2, 1, 4]),
        (CandidateSortKey::Channel, [1, 5, 2, 3, 4], [2, 3, 4, 1, 5]),
        (CandidateSortKey::Exposure, [3, 1, 2, 4, 5], [1, 2, 4, 5, 3]),
        (CandidateSortKey::Camera, [1, 2, 3, 5, 4], [4, 1, 2, 3, 5]),
        (CandidateSortKey::Frames, [4, 2, 3, 1, 5], [1, 5, 2, 3, 4]),
        (CandidateSortKey::Integration, [4, 3, 2, 1, 5], [1, 5, 2, 3, 4]),
        (CandidateSortKey::Availability, [1, 2, 3, 5, 4], [4, 1, 2, 3, 5]),
    ];
    for (key, ascending, descending) in orders {
        assert_eq!(rows(&sorted(&evaluations, key, SortDirection::Asc)), ascending, "{key:?} asc");
        assert_eq!(
            rows(&sorted(&evaluations, key, SortDirection::Desc)),
            descending,
            "{key:?} desc"
        );
    }
    let page = sorted(&evaluations, CandidateSortKey::Integration, SortDirection::Asc);
    let integration: Vec<Microseconds> = page.rows.iter().map(|row| row.integration).collect();
    assert_eq!(
        integration,
        [300, 360, 600, 900, 900].map(|seconds| Microseconds(seconds * Microseconds::PER_SECOND))
    );
}

#[test]
fn sky_distance_and_overlap_sorts_place_rows_without_evidence_last() {
    let mut far = Spec::base("2026-09-01");
    far.pointing = Some((RA, DEC + 0.5));
    let mut near = Spec::base("2026-09-02");
    near.pointing = Some((RA, DEC + 0.2));
    let mut unknown = Spec::base("2026-09-03");
    unknown.pointing = None;
    let mut pointing_only = Spec::base("2026-09-05");
    pointing_only.pointing = Some((RA, DEC + 1.0));
    pointing_only.rotation = None;
    let basis = basis(vec![
        candidate(0x1, &far),
        candidate(0x2, &near),
        candidate(0x3, &unknown),
        candidate(0x4, &near),
        candidate(0x5, &pointing_only),
    ]);
    let mut panelled = criteria(FramingSource::Project, &[REDCAT]);
    panelled.framing.targets.clear();
    panelled.framing.panels.push(FramingPanel {
        id: id(0x9A),
        name: "P1".into(),
        ra_deg: RA,
        dec_deg: DEC,
        width_deg: 6248.0 * SCALE / 3600.0,
        height_deg: 4176.0 * SCALE / 3600.0,
        position_angle_deg: Some(0.0),
    });
    let evaluations = evaluate_candidates(&basis, &panelled);

    let distance = |direction| sorted(&evaluations, CandidateSortKey::SkyDistance, direction);
    assert_eq!(rows(&distance(SortDirection::Asc)), [2, 4, 1, 5, 3]);
    assert_eq!(rows(&distance(SortDirection::Desc)), [5, 1, 2, 4, 3]);
    let last = distance(SortDirection::Desc).rows.pop().unwrap();
    assert_eq!(last.geometry.distance_deg, None, "Position unknown has no distance, never 0");

    let overlap = |direction| sorted(&evaluations, CandidateSortKey::Overlap, direction);
    assert_eq!(rows(&overlap(SortDirection::Asc)), [1, 2, 4, 3, 5]);
    assert_eq!(rows(&overlap(SortDirection::Desc)), [2, 4, 1, 3, 5]);
    for row in &overlap(SortDirection::Asc).rows[3..] {
        assert_eq!(row.geometry.coverage, None, "no footprint reads no coverage, never 0");
    }
    let compared: Vec<f64> = overlap(SortDirection::Asc).rows[..3]
        .iter()
        .map(|row| row.geometry.coverage.unwrap())
        .collect();
    assert!(compared[0] < compared[1] && compared[1] > 0.9, "{compared:?}");
}

#[test]
fn paging_lists_each_row_once_and_never_changes_the_selection() {
    let basis = filter_set();
    let evaluations = evaluate_candidates(&basis, &criteria(FramingSource::Project, &[REDCAT]));
    let selection: Vec<SessionChoice> = [2, 5]
        .into_iter()
        .map(|session| choice(session, SessionChoiceState::Selected, SelectionReason::Manual))
        .collect();
    let sort = Some(CandidateSort { key: CandidateSortKey::Date, direction: SortDirection::Asc });
    let mut listed = Vec::new();
    for offset in [0, 2, 4] {
        let page = page_candidates(
            &evaluations,
            &CandidateQuery { sort, offset, limit: 2, ..query(CandidateFilters::default()) },
            &selection,
        );
        assert_eq!(
            (page.match_count, page.selected_count, page.selected_outside_filters),
            (5, 2, 0)
        );
        listed.extend(rows(&page));
    }
    assert_eq!(listed, [4, 1, 2, 3, 5]);
    let beyond = page_candidates(
        &evaluations,
        &CandidateQuery { offset: 9, ..query(CandidateFilters::default()) },
        &selection,
    );
    assert!(beyond.rows.is_empty());
    assert_eq!(beyond.selected_count, 2);
}

fn copy_state(asset_id: Uuid, location: u128, availability: Availability) -> CopyState {
    CopyState {
        asset_id,
        location_id: id(location),
        location_name: if location == COLD { "Cold-1" } else { "Astro-T7" }.into(),
        path: NativePath::UnixBytes(format!("Captures/{asset_id}.fits").into_bytes()),
        availability,
        failure_reason: (availability != Availability::Available)
            .then(|| "volume not mounted".into()),
        last_observed_at: "2026-10-01T00:00:00Z".into(),
        current: ExpectedAsset {
            asset_id,
            decision_revision: 1,
            fingerprint: fingerprint(asset_id),
        },
    }
}

/// An included, available, Unreviewed light member of `session`.
fn member(session: u128, n: usize, channel: Option<&str>, exposure: Option<f64>) -> MemberBasis {
    let key = asset(session, n);
    let mut spec = Spec::base("2026-09-26");
    spec.channel = None;
    let mut evidence = frame(key, &spec, n % 60);
    evidence.filter = channel.map(str::to_owned);
    evidence.exposure_seconds = exposure;
    MemberBasis {
        member: ViewMember {
            member_key: key,
            session_id: id(session),
            state: MemberState::Included,
            reason: MemberReason::Initial,
            quality_when_chosen: ApplicableQuality::Unreviewed,
            added_in_revision: Some(1),
            copies: vec![MemberCopy {
                asset_id: key,
                decision_revision: 1,
                fingerprint: fingerprint(key),
            }],
        },
        copies: vec![copy_state(key, ASTRO, Availability::Available)],
        quality: ApplicableQuality::Unreviewed,
        frame: evidence,
        unresolved: false,
        changed_since_review: false,
    }
}

fn membership(sessions: Vec<ChoiceBasis>, members: Vec<MemberBasis>) -> MembershipBasis {
    MembershipBasis {
        view_id: id(0x7777),
        membership: Membership::Committed,
        revision: 1,
        project_id: None,
        criteria: criteria(FramingSource::Project, &[REDCAT]),
        sessions,
        members,
    }
}

fn seconds(value: u64) -> Microseconds {
    Microseconds(value * Microseconds::PER_SECOND)
}

#[test]
fn summary_totals_are_exact_integer_microseconds_per_exact_channel() {
    let mut members = Vec::new();
    for (session, channel, frames) in [
        (0x18, "Ha", 55),
        (0x28, "Ha", 56),
        (0x24, "OIII", 20),
        (0x26, "OIII", 35),
        (0x30, "OIII", 42),
    ] {
        members.extend((0..frames).map(|n| member(session, n, Some(channel), Some(300.0))));
    }
    let summary = summarize(&membership(Vec::new(), members));
    let channels: Vec<(Option<&str>, u64, Microseconds, u64)> = summary
        .channels
        .iter()
        .map(|row| {
            (
                row.channel.as_deref(),
                row.included_frames,
                row.included_seconds,
                row.unreviewed_frames,
            )
        })
        .collect();
    assert_eq!(
        channels,
        [(Some("Ha"), 111, seconds(33_300), 111), (Some("OIII"), 97, seconds(29_100), 97)]
    );
    assert_eq!((summary.included_frames, summary.included_seconds), (208, seconds(62_400)));
    assert_eq!(summary.included_seconds, Microseconds(62_400_000_000));
    assert!(summary.unknown_channel.is_none());
    assert!(summary.unresolved.is_empty() && summary.changed_since_review.is_empty());

    let tenths = (0..3).map(|n| member(0x40, n, Some("L"), Some(0.1))).collect();
    let summary = summarize(&membership(Vec::new(), tenths));
    assert_eq!(summary.included_seconds, Microseconds(300_000));
}

#[test]
fn summary_counts_unknowns_and_lists_unresolved_and_changed_members_outside_the_totals() {
    let unknown_channel = member(0x50, 1, None, Some(300.0));
    let unknown_exposure = member(0x50, 2, Some("Ha"), None);
    let mut unknown_type = member(0x50, 3, Some("Ha"), Some(300.0));
    unknown_type.frame.light = None;
    let mut offline = member(0x51, 4, Some("Ha"), Some(300.0));
    offline.copies = vec![copy_state(asset(0x51, 4), COLD, Availability::Offline)];
    offline.unresolved = true;
    let mut changed = member(0x50, 5, Some("Ha"), Some(300.0));
    changed.changed_since_review = true;
    let mut pair = member(0x50, 6, Some("Ha"), Some(300.0));
    pair.member.copies.push(MemberCopy {
        asset_id: asset(0x52, 6),
        decision_revision: 1,
        fingerprint: fingerprint(asset(0x52, 6)),
    });
    pair.copies = vec![
        copy_state(asset(0x50, 6), COLD, Availability::Offline),
        copy_state(asset(0x52, 6), ASTRO, Availability::Available),
    ];
    pair.quality = ApplicableQuality::Usable;
    let excluded = |n, reason| {
        let mut basis = member(0x50, n, Some("Ha"), Some(300.0));
        basis.member.state = MemberState::Excluded;
        basis.member.reason = reason;
        basis
    };
    let members = vec![
        unknown_channel,
        unknown_exposure,
        unknown_type,
        offline,
        changed,
        pair,
        excluded(7, MemberReason::LibraryUnusable),
        excluded(8, MemberReason::ViewExclusion),
        excluded(
            9,
            MemberReason::QualityNeedsReview {
                quality: ApplicableQuality::ChangedContent {
                    previous: platevault_core::Quality::Usable,
                },
            },
        ),
    ];
    let summary = summarize(&membership(Vec::new(), members));

    let unknown = summary.unknown_channel.as_ref().expect("unknown FILTER forms its own row");
    assert_eq!((unknown.channel.as_deref(), unknown.included_frames), (None, 1));
    assert_eq!(unknown.included_seconds, seconds(300));
    assert_eq!(summary.channels.len(), 1);
    let ha = &summary.channels[0];
    assert_eq!(ha.channel.as_deref(), Some("Ha"));
    assert_eq!(ha.included_frames, 2, "unknown exposure is a frame; the pair counts once");
    assert_eq!(ha.included_seconds, seconds(300), "unknown exposure adds no seconds");
    assert_eq!(ha.unknown_exposure_count, 1);
    assert_eq!(ha.unknown_image_type_count, 1);
    assert_eq!((ha.unreviewed_frames, ha.usable_frames), (1, 1));
    assert_eq!(
        ha.excluded,
        [
            ExclusionCount { reason: ExclusionReason::LibraryUnusable, count: 1 },
            ExclusionCount { reason: ExclusionReason::QualityNeedsReview, count: 1 },
            ExclusionCount { reason: ExclusionReason::ViewExclusion, count: 1 },
        ]
    );
    assert_eq!((summary.included_frames, summary.included_seconds), (3, seconds(600)));

    assert_eq!(summary.unresolved.len(), 1);
    assert_offline_source(&summary.unresolved[0]);
    assert_eq!(summary.changed_since_review, [asset(0x50, 5)]);
}

fn assert_offline_source(source: &UnresolvedSource) {
    assert_eq!((source.session_id, source.location_id), (id(0x51), id(COLD)));
    assert_eq!(source.location_name, "Cold-1");
    assert_eq!(source.availability, Availability::Offline);
    assert_eq!(source.failure_reason.as_deref(), Some("volume not mounted"));
    assert_eq!(source.member_keys, [asset(0x51, 4)]);
    assert_eq!(source.paths.len(), 1);
    assert_eq!((source.last_observed_frames, source.last_observed_seconds), (1, seconds(300)));
    assert!(!source.verified, "last-observed counts are never verified");
    assert_eq!(
        source.actions,
        [UnresolvedAction::Reconnect, UnresolvedAction::Locate, UnresolvedAction::Remove]
    );
}

fn chosen(session: &CandidateSession, choice: SessionChoice) -> ChoiceBasis {
    ChoiceBasis { choice, current: session.summary.clone() }
}

fn members_of(session: &CandidateSession, keys: std::ops::Range<usize>) -> Vec<MemberBasis> {
    let session_id = session.summary.session.id.as_u128();
    keys.map(|n| member(session_id, n, Some("Ha"), Some(300.0))).collect()
}

const REVIEW: u128 = 0xF00D;

/// Candidates and a committed membership covering every refresh item kind:
/// 0x11 grew a capture, 0x12 left the framing, 0x13 is a manual choice
/// without position, 0x14 left the framing with an offline member, 0x15 is a
/// declined suggestion, 0x16 has two excluded members, 0x17 was regrouped into
/// 0x27 and 0x28, 0x18 is a manual choice inside the framing, 0x21 is new on
/// `RedCat`, 0x22 is new on another camera and 0x23 is new and pointing-only.
fn refresh_fixture() -> (CandidateBasis, MembershipBasis) {
    let suggestion = || SelectionReason::GeometrySuggestion;
    let selected = SessionChoiceState::Selected;
    let mut far = Spec::base("2026-09-02");
    far.pointing = Some((RA, DEC - 30.0));
    let mut unknown = Spec::base("2026-09-03");
    unknown.pointing = None;
    let mut other = Spec::base("2026-10-02");
    other.equipment = Some((OTHER_CAMERA, AssociationState::Confirmed));
    let mut pointing_only = Spec::base("2026-10-03");
    pointing_only.rotation = None;
    let mut single = Spec::base("2026-09-07");
    single.qualities = vec![ApplicableQuality::Unreviewed];

    let grown = candidate(0x11, &Spec::base("2026-09-01"));
    let failing = candidate(0x12, &far);
    let manual = candidate(0x13, &unknown);
    let unavailable = candidate(0x14, &far);
    let declined = candidate(0x15, &Spec::base("2026-09-05"));
    let trimmed = candidate(0x16, &Spec::base("2026-09-06"));
    let inside = candidate(0x18, &Spec::base("2026-09-08"));
    let regrouped = summary(
        0x17,
        &Spec::base("2026-09-07"),
        &[asset(0x17, 0), asset(0x17, 1)],
        vec![id(0x27), id(0x28)],
    );

    let mut members = Vec::new();
    members.extend(members_of(&grown, 0..2));
    members.extend(members_of(&failing, 0..3));
    members.extend(members_of(&manual, 0..3));
    let mut offline = members_of(&unavailable, 0..3);
    offline[0].copies = vec![copy_state(asset(0x14, 0), COLD, Availability::Offline)];
    offline[0].unresolved = true;
    members.extend(offline);
    let mut excluded = members_of(&trimmed, 0..3);
    for member in &mut excluded[1..] {
        member.member.state = MemberState::Excluded;
        member.member.reason = MemberReason::ViewExclusion;
    }
    members.extend(excluded);
    members.extend((0..2).map(|n| member(0x17, n, Some("Ha"), Some(300.0))));
    members.extend(members_of(&inside, 0..3));
    let declined_reason = SelectionReason::RefreshMatch { review_id: id(REVIEW) };
    let committed = membership(
        vec![
            chosen(&grown, choice(0x11, selected, suggestion())),
            chosen(&failing, choice(0x12, selected, suggestion())),
            chosen(&manual, choice(0x13, selected, SelectionReason::Manual)),
            chosen(&unavailable, choice(0x14, selected, suggestion())),
            chosen(&declined, choice(0x15, SessionChoiceState::Excluded, declined_reason)),
            chosen(&trimmed, choice(0x16, selected, suggestion())),
            ChoiceBasis { choice: choice(0x17, selected, suggestion()), current: regrouped },
            chosen(&inside, choice(0x18, selected, SelectionReason::Manual)),
        ],
        members,
    );
    let library = basis(vec![
        grown,
        failing,
        manual,
        unavailable,
        declined,
        trimmed,
        inside,
        candidate(0x21, &Spec::base("2026-10-01")),
        candidate(0x22, &other),
        candidate(0x23, &pointing_only),
        holding(0x27, &single, &[asset(0x17, 0)]),
        holding(0x28, &single, &[asset(0x17, 1)]),
    ]);
    (library, committed)
}

#[test]
fn refresh_lists_additions_removals_regroups_and_never_drops_pinned_or_unavailable_members() {
    let (library, committed) = refresh_fixture();
    let criteria = criteria(FramingSource::Project, &[REDCAT]);
    let evaluations = evaluate_candidates(&library, &criteria);
    let items = refresh_items(&committed, &evaluations, &criteria);

    let kinds: Vec<(RefreshItemKind, u128)> =
        items.iter().map(|item| (item.kind, item.session_id.as_u128())).collect();
    assert_eq!(
        kinds,
        [
            (RefreshItemKind::AddedSession, 0x21),
            (RefreshItemKind::AddedCaptures, 0x11),
            (RefreshItemKind::Removed, 0x12),
            (RefreshItemKind::Regrouped, 0x17),
            (RefreshItemKind::Unavailable, 0x14),
            (RefreshItemKind::ManualInclusion, 0x13),
            (RefreshItemKind::KeptExclusion, 0x15),
            (RefreshItemKind::KeptExclusion, 0x16),
        ]
    );
    let mut item_ids: Vec<Uuid> = items.iter().map(|item| item.id).collect();
    item_ids.sort();
    item_ids.dedup();
    assert_eq!(item_ids.len(), items.len(), "item ids are unique within a review");

    let addition = &items[0];
    assert_eq!(addition.session.as_ref().map(|s| s.session_id), Some(id(0x21)));
    assert!(addition.evidence.as_ref().is_some_and(|evidence| evidence.matched.is_some()));
    let assessed = addition.assessed.as_ref().expect("the member basis it was computed from");
    let new_assets: Vec<Uuid> = (0..3).map(|n| asset(0x21, n)).collect();
    assert_eq!(assessed.observations.keys().copied().collect::<Vec<_>>(), new_assets);
    assert_eq!(items[1].member_keys, [asset(0x11, 2)], "only the capture that joined");
    assert!(items[1].assessed.is_some());
    assert_eq!(items[2].member_keys, (0..3).map(|n| asset(0x12, n)).collect::<Vec<_>>());
    let successors: Vec<Uuid> = items[3].successors.iter().map(|s| s.session_id).collect();
    assert_eq!(successors, [id(0x27), id(0x28)]);
    assert_eq!(items[4].member_keys, [asset(0x14, 0)]);
    assert_eq!(items[5].reason, Some(SelectionReason::Manual));
    assert_eq!(items[6].reason, Some(SelectionReason::RefreshMatch { review_id: id(REVIEW) }));
    assert_eq!(items[7].member_keys, [asset(0x16, 1), asset(0x16, 2)]);
    assert!(items.iter().all(|item| !item.kind.actionable() || item.session.is_some()));
}

#[test]
fn refresh_of_an_unchanged_library_lists_nothing() {
    let inside = candidate(0x18, &Spec::base("2026-09-08"));
    let quiet = membership(
        vec![chosen(
            &inside,
            choice(0x18, SessionChoiceState::Selected, SelectionReason::GeometrySuggestion),
        )],
        members_of(&inside, 0..3),
    );
    let library = basis(vec![inside]);
    let criteria = criteria(FramingSource::Project, &[REDCAT]);
    let evaluations = evaluate_candidates(&library, &criteria);
    assert!(refresh_items(&quiet, &evaluations, &criteria).is_empty());
}
