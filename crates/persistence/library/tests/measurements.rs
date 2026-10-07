// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Measurement runs, cached records, contained reads and reviewed imports in
//! the library catalog (spec 067: PIX-FR-01/06/07/08, PIX-AC-01/04,
//! PV-PIX-SC-03).
#![allow(clippy::too_many_lines)]

mod support;

use std::collections::BTreeMap;
use std::io::{Read, Write};

use persistence_library::{Catalog, ImportReviewInput, LocationReferences};
use platevault_model::{
    reasons, Asset, Availability, ColumnClass, DecodedBasis, Drift, ExportLayout, FrameState,
    FrameStateKind, ImageFormat, ImportBasis, ImportCell, ImportColumn, ImportFormat,
    ImportReviewState, ImportRow, ImportSource, ImportVerification, InputBasis, LibraryError,
    Location, LocationLifecycle, MaskCounts, MeasurementMethod, MeasurementOutcome,
    MeasurementRecord, MetricId, MetricValue, NativePath, PlaneBasis, PreambleEntry,
    RecordValidity, ReferenceKind, RowMatch, RowResolution, RunIssue, RunState, SampleFormat,
    SaturationBasis, SaturationSource, Scaling, Units, Verification,
};
use sqlx::{Connection, Row};
use support::{kind, scan, sha_of, DiskProbe, Fixture};
use uuid::Uuid;

const FRAMES: [&str; 3] = ["night1/Ha_001.fits", "night1/Ha_002.fits", "night2/OIII_001.fits"];

fn method() -> MeasurementMethod {
    MeasurementMethod::new("platevault.stars", 1)
}

fn bytes_for(index: usize) -> Vec<u8> {
    format!("SIMPLE  =                    T / frame {index}\n").repeat(40 + index).into_bytes()
}

struct Indexed {
    fx: Fixture,
    catalog: Catalog,
    location: Location,
    assets: Vec<Asset>,
}

impl Indexed {
    fn path(&self, index: usize) -> std::path::PathBuf {
        self.fx.root.join(FRAMES[index])
    }
    fn ids(&self) -> Vec<Uuid> {
        self.assets.iter().map(|asset| asset.id).collect()
    }
    async fn refresh(&mut self) {
        self.assets = sorted(self.catalog.location_assets(self.location.id).await.unwrap());
    }
}

fn sorted(mut assets: Vec<Asset>) -> Vec<Asset> {
    assets.sort_by_key(|asset| asset.relative_path.display());
    assets
}

async fn indexed() -> Indexed {
    let fx = Fixture::new();
    for (index, name) in FRAMES.iter().enumerate() {
        fx.write(name, &bytes_for(index));
    }
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &FRAMES).await;
    let assets = sorted(catalog.location_assets(location.id).await.unwrap());
    assert_eq!(assets.len(), 3);
    Indexed { fx, catalog, location, assets }
}

fn record(
    asset: &Asset,
    run: Uuid,
    sequence: u64,
    sha256: &str,
    failed: bool,
) -> MeasurementRecord {
    let method = method();
    let mut fingerprint = asset.fingerprint.clone();
    fingerprint.content_sha256 = Some(sha256.to_owned());
    let outcome = if failed {
        MeasurementOutcome::Failed {
            reason: reasons::UNSUPPORTED_FORMAT.into(),
            message: "FITS tile compression".into(),
        }
    } else {
        MeasurementOutcome::Measured {
            metrics: vec![
                MetricValue::measured(MetricId::BackgroundMedian, Units::Dn, 1000.5, &method),
                MetricValue::unavailable(
                    MetricId::FwhmMedian,
                    Units::Px,
                    reasons::NO_FITTED_STARS,
                    &method,
                ),
            ],
            stars: Vec::new(),
            masks: MaskCounts { saturated: 3, ..MaskCounts::default() },
            truncated: false,
        }
    };
    MeasurementRecord {
        id: Uuid::new_v4(),
        asset_id: asset.id,
        run_id: run,
        method,
        dequeue_sequence: sequence,
        basis: InputBasis {
            fingerprint,
            container: ImageFormat::Fits,
            decoded: Some(DecodedBasis {
                plane: PlaneBasis::Mono,
                plane_count: 1,
                sample_format: SampleFormat::Int16,
                scaling: Scaling { zero: 32768.0, scale: 1.0 },
                blank: None,
                width: 8,
                height: 8,
                saturation: SaturationBasis {
                    level: Some(65535.0),
                    source: SaturationSource::TypeMaximum,
                },
            }),
        },
        outcome,
        measured_at: "2026-10-05T10:00:00Z".into(),
    }
}

/// Every non-measurement table as quoted rows, in rowid order.
async fn dump(fx: &Fixture) -> BTreeMap<String, Vec<String>> {
    let url = format!("sqlite://{}?mode=ro", fx.db.display());
    let mut conn = sqlx::SqliteConnection::connect(&url).await.unwrap();
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' \
         AND name NOT LIKE 'measurement%' ORDER BY name",
    )
    .fetch_all(&mut conn)
    .await
    .unwrap();
    let mut dump = BTreeMap::new();
    for table in tables {
        let columns: Vec<String> =
            sqlx::query(sqlx::AssertSqlSafe(format!("PRAGMA table_info({table})")))
                .fetch_all(&mut conn)
                .await
                .unwrap()
                .iter()
                .map(|row| row.get::<String, _>("name"))
                .collect();
        let select = columns
            .iter()
            .map(|column| format!("quote({column})"))
            .collect::<Vec<_>>()
            .join(" || ',' || ");
        let rows: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT {select} FROM {table} ORDER BY rowid"
        )))
        .fetch_all(&mut conn)
        .await
        .unwrap();
        dump.insert(table, rows);
    }
    conn.close().await.unwrap();
    dump
}

async fn table_names(path: &std::path::Path) -> Vec<String> {
    let url = format!("sqlite://{}?mode=ro", path.display());
    let mut conn = sqlx::SqliteConnection::connect(&url).await.unwrap();
    let names =
        sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .fetch_all(&mut conn)
            .await
            .unwrap();
    conn.close().await.unwrap();
    names
}

#[tokio::test]
async fn measurement_tables_install_at_the_schema_version_and_older_catalogs_are_refused() {
    let fx = Fixture::new();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    catalog.close().await.unwrap();
    let url = format!("sqlite://{}?mode=ro", fx.db.display());
    let mut conn = sqlx::SqliteConnection::connect(&url).await.unwrap();
    let version: i64 =
        sqlx::query_scalar("SELECT value FROM catalog_meta WHERE key = 'schema_version'")
            .fetch_one(&mut conn)
            .await
            .unwrap();
    conn.close().await.unwrap();
    assert_eq!(version, persistence_library::SCHEMA_VERSION);
    let tables = table_names(&fx.db).await;
    for table in [
        "measurement_runs",
        "measurement_records",
        "measurement_imports",
        "measurement_import_values",
    ] {
        assert!(tables.contains(&table.to_owned()), "{table} missing from {tables:?}");
    }

    let older = fx.temp.path().join("older.sqlite");
    let url = format!("sqlite://{}?mode=rwc", older.display());
    let mut conn = sqlx::SqliteConnection::connect(&url).await.unwrap();
    sqlx::query(
        "CREATE TABLE catalog_meta (key TEXT PRIMARY KEY NOT NULL, value INTEGER NOT NULL) STRICT",
    )
    .execute(&mut conn)
    .await
    .unwrap();
    sqlx::query("INSERT INTO catalog_meta (key, value) VALUES ('schema_version', ?1)")
        .bind(version - 1)
        .execute(&mut conn)
        .await
        .unwrap();
    conn.close().await.unwrap();
    match Catalog::open(&older).await {
        Err(LibraryError::InvalidInput(message)) => {
            assert!(message.contains(&(version - 1).to_string()), "{message}");
        }
        Err(other) => panic!("expected InvalidInput, got {other:?}"),
        Ok(_) => panic!("an older catalog opened"),
    }
    assert_eq!(table_names(&older).await, vec!["catalog_meta".to_owned()], "no DDL ran");
}

#[tokio::test]
async fn contained_reads_hash_exactly_the_consumed_bytes_and_refuse_links_and_changes() {
    let mut ix = indexed().await;
    let before = dump(&ix.fx).await;
    let first = ix.assets[0].clone();
    let read = ix
        .catalog
        .open_contained(first.id, DiskProbe, |reader: &mut dyn Read| {
            let mut head = vec![0; 100];
            reader
                .read_exact(&mut head)
                .map_err(|error| LibraryError::SourceUnavailable(error.to_string()))?;
            Ok(head)
        })
        .await
        .unwrap();
    let bytes = std::fs::read(ix.path(0)).unwrap();
    assert_eq!(read.value, bytes[..100]);
    assert_eq!(read.sha256, sha_of(&ix.path(0)), "the unread remainder is hashed too");
    assert_eq!(read.fingerprint.content_sha256.as_deref(), Some(read.sha256.as_str()));
    assert_eq!(read.fingerprint.size_bytes, bytes.len() as u64);
    assert_eq!(read.asset.id, first.id);
    let whole = ix
        .catalog
        .open_contained(first.id, DiskProbe, |reader: &mut dyn Read| {
            let mut all = Vec::new();
            reader
                .read_to_end(&mut all)
                .map_err(|error| LibraryError::SourceUnavailable(error.to_string()))?;
            Ok(all)
        })
        .await
        .unwrap();
    assert_eq!(whole.value, bytes);
    assert_eq!(whole.sha256, read.sha256);
    assert_eq!(dump(&ix.fx).await, before, "a contained read writes no row");
    assert!(ix.catalog.asset(first.id).await.unwrap().last_verified_at.is_none());

    std::fs::remove_file(ix.path(1)).unwrap();
    std::os::unix::fs::symlink(ix.path(0), ix.path(1)).unwrap();
    let linked =
        ix.catalog.open_contained(ix.assets[1].id, DiskProbe, |_: &mut dyn Read| Ok(())).await;
    let error = linked.expect_err("a linked leaf is refused");
    assert!(
        ["invalid_input", "identity_conflict", "source_unavailable"]
            .contains(&kind(&error).as_str()),
        "{error:?}"
    );

    let changing = ix.path(2);
    let changed = ix
        .catalog
        .open_contained(ix.assets[2].id, DiskProbe, move |reader: &mut dyn Read| {
            let mut head = [0; 10];
            reader
                .read_exact(&mut head)
                .map_err(|error| LibraryError::SourceUnavailable(error.to_string()))?;
            let mut file = std::fs::OpenOptions::new().append(true).open(&changing).unwrap();
            file.write_all(b"appended while reading").unwrap();
            Ok(head)
        })
        .await;
    assert_eq!(kind(&changed.expect_err("a changed source is refused")), "identity_conflict");
    ix.refresh().await;
    assert_eq!(dump(&ix.fx).await, before);
}

/// Main's D19 rule: a contained read is of the recorded file. A file swapped
/// in at the same path with equal size and nanosecond mtime is a different
/// file and is refused; bytes rewritten in place keep the recorded file and
/// are read with their current digest.
#[tokio::test]
async fn open_contained_refuses_replaced_file_with_equal_stats() {
    let ix = indexed().await;
    let before = dump(&ix.fx).await;
    let read_all = |reader: &mut dyn Read| {
        let mut all = Vec::new();
        reader
            .read_to_end(&mut all)
            .map_err(|error| LibraryError::SourceUnavailable(error.to_string()))?;
        Ok(all)
    };

    let replaced = ix.path(0);
    let original = std::fs::metadata(&replaced).unwrap();
    let mut bytes = std::fs::read(&replaced).unwrap();
    bytes[0] ^= 0x01;
    let staged = replaced.with_extension("staged");
    std::fs::write(&staged, &bytes).unwrap();
    std::fs::File::options()
        .write(true)
        .open(&staged)
        .unwrap()
        .set_modified(original.modified().unwrap())
        .unwrap();
    std::fs::rename(&staged, &replaced).unwrap();
    let swapped = std::fs::metadata(&replaced).unwrap();
    assert_eq!(swapped.len(), original.len());
    assert_eq!(swapped.modified().unwrap(), original.modified().unwrap());
    assert_ne!(
        std::os::unix::fs::MetadataExt::ino(&swapped),
        std::os::unix::fs::MetadataExt::ino(&original)
    );
    let refused = ix.catalog.open_contained(ix.assets[0].id, DiskProbe, read_all).await;
    assert_eq!(kind(&refused.expect_err("a replaced file is refused")), "identity_conflict");

    let rewritten = ix.path(1);
    let original = std::fs::metadata(&rewritten).unwrap();
    let mut bytes = std::fs::read(&rewritten).unwrap();
    bytes[0] ^= 0x01;
    std::fs::write(&rewritten, &bytes).unwrap();
    std::fs::File::options()
        .write(true)
        .open(&rewritten)
        .unwrap()
        .set_modified(original.modified().unwrap())
        .unwrap();
    let read = ix.catalog.open_contained(ix.assets[1].id, DiskProbe, read_all).await.unwrap();
    assert_eq!(read.value, bytes, "the recorded file is read as it is now");
    assert_eq!(read.sha256, sha_of(&rewritten));
    assert_eq!(dump(&ix.fx).await, before, "a contained read writes no row");
}

fn state(basis: &persistence_library::FrameRecordBasis) -> FrameState {
    FrameState::derive(
        &basis.asset,
        basis.record.as_ref(),
        basis.validity,
        basis.queued,
        Vec::new(),
    )
}

#[tokio::test]
async fn frame_record_validity_follows_fingerprints_digests_methods_and_availability() {
    let mut ix = indexed().await;
    let ids = ix.ids();
    let run = ix.catalog.begin_measurement_run(&method(), &ids, 0).await.unwrap();
    let pending = ix.catalog.frame_records(&ids, &method()).await.unwrap();
    assert!(pending.iter().all(|basis| basis.queued && basis.validity == RecordValidity::Absent));
    assert!(pending.iter().all(|basis| state(basis).state == FrameStateKind::Pending));
    let wrong = "00".repeat(32);
    for (index, asset) in ix.assets.clone().iter().enumerate() {
        let sha = if index == 1 { wrong.clone() } else { sha_of(&ix.path(index)) };
        ix.catalog
            .record_measurement(
                run.operation_id,
                &record(asset, run.operation_id, index as u64 + 1, &sha, false),
            )
            .await
            .unwrap();
    }
    ix.catalog.finish_measurement_run(run.operation_id, RunState::Completed).await.unwrap();
    let before = dump(&ix.fx).await;
    let records = ix.catalog.frame_records(&ids, &method()).await.unwrap();
    assert_eq!(
        dump(&ix.fx).await,
        before,
        "reading frame records starts no hash and writes nothing"
    );
    assert_eq!(records.iter().map(|basis| basis.asset.id).collect::<Vec<_>>(), ids);
    for basis in &records {
        assert_eq!(basis.validity, RecordValidity::Valid);
        let state = state(basis);
        assert_eq!(state.state, FrameStateKind::Cached);
        assert_eq!(state.verification, Some(Verification::Current));
        assert_eq!(state.values.len(), 2);
        assert!(!basis.queued);
    }
    let bumped = ix
        .catalog
        .frame_records(&ids, &MeasurementMethod::new("platevault.stars", 2))
        .await
        .unwrap();
    assert!(bumped.iter().all(|basis| basis.validity == RecordValidity::Stale));
    assert!(bumped.iter().all(|basis| state(basis).state == FrameStateKind::NotMeasured));

    // A library digest for the current fingerprint that differs from the record's.
    ix.catalog.verify_digest(ix.assets[1].id, DiskProbe).await.unwrap();
    let records = ix.catalog.frame_records(&ids, &method()).await.unwrap();
    assert_eq!(records[0].validity, RecordValidity::Valid);
    assert_eq!(records[1].validity, RecordValidity::Stale);
    assert!(state(&records[1]).values.is_empty(), "a stale record supplies no value");

    // A rescan records a changed fingerprint.
    ix.fx.write(FRAMES[2], b"rewritten with different bytes");
    scan(&ix.catalog, &ix.fx, &ix.location, &FRAMES).await;
    ix.refresh().await;
    let records = ix.catalog.frame_records(&ids, &method()).await.unwrap();
    assert_eq!(records[2].validity, RecordValidity::Stale);
    assert_eq!(state(&records[2]).state, FrameStateKind::NotMeasured);

    // An offline copy keeps its valid record, labelled last observed.
    let unplugged = ix.fx.root.with_extension("unplugged");
    std::fs::rename(&ix.fx.root, &unplugged).unwrap();
    let location = ix
        .catalog
        .mark_location_unavailable(ix.location.id, Availability::Offline, "unplugged")
        .await
        .unwrap();
    let records = ix.catalog.frame_records(&ids, &method()).await.unwrap();
    assert_eq!(records[0].asset.availability, Availability::Offline);
    assert_eq!(records[0].validity, RecordValidity::Valid);
    let offline = state(&records[0]);
    assert_eq!(
        (offline.state, offline.verification),
        (FrameStateKind::Cached, Some(Verification::LastObserved))
    );
    let gone = state(&records[2]);
    assert_eq!(
        (gone.state, gone.reason.as_deref()),
        (FrameStateKind::Unavailable, Some("offline"))
    );

    // Retiring the location keeps the records as history; the copies read unavailable.
    let assets = ix.catalog.location_assets(location.id).await.unwrap();
    let references = LocationReferences {
        assets: assets.iter().map(|asset| asset.id).collect(),
        references: Vec::new(),
        consulted: vec![ReferenceKind::View, ReferenceKind::Project, ReferenceKind::Result],
    };
    let review = ix.catalog.review_retire_location(location.id, &references).await.unwrap();
    let retired = ix
        .catalog
        .retire_location(review.id, location.id, review.expected_revision, &references)
        .await
        .unwrap();
    assert_eq!(retired.lifecycle, LocationLifecycle::Retired);
    let records = ix.catalog.frame_records(&ids, &method()).await.unwrap();
    for basis in &records {
        assert_eq!(basis.asset.availability, Availability::Retired);
        assert!(basis.record.is_some(), "records stay as history");
        let state = state(basis);
        assert_eq!(
            (state.state, state.reason.as_deref()),
            (FrameStateKind::Unavailable, Some("retired"))
        );
    }
}

#[tokio::test]
async fn one_run_runs_at_a_time_and_counters_issues_and_interruption_are_durable() {
    let mut ix = indexed().await;
    let ids = ix.ids();
    let before = dump(&ix.fx).await;
    let run = ix.catalog.begin_measurement_run(&method(), &ids[..2], 1).await.unwrap();
    assert_eq!((run.state, run.revision), (RunState::Running, 1));
    assert_eq!(
        (run.counters.requested, run.counters.already_cached, run.counters.remaining),
        (3, 1, 2)
    );
    let second = ix.catalog.begin_measurement_run(&method(), &ids[2..], 0).await.unwrap_err();
    assert!(
        matches!(second, LibraryError::Conflict { id, .. } if id == run.operation_id),
        "{second:?}"
    );
    let run = ix.catalog.extend_measurement_run(run.operation_id, &ids[1..], 0).await.unwrap();
    assert_eq!(
        (run.counters.requested, run.counters.remaining, run.revision),
        (4, 3, 2),
        "an asset already queued is not queued twice"
    );
    let measured = record(&ix.assets[0], run.operation_id, 1, &sha_of(&ix.path(0)), false);
    let run = ix.catalog.record_measurement(run.operation_id, &measured).await.unwrap();
    assert_eq!((run.counters.measured, run.counters.remaining, run.revision), (1, 2, 3));
    assert_eq!(ix.catalog.measurement(measured.id).await.unwrap(), measured);
    let issue =
        RunIssue { asset_id: ids[1], kind: "source_unavailable".into(), message: "offline".into() };
    let run = ix.catalog.record_run_issue(run.operation_id, &issue).await.unwrap();
    assert_eq!((run.counters.unavailable, run.counters.remaining), (1, 1));
    assert_eq!(run.issues, vec![issue.clone()]);
    assert_eq!(dump(&ix.fx).await, before, "measurement writes touch only measurement tables");

    // The source changed after it was read: an issue instead of a record.
    let stale = record(&ix.assets[2], run.operation_id, 2, &sha_of(&ix.path(2)), false);
    ix.fx.write(FRAMES[2], b"changed after the read");
    scan(&ix.catalog, &ix.fx, &ix.location, &FRAMES).await;
    ix.refresh().await;
    let run = ix.catalog.record_measurement(run.operation_id, &stale).await.unwrap();
    assert_eq!(
        (run.counters.measured, run.counters.unavailable, run.counters.remaining),
        (1, 2, 0)
    );
    assert_eq!(run.issues[1].asset_id, ids[2]);
    assert_eq!(run.issues[1].kind, "identity_conflict");
    assert_eq!(kind(&ix.catalog.measurement(stale.id).await.unwrap_err()), "not_found");
    assert!(ix.catalog.frame_records(&ids[2..], &method()).await.unwrap()[0].record.is_none());

    let refused =
        ix.catalog.finish_measurement_run(run.operation_id, RunState::Running).await.unwrap_err();
    assert_eq!(kind(&refused), "invalid_input");
    let done =
        ix.catalog.finish_measurement_run(run.operation_id, RunState::Completed).await.unwrap();
    assert_eq!(done.state, RunState::Completed);
    assert!(done.finished_at.is_some());
    let late = record(&ix.assets[1], run.operation_id, 3, &sha_of(&ix.path(1)), false);
    assert!(matches!(
        ix.catalog.record_measurement(run.operation_id, &late).await,
        Err(LibraryError::Conflict { .. })
    ));

    let next = ix.catalog.begin_measurement_run(&method(), &ids[1..2], 0).await.unwrap();
    let failed = record(&ix.assets[1], next.operation_id, 1, &sha_of(&ix.path(1)), true);
    let next = ix.catalog.record_measurement(next.operation_id, &failed).await.unwrap();
    assert_eq!((next.counters.failed, next.counters.remaining), (1, 0));
    let failed_state = state(&ix.catalog.frame_records(&ids[1..2], &method()).await.unwrap()[0]);
    assert_eq!(
        (failed_state.state, failed_state.reason.as_deref()),
        (FrameStateKind::Failed, Some("unsupported_format"))
    );
    let open = ix.catalog.begin_measurement_run(&method(), &ids[..1], 0).await;
    assert!(open.is_err(), "the second run is still Running");
    ix.catalog.close().await.unwrap();

    let reopened = Catalog::open(&ix.fx.db).await.unwrap();
    let interrupted = reopened.measurement_run(next.operation_id).await.unwrap();
    assert_eq!(interrupted.state, RunState::Interrupted);
    assert_eq!(interrupted.revision, next.revision + 1);
    let runs = reopened.list_measurement_runs(0, 10).await.unwrap();
    assert_eq!(
        runs.iter().map(|run| run.operation_id).collect::<Vec<_>>(),
        vec![next.operation_id, run.operation_id]
    );
    assert_eq!(reopened.measurement(measured.id).await.unwrap(), measured);
    assert_eq!(reopened.measurement(failed.id).await.unwrap(), failed);
}

fn column(
    header: &str,
    position: u32,
    class: ColumnClass,
    units: Option<Units>,
    reason: Option<&str>,
) -> ImportColumn {
    ImportColumn {
        header: header.into(),
        position,
        class,
        units,
        units_basis: units
            .map(|_| vec![PreambleEntry { key: "Scale Unit".into(), value: "arcsec".into() }])
            .unwrap_or_default(),
        reason: reason.map(str::to_owned),
        warnings: Vec::new(),
    }
}

/// One CSV row; an attached row carries its asset and the SHA-256 it was
/// reviewed against.
fn row(
    line: u64,
    file: &str,
    state: RowMatch,
    candidates: Vec<Uuid>,
    attached: Option<(&Asset, String)>,
    fwhm: &str,
) -> ImportRow {
    ImportRow {
        line,
        index: Some(line - 1),
        file: file.into(),
        match_state: state,
        reason: None,
        candidates,
        asset_id: attached.as_ref().map(|(asset, _)| asset.id),
        basis: attached.map(|(asset, sha256)| ImportBasis {
            fingerprint: asset.fingerprint.clone(),
            sha256: Some(sha256),
        }),
        values: vec![ImportCell {
            position: 2,
            raw: fwhm.into(),
            value: fwhm.parse().ok(),
            reason: None,
        }],
    }
}

fn review_input(ix: &Indexed) -> ImportReviewInput {
    let [first, second, third] = [&ix.assets[0], &ix.assets[1], &ix.assets[2]];
    ImportReviewInput {
        format: ImportFormat::SubframeSelectorCsv,
        source: ImportSource {
            path: NativePath::from_path(&ix.fx.temp.path().join("measurements.csv")),
            size_bytes: 1234,
            sha256: "ab".repeat(32),
        },
        module_version: Some("1.9.3".into()),
        psf_type: Some("Moffat4".into()),
        preamble: vec![PreambleEntry { key: "Scale Unit".into(), value: "arcsec".into() }],
        layout: ExportLayout::Columns30,
        scope: ix.ids(),
        columns: vec![
            column("Index", 0, ColumnClass::Identity, None, None),
            column("File", 1, ColumnClass::Identity, None, None),
            column("FWHM", 2, ColumnClass::Mapped, Some(Units::Arcsec), None),
            column(
                "Approved",
                3,
                ColumnClass::Excluded,
                None,
                Some(reasons::DECISION_NOT_IMPORTED),
            ),
        ],
        rows: vec![
            row(
                2,
                "/other/machine/night1/Ha_001.fits",
                RowMatch::MatchedPath,
                vec![first.id],
                Some((first, sha_of(&ix.path(0)))),
                "2.50",
            ),
            row(
                3,
                "C:/lights/OIII_001.fits",
                RowMatch::Ambiguous,
                vec![second.id, third.id],
                None,
                "3.10",
            ),
            row(4, "/elsewhere/unknown.fits", RowMatch::Unmatched, Vec::new(), None, "2.90"),
        ],
        bases: [first, second, third]
            .into_iter()
            .enumerate()
            .map(|(index, asset)| {
                let sha256 = Some(sha_of(&ix.path(index)));
                (asset.id, ImportBasis { fingerprint: asset.fingerprint.clone(), sha256 })
            })
            .collect(),
    }
}

#[tokio::test]
async fn reviewed_imports_confirm_once_within_candidates_and_against_unchanged_assets() {
    let mut ix = indexed().await;
    let candidates = ix.catalog.import_candidates(&ix.ids()).await.unwrap();
    assert_eq!(candidates.len(), 3);
    let first = candidates.iter().find(|candidate| candidate.asset_id == ix.assets[0].id).unwrap();
    assert_eq!(first.basename.as_deref(), Some("Ha_001.fits"));
    assert_eq!(first.path, NativePath::from_path(&ix.path(0)));
    assert_eq!(first.path_text.as_deref(), ix.path(0).to_str());
    assert_eq!(first.sha256, None, "no digest is recorded yet");

    let before = dump(&ix.fx).await;
    let review = ix.catalog.create_import_review(&review_input(&ix)).await.unwrap();
    assert_eq!((review.state, review.revision), (ImportReviewState::Reviewed, 1));
    assert_eq!(review.rows.len(), 3);
    assert_eq!(ix.catalog.import_review(review.review_id).await.unwrap(), review);
    assert!(
        ix.catalog.imported_values(&ix.ids()).await.unwrap().is_empty(),
        "a review attaches nothing"
    );

    let outside = [RowResolution { index: 2, asset_id: ix.assets[0].id }];
    let error = ix.catalog.confirm_import(review.review_id, &outside).await.unwrap_err();
    assert_eq!(kind(&error), "invalid_input");
    let not_ambiguous = [RowResolution { index: 1, asset_id: ix.assets[0].id }];
    assert_eq!(
        kind(&ix.catalog.confirm_import(review.review_id, &not_ambiguous).await.unwrap_err()),
        "invalid_input"
    );
    assert_eq!(
        ix.catalog.import_review(review.review_id).await.unwrap(),
        review,
        "nothing written on refusal"
    );
    assert_eq!(dump(&ix.fx).await, before);

    // The resolved asset changed since review: the whole import is refused.
    ix.fx.write(FRAMES[1], b"changed after review");
    scan(&ix.catalog, &ix.fx, &ix.location, &FRAMES).await;
    ix.refresh().await;
    let changed = [RowResolution { index: 2, asset_id: ix.assets[1].id }];
    assert!(matches!(
        ix.catalog.confirm_import(review.review_id, &changed).await,
        Err(LibraryError::Conflict { .. })
    ));
    assert_eq!(ix.catalog.import_review(review.review_id).await.unwrap(), review);

    let before = dump(&ix.fx).await;
    let resolve = [RowResolution { index: 2, asset_id: ix.assets[2].id }];
    let confirmed = ix.catalog.confirm_import(review.review_id, &resolve).await.unwrap();
    assert_eq!(dump(&ix.fx).await, before, "confirmation writes only import tables");
    assert_eq!(confirmed.review.state, ImportReviewState::Confirmed);
    assert_eq!(confirmed.review.revision, 2);
    assert!(confirmed.review.confirmed_at.is_some());
    assert_eq!(confirmed.attached.iter().map(|row| row.line).collect::<Vec<_>>(), vec![2, 3]);
    assert_eq!(confirmed.attached[1].match_state, RowMatch::Resolved);
    assert_eq!(confirmed.attached[1].asset_id, Some(ix.assets[2].id));
    assert_eq!(confirmed.unattached.iter().map(|row| row.line).collect::<Vec<_>>(), vec![4]);
    assert_eq!(confirmed.values.len(), 2);
    for value in &confirmed.values {
        assert_eq!(value.verification, ImportVerification::Unverified);
        assert_eq!(value.drift, Drift::Matches);
        assert_eq!(value.units, Some(Units::Arcsec));
        assert_eq!(value.column, "FWHM");
    }
    let again = ix.catalog.confirm_import(review.review_id, &resolve).await.unwrap_err();
    assert!(
        matches!(again, LibraryError::Conflict { .. }),
        "confirmation is single-use: {again:?}"
    );

    let ids = ix.ids();
    let values = ix.catalog.imported_values(&ids).await.unwrap();
    assert_eq!(values.len(), 2);
    assert_eq!(
        values.iter().find(|value| value.asset_id == ix.assets[0].id).unwrap().value,
        Some(2.5)
    );
    ix.catalog.close().await.unwrap();
    let reopened = Catalog::open(&ix.fx.db).await.unwrap();
    assert_eq!(reopened.import_review(review.review_id).await.unwrap(), confirmed.review);
    assert_eq!(reopened.imported_values(&ids).await.unwrap(), values);

    // A later change to an attached asset reads as drift, never as a new value.
    ix.fx.write(FRAMES[0], b"rewritten after import");
    scan(&reopened, &ix.fx, &ix.location, &FRAMES).await;
    let drifted = reopened.imported_values(&ids[..1]).await.unwrap();
    assert_eq!(drifted[0].drift, Drift::Differs);
    assert_eq!(drifted[0].value, Some(2.5));
}
