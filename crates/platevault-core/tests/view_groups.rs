// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Mosaic run groups (spec 066 VSEL-FR-05/07/08/18/19, VSEL-AC-21/22,
//! PRJ-AC-13, PV-VSEL-SC-04; D-W38, D-W41, D-W73) over generated FITS
//! sessions of NGC 7000 Mosaic: one panel run per confirmed panel and no
//! whole-mosaic run, panel assignment by pointing against the rig's field of
//! view, flagged sessions that wait for the user, one shared setup, and status
//! and outcomes per panel. Fixture files are only read.
#![cfg(unix)]

mod support;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use persistence_library::SessionQuery;
use platevault_core::library::Library;
use platevault_core::targets::ICRS_FRAME;
use platevault_core::view_groups::{GroupSessionState, ViewGroupDetail};
use platevault_core::*;
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::Connection;
use uuid::Uuid;

/// `(number, RA, Dec)`: three panels 1.5° apart in RA at Dec +44°, rotation 0.
/// The rig's 1.29° × 0.86° field makes neighbouring panels overlap.
const PANELS: [(u32, f64, f64); 3] = [(1, 313.0, 44.0), (2, 314.5, 44.0), (3, 316.0, 44.0)];

/// One light frame per night, so each night is its own session.
const SESSIONS: [(&str, Option<(f64, f64)>); 6] = [
    // Inside Panel 1 only.
    ("2026-09-01", Some((313.02, 44.01))),
    ("2026-09-02", Some((312.95, 43.98))),
    // Inside Panel 3 only.
    ("2026-09-03", Some((316.01, 44.02))),
    // In the overlap of Panels 1 and 2.
    ("2026-09-04", Some((313.75, 44.0))),
    // Two degrees north of Panel 2: outside every panel.
    ("2026-09-05", Some((314.5, 46.0))),
    // No pointing at all.
    ("2026-09-06", None),
];
const P1_A: usize = 0;
const P1_B: usize = 1;
const P3: usize = 2;
const BETWEEN: usize = 3;
const OFF: usize = 4;
const UNKNOWN: usize = 5;

fn write_frames(root: &Path) {
    for (night, pointing) in SESSIONS {
        let mut fields = vec![
            ("IMAGETYP", "'LIGHT'".to_owned()),
            ("INSTRUME", "'ASI2600MM'".into()),
            ("TELESCOP", "'RedCat 51'".into()),
            ("OBJECT", "'NGC 7000'".into()),
            ("FILTER", "'Ha'".into()),
            ("EXPTIME", "300".into()),
            ("DATE-OBS", format!("'{night}T22:00:00'")),
        ];
        if let Some((ra, dec)) = pointing {
            fields.push(("RA", format!("{ra}")));
            fields.push(("DEC", format!("{dec}")));
        }
        let fields: Vec<(&str, &str)> =
            fields.iter().map(|(key, value)| (*key, value.as_str())).collect();
        support::fits(&root.join(format!("{night}.fits")), &fields).unwrap();
    }
}

async fn scan_to_end(library: &Arc<Library>, location: Uuid) {
    let mut progress = library.subscribe_scan_progress();
    let started = library.start_scan(location, None).await.unwrap();
    let finished = tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let operation = progress.recv().await.unwrap();
            if operation.id == started.id && operation.state != ScanState::Running {
                return operation;
            }
        }
    })
    .await
    .expect("scan must publish its terminal state");
    assert_eq!(finished.state, ScanState::Completed);
}

fn target(designation: &str, ra_deg: f64, dec_deg: f64) -> TargetCandidate {
    TargetCandidate {
        id: Uuid::new_v4(),
        designation: designation.into(),
        aliases: Vec::new(),
        common_name: None,
        object_type: "nebula".into(),
        coordinates: Some(SkyCoordinates { ra_deg, dec_deg, frame: ICRS_FRAME.into() }),
        provenance: Provenance::User,
        provider_id: None,
        angular_size: None,
        catalogues: Vec::new(),
    }
}

/// 3000 × 2000 pixels of 3.76 µm at 500 mm: a 1.29° × 0.86° field.
fn redcat() -> Equipment {
    Equipment {
        id: Uuid::new_v4(),
        name: "RedCat 51".into(),
        camera: Some("ASI2600MM".into()),
        telescope: Some("RedCat 51".into()),
        focal_length_mm: Some(500.0),
        pixel_size_um: Some(3.76),
        sensor_width_px: Some(3000),
        sensor_height_px: Some(2000),
        color_kind: None,
        decision_revision: 0,
        state: AssociationState::Confirmed,
        provenance: Provenance::User,
    }
}

fn kind(error: &LibraryError) -> String {
    error.response(None, None).kind
}

struct World {
    _temp: tempfile::TempDir,
    database: PathBuf,
    library: Arc<Library>,
    rig: Equipment,
    project: Project,
    /// In [`SESSIONS`] order.
    sessions: Vec<Uuid>,
}

impl World {
    async fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("RedCat");
        std::fs::create_dir(&root).unwrap();
        write_frames(&root);
        let database = temp.path().join("library.sqlite");
        let library = Library::open(&database, None).await.unwrap();
        let location = library
            .register_location(
                NativePath::from_path(&root),
                "RedCat".into(),
                LocationRole::Captures,
            )
            .await
            .unwrap();
        scan_to_end(&library, location.id).await;
        let catalog = library.catalog();
        let mosaic = catalog.save_target(&target("NGC 7000", 314.75, 44.33), None).await.unwrap();
        let single = catalog.save_target(&target("M 81", 148.9, 69.07), None).await.unwrap();
        let rig = catalog.save_equipment(&redcat(), None).await.unwrap();
        let assets = catalog.location_assets(location.id).await.unwrap();
        let mut sessions = Vec::new();
        for (night, _) in SESSIONS {
            let asset = assets
                .iter()
                .find(|asset| asset.relative_path.display().ends_with(&format!("{night}.fits")))
                .unwrap()
                .id;
            let session = Self::session_of(&library, asset).await;
            catalog
                .associate_target(&[expected_session(&session)], mosaic.candidate.id)
                .await
                .unwrap();
            let session = Self::session_of(&library, asset).await;
            catalog.confirm_equipment(&[expected_session(&session)], rig.id).await.unwrap();
            sessions.push(session.id);
        }
        let panels = PANELS
            .iter()
            .map(|&(number, ra_deg, dec_deg)| PanelInput {
                number,
                ra_deg,
                dec_deg,
                rotation_deg: Some(0.0),
            })
            .collect();
        let input = ProjectInput {
            name: "Cygnus 2026".into(),
            notes: None,
            subjects: vec![
                SubjectInput {
                    target_id: mosaic.candidate.id,
                    name: Some("NGC 7000 Mosaic".into()),
                    mosaic: true,
                    panels,
                },
                SubjectInput {
                    target_id: single.candidate.id,
                    name: None,
                    mosaic: false,
                    panels: Vec::new(),
                },
            ],
            rig_ids: vec![rig.id],
            goals: Vec::new(),
        };
        let project = catalog.create_project(&input).await.unwrap();
        Self { _temp: temp, database, library, rig, project, sessions }
    }

    async fn session_of(library: &Library, asset: Uuid) -> Session {
        let summaries = library.catalog().list_sessions(&SessionQuery::default()).await.unwrap();
        summaries.into_iter().map(|s| s.session).find(|s| s.asset_ids.contains(&asset)).unwrap()
    }

    fn mosaic(&self) -> &ProjectSubject {
        &self.project.subjects[0]
    }

    fn new_group(&self) -> NewViewGroup {
        NewViewGroup {
            project_id: self.project.id,
            subject_id: self.mosaic().id,
            rig_id: self.rig.id,
            name: "NGC 7000 Mosaic".into(),
            panels: self.mosaic().panels.clone(),
        }
    }

    async fn group(&self) -> ViewGroupDetail {
        self.library.create_view_group(&self.new_group()).await.unwrap()
    }

    async fn detail(&self, group: Uuid, filter: Option<PanelFilter>) -> ViewGroupDetail {
        self.library.view_group_detail(group, filter).await.unwrap()
    }

    /// Selected sessions of a run's draft, sorted.
    async fn draft_selected(&self, view: Uuid) -> Vec<Uuid> {
        let basis = self.library.catalog().view_membership(view, Membership::Draft).await.unwrap();
        let mut ids: Vec<Uuid> = basis
            .sessions
            .iter()
            .filter(|basis| basis.choice.state == SessionChoiceState::Selected)
            .map(|basis| basis.choice.session_id)
            .collect();
        ids.sort_unstable();
        ids
    }

    fn ids(&self, indexes: &[usize]) -> Vec<Uuid> {
        let mut ids: Vec<Uuid> = indexes.iter().map(|index| self.sessions[*index]).collect();
        ids.sort_unstable();
        ids
    }

    /// Run SQL a later unit's write owns (U16 Move to Trash) directly.
    async fn raw_sql(&self, statement: &str) {
        let options = SqliteConnectOptions::new().filename(&self.database);
        let mut conn = SqliteConnection::connect_with(&options).await.unwrap();
        sqlx::query(sqlx::AssertSqlSafe(statement.to_owned())).execute(&mut conn).await.unwrap();
        conn.close().await.unwrap();
    }
}

fn expected_session(session: &Session) -> ExpectedSession {
    ExpectedSession {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        decision_revision: session.decision_revision,
    }
}

fn row(detail: &ViewGroupDetail, session: Uuid) -> &view_groups::GroupSessionRow {
    detail.sessions.iter().find(|row| row.session.session.id == session).unwrap()
}

fn sorted(mut ids: Vec<Uuid>) -> Vec<Uuid> {
    ids.sort_unstable();
    ids
}

fn filter_count(detail: &ViewGroupDetail, filter: PanelFilter) -> u64 {
    detail.filters.iter().find(|count| count.filter == filter).map(|count| count.count).unwrap()
}

#[tokio::test]
async fn group_creates_one_run_per_confirmed_panel_no_whole_mosaic() {
    let world = World::new().await;
    let single = NewView {
        project_id: world.project.id,
        subject_id: world.mosaic().id,
        rig_id: world.rig.id,
        name: "Whole mosaic".into(),
    };
    let error = world.library.create_view(&single).await.unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "{error}");
    assert!(error.to_string().contains("run group"), "{error}");

    // Panels are confirmed as listed: a stale or partial list creates nothing.
    let mut stale = world.new_group();
    stale.panels[1].rotation_deg = Some(30.0);
    let error = world.library.create_view_group(&stale).await.unwrap_err();
    assert_eq!(kind(&error), "conflict", "{error}");
    let mut partial = world.new_group();
    partial.panels.pop();
    let error = world.library.create_view_group(&partial).await.unwrap_err();
    assert_eq!(kind(&error), "conflict", "{error}");
    let not_mosaic = NewViewGroup {
        subject_id: world.project.subjects[1].id,
        panels: Vec::new(),
        ..world.new_group()
    };
    let error = world.library.create_view_group(&not_mosaic).await.unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "{error}");
    let query = ViewQuery { project_id: Some(world.project.id), offset: 0, limit: 0 };
    assert!(world.library.catalog().list_views(&query).await.unwrap().is_empty());

    let detail = world.group().await;
    let group = &detail.group;
    let numbers: Vec<u32> = detail.panels.iter().map(|panel| panel.panel.number).collect();
    assert_eq!(numbers, vec![1, 2, 3]);
    for panel in &detail.panels {
        assert_eq!(panel.view.group_id, Some(group.id));
        assert_eq!(panel.view.panel_id, Some(panel.panel.id));
        assert_eq!(panel.view.subject_id, world.mosaic().id);
        assert_eq!(panel.view.rig_id, world.rig.id);
        assert_eq!(panel.view.stage, RunStage::Select);
        let outline = panel.outline.as_ref().expect("a known rotation and rig field");
        assert_eq!(outline.corners.len(), 4);
    }
    let runs = world.library.catalog().list_views(&query).await.unwrap();
    assert_eq!(runs.len(), 3, "one run per panel and no whole-mosaic run");
    assert!(runs.iter().all(|run| run.group_id == Some(group.id) && run.panel_id.is_some()));

    // Each in-panel session joins its panel run, its pointing as the reason.
    let [p1, p2, p3] = [&detail.panels[0], &detail.panels[1], &detail.panels[2]];
    assert_eq!(world.draft_selected(p1.view.id).await, world.ids(&[P1_A, P1_B]));
    assert!(world.draft_selected(p2.view.id).await.is_empty());
    assert_eq!(world.draft_selected(p3.view.id).await, world.ids(&[P3]));
    let basis =
        world.library.catalog().view_membership(p1.view.id, Membership::Draft).await.unwrap();
    for choice in basis.sessions.iter().map(|basis| &basis.choice) {
        let SelectionReason::PanelPointing { panel_id, separation_deg, .. } = choice.reason else {
            panic!("pointing names the reason: {:?}", choice.reason);
        };
        assert_eq!(panel_id, p1.panel.id);
        assert!(separation_deg < 0.1, "{separation_deg}");
    }
    assert_eq!(sorted(p1.sessions.clone()), world.ids(&[P1_A, P1_B]));
    assert_eq!(p3.sessions, world.ids(&[P3]));

    // Each panel run stays tied to its panel: discarding a never-saved panel
    // run's draft removes nothing.
    let error = world.library.catalog().discard_view_draft(p2.view.id, 1).await.unwrap_err();
    assert!(error.to_string().contains("run group"), "{error}");
    assert_eq!(world.library.catalog().list_views(&query).await.unwrap().len(), 3);
    assert!(world.draft_selected(p2.view.id).await.is_empty());
}

#[tokio::test]
async fn ambiguous_offpanel_and_unknown_pointing_flagged_unassigned() {
    let world = World::new().await;
    let detail = world.group().await;
    let [p1, p2, p3] = [&detail.panels[0], &detail.panels[1], &detail.panels[2]];
    for (index, flag) in [
        (BETWEEN, PanelFlag::Ambiguous),
        (OFF, PanelFlag::OffPanel),
        (UNKNOWN, PanelFlag::NoPointing),
    ] {
        let row = row(&detail, world.sessions[index]);
        assert_eq!(row.state, GroupSessionState::Flagged, "{index}");
        assert_eq!(row.flag, Some(flag), "{index}");
        assert_eq!(row.panel_id, None, "{index}");
    }
    let between = &row(&detail, world.sessions[BETWEEN]).evidence;
    let inside: Vec<Option<u64>> = between.checks.iter().map(|check| check.frames_inside).collect();
    assert_eq!(inside, vec![Some(1), Some(1), Some(0)], "inside Panels 1 and 2");
    assert!(row(&detail, world.sessions[UNKNOWN]).evidence.mean_pointing.is_none());
    // A flagged session joins no panel run and counts toward no panel.
    for panel in &detail.panels {
        let drafts = world.draft_selected(panel.view.id).await;
        for index in [BETWEEN, OFF, UNKNOWN] {
            assert!(!drafts.contains(&world.sessions[index]), "panel {}", panel.panel.number);
        }
    }
    assert_eq!(detail.summary.included_frames, 3);

    // The Panel filter lists Panel N and Flagged, each with its count.
    assert_eq!(filter_count(&detail, PanelFilter::Flagged), 3);
    assert_eq!(filter_count(&detail, PanelFilter::Panel { number: 1 }), 2);
    assert_eq!(filter_count(&detail, PanelFilter::Panel { number: 2 }), 0);
    assert_eq!(filter_count(&detail, PanelFilter::Panel { number: 3 }), 1);
    let flagged = world.detail(detail.group.id, Some(PanelFilter::Flagged)).await;
    let listed = sorted(flagged.sessions.iter().map(|row| row.session.session.id).collect());
    assert_eq!(listed, world.ids(&[BETWEEN, OFF, UNKNOWN]));

    // A panel run's picker offers only the sessions assigned to its panel.
    let query = CandidateQuery {
        membership: Membership::Draft,
        filters: CandidateFilters::default(),
        sort: None,
        selected_only: false,
        offset: 0,
        limit: 100,
    };
    let page = world.library.view_candidates(p1.view.id, &query).await.unwrap();
    let offered = sorted(page.rows.iter().map(|row| row.session.session.id).collect());
    assert_eq!(offered, world.ids(&[P1_A, P1_B]));
    let error = world
        .library
        .view_select_matching(p2.view.id, 1, &CandidateFilters::default())
        .await
        .unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "Panel 2 has no candidate: {error}");

    // The user assigns one flagged session and leaves another out.
    let decisions = [
        PanelDecision {
            session_id: world.sessions[BETWEEN],
            choice: PanelChoice::Panel { panel_id: p2.panel.id },
        },
        PanelDecision { session_id: world.sessions[OFF], choice: PanelChoice::LeftOut },
    ];
    let stale = world
        .library
        .assign_view_group_panels(detail.group.id, detail.group.revision + 1, &decisions)
        .await
        .unwrap_err();
    assert_eq!(kind(&stale), "conflict", "{stale}");
    let after = world
        .library
        .assign_view_group_panels(detail.group.id, detail.group.revision, &decisions)
        .await
        .unwrap();
    let between = row(&after, world.sessions[BETWEEN]);
    assert_eq!(
        (between.state, between.basis, between.panel_id, between.flag),
        (
            GroupSessionState::Assigned,
            Some(PanelBasis::User),
            Some(p2.panel.id),
            Some(PanelFlag::Ambiguous)
        )
    );
    let off = row(&after, world.sessions[OFF]);
    assert_eq!(
        (off.state, off.basis, off.panel_id),
        (GroupSessionState::LeftOut, Some(PanelBasis::LeftOut), None)
    );
    assert_eq!(row(&after, world.sessions[UNKNOWN]).state, GroupSessionState::Flagged);
    assert_eq!(world.draft_selected(p2.view.id).await, world.ids(&[BETWEEN]));
    let basis =
        world.library.catalog().view_membership(p2.view.id, Membership::Draft).await.unwrap();
    assert_eq!(basis.sessions[0].choice.reason, SelectionReason::Manual);
    for panel in [p1, p3] {
        assert!(!world.draft_selected(panel.view.id).await.contains(&world.sessions[OFF]));
    }
    assert_eq!(filter_count(&after, PanelFilter::Flagged), 1);
    assert_eq!(after.panels[1].summary.as_ref().unwrap().included_frames, 1);
    assert_eq!(after.summary.included_frames, 4);
}

#[tokio::test]
async fn shared_setup_change_applies_to_every_panel() {
    let world = World::new().await;
    let detail = world.group().await;
    assert_eq!(detail.group.setup.calibration_policy, CalibrationPolicy::Automatic);
    let setup = GroupSetup {
        profile_id: Some(Uuid::new_v4()),
        input_mode: Some(InputMode::Copy),
        calibration_policy: CalibrationPolicy::Manual,
    };
    let stale = world
        .library
        .set_view_group_setup(detail.group.id, detail.group.revision + 1, &setup)
        .await
        .unwrap_err();
    assert_eq!(kind(&stale), "conflict", "{stale}");
    let outcome = world
        .library
        .set_view_group_setup(detail.group.id, detail.group.revision, &setup)
        .await
        .unwrap();
    assert_eq!(outcome.group.setup, setup);
    assert_eq!(outcome.group.revision, detail.group.revision + 1);
    assert_eq!(outcome.panels.len(), 3);
    assert!(outcome.panels.iter().all(|panel| panel.result == PanelResult::Applied));
    for panel in &detail.panels {
        let view = world.library.catalog().view(panel.view.id).await.unwrap().view;
        assert_eq!(
            (view.profile_id, view.calibration_policy),
            (setup.profile_id, setup.calibration_policy)
        );
    }
    let after = world.detail(detail.group.id, None).await;
    assert_eq!(after.group.setup, setup);
    assert!(after.panels.iter().all(|panel| panel.setup_matches_group));

    let again = world
        .library
        .set_view_group_setup(detail.group.id, outcome.group.revision, &setup)
        .await
        .unwrap();
    assert!(again.panels.iter().all(|panel| panel.result == PanelResult::Unchanged));
}

#[tokio::test]
async fn panel_status_independent() {
    let world = World::new().await;
    let detail = world.group().await;
    for panel in [&detail.panels[0], &detail.panels[2]] {
        world.library.catalog().set_view_stage(panel.view.id, RunStage::Review).await.unwrap();
    }
    let after = world.detail(detail.group.id, None).await;
    let stages: Vec<RunStage> = after.panels.iter().map(|panel| panel.view.stage).collect();
    assert_eq!(stages, vec![RunStage::Review, RunStage::Select, RunStage::Review]);
    let frames: Vec<u64> = after
        .panels
        .iter()
        .map(|panel| panel.summary.as_ref().map_or(0, |summary| summary.included_frames))
        .collect();
    assert_eq!(frames, vec![2, 0, 1], "a summary per panel run");
    assert_eq!(after.summary.included_frames, 3, "and one for the group");
    let channels: Vec<(Option<String>, u64)> = after
        .summary
        .channels
        .iter()
        .map(|channel| (channel.channel.clone(), channel.included_frames))
        .collect();
    assert_eq!(channels, vec![(Some("Ha".into()), 3)]);
}

#[tokio::test]
async fn group_action_reports_per_panel_outcome() {
    let world = World::new().await;
    let detail = world.group().await;
    let [p1, p2, p3] = [&detail.panels[0], &detail.panels[1], &detail.panels[2]];
    world.library.catalog().set_view_stage(p1.view.id, RunStage::Review).await.unwrap();
    world
        .raw_sql(&format!(
            "UPDATE views SET trashed_at = '2026-10-07T12:00:00Z' WHERE id = '{}'",
            p2.view.id
        ))
        .await;
    let setup = GroupSetup {
        profile_id: Some(Uuid::new_v4()),
        input_mode: Some(InputMode::LinkedView),
        calibration_policy: CalibrationPolicy::Manual,
    };
    let outcome = world
        .library
        .set_view_group_setup(detail.group.id, detail.group.revision, &setup)
        .await
        .unwrap();
    let results: Vec<(u32, Uuid)> =
        outcome.panels.iter().map(|panel| (panel.number, panel.view_id)).collect();
    assert_eq!(results, vec![(1, p1.view.id), (2, p2.view.id), (3, p3.view.id)]);
    assert_eq!(outcome.panels[0].result, PanelResult::Applied);
    let PanelResult::Refused { reason } = &outcome.panels[1].result else {
        panic!("Panel 2 is in the Trash: {:?}", outcome.panels[1].result);
    };
    assert!(reason.contains("Trash"), "{reason}");
    assert_eq!(outcome.panels[2].result, PanelResult::Applied);

    // One panel's refusal changes no other panel, and the refused one keeps
    // its own setup and status.
    let after = world.detail(detail.group.id, None).await;
    let stages: Vec<RunStage> = after.panels.iter().map(|panel| panel.view.stage).collect();
    assert_eq!(stages, vec![RunStage::Review, RunStage::Select, RunStage::Select]);
    let refused = &after.panels[1];
    assert_eq!(
        (refused.view.profile_id, refused.view.calibration_policy),
        (None, CalibrationPolicy::Automatic)
    );
    assert!(refused.view.trashed_at.is_some());
    let matches: Vec<bool> = after.panels.iter().map(|panel| panel.setup_matches_group).collect();
    assert_eq!(matches, vec![true, false, true]);

    // A decision for a panel run in the Trash is refused as a whole.
    let decisions = [PanelDecision {
        session_id: world.sessions[BETWEEN],
        choice: PanelChoice::Panel { panel_id: p2.panel.id },
    }];
    let error = world
        .library
        .assign_view_group_panels(detail.group.id, outcome.group.revision, &decisions)
        .await
        .unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "{error}");
    assert!(error.to_string().contains("Trash"), "{error}");
    let unchanged = world.detail(detail.group.id, None).await;
    assert_eq!(row(&unchanged, world.sessions[BETWEEN]).state, GroupSessionState::Flagged);
}
