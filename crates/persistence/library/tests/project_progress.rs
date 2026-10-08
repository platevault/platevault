// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project goal progress (spec 065: PRJ-FR-03, PRJ-FR-04, PRJ-FR-21, PRJ-AC-01,
//! PRJ-AC-03, PRJ-AC-07, PRJ-AC-08, PRJ-AC-26, PRJ-AC-29; root FR-019, FR-023;
//! D-W36, D-W44, D-W45, D-W66, D-W72). "in project" counts the latest saved
//! membership of each run outside the Project's Trash, each content-identical
//! frame once, minus run exclusions, Project-only rejects, Trashed frames,
//! drifted frames and frames the quality bar does not admit. "captured" counts
//! the candidates plus those runs' members, Trashed frames aside, so "in
//! project" never exceeds "captured". Fixture files are real and only read,
//! except where a scenario rewrites or trashes one.
#![cfg(unix)]

mod support;

use std::path::Path;

use persistence_library::{
    Catalog, LocationRegistration, ProgressBasis, SessionQuery, SourceProbe, TrashedFrame,
};
use platevault_model::{
    reasons, Asset, AssociationState, DecodedBasis, DraftEdit, Equipment, GoalInput, GoalProgress,
    GoalSpec, GoalTally, ImageFormat, InputBasis, Location, LocationRole, MaskCounts,
    MeasurementMethod, MeasurementOutcome, MeasurementRecord, MemberState, MetricId, MetricValue,
    Microseconds, NativePath, NewView, PlaneBasis, Project, ProjectInput, ProjectState, Provenance,
    Quality, QualityCriterion, RejectionMark, RunState, SampleFormat, SaturationBasis,
    SaturationSource, Scaling, ScanFile, ScanObservation, ScanProgress, ScanState, Session,
    SubjectInput, TargetRecord, Units, VolumeKind,
};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::Connection;
use support::*;
use uuid::Uuid;

const HA: [&str; 4] = ["Ha_001.fits", "Ha_002.fits", "Ha_003.fits", "Ha_004.fits"];
const OIII: [&str; 2] = ["OIII_001.fits", "OIII_002.fits"];

/// The built-in method whose valid records a median-FWHM bar reads.
fn method() -> MeasurementMethod {
    MeasurementMethod::new("platevault.stars", 1)
}

fn rig() -> Equipment {
    Equipment {
        id: Uuid::new_v4(),
        name: "RedCat 51".into(),
        camera: Some("ASI2600MM".into()),
        telescope: Some("RedCat 51".into()),
        focal_length_mm: Some(250.0),
        pixel_size_um: Some(3.76),
        sensor_width_px: None,
        sensor_height_px: None,
        color_kind: None,
        decision_revision: 0,
        state: AssociationState::Confirmed,
        provenance: Provenance::User,
    }
}

fn seconds(value: u64) -> Microseconds {
    Microseconds::from_whole_seconds(value).unwrap()
}

/// `frames` light frames of 300 s each with known exposure and image type.
fn frames(frames: u64) -> GoalTally {
    GoalTally { frames, seconds: seconds(frames * 300), ..GoalTally::default() }
}

fn integration(target: Uuid, channel: &str, goal_seconds: u64) -> GoalInput {
    GoalInput {
        target_id: target,
        panel: None,
        goal: GoalSpec::Integration { channel: Some(channel.into()), goal_seconds },
    }
}

fn frame_count(target: Uuid, channel: &str, goal_frames: u64) -> GoalInput {
    GoalInput {
        target_id: target,
        panel: None,
        goal: GoalSpec::FrameCount { channel: Some(channel.into()), goal_frames },
    }
}

fn bar(target: Uuid, criterion: QualityCriterion) -> GoalInput {
    GoalInput { target_id: target, panel: None, goal: GoalSpec::QualityBar { criterion } }
}

struct World {
    fx: Fixture,
    catalog: Catalog,
    location: Location,
    /// A second Captures location holding byte-identical copies, when asked.
    backup: Option<Location>,
    ngc: TargetRecord,
    m81: TargetRecord,
    redcat: Equipment,
}

/// Four Ha and two OIII frames of NGC 7000 on the `RedCat`, one session per
/// filter, both confirmed. `extra` files are written and scanned with them;
/// each of `copies` is copied byte for byte to a NAS location, scanned first.
async fn world(extra: &[(&str, &str)], copies: &[&str]) -> World {
    let fx = Fixture::new();
    let mut names: Vec<&str> = HA.iter().chain(OIII.iter()).copied().collect();
    for name in &names {
        fx.write(name, format!("frame {name}").as_bytes());
    }
    for (name, bytes) in extra {
        fx.write(name, bytes.as_bytes());
        names.push(name);
    }
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &names).await;
    let backup = if copies.is_empty() {
        None
    } else {
        let nas = fx.temp.path().join("NAS");
        std::fs::create_dir_all(&nas).unwrap();
        for name in copies {
            std::fs::copy(fx.root.join(name), nas.join(name)).unwrap();
        }
        let registration = LocationRegistration {
            name: "NAS".into(),
            path: NativePath::from_path(&nas),
            role: LocationRole::Captures,
            identity: folder_identity(&nas).unwrap(),
            volume_kind: VolumeKind::Local,
        };
        let backup = catalog.register_location(&registration).await.unwrap();
        scan_copies(&catalog, &backup, &nas, copies).await;
        Some(backup)
    };
    let ngc = catalog.save_target(&target("NGC 7000", "ngc 7000"), None).await.unwrap();
    let m81 = catalog.save_target(&target("M 81", "m 81"), None).await.unwrap();
    let redcat = catalog.save_equipment(&rig(), None).await.unwrap();
    let world = World { fx, catalog, location, backup, ngc, m81, redcat };
    for name in [HA[0], OIII[0]] {
        world.retarget(name, world.ngc.candidate.id).await;
        let session = world.session(name).await;
        world
            .catalog
            .confirm_equipment(&[expected_session(&session)], world.redcat.id)
            .await
            .unwrap();
    }
    world
}

/// A complete scan of the copies in a second location.
async fn scan_copies(catalog: &Catalog, location: &Location, root: &Path, names: &[&str]) {
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let files = names
        .iter()
        .map(|name| ScanFile {
            relative_path: NativePath::from_path(Path::new(name)),
            fingerprint: file_fingerprint(&root.join(name)).unwrap(),
            format: ImageFormat::Fits,
            metadata: metadata_for(name),
        })
        .collect();
    let observation = ScanObservation {
        location_id: location.id,
        root_identity: folder_identity(root).unwrap(),
        files,
        issues: Vec::new(),
        complete_scopes: vec![root_scope()],
        incomplete_scopes: Vec::new(),
        progress: ScanProgress::default(),
        state: ScanState::Completed,
    };
    catalog
        .finish_scan(
            operation.id,
            &observation,
            |location| DiskProbe.root_identity(location),
            group,
        )
        .await
        .unwrap();
}

impl World {
    async fn asset(&self, name: &str) -> Asset {
        by_name(&self.catalog.location_assets(self.location.id).await.unwrap(), name).clone()
    }

    async fn session(&self, name: &str) -> Session {
        let asset = self.asset(name).await.id;
        let summaries = self.catalog.list_sessions(&SessionQuery::default()).await.unwrap();
        summaries.into_iter().map(|s| s.session).find(|s| s.asset_ids.contains(&asset)).unwrap()
    }

    /// Confirm the Target of the session holding `name`.
    async fn retarget(&self, name: &str, target: Uuid) {
        let session = self.session(name).await;
        self.catalog.associate_target(&[expected_session(&session)], target).await.unwrap();
    }

    async fn project(&self, goals: Vec<GoalInput>) -> Project {
        let input = ProjectInput {
            name: "NGC 7000 HOO".into(),
            notes: None,
            subjects: vec![SubjectInput {
                target_id: self.ngc.candidate.id,
                name: None,
                mosaic: false,
                panels: Vec::new(),
            }],
            rig_ids: vec![self.redcat.id],
            goals,
        };
        self.catalog.create_project(&input).await.unwrap()
    }

    /// A run on the subject and rig, starting with every candidate selected,
    /// with `edits` applied to its first draft before Save.
    async fn saved_run(&self, project: &Project, name: &str, edits: &[DraftEdit]) -> Uuid {
        let input = NewView {
            project_id: project.id,
            subject_id: project.subjects[0].id,
            rig_id: self.redcat.id,
            name: name.into(),
        };
        let id = self.catalog.create_view(&input).await.unwrap().view.id;
        let mut draft = 1;
        for edit in edits {
            self.catalog.edit_view_draft(id, draft, edit).await.unwrap();
            draft += 1;
        }
        self.catalog.save_view(id, 0, draft).await.unwrap();
        id
    }

    async fn exclude(&self, name: &str) -> DraftEdit {
        DraftEdit::SetFrames {
            member_keys: vec![self.asset(name).await.id],
            state: MemberState::Excluded,
        }
    }

    async fn reject_for_project(&self, project: Uuid, name: &str) {
        let asset = self.asset(name).await;
        let mark = RejectionMark {
            asset_id: asset.id,
            fingerprint: asset.fingerprint.clone(),
            expected_revision: 0,
            rejected: true,
        };
        self.catalog.set_project_rejection(project, &[mark]).await.unwrap();
    }

    /// Move one frame to the fixture's OS Trash and record it Trashed.
    async fn trash(&self, name: &str) {
        let asset = self.asset(name).await;
        let source = self.fx.root.join(name);
        let sha256 = sha_of(&source);
        let bin = self.fx.temp.path().join("Trash");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::rename(&source, bin.join(name)).unwrap();
        let frame = TrashedFrame { asset_id: asset.id, sha256, complete_view_ids: Vec::new() };
        self.catalog.record_trashed(Uuid::new_v4(), &[frame]).await.unwrap();
    }

    async fn set_quality(&self, name: &str, quality: Quality) {
        let asset = self.asset(name).await;
        self.catalog.set_quality(&[expected(&asset)], quality, DiskProbe).await.unwrap();
    }

    async fn progress(&self, project: Uuid) -> ProgressBasis {
        self.catalog.project_progress_basis(project, &method()).await.unwrap()
    }

    /// Run SQL a later unit's write owns (U16 Move to Trash and Restore) directly.
    async fn raw_sql(mut self, statement: &str) -> Self {
        self.catalog.close().await.unwrap();
        let mut conn =
            SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&self.fx.db))
                .await
                .unwrap();
        sqlx::query(sqlx::AssertSqlSafe(statement.to_owned())).execute(&mut conn).await.unwrap();
        conn.close().await.unwrap();
        self.catalog = Catalog::open(&self.fx.db).await.unwrap();
        self
    }
}

fn goal<'a>(basis: &'a ProgressBasis, channel: &str) -> &'a GoalProgress {
    basis.goals.iter().find(|progress| progress.goal.goal.channel() == Some(channel)).unwrap()
}

/// FR-023: no goal ever shows "in project" above "captured".
fn assert_never_exceeds(basis: &ProgressBasis) {
    for progress in &basis.goals {
        let (inside, all) = (&progress.in_project, &progress.captured);
        assert!(inside.frames <= all.frames, "{progress:#?}");
        assert!(inside.seconds <= all.seconds, "{progress:#?}");
        assert!(inside.unknown_exposure_frames <= all.unknown_exposure_frames, "{progress:#?}");
        assert!(inside.unknown_image_type_frames <= all.unknown_image_type_frames, "{progress:#?}");
    }
}

/// A measurement record of `asset` on its current bytes: a median FWHM, an
/// unavailable one (`None`), or a failed frame.
fn record(
    asset: &Asset,
    path: &Path,
    run: Uuid,
    sequence: u64,
    fwhm: Option<f64>,
    failed: bool,
) -> MeasurementRecord {
    let method = method();
    let mut fingerprint = asset.fingerprint.clone();
    fingerprint.content_sha256 = Some(sha_of(path));
    let outcome = if failed {
        MeasurementOutcome::Failed {
            reason: reasons::UNSUPPORTED_FORMAT.into(),
            message: "FITS tile compression".into(),
        }
    } else {
        let value = match fwhm {
            Some(value) => MetricValue::measured(MetricId::FwhmMedian, Units::Px, value, &method),
            None => MetricValue::unavailable(
                MetricId::FwhmMedian,
                Units::Px,
                reasons::NO_FITTED_STARS,
                &method,
            ),
        };
        MeasurementOutcome::Measured {
            metrics: vec![value],
            stars: Vec::new(),
            masks: MaskCounts::default(),
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
        measured_at: "2026-10-07T10:00:00Z".into(),
    }
}

/// PRJ-FR-04, D-W44, root FR-019: the latest saved membership counts, an unsaved
/// draft does not; the run's exclusion, the Project-only reject and the Trashed
/// frame leave "in project", and only the Trashed one leaves "captured".
#[tokio::test]
async fn in_project_counts_saved_memberships_minus_exclusions_rejects_trashed() {
    let world = world(&[], &[]).await;
    let ngc = world.ngc.candidate.id;
    let project = world.project(vec![integration(ngc, "Ha", 3600)]).await;
    let before = world.progress(project.id).await;
    assert_eq!(goal(&before, "Ha").in_project, GoalTally::default(), "no run, nothing in project");
    assert_eq!(goal(&before, "Ha").captured, frames(4), "every candidate frame is captured");

    let run = world.saved_run(&project, "HOO", &[world.exclude(HA[0]).await]).await;
    world.reject_for_project(project.id, HA[1]).await;
    world.trash(HA[2]).await;
    let progress = world.progress(project.id).await;
    let ha = goal(&progress, "Ha");
    assert_eq!(ha.in_project, frames(1), "only Ha_004 is left in project");
    assert_eq!(ha.captured, frames(3), "the excluded and rejected frames are still captured");
    assert_eq!((progress.project_id, progress.revision), (project.id, project.revision));

    // A draft is no saved membership.
    world.catalog.edit_view_draft(run, 0, &world.exclude(HA[3]).await).await.unwrap();
    assert_eq!(goal(&world.progress(project.id).await, "Ha").in_project, frames(1));
    world.catalog.close().await.unwrap();
}

/// D-W66, D-W72, PRJ-AC-29: "captured" is the candidates plus the members of
/// the runs outside the Project's Trash. A trashed run's members count in
/// neither unless they are still candidates, and count again after Restore.
#[tokio::test]
async fn captured_is_candidates_plus_members() {
    let world = world(&[], &[]).await;
    let ngc = world.ngc.candidate.id;
    let project = world.project(vec![frame_count(ngc, "OIII", 2)]).await;
    let oiii = world.session(OIII[0]).await.id;
    let deselect = DraftEdit::DeselectSessions { session_ids: vec![oiii] };
    world.saved_run(&project, "Ha-only", &[deselect]).await;
    let progress = world.progress(project.id).await;
    let row = goal(&progress, "OIII");
    assert_eq!(
        (row.in_project.frames, row.captured.frames),
        (0, 2),
        "a candidate only is captured"
    );

    let hoo = world.saved_run(&project, "HOO", &[]).await;
    let progress = world.progress(project.id).await;
    assert_eq!(
        (goal(&progress, "OIII").in_project.frames, goal(&progress, "OIII").captured.frames),
        (2, 2)
    );

    let world = world
        .raw_sql(&format!(
            "UPDATE views SET trashed_at = '2026-10-07T12:00:00Z' WHERE id = '{hoo}'"
        ))
        .await;
    let progress = world.progress(project.id).await;
    let row = goal(&progress, "OIII");
    assert_eq!((row.in_project.frames, row.captured.frames), (0, 2), "still candidates");

    // Re-confirmed elsewhere and only held by the trashed run: in neither.
    world.retarget(OIII[0], world.m81.candidate.id).await;
    let progress = world.progress(project.id).await;
    assert_eq!(goal(&progress, "OIII").captured, GoalTally::default());

    let world =
        world.raw_sql(&format!("UPDATE views SET trashed_at = NULL WHERE id = '{hoo}'")).await;
    let progress = world.progress(project.id).await;
    let row = goal(&progress, "OIII");
    assert_eq!((row.in_project.frames, row.captured.frames), (2, 2), "Restore counts them again");
    world.catalog.close().await.unwrap();
}

/// FR-023, PRJ-FR-21: whatever runs, rejects, re-confirmations, Trashed frames,
/// trashed runs and bars hold, no goal shows "in project" above "captured".
#[tokio::test]
async fn in_project_never_exceeds_captured() {
    let world = world(&[], &[]).await;
    let ngc = world.ngc.candidate.id;
    let project = world
        .project(vec![
            integration(ngc, "Ha", 3600),
            frame_count(ngc, "OIII", 10),
            bar(ngc, QualityCriterion::UsableOnly),
        ])
        .await;
    assert_never_exceeds(&world.progress(project.id).await);
    let oiii = world.session(OIII[0]).await.id;
    let ha_only = world
        .saved_run(&project, "Ha-only", &[DraftEdit::DeselectSessions { session_ids: vec![oiii] }])
        .await;
    world.saved_run(&project, "HOO", &[world.exclude(HA[1]).await]).await;
    world.set_quality(HA[0], Quality::Usable).await;
    world.set_quality(OIII[1], Quality::Usable).await;
    assert_never_exceeds(&world.progress(project.id).await);
    world.reject_for_project(project.id, HA[0]).await;
    world.retarget(OIII[0], world.m81.candidate.id).await;
    assert_never_exceeds(&world.progress(project.id).await);
    world.trash(HA[2]).await;
    let world = world
        .raw_sql(&format!(
            "UPDATE views SET trashed_at = '2026-10-07T12:00:00Z' WHERE id = '{ha_only}'"
        ))
        .await;
    let progress = world.progress(project.id).await;
    assert_never_exceeds(&progress);
    assert_eq!(goal(&progress, "OIII").in_project.frames, 1, "the Usable OIII member");
    world.catalog.close().await.unwrap();
}

/// D-W45, PRJ-AC-26: a member whose Target is re-confirmed as another Target is
/// no longer a candidate, yet still counts "in project" and "captured".
#[tokio::test]
async fn reconfirmed_member_counts_in_both() {
    let world = world(&[], &[]).await;
    let ngc = world.ngc.candidate.id;
    let project = world.project(vec![integration(ngc, "Ha", 3600)]).await;
    world.saved_run(&project, "HOO", &[]).await;
    world.retarget(HA[0], world.m81.candidate.id).await;
    let ha = world.session(HA[0]).await.id;
    let candidates = world.catalog.project_candidates(project.id).await.unwrap();
    assert!(candidates.iter().all(|c| c.session_id != ha), "no longer a candidate");
    let progress = world.progress(project.id).await;
    assert_eq!(goal(&progress, "Ha").in_project, frames(4));
    assert_eq!(goal(&progress, "Ha").captured, frames(4));
    world.catalog.close().await.unwrap();
}

/// PRJ-AC-03, D-W36: a goal is met from "in project" only; captured frames
/// never meet it, and a met goal leaves the Project open.
#[tokio::test]
async fn goal_met_uses_in_project_only() {
    let world = world(&[], &[]).await;
    let ngc = world.ngc.candidate.id;
    let project =
        world.project(vec![integration(ngc, "Ha", 1200), frame_count(ngc, "OIII", 2)]).await;
    let progress = world.progress(project.id).await;
    let ha = goal(&progress, "Ha");
    assert_eq!(ha.captured, frames(4), "the captured frames would meet it");
    assert!(!ha.met && !goal(&progress, "OIII").met);

    let run = world.saved_run(&project, "HOO", &[world.exclude(HA[0]).await]).await;
    let progress = world.progress(project.id).await;
    let ha = goal(&progress, "Ha");
    assert_eq!((ha.in_project.seconds, ha.captured.seconds), (seconds(900), seconds(1200)));
    assert!(!ha.met, "900 s in project of 1200 s");
    assert!(goal(&progress, "OIII").met);

    let include = DraftEdit::SetFrames {
        member_keys: vec![world.asset(HA[0]).await.id],
        state: MemberState::Included,
    };
    world.catalog.edit_view_draft(run, 0, &include).await.unwrap();
    world.catalog.save_view(run, 1, 1).await.unwrap();
    let progress = world.progress(project.id).await;
    assert!(goal(&progress, "Ha").met, "1200 s in project");
    assert_eq!(world.catalog.project(project.id).await.unwrap().state, ProjectState::Open);
    world.catalog.close().await.unwrap();
}

/// PRJ-FR-03, PRJ-AC-07: a Usable-only bar admits only Usable members; a median
/// FWHM limit admits measured members within it, and a member without a valid
/// measured median reads unknown and counts toward no goal. Captured stays.
#[tokio::test]
async fn quality_bar_usable_only_and_fwhm_median_limit_unknown_when_unmeasured() {
    let world = world(&[], &[]).await;
    let ngc = world.ngc.candidate.id;
    let project = world
        .project(vec![integration(ngc, "Ha", 3600), bar(ngc, QualityCriterion::UsableOnly)])
        .await;
    world.saved_run(&project, "HOO", &[]).await;
    world.set_quality(HA[0], Quality::Usable).await;
    world.set_quality(HA[2], Quality::Unusable).await;
    let progress = world.progress(project.id).await;
    let ha = goal(&progress, "Ha");
    assert_eq!(ha.quality_bars, [QualityCriterion::UsableOnly]);
    assert_eq!((ha.in_project, ha.captured, ha.unknown_for_bar), (frames(1), frames(4), 0));
    assert!(progress.goals.iter().all(|row| row.goal.goal.counts_frames()), "a bar is no row");

    let limit = QualityCriterion::MaxFwhmMedian { max_px: 3.0 };
    let goals = [integration(ngc, "Ha", 3600), bar(ngc, limit.clone())];
    world.catalog.set_project_goals(project.id, project.revision, &goals).await.unwrap();
    let ids: Vec<Uuid> = {
        let mut ids = Vec::new();
        for name in &HA[..3] {
            ids.push(world.asset(name).await.id);
        }
        ids
    };
    let run = world.catalog.begin_measurement_run(&method(), &ids, 0).await.unwrap();
    for (sequence, (name, fwhm, failed)) in
        [(HA[0], Some(2.5), false), (HA[1], Some(3.5), false), (HA[2], None, true)]
            .into_iter()
            .enumerate()
    {
        let asset = world.asset(name).await;
        let record = record(
            &asset,
            &world.fx.root.join(name),
            run.operation_id,
            sequence as u64 + 1,
            fwhm,
            failed,
        );
        world.catalog.record_measurement(run.operation_id, &record).await.unwrap();
    }
    world.catalog.finish_measurement_run(run.operation_id, RunState::Completed).await.unwrap();
    let progress = world.progress(project.id).await;
    let ha = goal(&progress, "Ha");
    assert_eq!(ha.quality_bars, [limit]);
    assert_eq!(ha.in_project, frames(1), "2.5 px is within 3 px, 3.5 px is not");
    assert_eq!(ha.unknown_for_bar, 2, "a failed and an unmeasured frame read unknown");
    assert_eq!(ha.captured, frames(4));

    // Another method version's record is not valid evidence.
    let other = MeasurementMethod::new("platevault.stars", 2);
    let stale = world.catalog.project_progress_basis(project.id, &other).await.unwrap();
    assert_eq!((goal(&stale, "Ha").in_project.frames, goal(&stale, "Ha").unknown_for_bar), (0, 4));
    world.catalog.close().await.unwrap();
}

/// PRJ-FR-04: a frame held by two runs, a byte-identical copy in another
/// location and a byte-identical duplicate file each count once.
#[tokio::test]
async fn content_identical_frame_in_two_runs_counts_once() {
    let world = world(&[("Ha_dup.fits", "frame Ha_001.fits")], &[HA[1]]).await;
    let backup = world.backup.as_ref().unwrap().id;
    let copy = world.catalog.location_assets(backup).await.unwrap().remove(0);
    for id in [
        world.asset(HA[0]).await.id,
        world.asset("Ha_dup.fits").await.id,
        world.asset(HA[1]).await.id,
        copy.id,
    ] {
        world.catalog.verify_digest(id, DiskProbe).await.unwrap();
    }
    let ngc = world.ngc.candidate.id;
    let project = world.project(vec![integration(ngc, "Ha", 3600)]).await;
    let before = world.progress(project.id).await;
    assert_eq!(goal(&before, "Ha").captured, frames(4), "six Ha files, four frames");

    world.saved_run(&project, "Ha-only", &[]).await;
    world.saved_run(&project, "HOO", &[]).await;
    let progress = world.progress(project.id).await;
    assert_eq!(goal(&progress, "Ha").in_project, frames(4));
    assert_eq!(goal(&progress, "Ha").captured, frames(4));
    world.catalog.close().await.unwrap();
}

/// R16, D19: a member whose bytes changed since the saved revision chose it
/// leaves "in project" and stays "captured".
#[tokio::test]
async fn drifted_frame_leaves_in_project() {
    let world = world(&[], &[]).await;
    let ngc = world.ngc.candidate.id;
    let project = world.project(vec![integration(ngc, "Ha", 3600)]).await;
    world.saved_run(&project, "HOO", &[]).await;
    assert_eq!(goal(&world.progress(project.id).await, "Ha").in_project, frames(4));

    world.fx.write(HA[1], b"frame Ha_002.fits, rewritten by another tool");
    let names: Vec<&str> = HA.iter().chain(OIII.iter()).copied().collect();
    scan(&world.catalog, &world.fx, &world.location, &names).await;
    let progress = world.progress(project.id).await;
    assert_eq!(goal(&progress, "Ha").in_project, frames(3));
    assert_eq!(goal(&progress, "Ha").captured, frames(4));
    world.catalog.close().await.unwrap();
}
