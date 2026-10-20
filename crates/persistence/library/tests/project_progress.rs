// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project goal progress (spec 065: PRJ-FR-03, PRJ-FR-04, PRJ-FR-21, PRJ-AC-01,
//! PRJ-AC-03, PRJ-AC-07, PRJ-AC-26; root FR-019, FR-023; D-W36, D-W44, D-W94,
//! D-W96). "in project" counts the frames of the sessions the Project holds
//! (`project_sessions`), each content-identical frame once, minus the
//! Project's exclusions, Library rejections, Trashed frames and frames the
//! quality bar does not admit. "captured" adds the frames of its
//! suggestions, Trashed frames aside, so "in project" never exceeds
//! "captured". Sessions join through the membership writer once Ready and
//! settled. Fixture files are real and only read, except where a scenario
//! rewrites or trashes one.
#![cfg(unix)]

#[path = "support/membership.rs"]
mod membership_support;
mod support;

use std::path::Path;

use membership_support::{add, admit, hold, remove};
use persistence_library::{
    Catalog, LocationRegistration, ProgressBasis, SessionQuery, SourceProbe, TrashedFrame,
};
use platevault_model::{
    reasons, Asset, AssociationState, DecodedBasis, Equipment, FrameChoice, GoalInput,
    GoalProgress, GoalSpec, GoalTally, ImageFormat, InputBasis, Location, LocationRole, MaskCounts,
    MeasurementMethod, MeasurementOutcome, MeasurementRecord, MetricId, MetricValue, Microseconds,
    NativePath, PlaneBasis, Project, ProjectInput, ProjectLifecycle, Provenance, Quality,
    QualityCriterion, RunState, SampleFormat, SaturationBasis, SaturationSource, Scaling, ScanFile,
    ScanObservation, ScanProgress, ScanState, Session, SubjectInput, TargetRecord, Units,
    VolumeKind,
};
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
        group_id: None,
        goal: GoalSpec::Integration { channel: Some(channel.into()), goal_seconds },
    }
}

fn frame_count(target: Uuid, channel: &str, goal_frames: u64) -> GoalInput {
    GoalInput {
        target_id: target,
        group_id: None,
        goal: GoalSpec::FrameCount { channel: Some(channel.into()), goal_frames },
    }
}

fn bar(target: Uuid, criterion: QualityCriterion) -> GoalInput {
    GoalInput { target_id: target, group_id: None, goal: GoalSpec::QualityBar { criterion } }
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
            subjects: vec![SubjectInput { target_id: self.ngc.candidate.id, name: None }],
            rig_ids: vec![self.redcat.id],
            goals,
        };
        self.catalog.create_project(&input).await.unwrap()
    }

    /// The Project's choice for the frames at `names`, at its current
    /// revision.
    async fn choose(&self, project: Uuid, names: &[&str], choice: FrameChoice) {
        let mut keys = Vec::new();
        for name in names {
            keys.push(self.asset(name).await.id);
        }
        let revision = self.catalog.project_desired(project).await.unwrap().revision;
        self.catalog.set_project_frames(project, revision, &keys, choice).await.unwrap();
    }

    /// Move one frame to the fixture's OS Trash and record it Trashed.
    async fn trash(&self, name: &str) {
        let asset = self.asset(name).await;
        let source = self.fx.root.join(name);
        let sha256 = sha_of(&source);
        let bin = self.fx.temp.path().join("Trash");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::rename(&source, bin.join(name)).unwrap();
        let frame = TrashedFrame { asset_id: asset.id, sha256 };
        self.catalog.record_trashed(Uuid::new_v4(), &[frame]).await.unwrap();
    }

    async fn set_quality(&self, name: &str, quality: Quality) {
        let asset = self.asset(name).await;
        self.catalog.set_quality(&[expected(&asset)], quality, DiskProbe).await.unwrap();
    }

    async fn progress(&self, project: Uuid) -> ProgressBasis {
        self.catalog.project_progress_basis(project, &method()).await.unwrap()
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
            code: platevault_model::MeasurementFailureCode::UnsupportedFormat,
            parameters: Default::default(),
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

/// PRJ-FR-04, D-W44, root FR-019: the sessions the Project holds count; its
/// exclusion, a Library rejection and a Trashed frame leave "in project",
/// and only the Trashed one leaves "captured". A Ready session it doesn't
/// hold yet is captured only, and progress reads the committed edits.
#[tokio::test]
async fn in_project_counts_held_sessions_minus_exclusions_rejects_trashed() {
    let world = world(&[], &[]).await;
    let ngc = world.ngc.candidate.id;
    let project = world.project(vec![integration(ngc, "Ha", 3600)]).await;
    let ha = world.session(HA[0]).await.id;
    admit(&world.catalog, ha, Quality::Usable).await;
    let before = world.progress(project.id).await;
    assert_eq!(goal(&before, "Ha").in_project, GoalTally::default(), "a suggestion is not held");
    assert_eq!(goal(&before, "Ha").captured, frames(4), "the suggestion's frames are captured");

    add(&world.catalog, project.id, ha, world.redcat.id).await.unwrap();
    world.choose(project.id, &[HA[0]], FrameChoice::Exclude).await;
    world.set_quality(HA[1], Quality::Unusable).await;
    world.trash(HA[2]).await;
    let progress = world.progress(project.id).await;
    let row = goal(&progress, "Ha");
    assert_eq!(row.in_project, frames(1), "only Ha_004 is left in project");
    assert_eq!(row.captured, frames(3), "the excluded and rejected frames are still captured");
    let committed = world.catalog.project_desired(project.id).await.unwrap().revision;
    assert_eq!((progress.project_id, progress.revision), (project.id, committed));
    world.catalog.close().await.unwrap();
}

/// PRJ-FR-04, PRJ-FR-09: "captured" is the frames of the Project's own
/// sessions plus its suggestions'. A session it removes is a suggestion
/// again; one re-confirmed as another Target is neither, until it is
/// confirmed back and added again.
#[tokio::test]
async fn captured_is_suggestions_plus_held_sessions() {
    let world = world(&[], &[]).await;
    let ngc = world.ngc.candidate.id;
    let project = world.project(vec![frame_count(ngc, "OIII", 2)]).await;
    let oiii = world.session(OIII[0]).await.id;
    admit(&world.catalog, oiii, Quality::Usable).await;
    let tally = |progress: &ProgressBasis| {
        let row = goal(progress, "OIII");
        (row.in_project.frames, row.captured.frames)
    };
    assert_eq!(tally(&world.progress(project.id).await), (0, 2), "a suggestion only is captured");

    add(&world.catalog, project.id, oiii, world.redcat.id).await.unwrap();
    assert_eq!(tally(&world.progress(project.id).await), (2, 2));

    remove(&world.catalog, project.id, oiii).await;
    assert_eq!(tally(&world.progress(project.id).await), (0, 2), "a suggestion again");

    world.retarget(OIII[0], world.m81.candidate.id).await;
    assert_eq!(tally(&world.progress(project.id).await), (0, 0), "neither held nor suggested");

    world.retarget(OIII[0], ngc).await;
    add(&world.catalog, project.id, oiii, world.redcat.id).await.unwrap();
    assert_eq!(tally(&world.progress(project.id).await), (2, 2), "added again, it counts again");
    world.catalog.close().await.unwrap();
}

/// FR-023, PRJ-FR-21: whatever the Project holds, excludes or removes and
/// whatever the Library rejects, re-confirms or Trashes, with a bar, no goal
/// shows "in project" above "captured".
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
    let (ha, oiii) = (world.session(HA[0]).await.id, world.session(OIII[0]).await.id);
    hold(&world.catalog, project.id, ha, world.redcat.id).await;
    admit(&world.catalog, oiii, Quality::Usable).await;
    assert_never_exceeds(&world.progress(project.id).await);
    add(&world.catalog, project.id, oiii, world.redcat.id).await.unwrap();
    world.choose(project.id, &[HA[1]], FrameChoice::Exclude).await;
    world.set_quality(HA[0], Quality::Unusable).await;
    world.set_quality(OIII[0], Quality::Unusable).await;
    assert_never_exceeds(&world.progress(project.id).await);
    world.retarget(OIII[0], world.m81.candidate.id).await;
    assert_never_exceeds(&world.progress(project.id).await);
    world.trash(HA[2]).await;
    remove(&world.catalog, project.id, ha).await;
    let progress = world.progress(project.id).await;
    assert_never_exceeds(&progress);
    assert_eq!(goal(&progress, "OIII").in_project.frames, 1, "the Usable OIII frame it holds");
    world.catalog.close().await.unwrap();
}

/// PRJ-AC-26, D-W94, D-W96: a session the Project holds whose Target is
/// re-confirmed as another Target is no longer a candidate, yet stays in
/// the Project and still counts "in project" and "captured".
#[tokio::test]
async fn reconfirmed_held_session_counts_in_both() {
    let world = world(&[], &[]).await;
    let ngc = world.ngc.candidate.id;
    let project = world.project(vec![integration(ngc, "Ha", 3600)]).await;
    let ha = world.session(HA[0]).await.id;
    hold(&world.catalog, project.id, ha, world.redcat.id).await;
    world.retarget(HA[0], world.m81.candidate.id).await;
    let candidates = world.catalog.project_candidates(project.id).await.unwrap();
    assert!(candidates.iter().all(|c| c.session_id != ha), "no longer a candidate");
    let desired = world.catalog.project_desired(project.id).await.unwrap();
    assert!(desired.sessions.iter().any(|member| member.session_id == ha), "it stays held");
    let progress = world.progress(project.id).await;
    assert_eq!(goal(&progress, "Ha").in_project, frames(4));
    assert_eq!(goal(&progress, "Ha").captured, frames(4));
    assert_never_exceeds(&progress);
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
    let (ha, oiii) = (world.session(HA[0]).await.id, world.session(OIII[0]).await.id);
    admit(&world.catalog, ha, Quality::Usable).await;
    admit(&world.catalog, oiii, Quality::Usable).await;
    let progress = world.progress(project.id).await;
    let row = goal(&progress, "Ha");
    assert_eq!(row.captured, frames(4), "the captured frames would meet it");
    assert!(!row.met && !goal(&progress, "OIII").met);

    add(&world.catalog, project.id, ha, world.redcat.id).await.unwrap();
    add(&world.catalog, project.id, oiii, world.redcat.id).await.unwrap();
    world.choose(project.id, &[HA[0]], FrameChoice::Exclude).await;
    let progress = world.progress(project.id).await;
    let row = goal(&progress, "Ha");
    assert_eq!((row.in_project.seconds, row.captured.seconds), (seconds(900), seconds(1200)));
    assert!(!row.met, "900 s in project of 1200 s");
    assert!(goal(&progress, "OIII").met);

    world.choose(project.id, &[HA[0]], FrameChoice::FollowLibrary).await;
    let progress = world.progress(project.id).await;
    assert!(goal(&progress, "Ha").met, "1200 s in project");
    let desired = world.catalog.project_desired(project.id).await.unwrap();
    assert_eq!(desired.lifecycle, ProjectLifecycle::Open, "met goals never close the Project");
    world.catalog.close().await.unwrap();
}

/// PRJ-FR-03, PRJ-AC-07: a Usable-only bar admits only Usable frames, even
/// ones the Project includes explicitly; a median FWHM limit admits measured
/// frames within it, and a frame without a valid measured median reads
/// unknown and counts toward no goal. Captured stays.
#[tokio::test]
async fn quality_bar_usable_only_and_fwhm_median_limit_unknown_when_unmeasured() {
    let world = world(&[], &[]).await;
    let ngc = world.ngc.candidate.id;
    let project = world
        .project(vec![integration(ngc, "Ha", 3600), bar(ngc, QualityCriterion::UsableOnly)])
        .await;
    let ha = world.session(HA[0]).await.id;
    world.set_quality(HA[0], Quality::Usable).await;
    admit(&world.catalog, ha, Quality::Unusable).await;
    add(&world.catalog, project.id, ha, world.redcat.id).await.unwrap();
    world.choose(project.id, &HA[1..], FrameChoice::Include).await;
    let progress = world.progress(project.id).await;
    let row = goal(&progress, "Ha");
    assert_eq!(row.quality_bars, [QualityCriterion::UsableOnly]);
    assert_eq!((row.in_project, row.captured, row.unknown_for_bar), (frames(1), frames(4), 0));
    assert!(progress.goals.iter().all(|row| row.goal.goal.counts_frames()), "a bar is no row");

    let limit = QualityCriterion::MaxFwhmMedian { max_px: 3.0 };
    let goals = [integration(ngc, "Ha", 3600), bar(ngc, limit.clone())];
    let revision = world.catalog.project_desired(project.id).await.unwrap().revision;
    world.catalog.set_project_goals(project.id, revision, &goals).await.unwrap();
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
    let row = goal(&progress, "Ha");
    assert_eq!(row.quality_bars, [limit]);
    assert_eq!(row.in_project, frames(1), "2.5 px is within 3 px, 3.5 px is not");
    assert_eq!(row.unknown_for_bar, 2, "a failed and an unmeasured frame read unknown");
    assert_eq!(row.captured, frames(4));

    // Another method version's record is not valid evidence.
    let other = MeasurementMethod::new("platevault.stars", 2);
    let stale = world.catalog.project_progress_basis(project.id, &other).await.unwrap();
    assert_eq!((goal(&stale, "Ha").in_project.frames, goal(&stale, "Ha").unknown_for_bar), (0, 4));
    world.catalog.close().await.unwrap();
}

/// PRJ-FR-04: a byte-identical copy in another location and a byte-identical
/// duplicate file count once, suggested or held.
#[tokio::test]
async fn content_identical_frame_counts_once() {
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
    let ha = world.session(HA[0]).await.id;
    admit(&world.catalog, ha, Quality::Usable).await;
    let before = world.progress(project.id).await;
    assert_eq!(goal(&before, "Ha").captured, frames(4), "six Ha files, four frames");

    add(&world.catalog, project.id, ha, world.redcat.id).await.unwrap();
    let progress = world.progress(project.id).await;
    assert_eq!(goal(&progress, "Ha").in_project, frames(4));
    assert_eq!(goal(&progress, "Ha").captured, frames(4));
    world.catalog.close().await.unwrap();
}

/// R16, D19: a held frame whose bytes changed since the Project chose it
/// leaves "in project" and stays "captured".
#[tokio::test]
async fn drifted_frame_leaves_in_project() {
    let world = world(&[], &[]).await;
    let ngc = world.ngc.candidate.id;
    let project = world.project(vec![integration(ngc, "Ha", 3600)]).await;
    let ha = world.session(HA[0]).await.id;
    hold(&world.catalog, project.id, ha, world.redcat.id).await;
    assert_eq!(goal(&world.progress(project.id).await, "Ha").in_project, frames(4));

    world.fx.write(HA[1], b"frame Ha_002.fits, rewritten by another tool");
    let names: Vec<&str> = HA.iter().chain(OIII.iter()).copied().collect();
    scan(&world.catalog, &world.fx, &world.location, &names).await;
    let progress = world.progress(project.id).await;
    assert_eq!(goal(&progress, "Ha").in_project, frames(3));
    assert_eq!(goal(&progress, "Ha").captured, frames(4));
    world.catalog.close().await.unwrap();
}
