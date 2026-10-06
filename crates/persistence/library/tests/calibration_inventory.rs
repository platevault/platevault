// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calibration inventory reads (spec 068): raw sets and detected candidates
//! from indexed locations, one copy per logical capture, and the View basis
//! read from a committed revision. Reads change no row and no file.
#![cfg(unix)]

mod support;

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use persistence_library::{CalibrationInputSummary, Catalog, InputQuery, LocationReferences};
use platevault_model::{
    Availability, CandidateRef, CriteriaInput, DraftEdit, EvidenceField, InputForm, InputKind,
    Location, LocationRole, MasterBasis, MasterOrigin, MemberState, NewView, Quality,
    ReferenceKind, RequirementState, Session, ViewOriginInput,
};
use support::*;
use uuid::Uuid;

/// Library rows no calibration read may touch.
const LIBRARY_TABLES: [&str; 6] =
    ["assets", "sessions", "session_members", "quality_decisions", "associations", "corrections"];

struct Lib {
    fx: Fixture,
    catalog: Catalog,
    captures: Location,
    calibration: Location,
    calibration_root: PathBuf,
    /// Asset id by location-relative path, for both quickstart locations.
    names: BTreeMap<String, Uuid>,
    before: BTreeMap<PathBuf, (u64, String)>,
}

/// The quickstart subset: 18 Sep Ha lights and 300 s darks in Captures; Ha flats
/// with optical-train headers plus a Siril master flat in the same session, 26 Sep
/// OIII flats without train evidence, 120 s darks and a `PixInsight` master dark in
/// Calibration.
async fn indexed() -> Lib {
    let fx = Fixture::new();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let captures = catalog.register_location(&fx.registration()).await.unwrap();
    let light = || with_train(calibration_frame("LIGHT", Some("Ha"), 300.0, "2026-09-18"));
    let dark = || calibration_frame("DARK", None, 300.0, "2026-09-18");
    scan_frames(
        &catalog,
        &captures,
        vec![
            frame(&fx.root, "lights/Ha_001.fits", light()),
            frame(&fx.root, "lights/Ha_002.fits", light()),
            frame(&fx.root, "darks/Dark_300s_001.fits", dark()),
            frame(&fx.root, "darks/Dark_300s_002.fits", dark()),
        ],
    )
    .await;
    let (calibration, root) =
        location_at(&catalog, &fx, "Astro-T7/Calibration", LocationRole::Calibration).await;
    let flat = || with_train(calibration_frame("FLAT", Some("Ha"), 2.0, "2026-09-18"));
    let oiii = || calibration_frame("FLAT", Some("OIII"), 2.0, "2026-09-26");
    let mut master_flat = flat();
    master_flat.stack_count = Some(30);
    let mut master_dark = calibration_frame("Master Dark", None, 300.0, "2026-09-20");
    master_dark.stack_count = None;
    scan_frames(
        &catalog,
        &calibration,
        vec![
            frame(&root, "flats/Ha/Flat_Ha_001.fits", flat()),
            frame(&root, "flats/Ha/Flat_Ha_002.fits", flat()),
            frame(&root, "flats/Ha/Flat_Ha_003.fits", flat()),
            frame(&root, "flats/Ha/master_flat_Ha.fit", master_flat),
            frame(&root, "flats/OIII/Flat_OIII_001.fits", oiii()),
            frame(&root, "flats/OIII/Flat_OIII_002.fits", oiii()),
            frame(
                &root,
                "darks/Dark_120s_001.fits",
                calibration_frame("DARK", None, 120.0, "2026-09-18"),
            ),
            frame(&root, "masters/MasterDark_300s.xisf", master_dark),
        ],
    )
    .await;
    let before = tree(fx.temp.path());
    let mut names = BTreeMap::new();
    for location in [captures.id, calibration.id] {
        for asset in catalog.location_assets(location).await.unwrap() {
            names.insert(asset.relative_path.display(), asset.id);
        }
    }
    Lib { fx, catalog, captures, calibration, calibration_root: root, names, before }
}

async fn inputs(lib: &Lib, query: &InputQuery) -> Vec<CalibrationInputSummary> {
    lib.catalog.calibration_inputs(query, &TestRules::default()).await.unwrap()
}

/// The listed row whose evidence copy lives at `path` (raw sets) or is `path`.
fn row<'a>(
    rows: &'a [CalibrationInputSummary],
    lib: &Lib,
    name: &str,
) -> &'a CalibrationInputSummary {
    let id = asset_named(lib, name);
    rows.iter()
        .find(|row| row.member_assets.contains(&id))
        .unwrap_or_else(|| panic!("no row holds {name}: {rows:#?}"))
}

fn asset_named(lib: &Lib, name: &str) -> Uuid {
    *lib.names.get(name).unwrap_or_else(|| panic!("no fixture asset {name}: {:?}", lib.names))
}

/// Fixture files other than the catalog's own database files.
fn sources(files: BTreeMap<PathBuf, (u64, String)>) -> BTreeMap<PathBuf, (u64, String)> {
    files.into_iter().filter(|(path, _)| !path.to_string_lossy().starts_with("catalog")).collect()
}

async fn unchanged(lib: &Lib, rows: &BTreeMap<String, Vec<String>>) {
    assert_eq!(&dump_tables(&lib.fx.db, &LIBRARY_TABLES).await, rows, "library rows unchanged");
    assert_eq!(
        sources(tree(lib.fx.temp.path())),
        sources(lib.before.clone()),
        "fixture files unchanged"
    );
}

#[tokio::test]
async fn raw_sets_and_candidates_list_grouped_with_their_missing_evidence() {
    let lib = indexed().await;
    let rows_before = dump_tables(&lib.fx.db, &LIBRARY_TABLES).await;
    let rows = inputs(&lib, &InputQuery::default()).await;

    let forms: BTreeMap<InputForm, usize> = rows.iter().fold(BTreeMap::new(), |mut counts, row| {
        *counts.entry(row.form).or_default() += 1;
        counts
    });
    assert_eq!(forms, [(InputForm::RawSet, 4), (InputForm::Candidate, 2)].into(), "{rows:#?}");
    assert!(rows.windows(2).all(|pair| pair[0].group <= pair[1].group), "rows are grouped");

    let darks = row(&rows, &lib, "darks/Dark_300s_001.fits");
    assert_eq!(
        (darks.kind, darks.form, darks.state.members),
        (InputKind::Dark, InputForm::RawSet, 2)
    );
    assert_eq!(darks.location_ids, vec![lib.captures.id], "a Captures location lists raw sets too");
    assert!(darks.reusable);
    assert_eq!(darks.group.camera.as_deref(), Some("ASI2600MM"));
    assert_eq!(
        (darks.group.gain.as_deref(), darks.group.offset.as_deref()),
        (Some("100"), Some("50"))
    );
    assert_eq!(darks.group.dimensions.as_deref(), Some("6248x4176"));
    assert_eq!(darks.group.binning.as_deref(), Some("1x1"));
    let short = row(&rows, &lib, "darks/Dark_120s_001.fits");
    assert_eq!(short.location_ids, vec![lib.calibration.id]);
    assert_ne!(short.input, darks.input);

    let ha = row(&rows, &lib, "flats/Ha/Flat_Ha_001.fits");
    assert_eq!(
        (ha.kind, ha.state.members),
        (InputKind::Flat, 3),
        "the master member is not a raw frame"
    );
    assert!(!ha.member_assets.contains(&asset_named(&lib, "flats/Ha/master_flat_Ha.fit")));
    assert_eq!(ha.group.channel.as_deref(), Some("Ha"));
    assert!(ha.missing.is_empty(), "{:?}", ha.missing);
    let oiii = row(&rows, &lib, "flats/OIII/Flat_OIII_001.fits");
    assert_eq!(oiii.group.channel.as_deref(), Some("OIII"));
    assert!(oiii.missing.contains(&EvidenceField::Telescope), "{:?}", oiii.missing);
    assert!(oiii.missing.contains(&EvidenceField::FocalLength));

    let siril = row(&rows, &lib, "flats/Ha/master_flat_Ha.fit");
    assert_eq!((siril.form, siril.kind), (InputForm::Candidate, InputKind::Flat));
    assert_eq!(
        siril.input,
        CandidateRef::Candidate { asset_id: asset_named(&lib, "flats/Ha/master_flat_Ha.fit") }
    );
    assert_eq!(siril.master.as_ref().unwrap().basis, MasterBasis::HeaderStackCount);
    assert!(!siril.reusable, "detection never makes a master reusable");
    let MasterOrigin::Location { location_id, relative_path, .. } = siril.origin.clone().unwrap()
    else {
        panic!("an indexed candidate's origin is its location and path")
    };
    assert_eq!(location_id, lib.calibration.id);
    assert_eq!(relative_path.display(), "flats/Ha/master_flat_Ha.fit");
    let pixinsight = row(&rows, &lib, "masters/MasterDark_300s.xisf");
    assert_eq!(pixinsight.master.as_ref().unwrap().basis, MasterBasis::HeaderImagetyp);
    assert!(!pixinsight.reusable);
    assert!(rows.iter().all(|row| row.input.form() == row.form));

    let only_flats =
        inputs(&lib, &InputQuery { kind: Some(InputKind::Flat), ..InputQuery::default() }).await;
    assert_eq!(only_flats.len(), 3);
    let candidates =
        inputs(&lib, &InputQuery { form: Some(InputForm::Candidate), ..InputQuery::default() })
            .await;
    assert_eq!(candidates.len(), 2);
    let in_captures =
        inputs(&lib, &InputQuery { location_id: Some(lib.captures.id), ..InputQuery::default() })
            .await;
    assert_eq!(in_captures.len(), 1);
    let page = inputs(&lib, &InputQuery { offset: 1, limit: 2, ..InputQuery::default() }).await;
    assert_eq!(
        page.iter().map(|r| r.input).collect::<Vec<_>>(),
        rows[1..3].iter().map(|r| r.input).collect::<Vec<_>>()
    );

    let detail = lib.catalog.calibration_input(&ha.input, &TestRules::default()).await.unwrap();
    assert_eq!(detail.members.len(), 3);
    assert!(detail.excluded.is_empty());
    let unknown = CandidateRef::Candidate { asset_id: Uuid::new_v4() };
    let error = lib.catalog.calibration_input(&unknown, &TestRules::default()).await.unwrap_err();
    assert_eq!(kind(&error), "not_found");
    unchanged(&lib, &rows_before).await;
}

#[tokio::test]
async fn one_copy_per_capture_with_unusable_members_excluded_and_offline_ones_counted() {
    let lib = indexed().await;
    let catalog = &lib.catalog;
    // Cold-1 holds a byte-identical copy of Flat_Ha_001; both copies are hashed so they join.
    let (cold, cold_root) =
        location_at(catalog, &lib.fx, "Cold-1/Calibration", LocationRole::Calibration).await;
    let copy = cold_root.join("flats/Ha/Flat_Ha_001.fits");
    std::fs::create_dir_all(copy.parent().unwrap()).unwrap();
    std::fs::copy(lib.calibration_root.join("flats/Ha/Flat_Ha_001.fits"), &copy).unwrap();
    scan_frames(
        catalog,
        &cold,
        vec![frame(
            &cold_root,
            "flats/Ha/Flat_Ha_001.fits",
            with_train(calibration_frame("FLAT", Some("Ha"), 2.0, "2026-09-18")),
        )],
    )
    .await;
    for location in [lib.calibration.id, cold.id] {
        let assets = catalog.location_assets(location).await.unwrap();
        catalog.verify_digest(by_name(&assets, "Flat_Ha_001.fits").id, DiskProbe).await.unwrap();
    }
    let rows = inputs(&lib, &InputQuery::default()).await;
    let ha = row(&rows, &lib, "flats/Ha/Flat_Ha_002.fits");
    assert_eq!(ha.state.members, 3, "byte-identical copies in two locations count once");
    assert_eq!(
        ha.location_ids.iter().copied().collect::<BTreeSet<_>>(),
        [lib.calibration.id, cold.id].into()
    );
    assert_eq!(
        rows.iter().filter(|r| r.form == InputForm::RawSet).count(),
        4,
        "no second Ha raw set"
    );

    let assets = catalog.location_assets(lib.calibration.id).await.unwrap();
    let unusable = by_name(&assets, "Flat_Ha_002.fits");
    catalog.set_quality(&[expected(unusable)], Quality::Unusable, DiskProbe).await.unwrap();
    let rows = inputs(&lib, &InputQuery::default()).await;
    let ha = row(&rows, &lib, "flats/Ha/Flat_Ha_003.fits");
    assert_eq!((ha.state.members, ha.state.excluded_members), (2, 1));
    let detail = catalog.calibration_input(&ha.input, &TestRules::default()).await.unwrap();
    assert_eq!(detail.excluded.len(), 1);
    assert!(detail.excluded[0].copies.iter().any(|copy| copy.asset_id == unusable.id));

    catalog
        .mark_location_unavailable(lib.captures.id, Availability::Offline, "unplugged")
        .await
        .unwrap();
    let rows = inputs(&lib, &InputQuery::default()).await;
    let darks = row(&rows, &lib, "darks/Dark_300s_001.fits");
    assert_eq!(darks.state.members, 2, "offline members are counted, never absence");
    assert_eq!(darks.state.available_members, 0);
    assert_eq!(darks.state.availability, Availability::Offline);
    assert!(!darks.state.available());
}

#[tokio::test]
async fn retired_copies_are_not_listed() {
    let lib = indexed().await;
    let catalog = &lib.catalog;
    let (old, old_root) =
        location_at(catalog, &lib.fx, "Old/Calibration", LocationRole::Calibration).await;
    scan_frames(
        catalog,
        &old,
        vec![
            frame(
                &old_root,
                "bias/Bias_001.fits",
                calibration_frame("BIAS", None, 0.0, "2026-08-01"),
            ),
            frame(
                &old_root,
                "bias/Bias_002.fits",
                calibration_frame("BIAS", None, 0.0, "2026-08-01"),
            ),
        ],
    )
    .await;
    let bias = InputQuery { kind: Some(InputKind::Bias), ..InputQuery::default() };
    assert_eq!(inputs(&lib, &bias).await.len(), 1);
    let assets: BTreeSet<Uuid> =
        catalog.location_assets(old.id).await.unwrap().iter().map(|a| a.id).collect();
    let references =
        LocationReferences { references: Vec::new(), assets, consulted: vec![ReferenceKind::View] };
    catalog.mark_location_unavailable(old.id, Availability::Offline, "unplugged").await.unwrap();
    let review = catalog.review_retire_location(old.id, &references).await.unwrap();
    catalog
        .retire_location(review.id, old.id, review.expected_revision, &references)
        .await
        .unwrap();
    assert!(inputs(&lib, &bias).await.is_empty(), "a Retired location's copies are not listed");
    assert_eq!(inputs(&lib, &InputQuery::default()).await.len(), 6);
}

async fn session_of(catalog: &Catalog, asset: Uuid) -> Session {
    let detail = catalog.asset(asset).await.unwrap();
    let summaries =
        catalog.list_sessions(&persistence_library::SessionQuery::default()).await.unwrap();
    summaries.into_iter().find(|s| s.session.asset_ids.contains(&detail.id)).unwrap().session
}

#[tokio::test]
async fn the_view_plan_reads_each_light_sessions_included_assets_from_the_committed_revision() {
    let lib = indexed().await;
    let catalog = &lib.catalog;
    let light_a = asset_named(&lib, "lights/Ha_001.fits");
    let light_b = asset_named(&lib, "lights/Ha_002.fits");
    let session = session_of(catalog, light_a).await;
    let view = catalog
        .create_view(&NewView {
            origin: ViewOriginInput::Sessions { sessions: vec![expected_session(&session)] },
            name: Some("NGC7000 HOO - Siril".into()),
            criteria: CriteriaInput::default(),
            framing_revision: None,
            suggestions: Vec::new(),
        })
        .await
        .unwrap();
    let id = view.view.id;
    catalog.save_view(id, 0, 1).await.unwrap();
    catalog
        .edit_view_draft(
            id,
            0,
            &DraftEdit::SetFrames { member_keys: vec![light_b], state: MemberState::Excluded },
        )
        .await
        .unwrap();
    catalog.save_view(id, 1, 1).await.unwrap();
    let rows_before = dump_tables(&lib.fx.db, &LIBRARY_TABLES).await;

    let rules = TestRules::default();
    let plan = catalog.calibration_view_plan(id, 2, &rules).await.unwrap();
    let basis = rules.last_basis();
    assert_eq!((basis.view_id, basis.view_revision, basis.plan.revision), (id, 2, 0));
    assert_eq!(basis.plan.required_kinds, [InputKind::Dark, InputKind::Flat], "default kinds");
    let [light] = basis.lights.as_slice() else { panic!("{:#?}", basis.lights) };
    assert_eq!(light.evidence.session_id, session.id);
    assert_eq!(light.included_assets, [light_a].into(), "only the included member of revision 2");
    assert!(light.light_type_known && !light.product);
    assert_eq!(
        light.evidence.capture.get(EvidenceField::Night).unwrap().value,
        "2026-09-18@date-loc-noon"
    );
    assert!(basis.decisions.is_empty());
    assert_eq!(basis.candidates.len(), 6, "every listed input, candidates included");
    let states: Vec<_> = plan.requirements.iter().map(|r| (r.kind, r.state)).collect();
    assert_eq!(
        states,
        [
            (InputKind::Dark, RequirementState::Suggested),
            (InputKind::Flat, RequirementState::Suggested)
        ]
    );
    assert!(plan.requirements.iter().all(|r| r.preselected.unwrap().form() == InputForm::RawSet));

    // A non-current revision reads too: revision 1 holds both frames.
    catalog.calibration_view_plan(id, 1, &rules).await.unwrap();
    assert_eq!(rules.last_basis().lights[0].included_assets, [light_a, light_b].into());
    let error = catalog.calibration_view_plan(id, 3, &rules).await.unwrap_err();
    assert_eq!(kind(&error), "not_found");
    let error = catalog.calibration_view_plan(Uuid::new_v4(), 1, &rules).await.unwrap_err();
    assert_eq!(kind(&error), "not_found");

    // Matching without a View reads the same candidates for these sessions.
    let matched = catalog
        .calibration_match(&[expected_session(&session)], &[InputKind::Dark], &rules)
        .await
        .unwrap();
    assert_eq!(matched.len(), 1);
    assert_eq!(matched[0].state, RequirementState::Suggested);
    assert_eq!(rules.last_basis().lights[0].included_assets, [light_a, light_b].into());
    let mut stale = expected_session(&session);
    stale.grouping_revision += 1;
    let error = catalog.calibration_match(&[stale], &[InputKind::Dark], &rules).await.unwrap_err();
    assert_eq!(kind(&error), "conflict");

    // Reads start no rehash: verification state and every library row stay as they were.
    unchanged(&lib, &rows_before).await;
}

#[tokio::test]
async fn a_catalog_recorded_at_schema_version_8_is_refused_before_any_ddl() {
    let fx = Fixture::new();
    Catalog::open(&fx.db).await.unwrap().close().await.unwrap();
    let mut conn = raw(&fx.db).await;
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' \
         AND (name LIKE 'calibration%' OR name LIKE 'adopt%')",
    )
    .fetch_all(&mut conn)
    .await
    .unwrap();
    assert_eq!(tables.len(), 5, "{tables:?}");
    // The version 8 shape: every table up to the View tables and no calibration table.
    let drops: String = [
        "calibration_decisions",
        "adoption_operations",
        "adopted_masters",
        "adoption_reviews",
        "calibration_plans",
    ]
    .map(|table| format!("DROP TABLE {table};"))
    .concat();
    sqlx::raw_sql(sqlx::AssertSqlSafe(format!(
        "{drops} UPDATE catalog_meta SET value = 8 WHERE key = 'schema_version';"
    )))
    .execute(&mut conn)
    .await
    .unwrap();
    sqlx::Connection::close(conn).await.unwrap();

    let error = Catalog::open(&fx.db).await.err().expect("a version 8 catalog is refused");
    assert_eq!(kind(&error), "invalid_input");
    assert_eq!(error.to_string(), "invalid input: unsupported catalog schema version 8");
    let mut conn = raw(&fx.db).await;
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE name LIKE 'calibration%' OR name LIKE 'adopt%'",
    )
    .fetch_all(&mut conn)
    .await
    .unwrap();
    assert!(tables.is_empty(), "no DDL of this version ran: {tables:?}");
}
