// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! F4 Apply's final gate and its walkers (spec 066 VSEL-FR-14/20,
//! VSEL-AC-28, 069 PREP-FR-09, 071 STO-FR-04/05/16, plan §3;
//! astro-plan-yb133): the gate re-reads every built copy, the swap re-reads
//! the catalog, the sheet hashes every copy it reports unchanged, and no
//! walk follows a linked root or leaves out an entry it couldn't read.

#[path = "support/apply.rs"]
mod apply_support;
#[path = "support/cleanup.rs"]
mod cleanup_support;

use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::SystemTime;

use apply_support::{digest, file_node, link_folder, world, World, HA};
use cleanup_support::ScopedTrash;
use platevault_core::apply::{ApplyControl, Unattended};
use platevault_core::*;

/// Rewrite `path` in place, as a tool editing it would: same file, same
/// size, one byte flipped and its modification time put back to `modified`.
fn rewrite_in_place(path: &Path, modified: SystemTime) {
    let mut bytes = fs::read(path).unwrap();
    let last = bytes.len() - 1;
    bytes[last] ^= 0xff;
    let before = (file_node(path), fs::metadata(path).unwrap().len());
    fs::write(path, &bytes).unwrap();
    fs::File::options().write(true).open(path).unwrap().set_modified(modified).unwrap();
    assert_eq!(
        (file_node(path), fs::metadata(path).unwrap().len()),
        before,
        "the rewrite keeps the file and its size"
    );
}

/// The View entry placed for the light at `relative`.
fn placed(world: &World, relative: &str) -> PathBuf {
    let name = Path::new(relative).file_name().unwrap().to_string_lossy().into_owned();
    let found = World::tree(&world.view());
    let entry = found.iter().find(|path| path.ends_with(&format!("/{name}"))).unwrap();
    world.view().join(entry)
}

/// The first regular file below `root`, never following a link.
fn first_file(root: &Path) -> Option<PathBuf> {
    let mut folders = vec![root.to_path_buf()];
    while let Some(folder) = folders.pop() {
        for entry in fs::read_dir(&folder).ok()?.flatten() {
            let kind = entry.file_type().unwrap();
            if kind.is_dir() {
                folders.push(entry.path());
            } else if kind.is_file() {
                return Some(entry.path());
            }
        }
    }
    None
}

/// Rewrites the first copy the build placed, in place, before the build
/// places its next entry.
struct RewriteBuiltCopy {
    building: PathBuf,
    rewritten: std::sync::Mutex<Option<PathBuf>>,
}

impl ApplyControl for RewriteBuiltCopy {
    fn canceled(&self) -> bool {
        let mut rewritten = self.rewritten.lock().unwrap();
        if rewritten.is_none() {
            if let Some(copy) = first_file(&self.building) {
                let modified = fs::metadata(&copy).unwrap().modified().unwrap();
                rewrite_in_place(&copy, modified);
                *rewritten = Some(copy);
            }
        }
        false
    }
}

/// C1, PREP-FR-09: a built copy rewritten in place keeps its identity, but
/// the final gate re-reads its bytes, so Apply fails before the swap and the
/// old View stays.
#[tokio::test]
async fn an_in_place_rewrite_of_a_built_copy_fails_apply_before_the_swap() {
    let world = world(ViewMode::Copies).await;
    world.apply().await;
    let before = World::tree(&world.view());
    let kept = digest(&placed(&world, HA[0]));
    world.bump().await;
    let preview = world.preview().await;
    assert!(preview.blockers.is_empty(), "{:#?}", preview.blockers);

    let control =
        RewriteBuiltCopy { building: world.building(), rewritten: std::sync::Mutex::default() };
    let report = world.library.apply(&World::request(&preview), &control).await.unwrap();
    let rewritten = control.rewritten.lock().unwrap().clone().expect("a built copy was rewritten");
    assert_eq!(report.outcome, Some(ApplyOutcome::Failed), "{report:#?}");
    let relative = rewritten.strip_prefix(world.building()).unwrap();
    assert!(
        report.failures.iter().any(|failure| {
            failure.path.relative_path().is_ok_and(|path| path == relative)
                && failure.reason.code == ReasonCode::DestinationMismatch
        }),
        "the rewritten copy is named: {report:#?}"
    );
    assert_eq!(World::tree(&world.view()), before, "the old View stays");
    assert_eq!(digest(&placed(&world, HA[0])), kept);
    assert!(!world.previous().exists());
}

/// C9, VSEL-FR-14, VSEL-AC-28: a same-size edit of a copy whose time is put
/// back is listed as changed; an equal time is no proof of equal bytes.
#[tokio::test]
async fn a_same_size_copy_edit_with_its_time_restored_is_listed_as_changed() {
    let world = world(ViewMode::Copies).await;
    let applied = world.apply().await;
    let copy = placed(&world, HA[0]);
    let relative = copy.strip_prefix(world.view()).unwrap().to_path_buf();
    assert_eq!(world.preview().await.changed_copies, []);
    // The edit puts back the very time the sheet compares: its original's,
    // as the manifest recorded it.
    let manifest = world.catalog().view_manifest(world.project, applied.generation).await.unwrap();
    let entry = manifest
        .entries
        .iter()
        .find(|entry| entry.path.relative_path().is_ok_and(|path| path == relative))
        .unwrap();
    let nanos = u64::try_from(entry.source_fingerprint.modified_ns).unwrap();
    rewrite_in_place(&copy, SystemTime::UNIX_EPOCH + std::time::Duration::from_nanos(nanos));
    let probed = fs::metadata(&copy).unwrap().modified().unwrap();
    assert_eq!(probed, SystemTime::UNIX_EPOCH + std::time::Duration::from_nanos(nanos));

    let preview = world.preview().await;
    let changed: Vec<PathBuf> =
        preview.changed_copies.iter().filter_map(|path| path.relative_path().ok()).collect();
    assert_eq!(changed, std::slice::from_ref(&relative), "{preview:#?}");
}

/// What one test commits while the build runs.
enum Edit {
    /// A desired-state edit of the Project.
    Project,
    /// A Library review rejecting a held session.
    Review(Box<Session>),
}

/// Commits `edit` once the building folder is made, before any entry is
/// placed, then lets the build run on.
struct EditDuringBuild<'a> {
    world: &'a World,
    edit: Edit,
    done: AtomicBool,
}

impl ApplyControl for EditDuringBuild<'_> {
    fn interrupted(&self, phase: ApplyPhase) -> bool {
        if phase == ApplyPhase::Building && !self.done.swap(true, Ordering::SeqCst) {
            tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current().block_on(async {
                    match &self.edit {
                        Edit::Project => self.world.bump().await,
                        Edit::Review(session) => {
                            self.world.mark(session, Quality::Unusable).await;
                        }
                    }
                });
            });
        }
        false
    }
}

async fn edited_during_the_build(review: bool) {
    let world = world(ViewMode::Copies).await;
    world.apply().await;
    let edit = if review {
        Edit::Review(Box::new(world.session_of(&world.captures, HA[0]).await))
    } else {
        Edit::Project
    };
    let before = World::tree(&world.view());
    let kept = digest(&placed(&world, HA[0]));
    world.bump().await;
    let preview = world.preview().await;
    assert!(preview.blockers.is_empty(), "{:#?}", preview.blockers);

    let control = EditDuringBuild { world: &world, edit, done: AtomicBool::new(false) };
    let report = world.library.apply(&World::request(&preview), &control).await.unwrap();
    assert!(control.done.load(Ordering::SeqCst), "the edit was committed during the build");
    assert_eq!(report.outcome, Some(ApplyOutcome::Failed), "{report:#?}");
    assert!(report.failures.is_empty(), "every file verified; the catalog moved: {report:#?}");
    assert_eq!(report.stop, Some(ApplyStop::CatalogMoved), "{report:#?}");
    assert_eq!(World::tree(&world.view()), before, "the old View stays");
    assert_eq!(digest(&placed(&world, HA[0])), kept);
    assert!(!world.previous().exists());
    let journal = world.journal(report.operation_id).await;
    assert_eq!(journal.settled_from, Some(ApplyPhase::BuildVerified), "{journal:#?}");
    assert_ne!(world.preview().await.basis_digest, preview.basis_digest);
}

/// PS2, plan §3: a Project edit committed during the build fails Apply
/// before the swap, with the old View intact.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_project_edit_during_the_build_fails_apply_before_the_swap() {
    edited_during_the_build(false).await;
}

/// PS2, plan §3: a Library review committed during the build fails Apply
/// before the swap, with the old View intact.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_review_during_the_build_fails_apply_before_the_swap() {
    edited_during_the_build(true).await;
}

/// Reopens a held session's review once Apply reserved the Project, before
/// it reads the catalog again: a readiness change the basis doesn't carry.
struct ReopenOnReserve<'a> {
    world: &'a World,
    session: uuid::Uuid,
    done: AtomicBool,
}

impl ApplyControl for ReopenOnReserve<'_> {
    fn reserved(&self, _operation_id: uuid::Uuid) {
        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                self.world.catalog().reopen_session_review(self.session).await.unwrap();
            });
        });
        self.done.store(true, Ordering::SeqCst);
    }
}

/// 5u6x7 (6), FR-034 (D-W100): a held session that stops being Ready
/// between the reservation and the catalog's second read fails Apply
/// before the swap, with the old View intact.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_readiness_change_after_the_reservation_fails_apply_before_the_swap() {
    let world = world(ViewMode::Copies).await;
    world.apply().await;
    let before = World::tree(&world.view());
    world.bump().await;
    let preview = world.preview().await;
    assert!(preview.blockers.is_empty(), "{:#?}", preview.blockers);
    let session = world.session_of(&world.captures, HA[0]).await.id;

    let control = ReopenOnReserve { world: &world, session, done: AtomicBool::new(false) };
    let report = world.library.apply(&World::request(&preview), &control).await.unwrap();
    assert!(control.done.load(Ordering::SeqCst), "the review was reopened after the reservation");
    assert_eq!(report.stop, Some(ApplyStop::CatalogMoved), "{report:#?}");
    assert_eq!(report.outcome, Some(ApplyOutcome::Failed), "{report:#?}");
    assert_eq!(World::tree(&world.view()), before, "the old View stays");
    assert!(!world.previous().exists());
}

/// C3, STO-FR-04/05/16: a `View (previous)/` that is a link is never walked:
/// the sheet names it as unreadable and lists nothing below it.
#[tokio::test]
async fn a_linked_previous_view_is_refused_and_nothing_below_it_is_listed() {
    let world = world(ViewMode::Copies).await;
    world.apply().await;
    let elsewhere = world.temp.path().join("elsewhere");
    fs::create_dir_all(elsewhere.join("night")).unwrap();
    fs::write(elsewhere.join("night/notes.txt"), b"not the Project's").unwrap();
    link_folder(&elsewhere, &world.previous());

    let preview = world.preview().await;
    assert!(
        preview.blockers.contains(&ApplyBlocker::ViewUnreadable {
            path: NativePath::from_path(&world.previous()),
            reason: ReasonCode::SourceUnavailable,
        }),
        "{:#?}",
        preview.blockers
    );
    let listed = serde_json::to_string(&preview).unwrap();
    assert!(!listed.contains("notes.txt"), "nothing below the link is listed: {listed}");
    assert!(world.library.apply(&World::request(&preview), &Unattended).await.is_err());
    assert!(elsewhere.join("night/notes.txt").exists());
}

/// C3, STO-FR-04/16: a `Processing/` that is a link is refused in the Trash
/// step; nothing below it is offered or moved.
#[tokio::test]
async fn a_linked_processing_folder_is_refused_and_nothing_below_it_moves() {
    let world = world(ViewMode::Symlinks).await;
    world.apply().await;
    let elsewhere = world.temp.path().join("elsewhere");
    fs::create_dir_all(elsewhere.join("WBPP")).unwrap();
    let outside = elsewhere.join("WBPP/registered.xisf");
    fs::write(&outside, b"not the Project's").unwrap();
    link_folder(&elsewhere, &world.folder().join("Processing"));
    let trash = ScopedTrash::new(&world.temp.path().join("bin"));
    // Wrap up runs Clean up before Trash; nothing is selected.
    let clean = world.library.clean_up_review(world.project).await.unwrap();
    let request = CleanUpRequest {
        project_id: world.project,
        desired_revision: clean.desired_revision,
        generation: clean.generation,
        selected: Vec::new(),
    };
    world.library.clean_up(&request, trash.dyn_trash()).await.unwrap();

    let review = world.library.trash_review(world.project, trash.dyn_trash()).await.unwrap();
    let processing =
        review.groups.iter().find(|group| group.group == TrashGroup::ProcessingFiles).unwrap();
    assert!(processing.items.is_empty(), "{review:#?}");
    assert_eq!(processing.refused.len(), 1, "{review:#?}");
    assert_eq!(
        processing.refused[0].path,
        NativePath::from_path(&world.folder().join("Processing"))
    );
    assert_eq!(processing.refused[0].reason.code, ReasonCode::SourceUnavailable);

    let request = TrashRequest {
        project_id: world.project,
        digest: review.digest.clone(),
        ticked: vec![TrashGroup::ProcessingFiles],
    };
    let report = world.library.wrap_up_trash(&request, trash.dyn_trash()).await.unwrap();
    assert!(report.moved.is_empty(), "{report:#?}");
    assert!(outside.exists(), "nothing below the link moved");
}

/// Restores a folder's permissions when the test ends, so the temporary
/// folder can be removed.
#[cfg(unix)]
struct Unreadable(PathBuf);

#[cfg(unix)]
impl Unreadable {
    fn new(folder: &Path) -> Self {
        fs::set_permissions(folder, fs::Permissions::from_mode(0o000)).unwrap();
        Self(folder.to_path_buf())
    }
}

#[cfg(unix)]
impl Drop for Unreadable {
    fn drop(&mut self) {
        let _ = fs::set_permissions(&self.0, fs::Permissions::from_mode(0o755));
    }
}

/// C10, VSEL-FR-20: a folder in `View/` that can't be read is a visible
/// blocker naming it, not left out of the sheet's inventory.
// chmod makes the folder unreadable; Windows files have no mode bits.
#[cfg(unix)]
#[tokio::test]
async fn an_unreadable_view_entry_is_a_blocker_not_omitted() {
    let world = world(ViewMode::Copies).await;
    world.apply().await;
    let hidden = world.view().join("WBPP notes");
    fs::create_dir(&hidden).unwrap();
    fs::write(hidden.join("notes.txt"), b"the user's").unwrap();
    let _guard = Unreadable::new(&hidden);

    let preview = world.preview().await;
    assert!(
        preview.blockers.contains(&ApplyBlocker::ViewUnreadable {
            path: NativePath::from_path(&hidden),
            reason: ReasonCode::SourceUnavailable,
        }),
        "{:#?}",
        preview.blockers
    );
    assert!(world.library.apply(&World::request(&preview), &Unattended).await.is_err());
}

/// C10, STO-FR-05/16: a folder in `Processing/` that can't be read is a
/// Trash refusal naming it; the step offers no partial list.
// chmod makes the folder unreadable; Windows files have no mode bits.
#[cfg(unix)]
#[tokio::test]
async fn an_unreadable_processing_entry_is_a_trash_refusal() {
    let world = world(ViewMode::Symlinks).await;
    world.apply().await;
    let processing = world.folder().join("Processing");
    fs::create_dir_all(processing.join("WBPP")).unwrap();
    fs::write(processing.join("WBPP/registered.xisf"), b"registered").unwrap();
    let hidden = processing.join("Siril");
    fs::create_dir(&hidden).unwrap();
    fs::write(hidden.join("stacked.fit"), b"stacked").unwrap();
    let _guard = Unreadable::new(&hidden);
    let trash = ScopedTrash::new(&world.temp.path().join("bin"));

    let review = world.library.trash_review(world.project, trash.dyn_trash()).await.unwrap();
    let group =
        review.groups.iter().find(|group| group.group == TrashGroup::ProcessingFiles).unwrap();
    assert!(group.items.is_empty(), "no partial list is offered: {review:#?}");
    let refused: Vec<(&NativePath, ReasonCode)> =
        group.refused.iter().map(|refusal| (&refusal.path, refusal.reason.code)).collect();
    assert_eq!(refused, [(&NativePath::from_path(&hidden), ReasonCode::SourceUnavailable)]);
}
