// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `Services::start` installs the process logging: stale rotated files are
//! pruned, and `tracing` events reach the daily file, which `shutdown`
//! flushes. A later start installs nothing. Its own test binary with one test,
//! because the subscriber and the once-per-process guard are process-global.

use std::fs::File;
use std::time::{Duration, SystemTime};

use desktop_services::{AppIdentity, Config, Services};

const DAY: Duration = Duration::from_hours(24);

#[test]
fn start_prunes_stale_logs_and_writes_the_daily_file() {
    let dir = tempfile::tempdir().expect("temp dir");
    let log_dir = dir.path().join("logs");
    std::fs::create_dir(&log_dir).expect("create log dir");
    for (name, age) in [("plate-vault.log.stale", 15 * DAY), ("plate-vault.log.recent", DAY)] {
        let file = File::create(log_dir.join(name)).expect("create log file");
        file.set_modified(SystemTime::now() - age).expect("backdate log file");
    }

    let services = Services::start(&Config {
        identity: AppIdentity { identifier: "dev.example.app".to_owned(), development: true },
        log_dir: log_dir.clone(),
    });
    tracing::error!("logging-init-marker");
    services.shutdown();

    assert!(!log_dir.join("plate-vault.log.stale").exists(), "stale log pruned");
    assert!(log_dir.join("plate-vault.log.recent").exists(), "recent log kept");

    let daily: Vec<_> = std::fs::read_dir(&log_dir)
        .expect("read log dir")
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with("plate-vault.log.20"))
        .collect();
    assert_eq!(daily.len(), 1, "one dated file for today: {daily:?}");
    let contents = std::fs::read_to_string(log_dir.join(&daily[0])).expect("read daily log");
    assert!(contents.contains("logging-init-marker"), "event written and flushed: {contents}");
    assert!(!contents.contains('\u{1b}'), "the file carries no ANSI colour codes");

    // A second start in the same process opens no log directory of its own.
    let second_dir = dir.path().join("second-logs");
    let second = Services::start(&Config {
        identity: AppIdentity { identifier: "dev.example.app".to_owned(), development: true },
        log_dir: second_dir.clone(),
    });
    second.shutdown();
    assert!(!second_dir.exists(), "a later start creates no log directory or writer");
}
