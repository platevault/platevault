// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Composed Project acceptance (spec 065) over the worked NGC 7000 subset: six
//! Redcat 51 sessions of real generated FITS/XISF indexed through Library scans,
//! one Project with an HOO checklist, `Library::project_detail`, the registered
//! Project reference source and restart. Project records never change a library
//! record, and every fixture file is only ever read.

mod support;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use persistence_library::SessionQuery;
use platevault_core::library::{InventoryProbe, Library};
use platevault_core::targets::ICRS_FRAME;
use platevault_core::*;
use uuid::Uuid;

const BACKYARD: (f64, f64) = (52.0, 4.5);
const SECOND_SITE: (f64, f64) = (40.4, -3.7);
/// Three nights, the last one away from Backyard.
const NIGHTS: [(&str, (f64, f64)); 3] =
    [("2026-09-18", BACKYARD), ("2026-09-19", BACKYARD), ("2026-09-20", SECOND_SITE)];
const FILTERS: [&str; 2] = ["Ha", "OIII"];
const NGC7000: (f64, f64) = (314.75, 44.33);

fn frame_name(night: usize, filter: &str, index: usize) -> String {
    let extension = if filter == "Ha" { "fits" } else { "xisf" };
    format!("n{night}_{filter}_{index}.{extension}")
}

/// Two 300 s light frames per night and filter, taken with the Redcat 51.
fn write_frames(root: &Path) -> Vec<(PathBuf, String)> {
    let mut originals = Vec::new();
    for (night, (date, (latitude, longitude))) in NIGHTS.iter().enumerate() {
        for (hour, filter) in FILTERS.iter().enumerate() {
            for index in 0..2 {
                let fields = [
                    ("IMAGETYP", "'LIGHT'".to_owned()),
                    ("INSTRUME", "'ASI2600MM'".into()),
                    ("TELESCOP", "'RedCat 51'".into()),
                    ("OBJECT", "'NGC 7000'".into()),
                    ("FILTER", format!("'{filter}'")),
                    ("EXPTIME", "300".into()),
                    ("DATE-OBS", format!("'{date}T2{}:0{}:00'", hour + 1, index * 5)),
                    ("SITELAT", format!("{latitude:.1}")),
                    ("SITELONG", format!("{longitude:.1}")),
                ];
                let fields: Vec<(&str, &str)> =
                    fields.iter().map(|(key, value)| (*key, value.as_str())).collect();
                let path = root.join(frame_name(night, filter, index));
                if *filter == "Ha" {
                    support::fits(&path, &fields).unwrap();
                } else {
                    support::xisf(&path, &fields).unwrap();
                }
                originals.push((path.clone(), support::digest(&path)));
            }
        }
    }
    originals
}

/// Start a scan and wait for its terminal event, published after scan-time work.
async fn scan_to_end(library: &Arc<Library>, location: Uuid) -> ScanOperation {
    let mut progress = library.subscribe_scan_progress();
    let started = library.start_scan(location, None).await.unwrap();
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let operation = progress.recv().await.unwrap();
            if operation.id == started.id && operation.state != ScanState::Running {
                return operation;
            }
        }
    })
    .await
    .expect("scan must publish its terminal state")
}

/// The worked subset, indexed, with the prefilled NGC 7000 Target saved.
struct Worked {
    _temp: tempfile::TempDir,
    database: PathBuf,
    root: PathBuf,
    library: Arc<Library>,
    location: Uuid,
    target: TargetRecord,
    originals: Vec<(PathBuf, String)>,
}

impl Worked {
    async fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("RedCat");
        std::fs::create_dir(&root).unwrap();
        let originals = write_frames(&root);
        let database = temp.path().join("library.sqlite");
        let library = Library::open(&database, None).await.unwrap();
        let location = library
            .register_location(
                NativePath::from_path(&root),
                "RedCat".into(),
                LocationRole::Captures,
            )
            .await
            .unwrap();
        assert_eq!(scan_to_end(&library, location.id).await.state, ScanState::Completed);
        let target = TargetCandidate {
            id: Uuid::new_v4(),
            designation: "NGC 7000".into(),
            aliases: Vec::new(),
            common_name: Some("North America Nebula".into()),
            object_type: "nebula".into(),
            coordinates: Some(coordinates()),
            provenance: Provenance::User,
            provider_id: None,
        };
        let target = library.catalog().save_target(&target, None).await.unwrap();
        Self { _temp: temp, database, root, library, location: location.id, target, originals }
    }

    async fn copy(&self, night: usize, filter: &str, index: usize) -> Asset {
        let name = frame_name(night, filter, index);
        let assets = self.library.catalog().location_assets(self.location).await.unwrap();
        assets.into_iter().find(|asset| asset.relative_path.display() == name).unwrap()
    }

    /// The six current sessions in night order, Ha before OIII.
    async fn sessions(&self) -> Vec<Session> {
        let current = self.library.catalog().list_sessions(&SessionQuery::default()).await.unwrap();
        let mut sessions = Vec::new();
        for night in 0..NIGHTS.len() {
            for filter in FILTERS {
                let asset = self.copy(night, filter, 0).await;
                let session = current
                    .iter()
                    .map(|summary| summary.session.clone())
                    .find(|session| session.asset_ids.contains(&asset.id))
                    .unwrap();
                assert_eq!(session.asset_ids.len(), 2, "one session per night and filter");
                sessions.push(session);
            }
        }
        sessions
    }

    fn input(&self, notes: Option<&str>) -> ProjectInput {
        ProjectInput {
            name: "NGC 7000 HOO".into(),
            notes: notes.map(str::to_owned),
            targets: vec![TargetFraming {
                target_id: self.target.candidate.id,
                expected_revision: self.target.decision_revision,
            }],
            panels: Vec::new(),
            equipment_ids: Vec::new(),
        }
    }

    /// Create the Project with the prefilled Target, link the six sessions and
    /// add the HOO checklist.
    async fn hoo_project(&self) -> Project {
        let catalog = self.library.catalog();
        let project = catalog.create_project(&self.input(None)).await.unwrap();
        let links: Vec<SessionLinkInput> = self
            .sessions()
            .await
            .iter()
            .map(|session| SessionLinkInput { session: expected_session(session), panel_id: None })
            .collect();
        let project = catalog.link_sessions(project.id, project.revision, &links).await.unwrap();
        let items = [
            ChecklistKind::Integration { channel: "Ha".into(), goal_seconds: 36_000 },
            ChecklistKind::Integration { channel: "OIII".into(), goal_seconds: 36_000 },
            ChecklistKind::ExposurePreference { exposure_seconds: 300.0, channel: None },
        ]
        .map(|criterion| ChecklistItemInput { id: None, criterion });
        catalog.set_checklist(project.id, project.revision, &items).await.unwrap()
    }

    /// Every asset and session record with its quality, decision revisions and
    /// associations, and the Target coverage.
    async fn library_state(&self) -> serde_json::Value {
        let catalog = self.library.catalog();
        let assets = catalog.location_assets(self.location).await.unwrap();
        let query = SessionQuery { include_superseded: true, ..SessionQuery::default() };
        let mut sessions = Vec::new();
        for summary in catalog.list_sessions(&query).await.unwrap() {
            sessions.push(catalog.session(summary.session.id).await.unwrap());
        }
        let coverage = catalog.target_coverage(self.target.candidate.id).await.unwrap();
        serde_json::json!({ "assets": assets, "sessions": sessions, "coverage": coverage })
    }

    fn assert_originals(&self) {
        for (path, digest) in &self.originals {
            assert_eq!(&support::digest(path), digest, "{} is read-only", path.display());
        }
    }
}

fn coordinates() -> SkyCoordinates {
    SkyCoordinates { ra_deg: NGC7000.0, dec_deg: NGC7000.1, frame: ICRS_FRAME.into() }
}

fn expected_session(session: &Session) -> ExpectedSession {
    ExpectedSession {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        decision_revision: session.decision_revision,
    }
}

fn expected_of(asset: &Asset) -> ExpectedAsset {
    ExpectedAsset {
        asset_id: asset.id,
        decision_revision: asset.decision_revision,
        fingerprint: asset.fingerprint.clone(),
    }
}

fn us(seconds: u64) -> Microseconds {
    Microseconds::from_whole_seconds(seconds).unwrap()
}

/// The integration item of `channel`: (captured, usable, accepted, goal, met).
fn integration(
    detail: &ProjectDetail,
    channel: &str,
) -> (Microseconds, Microseconds, Microseconds, Microseconds, bool) {
    let item = detail
        .checklist
        .iter()
        .find(|progress| {
            matches!(&progress.item.criterion, ChecklistKind::Integration { channel: c, .. } if c == channel)
        })
        .unwrap();
    assert_eq!(item.basis, ChecklistBasis::AcceptedIntegration);
    match &item.outcome {
        ChecklistOutcome::Seconds { captured, usable, accepted, goal, met } => {
            (*captured, *usable, *accepted, *goal, *met)
        }
        other => panic!("integration reports seconds: {other:?}"),
    }
}

/// PRJ-AC-01, PRJ-AC-04, PRJ-AC-05, PRJ-AC-07, PV-PRJ-SC-01: the detail shows the
/// confirmed framing, captured and usable progress apart and unmet, 300 s
/// exposure evidence and each session's own site, with no Project site field.
#[tokio::test]
async fn the_worked_hoo_project_shows_framing_progress_and_per_session_evidence() {
    let worked = Worked::new().await;
    let (library, catalog) = (&worked.library, worked.library.catalog());
    let project = worked.hoo_project().await;
    let first_ha = [worked.copy(0, "Ha", 0).await, worked.copy(0, "Ha", 1).await];
    let expected: Vec<ExpectedAsset> = first_ha.iter().map(expected_of).collect();
    catalog.set_quality(&expected, Quality::Usable, InventoryProbe).await.unwrap();

    let before = catalog.project(project.id).await.unwrap();
    let detail = library.project_detail(project.id).await.unwrap();
    assert_eq!(detail.project, before, "the detail carries the committed Project");
    let framing = &detail.project.targets[0];
    assert_eq!(framing.target_id, worked.target.candidate.id);
    assert_eq!(framing.designation, "NGC 7000");
    assert_eq!(framing.coordinates, Some(coordinates()));
    assert_eq!(framing.provenance, Provenance::User);
    assert!(!framing.framing_changed);
    assert_eq!(integration(&detail, "Ha"), (us(1_800), us(600), us(600), us(36_000), false));
    assert_eq!(integration(&detail, "OIII"), (us(1_800), us(0), us(0), us(36_000), false));

    let sessions = worked.sessions().await;
    assert_eq!(detail.links.len(), 6);
    for (position, session) in sessions.iter().enumerate() {
        let link = detail.links.iter().find(|link| link.session_id == session.id).unwrap();
        let filter = FILTERS[position % 2];
        let site = NIGHTS[position / 2].1;
        assert_eq!(link.state, LinkState::Current);
        assert_eq!(
            link.exposures,
            [SessionExposure {
                channel: Some(filter.into()),
                exposure_seconds: Some(us(300)),
                frames: 2
            }]
        );
        assert_eq!(
            link.capture_sites,
            [CaptureSite { latitude_deg: site.0, longitude_deg: site.1, frames: 2 }],
            "each linked session shows its own observed site"
        );
    }
    let preference = &detail.checklist[2];
    assert_eq!(preference.basis, ChecklistBasis::SessionExposure);
    let ChecklistOutcome::Evidence { evidence } = &preference.outcome else {
        panic!("exposure preference reports evidence: {preference:?}");
    };
    assert_eq!(evidence.len(), 6);
    for entry in evidence {
        assert_eq!(
            (entry.state, entry.reason.as_str()),
            (EvidenceState::Matches, "exposure_matches")
        );
    }
    let wire = serde_json::to_value(&detail.project).unwrap();
    let fields: Vec<&String> = wire.as_object().unwrap().keys().collect();
    assert!(
        fields.iter().all(|field| !field.to_lowercase().contains("site")
            && !field.to_lowercase().contains("latitude")),
        "a Project has no capture site: {fields:?}"
    );

    // PRJ-AC-05 (Project side): reading context of an unmet checklist succeeds
    // and leaves the Project revision unchanged.
    let context = catalog.project(project.id).await.unwrap();
    assert_eq!(context, before);
    assert_eq!(catalog.project(project.id).await.unwrap().revision, project.revision);
    worked.assert_originals();
}

/// PRJ-AC-02, PRJ-AC-03, PRJ-AC-08, PRJ-FR-05, PRJ-FR-08, PV-PRJ-SC-03: Project
/// writes and evaluation change no library record or source; a goal edited to the
/// accepted total is met without changing the Project; a rejection lowers
/// accepted only; restart restores the same detail.
#[tokio::test]
async fn project_writes_leave_the_library_unchanged_and_a_met_goal_changes_no_project_field() {
    let worked = Worked::new().await;
    let (library, catalog) = (&worked.library, worked.library.catalog());
    let expected: Vec<ExpectedSession> =
        worked.sessions().await.iter().map(expected_session).collect();
    catalog.associate_target(&expected, worked.target.candidate.id).await.unwrap();
    let first_ha = [worked.copy(0, "Ha", 0).await, worked.copy(0, "Ha", 1).await];
    let usable: Vec<ExpectedAsset> = first_ha.iter().map(expected_of).collect();
    catalog.set_quality(&usable, Quality::Usable, InventoryProbe).await.unwrap();
    let state = worked.library_state().await;

    // Create, edit, link and checklist: the library stays as it was.
    let project = worked.hoo_project().await;
    let project = catalog
        .update_project(project.id, project.revision, &worked.input(Some("Bicolor HOO")))
        .await
        .unwrap();
    assert_eq!(project.notes.as_deref(), Some("Bicolor HOO"));
    assert_eq!(project.links.len(), 6, "an edit keeps the links");
    let detail = library.project_detail(project.id).await.unwrap();
    assert_eq!(integration(&detail, "Ha"), (us(1_800), us(600), us(600), us(36_000), false));
    assert_eq!(worked.library_state().await, state, "Project writes change no library record");

    // The Ha goal edited to the accepted total is met; evaluation writes nothing.
    let items: Vec<ChecklistItemInput> = project
        .checklist
        .iter()
        .map(|item| {
            let criterion = match &item.criterion {
                ChecklistKind::Integration { channel, .. } if channel == "Ha" => {
                    ChecklistKind::Integration { channel: channel.clone(), goal_seconds: 600 }
                }
                criterion => criterion.clone(),
            };
            ChecklistItemInput { id: Some(item.id), criterion }
        })
        .collect();
    let project = catalog.set_checklist(project.id, project.revision, &items).await.unwrap();
    let detail = library.project_detail(project.id).await.unwrap();
    assert_eq!(integration(&detail, "Ha"), (us(1_800), us(600), us(600), us(600), true));
    assert_eq!(catalog.project(project.id).await.unwrap(), project, "evaluation changes nothing");
    let project = catalog
        .update_project(project.id, project.revision, &worked.input(Some("Ha goal met")))
        .await
        .unwrap();
    assert_eq!(project.checklist, detail.project.checklist, "a met item stays an item");

    // Rejecting a Usable frame lowers accepted; captured, usable and coverage stay.
    let rejected = worked.copy(0, "Ha", 0).await;
    let project = catalog
        .set_project_rejection(project.id, project.revision, &[expected_of(&rejected)], true)
        .await
        .unwrap();
    let detail = library.project_detail(project.id).await.unwrap();
    assert_eq!(integration(&detail, "Ha"), (us(1_800), us(600), us(300), us(600), false));
    assert_eq!(detail.rejections.len(), 1);
    assert_eq!(detail.rejections[0].asset_id, rejected.id);
    // A rejected library-Unreviewed frame stays captured and never becomes accepted.
    let unreviewed = worked.copy(1, "Ha", 0).await;
    let project = catalog
        .set_project_rejection(project.id, project.revision, &[expected_of(&unreviewed)], true)
        .await
        .unwrap();
    let detail = library.project_detail(project.id).await.unwrap();
    assert_eq!(integration(&detail, "Ha"), (us(1_800), us(600), us(300), us(600), false));
    let ha = detail.progress.channels.iter().find(|row| row.channel.as_deref() == Some("Ha"));
    assert_eq!(ha.unwrap().rejected_frames, 2);
    assert_eq!(worked.library_state().await, state, "rejections change no library record");

    // Restart: the reopened library reports the identical detail.
    worked.assert_originals();
    let before = serde_json::to_value(&detail).unwrap();
    let Worked { _temp: temp, database, library, originals, .. } = worked;
    drop(library);
    let reopened = Library::open(&database, None).await.unwrap();
    let after = serde_json::to_value(reopened.project_detail(project.id).await.unwrap()).unwrap();
    assert_eq!(after, before);
    for (path, digest) in &originals {
        assert_eq!(&support::digest(path), digest, "{} is read-only", path.display());
    }
    drop(temp);
}

/// PRJ-FR-07: `Library::open` registers the Project reference source. Retire
/// review names a Project linking the location's copies, and a Project edit
/// after the review makes the review stale.
#[tokio::test]
async fn retire_review_names_a_linking_project_and_a_later_project_edit_refuses_it() {
    let worked = Worked::new().await;
    let (library, catalog) = (&worked.library, worked.library.catalog());
    let project = worked.hoo_project().await;
    let unplugged = worked.root.with_file_name("RedCat unplugged");
    std::fs::rename(&worked.root, &unplugged).unwrap();
    assert_eq!(scan_to_end(library, worked.location).await.state, ScanState::Failed);

    let review = library.review_retire_location(worked.location).await.unwrap();
    assert!(review.consulted.contains(&ReferenceKind::Project), "{:?}", review.consulted);
    let mut held: Vec<Uuid> =
        catalog.location_assets(worked.location).await.unwrap().iter().map(|a| a.id).collect();
    held.sort_unstable();
    assert_eq!(
        review.references,
        [AssetReference {
            kind: ReferenceKind::Project,
            id: project.id,
            name: "NGC 7000 HOO".into(),
            revision: project.revision,
            asset_ids: held,
        }]
    );

    let edited = catalog
        .update_project(project.id, project.revision, &worked.input(Some("after review")))
        .await
        .unwrap();
    assert!(edited.revision > project.revision);
    let stale = library.retire_location(review.id, worked.location, review.expected_revision).await;
    let response = stale.unwrap_err().response(None, None);
    assert_eq!(
        (response.kind.as_str(), response.identity, response.retry),
        ("conflict", Some(worked.location), RetryAction::Review)
    );
    let location = catalog.location(worked.location).await.unwrap();
    assert_eq!(location.lifecycle, LocationLifecycle::Active);
    std::fs::rename(&unplugged, &worked.root).unwrap();
    worked.assert_originals();
}
