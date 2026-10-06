// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calibration inputs (spec 068) on the composed library: real FITS and XISF
//! headers, the real calibration rules and the real disk probe, from inventory
//! through a View plan, accept and exception, the PREP handoff, master
//! adoption, custody facts and Retire location references, to a restart. A
//! SHA-256 manifest proves only the adopted copy is new.
#![cfg(unix)]

mod support;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use persistence_library::{InputQuery, SessionQuery};
use platevault_core::library::Library;
use platevault_core::*;
use uuid::Uuid;

const SIZE: (u32, u32) = (6248, 4176);
const VIEW_NAME: &str = "NGC7000 HOO - Siril";
const SOURCE: &str = "NGC7000-HOO-Siril/output/master_flat_Ha.fit";
const DESTINATION: &str = "masters/master_flat_Ha.fit";
const REASON: &str = "Same rotation as 26 Sep; train not changed";

/// Shared quickstart headers: ASI2600MM, gain 100, offset 50, binning 1 and a
/// -10 C setpoint, captured on `night` (frame `index`).
fn header(
    image_type: &str,
    exposure: &str,
    night: &str,
    index: usize,
) -> Vec<(&'static str, String)> {
    vec![
        ("IMAGETYP", format!("'{image_type}'")),
        ("INSTRUME", "'ASI2600MM'".into()),
        ("EXPTIME", exposure.into()),
        ("DATE-OBS", format!("'{night}T20:{index:02}:00'")),
        ("DATE-LOC", format!("'{night}T22:{index:02}:00'")),
        ("XBINNING", "1".into()),
        ("YBINNING", "1".into()),
        ("GAIN", "100".into()),
        ("OFFSET", "50".into()),
        ("SET-TEMP", "-10".into()),
        ("CCD-TEMP", "-9.8".into()),
    ]
}

fn with_train(mut fields: Vec<(&'static str, String)>) -> Vec<(&'static str, String)> {
    fields.push(("TELESCOP", "'RedCat 51'".into()));
    fields.push(("FOCALLEN", "250".into()));
    fields
}

fn write(root: &Path, relative: &str, fields: &[(&'static str, String)]) {
    let path = root.join(relative);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let fields: Vec<(&str, &str)> =
        fields.iter().map(|(key, value)| (*key, value.as_str())).collect();
    if path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("xisf")) {
        support::xisf_sized(&path, SIZE, &fields).unwrap();
    } else {
        support::fits_sized(&path, SIZE, &fields).unwrap();
    }
}

/// Every file below `root` other than the catalog's own, with its SHA-256.
fn manifest(root: &Path) -> BTreeMap<PathBuf, String> {
    let mut files = BTreeMap::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(folder) = pending.pop() {
        for entry in std::fs::read_dir(&folder).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                pending.push(path);
            } else if !path.file_name().unwrap().to_string_lossy().starts_with("library.sqlite") {
                files
                    .insert(path.strip_prefix(root).unwrap().to_path_buf(), support::digest(&path));
            }
        }
    }
    files
}

/// Start a scan and wait for its terminal event, published after scan-time work.
async fn scan_to_end(library: &Arc<Library>, location: Uuid) -> ScanOperation {
    let mut progress = library.subscribe_scan_progress();
    let started = library.start_scan(location, None).await.unwrap();
    tokio::time::timeout(Duration::from_secs(60), async {
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

struct World {
    temp: tempfile::TempDir,
    database: PathBuf,
    library: Arc<Library>,
    captures: Uuid,
    calibration: Uuid,
    results: Uuid,
}

/// The quickstart subset: 18 Sep Ha and 24 Sep OIII lights with train headers;
/// 300 s and 120 s darks, Ha flats with the train, 26 Sep OIII flats without
/// it and a `PixInsight` master dark in `Astro-T7/Calibration`; a Siril master
/// flat (STACKCNT 30) in `Work/Processing`.
async fn world() -> World {
    let temp = tempfile::tempdir().unwrap();
    let captures_root = temp.path().join("Astro-T7/Captures");
    let calibration_root = temp.path().join("Astro-T7/Calibration");
    let results_root = temp.path().join("Work/Processing");
    for (filter, night) in [("Ha", "2026-09-18"), ("OIII", "2026-09-24")] {
        for index in 0..2 {
            let mut fields = with_train(header("LIGHT", "300", night, index));
            fields.push(("FILTER", format!("'{filter}'")));
            fields.push(("OBJECT", "'NGC 7000'".into()));
            fields.push(("RA", "314.75".into()));
            fields.push(("DEC", "44.33".into()));
            write(&captures_root, &format!("{night}/{filter}_{index:02}.fits"), &fields);
        }
    }
    std::fs::create_dir_all(calibration_root.join("masters")).unwrap();
    for index in 0..2 {
        let dark = |exposure| header("DARK", exposure, "2026-09-18", index);
        write(&calibration_root, &format!("darks/Dark_300s_{index:03}.fits"), &dark("300"));
        write(&calibration_root, &format!("darks/Dark_120s_{index:03}.fits"), &dark("120"));
        let mut ha = with_train(header("FLAT", "2", "2026-09-18", index));
        ha.push(("FILTER", "'Ha'".into()));
        write(&calibration_root, &format!("flats/Ha/Flat_Ha_{index:03}.fits"), &ha);
        let mut oiii = header("FLAT", "2", "2026-09-26", index);
        oiii.push(("FILTER", "'OIII'".into()));
        write(&calibration_root, &format!("flats/OIII/Flat_OIII_{index:03}.fits"), &oiii);
    }
    write(
        &calibration_root,
        "MasterDark_300s.xisf",
        &header("Master Dark", "300", "2026-09-20", 0),
    );
    let mut master = with_train(header("Flat", "2", "2026-09-20", 0));
    master.push(("FILTER", "'Ha'".into()));
    master.push(("STACKCNT", "30".into()));
    write(&results_root, SOURCE, &master);

    let database = temp.path().join("library.sqlite");
    let library = Library::open(&database, None).await.unwrap();
    let mut ids = Vec::new();
    for (root, name, role) in [
        (&captures_root, "Astro-T7/Captures", LocationRole::Captures),
        (&calibration_root, "Astro-T7/Calibration", LocationRole::Calibration),
        (&results_root, "Work/Processing", LocationRole::Results),
    ] {
        let location = library
            .register_location(NativePath::from_path(root), name.into(), role)
            .await
            .unwrap();
        assert_eq!(scan_to_end(&library, location.id).await.state, ScanState::Completed);
        ids.push(location.id);
    }
    World { temp, database, library, captures: ids[0], calibration: ids[1], results: ids[2] }
}

impl World {
    async fn asset(&self, location: Uuid, name: &str) -> Asset {
        let assets = self.library.catalog().location_assets(location).await.unwrap();
        assets.into_iter().find(|asset| asset.relative_path.display() == name).unwrap()
    }

    async fn session_of(&self, location: Uuid, name: &str) -> Session {
        let asset = self.asset(location, name).await.id;
        let sessions =
            self.library.catalog().list_sessions(&SessionQuery::default()).await.unwrap();
        sessions.into_iter().find(|s| s.session.asset_ids.contains(&asset)).unwrap().session
    }

    async fn raw_set(&self, name: &str) -> InputRef {
        let session = self.session_of(self.calibration, name).await;
        InputRef::RawSet { session_id: session.id, grouping_revision: session.grouping_revision }
    }
}

fn expected(session: &Session) -> ExpectedSession {
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

fn requirement(plan: &CalibrationViewPlan, session: &Session, kind: InputKind) -> Requirement {
    plan.requirements
        .iter()
        .find(|r| r.light_session_id == session.id && r.kind == kind)
        .cloned()
        .unwrap_or_else(|| panic!("no {kind:?} requirement for {}: {plan:#?}", session.id))
}

fn json<T: serde::Serialize>(value: &T) -> serde_json::Value {
    serde_json::to_value(value).unwrap()
}

#[expect(clippy::too_many_lines, reason = "one quickstart scenario over one composed library")]
#[tokio::test]
async fn the_quickstart_calibration_flow_runs_on_the_composed_library() {
    let world = world().await;
    let library = &world.library;
    let originals = manifest(world.temp.path());

    // 1. Inventory: raw sets by kind and settings; both masters are candidates
    // with their evidence basis, and none of them is reusable.
    let inputs = library.calibration_inputs(&InputQuery::default()).await.unwrap();
    let raw =
        |kind| inputs.iter().filter(move |row| row.form == InputForm::RawSet && row.kind == kind);
    assert_eq!((raw(InputKind::Dark).count(), raw(InputKind::Flat).count()), (2, 2), "{inputs:#?}");
    let oiii_flats = raw(InputKind::Flat)
        .find(|row| row.group.channel.as_deref() == Some("OIII"))
        .expect("the 26 Sep OIII flats list");
    assert!(oiii_flats.missing.contains(&EvidenceField::Telescope), "{:?}", oiii_flats.missing);
    let mut bases: Vec<(InputKind, MasterBasis, bool)> = inputs
        .iter()
        .filter(|row| row.form == InputForm::Candidate)
        .map(|row| (row.kind, row.master.as_ref().unwrap().basis, row.reusable))
        .collect();
    bases.sort_by_key(|(kind, ..)| *kind);
    assert_eq!(
        bases,
        [
            (InputKind::Dark, MasterBasis::HeaderImagetyp, false),
            (InputKind::Flat, MasterBasis::HeaderStackCount, false)
        ]
    );
    let source = world.asset(world.results, SOURCE).await;
    let detail =
        library.calibration_input(&CandidateRef::Candidate { asset_id: source.id }).await.unwrap();
    assert_eq!(detail.summary.member_assets, [source.id]);

    // Matching without a View writes nothing and preselects the 300 s darks.
    let ha = world.session_of(world.captures, "2026-09-18/Ha_00.fits").await;
    let oiii = world.session_of(world.captures, "2026-09-24/OIII_00.fits").await;
    let darks = world.raw_set("darks/Dark_300s_000.fits").await;
    let matched = library
        .calibration_match(&[expected(&ha), expected(&oiii)], &[InputKind::Dark])
        .await
        .unwrap();
    assert_eq!(matched.len(), 2);
    assert!(
        matched.iter().all(|r| r.preselected == Some(CandidateRef::from(darks))),
        "{matched:#?}"
    );

    // 2-4. The saved View's plan: dark and flat required, three suggestions,
    // the 24 Sep flat unknown, and a handoff that is not ready.
    let origin = ViewOriginInput::Sessions { sessions: vec![expected(&ha), expected(&oiii)] };
    let view = library.create_view(&origin, Some(VIEW_NAME.into())).await.unwrap().view.id;
    library.catalog().save_view(view, 0, 1).await.unwrap();
    let plan = library.calibration_view_plan(view, 1).await.unwrap();
    assert_eq!(
        (plan.plan_revision, plan.required_kinds.as_slice()),
        (0, [InputKind::Dark, InputKind::Flat].as_slice())
    );
    let ha_flats = world.raw_set("flats/Ha/Flat_Ha_000.fits").await;
    for (session, kind, input) in [
        (&ha, InputKind::Dark, darks),
        (&oiii, InputKind::Dark, darks),
        (&ha, InputKind::Flat, ha_flats),
    ] {
        let required = requirement(&plan, session, kind);
        assert_eq!(required.state, RequirementState::Suggested, "{required:#?}");
        assert_eq!(required.preselected, Some(CandidateRef::from(input)));
    }
    let unknown = requirement(&plan, &oiii, InputKind::Flat);
    assert_eq!(
        (unknown.state, unknown.reason),
        (RequirementState::Unresolved, Some(UnresolvedReason::CriterionUnknown))
    );
    let short = world.raw_set("darks/Dark_120s_000.fits").await;
    let short = requirement(&plan, &ha, InputKind::Dark)
        .candidates
        .into_iter()
        .find(|c| c.candidate == CandidateRef::from(short))
        .expect("the 120 s darks are evaluated");
    let exposure =
        short.evaluation.criteria.iter().find(|c| c.criterion == CriterionId::Exposure).unwrap();
    assert_eq!((exposure.verdict, exposure.tolerance), (Verdict::Incompatible, Tolerance::None));
    let handoff = library.calibration_handoff(view, 1).await.unwrap();
    assert!(!handoff.ready && handoff.assignments.is_empty(), "{handoff:#?}");
    let mut reasons: Vec<UnresolvedReason> = handoff.unresolved.iter().map(|u| u.reason).collect();
    reasons.sort_by_key(|reason| format!("{reason:?}"));
    assert_eq!(
        reasons,
        [
            UnresolvedReason::CriterionUnknown,
            UnresolvedReason::SuggestionUnaccepted,
            UnresolvedReason::SuggestionUnaccepted,
            UnresolvedReason::SuggestionUnaccepted,
        ]
    );
    assert_eq!(manifest(world.temp.path()), originals, "reads and matching touch no file");

    // 5-6. Accept the three suggestions; the 24 Sep flats are refused naming
    // the optical train and take a reasoned exception instead.
    let item =
        |session: &Session, kind, input| DecisionItem { light_session_id: session.id, kind, input };
    let items = [
        item(&ha, InputKind::Dark, darks),
        item(&oiii, InputKind::Dark, darks),
        item(&ha, InputKind::Flat, ha_flats),
    ];
    let accepted = library.calibration_accept(view, 1, 0, &items).await.unwrap();
    assert_eq!(accepted.plan_revision, 1);
    for decided in &items {
        let required = requirement(
            &accepted,
            if decided.light_session_id == ha.id { &ha } else { &oiii },
            decided.kind,
        );
        assert_eq!(required.state, RequirementState::Accepted, "{required:#?}");
    }
    let bound = world.asset(world.calibration, "darks/Dark_300s_000.fits").await;
    assert!(bound.last_verified_at.is_some() && bound.fingerprint.content_sha256.is_some());
    let oiii_flats = world.raw_set("flats/OIII/Flat_OIII_000.fits").await;
    let waived = item(&oiii, InputKind::Flat, oiii_flats);
    let refused =
        library.calibration_accept(view, 1, 1, std::slice::from_ref(&waived)).await.unwrap_err();
    assert!(matches!(refused, LibraryError::InvalidInput(_)), "{refused:?}");
    assert!(refused.to_string().contains("optical_train"), "{refused}");
    let flat_session =
        json(&world.session_of(world.calibration, "flats/OIII/Flat_OIII_000.fits").await);
    let excepted = library.calibration_record_exception(view, 1, 1, &waived, REASON).await.unwrap();
    assert_eq!(excepted.plan_revision, 2);
    assert_eq!(
        json(&world.session_of(world.calibration, "flats/OIII/Flat_OIII_000.fits").await),
        flat_session,
        "an exception edits no input evidence"
    );
    let handoff = library.calibration_handoff(view, 1).await.unwrap();
    assert!(handoff.ready && handoff.unresolved.is_empty(), "{handoff:#?}");
    assert_eq!(handoff.assignments.len(), 4);
    let exception = handoff
        .assignments
        .iter()
        .find(|a| a.resolution == Resolution::Exception)
        .expect("the exception is handed off");
    assert_eq!(exception.reason.as_deref(), Some(REASON));
    assert!(exception
        .criteria
        .iter()
        .any(|c| c.criterion == CriterionId::OpticalTrain && c.verdict == Verdict::Unknown));
    let kinds = library
        .calibration_set_required_kinds(view, 1, 2, &[InputKind::Dark, InputKind::Flat])
        .await
        .unwrap();
    assert_eq!(kinds.revision, 3);

    // 9. Adopt the Siril master flat: the review writes no file; the copy is
    // verified and registered with its provenance, and the source stays.
    let before = manifest(world.temp.path());
    let destination = AdoptionDestination {
        location_id: world.calibration,
        relative_path: NativePath::from_path(Path::new(DESTINATION)),
    };
    let review = library
        .calibration_review_adoption(
            &AdoptionSource::Asset { asset_id: source.id, expected: expected_of(&source) },
            &destination,
        )
        .await
        .unwrap();
    let source_key = PathBuf::from("Work/Processing").join(SOURCE);
    assert_eq!(review.source.sha256, before[&source_key]);
    assert_eq!(manifest(world.temp.path()), before, "a review writes no file");
    let operation = library.calibration_adopt(review.id, review.revision).await.unwrap();
    assert_eq!(
        (operation.state, operation.phase),
        (AdoptionState::Completed, AdoptionPhase::Registered)
    );
    let master = operation.master.clone().expect("the completed operation carries its master");
    let mut adopted = before.clone();
    adopted.insert(
        PathBuf::from("Astro-T7/Calibration").join(DESTINATION),
        before[&source_key].clone(),
    );
    assert_eq!(manifest(world.temp.path()), adopted, "only the adopted copy is new");
    let operations = library.calibration_list_adoptions(None, 0, 0).await.unwrap();
    assert_eq!(operations.iter().map(|op| op.id).collect::<Vec<_>>(), [operation.id]);

    // 13. Custody facts and Retire location references.
    let facts = library.calibration_custody_facts(view).await.unwrap();
    let detected = world.asset(world.calibration, "MasterDark_300s.xisf").await;
    let kept = KeptCopy {
        master_id: master.id,
        location_id: master.location_id,
        relative_path: master.relative_path.clone(),
        fingerprint: master.fingerprint.clone(),
    };
    let mut named: Vec<(CustodyKind, Option<Uuid>, Option<Uuid>, Option<KeptCopy>)> =
        facts.iter().map(|f| (f.kind, f.asset_id, f.master_id, f.kept_copy.clone())).collect();
    named.sort_by_key(|(kind, ..)| format!("{kind:?}"));
    assert_eq!(
        named,
        [
            (CustodyKind::AdoptedMaster, None, Some(master.id), None),
            (CustodyKind::CandidateMaster, Some(detected.id), None, None),
            (CustodyKind::GeneratedSource, Some(source.id), None, Some(kept)),
        ]
    );
    let results_review = library.review_retire_location(world.results).await.unwrap();
    assert!(results_review.consulted.contains(&ReferenceKind::Calibration));
    assert!(
        results_review.references.iter().any(|r| (r.kind, r.id, r.revision)
            == (ReferenceKind::Calibration, master.id, master.revision)),
        "{:?}",
        results_review.references
    );
    let calibration_review = library.review_retire_location(world.calibration).await.unwrap();
    let named_view = |review: &RetireReview| {
        review
            .references
            .iter()
            .find(|r| (r.kind, r.id) == (ReferenceKind::Calibration, view))
            .map(|r| (r.name.clone(), r.revision))
    };
    assert_eq!(named_view(&calibration_review), Some((VIEW_NAME.to_owned(), 3)));
    let withdrawn =
        library.calibration_withdraw(view, 1, 3, &[(oiii.id, InputKind::Flat)]).await.unwrap();
    assert_eq!(withdrawn.plan_revision, 4);
    let stale = library
        .retire_location(
            calibration_review.id,
            world.calibration,
            calibration_review.expected_revision,
        )
        .await
        .unwrap_err();
    assert!(matches!(stale, LibraryError::Conflict { .. }), "{stale:?}");
    let again = library.review_retire_location(world.calibration).await.unwrap();
    assert_eq!(
        named_view(&again),
        Some((VIEW_NAME.to_owned(), 4)),
        "a new review reads the plan again"
    );

    // 14. Restart: plans, decisions, operations and masters return unchanged.
    let plan = json(&library.calibration_view_plan(view, 1).await.unwrap());
    let operations = json(&library.calibration_list_adoptions(None, 0, 0).await.unwrap());
    let facts = json(&library.calibration_custody_facts(view).await.unwrap());
    let World { temp, database, library, .. } = world;
    drop(library);
    let reopened = Library::open(&database, None).await.unwrap();
    assert_eq!(json(&reopened.calibration_view_plan(view, 1).await.unwrap()), plan);
    assert_eq!(json(&reopened.calibration_list_adoptions(None, 0, 0).await.unwrap()), operations);
    assert_eq!(json(&reopened.calibration_custody_facts(view).await.unwrap()), facts);

    // 15. Only the adopted copy differs from the original manifest.
    let mut expected_files = originals;
    expected_files.insert(
        PathBuf::from("Astro-T7/Calibration").join(DESTINATION),
        adopted[&PathBuf::from("Astro-T7/Calibration").join(DESTINATION)].clone(),
    );
    assert_eq!(manifest(temp.path()), expected_files);
}
