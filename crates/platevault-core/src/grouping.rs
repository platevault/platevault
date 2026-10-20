// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Pure capture grouping: one session candidate per canonical [`CaptureKey`]
//! and, for lights, per framing (D-W107).
//!
//! The key is derived only from the effective capture evidence the caller
//! passes in ([`Asset::effective`]: observed header values overlaid with
//! catalog corrections). OBJECT, Target associations, measured sensor
//! temperature, mechanical rotator angle and pointing remain per-frame evidence
//! and never enter the key. Unknown values are encoded explicitly and listed as
//! provisional evidence; nothing falls back to the clock, app settings or zero.
//! Pointing and rotation split a key's lights into framings within the
//! framing margins in force at intake; the framing joins the session's
//! identity beside the key. A session the catalog already holds keeps its
//! frames and its own limits whatever the margins now ([`Intake`]).

mod framing;

pub(crate) use framing::framing_offset;

use std::collections::{BTreeMap, BTreeSet, HashMap};

use time::{Date, Duration, Month, PrimitiveDateTime, Time, UtcOffset};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

use crate::{
    Asset, CaptureKey, CaptureMetadata, FramingMargins, GroupingResult, ImageTypeEvidence,
    NativePath, SessionCandidate, StandingSession,
};

/// Version prefix of the canonical key encoding.
const KEY_VERSION: &str = "capture-v1";

/// Night is the header `DATE-LOC` calendar date under a local-noon boundary.
pub const BASIS_DATE_LOC: &str = "date-loc-noon";
/// Night is `DATE-OBS` shifted by the header site longitude (east positive)
/// under a mean-solar-noon boundary.
pub const BASIS_LONGITUDE: &str = "longitude-mean-solar-noon";
/// Provisional: the UTC calendar date of `DATE-OBS`; no local-night evidence.
pub const BASIS_UTC: &str = "utc-date-provisional";

/// Group assets into metadata-homogeneous session candidates around the
/// catalog's `standing` sessions: each keeps its members, and a frame joins
/// it within its own recorded split limits (D-W107). The other frames split
/// by framing within `margins`, the limits of the intake bringing them in. A
/// standing session whose members no longer share its capture key stands no
/// longer: its frames are grouped afresh. With no standing sessions, every
/// key's lights split within `margins`.
///
/// Pure and deterministic: the result depends only on each asset's ID, file
/// name and effective metadata, never on input order, storage or the current
/// time. Sessions are ordered by key, then framing, and their asset IDs
/// ascending.
#[must_use]
pub fn regroup_assets(
    assets: &[Asset],
    standing: &[StandingSession],
    margins: &FramingMargins,
) -> GroupingResult {
    let names: Vec<String> = assets.iter().map(|asset| file_name(&asset.relative_path)).collect();
    let frames: Vec<Frame<'_>> = assets
        .iter()
        .zip(&names)
        .map(|(asset, name)| Frame { id: asset.id, name, metadata: &asset.effective })
        .collect();
    group_frames(&frames, standing, margins)
}

/// Intake's grouping inside a catalog regroup, within these margins: the
/// catalog's standing sessions keep their frames ([`regroup_assets`]).
#[derive(Clone, Copy)]
pub struct Intake<'a>(pub &'a FramingMargins);

impl persistence_library::Grouping for Intake<'_> {
    fn group(&mut self, assets: &[Asset], standing: &[StandingSession]) -> GroupingResult {
        regroup_assets(assets, standing, self.0)
    }
}

/// One frame as grouping reads it: a catalogued asset, or an import item the
/// import review groups before anything is written.
#[derive(Clone, Copy)]
pub(crate) struct Frame<'a> {
    pub(crate) id: Uuid,
    /// The file name; it orders frames captured at the same instant.
    pub(crate) name: &'a str,
    pub(crate) metadata: &'a CaptureMetadata,
}

/// The file name of a path, for capture order.
pub(crate) fn file_name(path: &NativePath) -> String {
    path.relative_path()
        .ok()
        .and_then(|path| path.file_name().map(|name| name.to_string_lossy().into_owned()))
        .unwrap_or_default()
}

/// [`regroup_assets`] over frames.
pub(crate) fn group_frames<'a>(
    frames: &[Frame<'a>],
    standing: &'a [StandingSession],
    margins: &FramingMargins,
) -> GroupingResult {
    let mut buckets: BTreeMap<CaptureKey, Bucket> = BTreeMap::new();
    for (index, frame) in frames.iter().enumerate() {
        let capture = derive(frame.metadata);
        let bucket = buckets.entry(capture.key).or_insert_with(|| Bucket {
            date_basis: capture.date_basis,
            lights: capture.light,
            members: Vec::new(),
            notes: Vec::new(),
        });
        bucket.members.push(index);
        bucket.notes.push(capture.provisional);
    }
    let mut sessions = Vec::new();
    for (key, bucket) in buckets {
        let local: Vec<Frame<'a>> = bucket.members.iter().map(|&index| frames[index]).collect();
        let splits = if bucket.lights {
            framing::split(&local, &standing_in(&key, &local, standing), margins)
        } else {
            vec![framing::Split {
                members: (0..local.len()).collect(),
                framing: None,
                notes: BTreeSet::new(),
            }]
        };
        let mut candidates: Vec<SessionCandidate> = splits
            .into_iter()
            .map(|split| {
                let mut provisional = split.notes;
                let mut asset_ids = BTreeSet::new();
                for member in split.members {
                    asset_ids.insert(local[member].id);
                    provisional.extend(bucket.notes[member].iter().cloned());
                }
                SessionCandidate {
                    key: key.clone(),
                    asset_ids: asset_ids.into_iter().collect(),
                    provisional: provisional.into_iter().collect(),
                    date_basis: bucket.date_basis.map(str::to_owned),
                    framing: split.framing,
                }
            })
            .collect();
        candidates.sort_by_key(|candidate| {
            (
                candidate.framing.as_ref().map_or(u32::MAX, |framing| framing.ordinal),
                candidate.asset_ids.first().copied(),
            )
        });
        sessions.extend(candidates);
    }
    GroupingResult { sessions }
}

/// The standing sessions of `key` among its frames `local`, as members of
/// `local`. A session with a member outside them no longer shares one key:
/// it stands no longer, and its members are split afresh.
fn standing_in<'a>(
    key: &CaptureKey,
    local: &[Frame<'_>],
    standing: &'a [StandingSession],
) -> Vec<framing::Standing<'a>> {
    let position: HashMap<Uuid, usize> =
        local.iter().enumerate().map(|(index, frame)| (frame.id, index)).collect();
    standing
        .iter()
        .filter(|session| &session.key == key)
        .filter_map(|session| {
            let members = session
                .asset_ids
                .iter()
                .map(|id| position.get(id).copied())
                .collect::<Option<Vec<usize>>>()?;
            Some(framing::Standing { members, framing: session.framing.as_ref() })
        })
        .collect()
}

/// The frames of one key, with each frame's provisional notes.
struct Bucket {
    date_basis: Option<&'static str>,
    /// The key's frame type is light: only lights split by framing.
    lights: bool,
    members: Vec<usize>,
    notes: Vec<Vec<String>>,
}

struct Capture {
    key: CaptureKey,
    date_basis: Option<&'static str>,
    light: bool,
    provisional: Vec<String>,
}

fn derive(meta: &CaptureMetadata) -> Capture {
    let mut key =
        KeyWriter { key: KEY_VERSION.to_owned(), provisional: Vec::new(), raw: &meta.raw };

    match meta.image_type_evidence() {
        ImageTypeEvidence::Known(frame) => key.known("type", frame.as_str()),
        ImageTypeEvidence::Unclassified(text) => {
            key.known("type", &format!("unclassified:{text}"));
            key.note(format!("type: IMAGETYP {text:?} is not a recognised frame type"));
        }
        ImageTypeEvidence::Blank => key.unknown("type", "IMAGETYP is blank"),
        ImageTypeEvidence::Absent => key.unknown_from_header("type", Some("IMAGETYP")),
    }

    let night = night(meta);
    key.provisional.extend(night.notes);
    match night.value {
        Some((date, basis)) => key.known("night", &format!("{date}@{basis}")),
        None => key.unknown("night", "no usable DATE-LOC or DATE-OBS"),
    }

    key.text("camera", meta.camera.as_deref(), Some("INSTRUME"));
    key.text("camera_id", meta.camera_id.as_deref(), Some("CAMERAID"));
    key.text("telescope", meta.telescope.as_deref(), Some("TELESCOP"));
    key.decimal("focal_length_mm", meta.focal_length_mm, None);
    key.text("filter", meta.filter.as_deref(), Some("FILTER"));
    key.decimal("exposure_s", meta.exposure_seconds.filter(|v| *v >= 0.0), Some("EXPTIME"));
    key.decimal("gain", meta.gain, Some("GAIN"));
    match meta.offset {
        Some(offset) => key.known("offset", &offset.to_string()),
        None => key.unknown_from_header("offset", None),
    }
    key.integer("binning_x", meta.binning_x, Some("XBINNING"));
    key.integer("binning_y", meta.binning_y, Some("YBINNING"));
    key.integer("width", meta.width, Some("NAXIS1"));
    key.integer("height", meta.height, Some("NAXIS2"));
    key.text("readout", meta.readout_mode.as_deref(), Some("READOUTM"));
    key.decimal("set_temp_c", meta.set_temperature_c, None);

    Capture {
        key: CaptureKey(key.key),
        date_basis: night.value.map(|(_, basis)| basis),
        light: meta.is_light() == Some(true),
        provisional: key.provisional,
    }
}

/// Builds the injective `capture-v1|name=value|name?` encoding.
///
/// Known values are escaped so `|` and `%` inside text can never forge a field
/// boundary; an unknown field is `name?` and records why it is unknown.
struct KeyWriter<'a> {
    key: String,
    provisional: Vec<String>,
    raw: &'a BTreeMap<String, String>,
}

impl KeyWriter<'_> {
    fn known(&mut self, name: &str, value: &str) {
        self.key.push('|');
        self.key.push_str(name);
        self.key.push('=');
        for character in value.chars() {
            match character {
                '%' => self.key.push_str("%25"),
                '|' => self.key.push_str("%7C"),
                other => self.key.push(other),
            }
        }
    }

    fn unknown(&mut self, name: &str, reason: &str) {
        self.key.push('|');
        self.key.push_str(name);
        self.key.push('?');
        self.note(format!("{name}: unknown; {reason}"));
    }

    fn unknown_from_header(&mut self, name: &str, header: Option<&str>) {
        let reason = match header {
            Some(header) => match self.raw.get(header) {
                Some(value) => format!("header {header}={value:?} is not usable"),
                None => format!("header {header} is absent"),
            },
            None => "not recorded".to_owned(),
        };
        self.unknown(name, &reason);
    }

    fn note(&mut self, note: String) {
        self.provisional.push(note);
    }

    fn text(&mut self, name: &str, value: Option<&str>, header: Option<&str>) {
        match value.map(canonical_text) {
            Some(Some(text)) => self.known(name, &text),
            Some(None) => self.unknown(name, "value is blank"),
            None => self.unknown_from_header(name, header),
        }
    }

    fn decimal(&mut self, name: &str, value: Option<f64>, header: Option<&str>) {
        match value.and_then(canonical_decimal) {
            Some(text) => self.known(name, &text),
            None => self.unknown_from_header(name, header),
        }
    }

    fn integer(&mut self, name: &str, value: Option<u32>, header: Option<&str>) {
        match value {
            Some(value) => self.known(name, &value.to_string()),
            None => self.unknown_from_header(name, header),
        }
    }
}

/// Trimmed NFC text; blank text is not evidence.
fn canonical_text(value: &str) -> Option<String> {
    let text: String = value.trim().nfc().collect();
    (!text.is_empty()).then_some(text)
}

/// Shortest round-trip decimal of a finite value, with negative zero folded
/// into zero so `-0`, `0` and `0.0` share one encoding.
fn canonical_decimal(value: f64) -> Option<String> {
    // Adding positive zero maps -0.0 to +0.0 and leaves every other value as is.
    value.is_finite().then(|| (value + 0.0).to_string())
}

struct Night {
    value: Option<(Date, &'static str)>,
    notes: Vec<String>,
}

/// The observing night sessions are keyed by, for naming templates' `{date}`.
pub(crate) fn observing_night(meta: &CaptureMetadata) -> Option<Date> {
    night(meta).value.map(|(date, _)| date)
}

/// When a frame was captured, for capture order: `DATE-OBS` in UTC, else
/// `DATE-LOC`; `None` without a time of day.
fn capture_instant(meta: &CaptureMetadata) -> Option<PrimitiveDateTime> {
    let parse = |raw: Option<&str>| match parse_header_time(raw?)? {
        HeaderTime::DateTime(time, offset) => to_utc(time, offset),
        HeaderTime::Date(_) => None,
    };
    parse(meta.date_obs.as_deref()).or_else(|| parse(meta.date_local.as_deref()))
}

/// Header-derived observing night; never consults the clock.
///
/// Precedence: `DATE-LOC` with a time of day (local noon boundary), then
/// `DATE-OBS` plus site longitude (mean solar noon), then the provisional UTC
/// date of `DATE-OBS`. Skipped evidence is named in the notes.
fn night(meta: &CaptureMetadata) -> Night {
    let mut notes = Vec::new();
    if let Some(raw) = meta.date_local.as_deref() {
        match parse_header_time(raw) {
            Some(HeaderTime::DateTime(local, _)) => {
                if let Some(date) = noon_night(local) {
                    return Night { value: Some((date, BASIS_DATE_LOC)), notes };
                }
                notes.push(format!("night: DATE-LOC={raw:?} is outside the supported date range"));
            }
            Some(HeaderTime::Date(_)) => {
                notes.push(format!(
                    "night: DATE-LOC={raw:?} has no time of day for the noon boundary"
                ));
            }
            None => notes.push(format!("night: DATE-LOC={raw:?} is not a valid date-time")),
        }
    }

    let observed = meta.date_obs.as_deref().map(|raw| (raw, parse_header_time(raw)));
    let utc = match observed {
        Some((_, Some(HeaderTime::DateTime(time, offset)))) => to_utc(time, offset),
        _ => None,
    };
    if let Some(utc) = utc {
        match meta.site_longitude_deg.map(east_longitude) {
            Some(Some(longitude)) => {
                let shift = Duration::seconds_f64(longitude * 240.0);
                if let Some(date) = utc.checked_add(shift).and_then(noon_night) {
                    return Night { value: Some((date, BASIS_LONGITUDE)), notes };
                }
            }
            Some(None) => notes.push("night: site longitude is outside -180..360 degrees".into()),
            None => {}
        }
    }

    match observed {
        Some((_, Some(HeaderTime::Date(date)))) => provisional_utc(date, notes),
        Some((_, Some(HeaderTime::DateTime(..)))) => {
            if let Some(utc) = utc {
                provisional_utc(utc.date(), notes)
            } else {
                notes.push("night: DATE-OBS is outside the supported date range".into());
                Night { value: None, notes }
            }
        }
        Some((raw, None)) => {
            notes.push(format!("night: DATE-OBS={raw:?} is not a valid date-time"));
            Night { value: None, notes }
        }
        None => Night { value: None, notes },
    }
}

fn provisional_utc(date: Date, mut notes: Vec<String>) -> Night {
    notes.push("night: provisional UTC date; no DATE-LOC time or site longitude".into());
    Night { value: Some((date, BASIS_UTC)), notes }
}

/// The calendar date whose noon starts the night containing `time`.
fn noon_night(time: PrimitiveDateTime) -> Option<Date> {
    time.checked_sub(Duration::hours(12)).map(PrimitiveDateTime::date)
}

/// Longitude in `-180..=180`, accepting the `0..360` east-positive form.
fn east_longitude(degrees: f64) -> Option<f64> {
    if !(-180.0..=360.0).contains(&degrees) {
        return None;
    }
    Some(if degrees > 180.0 { degrees - 360.0 } else { degrees })
}

fn to_utc(time: PrimitiveDateTime, offset: Option<UtcOffset>) -> Option<PrimitiveDateTime> {
    let Some(offset) = offset else {
        return Some(time);
    };
    let shift = Duration::seconds(i64::from(offset.whole_seconds()));
    time.checked_sub(shift)
}

enum HeaderTime {
    Date(Date),
    DateTime(PrimitiveDateTime, Option<UtcOffset>),
}

/// Parse FITS/ISO `YYYY-MM-DD[(T| )HH:MM[:SS[.fff…]]][Z|±HH[:]MM]`.
///
/// FITS single quotes are tolerated. Fractions beyond nanoseconds are
/// truncated; anything else malformed (including leap second 60) is `None`.
fn parse_header_time(raw: &str) -> Option<HeaderTime> {
    let text = raw.trim().trim_matches('\'').trim();
    let bytes = text.as_bytes();
    if bytes.len() < 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let year = i32::try_from(digits(&bytes[0..4])?).ok()?;
    let month = Month::try_from(u8::try_from(digits(&bytes[5..7])?).ok()?).ok()?;
    let day = u8::try_from(digits(&bytes[8..10])?).ok()?;
    let date = Date::from_calendar_date(year, month, day).ok()?;
    if bytes.len() == 10 {
        return Some(HeaderTime::Date(date));
    }
    if !matches!(bytes[10], b'T' | b' ') {
        return None;
    }

    let mut rest = &bytes[11..];
    let hour = take_two(&mut rest)?;
    expect(&mut rest, b':')?;
    let minute = take_two(&mut rest)?;
    let mut second = 0;
    let mut nanos = 0_u32;
    if rest.first() == Some(&b':') {
        rest = &rest[1..];
        second = take_two(&mut rest)?;
        if rest.first() == Some(&b'.') {
            rest = &rest[1..];
            let length = rest.iter().take_while(|byte| byte.is_ascii_digit()).count();
            if length == 0 {
                return None;
            }
            let mut scale = 100_000_000_u32;
            for byte in &rest[..length.min(9)] {
                nanos += u32::from(byte - b'0') * scale;
                scale /= 10;
            }
            rest = &rest[length..];
        }
    }
    let time = Time::from_hms_nano(hour, minute, second, nanos).ok()?;

    let offset = match rest {
        [] => None,
        [b'Z' | b'z'] => Some(UtcOffset::UTC),
        [sign @ (b'+' | b'-'), zone @ ..] => {
            let mut zone = zone;
            let hours = i8::try_from(take_two(&mut zone)?).ok()?;
            if zone.first() == Some(&b':') {
                zone = &zone[1..];
            }
            let minutes = i8::try_from(take_two(&mut zone)?).ok()?;
            if !zone.is_empty() {
                return None;
            }
            let sign = if *sign == b'-' { -1 } else { 1 };
            Some(UtcOffset::from_hms(sign * hours, sign * minutes, 0).ok()?)
        }
        _ => return None,
    };
    Some(HeaderTime::DateTime(PrimitiveDateTime::new(date, time), offset))
}

fn digits(bytes: &[u8]) -> Option<u32> {
    bytes.iter().try_fold(0_u32, |value, byte| {
        byte.is_ascii_digit().then(|| value * 10 + u32::from(byte - b'0'))
    })
}

fn take_two(rest: &mut &[u8]) -> Option<u8> {
    let (head, tail) = rest.split_at_checked(2)?;
    *rest = tail;
    u8::try_from(digits(head)?).ok()
}

fn expect(rest: &mut &[u8], byte: u8) -> Option<()> {
    let (first, tail) = rest.split_first()?;
    if *first != byte {
        return None;
    }
    *rest = tail;
    Some(())
}
