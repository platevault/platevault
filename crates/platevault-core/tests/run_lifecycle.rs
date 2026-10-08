// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Run lifecycle (spec 070 RES-FR-06/07/10, amended D-W72): Mark Complete
//! needs no Result and is blocked only by a Running app-owned operation;
//! Reopen returns to the stage before Complete; Move run to Trash moves no
//! file, hides the run everywhere except the Project's Trash list and is
//! refused, naming each blocker, while an operation affecting it is Running
//! or one of its accepted Results is an input to another run; Restore brings
//! it back exactly as it was. Operations and Results come through the
//! `RunOperationGuard` port their features register, and prepared and Results
//! folders through the `RunFolders` port. Fixture files are real and only read.
#![cfg(unix)]

mod support;

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Weak};
use std::time::Duration;

use persistence_library::SessionQuery;
use platevault_core::library::Library;
use platevault_core::run_lifecycle::{
    BlockersFuture, FoldersFuture, RunFolders, RunOperationGuard,
};
use platevault_core::*;
use tokio::task::JoinHandle;
use uuid::Uuid;

struct World {
    _temp: tempfile::TempDir,
    root: PathBuf,
    library: Arc<Library>,
    location: Uuid,
    project: Project,
    rig: Uuid,
    /// The two Ha nights and the OIII night, by session id.
    ha1: Uuid,
    ha2: Uuid,
    oiii: Uuid,
}

fn frame(path: &Path, filter: &str, start: &str) {
    let fields = [
        ("IMAGETYP", "'LIGHT'".to_owned()),
        ("FILTER", format!("'{filter}'")),
        ("EXPTIME", "300".to_owned()),
        ("DATE-OBS", format!("'{start}'")),
        ("OBJECT", "'NGC 7000'".to_owned()),
        ("RA", "314.75".to_owned()),
        ("DEC", "44.33".to_owned()),
    ];
    let fields: Vec<(&str, &str)> =
        fields.iter().map(|(key, value)| (*key, value.as_str())).collect();
    support::fits(path, &fields).unwrap();
}

fn ngc7000() -> TargetCandidate {
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

fn redcat() -> Equipment {
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

fn expected(session: &Session) -> ExpectedSession {
    ExpectedSession {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        decision_revision: session.decision_revision,
    }
}

async fn session(library: &Library, id: Uuid) -> Session {
    let sessions = library.catalog().list_sessions(&SessionQuery::default()).await.unwrap();
    sessions.into_iter().map(|summary| summary.session).find(|s| s.id == id).unwrap()
}

async fn scan_to_end(library: &Arc<Library>, location: Uuid) {
    let mut progress = library.subscribe_scan_progress();
    let started = library.start_scan(location, None).await.unwrap();
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let operation = progress.recv().await.unwrap();
            if operation.id == started.id && operation.state != ScanState::Running {
                assert_eq!(operation.state, ScanState::Completed);
                return;
            }
        }
    })
    .await
    .expect("scan must publish its terminal state");
}

/// Four real frames in three sessions: Ha on two nights and OIII on the
/// second, every one confirmed as NGC 7000 on the `RedCat`, and one Project on
/// that subject and rig.
async fn world() -> World {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("Captures");
    std::fs::create_dir(&root).unwrap();
    frame(&root.join("Ha_001.fits"), "Ha", "2026-09-12T22:00:00");
    frame(&root.join("Ha_002.fits"), "Ha", "2026-09-12T22:05:00");
    frame(&root.join("Ha_003.fits"), "Ha", "2026-09-14T22:00:00");
    frame(&root.join("OIII_001.fits"), "OIII", "2026-09-14T23:00:00");
    let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
    let location = library
        .register_location(NativePath::from_path(&root), "Captures".into(), LocationRole::Captures)
        .await
        .unwrap()
        .id;
    scan_to_end(&library, location).await;
    let catalog = library.catalog();
    let target = catalog.save_target(&ngc7000(), None).await.unwrap().candidate.id;
    let rig = catalog.save_equipment(&redcat(), None).await.unwrap().id;
    let sessions = catalog.list_sessions(&SessionQuery::default()).await.unwrap();
    assert_eq!(sessions.len(), 3, "{sessions:?}");
    let mut by_frame = HashMap::new();
    for summary in sessions {
        let id = summary.session.id;
        catalog.associate_target(&[expected(&summary.session)], target).await.unwrap();
        catalog.confirm_equipment(&[expected(&session(&library, id).await)], rig).await.unwrap();
        let detail = catalog.session(id).await.unwrap();
        for asset in detail.assets {
            by_frame.insert(asset.relative_path.display(), id);
        }
    }
    let project = catalog
        .create_project(&ProjectInput {
            name: "NGC 7000 HOO".into(),
            notes: None,
            subjects: vec![SubjectInput {
                target_id: target,
                name: None,
                mosaic: false,
                panels: Vec::new(),
            }],
            rig_ids: vec![rig],
            goals: Vec::new(),
        })
        .await
        .unwrap();
    World {
        ha1: by_frame["Ha_001.fits"],
        ha2: by_frame["Ha_003.fits"],
        oiii: by_frame["OIII_001.fits"],
        _temp: temp,
        root,
        library,
        location,
        project,
        rig,
    }
}

impl World {
    /// A saved run on the Project's subject and rig holding `sessions`.
    async fn run(&self, name: &str, sessions: &[Uuid]) -> Uuid {
        let input = NewView {
            project_id: self.project.id,
            subject_id: self.project.subjects[0].id,
            rig_id: self.rig,
            name: name.into(),
        };
        let id = self.library.create_view(&input).await.unwrap().view.id;
        let catalog = self.library.catalog();
        let all = [self.ha1, self.ha2, self.oiii];
        let drop: Vec<Uuid> = all.into_iter().filter(|s| !sessions.contains(s)).collect();
        if !drop.is_empty() {
            let edit = DraftEdit::DeselectSessions { session_ids: drop };
            catalog.edit_view_draft(id, 1, &edit).await.unwrap();
        }
        self.save(id).await;
        id
    }

    /// Save the run's draft as its next revision.
    async fn save(&self, id: Uuid) {
        let catalog = self.library.catalog();
        let record = catalog.view(id).await.unwrap();
        let draft = record.draft.unwrap().draft_revision;
        catalog.save_view(id, record.view.revision, draft).await.unwrap();
    }

    async fn stage(&self, id: Uuid, stage: RunStage) {
        self.library.catalog().set_view_stage(id, stage).await.unwrap();
    }

    async fn listed(&self) -> Vec<(String, RunStage)> {
        let query = ViewQuery { project_id: Some(self.project.id), ..ViewQuery::default() };
        let runs = self.library.catalog().list_views(&query).await.unwrap();
        runs.into_iter().map(|run| (run.name, run.stage)).collect()
    }

    async fn members(&self) -> BTreeMap<Uuid, Vec<Uuid>> {
        let members = self.library.catalog().project_members(self.project.id).await.unwrap();
        members.into_iter().map(|member| (member.session_id, member.view_ids)).collect()
    }

    async fn trash(&self) -> Vec<(String, RunStage, RunCompletion)> {
        let trash = self.library.catalog().trashed_views(self.project.id).await.unwrap();
        trash.into_iter().map(|t| (t.run.name, t.run.stage, t.run.completion)).collect()
    }

    /// Library quality decisions of every frame.
    async fn decisions(&self) -> Vec<(Uuid, Quality, Revision)> {
        let assets = self.library.catalog().location_assets(self.location).await.unwrap();
        assets.into_iter().map(|a| (a.id, a.quality, a.decision_revision)).collect()
    }
}

/// Names, sizes and SHA-256 of every file below `root`.
fn tree(root: &Path) -> BTreeMap<PathBuf, (u64, String)> {
    let mut files = BTreeMap::new();
    for entry in std::fs::read_dir(root).unwrap() {
        let path = entry.unwrap().path();
        let size = std::fs::metadata(&path).unwrap().len();
        files.insert(path.clone(), (size, support::digest(&path)));
    }
    files
}

fn refused(error: &LibraryError, needles: &[&str]) {
    assert_eq!(error.response(None, None).kind, "invalid_input", "{error}");
    for needle in needles {
        assert!(error.to_string().contains(needle), "{error} should name {needle}");
    }
}

/// Blockers a feature holds per run: Running preparations and storage
/// mutations, and runs using one of the run's accepted Results.
#[derive(Default)]
struct Operations {
    held: tokio::sync::Mutex<HashMap<Uuid, Vec<LifecycleBlocker>>>,
}

impl Operations {
    async fn hold(&self, view: Uuid, blocker: LifecycleBlocker) {
        self.held.lock().await.entry(view).or_default().push(blocker);
    }

    async fn clear(&self, view: Uuid) {
        self.held.lock().await.remove(&view);
    }
}

impl RunOperationGuard for Operations {
    fn blockers<'a>(&'a self, view: &'a View) -> BlockersFuture<'a> {
        Box::pin(
            async move { Ok(self.held.lock().await.get(&view.id).cloned().unwrap_or_default()) },
        )
    }
}

fn preparation(name: &str) -> LifecycleBlocker {
    LifecycleBlocker::RunningOperation {
        operation_id: Uuid::new_v4(),
        operation: RunOperationKind::Preparation,
        name: name.into(),
    }
}

fn result_input(view_id: Uuid, view_name: &str) -> LifecycleBlocker {
    LifecycleBlocker::ResultInput {
        result_id: Uuid::from_u128(0x51),
        result_name: "NGC 7000 Ha stack".into(),
        view_id,
        view_name: view_name.into(),
    }
}

async fn guarded(world: &World) -> Arc<Operations> {
    let operations = Arc::new(Operations::default());
    world.library.register_run_guard(Arc::clone(&operations) as Arc<dyn RunOperationGuard>).await;
    operations
}

/// RES-AC-06: with no accepted Result, Mark processing complete makes the run
/// Complete at Done; no file is removed and Clean up has not started.
#[tokio::test]
async fn complete_needs_no_result() {
    let world = world().await;
    let files = tree(&world.root);
    let decisions = world.decisions().await;
    let id = world.run("HOO", &[world.ha1, world.oiii]).await;
    world.stage(id, RunStage::Calibrate).await;
    let record = world.library.mark_view_complete(id).await.unwrap();
    assert_eq!(
        (record.view.completion, record.view.stage, record.view.stage_before_complete),
        (RunCompletion::Complete, RunStage::Done, Some(RunStage::Calibrate)),
        "Complete at Done, not Clean up"
    );
    assert_eq!(record.revision.as_ref().map(|r| r.revision), Some(1), "membership unchanged");
    assert_eq!(world.library.catalog().view(id).await.unwrap(), record, "durable");
    assert_eq!(tree(&world.root), files, "no file is removed");
    assert_eq!(world.decisions().await, decisions, "no quality decision changes");
    let rename = DraftEdit::Details { name: "HOO 2".into() };
    let error = world.library.catalog().edit_view_draft(id, 0, &rename).await.unwrap_err();
    refused(&error, &["reopen"]);
    refused(&world.library.mark_view_complete(id).await.unwrap_err(), &["already Complete"]);
}

/// RES-AC-07: a Running app-owned operation affecting the run blocks Mark
/// Complete and the refusal names it; a Result used as another run's input
/// does not, and an unrelated run's operation does not block it.
#[tokio::test]
async fn complete_blocked_only_by_running_app_operation() {
    let world = world().await;
    let operations = guarded(&world).await;
    let a = world.run("Ha-only", &[world.ha1]).await;
    let b = world.run("HOO", &[world.ha2, world.oiii]).await;
    let c = world.run("HOO reprocess", &[world.ha2]).await;
    operations.hold(a, preparation("Ha-only rev 2")).await;
    operations.hold(b, result_input(c, "HOO reprocess")).await;

    let error = world.library.mark_view_complete(a).await.unwrap_err();
    refused(&error, &["Ha-only", "preparation 'Ha-only rev 2'", "Running"]);
    assert_eq!(world.library.catalog().view(a).await.unwrap().view.completion, RunCompletion::Open);

    let done = world.library.mark_view_complete(b).await.unwrap();
    assert_eq!(
        done.view.completion,
        RunCompletion::Complete,
        "a Result input never blocks Complete"
    );

    operations.clear(a).await;
    let done = world.library.mark_view_complete(a).await.unwrap();
    assert_eq!(done.view.completion, RunCompletion::Complete, "nothing else blocks it");
}

/// RES-AC-08: Reopen returns a Complete run to the stage it was in, even
/// after it moved on to Clean up, and membership changes are accepted again.
#[tokio::test]
async fn reopen_returns_to_previous_stage() {
    let world = world().await;
    let id = world.run("HOO", &[world.ha1, world.oiii]).await;
    world.stage(id, RunStage::Prepare).await;
    refused(&world.library.catalog().reopen_view(id).await.unwrap_err(), &["not Complete"]);
    world.library.mark_view_complete(id).await.unwrap();
    world.stage(id, RunStage::CleanUp).await;
    let reopened = world.library.catalog().reopen_view(id).await.unwrap();
    assert_eq!(
        (reopened.view.completion, reopened.view.stage, reopened.view.stage_before_complete),
        (RunCompletion::Open, RunStage::Prepare, None)
    );
    assert_eq!(world.library.catalog().view(id).await.unwrap(), reopened, "durable");
    let rename = DraftEdit::Details { name: "HOO 2".into() };
    let draft = world.library.catalog().edit_view_draft(id, 0, &rename).await.unwrap();
    assert_eq!(draft.draft.map(|d| d.name), Some("HOO 2".into()), "open for changes again");
}

/// RES-AC-19 and PRJ-AC-29: moving a run to the Trash moves no file and
/// changes no library decision. The run leaves the run list (the stage rail)
/// and the Project's members, so its frames stop counting toward goals unless
/// another run holds them; the Project's Trash list shows it at its stage. Its
/// sessions stay candidates in the other run's picker, and it offers no step
/// until restored.
#[tokio::test]
async fn trash_moves_no_file_and_hides_run_from_lists_pickers_goals() {
    let world = world().await;
    let ha_only = world.run("Ha-only", &[world.ha1]).await;
    let hoo = world.run("HOO", &[world.ha2, world.oiii]).await;
    world.stage(ha_only, RunStage::Prepare).await;
    let files = tree(&world.root);
    let decisions = world.decisions().await;
    assert_eq!(world.members().await.len(), 3);

    let trashed = world.library.move_view_to_trash(ha_only).await.unwrap();
    assert!(trashed.view.trashed_at.is_some());
    assert_eq!(
        (trashed.view.stage, trashed.view.completion),
        (RunStage::Prepare, RunCompletion::Open),
        "it keeps its stage"
    );
    assert_eq!(tree(&world.root), files, "no file moves");
    assert_eq!(world.decisions().await, decisions, "no library frame or decision changes");

    assert_eq!(world.listed().await, vec![("HOO".to_owned(), RunStage::Select)], "left the rail");
    let everywhere = world.library.catalog().list_views(&ViewQuery::default()).await.unwrap();
    assert_eq!(everywhere.iter().map(|run| run.id).collect::<Vec<_>>(), vec![hoo]);
    let members = world.members().await;
    assert_eq!(
        members,
        BTreeMap::from([(world.ha2, vec![hoo]), (world.oiii, vec![hoo])]),
        "its frames stop counting in project"
    );
    assert_eq!(
        world.trash().await,
        vec![("Ha-only".to_owned(), RunStage::Prepare, RunCompletion::Open)],
        "the Project's Trash list shows it at Prepare"
    );
    let picker = world.library.catalog().view_candidate_basis(hoo).await.unwrap();
    let mut candidates: Vec<Uuid> =
        picker.sessions.iter().map(persistence_library::CandidateSession::session_id).collect();
    candidates.sort_unstable();
    let mut expected = vec![world.ha1, world.ha2, world.oiii];
    expected.sort_unstable();
    assert_eq!(candidates, expected, "its sessions stay candidates");

    let catalog = world.library.catalog();
    refused(&catalog.set_view_stage(ha_only, RunStage::Results).await.unwrap_err(), &["Trash"]);
    let rename = DraftEdit::Details { name: "Ha 2".into() };
    refused(&catalog.edit_view_draft(ha_only, 0, &rename).await.unwrap_err(), &["Trash"]);
    refused(&world.library.mark_view_complete(ha_only).await.unwrap_err(), &["Trash"]);
    refused(&world.library.move_view_to_trash(ha_only).await.unwrap_err(), &["already"]);
}

/// Prepared and Results folders a feature records per run.
#[derive(Default)]
struct Folders {
    held: tokio::sync::Mutex<HashMap<Uuid, RunFolderSet>>,
}

impl RunFolders for Folders {
    fn folders<'a>(&'a self, view: &'a View) -> FoldersFuture<'a> {
        Box::pin(
            async move { Ok(self.held.lock().await.get(&view.id).cloned().unwrap_or_default()) },
        )
    }
}

fn folder(root: &Path, name: &str) -> NativePath {
    NativePath::from_path(&root.join("Processing").join("NGC 7000 HOO").join(name))
}

/// RES-AC-21 and PRJ-AC-29: Restore brings the run back at its stage with
/// the same membership revisions, draft, prepared revisions and Results
/// folder, and the goal basis reads as before the move; nothing moves.
#[tokio::test]
async fn restore_brings_back_revisions_and_stage_exactly() {
    let world = world().await;
    let catalog = world.library.catalog();
    let folders = Arc::new(Folders::default());
    world.library.register_run_folders(Arc::clone(&folders) as Arc<dyn RunFolders>).await;
    let id = world.run("Ha-only", &[world.ha1, world.ha2]).await;
    let drop = DraftEdit::DeselectSessions { session_ids: vec![world.ha2] };
    catalog.edit_view_draft(id, 0, &drop).await.unwrap();
    world.save(id).await;
    let rename = DraftEdit::Details { name: "Ha-only night 1".into() };
    catalog.edit_view_draft(id, 0, &rename).await.unwrap();
    world.stage(id, RunStage::Prepare).await;
    let prepared = RunFolderSet {
        prepared: vec![
            PreparedFolder { preparation_revision: 1, path: folder(&world.root, "Ha-only") },
            PreparedFolder {
                preparation_revision: 2,
                path: folder(&world.root, "Ha-only (rev 2)"),
            },
        ],
        results: vec![folder(&world.root, "Ha-only Results")],
    };
    folders.held.lock().await.insert(id, prepared.clone());
    let done = world.run("HOO", &[world.ha2, world.oiii]).await;
    world.library.mark_view_complete(done).await.unwrap();

    let record = catalog.view(id).await.unwrap();
    let revisions = (
        json(&catalog.view_revision(id, 1).await.unwrap()),
        json(&catalog.view_revision(id, 2).await.unwrap()),
        json(&catalog.view_membership(id, Membership::Draft).await.unwrap()),
    );
    let complete = catalog.view(done).await.unwrap();
    let (listed, members, files) = (world.listed().await, world.members().await, tree(&world.root));

    for run in [id, done] {
        world.library.move_view_to_trash(run).await.unwrap();
    }
    assert!(world.listed().await.is_empty() && world.members().await.is_empty());
    let review = world.library.empty_trash_review(world.project.id, &[id]).await.unwrap();
    assert_eq!(review.runs.len(), 1);
    assert_eq!(
        (&review.runs[0].prepared_folders, &review.runs[0].results_folders),
        (&prepared.prepared, &prepared.results),
        "the trashed run keeps both preparation revisions and its Results folder"
    );

    for run in [id, done] {
        let restored = catalog.restore_view(run).await.unwrap();
        assert_eq!(restored.view.trashed_at, None);
    }
    let restored = catalog.view(id).await.unwrap();
    let mut expected = record.clone();
    expected.view.updated_at.clone_from(&restored.view.updated_at);
    assert_eq!(restored, expected, "the same stage, revisions and draft");
    assert_eq!(restored.view.stage, RunStage::Prepare);
    assert_eq!(
        (
            json(&catalog.view_revision(id, 1).await.unwrap()),
            json(&catalog.view_revision(id, 2).await.unwrap()),
            json(&catalog.view_membership(id, Membership::Draft).await.unwrap()),
        ),
        revisions
    );
    let restored_complete = catalog.view(done).await.unwrap();
    assert_eq!(
        (
            restored_complete.view.completion,
            restored_complete.view.stage,
            restored_complete.view.stage_before_complete
        ),
        (complete.view.completion, complete.view.stage, complete.view.stage_before_complete),
        "a Complete run comes back Complete"
    );
    assert_eq!(world.listed().await, listed, "back on the stage rail");
    assert_eq!(world.members().await, members, "goal numbers read as before");
    assert!(world.trash().await.is_empty());
    assert_eq!(tree(&world.root), files, "no file moved");
    assert_eq!(folders.held.lock().await[&id], prepared, "its folders are untouched");
    refused(&catalog.restore_view(id).await.unwrap_err(), &["not in the Project's Trash"]);
}

/// RES-AC-20 (the Running-operation half; U27 registers Results inputs): Move
/// run to Trash is refused while an app-owned operation affecting the run is
/// Running, and while one of its accepted Results is an input to another run.
/// Each refusal names every blocker and nothing changes.
#[tokio::test]
async fn trash_refused_while_operation_running_names_it() {
    let world = world().await;
    let operations = guarded(&world).await;
    let a = world.run("Ha-only", &[world.ha1]).await;
    let b = world.run("HOO", &[world.ha2, world.oiii]).await;
    let c = world.run("HOO reprocess", &[world.ha2]).await;
    let d = world.run("HOO mosaic test", &[world.oiii]).await;
    operations.hold(a, preparation("Ha-only rev 2")).await;
    operations
        .hold(
            a,
            LifecycleBlocker::RunningOperation {
                operation_id: Uuid::new_v4(),
                operation: RunOperationKind::StorageMutation,
                name: "Clean up Ha-only".into(),
            },
        )
        .await;
    operations.hold(b, result_input(c, "HOO reprocess")).await;
    operations.hold(b, result_input(d, "HOO mosaic test")).await;
    let listed = world.listed().await;
    let members = world.members().await;

    let error = world.library.move_view_to_trash(a).await.unwrap_err();
    refused(
        &error,
        &["Ha-only", "preparation 'Ha-only rev 2'", "storage mutation 'Clean up Ha-only'"],
    );
    let error = world.library.move_view_to_trash(b).await.unwrap_err();
    refused(&error, &["'HOO reprocess'", "'HOO mosaic test'", "NGC 7000 Ha stack"]);
    for run in [a, b] {
        assert_eq!(world.library.catalog().view(run).await.unwrap().view.trashed_at, None);
    }
    assert_eq!((world.listed().await, world.members().await), (listed, members), "nothing changes");
    assert!(world.trash().await.is_empty());

    operations.clear(a).await;
    world.library.move_view_to_trash(a).await.unwrap();
    assert_eq!(world.trash().await.len(), 1, "it moves once nothing is Running");
}

/// An operation starting on a run while Move run to Trash asks the guards
/// waits for the move: the guards are asked holding the catalog writer, so the
/// start then finds the run in the Trash and refuses.
#[tokio::test]
async fn operation_start_racing_trash_waits_for_it() {
    struct RacingStart {
        library: Weak<Library>,
        started: tokio::sync::Mutex<Option<JoinHandle<Result<ViewRecord, LibraryError>>>>,
    }
    impl RunOperationGuard for RacingStart {
        fn blockers<'a>(&'a self, view: &'a View) -> BlockersFuture<'a> {
            Box::pin(async move {
                let library = self.library.upgrade().unwrap();
                let id = view.id;
                let start = tokio::spawn(async move {
                    library.catalog().set_view_stage(id, RunStage::Prepare).await
                });
                tokio::time::sleep(Duration::from_millis(200)).await;
                assert!(!start.is_finished(), "no write lands while the guards are asked");
                *self.started.lock().await = Some(start);
                Ok(Vec::new())
            })
        }
    }

    let world = world().await;
    let id = world.run("HOO", &[world.ha1]).await;
    let racing = Arc::new(RacingStart {
        library: Arc::downgrade(&world.library),
        started: tokio::sync::Mutex::new(None),
    });
    world.library.register_run_guard(Arc::clone(&racing) as Arc<dyn RunOperationGuard>).await;
    world.library.move_view_to_trash(id).await.unwrap();
    let start = racing.started.lock().await.take().unwrap();
    refused(&start.await.unwrap().unwrap_err(), &["Trash"]);
    assert_eq!(
        world.trash().await,
        vec![("HOO".to_owned(), RunStage::Select, RunCompletion::Open)]
    );
}

/// PRJ-FR-20 and RES-FR-10: the Empty Trash review names each run record in
/// the Project's Trash, or only the asked ones, with its prepared folders and
/// its Results folder, which goes only when ticked. It moves nothing.
#[tokio::test]
async fn empty_trash_review_names_runs_and_folders_and_moves_nothing() {
    let world = world().await;
    let folders = Arc::new(Folders::default());
    world.library.register_run_folders(Arc::clone(&folders) as Arc<dyn RunFolders>).await;
    let a = world.run("Ha-only", &[world.ha1]).await;
    let b = world.run("HOO", &[world.ha2, world.oiii]).await;
    let live = world.run("OIII", &[world.oiii]).await;
    let set = RunFolderSet {
        prepared: vec![PreparedFolder {
            preparation_revision: 1,
            path: folder(&world.root, "HOO"),
        }],
        results: vec![folder(&world.root, "HOO Results")],
    };
    folders.held.lock().await.insert(b, set.clone());
    for run in [a, b] {
        world.library.move_view_to_trash(run).await.unwrap();
    }
    let files = tree(&world.root);

    let review = world.library.empty_trash_review(world.project.id, &[]).await.unwrap();
    assert_eq!(review.project_id, world.project.id);
    let mut named: Vec<(&str, usize, usize)> = review
        .runs
        .iter()
        .map(|run| {
            (run.run.run.name.as_str(), run.prepared_folders.len(), run.results_folders.len())
        })
        .collect();
    named.sort_unstable();
    assert_eq!(named, vec![("HOO", 1, 1), ("Ha-only", 0, 0)]);
    assert!(review.statement.contains("only when ticked"), "{}", review.statement);

    let one = world.library.empty_trash_review(world.project.id, &[b]).await.unwrap();
    assert_eq!(one.runs.len(), 1);
    assert_eq!(
        (&one.runs[0].prepared_folders, &one.runs[0].results_folders),
        (&set.prepared, &set.results)
    );
    let error = world.library.empty_trash_review(world.project.id, &[live]).await.unwrap_err();
    refused(&error, &["not in this Project's Trash"]);
    assert_eq!(tree(&world.root), files, "the review moves nothing");
    assert_eq!(world.trash().await.len(), 2, "and removes no run");
}

/// Serialized JSON of a read, for exact comparison.
fn json<T: serde::Serialize>(value: &T) -> serde_json::Value {
    serde_json::to_value(value).unwrap()
}
