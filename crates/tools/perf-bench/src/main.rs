// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Performance measurement harness for the inbox scan/classify hot paths.
//!
//! Generates a synthetic fixture tree in a tempdir, runs real use-case
//! functions against a real `SQLite` database (with migrations applied), and
//! prints one machine-readable JSON line per scenario so PRs can paste
//! before/after tables.
//!
//! # Usage
//!
//! ```
//! just perf-bench              # PERF_N=500 (CI-safe default)
//! PERF_N=5000 just perf-bench  # larger fixture for a local baseline run
//! ```
//!
//! # Environment variables
//!
//! | Variable | Default | Description |
//! |---|---|---|
//! | `PERF_N` | `500` | Number of sub-frame FITS files to generate |
//!
//! # Output
//!
//! One JSON object per scenario written to stdout:
//!
//! ```json
//! {"scenario":"scan_root","n":500,"wall_ms":42,"items":10}
//! {"scenario":"classify_source_groups","n":500,"wall_ms":310,"groups":10}
//! ```
//!
//! `wall_ms` is wall-clock milliseconds measured around the use-case call
//! only (fixture setup and DB bootstrapping are excluded from every timing
//! window).

use std::io::Write;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::Instant;

use app_core_inbox::classify::classify_source_group;
use app_core_inbox::scan::{scan_root, ScanOptions};
use domain_core::first_run::{OrganizationState, RegisterSourceRequest, ScanDepth, SourceKind};
use persistence_db::repositories::first_run::register_source;
use persistence_db::repositories::inbox::{upsert_inbox_source_group, UpsertSourceGroup};
use persistence_db::Database;
use tracing_subscriber::prelude::*;
use uuid::Uuid;

// ── Fixture builder ───────────────────────────────────────────────────────────

/// Pad a string to exactly 80 ASCII bytes (FITS card width).
fn pad80(s: &str) -> Vec<u8> {
    let mut v: Vec<u8> = s.as_bytes().to_vec();
    v.resize(80, b' ');
    v
}

/// Write a minimal valid FITS file (one 2880-byte header block).
///
/// Cards: SIMPLE, BITPIX, NAXIS, IMAGETYP, OBJECT, FILTER, EXPTIME, GAIN,
/// NAXIS1, NAXIS2, DATE-OBS. Enough for the classify path to extract a
/// complete classification evidence row.
fn write_fits(dir: &Path, name: &str, seq: usize) {
    // Vary OBJECT/FILTER/EXPTIME so classify sees realistic diversity.
    let objects = ["NGC 7000", "M 42", "M 31", "IC 1805", "NGC 253"];
    let filters = ["Ha", "OIII", "SII", "L", "R", "G", "B"];
    let object = objects[seq % objects.len()];
    let filter = filters[seq % filters.len()];
    let exptime = 300 * ((seq % 4) + 1); // 300..1200

    let mut bytes: Vec<u8> = Vec::new();
    for card in &[
        "SIMPLE  =                    T / file conforms to FITS standard".to_owned(),
        "BITPIX  =                   16 / bits per data value".to_owned(),
        "NAXIS   =                    0 / no image data".to_owned(),
        "IMAGETYP= 'Light Frame'        / frame type".to_owned(),
        format!("OBJECT  = '{object:<16}' / object name"),
        format!("FILTER  = '{filter:<8}' / filter name"),
        format!("EXPTIME =              {exptime:7}.0 / exposure time in seconds"),
        "GAIN    =                   100 / camera gain".to_owned(),
        "NAXIS1  =                  4144 / width".to_owned(),
        "NAXIS2  =                  2822 / height".to_owned(),
        "DATE-OBS= '2025-10-10T22:15:00' / observation start".to_owned(),
        "INSTRUME= 'ZWO ASI2600MM Pro'   / camera".to_owned(),
    ] {
        bytes.extend_from_slice(&pad80(card));
    }
    bytes.extend_from_slice(&pad80("END"));
    // Pad to the 2880-byte FITS block boundary.
    let rem = bytes.len() % 2880;
    if rem != 0 {
        bytes.resize(bytes.len() + (2880 - rem), b' ');
    }

    let path = dir.join(name);
    let mut f = std::fs::File::create(path).expect("create FITS fixture");
    f.write_all(&bytes).expect("write FITS fixture");
}

/// Build a fixture tree under `root`:
///
/// ```
/// root/
///   session_001/  (files_per_session FITS files)
///   session_002/
///   ...
/// ```
///
/// `n` is the total file count. Sessions are sized at 50 files each so a
/// 500-file fixture has 10 leaf folders — realistic for a night's worth of
/// frames spread across targets.
fn build_fixture(root: &Path, n: usize) {
    const FILES_PER_SESSION: usize = 50;
    let sessions = n.div_ceil(FILES_PER_SESSION);

    let mut seq = 0usize;
    for s in 0..sessions {
        let session_dir = root.join(format!("session_{s:03}"));
        std::fs::create_dir_all(&session_dir).expect("create session dir");

        let count = FILES_PER_SESSION.min(n.saturating_sub(s * FILES_PER_SESSION));
        for i in 0..count {
            write_fits(&session_dir, &format!("frame_{i:04}.fits"), seq);
            seq += 1;
        }
    }
}

// ── Query counter ─────────────────────────────────────────────────────────────

/// Counts tracing events whose target starts with `sqlx`.
///
/// sqlx emits a tracing event per statement execution at the `debug` level
/// under the `sqlx` target (target prefix `"sqlx"`). Counting those events gives a
/// statement-count proxy for DB pressure without adding any instrumentation
/// dependency inside the production crates.
///
/// The inner `Arc<AtomicU64>` lets the layer and the harness share the same
/// counter. The newtype wrapper is required by Rust's orphan rule: `Layer` is
/// a foreign trait and `Arc` is a foreign type, so the impl must be on a
/// local type.
struct SqlxCounterLayer(std::sync::Arc<std::sync::atomic::AtomicU64>);

impl SqlxCounterLayer {
    fn new() -> (Self, std::sync::Arc<std::sync::atomic::AtomicU64>) {
        let inner = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
        (Self(inner.clone()), inner)
    }
}

impl<S: tracing::Subscriber> tracing_subscriber::Layer<S> for SqlxCounterLayer {
    // Declare DEBUG interest so the registry does not drop sqlx query events
    // before they reach this layer, even when the fmt layer's EnvFilter is set
    // to a higher level (e.g. "error").
    fn max_level_hint(&self) -> Option<tracing::level_filters::LevelFilter> {
        Some(tracing::level_filters::LevelFilter::DEBUG)
    }

    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        if event.metadata().target().starts_with("sqlx") {
            self.0.fetch_add(1, Ordering::Relaxed);
        }
    }
}

// ── Scenario runner ───────────────────────────────────────────────────────────

fn print_result(scenario: &str, n: usize, wall_ms: u128, extra: &serde_json::Value) {
    let mut obj = serde_json::json!({
        "scenario": scenario,
        "n": n,
        "wall_ms": wall_ms,
    });
    if let serde_json::Value::Object(ref extra_map) = extra {
        if let serde_json::Value::Object(ref mut m) = obj {
            m.extend(extra_map.clone());
        }
    }
    println!("{obj}");
}

#[tokio::main]
async fn main() {
    let n: usize = std::env::var("PERF_N").ok().and_then(|v| v.parse().ok()).unwrap_or(500);

    // Set up counting tracing subscriber.
    //
    // The counter layer must receive sqlx DEBUG events regardless of RUST_LOG.
    // tracing drops events below the global max-level hint (computed as the
    // minimum across all layers' `max_level_hint`). SqlxCounterLayer overrides
    // `max_level_hint` to return DEBUG, so the framework keeps sqlx events
    // alive for counting even when the fmt layer's EnvFilter would otherwise
    // suppress them.
    //
    // Human-readable output defaults to "sqlx=debug" so statement counts are
    // visible on stderr; set RUST_LOG to override (e.g. "error" for silence).
    let (counter_layer, counter) = SqlxCounterLayer::new();
    let fmt_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("sqlx=debug"));
    tracing_subscriber::registry()
        .with(counter_layer)
        .with(tracing_subscriber::fmt::layer().with_writer(std::io::stderr).with_filter(fmt_filter))
        .init();

    // One-time bootstrap: tempdir + fixture + real SQLite with migrations.
    let fixture_dir = tempfile::tempdir().expect("tempdir");
    build_fixture(fixture_dir.path(), n);

    let db_dir = tempfile::tempdir().expect("db tempdir");
    let db_path = db_dir.path().join("perf.db");
    let db_url = format!("sqlite://{}?mode=rwc", db_path.display());
    let db = Database::connect(&db_url).await.expect("db connect");
    db.migrate().await.expect("migrations");

    // Register a synthetic inbox source so the source-group FK resolves.
    let root_path = fixture_dir.path().to_str().expect("utf8 path");
    let reg = register_source(
        db.pool(),
        &RegisterSourceRequest {
            kind: SourceKind::Inbox,
            path: root_path.to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Unorganized,
        },
    )
    .await
    .expect("register_source");
    let root_id = reg.source_id;

    // ── Scenario A: scan_root ─────────────────────────────────────────────────

    counter.store(0, Ordering::Relaxed);
    let t0 = Instant::now();
    let scanned = scan_root(fixture_dir.path(), &ScanOptions::default()).expect("scan_root");
    let scan_ms = t0.elapsed().as_millis();
    let scan_stmts = counter.load(Ordering::Relaxed);

    print_result(
        "scan_root",
        n,
        scan_ms,
        &serde_json::json!({ "items": scanned.len(), "sqlx_stmts": scan_stmts }),
    );

    // ── Persist source groups (prerequisite for classify) ─────────────────────
    //
    // This mirrors `inbox_scan_folder`'s upsert loop but is NOT timed as its
    // own scenario — it is setup for scenario B.

    for item in &scanned {
        let sg_id = Uuid::new_v4().to_string();
        upsert_inbox_source_group(
            db.pool(),
            &UpsertSourceGroup {
                id: &sg_id,
                root_id: &root_id,
                relative_path: &item.relative_path,
                content_signature: Some(&item.content_signature),
                format: Some(item.format.as_str()),
                lane: Some("move"),
                file_count: i64::try_from(item.sub_frame_count()).unwrap_or(i64::MAX),
            },
        )
        .await
        .expect("upsert source group");
    }

    // ── Scenario B: classify_source_groups ────────────────────────────────────
    //
    // Fetch all unclassified source groups and classify each one. Uses the
    // spec-058 `classify_source_group` path (folder-level, no pre-existing
    // inbox_item_id required).

    let groups =
        persistence_db::repositories::inbox::list_unclassified_source_groups(db.pool(), i64::MAX)
            .await
            .expect("list_unclassified_source_groups");

    counter.store(0, Ordering::Relaxed);
    let t0 = Instant::now();
    let mut classified = 0usize;
    for group in &groups {
        let result = classify_source_group(db.pool(), &group.id, fixture_dir.path()).await;
        if result.is_ok() {
            classified += 1;
        }
    }
    let classify_ms = t0.elapsed().as_millis();
    let classify_stmts = counter.load(Ordering::Relaxed);

    print_result(
        "classify_source_groups",
        n,
        classify_ms,
        &serde_json::json!({
            "groups": groups.len(),
            "classified_ok": classified,
            "sqlx_stmts": classify_stmts,
        }),
    );
}
