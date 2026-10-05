// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calendar snapshots (spec 072, PLAN-FR-04/05, PLAN-AC-03): RFC 5545 text with
//! UTC instants, a digest over the confirmed snapshot, and an atomic write of
//! the one user-chosen `.ics` file that never damages an existing file.

use std::path::Path;

use platevault_core::calendar::{render_ics, snapshot_digest, write_snapshot};
use platevault_core::{
    CalendarSnapshot, Darkness, LibraryError, MoonCriterion, ObservingWindow, PlanCriteria,
    SiteBasis, WindowKey,
};
use sha2::{Digest, Sha256};
use time::macros::{date, datetime};
use time::{Duration, OffsetDateTime, UtcOffset};
use uuid::Uuid;

fn window(target: Uuid, site: Uuid, start: OffsetDateTime, minutes: i64) -> ObservingWindow {
    let end = start + Duration::minutes(minutes);
    let offset = |at: OffsetDateTime| {
        if at < datetime!(2026-10-25 01:00 UTC) {
            UtcOffset::from_hms(2, 0, 0).unwrap()
        } else {
            UtcOffset::from_hms(1, 0, 0).unwrap()
        }
    };
    ObservingWindow {
        key: WindowKey::new(target, site, start).unwrap(),
        start_utc: start,
        end_utc: end,
        start_local: start.to_offset(offset(start)),
        end_local: end.to_offset(offset(end)),
        time_zone: "Europe/Amsterdam".into(),
        duration_minutes: u32::try_from(minutes).unwrap(),
        night: date!(2026 - 10 - 24),
        site_name: "Backyard".into(),
    }
}

fn snapshot() -> CalendarSnapshot {
    let (target, site) = (Uuid::new_v4(), Uuid::new_v4());
    CalendarSnapshot {
        target_id: target,
        target_revision: 2,
        designation: "NGC 7000".into(),
        site: SiteBasis {
            id: site,
            name: "Backyard".into(),
            revision: 1,
            latitude_deg: 52.09,
            longitude_deg: 5.12,
            elevation_m: Some(5.0),
        },
        time_zone: "Europe/Amsterdam".into(),
        first_night: date!(2026 - 10 - 20),
        last_night: date!(2026 - 11 - 18),
        criteria: PlanCriteria {
            min_altitude_deg: 30.0,
            darkness: Darkness::Astronomical,
            moon: MoonCriterion::MinSeparation { min_separation_deg: 30.0 },
            min_duration_minutes: 60,
        },
        windows: vec![
            window(target, site, datetime!(2026-10-23 18:22 UTC), 395),
            window(target, site, datetime!(2026-10-24 18:20 UTC), 393),
            window(target, site, datetime!(2026-10-25 18:18 UTC), 391),
        ],
    }
}

const STAMP: OffsetDateTime = datetime!(2026-10-20 09:30:15 UTC);

/// Unfolded content lines: a CRLF followed by one space continues a line.
fn unfold(text: &str) -> Vec<String> {
    text.replace("\r\n ", "")
        .split("\r\n")
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect()
}

fn values<'a>(lines: &'a [String], name: &str) -> Vec<&'a str> {
    let prefix = format!("{name}:");
    lines.iter().filter_map(|line| line.strip_prefix(&prefix)).collect()
}

/// The UID a window key renders as.
fn uid_of(key: WindowKey) -> String {
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

#[test]
fn three_windows_render_three_utc_events_with_site_zone_and_criteria() {
    let snapshot = snapshot();
    let text = render_ics(&snapshot, STAMP);
    let lines = unfold(&text);
    assert_eq!(lines.first().map(String::as_str), Some("BEGIN:VCALENDAR"));
    assert_eq!(lines.last().map(String::as_str), Some("END:VCALENDAR"));
    assert_eq!(values(&lines, "VERSION"), ["2.0"]);
    assert_eq!(values(&lines, "X-WR-TIMEZONE"), ["Europe/Amsterdam"]);
    assert_eq!(values(&lines, "BEGIN").iter().filter(|value| **value == "VEVENT").count(), 3);
    assert_eq!(values(&lines, "END").iter().filter(|value| **value == "VEVENT").count(), 3);
    assert!(!text.contains("TZID") && !text.contains("VTIMEZONE"));
    assert_eq!(
        values(&lines, "DTSTART"),
        ["20261023T182200Z", "20261024T182000Z", "20261025T181800Z"]
    );
    assert_eq!(
        values(&lines, "DTEND"),
        ["20261024T005700Z", "20261025T005300Z", "20261026T004900Z"]
    );
    assert_eq!(values(&lines, "DTSTAMP"), ["20261020T093015Z"; 3]);
    let uids: Vec<String> = snapshot.windows.iter().map(|window| uid_of(window.key)).collect();
    assert_eq!(values(&lines, "UID"), uids);
    assert_eq!(values(&lines, "LOCATION"), ["Backyard"; 3]);
    assert_eq!(values(&lines, "GEO"), ["52.090000;5.120000"; 3]);
    assert_descriptions(&values(&lines, "DESCRIPTION"));
    assert_eq!(render_ics(&snapshot, STAMP), text, "rendering is deterministic for a stamp");
}

/// Each description names the zone, the local times with their offsets and
/// the criteria.
fn assert_descriptions(descriptions: &[&str]) {
    assert_eq!(descriptions.len(), 3);
    let expected = [
        ("Europe/Amsterdam", 0),
        ("2026-10-23T20:22:00+02:00", 0),
        ("2026-10-24T02:57:00+02:00", 0),
        ("2026-10-25T19:18:00+01:00", 2),
        ("altitude at least 30 degrees", 0),
        ("astronomical darkness", 0),
        ("Moon at least 30 degrees away", 0),
        ("at least 60 minutes", 0),
    ];
    for (text, index) in expected {
        assert!(descriptions[index].contains(text), "{text}: {}", descriptions[index]);
    }
}

#[test]
fn lines_end_in_crlf_fold_at_75_octets_and_escape_text() {
    let mut snapshot = snapshot();
    snapshot.site.name = "Back, yard; \\ north\nside — Västra".into();
    for window in &mut snapshot.windows {
        window.site_name = snapshot.site.name.clone();
    }
    let text = render_ics(&snapshot, STAMP);
    assert!(text.ends_with("\r\n"));
    assert!(!text.replace("\r\n", "").contains('\n'), "a bare LF");
    assert!(!text.replace("\r\n", "").contains('\r'), "a bare CR");
    let physical: Vec<&str> = text.split("\r\n").collect();
    assert!(physical.iter().any(|line| line.starts_with(' ')), "long descriptions fold");
    for line in &physical {
        assert!(line.len() <= 75, "{} octets: {line:?}", line.len());
    }
    let lines = unfold(&text);
    let escaped = "Back\\, yard\\; \\\\ north\\nside — Västra";
    assert_eq!(values(&lines, "LOCATION"), [escaped; 3]);
    // Folding never splits a multi-byte character.
    assert!(String::from_utf8(text.clone().into_bytes()).is_ok());
}

#[test]
fn the_digest_follows_site_revision_criteria_and_selection() {
    let snapshot = snapshot();
    let digest = snapshot_digest(&snapshot).unwrap();
    assert_eq!(digest.len(), 64);
    assert_eq!(snapshot_digest(&snapshot).unwrap(), digest);
    let moved = CalendarSnapshot {
        site: SiteBasis { revision: 2, ..snapshot.site.clone() },
        ..snapshot.clone()
    };
    let stricter = CalendarSnapshot {
        criteria: PlanCriteria { min_duration_minutes: 120, ..snapshot.criteria },
        ..snapshot.clone()
    };
    let fewer = CalendarSnapshot { windows: snapshot.windows[..2].to_vec(), ..snapshot.clone() };
    for changed in [moved, stricter, fewer] {
        assert_ne!(snapshot_digest(&changed).unwrap(), digest);
    }
}

fn sha(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn entries(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[test]
fn write_snapshot_saves_synced_bytes_and_refuses_paths_without_ics() {
    let dir = tempfile::tempdir().unwrap();
    let bytes = render_ics(&snapshot(), STAMP).into_bytes();
    let path = dir.path().join("NGC 7000 Backyard.ics");
    let saved = write_snapshot(&path, &bytes).unwrap();
    let on_disk = std::fs::read(&path).unwrap();
    assert_eq!(on_disk, bytes);
    assert_eq!(saved.sha256, sha(&on_disk));
    assert_eq!(saved.byte_count, u64::try_from(on_disk.len()).unwrap());
    assert_eq!(entries(dir.path()), ["NGC 7000 Backyard.ics"]);

    let replacement = b"BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";
    let replaced = write_snapshot(&path, replacement).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), replacement);
    assert_eq!(replaced.sha256, sha(replacement));

    for refused in ["plan.txt", "plan", "plan.ics.txt"] {
        let target = dir.path().join(refused);
        match write_snapshot(&target, &bytes) {
            Err(LibraryError::InvalidInput(message)) => {
                assert!(message.contains(".ics"), "{message}");
            }
            other => panic!("{refused}: {other:?}"),
        }
        assert!(!target.exists());
    }
    assert_eq!(entries(dir.path()), ["NGC 7000 Backyard.ics"]);
}

#[test]
fn a_failed_rename_leaves_the_target_and_no_temporary_file() {
    let dir = tempfile::tempdir().unwrap();
    // A directory at the chosen path refuses the rename onto it.
    let occupied = dir.path().join("occupied.ics");
    std::fs::create_dir(&occupied).unwrap();
    std::fs::write(occupied.join("keep.txt"), b"kept").unwrap();
    let error = write_snapshot(&occupied, b"BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n").unwrap_err();
    assert!(!matches!(error, LibraryError::InvalidInput(_)), "{error:?}");
    assert_eq!(std::fs::read(occupied.join("keep.txt")).unwrap(), b"kept");
    assert_eq!(entries(dir.path()), ["occupied.ics"]);
}

#[cfg(unix)]
#[test]
fn a_failed_write_leaves_an_existing_file_byte_identical() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("existing.ics");
    std::fs::write(&path, b"original calendar").unwrap();
    let before = sha(&std::fs::read(&path).unwrap());
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o555)).unwrap();
    let result = write_snapshot(&path, b"replacement");
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
    let error = result.unwrap_err();
    assert_eq!(error.response(None, None).kind, "access_denied", "{error:?}");
    assert_eq!(sha(&std::fs::read(&path).unwrap()), before);
    assert_eq!(entries(dir.path()), ["existing.ics"]);
}

#[test]
fn the_rendered_text_claims_only_astronomy() {
    let text = render_ics(&snapshot(), STAMP).to_lowercase();
    for claim in ["weather", "equipment", "readiness", "provider", "account", "forecast"] {
        assert!(!text.contains(claim), "{claim}");
    }
}
