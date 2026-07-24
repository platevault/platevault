// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! T033a — `SessionKey` derivation + `observing_night` local-solar-noon
//! algorithm.
//!
//! See `specs/002-data-lifecycle-state-model/research.md` §2.5. Missing
//! `observer_location` is a refusable condition surfaced via [`KeyError::
//! ObserverLocationMissing`] — callers raise `provenance.unreviewed` against
//! the spec-018 settings field rather than guessing.

use thiserror::Error;
use time::{Date, OffsetDateTime, UtcOffset};

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

/// The canonical session identity string `target_id|filter|binning|gain|night`.
///
/// Wraps the stable pipe-delimited serialization so callers hold a typed value
/// rather than a plain `String`, eliminating the positional-swap hazard present
/// when constructing via four same-type `&str` arguments.
///
/// # Construction
/// Use [`SessionKey::new`] to derive from frame metadata.
/// Use [`SessionKey::parse`] to split a stored key back into its fields.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct SessionKey(pub String);

impl SessionKey {
    /// Derive the canonical session key for a frame.
    ///
    /// Frames whose `observing_night` differs MUST split into separate sessions
    /// (FR-012); that split decision lives in the candidate-formation pipeline,
    /// not here. This method is the pure key-canonicalisation step.
    ///
    /// # Errors
    /// Returns [`KeyError::ObserverLocationMissing`] when `observer` is `None`.
    pub fn new(
        target_id: &str,
        filter: &str,
        binning: &str,
        gain: &str,
        utc_capture_at: OffsetDateTime,
        observer: Option<&ObserverContext>,
    ) -> Result<Self, KeyError> {
        let night = observing_night(utc_capture_at, observer)?;
        Ok(Self(format!("{target_id}|{filter}|{binning}|{gain}|{night}")))
    }

    /// Split a stored session key back into its fields — the inverse of
    /// [`SessionKey::new`] and the single supported reader of that format.
    ///
    /// A key with fewer than five segments yields `None` for the missing tail;
    /// any extra `|` beyond the fourth stays inside `night`. Legacy JSON-object
    /// keys are deliberately NOT handled here: that pre-035 shape is an app-layer
    /// compatibility concern, not part of this format.
    #[must_use]
    pub fn parse(key: &str) -> SessionKeyParts {
        let mut parts =
            key.splitn(5, '|').map(|s| if s.is_empty() { None } else { Some(s.to_owned()) });
        SessionKeyParts {
            target: parts.next().flatten(),
            filter: parts.next().flatten(),
            binning: parts.next().flatten(),
            gain: parts.next().flatten(),
            night: parts.next().flatten(),
        }
    }

    /// The key as a string slice.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for SessionKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for SessionKey {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

/// The fields encoded in a [`SessionKey`] string.
///
/// Blank segments are `None` so callers can layer their own fallbacks (e.g.
/// `acquisition_fingerprint`) without re-checking for empty strings.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SessionKeyParts {
    pub target: Option<String>,
    pub filter: Option<String>,
    pub binning: Option<String>,
    pub gain: Option<String>,
    pub night: Option<String>,
}

fn previous_day(d: Date) -> Date {
    d.previous_day().unwrap_or(d)
}

fn format_date_iso(d: Date) -> String {
    let month = u8::from(d.month());
    format!("{:04}-{:02}-{:02}", d.year(), month, d.day())
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
    fn session_key_new_stable_string() {
        let key = SessionKey::new(
            "M31",
            "Lum",
            "1x1",
            "100",
            utc(2026, Month::March, 15, 21, 0),
            Some(&observer(1)),
        )
        .unwrap();
        assert_eq!(key.as_str(), "M31|Lum|1x1|100|2026-03-15");
    }

    #[test]
    fn session_key_parse_round_trips_and_blanks_are_none() {
        let parts = SessionKey::parse("M31|Lum|1x1|100|2026-03-15");
        assert_eq!(parts.target.as_deref(), Some("M31"));
        assert_eq!(parts.filter.as_deref(), Some("Lum"));
        assert_eq!(parts.night.as_deref(), Some("2026-03-15"));

        // An unfiltered frame writes an empty segment, not a missing one.
        let blank = SessionKey::parse("M31||1x1|100|2026-03-15");
        assert_eq!(blank.filter, None);

        // A short/foreign key yields None rather than panicking.
        assert_eq!(SessionKey::parse("KEY").filter, None);
    }

    #[test]
    fn session_key_new_refuses_without_observer() {
        assert!(SessionKey::new(
            "M31",
            "Lum",
            "1x1",
            "100",
            utc(2026, Month::March, 15, 21, 0),
            None,
        )
        .is_err());
    }
}
