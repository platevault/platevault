// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Observing windows (spec 072): pure astronomical window computation for a
//! saved Target from a saved site, composed from skymath 0.7.2 twilight,
//! altitude-crossing, Moon-crossing and lunar-separation primitives, with night
//! boundaries and local times from the bundled IANA time-zone database.
//! Suitability is astronomical only; nothing here performs I/O.
//!
//! A night runs from local noon on its date to local noon on the next date
//! (research R5). Each night intersects the dark interval, the target-above
//! intervals and the Moon-allowed intervals (R7). Crossings bracket one transit
//! or culmination each, so every primitive is queried at the night's start,
//! middle and end and the clipped results are merged. Separation intervals come
//! from 10-minute samples bisected to one second. Boundaries are rounded inward
//! to whole minutes and then checked against the same primitives, so every
//! listed minute meets the criteria.

use std::sync::LazyLock;

use jiff::tz::{TimeZone, TimeZoneDatabase};
use skymath::{
    alt_az, altitude_crossings, lunar_separation, moon_crossings, moon_position_topocentric,
    sun_position, twilight, Angle, CrossingOutcome, Equatorial, Location, Twilight,
    TwilightOutcome,
};
use time::{Date, Duration, OffsetDateTime, UtcOffset};

use crate::{
    Darkness, LibraryError, MoonCriterion, NightPlan, NoWindowReason, ObservingSite,
    ObservingWindow, PlanCriteria, TargetRecord, WindowBasis, WindowKey, WindowQuery, WindowSet,
    WindowUnavailableReason,
};

/// How every window is computed; named in each window basis.
pub const METHOD: &str = "skymath 0.7.2, geometric, no refraction";

/// Separation sampling step and bisection resolution (R7).
const SEPARATION_STEP: Duration = Duration::minutes(10);
const BISECTION_RESOLUTION: Duration = Duration::seconds(1);

/// The bundled database only, never the host's zoneinfo (R3).
static ZONES: LazyLock<TimeZoneDatabase> = LazyLock::new(TimeZoneDatabase::bundled);

/// A UTC interval from `start` to `end`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Span {
    pub start: OffsetDateTime,
    pub end: OffsetDateTime,
}

/// The unrounded intervals of one night, each clipped to the night.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NightSpans {
    pub night: Date,
    /// Local noon of the night's date, in UTC.
    pub start: OffsetDateTime,
    /// Local noon of the next date, in UTC.
    pub end: OffsetDateTime,
    pub dark: Vec<Span>,
    pub above: Vec<Span>,
    pub moon_allowed: Vec<Span>,
    /// The intersection of `dark`, `above` and `moon_allowed`, before rounding.
    pub windows: Vec<Span>,
}

/// Check that `name` is a canonical IANA zone name in the bundled database.
///
/// # Errors
/// `InvalidInput` naming `timeZone` for an unknown or non-canonical name.
pub fn validate_time_zone(name: &str) -> Result<(), LibraryError> {
    zone(name).map(drop)
}

/// The night, by its site-local evening date, that holds `instant`.
///
/// # Errors
/// `InvalidInput` naming `timeZone` when the site's zone is not bundled.
pub fn night_of(instant: OffsetDateTime, site: &ObservingSite) -> Result<Date, LibraryError> {
    let zone = zone(&site.time_zone)?;
    let local = local(&zone, instant)?;
    if local.hour() < 12 {
        local.date().previous_day().ok_or_else(|| out_of_range(instant))
    } else {
        Ok(local.date())
    }
}

/// Compute the windows of one Target at one site. The query names the night
/// range and the criteria; the site is a parameter and nothing is stored.
///
/// # Errors
/// `InvalidInput` for an invalid query, a query naming another Target or site,
/// an unbundled zone or an invalid site position.
pub fn compute_windows(
    target: &TargetRecord,
    site: &ObservingSite,
    query: &WindowQuery,
) -> Result<WindowSet, LibraryError> {
    query.validate()?;
    if query.target_id != target.candidate.id || query.site_id != site.id {
        return Err(LibraryError::InvalidInput(format!(
            "window query names target {} at site {}, not target {} at site {}",
            query.target_id, query.site_id, target.candidate.id, site.id
        )));
    }
    let zone = zone(&site.time_zone)?;
    let basis = WindowBasis {
        target_id: target.candidate.id,
        target_revision: target.decision_revision,
        designation: target.candidate.designation.clone(),
        site: site.basis(),
        time_zone: site.time_zone.clone(),
        criteria: query.criteria,
        method: METHOD.into(),
    };
    let position = match position(target) {
        Ok(position) => position,
        Err(reason) => {
            return Ok(WindowSet { basis, nights: Vec::new(), unavailable_reason: Some(reason) })
        }
    };
    let sky = Sky { position, location: location(site)?, criteria: query.criteria };
    let mut nights = Vec::new();
    let mut night = query.first_night;
    for index in 0..query.nights {
        if index > 0 {
            night = night.next_day().ok_or_else(|| out_of_range(night))?;
        }
        let spans = sky.night(&zone, night)?;
        nights.push(plan_night(&sky, &zone, target, site, &spans)?);
    }
    Ok(WindowSet { basis, nights, unavailable_reason: None })
}

/// The unrounded intervals of one night, for qualification against an
/// independent reference.
///
/// # Errors
/// `InvalidInput` for invalid criteria, a Target without `icrs` coordinates,
/// an unbundled zone or an invalid site position.
pub fn night_spans(
    target: &TargetRecord,
    site: &ObservingSite,
    night: Date,
    criteria: &PlanCriteria,
) -> Result<NightSpans, LibraryError> {
    criteria.validate()?;
    let position = position(target).map_err(|reason| {
        LibraryError::InvalidInput(format!(
            "target {} has no usable position: {reason:?}",
            target.candidate.id
        ))
    })?;
    let sky = Sky { position, location: location(site)?, criteria: *criteria };
    sky.night(&zone(&site.time_zone)?, night)
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

fn zone(name: &str) -> Result<TimeZone, LibraryError> {
    let unknown = || {
        LibraryError::InvalidInput(format!(
            "timeZone {name:?} is not an IANA name in the bundled time-zone database"
        ))
    };
    let zone = ZONES.get(name).map_err(|_| unknown())?;
    match zone.iana_name() {
        Some(canonical) if canonical == name && !zone.is_unknown() => Ok(zone),
        Some(canonical) if !zone.is_unknown() => Err(LibraryError::InvalidInput(format!(
            "timeZone {name:?} is not canonical; the bundled database names it {canonical:?}"
        ))),
        _ => Err(unknown()),
    }
}

fn position(target: &TargetRecord) -> Result<Equatorial, WindowUnavailableReason> {
    let coordinates = target
        .candidate
        .coordinates
        .as_ref()
        .ok_or(WindowUnavailableReason::TargetCoordinatesUnknown)?;
    if !coordinates.frame.eq_ignore_ascii_case("icrs") {
        return Err(WindowUnavailableReason::UnsupportedCoordinateFrame);
    }
    // ICRS and J2000 differ by milliarcseconds, far below the window resolution.
    Equatorial::j2000(
        Angle::from_degrees(coordinates.ra_deg),
        Angle::from_degrees(coordinates.dec_deg),
    )
    .map_err(|_| WindowUnavailableReason::TargetCoordinatesUnknown)
}

fn location(site: &ObservingSite) -> Result<Location, LibraryError> {
    // Elevation only moves the topocentric Moon by meters of parallax; an
    // unknown elevation computes at sea level.
    Location::new(
        Angle::from_degrees(site.latitude_deg),
        Angle::from_degrees(site.longitude_deg),
        site.elevation_m.unwrap_or(0.0),
    )
    .map_err(|error| LibraryError::InvalidInput(format!("site {} position: {error}", site.id)))
}

fn out_of_range(near: impl std::fmt::Display) -> LibraryError {
    LibraryError::InvalidInput(format!("night near {near} is outside the supported calendar"))
}

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

fn offset_at(zone: &TimeZone, instant: OffsetDateTime) -> Result<UtcOffset, LibraryError> {
    let stamp = jiff::Timestamp::from_second(instant.unix_timestamp())
        .map_err(|_| out_of_range(instant))?;
    UtcOffset::from_whole_seconds(zone.to_offset(stamp).seconds())
        .map_err(|_| out_of_range(instant))
}

fn local(zone: &TimeZone, instant: OffsetDateTime) -> Result<OffsetDateTime, LibraryError> {
    Ok(instant.to_offset(offset_at(zone, instant)?))
}

/// Local noon of `date` in `zone`, in UTC.
fn local_noon(zone: &TimeZone, date: Date) -> Result<OffsetDateTime, LibraryError> {
    let fail = || out_of_range(date);
    let civil = jiff::civil::date(
        i16::try_from(date.year()).map_err(|_| fail())?,
        i8::try_from(u8::from(date.month())).map_err(|_| fail())?,
        i8::try_from(date.day()).map_err(|_| fail())?,
    )
    .at(12, 0, 0, 0);
    let zoned = zone.to_zoned(civil).map_err(|_| fail())?;
    OffsetDateTime::from_unix_timestamp(zoned.timestamp().as_second()).map_err(|_| fail())
}

// ---------------------------------------------------------------------------
// One night
// ---------------------------------------------------------------------------

struct Sky {
    position: Equatorial,
    location: Location,
    criteria: PlanCriteria,
}

impl Sky {
    fn night(&self, zone: &TimeZone, night: Date) -> Result<NightSpans, LibraryError> {
        let start = local_noon(zone, night)?;
        let next = night.next_day().ok_or_else(|| out_of_range(start))?;
        let end = local_noon(zone, next)?;
        let bounds = Span { start, end };
        let probes = [start, start + (end - start) / 2, end];
        let kind = match self.criteria.darkness {
            Darkness::Civil => Twilight::Civil,
            Darkness::Nautical => Twilight::Nautical,
            Darkness::Astronomical => Twilight::Astronomical,
        };
        let dark = merge(probes.iter().map(|near| match twilight(kind, *near, &self.location) {
            TwilightOutcome::Night { dusk, dawn } => clip(Span { start: dusk, end: dawn }, bounds),
            TwilightOutcome::AlwaysDark => Some(bounds),
            TwilightOutcome::NeverDark => None,
        }));
        let threshold = Angle::from_degrees(self.criteria.min_altitude_deg);
        let above = merge(probes.iter().map(|near| {
            crossing_span(
                altitude_crossings(self.position, threshold, *near, &self.location),
                bounds,
            )
        }));
        let moon_allowed = match self.criteria.moon {
            MoonCriterion::None => vec![bounds],
            MoonCriterion::BelowHorizon => self.moon_down(&probes, bounds),
            MoonCriterion::MinSeparation { min_separation_deg } => {
                let apart = self.separated(bounds, min_separation_deg);
                union(&self.moon_down(&probes, bounds), &apart)
            }
        };
        let windows = intersect(&intersect(&dark, &above), &moon_allowed);
        Ok(NightSpans { night, start, end, dark, above, moon_allowed, windows })
    }

    fn moon_down(&self, probes: &[OffsetDateTime], bounds: Span) -> Vec<Span> {
        let horizon = Angle::from_degrees(0.0);
        let up = merge(
            probes
                .iter()
                .map(|near| crossing_span(moon_crossings(horizon, *near, &self.location), bounds)),
        );
        complement(&up, bounds)
    }

    /// Where the topocentric separation is at least `limit` degrees.
    fn separated(&self, bounds: Span, limit: f64) -> Vec<Span> {
        let apart = |at: OffsetDateTime| {
            lunar_separation(self.position, at, &self.location).degrees() >= limit
        };
        let mut spans = Vec::new();
        let mut open = apart(bounds.start).then_some(bounds.start);
        let mut previous = bounds.start;
        while previous < bounds.end {
            let next = (previous + SEPARATION_STEP).min(bounds.end);
            let inside = apart(next);
            if inside != open.is_some() {
                let edge = bisect(previous, next, &apart, !inside);
                match open.take() {
                    Some(from) => spans.push(Span { start: from, end: edge }),
                    None => open = Some(edge),
                }
            }
            previous = next;
        }
        if let Some(from) = open {
            spans.push(Span { start: from, end: bounds.end });
        }
        spans.retain(|span| span.end > span.start);
        spans
    }

    /// Whether one instant meets every criterion under the same primitives.
    fn meets(&self, at: OffsetDateTime) -> bool {
        let altitude = alt_az(self.position, at, &self.location).altitude.degrees();
        if altitude < self.criteria.min_altitude_deg {
            return false;
        }
        let sun = alt_az(sun_position(at), at, &self.location).altitude.degrees();
        if sun >= self.criteria.darkness.sun_altitude_deg() {
            return false;
        }
        let moon_up = || {
            alt_az(moon_position_topocentric(at, &self.location), at, &self.location)
                .altitude
                .degrees()
                >= 0.0
        };
        match self.criteria.moon {
            MoonCriterion::None => true,
            MoonCriterion::BelowHorizon => !moon_up(),
            MoonCriterion::MinSeparation { min_separation_deg } => {
                !moon_up()
                    || lunar_separation(self.position, at, &self.location).degrees()
                        >= min_separation_deg
            }
        }
    }
}

/// The instant within `(low, high]` where `predicate` changes, to one second;
/// `before` is its value at `low`. Returns the first instant past the edge
/// when the span opens, and the last instant before it when the span closes.
fn bisect(
    mut low: OffsetDateTime,
    mut high: OffsetDateTime,
    predicate: &impl Fn(OffsetDateTime) -> bool,
    before: bool,
) -> OffsetDateTime {
    while high - low > BISECTION_RESOLUTION {
        let middle = low + (high - low) / 2;
        if predicate(middle) == before {
            low = middle;
        } else {
            high = middle;
        }
    }
    if before {
        low
    } else {
        high
    }
}

fn plan_night(
    sky: &Sky,
    zone: &TimeZone,
    target: &TargetRecord,
    site: &ObservingSite,
    spans: &NightSpans,
) -> Result<NightPlan, LibraryError> {
    let mut windows = Vec::new();
    for span in &spans.windows {
        let Some((start, end)) = round_inward(sky, *span) else { continue };
        let minutes = u32::try_from((end - start).whole_minutes()).unwrap_or(u32::MAX);
        if minutes < sky.criteria.min_duration_minutes {
            continue;
        }
        windows.push(ObservingWindow {
            key: WindowKey::new(target.candidate.id, site.id, start)?,
            start_utc: start,
            end_utc: end,
            start_local: local(zone, start)?,
            end_local: local(zone, end)?,
            time_zone: site.time_zone.clone(),
            duration_minutes: minutes,
            night: spans.night,
            site_name: site.name.clone(),
        });
    }
    let no_window_reason = windows.is_empty().then(|| {
        if spans.dark.is_empty() {
            NoWindowReason::NeverDark
        } else if spans.above.is_empty() {
            NoWindowReason::TargetNeverAbove
        } else if intersect(&spans.dark, &spans.above).is_empty() {
            NoWindowReason::NoOverlap
        } else if spans.windows.is_empty() {
            NoWindowReason::MoonExcluded
        } else {
            NoWindowReason::ShorterThanMinimum
        }
    });
    Ok(NightPlan { night: spans.night, windows, no_window_reason })
}

/// Round a span inward to whole minutes, then step each boundary inward until
/// it meets the criteria under the same primitives, so every listed minute does.
fn round_inward(sky: &Sky, span: Span) -> Option<(OffsetDateTime, OffsetDateTime)> {
    let mut start = floor_minute(span.start);
    if start < span.start {
        start += Duration::MINUTE;
    }
    let mut end = floor_minute(span.end);
    while start <= end && !sky.meets(start) {
        start += Duration::MINUTE;
    }
    while end >= start && !sky.meets(end) {
        end -= Duration::MINUTE;
    }
    (start < end).then_some((start, end))
}

fn floor_minute(at: OffsetDateTime) -> OffsetDateTime {
    at - Duration::seconds(i64::from(at.second()))
        - Duration::nanoseconds(i64::from(at.nanosecond()))
}

// ---------------------------------------------------------------------------
// Interval algebra over sorted, disjoint spans
// ---------------------------------------------------------------------------

fn clip(span: Span, bounds: Span) -> Option<Span> {
    let start = span.start.max(bounds.start);
    let end = span.end.min(bounds.end);
    (end > start).then_some(Span { start, end })
}

fn crossing_span(outcome: CrossingOutcome, bounds: Span) -> Option<Span> {
    match outcome {
        CrossingOutcome::AlwaysAbove => Some(bounds),
        CrossingOutcome::NeverAbove => None,
        CrossingOutcome::Crosses { rise, set } => clip(Span { start: rise, end: set }, bounds),
    }
}

fn merge(spans: impl Iterator<Item = Option<Span>>) -> Vec<Span> {
    let mut spans: Vec<Span> = spans.flatten().collect();
    spans.sort_by_key(|span| span.start);
    let mut merged: Vec<Span> = Vec::with_capacity(spans.len());
    for span in spans {
        match merged.last_mut() {
            Some(last) if span.start <= last.end => last.end = last.end.max(span.end),
            _ => merged.push(span),
        }
    }
    merged
}

fn union(first: &[Span], second: &[Span]) -> Vec<Span> {
    merge(first.iter().chain(second).copied().map(Some))
}

fn intersect(first: &[Span], second: &[Span]) -> Vec<Span> {
    let mut out = Vec::new();
    for a in first {
        for b in second {
            if let Some(span) = clip(*a, *b) {
                out.push(span);
            }
        }
    }
    merge(out.into_iter().map(Some))
}

fn complement(spans: &[Span], bounds: Span) -> Vec<Span> {
    let mut out = Vec::new();
    let mut cursor = bounds.start;
    for span in spans {
        if span.start > cursor {
            out.push(Span { start: cursor, end: span.start });
        }
        cursor = cursor.max(span.end);
    }
    if bounds.end > cursor {
        out.push(Span { start: cursor, end: bounds.end });
    }
    out
}
