// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The Done / Archive sheet offers (spec 065 PRJ-FR-14/15, PRJ-AC-15/16/28/30,
//! PRJ-AC-17 and PV-PRJ-SC-06 on the offer side, root FR-021; D-W42, D-W43,
//! D-W70, D-W72, D-W74) on the composed library over real files: rejected
//! frames are the library-Unusable candidates only, never a Project-only
//! reject, refusing frames a run that is not Complete prepared in any Project
//! or a Result records; intermediates include an adopted master's generated
//! source as a verified duplicate; duplicate copies keep the Captures or
//! earliest copy; Archive keeps sessions an open Project's run uses; Empty
//! Trash is offered while the Trash holds runs.
#![cfg(unix)]

#[path = "support/done_archive.rs"]
mod done_archive_support;
#[path = "support/prepare.rs"]
mod prepare_support;
#[path = "support/results.rs"]
mod results_support;
mod support;

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use done_archive_support::{
    asset_at, done, file_of, hashed, light, light_metadata, mark_done, other_project_run,
    project_of, record_preparation, record_trashed, register, reject_for_project, scan,
    set_quality, sheet,
};
use platevault_core::*;
use prepare_support::{world, World, HA_LIGHTS, OIII_LIGHTS, PROJECT, RUN};
use results_support::{accept, find, prepared, results_dir, stack, text};
use uuid::Uuid;

fn run(world: &World) -> ResultOwner {
    ResultOwner::Run { view_id: world.run }
}

fn offered(offer: &RejectedFramesOffer) -> Vec<Uuid> {
    offer.frames.iter().map(|frame| frame.frame_key).collect()
}

fn ids(copies: &[FrameCopy]) -> Vec<Uuid> {
    copies.iter().map(|copy| copy.asset_id).collect()
}

fn other_run(view_id: Uuid, name: &str, project_id: Uuid, project_name: &str) -> OfferRun {
    OfferRun {
        view_id,
        name: name.into(),
        project_id,
        project_name: project_name.into(),
        stage: RunStage::Prepare,
    }
}

/// PRJ-FR-15, root FR-021: the offer covers only the Project's candidate
/// frames whose library quality is Unusable. A Usable or Unreviewed
/// candidate, a Trashed frame and an Unusable calibration frame its run uses
/// are not counted.
#[tokio::test]
async fn rejected_offer_counts_library_unusable_candidates_only() {
    let world = world().await;
    let unusable = light(&world, HA_LIGHTS[0]).await;
    set_quality(&world, &unusable, Quality::Unusable).await;
    set_quality(&world, &light(&world, HA_LIGHTS[1]).await, Quality::Usable).await;
    let trashed = light(&world, OIII_LIGHTS[1]).await;
    set_quality(&world, &trashed, Quality::Unusable).await;
    record_trashed(&world, &world.captures, &light(&world, OIII_LIGHTS[1]).await).await;
    let dark = asset_at(&world, &world.calibration, "darks/Dark_300s_001.fits").await;
    set_quality(&world, &dark, Quality::Unusable).await;
    let project = done(&world).await;

    let offer = sheet(&world, project).await.rejected_frames;
    assert_eq!(offered(&offer), vec![unusable.id], "{offer:#?}");
    assert_eq!(offer.n, 1);
    assert_eq!(ids(&offer.frames[0].copies), vec![unusable.id]);
    assert_eq!(offer.size_bytes, unusable.fingerprint.size_bytes);
    assert_eq!(offer.frames[0].size_bytes, unusable.fingerprint.size_bytes);
    assert!(offer.refused.is_empty(), "{:?}", offer.refused);
}

/// PRJ-AC-16, D-W42, PV-PRJ-SC-06: a frame this Project rejects for itself
/// only is never counted or listed, Unusable in the library or not; another
/// Project's Project-only reject changes nothing here.
#[tokio::test]
async fn project_only_rejects_never_included() {
    let world = world().await;
    let project = project_of(&world).await;
    let (other, _) = other_project_run(&world, "NGC 7000 Wide", "Wide-Ha").await;
    let unusable = light(&world, HA_LIGHTS[0]).await;
    set_quality(&world, &unusable, Quality::Unusable).await;
    reject_for_project(&world, other, &light(&world, HA_LIGHTS[0]).await).await;
    let both = light(&world, HA_LIGHTS[1]).await;
    set_quality(&world, &both, Quality::Unusable).await;
    reject_for_project(&world, project, &light(&world, HA_LIGHTS[1]).await).await;
    let project_only = light(&world, OIII_LIGHTS[0]).await;
    reject_for_project(&world, project, &project_only).await;
    done(&world).await;

    let offer = sheet(&world, project).await.rejected_frames;
    assert_eq!(offered(&offer), vec![unusable.id], "{offer:#?}");
    assert_eq!(offer.n, 1);
    let listed: BTreeSet<Uuid> = offer
        .frames
        .iter()
        .flat_map(|frame| ids(&frame.copies))
        .chain(offer.refused.iter().flat_map(|frame| ids(&frame.copies)))
        .collect();
    assert!(!listed.contains(&both.id), "a Project-only reject is never listed");
    assert!(!listed.contains(&project_only.id), "a Project-only reject is never listed");
    assert!(offer.refused.is_empty(), "{:?}", offer.refused);
}

/// PRJ-AC-16, D-W43: a library-Unusable candidate in a prepared revision of
/// a run at Prepare in another Project is refused, naming that run and
/// Project; the other Unusable candidate is offered.
#[tokio::test]
async fn refuses_prepared_in_noncomplete_run_any_project() {
    let world = world().await;
    let used = light(&world, HA_LIGHTS[0]).await;
    let free = light(&world, HA_LIGHTS[1]).await;
    let (other, wide) = other_project_run(&world, "NGC 7000 Wide", "Wide-Ha").await;
    let file = file_of(&world.captures, &used);
    record_preparation(&world, wide, InputMode::LinkedView, &[(used.id, &used, file)]).await;
    set_quality(&world, &used, Quality::Unusable).await;
    set_quality(&world, &free, Quality::Unusable).await;
    let project = done(&world).await;

    let offer = sheet(&world, project).await.rejected_frames;
    assert_eq!(offered(&offer), vec![free.id], "{offer:#?}");
    assert_eq!(offer.n, 1);
    assert_eq!(offer.refused.len(), 1, "{:?}", offer.refused);
    let refused = &offer.refused[0];
    assert_eq!(refused.frame_key, used.id);
    assert_eq!(ids(&refused.copies), vec![used.id]);
    assert_eq!(
        refused.reasons,
        vec![OfferRefusal::PreparedInOpenRun {
            run: other_run(wide, "Wide-Ha", other, "NGC 7000 Wide"),
            preparation: 1,
        }]
    );
    let reason = refused.reasons[0].to_string();
    assert!(reason.contains("'Wide-Ha'") && reason.contains("'NGC 7000 Wide'"), "{reason}");
}

/// PRJ-AC-16, D-W43: a library-Unusable candidate held by the prepared
/// revision a Result records, by tool evidence naming its folder, is refused
/// as a recorded input of that Result although its run is Complete.
#[tokio::test]
async fn refuses_recorded_result_input() {
    let world = world().await;
    prepared(&world).await;
    let product = results_dir(&world).join("HOO_stack.fit");
    stack(&product, &[("HISTORY", &format!("'../{RUN}/Lights/Ha_001.fits'"))]);
    let result = accept(&world.library, run(&world), &product, ResultKind::LinearIntegration).await;
    let input = light(&world, HA_LIGHTS[0]).await;
    set_quality(&world, &input, Quality::Unusable).await;
    let project = done(&world).await;

    let offer = sheet(&world, project).await.rejected_frames;
    assert_eq!(offer.n, 0, "{offer:#?}");
    assert!(offer.frames.is_empty());
    assert_eq!(offer.refused.len(), 1, "{:?}", offer.refused);
    assert_eq!(offer.refused[0].frame_key, input.id);
    assert_eq!(
        offer.refused[0].reasons,
        vec![OfferRefusal::ResultInput {
            result_id: result,
            result_name: "HOO_stack.fit".into(),
            run: OfferRun {
                view_id: world.run,
                name: RUN.into(),
                project_id: project,
                project_name: PROJECT.into(),
                stage: RunStage::Done,
            },
            preparation: 1,
            inferred: false,
        }]
    );
}

/// PRJ-AC-16, STO-AC-18: a library-Unusable candidate in a prepared revision
/// of a Complete run that no Result records is offered.
#[tokio::test]
async fn includes_complete_run_frames() {
    let world = world().await;
    let outcome = prepared(&world).await;
    let frame = light(&world, HA_LIGHTS[0]).await;
    assert!(
        outcome.prepared.iter().any(|entry| entry.asset_id == Some(frame.id)),
        "the frame is in the run's prepared revision"
    );
    set_quality(&world, &frame, Quality::Unusable).await;
    let project = done(&world).await;
    assert_eq!(world.view().await.completion, RunCompletion::Complete);

    let offer = sheet(&world, project).await.rejected_frames;
    assert_eq!(offered(&offer), vec![frame.id], "{offer:#?}");
    assert_eq!(offer.n, 1);
    assert!(offer.refused.is_empty(), "{:?}", offer.refused);
}

/// PRJ-AC-28, STO-AC-21, D-W70: the intermediates offer counts the run's
/// recognized intermediates and its adopted master's generated source, listed
/// as a verified duplicate naming the kept library copy. The accepted Result,
/// a candidate master, an unknown file and the adopted library master are
/// not offered.
#[tokio::test]
async fn intermediates_offer_includes_adopted_master_source_as_verified_duplicate() {
    let world = world().await;
    prepared(&world).await;
    let results = results_dir(&world);
    let intermediates: Vec<PathBuf> =
        ["process/pp_light_00001.fit", "process/r_pp_light_00001.fit"]
            .iter()
            .map(|path| results.join(path))
            .collect();
    for path in &intermediates {
        stack(path, &[("OBJECT", "'NGC 7000'")]);
    }
    let sequence = results.join("process/r_pp_light_.seq");
    text(&sequence, "S 'r_pp_light_' 1 1 1 1");
    let final_image = results.join("NGC7000_HOO.fit");
    stack(&final_image, &[("OBJECT", "'NGC 7000'")]);
    let generated = results.join("master_flat.fit");
    stack(&generated, &[("IMAGETYP", "'Flat'"), ("FILTER", "'Ha'"), ("STACKCNT", "30")]);
    let candidate_master = results.join("master_dark.fit");
    stack(&candidate_master, &[("IMAGETYP", "'Dark'"), ("STACKCNT", "20")]);
    let unknown = results.join("notes.txt");
    text(&unknown, "stacking notes");
    accept(&world.library, run(&world), &final_image, ResultKind::FinalImage).await;
    let listing = world.library.rescan_results(run(&world)).await.unwrap();
    let source = find(&listing.candidates, &generated).clone();
    world
        .library
        .register_location(
            NativePath::from_path(&world.output),
            "Processing".into(),
            LocationRole::Results,
        )
        .await
        .unwrap();
    let calibration_root = world.calibration.path.to_path_buf().unwrap();
    fs::create_dir_all(calibration_root.join("masters")).unwrap();
    let destination = AdoptionDestination {
        location_id: world.calibration.id,
        relative_path: NativePath::from_path(Path::new("masters/master_flat.fit")),
    };
    let review = world
        .library
        .calibration_review_adoption(&AdoptionSource::Result { result_id: source.id }, &destination)
        .await
        .unwrap();
    let adoption = world.library.calibration_adopt(review.id, review.revision).await.unwrap();
    assert_eq!(adoption.state, AdoptionState::Completed, "{adoption:?}");
    let project = done(&world).await;

    let offer = sheet(&world, project).await.intermediates;
    let mut expected: Vec<PathBuf> = intermediates.clone();
    expected.push(sequence);
    expected.push(generated.clone());
    expected.sort();
    let mut paths: Vec<PathBuf> =
        offer.items.iter().map(|item| item.path.to_path_buf().unwrap()).collect();
    paths.sort();
    assert_eq!(paths, expected, "{offer:#?}");
    assert_eq!(offer.n, 4);
    let size: u64 = expected.iter().map(|path| fs::metadata(path).unwrap().len()).sum();
    assert_eq!(offer.size_bytes, size);
    assert!(offer.refused.is_empty(), "{:?}", offer.refused);
    let kept = KeptLibraryCopy {
        master_id: adoption.master_id.unwrap(),
        asset_id: None,
        location_id: world.calibration.id,
        relative_path: NativePath::from_path(Path::new("masters/master_flat.fit")),
        sha256: source.sha256.clone().unwrap(),
    };
    for item in &offer.items {
        let path = item.path.to_path_buf().unwrap();
        let duplicate = (path == generated).then(|| kept.clone());
        assert_eq!(item.verified_duplicate_of, duplicate, "{}", path.display());
        assert_eq!(item.owner, run(&world));
    }
    assert_eq!(
        support::digest(&calibration_root.join("masters/master_flat.fit")),
        support::digest(&generated),
        "the kept library copy holds the source's bytes"
    );
}

/// PRJ-AC-30, D-W74: each frame keeps its copy in a Captures or Calibration
/// location, the earliest-registered one among several, and its extra
/// byte-identical copies are offered: F1's Results copy, F2's copy in the
/// later Captures location, and F4's Results copy, whose Captures copy is
/// kept although the Results location was registered earlier. F3's later
/// copy is the Direct-source path of another Project's run at Prepare and is
/// refused with that reason.
#[tokio::test]
async fn duplicate_offer_keeps_captures_or_earliest_copy() {
    let world = world().await;
    let processed = register(&world, "Astro-T7/Results", LocationRole::Results).await;
    let later = register(&world, "Astro-T7/Captures B", LocationRole::Captures).await;
    let bytes = |path: &str| fs::read(world.light(path)).unwrap();
    let ha = || light_metadata("Ha", "2026-09-18");
    let ha3 = "2026-09-18/Ha_003.fits";
    let ha3_bytes = format!("{ha3}{}", " ".repeat(64)).into_bytes();
    scan(
        &world,
        &processed,
        &[(HA_LIGHTS[0], bytes(HA_LIGHTS[0]), ha()), (ha3, ha3_bytes.clone(), ha())],
    )
    .await;
    scan(
        &world,
        &later,
        &[
            (HA_LIGHTS[1], bytes(HA_LIGHTS[1]), ha()),
            (OIII_LIGHTS[0], bytes(OIII_LIGHTS[0]), light_metadata("OIII", "2026-09-24")),
            (ha3, ha3_bytes, ha()),
        ],
    )
    .await;
    let f1 = [
        hashed(&world, &light(&world, HA_LIGHTS[0]).await).await,
        hashed(&world, &asset_at(&world, &processed, HA_LIGHTS[0]).await).await,
    ];
    let f2 = [
        hashed(&world, &light(&world, HA_LIGHTS[1]).await).await,
        hashed(&world, &asset_at(&world, &later, HA_LIGHTS[1]).await).await,
    ];
    let f3 = [
        hashed(&world, &light(&world, OIII_LIGHTS[0]).await).await,
        hashed(&world, &asset_at(&world, &later, OIII_LIGHTS[0]).await).await,
    ];
    let f4 = [
        hashed(&world, &asset_at(&world, &processed, ha3).await).await,
        hashed(&world, &asset_at(&world, &later, ha3).await).await,
    ];
    let key = |frame: &[Asset; 2]| frame[0].id.min(frame[1].id);
    let (other, direct) = other_project_run(&world, "NGC 7000 Wide", "Wide-Direct").await;
    let source = file_of(&later, &f3[1]);
    record_preparation(&world, direct, InputMode::DirectSource, &[(key(&f3), &f3[1], source)])
        .await;
    let project = done(&world).await;

    let offer = sheet(&world, project).await.duplicates;
    let frame = |assets: &[Asset; 2]| {
        offer
            .frames
            .iter()
            .find(|frame| frame.frame_key == key(assets))
            .unwrap_or_else(|| panic!("frame {} is not listed in {offer:#?}", key(assets)))
    };
    for (assets, kept, extra) in [(&f1, 0, 1), (&f2, 0, 1), (&f4, 1, 0)] {
        let listed = frame(assets);
        assert_eq!(listed.kept.asset_id, assets[kept].id, "{listed:#?}");
        assert_eq!(ids(&listed.offered), vec![assets[extra].id], "{listed:#?}");
        assert!(listed.refused.is_empty(), "{listed:#?}");
    }
    let refused = frame(&f3);
    assert_eq!(refused.kept.asset_id, f3[0].id);
    assert!(refused.offered.is_empty(), "{refused:#?}");
    assert_eq!(refused.refused.len(), 1, "{refused:#?}");
    assert_eq!(refused.refused[0].copy.asset_id, f3[1].id);
    assert_eq!(
        refused.refused[0].reasons,
        vec![OfferRefusal::PreparedSource {
            run: other_run(direct, "Wide-Direct", other, "NGC 7000 Wide"),
            preparation: 1,
            direct_source: true,
        }]
    );
    assert_eq!(offer.frames.len(), 4, "{offer:#?}");
    assert_eq!(offer.n, 3);
    let size =
        f1[1].fingerprint.size_bytes + f2[1].fingerprint.size_bytes + f4[0].fingerprint.size_bytes;
    assert_eq!(offer.size_bytes, size);
    for copy in f1.iter().chain(&f2).chain(&f3).chain(&f4) {
        let location = if copy.location_id == world.captures.id {
            &world.captures
        } else if copy.location_id == processed.id {
            &processed
        } else {
            &later
        };
        assert!(file_of(location, copy).exists(), "offers move nothing");
    }
}

/// PRJ-FR-14, PRJ-AC-15: Archive keeps every member session a run of another
/// Project not marked Done selects, naming that Project; once that Project
/// is Done, Archive covers them.
#[tokio::test]
async fn archive_keeps_sessions_used_by_open_projects() {
    let world = world().await;
    let (other, wide) = other_project_run(&world, "NGC 7000 Wide", "Wide-Ha").await;
    let project = done(&world).await;
    let members: Vec<Uuid> = world
        .catalog()
        .project_members(project)
        .await
        .unwrap()
        .into_iter()
        .map(|member| member.session_id)
        .collect();
    assert_eq!(members.len(), 2);

    let archive = sheet(&world, project).await.archive;
    assert!(archive.sessions.is_empty(), "{archive:#?}");
    let wide_project = ProjectName { id: other, name: "NGC 7000 Wide".into() };
    assert_eq!(
        archive.kept,
        members
            .iter()
            .map(|session_id| KeptSession {
                session_id: *session_id,
                projects: vec![wide_project.clone()],
            })
            .collect::<Vec<_>>()
    );

    world.library.mark_view_complete(wide).await.unwrap();
    mark_done(&world, other).await;
    let archive = sheet(&world, project).await.archive;
    assert_eq!(archive.sessions, members);
    assert!(archive.kept.is_empty(), "{archive:#?}");
}

/// PRJ-FR-14, PRJ-AC-15, RES-FR-10: the sheet opens only for a Done
/// Project, and offers Empty Trash only while the Project's Trash holds
/// runs, listing each of them.
#[tokio::test]
async fn empty_trash_offered_when_trash_holds_runs() {
    let world = world().await;
    let project = project_of(&world).await;
    let trash = std::sync::Arc::new(done_archive_support::EveryTrash);
    let error = world.library.done_archive_review(project, trash).await.unwrap_err();
    assert!(matches!(error, LibraryError::InvalidInput(_)), "{error}");
    assert!(error.to_string().contains("not Done"), "{error}");
    done(&world).await;
    assert_eq!(sheet(&world, project).await.empty_trash, None);

    let catalog = world.catalog();
    let revision = catalog.project(project).await.unwrap().revision;
    catalog.reopen_project(project, revision).await.unwrap();
    let view = world.view().await;
    let discarded = catalog
        .create_view(&NewView {
            project_id: project,
            subject_id: view.subject_id,
            rig_id: view.rig_id,
            name: "Discarded".into(),
        })
        .await
        .unwrap()
        .view
        .id;
    world.library.move_view_to_trash(discarded).await.unwrap();
    mark_done(&world, project).await;

    let offer = sheet(&world, project).await.empty_trash.expect("Empty Trash is offered");
    assert_eq!(
        offer.runs.iter().map(|trashed| trashed.run.id).collect::<Vec<_>>(),
        vec![discarded]
    );
    assert_eq!(offer.runs[0].run.name, "Discarded");
}
