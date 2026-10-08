// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Import (spec 071 STO-IMP-FR-01..06/08, STO-IMP-AC-01..07/09/10; LIB-FR-16,
//! LIB-AC-17 import side): the templated preview with its holds, duplicates and
//! collisions, verified Copy and Move, resume after an unmounted source, and
//! indexing as files land.

mod support;

use std::fs;
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::{Mutex, MutexGuard};
use persistence_library::SessionQuery;
use platevault_core::custody::trash::OsTrash;
use platevault_core::import::ImportCheck;
use platevault_core::library::Library;
use platevault_core::*;
use support::digest;
use uuid::Uuid;

/// Settle checks a few tens of milliseconds apart keep the suite fast; the
/// growing-file test writes faster than that.
const CHECK: ImportCheck = ImportCheck { settle_interval: Duration::from_millis(40) };

type Hook = Box<dyn Fn(&Path) + Send + Sync>;

/// A stand-in OS Trash that moves each entry into a private bin, records the
/// moves, and runs optional hooks when support is asked and after a move.
struct FakeTrash {
    support: TrashSupport,
    bin: PathBuf,
    moved: Mutex<Vec<PathBuf>>,
    on_support: Option<Hook>,
    after_move: Option<Hook>,
}

impl FakeTrash {
    fn new(bin: &Path) -> Self {
        fs::create_dir_all(bin).unwrap();
        Self {
            support: TrashSupport::Supported,
            bin: bin.to_path_buf(),
            moved: Mutex::default(),
            on_support: None,
            after_move: None,
        }
    }

    fn moved(&self) -> Vec<PathBuf> {
        self.log().clone()
    }

    fn log(&self) -> MutexGuard<'_, Vec<PathBuf>> {
        self.moved.lock()
    }
}

impl OsTrash for FakeTrash {
    fn support(&self, entry: &Path, _size_bytes: u64) -> TrashSupport {
        if let Some(hook) = &self.on_support {
            hook(entry);
        }
        self.support.clone()
    }

    fn move_to_trash(&self, entry: &Path) -> Result<(), String> {
        let count = {
            let mut moved = self.log();
            moved.push(entry.to_path_buf());
            moved.len()
        };
        fs::rename(entry, self.bin.join(count.to_string())).map_err(|e| e.to_string())?;
        if let Some(hook) = &self.after_move {
            hook(entry);
        }
        Ok(())
    }
}

fn as_dyn(trash: &Arc<FakeTrash>) -> Arc<dyn OsTrash> {
    Arc::clone(trash) as Arc<dyn OsTrash>
}

fn native(path: &Path) -> NativePath {
    NativePath::from_path(path)
}

/// `path` with each `/` read as the platform separator, as the import records
/// it (`\` on Windows).
fn rel(path: &str) -> NativePath {
    NativePath::from_path(&path.split('/').collect::<PathBuf>())
}

const CAMERA: &str = "'ZWO ASI2600MM Pro'";
const TELESCOPE: &str = "'RedCat 51'";

fn frame(path: &Path, keywords: &[(&str, &str)]) -> PathBuf {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    support::fits(path, keywords).unwrap();
    path.to_path_buf()
}

/// A 300 s light of `object` (none: no OBJECT card) through `filter`.
fn light(path: &Path, object: Option<&str>, filter: &str, start: &str) -> PathBuf {
    let object = object.map(|object| format!("'{object}'"));
    let filter = format!("'{filter}'");
    let start = format!("'{start}'");
    let mut keywords = vec![
        ("IMAGETYP", "'LIGHT'"),
        ("FILTER", filter.as_str()),
        ("EXPTIME", "300"),
        ("GAIN", "100"),
        ("DATE-OBS", start.as_str()),
        ("INSTRUME", CAMERA),
        ("TELESCOP", TELESCOPE),
    ];
    if let Some(object) = &object {
        keywords.push(("OBJECT", object.as_str()));
    }
    frame(path, &keywords)
}

fn flat(path: &Path, filter: &str, start: &str) -> PathBuf {
    let (filter, start) = (format!("'{filter}'"), format!("'{start}'"));
    frame(
        path,
        &[
            ("IMAGETYP", "'FLAT'"),
            ("FILTER", filter.as_str()),
            ("EXPTIME", "2"),
            ("DATE-OBS", start.as_str()),
            ("INSTRUME", CAMERA),
        ],
    )
}

fn dark(path: &Path, start: &str) -> PathBuf {
    let start = format!("'{start}'");
    frame(
        path,
        &[
            ("IMAGETYP", "'DARK'"),
            ("EXPTIME", "300"),
            ("DATE-OBS", start.as_str()),
            ("INSTRUME", CAMERA),
        ],
    )
}

/// A frame with no IMAGETYP card at all.
fn untyped(path: &Path, start: &str) -> PathBuf {
    let start = format!("'{start}'");
    frame(path, &[("EXPTIME", "60"), ("DATE-OBS", start.as_str()), ("INSTRUME", CAMERA)])
}

/// Every regular file below `root`, relative and sorted.
fn files_below(root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(folder) = stack.pop() {
        let Ok(entries) = fs::read_dir(&folder) else { continue };
        for entry in entries {
            let path = entry.unwrap().path();
            if path.is_dir() {
                stack.push(path);
            } else {
                found.push(path.strip_prefix(root).unwrap().to_path_buf());
            }
        }
    }
    found.sort();
    found
}

struct Fixture {
    temp: tempfile::TempDir,
    card: PathBuf,
    captures: PathBuf,
    calibration: PathBuf,
    library: Arc<Library>,
    captures_id: Uuid,
    calibration_id: Option<Uuid>,
}

impl Fixture {
    async fn new() -> Self {
        Self::with_calibration(true).await
    }

    async fn with_calibration(calibration: bool) -> Self {
        let temp = tempfile::tempdir().unwrap();
        let card = temp.path().join("share").join("card");
        let captures = temp.path().join("Astro-T7").join("Captures");
        let calibration_root = temp.path().join("Astro-T7").join("Calibration");
        for folder in [&card, &captures, &calibration_root] {
            fs::create_dir_all(folder).unwrap();
        }
        let library = Library::open(&temp.path().join("catalog.sqlite"), None).await.unwrap();
        let captures_id = library
            .register_location(
                native(&captures),
                "Astro-T7/Captures".into(),
                LocationRole::Captures,
            )
            .await
            .unwrap()
            .id;
        let calibration_id = if calibration {
            let location = library
                .register_location(
                    native(&calibration_root),
                    "Astro-T7/Calibration".into(),
                    LocationRole::Calibration,
                )
                .await
                .unwrap();
            Some(location.id)
        } else {
            None
        };
        Self {
            temp,
            card,
            captures,
            calibration: calibration_root,
            library,
            captures_id,
            calibration_id,
        }
    }

    fn trash(&self) -> Arc<FakeTrash> {
        Arc::new(FakeTrash::new(&self.temp.path().join("bin")))
    }

    async fn preview(&self) -> ImportOperation {
        self.library
            .preview_import(ImportSourceSpec::Folder { path: native(&self.card) }, CHECK)
            .await
            .unwrap()
    }

    async fn run(
        &self,
        preview: &ImportOperation,
        mode: ImportMode,
        trash: &Arc<FakeTrash>,
    ) -> ImportOperation {
        let started = self.library.start_import(preview.id, preview.revision, mode).await.unwrap();
        assert_eq!(started.state, ImportState::Running);
        self.library.run_import(started.id, as_dyn(trash)).await.unwrap()
    }

    /// Absolute destination of an item.
    fn destination(&self, item: &ImportItem) -> PathBuf {
        let root = match item.role {
            Some(LocationRole::Captures) => &self.captures,
            Some(LocationRole::Calibration) => &self.calibration,
            other => panic!("unexpected role {other:?}"),
        };
        root.join(item.destination_path.as_ref().unwrap().relative_path().unwrap())
    }
}

fn item<'a>(operation: &'a ImportOperation, relative: &str) -> &'a ImportItem {
    operation
        .items
        .iter()
        .find(|item| item.relative_path == rel(relative))
        .unwrap_or_else(|| panic!("no item {relative}"))
}

fn destination_text(item: &ImportItem) -> String {
    item.destination_path.as_ref().map(NativePath::display).unwrap_or_default()
}

fn reason_code(item: &ImportItem) -> Option<ReasonCode> {
    item.reason.as_ref().map(|reason| reason.code)
}

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

#[tokio::test]
async fn preview_routes_lights_and_calibration_with_templated_paths() {
    let fixture = Fixture::new().await;
    let card = &fixture.card;
    light(&card.join("lights/NGC7000_Ha_001.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:00:00");
    light(&card.join("lights/NGC7000_Ha_002.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:05:00");
    flat(&card.join("flats/flat_Ha_001.fits"), "Ha", "2026-04-12T21:00:00");
    dark(&card.join("darks/dark_300_001.fits"), "2026-04-12T20:00:00");
    untyped(&card.join("untyped_001.fits"), "2026-04-12T23:00:00");
    untyped(&card.join("untyped_002.fits"), "2026-04-12T23:01:00");

    let preview = fixture.preview().await;

    assert_eq!(preview.state, ImportState::Previewed);
    assert_eq!(preview.items.len(), 6, "every source frame is listed");
    for (relative, expected) in [
        ("lights/NGC7000_Ha_001.fits", "NGC7000/Ha/2026-04-12/light/NGC7000_Ha_001.fits"),
        ("lights/NGC7000_Ha_002.fits", "NGC7000/Ha/2026-04-12/light/NGC7000_Ha_002.fits"),
    ] {
        let light = item(&preview, relative);
        assert_eq!(light.phase, ImportItemPhase::Ready, "{relative}");
        assert_eq!(light.classification, Some(NamingFrameType::Light));
        assert_eq!(light.role, Some(LocationRole::Captures));
        assert_eq!(light.destination_location_id, Some(fixture.captures_id));
        assert_eq!(destination_text(light), rel(expected).display(), "lights keep their basename");
        assert!(light.fallbacks.is_empty(), "no fallback for a fully described light");
        assert_eq!(light.sha256.as_deref(), Some(digest(&card.join(relative)).as_str()));
    }
    let flat = item(&preview, "flats/flat_Ha_001.fits");
    assert_eq!(flat.phase, ImportItemPhase::Ready);
    assert_eq!(flat.classification, Some(NamingFrameType::Flat));
    assert_eq!(flat.role, Some(LocationRole::Calibration));
    assert_eq!(flat.destination_location_id, fixture.calibration_id);
    assert_eq!(destination_text(flat), rel("flats/Ha/2026-04-12/flat_Ha_001.fits").display());
    let dark = item(&preview, "darks/dark_300_001.fits");
    assert_eq!(dark.classification, Some(NamingFrameType::Dark));
    assert_eq!(dark.destination_location_id, fixture.calibration_id);
    assert_eq!(destination_text(dark), rel("darks/300/dark_300_001.fits").display());
    for relative in ["untyped_001.fits", "untyped_002.fits"] {
        let held = item(&preview, relative);
        assert_eq!(held.phase, ImportItemPhase::Unclassified, "{relative}");
        assert_eq!(held.classification, None);
        assert!(held.destination_path.is_none(), "an untyped frame has no destination");
    }

    let captures = preview
        .destinations
        .iter()
        .find(|destination| destination.location_id == fixture.captures_id)
        .unwrap();
    let light_bytes: u64 = ["lights/NGC7000_Ha_001.fits", "lights/NGC7000_Ha_002.fits"]
        .iter()
        .map(|relative| fs::metadata(card.join(relative)).unwrap().len())
        .sum();
    assert!(captures.chosen);
    assert_eq!((captures.items, captures.bytes), (2, light_bytes));
    assert!(captures.free_bytes.is_some_and(|free| free > 0), "free space is read");
    assert_eq!(captures.writability, Writability::Writable);
    let calibration = preview
        .destinations
        .iter()
        .find(|destination| Some(destination.location_id) == fixture.calibration_id)
        .unwrap();
    assert_eq!(calibration.items, 2);
    assert_eq!(calibration.writability, Writability::Writable);
    assert_eq!(preview.summary.ready, 4);
    assert_eq!(preview.summary.unclassified, 2);

    assert!(files_below(&fixture.captures).is_empty(), "the preview writes nothing");
    assert!(files_below(&fixture.calibration).is_empty(), "the preview writes nothing");
}

#[tokio::test]
async fn unclassified_held_until_typed() {
    let fixture = Fixture::new().await;
    let card = &fixture.card;
    light(&card.join("light_001.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:00:00");
    untyped(&card.join("frame_a.fits"), "2026-04-12T23:00:00");
    untyped(&card.join("frame_b.fits"), "2026-04-12T23:01:00");

    let preview = fixture.preview().await;
    let (a, b) = (item(&preview, "frame_a.fits").clone(), item(&preview, "frame_b.fits").clone());
    assert_eq!((a.phase, b.phase), (ImportItemPhase::Unclassified, ImportItemPhase::Unclassified));

    let typed = fixture
        .library
        .set_import_type(preview.id, preview.revision, a.seq, Some(NamingFrameType::Flat))
        .await
        .unwrap();
    let a = item(&typed, "frame_a.fits");
    assert_eq!(a.user_type, Some(NamingFrameType::Flat));
    assert_eq!(a.phase, ImportItemPhase::Ready, "a typed frame routes and is offered");
    assert_eq!(a.destination_location_id, fixture.calibration_id);
    assert_eq!(destination_text(a), rel("flats/nofilter/2026-04-12/frame_a.fits").display());
    assert!(
        a.fallbacks.iter().any(|fallback| fallback.token == "filter"),
        "the preview names the fallback it used"
    );
    assert_eq!(item(&typed, "frame_b.fits").phase, ImportItemPhase::Unclassified);
    let stale = fixture
        .library
        .set_import_type(preview.id, preview.revision, b.seq, Some(NamingFrameType::Dark))
        .await;
    assert!(
        matches!(stale, Err(LibraryError::Conflict { .. })),
        "a choice made against an older preview is refused"
    );

    let trash = fixture.trash();
    let done = fixture.run(&typed, ImportMode::Copy, &trash).await;

    assert_eq!(done.state, ImportState::Settled);
    assert_eq!(item(&done, "frame_a.fits").phase, ImportItemPhase::Copied);
    assert_eq!(item(&done, "frame_b.fits").phase, ImportItemPhase::Unclassified);
    assert_eq!(done.summary.imported, 2);
    assert_eq!(done.summary.unclassified, 1, "the summary lists the held frame");
    let everywhere: Vec<PathBuf> =
        [files_below(&fixture.captures), files_below(&fixture.calibration)].concat();
    assert!(
        everywhere.iter().all(|path| !path.ends_with("frame_b.fits")),
        "an untyped frame is never imported: {everywhere:?}"
    );
    let calibration =
        fixture.library.catalog().location_assets(fixture.calibration_id.unwrap()).await.unwrap();
    assert_eq!(calibration.len(), 1, "only the typed frame reaches the catalog");
    let typed = &calibration[0];
    assert_eq!(typed.observed.image_type, None, "the header bytes are untouched");
    assert_eq!(
        typed.effective.image_type.as_deref(),
        Some("Flat"),
        "the catalog holds the frame as the type the user gave it"
    );
}

#[tokio::test]
async fn growing_file_waits_to_settle() {
    let fixture = Fixture::new().await;
    let card = &fixture.card;
    light(&card.join("light_001.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:00:00");
    let growing = light(&card.join("light_002.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:05:00");
    let check = ImportCheck { settle_interval: Duration::from_millis(150) };

    let writing = Arc::new(AtomicBool::new(true));
    let writer = {
        let (writing, growing) = (Arc::clone(&writing), growing.clone());
        std::thread::spawn(move || {
            let mut file = fs::OpenOptions::new().append(true).open(&growing).unwrap();
            while writing.load(Ordering::Acquire) {
                file.write_all(&[0; 2880]).unwrap();
                file.sync_all().unwrap();
                std::thread::sleep(Duration::from_millis(10));
            }
        })
    };

    let preview = fixture
        .library
        .preview_import(ImportSourceSpec::Folder { path: native(card) }, check)
        .await
        .unwrap();
    let held = item(&preview, "light_002.fits");
    assert_eq!(held.phase, ImportItemPhase::Settling, "a file still being written waits");
    assert_eq!(held.sha256, None, "nothing about a growing file is approved");
    assert_eq!(item(&preview, "light_001.fits").phase, ImportItemPhase::Ready);
    assert_eq!(preview.summary.settling, 1);

    let still = fixture.library.recheck_import(preview.id, preview.revision, check).await.unwrap();
    assert_eq!(item(&still, "light_002.fits").phase, ImportItemPhase::Settling);

    writing.store(false, Ordering::Release);
    writer.join().unwrap();
    let settled = fixture.library.recheck_import(still.id, still.revision, check).await.unwrap();
    let offered = item(&settled, "light_002.fits");
    assert_eq!(offered.phase, ImportItemPhase::Ready, "offered once unchanged across checks");
    assert_eq!(offered.sha256.as_deref(), Some(digest(&growing).as_str()));
    assert!(files_below(&fixture.captures).is_empty());
}

#[tokio::test]
async fn sha_duplicate_skipped_incl_same_import_and_import_new() {
    let fixture = Fixture::new().await;
    let card = &fixture.card;
    // A frame already indexed in the library, never hashed by the catalog.
    let indexed = light(
        &fixture.captures.join("existing/NGC7000_Ha_000.fits"),
        Some("NGC7000"),
        "Ha",
        "2026-04-11T22:00:00",
    );
    assert_eq!(
        scan_to_end(&fixture.library, fixture.captures_id).await.state,
        ScanState::Completed
    );
    let indexed_id =
        fixture.library.catalog().location_assets(fixture.captures_id).await.unwrap()[0].id;
    fs::copy(&indexed, card.join("copy_of_000.fits")).unwrap();
    let a = light(&card.join("a.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:00:00");
    fs::copy(&a, card.join("b.fits")).unwrap();
    light(&card.join("c.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:05:00");
    let source = fixture.library.save_import_source("SD card".into(), native(card)).await.unwrap();

    let first = fixture
        .library
        .preview_import(ImportSourceSpec::Saved { id: source.id }, CHECK)
        .await
        .unwrap();
    assert_eq!(first.source_id, Some(source.id));
    assert_eq!(
        item(&first, "copy_of_000.fits").duplicate,
        Some(ImportDuplicate::IndexedFrame { asset_id: indexed_id }),
        "a file matching an indexed frame is skipped"
    );
    assert_eq!(item(&first, "copy_of_000.fits").phase, ImportItemPhase::Duplicate);
    let a_seq = item(&first, "a.fits").seq;
    assert_eq!(item(&first, "a.fits").phase, ImportItemPhase::Ready);
    assert_eq!(
        item(&first, "b.fits").duplicate,
        Some(ImportDuplicate::SameImport { seq: a_seq, source_path: native(&a) }),
        "only the first copy within an import is imported"
    );
    assert_eq!(first.summary.duplicates, 2);

    let trash = fixture.trash();
    let done = fixture.run(&first, ImportMode::Copy, &trash).await;
    assert_eq!(done.state, ImportState::Settled);
    assert_eq!(done.summary.imported, 2, "a and c");
    assert_eq!(done.summary.duplicates, 2);
    let sources = fixture.library.import_sources().await.unwrap();
    assert!(sources[0].source.last_imported_at.is_some(), "the source records its import");

    // New frames, and an earlier frame copied back under a new name.
    light(&card.join("d.fits"), Some("NGC7000"), "Ha", "2026-04-13T22:00:00");
    light(&card.join("e.fits"), Some("NGC7000"), "Ha", "2026-04-13T22:05:00");
    fs::copy(&a, card.join("a_again.fits")).unwrap();
    let again = fixture
        .library
        .preview_import(ImportSourceSpec::Saved { id: source.id }, CHECK)
        .await
        .unwrap();
    for relative in ["a.fits", "b.fits", "c.fits", "a_again.fits"] {
        assert_eq!(
            item(&again, relative).duplicate,
            Some(ImportDuplicate::SameSource { operation_id: first.id }),
            "{relative} was already imported from this source"
        );
    }
    assert_eq!(item(&again, "d.fits").phase, ImportItemPhase::Ready);
    assert_eq!(item(&again, "e.fits").phase, ImportItemPhase::Ready);

    let done = fixture.run(&again, ImportMode::Copy, &trash).await;
    assert_eq!(done.summary.imported, 2, "Import new imports only the new frames");
    assert_eq!(done.summary.duplicates, 5);
    let copies_of_a = files_below(&fixture.captures)
        .iter()
        .filter(|path| digest(&fixture.captures.join(path)) == digest(&a))
        .count();
    assert_eq!(copies_of_a, 1, "no second copy is created");
}

#[tokio::test]
async fn collision_with_different_bytes_blocks_item() {
    let fixture = Fixture::new().await;
    let card = &fixture.card;
    let one = light(&card.join("light_001.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:00:00");
    let two = light(&card.join("light_002.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:05:00");
    light(&card.join("light_003.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:10:00");
    let folder =
        fixture.captures.join("NGC7000/Ha/2026-04-12/light".split('/').collect::<PathBuf>());
    fs::create_dir_all(&folder).unwrap();
    let occupant = folder.join("light_001.fits");
    fs::write(&occupant, b"a different frame that happens to share the name").unwrap();
    let occupant_digest = digest(&occupant);
    fs::copy(&two, folder.join("light_002.fits")).unwrap();

    let preview = fixture.preview().await;
    let blocked = item(&preview, "light_001.fits");
    assert_eq!(blocked.phase, ImportItemPhase::Blocked);
    assert_eq!(blocked.block, Some(ImportBlock::Collision { path: native(&occupant) }));
    let same = item(&preview, "light_002.fits");
    assert_eq!(same.phase, ImportItemPhase::Duplicate, "identical bytes are a duplicate");
    assert!(matches!(same.duplicate, Some(ImportDuplicate::AtDestination { .. })));
    assert_eq!(item(&preview, "light_003.fits").phase, ImportItemPhase::Ready);

    let left_out = fixture
        .library
        .set_import_excluded(preview.id, preview.revision, blocked.seq, true)
        .await
        .unwrap();
    assert_eq!(item(&left_out, "light_001.fits").phase, ImportItemPhase::Excluded);
    let trash = fixture.trash();
    let done = fixture.run(&left_out, ImportMode::Copy, &trash).await;
    assert_eq!(item(&done, "light_003.fits").phase, ImportItemPhase::Copied, "others proceed");
    assert_eq!(item(&done, "light_001.fits").phase, ImportItemPhase::Excluded);
    assert_eq!(digest(&occupant), occupant_digest, "PlateVault never overwrites the file");

    // A changed template routes the blocked frame somewhere free.
    fixture
        .library
        .save_naming_template(NamingFrameType::Light, "{target}/{date}/{filter}/")
        .await
        .unwrap();
    let moved_on = fixture.preview().await;
    let free = item(&moved_on, "light_001.fits");
    assert_eq!(free.phase, ImportItemPhase::Ready);
    assert_eq!(destination_text(free), rel("NGC7000/2026-04-12/Ha/light_001.fits").display());
    assert_eq!(digest(&one), free.sha256.clone().unwrap());
}

#[tokio::test]
async fn copy_verifies_and_leaves_source() {
    let fixture = Fixture::new().await;
    let card = &fixture.card;
    let sources = [
        light(&card.join("light_001.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:00:00"),
        light(&card.join("light_002.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:05:00"),
        flat(&card.join("flat_001.fits"), "Ha", "2026-04-12T21:00:00"),
    ];
    let before: Vec<String> = sources.iter().map(|source| digest(source)).collect();

    let preview = fixture.preview().await;
    let trash = fixture.trash();
    let done = fixture.run(&preview, ImportMode::Copy, &trash).await;

    assert_eq!(done.state, ImportState::Settled);
    assert_eq!(done.mode, Some(ImportMode::Copy));
    for (source, digest_before) in sources.iter().zip(&before) {
        let relative = source.file_name().unwrap().to_str().unwrap();
        let copied = item(&done, relative);
        assert_eq!(copied.phase, ImportItemPhase::Copied, "{relative}");
        assert!(copied.landed);
        assert_eq!(copied.sha256.as_ref(), Some(digest_before));
        assert_eq!(&digest(&fixture.destination(copied)), digest_before, "re-read matches");
        assert_eq!(&digest(source), digest_before, "the source is unchanged");
    }
    assert!(trash.moved().is_empty(), "Copy never asks the OS Trash for anything");
    assert_eq!(done.summary.imported, 3);
    assert_eq!(done.summary.sources_trashed, 0);
}

#[tokio::test]
async fn move_trashes_source_only_after_verify_and_reverify() {
    let fixture = Fixture::new().await;
    let card = fixture.card.clone();
    let sources = [
        light(&card.join("light_001.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:00:00"),
        light(&card.join("light_002.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:05:00"),
        light(&card.join("light_003.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:10:00"),
    ];
    let snapshot: Vec<String> = sources.iter().map(|source| digest(source)).collect();
    let preview = fixture.preview().await;
    let destinations: Vec<(PathBuf, PathBuf)> = sources
        .iter()
        .map(|source| {
            let relative = source.file_name().unwrap().to_str().unwrap();
            (source.clone(), fixture.destination(item(&preview, relative)))
        })
        .collect();

    // A tool rewrites light_002 in place, keeping its size and modification
    // time, after its copy verified and right before its source would move.
    let drifting = sources[1].clone();
    let verified_at_move = Arc::new(Mutex::new(Vec::new()));
    let mut trash = FakeTrash::new(&fixture.temp.path().join("bin"));
    trash.on_support = Some(Box::new(move |entry| {
        if entry == drifting {
            let modified = fs::metadata(entry).unwrap().modified().unwrap();
            let mut file = fs::OpenOptions::new().write(true).open(entry).unwrap();
            file.seek(SeekFrom::Start(2880)).unwrap();
            file.write_all(&[7; 16]).unwrap();
            file.set_modified(modified).unwrap();
            file.sync_all().unwrap();
        }
    }));
    {
        let (log, destinations, snapshot) =
            (Arc::clone(&verified_at_move), destinations.clone(), snapshot.clone());
        trash.after_move = Some(Box::new(move |entry| {
            let index = destinations.iter().position(|(source, _)| source == entry).unwrap();
            let destination = &destinations[index].1;
            log.lock().push(destination.exists() && digest(destination) == snapshot[index]);
        }));
    }
    let trash = Arc::new(trash);

    let done = fixture.run(&preview, ImportMode::Move, &trash).await;

    assert_eq!(done.state, ImportState::Settled);
    assert_eq!(item(&done, "light_001.fits").phase, ImportItemPhase::Moved);
    assert_eq!(item(&done, "light_003.fits").phase, ImportItemPhase::Moved);
    let kept = item(&done, "light_002.fits");
    assert_eq!(kept.phase, ImportItemPhase::SourceKept, "a drifted source is kept");
    assert_eq!(reason_code(kept), Some(ReasonCode::SourceDrift), "and the item is named");
    assert!(sources[1].exists(), "the drifted source stays in place");
    assert_ne!(digest(&sources[1]), snapshot[1]);
    assert_eq!(digest(&destinations[1].1), snapshot[1], "both versions are kept");
    assert_eq!(trash.moved(), vec![sources[0].clone(), sources[2].clone()]);
    assert_eq!(
        *verified_at_move.lock(),
        vec![true, true],
        "each source left only once its destination held the verified snapshot"
    );
    assert!(!sources[0].exists() && !sources[2].exists());
    assert_eq!(done.summary.sources_trashed, 2);
    assert_eq!(done.summary.sources_kept, 1);
    assert_eq!(done.summary.failed_verification, 1);
}

#[tokio::test]
async fn no_trash_volume_reports_copied_source_kept() {
    let fixture = Fixture::new().await;
    let card = &fixture.card;
    let sources = [
        light(&card.join("light_001.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:00:00"),
        light(&card.join("light_002.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:05:00"),
    ];
    let mut trash = FakeTrash::new(&fixture.temp.path().join("bin"));
    trash.support = TrashSupport::Unsupported {
        reason: TrashUnsupported::DeletesImmediately,
        detail: "the smbfs network volume has no Trash: macOS deletes items there immediately"
            .into(),
    };
    let trash = Arc::new(trash);

    let preview = fixture.preview().await;
    let done = fixture.run(&preview, ImportMode::Move, &trash).await;

    assert_eq!(done.state, ImportState::Settled);
    for source in &sources {
        let relative = source.file_name().unwrap().to_str().unwrap();
        let kept = item(&done, relative);
        assert_eq!(kept.phase, ImportItemPhase::SourceKept, "copied, source kept");
        assert_eq!(reason_code(kept), Some(ReasonCode::TrashUnsupported));
        assert!(kept.landed);
        assert_eq!(digest(&fixture.destination(kept)), digest(source));
        assert!(source.exists(), "nothing is permanently deleted");
    }
    assert!(trash.moved().is_empty());
    assert_eq!(done.summary.sources_kept, 2);
    assert_eq!(done.summary.sources_trashed, 0);
    assert_eq!(done.summary.imported, 2);
}

#[cfg(unix)]
fn inode(path: &Path) -> u64 {
    use std::os::unix::fs::MetadataExt;
    fs::metadata(path).unwrap().ino()
}

#[cfg(unix)]
#[tokio::test]
async fn network_source_unmount_resumes() {
    let fixture = Fixture::new().await;
    let card = fixture.card.clone();
    let sources = [
        light(&card.join("light_001.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:00:00"),
        light(&card.join("light_002.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:05:00"),
        light(&card.join("light_003.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:10:00"),
    ];
    let unmounted = fixture.temp.path().join("share").join("card (unmounted)");
    let mut trash = FakeTrash::new(&fixture.temp.path().join("bin"));
    {
        // The share drops right after the first source reached the OS Trash.
        let (card, unmounted) = (card.clone(), unmounted.clone());
        let dropped = AtomicBool::new(false);
        trash.after_move = Some(Box::new(move |_| {
            if !dropped.swap(true, Ordering::AcqRel) {
                fs::rename(&card, &unmounted).unwrap();
            }
        }));
    }
    let trash = Arc::new(trash);
    let preview = fixture.preview().await;

    let interrupted = fixture.run(&preview, ImportMode::Move, &trash).await;

    assert_eq!(interrupted.state, ImportState::Interrupted);
    assert_eq!(interrupted.source_availability, Availability::Offline);
    let first = item(&interrupted, "light_001.fits");
    assert_eq!(first.phase, ImportItemPhase::Moved, "a verified item keeps its state");
    let first_destination = fixture.destination(first);
    let first_inode = inode(&first_destination);
    for relative in ["light_002.fits", "light_003.fits"] {
        assert_eq!(item(&interrupted, relative).phase, ImportItemPhase::Pending, "{relative}");
    }
    assert_eq!(trash.moved(), vec![sources[0].clone()], "no unverified source is trashed");
    assert_eq!(interrupted.summary.pending, 2);

    fs::rename(&unmounted, &card).unwrap();
    let resumed = fixture.library.run_import(interrupted.id, as_dyn(&trash)).await.unwrap();

    assert_eq!(resumed.state, ImportState::Settled);
    assert_eq!(resumed.source_availability, Availability::Available);
    for relative in ["light_001.fits", "light_002.fits", "light_003.fits"] {
        assert_eq!(item(&resumed, relative).phase, ImportItemPhase::Moved, "{relative}");
    }
    assert_eq!(inode(&first_destination), first_inode, "a verified item is not copied again");
    assert_eq!(trash.moved(), sources.to_vec());
    let landed = files_below(&fixture.captures);
    assert_eq!(landed.len(), 3, "one copy each and no partial copy left behind: {landed:?}");
}

#[tokio::test]
async fn imported_lights_appear_in_sessions_without_inbox() {
    let fixture = Fixture::new().await;
    let card = &fixture.card;
    light(&card.join("NGC7000_001.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:00:00");
    light(&card.join("NGC7000_002.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:05:00");
    light(&card.join("mystery_001.fits"), None, "OIII", "2026-04-12T23:00:00");
    light(&card.join("mystery_002.fits"), None, "OIII", "2026-04-12T23:05:00");
    flat(&card.join("flat_001.fits"), "Ha", "2026-04-12T21:00:00");
    dark(&card.join("dark_001.fits"), "2026-04-12T20:00:00");

    let preview = fixture.preview().await;
    let mystery = item(&preview, "mystery_001.fits");
    assert_eq!(
        destination_text(mystery),
        rel("unclassified/OIII/2026-04-12/light/mystery_001.fits").display()
    );
    assert_eq!(
        mystery.fallbacks,
        vec![NamingFallback { token: "target".into(), value: "unclassified".into() }],
        "the preview names the fallback"
    );

    let trash = fixture.trash();
    let done = fixture.run(&preview, ImportMode::Copy, &trash).await;

    assert_eq!(done.state, ImportState::Settled);
    assert!(done.items.iter().all(|item| item.indexed), "indexed as landed: {:?}", done.items);
    let sessions = fixture.library.catalog().list_sessions(&SessionQuery::default()).await.unwrap();
    assert_eq!(sessions.len(), 2, "the lights appear in Sessions with no confirm step");
    assert_eq!(sessions.iter().map(|summary| summary.asset_count).sum::<u64>(), 4);
    assert!(sessions.iter().all(|summary| summary.location_ids == vec![fixture.captures_id]));
    let calibration =
        fixture.library.catalog().location_assets(fixture.calibration_id.unwrap()).await.unwrap();
    assert_eq!(calibration.len(), 2, "calibration frames land in the Calibration library");
    let mut mystery_session = None;
    for summary in &sessions {
        let detail = fixture.library.catalog().session(summary.session.id).await.unwrap();
        assert!(
            detail.assets.iter().all(|asset| calibration.iter().all(|frame| frame.id != asset.id)),
            "no calibration frame appears in Sessions"
        );
        if detail.assets.iter().all(|asset| asset.effective.object.is_none()) {
            mystery_session = Some(summary.session.id);
        }
    }
    let mystery_session = mystery_session.expect("a session holds the lights with no OBJECT");
    let associations = fixture.library.catalog().associations(mystery_session).await.unwrap();
    assert!(
        !associations.iter().any(|association| association.kind == AssociationKind::Target
            && association.state == AssociationState::Confirmed),
        "import confirms no Target: the session needs one"
    );
}

#[tokio::test]
async fn missing_calibration_role_blocks_only_calibration_items() {
    let fixture = Fixture::with_calibration(false).await;
    let card = &fixture.card;
    light(&card.join("light_001.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:00:00");
    light(&card.join("light_002.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:05:00");
    flat(&card.join("flat_001.fits"), "Ha", "2026-04-12T21:00:00");
    dark(&card.join("dark_001.fits"), "2026-04-12T20:00:00");

    let preview = fixture.preview().await;
    for relative in ["flat_001.fits", "dark_001.fits"] {
        let held = item(&preview, relative);
        assert_eq!(held.phase, ImportItemPhase::Blocked, "{relative}");
        assert_eq!(held.block, Some(ImportBlock::MissingRole { role: LocationRole::Calibration }));
    }
    for relative in ["light_001.fits", "light_002.fits"] {
        assert_eq!(item(&preview, relative).phase, ImportItemPhase::Ready, "{relative}");
    }

    let trash = fixture.trash();
    let done = fixture.run(&preview, ImportMode::Copy, &trash).await;
    assert_eq!(done.state, ImportState::Settled);
    assert_eq!(done.summary.imported, 2, "the lights import");
    assert_eq!(done.summary.blocked, 2, "only the calibration items are held");
    assert_eq!(item(&done, "flat_001.fits").phase, ImportItemPhase::Blocked);
}

#[tokio::test]
async fn unknown_filter_prompt_holds_nothing_back() {
    let fixture = Fixture::new().await;
    // An indexed session from this camera and telescope, confirmed to RedCat.
    light(
        &fixture.captures.join("earlier/NGC7000_OIII_000.fits"),
        Some("NGC7000"),
        "OIII",
        "2026-04-01T22:00:00",
    );
    assert_eq!(
        scan_to_end(&fixture.library, fixture.captures_id).await.state,
        ScanState::Completed
    );
    let redcat = fixture
        .library
        .catalog()
        .save_equipment(
            &Equipment {
                id: Uuid::new_v4(),
                name: "RedCat".into(),
                camera: Some("ZWO ASI2600MM Pro".into()),
                telescope: Some("RedCat 51".into()),
                focal_length_mm: Some(250.0),
                pixel_size_um: Some(3.76),
                sensor_width_px: Some(6248),
                sensor_height_px: Some(4176),
                color_kind: Some(ColorKind::Mono),
                decision_revision: 0,
                state: AssociationState::Confirmed,
                provenance: Provenance::User,
            },
            None,
        )
        .await
        .unwrap();
    let oiii = RigFilter {
        id: Uuid::new_v4(),
        name: "OIII".into(),
        match_values: vec!["OIII".into()],
        bands: vec![Band::Oiii],
    };
    let listed = fixture.library.save_rig_filters(redcat.id, &[oiii], 0).await.unwrap();
    let sessions = fixture.library.catalog().list_sessions(&SessionQuery::default()).await.unwrap();
    let session = &sessions[0].session;
    let expected = ExpectedSession {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        decision_revision: session.decision_revision,
    };
    fixture.library.catalog().confirm_equipment(&[expected], redcat.id).await.unwrap();
    let card = &fixture.card;
    light(&card.join("Ha_001.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:00:00");
    light(&card.join("OIII_001.fits"), Some("NGC7000"), "OIII", "2026-04-12T23:00:00");

    let preview = fixture.preview().await;

    let unknown = item(&preview, "Ha_001.fits");
    assert_eq!(unknown.rig, Some(ImportRig { equipment_id: redcat.id, name: "RedCat".into() }));
    assert_eq!(
        unknown.unknown_filter,
        Some(UnknownFilter {
            equipment_id: redcat.id,
            rig_name: "RedCat".into(),
            value: "Ha".into(),
        }),
        "the preview offers Add Ha to RedCat"
    );
    assert_eq!(unknown.phase, ImportItemPhase::Ready, "the prompt holds nothing back");
    let known = item(&preview, "OIII_001.fits");
    assert_eq!(known.unknown_filter, None);
    assert_eq!(known.phase, ImportItemPhase::Ready);
    assert_eq!(
        fixture.library.rig(redcat.id).await.unwrap().filters,
        listed.filters,
        "previewing changes no rig"
    );
}

#[tokio::test]
async fn untyped_master_names_held_unclassified() {
    let fixture = Fixture::new().await;
    let card = &fixture.card;
    untyped(&card.join("masterDark_300s.fits"), "2026-04-12T23:00:00");
    frame(
        &card.join("darks/stack_001.fits"),
        &[
            ("NCOMBINE", "20"),
            ("EXPTIME", "300"),
            ("DATE-OBS", "'2026-04-12T23:05:00'"),
            ("INSTRUME", CAMERA),
        ],
    );

    let preview = fixture.preview().await;

    for relative in ["masterDark_300s.fits", "darks/stack_001.fits"] {
        let held = item(&preview, relative);
        assert_eq!(
            (held.classification, held.phase),
            (None, ImportItemPhase::Unclassified),
            "{relative}: a name never stands in for a frame-type header"
        );
        assert_eq!(held.destination_location_id, None, "{relative}");
    }
}

/// Put a different, empty folder at `folder`'s path: the path still resolves
/// to a folder, but not the one recorded. Returns where the original went.
fn replace_folder(folder: &Path) -> PathBuf {
    let original = folder.with_extension("original");
    fs::rename(folder, &original).unwrap();
    fs::create_dir(folder).unwrap();
    original
}

fn restore_folder(folder: &Path, original: &Path) {
    fs::remove_dir_all(folder).unwrap();
    fs::rename(original, folder).unwrap();
}

#[tokio::test]
async fn replaced_destination_folder_interrupts_with_nothing_written() {
    let fixture = Fixture::new().await;
    let card = &fixture.card;
    let sources = [
        light(&card.join("light_001.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:00:00"),
        light(&card.join("light_002.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:05:00"),
    ];
    let preview = fixture.preview().await;
    let started =
        fixture.library.start_import(preview.id, preview.revision, ImportMode::Move).await.unwrap();
    let original = replace_folder(&fixture.captures);
    let trash = fixture.trash();

    let outcome = fixture.library.run_import(started.id, as_dyn(&trash)).await;

    assert!(trash.moved().is_empty(), "no source is trashed");
    let written = files_below(&fixture.captures);
    assert!(written.is_empty(), "nothing is written into the other folder: {written:?}");
    let interrupted = outcome.unwrap();
    assert_eq!(interrupted.state, ImportState::Interrupted);
    for relative in ["light_001.fits", "light_002.fits"] {
        assert_eq!(item(&interrupted, relative).phase, ImportItemPhase::Pending, "{relative}");
    }
    assert!(sources.iter().all(|source| source.exists()), "every source stays in place");

    restore_folder(&fixture.captures, &original);
    let resumed = fixture.library.run_import(interrupted.id, as_dyn(&trash)).await.unwrap();

    assert_eq!(resumed.state, ImportState::Settled);
    for relative in ["light_001.fits", "light_002.fits"] {
        assert_eq!(item(&resumed, relative).phase, ImportItemPhase::Moved, "{relative}");
    }
    assert_eq!(files_below(&fixture.captures).len(), 2);
}

#[tokio::test]
async fn replaced_source_folder_interrupts_until_it_returns() {
    let fixture = Fixture::new().await;
    let card = &fixture.card;
    let sources = [
        light(&card.join("light_001.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:00:00"),
        light(&card.join("light_002.fits"), Some("NGC7000"), "Ha", "2026-04-12T22:05:00"),
    ];
    let preview = fixture.preview().await;
    let started =
        fixture.library.start_import(preview.id, preview.revision, ImportMode::Move).await.unwrap();
    let original = replace_folder(card);
    let trash = fixture.trash();

    let outcome = fixture.library.run_import(started.id, as_dyn(&trash)).await;

    assert!(trash.moved().is_empty(), "no source is trashed");
    assert!(files_below(&fixture.captures).is_empty(), "nothing is copied");
    let interrupted = outcome.unwrap();
    assert_eq!(interrupted.state, ImportState::Interrupted);
    assert_ne!(
        interrupted.source_availability,
        Availability::Available,
        "another folder at the source path is not the previewed source"
    );
    for relative in ["light_001.fits", "light_002.fits"] {
        assert_eq!(item(&interrupted, relative).phase, ImportItemPhase::Pending, "{relative}");
    }

    restore_folder(card, &original);
    let resumed = fixture.library.run_import(interrupted.id, as_dyn(&trash)).await.unwrap();

    assert_eq!(resumed.state, ImportState::Settled);
    assert_eq!(resumed.source_availability, Availability::Available);
    for relative in ["light_001.fits", "light_002.fits"] {
        assert_eq!(item(&resumed, relative).phase, ImportItemPhase::Moved, "{relative}");
    }
    assert_eq!(trash.moved(), sources.to_vec());
}

#[tokio::test]
async fn destination_offline_before_indexing_interrupts_until_indexed() {
    let fixture = Fixture::new().await;
    untyped(&fixture.card.join("frame_a.fits"), "2026-04-12T23:00:00");
    let unmounted = fixture.calibration.with_extension("unmounted");
    let mut trash = FakeTrash::new(&fixture.temp.path().join("bin"));
    {
        // The Calibration volume drops right after the last source reached the
        // OS Trash, before its landed copy is indexed.
        let (calibration, unmounted) = (fixture.calibration.clone(), unmounted.clone());
        trash.after_move = Some(Box::new(move |_| fs::rename(&calibration, &unmounted).unwrap()));
    }
    let trash = Arc::new(trash);
    let preview = fixture.preview().await;
    let seq = item(&preview, "frame_a.fits").seq;
    let typed = fixture
        .library
        .set_import_type(preview.id, preview.revision, seq, Some(NamingFrameType::Flat))
        .await
        .unwrap();

    let interrupted = fixture.run(&typed, ImportMode::Move, &trash).await;

    assert_eq!(interrupted.state, ImportState::Interrupted, "the landed copy is not indexed yet");
    let moved = item(&interrupted, "frame_a.fits");
    assert_eq!(moved.phase, ImportItemPhase::Moved, "a verified item keeps its state");
    assert!(!moved.indexed);

    fs::rename(&unmounted, &fixture.calibration).unwrap();
    let resumed = fixture.library.run_import(interrupted.id, as_dyn(&trash)).await.unwrap();

    assert_eq!(resumed.state, ImportState::Settled);
    assert!(item(&resumed, "frame_a.fits").indexed, "Retry indexes the landed copy");
    let calibration =
        fixture.library.catalog().location_assets(fixture.calibration_id.unwrap()).await.unwrap();
    assert_eq!(calibration.len(), 1);
    assert_eq!(
        calibration[0].effective.image_type.as_deref(),
        Some("Flat"),
        "the type the user set is recorded"
    );
}
