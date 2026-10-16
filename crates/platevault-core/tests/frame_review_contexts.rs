// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Frame review contexts (spec 067 PIX-FR-14..16, PIX-FR-18, D-W78, D-W43):
//! live frames can be listed and marked through the library-quality route.
//! Project candidates show unreviewed captures. Trashed frames are never
//! listed, counted, measured or thumbnailed, and display names rename nothing.
//! Fixture files are only read.

mod support;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use persistence_library::{SessionQuery, TrashedFrame};
use platevault_core::frame_review::FrameReview;
use platevault_core::library::Library;
use platevault_core::*;
use uuid::Uuid;

/// The NGC 7000 Ha frames: one session, in capture order.
const NGC: [&str; 4] =
    ["ngc7000/Ha_001.fits", "ngc7000/Ha_002.fits", "ngc7000/Ha_003.fits", "ngc7000/Ha_004.fits"];
/// A frame of another Target: never a candidate of either Project.
const M81: &str = "m81/L_001.fits";

const LIBRARY: QualityLabel = QualityLabel::Rejected { scope: LabelScope::Library };

/// `relative` with the platform's separators, as the scanner builds it.
fn native(relative: &str) -> PathBuf {
    relative.split('/').collect()
}

fn write_frame(root: &Path, relative: &str, object: &str, filter: &str, minute: usize) {
    let path = root.join(native(relative));
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let object = format!("'{object}'");
    let filter = format!("'{filter}'");
    let start = format!("'2026-09-12T22:{minute:02}:00'");
    let cards = [
        ("IMAGETYP", "'LIGHT'"),
        ("INSTRUME", "'ASI2600MM'"),
        ("TELESCOP", "'RedCat 51'"),
        ("OBJECT", object.as_str()),
        ("FILTER", filter.as_str()),
        ("EXPTIME", "300"),
        ("DATE-OBS", start.as_str()),
        ("SITELAT", "52.0"),
        ("SITELONG", "4.5"),
    ];
    support::fits(&path, &cards).unwrap();
}

fn rig() -> Equipment {
    Equipment {
        id: Uuid::new_v4(),
        name: "RedCat 51".into(),
        camera: Some("ASI2600MM".into()),
        telescope: Some("RedCat 51".into()),
        focal_length_mm: Some(250.0),
        pixel_size_um: Some(3.76),
        sensor_width_px: None,
        sensor_height_px: None,
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
        coordinates: None,
        provenance: Provenance::User,
        provider_id: None,
        angular_size: None,
        catalogues: Vec::new(),
    }
}

/// Two Projects on NGC 7000 with the `RedCat`, each with one run, over one
/// indexed root: four NGC 7000 Ha frames and one M 81 frame.
struct World {
    _temp: tempfile::TempDir,
    root: PathBuf,
    library: Arc<Library>,
    location: Uuid,
    frames: Vec<Uuid>,
    m81: Uuid,
    run_a: Uuid,
    run_b: Uuid,
    project_a: Uuid,
    project_b: Uuid,
    manifest: BTreeMap<PathBuf, String>,
}

impl World {
    async fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("Captures");
        std::fs::create_dir(&root).unwrap();
        for (minute, relative) in NGC.iter().enumerate() {
            write_frame(&root, relative, "NGC 7000", "Ha", minute * 5);
        }
        write_frame(&root, M81, "M 81", "L", 40);
        let manifest = NGC
            .iter()
            .chain([&M81])
            .map(|relative| root.join(native(relative)))
            .map(|path| {
                let digest = support::digest(&path);
                (path, digest)
            })
            .collect();
        let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
        let location = library
            .register_location(
                NativePath::from_path(&root),
                "Captures".into(),
                LocationRole::Captures,
            )
            .await
            .unwrap();
        let started = library.start_scan(location.id, None).await.unwrap();
        terminal(&library, started.id).await;
        let catalog = library.catalog();
        let ids: BTreeMap<NativePath, Uuid> = catalog
            .location_assets(location.id)
            .await
            .unwrap()
            .into_iter()
            .map(|asset| (asset.relative_path, asset.id))
            .collect();
        let id = |relative: &str| ids[&NativePath::from_path(&native(relative))];
        let frames: Vec<Uuid> = NGC.into_iter().map(id).collect();
        let target = catalog.save_target(&ngc7000(), None).await.unwrap().candidate.id;
        let rig = catalog.save_equipment(&rig(), None).await.unwrap().id;
        for summary in catalog.list_sessions(&SessionQuery::default()).await.unwrap() {
            if !summary.session.asset_ids.contains(&frames[0]) {
                continue;
            }
            let session = summary.session;
            catalog.associate_target(&[expected_session(&session)], target).await.unwrap();
            let session = catalog.session(session.id).await.unwrap().summary.session;
            catalog.confirm_equipment(&[expected_session(&session)], rig).await.unwrap();
        }
        let (project_a, run_a) = project_with_run(catalog, "NGC 7000 A", target, rig).await;
        let (project_b, run_b) = project_with_run(catalog, "NGC 7000 B", target, rig).await;
        Self {
            _temp: temp,
            root,
            library,
            location: location.id,
            frames,
            m81: id(M81),
            run_a,
            run_b,
            project_a,
            project_b,
            manifest,
        }
    }

    fn catalog(&self) -> &persistence_library::Catalog {
        self.library.catalog()
    }

    fn review(&self) -> &FrameReview {
        self.library.frame_review()
    }

    const fn run_a(&self) -> ReviewContext {
        ReviewContext::Run { view_id: self.run_a }
    }

    const fn candidates_a(&self) -> ReviewContext {
        ReviewContext::ProjectCandidates { project_id: self.project_a }
    }

    /// Every context showing the frames: both runs and both Projects' candidates.
    const fn contexts(&self) -> [ReviewContext; 4] {
        [
            ReviewContext::Run { view_id: self.run_a },
            ReviewContext::Run { view_id: self.run_b },
            ReviewContext::ProjectCandidates { project_id: self.project_a },
            ReviewContext::ProjectCandidates { project_id: self.project_b },
        ]
    }

    async fn list(&self, context: ReviewContext, filter: ReviewFilter) -> ReviewList {
        self.review()
            .review_list(context, filter, None, &ReviewSort::default(), &NameTemplate::FileName)
            .await
            .unwrap()
    }

    async fn row(&self, context: ReviewContext, asset: Uuid) -> ReviewFrame {
        self.list(context, ReviewFilter::All)
            .await
            .frames
            .into_iter()
            .find(|frame| frame.asset.id == asset)
            .unwrap_or_else(|| panic!("asset {asset} is listed in {context:?}"))
    }

    async fn label(&self, context: ReviewContext, asset: Uuid) -> QualityLabel {
        self.row(context, asset).await.label
    }

    /// P, X or U on the listed copy.
    async fn library_mark(
        &self,
        context: ReviewContext,
        asset: Uuid,
        quality: Quality,
    ) -> ReviewMarked {
        let row = self.row(context, asset).await;
        let expected = ExpectedAsset {
            asset_id: row.asset.id,
            decision_revision: row.asset.decision_revision,
            fingerprint: row.asset.fingerprint,
        };
        self.review()
            .review_mark(context, &ReviewMark::Library { asset: expected, quality })
            .await
            .unwrap()
    }

    async fn assets(&self) -> serde_json::Value {
        serde_json::to_value(self.catalog().location_assets(self.location).await.unwrap()).unwrap()
    }

    fn assert_manifest(&self) {
        for (path, digest) in &self.manifest {
            assert_eq!(&support::digest(path), digest, "{}", path.display());
        }
    }
}

async fn terminal(library: &Arc<Library>, id: Uuid) {
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let operation = library.catalog().scan_status(id).await.unwrap();
            if operation.state != ScanState::Running {
                assert_eq!(operation.state, ScanState::Completed, "{operation:?}");
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("scan must reach a durable terminal state");
}

const fn expected_session(session: &Session) -> ExpectedSession {
    ExpectedSession {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        decision_revision: session.decision_revision,
    }
}

async fn project_with_run(
    catalog: &persistence_library::Catalog,
    name: &str,
    target: Uuid,
    rig: Uuid,
) -> (Uuid, Uuid) {
    let input = ProjectInput {
        name: name.into(),
        notes: None,
        subjects: vec![SubjectInput {
            target_id: target,
            name: None,
            mosaic: false,
            panels: vec![],
        }],
        rig_ids: vec![rig],
        goals: Vec::new(),
    };
    let project = catalog.create_project(&input).await.unwrap();
    let run = NewView {
        project_id: project.id,
        subject_id: project.subjects[0].id,
        rig_id: rig,
        name: format!("{name} run"),
    };
    let run = catalog.create_view(&run).await.unwrap();
    (project.id, run.view.id)
}

fn ids(list: &ReviewList) -> Vec<Uuid> {
    list.frames.iter().map(|frame| frame.asset.id).collect()
}

fn kind(error: &LibraryError) -> String {
    error.response(None, None).kind
}

/// PIX-AC-12: X sets library quality Unusable, which reads Rejected with scope
/// Library in every Project and run that shows the frame; U returns it to
/// Unreviewed everywhere.
#[tokio::test]
async fn x_marks_library_unusable_rejected_scope_library_everywhere() {
    let world = World::new().await;
    let frame = world.frames[0];
    for context in world.contexts() {
        assert_eq!(world.label(context, frame).await, QualityLabel::Unreviewed, "{context:?}");
    }

    let marked = world.library_mark(world.run_a(), frame, Quality::Unusable).await;
    let ReviewDecision::Library { asset } = &marked.decision else {
        panic!("X writes the library decision: {:?}", marked.decision);
    };
    assert_eq!(asset.quality, Quality::Unusable);
    assert_eq!(world.catalog().asset(frame).await.unwrap().quality, Quality::Unusable);
    for context in world.contexts() {
        assert_eq!(world.label(context, frame).await, LIBRARY, "{context:?}");
    }

    let marked = world.library_mark(world.run_a(), frame, Quality::Unreviewed).await;
    let ReviewDecision::Library { asset } = &marked.decision else {
        panic!("U writes the library decision: {:?}", marked.decision);
    };
    assert_eq!(asset.quality, Quality::Unreviewed);
    for context in world.contexts() {
        assert_eq!(world.label(context, frame).await, QualityLabel::Unreviewed, "{context:?}");
    }

    // The same marks route through library_set_quality outside a run.
    world.library_mark(world.candidates_a(), frame, Quality::Unusable).await;
    for context in world.contexts() {
        assert_eq!(world.label(context, frame).await, LIBRARY, "{context:?}");
    }
    world.assert_manifest();
}

#[tokio::test]
async fn trashed_frame_not_listed_counted_measured_or_thumbnailed() {
    let world = World::new().await;
    let trashed = world.frames[3];
    let path = world.root.join(native(NGC[3]));
    let frame = TrashedFrame {
        asset_id: trashed,
        sha256: support::digest(&path),
        complete_view_ids: Vec::new(),
    };
    world.catalog().record_trashed(Uuid::new_v4(), &[frame]).await.unwrap();

    for context in world.contexts() {
        for filter in [
            ReviewFilter::All,
            ReviewFilter::Picked,
            ReviewFilter::Rejected,
            ReviewFilter::Unreviewed,
        ] {
            let list = world.list(context, filter).await;
            assert!(!ids(&list).contains(&trashed), "{context:?} {filter:?} lists it");
            assert_eq!(list.counts.all, 3, "{context:?} counts it");
            assert_eq!(list.counts.unreviewed, 3, "{context:?} counts it");
        }
    }

    let review = world.review();
    for assets in [vec![trashed], vec![world.frames[0], trashed]] {
        let error = review.start_measurement(&assets, &[]).await.unwrap_err();
        assert_eq!(kind(&error), "invalid_input", "{error}");
        assert!(error.to_string().contains(&trashed.to_string()), "{error}");
    }
    assert!(review.list_runs(0, 10).await.unwrap().is_empty(), "nothing was measured");

    let entries = review.thumbnails(&[trashed]).await.unwrap();
    assert_eq!(
        entries[0].state,
        ThumbnailState::Unavailable { reason: reasons::TRASHED.into() },
        "a Trashed frame is never thumbnailed"
    );
    tokio::time::sleep(Duration::from_millis(200)).await;
    let bases = world.catalog().thumbnail_bases(&[trashed]).await.unwrap();
    assert!(bases[0].thumbnail.is_none(), "no thumbnail was decoded or cached");

    let error = review.display_names(&[trashed], &NameTemplate::FileName).await.unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "{error}");
    world.assert_manifest();
}

/// PIX-FR-18: Project candidate review lists currently unreviewed library captures.
#[tokio::test]
async fn project_candidates_context_filtered_unreviewed() {
    let world = World::new().await;
    let [picked, library, _unreviewed, _] = world.frames[..] else { unreachable!() };
    let context = world.candidates_a();
    let all = world.list(context, ReviewFilter::All).await;
    assert_eq!(ids(&all), world.frames, "every candidate frame in capture order");
    assert!(all.run.is_none());
    assert_eq!(all.project_id, world.project_a);
    assert!(all.frames.iter().all(|frame| frame.member.is_none()));

    world.library_mark(context, picked, Quality::Usable).await;
    world.library_mark(context, library, Quality::Unusable).await;
    let before = world.assets().await;
    let list = world.list(context, ReviewFilter::Unreviewed).await;
    assert_eq!(list.frames.len(), 2);
    assert_eq!(list.filter, ReviewFilter::Unreviewed);
    assert_eq!(list.counts.unreviewed, 2);
    assert!(!ids(&world.list(context, ReviewFilter::All).await).contains(&world.m81));
    assert_eq!(
        world.review().list_runs(0, 10).await.unwrap(),
        [] as [platevault_core::MeasurementRun; 0]
    );
    assert_eq!(world.assets().await, before, "listing changes no quality record");
}

/// PIX-AC-17: switching the display template re-renders every name from the
/// naming tokens and fallbacks; no file is renamed and the full path stays
/// available. The Name sort orders by the displayed name.
#[tokio::test]
async fn display_template_renames_nothing() {
    let world = World::new().await;
    let before = world.assets().await;
    let list = world.list(world.run_a(), ReviewFilter::All).await;
    let listed: Vec<&str> = list.frames.iter().map(|frame| frame.display.name.as_str()).collect();
    assert_eq!(listed, vec!["Ha_001.fits", "Ha_002.fits", "Ha_003.fits", "Ha_004.fits"]);
    for (frame, relative) in list.frames.iter().zip(NGC) {
        assert_eq!(frame.display.path, NativePath::from_path(&world.root.join(native(relative))));
        assert_eq!(frame.display.fallbacks, [] as [platevault_core::NamingFallback; 0]);
    }

    let tokens = NameTemplate::Tokens { template: "{filter}_{exposure}s".into() };
    let rendered = world.review().display_names(&world.frames, &tokens).await.unwrap();
    assert_eq!(rendered.iter().map(|name| name.asset_id).collect::<Vec<_>>(), world.frames);
    assert!(rendered.iter().all(|name| name.name == "Ha_300s" && name.fallbacks.is_empty()));

    let fallback = NameTemplate::Tokens { template: "{filter}_{gain}".into() };
    let defaulted = world.review().display_names(&world.frames[..1], &fallback).await.unwrap();
    assert_eq!(defaulted[0].name, "Ha_unknown-gain");
    assert_eq!(
        defaulted[0].fallbacks.iter().map(|used| used.token.as_str()).collect::<Vec<_>>(),
        vec!["gain"]
    );

    let by_name = ReviewSort { key: ReviewSortKey::Name, direction: SortDirection::Desc };
    let sorted = world
        .review()
        .review_list(world.run_a(), ReviewFilter::All, None, &by_name, &NameTemplate::FileName)
        .await
        .unwrap();
    let mut reversed = world.frames.clone();
    reversed.reverse();
    assert_eq!(ids(&sorted), reversed);
    let tokened = world
        .review()
        .review_list(world.run_a(), ReviewFilter::All, None, &by_name, &tokens)
        .await
        .unwrap();
    assert!(tokened.frames.iter().all(|frame| frame.display.name == "Ha_300s"));

    let refused = NameTemplate::Tokens { template: "../{filter}".into() };
    let error = world.review().display_names(&world.frames, &refused).await.unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "{error}");

    assert_eq!(world.assets().await, before, "no record changed and no file was renamed");
    world.assert_manifest();
    assert!(world.manifest.keys().all(|path| path.is_file()), "every file keeps its path");
}
