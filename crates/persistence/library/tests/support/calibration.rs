// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calibration fixtures (spec 068): locations below the shared fixture's
//! temporary folder, frames with their own capture metadata, a night-keyed
//! grouping, raw table dumps and a small behavioral rule set. A calibration test
//! declares it beside the shared fixture with
//! `#[path = "support/calibration.rs"] mod calibration_support;`.
#![allow(dead_code)]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use persistence_library::{Catalog, LocationRegistration, SourceProbe};
use platevault_model::{
    Asset, CalibrationRules, CaptureEvidence, CaptureKey, CaptureMetadata, Classification,
    CriterionId, CriterionResult, Evaluation, EvidenceField, GroupingResult, ImageFormat,
    InputEvidence, InputKind, KindMatch, LightEvidence, Location, LocationRole, MasterBasis,
    MasterEvidence, MatchCaution, MatchOffer, NativePath, PinTarget, ScanBatch, ScanFile,
    ScanIssue, ScanObservation, ScanOperation, ScanProgress, ScanState, SessionCandidate,
    SessionInput, SessionLight, Tolerance, Verdict, WorkflowSettings,
};
use uuid::Uuid;

use crate::support::{file_fingerprint, folder_identity, root_scope, DiskProbe, Fixture};

/// One scan of `files` with their own metadata, grouped by `grouping`.
pub async fn scan_files<G>(
    catalog: &Catalog,
    location: &Location,
    files: Vec<ScanFile>,
    issues: Vec<ScanIssue>,
    state: ScanState,
    grouping: G,
) -> ScanOperation
where
    G: FnMut(&[Asset]) -> GroupingResult + Copy,
{
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let root = DiskProbe.root_identity(location).unwrap();
    let progress = ScanProgress {
        discovered: files.len() as u64,
        metadata_read: files.len() as u64,
        ..ScanProgress::default()
    };
    let batch =
        ScanBatch { files: files.clone(), issues: issues.clone(), progress: progress.clone() };
    catalog.apply_scan_batch(operation.id, &root, &batch, grouping).await.unwrap();
    let terminal = matches!(state, ScanState::Completed | ScanState::Partial);
    let observation = ScanObservation {
        location_id: location.id,
        root_identity: root,
        incomplete_scopes: issues.iter().map(|issue| issue.relative_path.clone()).collect(),
        files,
        issues,
        complete_scopes: if terminal { vec![root_scope()] } else { Vec::new() },
        progress,
        state,
    };
    catalog
        .finish_scan(
            operation.id,
            &observation,
            |location| DiskProbe.root_identity(location),
            grouping,
        )
        .await
        .unwrap()
}

pub async fn raw(db: &Path) -> sqlx::sqlite::SqliteConnection {
    use sqlx::Connection;
    let options = sqlx::sqlite::SqliteConnectOptions::new().filename(db);
    sqlx::sqlite::SqliteConnection::connect_with(&options).await.unwrap()
}

/// Rows of `table` with a trailing filter in rowid order, each value quoted by
/// SQLite.
pub async fn dump_where(db: &Path, table: &str, filter: &str) -> Vec<String> {
    use sqlx::Connection;
    let mut conn = raw(db).await;
    let columns: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT name FROM pragma_table_info('{table}')"
    )))
    .fetch_all(&mut conn)
    .await
    .unwrap();
    let quoted = columns.iter().map(|column| format!("quote(\"{column}\")")).collect::<Vec<_>>();
    let values: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT {} FROM {table} {filter} ORDER BY rowid",
        quoted.join(" || '|' || ")
    )))
    .fetch_all(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();
    values
}

/// Every row of `tables` in rowid order, each value quoted by SQLite.
pub async fn dump_tables(db: &Path, tables: &[&str]) -> BTreeMap<String, Vec<String>> {
    let mut rows = BTreeMap::new();
    for table in tables {
        rows.insert((*table).to_owned(), dump_where(db, table, "").await);
    }
    rows
}

/// A registered location below the fixture's temporary folder.
pub async fn location_at(
    catalog: &Catalog,
    fx: &Fixture,
    name: &str,
    role: LocationRole,
) -> (Location, PathBuf) {
    let root = fx.temp.path().join(name);
    std::fs::create_dir_all(&root).unwrap();
    let location = catalog
        .register_location(&LocationRegistration {
            name: name.into(),
            path: NativePath::from_path(&root),
            role,
            identity: folder_identity(&root).unwrap(),
            volume_kind: platevault_model::VolumeKind::Local,
        })
        .await
        .unwrap();
    (location, root)
}

/// Write `relative` below `root` with bytes unique to its path, and return its
/// scan record carrying `metadata`.
pub fn frame(root: &Path, relative: &str, metadata: CaptureMetadata) -> ScanFile {
    let path = root.join(relative);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    if !path.exists() {
        std::fs::write(&path, relative.as_bytes()).unwrap();
    }
    ScanFile {
        relative_path: NativePath::from_path(Path::new(relative)),
        fingerprint: file_fingerprint(&path).unwrap(),
        format: if Path::new(relative)
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("xisf"))
        {
            ImageFormat::Xisf
        } else {
            ImageFormat::Fits
        },
        metadata,
    }
}

/// Scan `files` into `location` with [`group_by_night`].
pub async fn scan_frames(catalog: &Catalog, location: &Location, files: Vec<ScanFile>) {
    scan_files(catalog, location, files, Vec::new(), ScanState::Completed, group_by_night).await;
}

/// A `capture-v1`-shaped grouping by frame type, night, filter, exposure and
/// camera, so each night of the same settings is its own session.
pub fn group_by_night(assets: &[Asset]) -> GroupingResult {
    let mut sessions: BTreeMap<String, Vec<Uuid>> = BTreeMap::new();
    for asset in assets {
        let m = &asset.effective;
        let night = m.date_local.as_deref().map(|date| date.get(..10).unwrap_or(date).to_owned());
        let key = format!(
            "capture-v1|type={}|night={}@date-loc-noon|filter={}|exposure_s={}|camera={}",
            m.image_type.as_deref().unwrap_or("?").to_lowercase(),
            night.unwrap_or_default(),
            m.filter.as_deref().unwrap_or("?"),
            m.exposure_seconds.map(|v| v.to_string()).unwrap_or_default(),
            m.camera.as_deref().unwrap_or("?"),
        );
        sessions.entry(key).or_default().push(asset.id);
    }
    GroupingResult {
        sessions: sessions
            .into_iter()
            .map(|(key, mut asset_ids)| {
                asset_ids.sort_unstable();
                SessionCandidate {
                    key: CaptureKey(key),
                    asset_ids,
                    provisional: Vec::new(),
                    date_basis: Some("date-loc-noon".into()),
                    framing: None,
                }
            })
            .collect(),
    }
}

/// Quickstart capture metadata: ASI2600MM, gain 100, offset 50, 6248 x 4176,
/// binning 1, -10 C, on the night of `night` (YYYY-MM-DD).
pub fn calibration_frame(
    image_type: &str,
    filter: Option<&str>,
    exposure: f64,
    night: &str,
) -> CaptureMetadata {
    CaptureMetadata {
        image_type: Some(image_type.into()),
        filter: filter.map(str::to_owned),
        exposure_seconds: Some(exposure),
        camera: Some("ASI2600MM".into()),
        gain: Some(100.0),
        offset: Some(50),
        width: Some(6248),
        height: Some(4176),
        binning_x: Some(1),
        binning_y: Some(1),
        set_temperature_c: Some(-10.0),
        date_local: Some(format!("{night}T22:00:00")),
        ..CaptureMetadata::default()
    }
}

/// [`calibration_frame`] with the `RedCat 51` optical-train headers.
pub fn with_train(mut metadata: CaptureMetadata) -> CaptureMetadata {
    metadata.telescope = Some("RedCat 51".into());
    metadata.focal_length_mm = Some(250.0);
    metadata
}

/// A small behavioral rule set for catalog tests: kinds by IMAGETYP, masters by
/// a count above 1 or a `MASTER` IMAGETYP and a handful of exact criteria.
#[derive(Clone, Copy, Default)]
pub struct TestRules;

fn test_row(
    criterion: CriterionId,
    light: &CaptureEvidence,
    input: &CaptureEvidence,
    field: EvidenceField,
) -> CriterionResult {
    let (l, i) = (light.get(field), input.get(field));
    let verdict = match (l, i) {
        (Some(l), Some(i)) if l.value == i.value => Verdict::Compatible,
        (Some(_), Some(_)) => Verdict::Incompatible,
        _ => Verdict::Unknown,
    };
    CriterionResult {
        criterion,
        verdict,
        light_value: l.map(|v| v.value.clone()),
        input_value: i.map(|v| v.value.clone()),
        light_source: l.map(|v| v.source.clone()),
        input_source: i.map(|v| v.source.clone()),
        tolerance: Tolerance::None,
        note: None,
    }
}

impl CalibrationRules for TestRules {
    fn classify(
        &self,
        effective: &CaptureMetadata,
        _relative_path: &NativePath,
    ) -> Option<Classification> {
        let image_type = effective.image_type.as_deref()?.trim().to_ascii_uppercase();
        let master = match effective.stack_count {
            Some(count) => (count > 1).then_some(MasterBasis::HeaderStackCount),
            None => image_type.contains("MASTER").then_some(MasterBasis::HeaderImagetyp),
        };
        let kind = match image_type.replace("MASTER", "").trim() {
            "DARK" => InputKind::Dark,
            "FLAT" => InputKind::Flat,
            "BIAS" | "OFFSET" => InputKind::Bias,
            _ => return None,
        };
        Some(Classification {
            kind,
            master: master.map(|basis| MasterEvidence {
                basis,
                stack_count: effective.stack_count,
                detector: "test".into(),
            }),
        })
    }

    fn evaluate(
        &self,
        kind: InputKind,
        light: &LightEvidence,
        input: &InputEvidence,
    ) -> Evaluation {
        let (l, i) = (&light.capture, &input.capture);
        let mut criteria = vec![
            CriterionResult {
                verdict: if input.kind == kind {
                    Verdict::Compatible
                } else {
                    Verdict::Incompatible
                },
                ..test_row(CriterionId::ImageType, l, i, EvidenceField::ImageType)
            },
            test_row(CriterionId::Camera, l, i, EvidenceField::Camera),
            test_row(CriterionId::Gain, l, i, EvidenceField::Gain),
        ];
        match kind {
            InputKind::Dark => {
                criteria.push(test_row(CriterionId::Exposure, l, i, EvidenceField::Exposure));
            }
            InputKind::Flat => {
                criteria.push(test_row(CriterionId::Channel, l, i, EvidenceField::Filter));
                let train = match (l.confirmed_equipment, i.confirmed_equipment) {
                    (Some(a), Some(b)) if a == b => CriterionResult {
                        verdict: Verdict::Compatible,
                        ..test_row(CriterionId::OpticalTrain, l, i, EvidenceField::Telescope)
                    },
                    _ => test_row(CriterionId::OpticalTrain, l, i, EvidenceField::Telescope),
                };
                criteria.push(train);
            }
            InputKind::Bias => {}
        }
        Evaluation::new(criteria, Vec::new())
    }

    /// Each input of the kind the test criteria don't refuse, in input
    /// order: pinnable when every criterion is compatible. The ranking and
    /// window rules are the product's (core); these tests cover the
    /// catalog's writes.
    fn match_session(
        &self,
        kind: InputKind,
        light: &SessionLight,
        inputs: &[SessionInput],
        _settings: &WorkflowSettings,
    ) -> KindMatch {
        let lights = LightEvidence {
            session_id: light.session_id,
            grouping_revision: 0,
            capture: light.capture.clone(),
        };
        let offers = inputs
            .iter()
            .filter(|input| input.kind == kind)
            .filter_map(|input| {
                let evidence = InputEvidence {
                    kind: input.kind,
                    form: input.input.form(),
                    capture: input.capture.clone(),
                };
                let evaluation = self.evaluate(kind, &lights, &evidence);
                let cautions = match evaluation.verdict {
                    Verdict::Incompatible => return None,
                    Verdict::Unknown => {
                        vec![MatchCaution::CriterionUnknown { criteria: evaluation.blocking() }]
                    }
                    Verdict::Compatible => Vec::new(),
                };
                let target = PinTarget {
                    input: input.input,
                    captured: input.captured,
                    files: input.files.clone(),
                    evaluation,
                };
                Some(MatchOffer { target, cautions })
            })
            .collect();
        KindMatch { kind, offers }
    }
}
