// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calibration inventory reads (spec 068): raw sets and detected candidates
//! from indexed locations, one copy per logical capture, and matching without a
//! View for the current light Sessions. Reads change no row and no file.
#![cfg(unix)]

#[path = "support/calibration.rs"]
mod calibration_support;
mod support;

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use calibration_support::*;
use persistence_library::{CalibrationInputSummary, Catalog, InputQuery, LocationReferences};
use platevault_model::{
    Availability, CandidateRef, EvidenceField, InputForm, InputKind, Location, LocationRole,
    MasterBasis, MasterOrigin, Quality, ReferenceKind, RequirementState, Session,
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

/// Matching without a View (the evidence seam of CAL-FR-12) reads every listed
/// input for the current members of the given light Sessions; a stale Session
/// or a repeated kind is refused.
#[tokio::test]
async fn matching_without_a_view_reads_the_current_sessions_and_refuses_a_stale_one() {
    let lib = indexed().await;
    let catalog = &lib.catalog;
    let light_a = asset_named(&lib, "lights/Ha_001.fits");
    let light_b = asset_named(&lib, "lights/Ha_002.fits");
    let session = session_of(catalog, light_a).await;
    let rows_before = dump_tables(&lib.fx.db, &LIBRARY_TABLES).await;

    let rules = TestRules::default();
    let kinds = [InputKind::Flat, InputKind::Dark];
    let matched =
        catalog.calibration_match(&[expected_session(&session)], &kinds, &rules).await.unwrap();
    let basis = rules.last_basis();
    assert_eq!((basis.view_id, basis.view_revision), (Uuid::nil(), 0), "no View is read");
    assert_eq!(basis.plan.required_kinds, [InputKind::Dark, InputKind::Flat]);
    let [light] = basis.lights.as_slice() else { panic!("{:#?}", basis.lights) };
    assert_eq!(light.evidence.session_id, session.id);
    assert_eq!(light.included_assets, [light_a, light_b].into(), "every current member");
    assert!(light.light_type_known && !light.product);
    assert_eq!(
        light.evidence.capture.get(EvidenceField::Night).unwrap().value,
        "2026-09-18@date-loc-noon"
    );
    assert!(basis.decisions.is_empty());
    assert_eq!(basis.candidates.len(), 6, "every listed input, candidates included");
    let states: Vec<_> = matched.iter().map(|r| (r.kind, r.state)).collect();
    assert_eq!(
        states,
        [
            (InputKind::Dark, RequirementState::Suggested),
            (InputKind::Flat, RequirementState::Suggested)
        ]
    );
    assert!(matched.iter().all(|r| r.preselected.unwrap().form() == InputForm::RawSet));

    let mut stale = expected_session(&session);
    stale.grouping_revision += 1;
    let error = catalog.calibration_match(&[stale], &[InputKind::Dark], &rules).await.unwrap_err();
    assert_eq!(kind(&error), "conflict");
    let twice = [InputKind::Dark, InputKind::Dark];
    let error =
        catalog.calibration_match(&[expected_session(&session)], &twice, &rules).await.unwrap_err();
    assert_eq!(kind(&error), "invalid_input");

    // Reads start no rehash: verification state and every library row stay as they were.
    unchanged(&lib, &rows_before).await;
}

/// A Trashed frame is never an input (LIB-FR-18): it leaves its raw set, and a
/// Trashed master is no longer a candidate.
#[tokio::test]
async fn trashed_frames_are_never_listed() {
    let lib = indexed().await;
    let flat = asset_named(&lib, "flats/Ha/Flat_Ha_003.fits");
    let master = asset_named(&lib, "masters/MasterDark_300s.xisf");
    // No catalog write trashes a frame yet, so store the model's encoding directly.
    let encoding = serde_json::to_value(Availability::Trashed).unwrap();
    let mut conn = raw(&lib.fx.db).await;
    for id in [flat, master] {
        sqlx::query("UPDATE assets SET availability = ?1 WHERE id = ?2")
            .bind(encoding.as_str().unwrap())
            .bind(id.to_string())
            .execute(&mut conn)
            .await
            .unwrap();
    }
    sqlx::Connection::close(conn).await.unwrap();

    let rows = inputs(&lib, &InputQuery::default()).await;
    let ha = row(&rows, &lib, "flats/Ha/Flat_Ha_001.fits");
    assert_eq!(ha.state.members, 2, "the Trashed flat leaves its raw set");
    assert!(!ha.member_assets.contains(&flat));
    assert!(
        rows.iter().all(|row| !row.member_assets.contains(&master)),
        "a Trashed master is no candidate: {rows:#?}"
    );
    assert_eq!(rows.iter().filter(|row| row.form == InputForm::Candidate).count(), 1);
}

/// A catalog recorded at another schema version is refused before any module's
/// DDL runs, so no adoption table is created in it.
#[tokio::test]
async fn a_catalog_recorded_at_an_older_schema_version_gets_no_adoption_tables() {
    const ADOPTION_TABLES: &str =
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'adopt%'";
    let fx = Fixture::new();
    Catalog::open(&fx.db).await.unwrap().close().await.unwrap();
    let mut conn = raw(&fx.db).await;
    let tables: Vec<String> =
        sqlx::query_scalar(ADOPTION_TABLES).fetch_all(&mut conn).await.unwrap();
    assert_eq!(tables.len(), 3, "{tables:?}");
    // The older shape: every library table and no adoption table.
    let older = persistence_library::SCHEMA_VERSION - 1;
    sqlx::raw_sql(sqlx::AssertSqlSafe(format!(
        "DROP TABLE adoption_operations; DROP TABLE adopted_masters; DROP TABLE adoption_reviews; \
         UPDATE catalog_meta SET value = {older} WHERE key = 'schema_version';"
    )))
    .execute(&mut conn)
    .await
    .unwrap();
    sqlx::Connection::close(conn).await.unwrap();

    let error = Catalog::open(&fx.db).await.err().expect("an older catalog is refused");
    assert_eq!(kind(&error), "invalid_input");
    assert_eq!(
        error.to_string(),
        format!("invalid input: unsupported catalog schema version {older}")
    );
    let mut conn = raw(&fx.db).await;
    let tables: Vec<String> =
        sqlx::query_scalar(ADOPTION_TABLES).fetch_all(&mut conn).await.unwrap();
    assert!(tables.is_empty(), "no DDL of this version ran: {tables:?}");
}
