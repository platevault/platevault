// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Run-group Review all (spec 067 PIX-FR-17, PIX-AC-18; spec 066 VSEL-FR-19,
//! VSEL-AC-22; D-W41) over generated FITS sessions of NGC 7000 Mosaic with
//! four panel runs: one list spans every panel run with a Panel column and a
//! Panel filter, each frame listed as its own panel run's Review step lists
//! it. A mark routes as in that panel run, changes only the marked frame's
//! quality and keeps every frame in its own panel run's membership. Fixture
//! files are only read.
#![cfg(unix)]

mod support;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use persistence_library::SessionQuery;
use platevault_core::frame_review::FrameReview;
use platevault_core::library::Library;
use platevault_core::targets::ICRS_FRAME;
use platevault_core::view_groups::ViewGroupDetail;
use platevault_core::*;
use uuid::Uuid;

/// `(number, RA, Dec)`: four panels 2° apart in RA at Dec +44°, rotation 0.
/// The rig's 1.29° × 0.86° field keeps neighbouring panels apart.
const PANELS: [(u32, f64, f64); 4] =
    [(1, 312.0, 44.0), (2, 314.0, 44.0), (3, 316.0, 44.0), (4, 318.0, 44.0)];

/// One light frame per night, so each night is its own session, with the
/// panel its pointing falls in.
const NIGHTS: [(&str, (f64, f64), Option<u32>); 7] = [
    ("2026-09-01", (312.01, 44.01), Some(1)),
    ("2026-09-02", (311.98, 43.99), Some(1)),
    ("2026-09-03", (314.02, 44.02), Some(2)),
    ("2026-09-04", (313.97, 43.98), Some(2)),
    ("2026-09-05", (316.01, 44.0), Some(3)),
    ("2026-09-06", (318.0, 44.01), Some(4)),
    // Three degrees north of Panel 2: off every panel, so in no panel run.
    ("2026-09-07", (314.0, 47.0), None),
];
const OFF_PANEL: usize = 6;

const LIBRARY: QualityLabel = QualityLabel::Rejected { scope: LabelScope::Library };
const THIS_PROJECT: QualityLabel = QualityLabel::Rejected { scope: LabelScope::ThisProject };

fn write_frames(root: &Path) {
    for (night, (ra, dec), _) in NIGHTS {
        let fields = [
            ("IMAGETYP", "'LIGHT'".to_owned()),
            ("INSTRUME", "'ASI2600MM'".into()),
            ("TELESCOP", "'RedCat 51'".into()),
            ("OBJECT", "'NGC 7000'".into()),
            ("FILTER", "'Ha'".into()),
            ("EXPTIME", "300".into()),
            ("DATE-OBS", format!("'{night}T22:00:00'")),
            ("RA", format!("{ra}")),
            ("DEC", format!("{dec}")),
        ];
        let fields: Vec<(&str, &str)> =
            fields.iter().map(|(key, value)| (*key, value.as_str())).collect();
        support::fits(&root.join(format!("{night}.fits")), &fields).unwrap();
    }
}

async fn scan_to_end(library: &Arc<Library>, location: Uuid) {
    let mut progress = library.subscribe_scan_progress();
    let started = library.start_scan(location, None).await.unwrap();
    let finished = tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let operation = progress.recv().await.unwrap();
            if operation.id == started.id && operation.state != ScanState::Running {
                return operation;
            }
        }
    })
    .await
    .expect("scan must publish its terminal state");
    assert_eq!(finished.state, ScanState::Completed);
}

/// 3000 × 2000 pixels of 3.76 µm at 500 mm: a 1.29° × 0.86° field.
fn redcat() -> Equipment {
    Equipment {
        id: Uuid::new_v4(),
        name: "RedCat 51".into(),
        camera: Some("ASI2600MM".into()),
        telescope: Some("RedCat 51".into()),
        focal_length_mm: Some(500.0),
        pixel_size_um: Some(3.76),
        sensor_width_px: Some(3000),
        sensor_height_px: Some(2000),
        color_kind: None,
        decision_revision: 0,
        state: AssociationState::Confirmed,
        provenance: Provenance::User,
    }
}

fn ngc7000() -> TargetCandidate {
    TargetCandidate {
        id: Uuid::new_v4(),
        designation: "NGC 7000".into(),
        aliases: Vec::new(),
        common_name: None,
        object_type: "nebula".into(),
        coordinates: Some(SkyCoordinates {
            ra_deg: 315.0,
            dec_deg: 44.0,
            frame: ICRS_FRAME.into(),
        }),
        provenance: Provenance::User,
        provider_id: None,
        angular_size: None,
        catalogues: Vec::new(),
    }
}

const fn expected_session(session: &Session) -> ExpectedSession {
    ExpectedSession {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        decision_revision: session.decision_revision,
    }
}

fn kind(error: &LibraryError) -> String {
    error.response(None, None).kind
}

/// A mosaic Project with a four-panel run group over one indexed root.
struct World {
    _temp: tempfile::TempDir,
    library: Arc<Library>,
    location: Uuid,
    /// One frame per night, in [`NIGHTS`] order.
    frames: Vec<Uuid>,
    group: ViewGroupDetail,
    manifest: BTreeMap<PathBuf, String>,
}

impl World {
    async fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("RedCat");
        std::fs::create_dir(&root).unwrap();
        write_frames(&root);
        let manifest = NIGHTS
            .iter()
            .map(|(night, ..)| {
                let path = root.join(format!("{night}.fits"));
                let digest = support::digest(&path);
                (path, digest)
            })
            .collect();
        let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
        let location = library
            .register_location(
                NativePath::from_path(&root),
                "RedCat".into(),
                LocationRole::Captures,
            )
            .await
            .unwrap();
        scan_to_end(&library, location.id).await;
        let catalog = library.catalog();
        let mosaic = catalog.save_target(&ngc7000(), None).await.unwrap();
        let rig = catalog.save_equipment(&redcat(), None).await.unwrap();
        let assets = catalog.location_assets(location.id).await.unwrap();
        let sessions = catalog.list_sessions(&SessionQuery::default()).await.unwrap();
        let mut frames = Vec::new();
        for (night, ..) in NIGHTS {
            let name = format!("{night}.fits");
            let asset = assets.iter().find(|a| a.relative_path.display() == name).unwrap().id;
            let session = sessions.iter().find(|s| s.session.asset_ids.contains(&asset)).unwrap();
            let session_id = session.session.id;
            catalog
                .associate_target(&[expected_session(&session.session)], mosaic.candidate.id)
                .await
                .unwrap();
            let session = catalog.session(session_id).await.unwrap().summary.session;
            catalog.confirm_equipment(&[expected_session(&session)], rig.id).await.unwrap();
            frames.push(asset);
        }
        let panels = PANELS
            .iter()
            .map(|&(number, ra_deg, dec_deg)| PanelInput {
                number,
                ra_deg,
                dec_deg,
                rotation_deg: Some(0.0),
            })
            .collect();
        let input = ProjectInput {
            name: "Cygnus 2026".into(),
            notes: None,
            subjects: vec![SubjectInput {
                target_id: mosaic.candidate.id,
                name: Some("NGC 7000 Mosaic".into()),
                mosaic: true,
                panels,
            }],
            rig_ids: vec![rig.id],
            goals: Vec::new(),
        };
        let project = catalog.create_project(&input).await.unwrap();
        let subject = &project.subjects[0];
        let group = library
            .create_view_group(&NewViewGroup {
                project_id: project.id,
                subject_id: subject.id,
                rig_id: rig.id,
                name: "NGC 7000 Mosaic".into(),
                panels: subject.panels.clone(),
            })
            .await
            .unwrap();
        Self { _temp: temp, library, location: location.id, frames, group, manifest }
    }

    fn review(&self) -> &FrameReview {
        self.library.frame_review()
    }

    const fn review_all(&self) -> ReviewContext {
        ReviewContext::ViewGroup { group_id: self.group.group.id }
    }

    /// Panel `number`'s panel id and run.
    fn panel(&self, number: u32) -> (Uuid, Uuid) {
        let panel = self.group.panels.iter().find(|p| p.panel.number == number).unwrap();
        (panel.panel.id, panel.view.id)
    }

    async fn list(&self, context: ReviewContext, panel: Option<Uuid>) -> ReviewList {
        let sort = ReviewSort::default();
        self.review()
            .review_list(context, ReviewFilter::All, panel, &sort, &NameTemplate::FileName)
            .await
            .unwrap()
    }

    /// The error kind a refused listing reports.
    async fn refusal(&self, context: ReviewContext, panel: Option<Uuid>) -> String {
        let sort = ReviewSort::default();
        let error = self
            .review()
            .review_list(context, ReviewFilter::All, panel, &sort, &NameTemplate::FileName)
            .await
            .unwrap_err();
        kind(&error)
    }

    async fn row(&self, asset: Uuid) -> ReviewFrame {
        let list = self.list(self.review_all(), None).await;
        list.frames.into_iter().find(|frame| frame.asset.id == asset).unwrap()
    }

    /// Route one mark through Review all with the listed draft revision of the
    /// frame's panel run.
    async fn mark(&self, asset: Uuid, mark: &ReviewMark) -> Result<ReviewMarked, LibraryError> {
        let list = self.list(self.review_all(), None).await;
        let frame = list.frames.iter().find(|frame| frame.asset.id == asset).unwrap();
        let view = frame.panel.expect("a Review all frame names its panel run").view_id;
        let run = list.panels.iter().find(|panel| panel.run.view_id == view).unwrap().run;
        self.review().review_mark(self.review_all(), run.draft_revision, mark).await
    }

    async fn library_mark(&self, asset: Uuid, quality: Quality) -> ReviewMarked {
        let row = self.row(asset).await;
        let asset = ExpectedAsset {
            asset_id: row.asset.id,
            decision_revision: row.asset.decision_revision,
            fingerprint: row.asset.fingerprint,
        };
        self.mark(asset.asset_id, &ReviewMark::Library { asset, quality }).await.unwrap()
    }

    async fn project_mark(&self, asset: Uuid, rejected: bool) -> ReviewMarked {
        let row = self.row(asset).await;
        let mark = RejectionMark {
            asset_id: row.asset.id,
            fingerprint: row.asset.fingerprint,
            expected_revision: row.project.revision,
            rejected,
        };
        self.mark(asset, &ReviewMark::Project { mark }).await.unwrap()
    }

    /// Every asset record by id.
    async fn records(&self) -> BTreeMap<Uuid, Asset> {
        let assets = self.library.catalog().location_assets(self.location).await.unwrap();
        assets.into_iter().map(|asset| (asset.id, asset)).collect()
    }

    /// Every asset record by id, as JSON.
    async fn assets(&self) -> BTreeMap<Uuid, serde_json::Value> {
        let records = self.records().await;
        records.into_iter().map(|(id, a)| (id, serde_json::to_value(&a).unwrap())).collect()
    }

    /// Each panel run's own Review step list, as JSON, by panel number.
    async fn panel_runs(&self) -> BTreeMap<u32, serde_json::Value> {
        let mut runs = BTreeMap::new();
        for panel in &self.group.panels {
            let list = self.list(ReviewContext::Run { view_id: panel.view.id }, None).await;
            runs.insert(panel.panel.number, serde_json::to_value(&list).unwrap());
        }
        runs
    }

    fn assert_manifest(&self) {
        for (path, digest) in &self.manifest {
            assert_eq!(&support::digest(path), digest, "{} is read-only", path.display());
        }
    }
}

fn ids(frames: &[ReviewFrame]) -> Vec<Uuid> {
    let mut ids: Vec<Uuid> = frames.iter().map(|frame| frame.asset.id).collect();
    ids.sort_unstable();
    ids
}

/// The frames of nights in panel `number`, sorted.
fn nights_in(world: &World, number: u32) -> Vec<Uuid> {
    let mut ids: Vec<Uuid> = NIGHTS
        .iter()
        .zip(&world.frames)
        .filter(|((.., panel), _)| *panel == Some(number))
        .map(|(_, id)| *id)
        .collect();
    ids.sort_unstable();
    ids
}

/// PIX-AC-18, PIX-FR-17, VSEL-AC-22, VSEL-FR-19: Review all lists the frames
/// of all four panel runs together, each with its Panel column; the Panel
/// filter lists only that panel's frames, and the Panel column sorts.
#[tokio::test]
async fn review_all_lists_every_panel_with_panel_column_and_filter() {
    let world = World::new().await;
    let before = world.assets().await;
    let list = world.list(world.review_all(), None).await;

    assert_eq!(list.context, world.review_all());
    assert_eq!(list.project_id, world.group.group.project_id);
    assert!(list.run.is_none(), "Review all spans panel runs, not one run");
    let numbers: Vec<u32> = list.panels.iter().map(|panel| panel.number).collect();
    assert_eq!(numbers, vec![1, 2, 3, 4], "every panel run, by panel number");
    for panel in &list.panels {
        let (panel_id, view_id) = world.panel(panel.number);
        assert_eq!((panel.panel_id, panel.run.view_id), (panel_id, view_id));
        assert_eq!(
            (panel.run.completion, panel.run.membership),
            (RunCompletion::Open, Membership::Draft)
        );
    }

    // All four panels list together; the off-panel frame is in no panel run.
    let mut in_panels = world.frames.clone();
    in_panels.remove(OFF_PANEL);
    in_panels.sort_unstable();
    assert_eq!(ids(&list.frames), in_panels);
    assert_eq!(list.counts.all, 6);
    assert_eq!(list.panel_filter, None);
    for frame in &list.frames {
        let panel = frame.panel.expect("every Review all frame has a Panel column");
        let night = world.frames.iter().position(|id| *id == frame.asset.id).unwrap();
        assert_eq!(Some(panel.number), NIGHTS[night].2, "{night}");
        let (panel_id, view_id) = world.panel(panel.number);
        assert_eq!((panel.panel_id, panel.view_id), (panel_id, view_id));
        assert_eq!(frame.label, QualityLabel::Unreviewed);
    }

    // Each frame lists as its own panel run's Review step lists it.
    for panel in &world.group.panels {
        let own = world.list(ReviewContext::Run { view_id: panel.view.id }, None).await;
        let in_group: Vec<&ReviewFrame> = list
            .frames
            .iter()
            .filter(|frame| frame.panel.is_some_and(|p| p.view_id == panel.view.id))
            .collect();
        assert_eq!(in_group.len(), own.frames.len(), "panel {}", panel.panel.number);
        for frame in &own.frames {
            let grouped = in_group.iter().find(|row| row.asset.id == frame.asset.id).unwrap();
            assert_eq!(grouped.member, frame.member);
            assert_eq!(grouped.label, frame.label);
            assert!(frame.panel.is_none(), "a Run context has no Panel column");
        }
    }

    // Filtering to Panel 2 lists only Panel 2's frames, counted over Panel 2.
    let (panel_2, view_2) = world.panel(2);
    let filtered = world.list(world.review_all(), Some(panel_2)).await;
    assert_eq!(ids(&filtered.frames), nights_in(&world, 2));
    assert!(filtered.frames.iter().all(|frame| frame.panel.unwrap().view_id == view_2));
    assert_eq!(filtered.panel_filter, Some(panel_2));
    assert_eq!(filtered.counts.all, 2);
    assert_eq!(filtered.panels, list.panels, "the Panel filter still offers every panel");

    // The Panel column sorts by panel number.
    let by_panel = ReviewSort { key: ReviewSortKey::Panel, direction: SortDirection::Desc };
    let sorted = world
        .review()
        .review_list(
            world.review_all(),
            ReviewFilter::All,
            None,
            &by_panel,
            &NameTemplate::FileName,
        )
        .await
        .unwrap();
    let numbers: Vec<u32> = sorted.frames.iter().map(|frame| frame.panel.unwrap().number).collect();
    assert_eq!(numbers, vec![4, 3, 2, 2, 1, 1]);

    // A Panel filter outside the listed panels, and an unknown group, refuse.
    let unknown_panel = world.refusal(world.review_all(), Some(Uuid::new_v4())).await;
    assert_eq!(unknown_panel, "invalid_input");
    let single_run = world.refusal(ReviewContext::Run { view_id: view_2 }, Some(panel_2)).await;
    assert_eq!(single_run, "invalid_input", "a single run has no Panel filter");
    let group = ReviewContext::ViewGroup { group_id: Uuid::new_v4() };
    assert_eq!(world.refusal(group, None).await, "not_found");

    // Listing writes nothing and reads no source.
    assert_eq!(world.assets().await, before);
    world.assert_manifest();
}

/// PIX-AC-18, PIX-FR-17: a Review all mark routes through the frame's panel
/// run as a single run's Review step does. It changes only that frame's
/// quality, and every frame stays in its own panel run's membership.
#[tokio::test]
async fn mark_changes_only_that_frames_quality_and_keeps_panel_membership() {
    let world = World::new().await;
    let (_, view_2) = world.panel(2);
    let before = world.assets().await;
    let runs_before = world.panel_runs().await;
    let panels_before: BTreeMap<Uuid, ReviewPanel> = world
        .list(world.review_all(), None)
        .await
        .frames
        .iter()
        .map(|frame| (frame.asset.id, frame.panel.unwrap()))
        .collect();
    let frame = nights_in(&world, 2)[0];

    // X on a Panel 2 frame: Panel 2's Review step writes it and moves its member.
    let marked = world.library_mark(frame, Quality::Unusable).await;
    let member = marked.member.expect("an open panel run's mark moves its draft member");
    assert_eq!(
        (member.state, member.reason),
        (MemberState::Excluded, MemberReason::Rejected { scope: RejectScope::Library })
    );
    let draft = marked.draft_revision.expect("the mark started Panel 2's draft revision");

    // Only the marked frame's quality changed.
    let after = world.records().await;
    for (id, record) in &after {
        if *id == frame {
            assert_eq!(record.quality, Quality::Unusable);
        } else {
            assert_eq!(&serde_json::to_value(record).unwrap(), &before[id], "asset {id}");
        }
    }
    let row = world.row(frame).await;
    assert_eq!(row.label, LIBRARY);

    // The frame stays in Panel 2's membership; no other panel run changed.
    assert_eq!(row.panel, Some(panels_before[&frame]));
    assert_eq!(row.member.unwrap().state, MemberState::Excluded);
    let runs_after = world.panel_runs().await;
    for number in [1, 3, 4] {
        assert_eq!(runs_after[&number], runs_before[&number], "panel {number} is unchanged");
    }
    let own = world.list(ReviewContext::Run { view_id: view_2 }, None).await;
    assert!(own.frames.iter().any(|listed| listed.asset.id == frame));
    assert_eq!(own.run.unwrap().draft_revision, draft);
    let panels_after: BTreeMap<Uuid, ReviewPanel> = world
        .list(world.review_all(), None)
        .await
        .frames
        .iter()
        .map(|listed| (listed.asset.id, listed.panel.unwrap()))
        .collect();
    assert_eq!(panels_after, panels_before, "every frame keeps its panel run");

    // A stale draft revision of the frame's panel run conflicts.
    let stale = ExpectedAsset {
        asset_id: row.asset.id,
        decision_revision: row.asset.decision_revision,
        fingerprint: row.asset.fingerprint,
    };
    let error = world
        .review()
        .review_mark(
            world.review_all(),
            draft + 1,
            &ReviewMark::Library { asset: stale, quality: Quality::Unreviewed },
        )
        .await
        .unwrap_err();
    assert_eq!(kind(&error), "conflict", "{error}");

    // U restores it to Panel 2's draft; P and Reject for this Project only on
    // other panels' frames change only those frames.
    let restored = world.library_mark(frame, Quality::Unreviewed).await;
    let member = restored.member.unwrap();
    assert_eq!((member.state, member.reason), (MemberState::Included, MemberReason::Restored));
    let picked = nights_in(&world, 1)[0];
    let marked = world.library_mark(picked, Quality::Usable).await;
    assert_eq!(marked.member.unwrap().state, MemberState::Included);
    let rejected = nights_in(&world, 3)[0];
    let marked = world.project_mark(rejected, true).await;
    assert_eq!(marked.member.unwrap().state, MemberState::Excluded);
    let list = world.list(world.review_all(), None).await;
    for listed in &list.frames {
        let expected = match listed.asset.id {
            id if id == picked => QualityLabel::Picked,
            id if id == rejected => THIS_PROJECT,
            _ => QualityLabel::Unreviewed,
        };
        assert_eq!(listed.label, expected, "{}", listed.asset.id);
        assert_eq!(listed.panel, Some(panels_before[&listed.asset.id]));
    }

    // A frame no panel run holds cannot be marked through Review all.
    let off = world.frames[OFF_PANEL];
    let records = world.records().await;
    let asset = &records[&off];
    let mark = ReviewMark::Library {
        asset: ExpectedAsset {
            asset_id: off,
            decision_revision: asset.decision_revision,
            fingerprint: asset.fingerprint.clone(),
        },
        quality: Quality::Unusable,
    };
    let error = world.review().review_mark(world.review_all(), 0, &mark).await.unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "{error}");
    assert_eq!(world.assets().await[&off], before[&off]);
    world.assert_manifest();
}
