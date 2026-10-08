// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared world for the Prepare all tests (spec 069 PREP-FR-12/13): Project
//! 'Cygnus 2026' with the mosaic subject 'NGC 7000 Mosaic' of three panels on
//! `RedCat 51`, its run group with one panel run per panel, three Ha lights
//! per panel at the panel centre on the panel's own night, darks and two Ha
//! flat sets, every panel run saved once with its calibration assigned
//! Automatic, and the empty `Work/Processing` parent. Fixture files are real.
//! Included with `#[path = "support/prepare_group.rs"] mod group_support;`.
#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use persistence_library::{SessionQuery, SourceProbe};
use platevault_core::library::{InventoryProbe, Library};
use platevault_core::prepare::PrepareControl;
use platevault_core::*;
use uuid::Uuid;

pub const PROJECT: &str = "Cygnus 2026";
pub const MOSAIC: &str = "NGC 7000 Mosaic";

/// `(number, RA, Dec)`: three panels 10° apart in RA at Dec +44°, rotation 0.
const PANELS: [(u32, f64, f64); 3] = [(1, 300.0, 44.0), (2, 310.0, 44.0), (3, 320.0, 44.0)];

/// The night each panel was taken on, by panel number.
const NIGHTS: [&str; 3] = ["2026-09-18", "2026-09-20", "2026-09-24"];

/// Lights per panel.
pub const LIGHTS: u32 = 3;

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

fn train(mut metadata: CaptureMetadata) -> CaptureMetadata {
    metadata.telescope = Some("RedCat 51".into());
    metadata.focal_length_mm = Some(250.0);
    metadata
}

/// The relative path of light `index` of panel `number`.
pub fn light_path(number: u32, index: u32) -> String {
    format!("Panel{number}/Ha_{index:03}.fits")
}

fn lights() -> Vec<(String, CaptureMetadata)> {
    let mut frames = Vec::new();
    for ((number, ra, dec), night) in PANELS.iter().zip(NIGHTS) {
        for index in 1..=LIGHTS {
            let mut metadata = train(meta("LIGHT", Some("Ha"), 300.0, night));
            metadata.ra_deg = Some(*ra);
            metadata.dec_deg = Some(*dec);
            metadata.object = Some("NGC 7000".into());
            frames.push((light_path(*number, index), metadata));
        }
    }
    frames
}

/// Darks of 18 Sep and two Ha flat sets: A of 18 Sep and B of 24 Sep.
fn calibration_frames() -> Vec<(String, CaptureMetadata)> {
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

/// One session per night of the same capture settings.
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

/// Write each file as a FITS header unique to its path, as `prepare_support`
/// writes it, and scan the location once.
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
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, super::prepare_support::fits(relative, metadata)).unwrap();
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

pub struct GroupWorld {
    pub temp: tempfile::TempDir,
    pub library: Arc<Library>,
    pub captures: Location,
    pub calibration: Location,
    /// `Work/Processing`, canonical: the parent the tests choose.
    pub output: PathBuf,
    pub project: Uuid,
    pub group: Uuid,
    /// The panel runs by panel number.
    pub runs: Vec<Uuid>,
}

/// The run group with every panel run saved once and its calibration
/// assigned Automatic.
pub async fn group_world() -> GroupWorld {
    let temp = tempfile::tempdir().unwrap();
    let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
    let mut locations = Vec::new();
    for (name, role) in [
        ("Astro-T7/Captures", LocationRole::Captures),
        ("Astro-T7/Calibration", LocationRole::Calibration),
    ] {
        let root = temp.path().join(name);
        fs::create_dir_all(&root).unwrap();
        let location = library
            .register_location(NativePath::from_path(&root), name.into(), role)
            .await
            .unwrap();
        locations.push((location, root));
    }
    let output = temp.path().join("Work/Processing");
    fs::create_dir_all(&output).unwrap();
    let output = fs::canonicalize(output).unwrap();
    scan(&library, &locations[0].0, &locations[0].1, &lights()).await;
    scan(&library, &locations[1].0, &locations[1].1, &calibration_frames()).await;
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
            name: PROJECT.into(),
            notes: None,
            subjects: vec![SubjectInput {
                target_id: ngc.candidate.id,
                name: Some(MOSAIC.into()),
                mosaic: true,
                panels,
            }],
            rig_ids: vec![rig.id],
            goals: Vec::new(),
        })
        .await
        .unwrap();
    for summary in catalog.list_sessions(&SessionQuery::default()).await.unwrap() {
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
            name: MOSAIC.into(),
            panels: subject.panels.clone(),
        })
        .await
        .unwrap();
    let world = GroupWorld {
        library: Arc::clone(&library),
        captures: locations[0].0.clone(),
        calibration: locations[1].0.clone(),
        output,
        project: project.id,
        group: detail.group.id,
        runs: detail.panels.iter().map(|panel| panel.view.id).collect(),
        temp,
    };
    for number in 1..=3 {
        let run = world.run(number);
        let record = world.catalog().view(run).await.unwrap();
        let draft = record.draft.expect("a panel run starts with a draft").draft_revision;
        world.catalog().save_view(run, record.view.revision, draft).await.unwrap();
        world.assign(number, 1).await;
    }
    world
}

impl GroupWorld {
    pub fn catalog(&self) -> &persistence_library::Catalog {
        self.library.catalog()
    }

    /// The panel run of panel `number`.
    pub fn run(&self, number: u32) -> Uuid {
        self.runs[number as usize - 1]
    }

    pub fn light(&self, number: u32, index: u32) -> PathBuf {
        self.captures.path.to_path_buf().unwrap().join(light_path(number, index))
    }

    /// Every library source a Prepare all reads.
    pub fn sources(&self) -> Vec<PathBuf> {
        let mut sources = Vec::new();
        for number in 1..=3 {
            sources.extend((1..=LIGHTS).map(|index| self.light(number, index)));
        }
        let root = self.calibration.path.to_path_buf().unwrap();
        sources.extend(calibration_frames().iter().map(|(path, _)| root.join(path)));
        sources
    }

    /// The automatic calibration match of panel `number` at membership
    /// `revision`.
    pub async fn assign(&self, number: u32, revision: Revision) {
        let run = self.run(number);
        let plan = self.library.calibration_view_plan(run, revision).await.unwrap();
        self.library.calibration_assign(run, revision, plan.plan_revision).await.unwrap();
        let handoff = self.library.calibration_handoff(run, revision).await.unwrap();
        assert!(handoff.ready, "Panel {number}: {handoff:#?}");
    }

    /// Save panel `number`'s next membership revision without its last
    /// light; its calibration is not matched again.
    pub async fn drop_last_light(&self, number: u32) {
        let run = self.run(number);
        let current = self.catalog().view(run).await.unwrap().view.revision;
        let revision = self.catalog().view_revision(run, current).await.unwrap();
        let asset = self
            .catalog()
            .location_assets(self.captures.id)
            .await
            .unwrap()
            .into_iter()
            .find(|asset| asset.relative_path.display() == light_path(number, LIGHTS))
            .unwrap()
            .id;
        let member = revision
            .members
            .iter()
            .find(|member| member.copies.iter().any(|copy| copy.asset_id == asset))
            .unwrap()
            .member_key;
        let edit = DraftEdit::SetFrames { member_keys: vec![member], state: MemberState::Excluded };
        self.catalog().edit_view_draft(run, 0, &edit).await.unwrap();
        self.catalog().save_view(run, current, 1).await.unwrap();
    }

    /// A verified read-only WBPP profile that launches `/bin/sh` with
    /// `script`, which gets `{results}` as `$1`.
    pub async fn wbpp(&self, script: &str) -> Profile {
        let proofs = Capability::ALL
            .into_iter()
            .map(|capability| CapabilityProof {
                capability,
                evidence: format!("fixture-qualified {capability}"),
            })
            .collect();
        let input = ProfileInput {
            name: "WBPP".into(),
            kind: ProfileKind::Wbpp,
            executable: Some(NativePath::from_path(Path::new("/bin/sh"))),
            args: vec!["-c".into(), script.into(), "sh".into(), "{results}".into()],
            capability_evidence: CapabilityEvidence {
                input_behavior: InputBehavior::ReadOnly,
                input_list: true,
                proofs,
            },
        };
        self.catalog().create_profile(&input).await.unwrap()
    }

    /// Give the group `profile` and `mode` as its shared setup and return the
    /// matching request under `Work/Processing`.
    pub async fn setup(&self, profile: &Profile, mode: InputMode) -> PrepareRequest {
        let revision =
            self.catalog().group_preparation_basis(self.group).await.unwrap().group.revision;
        let setup = GroupSetup {
            profile_id: Some(profile.id),
            input_mode: Some(mode),
            calibration_policy: CalibrationPolicy::Automatic,
        };
        self.library.set_view_group_setup(self.group, revision, &setup).await.unwrap();
        PrepareRequest {
            profile_id: profile.id,
            mode,
            link: None,
            output: Some(NativePath::from_path(&self.output)),
            folder_name: None,
            corrections: std::collections::BTreeMap::new(),
        }
    }

    pub async fn review(&self, request: &PrepareRequest) -> GroupPreparationReview {
        self.library.review_group_preparation(self.group, request).await.unwrap()
    }

    /// Review Prepare all, then run it at the reviewed selection.
    pub async fn prepare_all(
        &self,
        request: &PrepareRequest,
        control: &dyn PrepareControl,
    ) -> GroupPreparationOutcome {
        let review = self.review(request).await;
        self.library.prepare_group(self.group, request, &review.basis(), control).await.unwrap()
    }

    /// What records the next Prepare all Running for the reviewed `request`
    /// with `profile`: one Copy of each panel run's first light, none written
    /// and none settled, so none carries a basis.
    pub async fn running_input(
        &self,
        profile: &Profile,
        request: &PrepareRequest,
    ) -> persistence_library::NewGroupPreparation {
        let review = self.review(request).await;
        let location = review.location.clone().unwrap();
        persistence_library::NewGroupPreparation {
            group_id: self.group,
            n: review.preparation_number,
            profile_id: profile.id,
            mode: InputMode::Copy,
            link: None,
            output: location.output.clone(),
            folder: location.folder.clone(),
            assembled: location.assembled.clone(),
            panels: review
                .panels
                .iter()
                .zip(&location.panels)
                .map(|(panel, place)| persistence_library::NewPanelPreparation {
                    view_id: panel.view_id,
                    n: panel.preparation_number,
                    membership_revision: panel.membership_revision,
                    folder: place.folder.clone(),
                    results_folder: place.results.clone(),
                    entries: vec![persistence_library::NewPreparedEntry {
                        member_key: panel.entries[0].member_key,
                        asset_id: panel.entries[0].asset_id,
                        master_id: None,
                        input: PreparedInput::Light,
                        kind: PreparedEntryKind::Copy,
                        path: panel.entries[0].path.clone(),
                        source: Some(panel.entries[0].source.clone()),
                        size_bytes: panel.entries[0].size_bytes,
                        basis: None,
                        header_changes: Vec::new(),
                        blocked: None,
                    }],
                })
                .collect(),
        }
    }

    /// Confirm a catalog correction of `field` of light `index` of panel
    /// `number`, its file untouched, then match that panel run's
    /// calibration again. Returns the corrected asset.
    pub async fn correct(
        &self,
        number: u32,
        index: u32,
        field: &str,
        value: serde_json::Value,
    ) -> Uuid {
        let asset = self
            .catalog()
            .location_assets(self.captures.id)
            .await
            .unwrap()
            .into_iter()
            .find(|asset| asset.relative_path.display() == light_path(number, index))
            .unwrap();
        let expected = ExpectedAsset {
            asset_id: asset.id,
            decision_revision: asset.decision_revision,
            fingerprint: asset.fingerprint.clone(),
        };
        let correction = CorrectionInput { asset_id: asset.id, field: field.into(), value };
        self.catalog()
            .apply_correction_and_regroup(&[expected], &[correction], group_by_night)
            .await
            .unwrap();
        self.assign(number, 1).await;
        asset.id
    }

    /// `<output>/<Project>/<Mosaic>` or a later group folder.
    pub fn group_folder(&self, name: &str) -> PathBuf {
        self.output.join(PROJECT).join(name)
    }

    /// `<output>/<Project>/<Mosaic> Results`.
    pub fn results(&self) -> PathBuf {
        self.output.join(PROJECT).join(format!("{MOSAIC} Results"))
    }
}

/// Each panel run's outcome state, by panel number.
pub fn panel_states(outcome: &GroupPreparationOutcome) -> Vec<PreparationState> {
    outcome.panels.iter().map(|panel| panel.outcome.revision.state).collect()
}

/// The panel outcome of panel `number`.
pub fn panel(outcome: &GroupPreparationOutcome, number: u32) -> &PreparationOutcome {
    &outcome.panels.iter().find(|panel| panel.number == number).unwrap().outcome
}
