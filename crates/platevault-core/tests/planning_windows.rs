// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Observing windows and the night sky (spec 072, PLAN-FR-02/05/08/11,
//! PLAN-AC-01): every listed minute meets the criteria under skymath sampling,
//! nights follow the site's zone, and unrounded boundaries, peak altitudes, Moon
//! rise, set, illumination and phase and the darkness window agree with the
//! independent astroplan reference in `fixtures/planning`.

use platevault_core::planning::{
    compute_windows, night_of, night_sky, night_spans, validate_time_zone, Span,
};
use platevault_core::{
    Darkness, LibraryError, MoonCriterion, MoonPhase, NoWindowReason, ObservingSite, PlanCriteria,
    Provenance, SkyCoordinates, TargetCandidate, TargetRecord, WindowKey, WindowQuery, WindowSet,
    WindowUnavailableReason,
};
use skymath::{
    alt_az, lunar_separation, moon_position_topocentric, sun_position, Angle, Equatorial, Location,
};
use time::macros::{date, datetime, offset};
use time::{Date, Duration, OffsetDateTime, UtcOffset};
use uuid::Uuid;

const REFERENCE: &str = include_str!("fixtures/planning/astroplan-reference.json");
const TOLERANCE_SECONDS: i64 = 180;

fn site(
    name: &str,
    latitude_deg: f64,
    longitude_deg: f64,
    elevation: f64,
    zone: &str,
) -> ObservingSite {
    ObservingSite {
        id: Uuid::new_v4(),
        name: name.into(),
        latitude_deg,
        longitude_deg,
        elevation_m: Some(elevation),
        time_zone: zone.into(),
        revision: 1,
        created_at: "2026-10-01T10:00:00Z".into(),
        updated_at: "2026-10-01T10:00:00Z".into(),
    }
}

fn backyard() -> ObservingSite {
    site("Backyard", 52.09, 5.12, 5.0, "Europe/Amsterdam")
}

fn athens() -> ObservingSite {
    ObservingSite { revision: 3, ..site("Athens", 37.98, 23.73, 100.0, "Europe/Athens") }
}

fn polar() -> ObservingSite {
    site("Longyearbyen", 78.22, 15.65, 10.0, "Arctic/Longyearbyen")
}

fn target(coordinates: Option<SkyCoordinates>) -> TargetRecord {
    TargetRecord {
        candidate: TargetCandidate {
            id: Uuid::new_v4(),
            designation: "NGC 7000".into(),
            aliases: Vec::new(),
            common_name: Some("North America Nebula".into()),
            object_type: "HII".into(),
            coordinates,
            provenance: Provenance::User,
            provider_id: None,
            angular_size: None,
            catalogues: Vec::new(),
        },
        decision_revision: 2,
    }
}

fn ngc_7000() -> TargetRecord {
    target(Some(SkyCoordinates { ra_deg: 314.75, dec_deg: 44.33, frame: "icrs".into() }))
}

fn quickstart() -> PlanCriteria {
    PlanCriteria {
        min_altitude_deg: 30.0,
        darkness: Darkness::Astronomical,
        moon: MoonCriterion::MinSeparation { min_separation_deg: 30.0 },
        min_duration_minutes: 60,
    }
}

fn query(
    target: &TargetRecord,
    site: &ObservingSite,
    first: Date,
    nights: u32,
    criteria: PlanCriteria,
) -> WindowQuery {
    WindowQuery {
        target_id: target.candidate.id,
        site_id: site.id,
        first_night: first,
        nights,
        criteria,
    }
}

fn windows(
    target: &TargetRecord,
    site: &ObservingSite,
    first: Date,
    nights: u32,
    criteria: PlanCriteria,
) -> WindowSet {
    compute_windows(target, site, &query(target, site, first, nights, criteria)).unwrap()
}

/// Whether one instant meets the criteria, sampled directly with skymath.
fn meets(
    target: &TargetRecord,
    site: &ObservingSite,
    criteria: &PlanCriteria,
    at: OffsetDateTime,
) -> bool {
    let coordinates = target.candidate.coordinates.as_ref().unwrap();
    let position = Equatorial::j2000(
        Angle::from_degrees(coordinates.ra_deg),
        Angle::from_degrees(coordinates.dec_deg),
    )
    .unwrap();
    let location = Location::new(
        Angle::from_degrees(site.latitude_deg),
        Angle::from_degrees(site.longitude_deg),
        site.elevation_m.unwrap_or(0.0),
    )
    .unwrap();
    let altitude = alt_az(position, at, &location).altitude.degrees();
    let sun = alt_az(sun_position(at), at, &location).altitude.degrees();
    let moon_up =
        alt_az(moon_position_topocentric(at, &location), at, &location).altitude.degrees() >= 0.0;
    let moon = match criteria.moon {
        MoonCriterion::None => true,
        MoonCriterion::BelowHorizon => !moon_up,
        MoonCriterion::MinSeparation { min_separation_deg } => {
            !moon_up || lunar_separation(position, at, &location).degrees() >= min_separation_deg
        }
    };
    altitude >= criteria.min_altitude_deg && sun < criteria.darkness.sun_altitude_deg() && moon
}

fn assert_every_minute_meets(set: &WindowSet, target: &TargetRecord, site: &ObservingSite) {
    for window in set.windows() {
        assert_eq!(window.start_utc.second(), 0, "{window:?}");
        assert_eq!(window.end_utc.second(), 0, "{window:?}");
        let minutes = (window.end_utc - window.start_utc).whole_minutes();
        assert_eq!(i64::from(window.duration_minutes), minutes);
        assert!(window.duration_minutes >= set.basis.criteria.min_duration_minutes);
        for minute in 0..=minutes {
            let at = window.start_utc + Duration::minutes(minute);
            assert!(meets(target, site, &set.basis.criteria, at), "{at} in {window:?}");
        }
    }
}

#[test]
fn every_listed_minute_at_backyard_meets_altitude_darkness_and_moon_criteria() {
    let (ngc, backyard) = (ngc_7000(), backyard());
    let set = windows(&ngc, &backyard, date!(2026 - 10 - 20), 30, quickstart());
    assert_eq!(set.nights.len(), 30);
    assert_eq!(set.basis.site.name, "Backyard");
    assert_eq!(set.basis.time_zone, "Europe/Amsterdam");
    assert_eq!(set.basis.method, "skymath 0.7.2, geometric, no refraction");
    assert_eq!((set.basis.target_id, set.basis.target_revision), (ngc.candidate.id, 2));
    assert!(set.windows().count() >= 25, "{set:?}");
    for night in &set.nights {
        assert_eq!(night.no_window_reason.is_some(), night.windows.is_empty(), "{night:?}");
        for window in &night.windows {
            assert_eq!(window.night, night.night);
            assert_eq!(
                (window.site_name.as_str(), window.time_zone.as_str()),
                ("Backyard", "Europe/Amsterdam")
            );
            assert_eq!(
                window.key,
                WindowKey::new(ngc.candidate.id, backyard.id, window.start_utc).unwrap()
            );
        }
    }
    assert_every_minute_meets(&set, &ngc, &backyard);

    let longer = windows(
        &ngc,
        &backyard,
        date!(2026 - 10 - 20),
        30,
        PlanCriteria { min_duration_minutes: 120, ..quickstart() },
    );
    assert!(longer.windows().all(|window| window.duration_minutes >= 120));
    assert_every_minute_meets(&longer, &ngc, &backyard);
}

#[test]
fn the_second_site_names_its_own_basis_zone_and_offsets() {
    let (ngc, backyard, athens) = (ngc_7000(), backyard(), athens());
    let here = windows(&ngc, &backyard, date!(2026 - 10 - 20), 30, quickstart());
    let there = windows(&ngc, &athens, date!(2026 - 10 - 20), 30, quickstart());
    assert_eq!(
        (there.basis.site.id, there.basis.site.name.as_str(), there.basis.site.revision),
        (athens.id, "Athens", 3)
    );
    assert_eq!(there.basis.time_zone, "Europe/Athens");
    let starts = |set: &WindowSet| set.windows().map(|window| window.start_utc).collect::<Vec<_>>();
    assert_ne!(starts(&here), starts(&there));
    let change = datetime!(2026-10-25 01:00 UTC);
    for window in there.windows() {
        assert_eq!(
            (window.site_name.as_str(), window.time_zone.as_str()),
            ("Athens", "Europe/Athens")
        );
        assert_eq!(window.key.site_id(), athens.id);
        for (utc, local) in
            [(window.start_utc, window.start_local), (window.end_utc, window.end_local)]
        {
            let expected = if utc < change { offset!(+3) } else { offset!(+2) };
            assert_eq!(local.offset(), expected, "{window:?}");
            assert_eq!(local, utc);
        }
    }
    assert_every_minute_meets(&there, &ngc, &athens);
}

/// The 2026-10-25 01:00 UTC change falls in the night labeled by its evening,
/// 2026-10-24, which runs from local noon to local noon across it.
#[test]
fn the_dst_night_lasts_25_hours_and_local_times_change_offset_with_the_zone() {
    let ngc = ngc_7000();
    for (site, before, after) in
        [(backyard(), offset!(+2), offset!(+1)), (athens(), offset!(+3), offset!(+2))]
    {
        let night = night_spans(&ngc, &site, date!(2026 - 10 - 24), &quickstart()).unwrap();
        assert_eq!(night.end - night.start, Duration::hours(25), "{}", site.name);
        assert_eq!(night.start.to_offset(before).time(), time::macros::time!(12:00));
        assert_eq!(night.end.to_offset(after).time(), time::macros::time!(12:00));
        let ordinary = night_spans(&ngc, &site, date!(2026 - 10 - 25), &quickstart()).unwrap();
        assert_eq!(ordinary.end - ordinary.start, Duration::hours(24));
        assert_eq!(night_of(night.start, &site).unwrap(), date!(2026 - 10 - 24));
        assert_eq!(
            night_of(night.end - Duration::seconds(1), &site).unwrap(),
            date!(2026 - 10 - 24)
        );
        assert_eq!(night_of(night.end, &site).unwrap(), date!(2026 - 10 - 25));
        let set = windows(&ngc, &site, date!(2026 - 10 - 22), 6, quickstart());
        let change = datetime!(2026-10-25 01:00 UTC);
        let mut offsets = Vec::new();
        for window in set.windows() {
            for (utc, local) in
                [(window.start_utc, window.start_local), (window.end_utc, window.end_local)]
            {
                assert_eq!(local.offset(), if utc < change { before } else { after });
                offsets.push(local.offset());
            }
        }
        assert!(offsets.contains(&before) && offsets.contains(&after), "{offsets:?}");
    }
}

/// The spring change, 2026-03-29 01:00 UTC, falls in the night labeled
/// 2026-03-28, which lasts 23 hours from local noon to local noon. NGC 7000 is
/// above 20 degrees in the dark across that instant, so a window starting
/// before it ends after it, and every boundary reads the offset of its own
/// instant rather than the evening's.
#[test]
fn the_spring_dst_night_lasts_23_hours_and_a_window_spans_the_change() {
    let ngc = ngc_7000();
    let low = PlanCriteria {
        min_altitude_deg: 20.0,
        darkness: Darkness::Astronomical,
        moon: MoonCriterion::None,
        min_duration_minutes: 30,
    };
    let change = datetime!(2026-03-29 01:00 UTC);
    let site = backyard();
    let (before, after) = (offset!(+1), offset!(+2));
    let night = night_spans(&ngc, &site, date!(2026 - 03 - 28), &low).unwrap();
    assert_eq!(night.end - night.start, Duration::hours(23));
    assert_eq!(night.start, datetime!(2026-03-28 12:00 +1));
    assert_eq!(night.end, datetime!(2026-03-29 12:00 +2));
    for ordinary in [date!(2026 - 03 - 27), date!(2026 - 03 - 29)] {
        let span = night_spans(&ngc, &site, ordinary, &low).unwrap();
        assert_eq!(span.end - span.start, Duration::hours(24), "{ordinary}");
    }
    assert_eq!(night_of(night.start, &site).unwrap(), date!(2026 - 03 - 28));
    assert_eq!(night_of(night.end - Duration::seconds(1), &site).unwrap(), date!(2026 - 03 - 28));
    assert_eq!(night_of(night.end, &site).unwrap(), date!(2026 - 03 - 29));

    let set = windows(&ngc, &site, date!(2026 - 03 - 26), 5, low);
    assert_every_minute_meets(&set, &ngc, &site);
    let nights: Vec<Date> = set.nights.iter().map(|night| night.night).collect();
    let expected = [26, 27, 28, 29, 30].map(|day| date!(2026 - 03 - 01).replace_day(day).unwrap());
    assert_eq!(nights, expected, "consecutive calendar nights");
    let spanning: Vec<_> = set
        .windows()
        .filter(|window| window.start_utc < change && change < window.end_utc)
        .collect();
    let [window] = spanning.as_slice() else {
        panic!("one window across the change: {:?}", set.windows().collect::<Vec<_>>());
    };
    assert_eq!(window.night, date!(2026 - 03 - 28));
    assert_eq!((window.start_local.offset(), window.end_local.offset()), (before, after));
    for window in set.windows() {
        for (utc, local) in
            [(window.start_utc, window.start_local), (window.end_utc, window.end_local)]
        {
            assert_eq!(local, utc.to_offset(if utc < change { before } else { after }));
        }
    }
}

#[test]
fn set_then_rise_never_dark_and_always_dark_nights_have_their_own_shapes() {
    let (ngc, backyard, polar) = (ngc_7000(), backyard(), polar());
    let low = PlanCriteria {
        min_altitude_deg: 15.0,
        moon: MoonCriterion::None,
        min_duration_minutes: 30,
        ..quickstart()
    };
    let twice = windows(&ngc, &backyard, date!(2027 - 01 - 15), 1, low);
    assert_eq!(twice.nights[0].windows.len(), 2, "{twice:?}");
    assert_every_minute_meets(&twice, &ngc, &backyard);

    let summer = PlanCriteria { moon: MoonCriterion::None, ..quickstart() };
    let bright = windows(&ngc, &backyard, date!(2026 - 06 - 20), 1, summer);
    assert!(bright.nights[0].windows.is_empty());
    assert_eq!(bright.nights[0].no_window_reason, Some(NoWindowReason::NeverDark));

    let civil =
        PlanCriteria { darkness: Darkness::Civil, moon: MoonCriterion::None, ..quickstart() };
    let dark = windows(&ngc, &polar, date!(2026 - 12 - 20), 1, civil);
    let whole = &dark.nights[0].windows;
    assert_eq!(whole.len(), 1, "{dark:?}");
    assert_eq!(whole[0].start_local, datetime!(2026-12-20 12:00 +01:00));
    assert_eq!(whole[0].end_local, datetime!(2026-12-21 12:00 +01:00));
    assert_eq!(whole[0].duration_minutes, 1440);

    let southern =
        target(Some(SkyCoordinates { ra_deg: 201.37, dec_deg: -60.0, frame: "icrs".into() }));
    let never = windows(&southern, &backyard, date!(2026 - 10 - 20), 1, quickstart());
    assert_eq!(never.nights[0].no_window_reason, Some(NoWindowReason::TargetNeverAbove));
}

#[test]
fn the_moon_limit_excludes_moon_up_and_close_spans() {
    let (ngc, backyard) = (ngc_7000(), backyard());
    let open = windows(
        &ngc,
        &backyard,
        date!(2026 - 10 - 20),
        30,
        PlanCriteria { moon: MoonCriterion::None, ..quickstart() },
    );
    let total = |set: &WindowSet| set.windows().map(|window| window.duration_minutes).sum::<u32>();
    for moon in
        [MoonCriterion::BelowHorizon, MoonCriterion::MinSeparation { min_separation_deg: 100.0 }]
    {
        let limited = windows(
            &ngc,
            &backyard,
            date!(2026 - 10 - 20),
            30,
            PlanCriteria { moon, ..quickstart() },
        );
        assert!(total(&limited) < total(&open), "{moon:?} excluded nothing");
        for window in limited.windows() {
            assert!(
                open.windows().any(
                    |wide| wide.start_utc <= window.start_utc && window.end_utc <= wide.end_utc
                ),
                "{window:?}"
            );
        }
        assert_every_minute_meets(&limited, &ngc, &backyard);
        assert!(limited.nights.iter().any(|night| night.no_window_reason
            == Some(NoWindowReason::MoonExcluded)
            || night.windows.len()
                < open
                    .nights
                    .iter()
                    .find(|wide| wide.night == night.night)
                    .unwrap()
                    .windows
                    .len()
            || night.windows.iter().map(|w| w.duration_minutes).sum::<u32>()
                < open
                    .nights
                    .iter()
                    .find(|wide| wide.night == night.night)
                    .unwrap()
                    .windows
                    .iter()
                    .map(|w| w.duration_minutes)
                    .sum::<u32>()));
    }
}

#[test]
fn boundaries_round_inward_and_windows_short_after_rounding_are_dropped() {
    let (ngc, backyard) = (ngc_7000(), backyard());
    let night = date!(2026 - 10 - 20);
    let spans = night_spans(&ngc, &backyard, night, &quickstart()).unwrap();
    assert_eq!(spans.windows.len(), 1, "{spans:?}");
    let Span { start, end } = spans.windows[0];
    let set = windows(&ngc, &backyard, night, 1, quickstart());
    let window = &set.nights[0].windows[0];
    assert!(
        window.start_utc >= start && window.start_utc - start < Duration::minutes(2),
        "{window:?} {start}"
    );
    assert!(
        window.end_utc <= end && end - window.end_utc < Duration::minutes(2),
        "{window:?} {end}"
    );
    let rounded = window.duration_minutes;
    let exact = windows(
        &ngc,
        &backyard,
        night,
        1,
        PlanCriteria { min_duration_minutes: rounded, ..quickstart() },
    );
    assert_eq!(exact.nights[0].windows.len(), 1);
    let short = windows(
        &ngc,
        &backyard,
        night,
        1,
        PlanCriteria { min_duration_minutes: rounded + 1, ..quickstart() },
    );
    assert!(short.nights[0].windows.is_empty());
    assert_eq!(short.nights[0].no_window_reason, Some(NoWindowReason::ShorterThanMinimum));
}

#[test]
fn targets_without_icrs_coordinates_have_no_nights_and_zones_must_be_bundled_iana_names() {
    let backyard = backyard();
    let unknown = windows(&target(None), &backyard, date!(2026 - 10 - 20), 3, quickstart());
    assert_eq!(unknown.unavailable_reason, Some(WindowUnavailableReason::TargetCoordinatesUnknown));
    assert!(unknown.nights.is_empty());
    let fk4 = target(Some(SkyCoordinates { ra_deg: 314.75, dec_deg: 44.33, frame: "fk4".into() }));
    let other = windows(&fk4, &backyard, date!(2026 - 10 - 20), 3, quickstart());
    assert_eq!(other.unavailable_reason, Some(WindowUnavailableReason::UnsupportedCoordinateFrame));
    assert!(other.nights.is_empty());

    for zone in ["Europe/Amsterdam", "Europe/Athens", "Arctic/Longyearbyen", "UTC"] {
        assert!(validate_time_zone(zone).is_ok(), "{zone}");
    }
    for zone in ["Mars/Olympus", "europe/amsterdam", " Europe/Amsterdam", "Etc/Unknown", ""] {
        match validate_time_zone(zone) {
            Err(LibraryError::InvalidInput(message)) => {
                assert!(message.contains("timeZone"), "{message}");
            }
            other => panic!("{zone:?} accepted: {other:?}"),
        }
    }
    let mars = ObservingSite { time_zone: "Mars/Olympus".into(), ..backyard };
    let query = query(&ngc_7000(), &mars, date!(2026 - 10 - 20), 1, quickstart());
    assert!(matches!(
        compute_windows(&ngc_7000(), &mars, &query),
        Err(LibraryError::InvalidInput(_))
    ));
}

fn instant(value: &serde_json::Value) -> OffsetDateTime {
    OffsetDateTime::parse(value.as_str().unwrap(), &time::format_description::well_known::Rfc3339)
        .unwrap()
}

fn assert_agree(label: &str, ours: &[Span], reference: &serde_json::Value) {
    // Slivers shorter than the tolerance may exist on one side only.
    let long = |span: &Span| span.end - span.start > Duration::seconds(2 * TOLERANCE_SECONDS);
    let theirs: Vec<Span> = reference
        .as_array()
        .unwrap()
        .iter()
        .map(|span| Span { start: instant(&span["startUtc"]), end: instant(&span["endUtc"]) })
        .collect();
    let close =
        |a: OffsetDateTime, b: OffsetDateTime| (a - b).whole_seconds().abs() <= TOLERANCE_SECONDS;
    for (left, right, side) in
        [(ours, theirs.as_slice(), "ours"), (theirs.as_slice(), ours, "reference")]
    {
        for span in left.iter().filter(|span| long(span)) {
            assert!(
                right
                    .iter()
                    .any(|other| close(span.start, other.start) && close(span.end, other.end)),
                "{label}: {side} span {span:?} has no counterpart in {right:?}"
            );
        }
    }
}

#[test]
fn unrounded_boundaries_agree_with_the_astroplan_reference_within_180_seconds() {
    let reference: serde_json::Value = serde_json::from_str(REFERENCE).unwrap();
    let ngc = ngc_7000();
    let sites = [("backyard", backyard()), ("second", athens()), ("polar", polar())];
    let mut nights = 0;
    for case in reference["cases"].as_array().unwrap() {
        let site = &sites.iter().find(|(key, _)| case["site"] == *key).unwrap().1;
        let criteria: PlanCriteria = serde_json::from_value(case["criteria"].clone()).unwrap();
        for night in case["nights"].as_array().unwrap() {
            let date = Date::parse(
                night["night"].as_str().unwrap(),
                time::macros::format_description!("[year]-[month]-[day]"),
            )
            .unwrap();
            let spans = night_spans(&ngc, site, date, &criteria).unwrap();
            let label = format!("{} {date}", case["case"]);
            assert_eq!(spans.start, instant(&night["nightStartUtc"]), "{label}");
            assert_eq!(spans.end, instant(&night["nightEndUtc"]), "{label}");
            assert_agree(&format!("{label} dark"), &spans.dark, &night["dark"]);
            assert_agree(&format!("{label} above"), &spans.above, &night["above"]);
            assert_agree(&format!("{label} moon"), &spans.moon_allowed, &night["moonAllowed"]);
            assert_agree(&format!("{label} windows"), &spans.windows, &night["windows"]);
            nights += 1;
        }
    }
    assert_eq!(nights, 68);
}

#[test]
fn equal_inputs_produce_identical_windows_and_keys() {
    let (ngc, backyard) = (ngc_7000(), backyard());
    let first = windows(&ngc, &backyard, date!(2026 - 10 - 20), 30, quickstart());
    let second = windows(&ngc, &backyard, date!(2026 - 10 - 20), 30, quickstart());
    assert_eq!(first, second);
    let shifted = windows(&ngc, &backyard, date!(2026 - 10 - 25), 5, quickstart());
    for window in shifted.windows() {
        assert!(first.windows().any(|same| same == window), "{window:?}");
    }
    assert_eq!(UtcOffset::UTC, first.windows().next().unwrap().key.start_utc().offset());
}

/// Every night of every reference case with its site, criteria and the
/// reference record.
fn reference_nights() -> Vec<(String, ObservingSite, PlanCriteria, Date, serde_json::Value)> {
    let reference: serde_json::Value = serde_json::from_str(REFERENCE).unwrap();
    let sites = [("backyard", backyard()), ("second", athens()), ("polar", polar())];
    let mut nights = Vec::new();
    for case in reference["cases"].as_array().unwrap() {
        let site = &sites.iter().find(|(key, _)| case["site"] == *key).unwrap().1;
        let criteria: PlanCriteria = serde_json::from_value(case["criteria"].clone()).unwrap();
        for night in case["nights"].as_array().unwrap() {
            let date = Date::parse(
                night["night"].as_str().unwrap(),
                time::macros::format_description!("[year]-[month]-[day]"),
            )
            .unwrap();
            let label = format!("{} {date}", case["case"]);
            nights.push((label, site.clone(), criteria, date, night.clone()));
        }
    }
    nights
}

fn geometric_altitude(target: &TargetRecord, site: &ObservingSite, at: OffsetDateTime) -> f64 {
    let coordinates = target.candidate.coordinates.as_ref().unwrap();
    let position = Equatorial::j2000(
        Angle::from_degrees(coordinates.ra_deg),
        Angle::from_degrees(coordinates.dec_deg),
    )
    .unwrap();
    let location = Location::new(
        Angle::from_degrees(site.latitude_deg),
        Angle::from_degrees(site.longitude_deg),
        site.elevation_m.unwrap_or(0.0),
    )
    .unwrap();
    alt_az(position, at, &location).altitude.degrees()
}

/// PLAN-FR-11 / D-W39: every window reports the Target's highest altitude
/// within it. It is at least the altitude of every listed minute and at most a
/// hundredth of a degree above the highest of them, and it agrees with the
/// astroplan reference: within 0.05 degrees at a transit, within 1 degree at a
/// boundary (README tolerances).
#[test]
fn window_reports_peak_altitude() {
    let ngc = ngc_7000();
    let mut transit_peaks = 0;
    let mut boundary_peaks = 0;
    for (label, site, criteria, date, night) in reference_nights() {
        let set = windows(&ngc, &site, date, 1, criteria);
        let theirs = night["windows"].as_array().unwrap();
        for window in set.windows() {
            let minutes = (window.end_utc - window.start_utc).whole_minutes();
            let sampled = (0..=minutes)
                .map(|minute| {
                    geometric_altitude(&ngc, &site, window.start_utc + Duration::minutes(minute))
                })
                .fold(f64::MIN, f64::max);
            let peak = window.peak_altitude_deg;
            assert!(peak >= sampled - 1e-9, "{label}: peak {peak} below sampled {sampled}");
            assert!(peak - sampled < 0.01, "{label}: peak {peak} far above sampled {sampled}");
            let reference = theirs
                .iter()
                .find(|span| {
                    let close = |ours: OffsetDateTime, key: &str| {
                        (ours - instant(&span[key])).whole_seconds().abs() <= TOLERANCE_SECONDS + 60
                    };
                    close(window.start_utc, "startUtc") && close(window.end_utc, "endUtc")
                })
                .unwrap_or_else(|| panic!("{label}: {window:?} has no reference window"));
            let expected = reference["peakAltitudeDeg"].as_f64().unwrap();
            let (tolerance, count) = if reference["peakInterior"].as_bool().unwrap() {
                (0.05, &mut transit_peaks)
            } else {
                (1.0, &mut boundary_peaks)
            };
            assert!(
                (peak - expected).abs() <= tolerance,
                "{label}: peak {peak} against reference {expected}"
            );
            *count += 1;
        }
    }
    assert!(transit_peaks > 0 && boundary_peaks > 0, "{transit_peaks} / {boundary_peaks}");
}

/// The phase sector of a Sun-Moon elongation (180 minus the phase angle) and
/// whether the Moon waxes, or None within half a degree of a sector boundary.
fn reference_phase(phase_angle_deg: f64, waxing: bool) -> Option<MoonPhase> {
    let elongation = 180.0 - phase_angle_deg;
    if [22.5, 67.5, 112.5, 157.5].iter().any(|edge| (elongation - edge).abs() < 0.5) {
        return None;
    }
    Some(match (elongation, waxing) {
        (e, _) if e < 22.5 => MoonPhase::New,
        (e, _) if e >= 157.5 => MoonPhase::Full,
        (e, true) if e < 67.5 => MoonPhase::WaxingCrescent,
        (e, true) if e < 112.5 => MoonPhase::FirstQuarter,
        (_, true) => MoonPhase::WaxingGibbous,
        (e, false) if e < 67.5 => MoonPhase::WaningCrescent,
        (e, false) if e < 112.5 => MoonPhase::LastQuarter,
        (_, false) => MoonPhase::WaningGibbous,
    })
}

/// PLAN-FR-11 / D-W39: the night sky at a site names the Moon's illumination,
/// phase, rise and set and the darkness window, agreeing with the astroplan
/// reference on every reference night, the 23-hour spring night included.
#[test]
fn night_sky_reports_moon_rise_set_and_darkness_window() {
    let close = |ours: Option<OffsetDateTime>, theirs: Option<OffsetDateTime>| match (ours, theirs)
    {
        (Some(a), Some(b)) => (a - b).whole_seconds().abs() <= TOLERANCE_SECONDS,
        (None, None) => true,
        _ => false,
    };
    let mut nights = 0;
    let mut rises = 0;
    let mut phases = 0;
    for (label, site, criteria, date, night) in reference_nights() {
        let sky = night_sky(&site, date, criteria.darkness).unwrap();
        assert_eq!((sky.night, sky.level), (date, criteria.darkness), "{label}");
        assert_eq!((&sky.site.name, &sky.time_zone), (&site.name, &site.time_zone), "{label}");
        let (start, end) = (instant(&night["nightStartUtc"]), instant(&night["nightEndUtc"]));

        let dark = night["dark"].as_array().unwrap();
        match (&sky.darkness, dark.first(), dark.last()) {
            (None, None, None) => {}
            (Some(ours), Some(first), Some(last)) => {
                assert!(close(Some(ours.start_utc), Some(instant(&first["startUtc"]))), "{label}");
                assert!(close(Some(ours.end_utc), Some(instant(&last["endUtc"]))), "{label}");
                assert_eq!(ours.start_local, ours.start_utc, "{label}");
                assert_eq!(ours.end_local, ours.end_utc, "{label}");
            }
            (ours, first, _) => panic!("{label}: darkness {ours:?} against {first:?}"),
        }

        let down = night["moonDown"].as_array().unwrap();
        let rise = down.iter().map(|span| instant(&span["endUtc"])).find(|at| *at < end);
        let set = down.iter().map(|span| instant(&span["startUtc"])).find(|at| *at > start);
        assert!(close(sky.moon.rise_utc, rise), "{label}: rise {:?} against {rise:?}", sky.moon);
        assert!(close(sky.moon.set_utc, set), "{label}: set {:?} against {set:?}", sky.moon);
        rises += usize::from(rise.is_some());

        let illumination = night["moonIllumination"].as_f64().unwrap();
        assert!((sky.moon.illumination - illumination).abs() <= 0.01, "{label}: {:?}", sky.moon);
        if let Some(phase) = reference_phase(
            night["moonPhaseAngleDeg"].as_f64().unwrap(),
            night["moonWaxing"].as_bool().unwrap(),
        ) {
            assert_eq!(sky.moon.phase, phase, "{label}: {:?}", sky.moon);
            phases += 1;
        }
        nights += 1;
    }
    assert_eq!(nights, 68);
    assert!(rises > 30 && phases > 60, "{rises} rises, {phases} phases checked");

    // The 23-hour night: dusk before the change at +01:00, dawn after it at +02:00.
    let spring = night_sky(&backyard(), date!(2026 - 03 - 28), Darkness::Astronomical).unwrap();
    let dark = spring.darkness.expect("a dark spring night");
    assert!(dark.start_utc < datetime!(2026-03-29 01:00 UTC), "{dark:?}");
    assert!(dark.end_utc > datetime!(2026-03-29 01:00 UTC), "{dark:?}");
    assert_eq!((dark.start_local.offset(), dark.end_local.offset()), (offset!(+1), offset!(+2)));
    assert_eq!(spring.method, platevault_core::planning::METHOD);
}
