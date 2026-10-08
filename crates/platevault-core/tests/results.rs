// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! RES Results (spec 070 RES-FR-01..05/08/10, RES-AC-01..05/09..16/20,
//! CAL-FR-06, CAL-AC-12, VSEL-FR-05) on the composed library over real files:
//! discovery in the recorded Results folder only, Pending growing files,
//! intermediates apart, the prepared revision each candidate came from,
//! Attach Result, Accept Result bound to the inspected bytes, accepted
//! products as inputs from another rig, panel and group Results by folder,
//! the Result-input Trash refusal and the once-only master offer.
#![cfg(unix)]

#[path = "support/prepare_group.rs"]
mod group_support;
#[path = "support/prepare.rs"]
mod prepare_support;
#[path = "support/results.rs"]
mod results_support;
mod support;

use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

use group_support::{group_world, panel as group_panel, GroupWorld, MOSAIC};
use platevault_core::*;
use prepare_support::{
    digest, overwrite_in_place, restore_in_place, world, Watch, World, PROJECT, RUN,
};
use results_support::{
    accept, database, find, paths, prepared, record_results_folder, results_dir, settle, stack,
    text,
};
use uuid::Uuid;

fn run(world: &World) -> ResultOwner {
    ResultOwner::Run { view_id: world.run }
}

fn native(path: &NativePath) -> PathBuf {
    path.to_path_buf().unwrap()
}

fn sorted(mut paths: Vec<PathBuf>) -> Vec<PathBuf> {
    paths.sort();
    paths
}

fn refused(error: &LibraryError, needle: &str) {
    assert!(matches!(error, LibraryError::InvalidInput(_)), "{error}");
    assert!(error.to_string().contains(needle), "{error} should name {needle}");
}

/// Another run on the world's subject and `rig`.
async fn other_run(world: &World, rig: Uuid, name: &str) -> Uuid {
    let view = world.view().await;
    let input = NewView {
        project_id: view.project_id,
        subject_id: view.subject_id,
        rig_id: rig,
        name: name.into(),
    };
    world.library.create_view(&input).await.unwrap().view.id
}

/// RES-FR-01, PREP-FR-07: only the run's recorded Results folder is read;
/// a file in its prepared folder or in an unrecorded sibling folder is never
/// discovered.
#[tokio::test]
async fn discovers_only_recorded_results_folders_never_prepared_folder() {
    let world = world().await;
    let outcome = prepared(&world).await;
    let product = results_dir(&world).join("result.fit");
    stack(&product, &[("IMAGETYP", "'LIGHT'"), ("STACKCNT", "4")]);
    stack(&native(&outcome.revision.folder).join("stack_in_prepared.fit"), &[]);
    stack(&world.output.join(PROJECT).join("Other Results").join("stray.fit"), &[]);
    let listing = world.library.rescan_results(run(&world)).await.unwrap();
    assert_eq!(native(listing.folder.as_ref().unwrap()), results_dir(&world));
    assert_eq!(paths(&listing.candidates), vec![product.clone()]);
    assert!(listing.intermediates.is_empty(), "{:?}", paths(&listing.intermediates));
    let record = &listing.candidates[0];
    assert_eq!(record.state, ResultState::Candidate);
    assert_eq!(record.association, ResultAssociation::ResultsFolder);
    assert_eq!(record.sha256.as_deref(), Some(digest(&product).as_str()));
    assert!(record.accepted.is_none(), "appearing never accepts");

    let unprepared = other_run(&world, world.view().await.rig_id, "Never prepared").await;
    let error = world.library.rescan_results(ResultOwner::Run { view_id: unprepared }).await;
    refused(&error.unwrap_err(), "no recorded Results folder");
}

/// RES-AC-01: a file still being written reads Pending, unhashed and
/// unacceptable, until it settles.
#[tokio::test]
async fn growing_file_pending() {
    let world = world().await;
    prepared(&world).await;
    let settled = results_dir(&world).join("result.fit");
    stack(&settled, &[("OBJECT", "'NGC 7000'")]);
    let growing = results_dir(&world).join("result_live.fit");
    support::fits(&growing, &[("OBJECT", "'NGC 7000 live'")]).unwrap();
    let listing = world.library.rescan_results(run(&world)).await.unwrap();
    let pending = find(&listing.candidates, &growing).clone();
    assert_eq!(pending.state, ResultState::Pending);
    assert!(pending.sha256.is_none(), "a Pending file is never hashed");
    assert_eq!(find(&listing.candidates, &settled).state, ResultState::Candidate);
    let outcome = world
        .library
        .accept_results(&[AcceptResult {
            result_id: pending.id,
            kind: Some(ResultKind::FinalImage),
        }])
        .await
        .unwrap();
    assert!(outcome.accepted.is_empty());
    assert!(outcome.refused[0].reason.contains("still being written"), "{:?}", outcome.refused);

    settle(&growing);
    let listing = world.library.rescan_results(run(&world)).await.unwrap();
    let record = find(&listing.candidates, &growing);
    assert_eq!(record.state, ResultState::Candidate);
    assert_eq!(record.sha256.as_deref(), Some(digest(&growing).as_str()));
}

/// RES-AC-01, RES-FR-01: the Siril recognizer sets process frames,
/// sequences and logs apart; stacks stay candidates.
#[tokio::test]
async fn intermediates_listed_separately() {
    let world = world().await;
    prepared(&world).await;
    let results = results_dir(&world);
    let intermediates =
        [results.join("process/pp_light_00001.fit"), results.join("process/r_pp_light_00001.fit")];
    for frame in &intermediates {
        stack(frame, &[("IMAGETYP", "'LIGHT'")]);
    }
    let sequence = results.join("process/r_pp_light_.seq");
    text(&sequence, "S 'r_pp_light_' 1 2 2");
    let log = results.join("siril.log");
    text(&log, "stacking done");
    let stacked = results.join("process/r_pp_light_stacked.fit");
    let result = results.join("result.fit");
    stack(&stacked, &[("STACKCNT", "4")]);
    stack(&result, &[("STACKCNT", "4"), ("OBJECT", "'final'")]);
    let listing = world.library.rescan_results(run(&world)).await.unwrap();
    let mut expected = intermediates.to_vec();
    expected.extend([sequence, log]);
    assert_eq!(sorted(paths(&listing.intermediates)), sorted(expected));
    assert_eq!(sorted(paths(&listing.candidates)), sorted(vec![stacked, result]));
    for record in &listing.intermediates {
        assert_eq!(record.state, ResultState::Intermediate);
        assert!(record.sha256.is_none());
        assert!(matches!(record.kind, Some(ResultKind::Intermediate { .. })), "{:?}", record.kind);
    }
    let frame = find(&listing.intermediates, &intermediates[0]);
    let outcome = world
        .library
        .accept_results(&[AcceptResult { result_id: frame.id, kind: Some(ResultKind::FinalImage) }])
        .await
        .unwrap();
    assert!(outcome.refused[0].reason.contains("intermediate"), "{:?}", outcome.refused);
}

fn at(text: &str) -> i128 {
    time::OffsetDateTime::parse(text, &time::format_description::well_known::Rfc3339)
        .unwrap()
        .unix_timestamp_nanos()
}

fn set_modified(path: &Path, nanos: i128) {
    let time = UNIX_EPOCH + Duration::from_nanos(u64::try_from(nanos).unwrap());
    std::fs::OpenOptions::new().write(true).open(path).unwrap().set_modified(time).unwrap();
}

/// RES-AC-16, D-W67, plan risk 9a: both revisions write the one Results
/// folder; each candidate names its revision by a header or log naming the
/// prepared folder, else by its time window as inference, else Unknown.
#[tokio::test]
async fn candidate_records_prepared_revision() {
    let world = world().await;
    let profile = world.siril("exit 0").await;
    let request = world.request(&profile, InputMode::LinkedView, None);
    let first = world.prepare(&request, &Watch::quiet()).await;
    world.drop_one_oiii_frame().await;
    let second = world.prepare(&request, &Watch::quiet()).await;
    assert_eq!(second.revision.n, 2);
    let results = results_dir(&world);
    let window = i128::midpoint(
        at(first.revision.finished_at.as_deref().unwrap()),
        at(&second.revision.started_at),
    );
    let header = results.join("tool.fit");
    support::fits(&header, &[("HISTORY", &format!("'../{RUN} (rev 2)/Lights/Ha_001.fits'"))])
        .unwrap();
    set_modified(&header, window);
    let windowed = results.join("window.fit");
    support::fits(&windowed, &[("OBJECT", "'window'")]).unwrap();
    set_modified(&windowed, window);
    let logged = results.join("logged.fit");
    stack(&logged, &[("OBJECT", "'logged'")]);
    let log = results.join("stacking.log");
    text(&log, &format!("Stacking logged.fit from ../{RUN} (rev 2)/Lights/OIII_001.fits"));
    let unknown = results.join("unknown.fit");
    stack(&unknown, &[("OBJECT", "'unknown'")]);
    let latest = results.join("latest.fit");
    support::fits(&latest, &[("OBJECT", "'latest'")]).unwrap();
    tokio::time::sleep(platevault_core::results::SETTLE + Duration::from_millis(500)).await;

    let listing = world.library.rescan_results(run(&world)).await.unwrap();
    let (rev1, rev2) = (first.revision.id, second.revision.id);
    assert_eq!(
        find(&listing.candidates, &header).attribution,
        RevisionAttribution::ToolEvidence {
            revision_id: rev2,
            n: 2,
            source: NativePath::from_path(&header)
        }
    );
    assert_eq!(
        find(&listing.candidates, &logged).attribution,
        RevisionAttribution::ToolEvidence {
            revision_id: rev2,
            n: 2,
            source: NativePath::from_path(&log)
        }
    );
    assert_eq!(
        find(&listing.candidates, &windowed).attribution,
        RevisionAttribution::TimeWindow { revision_id: rev1, n: 1 }
    );
    assert_eq!(
        find(&listing.candidates, &latest).attribution,
        RevisionAttribution::TimeWindow { revision_id: rev2, n: 2 }
    );
    assert_eq!(find(&listing.candidates, &unknown).attribution, RevisionAttribution::Unknown);
}

/// RES-AC-02/03: a file outside the Results folder is attached User-linked
/// with Unknown lineage, listed beside the candidates, and acceptance
/// upgrades neither.
#[tokio::test]
async fn attach_is_user_linked_lineage_unknown() {
    let world = world().await;
    prepared(&world).await;
    let elsewhere = world.output.join("Elsewhere/HOO_linear.fit");
    stack(&elsewhere, &[("OBJECT", "'HOO linear'")]);
    let owner = run(&world);
    let record = world
        .library
        .attach_result(owner, NativePath::from_path(&elsewhere), ResultKind::LinearIntegration)
        .await
        .unwrap();
    assert_eq!(record.state, ResultState::Attached);
    assert_eq!(record.association, ResultAssociation::UserLinked);
    assert_eq!(record.lineage, ResultLineage::Unknown);
    assert_eq!(record.attribution, RevisionAttribution::Unknown);
    assert_eq!(record.sha256.as_deref(), Some(digest(&elsewhere).as_str()));
    let listing = world.library.rescan_results(owner).await.unwrap();
    assert_eq!(find(&listing.candidates, &elsewhere).state, ResultState::Attached);

    let inside = results_dir(&world).join("inside.fit");
    stack(&inside, &[]);
    let error = world
        .library
        .attach_result(owner, NativePath::from_path(&inside), ResultKind::FinalImage)
        .await
        .unwrap_err();
    refused(&error, "discovered, not attached");
    let other = world.output.join("Elsewhere/mosaic.fit");
    stack(&other, &[("OBJECT", "'mosaic'")]);
    let error = world
        .library
        .attach_result(owner, NativePath::from_path(&other), ResultKind::AssembledMosaic)
        .await
        .unwrap_err();
    refused(&error, "Assembled mosaic");

    let outcome = world
        .library
        .accept_results(&[AcceptResult { result_id: record.id, kind: None }])
        .await
        .unwrap();
    let accepted = &outcome.accepted[0];
    assert_eq!(accepted.state, ResultState::Accepted);
    assert_eq!(accepted.association, ResultAssociation::UserLinked);
    assert_eq!(accepted.lineage, ResultLineage::Unknown);
}

/// RES-AC-10, RES-AC-09, D19: of three inspected products, the one replaced
/// in place with its size and time kept is refused naming the change, the
/// others are accepted, and it is accepted once inspected again. An accepted
/// product replaced in place reads drifted and is not offered until its
/// accepted bytes return, with no new acceptance.
#[tokio::test]
async fn accept_requires_current_bytes_match() {
    let world = world().await;
    prepared(&world).await;
    let files: Vec<PathBuf> = ["Ha.fit", "OIII.fit", "SII.fit"]
        .iter()
        .map(|name| results_dir(&world).join(name))
        .collect();
    for (index, file) in files.iter().enumerate() {
        stack(file, &[("OBJECT", &format!("'channel {index}'"))]);
    }
    let listing = world.library.rescan_results(run(&world)).await.unwrap();
    let ids: Vec<Uuid> = files.iter().map(|file| find(&listing.candidates, file).id).collect();
    overwrite_in_place(&files[1]);
    let items: Vec<AcceptResult> = ids
        .iter()
        .map(|id| AcceptResult { result_id: *id, kind: Some(ResultKind::LinearIntegration) })
        .collect();
    let outcome = world.library.accept_results(&items).await.unwrap();
    let mut accepted: Vec<Uuid> = outcome.accepted.iter().map(|record| record.id).collect();
    accepted.sort();
    let mut expected = vec![ids[0], ids[2]];
    expected.sort();
    assert_eq!(accepted, expected);
    assert_eq!(outcome.refused.len(), 1);
    assert_eq!(outcome.refused[0].result_id, ids[1]);
    assert!(
        outcome.refused[0].reason.contains("changed since it was inspected"),
        "{:?}",
        outcome.refused
    );
    world.library.rescan_results(run(&world)).await.unwrap();
    let again = world.library.accept_results(&items[1..2]).await.unwrap();
    assert_eq!(again.accepted.len(), 1, "{:?}", again.refused);

    let accepted_at = again.accepted[0].accepted.clone().unwrap().accepted_at;
    let combine = other_run(&world, world.view().await.rig_id, "NGC7000 HOO combine").await;
    overwrite_in_place(&files[1]);
    let offers = world.library.result_inputs(Some(combine)).await.unwrap();
    let offer = offers.iter().find(|offer| offer.result.id == ids[1]).unwrap();
    assert!(
        matches!(offer.verification, InputVerification::Drifted { .. }),
        "{:?}",
        offer.verification
    );
    assert!(!offer.offered() && offer.result.drifted);
    let error = world.library.add_view_product_inputs(combine, &[ids[1]]).await.unwrap_err();
    refused(&error, "drifted");
    restore_in_place(&files[1]);
    let offers = world.library.result_inputs(Some(combine)).await.unwrap();
    let offer = offers.iter().find(|offer| offer.result.id == ids[1]).unwrap();
    assert!(offer.offered(), "{:?}", offer.verification);
    assert_eq!(
        offer.result.accepted.as_ref().unwrap().accepted_at,
        accepted_at,
        "no new acceptance"
    );
    world.library.add_view_product_inputs(combine, &[ids[1]]).await.unwrap();
}

/// RES-AC-14, RES-AC-04, D-W56: an accepted OIII product of a run on rig
/// Esprit is offered to a `RedCat` run labelled with its rig; picking it adds a
/// product input and no raw session or member.
#[tokio::test]
async fn product_from_other_rig_offered_as_input_with_rig() {
    let world = world().await;
    let catalog = world.library.catalog();
    let view = world.view().await;
    let mut esprit = catalog.equipment(view.rig_id).await.unwrap();
    esprit.id = Uuid::new_v4();
    esprit.name = "Esprit 100".into();
    esprit.decision_revision = 0;
    let esprit = catalog.save_equipment(&esprit, None).await.unwrap();
    let project = catalog.project(view.project_id).await.unwrap();
    catalog
        .set_project_rigs(project.id, project.revision, &[view.rig_id, esprit.id])
        .await
        .unwrap();
    let source = other_run(&world, esprit.id, "NGC7000-OIII-Esprit").await;
    let folder = world.output.join(PROJECT).join("NGC7000-OIII-Esprit Results");
    record_results_folder(&database(&world), source, &folder).await;
    let product = folder.join("OIII_linear.fit");
    stack(&product, &[("FILTER", "'OIII'")]);
    let id = accept(
        &world.library,
        ResultOwner::Run { view_id: source },
        &product,
        ResultKind::LinearIntegration,
    )
    .await;

    let before = format!("{:?}", catalog.view(world.run).await.unwrap());
    let members = format!("{:?}", catalog.project_members(project.id).await.unwrap());
    let offers = world.library.result_inputs(Some(world.run)).await.unwrap();
    let offer = offers.iter().find(|offer| offer.result.id == id).unwrap();
    assert!(offer.offered(), "{:?}", offer.verification);
    assert_eq!(offer.origin.rig_id, esprit.id);
    assert_eq!(offer.origin.rig_name, "Esprit 100");
    assert_eq!(offer.origin.project_name, PROJECT);
    assert_eq!(offer.origin.owner_name, "NGC7000-OIII-Esprit");
    let inputs = world.library.add_view_product_inputs(world.run, &[id]).await.unwrap();
    assert_eq!(inputs.len(), 1);
    assert_eq!(inputs[0].origin.rig_name, "Esprit 100");
    assert_eq!(inputs[0].sha256, digest(&product));
    assert_eq!(format!("{:?}", catalog.view(world.run).await.unwrap()), before, "no raw session");
    assert_eq!(format!("{:?}", catalog.project_members(project.id).await.unwrap()), members);
    let again = world.library.result_inputs(Some(world.run)).await.unwrap();
    assert!(again.iter().all(|offer| offer.result.id != id), "an input is not offered twice");
}

/// `group_support`'s run group Prepared once by Prepare all, which records
/// each panel run's `<Mosaic> Results/Panel N/` and the group's
/// `<Mosaic> Results/Assembled/`.
async fn prepared_group() -> (GroupWorld, GroupPreparationOutcome) {
    let world = group_world().await;
    let profile = world.wbpp("exit 0").await;
    let request = world.setup(&profile, InputMode::Copy).await;
    let outcome = world.prepare_all(&request, &Watch::quiet()).await;
    assert_eq!(outcome.preparation.outcome, PreparationState::Prepared, "{outcome:#?}");
    for number in 1..=3 {
        let recorded = &group_panel(&outcome, number).revision.results_folder;
        assert_eq!(native(recorded), world.results().join(format!("Panel {number}")));
    }
    assert_eq!(native(&outcome.assembled), world.results().join("Assembled"));
    (world, outcome)
}

/// RES-AC-11, RES-FR-08: each panel run lists exactly its own `Panel N/`
/// folder, so a Panel 2 stack whose header names Panel 3 stays Panel 2's; the
/// prepared group folder is never read.
#[tokio::test]
async fn panel_inferred_from_folder_only() {
    let (world, _) = prepared_group().await;
    stack(&world.group_folder(MOSAIC).join("Panel 2/stray.fit"), &[]);
    let panel2 = world.results().join("Panel 2/stack.fit");
    stack(&panel2, &[("OBJECT", format!("'{MOSAIC} Panel 3'").as_str())]);
    let owner = |number| ResultOwner::Run { view_id: world.run(number) };
    // Panel 3 (which the header names) and Panel 1 open first: neither claims it.
    for other in [3, 1] {
        let listing = world.library.rescan_results(owner(other)).await.unwrap();
        assert!(listing.candidates.is_empty(), "Panel {other}: {:?}", paths(&listing.candidates));
    }
    let listing = world.library.rescan_results(owner(2)).await.unwrap();
    assert_eq!(paths(&listing.candidates), vec![panel2]);
    assert_eq!(listing.candidates[0].kind, Some(ResultKind::MosaicPanel));
    assert_eq!(listing.candidates[0].owner, owner(2));
}

/// RES-AC-11/12, RES-FR-08, D-W73: `Assembled/` yields the group Result of
/// kind Assembled mosaic; accepting it records it on the group, the Project
/// and the mosaic subject, and no panel run changes.
#[tokio::test]
async fn assembled_is_group_result() {
    let (world, outcome) = prepared_group().await;
    let assembled = native(&outcome.assembled).join(format!("{MOSAIC} mosaic.fit"));
    stack(&assembled, &[("OBJECT", format!("'{MOSAIC}'").as_str())]);
    let catalog = world.library.catalog();
    let mut runs = Vec::new();
    for number in 1..=3 {
        runs.push(catalog.view(world.run(number)).await.unwrap());
    }
    let group = ResultOwner::Group { group_id: world.group };
    let listing = world.library.rescan_results(group).await.unwrap();
    assert_eq!(paths(&listing.candidates), vec![assembled.clone()]);
    let record = &listing.candidates[0];
    assert_eq!(record.kind, Some(ResultKind::AssembledMosaic));
    assert_eq!(record.owner, group);
    let panel = world.library.rescan_results(ResultOwner::Run { view_id: world.run(1) }).await;
    assert!(panel.unwrap().candidates.is_empty(), "the group Result is no panel's");
    let outcome = world
        .library
        .accept_results(&[AcceptResult { result_id: record.id, kind: None }])
        .await
        .unwrap();
    assert_eq!(outcome.accepted.len(), 1, "{:?}", outcome.refused);
    assert_eq!(outcome.accepted[0].lineage, ResultLineage::Unknown);
    let accepted = catalog.accepted_results(Some(world.project), None).await.unwrap();
    assert_eq!(accepted.len(), 1);
    assert_eq!(accepted[0].origin.owner, group);
    assert_eq!(accepted[0].origin.subject_name, MOSAIC);
    assert_eq!(accepted[0].origin.subject_id, runs[0].view.subject_id);
    for (number, before) in (1..=3).zip(&runs) {
        assert_eq!(&catalog.view(world.run(number)).await.unwrap(), before);
    }
    let other = world.temp.path().join("final.fit");
    stack(&other, &[]);
    let error = world
        .library
        .attach_result(group, NativePath::from_path(&other), ResultKind::FinalImage)
        .await
        .unwrap_err();
    refused(&error, "Assembled mosaic");
    let in_group_folder = world.group_folder(MOSAIC).join("loose.fit");
    stack(&in_group_folder, &[]);
    let error = world
        .library
        .attach_result(group, NativePath::from_path(&in_group_folder), ResultKind::AssembledMosaic)
        .await
        .unwrap_err();
    refused(&error, "lies in the recorded folder");
}

/// RES-AC-20, RES-FR-10: Move run to Trash is refused while the run's
/// accepted Result is an input to runs C and D, the refusal names both, and
/// nothing changes; Mark Complete is not blocked by it.
#[tokio::test]
async fn trash_refused_while_result_is_input_names_runs() {
    let world = world().await;
    prepared(&world).await;
    let product = results_dir(&world).join("Ha_linear.fit");
    stack(&product, &[("FILTER", "'Ha'")]);
    let id = accept(&world.library, run(&world), &product, ResultKind::LinearIntegration).await;
    let rig = world.view().await.rig_id;
    for name in ["HOO combine C", "HOO combine D"] {
        let consumer = other_run(&world, rig, name).await;
        world.library.add_view_product_inputs(consumer, &[id]).await.unwrap();
    }
    let error = world.library.move_view_to_trash(world.run).await.unwrap_err();
    refused(&error, "HOO combine C");
    refused(&error, "HOO combine D");
    refused(&error, "Ha_linear.fit");
    assert!(world.view().await.trashed_at.is_none(), "nothing changes");
    let complete = world.library.mark_view_complete(world.run).await.unwrap();
    assert_eq!(complete.view.completion, RunCompletion::Complete);
}

/// RES-AC-15, CAL-FR-06, CAL-AC-12: a generated master dark in Results is a
/// candidate offered once; Dismiss holds for that file and digest while it
/// stays listed in Calibration, and changed content is a new offer.
#[tokio::test]
async fn master_offered_once_dismiss_by_digest() {
    let world = world().await;
    prepared(&world).await;
    let master = results_dir(&world).join("master_dark.fit");
    stack(&master, &[("IMAGETYP", "'Dark'"), ("STACKCNT", "20")]);
    let listing = world.library.rescan_results(run(&world)).await.unwrap();
    let record = find(&listing.candidates, &master).clone();
    assert_eq!(record.state, ResultState::Candidate);
    assert_eq!(record.kind, Some(ResultKind::CalibrationMaster { input: InputKind::Dark }));
    assert_eq!(listing.offers.len(), 1);
    let offer = listing.offers[0].clone();
    assert_eq!(offer.state, MasterOfferState::Offered);
    assert_eq!(Some(&offer.sha256), record.sha256.as_ref());
    let again = world.library.rescan_results(run(&world)).await.unwrap();
    assert_eq!(
        again.offers.iter().map(|o| o.id).collect::<Vec<_>>(),
        vec![offer.id],
        "offered once"
    );

    let catalog = world.library.catalog();
    let dismissed = catalog.dismiss_master_offer(offer.id).await.unwrap();
    assert_eq!(dismissed.state, MasterOfferState::Dismissed);
    let listing = world.library.rescan_results(run(&world)).await.unwrap();
    assert!(listing.offers.is_empty(), "not offered again for this file and digest");
    let masters = catalog.result_masters().await.unwrap();
    assert_eq!(
        masters.iter().map(|m| (m.id, m.state)).collect::<Vec<_>>(),
        vec![(offer.id, MasterOfferState::Dismissed)]
    );
    refused(&catalog.dismiss_master_offer(offer.id).await.unwrap_err(), "already");

    stack(&master, &[("IMAGETYP", "'Dark'"), ("STACKCNT", "21")]);
    let listing = world.library.rescan_results(run(&world)).await.unwrap();
    assert_eq!(listing.offers.len(), 1, "changed content is a new offer");
    assert_ne!(listing.offers[0].id, offer.id);
    assert_ne!(listing.offers[0].sha256, offer.sha256);
}

/// CAL-AC-12, D05: a dismissed Results master can still be adopted through
/// the adoption flow, and its offer then reads Adopted.
#[tokio::test]
async fn dismissed_result_master_still_adopted() {
    let world = world().await;
    prepared(&world).await;
    let master = results_dir(&world).join("master_flat.fit");
    stack(&master, &[("IMAGETYP", "'Flat'"), ("FILTER", "'Ha'"), ("STACKCNT", "30")]);
    let listing = world.library.rescan_results(run(&world)).await.unwrap();
    let record = find(&listing.candidates, &master).clone();
    let catalog = world.library.catalog();
    catalog.dismiss_master_offer(listing.offers[0].id).await.unwrap();
    world
        .library
        .register_location(
            NativePath::from_path(&world.output),
            "Processing".into(),
            LocationRole::Results,
        )
        .await
        .unwrap();
    let calibration_root = native(&world.calibration.path);
    std::fs::create_dir_all(calibration_root.join("masters")).unwrap();
    let destination = AdoptionDestination {
        location_id: world.calibration.id,
        relative_path: NativePath::from_path(Path::new("masters/master_flat.fit")),
    };
    let source = AdoptionSource::Result { result_id: record.id };
    let review = world.library.calibration_review_adoption(&source, &destination).await.unwrap();
    assert_eq!(review.source.result_id, Some(record.id));
    assert_eq!(Some(&review.source.sha256), record.sha256.as_ref());
    let operation = world.library.calibration_adopt(review.id, review.revision).await.unwrap();
    assert_eq!(operation.state, AdoptionState::Completed, "{operation:?}");
    assert_eq!(digest(&calibration_root.join("masters/master_flat.fit")), digest(&master));
    assert!(
        catalog.result_masters().await.unwrap().is_empty(),
        "an adopted master leaves the list"
    );
}
