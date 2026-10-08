// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Tonight over the library facade (spec 072 PLAN-FR-11, PLAN-AC-11/12,
//! PV-PLAN-SC-04, D-W39, D-W63): the best window tonight of each ★ favourite
//! and each open-Project subject at the default site, each equal to the Plan
//! area's best window, the Moon and the darkness window naming the site and
//! zone, Targets without a window left out, a mosaic planned at its subject
//! Target, and no windows with "Add an observing site in Settings" without a
//! default site.

use std::path::Path;
use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::targets::{user_target, ObjectType, TargetQuery, UserTargetInput, ICRS_FRAME};
use platevault_core::tonight::{Tonight, TonightQuery, TonightWindow};
use platevault_core::*;
use time::macros::date;
use time::Date;
use uuid::Uuid;

const BACKYARD: (f64, f64) = (52.09, 5.12);
const NIGHT: Date = date!(2026 - 10 - 10);

async fn open(database: &Path) -> Arc<Library> {
    Library::open(database, None).await.unwrap()
}

async fn site(library: &Library, name: &str) -> Uuid {
    let input = SiteInput {
        name: name.into(),
        latitude_deg: BACKYARD.0,
        longitude_deg: BACKYARD.1,
        elevation_m: None,
        time_zone: "Europe/Amsterdam".into(),
    };
    library.save_site(None, None, &input).await.unwrap().site.id
}

async fn default_site(library: &Library, name: &str) -> Uuid {
    let id = site(library, name).await;
    let settings = library.catalog().list_sites().await.unwrap().settings_revision;
    library.set_default_site(Some(id), settings).await.unwrap();
    id
}

fn criteria() -> PlanCriteria {
    PlanCriteria {
        min_altitude_deg: 30.0,
        darkness: Darkness::Astronomical,
        moon: MoonCriterion::None,
        min_duration_minutes: 30,
    }
}

fn query() -> TonightQuery {
    TonightQuery { night: Some(NIGHT), criteria: criteria() }
}

async fn seed(library: &Library, text: &str) -> TargetCandidate {
    let query = TargetQuery { text: Some(text.into()), cone: None, limit: 1 };
    library.search_targets(&query).await.unwrap().remove(0).candidate
}

/// A saved user Target, not in My targets.
async fn saved(library: &Library, designation: &str, at: Option<(f64, f64)>) -> Uuid {
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
    candidate.id
}

async fn rig(library: &Library) -> Uuid {
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
    library.catalog().save_equipment(&rig, None).await.unwrap().id
}

async fn project(library: &Library, name: &str, subjects: Vec<SubjectInput>) -> Project {
    let rig = rig(library).await;
    let input = ProjectInput {
        name: name.into(),
        notes: None,
        subjects,
        rig_ids: vec![rig],
        goals: vec![],
    };
    library.catalog().create_project(&input).await.unwrap()
}

fn subject(target_id: Uuid) -> SubjectInput {
    SubjectInput { target_id, name: None, mosaic: false, panels: Vec::new() }
}

/// The Plan area's best window tonight: the longest, then the highest peak.
async fn plan_area_best(library: &Library, target: Uuid, site: Uuid) -> ObservingWindow {
    let query = WindowQuery {
        target_id: target,
        site_id: site,
        first_night: NIGHT,
        nights: 1,
        criteria: criteria(),
    };
    let set = library.compute_windows(&query).await.unwrap();
    set.windows()
        .max_by(|first, second| {
            first
                .duration_minutes
                .cmp(&second.duration_minutes)
                .then(first.peak_altitude_deg.total_cmp(&second.peak_altitude_deg))
                .then(second.start_utc.cmp(&first.start_utc))
        })
        .cloned()
        .expect("the Plan area lists a window tonight")
}

fn window(tonight: &Tonight, target: Uuid) -> &TonightWindow {
    tonight.windows.iter().find(|window| window.target_id == target).unwrap()
}

fn ids(tonight: &Tonight) -> Vec<Uuid> {
    let mut ids: Vec<Uuid> = tonight.windows.iter().map(|window| window.target_id).collect();
    ids.sort();
    ids
}

fn sorted(mut ids: Vec<Uuid>) -> Vec<Uuid> {
    ids.sort();
    ids
}

/// PLAN-AC-11, PLAN-FR-11, PV-PLAN-SC-04: with Backyard as default, M 31 ★
/// and NGC 7000 a subject of the open Project "Summer nebulae", Tonight holds
/// the Plan area's best window of exactly those two, each with start, end and
/// peak altitude, plus the Moon and the darkness window, every value naming
/// Backyard and its zone. A saved Target in neither is left out.
#[tokio::test]
async fn tonight_best_window_for_open_project_subjects_and_favourites() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    let backyard = default_site(&library, "Backyard").await;
    let m31 = seed(&library, "M 31").await;
    let ngc7000 = seed(&library, "NGC 7000").await;
    library.add_to_my_targets(&AddTarget::Seed { id: m31.id }).await.unwrap();
    library.catalog().record_seed_target(&ngc7000).await.unwrap();
    let summer = project(&library, "Summer nebulae", vec![subject(ngc7000.id)]).await;
    let elsewhere = saved(&library, "Saved only", Some((10.68, 41.27))).await;

    let tonight = library.tonight(&query()).await.unwrap();
    assert_eq!(tonight.unavailable_reason, None);
    assert_eq!(ids(&tonight), sorted(vec![m31.id, ngc7000.id]), "not {elsewhere}");
    for target in [m31.id, ngc7000.id] {
        let listed = window(&tonight, target);
        assert_eq!(listed.window, plan_area_best(&library, target, backyard).await);
        assert!(listed.window.end_utc > listed.window.start_utc);
        assert!(listed.window.peak_altitude_deg >= 30.0);
        assert_eq!(listed.window.site_name, "Backyard");
        assert_eq!(listed.window.time_zone, "Europe/Amsterdam");
        assert!(tonight.has_window(target), "Home's Next rule 3 input");
    }
    assert!(!tonight.has_window(elsewhere));
    let andromeda = window(&tonight, m31.id);
    assert!(andromeda.favourite && andromeda.projects.is_empty());
    let nebula = window(&tonight, ngc7000.id);
    assert!(!nebula.favourite);
    assert_eq!(
        nebula.projects,
        [ProjectBadge { project_id: summer.id, name: "Summer nebulae".into() }]
    );

    let sky = library.night_sky(backyard, NIGHT, Darkness::Astronomical).await.unwrap();
    assert_eq!(tonight.site.as_ref(), Some(&sky.site));
    assert_eq!(tonight.site.as_ref().map(|site| site.name.as_str()), Some("Backyard"));
    assert_eq!(tonight.time_zone.as_deref(), Some("Europe/Amsterdam"));
    assert_eq!(tonight.night, Some(NIGHT));
    assert_eq!(tonight.moon.as_ref(), Some(&sky.moon));
    assert!(tonight.darkness.is_some());
    assert_eq!(tonight.darkness, sky.darkness);
    let starts: Vec<_> = tonight.windows.iter().map(|window| window.window.start_utc).collect();
    assert!(starts.is_sorted(), "by start");
}

/// PLAN-AC-11, PLAN-FR-11: a ★ Target that never clears the altitude at
/// Backyard and one without catalogued coordinates have no window tonight and
/// are left out; M 31 stays.
#[tokio::test]
async fn tonight_omits_targets_without_window() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    default_site(&library, "Backyard").await;
    let m31 = seed(&library, "M 31").await;
    library.add_to_my_targets(&AddTarget::Seed { id: m31.id }).await.unwrap();
    let south = saved(&library, "Far south", Some((84.0, -69.0))).await;
    let unknown = saved(&library, "No coordinates", None).await;
    for id in [south, unknown] {
        library.set_favourite(id, true).await.unwrap();
    }

    let tonight = library.tonight(&query()).await.unwrap();
    assert_eq!(ids(&tonight), [m31.id]);
    assert!(!tonight.has_window(south) && !tonight.has_window(unknown));
}

/// PLAN-FR-11, D-W63: a mosaic subject's window uses the mosaic's centre, the
/// subject Target's position, not its panels: with both panels far below the
/// horizon, NGC 7000 is listed once with the Plan area's best window of its
/// Target.
#[tokio::test]
async fn mosaic_uses_centre() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    let backyard = default_site(&library, "Backyard").await;
    let ngc7000 = seed(&library, "NGC 7000").await;
    library.catalog().record_seed_target(&ngc7000).await.unwrap();
    let panels = (1..=2)
        .map(|number| PanelInput {
            number,
            ra_deg: 84.0 + f64::from(number),
            dec_deg: -75.0,
            rotation_deg: None,
        })
        .collect();
    let mosaic = SubjectInput { target_id: ngc7000.id, name: None, mosaic: true, panels };
    project(&library, "Cygnus mosaic", vec![mosaic]).await;

    let tonight = library.tonight(&query()).await.unwrap();
    assert_eq!(ids(&tonight), [ngc7000.id], "one window for the mosaic, none per panel");
    assert_eq!(
        window(&tonight, ngc7000.id).window,
        plan_area_best(&library, ngc7000.id, backyard).await
    );
}

/// PLAN-AC-12: with no saved planning site, and with a saved site that is not
/// the default, Tonight lists no windows, computes no Moon or darkness and
/// names "Add an observing site in Settings".
#[tokio::test]
async fn no_site_returns_reason() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    let m31 = seed(&library, "M 31").await;
    library.add_to_my_targets(&AddTarget::Seed { id: m31.id }).await.unwrap();

    for name in ["Backyard", "Not the default"] {
        let tonight = library.tonight(&query()).await.unwrap();
        assert_eq!(tonight.unavailable_reason, Some(PlanningUnknownReason::NoSite));
        assert!(tonight.windows.is_empty());
        assert!(!tonight.has_window(m31.id));
        assert_eq!((tonight.site, tonight.time_zone, tonight.night), (None, None, None));
        assert_eq!((tonight.moon, tonight.darkness), (None, None));
        site(&library, name).await;
    }
    let wire = serde_json::to_value(library.tonight(&query()).await.unwrap()).unwrap();
    assert_eq!(wire["unavailableReason"], "no_site");
    assert_eq!(wire["windows"], serde_json::json!([]));
}
