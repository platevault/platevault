// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The Targets rig selector, Fit, Filters strip and rig-dependent presets
//! (spec 072 PLAN-TGT-FR-06/11/12/13, PLAN-TGT-AC-11..14, PLAN-FR-10 rig
//! context): no rig, one rig or "this Project's rigs"; Fit by the major axis
//! over the field's shorter side, one value per rig; the union of the rigs'
//! bands; Mosaic candidates and Fits nicely only with a rig and matching on
//! any rig; narrowband presets hidden without an Ha, SII or OIII filter; and
//! "-" with the reason when the size or field of view is unknown.

use std::path::Path;
use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::targets::TargetQuery;
use platevault_core::targets_list::fit;
use platevault_core::*;
use time::macros::date;
use uuid::Uuid;

const BACKYARD: (f64, f64) = (52.09, 5.12);

async fn open(database: &Path) -> Arc<Library> {
    Library::open(database, None).await.unwrap()
}

fn rig_record(
    name: &str,
    color_kind: ColorKind,
    focal_length_mm: Option<f64>,
    sensor: (u32, u32),
) -> Equipment {
    Equipment {
        id: Uuid::new_v4(),
        name: name.into(),
        camera: Some(format!("{name} camera")),
        telescope: None,
        focal_length_mm,
        pixel_size_um: Some(3.76),
        sensor_width_px: Some(sensor.0),
        sensor_height_px: Some(sensor.1),
        color_kind: Some(color_kind),
        decision_revision: 0,
        state: AssociationState::Confirmed,
        provenance: Provenance::User,
    }
}

fn filter(name: &str, bands: &[Band]) -> RigFilter {
    RigFilter {
        id: Uuid::new_v4(),
        name: name.into(),
        match_values: vec![name.into()],
        bands: bands.to_vec(),
    }
}

/// A saved rig with its filter list; `focal_length_mm: None` leaves its field
/// of view unknown.
async fn rig(
    library: &Library,
    name: &str,
    color_kind: ColorKind,
    focal_length_mm: Option<f64>,
    filters: &[RigFilter],
) -> Uuid {
    let equipment = rig_record(name, color_kind, focal_length_mm, (6248, 4176));
    let id = library.catalog().save_equipment(&equipment, None).await.unwrap().id;
    if !filters.is_empty() {
        library.save_rig_filters(id, filters, 0).await.unwrap();
    }
    id
}

fn lrgb() -> Vec<RigFilter> {
    vec![
        filter("L", &[Band::L]),
        filter("R", &[Band::R]),
        filter("G", &[Band::G]),
        filter("B", &[Band::B]),
    ]
}

/// `Esprit 100 + ASI2600MM`: mono, 550 mm, a 146.8' × 98.1' field.
async fn esprit(library: &Library) -> Uuid {
    rig(library, "Esprit 100 + ASI2600MM", ColorKind::Mono, Some(550.0), &lrgb()).await
}

/// `RedCat 51 + ASI2600MC`: OSC with a dual-band Ha/OIII filter, 250 mm, a
/// 322.4' × 216.0' field.
async fn redcat_dual_band(library: &Library) -> Uuid {
    let dual = filter("L-eXtreme", &[Band::Ha, Band::Oiii]);
    rig(library, "RedCat 51 + ASI2600MC", ColorKind::Osc, Some(250.0), &[dual]).await
}

async fn seed(library: &Library, text: &str) -> TargetCandidate {
    let query = TargetQuery { text: Some(text.into()), cone: None, limit: 1 };
    library.search_targets(&query).await.unwrap().remove(0).candidate
}

/// A Project with the seed subject `subject` and the rigs, in order.
async fn project(library: &Library, subject: &str, rig_ids: Vec<Uuid>) -> Uuid {
    let target = seed(library, subject).await;
    library.catalog().record_seed_target(&target).await.unwrap();
    let input = ProjectInput {
        name: "Autumn".into(),
        notes: None,
        subjects: vec![SubjectInput {
            target_id: target.id,
            name: None,
            mosaic: false,
            panels: Vec::new(),
        }],
        rig_ids,
        goals: Vec::new(),
    };
    library.catalog().create_project(&input).await.unwrap().id
}

/// Browse Messier with no planning site: rows carry Fit without a night.
fn messier(rigs: RigSelection) -> TargetsQuery {
    TargetsQuery {
        show: TargetsShow::Browse,
        catalogues: vec![Catalogue::Messier],
        preset: None,
        site_id: None,
        night: None,
        criteria: PlanCriteria {
            min_altitude_deg: 30.0,
            darkness: Darkness::Astronomical,
            moon: MoonCriterion::None,
            min_duration_minutes: 30,
        },
        sort: None,
        offset: 0,
        limit: None,
        rigs,
    }
}

fn row<'a>(page: &'a TargetsPage, designation: &str) -> &'a TargetRow {
    page.rows.iter().find(|row| row.target.designation == designation).unwrap()
}

fn labels(row: &TargetRow) -> Vec<(&str, String)> {
    row.fit.iter().map(|rig| (rig.rig_name.as_str(), rig.fit.label())).collect()
}

fn designations(page: &TargetsPage) -> Vec<&str> {
    page.rows.iter().map(|row| row.target.designation.as_str()).collect()
}

const fn size(major_arcmin: f64, minor_arcmin: Option<f64>) -> AngularSize {
    AngularSize { major_arcmin, minor_arcmin, pa_deg: None }
}

/// PLAN-TGT-FR-11, PLAN-TGT-AC-11: coverage is the major axis over the
/// field's shorter side; at least 25% in one field reads "fits", below it
/// "tiny", and a Target larger than the shorter side reads the grid of fields
/// it needs.
#[tokio::test]
async fn fit_fits_n_panels_tiny_by_major_axis_over_short_side() {
    // A 120' × 60' field: the shorter side is 60'.
    let field = Some(FieldOfView { width_deg: 2.0, height_deg: 1.0 });
    let read = |major: f64, minor: Option<f64>| fit(Some(size(major, minor)), field);
    assert_eq!(read(30.0, None), Fit::Fits { coverage: 0.5 });
    assert_eq!(read(15.0, None).label(), "fits", "exactly 25% fits");
    assert_eq!(read(60.0, Some(10.0)).label(), "fits", "exactly the shorter side fits");
    assert_eq!(read(14.0, None).label(), "tiny");
    assert_eq!(read(90.0, Some(10.0)), Fit::Panels { coverage: 1.5, panels: 2 });
    assert_eq!(
        read(90.0, Some(10.0)).label(),
        "2 panels",
        "the major axis decides, not the minor axis or the long side"
    );
    assert_eq!(read(150.0, None).label(), "6 panels", "2 across 120' by 3 across 60'");

    // On the library page with "Esprit 100 + ASI2600MM" selected.
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    let esprit = esprit(&library).await;
    let page =
        library.target_rows(&messier(RigSelection::Rig { equipment_id: esprit })).await.unwrap();
    let rig = &page.rigs[0];
    let field = rig.field_of_view.unwrap();
    assert!((field.height_deg * 60.0 - 98.1).abs() < 0.1, "{field:?}");
    assert_eq!(labels(row(&page, "M 31")), [(rig.name.as_str(), "6 panels".into())]);
    assert_eq!(labels(row(&page, "M 42")), [(rig.name.as_str(), "fits".into())]);
    assert_eq!(labels(row(&page, "M 57")), [(rig.name.as_str(), "tiny".into())]);
    let Fit::Fits { coverage } = row(&page, "M 42").fit[0].fit else { unreachable!() };
    assert!((coverage - 66.0 / (field.height_deg * 60.0)).abs() < 1e-9);

    // With no rig there is no Fit column.
    let none = library.target_rows(&messier(RigSelection::None)).await.unwrap();
    assert!(none.rigs.is_empty());
    assert!(none.rows.iter().all(|row| row.fit.is_empty()));
}

/// PLAN-TGT-FR-11, PLAN-TGT-AC-14, PLAN-FR-10: "this Project's rigs" gives one
/// Fit per rig, labeled with the rig name, in the Project's rig order; one rig
/// gives one value.
#[tokio::test]
async fn fit_one_value_per_rig() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    let esprit = esprit(&library).await;
    let redcat = redcat_dual_band(&library).await;
    let autumn = project(&library, "M 31", vec![esprit, redcat]).await;

    // The selector arrives over IPC as `{"kind": "project", "projectId": …}`.
    let mut wire = serde_json::to_value(messier(RigSelection::None)).unwrap();
    wire["rigs"] = serde_json::json!({ "kind": "project", "projectId": autumn });
    let request: TargetsQuery = serde_json::from_value(wire).unwrap();
    assert_eq!(request.rigs, RigSelection::Project { project_id: autumn });

    let page = library.target_rows(&request).await.unwrap();
    let names: Vec<&str> = page.rigs.iter().map(|rig| rig.name.as_str()).collect();
    assert_eq!(names, ["Esprit 100 + ASI2600MM", "RedCat 51 + ASI2600MC"]);
    assert_eq!(
        labels(row(&page, "M 31")),
        [("Esprit 100 + ASI2600MM", "6 panels".into()), ("RedCat 51 + ASI2600MC", "fits".into())]
    );
    for row in &page.rows {
        let ids: Vec<Uuid> = row.fit.iter().map(|rig| rig.equipment_id).collect();
        assert_eq!(ids, [esprit, redcat], "{}", row.target.designation);
    }
    let json = serde_json::to_value(&row(&page, "M 31").fit[0]).unwrap();
    assert_eq!(json["rigName"], "Esprit 100 + ASI2600MM");
    assert_eq!(json["fit"]["state"], "panels");
    assert_eq!(json["fit"]["panels"], 6);

    let single =
        library.target_rows(&messier(RigSelection::Rig { equipment_id: redcat })).await.unwrap();
    assert_eq!(labels(row(&single, "M 31")), [("RedCat 51 + ASI2600MC", "fits".into())]);

    let unknown = RigSelection::Project { project_id: Uuid::new_v4() };
    let missing = library.target_rows(&messier(unknown)).await.unwrap_err();
    assert!(matches!(missing, LibraryError::NotFound(_)), "{missing:?}");
}

/// PLAN-TGT-FR-06, PLAN-TGT-AC-12/13/14: the Filters strip is all seven
/// bands with no rig, the rig's bands with one, and the union of the
/// Project's rigs' bands; each row's band states follow the strip.
#[tokio::test]
async fn union_of_bands_across_project_rigs() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    let backyard = library
        .save_site(
            None,
            None,
            &SiteInput {
                name: "Backyard".into(),
                latitude_deg: BACKYARD.0,
                longitude_deg: BACKYARD.1,
                elevation_m: None,
                time_zone: "Europe/Amsterdam".into(),
            },
        )
        .await
        .unwrap()
        .site
        .id;
    let esprit = esprit(&library).await;
    let redcat = redcat_dual_band(&library).await;
    let autumn = project(&library, "M 31", vec![esprit, redcat]).await;
    let my_targets = |rigs| TargetsQuery {
        show: TargetsShow::MyTargets,
        catalogues: Vec::new(),
        site_id: Some(backyard),
        night: Some(date!(2026 - 10 - 20)),
        ..messier(rigs)
    };
    let strip = |page: &TargetsPage| {
        let row_bands: Vec<Band> = page.rows[0].bands.iter().map(|state| state.band).collect();
        assert_eq!(row_bands, page.bands, "a row's band states follow the strip");
        page.bands.clone()
    };

    let none = library.target_rows(&my_targets(RigSelection::None)).await.unwrap();
    assert_eq!(strip(&none), [Band::L, Band::R, Band::G, Band::B, Band::Ha, Band::Sii, Band::Oiii]);
    let mono =
        library.target_rows(&my_targets(RigSelection::Rig { equipment_id: esprit })).await.unwrap();
    assert_eq!(strip(&mono), [Band::L, Band::R, Band::G, Band::B]);
    let osc =
        library.target_rows(&my_targets(RigSelection::Rig { equipment_id: redcat })).await.unwrap();
    assert_eq!(strip(&osc), [Band::R, Band::G, Band::B, Band::Ha, Band::Oiii]);
    let both = library
        .target_rows(&my_targets(RigSelection::Project { project_id: autumn }))
        .await
        .unwrap();
    assert_eq!(strip(&both), [Band::L, Band::R, Band::G, Band::B, Band::Ha, Band::Oiii]);
    assert_eq!(
        serde_json::to_value(&both.bands).unwrap(),
        serde_json::json!(["L", "R", "G", "B", "Ha", "OIII"])
    );
}

/// The built-in presets the menu offers for the rigs.
async fn menu(library: &Library, rigs: RigSelection) -> Vec<BuiltinPreset> {
    let presets = library.targets_presets(rigs).await.unwrap();
    presets.builtin.into_iter().map(|info| info.preset).collect()
}

/// PLAN-TGT-FR-12, PLAN-TGT-AC-11/14: Mosaic candidates (2 or more panels)
/// and Fits nicely (coverage 25% to 90%) are offered only with a rig, and
/// with several rigs a Target matches when it matches on any of them.
#[tokio::test]
async fn mosaic_candidates_and_fits_nicely_only_with_rig() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    let esprit = esprit(&library).await;
    let redcat = redcat_dual_band(&library).await;
    let autumn = project(&library, "M 31", vec![esprit, redcat]).await;
    let rig_only = [BuiltinPreset::MosaicCandidates, BuiltinPreset::FitsNicely];
    let with = |rigs, preset| TargetsQuery { preset: Some(preset), ..messier(rigs) };

    let none = menu(&library, RigSelection::None).await;
    assert!(rig_only.iter().all(|preset| !none.contains(preset)), "{none:?}");
    for preset in rig_only {
        let refused = library.target_rows(&with(RigSelection::None, preset)).await.unwrap_err();
        assert!(matches!(refused, LibraryError::InvalidInput(_)), "{refused:?}");
    }

    let one = RigSelection::Rig { equipment_id: esprit };
    let offered = menu(&library, one).await;
    assert!(rig_only.iter().all(|preset| offered.contains(preset)), "{offered:?}");
    let mosaic = library.target_rows(&with(one, BuiltinPreset::MosaicCandidates)).await.unwrap();
    assert!(designations(&mosaic).contains(&"M 31"));
    assert!(mosaic.rows.iter().all(|row| matches!(
        row.fit[0].fit,
        Fit::Panels { panels, .. } if panels >= 2
    )));
    let nicely = library.target_rows(&with(one, BuiltinPreset::FitsNicely)).await.unwrap();
    let names = designations(&nicely);
    assert!(names.contains(&"M 42") && !names.contains(&"M 31") && !names.contains(&"M 57"));
    assert!(nicely.rows.iter().all(|row| matches!(
        row.fit[0].fit,
        Fit::Fits { coverage } if (0.25..=0.90).contains(&coverage)
    )));

    // On either of the Project's rigs: M 31 needs panels only on the Esprit,
    // M 24 (120') fits nicely only on the RedCat.
    let project = RigSelection::Project { project_id: autumn };
    let mosaic = library.target_rows(&with(project, BuiltinPreset::MosaicCandidates)).await;
    let mosaic = mosaic.unwrap();
    assert_eq!(labels(row(&mosaic, "M 31"))[1].1, "fits");
    let nicely = library.target_rows(&with(project, BuiltinPreset::FitsNicely)).await.unwrap();
    assert_eq!(labels(row(&nicely, "M 24"))[0].1, "2 panels");
    assert!(nicely.rows.iter().all(|row| row.fit.iter().any(|rig| rig.fit.fits_nicely())));
    assert!(mosaic.rows.iter().all(|row| row.fit.iter().any(|rig| rig.fit.is_mosaic_candidate())));
}

/// PLAN-TGT-FR-13, PLAN-TGT-AC-12/13: with a rig selected whose filters pass
/// no Ha, SII or OIII, Narrowband (Moon up), Emission nebulae Ha and
/// Planetary nebulae OIII are hidden; a dual-band OSC rig, or no rig, offers
/// them.
#[tokio::test]
async fn narrowband_presets_hidden_without_narrowband_filter() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    let esprit = esprit(&library).await;
    let redcat = redcat_dual_band(&library).await;
    let sii =
        rig(&library, "SII only", ColorKind::Mono, Some(400.0), &[filter("S", &[Band::Sii])]).await;
    let narrowband = [
        BuiltinPreset::NarrowbandMoonUp,
        BuiltinPreset::EmissionNebulaeHa,
        BuiltinPreset::PlanetaryNebulaeOiii,
    ];

    let lrgb = RigSelection::Rig { equipment_id: esprit };
    assert_eq!(
        menu(&library, lrgb).await,
        [
            BuiltinPreset::BestTonightBroadband,
            BuiltinPreset::GalaxiesDarkSky,
            BuiltinPreset::MosaicCandidates,
            BuiltinPreset::FitsNicely,
        ]
    );
    for preset in narrowband {
        let request = TargetsQuery { preset: Some(preset), ..messier(lrgb) };
        let refused = library.target_rows(&request).await.unwrap_err();
        assert!(matches!(refused, LibraryError::InvalidInput(_)), "{refused:?}");
    }
    for rigs in [
        RigSelection::None,
        RigSelection::Rig { equipment_id: redcat },
        RigSelection::Rig { equipment_id: sii },
    ] {
        let offered = menu(&library, rigs).await;
        assert!(narrowband.iter().all(|preset| offered.contains(preset)), "{rigs:?}");
    }
}

/// PLAN-TGT-FR-11 and its edge cases: a Target without a catalogued size reads
/// "-" with "Size unknown", a rig without a field of view reads "-" with
/// "Field of view unknown", and Mosaic candidates and Fits nicely leave them
/// out.
#[tokio::test]
async fn size_or_fov_unknown_reads_dash_with_reason() {
    let field = Some(FieldOfView { width_deg: 2.0, height_deg: 1.0 });
    let no_size = fit(None, field);
    assert_eq!(no_size, Fit::Unknown { reason: FitUnknownReason::SizeUnknown });
    assert_eq!(
        (no_size.label().as_str(), no_size.reason().map(FitUnknownReason::text)),
        ("-", Some("Size unknown"))
    );
    let no_field = fit(Some(size(30.0, None)), None);
    assert_eq!(
        (no_field.label().as_str(), no_field.reason().map(FitUnknownReason::text)),
        ("-", Some("Field of view unknown"))
    );
    assert!(!no_size.is_mosaic_candidate() && !no_size.fits_nicely());

    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    let esprit = esprit(&library).await;
    let blind = rig(&library, "No focal length", ColorKind::Mono, None, &lrgb()).await;

    // NGC 7000 has no catalogued size in the seed.
    let request = TargetsQuery {
        catalogues: vec![Catalogue::Ngc],
        ..messier(RigSelection::Rig { equipment_id: esprit })
    };
    let page = library.target_rows(&request).await.unwrap();
    let ngc7000 = row(&page, "NGC 7000");
    assert_eq!(ngc7000.fit[0].fit, Fit::Unknown { reason: FitUnknownReason::SizeUnknown });
    let json = serde_json::to_value(ngc7000.fit[0].fit).unwrap();
    assert_eq!(json, serde_json::json!({ "state": "unknown", "reason": "size_unknown" }));
    for preset in [BuiltinPreset::MosaicCandidates, BuiltinPreset::FitsNicely] {
        let filtered = TargetsQuery { preset: Some(preset), ..request.clone() };
        let filtered = library.target_rows(&filtered).await.unwrap();
        assert!(!designations(&filtered).contains(&"NGC 7000"));
    }

    let blind = RigSelection::Rig { equipment_id: blind };
    let page = library.target_rows(&messier(blind)).await.unwrap();
    assert_eq!(page.rigs[0].field_of_view, None);
    assert!(
        page.rows
            .iter()
            .all(|row| row.fit[0].fit
                == Fit::Unknown { reason: FitUnknownReason::FieldOfViewUnknown })
    );
    for preset in [BuiltinPreset::MosaicCandidates, BuiltinPreset::FitsNicely] {
        let filtered = TargetsQuery { preset: Some(preset), ..messier(blind) };
        assert_eq!(library.target_rows(&filtered).await.unwrap().total, 0);
    }
}
