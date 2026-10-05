// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calendar export (spec 072): RFC 5545 rendering of a confirmed window
//! snapshot with UTC instants, and the atomic write of the one user-chosen
//! `.ics` file. The application keeps no copy and never rewrites the file.
//!
//! Each window is one `VEVENT` with UTC `DTSTART` and `DTEND`, so no
//! `VTIMEZONE` is needed and every client shows the exact instants (research
//! R21). Lines end in CRLF and fold at 75 octets without splitting a character.

use std::io::Write as _;
use std::path::Path;

use sha2::{Digest, Sha256};
use time::{OffsetDateTime, UtcOffset};
use uuid::Uuid;

use crate::{CalendarSnapshot, Darkness, LibraryError, MoonCriterion, ObservingWindow};

const LINE_OCTETS: usize = 75;

/// The bytes a snapshot write left on disk.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SavedCalendar {
    pub sha256: String,
    pub byte_count: u64,
}

/// SHA-256 over the canonical JSON of the snapshot: the Target and its
/// revision, the site and its revision, the zone, the night range, the criteria
/// and the selected windows. Export compares it with the reviewed digest.
///
/// # Errors
/// `InvalidInput` when an instant cannot be written as RFC 3339.
pub fn snapshot_digest(snapshot: &CalendarSnapshot) -> Result<String, LibraryError> {
    let canonical = serde_json::to_vec(snapshot)?;
    Ok(hex::encode(Sha256::digest(canonical)))
}

/// Render the snapshot as an RFC 5545 calendar, deterministically for `stamp`.
#[must_use]
pub fn render_ics(snapshot: &CalendarSnapshot, stamp: OffsetDateTime) -> String {
    let mut out = String::new();
    let mut line = |text: String| fold_into(&mut out, &text);
    line("BEGIN:VCALENDAR".into());
    line("VERSION:2.0".into());
    line("PRODID:-//PlateVault//Observing plans 1//EN".into());
    line("CALSCALE:GREGORIAN".into());
    line("METHOD:PUBLISH".into());
    line(format!(
        "X-WR-CALNAME:{}",
        escape(&format!("{} from {}", snapshot.designation, snapshot.site.name))
    ));
    line(format!("X-WR-TIMEZONE:{}", escape(&snapshot.time_zone)));
    for window in &snapshot.windows {
        line("BEGIN:VEVENT".into());
        line(format!("UID:{}", uid(window)));
        line(format!("DTSTAMP:{}", utc_stamp(stamp)));
        line(format!("DTSTART:{}", utc_stamp(window.start_utc)));
        line(format!("DTEND:{}", utc_stamp(window.end_utc)));
        line(format!("SUMMARY:{}", escape(&format!("{} observing window", snapshot.designation))));
        line(format!("LOCATION:{}", escape(&snapshot.site.name)));
        line(format!("GEO:{:.6};{:.6}", snapshot.site.latitude_deg, snapshot.site.longitude_deg));
        line(format!("DESCRIPTION:{}", escape(&description(snapshot, window))));
        line("TRANSP:TRANSPARENT".into());
        line("END:VEVENT".into());
    }
    line("END:VCALENDAR".into());
    out
}

/// Write the snapshot bytes to the user-chosen `.ics` path: a new temporary
/// file in the same folder, synced, renamed onto the path, then the folder
/// synced. A failure removes the temporary file and leaves any existing file
/// unchanged.
///
/// # Errors
/// `InvalidInput` for a path without the `.ics` extension or without a parent
/// folder; `AccessDenied`, `NotFound` or `SourceUnavailable` naming the path
/// when a filesystem step fails.
pub fn write_snapshot(path: &Path, bytes: &[u8]) -> Result<SavedCalendar, LibraryError> {
    let is_ics = path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("ics"));
    let (Some(folder), Some(name), true) = (path.parent(), path.file_name(), is_ics) else {
        return Err(LibraryError::InvalidInput(format!(
            "calendar path {} must name a file with the .ics extension",
            path.display()
        )));
    };
    let folder = if folder.as_os_str().is_empty() { Path::new(".") } else { folder };
    let temporary =
        folder.join(format!(".{}.{}.partial", name.to_string_lossy(), Uuid::new_v4().simple()));
    let written = (|| {
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, path)?;
        sync_folder(folder)
    })();
    if let Err(error) = written {
        // Removing a temporary file that was never created fails harmlessly.
        let _ = std::fs::remove_file(&temporary);
        return Err(LibraryError::from_io(path, &error));
    }
    Ok(SavedCalendar {
        sha256: hex::encode(Sha256::digest(bytes)),
        byte_count: u64::try_from(bytes.len()).unwrap_or(u64::MAX),
    })
}

#[cfg(unix)]
fn sync_folder(folder: &Path) -> std::io::Result<()> {
    std::fs::File::open(folder)?.sync_all()
}

#[cfg(not(unix))]
fn sync_folder(_folder: &Path) -> std::io::Result<()> {
    // Windows commits a rename with the file's metadata; a folder handle
    // cannot be synced there.
    Ok(())
}

fn uid(window: &ObservingWindow) -> String {
    let key = window.key;
    let start = key.start_utc();
    format!(
        "{}-{}-{:04}{:02}{:02}T{:02}{:02}Z@platevault",
        key.target_id(),
        key.site_id(),
        start.year(),
        u8::from(start.month()),
        start.day(),
        start.hour(),
        start.minute()
    )
}

fn utc_stamp(at: OffsetDateTime) -> String {
    let at = at.to_offset(UtcOffset::UTC);
    format!(
        "{:04}{:02}{:02}T{:02}{:02}{:02}Z",
        at.year(),
        u8::from(at.month()),
        at.day(),
        at.hour(),
        at.minute(),
        at.second()
    )
}

fn local_text(at: OffsetDateTime) -> String {
    let offset = at.offset();
    let (hours, minutes, _) = offset.as_hms();
    let sign = if offset.is_negative() { '-' } else { '+' };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}{sign}{:02}:{:02}",
        at.year(),
        u8::from(at.month()),
        at.day(),
        at.hour(),
        at.minute(),
        at.second(),
        hours.unsigned_abs(),
        minutes.unsigned_abs()
    )
}

fn description(snapshot: &CalendarSnapshot, window: &ObservingWindow) -> String {
    let criteria = &snapshot.criteria;
    let darkness = match criteria.darkness {
        Darkness::Civil => "civil darkness (Sun below -6 degrees)",
        Darkness::Nautical => "nautical darkness (Sun below -12 degrees)",
        Darkness::Astronomical => "astronomical darkness (Sun below -18 degrees)",
    };
    let moon = match criteria.moon {
        MoonCriterion::None => "no Moon limit".to_owned(),
        MoonCriterion::BelowHorizon => "Moon below the horizon".to_owned(),
        MoonCriterion::MinSeparation { min_separation_deg } => {
            format!("Moon at least {min_separation_deg} degrees away while up")
        }
    };
    format!(
        "{} from {} ({:.6}, {:.6}), time zone {}. Local {} to {} ({} minutes). \
         Criteria: altitude at least {} degrees, {darkness}, {moon}, at least {} minutes. \
         Astronomical suitability only, computed with skymath 0.7.2, geometric, no refraction.",
        snapshot.designation,
        snapshot.site.name,
        snapshot.site.latitude_deg,
        snapshot.site.longitude_deg,
        snapshot.time_zone,
        local_text(window.start_local),
        local_text(window.end_local),
        window.duration_minutes,
        criteria.min_altitude_deg,
        criteria.min_duration_minutes,
    )
}

/// RFC 5545 TEXT escaping: backslash, semicolon, comma and newline.
fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '\\' => out.push_str("\\\\"),
            ';' => out.push_str("\\;"),
            ',' => out.push_str("\\,"),
            '\n' => out.push_str("\\n"),
            '\r' => {}
            other => out.push(other),
        }
    }
    out
}

/// Append one content line, folded so no physical line exceeds 75 octets;
/// each continuation starts with one space.
fn fold_into(out: &mut String, line: &str) {
    let mut used = 0;
    for character in line.chars() {
        let width = character.len_utf8();
        if used + width > LINE_OCTETS {
            out.push_str("\r\n ");
            used = 1;
        }
        out.push(character);
        used += width;
    }
    out.push_str("\r\n");
}
