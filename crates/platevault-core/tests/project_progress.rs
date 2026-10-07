// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project progress warnings (spec 065 PRJ-FR-11, PRJ-AC-07; spec 068
//! CAL-FR-12; D-W29): the exposure-mismatch warning per subject and channel,
//! read from calibration-matching evidence over generated FITS frames indexed
//! through Library scans. A warning is never a goal and assigns nothing.

mod support;

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use persistence_library::SessionQuery;
use platevault_core::library::Library;
use platevault_core::*;
use uuid::Uuid;

/// One frame's header: every calibration criterion recorded.
fn cards<'a>(
    image_type: &'a str,
    filter: Option<&'a str>,
    exposure: &'a str,
    minute: usize,
) -> Vec<(&'static str, String)> {
    let mut cards = vec![
        ("IMAGETYP", format!("'{image_type}'")),
        ("INSTRUME", "'ASI2600MM'".into()),
        ("TELESCOP", "'RedCat 51'".into()),
        ("EXPTIME", exposure.into()),
        ("GAIN", "100".into()),
        ("OFFSET", "50".into()),
        ("XBINNING", "1".into()),
        ("YBINNING", "1".into()),
        ("SET-TEMP", "-10".into()),
        ("DATE-OBS", format!("'2026-09-12T22:{minute:02}:00'")),
    ];
    if let Some(filter) = filter {
        cards.push(("FILTER", format!("'{filter}'")));
    }
    cards
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

fn ngc7000() -> TargetCandidate {
    TargetCandidate {
        id: Uuid::new_v4(),
        designation: "NGC 7000".into(),
        aliases: vec![TargetAlias {
            text: "NGC 7000".into(),
            normalized: "ngc 7000".into(),
            kind: "designation".into(),
            provenance: Provenance::User,
        }],
        common_name: None,
        object_type: "nebula".into(),
        coordinates: Some(SkyCoordinates { ra_deg: 314.75, dec_deg: 44.33, frame: "ICRS".into() }),
        provenance: Provenance::User,
        provider_id: None,
        angular_size: None,
        catalogues: Vec::new(),
    }
}

/// PRJ-FR-11, CAL-FR-12: Ha lights at 300 s find only 120 s darks that match
/// on every other criterion, so Ha warns of an exposure mismatch; OIII lights
/// at 120 s have a matching dark and do not. The warning is no goal row.
#[tokio::test]
async fn exposure_mismatch_warns_per_subject_and_channel() {
    let temp = tempfile::tempdir().unwrap();
    let captures = temp.path().join("Captures");
    let calibration = temp.path().join("Calibration");
    std::fs::create_dir_all(&captures).unwrap();
    std::fs::create_dir_all(&calibration).unwrap();
    for minute in 0..2 {
        write(
            &captures,
            &format!("Ha_{minute:03}.fits"),
            &cards("LIGHT", Some("Ha"), "300", minute),
        );
        write(
            &captures,
            &format!("OIII_{minute:03}.fits"),
            &cards("LIGHT", Some("OIII"), "120", 10 + minute),
        );
        write(
            &calibration,
            &format!("Dark_120_{minute:03}.fits"),
            &cards("DARK", None, "120", 30 + minute),
        );
    }
    let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
    for (root, name, role) in [
        (&captures, "Captures", LocationRole::Captures),
        (&calibration, "Calibration", LocationRole::Calibration),
    ] {
        let location = library
            .register_location(NativePath::from_path(root), name.into(), role)
            .await
            .unwrap();
        scan_to_end(&library, location.id).await;
    }
    let catalog = library.catalog();
    let target = catalog.save_target(&ngc7000(), None).await.unwrap();
    let rig = catalog.save_equipment(&rig(), None).await.unwrap();
    let sessions = catalog.list_sessions(&SessionQuery::default()).await.unwrap();
    assert_eq!(sessions.len(), 2, "one light session per filter: {sessions:#?}");
    for summary in &sessions {
        let id = summary.session.id;
        let expected = |session: &Session| ExpectedSession {
            session_id: session.id,
            grouping_revision: session.grouping_revision,
            decision_revision: session.decision_revision,
        };
        catalog.associate_target(&[expected(&summary.session)], target.candidate.id).await.unwrap();
        let session = catalog.session(id).await.unwrap().summary.session;
        catalog.confirm_equipment(&[expected(&session)], rig.id).await.unwrap();
    }
    let input = ProjectInput {
        name: "NGC 7000 HOO".into(),
        notes: None,
        subjects: vec![SubjectInput {
            target_id: target.candidate.id,
            name: None,
            mosaic: false,
            panels: Vec::new(),
        }],
        rig_ids: vec![rig.id],
        goals: vec![GoalInput {
            target_id: target.candidate.id,
            panel: None,
            goal: GoalSpec::Integration { channel: Some("Ha".into()), goal_seconds: 36_000 },
        }],
    };
    let project = catalog.create_project(&input).await.unwrap();

    let progress = library.project_progress(project.id).await.unwrap();
    assert_eq!((progress.project_id, progress.revision), (project.id, project.revision));
    assert_eq!(
        progress.warnings,
        [ProjectWarning::ExposureMismatch {
            subject_id: project.subjects[0].id,
            channel: Some("Ha".into()),
            light_exposures: vec!["300".into()],
            dark_exposures: vec!["120".into()],
        }]
    );
    let [ha] = progress.goals.as_slice() else { panic!("{:#?}", progress.goals) };
    assert_eq!((ha.captured.frames, ha.in_project.frames), (2, 0), "a warning is no goal");
    assert!(!ha.met);
}
