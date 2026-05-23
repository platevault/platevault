//! T033a — `session_key` derivation + `observing_night` local-solar-noon
//! algorithm.
//!
//! See `specs/002-data-lifecycle-state-model/research.md` §2.5. Missing
//! `observer_location` is a refusable condition surfaced via [`KeyError::
//! ObserverLocationMissing`] — callers raise `provenance.unreviewed` against
//! the spec-018 settings field rather than guessing.

use thiserror::Error;
use time::{Date, Month, OffsetDateTime, UtcOffset};

/// Observer location subset needed for the night calculation.
#[derive(Clone, Debug)]
pub struct ObserverContext {
    /// Fixed UTC offset for the capture site. Computed from the IANA tz on
    /// the calling side (timezone-database resolution lives in the metadata
    /// extractor, not in this pure-domain crate).
    pub utc_offset: UtcOffset,
}

#[derive(Debug, Error)]
pub enum KeyError {
    #[error(
        "observer_location is unset for this frame; refuse session formation \
         (see spec 018 observer_location; emit provenance.unreviewed)"
    )]
    ObserverLocationMissing,
}

/// Compute the local-solar-noon-bounded observing night for the given UTC
/// capture timestamp.
///
/// Returns the start-of-night local calendar date in `YYYY-MM-DD` form.
/// Pre-noon local timestamps belong to the *previous* night (still imaging
/// last night until local solar noon).
///
/// # Errors
/// Returns [`KeyError::ObserverLocationMissing`] when `observer` is `None`.
pub fn observing_night(
    utc_capture_at: OffsetDateTime,
    observer: Option<&ObserverContext>,
) -> Result<String, KeyError> {
    let observer = observer.ok_or(KeyError::ObserverLocationMissing)?;
    let local = utc_capture_at.to_offset(observer.utc_offset);
    let date = if local.hour() < 12 { previous_day(local.date()) } else { local.date() };
    Ok(format_date_iso(date))
}

/// Derive the canonical session key tuple as a stable string.
///
/// Frames whose `observing_night` differs MUST split into separate sessions
/// (FR-012); that split decision lives in the candidate-formation pipeline,
/// not here. This function is the pure key-canonicalisation step.
///
/// # Errors
/// Returns [`KeyError::ObserverLocationMissing`] when `observer` is `None`.
pub fn session_key(
    target_id: &str,
    filter: &str,
    binning: &str,
    gain: &str,
    utc_capture_at: OffsetDateTime,
    observer: Option<&ObserverContext>,
) -> Result<String, KeyError> {
    let night = observing_night(utc_capture_at, observer)?;
    Ok(format!("{target_id}|{filter}|{binning}|{gain}|{night}"))
}

fn previous_day(d: Date) -> Date {
    d.previous_day().unwrap_or(d)
}

fn format_date_iso(d: Date) -> String {
    let month = month_number(d.month());
    format!("{:04}-{:02}-{:02}", d.year(), month, d.day())
}

const fn month_number(m: Month) -> u8 {
    match m {
        Month::January => 1,
        Month::February => 2,
        Month::March => 3,
        Month::April => 4,
        Month::May => 5,
        Month::June => 6,
        Month::July => 7,
        Month::August => 8,
        Month::September => 9,
        Month::October => 10,
        Month::November => 11,
        Month::December => 12,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::{Date, Month, PrimitiveDateTime, Time};

    fn observer(hours: i8) -> ObserverContext {
        ObserverContext { utc_offset: UtcOffset::from_hms(hours, 0, 0).unwrap() }
    }

    fn utc(y: i32, m: Month, d: u8, hour: u8, minute: u8) -> OffsetDateTime {
        let date = Date::from_calendar_date(y, m, d).unwrap();
        let time = Time::from_hms(hour, minute, 0).unwrap();
        PrimitiveDateTime::new(date, time).assume_utc()
    }

    #[test]
    fn local_evening_belongs_to_today() {
        // 22:00 local on 2026-03-15 (CET +01:00) → still 2026-03-15 night.
        let night =
            observing_night(utc(2026, Month::March, 15, 21, 0), Some(&observer(1))).unwrap();
        assert_eq!(night, "2026-03-15");
    }

    #[test]
    fn local_pre_noon_belongs_to_previous_night() {
        // 02:00 local on 2026-03-16 (CET +01:00) → still 2026-03-15 night.
        let night = observing_night(utc(2026, Month::March, 16, 1, 0), Some(&observer(1))).unwrap();
        assert_eq!(night, "2026-03-15");
    }

    #[test]
    fn exactly_noon_local_is_today() {
        // 12:00 local on 2026-03-16 — boundary; >=12 is today.
        let night =
            observing_night(utc(2026, Month::March, 16, 11, 0), Some(&observer(1))).unwrap();
        assert_eq!(night, "2026-03-16");
    }

    #[test]
    fn negative_offset_handled_for_pacific_observer() {
        // 03:00 UTC = 20:00 local previous day (UTC-7) → 2026-03-14 night.
        let night =
            observing_night(utc(2026, Month::March, 15, 3, 0), Some(&observer(-7))).unwrap();
        assert_eq!(night, "2026-03-14");
    }

    #[test]
    fn missing_observer_refuses() {
        assert!(matches!(
            observing_night(utc(2026, Month::March, 15, 21, 0), None),
            Err(KeyError::ObserverLocationMissing)
        ));
    }

    #[test]
    fn session_key_stable_string() {
        let key = session_key(
            "M31",
            "Lum",
            "1x1",
            "100",
            utc(2026, Month::March, 15, 21, 0),
            Some(&observer(1)),
        )
        .unwrap();
        assert_eq!(key, "M31|Lum|1x1|100|2026-03-15");
    }

    #[test]
    fn session_key_refuses_without_observer() {
        assert!(session_key("M31", "Lum", "1x1", "100", utc(2026, Month::March, 15, 21, 0), None,)
            .is_err());
    }
}
