// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Process logging (spec 051 US7, T041/T042): every `tracing` event goes to
//! standard output (FR-021) and to a daily-rotating file in the log directory
//! (FR-022), both filtered by `RUST_LOG` with `info` as the default.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime};

use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, Layer};

/// Log file name; the appender appends the UTC date (`plate-vault.log.YYYY-MM-DD`).
const LOG_FILE_PREFIX: &str = "plate-vault.log";
/// Rotated log files older than this are deleted at startup, so the directory
/// never grows unbounded (SC-006).
const RETENTION_DAYS: u64 = 14;

/// Set by the first [`init`]; process logging is installed once per process.
static STARTED: AtomicBool = AtomicBool::new(false);

/// Install the process-wide subscriber, writing the file through a background
/// thread that flushes until the returned guard drops.
///
/// Only the first call in a process does anything: a later one returns `None`
/// without pruning, opening a file or starting a writer thread, and the first
/// call's log directory stays in use.
///
/// `try_init` leaves a subscriber something else installed first (a test
/// harness, say) in place instead of panicking. It also installs the
/// `log`-facade bridge, so `log` records reach both outputs.
pub fn init(log_dir: &Path) -> Option<WorkerGuard> {
    if STARTED.swap(true, Ordering::AcqRel) {
        tracing::warn!(
            log_dir = %log_dir.display(),
            "process logging already started; keeping its log directory"
        );
        return None;
    }
    let _ = std::fs::create_dir_all(log_dir);

    // Prune before creating today's writer so a just-rotated file from a
    // prior run doesn't briefly exist alongside an already-stale one.
    prune_old_logs(log_dir, RETENTION_DAYS);

    let file_appender = tracing_appender::rolling::daily(log_dir, LOG_FILE_PREFIX);
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    let env_filter =
        || EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    let _ = tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().with_filter(env_filter()))
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_writer(non_blocking)
                .with_filter(env_filter()),
        )
        .try_init();

    tracing::info!(log_dir = %log_dir.display(), "diagnostics log file initialised");
    Some(guard)
}

/// Delete files in `log_dir` last modified more than `max_age_days` ago.
/// Best-effort: a failure to read the directory or remove a given file is
/// logged and otherwise ignored, never fatal to startup.
fn prune_old_logs(log_dir: &Path, max_age_days: u64) {
    let Ok(entries) = std::fs::read_dir(log_dir) else { return };
    let max_age = Duration::from_secs(max_age_days * 24 * 60 * 60);
    let now = SystemTime::now();

    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else { continue };
        if !metadata.is_file() {
            continue;
        }
        let Ok(modified) = metadata.modified() else { continue };
        let Ok(age) = now.duration_since(modified) else { continue };
        if age > max_age {
            if let Err(e) = std::fs::remove_file(&path) {
                tracing::warn!(path = %path.display(), "failed to prune old log file: {e:?}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs::File;
    use std::path::Path;
    use std::time::{Duration, SystemTime};

    use super::prune_old_logs;

    const DAY: Duration = Duration::from_hours(24);

    fn file_aged(dir: &Path, name: &str, age: Duration) {
        let file = File::create(dir.join(name)).expect("create log file");
        file.set_modified(SystemTime::now() - age).expect("backdate log file");
    }

    #[test]
    fn pruning_deletes_only_files_older_than_the_retention_window() {
        let dir = tempfile::tempdir().expect("temp dir");
        file_aged(dir.path(), "plate-vault.log.stale", 15 * DAY);
        file_aged(dir.path(), "plate-vault.log.recent", 13 * DAY);
        std::fs::create_dir(dir.path().join("subdir")).expect("create subdir");

        prune_old_logs(dir.path(), 14);

        assert!(!dir.path().join("plate-vault.log.stale").exists());
        assert!(dir.path().join("plate-vault.log.recent").exists());
        assert!(dir.path().join("subdir").exists(), "directories are never pruned");
    }

    #[test]
    fn pruning_a_missing_directory_is_a_no_op() {
        let dir = tempfile::tempdir().expect("temp dir");
        prune_old_logs(&dir.path().join("absent"), 14);
    }
}
