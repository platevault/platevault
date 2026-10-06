// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calibration plans and decisions (spec 068): required kinds, accept and
//! exception with D19 hashing, withdrawal, R13 revision applicability and the
//! PREP handoff read. Refused writes change no calibration, digest or asset row.
#![cfg(unix)]

mod support;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use persistence_library::{Catalog, SessionQuery};
use platevault_model::{
    AdoptionDestination, AdoptionSource, Availability, CalibrationViewPlan, CandidateRef,
    CriteriaInput, CriterionId, DecisionItem, DraftEdit, InputForm, InputKind, InputRef, Location,
    LocationRole, MemberState, NativePath, NewView, RequirementState, Resolution, Session,
    UnresolvedReason, Verdict, ViewOriginInput,
};
use support::*;
use uuid::Uuid;

const CALIBRATION_TABLES: [&str; 2] = ["calibration_plans", "calibration_decisions"];
/// Library rows an input Session's evidence lives in.
const EVIDENCE_TABLES: [&str; 4] = ["sessions", "session_members", "associations", "corrections"];

struct Lib {
    fx: Fixture,
    catalog: Catalog,
    calibration: Location,
    calibration_root: PathBuf,
    names: BTreeMap<String, Uuid>,
    /// 18 Sep Ha and 24 Sep OIII light Sessions.
    ha: Session,
    oiii: Session,
    view: Uuid,
}

/// The quickstart subset: 18 Sep Ha and 24 Sep OIII lights with `RedCat` train
/// headers; 300 s and 120 s darks, Ha flats with the train, 26 Sep OIII flats
/// without it and a `PixInsight` master dark. The View holds both light Sessions.
async fn library() -> Lib {
    let fx = Fixture::new();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let captures = catalog.register_location(&fx.registration()).await.unwrap();
    let light = |filter, night| with_train(calibration_frame("LIGHT", Some(filter), 300.0, night));
    scan_frames(
        &catalog,
        &captures,
        vec![
            frame(&fx.root, "lights/Ha_18_001.fits", light("Ha", "2026-09-18")),
            frame(&fx.root, "lights/Ha_18_002.fits", light("Ha", "2026-09-18")),
            frame(&fx.root, "lights/OIII_24_001.fits", light("OIII", "2026-09-24")),
            frame(&fx.root, "lights/OIII_24_002.fits", light("OIII", "2026-09-24")),
        ],
    )
    .await;
    let (calibration, root) =
        location_at(&catalog, &fx, "Astro-T7/Calibration", LocationRole::Calibration).await;
    std::fs::create_dir_all(root.join("masters")).unwrap();
    let dark = |exposure| calibration_frame("DARK", None, exposure, "2026-09-18");
    let flat = || with_train(calibration_frame("FLAT", Some("Ha"), 2.0, "2026-09-18"));
    let oiii = || calibration_frame("FLAT", Some("OIII"), 2.0, "2026-09-26");
    let mut master_dark = calibration_frame("Master Dark", None, 300.0, "2026-09-20");
    master_dark.stack_count = None;
    // A byte-identical dark: one SHA-256, so the accepted basis lists it once.
    std::fs::create_dir_all(root.join("darks")).unwrap();
    std::fs::write(root.join("darks/Dark_300s_003.fits"), b"darks/Dark_300s_001.fits").unwrap();
    scan_frames(
        &catalog,
        &calibration,
        vec![
            frame(&root, "darks/Dark_300s_001.fits", dark(300.0)),
            frame(&root, "darks/Dark_300s_002.fits", dark(300.0)),
            frame(&root, "darks/Dark_300s_003.fits", dark(300.0)),
            frame(&root, "darks/Dark_120s_001.fits", dark(120.0)),
            frame(&root, "flats/Ha/Flat_Ha_001.fits", flat()),
            frame(&root, "flats/Ha/Flat_Ha_002.fits", flat()),
            frame(&root, "flats/OIII/Flat_OIII_001.fits", oiii()),
            frame(&root, "flats/OIII/Flat_OIII_002.fits", oiii()),
            frame(&root, "masters/MasterDark_300s.xisf", master_dark),
        ],
    )
    .await;
    let mut names = BTreeMap::new();
    for location in [captures.id, calibration.id] {
        for asset in catalog.location_assets(location).await.unwrap() {
            names.insert(asset.relative_path.display(), asset.id);
        }
    }
    let ha = session_of(&catalog, names["lights/Ha_18_001.fits"]).await;
    let oiii = session_of(&catalog, names["lights/OIII_24_001.fits"]).await;
    let view = saved_view(&catalog, "NGC7000 HOO - Siril", &[&ha, &oiii]).await;
    Lib { fx, catalog, calibration, calibration_root: root, names, ha, oiii, view }
}

async fn session_of(catalog: &Catalog, asset: Uuid) -> Session {
    let sessions = catalog.list_sessions(&SessionQuery::default()).await.unwrap();
    sessions.into_iter().find(|s| s.session.asset_ids.contains(&asset)).unwrap().session
}

async fn saved_view(catalog: &Catalog, name: &str, sessions: &[&Session]) -> Uuid {
    let record = catalog
        .create_view(&NewView {
            origin: ViewOriginInput::Sessions {
                sessions: sessions.iter().map(|session| expected_session(session)).collect(),
            },
            name: Some(name.into()),
            criteria: CriteriaInput::default(),
            framing_revision: None,
            suggestions: Vec::new(),
        })
        .await
        .unwrap();
    catalog.save_view(record.view.id, 0, 1).await.unwrap();
    record.view.id
}

fn rules() -> TestRules {
    TestRules::default()
}

async fn plan(lib: &Lib, revision: u64) -> CalibrationViewPlan {
    lib.catalog.calibration_view_plan(lib.view, revision, &rules()).await.unwrap()
}

fn requirement(
    plan: &CalibrationViewPlan,
    session: &Session,
    kind: InputKind,
) -> platevault_model::Requirement {
    plan.requirements
        .iter()
        .find(|r| r.light_session_id == session.id && r.kind == kind)
        .cloned()
        .unwrap_or_else(|| panic!("no {kind:?} requirement for {}: {plan:#?}", session.id))
}

/// The raw set holding `name`, as a decision input.
async fn raw_set(lib: &Lib, name: &str) -> InputRef {
    let session = session_of(&lib.catalog, lib.names[name]).await;
    InputRef::RawSet { session_id: session.id, grouping_revision: session.grouping_revision }
}

fn item(session: &Session, kind: InputKind, input: InputRef) -> DecisionItem {
    DecisionItem { light_session_id: session.id, kind, input }
}

/// The preselected suggestion of every suggested requirement.
fn suggestions(plan: &CalibrationViewPlan) -> Vec<DecisionItem> {
    plan.requirements
        .iter()
        .filter(|r| r.state == RequirementState::Suggested)
        .map(|r| DecisionItem {
            light_session_id: r.light_session_id,
            kind: r.kind,
            input: r.preselected.unwrap().input().unwrap(),
        })
        .collect()
}

fn path_of(lib: &Lib, name: &str) -> PathBuf {
    lib.calibration_root.join(name)
}

async fn rows(lib: &Lib, tables: &[&str]) -> BTreeMap<String, Vec<String>> {
    dump_tables(&lib.fx.db, tables).await
}

#[tokio::test]
async fn a_plan_reads_revision_zero_and_each_write_moves_it_by_exactly_one() {
    let lib = library().await;
    let catalog = &lib.catalog;
    let unplanned = plan(&lib, 1).await;
    assert_eq!(unplanned.plan_revision, 0);
    assert_eq!(unplanned.required_kinds, [InputKind::Dark, InputKind::Flat], "default kinds");

    let kinds = [InputKind::Flat, InputKind::Bias, InputKind::Dark];
    let planned = catalog.set_required_kinds(lib.view, 1, 0, &kinds).await.unwrap();
    assert_eq!(planned.revision, 1);
    assert_eq!(planned.required_kinds, [InputKind::Bias, InputKind::Dark, InputKind::Flat]);
    assert!(planned.updated_at.is_some());
    let stale = catalog.set_required_kinds(lib.view, 1, 0, &kinds).await.unwrap_err();
    assert_eq!(kind(&stale), "conflict", "{stale}");
    assert_eq!(stale.response(None, None).current_revision, Some(1));
    let twice = [InputKind::Dark, InputKind::Dark];
    let duplicate = catalog.set_required_kinds(lib.view, 1, 1, &twice).await.unwrap_err();
    assert_eq!(kind(&duplicate), "invalid_input", "{duplicate}");
    let none = catalog.set_required_kinds(lib.view, 1, 1, &[]).await.unwrap();
    assert_eq!((none.revision, none.required_kinds.len()), (2, 0), "an empty set is recorded");
    assert!(plan(&lib, 1).await.requirements.is_empty());

    // A later committed View revision makes revision 1 read-only.
    let exclude = DraftEdit::SetFrames {
        member_keys: vec![lib.names["lights/Ha_18_002.fits"]],
        state: MemberState::Excluded,
    };
    catalog.edit_view_draft(lib.view, 0, &exclude).await.unwrap();
    catalog.save_view(lib.view, 1, 1).await.unwrap();
    let old = catalog.set_required_kinds(lib.view, 1, 2, &kinds).await.unwrap_err();
    assert_eq!(kind(&old), "conflict", "{old}");
    assert_eq!(old.response(None, None).current_revision, Some(2), "the latest View revision");
    let missing = catalog.set_required_kinds(Uuid::new_v4(), 1, 0, &kinds).await.unwrap_err();
    assert_eq!(kind(&missing), "not_found");

    let before = rows(&lib, &CALIBRATION_TABLES).await;
    let Lib { fx, catalog, .. } = lib;
    catalog.close().await.unwrap();
    Catalog::open(&fx.db).await.unwrap().close().await.unwrap();
    assert_eq!(dump_tables(&fx.db, &CALIBRATION_TABLES).await, before, "restart keeps the plan");
}

#[tokio::test]
async fn accepting_hashes_every_input_binds_its_digest_and_records_the_basis() {
    let lib = library().await;
    let before = plan(&lib, 1).await;
    let items = suggestions(&before);
    assert_eq!(items.len(), 3, "darks for both lights and Ha flats: {before:#?}");
    assert!(lib
        .catalog
        .asset(lib.names["darks/Dark_300s_001.fits"])
        .await
        .unwrap()
        .last_verified_at
        .is_none());

    let accepted =
        lib.catalog.accept_calibration(lib.view, 1, 0, &items, &rules(), DiskProbe).await.unwrap();
    assert_eq!(accepted.plan_revision, 1);
    for item in &items {
        let r = accepted
            .requirements
            .iter()
            .find(|r| r.light_session_id == item.light_session_id && r.kind == item.kind)
            .unwrap();
        assert_eq!(r.state, RequirementState::Accepted, "{r:#?}");
        let effective = r.effective.as_ref().unwrap();
        assert!(effective.applicable);
        assert_eq!((effective.decided_at_revision, effective.decision.plan_revision), (1, 1));
        assert_eq!(effective.decision.resolution, Resolution::Accepted);
        assert_eq!(effective.decision.input, Some(item.input));
        assert!(!effective.decision.criteria.is_empty(), "the criteria snapshot is kept");
        assert!(effective.decision.criteria.iter().all(|c| c.verdict == Verdict::Compatible));
    }
    let dark = requirement(&accepted, &lib.ha, InputKind::Dark).effective.unwrap().decision;
    assert_eq!(dark.light_asset_ids, lib.ha.asset_ids.iter().copied().collect::<BTreeSet<_>>());
    let shas: BTreeSet<String> =
        dark.inputs.iter().map(|file| file.fingerprint.content_sha256.clone().unwrap()).collect();
    assert_eq!(shas.len(), dark.inputs.len(), "one copy per SHA-256");
    let expected: BTreeSet<String> =
        ["darks/Dark_300s_001.fits", "darks/Dark_300s_002.fits", "darks/Dark_300s_003.fits"]
            .iter()
            .map(|name| sha_of(&path_of(&lib, name)))
            .collect();
    assert_eq!((shas.clone(), shas.len()), (expected, 2), "the byte-identical dark counts once");
    for file in &dark.inputs {
        assert_eq!(file.location_id, lib.calibration.id);
        let asset = lib.catalog.asset(file.asset_id.unwrap()).await.unwrap();
        assert_eq!(asset.relative_path, file.relative_path);
        assert_eq!(
            asset.fingerprint.content_sha256, file.fingerprint.content_sha256,
            "digest bound"
        );
        assert!(asset.last_verified_at.is_some(), "last_verified_at bound");
        let on_disk = sha_of(&lib.calibration_root.join(file.relative_path.to_path_buf().unwrap()));
        assert_eq!(file.fingerprint.content_sha256.as_deref(), Some(on_disk.as_str()));
    }
    let stale = lib
        .catalog
        .accept_calibration(lib.view, 1, 0, &items, &rules(), DiskProbe)
        .await
        .unwrap_err();
    assert_eq!(kind(&stale), "conflict", "{stale}");
    assert_eq!(stale.response(None, None).current_revision, Some(1));
}

#[tokio::test]
async fn refused_accepts_change_no_decision_digest_or_asset_row() {
    let lib = library().await;
    let catalog = &lib.catalog;
    let tables = [&CALIBRATION_TABLES[..], &["assets", "quality_decisions"]].concat();
    let before = rows(&lib, &tables).await;
    let view = lib.view;
    let refuse = |items: Vec<DecisionItem>| async move {
        catalog.accept_calibration(view, 1, 0, &items, &rules(), DiskProbe).await.unwrap_err()
    };

    let oiii_flats = raw_set(&lib, "flats/OIII/Flat_OIII_001.fits").await;
    let unknown = refuse(vec![item(&lib.oiii, InputKind::Flat, oiii_flats)]).await;
    assert_eq!(kind(&unknown), "invalid_input", "{unknown}");
    assert!(unknown.to_string().contains("optical_train"), "the criterion is named: {unknown}");
    let short = raw_set(&lib, "darks/Dark_120s_001.fits").await;
    let incompatible = refuse(vec![item(&lib.ha, InputKind::Dark, short)]).await;
    assert_eq!(kind(&incompatible), "invalid_input");
    assert!(incompatible.to_string().contains("exposure"), "{incompatible}");
    let candidate = lib.names["masters/MasterDark_300s.xisf"];
    let unadopted = InputRef::Master { master_id: candidate, revision: 1 };
    let not_master = refuse(vec![item(&lib.ha, InputKind::Dark, unadopted)]).await;
    assert_eq!(kind(&not_master), "invalid_input", "an unadopted master is no input: {not_master}");
    let darks = raw_set(&lib, "darks/Dark_300s_001.fits").await;
    let empty = refuse(Vec::new()).await;
    assert_eq!(kind(&empty), "invalid_input");

    let drifted = path_of(&lib, "darks/Dark_300s_002.fits");
    std::fs::write(&drifted, b"re-shot dark with other bytes").unwrap();
    let ha_flats = raw_set(&lib, "flats/Ha/Flat_Ha_001.fits").await;
    let drift = refuse(vec![
        item(&lib.ha, InputKind::Flat, ha_flats),
        item(&lib.ha, InputKind::Dark, darks),
    ])
    .await;
    assert_eq!(kind(&drift), "identity_conflict", "{drift}");
    assert_eq!(
        drift.response(None, None).scope,
        Some(NativePath::from_path(&drifted)),
        "names the file"
    );
    assert_eq!(rows(&lib, &tables).await, before, "no decision, digest or asset row changed");

    catalog
        .mark_location_unavailable(lib.calibration.id, Availability::Offline, "unplugged")
        .await
        .unwrap();
    let before_offline = rows(&lib, &tables).await;
    let offline = refuse(vec![item(&lib.ha, InputKind::Flat, ha_flats)]).await;
    assert_eq!(kind(&offline), "source_unavailable", "{offline}");
    assert_eq!(rows(&lib, &tables).await, before_offline, "the offline refusal changes nothing");
    assert_eq!(plan(&lib, 1).await.plan_revision, 0);
}

#[tokio::test]
async fn an_exception_snapshots_the_waived_criterion_scoped_to_one_view() {
    let lib = library().await;
    let catalog = &lib.catalog;
    let oiii_flats = raw_set(&lib, "flats/OIII/Flat_OIII_001.fits").await;
    let exception = item(&lib.oiii, InputKind::Flat, oiii_flats);
    let evidence_before = rows(&lib, &EVIDENCE_TABLES).await;
    let flats_before: Vec<_> =
        futures_assets(&lib, &["flats/OIII/Flat_OIII_001.fits", "flats/OIII/Flat_OIII_002.fits"])
            .await;

    let blank = catalog
        .record_calibration_exception(lib.view, 1, 0, &exception, "   ", &rules(), DiskProbe)
        .await
        .unwrap_err();
    assert_eq!(kind(&blank), "invalid_input");
    let ha_flats = raw_set(&lib, "flats/Ha/Flat_Ha_001.fits").await;
    let compatible = catalog
        .record_calibration_exception(
            lib.view,
            1,
            0,
            &item(&lib.ha, InputKind::Flat, ha_flats),
            "no reason needed",
            &rules(),
            DiskProbe,
        )
        .await
        .unwrap_err();
    assert_eq!(kind(&compatible), "invalid_input", "accept it instead: {compatible}");

    let reason = "  Same rotation as 26 Sep; train not changed ";
    let excepted = catalog
        .record_calibration_exception(lib.view, 1, 0, &exception, reason, &rules(), DiskProbe)
        .await
        .unwrap();
    let r = requirement(&excepted, &lib.oiii, InputKind::Flat);
    assert_eq!(r.state, RequirementState::Excepted);
    let decision = r.effective.unwrap().decision;
    assert_eq!(decision.resolution, Resolution::Exception);
    assert_eq!(decision.reason.as_deref(), Some("Same rotation as 26 Sep; train not changed"));
    let train =
        decision.criteria.iter().find(|c| c.criterion == CriterionId::OpticalTrain).unwrap();
    assert_eq!(train.verdict, Verdict::Unknown, "the waived criterion is snapshotted");
    assert_eq!(decision.inputs.len(), 2);

    assert_eq!(rows(&lib, &EVIDENCE_TABLES).await, evidence_before, "input evidence is unchanged");
    let flats_after =
        futures_assets(&lib, &["flats/OIII/Flat_OIII_001.fits", "flats/OIII/Flat_OIII_002.fits"])
            .await;
    for (before, after) in flats_before.iter().zip(&flats_after) {
        assert_eq!((&before.observed, &before.effective), (&after.observed, &after.effective));
        assert_eq!(before.decision_revision, after.decision_revision);
    }

    let standalone = saved_view(catalog, "24 Sep only", &[&lib.oiii]).await;
    let other = catalog.calibration_view_plan(standalone, 1, &rules()).await.unwrap();
    let r = requirement(&other, &lib.oiii, InputKind::Flat);
    assert_eq!(
        (r.state, r.reason),
        (RequirementState::Unresolved, Some(UnresolvedReason::CriterionUnknown))
    );
    assert!(r.effective.is_none(), "an exception never applies to another View");

    // Withdrawal appends a row; the earlier rows stay as history.
    let withdrawn = catalog
        .withdraw_calibration(lib.view, 1, 1, &[(lib.oiii.id, InputKind::Flat)], &rules())
        .await
        .unwrap();
    assert_eq!(withdrawn.plan_revision, 2);
    let r = requirement(&withdrawn, &lib.oiii, InputKind::Flat);
    assert_eq!(
        (r.state, r.reason),
        (RequirementState::Unresolved, Some(UnresolvedReason::CriterionUnknown))
    );
    assert!(r.effective.is_none());
    let history = rows(&lib, &["calibration_decisions"]).await;
    assert_eq!(history["calibration_decisions"].len(), 2);
    assert!(history["calibration_decisions"][1].contains("'withdrawn'"));
    let again = catalog
        .withdraw_calibration(lib.view, 1, 2, &[(lib.oiii.id, InputKind::Flat)], &rules())
        .await
        .unwrap_err();
    assert_eq!(kind(&again), "invalid_input", "nothing left to withdraw: {again}");
}

async fn futures_assets(lib: &Lib, names: &[&str]) -> Vec<platevault_model::Asset> {
    let mut assets = Vec::new();
    for name in names {
        assets.push(lib.catalog.asset(lib.names[*name]).await.unwrap());
    }
    assets
}

#[tokio::test]
async fn the_handoff_names_only_accepted_and_excepted_inputs_under_r13() {
    let lib = library().await;
    let catalog = &lib.catalog;
    let first = catalog.calibration_handoff(lib.view, 1, &rules()).await.unwrap();
    assert!(!first.ready);
    assert!(first.assignments.is_empty(), "suggestions never appear as assignments");
    let reasons: Vec<_> =
        first.unresolved.iter().map(|u| (u.light_session_id, u.kind, u.reason)).collect();
    assert!(reasons.contains(&(
        lib.ha.id,
        InputKind::Dark,
        UnresolvedReason::SuggestionUnaccepted
    )));
    assert!(reasons.contains(&(lib.oiii.id, InputKind::Flat, UnresolvedReason::CriterionUnknown)));

    let items = suggestions(&plan(&lib, 1).await);
    catalog.accept_calibration(lib.view, 1, 0, &items, &rules(), DiskProbe).await.unwrap();
    let oiii_flats = raw_set(&lib, "flats/OIII/Flat_OIII_001.fits").await;
    catalog
        .record_calibration_exception(
            lib.view,
            1,
            1,
            &item(&lib.oiii, InputKind::Flat, oiii_flats),
            "Same rotation as 26 Sep; train not changed",
            &rules(),
            DiskProbe,
        )
        .await
        .unwrap();
    let verified = rows(&lib, &["assets"]).await;
    let ready = catalog.calibration_handoff(lib.view, 1, &rules()).await.unwrap();
    assert!(ready.ready, "{ready:#?}");
    assert_eq!((ready.plan_revision, ready.assignments.len()), (2, 4));
    assert!(ready.unresolved.is_empty());
    let flat = ready
        .assignments
        .iter()
        .find(|a| a.light_session_id == lib.oiii.id && a.kind == InputKind::Flat)
        .unwrap();
    assert_eq!((flat.form, flat.resolution), (InputForm::RawSet, Resolution::Exception));
    assert_eq!(flat.reason.as_deref(), Some("Same rotation as 26 Sep; train not changed"));
    let files: BTreeSet<_> = flat.inputs.iter().map(|file| file.asset_id.unwrap()).collect();
    let expected: BTreeSet<_> =
        [lib.names["flats/OIII/Flat_OIII_001.fits"], lib.names["flats/OIII/Flat_OIII_002.fits"]]
            .into();
    assert_eq!(files, expected, "raw-set assignments list their files");
    assert_eq!(rows(&lib, &["assets"]).await, verified, "the handoff read starts no rehash");

    // Revision 2 drops one Ha frame: only that Session's decisions stop applying.
    let exclude = DraftEdit::SetFrames {
        member_keys: vec![lib.names["lights/Ha_18_002.fits"]],
        state: MemberState::Excluded,
    };
    catalog.edit_view_draft(lib.view, 0, &exclude).await.unwrap();
    catalog.save_view(lib.view, 1, 1).await.unwrap();
    let later = catalog.calibration_handoff(lib.view, 2, &rules()).await.unwrap();
    assert!(!later.ready);
    let reasons: Vec<_> =
        later.unresolved.iter().map(|u| (u.light_session_id, u.kind, u.reason)).collect();
    assert_eq!(reasons.len(), 2, "{reasons:?}");
    assert!(reasons.contains(&(
        lib.ha.id,
        InputKind::Dark,
        UnresolvedReason::LightMembershipChanged
    )));
    assert!(reasons.contains(&(
        lib.ha.id,
        InputKind::Flat,
        UnresolvedReason::LightMembershipChanged
    )));
    let kept: BTreeSet<_> = later
        .assignments
        .iter()
        .map(|a| (a.light_session_id, a.kind, a.decided_at_revision))
        .collect();
    assert_eq!(kept, [(lib.oiii.id, InputKind::Dark, 1), (lib.oiii.id, InputKind::Flat, 1)].into());

    let before = rows(&lib, &CALIBRATION_TABLES).await;
    let Lib { fx, catalog, .. } = lib;
    catalog.close().await.unwrap();
    Catalog::open(&fx.db).await.unwrap().close().await.unwrap();
    assert_eq!(
        dump_tables(&fx.db, &CALIBRATION_TABLES).await,
        before,
        "restart restores every decision"
    );
}

#[tokio::test]
async fn an_adopted_master_is_accepted_and_handed_off_with_its_destination_fingerprint() {
    let lib = library().await;
    let catalog = &lib.catalog;
    let (results, results_root) =
        location_at(catalog, &lib.fx, "Work/Processing", LocationRole::Results).await;
    let mut master = with_train(calibration_frame("Flat", Some("Ha"), 2.0, "2026-09-20"));
    master.stack_count = Some(30);
    let relative = "NGC7000-HOO-Siril/output/master_flat_Ha.fit";
    scan_frames(catalog, &results, vec![frame(&results_root, relative, master)]).await;
    let source = catalog.location_assets(results.id).await.unwrap().remove(0);
    let review = catalog
        .review_adoption(
            &AdoptionSource::Asset { asset_id: source.id, expected: expected(&source) },
            &AdoptionDestination {
                location_id: lib.calibration.id,
                relative_path: NativePath::from_path(Path::new("masters/master_flat_Ha.fit")),
            },
            &rules(),
            DiskProbe,
        )
        .await
        .unwrap();
    let adopted =
        catalog.adopt_master(review.id, review.revision, DiskProbe).await.unwrap().master.unwrap();

    let current = plan(&lib, 1).await;
    let flat = requirement(&current, &lib.ha, InputKind::Flat);
    let listed = flat
        .candidates
        .iter()
        .find(|c| c.candidate == CandidateRef::Master { master_id: adopted.id, revision: 1 })
        .expect("the adopted master lists as a reusable candidate");
    assert_eq!(listed.evaluation.verdict, Verdict::Compatible);
    let input = InputRef::Master { master_id: adopted.id, revision: 1 };
    catalog
        .accept_calibration(
            lib.view,
            1,
            0,
            &[item(&lib.ha, InputKind::Flat, input)],
            &rules(),
            DiskProbe,
        )
        .await
        .unwrap();
    let handoff = catalog.calibration_handoff(lib.view, 1, &rules()).await.unwrap();
    let assignment = handoff
        .assignments
        .iter()
        .find(|a| a.light_session_id == lib.ha.id && a.kind == InputKind::Flat)
        .unwrap();
    assert_eq!(assignment.form, InputForm::Master);
    let [file] = assignment.inputs.as_slice() else { panic!("{:#?}", assignment.inputs) };
    assert_eq!((file.master_id, file.asset_id), (Some(adopted.id), None));
    assert_eq!(
        (file.location_id, &file.relative_path),
        (adopted.location_id, &adopted.relative_path)
    );
    assert_eq!(
        file.fingerprint, adopted.fingerprint,
        "the destination fingerprint with its SHA-256"
    );
    assert_eq!(
        file.fingerprint.content_sha256.as_deref(),
        Some(sha_of(&path_of(&lib, "masters/master_flat_Ha.fit")).as_str())
    );
}
