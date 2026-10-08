// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The Targets list over the library facade (spec 072 PLAN-TGT-FR-01..05/07..10,
//! PLAN-TGT-AC-01..10/15/16, PV-PLAN-SC-04/05): My targets with Project badges,
//! Browse catalogues, unified search with its sources and "SIMBAD not
//! searched", tonight's planning columns against the Plan area windows, the
//! zero-Img-time reasons, unknown values sorting last, no-site rows, and the
//! built-in and saved presets.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::Path;
use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::targets::{
    user_target, ObjectType, SimbadConfig, TargetQuery, UserTargetInput, ICRS_FRAME,
};
use platevault_core::*;
use time::macros::date;
use time::Date;
use uuid::Uuid;

const BACKYARD: (f64, f64) = (52.09, 5.12);
const TROMSO: (f64, f64) = (69.65, 18.96);

async fn open(database: &Path) -> Arc<Library> {
    Library::open(database, None).await.unwrap()
}

async fn site(library: &Library, name: &str, (lat, lon): (f64, f64), zone: &str) -> Uuid {
    let input = SiteInput {
        name: name.into(),
        latitude_deg: lat,
        longitude_deg: lon,
        elevation_m: None,
        time_zone: zone.into(),
    };
    library.save_site(None, None, &input).await.unwrap().site.id
}

fn criteria(moon: MoonCriterion) -> PlanCriteria {
    PlanCriteria {
        min_altitude_deg: 30.0,
        darkness: Darkness::Astronomical,
        moon,
        min_duration_minutes: 30,
    }
}

fn query(show: TargetsShow, site: Option<Uuid>, night: Date) -> TargetsQuery {
    TargetsQuery {
        show,
        catalogues: Vec::new(),
        preset: None,
        site_id: site,
        night: Some(night),
        criteria: criteria(MoonCriterion::None),
        sort: None,
        offset: 0,
        limit: None,
        rigs: RigSelection::None,
    }
}

async fn seed(library: &Library, text: &str) -> TargetCandidate {
    let query = TargetQuery { text: Some(text.into()), cone: None, limit: 1 };
    library.search_targets(&query).await.unwrap().remove(0).candidate
}

/// A saved user Target in My targets.
async fn mine(library: &Library, designation: &str, at: Option<(f64, f64)>) -> TargetRecord {
    let candidate = user_target(&UserTargetInput {
        designation: designation.into(),
        aliases: Vec::new(),
        common_name: None,
        object_type: ObjectType::Galaxy,
        coordinates: at.map(|(ra_deg, dec_deg)| SkyCoordinates {
            ra_deg,
            dec_deg,
            frame: ICRS_FRAME.into(),
        }),
    })
    .unwrap();
    library.catalog().save_target(&candidate, None).await.unwrap();
    library.add_to_my_targets(&AddTarget::Saved { id: candidate.id }).await.unwrap()
}

fn designations(page: &TargetsPage) -> Vec<&str> {
    page.rows.iter().map(|row| row.target.designation.as_str()).collect()
}

fn row(page: &TargetsPage, id: Uuid) -> &TargetRow {
    page.rows.iter().find(|row| row.target.id == id).unwrap()
}

// ---------------------------------------------------------------------------
// My targets and Browse
// ---------------------------------------------------------------------------

/// PLAN-TGT-AC-01/16, D-W60: My targets lists the ★ favourites and the subjects
/// of open Projects; IC 1396, not ★, carries its "Summer nebulae" badge, and ★
/// on and off leaves it listed.
#[tokio::test]
async fn my_targets_is_favourites_plus_open_project_subjects_with_badge() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    let m31 = seed(&library, "M 31").await;
    let ic1396 = seed(&library, "IC 1396").await;
    let ngc7000 = seed(&library, "NGC 7000").await;
    library.add_to_my_targets(&AddTarget::Seed { id: m31.id }).await.unwrap();
    library.catalog().record_seed_target(&ic1396).await.unwrap();
    library.catalog().record_seed_target(&ngc7000).await.unwrap();
    let rig = Equipment {
        id: Uuid::new_v4(),
        name: "Esprit 100 + ASI2600MM".into(),
        camera: Some("ASI2600MM".into()),
        telescope: Some("Esprit 100".into()),
        focal_length_mm: Some(550.0),
        pixel_size_um: Some(3.76),
        sensor_width_px: Some(6248),
        sensor_height_px: Some(4176),
        color_kind: Some(ColorKind::Mono),
        decision_revision: 0,
        state: AssociationState::Confirmed,
        provenance: Provenance::User,
    };
    let rig = library.catalog().save_equipment(&rig, None).await.unwrap();
    let summer = library
        .catalog()
        .create_project(&ProjectInput {
            name: "Summer nebulae".into(),
            notes: None,
            subjects: vec![SubjectInput {
                target_id: ic1396.id,
                name: None,
                mosaic: false,
                panels: Vec::new(),
            }],
            rig_ids: vec![rig.id],
            goals: Vec::new(),
        })
        .await
        .unwrap();

    let page =
        library.target_rows(&query(TargetsShow::MyTargets, None, date!(2026 - 10 - 10))).await;
    let page = page.unwrap();
    assert_eq!(designations(&page), ["IC 1396", "M 31"], "NGC 7000 is saved but not listed");
    let ic = row(&page, ic1396.id);
    assert!(!ic.favourite);
    assert_eq!(
        ic.projects,
        [ProjectBadge { project_id: summer.id, name: "Summer nebulae".into() }]
    );
    let andromeda = row(&page, m31.id);
    assert!(andromeda.favourite && andromeda.saved && andromeda.projects.is_empty());
    assert!(
        andromeda.target.catalogues.iter().any(|entry| entry.catalogue == Catalogue::Messier),
        "a saved seed Target reads back its catalogue facts"
    );

    for favourite in [true, false] {
        library.set_favourite(ic1396.id, favourite).await.unwrap();
        let page =
            library.target_rows(&query(TargetsShow::MyTargets, None, date!(2026 - 10 - 10))).await;
        let page = page.unwrap();
        assert_eq!(designations(&page), ["IC 1396", "M 31"]);
        assert_eq!(row(&page, ic1396.id).favourite, favourite);
        assert_eq!(row(&page, ic1396.id).projects.len(), 1);
    }
}

/// PLAN-TGT-AC-02, PV-PLAN-SC-05: Browse with no catalogue and no preset lists
/// zero rows and asks for one; Messier then lists the Messier objects.
#[tokio::test]
async fn browse_without_catalogue_or_preset_lists_zero() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    let backyard = site(&library, "Backyard", BACKYARD, "Europe/Amsterdam").await;
    let mut browse = query(TargetsShow::Browse, Some(backyard), date!(2026 - 10 - 10));

    let empty = library.target_rows(&browse).await.unwrap();
    assert!(empty.rows.is_empty());
    assert_eq!(empty.total, 0);
    assert!(empty.needs_catalogue_or_preset);

    browse.catalogues = vec![Catalogue::Messier];
    let messier = library.target_rows(&browse).await.unwrap();
    assert!(!messier.needs_catalogue_or_preset);
    assert!(messier.total >= 100, "{} Messier rows", messier.total);
    assert!(messier.rows.iter().all(|row| {
        row.target.catalogues.iter().any(|entry| entry.catalogue == Catalogue::Messier)
    }));
    let messier_named: Vec<&str> =
        designations(&messier).into_iter().filter(|name| name.starts_with("M ")).collect();
    assert_eq!(&messier_named[..4], ["M 1", "M 2", "M 3", "M 4"], "Designation sorts naturally");
    assert!(messier.rows.iter().all(|row| !row.saved && !row.favourite));

    browse.limit = Some(10);
    browse.offset = 5;
    let page = library.target_rows(&browse).await.unwrap();
    assert_eq!(page.total, messier.total);
    assert_eq!(designations(&page), designations(&messier)[5..15]);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/// Serve one canned SIMBAD TAP answer: the alias query gets `ident`, any other `basic`.
fn serve_tap(basic: &'static str, ident: &'static str) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/simbad/sim-tap/sync", listener.local_addr().unwrap());
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut request = Vec::new();
            let mut buffer = [0_u8; 4096];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                match stream.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => request.extend_from_slice(&buffer[..read]),
                }
            }
            let body = if String::from_utf8_lossy(&request).contains("FROM+ident") {
                ident
            } else {
                basic
            };
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: text/tab-separated-values\r\n\
                 Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        }
    });
    endpoint
}

/// PLAN-TGT-FR-03, PLAN-TGT-AC-03: "M31", "M 31", "m31" and " m 31 " find the
/// same Target; every result names its source; searching writes nothing; Add
/// to targets puts a catalogue result into the library and My targets.
#[tokio::test]
async fn search_ignores_case_whitespace_and_names_source() {
    let endpoint = serve_tap(
        "oid\tmain_id\tra\tdec\totype_txt\tV\n\
         9001\t\"PVQ  Nebula\"\t300.0\t40.0\t\"HII\"\t12.0\n",
        "id\n\"PVQ  Nebula\"\n",
    );
    let temp = tempfile::tempdir().unwrap();
    let config = SimbadConfig::from_settings(endpoint, 5);
    let library = Library::open(&temp.path().join("library.sqlite"), Some(&config)).await.unwrap();
    let m31 = seed(&library, "M 31").await;
    library.add_to_my_targets(&AddTarget::Seed { id: m31.id }).await.unwrap();
    let generation = library.catalog().target_generation().await.unwrap();

    for text in ["M31", "M 31", "m31", " m 31 "] {
        let found = library.targets_search(text).await.unwrap();
        let first = &found.results[0];
        assert_eq!(first.target.id, m31.id, "{text:?}");
        assert_eq!(first.source, TargetsSearchSource::MyTargets, "{text:?}");
        assert!(first.in_my_targets);
        assert_eq!(found.results.iter().filter(|r| r.target.id == m31.id).count(), 1);
    }

    let found = library.targets_search("ngc 7000").await.unwrap();
    let ngc = found.results.iter().find(|r| r.target.designation == "NGC 7000").unwrap();
    assert_eq!(ngc.source, TargetsSearchSource::Catalogue);
    assert!(!ngc.in_my_targets);
    assert_eq!(found.simbad, SimbadSearch::Searched);

    let found = library.targets_search("PVQ Nebula").await.unwrap();
    let simbad = found.results.iter().find(|r| r.source == TargetsSearchSource::Simbad).unwrap();
    assert_eq!(simbad.target.designation, "PVQ Nebula");
    assert!(!simbad.in_my_targets);
    assert_eq!(
        library.catalog().target_generation().await.unwrap(),
        generation,
        "search writes nothing"
    );

    let added = library.add_to_my_targets(&AddTarget::Seed { id: ngc.target.id }).await.unwrap();
    assert_eq!(added.candidate.id, ngc.target.id);
    let again = library.targets_search("NGC7000").await.unwrap();
    let ngc = again.results.iter().find(|r| r.target.id == added.candidate.id).unwrap();
    assert_eq!(ngc.source, TargetsSearchSource::MyTargets);
    let added = library.add_to_my_targets(&AddTarget::Simbad { query: "PVQ Nebula".into() }).await;
    let added = added.unwrap();
    assert!(matches!(added.candidate.provenance, Provenance::Provider { .. }));
    let mine =
        library.target_rows(&query(TargetsShow::MyTargets, None, date!(2026 - 10 - 10))).await;
    assert_eq!(designations(&mine.unwrap()), ["M 31", "NGC 7000", "PVQ Nebula"]);
}

/// PLAN-TGT-AC-04: with SIMBAD unreachable, or no provider at all, the local
/// matches are listed and the results say SIMBAD was not searched.
#[tokio::test]
async fn simbad_unreachable_results_say_not_searched() {
    let closed = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/simbad/sim-tap/sync", closed.local_addr().unwrap());
    drop(closed);
    let temp = tempfile::tempdir().unwrap();
    let config = SimbadConfig::from_settings(endpoint, 2);
    let library = Library::open(&temp.path().join("library.sqlite"), Some(&config)).await.unwrap();

    let found = library.targets_search("m 31").await.unwrap();
    assert_eq!(found.results[0].target.designation, "M 31");
    assert_eq!(found.results[0].source, TargetsSearchSource::Catalogue);
    assert!(matches!(found.simbad, SimbadSearch::NotSearched { .. }), "{:?}", found.simbad);

    let offline = open(&temp.path().join("offline.sqlite")).await;
    let found = offline.targets_search("M31").await.unwrap();
    assert_eq!(found.results[0].target.designation, "M 31");
    assert!(matches!(found.simbad, SimbadSearch::NotSearched { .. }));
    let blank = offline.targets_search("  ").await.unwrap_err();
    assert!(matches!(blank, LibraryError::InvalidInput(_)), "{blank:?}");
}

// ---------------------------------------------------------------------------
// Planning columns
// ---------------------------------------------------------------------------

async fn plan_area(
    library: &Library,
    target: Uuid,
    site: Uuid,
    night: Date,
    criteria: PlanCriteria,
) -> WindowSet {
    let query =
        WindowQuery { target_id: target, site_id: site, first_night: night, nights: 1, criteria };
    library.compute_windows(&query).await.unwrap()
}

/// PLAN-TGT-AC-06, PLAN-TGT-FR-05: an Img time of zero names altitude, the
/// Moon or darkness, and every Img time equals the Plan area windows' total
/// under the same site, night and criteria (PV-PLAN-SC-04).
#[tokio::test]
async fn img_time_zero_names_altitude_moon_or_darkness() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    let backyard = site(&library, "Backyard", BACKYARD, "Europe/Amsterdam").await;
    let tromso = site(&library, "Tromsø", TROMSO, "Europe/Oslo").await;
    let andromeda = mine(&library, "Andromeda", Some((10.684_708, 41.268_75))).await.candidate.id;
    let southern = mine(&library, "Southern", Some((84.0, -69.0))).await.candidate.id;

    // A moonless autumn night: Andromeda is up, the southern Target never clears 30°.
    let night = date!(2026 - 10 - 10);
    let page = library.target_rows(&query(TargetsShow::MyTargets, Some(backyard), night)).await;
    let page = page.unwrap();
    let up = row(&page, andromeda);
    assert!(up.img_time_minutes.unwrap() > 0 && up.img_time_zero_reason.is_none());
    let low = row(&page, southern);
    assert_eq!(low.img_time_minutes, Some(0));
    assert_eq!(low.img_time_zero_reason, Some(ImgTimeZeroReason::Altitude));
    assert!(low.max_altitude_deg.unwrap() < 30.0);
    assert_eq!(page.basis.as_ref().unwrap().night, night);

    // Full Moon with the Moon required below the horizon.
    let mut full = query(TargetsShow::MyTargets, Some(backyard), date!(2026 - 10 - 25));
    full.criteria = criteria(MoonCriterion::BelowHorizon);
    let page = library.target_rows(&full).await.unwrap();
    assert!(page.moon.as_ref().unwrap().illumination > 0.95);
    let moonlit = row(&page, andromeda);
    assert_eq!(moonlit.img_time_minutes, Some(0));
    assert_eq!(moonlit.img_time_zero_reason, Some(ImgTimeZeroReason::Moon));

    // Midsummer in Tromsø is never astronomically dark.
    let page = library
        .target_rows(&query(TargetsShow::MyTargets, Some(tromso), date!(2026 - 06 - 21)))
        .await;
    let page = page.unwrap();
    for id in [andromeda, southern] {
        assert_eq!(row(&page, id).img_time_minutes, Some(0));
        assert_eq!(row(&page, id).img_time_zero_reason, Some(ImgTimeZeroReason::Darkness));
    }

    // PV-PLAN-SC-04: Img time is the Plan area total; Max alt is no lower than
    // any window's peak.
    for (site, night, criteria) in [
        (backyard, night, full.criteria),
        (backyard, night, query(TargetsShow::MyTargets, None, night).criteria),
        (
            backyard,
            date!(2026 - 10 - 20),
            criteria(MoonCriterion::MinSeparation { min_separation_deg: 60.0 }),
        ),
        (tromso, date!(2026 - 12 - 01), full.criteria),
    ] {
        let mut request = query(TargetsShow::MyTargets, Some(site), night);
        request.criteria = criteria;
        let page = library.target_rows(&request).await.unwrap();
        for id in [andromeda, southern] {
            let windows = plan_area(&library, id, site, night, criteria).await;
            let total: u32 = windows.windows().map(|window| window.duration_minutes).sum();
            let listed = row(&page, id);
            assert_eq!(listed.img_time_minutes, Some(total), "{night} {criteria:?}");
            let max = listed.max_altitude_deg.unwrap();
            assert!(windows.windows().all(|window| window.peak_altitude_deg <= max + 1e-9));
            assert!(listed.lunar_separation_deg.is_some_and(|sep| (0.0..=180.0).contains(&sep)));
            assert!(listed.next_opposition.is_some_and(|date| date >= night));
            assert_eq!(listed.bands.len(), 7);
        }
    }
}

/// PLAN-TGT-AC-07, PLAN-TGT-FR-04: unknown values sort last in either
/// direction, and a Target without catalogued coordinates names the reason.
#[tokio::test]
async fn unknown_sorts_last() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    let backyard = site(&library, "Backyard", BACKYARD, "Europe/Amsterdam").await;
    let high = mine(&library, "B high", Some((10.684_708, 41.268_75))).await.candidate.id;
    let unknown = mine(&library, "A unknown", None).await.candidate.id;
    let low = mine(&library, "C low", Some((300.0, 5.0))).await.candidate.id;

    let mut request = query(TargetsShow::MyTargets, Some(backyard), date!(2026 - 10 - 10));
    let page = library.target_rows(&request).await.unwrap();
    assert_eq!(designations(&page), ["A unknown", "B high", "C low"]);
    let blank = row(&page, unknown);
    assert_eq!(blank.unknown_reason, Some(PlanningUnknownReason::TargetCoordinatesUnknown));
    assert!(blank.max_altitude_deg.is_none() && blank.lunar_separation_deg.is_none());
    assert!(blank.img_time_minutes.is_none() && blank.next_opposition.is_none());
    assert!(blank.bands.is_empty() && blank.recommendation.is_none());

    for column in [
        TargetsColumn::MaxAlt,
        TargetsColumn::Lunar,
        TargetsColumn::ImgTime,
        TargetsColumn::Filters,
        TargetsColumn::Opposition,
    ] {
        for descending in [false, true] {
            request.sort = Some(TargetsSort { column, descending });
            let page = library.target_rows(&request).await.unwrap();
            let order: Vec<Uuid> = page.rows.iter().map(|row| row.target.id).collect();
            assert_eq!(order[2], unknown, "{column:?} descending={descending}");
        }
    }
    request.sort = Some(TargetsSort { column: TargetsColumn::MaxAlt, descending: true });
    let page = library.target_rows(&request).await.unwrap();
    assert_eq!(page.rows.iter().map(|row| row.target.id).collect::<Vec<_>>(), [high, low, unknown]);
    request.sort = Some(TargetsSort { column: TargetsColumn::MaxAlt, descending: false });
    let page = library.target_rows(&request).await.unwrap();
    assert_eq!(page.rows.iter().map(|row| row.target.id).collect::<Vec<_>>(), [low, high, unknown]);
}

/// PLAN-TGT-AC-15: with no saved planning site the planning columns read "-"
/// with "Add an observing site in Settings"; ★, Sessions, search and Add to
/// targets still work, and the toolbar has no Moon.
#[tokio::test]
async fn no_site_shows_dash_and_add_site_reason() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    let m31 = seed(&library, "M 31").await;
    library.add_to_my_targets(&AddTarget::Seed { id: m31.id }).await.unwrap();

    let page =
        library.target_rows(&query(TargetsShow::MyTargets, None, date!(2026 - 10 - 10))).await;
    let page = page.unwrap();
    assert_eq!(page.planning_unavailable, Some(PlanningUnknownReason::NoSite));
    assert!(page.basis.is_none() && page.moon.is_none());
    let andromeda = row(&page, m31.id);
    assert_eq!(andromeda.unknown_reason, Some(PlanningUnknownReason::NoSite));
    assert!(andromeda.max_altitude_deg.is_none() && andromeda.img_time_minutes.is_none());
    assert!(andromeda.lunar_separation_deg.is_none() && andromeda.next_opposition.is_none());
    assert!(andromeda.favourite);
    assert_eq!(andromeda.sessions, 0);
    assert!(library.targets_search("M 31").await.unwrap().results[0].in_my_targets);
    library.set_favourite(m31.id, false).await.unwrap();
    let page =
        library.target_rows(&query(TargetsShow::MyTargets, None, date!(2026 - 10 - 10))).await;
    assert!(page.unwrap().rows.is_empty());

    // A saved default site becomes the planning site when the query names none.
    library.add_to_my_targets(&AddTarget::Saved { id: m31.id }).await.unwrap();
    let backyard = site(&library, "Backyard", BACKYARD, "Europe/Amsterdam").await;
    let settings = library.catalog().list_sites().await.unwrap().settings_revision;
    library.set_default_site(Some(backyard), settings).await.unwrap();
    let page =
        library.target_rows(&query(TargetsShow::MyTargets, None, date!(2026 - 10 - 10))).await;
    let page = page.unwrap();
    assert_eq!(page.basis.as_ref().unwrap().site.id, backyard);
    assert!(page.moon.is_some() && page.planning_unavailable.is_none());
    assert!(row(&page, m31.id).img_time_minutes.is_some());

    let unknown = query(TargetsShow::MyTargets, Some(Uuid::new_v4()), date!(2026 - 10 - 10));
    let missing = library.target_rows(&unknown).await.unwrap_err();
    assert!(matches!(missing, LibraryError::NotFound(_)), "{missing:?}");
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/// PLAN-TGT-AC-09/10, PLAN-TGT-FR-09/10: exactly the five built-ins, no "Avoid
/// tonight"; a saved preset survives a restart with its filters, is renamed
/// and deleted, and a built-in cannot be.
#[tokio::test]
async fn saved_preset_persists_rename_delete_builtin_immutable() {
    let temp = tempfile::tempdir().unwrap();
    let database = temp.path().join("library.sqlite");
    let library = open(&database).await;
    let presets = library.targets_presets(RigSelection::None).await.unwrap();
    let names: Vec<&str> = presets.builtin.iter().map(|info| info.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "Best tonight (broadband)",
            "Narrowband (Moon up)",
            "Emission nebulae Ha",
            "Galaxies dark sky",
            "Planetary nebulae OIII",
        ]
    );
    assert!(presets.builtin.iter().all(|info| !info.definition.is_empty()));
    assert!(presets.saved.is_empty());

    let filters = PresetFilters {
        show: TargetsShow::Browse,
        catalogues: vec![Catalogue::Ngc],
        preset: Some(BuiltinPreset::GalaxiesDarkSky),
        sort: TargetsSort { column: TargetsColumn::ImgTime, descending: true },
    };
    let saved = library.save_targets_preset("Autumn galaxies", &filters).await.unwrap();
    drop(library);

    let library = open(&database).await;
    let presets = library.targets_presets(RigSelection::None).await.unwrap();
    assert_eq!(presets.saved, std::slice::from_ref(&saved));
    assert_eq!(presets.saved[0].filters, filters, "applying it restores the same filters");

    let renamed = library
        .rename_targets_preset(
            PresetRef::Saved { id: saved.id },
            "Autumn galaxies 2026",
            saved.revision,
        )
        .await
        .unwrap();
    assert_eq!(renamed.name, "Autumn galaxies 2026");
    for preset in BuiltinPreset::ALL {
        let rename = library.rename_targets_preset(PresetRef::Builtin { preset }, "Mine", 1).await;
        assert!(matches!(rename.unwrap_err(), LibraryError::InvalidInput(_)));
        let delete = library.delete_targets_preset(PresetRef::Builtin { preset }, 1).await;
        assert!(matches!(delete.unwrap_err(), LibraryError::InvalidInput(_)));
    }
    library
        .delete_targets_preset(PresetRef::Saved { id: saved.id }, renamed.revision)
        .await
        .unwrap();
    let presets = library.targets_presets(RigSelection::None).await.unwrap();
    assert!(presets.saved.is_empty());
    assert_eq!(presets.builtin.len(), 5);
}

/// PLAN-TGT-FR-09: each built-in preset lists only the rows its definition
/// admits, and Best tonight sorts by Img time descending.
#[tokio::test]
async fn builtin_presets_follow_their_definitions() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    let backyard = site(&library, "Backyard", BACKYARD, "Europe/Amsterdam").await;
    let mut request = query(TargetsShow::Browse, Some(backyard), date!(2026 - 10 - 20));
    request.catalogues = vec![Catalogue::Messier];
    let all = library.target_rows(&request).await.unwrap();

    let viable = |row: &TargetRow, bands: &[Band]| {
        row.bands.iter().any(|state| state.viable && bands.contains(&state.band))
    };
    let menu = library.targets_presets(RigSelection::None).await.unwrap().builtin;
    for preset in menu.into_iter().map(|info| info.preset) {
        request.preset = Some(preset);
        let page = library.target_rows(&request).await.unwrap();
        assert!(page.total <= all.total);
        for row in &page.rows {
            let img = row.img_time_minutes.unwrap_or(0);
            match preset {
                BuiltinPreset::BestTonightBroadband => {
                    assert!(img > 0 && viable(row, &[Band::L, Band::R, Band::G, Band::B]));
                }
                BuiltinPreset::NarrowbandMoonUp => {
                    assert!(img > 0 && viable(row, &[Band::Ha, Band::Sii, Band::Oiii]));
                }
                BuiltinPreset::EmissionNebulaeHa => {
                    assert_eq!(row.target.object_type, "emission_nebula");
                    assert!(viable(row, &[Band::Ha]));
                }
                BuiltinPreset::GalaxiesDarkSky => {
                    assert_eq!(row.target.object_type, "galaxy");
                    assert!(img > 0);
                }
                BuiltinPreset::PlanetaryNebulaeOiii => {
                    assert_eq!(row.target.object_type, "planetary_nebula");
                    assert!(viable(row, &[Band::Oiii]));
                }
                BuiltinPreset::MosaicCandidates | BuiltinPreset::FitsNicely => {
                    unreachable!("offered only with a rig selected")
                }
            }
        }
        if preset == BuiltinPreset::BestTonightBroadband {
            assert!(page.total > 0);
            let times: Vec<u32> = page.rows.iter().filter_map(|row| row.img_time_minutes).collect();
            assert!(times.windows(2).all(|pair| pair[0] >= pair[1]), "{times:?}");
        }
    }

    // A preset alone browses every bundled catalogue.
    request.catalogues.clear();
    request.preset = Some(BuiltinPreset::PlanetaryNebulaeOiii);
    let page = library.target_rows(&request).await.unwrap();
    assert!(!page.needs_catalogue_or_preset);
    assert!(page.total > 0);
}
