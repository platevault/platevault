// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calibration decisions of a processing run (spec 068 as amended by D-W5,
//! D-W37 and D-W55) on the composed library: the real calibration rules and
//! the real disk probe over real files. A run's light groups are matched for
//! its one rig; a fully compatible single top input is assigned Automatic with
//! the SHA-256 of every file it binds, anything else stays a suggestion or
//! needs review, a user's choice survives rematch, and an adopted master whose
//! bytes drifted from its adoption digest is never assigned.
#![cfg(unix)]

mod support;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use persistence_library::{SessionQuery, SourceProbe};
use platevault_core::library::{InventoryProbe, Library};
use platevault_core::*;
use uuid::Uuid;

const HA_LIGHTS: [&str; 2] = ["2026-09-18/Ha_001.fits", "2026-09-18/Ha_002.fits"];
const OIII_LIGHTS: [&str; 2] = ["2026-09-24/OIII_001.fits", "2026-09-24/OIII_002.fits"];
const MASTER_SOURCE: &str = "NGC7000/output/master_dark_300s.fits";
const MASTER_DESTINATION: &str = "masters/master_dark_300s.fits";

/// Quickstart capture metadata: ASI2600MM, gain 100, offset 50, 6248 x 4176,
/// binning 1 and a -10 C setpoint on the night of `night` (YYYY-MM-DD).
fn meta(image_type: &str, filter: Option<&str>, exposure: f64, night: &str) -> CaptureMetadata {
    CaptureMetadata {
        image_type: Some(image_type.into()),
        filter: filter.map(str::to_owned),
        exposure_seconds: Some(exposure),
        camera: Some("ASI2600MM".into()),
        gain: Some(100.0),
        offset: Some(50),
        width: Some(6248),
        height: Some(4176),
        binning_x: Some(1),
        binning_y: Some(1),
        set_temperature_c: Some(-10.0),
        date_local: Some(format!("{night}T22:00:00")),
        ..CaptureMetadata::default()
    }
}

/// The `RedCat 51` optical-train headers of the run's rig.
fn train(mut metadata: CaptureMetadata) -> CaptureMetadata {
    metadata.telescope = Some("RedCat 51".into());
    metadata.focal_length_mm = Some(250.0);
    metadata
}

fn dark(night: &str, exposure: f64) -> CaptureMetadata {
    meta("DARK", None, exposure, night)
}

fn flat(filter: &str, night: &str) -> CaptureMetadata {
    train(meta("FLAT", Some(filter), 2.0, night))
}

/// A `capture-v1`-shaped grouping: frame type, night, filter, exposure,
/// camera and telescope, so each night of the same settings is its own session.
fn group_by_night(assets: &[Asset]) -> GroupingResult {
    let mut sessions: std::collections::BTreeMap<String, Vec<Uuid>> =
        std::collections::BTreeMap::new();
    for asset in assets {
        let m = &asset.effective;
        let night = m.date_local.as_deref().map(|date| date.get(..10).unwrap_or(date).to_owned());
        let key = format!(
            "capture-v1|type={}|night={}@date-loc-noon|filter={}|exposure_s={}|camera={}|scope={}",
            m.image_type.as_deref().unwrap_or("?").to_lowercase(),
            night.unwrap_or_default(),
            m.filter.as_deref().unwrap_or("?"),
            m.exposure_seconds.map(|v| v.to_string()).unwrap_or_default(),
            m.camera.as_deref().unwrap_or("?"),
            m.telescope.as_deref().unwrap_or("?"),
        );
        sessions.entry(key).or_default().push(asset.id);
    }
    GroupingResult {
        sessions: sessions
            .into_iter()
            .map(|(key, mut asset_ids)| {
                asset_ids.sort_unstable();
                SessionCandidate {
                    key: CaptureKey(key),
                    asset_ids,
                    provisional: Vec::new(),
                    date_basis: Some("date-loc-noon".into()),
                }
            })
            .collect(),
    }
}

/// Write each file with bytes unique to its path and scan the whole location once.
async fn scan(
    library: &Library,
    location: &Location,
    root: &Path,
    frames: &[(String, CaptureMetadata)],
) {
    let catalog = library.catalog();
    let mut files = Vec::new();
    for (relative, metadata) in frames {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, format!("{relative}{}", " ".repeat(64))).unwrap();
        files.push(ScanFile {
            relative_path: NativePath::from_path(Path::new(relative)),
            fingerprint: InventoryProbe.fingerprint(&path).unwrap(),
            format: ImageFormat::Fits,
            metadata: metadata.clone(),
        });
    }
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let identity = InventoryProbe.root_identity(location).unwrap();
    let count = files.len() as u64;
    let progress =
        ScanProgress { discovered: count, metadata_read: count, ..ScanProgress::default() };
    let batch = ScanBatch { files: files.clone(), issues: Vec::new(), progress: progress.clone() };
    catalog.apply_scan_batch(operation.id, &identity, &batch, group_by_night).await.unwrap();
    let observation = ScanObservation {
        location_id: location.id,
        root_identity: identity,
        incomplete_scopes: Vec::new(),
        files,
        issues: Vec::new(),
        complete_scopes: vec![NativePath::UnixBytes(Vec::new())],
        progress,
        state: ScanState::Completed,
    };
    let finished = catalog
        .finish_scan(
            operation.id,
            &observation,
            |location| InventoryProbe.root_identity(location),
            group_by_night,
        )
        .await
        .unwrap();
    assert_eq!(finished.state, ScanState::Completed);
}

fn rig(name: &str, camera: &str, telescope: &str, focal: f64) -> Equipment {
    Equipment {
        id: Uuid::new_v4(),
        name: name.into(),
        camera: Some(camera.into()),
        telescope: Some(telescope.into()),
        focal_length_mm: Some(focal),
        pixel_size_um: Some(3.76),
        sensor_width_px: Some(6248),
        sensor_height_px: Some(4176),
        color_kind: None,
        decision_revision: 0,
        state: AssociationState::Confirmed,
        provenance: Provenance::User,
    }
}

fn target() -> TargetCandidate {
    TargetCandidate {
        id: Uuid::new_v4(),
        designation: "NGC 7000".into(),
        aliases: vec![TargetAlias {
            text: "NGC 7000".into(),
            normalized: "ngc 7000".into(),
            kind: "designation".into(),
            provenance: Provenance::User,
        }],
        common_name: None,
        object_type: "nebula".into(),
        coordinates: Some(SkyCoordinates { ra_deg: 314.75, dec_deg: 44.33, frame: "ICRS".into() }),
        provenance: Provenance::User,
        provider_id: None,
        angular_size: None,
        catalogues: Vec::new(),
    }
}

fn expected_session(session: &Session) -> ExpectedSession {
    ExpectedSession {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        decision_revision: session.decision_revision,
    }
}

struct World {
    temp: tempfile::TempDir,
    library: Arc<Library>,
    captures: Location,
    calibration: Location,
    results: Location,
    rig: Equipment,
    other_rig: Equipment,
    project: Project,
    run: Uuid,
}

/// Lights: 18 Sep Ha and 24 Sep OIII, two frames each, 300 s on the `RedCat`
/// rig with its train headers, confirmed NGC 7000 and `RedCat`. Calibration
/// frames are the test's own. One run on NGC 7000 and `RedCat`, saved once.
async fn world(
    calibration: &[(String, CaptureMetadata)],
    results: &[(String, CaptureMetadata)],
) -> World {
    let temp = tempfile::tempdir().unwrap();
    let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
    let mut locations = Vec::new();
    for (name, role) in [
        ("Astro-T7/Captures", LocationRole::Captures),
        ("Astro-T7/Calibration", LocationRole::Calibration),
        ("Work/Processing", LocationRole::Results),
    ] {
        let root = temp.path().join(name);
        std::fs::create_dir_all(&root).unwrap();
        let location = library
            .register_location(NativePath::from_path(&root), name.into(), role)
            .await
            .unwrap();
        locations.push((location, root));
    }
    let lights: Vec<(String, CaptureMetadata)> = HA_LIGHTS
        .iter()
        .map(|path| ((*path).to_owned(), train(meta("LIGHT", Some("Ha"), 300.0, "2026-09-18"))))
        .chain(OIII_LIGHTS.iter().map(|path| {
            ((*path).to_owned(), train(meta("LIGHT", Some("OIII"), 300.0, "2026-09-24")))
        }))
        .collect();
    scan(&library, &locations[0].0, &locations[0].1, &lights).await;
    if !calibration.is_empty() {
        scan(&library, &locations[1].0, &locations[1].1, calibration).await;
    }
    if !results.is_empty() {
        scan(&library, &locations[2].0, &locations[2].1, results).await;
    }
    let catalog = library.catalog();
    let ngc = catalog.save_target(&target(), None).await.unwrap();
    let redcat = catalog
        .save_equipment(&rig("RedCat 51", "ASI2600MM", "RedCat 51", 250.0), None)
        .await
        .unwrap();
    let esprit = catalog
        .save_equipment(&rig("Esprit 100", "ASI2600MM", "Esprit 100", 550.0), None)
        .await
        .unwrap();
    let project = catalog
        .create_project(&ProjectInput {
            name: "NGC 7000 HOO".into(),
            notes: None,
            subjects: vec![SubjectInput {
                target_id: ngc.candidate.id,
                name: None,
                mosaic: false,
                panels: Vec::new(),
            }],
            rig_ids: vec![redcat.id],
            goals: Vec::new(),
        })
        .await
        .unwrap();
    let mut world = World {
        library: Arc::clone(&library),
        captures: locations[0].0.clone(),
        calibration: locations[1].0.clone(),
        results: locations[2].0.clone(),
        rig: redcat,
        other_rig: esprit,
        project,
        run: Uuid::nil(),
        temp,
    };
    for path in [HA_LIGHTS[0], OIII_LIGHTS[0]] {
        let session = world.session_at(&locations[0].0, path).await;
        catalog.associate_target(&[expected_session(&session)], ngc.candidate.id).await.unwrap();
        let session = world.session_at(&locations[0].0, path).await;
        catalog.confirm_equipment(&[expected_session(&session)], world.rig.id).await.unwrap();
    }
    let record = catalog
        .create_view(&NewView {
            project_id: world.project.id,
            subject_id: world.project.subjects[0].id,
            rig_id: world.rig.id,
            name: "NGC 7000 HOO".into(),
        })
        .await
        .unwrap();
    world.run = record.view.id;
    catalog.save_view(world.run, 0, 1).await.unwrap();
    world
}

impl World {
    fn catalog(&self) -> &persistence_library::Catalog {
        self.library.catalog()
    }

    fn root(&self, location: &Location) -> PathBuf {
        location.path.to_path_buf().unwrap()
    }

    async fn asset_at(&self, location: &Location, path: &str) -> Asset {
        self.catalog()
            .location_assets(location.id)
            .await
            .unwrap()
            .into_iter()
            .find(|asset| asset.relative_path.display() == path)
            .unwrap()
    }

    async fn session_at(&self, location: &Location, path: &str) -> Session {
        let asset = self.asset_at(location, path).await.id;
        let summaries = self.catalog().list_sessions(&SessionQuery::default()).await.unwrap();
        summaries.into_iter().map(|s| s.session).find(|s| s.asset_ids.contains(&asset)).unwrap()
    }

    async fn plan(&self, revision: Revision) -> CalibrationViewPlan {
        self.library.calibration_view_plan(self.run, revision).await.unwrap()
    }

    /// The automatic match at `revision`, from the current plan revision.
    async fn assign(&self, revision: Revision) -> CalibrationAssignment {
        let expected = self.plan(revision).await.plan_revision;
        self.library.calibration_assign(self.run, revision, expected).await.unwrap()
    }

    /// Save a second membership revision without one OIII frame.
    async fn drop_one_oiii_frame(&self) {
        let revision = self.catalog().view_revision(self.run, 1).await.unwrap();
        let oiii = self.asset_at(&self.captures, OIII_LIGHTS[1]).await.id;
        let member = revision
            .members
            .iter()
            .find(|member| member.copies.iter().any(|copy| copy.asset_id == oiii))
            .unwrap()
            .member_key;
        let edit = DraftEdit::SetFrames { member_keys: vec![member], state: MemberState::Excluded };
        self.catalog().edit_view_draft(self.run, 0, &edit).await.unwrap();
        self.catalog().save_view(self.run, 1, 1).await.unwrap();
    }
}

fn row<'a>(plan: &'a CalibrationViewPlan, channel: &str, kind: InputKind) -> &'a Requirement {
    plan.requirements
        .iter()
        .find(|r| r.kind == kind && r.light_group.channel.as_deref() == Some(channel))
        .unwrap_or_else(|| panic!("no {channel} {kind:?} requirement: {plan:#?}"))
}

fn effective(requirement: &Requirement) -> &CalibrationDecision {
    &requirement.effective.as_ref().expect("an effective decision").decision
}

fn item(requirement: &Requirement, input: InputRef) -> DecisionItem {
    DecisionItem { light_group: requirement.light_group.clone(), kind: requirement.kind, input }
}

fn key(requirement: &Requirement) -> RequirementKey {
    RequirementKey { light_group: requirement.light_group.clone(), kind: requirement.kind }
}

fn standard_calibration() -> Vec<(String, CaptureMetadata)> {
    let mut frames = Vec::new();
    for index in 1..=2 {
        frames.push((format!("darks/Dark_300s_{index:03}.fits"), dark("2026-09-18", 300.0)));
        frames.push((format!("flats/Ha/Flat_Ha_{index:03}.fits"), flat("Ha", "2026-09-18")));
        frames.push((format!("flats/OIII/Flat_OIII_{index:03}.fits"), flat("OIII", "2026-09-24")));
    }
    frames
}

/// CAL-AC-01, CAL-FR-02, CAL-FR-08, PV-CAL-SC-04: every light group's single
/// fully compatible top input is assigned Automatic, recording the identity and
/// SHA-256 of every file it binds; the readiness line reads every group matched.
#[tokio::test]
async fn fully_compatible_top_match_assigned_automatic_with_sha() {
    let world = world(&standard_calibration(), &[]).await;
    let before = world.plan(1).await;
    assert_eq!(before.policy, CalibrationPolicy::Automatic);
    assert!(before.requirements.iter().all(|r| r.state == RequirementState::Suggested));
    assert!(before.requirements.iter().all(|r| r.automatic.is_some()));

    let outcome = world.assign(1).await;
    assert_eq!(outcome.assigned.len(), 4, "{outcome:#?}");
    let plan = &outcome.plan;
    assert_eq!(plan.plan_revision, before.plan_revision + 1);
    for requirement in &plan.requirements {
        assert_eq!(requirement.state, RequirementState::Automatic, "{requirement:#?}");
        let decision = effective(requirement);
        assert_eq!(decision.resolution, Resolution::Automatic);
        assert_eq!(decision.input.map(CandidateRef::from), requirement.preselected);
        assert_eq!(decision.inputs.len(), 2, "both members of the raw set are bound");
        for file in &decision.inputs {
            let path = world.root(&world.calibration).join(file.relative_path.display());
            assert_eq!(
                file.fingerprint.content_sha256.as_deref(),
                Some(support::digest(&path).as_str()),
                "the SHA-256 of the bytes assigned"
            );
            assert!(file.asset_id.is_some(), "a raw-set member names its asset");
        }
        assert!(decision.criteria.iter().all(|row| row.verdict == Verdict::Compatible));
    }
    let ha_dark = effective(row(plan, "Ha", InputKind::Dark));
    let oiii_dark = effective(row(plan, "OIII", InputKind::Dark));
    assert_eq!(ha_dark.input, oiii_dark.input, "one dark set serves both groups");

    let readiness = world.library.calibration_readiness(world.run, 1).await.unwrap();
    assert_eq!((readiness.groups.len(), readiness.matched), (2, 2));
    assert!(readiness.ready);
    assert!(readiness.needs_review_blocker().is_none());
    let handoff = world.library.calibration_handoff(world.run, 1).await.unwrap();
    assert!(handoff.ready);
    assert_eq!(handoff.assignments.len(), 4);
    assert!(handoff.assignments.iter().all(|a| a.resolution == Resolution::Automatic));

    let again = world.assign(1).await;
    assert!(again.assigned.is_empty(), "matching an unchanged run assigns nothing new");
    assert_eq!(again.plan.plan_revision, plan.plan_revision, "and writes nothing");
}

/// CAL-AC-06, PV-CAL-SC-05: a best match with an unknown or incompatible
/// criterion is never assigned automatically and needs review.
#[tokio::test]
async fn unknown_or_incompatible_never_automatic() {
    let mut calibration = Vec::new();
    for index in 1..=2 {
        calibration.push((format!("darks/Dark_120s_{index:03}.fits"), dark("2026-09-18", 120.0)));
        calibration.push((format!("flats/Ha/Flat_Ha_{index:03}.fits"), flat("Ha", "2026-09-18")));
        calibration.push((
            format!("flats/OIII/Flat_OIII_{index:03}.fits"),
            meta("FLAT", Some("OIII"), 2.0, "2026-09-26"),
        ));
    }
    let world = world(&calibration, &[]).await;
    let outcome = world.assign(1).await;
    let plan = &outcome.plan;
    assert_eq!(outcome.assigned.len(), 1, "only the Ha flat: {outcome:#?}");
    assert_eq!(row(plan, "Ha", InputKind::Flat).state, RequirementState::Automatic);
    for (channel, kind, reason) in [
        ("Ha", InputKind::Dark, UnresolvedReason::CriterionIncompatible),
        ("OIII", InputKind::Dark, UnresolvedReason::CriterionIncompatible),
        ("OIII", InputKind::Flat, UnresolvedReason::CriterionUnknown),
    ] {
        let requirement = row(plan, channel, kind);
        assert_eq!(requirement.state, RequirementState::NeedsReview, "{requirement:#?}");
        assert_eq!(requirement.reason, Some(reason));
        assert!(requirement.effective.is_none(), "nothing was recorded");
        assert!(requirement.preselected.is_none() && requirement.automatic.is_none());
        assert!(!requirement.candidates.is_empty(), "the best match stays listed");
    }
    let oiii_flat = row(plan, "OIII", InputKind::Flat);
    let train = oiii_flat.candidates[0]
        .evaluation
        .criteria
        .iter()
        .find(|c| c.criterion == CriterionId::OpticalTrain)
        .unwrap();
    assert_eq!(train.verdict, Verdict::Unknown);

    // CAL-AC-02: choosing the unknown-train flat records the choice; it still
    // needs review and preparation lists it unresolved.
    let input = oiii_flat.candidates[0].candidate.input().unwrap();
    let picked = world
        .library
        .calibration_accept(world.run, 1, plan.plan_revision, &[item(oiii_flat, input)])
        .await
        .unwrap();
    let oiii_flat = row(&picked, "OIII", InputKind::Flat);
    assert_eq!(oiii_flat.state, RequirementState::NeedsReview);
    assert_eq!(oiii_flat.reason, Some(UnresolvedReason::CriterionUnknown));
    assert_eq!(effective(oiii_flat).resolution, Resolution::Accepted);
    let handoff = world.library.calibration_handoff(world.run, 1).await.unwrap();
    assert!(!handoff.ready);
    assert!(handoff
        .unresolved
        .iter()
        .any(|u| u.kind == InputKind::Flat && u.light_group.channel.as_deref() == Some("OIII")));
}

/// CAL edge case, D-W5: two fully compatible inputs that rank equal leave no
/// single top input: the group is not assigned and needs review. A group the
/// same inputs rank apart is assigned.
#[tokio::test]
async fn tie_needs_review() {
    let mut calibration = standard_calibration();
    calibration.retain(|(path, _)| !path.starts_with("darks/"));
    for index in 1..=2 {
        calibration.push((format!("darks/15/Dark_{index:03}.fits"), dark("2026-09-15", 300.0)));
        calibration.push((format!("darks/21/Dark_{index:03}.fits"), dark("2026-09-21", 300.0)));
    }
    let world = world(&calibration, &[]).await;
    let late = world.session_at(&world.calibration, "darks/21/Dark_001.fits").await.id;
    let before = world.plan(1).await;
    let ha_dark = row(&before, "Ha", InputKind::Dark);
    assert_eq!(ha_dark.state, RequirementState::NeedsReview);
    assert_eq!(ha_dark.reason, Some(UnresolvedReason::RankingTie));
    assert!(ha_dark.preselected.is_none() && ha_dark.automatic.is_none());
    assert_eq!(ha_dark.candidates.len(), 2);
    assert!(ha_dark.candidates.iter().all(|c| c.evaluation.verdict == Verdict::Compatible));
    assert_eq!(ha_dark.candidates[0].night_distance_days, Some(3));
    assert_eq!(ha_dark.candidates[1].night_distance_days, Some(3));

    let outcome = world.assign(1).await;
    let ha_dark = row(&outcome.plan, "Ha", InputKind::Dark);
    assert_eq!(ha_dark.state, RequirementState::NeedsReview, "a tie is never assigned");
    assert!(ha_dark.effective.is_none());
    let oiii_dark = row(&outcome.plan, "OIII", InputKind::Dark);
    assert_eq!(oiii_dark.state, RequirementState::Automatic, "3 days beats 9 days");
    assert_eq!(effective(oiii_dark).input.unwrap().id(), late);
    let readiness = world.library.calibration_readiness(world.run, 1).await.unwrap();
    assert_eq!((readiness.matched, readiness.needs_review), (1, 1));
    let blocker = readiness.needs_review_blocker().expect("the run is blocked");
    assert_eq!((blocker.view_id, blocker.groups), (world.run, 1));
}

/// CAL-FR-05, CAL edge case: a user's replacement of an automatic assignment
/// stays when matching runs again, both at the same revision and after a new
/// membership revision that changes another group.
#[tokio::test]
async fn user_replacement_survives_rematch() {
    let mut calibration = standard_calibration();
    for index in 1..=2 {
        calibration.push((format!("darks/21/Dark_{index:03}.fits"), dark("2026-09-21", 300.0)));
    }
    let world = world(&calibration, &[]).await;
    let near = world.session_at(&world.calibration, "darks/Dark_300s_001.fits").await;
    let other = world.session_at(&world.calibration, "darks/21/Dark_001.fits").await;
    let assigned = world.assign(1).await.plan;
    let ha_dark = row(&assigned, "Ha", InputKind::Dark);
    assert_eq!(effective(ha_dark).input.unwrap().id(), near.id, "0 days beats 3 days");

    let replacement =
        InputRef::RawSet { session_id: other.id, grouping_revision: other.grouping_revision };
    let replaced = world
        .library
        .calibration_accept(world.run, 1, assigned.plan_revision, &[item(ha_dark, replacement)])
        .await
        .unwrap();
    let ha_dark = row(&replaced, "Ha", InputKind::Dark);
    assert_eq!(ha_dark.state, RequirementState::Accepted);
    let chosen = effective(ha_dark).clone();
    assert_eq!(chosen.resolution, Resolution::Accepted);
    assert_eq!(chosen.input, Some(replacement));
    assert!(chosen.inputs.iter().all(|file| file.fingerprint.content_sha256.is_some()));

    let same = world.assign(1).await;
    assert!(same.assigned.is_empty(), "{same:#?}");
    assert_eq!(effective(row(&same.plan, "Ha", InputKind::Dark)), &chosen);

    world.drop_one_oiii_frame().await;
    let rematched = world.assign(2).await;
    let ha_dark = row(&rematched.plan, "Ha", InputKind::Dark);
    assert_eq!(ha_dark.state, RequirementState::Accepted, "the user's choice holds");
    assert_eq!(effective(ha_dark), &chosen);
    assert!(rematched.assigned.iter().all(|k| k.light_group.channel.as_deref() == Some("OIII")));
}

/// CAL-AC-11, D-W55: with automatic assignment turned off, compatible matches
/// stay suggestions and nothing is assigned until accepted.
#[tokio::test]
async fn policy_off_leaves_suggestions() {
    let world = world(&standard_calibration(), &[]).await;
    let plan = world.plan(1).await;
    let manual = world
        .library
        .calibration_set_policy(world.run, plan.plan_revision, CalibrationPolicy::Manual)
        .await
        .unwrap();
    assert_eq!(manual.policy, CalibrationPolicy::Manual);
    assert_eq!(manual.revision, plan.plan_revision + 1);
    let stale = world
        .library
        .calibration_set_policy(world.run, plan.plan_revision, CalibrationPolicy::Automatic)
        .await
        .unwrap_err();
    assert_eq!(stale.response(None, None).kind, "conflict");

    let outcome = world.assign(1).await;
    assert!(outcome.assigned.is_empty());
    assert_eq!(outcome.plan.plan_revision, manual.revision, "nothing was written");
    for requirement in &outcome.plan.requirements {
        assert_eq!(requirement.state, RequirementState::Suggested);
        assert!(requirement.preselected.is_some());
        assert!(requirement.automatic.is_none());
        assert!(requirement.effective.is_none());
    }
    let readiness = world.library.calibration_readiness(world.run, 1).await.unwrap();
    assert_eq!((readiness.matched, readiness.suggested), (0, 2));
    assert!(!readiness.ready);
    let handoff = world.library.calibration_handoff(world.run, 1).await.unwrap();
    assert!(handoff.assignments.is_empty(), "a suggestion never enters the handoff");

    let ha_dark = row(&outcome.plan, "Ha", InputKind::Dark);
    let input = ha_dark.preselected.unwrap().input().unwrap();
    let accepted = world
        .library
        .calibration_accept(world.run, 1, outcome.plan.plan_revision, &[item(ha_dark, input)])
        .await
        .unwrap();
    assert_eq!(row(&accepted, "Ha", InputKind::Dark).state, RequirementState::Accepted);
    assert_eq!(row(&accepted, "Ha", InputKind::Flat).state, RequirementState::Suggested);
}

/// CAL-FR-02: on a new membership revision matching runs again for the
/// changed light groups only; unchanged groups keep their decisions.
#[tokio::test]
async fn rematch_on_new_membership_revision_only_changed_groups() {
    let world = world(&standard_calibration(), &[]).await;
    let first = world.assign(1).await.plan;
    let ha: Vec<CalibrationDecision> = [InputKind::Dark, InputKind::Flat]
        .iter()
        .map(|kind| effective(row(&first, "Ha", *kind)).clone())
        .collect();

    world.drop_one_oiii_frame().await;
    let pending = world.plan(2).await;
    for kind in [InputKind::Dark, InputKind::Flat] {
        let oiii = row(&pending, "OIII", kind);
        assert_eq!(oiii.state, RequirementState::NeedsReview);
        assert_eq!(oiii.reason, Some(UnresolvedReason::LightMembershipChanged));
        assert!(oiii.automatic.is_some(), "the changed group is matched again");
        assert_eq!(row(&pending, "Ha", kind).state, RequirementState::Automatic);
        assert!(row(&pending, "Ha", kind).automatic.is_none());
    }

    let rematched = world.assign(2).await;
    let mut changed: Vec<_> = rematched
        .assigned
        .iter()
        .map(|k| (k.light_group.channel.clone().unwrap(), k.kind))
        .collect();
    changed.sort();
    assert_eq!(
        changed,
        [("OIII".to_owned(), InputKind::Dark), ("OIII".to_owned(), InputKind::Flat)]
    );
    for (index, kind) in [InputKind::Dark, InputKind::Flat].into_iter().enumerate() {
        assert_eq!(effective(row(&rematched.plan, "Ha", kind)), &ha[index], "unchanged");
        let oiii = effective(row(&rematched.plan, "OIII", kind));
        assert_eq!(oiii.view_revision, 2);
        assert_eq!(oiii.light_asset_ids.len(), 1, "the new membership is recorded");
    }
}

/// CAL-AC-14, CAL-FR-10, D-W37: the run's one rig decides the candidates.
/// Another camera's darks are no candidates; flats of another optical train
/// read incompatible, by headers or by a Confirmed Equipment association; the
/// requirement table has no camera grouping.
#[tokio::test]
async fn other_camera_not_candidate_other_train_incompatible() {
    let mut calibration = Vec::new();
    for index in 1..=2 {
        let mut other_camera = dark("2026-09-18", 300.0);
        other_camera.camera = Some("ASI533MC".into());
        calibration.push((format!("darks/533/Dark_{index:03}.fits"), other_camera));
        let mut esprit = meta("FLAT", Some("Ha"), 2.0, "2026-09-18");
        esprit.telescope = Some("Esprit 100".into());
        esprit.focal_length_mm = Some(550.0);
        calibration.push((format!("flats/esprit/Flat_Ha_{index:03}.fits"), esprit));
        calibration.push((
            format!("flats/bare/Flat_OIII_{index:03}.fits"),
            meta("FLAT", Some("OIII"), 2.0, "2026-09-24"),
        ));
    }
    let world = world(&calibration, &[]).await;
    let bare = world.session_at(&world.calibration, "flats/bare/Flat_OIII_001.fits").await;
    world
        .catalog()
        .confirm_equipment(&[expected_session(&bare)], world.other_rig.id)
        .await
        .unwrap();

    let plan = world.plan(1).await;
    assert_eq!(plan.requirements.len(), 4, "two light groups by two kinds");
    for kind in [InputKind::Dark, InputKind::Flat] {
        assert!(
            plan.requirements
                .iter()
                .all(|r| !serde_json::to_string(&r.light_group).unwrap().contains("ASI")),
            "no camera in a light group key ({kind:?})"
        );
    }
    for channel in ["Ha", "OIII"] {
        let darks = row(&plan, channel, InputKind::Dark);
        assert!(darks.candidates.is_empty(), "another camera's darks: {darks:#?}");
        assert_eq!(darks.reason, Some(UnresolvedReason::NoCandidate));
    }
    for channel in ["Ha", "OIII"] {
        let flats = row(&plan, channel, InputKind::Flat);
        let [candidate] = flats.candidates.as_slice() else { panic!("{flats:#?}") };
        let train = candidate
            .evaluation
            .criteria
            .iter()
            .find(|c| c.criterion == CriterionId::OpticalTrain)
            .unwrap();
        assert_eq!(train.verdict, Verdict::Incompatible, "{channel}: {train:#?}");
        assert_eq!(flats.state, RequirementState::NeedsReview);
        assert_eq!(flats.reason, Some(UnresolvedReason::CriterionIncompatible));
    }
    let outcome = world.assign(1).await;
    assert!(outcome.assigned.is_empty());
}

/// CAL-FR-09: the readiness line counts light groups matched, needing review,
/// excepted and excluded; an exception or an exclusion resolves a group.
#[tokio::test]
async fn readiness_counts_groups() {
    let mut calibration = standard_calibration();
    calibration.retain(|(path, _)| !path.starts_with("flats/OIII"));
    for index in 1..=2 {
        calibration.push((
            format!("flats/OIII/Flat_OIII_{index:03}.fits"),
            meta("FLAT", Some("OIII"), 2.0, "2026-09-26"),
        ));
    }
    let world = world(&calibration, &[]).await;
    let plan = world.assign(1).await.plan;
    let readiness = world.library.calibration_readiness(world.run, 1).await.unwrap();
    assert_eq!(readiness.groups.len(), 2);
    assert_eq!(
        (readiness.matched, readiness.needs_review, readiness.excepted, readiness.excluded),
        (1, 1, 0, 0)
    );
    assert!(!readiness.ready);
    let oiii_group = readiness
        .groups
        .iter()
        .find(|group| group.light_group.channel.as_deref() == Some("OIII"))
        .unwrap();
    assert_eq!(oiii_group.state, RequirementState::NeedsReview);
    assert_eq!(oiii_group.light_session_ids.len(), 1);

    let oiii_flat = row(&plan, "OIII", InputKind::Flat);
    let input = oiii_flat.candidates[0].candidate.input().unwrap();
    let blank = world
        .library
        .calibration_record_exception(
            world.run,
            1,
            plan.plan_revision,
            &item(oiii_flat, input),
            " ",
        )
        .await
        .unwrap_err();
    assert_eq!(blank.response(None, None).kind, "invalid_input");
    let excepted = world
        .library
        .calibration_record_exception(
            world.run,
            1,
            plan.plan_revision,
            &item(oiii_flat, input),
            "Same rotation as 24 Sep; train not changed",
        )
        .await
        .unwrap();
    let readiness = world.library.calibration_readiness(world.run, 1).await.unwrap();
    assert_eq!((readiness.matched, readiness.excepted, readiness.needs_review), (1, 1, 0));
    assert!(readiness.ready);

    let oiii_flat = row(&excepted, "OIII", InputKind::Flat);
    let withdrawn = world
        .library
        .calibration_withdraw(world.run, 1, excepted.plan_revision, &[key(oiii_flat)])
        .await
        .unwrap();
    let excluded = world
        .library
        .calibration_exclude(
            world.run,
            1,
            withdrawn.plan_revision,
            &[key(oiii_flat)],
            Some("No OIII flats this season"),
        )
        .await
        .unwrap();
    assert_eq!(row(&excluded, "OIII", InputKind::Flat).state, RequirementState::Excluded);
    let readiness = world.library.calibration_readiness(world.run, 1).await.unwrap();
    assert_eq!((readiness.matched, readiness.excluded, readiness.needs_review), (1, 1, 0));
    assert!(readiness.ready);
    let handoff = world.library.calibration_handoff(world.run, 1).await.unwrap();
    assert!(handoff.ready);
    assert_eq!(handoff.excluded.len(), 1);
}

/// CAL-AC-10, CAL-FR-08: an adopted master whose library copy was replaced in
/// place with its size and mtime preserved reads drifted at assignment and is
/// neither assigned nor accepted; restoring the adopted bytes restores the
/// automatic assignment with no new adoption.
#[tokio::test]
async fn adopted_master_drift_blocks_assignment() {
    let mut calibration = standard_calibration();
    calibration.retain(|(path, _)| !path.starts_with("darks/"));
    let mut master = dark("2026-09-18", 300.0);
    master.image_type = Some("Master Dark".into());
    master.stack_count = Some(30);
    let world = world(&calibration, &[(MASTER_SOURCE.to_owned(), master)]).await;
    let source = world.asset_at(&world.results, MASTER_SOURCE).await;
    let review = world
        .library
        .calibration_review_adoption(
            &AdoptionSource::Asset {
                asset_id: source.id,
                expected: ExpectedAsset {
                    asset_id: source.id,
                    decision_revision: source.decision_revision,
                    fingerprint: source.fingerprint.clone(),
                },
            },
            &AdoptionDestination {
                location_id: world.calibration.id,
                relative_path: NativePath::from_path(Path::new(MASTER_DESTINATION)),
            },
        )
        .await
        .unwrap();
    let adopted = world.library.calibration_adopt(review.id, review.revision).await.unwrap();
    let master = adopted.master.expect("the master is registered");

    let installed = world.root(&world.calibration).join(MASTER_DESTINATION);
    let original = std::fs::read(&installed).unwrap();
    let modified = std::fs::metadata(&installed).unwrap().modified().unwrap();
    let rewrite = |bytes: &[u8]| {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new().write(true).open(&installed).unwrap();
        file.write_all(bytes).unwrap();
        file.set_modified(modified).unwrap();
        file.sync_all().unwrap();
    };
    let mut drifted = original.clone();
    drifted[0] ^= 0xff;
    rewrite(&drifted);

    let outcome = world.assign(1).await;
    assert_eq!(outcome.drifted, [master.id]);
    for channel in ["Ha", "OIII"] {
        let darks = row(&outcome.plan, channel, InputKind::Dark);
        assert_eq!(darks.state, RequirementState::NeedsReview, "{darks:#?}");
        assert_eq!(darks.reason, Some(UnresolvedReason::MasterDrifted));
        assert!(darks.effective.is_none() && darks.preselected.is_none());
        assert!(darks.candidates[0].state.drifted, "the master reads drifted");
        assert_eq!(row(&outcome.plan, channel, InputKind::Flat).state, RequirementState::Automatic);
    }
    let darks = row(&outcome.plan, "Ha", InputKind::Dark);
    let refused = world
        .library
        .calibration_accept(
            world.run,
            1,
            outcome.plan.plan_revision,
            &[item(darks, InputRef::Master { master_id: master.id, revision: master.revision })],
        )
        .await
        .unwrap_err();
    assert_eq!(refused.response(None, None).kind, "identity_conflict", "{refused}");

    rewrite(&original);
    let restored = world.assign(1).await;
    assert!(restored.drifted.is_empty());
    for channel in ["Ha", "OIII"] {
        let darks = row(&restored.plan, channel, InputKind::Dark);
        assert_eq!(darks.state, RequirementState::Automatic, "{darks:#?}");
        let decision = effective(darks);
        assert_eq!(
            decision.input,
            Some(InputRef::Master { master_id: master.id, revision: master.revision })
        );
        assert_eq!(
            decision.inputs[0].fingerprint.content_sha256.as_deref(),
            Some(support::digest(&installed).as_str())
        );
        assert!(!darks.candidates[0].state.drifted);
    }
    let adoptions = world.library.calibration_list_adoptions(None, 0, 0).await.unwrap();
    assert_eq!(adoptions.len(), 1, "no new adoption");
}

/// CAL-FR-12, PRJ-FR-11: Project calibration evidence per subject and channel
/// names missing calibration and an exposure mismatch, and assigns nothing.
#[tokio::test]
async fn project_evidence_names_missing_calibration_and_assigns_nothing() {
    let mut calibration = Vec::new();
    for index in 1..=2 {
        calibration.push((format!("darks/Dark_120s_{index:03}.fits"), dark("2026-09-18", 120.0)));
        calibration.push((format!("flats/Ha/Flat_Ha_{index:03}.fits"), flat("Ha", "2026-09-18")));
    }
    let world = world(&calibration, &[]).await;
    let before = world.plan(1).await.plan_revision;
    let evidence = world.library.project_calibration_evidence(world.project.id).await.unwrap();
    assert_eq!(evidence.project_id, world.project.id);
    let row_of = |channel: &str| {
        evidence.rows.iter().find(|row| row.channel.as_deref() == Some(channel)).unwrap()
    };
    let ha = row_of("Ha");
    assert_eq!(ha.subject_id, world.project.subjects[0].id);
    assert_eq!(ha.missing, [InputKind::Dark]);
    assert!(ha.exposure_mismatch);
    assert_eq!(ha.light_exposures, ["300"]);
    assert_eq!(ha.dark_exposures, ["120"]);
    let oiii = row_of("OIII");
    assert_eq!(oiii.missing, [InputKind::Dark, InputKind::Flat]);
    assert_eq!(world.plan(1).await.plan_revision, before, "evidence assigns nothing");
}
