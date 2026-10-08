// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project planning over the library facade (spec 072 PLAN-FR-02/09/10,
//! PLAN-AC-10; spec 065 D-W36): a Project page lists the windows of its own
//! subjects only, each the Plan area's window set at the planning site, with
//! the "Open in Planner" context; each subject's per-channel gap names its
//! "in project" and "captured" amounts from the goal progress, and a mosaic
//! lists each panel with its own gaps, on the Project page and in the Target's
//! Plan area.

mod support;

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use persistence_library::SessionQuery;
use platevault_core::library::Library;
use platevault_core::planning_project::{
    GapLabel, GapRemaining, GoalGap, ProjectPlanning, ProjectPlanningQuery,
};
use platevault_core::targets::TargetQuery;
use platevault_core::*;
use time::macros::date;
use time::Date;
use uuid::Uuid;

const NIGHT: Date = date!(2026 - 10 - 10);

async fn site(library: &Library, name: &str) -> Uuid {
    let input = SiteInput {
        name: name.into(),
        latitude_deg: 52.09,
        longitude_deg: 5.12,
        elevation_m: None,
        time_zone: "Europe/Amsterdam".into(),
    };
    library.save_site(None, None, &input).await.unwrap().site.id
}

fn criteria() -> PlanCriteria {
    PlanCriteria {
        min_altitude_deg: 30.0,
        darkness: Darkness::Astronomical,
        moon: MoonCriterion::None,
        min_duration_minutes: 30,
    }
}

fn planning_query(project_id: Uuid, site_id: Option<Uuid>) -> ProjectPlanningQuery {
    ProjectPlanningQuery {
        project_id,
        site_id,
        first_night: NIGHT,
        nights: 2,
        criteria: criteria(),
    }
}

async fn seed(library: &Library, text: &str) -> TargetCandidate {
    let query = TargetQuery { text: Some(text.into()), cone: None, limit: 1 };
    let candidate = library.search_targets(&query).await.unwrap().remove(0).candidate;
    library.catalog().record_seed_target(&candidate).await.unwrap();
    candidate
}

fn rig(name: &str) -> Equipment {
    Equipment {
        id: Uuid::new_v4(),
        name: name.into(),
        camera: Some("ASI2600MM".into()),
        telescope: Some(name.into()),
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

fn subject(target_id: Uuid) -> SubjectInput {
    SubjectInput { target_id, name: None, mosaic: false, panels: Vec::new() }
}

fn ids(planning: &ProjectPlanning) -> Vec<Uuid> {
    planning.subjects.iter().map(|subject| subject.subject.target_id).collect()
}

/// PLAN-AC-10, PLAN-FR-09/10: "Summer nebulae" with subjects NGC 7000 and
/// IC 1396 lists windows for those two only, each the Plan area's window set
/// at the planning site; M 31, ★ and a subject of another Project, is not
/// listed. "Open in Planner" names those two subjects and this Project's
/// rigs. Without a planning site no window is computed and the reason is
/// named.
#[tokio::test]
async fn project_planning_lists_only_its_subjects() {
    let temp = tempfile::tempdir().unwrap();
    let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
    let ngc7000 = seed(&library, "NGC 7000").await;
    let ic1396 = seed(&library, "IC 1396").await;
    let m31 = seed(&library, "M 31").await;
    library.add_to_my_targets(&AddTarget::Seed { id: m31.id }).await.unwrap();
    let catalog = library.catalog();
    let esprit = catalog.save_equipment(&rig("Esprit 100"), None).await.unwrap().id;
    let redcat = catalog.save_equipment(&rig("RedCat 51"), None).await.unwrap().id;
    let summer = catalog
        .create_project(&ProjectInput {
            name: "Summer nebulae".into(),
            notes: None,
            subjects: vec![subject(ngc7000.id), subject(ic1396.id)],
            rig_ids: vec![esprit, redcat],
            goals: Vec::new(),
        })
        .await
        .unwrap();
    catalog
        .create_project(&ProjectInput {
            name: "Andromeda".into(),
            notes: None,
            subjects: vec![subject(m31.id)],
            rig_ids: vec![esprit],
            goals: Vec::new(),
        })
        .await
        .unwrap();

    let unplanned = library.project_planning(&planning_query(summer.id, None)).await.unwrap();
    assert_eq!(ids(&unplanned), [ngc7000.id, ic1396.id]);
    assert_eq!(unplanned.unavailable_reason, Some(PlanningUnknownReason::NoSite));
    assert!(unplanned.subjects.iter().all(|subject| subject.windows.is_none()));
    assert_eq!((unplanned.site, unplanned.time_zone), (None, None));

    let backyard = site(&library, "Backyard").await;
    let planning =
        library.project_planning(&planning_query(summer.id, Some(backyard))).await.unwrap();
    assert_eq!((planning.project_id, planning.revision), (summer.id, summer.revision));
    assert_eq!(planning.project_name, "Summer nebulae");
    assert_eq!(ids(&planning), [ngc7000.id, ic1396.id], "M 31 is not this Project's subject");
    assert_eq!(planning.unavailable_reason, None);
    assert_eq!(planning.site.as_ref().map(|site| site.id), Some(backyard));
    assert_eq!(planning.time_zone.as_deref(), Some("Europe/Amsterdam"));
    for listed in &planning.subjects {
        let target_id = listed.subject.target_id;
        let query = WindowQuery {
            target_id,
            site_id: backyard,
            first_night: NIGHT,
            nights: 2,
            criteria: criteria(),
        };
        let plan_area = library.compute_windows(&query).await.unwrap();
        assert_eq!(listed.windows.as_ref(), Some(&plan_area), "the same Target planning");
        assert!(plan_area.windows().next().is_some(), "a window to compare");
    }
    assert_eq!(planning.planner.project_id, summer.id);
    assert_eq!(planning.planner.project_name, "Summer nebulae");
    assert_eq!(planning.planner.target_ids, [ngc7000.id, ic1396.id]);
    assert_eq!(planning.planner.rig_ids, [esprit, redcat], "this Project's rigs");

    let settings = catalog.list_sites().await.unwrap().settings_revision;
    library.set_default_site(Some(backyard), settings).await.unwrap();
    let by_default = library.project_planning(&planning_query(summer.id, None)).await.unwrap();
    assert_eq!(by_default, planning, "the default site when none is chosen");
}

// ---------------------------------------------------------------------------
// Gaps
// ---------------------------------------------------------------------------

fn cards(filter: &str, exposure: &str, minute: usize) -> Vec<(&'static str, String)> {
    vec![
        ("IMAGETYP", "'LIGHT'".into()),
        ("INSTRUME", "'ASI2600MM'".into()),
        ("TELESCOP", "'RedCat 51'".into()),
        ("EXPTIME", exposure.into()),
        ("GAIN", "100".into()),
        ("OFFSET", "50".into()),
        ("XBINNING", "1".into()),
        ("YBINNING", "1".into()),
        ("SET-TEMP", "-10".into()),
        ("DATE-OBS", format!("'2026-09-12T22:{minute:02}:00'")),
        ("FILTER", format!("'{filter}'")),
    ]
}

fn write(root: &Path, name: &str, cards: &[(&'static str, String)]) {
    let keywords: Vec<(&str, &str)> =
        cards.iter().map(|(key, value)| (*key, value.as_str())).collect();
    support::fits(&root.join(name), &keywords).unwrap();
}

async fn scan_to_end(library: &Arc<Library>, location: Uuid) {
    let mut progress = library.subscribe_scan_progress();
    let started = library.start_scan(location, None).await.unwrap();
    tokio::time::timeout(Duration::from_secs(60), async {
        loop {
            let operation = progress.recv().await.unwrap();
            if operation.id == started.id && operation.state != ScanState::Running {
                assert_eq!(operation.state, ScanState::Completed);
                return;
            }
        }
    })
    .await
    .expect("scan must publish its terminal state");
}

fn expected(session: &Session) -> ExpectedSession {
    ExpectedSession {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        decision_revision: session.decision_revision,
    }
}

fn channel_gap<'a>(gaps: &'a [GoalGap], channel: &str) -> &'a GoalGap {
    gaps.iter().find(|gap| gap.goal.goal.channel() == Some(channel)).unwrap()
}

/// A library over 2 Ha lights of 300 s and 2 OIII lights of 120 s under
/// `root`, each session confirmed as NGC 7000 on one rig: the library,
/// NGC 7000, the rig and the OIII session.
async fn scanned_ngc7000(root: &Path) -> (Arc<Library>, TargetCandidate, Uuid, Uuid) {
    let captures = root.join("Captures");
    std::fs::create_dir_all(&captures).unwrap();
    for minute in 0..2 {
        write(&captures, &format!("Ha_{minute:03}.fits"), &cards("Ha", "300", minute));
        write(&captures, &format!("OIII_{minute:03}.fits"), &cards("OIII", "120", 10 + minute));
    }
    let library = Library::open(&root.join("library.sqlite"), None).await.unwrap();
    let location = library
        .register_location(
            NativePath::from_path(&captures),
            "Captures".into(),
            LocationRole::Captures,
        )
        .await
        .unwrap();
    scan_to_end(&library, location.id).await;
    let ngc7000 = seed(&library, "NGC 7000").await;
    let catalog = library.catalog();
    let redcat = catalog.save_equipment(&rig("RedCat 51"), None).await.unwrap().id;
    let sessions = catalog.list_sessions(&SessionQuery::default()).await.unwrap();
    assert_eq!(sessions.len(), 2, "one light session per filter");
    for summary in &sessions {
        catalog.associate_target(&[expected(&summary.session)], ngc7000.id).await.unwrap();
        let session = catalog.session(summary.session.id).await.unwrap().summary.session;
        catalog.confirm_equipment(&[expected(&session)], redcat).await.unwrap();
    }
    let assets = catalog.location_assets(location.id).await.unwrap();
    let oiii_asset =
        assets.iter().find(|asset| asset.relative_path.display().contains("OIII")).unwrap().id;
    let oiii = sessions
        .iter()
        .map(|summary| &summary.session)
        .find(|session| session.asset_ids.contains(&oiii_asset))
        .unwrap()
        .id;
    (library, ngc7000, redcat, oiii)
}
/// PLAN-FR-02, D-W36, D-W66: NGC 7000 has 2 Ha lights of 300 s and 2 OIII
/// lights of 120 s on the Project's rig, and the saved run "Ha only" leaves
/// the OIII session out. The Ha gap names 600 s "in project" and 600 s
/// "captured" with 3000 s to go; the OIII gap names 0 frames "in project" and
/// 2 "captured" with 10 to go. The mosaic subject IC 1396 lists each panel by
/// number with its own goal gap. The Target's Plan area reads the same gaps
/// for the open Project.
#[tokio::test]
async fn gap_names_in_project_and_captured() {
    let temp = tempfile::tempdir().unwrap();
    let (library, ngc7000, redcat, oiii) = scanned_ngc7000(temp.path()).await;
    let ic1396 = seed(&library, "IC 1396").await;
    let catalog = library.catalog();
    let panels = (1..=2)
        .map(|number| PanelInput {
            number,
            ra_deg: 312.0 + f64::from(number),
            dec_deg: 60.0,
            rotation_deg: None,
        })
        .collect();
    let goal = |target_id, panel, goal| GoalInput { target_id, panel, goal };
    let project = catalog
        .create_project(&ProjectInput {
            name: "Summer nebulae".into(),
            notes: None,
            subjects: vec![
                subject(ngc7000.id),
                SubjectInput { target_id: ic1396.id, name: None, mosaic: true, panels },
            ],
            rig_ids: vec![redcat],
            goals: vec![
                goal(
                    ngc7000.id,
                    None,
                    GoalSpec::Integration { channel: Some("Ha".into()), goal_seconds: 3600 },
                ),
                goal(
                    ngc7000.id,
                    None,
                    GoalSpec::FrameCount { channel: Some("OIII".into()), goal_frames: 10 },
                ),
                goal(
                    ic1396.id,
                    Some(2),
                    GoalSpec::Integration { channel: Some("Ha".into()), goal_seconds: 7200 },
                ),
            ],
        })
        .await
        .unwrap();
    let run = NewView {
        project_id: project.id,
        subject_id: project.subjects[0].id,
        rig_id: redcat,
        name: "Ha only".into(),
    };
    let run = catalog.create_view(&run).await.unwrap().view.id;
    let deselect = DraftEdit::DeselectSessions { session_ids: vec![oiii] };
    catalog.edit_view_draft(run, 1, &deselect).await.unwrap();
    catalog.save_view(run, 0, 2).await.unwrap();

    let planning = library.project_planning(&planning_query(project.id, None)).await.unwrap();
    let [nebula, mosaic] = planning.subjects.as_slice() else { panic!("{planning:#?}") };
    let seconds = |whole| Microseconds::from_whole_seconds(whole).unwrap();

    let ha = channel_gap(&nebula.subject.gaps, "Ha");
    assert_eq!(ha.in_project.label, GapLabel::InProject);
    assert_eq!(ha.captured.label, GapLabel::Captured);
    assert_eq!((ha.in_project.tally.frames, ha.in_project.tally.seconds), (2, seconds(600)));
    assert_eq!((ha.captured.tally.frames, ha.captured.tally.seconds), (2, seconds(600)));
    assert_eq!(ha.remaining, GapRemaining::Integration { seconds: seconds(3000) });
    assert!(!ha.met);
    let oiii_gap = channel_gap(&nebula.subject.gaps, "OIII");
    assert_eq!((oiii_gap.in_project.tally.frames, oiii_gap.captured.tally.frames), (0, 2));
    assert_eq!(oiii_gap.remaining, GapRemaining::FrameCount { frames: 10 });
    assert!(nebula.subject.panels.is_empty() && !nebula.subject.mosaic);

    let wire = serde_json::to_value(ha).unwrap();
    assert_eq!(wire["inProject"]["label"], "in project");
    assert_eq!(wire["captured"]["label"], "captured");
    assert_eq!((GapLabel::InProject.text(), GapLabel::Captured.text()), ("in project", "captured"));

    assert!(mosaic.subject.mosaic && mosaic.subject.gaps.is_empty());
    let numbers: Vec<u32> = mosaic.subject.panels.iter().map(|panel| panel.number).collect();
    assert_eq!(numbers, [1, 2], "a mosaic lists each panel");
    assert!(mosaic.subject.panels[0].gaps.is_empty());
    let [panel_two] = mosaic.subject.panels[1].gaps.as_slice() else { panic!("{mosaic:#?}") };
    assert_eq!(panel_two.goal.panel_id, Some(project.subjects[1].panels[1].id));
    assert_eq!(panel_two.remaining, GapRemaining::Integration { seconds: seconds(7200) });
    assert_eq!(panel_two.in_project.label, GapLabel::InProject);

    let plan_area = library.target_project_gaps(ngc7000.id).await.unwrap();
    let [entry] = plan_area.as_slice() else { panic!("{plan_area:#?}") };
    assert_eq!((entry.project_id, entry.project_name.as_str()), (project.id, "Summer nebulae"));
    assert_eq!(entry.subject, nebula.subject, "the Plan area reads the same gaps");
    let panels = library.target_project_gaps(ic1396.id).await.unwrap();
    assert_eq!(panels[0].subject, mosaic.subject);
}
