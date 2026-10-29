// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Home's planning reads over the library facade (spec 072 PLAN-FR-02,
//! PLAN-FR-11, PLAN-FR-12, PLAN-AC-11/14; D-W88, D-W89): Tonight grades every
//! unfinished goal of an open Project for its channel under the band's
//! Moon-avoidance curve, by R10-MOON-MODEL.md §3, with the Plan area's best
//! window under that curve, and names the next good night when no goal suits
//! tonight; the calendar lists each night's Moon, darkness, the goals it
//! suits and the goals the Moon rules out, under Home's stored criteria.

use std::path::Path;
use std::sync::Arc;

use platevault_core::goal_grades::GoalGrade;
use platevault_core::library::Library;
use platevault_core::planning::{curve_criterion, NightContext};
use platevault_core::tonight::{Tonight, TonightQuery};
use platevault_core::*;
use time::macros::date;
use time::{Date, Duration};
use uuid::Uuid;

const BACKYARD: (f64, f64) = (52.09, 5.12);
/// The full Moon of 2026-10-26: up through the whole dark night.
const FULL: Date = date!(2026 - 10 - 26);
/// The Ha curve asks no separation; the OIII curve asks all of it near full.
const LENIENT: MoonAvoidanceCurve = MoonAvoidanceCurve { distance_deg: 0.0, width_days: 7.0 };
const STRICT: MoonAvoidanceCurve = MoonAvoidanceCurve { distance_deg: 180.0, width_days: 30.0 };

async fn open(database: &Path) -> Arc<Library> {
    Library::open(database, None).await.unwrap()
}

async fn default_site(library: &Library) -> ObservingSite {
    let input = SiteInput {
        name: "Backyard".into(),
        latitude_deg: BACKYARD.0,
        longitude_deg: BACKYARD.1,
        elevation_m: None,
        time_zone: "Europe/Amsterdam".into(),
    };
    let site = library.save_site(None, None, &input).await.unwrap().site;
    let revision = library.catalog().list_sites().await.unwrap().settings_revision;
    library.set_default_site(Some(site.id), revision).await.unwrap();
    site
}

fn criteria() -> PlanCriteria {
    PlanCriteria {
        min_altitude_deg: 30.0,
        darkness: Darkness::Astronomical,
        moon: MoonCriterion::None,
        min_duration_minutes: 30,
    }
}

async fn curves(library: &Library) {
    let mut settings = WorkflowSettings::default();
    settings.moon_avoidance.set(Band::Ha, LENIENT);
    settings.moon_avoidance.set(Band::Oiii, STRICT);
    library.save_workflow_settings(0, &settings).await.unwrap();
}

async fn ngc7000(library: &Library) -> Uuid {
    let query = targets::TargetQuery { text: Some("NGC 7000".into()), cone: None, limit: 1 };
    let candidate = library.search_targets(&query).await.unwrap().remove(0).candidate;
    library.catalog().record_seed_target(&candidate).await.unwrap();
    candidate.id
}

/// A mono rig whose Ha and OIII filters pass their bands.
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
    let id = library.catalog().save_equipment(&rig, None).await.unwrap().id;
    let filter = |name: &str, band: Band| RigFilter {
        id: Uuid::new_v4(),
        name: name.into(),
        match_values: vec![name.into()],
        bands: vec![band],
    };
    library
        .save_rig_filters(id, &[filter("Ha", Band::Ha), filter("OIII", Band::Oiii)], 0)
        .await
        .unwrap();
    id
}

fn integration(target_id: Uuid, channel: &str) -> GoalInput {
    GoalInput {
        target_id,
        group_id: None,
        goal: GoalSpec::Integration { channel: Some(channel.into()), goal_seconds: 36_000 },
    }
}

/// An open Project on NGC 7000 with a goal on each of `channels`.
async fn project(library: &Library, target: Uuid, channels: &[&str]) -> Project {
    let input = ProjectInput {
        name: "Summer nebulae".into(),
        notes: None,
        subjects: vec![SubjectInput { target_id: target, name: None }],
        rig_ids: vec![rig(library).await],
        goals: channels.iter().map(|channel| integration(target, channel)).collect(),
    };
    library.catalog().create_project(&input).await.unwrap()
}

fn goal_id(project: &Project, channel: &str) -> Uuid {
    project.goals.iter().find(|goal| goal.goal.channel() == Some(channel)).unwrap().id
}

fn grade<'a>(grades: &'a [GoalGrade], channel: &str) -> &'a GoalGrade {
    grades.iter().find(|grade| grade.channel.as_deref() == Some(channel)).unwrap()
}

/// The Plan area's best window of `night` under `moon`: the longest, then
/// the highest peak, then the earliest.
async fn plan_area_best(
    library: &Library,
    target: Uuid,
    site: Uuid,
    night: Date,
    moon: MoonCriterion,
) -> Option<ObservingWindow> {
    let query = WindowQuery {
        target_id: target,
        site_id: site,
        first_night: night,
        nights: 1,
        criteria: PlanCriteria { moon, ..criteria() },
    };
    library.compute_windows(&query).await.unwrap().windows().cloned().max_by(|first, second| {
        first
            .duration_minutes
            .cmp(&second.duration_minutes)
            .then(first.peak_altitude_deg.total_cmp(&second.peak_altitude_deg))
            .then(second.start_utc.cmp(&first.start_utc))
    })
}

fn age(site: &ObservingSite, night: Date) -> f64 {
    NightContext::new(site, night, &criteria()).unwrap().moon_age_days()
}

async fn tonight(library: &Library, night: Date) -> Tonight {
    library.tonight(&TonightQuery { night: Some(night), criteria: criteria() }).await.unwrap()
}

/// PLAN-AC-11, PLAN-FR-11: on the full Moon, NGC 7000's Ha goal is good
/// with the Plan area's best window under the Ha curve, and its OIII goal
/// poor under the OIII curve with no window; each names its Project, goal,
/// subject and channel, best first. A channel no rig filter names is
/// ungraded, last.
#[tokio::test]
async fn tonight_grades_each_unfinished_goal_under_its_band_curve() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    let site = default_site(&library).await;
    curves(&library).await;
    let target = ngc7000(&library).await;
    let summer = project(&library, target, &["Ha", "OIII", "Lum"]).await;
    assert!(age(&site, FULL) < 1.0, "the night is the full Moon's");

    let tonight = tonight(&library, FULL).await;
    let channels: Vec<_> = tonight.goals.iter().map(|grade| grade.channel.as_deref()).collect();
    assert_eq!(channels, [Some("Ha"), Some("OIII"), Some("Lum")], "best first");
    let subject = summer.subjects[0].id;
    for (channel, band, expected) in [
        ("Ha", Some(Band::Ha), Some(BandGrade::Good)),
        ("OIII", Some(Band::Oiii), Some(BandGrade::Poor)),
        ("Lum", None, None),
    ] {
        let graded = grade(&tonight.goals, channel);
        assert_eq!(graded.project_id, summer.id);
        assert_eq!(graded.project_name, "Summer nebulae");
        assert_eq!(graded.goal_id, goal_id(&summer, channel));
        assert_eq!(graded.subject_id, subject);
        assert_eq!(graded.target_id, target);
        assert_eq!((graded.band, graded.grade), (band, expected), "{channel}");
    }
    let ha = grade(&tonight.goals, "Ha");
    let moon = curve_criterion(LENIENT, age(&site, FULL));
    let best = plan_area_best(&library, target, site.id, FULL, moon).await;
    assert!(best.is_some());
    assert_eq!(ha.window, best);
    assert_eq!(ha.window.as_ref().unwrap().site_name, "Backyard");
    assert_eq!(grade(&tonight.goals, "OIII").window, None);
    assert!(
        plan_area_best(&library, target, site.id, FULL, MoonCriterion::None).await.is_some(),
        "only the Moon keeps OIII poor"
    );
    assert_eq!(tonight.next_good_night, None, "the Ha goal suits tonight");
}

/// PLAN-FR-11: a marginal goal keeps a window shorter than three quarters
/// of the Moon-free one; a good goal at least that.
#[tokio::test]
async fn grades_follow_the_three_quarter_rule() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    let site = default_site(&library).await;
    let target = ngc7000(&library).await;
    project(&library, target, &["Ha", "OIII"]).await;
    // The default curves, two weeks either side of the full Moon.
    let avoidance = WorkflowSettings::default().moon_avoidance;
    let mut seen = Vec::new();
    for offset in -14..=14 {
        let night = FULL + Duration::days(offset);
        let tonight = tonight(&library, night).await;
        let free = plan_area_best(&library, target, site.id, night, MoonCriterion::None).await;
        for graded in &tonight.goals {
            let band = graded.band.unwrap();
            let moon = curve_criterion(avoidance.curve(band), age(&site, night));
            let curved = plan_area_best(&library, target, site.id, night, moon).await;
            let expected = match (&curved, &free) {
                (None, _) => BandGrade::Poor,
                (Some(curved), Some(free))
                    if 4 * curved.duration_minutes < 3 * free.duration_minutes =>
                {
                    BandGrade::Marginal
                }
                (Some(_), _) => BandGrade::Good,
            };
            assert_eq!(graded.grade, Some(expected), "{night} {band:?}");
            assert_eq!(graded.window, curved, "{night} {band:?}");
            seen.push(expected);
        }
    }
    for level in [BandGrade::Good, BandGrade::Marginal, BandGrade::Poor] {
        assert!(seen.contains(&level), "the month shows {level:?}");
    }
}

/// PLAN-AC-11: when no goal suits tonight, Tonight names the first later
/// night whose curve leaves the goal a window.
#[tokio::test]
async fn tonight_names_next_good_night_when_none_suits() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    let site = default_site(&library).await;
    curves(&library).await;
    let target = ngc7000(&library).await;
    project(&library, target, &["OIII"]).await;

    let tonight = tonight(&library, FULL).await;
    assert!(tonight.goals.iter().all(|grade| !grade.suits()));
    let next = tonight.next_good_night.expect("a later night suits the OIII goal");
    assert!(next > FULL);
    let mut night = FULL + Duration::days(1);
    while night <= next {
        let moon = curve_criterion(STRICT, age(&site, night));
        let window = plan_area_best(&library, target, site.id, night, moon).await;
        assert_eq!(window.is_some(), night == next, "{night}");
        night += Duration::days(1);
    }
}

/// PLAN-FR-11: without an unfinished goal there is nothing to grade and no
/// next good night.
#[tokio::test]
async fn tonight_without_goals_names_no_next_night() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    default_site(&library).await;
    let tonight = tonight(&library, FULL).await;
    assert_eq!(tonight.goals, []);
    assert_eq!(tonight.next_good_night, None);
}
