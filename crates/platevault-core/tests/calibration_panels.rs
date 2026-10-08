// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calibration of a mosaic run group (spec 068 CAL-FR-11, CAL-AC-13; spec 069
//! PREP-FR-12; D-W41, D-W55) on the composed library: the real calibration
//! rules, the real pointing assessment and the real disk probe over real
//! files. Each panel run is matched on its own lights and keeps its own
//! assignments, readiness, exceptions and exclusions; the group shares one
//! calibration policy and lists readiness per panel.
#![cfg(unix)]

use std::path::Path;
use std::sync::Arc;

use persistence_library::{InputQuery, SessionQuery, SourceProbe};
use platevault_core::library::{InventoryProbe, Library};
use platevault_core::*;
use uuid::Uuid;

/// `(number, RA, Dec)`: three panels 10° apart in RA at Dec +44°, rotation 0.
/// The rig's 5.4° × 3.6° field keeps them apart.
const PANELS: [(u32, f64, f64); 3] = [(1, 300.0, 44.0), (2, 310.0, 44.0), (3, 320.0, 44.0)];

/// The night each panel was taken on, by panel number.
const NIGHTS: [&str; 3] = ["2026-09-18", "2026-09-20", "2026-09-24"];

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

/// The `RedCat 51` optical-train headers of the group's rig.
fn train(mut metadata: CaptureMetadata) -> CaptureMetadata {
    metadata.telescope = Some("RedCat 51".into());
    metadata.focal_length_mm = Some(250.0);
    metadata
}

/// Two Ha lights per panel at the panel centre on the panel's night.
fn lights() -> Vec<(String, CaptureMetadata)> {
    let mut frames = Vec::new();
    for ((number, ra, dec), night) in PANELS.iter().zip(NIGHTS) {
        for index in 1..=2 {
            let mut metadata = train(meta("LIGHT", Some("Ha"), 300.0, night));
            metadata.ra_deg = Some(*ra);
            metadata.dec_deg = Some(*dec);
            frames.push((format!("Panel{number}/Ha_{index:03}.fits"), metadata));
        }
    }
    frames
}

/// Darks of 18 Sep and two Ha flat sets with the train headers: set A of
/// 18 Sep and set B of 24 Sep.
fn two_flat_sets() -> Vec<(String, CaptureMetadata)> {
    let mut frames = Vec::new();
    for index in 1..=2 {
        frames.push((
            format!("darks/Dark_300s_{index:03}.fits"),
            meta("DARK", None, 300.0, NIGHTS[0]),
        ));
        frames.push((
            format!("flats/A/Flat_Ha_{index:03}.fits"),
            train(meta("FLAT", Some("Ha"), 2.0, NIGHTS[0])),
        ));
        frames.push((
            format!("flats/B/Flat_Ha_{index:03}.fits"),
            train(meta("FLAT", Some("Ha"), 2.0, NIGHTS[2])),
        ));
    }
    frames
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

/// `RedCat 51` on the ASI2600MM: 6248 x 4176 pixels of 3.76 µm at 250 mm.
fn redcat() -> Equipment {
    Equipment {
        id: Uuid::new_v4(),
        name: "RedCat 51".into(),
        camera: Some("ASI2600MM".into()),
        telescope: Some("RedCat 51".into()),
        focal_length_mm: Some(250.0),
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
        aliases: Vec::new(),
        common_name: None,
        object_type: "nebula".into(),
        coordinates: Some(SkyCoordinates { ra_deg: 310.0, dec_deg: 44.0, frame: "ICRS".into() }),
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

fn kind(error: &LibraryError) -> String {
    error.response(None, None).kind
}

struct World {
    /// Keeps the fixture folder alive for the test.
    _temp: tempfile::TempDir,
    library: Arc<Library>,
    captures: Location,
    calibration: Location,
    group: ViewGroup,
    /// The panel runs by panel number.
    runs: Vec<Uuid>,
}

/// One mosaic subject of three panels on `RedCat`; `lights` and
/// `calibration` are scanned and every light session is confirmed on the
/// mosaic's Target and the rig. A run group is started with its panel runs
/// unsaved.
async fn world(
    lights: &[(String, CaptureMetadata)],
    calibration: &[(String, CaptureMetadata)],
) -> World {
    let temp = tempfile::tempdir().unwrap();
    let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
    let mut locations = Vec::new();
    for (name, role) in [
        ("Astro-T7/Captures", LocationRole::Captures),
        ("Astro-T7/Calibration", LocationRole::Calibration),
    ] {
        let root = temp.path().join(name);
        std::fs::create_dir_all(&root).unwrap();
        let location = library
            .register_location(NativePath::from_path(&root), name.into(), role)
            .await
            .unwrap();
        locations.push((location, root));
    }
    scan(&library, &locations[0].0, &locations[0].1, lights).await;
    scan(&library, &locations[1].0, &locations[1].1, calibration).await;
    let catalog = library.catalog();
    let ngc = catalog.save_target(&target(), None).await.unwrap();
    let rig = catalog.save_equipment(&redcat(), None).await.unwrap();
    let panels = PANELS
        .iter()
        .map(|&(number, ra_deg, dec_deg)| PanelInput {
            number,
            ra_deg,
            dec_deg,
            rotation_deg: Some(0.0),
        })
        .collect();
    let project = catalog
        .create_project(&ProjectInput {
            name: "Cygnus 2026".into(),
            notes: None,
            subjects: vec![SubjectInput {
                target_id: ngc.candidate.id,
                name: Some("NGC 7000 Mosaic".into()),
                mosaic: true,
                panels,
            }],
            rig_ids: vec![rig.id],
            goals: Vec::new(),
        })
        .await
        .unwrap();
    let summaries = catalog.list_sessions(&SessionQuery::default()).await.unwrap();
    for summary in summaries {
        let session = summary.session;
        catalog.associate_target(&[expected_session(&session)], ngc.candidate.id).await.unwrap();
        let session = catalog.session(session.id).await.unwrap().summary.session;
        catalog.confirm_equipment(&[expected_session(&session)], rig.id).await.unwrap();
    }
    let subject = &project.subjects[0];
    let detail = library
        .create_view_group(&NewViewGroup {
            project_id: project.id,
            subject_id: subject.id,
            rig_id: rig.id,
            name: "NGC 7000 Mosaic".into(),
            panels: subject.panels.clone(),
        })
        .await
        .unwrap();
    let runs = detail.panels.iter().map(|panel| panel.view.id).collect();
    World {
        library: Arc::clone(&library),
        captures: locations[0].0.clone(),
        calibration: locations[1].0.clone(),
        group: detail.group,
        runs,
        _temp: temp,
    }
}

impl World {
    fn catalog(&self) -> &persistence_library::Catalog {
        self.library.catalog()
    }

    fn run(&self, number: u32) -> Uuid {
        self.runs[number as usize - 1]
    }

    /// Save every panel run's draft as its first membership revision.
    async fn save_all(&self) {
        for run in &self.runs {
            let record = self.catalog().view(*run).await.unwrap();
            let draft = record.draft.expect("a panel run starts with a draft").draft_revision;
            self.catalog().save_view(*run, record.view.revision, draft).await.unwrap();
        }
    }

    async fn plan(&self, number: u32) -> CalibrationViewPlan {
        self.library.calibration_view_plan(self.run(number), 1).await.unwrap()
    }

    async fn readiness(&self, number: u32) -> CalibrationReadiness {
        self.library.calibration_readiness(self.run(number), 1).await.unwrap()
    }

    /// The automatic match of a panel run's first revision.
    async fn assign(&self, number: u32) -> CalibrationAssignment {
        let expected = self.plan(number).await.plan_revision;
        self.library.calibration_assign(self.run(number), 1, expected).await.unwrap()
    }

    async fn asset_at(&self, location: &Location, path: &str) -> Uuid {
        self.catalog()
            .location_assets(location.id)
            .await
            .unwrap()
            .into_iter()
            .find(|asset| asset.relative_path.display() == path)
            .unwrap()
            .id
    }

    /// The light session of panel `number`.
    async fn light_session(&self, number: u32) -> Uuid {
        let asset = self.asset_at(&self.captures, &format!("Panel{number}/Ha_001.fits")).await;
        let summaries = self.catalog().list_sessions(&SessionQuery::default()).await.unwrap();
        summaries.into_iter().map(|s| s.session).find(|s| s.asset_ids.contains(&asset)).unwrap().id
    }

    /// The raw set holding the calibration frame at `path`.
    async fn raw_set(&self, path: &str) -> Uuid {
        let asset = self.asset_at(&self.calibration, path).await;
        let inputs = self.library.calibration_inputs(&InputQuery::default()).await.unwrap();
        inputs.iter().find(|input| input.member_assets.contains(&asset)).unwrap().input.id()
    }
}

fn row(plan: &CalibrationViewPlan, kind: InputKind) -> &Requirement {
    plan.requirements
        .iter()
        .find(|r| r.kind == kind && r.light_group.channel.as_deref() == Some("Ha"))
        .unwrap_or_else(|| panic!("no Ha {kind:?} requirement: {plan:#?}"))
}

fn effective(requirement: &Requirement) -> &CalibrationDecision {
    &requirement.effective.as_ref().expect("an effective decision").decision
}

/// CAL-FR-11, CAL-AC-13: each panel run is matched on its own lights. Panel 3
/// was taken on a night with another flat set, so its flats differ from
/// Panel 1's; every panel run has its own readiness line, and an exclusion
/// in Panel 3 leaves the other panels as they were. The policy is the
/// group's: a panel run cannot set its own, and the group's setup moves
/// every panel's plan revision.
#[tokio::test]
async fn each_panel_own_assignments_and_readiness() {
    let world = world(&lights(), &two_flat_sets()).await;
    world.save_all().await;
    let set_a = world.raw_set("flats/A/Flat_Ha_001.fits").await;
    let set_b = world.raw_set("flats/B/Flat_Ha_001.fits").await;
    let darks = world.raw_set("darks/Dark_300s_001.fits").await;

    for number in 1..=3 {
        let outcome = world.assign(number).await;
        assert_eq!(outcome.assigned.len(), 2, "Panel {number}: {outcome:#?}");
        let light = world.light_session(number).await;
        for requirement in &outcome.plan.requirements {
            assert_eq!(requirement.light_session_ids, vec![light], "Panel {number}'s own lights");
            assert_eq!(requirement.state, RequirementState::Automatic, "Panel {number}");
        }
        assert_eq!(effective(row(&outcome.plan, InputKind::Dark)).input.unwrap().id(), darks);
    }
    let flat_of =
        |plan: &CalibrationViewPlan| effective(row(plan, InputKind::Flat)).input.unwrap().id();
    assert_eq!(flat_of(&world.plan(1).await), set_a, "18 Sep flats for Panel 1");
    assert_eq!(flat_of(&world.plan(2).await), set_a, "2 nights beat 4 for Panel 2");
    assert_eq!(flat_of(&world.plan(3).await), set_b, "Panel 3's own night's flats");

    let mut before = Vec::new();
    for number in 1..=3 {
        let readiness = world.readiness(number).await;
        assert_eq!(readiness.view_id, world.run(number));
        assert_eq!((readiness.groups.len(), readiness.matched), (1, 1), "Panel {number}");
        assert!(readiness.ready, "Panel {number}");
        let handoff = world.library.calibration_handoff(world.run(number), 1).await.unwrap();
        assert_eq!(handoff.assignments.len(), 2);
        let light = world.light_session(number).await;
        assert!(handoff.assignments.iter().all(|a| a.light_session_ids == vec![light]));
        before.push(readiness);
    }

    // An exclusion in Panel 3 is Panel 3's alone.
    let panel3 = world.plan(3).await;
    world
        .library
        .calibration_exclude(
            world.run(3),
            1,
            panel3.plan_revision,
            &[row(&panel3, InputKind::Flat).key()],
            Some("Panel 3 flats are dusty"),
        )
        .await
        .unwrap();
    let excluded = world.readiness(3).await;
    assert_eq!((excluded.matched, excluded.excluded), (0, 1), "{excluded:#?}");
    for number in 1..=2 {
        assert_eq!(world.readiness(number).await, before[number as usize - 1], "Panel {number}");
    }

    // The calibration policy is the group's (D-W41, D-W55).
    let revisions: Vec<Revision> = {
        let mut revisions = Vec::new();
        for number in 1..=3 {
            revisions.push(world.plan(number).await.plan_revision);
        }
        revisions
    };
    let error = world
        .library
        .calibration_set_policy(world.run(1), revisions[0], CalibrationPolicy::Manual)
        .await
        .unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "{error}");
    assert!(error.to_string().contains("run group"), "{error}");
    assert_eq!(world.plan(1).await.policy, CalibrationPolicy::Automatic, "nothing written");

    let setup = GroupSetup { calibration_policy: CalibrationPolicy::Manual, ..world.group.setup };
    world.library.set_view_group_setup(world.group.id, world.group.revision, &setup).await.unwrap();
    for number in 1..=3 {
        let plan = world.plan(number).await;
        assert_eq!(plan.policy, CalibrationPolicy::Manual, "Panel {number}");
        assert_eq!(
            plan.plan_revision,
            revisions[number as usize - 1] + 1,
            "the group's policy change moves Panel {number}'s plan revision"
        );
    }
    assert_eq!(world.readiness(1).await.matched, 1, "turning automatic off keeps decisions");
}

/// CAL-FR-11, CAL-AC-13: an exception recorded in Panel 3 for the same light
/// group key, kind and input is never applied to Panel 1 or Panel 2; they
/// still need review and their plans, readiness and handoffs are unchanged.
#[tokio::test]
async fn exception_in_one_panel_not_applied_to_other() {
    let mut calibration = Vec::new();
    for index in 1..=2 {
        calibration.push((
            format!("darks/Dark_300s_{index:03}.fits"),
            meta("DARK", None, 300.0, NIGHTS[0]),
        ));
        // No optical-train headers: the train reads unknown for every panel.
        calibration.push((
            format!("flats/bare/Flat_Ha_{index:03}.fits"),
            meta("FLAT", Some("Ha"), 2.0, NIGHTS[0]),
        ));
    }
    let world = world(&lights(), &calibration).await;
    world.save_all().await;
    let bare = world.raw_set("flats/bare/Flat_Ha_001.fits").await;
    for number in 1..=3 {
        let outcome = world.assign(number).await;
        assert_eq!(outcome.assigned.len(), 1, "only the dark is assigned: {outcome:#?}");
        let flats = row(&outcome.plan, InputKind::Flat);
        assert_eq!(flats.state, RequirementState::NeedsReview, "Panel {number}");
        assert!(flats.effective.is_none());
    }
    let mut before = Vec::new();
    for number in 1..=2 {
        before.push((
            world.plan(number).await,
            world.readiness(number).await,
            world.library.calibration_handoff(world.run(number), 1).await.unwrap(),
        ));
    }
    assert_eq!(
        row(&before[0].0, InputKind::Flat).light_group,
        row(&world.plan(3).await, InputKind::Flat).light_group,
        "the panels share one light group key"
    );

    let panel3 = world.plan(3).await;
    let flats = row(&panel3, InputKind::Flat);
    let input = flats.candidates[0].candidate.input().unwrap();
    assert_eq!(input.id(), bare);
    let item =
        DecisionItem { light_group: flats.light_group.clone(), kind: InputKind::Flat, input };
    let excepted = world
        .library
        .calibration_record_exception(
            world.run(3),
            1,
            panel3.plan_revision,
            &item,
            "Same RedCat train, headers missing",
        )
        .await
        .unwrap();
    let flats = row(&excepted, InputKind::Flat);
    assert_eq!(flats.state, RequirementState::Excepted);
    assert_eq!(effective(flats).resolution, Resolution::Exception);
    assert_eq!(effective(flats).view_id, world.run(3));
    assert!(world.readiness(3).await.ready);

    for number in 1..=2 {
        let (plan, readiness, handoff) = &before[number as usize - 1];
        let now = world.plan(number).await;
        assert_eq!(&now, plan, "Panel {number}'s plan is unchanged");
        let flats = row(&now, InputKind::Flat);
        assert_eq!(flats.state, RequirementState::NeedsReview, "Panel {number}");
        assert!(flats.effective.is_none(), "Panel {number}");
        assert_eq!(&world.readiness(number).await, readiness, "Panel {number}");
        let now = world.library.calibration_handoff(world.run(number), 1).await.unwrap();
        assert_eq!(&now, handoff, "Panel {number}");
        assert!(now.unresolved.iter().any(|u| u.kind == InputKind::Flat));
        assert!(!now.ready);
    }
}

/// CAL-FR-11, CAL-AC-13, PREP-FR-12: the group lists each panel run's
/// readiness by panel number with the one policy it shares. A panel never
/// saved reads none; Panel 3, taken at another gain, needs review and is the
/// panel the listing names, while Panels 1 and 2 read ready.
#[tokio::test]
async fn group_lists_readiness_per_panel() {
    let mut frames = lights();
    for (path, metadata) in &mut frames {
        if path.starts_with("Panel3/") {
            metadata.gain = Some(200.0);
        }
    }
    let world = world(&frames, &two_flat_sets()).await;

    let unsaved = world.library.calibration_group_readiness(world.group.id).await.unwrap();
    assert_eq!(unsaved.group_id, world.group.id);
    assert_eq!(unsaved.policy, CalibrationPolicy::Automatic);
    let listed: Vec<(u32, Uuid)> = unsaved.panels.iter().map(|p| (p.number, p.view_id)).collect();
    assert_eq!(listed, vec![(1, world.run(1)), (2, world.run(2)), (3, world.run(3))]);
    assert!(unsaved.panels.iter().all(|panel| panel.readiness.is_none()), "nothing saved yet");

    world.save_all().await;
    for number in 1..=3 {
        world.assign(number).await;
    }
    let group = world.library.calibration_group_readiness(world.group.id).await.unwrap();
    assert_eq!(group.panels.len(), 3);
    for panel in &group.panels {
        let readiness = panel.readiness.as_ref().expect("a saved panel run reads its line");
        assert_eq!(readiness, &world.readiness(panel.number).await, "Panel {}", panel.number);
        assert_eq!((readiness.view_id, readiness.view_revision), (panel.view_id, 1));
    }
    let needing_review: Vec<u32> = group
        .panels
        .iter()
        .filter(|panel| panel.readiness.as_ref().is_some_and(|r| !r.ready))
        .map(|panel| panel.number)
        .collect();
    assert_eq!(needing_review, vec![3], "the listing names Panel 3: {group:#?}");
    let panel3 = group.panels[2].readiness.as_ref().unwrap();
    assert_eq!((panel3.matched, panel3.needs_review), (0, 1));
    for panel in &group.panels[..2] {
        let readiness = panel.readiness.as_ref().unwrap();
        assert_eq!((readiness.matched, readiness.needs_review), (1, 0), "Panel {}", panel.number);
    }

    let setup = GroupSetup { calibration_policy: CalibrationPolicy::Manual, ..world.group.setup };
    let outcome = world
        .library
        .set_view_group_setup(world.group.id, world.group.revision, &setup)
        .await
        .unwrap();
    let manual = world.library.calibration_group_readiness(world.group.id).await.unwrap();
    assert_eq!(manual.policy, CalibrationPolicy::Manual, "one policy for the group");
    assert_eq!(manual.group_revision, outcome.group.revision);
    for panel in &manual.panels {
        assert_eq!(world.plan(panel.number).await.policy, CalibrationPolicy::Manual);
    }
}

/// CAL-FR-11, VSEL-FR-19: a Complete panel run keeps its setup when the
/// group's changes, as its own policy write is refused: the group reports it
/// refused and leaves its policy and calibration plan untouched, while every
/// other panel takes the policy and its plan revision moves by one.
#[tokio::test]
async fn group_setup_refuses_complete_panel_and_leaves_it_unchanged() {
    let world = world(&lights(), &two_flat_sets()).await;
    world.save_all().await;
    for number in 1..=3 {
        world.assign(number).await;
    }
    world.library.mark_view_complete(world.run(2)).await.unwrap();
    let mut before = Vec::new();
    for number in 1..=3 {
        before.push(world.plan(number).await);
    }
    let complete = world.catalog().view(world.run(2)).await.unwrap().view;

    let setup = GroupSetup { calibration_policy: CalibrationPolicy::Manual, ..world.group.setup };
    let outcome = world
        .library
        .set_view_group_setup(world.group.id, world.group.revision, &setup)
        .await
        .unwrap();
    assert_eq!(outcome.group.setup, setup);
    let results: Vec<(u32, bool)> = outcome
        .panels
        .iter()
        .map(|panel| (panel.number, matches!(panel.result, PanelResult::Applied)))
        .collect();
    assert_eq!(results, vec![(1, true), (2, false), (3, true)], "{outcome:#?}");
    let PanelResult::Refused { reason } = &outcome.panels[1].result else {
        panic!("Panel 2 is Complete: {:?}", outcome.panels[1].result);
    };
    assert!(reason.contains("Complete"), "{reason}");

    assert_eq!(world.catalog().view(world.run(2)).await.unwrap().view, complete, "untouched");
    assert_eq!(world.plan(2).await, before[1], "Panel 2's plan is unchanged");
    for number in [1, 3] {
        let plan = world.plan(number).await;
        let earlier = &before[number as usize - 1];
        assert_eq!(plan.policy, CalibrationPolicy::Manual, "Panel {number}");
        assert_eq!(plan.plan_revision, earlier.plan_revision + 1, "Panel {number}");
    }
    let group = world.library.calibration_group_readiness(world.group.id).await.unwrap();
    assert_eq!(group.policy, CalibrationPolicy::Manual);
}
