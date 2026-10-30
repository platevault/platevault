// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! A Project's `Output/` (spec 070 RES-FR-01/02/06 to RES-FR-08/11,
//! CAL-FR-06; D-W93, D-W98) on the composed library over real files and a
//! real catalog: the watcher lists every file of every subfolder as it is
//! written and settles it, Rescan, removal and unreadable folders, Kind and
//! Channel kept, panels by folder alone, Copy to Output verified and never
//! overwriting, a tool rerun changing no Output byte, the once-only
//! Processing master offer, protection, a Closed Project read-only, and
//! restart.

mod support;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use platevault_core::layout;
use platevault_core::library::Library;
use platevault_core::project_output::{OutputWatch, OutputWatchSettings};
use platevault_core::targets::TargetQuery;
use platevault_core::*;
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::Connection;
use support::{digest, fits};
use tempfile::TempDir;
use uuid::Uuid;

const PROJECT: &str = "NGC 7000 HOO";
const AT: &str = "2026-10-16T08:00:00Z";
const OPTICS: &str = r#"{"cameraId":null,"focalLengthMm":"250","reducer":null}"#;
const MASTER_DARK: [(&str, &str); 2] = [("IMAGETYP", "'Dark'"), ("STACKCNT", "20")];

/// Fast pacing: a 300 ms stable-size window and a sweep far beyond any test,
/// so a file found without Rescan was reported by the folder watcher.
const FAST: OutputWatchSettings = OutputWatchSettings {
    window: Duration::from_millis(300),
    tick: Duration::from_millis(50),
    sweep: Duration::from_secs(600),
    event_capacity: 1024,
    shutdown_grace: Duration::from_secs(2),
};

struct World {
    temp: TempDir,
    db: PathBuf,
    library: Arc<Library>,
    project: Uuid,
    rig: Uuid,
}

impl World {
    async fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let db = temp.path().join("catalog.sqlite");
        let library = Library::open(&db, None).await.unwrap();
        let rig = rig(&library).await;
        let query = TargetQuery { text: Some("NGC 7000".into()), cone: None, limit: 1 };
        let target = library.search_targets(&query).await.unwrap().remove(0).candidate;
        library.catalog().record_seed_target(&target).await.unwrap();
        let input = ProjectInput {
            name: PROJECT.into(),
            notes: None,
            subjects: vec![SubjectInput { target_id: target.id, name: None }],
            rig_ids: vec![rig],
            goals: Vec::new(),
        };
        let project = library.catalog().create_project(&input).await.unwrap().id;
        let world = Self { temp, db, library, project, rig };
        let parent = NativePath::from_path(&world.parent());
        world
            .sql(
                "UPDATE projects SET processing_parent = ?2 WHERE id = ?1",
                &[&world.project.to_string(), &serde_json::to_string(&parent).unwrap()],
            )
            .await
            .unwrap();
        fs::create_dir_all(world.output()).unwrap();
        fs::create_dir_all(world.processing().join("WBPP")).unwrap();
        world
    }

    fn parent(&self) -> PathBuf {
        self.temp.path().join("Astro")
    }

    fn folder(&self) -> PathBuf {
        layout::project_folder(&self.parent(), PROJECT).unwrap()
    }

    fn output(&self) -> PathBuf {
        self.folder().join(layout::OUTPUT_FOLDER)
    }

    fn processing(&self) -> PathBuf {
        self.folder().join(layout::PROCESSING_FOLDER)
    }

    fn watch(&self) -> OutputWatch {
        OutputWatch::start_with(&self.library, FAST)
    }

    async fn sql(&self, sql: &'static str, binds: &[&str]) -> Result<(), String> {
        let options = SqliteConnectOptions::new().filename(&self.db);
        let mut conn = SqliteConnection::connect_with(&options).await.unwrap();
        let mut query = sqlx::query(sql);
        for bind in binds {
            query = query.bind(*bind);
        }
        let result = query.execute(&mut conn).await.map(|_| ()).map_err(|error| error.to_string());
        conn.close().await.unwrap();
        result
    }

    async fn count(&self, sql: &'static str) -> i64 {
        let options = SqliteConnectOptions::new().filename(&self.db);
        let mut conn = SqliteConnection::connect_with(&options).await.unwrap();
        let count = sqlx::query_scalar(sql)
            .bind(self.project.to_string())
            .fetch_one(&mut conn)
            .await
            .unwrap();
        conn.close().await.unwrap();
        count
    }

    /// A panel group of the Project named `name`.
    async fn panel(&self, name: &str, position: u32) -> Uuid {
        let id = Uuid::new_v4();
        self.sql(
            "INSERT INTO project_groups (id, project_id, rig_id, name, name_key, panel, origin, \
             optics, framing, position, created_at) \
             VALUES (?1, ?2, ?3, ?4, lower(?4), 1, 'user', ?5, NULL, CAST(?6 AS INTEGER), ?7)",
            &[
                &id.to_string(),
                &self.project.to_string(),
                &self.rig.to_string(),
                name,
                OPTICS,
                &position.to_string(),
                AT,
            ],
        )
        .await
        .unwrap();
        id
    }

    /// Wrap up skipped throughout, the snapshot, then Closed.
    async fn close(&self) {
        let project = self.project.to_string();
        for step in ["clean_up", "trash", "archive"] {
            self.sql(
                "INSERT INTO project_wrap_up_steps (project_id, step, outcome, recorded_at) \
                 VALUES (?1, ?2, 'skipped', ?3)",
                &[&project, step, AT],
            )
            .await
            .unwrap();
        }
        self.sql(
            "INSERT INTO project_snapshots (project_id, applied_generation, snapshot, taken_at) \
             VALUES (?1, NULL, json_object('projectId', ?1, 'appliedGeneration', NULL), ?2)",
            &[&project, AT],
        )
        .await
        .unwrap();
        self.sql(
            "UPDATE projects SET lifecycle = 'closed', closed_at = ?2 WHERE id = ?1",
            &[&project, AT],
        )
        .await
        .unwrap();
    }

    async fn outputs(&self) -> Vec<OutputObservation> {
        self.library.catalog().project_outputs(self.project).await.unwrap()
    }

    async fn offers(&self) -> Vec<ProcessingMasterOffer> {
        self.library.catalog().processing_master_offers(self.project).await.unwrap()
    }

    /// Rescan, wait out the stable-size window, Rescan again.
    async fn settled(&self, watch: &OutputWatch) -> Vec<OutputObservation> {
        watch.rescan(self.project).await.unwrap();
        tokio::time::sleep(FAST.window + FAST.tick).await;
        watch.rescan(self.project).await.unwrap()
    }

    /// Wait until the recorded Output satisfies `wanted`, without Rescan. The
    /// deadline is generous: each catalog commit and copy syncs to disk, which
    /// a loaded host slows by seconds.
    async fn until(&self, wanted: impl Fn(&[OutputObservation]) -> bool) -> Vec<OutputObservation> {
        let deadline = Instant::now() + Duration::from_secs(90);
        loop {
            let outputs = self.outputs().await;
            if wanted(&outputs) {
                return outputs;
            }
            assert!(Instant::now() < deadline, "never reached: {outputs:#?}");
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
}

async fn rig(library: &Library) -> Uuid {
    let rig = Equipment {
        id: Uuid::new_v4(),
        name: "RedCat 51 + ASI2600MM".into(),
        camera: Some("ASI2600MM".into()),
        telescope: Some("RedCat 51".into()),
        focal_length_mm: Some(250.0),
        pixel_size_um: Some(3.76),
        sensor_width_px: Some(6248),
        sensor_height_px: Some(4176),
        color_kind: Some(ColorKind::Mono),
        decision_revision: 0,
        state: AssociationState::Confirmed,
        provenance: Provenance::User,
    };
    library.catalog().save_equipment(&rig, None).await.unwrap().id
}

/// `path`, written with `/`, in the host's spelling: the watcher and Copy to
/// Output name a file below `Output/` with the platform's separator.
fn native(path: &str) -> NativePath {
    NativePath::from_path(&path.split('/').collect::<PathBuf>())
}

fn write(path: &Path, bytes: &[u8]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}

/// A FITS file with `cards`, its folders made first.
fn stack(path: &Path, cards: &[(&str, &str)]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fits(path, cards).unwrap();
}

fn find<'a>(outputs: &'a [OutputObservation], path: &str) -> &'a OutputObservation {
    outputs
        .iter()
        .find(|output| output.path == native(path))
        .unwrap_or_else(|| panic!("{path} not listed in {outputs:#?}"))
}

/// Each Output's path as wire text, separated by `/` on every platform.
fn paths(outputs: &[OutputObservation]) -> Vec<String> {
    outputs
        .iter()
        .map(|output| fs_pathsafe::wire_path(&output.path.to_path_buf().unwrap()))
        .collect()
}

fn refused(error: &LibraryError, needle: &str) {
    assert!(matches!(error, LibraryError::InvalidInput(_)), "{error}");
    assert!(error.to_string().contains(needle), "{error} should name {needle}");
}

fn modified(path: &Path) -> SystemTime {
    fs::metadata(path).unwrap().modified().unwrap()
}

/// Every file below `root` with its SHA-256 and modification time.
fn tree(root: &Path) -> BTreeMap<PathBuf, (String, SystemTime)> {
    let mut files = BTreeMap::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(folder) = pending.pop() {
        for entry in fs::read_dir(&folder).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                pending.push(path);
            } else {
                files.insert(path.clone(), (digest(&path), modified(&path)));
            }
        }
    }
    files
}

// ── The watcher ──────────────────────────────────────────────────────────────
/// Reading the recorded listing does not consult disk, preserves catalog order,
/// and remains available after Close even when the Output folder is missing.
#[tokio::test]
async fn project_output_list_reads_catalog_without_filesystem_access() {
    let world = World::new().await;
    let watch = world.watch();
    write(&world.output().join("z.fit"), b"z");
    write(&world.output().join("a.fit"), b"a");
    let recorded = world.settled(&watch).await;
    assert_eq!(paths(&recorded), ["a.fit", "z.fit"]);

    fs::remove_dir_all(world.output()).unwrap();
    let read = world.library.project_output_list(world.project).await.unwrap();
    assert_eq!(read, recorded, "the catalog preserves full observation contents and order");

    world.close().await;
    assert_eq!(world.library.project_output_list(world.project).await.unwrap(), recorded);
    watch.shutdown().await;
}

/// An empty Output reads as an empty catalog listing without walking its folder.
#[tokio::test]
async fn project_output_list_returns_an_empty_recorded_listing() {
    let world = World::new().await;
    assert!(world.library.project_output_list(world.project).await.unwrap().is_empty());
}


/// RES-AC-01, RES-AC-23, RES-AC-27: a file saved into `Output/` appears
/// without a scan, reads "Still being written" while it grows and Settled
/// once it stops; files in the user's own subfolders found at start are
/// listed by their path relative to `Output/`, and no folder is made or
/// moved inside it.
#[tokio::test]
async fn the_watcher_lists_every_file_as_it_is_written_and_settles_it() {
    let world = World::new().await;
    write(&world.output().join("final/NGC7000-HOO.tif"), b"final image");
    write(&world.output().join("drafts/stretch-1.xcf"), b"draft");
    write(&world.output().join("notes.txt"), b"any file is a Result");
    let watch = world.watch();
    let listed = world
        .until(|outputs| {
            outputs.len() == 3 && outputs.iter().all(|output| output.state == OutputState::Settled)
        })
        .await;
    assert_eq!(paths(&listed), ["drafts/stretch-1.xcf", "final/NGC7000-HOO.tif", "notes.txt"]);
    assert!(listed.iter().all(|output| output.origin == OutputOrigin::Observed));
    assert!(listed.iter().all(|output| output.sha256.is_none()), "the watcher never hashes");

    let growing = world.output().join("final/NGC7000-HOO-v2.xisf");
    let name = "final/NGC7000-HOO-v2.xisf";
    write(&growing, b"part 1");
    let seen = world.until(|outputs| outputs.iter().any(|o| o.path == native(name))).await;
    let mut still_being_written = find(&seen, name).state == OutputState::Settling;
    let mut appended = b"part 1".to_vec();
    for n in 2..8 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        appended.extend_from_slice(format!(" part {n}").as_bytes());
        fs::write(&growing, &appended).unwrap();
        still_being_written |= find(&world.outputs().await, name).state == OutputState::Settling;
    }
    assert!(still_being_written, "a growing file reads Still being written");
    let settled = world
        .until(|outputs| {
            outputs.iter().any(|o| {
                o.path == native("final/NGC7000-HOO-v2.xisf")
                    && o.state == OutputState::Settled
                    && o.size_bytes == appended.len() as u64
            })
        })
        .await;
    assert_eq!(settled.len(), 4);
    let mut folders: Vec<String> = fs::read_dir(world.output())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    folders.sort();
    assert_eq!(folders, ["drafts", "final", "notes.txt"], "PlateVault makes no folder in Output/");
    watch.shutdown().await;
}

/// RES-FR-01 edge case: a file removed outside `PlateVault` leaves the table;
/// one below a folder that can't be read is unknown, never removed; a folder
/// made after the watcher started is found by the next pass.
#[tokio::test]
async fn removal_leaves_the_table_and_an_unreadable_folder_keeps_its_files() {
    let world = World::new().await;
    write(&world.output().join("drafts/a.fit"), b"a");
    write(&world.output().join("b.fit"), b"b");
    let watch = world.watch();
    let listed = world.settled(&watch).await;
    assert_eq!(paths(&listed), ["b.fit", "drafts/a.fit"]);

    // Unix only: a folder is made unreadable with chmod.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let drafts = world.output().join("drafts");
        fs::set_permissions(&drafts, fs::Permissions::from_mode(0o000)).unwrap();
        let readable = fs::read_dir(&drafts).is_ok();
        let outputs = watch.rescan(world.project).await.unwrap();
        fs::set_permissions(&drafts, fs::Permissions::from_mode(0o755)).unwrap();
        if !readable {
            assert_eq!(paths(&outputs), ["b.fit", "drafts/a.fit"], "unknown, not removed");
            assert_eq!(find(&outputs, "drafts/a.fit").state, OutputState::Unreadable);
        }
    }

    fs::remove_file(world.output().join("b.fit")).unwrap();
    write(&world.output().join("later/c.fit"), b"c");
    let outputs = world.settled(&watch).await;
    assert_eq!(paths(&outputs), ["drafts/a.fit", "later/c.fit"]);
    assert_eq!(find(&outputs, "drafts/a.fit").state, OutputState::Settled);

    // The folder made after the start is watched once a pass found it.
    write(&world.output().join("later/d.fit"), b"d");
    world.until(|outputs| outputs.iter().any(|o| o.path == native("later/d.fit"))).await;
    watch.shutdown().await;
}

/// RES-AC-24: Kind and Channel are the user's and survive every pass; a
/// copied file the user changes is no longer the verified copy.
#[tokio::test]
async fn kind_and_channel_stay_through_every_pass() {
    let world = World::new().await;
    write(&world.output().join("ha.fit"), b"ha");
    let watch = world.watch();
    world.settled(&watch).await;
    let catalog = world.library.catalog();
    let set = catalog
        .set_output_details(
            world.project,
            &native("ha.fit"),
            Some(OutputKind::ChannelProduct),
            Some("Ha".into()),
        )
        .await
        .unwrap();
    assert_eq!(
        (set.kind.clone(), set.channel.as_deref()),
        (Some(OutputKind::ChannelProduct), Some("Ha"))
    );
    write(&world.output().join("ha.fit"), b"ha, reprocessed");
    let outputs = world.settled(&watch).await;
    let ha = find(&outputs, "ha.fit");
    assert_eq!(
        (ha.kind.clone(), ha.channel.as_deref()),
        (Some(OutputKind::ChannelProduct), Some("Ha"))
    );
    let blank = catalog
        .set_output_details(world.project, &native("ha.fit"), None, Some("  ".into()))
        .await
        .unwrap_err();
    refused(&blank, "blank");
    let missing = catalog.set_output_details(world.project, &native("nope.fit"), None, None).await;
    assert!(matches!(missing, Err(LibraryError::NotFound(_))));

    let source = world.processing().join("WBPP/master/masterLight_Ha.xisf");
    write(&source, b"integrated Ha");
    let copied = world
        .library
        .copy_to_output(world.project, &NativePath::from_path(&source), &native("copied.xisf"))
        .await
        .unwrap();
    assert_eq!(copied.origin, OutputOrigin::Copied);
    write(&world.output().join("copied.xisf"), b"edited by the user");
    let outputs = world.settled(&watch).await;
    let edited = find(&outputs, "copied.xisf");
    assert_eq!((edited.origin, edited.sha256.as_deref()), (OutputOrigin::Observed, None));
    watch.shutdown().await;
}

/// RES-AC-11, RES-FR-08: a file belongs to a panel only by lying in its
/// panel group's `Output/Panels/<folder>/`; the assembled image in
/// `Output/` and a file in an unknown panel folder belong to none.
#[tokio::test]
async fn a_panel_result_belongs_to_its_panel_folder_alone() {
    let world = World::new().await;
    let one = world.panel("Panel 1", 0).await;
    let two = world.panel("Panel 2", 1).await;
    let panels = world.output().join(OUTPUT_PANELS);
    stack(&panels.join("Panel-1/stack.fit"), &[("OBJECT", "'Panel 2'")]);
    write(&panels.join("Panel-2/stack.fit"), b"panel 2");
    write(&panels.join("Panel-3/stack.fit"), b"no such panel");
    write(&panels.join("loose.fit"), b"in Panels/ itself");
    write(&world.output().join("mosaic.fit"), b"assembled");
    let watch = world.watch();
    let outputs = world.settled(&watch).await;
    let panel = |path: &str| find(&outputs, path).panel_group_id;
    assert_eq!(panel("Panels/Panel-1/stack.fit"), Some(one), "the folder decides, not the header");
    assert_eq!(panel("Panels/Panel-2/stack.fit"), Some(two));
    assert_eq!(panel("Panels/Panel-3/stack.fit"), None);
    assert_eq!(panel("Panels/loose.fit"), None);
    assert_eq!(panel("mosaic.fit"), None);
    watch.shutdown().await;
}

// ── Copy to Output ───────────────────────────────────────────────────────────

/// RES-AC-02, RES-FR-02: Copy to Output lists a copy re-read against the
/// source's SHA-256, under the Project's operation, and leaves the source in
/// `Processing/` unchanged.
#[tokio::test]
async fn copy_to_output_lists_a_verified_copy_and_leaves_the_source() {
    let world = World::new().await;
    let source = world.processing().join("WBPP/master/masterLight_Ha.xisf");
    stack(&source, &[("IMAGETYP", "'Light'"), ("STACKCNT", "40")]);
    let (before, at) = (digest(&source), modified(&source));
    let copied = world
        .library
        .copy_to_output(world.project, &NativePath::from_path(&source), &native("final/Ha.xisf"))
        .await
        .unwrap();
    assert_eq!(copied.origin, OutputOrigin::Copied);
    assert_eq!(copied.state, OutputState::Settled);
    assert_eq!(copied.sha256.as_deref(), Some(before.as_str()));
    assert!(copied.fingerprint.is_some());
    let destination = world.output().join("final/Ha.xisf");
    assert_eq!(digest(&destination), before);
    assert_eq!((digest(&source), modified(&source)), (before, at), "the source is unchanged");
    let outputs = world.outputs().await;
    assert_eq!(outputs, vec![copied]);
    assert_eq!(world.count("SELECT count(*) FROM output_copies WHERE project_id = ?1").await, 0);
    let settled = "SELECT count(*) FROM project_operations \
                   WHERE project_id = ?1 AND kind = 'copy_to_output' AND state = 'settled'";
    assert_eq!(world.count(settled).await, 1);
    assert!(world
        .library
        .catalog()
        .active_project_operation(world.project)
        .await
        .unwrap()
        .is_none());
}

/// RES-AC-25: a name `Output/` already holds is never overwritten; the user
/// picks another. A source in `Output/`, a link and a name that leaves
/// `Output/` are refused.
#[tokio::test]
async fn copy_to_output_never_overwrites() {
    let world = World::new().await;
    let source = world.processing().join("WBPP/master/masterLight_Ha.xisf");
    write(&source, b"new master");
    let existing = world.output().join("Ha.xisf");
    write(&existing, b"the user's own result");
    let error = world
        .library
        .copy_to_output(world.project, &NativePath::from_path(&source), &native("Ha.xisf"))
        .await
        .unwrap_err();
    refused(&error, "already exists; choose another name");
    assert_eq!(fs::read(&existing).unwrap(), b"the user's own result");
    let error = world
        .library
        .copy_to_output(world.project, &NativePath::from_path(&existing), &native("Ha-2.xisf"))
        .await
        .unwrap_err();
    refused(&error, "already in Output/");
    let link = world.processing().join("WBPP/link.xisf");
    fs_pathsafe::create_symlink(&source, &link).unwrap();
    let error = world
        .library
        .copy_to_output(world.project, &NativePath::from_path(&link), &native("link.xisf"))
        .await
        .unwrap_err();
    refused(&error, "links are not followed");
    for name in ["../escape.xisf", "/abs.xisf"] {
        let as_given = NativePath::from_path(Path::new(name));
        let result = world
            .library
            .copy_to_output(world.project, &NativePath::from_path(&source), &as_given)
            .await;
        assert!(result.is_err(), "{name} leaves Output/");
    }
    let copied = world
        .library
        .copy_to_output(world.project, &NativePath::from_path(&source), &native("Ha-2.xisf"))
        .await
        .unwrap();
    assert_eq!(copied.path, native("Ha-2.xisf"));
    assert!(!world.temp.path().join("escape.xisf").exists());
}

/// RES-FR-07, PREP-FR-19: one operation per Project, and a Closed Project's
/// Output step is read-only: no copy, no Kind or Channel, no Rescan, and
/// its recorded rows refuse every write.
#[tokio::test]
async fn copy_waits_for_another_operation_and_a_closed_output_is_read_only() {
    let world = World::new().await;
    let source = world.processing().join("WBPP/master/masterLight_Ha.xisf");
    write(&source, b"master");
    write(&world.output().join("kept.fit"), b"kept");
    let watch = world.watch();
    world.settled(&watch).await;
    let apply = Uuid::new_v4().to_string();
    world
        .sql(
            "INSERT INTO project_operations (id, project_id, kind, state, reserved_at) \
             VALUES (?1, ?2, 'apply', 'active', ?3)",
            &[&apply, &world.project.to_string(), AT],
        )
        .await
        .unwrap();
    let copy = |name: &'static str| {
        let library = Arc::clone(&world.library);
        let source = NativePath::from_path(&source);
        let project = world.project;
        async move { library.copy_to_output(project, &source, &native(name)).await }
    };
    refused(&copy("busy.xisf").await.unwrap_err(), "Apply is already running");
    assert!(!world.output().join("busy.xisf").exists());
    world
        .sql(
            "UPDATE project_operations SET state = 'settled', settled_at = ?2 WHERE id = ?1",
            &[&apply, AT],
        )
        .await
        .unwrap();

    world.close().await;
    refused(&copy("closed.xisf").await.unwrap_err(), "read-only");
    assert!(!world.output().join("closed.xisf").exists());
    let catalog = world.library.catalog();
    let kept = native("kept.fit");
    let details = catalog.set_output_details(world.project, &kept, None, Some("L".into()));
    refused(&details.await.unwrap_err(), "read-only");
    refused(&watch.rescan(world.project).await.unwrap_err(), "read-only");
    let error = world
        .sql("DELETE FROM project_outputs WHERE project_id = ?1", &[&world.project.to_string()])
        .await
        .unwrap_err();
    assert!(error.contains("read-only"), "{error}");
    fs::remove_file(world.output().join("kept.fit")).unwrap();
    tokio::time::sleep(FAST.window * 2).await;
    assert_eq!(paths(&world.outputs().await), ["kept.fit"], "a Closed Project is not watched");
    watch.shutdown().await;
}

/// RES-AC-28, PV-RES-SC-04: a tool rerun that overwrites `Processing/`
/// changes zero files in `Output/`, and the Output step lists the same
/// Results.
#[tokio::test]
async fn a_tool_rerun_changes_no_output_byte() {
    let world = World::new().await;
    let master = world.processing().join("WBPP/master/masterLight_Ha.xisf");
    stack(&master, &[("IMAGETYP", "'Light'"), ("STACKCNT", "40")]);
    let watch = world.watch();
    world
        .library
        .copy_to_output(world.project, &NativePath::from_path(&master), &native("Ha.xisf"))
        .await
        .unwrap();
    write(&world.output().join("final/HOO.tif"), b"the user's final image");
    let before_listing = world.settled(&watch).await;
    let before = tree(&world.output());

    // WBPP runs again: it rewrites its master and its other files.
    stack(&master, &[("IMAGETYP", "'Light'"), ("STACKCNT", "44")]);
    write(&world.processing().join("WBPP/calibrated/light_0001_c.xisf"), b"rerun");
    write(&world.processing().join("WBPP/logs/run.log"), b"rerun log");
    let after_listing = world.settled(&watch).await;
    assert_eq!(tree(&world.output()), before, "no byte, name or time in Output/ changed");
    assert_eq!(after_listing, before_listing);
    let ha = find(&after_listing, "Ha.xisf");
    assert_eq!(ha.origin, OutputOrigin::Copied);
    assert_ne!(ha.sha256.as_deref(), Some(digest(&master).as_str()));
    watch.shutdown().await;
}

// ── The Processing master offer ──────────────────────────────────────────────

/// RES-AC-15, RES-FR-11, CAL-FR-06: a generated master found in
/// `Processing/` is offered once per digest, wherever a rerun writes it; new
/// bytes are a new offer; a raw frame and a light master are never offered;
/// a copy of an offered master is prefilled as that calibration master.
#[tokio::test]
async fn a_generated_master_is_offered_once_per_digest() {
    let world = World::new().await;
    let dark = world.processing().join("WBPP/master/masterDark_300s.fit");
    stack(&dark, &MASTER_DARK);
    stack(&world.processing().join("WBPP/darks/dark_0001.fit"), &[("IMAGETYP", "'Dark'")]);
    stack(
        &world.processing().join("WBPP/master/masterLight_Ha.fit"),
        &[("IMAGETYP", "'Light'"), ("STACKCNT", "40")],
    );
    let watch = world.watch();
    world.settled(&watch).await;
    let offers = world.offers().await;
    assert_eq!(offers.len(), 1, "{offers:#?}");
    assert_eq!(offers[0].path, native("WBPP/master/masterDark_300s.fit"));
    assert_eq!(offers[0].sha256, digest(&dark));
    assert_eq!(offers[0].classification.kind, InputKind::Dark);
    assert_eq!(offers[0].state, MasterOfferState::Offered);
    assert!(world.outputs().await.is_empty(), "a master is not a Result until copied");

    world.settled(&watch).await;
    fs::create_dir_all(world.processing().join("WBPP/master-2")).unwrap();
    fs::copy(&dark, world.processing().join("WBPP/master-2/masterDark_300s.fit")).unwrap();
    world.settled(&watch).await;
    assert_eq!(world.offers().await.len(), 1, "a digest is offered once, whatever its path");

    stack(&dark, &[("IMAGETYP", "'Dark'"), ("STACKCNT", "21")]);
    world.settled(&watch).await;
    let offers = world.offers().await;
    assert_eq!(offers.len(), 2, "new bytes are a new offer");
    assert_eq!(offers[1].sha256, digest(&dark));

    let copied = world
        .library
        .copy_to_output(world.project, &NativePath::from_path(&dark), &native("masterDark.fit"))
        .await
        .unwrap();
    assert_eq!(copied.kind, Some(OutputKind::CalibrationMaster { input: InputKind::Dark }));
    watch.shutdown().await;
}

/// RES-FR-11, CAL-FR-06: Hide on a generated master offer and its Restore
/// change only the catalog decision; the source keeps its bytes and digest.
/// A digest or id the offer does not have is refused.
#[tokio::test]
async fn a_hidden_master_offer_is_restored_while_its_source_is_unchanged() {
    let world = World::new().await;
    let source = world.processing().join("WBPP/master/masterDark_300s.fit");
    stack(&source, &MASTER_DARK);
    let watch = world.watch();
    world.settled(&watch).await;
    watch.shutdown().await;
    let [offer] = <[_; 1]>::try_from(world.offers().await).unwrap();
    let before = (fs::read(&source).unwrap(), digest(&source));

    let hidden = world.library.dismiss_processing_master(offer.id, &offer.sha256).await.unwrap();
    assert_eq!(hidden.state, MasterOfferState::Dismissed);
    let restored = world.library.restore_processing_master(offer.id, &offer.sha256).await.unwrap();
    assert_eq!(restored.state, MasterOfferState::Offered);
    assert_eq!(restored.sha256, before.1);
    assert_eq!((fs::read(&source).unwrap(), digest(&source)), before, "the source stays put");

    let stale = "0".repeat(64);
    assert_eq!(
        world.library.dismiss_processing_master(offer.id, &stale).await.unwrap_err().code(),
        LibraryErrorCode::InvalidInput
    );
    assert_eq!(
        world
            .library
            .dismiss_processing_master(Uuid::new_v4(), &offer.sha256)
            .await
            .unwrap_err()
            .code(),
        LibraryErrorCode::NotFound
    );
    world.library.dismiss_processing_master(offer.id, &offer.sha256).await.unwrap();
    assert_eq!(
        world.library.restore_processing_master(offer.id, &stale).await.unwrap_err().code(),
        LibraryErrorCode::InvalidInput
    );
    assert_eq!(world.offers().await[0].state, MasterOfferState::Dismissed);
}
/// RES-FR-07, CAL-FR-06: Hide and Restore refuse a Closed or Archived
/// Project's read-only Output step and leave its offer unchanged.
#[tokio::test]
async fn a_master_offer_cannot_be_hidden_or_restored_on_a_closed_or_archived_project() {
    for lifecycle in ["closed", "archived"] {
        let world = World::new().await;
        let source = world.processing().join("WBPP/master/masterDark_300s.fit");
        stack(&source, &MASTER_DARK);
        let watch = world.watch();
        world.settled(&watch).await;
        watch.shutdown().await;
        let [offer] = <[_; 1]>::try_from(world.offers().await).unwrap();
        world.library.dismiss_processing_master(offer.id, &offer.sha256).await.unwrap();

        if lifecycle == "closed" {
            world.close().await;
        } else {
            for (step, outcome) in
                [("clean_up", "skipped"), ("trash", "skipped"), ("archive", "finished")]
            {
                world
                    .sql(
                        "INSERT INTO project_wrap_up_steps (project_id, step, outcome, recorded_at) \
                         VALUES (?1, ?2, ?3, ?4)",
                        &[&world.project.to_string(), step, outcome, AT],
                    )
                    .await
                    .unwrap();
            }
            world
                .sql(
                    "INSERT INTO project_snapshots (project_id, applied_generation, snapshot, taken_at) \
                     VALUES (?1, NULL, json_object('projectId', ?1, 'appliedGeneration', NULL), ?2)",
                    &[&world.project.to_string(), AT],
                )
                .await
                .unwrap();
            world
                .sql(
                    "UPDATE projects SET lifecycle = 'closing', closed_at = ?2 WHERE id = ?1",
                    &[&world.project.to_string(), AT],
                )
                .await
                .unwrap();
            world
                .sql(
                    "UPDATE projects SET lifecycle = 'archived' WHERE id = ?1",
                    &[&world.project.to_string()],
                )
                .await
                .unwrap();
        }

        let hidden = world.library.dismiss_processing_master(offer.id, &offer.sha256).await;
        refused(&hidden.unwrap_err(), "read-only");
        let restored = world.library.restore_processing_master(offer.id, &offer.sha256).await;
        refused(&restored.unwrap_err(), "read-only");
        assert_eq!(world.offers().await[0].state, MasterOfferState::Dismissed);
    }
}

/// A hidden offer is not restored once its source changed or is gone: the
/// offer names those bytes; changed bytes are offered afresh by the next pass.
#[tokio::test]
async fn a_hidden_master_offer_is_not_restored_after_its_source_changed() {
    let world = World::new().await;
    let source = world.processing().join("WBPP/master/masterDark_300s.fit");
    stack(&source, &MASTER_DARK);
    let watch = world.watch();
    world.settled(&watch).await;
    watch.shutdown().await;
    let [offer] = <[_; 1]>::try_from(world.offers().await).unwrap();
    world.library.dismiss_processing_master(offer.id, &offer.sha256).await.unwrap();

    stack(&source, &[("IMAGETYP", "'Dark'"), ("STACKCNT", "21")]);
    let rewritten = world.library.restore_processing_master(offer.id, &offer.sha256).await;
    assert_eq!(rewritten.unwrap_err().code(), LibraryErrorCode::InvalidInput);

    fs::remove_file(&source).unwrap();
    let removed = world.library.restore_processing_master(offer.id, &offer.sha256).await;
    assert_eq!(removed.unwrap_err().code(), LibraryErrorCode::InvalidInput);

    fs::remove_dir_all(world.processing().join("WBPP/master")).unwrap();
    let folder_gone = world.library.restore_processing_master(offer.id, &offer.sha256).await;
    assert_eq!(folder_gone.unwrap_err().code(), LibraryErrorCode::InvalidInput);
    assert_eq!(world.offers().await[0].state, MasterOfferState::Dismissed);
}

/// RES-FR-06, CAL-FR-06: Clean up, Trash and Close never take anything in
/// `Output/` or a master `Processing/` offered; other tool files are theirs.
#[tokio::test]
async fn output_and_offered_masters_are_protected() {
    let world = World::new().await;
    let dark = world.processing().join("WBPP/master/masterDark_300s.fit");
    stack(&dark, &MASTER_DARK);
    let calibrated = world.processing().join("WBPP/calibrated/light_0001_c.xisf");
    write(&calibrated, b"calibrated");
    write(&world.output().join("final/HOO.tif"), b"final");
    let watch = world.watch();
    world.settled(&watch).await;
    let protection = world.library.output_protection(world.project).await.unwrap();
    assert!(protection.protects(&world.output().join("final/HOO.tif")));
    assert!(protection.protects(&world.output()));
    assert!(protection.protects(&dark));
    assert!(!protection.protects(&calibrated));
    assert!(!protection.protects(&world.folder().join(layout::VIEW_FOLDER).join("x.fit")));
    watch.shutdown().await;
}

// ── Restart ──────────────────────────────────────────────────────────────────

/// Startup: an interrupted Copy to Output finishes and is listed; files
/// settled before the restart stay Settled; files saved while the app was
/// closed are found; shutdown stops the watcher.
#[tokio::test]
async fn a_restart_finishes_copies_and_finds_what_arrived_while_closed() {
    let world = World::new().await;
    write(&world.output().join("settled.fit"), b"settled before");
    let watch = world.watch();
    world.settled(&watch).await;
    watch.shutdown().await;
    refused(&watch.rescan(world.project).await.unwrap_err(), "stopped");

    write(&world.output().join("while-closed.fit"), b"saved while the app was closed");
    let source = world.processing().join("WBPP/master/masterLight_Ha.xisf");
    write(&source, b"master");
    let source_path = source.clone();
    let evidence = tokio::task::spawn_blocking(move || {
        let fingerprint = inventory::probe_fingerprint(&source_path).unwrap();
        EntryEvidence {
            path: NativePath::from_path(&source_path),
            root: None,
            kind: EntryKind::File,
            fingerprint,
            sha256: Some(digest(&source_path)),
        }
    })
    .await
    .unwrap();
    let planned = OutputObservation {
        path: native("interrupted.xisf"),
        kind: None,
        channel: None,
        panel_group_id: None,
        state: OutputState::Settled,
        size_bytes: evidence.fingerprint.size_bytes,
        fingerprint: None,
        sha256: evidence.sha256.clone(),
        origin: OutputOrigin::Copied,
    };
    let destination = TransferDestination {
        root: NativePath::from_path(&world.folder()),
        relative: NativePath::from_path(&Path::new(layout::OUTPUT_FOLDER).join("interrupted.xisf")),
    };
    // The process stopped right after the copy was reserved and journaled.
    world
        .library
        .catalog()
        .begin_output_copy(world.project, &evidence, &destination, &planned)
        .await
        .unwrap();

    let slow = OutputWatchSettings { window: Duration::from_secs(60), ..FAST };
    let restarted = OutputWatch::start_with(&world.library, slow);
    let outputs = world.until(|outputs| outputs.len() == 3).await;
    assert_eq!(paths(&outputs), ["interrupted.xisf", "settled.fit", "while-closed.fit"]);
    assert_eq!(
        find(&outputs, "settled.fit").state,
        OutputState::Settled,
        "settled before the restart"
    );
    assert_eq!(find(&outputs, "while-closed.fit").state, OutputState::Settling);
    let interrupted = find(&outputs, "interrupted.xisf");
    assert_eq!(
        (interrupted.origin, interrupted.sha256.as_deref()),
        (OutputOrigin::Copied, Some(digest(&source).as_str()))
    );
    assert_eq!(digest(&world.output().join("interrupted.xisf")), digest(&source));
    assert!(world
        .library
        .catalog()
        .active_project_operation(world.project)
        .await
        .unwrap()
        .is_none());
    restarted.shutdown().await;
}

// ── The catalog contract ─────────────────────────────────────────────────────

/// A pass read before a Copy to Output started is stale and writes nothing;
/// the copy's own record settles before its operation.
#[tokio::test]
async fn a_pass_read_before_a_copy_started_is_stale() {
    let world = World::new().await;
    let catalog = world.library.catalog();
    let basis = catalog.output_basis(world.project).await.unwrap();
    assert!(!basis.copying);
    let source = world.processing().join("WBPP/master/masterLight_Ha.xisf");
    write(&source, b"master");
    let fingerprint = inventory::probe_fingerprint(&source).unwrap();
    let evidence = EntryEvidence {
        path: NativePath::from_path(&source),
        root: None,
        kind: EntryKind::File,
        fingerprint,
        sha256: Some(digest(&source)),
    };
    let planned = OutputObservation {
        path: native("copy.xisf"),
        kind: None,
        channel: None,
        panel_group_id: None,
        state: OutputState::Settled,
        size_bytes: evidence.fingerprint.size_bytes,
        fingerprint: None,
        sha256: evidence.sha256.clone(),
        origin: OutputOrigin::Copied,
    };
    let destination = TransferDestination {
        root: NativePath::from_path(&world.folder()),
        relative: native("Output/copy.xisf"),
    };
    let copy =
        catalog.begin_output_copy(world.project, &evidence, &destination, &planned).await.unwrap();
    let scan = persistence_library::OutputScan {
        project_id: world.project,
        copies: basis.copies,
        folder: persistence_library::OutputFolder::Absent,
    };
    assert!(matches!(
        catalog.record_output_scan(&scan).await.unwrap(),
        persistence_library::OutputScanRecord::Stale
    ));
    let error = world
        .sql(
            "UPDATE project_operations SET state = 'settled', settled_at = ?2 WHERE id = ?1",
            &[&copy.operation_id.to_string(), AT],
        )
        .await
        .unwrap_err();
    assert!(error.contains("settles its copy first"), "{error}");
    let again = catalog.begin_output_copy(world.project, &evidence, &destination, &planned).await;
    refused(&again.unwrap_err(), "Copy to Output is already running");
}
