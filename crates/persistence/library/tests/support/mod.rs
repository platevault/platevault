// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared file-backed catalog fixture: real files under a temporary root, a real
//! no-follow probe of their metadata and a simple behavioral grouping.
#![allow(dead_code)]

use std::collections::{BTreeMap, BTreeSet};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use parking_lot::Mutex;
use persistence_library::{Catalog, LocationRegistration, SourceProbe};
use platevault_model::{
    Asset, CalibrationRules, CalibrationViewBasis, CalibrationViewPlan, CandidateEvaluation,
    CaptureEvidence, CaptureKey, CaptureMetadata, Classification, CriterionId, CriterionResult,
    EffectiveDecision, Evaluation, EvidenceField, ExpectedAsset, ExpectedSession, FileIdentity,
    GroupingResult, ImageFormat, InputEvidence, InputKind, LibraryError, LightEvidence, Location,
    LocationRole, MasterBasis, MasterEvidence, NativePath, ObservationFingerprint, PathSensitivity,
    Provenance, Requirement, RequirementState, Resolution, ScanBatch, ScanFile, ScanIssue,
    ScanObservation, ScanOperation, ScanProgress, ScanState, Session, SessionCandidate,
    TargetAlias, TargetCandidate, Tolerance, UnresolvedReason, Verdict, VolumeIdentity,
};
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub fn volume() -> VolumeIdentity {
    VolumeIdentity {
        filesystem: "apfs".into(),
        stable_id: Some("0F1E2D3C-test-volume".into()),
        file_ids_stable: true,
        case: PathSensitivity::Sensitive,
        normalization: PathSensitivity::Sensitive,
    }
}

pub fn io_error(path: &Path, error: &std::io::Error) -> LibraryError {
    LibraryError::from_io(path, error)
}

pub fn file_fingerprint(path: &Path) -> Result<ObservationFingerprint, LibraryError> {
    let metadata = std::fs::symlink_metadata(path).map_err(|error| io_error(path, &error))?;
    if !metadata.file_type().is_file() {
        return Err(LibraryError::InvalidInput("not a regular file".into()));
    }
    let modified = metadata.modified().map_err(|error| io_error(path, &error))?;
    let modified_ns =
        i128::try_from(modified.duration_since(UNIX_EPOCH).unwrap().as_nanos()).unwrap();
    Ok(ObservationFingerprint {
        identity: FileIdentity { volume: volume(), file_id: Some(metadata.ino().to_string()) },
        size_bytes: metadata.len(),
        modified_ns,
        content_sha256: None,
    })
}

pub fn folder_identity(path: &Path) -> Result<FileIdentity, LibraryError> {
    let metadata = std::fs::symlink_metadata(path).map_err(|error| io_error(path, &error))?;
    if !metadata.is_dir() {
        return Err(LibraryError::IdentityConflict("root is not a folder".into()));
    }
    Ok(FileIdentity { volume: volume(), file_id: Some(metadata.ino().to_string()) })
}

/// Real no-follow probe of the fixture volume.
#[derive(Clone)]
pub struct DiskProbe;

impl SourceProbe for DiskProbe {
    fn fingerprint(&self, path: &Path) -> Result<ObservationFingerprint, LibraryError> {
        file_fingerprint(path)
    }
    fn root_identity(&self, location: &Location) -> Result<FileIdentity, LibraryError> {
        folder_identity(&location.path.to_path_buf()?)
    }
}

/// Simple behavioral grouping: frame type, filter, exposure and camera.
pub fn group(assets: &[Asset]) -> GroupingResult {
    let mut sessions: BTreeMap<String, Vec<Uuid>> = BTreeMap::new();
    for asset in assets {
        let m = &asset.effective;
        let key =
            format!("{:?}|{:?}|{:?}|{:?}", m.image_type, m.filter, m.exposure_seconds, m.camera);
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
                    date_basis: Some("2026-09-12".into()),
                }
            })
            .collect(),
    }
}

/// Header metadata of a fixture frame named by its path: OIII or Ha, a DARK
/// frame type for `Dark` names and an unknown frame type for `Unknown` names.
pub fn metadata_for(relative: &str) -> CaptureMetadata {
    let filter = if relative.contains("OIII") { "OIII" } else { "Ha" };
    let image_type = if relative.contains("Unknown") {
        None
    } else {
        Some(if relative.contains("Dark") { "DARK" } else { "LIGHT" }.into())
    };
    CaptureMetadata {
        image_type,
        filter: Some(filter.into()),
        exposure_seconds: Some(300.0),
        camera: Some("ASI2600MM".into()),
        date_local: Some("2026-09-12T23:00:00".into()),
        ..CaptureMetadata::default()
    }
}

pub fn sha_of(path: &Path) -> String {
    hex::encode(Sha256::digest(std::fs::read(path).unwrap()))
}

/// Names, sizes and SHA-256 of every file below `root`.
pub fn tree(root: &Path) -> BTreeMap<PathBuf, (u64, String)> {
    let mut files = BTreeMap::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                pending.push(path);
            } else {
                let size = std::fs::metadata(&path).unwrap().len();
                files.insert(path.strip_prefix(root).unwrap().to_path_buf(), (size, sha_of(&path)));
            }
        }
    }
    files
}

pub struct Fixture {
    pub temp: tempfile::TempDir,
    pub db: PathBuf,
    pub root: PathBuf,
}

impl Fixture {
    pub fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("Astro-T7").join("Captures");
        std::fs::create_dir_all(&root).unwrap();
        Self { db: temp.path().join("catalog.sqlite"), root, temp }
    }
    pub fn write(&self, relative: &str, bytes: &[u8]) {
        let path = self.root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }
    pub fn registration(&self) -> LocationRegistration {
        LocationRegistration {
            name: "Astro-T7/Captures".into(),
            path: NativePath::from_path(&self.root),
            role: LocationRole::Captures,
            identity: folder_identity(&self.root).unwrap(),
        }
    }
    pub fn scan_file(&self, relative: &str) -> ScanFile {
        ScanFile {
            relative_path: NativePath::from_path(Path::new(relative)),
            fingerprint: file_fingerprint(&self.root.join(relative)).unwrap(),
            format: ImageFormat::Fits,
            metadata: metadata_for(relative),
        }
    }
}

pub fn root_scope() -> NativePath {
    NativePath::UnixBytes(Vec::new())
}

pub fn kind(error: &LibraryError) -> String {
    error.response(None, None).kind
}

pub fn expected(asset: &Asset) -> ExpectedAsset {
    ExpectedAsset {
        asset_id: asset.id,
        decision_revision: asset.decision_revision,
        fingerprint: asset.fingerprint.clone(),
    }
}

pub fn expected_session(session: &Session) -> ExpectedSession {
    ExpectedSession {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        decision_revision: session.decision_revision,
    }
}

pub fn target(designation: &str, alias: &str) -> TargetCandidate {
    TargetCandidate {
        id: Uuid::new_v4(),
        designation: designation.into(),
        aliases: vec![TargetAlias {
            text: designation.into(),
            normalized: alias.into(),
            kind: "designation".into(),
            provenance: Provenance::User,
        }],
        common_name: None,
        object_type: "nebula".into(),
        coordinates: Some(platevault_model::SkyCoordinates {
            ra_deg: 314.75,
            dec_deg: 44.33,
            frame: "ICRS".into(),
        }),
        provenance: Provenance::User,
        provider_id: None,
    }
}

pub async fn scan_with(
    catalog: &Catalog,
    fx: &Fixture,
    location: &Location,
    files: &[&str],
    issues: Vec<ScanIssue>,
    state: ScanState,
) -> ScanOperation {
    let files: Vec<ScanFile> = files.iter().map(|relative| fx.scan_file(relative)).collect();
    scan_files(catalog, location, files, issues, state, group).await
}

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

pub async fn scan(
    catalog: &Catalog,
    fx: &Fixture,
    location: &Location,
    files: &[&str],
) -> ScanOperation {
    scan_with(catalog, fx, location, files, Vec::new(), ScanState::Completed).await
}

pub fn by_name<'a>(assets: &'a [Asset], name: &str) -> &'a Asset {
    assets.iter().find(|asset| asset.relative_path.display().ends_with(name)).unwrap()
}

pub async fn raw(db: &Path) -> sqlx::sqlite::SqliteConnection {
    use sqlx::Connection;
    let options = sqlx::sqlite::SqliteConnectOptions::new().filename(db);
    sqlx::sqlite::SqliteConnection::connect_with(&options).await.unwrap()
}

/// Rows of `select` (a query over `table` with a trailing filter) in rowid
/// order, each value quoted by SQLite.
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

// ---------------------------------------------------------------------------
// Calibration fixtures (spec 068)
// ---------------------------------------------------------------------------

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
/// a count above 1 or a `MASTER` IMAGETYP, a handful of exact criteria and a
/// plan that preselects the first available compatible reusable candidate. It
/// records every basis it is given.
#[derive(Clone, Default)]
pub struct TestRules {
    pub seen: Arc<Mutex<Vec<CalibrationViewBasis>>>,
}

impl TestRules {
    pub fn last_basis(&self) -> CalibrationViewBasis {
        self.seen.lock().last().cloned().expect("plan was called")
    }
}

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

fn verdict_rank(verdict: Verdict) -> u8 {
    match verdict {
        Verdict::Compatible => 0,
        Verdict::Unknown => 1,
        Verdict::Incompatible => 2,
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

    fn plan(&self, basis: &CalibrationViewBasis) -> CalibrationViewPlan {
        self.seen.lock().push(basis.clone());
        let mut requirements = Vec::new();
        for light in basis.lights.iter().filter(|light| !light.product) {
            for &kind in &basis.plan.required_kinds {
                requirements.push(test_requirement(self, basis, light, kind));
            }
        }
        CalibrationViewPlan {
            view_id: basis.view_id,
            view_revision: basis.view_revision,
            plan_revision: basis.plan.revision,
            required_kinds: basis.plan.required_kinds.clone(),
            requirements,
        }
    }
}

fn test_requirement(
    rules: &TestRules,
    basis: &CalibrationViewBasis,
    light: &platevault_model::LightBasis,
    kind: InputKind,
) -> Requirement {
    let session = &light.evidence;
    let mut requirement = Requirement {
        light_session_id: session.session_id,
        grouping_revision: session.grouping_revision,
        kind,
        state: RequirementState::Unresolved,
        reason: None,
        preselected: None,
        candidates: Vec::new(),
        unadopted: Vec::new(),
        effective: None,
    };
    if !light.light_type_known {
        requirement.reason = Some(UnresolvedReason::LightTypeUnknown);
        return requirement;
    }
    for candidate in basis.candidates.iter().filter(|c| c.evidence.kind == kind) {
        let evaluated = CandidateEvaluation {
            candidate: candidate.candidate,
            kind,
            evaluation: rules.evaluate(kind, session, &candidate.evidence),
            night_distance_days: None,
            state: candidate.state.clone(),
            preselected: false,
            master: candidate.master.clone(),
            origin: candidate.origin.clone(),
        };
        if candidate.candidate.input().is_some() {
            requirement.candidates.push(evaluated);
        } else {
            requirement.unadopted.push(evaluated);
        }
    }
    requirement.candidates.sort_by_key(|c| (verdict_rank(c.evaluation.verdict), c.candidate.id()));
    if let Some(first) = requirement
        .candidates
        .iter_mut()
        .find(|c| c.evaluation.verdict == Verdict::Compatible && c.state.available())
    {
        first.preselected = true;
        requirement.preselected = Some(first.candidate);
    }
    let decision = basis.decisions.iter().find(|d| {
        d.light_session_id == session.session_id
            && d.kind == kind
            && d.resolution != Resolution::Withdrawn
    });
    if let Some(decision) = decision {
        let verdicts = |rows: &[CriterionResult]| -> BTreeSet<(CriterionId, Verdict)> {
            rows.iter().map(|row| (row.criterion, row.verdict)).collect()
        };
        let input = decision.input.map(platevault_model::CandidateRef::from);
        let current = basis.candidates.iter().find(|c| Some(c.candidate) == input);
        let blocked = if decision.light_asset_ids == light.included_assets {
            match current {
                None => Some(UnresolvedReason::InputUnavailable),
                Some(c)
                    if c.state.superseded
                        || verdicts(&rules.evaluate(kind, session, &c.evidence).criteria)
                            != verdicts(&decision.criteria) =>
                {
                    Some(UnresolvedReason::InputEvidenceChanged)
                }
                Some(_) => None,
            }
        } else {
            Some(UnresolvedReason::LightMembershipChanged)
        };
        requirement.effective = Some(EffectiveDecision {
            decision: decision.clone(),
            decided_at_revision: decision.view_revision,
            applicable: blocked.is_none(),
        });
        match blocked {
            None if decision.resolution == Resolution::Accepted => {
                requirement.state = RequirementState::Accepted;
            }
            None => requirement.state = RequirementState::Excepted,
            Some(reason) => requirement.reason = Some(reason),
        }
        return requirement;
    }
    if requirement.preselected.is_some() {
        requirement.state = RequirementState::Suggested;
        return requirement;
    }
    let has = |verdict| requirement.candidates.iter().any(|c| c.evaluation.verdict == verdict);
    requirement.reason = Some(if requirement.candidates.is_empty() {
        UnresolvedReason::NoCandidate
    } else if has(Verdict::Compatible) {
        UnresolvedReason::InputUnavailable
    } else if has(Verdict::Unknown) {
        UnresolvedReason::CriterionUnknown
    } else {
        UnresolvedReason::CriterionIncompatible
    });
    requirement
}
